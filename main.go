package main

import (
	"encoding/csv"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Track struct {
	Song         string
	Listeners    int
	Streams      int
	Saves        int
	PlaylistAdds int
	ReleaseDate  string

	SaveRate           float64
	StreamsPerListener float64
	PlaylistAddRate    float64
	AgeDays            int
	Recency            float64

	Score         float64
	Category      string
	Reason        string
	LowConfidence bool
}

type Cols struct {
	Song         int
	Listeners    int
	Streams      int
	Saves        int
	PlaylistAdds int
	ReleaseDate  int
}

type Config struct {
	Top          int
	MinListeners int
	Out          string
	Inspect      bool
	CSVInfo      bool

	SongCol         string
	ListenersCol    string
	StreamsCol      string
	SavesCol        string
	PlaylistAddsCol string
	ReleaseDateCol  string
}

type Metric struct {
	Name   string
	Weight float64
	Values []float64
}

func main() {
	var cfg Config
	flag.IntVar(&cfg.Top, "top", 5, "number of tracks to print")
	flag.IntVar(&cfg.MinListeners, "min-listeners", 500, "listeners needed before a track is high-confidence")
	flag.StringVar(&cfg.Out, "out", "", "write full ranked CSV to path")
	flag.BoolVar(&cfg.Inspect, "inspect", false, "print detected columns and exit")
	flag.BoolVar(&cfg.CSVInfo, "csv-info", false, "print CSV dialect and first rows")

	flag.StringVar(&cfg.SongCol, "song", "", "song/title column name")
	flag.StringVar(&cfg.ListenersCol, "listeners", "", "listeners column name")
	flag.StringVar(&cfg.StreamsCol, "streams", "", "streams column name")
	flag.StringVar(&cfg.SavesCol, "saves", "", "saves column name")
	flag.StringVar(&cfg.PlaylistAddsCol, "playlist-adds", "", "playlist adds column name")
	flag.StringVar(&cfg.ReleaseDateCol, "release-date", "", "release date column name")

	flag.Usage = usage

	path, args, err := splitArgs(os.Args[1:])
	if err != nil {
		die(err.Error())
	}
	if err := flag.CommandLine.Parse(args); err != nil {
		os.Exit(2)
	}
	if path == "" {
		usage()
		os.Exit(1)
	}
	tracks, headers, cols, err := readInput(path, cfg)
	if err != nil {
		die(err.Error())
	}

	if cfg.CSVInfo {
		printCSVInfo(path, headers)
		return
	}
	if cfg.Inspect {
		printInspect(headers, cols, len(tracks))
		return
	}
	if len(tracks) == 0 {
		die("no usable rows found")
	}

	score(tracks, cfg.MinListeners, cols)
	sort.SliceStable(tracks, func(i, j int) bool { return tracks[i].Score > tracks[j].Score })
	printReport(tracks, cfg, cols)

	if cfg.Out != "" {
		if err := writeRankedCSV(cfg.Out, tracks); err != nil {
			die(err.Error())
		}
		fmt.Printf("\nWrote %s\n", cfg.Out)
	}
}

func splitArgs(args []string) (string, []string, error) {
	needValue := map[string]bool{
		"-top": true, "-min-listeners": true, "-out": true,
		"-song": true, "-listeners": true, "-streams": true,
		"-saves": true, "-playlist-adds": true, "-release-date": true,
	}

	var path string
	out := make([]string, 0, len(args))

	for i := 0; i < len(args); i++ {
		a := args[i]

		if strings.HasPrefix(a, "-") {
			out = append(out, a)
			name := a
			if j := strings.IndexByte(a, '='); j >= 0 {
				name = a[:j]
			}
			if needValue[name] && !strings.Contains(a, "=") {
				if i+1 >= len(args) {
					return "", nil, fmt.Errorf("%s needs a value", a)
				}
				i++
				out = append(out, args[i])
			}
			continue
		}

		if path == "" {
			path = a
			continue
		}

		return "", nil, fmt.Errorf("multiple input files: %s and %s", path, a)
	}

	return path, out, nil
}

func usage() {
	fmt.Fprintf(os.Stderr, `Usage:
  spotrank <csv> [options]

Examples:
  spotrank songs.csv
  spotrank songs.csv -inspect
  spotrank songs.csv -top 10 -min-listeners 1000
  spotrank songs.csv -out ranked.csv

Required columns, auto-detected case-insensitively:
  song/title, listeners, streams, saves

Optional columns:
  playlist adds, release date

Options:
`)
	flag.PrintDefaults()
}

func readInput(path string, cfg Config) ([]*Track, []string, Cols, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, Cols{}, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true

	headers, err := r.Read()
	if err != nil {
		return nil, nil, Cols{}, fmt.Errorf("read header: %w", err)
	}
	trimBOM(headers)

	cols, err := detect(headers, cfg)
	if err != nil {
		return nil, headers, cols, err
	}

	var tracks []*Track
	rownum := 1
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		rownum++
		if err != nil {
			return nil, headers, cols, fmt.Errorf("row %d: %w", rownum, err)
		}

		t, err := parse(row, cols)
		if err != nil {
			fmt.Fprintf(os.Stderr, "skip row %d: %v\n", rownum, err)
			continue
		}
		if t.Song == "" {
			continue
		}
		tracks = append(tracks, t)
	}

	return tracks, headers, cols, nil
}

