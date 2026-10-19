import "./style.css";
import { parseCSV } from "./csv.ts";
import {
  CATEGORIES,
  COLUMNS,
  detectColumns,
  missingColumns,
  parseTracks,
  rank,
  toRankedCSV,
  type Category,
  type Cols,
  type Track,
} from "./rank.ts";

interface State {
  fileName: string;
  headers: string[];
  records: string[][];
  cols: Cols;
  filter: Category | null;
  ranked: Track[];
}

let state: State | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const drop = $<HTMLLabelElement>("drop");
const fileInput = $<HTMLInputElement>("file");
const dropTitle = $("drop-title");
const dropHint = $("drop-hint");
const results = $("results");
const minListenersInput = $<HTMLInputElement>("min-listeners");
const provenInput = $<HTMLInputElement>("proven");
const downloadButton = $<HTMLButtonElement>("download");
const mapping = $<HTMLDetailsElement>("mapping");
const mappingGrid = $("mapping-grid");
const errorBox = $("error");
const output = $("output");
const summary = $("summary");
const tabs = $("tabs");
const table = $<HTMLTableElement>("table");
const overlay = $("overlay");

const int = new Intl.NumberFormat("en-US");

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) el.className = className;
  Object.assign(el, rest);
  el.append(...children);
  return el;
}

async function load(file: File) {
  const [headers = [], ...records] = parseCSV(await file.text());
  if (headers.length > 0) headers[0] = headers[0].replace(/^﻿/, "");
  state = { fileName: file.name, headers, records, cols: detectColumns(headers), filter: null, ranked: [] };

  dropTitle.textContent = file.name;
  dropHint.textContent = "Drop another CSV or click to replace";
  drop.classList.add("compact");
  results.hidden = false;
  mapping.open = missingColumns(state.cols).length > 0;
  renderMapping();
  update();
}

function renderMapping() {
  if (!state) return;
  const { headers, cols } = state;
  mappingGrid.replaceChildren(
    ...COLUMNS.map((col) => {
      const select = h(
        "select",
        {
          onchange: () => {
            cols[col.name] = Number(select.value);
            state!.filter = null;
            update();
          },
        },
        h("option", { value: "-1" }, col.required ? "— choose —" : "— none —"),
        ...headers.map((name, i) => h("option", { value: String(i) }, name || `(column ${i + 1})`)),
      );
      select.value = String(cols[col.name]);
      return h("label", { class: "field" }, col.label + (col.required ? " *" : ""), select);
    }),
  );
}

