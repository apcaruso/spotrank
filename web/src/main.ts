import "@fontsource-variable/fraunces/soft.css";
import "./style.css";
import { parseCSV } from "./csv.ts";
import { ART, icon } from "./icons.ts";
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

// What each category means, in the garden's terms.
const ABOUT: Record<Category, string> = {
  scale: "In bloom: proven audience and saves above similar-size tracks. Put budget behind these.",
  test: "Budding: strong intent, but not enough volume or repeat listening yet. Test with a small budget.",
  reach: "Leafy: a big audience with average intent for its size. Good for reach, less for conversions.",
  niche: "Seedling: a small sample, but clearly above similar-size tracks. A cheap test at most.",
  ignore: "Dormant: a weak or unreliable signal for paid ads.",
};

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
const picks = $("picks");
const picksTitle = $("picks-title");
const picksNote = $("picks-note");
const picksGrid = $("picks-grid");
const tabs = $("tabs");
const tabNote = $("tab-note");
const table = $<HTMLTableElement>("table");
const overlay = $("overlay");

const int = new Intl.NumberFormat("en-US");

for (const el of document.querySelectorAll<HTMLElement>("[data-art]")) {
  el.innerHTML = ART[el.dataset.art as keyof typeof ART];
}

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
      return h("label", { class: "field" }, h("span", {}, col.label + (col.required ? " *" : "")), select);
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
  renderPicks();
  renderTabs();
  renderTable();
}

function showError(title: string, detail: string) {
  errorBox.replaceChildren(h("strong", {}, title), h("p", {}, detail));
  errorBox.hidden = false;
  output.hidden = true;
  downloadButton.disabled = true;
  summary.replaceChildren();
}

function renderSummary(skipped: string[]) {
  const parts: (Node | string)[] = [`${int.format(state!.ranked.length)} tracks ranked`];
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

// The answer to "what should I advertise?": tracks in bloom, or the best buds
// when nothing has bloomed yet.
function renderPicks() {
  const { ranked } = state!;
  const bloom = ranked.filter((t) => t.category === "scale");
  const shown = bloom.length > 0 ? bloom.slice(0, 6) : ranked.filter((t) => t.category === "test").slice(0, 3);
  picks.hidden = shown.length === 0;
  if (shown.length === 0) return;

  picksTitle.textContent = bloom.length > 0 ? "Ready to bloom" : "Nothing in full bloom yet";
  picksNote.textContent =
    bloom.length > 0
      ? "Proven audience and saves above similar-size tracks. Start your ads here."
      : "No track has a proven audience with strong intent yet. These are the best ones to test first.";
  picksGrid.replaceChildren(
    ...shown.map((t) =>
      h(
        "article",
        { class: `pick ${t.category}` },
        h("div", { class: "pick-top" }, icon(t.category), h("span", { class: "pick-rank" }, `#${ranked.indexOf(t) + 1}`), scoreRing(t.score)),
        h("h3", {}, t.song),
        h(
          "p",
          { class: "pick-lifts" },
          h("span", {}, h("strong", {}, `${t.saveLift.toFixed(1)}×`), " saves"),
          h("span", {}, h("strong", {}, `${t.repeatLift.toFixed(1)}×`), " repeats"),
        ),
        h("p", { class: "pick-meta" }, `vs similar-size tracks · ${int.format(t.listeners)} listeners · ${percent(t.saveRate)} save rate`),
      ),
    ),
  );
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
        ...(value ? [icon(value)] : []),
        value ?? "all",
        h("span", { class: "count" }, String(count(value))),
      ),
    ),
  );
  tabNote.textContent = filter ? ABOUT[filter] : "Every track, best ad candidates first.";
}

function renderTable() {
  const { ranked, filter, cols } = state!;
  const hasAdds = cols.playlistAdds >= 0;
  const hasRelease = cols.releaseDate >= 0;

  const peerNote = "× compares with the 6 tracks closest in listeners";
  const heads: [string, string, string?][] = [
    ["#", "c-rank"],
    ["Track", "c-track"],
    ["Category", "c-cat"],
    ["Score", "c-score"],
    ["Listeners", "c-listeners num"],
    ["Save rate", "c-save num", `${hasAdds ? "(saves + playlist adds)" : "saves"} / listeners; ${peerNote}`],
    ["Streams / listener", "c-repeat num", `streams / listeners; ${peerNote}`],
    ["Why", "c-why"],
  ];

  const rows = ranked.flatMap((t, i) => {
    if (filter && t.category !== filter) return [];
    const notes = [hasRelease && t.releaseDate ? `released ${t.releaseDate}` : "", t.lowConfidence ? "low sample" : ""];
    const saves = `${int.format(t.saves)} saves${hasAdds ? ` + ${int.format(t.playlistAdds)} playlist adds` : ""}`;
    return [
      h(
        "tr",
        {},
        h("td", { class: "c-rank" }, String(i + 1)),
        h(
          "td",
          { class: "c-track" },
          h("span", { class: "track-name" }, h("span", { class: "rank-inline" }, `${i + 1}`), t.song),
          h(
            "span",
            { class: "track-sub", title: t.lowConfidence ? "Fewer listeners than the minimum: score penalized" : "" },
            notes.filter(Boolean).join(" · "),
          ),
        ),
        h("td", { class: "c-cat" }, h("span", { class: `badge ${t.category}` }, icon(t.category), t.category)),
        cell("c-score", "Score", scoreRing(t.score)),
        cell("c-listeners num", "Listeners", int.format(t.listeners)),
        cell(
          "c-save num",
          "Save rate",
          h("span", { title: `${saves} / ${int.format(t.listeners)} listeners` }, percent(t.saveRate)),
          liftTag(t.saveLift),
        ),
        cell("c-repeat num", "Streams / listener", t.streamsPerListener.toFixed(2), liftTag(t.repeatLift)),
        h("td", { class: "c-why" }, t.reason),
      ),
    ];
  });

  table.replaceChildren(
    h("thead", {}, h("tr", {}, ...heads.map(([label, cls, title]) => h("th", { class: cls, title: title ?? "" }, label)))),
    h("tbody", {}, ...rows),
  );
}

// A table cell that keeps its column name, shown as a label on phone-sized cards.
function cell(className: string, label: string, ...children: (Node | string)[]) {
  const td = h("td", { class: className }, ...children);
  td.dataset.label = label;
  return td;
}

// Highlights lifts that clear the test/scale bar (1.1) or fall below reach (0.8).
function liftTag(lift: number) {
  const tone = lift >= 1.1 ? " up" : lift < 0.8 ? " down" : "";
  return h("span", { class: `lift${tone}` }, `${lift.toFixed(1)}×`);
}

function scoreRing(score: number) {
  const ring = h("span", { class: "ring" });
  ring.style.setProperty("--p", score.toFixed(1));
  return h("span", { class: "score" }, ring, h("span", { class: "score-value" }, score.toFixed(1)));
}

function percent(rate: number) {
  return `${(100 * rate).toFixed(1)}%`;
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
