// Port of the ranking model in ../main.go. Keep the two in sync.
import { formatCSV } from "./csv.ts";

export type Category = "scale" | "test" | "reach" | "niche" | "ignore";

export const CATEGORIES: Category[] = ["scale", "test", "reach", "niche", "ignore"];

export interface Track {
  song: string;
  listeners: number;
  streams: number;
  saves: number;
  playlistAdds: number;
  releaseDate: string;

  saveRate: number;
  streamsPerListener: number;
  saveLift: number;
  repeatLift: number;
  ageDays: number;
  recency: number;

  score: number;
  category: Category;
  reason: string;
  lowConfidence: boolean;
}

export interface Cols {
  song: number;
  listeners: number;
  streams: number;
  saves: number;
  playlistAdds: number;
  releaseDate: number;
}

export type ColName = keyof Cols;

export const COLUMNS: { name: ColName; label: string; required: boolean; aliases: string[] }[] = [
  { name: "song", label: "Song", required: true, aliases: ["song", "track", "title", "track name", "song name"] },
  { name: "listeners", label: "Listeners", required: true, aliases: ["listeners", "unique listeners", "unique listener"] },
  { name: "streams", label: "Streams", required: true, aliases: ["streams", "plays"] },
  { name: "saves", label: "Saves", required: true, aliases: ["saves", "save", "saves count"] },
  {
    name: "playlistAdds",
    label: "Playlist adds",
    required: false,
    aliases: ["playlist adds", "playlist add", "playlist adds count", "playlist_adds"],
  },
  {
    name: "releaseDate",
    label: "Release date",
    required: false,
    aliases: ["release date", "release_date", "released", "release"],
  },
];

export function detectColumns(headers: string[]): Cols {
  const c = {} as Cols;
  for (const { name, aliases } of COLUMNS) {
    const wanted = aliases.map(norm);
    c[name] = headers.findIndex((h) => wanted.includes(norm(h)));
  }
  return c;
}

export function missingColumns(c: Cols): ColName[] {
  return COLUMNS.filter((col) => col.required && c[col.name] < 0).map((col) => col.name);
}

// records excludes the header row.
export function parseTracks(records: string[][], c: Cols, now = Date.now()): { tracks: Track[]; skipped: string[] } {
  const tracks: Track[] = [];
  const skipped: string[] = [];
  records.forEach((row, i) => {
    try {
      const t = parse(row, c, now);
      if (t.song !== "") tracks.push(t);
    } catch (err) {
      skipped.push(`row ${i + 2}: ${(err as Error).message}`);
    }
  });
  return { tracks, skipped };
}

function parse(row: string[], c: Cols, now: number): Track {
  const num = (name: string, i: number) => {
    const n = atoi(field(row, i));
    if (n === null) throw new Error(`bad ${name}: ${JSON.stringify(field(row, i))}`);
    return n;
  };
  const listeners = num("listeners", c.listeners);
  const streams = num("streams", c.streams);
  const saves = num("saves", c.saves);

  const t: Track = {
    song: field(row, c.song),
    listeners,
    streams,
    saves,
    playlistAdds: 0,
    releaseDate: "",
    saveRate: 0,
    streamsPerListener: 0,
    saveLift: 0,
    repeatLift: 0,
    ageDays: 0,
    recency: 0,
    score: 0,
    category: "ignore",
    reason: "",
    lowConfidence: false,
  };
  if (c.playlistAdds >= 0) {
    t.playlistAdds = atoi(field(row, c.playlistAdds)) ?? 0;
  }
  if (c.releaseDate >= 0) {
    t.releaseDate = field(row, c.releaseDate);
    t.ageDays = ageDays(t.releaseDate, now);
    t.recency = recency(t.ageDays);
  }
  if (listeners > 0) {
    // Playlist adds count as saves (0 when the column is missing).
    t.saveRate = (saves + t.playlistAdds) / listeners;
    t.streamsPerListener = streams / listeners;
  }
  return t;
}

// Scores tracks in place and returns them sorted best first.
export function rank(tracks: Track[], minListeners: number, proven: number, c: Cols): Track[] {
  peerLifts(tracks);

  const metrics: [number, (t: Track) => number][] = [
    [0.25, (t) => t.listeners],
    [0.15, (t) => t.streams],
    [0.3, (t) => t.saveLift],
    [0.2, (t) => t.repeatLift],
  ];
  if (c.releaseDate >= 0) {
    metrics.push([0.1, (t) => t.recency]);
  }

  const total = metrics.reduce((sum, [w]) => sum + w, 0);
  const scores = new Array<number>(tracks.length).fill(0);
  for (const [weight, value] of metrics) {
    const r = ranks(tracks.map(value));
    tracks.forEach((_, i) => (scores[i] += (weight / total) * r[i]));
  }

  tracks.forEach((t, i) => {
    t.lowConfidence = t.listeners < minListeners;
    t.score = t.lowConfidence ? scores[i] * 0.75 : scores[i];
    [t.category, t.reason] = classify(t, proven);
  });
  return [...tracks].sort((a, b) => b.score - a.score);
}

