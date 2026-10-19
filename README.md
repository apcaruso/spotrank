# spotrank

`spotrank` is a small CLI tool that ranks Spotify for Artists song exports and identifies which tracks are better candidates for Meta ads.

It reads a CSV export, detects the relevant columns, computes intent metrics such as save rate and streams per listener, and returns a ranked list of tracks with a category and short explanation.

## Why

Not every track with many streams is a good ad candidate.

For paid acquisition, especially on Meta, the best tracks are usually the ones that combine:

- enough listener volume
- a high save rate for their audience size
- strong repeat listening
- recent momentum, when release date is available

`spotrank` turns those signals into a deterministic ranking.

## Input

Use a CSV export from Spotify for Artists, preferably from the Songs table. A window of about the last 12 months works well: long enough to have volume, without the release-week spike from existing fans that an all-time export includes.

Required columns:

```text
song / track / title
listeners
streams
saves
```

Optional columns:

```text
playlist adds
release date
```

Column names are detected case-insensitively. Common variants such as `song`, `track`, `Track Name`, `streams`, `saves`, and `release_date` are supported.

## Build

From the project directory:

```bash
go build -o spotrank main.go
```

## Install without sudo

Create a local binary directory:

```bash
mkdir -p ~/bin
```

Build directly into it:

```bash
go build -o ~/bin/spotrank main.go
```

Add `~/bin` to your shell path.

For `zsh`:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

For `bash`:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Verify:

```bash
which spotrank
spotrank -h
```

Now you can run `spotrank` from any directory.

## Usage

Basic ranking:

```bash
spotrank songs.csv
```

Inspect the CSV and detected columns:

```bash
spotrank songs.csv -inspect
```

Show more results:

```bash
spotrank songs.csv -top 10
```

Change the minimum listener threshold:

```bash
spotrank songs.csv -min-listeners 1000
```

Change how many listeners a track needs before it can be `scale` or `reach`:

```bash
spotrank songs.csv -proven 5000
```

Export the full ranking:

```bash
spotrank songs.csv -out ranked.csv
```

## Example output

```text
Loaded 64 tracks
Ranking mode: meta-ads
Minimum listeners: 500
Proven audience: 2000 listeners

Top 5 ad candidates:

1. drawn the line
   Score: 89.8 | Category: scale
   Listeners: 9778 | Streams: 19771 | Saves: 675
   Save rate: 6.9% (1.7× similar) | Streams/listener: 2.02 (1.2× similar) | Release: 2023-11-10
   Why: proven audience; saves 1.7× and repeats 1.2× similar-size tracks

2. monkey island (CMPLEX Remix)
   Score: 85.6 | Category: scale
   Listeners: 8902 | Streams: 16214 | Saves: 518
   Save rate: 5.8% (1.4× similar) | Streams/listener: 1.82 (1.1× similar) | Release: 2025-04-18
   Why: proven audience; saves 1.4× and repeats 1.1× similar-size tracks
```

## Web UI

`web/` contains a browser version written in TypeScript. Drag a CSV onto the page and it shows the full ranking, with category filters, the minimum-listeners and proven-audience controls, a column mapping panel, and a ranked CSV download in the same format as `-out`.

The file never leaves your machine: parsing and scoring run in the browser, using a port of the CLI's model (`web/src/rank.ts`). Keep it in sync with `main.go` when the scoring changes.

```bash
cd web
npm install
npm run dev
```

`npm run build` writes a static site to `web/dist/` that can be hosted anywhere.

## Manual column mapping

If your CSV uses unusual column names, pass them explicitly:

```bash
spotrank songs.csv \
  -song "Track Name" \
  -listeners "Unique listeners" \
  -streams "Streams" \
  -saves "Saves"
```

Optional fields can also be mapped:

```bash
spotrank songs.csv \
  -song "Track Name" \
  -listeners "Listeners" \
  -streams "Streams" \
  -saves "Saves" \
  -release-date "Release Date" \
  -playlist-adds "Playlist Adds"
```

## Scoring model

The default ranking is tuned for Meta ads.

Base weights:

```text
listeners              25%
streams                15%
save lift              30%
repeat lift            20%
recency                10%   (only when release date is available)
```

Save rate is `saves / listeners`. If `playlist adds` is available, playlist adds count as saves: `(saves + playlist adds) / listeners`.

### Compared with similar-size tracks

Save rate falls sharply as a track's audience grows. Small tracks are heard almost only by fans (and often pick up saves when someone saves the whole release), while big tracks reach strangers through algorithmic playlists. A 6% save rate is excellent at 10,000 listeners and below average at 800.

So save rate and streams per listener are not judged in absolute terms. Each track is compared with the 6 tracks of the catalog closest to it in listeners (about half above, half below), using their median:

```text
save lift    = save rate / median save rate of similar-size tracks
repeat lift  = streams per listener / median of similar-size tracks
```

A save lift of `1.7×` means the track saves 70% more than tracks with a comparable audience. This adapts automatically to genre, export window and catalog size, without relying on universal benchmarks. It also means categories describe the best tracks of *your* catalog: real campaign results are still the final test.

Scores use percentile ranks rather than raw values. This prevents one very large track from flattening the rest of the catalog.

## Categories

Each track receives a category:

```text
scale    proven audience and above-peer intent: put budget behind it
test     above-peer intent, but not enough volume (or repeat) to scale yet
reach    proven audience, roughly average intent for its size
niche    small sample, but clearly above similar-size tracks
ignore   weak or unreliable paid-acquisition signal
```

Rules, checked in order:

```text
niche    below -min-listeners, at least 100 listeners, save lift ≥ 1.25, repeat lift ≥ 1.0
ignore   any other track below -min-listeners
scale    at least -proven listeners, save lift ≥ 1.1, repeat lift ≥ 1.0, streams/listener ≥ 1.5
test     save lift ≥ 1.1, repeat lift ≥ 0.95, streams/listener ≥ 1.5
reach    at least -proven listeners, save lift ≥ 0.8
ignore   everything else
```

## Sample size

Two listener thresholds control how much a track's numbers are trusted:

- `-min-listeners` (default 500): below this a track is a low-confidence sample. Its score is multiplied by 0.75 and it can only be `niche` or `ignore`.
- `-proven` (default 2000): a track needs this many listeners to be `scale` or `reach`. Between the two thresholds it can be at most `test`.

At a 5% save rate the uncertainty is about ±1 point with 500 listeners and about ±0.5 with 2,000, so smaller differences between tracks are mostly noise.

```bash
spotrank songs.csv -min-listeners 300 -proven 1000
```

## Export format

When using:

```bash
spotrank songs.csv -out ranked.csv
```

The output CSV includes:

```text
rank
song
score
category
reason
listeners
streams
saves
playlist_adds
save_rate
streams_per_listener
save_lift
repeat_lift
release_date
low_confidence
```

## Notes

`spotrank` does not predict ad performance directly. It ranks tracks by observable listener-intent signals.

Use it to choose what to test first, then validate with real campaign data:

- video retention
- click-through rate
- cost per landing page view
- Spotify listeners
- saves
- streams per listener
- follower growth

The best ad candidate is not always the biggest track. It is usually the track that converts attention into repeat listening and saves.
