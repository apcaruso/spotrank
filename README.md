# spotrank

`spotrank` is a small CLI tool that ranks Spotify for Artists song exports and identifies which tracks are better candidates for Meta ads.

It reads a CSV export, detects the relevant columns, computes intent metrics such as save rate and streams per listener, and returns a ranked list of tracks with a category and short explanation.

## Why

Not every track with many streams is a good ad candidate.

For paid acquisition, especially on Meta, the best tracks are usually the ones that combine:

- enough listener volume
- high save rate
- strong repeat listening
- recent momentum, when release date is available

`spotrank` turns those signals into a deterministic ranking.

## Input

Use a CSV export from Spotify for Artists, preferably from the Songs table.

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

Export the full ranking:

```bash
spotrank songs.csv -out ranked.csv
```

## Example output

```text
Loaded 64 tracks
Ranking mode: meta-ads
Minimum listeners: 500

Top 5 ad candidates:

1. drawn the line
   Score: 63.0 | Category: scale
   Listeners: 9778 | Streams: 19771 | Saves: 675
   Save rate: 6.9% | Streams/listener: 2.02 | Release: 2023-11-10
   Why: high save rate and strong repeat listening

2. parasocial activity
   Score: 62.9 | Category: scale
   Listeners: 825 | Streams: 1849 | Saves: 76
   Save rate: 9.2% | Streams/listener: 2.24 | Release: 2025-01-17
   Why: high save rate and strong repeat listening
```

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
save rate              30%
streams per listener   20%
```

If `playlist adds` is available, it is added as another intent signal.

If `release date` is available, the tool adds a small recency component. This helps identify tracks that may still have current momentum.

Scores are based on percentile ranks rather than raw values. This prevents one very large track from flattening the rest of the catalog.

## Categories

Each track receives a category:

```text
scale    strong candidate for paid ads
test     worth testing with a small budget
reach    high volume, acceptable intent
niche    low volume, unusually high intent
ignore   weak or unreliable paid-acquisition signal
```

The category is not based on score alone. It also considers save rate, repeat listening, and sample size.

## Low-confidence samples

By default, tracks with fewer than 500 listeners are marked as low-confidence.

You can change this:

```bash
spotrank songs.csv -min-listeners 100
```

Small samples can produce misleading save rates, so low-confidence tracks are penalized in the final score.

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