// How many tracks of similar audience size a track is compared with.
const PEER_COUNT = 6;

// Compares each track's save rate and streams per listener with the tracks
// closest to it in listeners (about half above, half below). Small tracks are
// heard mostly by fans and save far more than big ones, so a fixed threshold
// would mean different things at different sizes.
function peerLifts(tracks: Track[]) {
  const byListeners = [...tracks].sort((a, b) => a.listeners - b.listeners);
  const n = byListeners.length;
  byListeners.forEach((t, i) => {
    const lo = Math.max(0, Math.min(i - PEER_COUNT / 2, n - 1 - PEER_COUNT));
    const peers = byListeners.slice(lo, lo + PEER_COUNT + 1).filter((p) => p !== t);
    t.saveLift = lift(t.saveRate, median(peers.map((p) => p.saveRate)));
    t.repeatLift = lift(t.streamsPerListener, median(peers.map((p) => p.streamsPerListener)));
  });
}

function lift(v: number, ref: number): number {
  return ref > 0 ? v / ref : 1;
}

function median(v: number[]): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Below this many listeners a track has no usable signal, even as niche.
const NICHE_MIN_LISTENERS = 100;

function classify(t: Track, proven: number): [Category, string] {
  const { saveLift: sl, repeatLift: rl, streamsPerListener: spl } = t;
  const x = (v: number) => `${v.toFixed(1)}×`;
  const isProven = t.listeners >= proven;
  if (t.lowConfidence && t.listeners >= NICHE_MIN_LISTENERS && sl >= 1.25 && rl >= 1.0) {
    return ["niche", `small sample, but saves ${x(sl)} similar-size tracks`];
  }
  if (t.lowConfidence) return ["ignore", "sample too small for paid scaling"];
  if (isProven && sl >= 1.1 && rl >= 1.0 && spl >= 1.5) {
    return ["scale", `proven audience; saves ${x(sl)} and repeats ${x(rl)} similar-size tracks`];
  }
  if (sl >= 1.1 && rl >= 0.95 && spl >= 1.5) {
    return isProven
      ? ["test", `saves ${x(sl)} similar-size tracks, but repeat listening is only average`]
      : ["test", `saves ${x(sl)} similar-size tracks; not enough volume to scale yet`];
  }
  if (isProven && sl >= 0.8) return ["reach", `large audience; saves ${x(sl)} similar-size tracks`];
  return ["ignore", `weak intent for its size: saves ${x(sl)}, repeats ${x(rl)} similar-size tracks`];
}

// Percentile rank 0..100; ties share their average rank.
function ranks(v: number[]): number[] {
  const order = v.map((value, i) => ({ i, value })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(v.length).fill(0);
  if (v.length === 1) {
    out[0] = 100;
    return out;
  }
  for (let i = 0; i < order.length; ) {
    let j = i + 1;
    while (j < order.length && order[j].value === order[i].value) j++;
    const r = (100 * ((i + j - 1) / 2)) / (order.length - 1);
    for (let k = i; k < j; k++) out[order[k].i] = r;
    i = j;
  }
  return out;
}

export function toRankedCSV(tracks: Track[]): string {
  const rows = [
    ["rank", "song", "score", "category", "reason", "listeners", "streams", "saves", "playlist_adds", "save_rate", "streams_per_listener", "save_lift", "repeat_lift", "release_date", "low_confidence"],
    ...tracks.map((t, i) => [
      String(i + 1),
      t.song,
      t.score.toFixed(2),
      t.category,
      t.reason,
      String(t.listeners),
      String(t.streams),
      String(t.saves),
      String(t.playlistAdds),
      t.saveRate.toFixed(4),
      t.streamsPerListener.toFixed(4),
      t.saveLift.toFixed(4),
      t.repeatLift.toFixed(4),
      t.releaseDate,
      String(t.lowConfidence),
    ]),
  ];
  return formatCSV(rows);
}

function atoi(s: string): number | null {
  s = s.trim().replaceAll(",", "").replaceAll(" ", "");
  if (s === "") return 0;
  return /^[+-]?\d+$/.test(s) ? Number(s) : null;
}

function field(row: string[], i: number): string {
  return i < 0 || i >= row.length ? "" : row[i].trim();
}

export function norm(s: string): string {
  return s
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/ {2,}/g, " ");
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Accepts YYYY-MM-DD, YYYY-MM or YYYY; anything else counts as very old.
function ageDays(s: string, now: number): number {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s);
  if (!m) return 99999;
  const [y, mo, d] = [Number(m[1]), Number(m[2] ?? 1), Number(m[3] ?? 1)];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return 99999;
  date.setUTCFullYear(y); // Date.UTC maps years 0-99 to 1900-1999
  return Math.trunc((now - date.getTime()) / DAY_MS);
}

function recency(days: number): number {
  if (days < 0) return 1;
  if (days > 730) return 0;
  return 1 - days / 730;
}