function update() {
  if (!state) return;
  const missing = missingColumns(state.cols);
  if (missing.length > 0) {
    const labels = COLUMNS.filter((c) => missing.includes(c.name)).map((c) => c.label.toLowerCase());
    return showError(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${labels.join(", ")}.`,
      `Found: ${state.headers.join(", ") || "nothing"}. Pick ${missing.length > 1 ? "them" : "it"} in the column mapping above.`,
    );
  }

  const { tracks, skipped } = parseTracks(state.records, state.cols);
  if (tracks.length === 0) {
    return showError("No usable rows found.", skipped.slice(0, 5).join("\n"));
  }

  const minListeners = Math.max(0, Number(minListenersInput.value) || 0);
  const proven = Math.max(0, Number(provenInput.value) || 0);
  state.ranked = rank(tracks, minListeners, proven, state.cols);

  errorBox.hidden = true;
  output.hidden = false;
  downloadButton.disabled = false;
  renderSummary(skipped);
  renderTabs();
  renderTable();
}

function showError(title: string, detail: string) {
  errorBox.replaceChildren(h("strong", {}, title), h("p", {}, detail));
  errorBox.hidden = false;
  output.hidden = true;
  downloadButton.disabled = true;
}

function renderSummary(skipped: string[]) {
  const parts: (Node | string)[] = [`Loaded ${int.format(state!.ranked.length)} tracks`];
  if (skipped.length > 0) {
    parts.push(
      " · ",
      h(
        "details",
        { class: "skipped" },
        h("summary", {}, `${skipped.length} row${skipped.length > 1 ? "s" : ""} skipped`),
        h("pre", {}, skipped.join("\n")),
      ),
    );
  }
  summary.replaceChildren(...parts);
}

function renderTabs() {
  const { ranked, filter } = state!;
  const count = (c: Category | null) => (c ? ranked.filter((t) => t.category === c).length : ranked.length);
  tabs.replaceChildren(
    ...[null, ...CATEGORIES].map((value) =>
      h(
        "button",
        {
          type: "button",
          class: `tab ${value ?? "all"}${filter === value ? " active" : ""}`,
          disabled: count(value) === 0,
          onclick: () => {
            state!.filter = value;
            renderTabs();
            renderTable();
          },
        },
        h("span", { class: "tab-label" }, value ?? "all", h("span", { class: "count" }, String(count(value)))),
      ),
    ),
  );
}

function renderTable() {
  const { ranked, filter, cols } = state!;
  const hasAdds = cols.playlistAdds >= 0;
  const hasRelease = cols.releaseDate >= 0;

  const peerNote = "× compares with the 6 tracks closest in listeners";
  const heads: [string, string?, string?][] = [
    ["#", "num"],
    ["Song"],
    ["Score"],
    ["Category"],
    ["Listeners", "num"],
    ["Streams", "num"],
    ["Saves", "num"],
    ...(hasAdds ? [["Playlist adds", "num"] as [string, string]] : []),
    ["Save rate", "num", `${hasAdds ? "(saves + playlist adds)" : "saves"} / listeners; ${peerNote}`],
    ["Streams / listener", "num", `streams / listeners; ${peerNote}`],
    ...(hasRelease ? [["Release"] as [string]] : []),
    ["Why"],
  ];

  const rows = ranked.flatMap((t, i) => {
    if (filter && t.category !== filter) return [];
    const song = h("td", { class: "song" }, t.song);
    if (t.lowConfidence) {
      song.append(h("span", { class: "low", title: "Fewer listeners than the minimum: score penalized" }, "low sample"));
    }
    return [
      h(
        "tr",
        {},
        h("td", { class: "num muted" }, String(i + 1)),
        song,
        h("td", { class: "score" }, h("span", { class: "score-value" }, t.score.toFixed(1)), scoreBar(t.score)),
        h("td", {}, h("span", { class: `badge ${t.category}` }, t.category)),
        h("td", { class: "num" }, int.format(t.listeners)),
        h("td", { class: "num" }, int.format(t.streams)),
        h("td", { class: "num" }, int.format(t.saves)),
        ...(hasAdds ? [h("td", { class: "num" }, int.format(t.playlistAdds))] : []),
        h("td", { class: "num" }, `${(100 * t.saveRate).toFixed(1)}%`, liftTag(t.saveLift)),
        h("td", { class: "num" }, t.streamsPerListener.toFixed(2), liftTag(t.repeatLift)),
        ...(hasRelease ? [h("td", { class: "nowrap" }, t.releaseDate)] : []),
        h("td", { class: "why" }, t.reason),
      ),
    ];
  });

  table.replaceChildren(
    h("thead", {}, h("tr", {}, ...heads.map(([label, cls, title]) => h("th", { class: cls, title: title ?? "" }, label)))),
    h("tbody", {}, ...rows),
  );
}

// Highlights lifts that clear the test/scale bar (1.1) or fall below reach (0.8).
function liftTag(lift: number) {
  const tone = lift >= 1.1 ? " up" : lift < 0.8 ? " down" : "";
  return h("span", { class: `lift${tone}` }, `${lift.toFixed(1)}×`);
}

function scoreBar(score: number) {
  const fill = h("span");
  fill.style.width = `${score}%`;
  return h("span", { class: "bar" }, fill);
}

function download() {
  if (!state) return;
  const blob = new Blob([toRankedCSV(state.ranked)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  h("a", { href: url, download: state.fileName.replace(/\.csv$/i, "") + "_ranked.csv" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(files: FileList | null | undefined) {
  const file = files?.[0];
  if (file) void load(file);
}

fileInput.addEventListener("change", () => {
  pickFile(fileInput.files);
  fileInput.value = "";
});
minListenersInput.addEventListener("input", update);
provenInput.addEventListener("input", update);
downloadButton.addEventListener("click", download);

// The whole window is a drop target; the overlay shows while files hover it.
let dragDepth = 0;
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) overlay.hidden = true;
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  pickFile(e.dataTransfer?.files);
});