func detect(headers []string, cfg Config) (Cols, error) {
	c := Cols{-1, -1, -1, -1, -1, -1}
	c.Song = col(headers, cfg.SongCol, "song", "track", "title", "track name", "song name")
	c.Listeners = col(headers, cfg.ListenersCol, "listeners", "unique listeners", "unique listener")
	c.Streams = col(headers, cfg.StreamsCol, "streams", "plays")
	c.Saves = col(headers, cfg.SavesCol, "saves", "save", "saves count")
	c.PlaylistAdds = col(headers, cfg.PlaylistAddsCol, "playlist adds", "playlist add", "playlist adds count", "playlist_adds")
	c.ReleaseDate = col(headers, cfg.ReleaseDateCol, "release date", "release_date", "released", "release")

	var missing []string
	if c.Song < 0 {
		missing = append(missing, "song")
	}
	if c.Listeners < 0 {
		missing = append(missing, "listeners")
	}
	if c.Streams < 0 {
		missing = append(missing, "streams")
	}
	if c.Saves < 0 {
		missing = append(missing, "saves")
	}
	if len(missing) > 0 {
		return c, fmt.Errorf("%s", missingMessage(missing, headers))
	}
	return c, nil
}

func col(headers []string, manual string, aliases ...string) int {
	if manual != "" {
		for i, h := range headers {
			if norm(h) == norm(manual) {
				return i
			}
		}
		return -1
	}
	for i, h := range headers {
		nh := norm(h)
		for _, a := range aliases {
			if nh == norm(a) {
				return i
			}
		}
	}
	return -1
}

func parse(row []string, c Cols) (*Track, error) {
	listeners, err := atoi(field(row, c.Listeners))
	if err != nil {
		return nil, fmt.Errorf("bad listeners: %q", field(row, c.Listeners))
	}
	streams, err := atoi(field(row, c.Streams))
	if err != nil {
		return nil, fmt.Errorf("bad streams: %q", field(row, c.Streams))
	}
	saves, err := atoi(field(row, c.Saves))
	if err != nil {
		return nil, fmt.Errorf("bad saves: %q", field(row, c.Saves))
	}

	t := &Track{Song: field(row, c.Song), Listeners: listeners, Streams: streams, Saves: saves}
	if c.PlaylistAdds >= 0 {
		t.PlaylistAdds, _ = atoi(field(row, c.PlaylistAdds))
	}
	if c.ReleaseDate >= 0 {
		t.ReleaseDate = field(row, c.ReleaseDate)
		t.AgeDays = ageDays(t.ReleaseDate)
		t.Recency = recency(t.AgeDays)
	}
	if listeners > 0 {
		t.SaveRate = float64(saves) / float64(listeners)
		t.StreamsPerListener = float64(streams) / float64(listeners)
		t.PlaylistAddRate = float64(t.PlaylistAdds) / float64(listeners)
	}
	return t, nil
}

