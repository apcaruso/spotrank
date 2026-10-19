// Botanical line art in currentColor. Each category is a growth stage:
// scale = in bloom, test = bud, reach = leaf, niche = seedling, ignore = seed.
import type { Category } from "./rank.ts";

const TINT = `fill="currentColor" fill-opacity=".16"`;

function svg(viewBox: string, body: string, strokeWidth = 1.5): string {
  return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Five petals around (cx, cy); r is how far the petals reach.
function flower(cx: number, cy: number, r: number): string {
  const petals = [0, 72, 144, 216, 288]
    .map((a) => `<ellipse cx="${cx}" cy="${cy - r * 0.58}" rx="${r * 0.36}" ry="${r * 0.52}" transform="rotate(${a} ${cx} ${cy})"/>`)
    .join("");
  return `<g fill="currentColor" fill-opacity=".3">${petals}</g><circle cx="${cx}" cy="${cy}" r="${r * 0.28}" fill="currentColor"/>`;
}

// A leaf from its base (x, y), pointing at angle degrees (0 = right, -90 = up).
function leaf(x: number, y: number, angle: number, len: number): string {
  const w = len * 0.36;
  return `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 0C${len * 0.3} ${-w} ${len * 0.7} ${-w} ${len} 0C${len * 0.7} ${w} ${len * 0.3} ${w} 0 0Z" ${TINT}/><path d="M0 0L${len * 0.75} 0"/></g>`;
}

export const ART = {
  scale: svg("0 0 24 24", `<path d="M12 13.5V22"/><path d="M12 19.8c2 0 3.4-1.2 3.9-3-2 0-3.4 1.1-3.9 3z" ${TINT}/>${flower(12, 9, 7.2)}`),
  test: svg(
    "0 0 24 24",
    `<path d="M12 14.2V21"/><path d="M12 18.4c-2.3 0-3.8-1.3-4.4-3.3 2.3 0 3.8 1.2 4.4 3.3z" ${TINT}/><path d="M12 3c2.8 2.2 4.2 4.8 4.2 7a4.2 4.2 0 0 1-8.4 0c0-2.2 1.4-4.8 4.2-7z" ${TINT}/><path d="M9.2 12.4c.8-1.4 1.7-2.6 2.8-3.7 1.1 1.1 2 2.3 2.8 3.7"/>`,
  ),
  reach: svg(
    "0 0 24 24",
    `<path d="M5.5 18.5C5 10.5 9.5 5.2 19 5c.3 9.3-5 13.9-13.5 13.5z" ${TINT}/><path d="M4 20l9.5-9.5"/><path d="M8.6 15.4h3.6M11.4 12.6V9"/>`,
  ),
  niche: svg(
    "0 0 24 24",
    `<path d="M12 20.5V12"/><path d="M12 13.5C12 10.4 10 8.5 6 8.5c0 3.1 2 5 6 5z" ${TINT}/><path d="M12 11.5c0-3.6 2.2-6 6.5-6 0 3.6-2.3 6-6.5 6z" ${TINT}/><path d="M7.5 20.5h9"/>`,
  ),
  ignore: svg(
    "0 0 24 24",
    `<path d="M12 4.5c3.4 2.3 5 5.2 5 8.2a5 5 0 0 1-10 0c0-3 1.6-5.9 5-8.2z" ${TINT}/><path d="M12 8c-.9 2.2-.9 5 0 8.5"/>`,
  ),
  vine: svg(
    "0 0 240 100",
    `<path d="M4 92C44 92 62 70 100 68S158 74 186 52 210 32 212 30"/>` +
      leaf(38, 90, -120, 18) +
      leaf(70, 77, -40, 20) +
      leaf(118, 68, -110, 18) +
      leaf(150, 68, 35, 16) +
      leaf(182, 55, -150, 16) +
      leaf(200, 40, -25, 14) +
      `<g style="color: var(--scale)">${flower(214, 20, 12)}</g>`,
    1.4,
  ),
} satisfies Record<Category | "vine", string>;

export function icon(name: keyof typeof ART, className = "icon"): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.innerHTML = ART[name];
  return el;
}