func score(tracks []*Track, minListeners int, cols Cols) {
	metrics := []Metric{
		{"listeners", 0.25, values(tracks, func(t *Track) float64 { return float64(t.Listeners) })},
		{"streams", 0.15, values(tracks, func(t *Track) float64 { return float64(t.Streams) })},
		{"save_rate", 0.30, values(tracks, func(t *Track) float64 { return t.SaveRate })},
		{"streams_per_listener", 0.20, values(tracks, func(t *Track) float64 { return t.StreamsPerListener })},
	}
	if cols.PlaylistAdds >= 0 {
		metrics = append(metrics, Metric{"playlist_add_rate", 0.10, values(tracks, func(t *Track) float64 { return t.PlaylistAddRate })})
	} else if cols.ReleaseDate >= 0 {
		metrics = append(metrics, Metric{"recency", 0.10, values(tracks, func(t *Track) float64 { return t.Recency })})
	}
	if cols.PlaylistAdds >= 0 && cols.ReleaseDate >= 0 {
		metrics = append(metrics, Metric{"recency", 0.05, values(tracks, func(t *Track) float64 { return t.Recency })})
	}

	total := 0.0
	for _, m := range metrics {
		total += m.Weight
	}

	scores := make([]float64, len(tracks))
	for _, m := range metrics {
		ranks := ranks(m.Values)
		for i := range tracks {
			scores[i] += (m.Weight / total) * ranks[i]
		}
	}

	for i, t := range tracks {
		t.LowConfidence = t.Listeners < minListeners
		t.Score = scores[i]
		if t.LowConfidence {
			t.Score *= 0.75
		}
		t.Category, t.Reason = classify(t)
	}
}

func classify(t *Track) (string, string) {
	sr := t.SaveRate
	spl := t.StreamsPerListener
	switch {
	case t.LowConfidence && sr >= 0.10:
		return "niche", "low volume, but unusually high save rate"
	case t.LowConfidence:
		return "ignore", "sample too small for paid scaling"
	case sr >= 0.06 && spl >= 1.70:
		return "scale", "high save rate and strong repeat listening"
	case sr >= 0.05 && spl >= 1.50:
		return "test", "good intent signals; test with small budget"
	case t.Listeners >= 5000 && sr >= 0.035:
		return "reach", "large audience and acceptable save rate"
	case spl >= 2.0:
		return "test", "repeat listening is strong"
	default:
		return "ignore", "weak paid-acquisition signal"
	}
}

func values(tracks []*Track, f func(*Track) float64) []float64 {
	v := make([]float64, len(tracks))
	for i, t := range tracks {
		v[i] = f(t)
	}
	return v
}

func ranks(v []float64) []float64 {
	type pair struct {
		i int
		v float64
	}
	p := make([]pair, len(v))
	for i := range v {
		p[i] = pair{i, v[i]}
	}
	sort.SliceStable(p, func(i, j int) bool { return p[i].v < p[j].v })

	out := make([]float64, len(v))
	if len(v) == 1 {
		out[0] = 100
		return out
	}

	for i := 0; i < len(p); {
		j := i + 1
		for j < len(p) && p[j].v == p[i].v {
			j++
		}
		avg := float64(i+j-1) / 2.0
		r := 100.0 * avg / float64(len(p)-1)
		for k := i; k < j; k++ {
			out[p[k].i] = r
		}
		i = j
	}
	return out
}

func printReport(tracks []*Track, cfg Config, cols Cols) {
	n := cfg.Top
	if n > len(tracks) {
		n = len(tracks)
	}

	fmt.Printf("Loaded %d tracks\n", len(tracks))
	fmt.Printf("Ranking mode: meta-ads\n")
	fmt.Printf("Minimum listeners: %d\n\n", cfg.MinListeners)
	fmt.Printf("Top %d ad candidates:\n\n", n)

	for i := 0; i < n; i++ {
		t := tracks[i]
		fmt.Printf("%d. %s\n", i+1, t.Song)
		fmt.Printf("   Score: %.1f | Category: %s\n", t.Score, t.Category)
		fmt.Printf("   Listeners: %d | Streams: %d | Saves: %d", t.Listeners, t.Streams, t.Saves)
		if cols.PlaylistAdds >= 0 {
			fmt.Printf(" | Playlist adds: %d", t.PlaylistAdds)
		}
		fmt.Println()
		fmt.Printf("   Save rate: %.1f%% | Streams/listener: %.2f", 100*t.SaveRate, t.StreamsPerListener)
		if cols.ReleaseDate >= 0 {
			fmt.Printf(" | Release: %s", t.ReleaseDate)
		}
		fmt.Println()
		fmt.Printf("   Why: %s\n", t.Reason)
		if t.LowConfidence {
			fmt.Printf("   Warning: low-confidence sample\n")
		}
		fmt.Println()
	}
}

func printInspect(headers []string, c Cols, rows int) {
	fmt.Printf("Rows: %d\n\n", rows)
	fmt.Println("Columns found:")
	for _, h := range headers {
		fmt.Printf("  %s\n", h)
	}
	fmt.Println("\nDetected mapping:")
	mapping("song", headers, c.Song)
	mapping("listeners", headers, c.Listeners)
	mapping("streams", headers, c.Streams)
	mapping("saves", headers, c.Saves)
	mapping("playlist_adds", headers, c.PlaylistAdds)
	mapping("release_date", headers, c.ReleaseDate)
	fmt.Println("\nStatus: OK")
}

func mapping(name string, headers []string, i int) {
	if i < 0 {
		fmt.Printf("  %-14s -> missing\n", name)
		return
	}
	fmt.Printf("  %-14s -> %s\n", name, headers[i])
}

func printCSVInfo(path string, headers []string) {
	fmt.Printf("File: %s\n", path)
	fmt.Println("Headers:")
	for _, h := range headers {
		fmt.Printf("  %q\n", h)
	}
}

func writeRankedCSV(path string, tracks []*Track) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer f.Close()
	w := csv.NewWriter(f)
	defer w.Flush()

	w.Write([]string{"rank", "song", "score", "category", "reason", "listeners", "streams", "saves", "playlist_adds", "save_rate", "streams_per_listener", "release_date", "low_confidence"})
	for i, t := range tracks {
		row := []string{strconv.Itoa(i + 1), t.Song, fmt.Sprintf("%.2f", t.Score), t.Category, t.Reason, strconv.Itoa(t.Listeners), strconv.Itoa(t.Streams), strconv.Itoa(t.Saves), strconv.Itoa(t.PlaylistAdds), fmt.Sprintf("%.4f", t.SaveRate), fmt.Sprintf("%.4f", t.StreamsPerListener), t.ReleaseDate, strconv.FormatBool(t.LowConfidence)}
		if err := w.Write(row); err != nil {
			return err
		}
	}
	return w.Error()
}

func atoi(s string) (int, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", "")
	s = strings.ReplaceAll(s, " ", "")
	if s == "" {
		return 0, nil
	}
	return strconv.Atoi(s)
}

func field(row []string, i int) string {
	if i < 0 || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

func trimBOM(headers []string) {
	if len(headers) > 0 {
		headers[0] = strings.TrimPrefix(headers[0], "\ufeff")
	}
}

func norm(s string) string {
	s = strings.TrimPrefix(s, "\ufeff")
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "_", " ")
	s = strings.ReplaceAll(s, "-", " ")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return s
}

func ageDays(s string) int {
	if s == "" {
		return 99999
	}
	layouts := []string{"2006-01-02", "2006-01", "2006"}
	for _, layout := range layouts {
		d, err := time.Parse(layout, s)
		if err == nil {
			return int(time.Since(d).Hours() / 24)
		}
	}
	return 99999
}

func recency(days int) float64 {
	if days < 0 {
		return 1
	}
	if days > 730 {
		return 0
	}
	return 1 - float64(days)/730.0
}

func missingMessage(missing []string, headers []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "missing required column(s): %s\n\n", strings.Join(missing, ", "))
	fmt.Fprintf(&b, "Found columns:\n")
	for _, h := range headers {
		fmt.Fprintf(&b, "  %s\n", h)
	}
	fmt.Fprintf(&b, "\nPass columns explicitly, e.g.\n")
	fmt.Fprintf(&b, "  spotrank songs.csv -song song -listeners listeners -streams streams -saves saves\n")
	return b.String()
}

func die(s string) {
	fmt.Fprintln(os.Stderr, s)
	os.Exit(1)
}
