/**
 * The desk's charts: donuts, split bars, trends, columns, heatmaps and the stat tiles.
 */

import type { Node, ActionRef } from "../../../../shared/types/sdui.js";
import { span } from "../phoneLook.js";
import { row, text, stack, type Style, n } from "./kit.js";

const APP_NAMES: Record<string, string> = { Desktop: "Computer", Generic: "" };
// Own keys only: an app is whatever the client named, "constructor" included.
export const appName = (a?: string) => (a && Object.hasOwn(APP_NAMES, a) ? APP_NAMES[a]! : a || "");

// ---- the race: said against typed --------------------------------------------------

/** Two lanes, the typed one always the full width, the said one its share. */
export function race(saidMin: number, typedMin: number, big = false): Node {
  const share = typedMin > 0 ? Math.max(2, Math.min(100, (saidMin / typedMin) * 100)) : 0;
  const lane = (lbl: string, pct: number, value: string, fill: string, color?: string): Node =>
    row([
      text(lbl, "d-lane-label", { width: big ? 70 : 52, flex: "none", ...(color ? { color } : {}) }),
      stack([stack([], { width: `${pct}%`, height: "100%" }, fill)], { flex: 1, height: big ? 12 : 6, minWidth: 0 }, "d-lane-t"),
      text(value, "d-lane-label", { width: big ? 80 : 58, flex: "none", textAlign: "right", ...(color ? { color } : {}) }),
    ], { align: "center", gap: 10 });
  return stack([
    lane("Said", share, span(saidMin), "d-lane-said"),
    lane("Typed", 100, span(typedMin), "d-lane-typed", "var(--d-typed)"),
  ], { gap: big ? 14 : 10, maxWidth: big ? 720 : undefined });
}

// ---- CHARTS ------------------------------------------------------------------------
//
// THE DESK'S CHARTS, FROM THE RENDERER'S PLAIN NODES — no installer, no canvas.
//
// A donut is a circle whose `backgroundImage` is a conic gradient: the renderer
// turns any camelCase style key into its CSS property (desktop sdui.js css()),
// so the gradient passes straight through, where `background` alone would land
// on background-color. A line or an area is the renderer's one-path `SVG` node,
// layered in one box; bars and columns are stacks.
//
// COLOUR, COMPUTED RATHER THAN CHOSEN. One categorical order, run through the
// data-viz validator against BOTH desk surfaces (#FFFFFF and the dark sheet
// #151210): every check passes in both, so the same four hexes serve both
// themes and nothing waits on a build. A donut wraps — its last slice touches
// its first — and with a fifth colour the wrap pair failed, so a part-to-whole
// carries at most four colours and folds the rest into Other. Other is a
// neutral mixed from the theme's own ink and sheet, never a slot. Text never
// wears a series colour: the swatch beside it carries the identity, and every
// part's value is written in its legend (the renderer has no hover layer, so
// the legend is the table).

export const SERIES = ["#C97A12", "#00977F", "#4B5BD0", "#D6456E"] as const;
export const OTHER = "color-mix(in srgb, var(--d-ink) 22%, var(--d-sheet))";
/** The one point that matters in a single series — today, this hour. */
export const ACCENT = SERIES[0];
/** The figures' face: data reads in the UI sans, proportional at size. */
const NUMBER: Style = { fontFamily: "var(--f-ui)", fontWeight: 500, letterSpacing: "-.02em", color: "var(--d-ink)" };

export interface Part { label: string; value: number; color?: string; press?: ActionRef; value2?: string }

/** At most four coloured parts, biggest first; the rest become Other. A part
 *  that already names its colour (an app's slot across the desk) keeps it. */
export function foldParts(rows: Part[], max = 4): Part[] {
  const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max).map((r, i) => ({ ...r, color: r.color ?? SERIES[i] }));
  const tail = sorted.slice(max);
  const rest = tail.reduce((s, r) => s + r.value, 0);
  return rest > 0 ? [...head, { label: "Other", value: rest, color: OTHER }] : head;
}

export const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
export const swatch = (color: string, size = 10): Node => stack([], { width: size, height: size, radius: 3, background: color, flex: "none" });

/**
 * A DONUT: part-to-whole at a glance, four colours and Other at most. A 2px gap
 * in the sheet's colour separates neighbouring slices (no borders), and the
 * hole carries the whole's figure, so the chart says its total without a key.
 */
function donut(ps: Part[], o: { size?: number; center?: { value: string; label: string } } = {}): Node {
  const size = o.size ?? 152;
  const total = ps.reduce((s, x) => s + x.value, 0) || 1;
  const gap = ps.length > 1 ? (2 / (Math.PI * size)) * 100 : 0;   // 2px of the circumference
  let acc = 0;
  const stops: string[] = [];
  for (const p of ps) {
    const a = (acc / total) * 100;
    acc += p.value;
    const b = (acc / total) * 100;
    const end = Math.max(a, b - gap);
    stops.push(`${p.color ?? OTHER} ${a.toFixed(2)}% ${end.toFixed(2)}%`);
    if (gap) stops.push(`var(--d-sheet) ${end.toFixed(2)}% ${b.toFixed(2)}%`);
  }
  const hole = Math.round(size * 0.66);
  return stack([
    stack(o.center ? [
      text(o.center.value, "d-k", { ...NUMBER, fontSize: Math.round(size * 0.16), lineHeight: "1" }),
      text(o.center.label, "d-margin", { marginTop: 4, textAlign: "center" }),
    ] : [], { width: hole, height: hole, radius: "50%", background: "var(--d-sheet)", align: "center", justify: "center" }),
  ], {
    width: size, height: size, radius: "50%", flex: "none", align: "center", justify: "center",
    backgroundImage: `conic-gradient(${stops.join(", ")})`,
  });
}

/** The legend as a table: swatch, name, share, and the count itself. A part
 *  that opens a page carries its own tap. */
function legend(ps: Part[], unit = ""): Node {
  const total = ps.reduce((s, x) => s + x.value, 0) || 1;
  return stack(ps.map((p) => {
    const line = row([
      swatch(p.color ?? OTHER),
      text(p.label, "d-k", { fontWeight: 500, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
      text(`${pct(p.value, total)}%`, "d-num", { width: 40, textAlign: "right", color: "var(--d-ink)" }),
      text(p.value2 ?? `${n(p.value)}${unit ? ` ${unit}` : ""}`, "d-num", { minWidth: 48, textAlign: "right", flex: "none", whiteSpace: "nowrap" }),
    ], { align: "center", gap: 8, paddingTop: 8, paddingBottom: 8 }, "d-rule-bottom");
    return p.press ? { ...line, on: { onPress: p.press } } : line;
  }), { flex: 1, minWidth: 168 });
}

/** Donut beside its legend — the desk's part-to-whole block. Sized to sit
 *  beside its key in half the page; it stacks only in a narrow window. */
export function donutWithLegend(ps: Part[], center: { value: string; label: string }, unit = ""): Node {
  return row([donut(ps, { center, size: 128 }), legend(ps, unit)], { gap: 24, align: "center", marginTop: 20, flexWrap: "wrap" });
}

/** One 100% bar split into its parts — for a split of two or three, where a
 *  donut would be a fuss. Each part's share is written under its swatch. */
export function splitBar(ps: Part[]): Node {
  const total = ps.reduce((s, x) => s + x.value, 0) || 1;
  const segs = ps.map((p, i) => stack([], {
    flex: Math.max(0.0001, p.value / total), height: 10, background: p.color ?? OTHER,
    borderTopLeftRadius: i === 0 ? 4 : 0, borderBottomLeftRadius: i === 0 ? 4 : 0,
    borderTopRightRadius: i === ps.length - 1 ? 4 : 0, borderBottomRightRadius: i === ps.length - 1 ? 4 : 0,
  }));
  return stack([
    row(segs, { gap: 2, marginTop: 16 }),
    row(ps.map((p) => row([swatch(p.color ?? OTHER, 9), text(`${p.label} · ${pct(p.value, total)}%`, "d-num", { color: "var(--d-ink)" })], { gap: 7, align: "center" })),
      { gap: 20, marginTop: 12, flexWrap: "wrap" }),
  ]);
}

// SVG geometry. The one-path SVG node draws in its own viewBox; a chart is a
// stack of them in one box, the first in flow (its width sets the box, its
// viewBox's aspect its height), the rest laid exactly over it.
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
function svgLayer(d: string, vb: string, o: { stroke?: string; fill?: string; width?: number; color: string; over?: boolean; opacity?: number }): Node {
  return {
    type: "SVG",
    props: { d, viewBox: vb, stroke: o.stroke ?? "none", fill: o.fill ?? "none", strokeWidth: o.width ?? 2 },
    style: {
      color: o.color, width: "100%",
      ...(o.over ? { position: "absolute", left: 0, top: 0, height: "100%" } : {}),
      ...(o.opacity != null ? { opacity: o.opacity } : {}),
    },
  };
}
const dot = (cx: number, cy: number, r: number) =>
  `M${f1(cx - r)},${f1(cy)}a${f1(r)},${f1(r)} 0 1,0 ${f1(2 * r)},0a${f1(r)},${f1(r)} 0 1,0 ${f1(-2 * r)},0`;

/** A monotone curve through the points (Fritsch–Carlson): it never swings
 *  past a point, so a quiet day never dips below zero on the way to a busy one. */
function smoothPath(pts: Array<[number, number]>): string {
  const N = pts.length;
  if (N === 0) return "";
  if (N === 1) return `M${f1(pts[0]![0])},${f1(pts[0]![1])}`;
  const x = pts.map((p) => p[0]), y = pts.map((p) => p[1]);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < N - 1; i++) { dx[i] = x[i + 1]! - x[i]!; m[i] = (y[i + 1]! - y[i]!) / (dx[i] || 1); }
  const t: number[] = new Array(N).fill(0);
  t[0] = m[0]!; t[N - 1] = m[N - 2]!;
  for (let i = 1; i < N - 1; i++) t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  for (let i = 0; i < N - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i]! / m[i]!, b = t[i + 1]! / m[i]!, s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]!; t[i + 1] = k * b * m[i]!; }
  }
  let d = `M${f1(x[0]!)},${f1(y[0]!)}`;
  for (let i = 0; i < N - 1; i++) {
    const h = dx[i]! / 3;
    d += `C${f1(x[i]! + h)},${f1(y[i]! + t[i]! * h)} ${f1(x[i + 1]! - h)},${f1(y[i + 1]! - t[i + 1]! * h)} ${f1(x[i + 1]!)},${f1(y[i + 1]!)}`;
  }
  return d;
}

/**
 * A TREND: one series as a 2px line over a 10% wash, solid hairline guides,
 * the average as a labelled reference, and the point that matters (today) as
 * an 8px dot in the accent with a ring of the sheet around it. Labelled
 * selectively — the peak, the average, the end — never a number on every day.
 * Ticks under it name the first, middle and last days.
 */
export function trend(values: number[], o: { ticks?: string[]; mark?: number; unit?: string; height?: number; avg?: boolean } = {}): Node {
  const W = 760, H = o.height ?? 170, top = 18, bottom = 8, inset = 8;   // room for the end dot and its ring
  const vals = values.length ? values : [0];
  const max = Math.max(1, ...vals);
  const span = Math.max(1, vals.length - 1);
  const X = (i: number) => (vals.length === 1 ? W / 2 : inset + (i / span) * (W - 2 * inset));
  const Y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const pts = vals.map((v, i) => [X(i), Y(v)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line}L${f1(X(vals.length - 1))},${f1(H - bottom)}L${f1(X(0))},${f1(H - bottom)}Z`;
  const vb = `0 0 ${W} ${H}`;
  const grid = [0, 0.5, 1].map((q) => `M0,${f1(top + q * (H - top - bottom))}H${W}`).join("");
  const active = vals.filter((v) => v > 0);
  const avg = active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0;
  const mark = o.mark ?? vals.length - 1;
  const [mx, my] = pts[Math.max(0, Math.min(pts.length - 1, mark))]!;
  const peak = vals.indexOf(max);
  const layers: Node[] = [
    svgLayer(grid, vb, { stroke: "currentColor", width: 1, color: "var(--d-rule)" }),
    svgLayer(area, vb, { fill: "currentColor", color: "var(--d-ink)", over: true, opacity: 0.08 }),
    ...(o.avg !== false && avg > 0 ? [svgLayer(`M0,${f1(Y(avg))}H${W}`, vb, { stroke: "currentColor", width: 1, color: "var(--d-ink3)", over: true })] : []),
    svgLayer(line, vb, { stroke: "currentColor", width: 2, color: "var(--d-ink)", over: true }),
    svgLayer(dot(mx, my, 6), vb, { fill: "currentColor", color: "var(--d-sheet)", over: true }),
    svgLayer(dot(mx, my, 4), vb, { fill: "currentColor", color: ACCENT, over: true }),
  ];
  // Direct labels, placed by percentage over the box so they ride the drawing.
  const lbl = (s: string, x: number, y: number, right = false): Node => text(s, "d-margin", {
    position: "absolute", top: `${((y / H) * 100).toFixed(1)}%`, transform: "translateY(-120%)",
    ...(right ? { right: `${(100 - (x / W) * 100).toFixed(1)}%` } : { left: `${((x / W) * 100).toFixed(1)}%` }),
    whiteSpace: "nowrap", color: "var(--d-ink2)", background: "var(--d-sheet)", paddingLeft: 3, paddingRight: 3,
  });
  const unit = o.unit ?? "words";
  const labels: Node[] = [];
  if (max > 1) labels.push(lbl(`Peak ${n(max)} ${unit}`, Math.min(X(peak), W * 0.78), Y(max)));
  if (o.avg !== false && avg > 0) labels.push(lbl(`Average ${n(avg)}`, W, Y(avg), true));
  const ticks = o.ticks ?? [];
  return stack([
    stack([...layers, ...labels], { position: "relative", width: "100%" }),
    ...(ticks.length ? [row(ticks.map((t) => text(t, "d-margin")), { justify: "between", marginTop: 8 })] : []),
  ], { width: "100%", maxWidth: W, marginTop: 18 });
}

/**
 * COLUMNS: one per bucket, grown from one baseline, ≤ 24px wide with a 4px
 * rounded end and a square foot. One series in ink; the buckets that matter
 * (now, today) in the accent. Ticks under it name a few buckets, not all.
 */
export function columns(values: number[], o: { height?: number; highlight?: number[]; ticks?: string[]; labels?: string[]; press?: (i: number) => ActionRef | undefined } = {}): Node {
  const H = o.height ?? 96;
  const max = Math.max(1, ...values);
  const hi = new Set(o.highlight ?? []);
  const cols = values.map((v, i) => {
    const h = v > 0 ? Math.max(3, Math.round((v / max) * H)) : 0;
    const press = o.press?.(i);
    const col = stack(h ? [stack([], {
      height: h, width: "100%", maxWidth: 24, background: hi.has(i) ? ACCENT : "var(--d-ink)",
      borderTopLeftRadius: 4, borderTopRightRadius: 4,
    })] : [], { flex: 1, minWidth: 0, height: H, justify: "end", align: "center" });
    return press && v > 0 ? { ...col, on: { onPress: press } } : col;
  });
  return stack([
    row(cols, { gap: 3, align: "end", height: H }),
    stack([], { height: 1, background: "var(--d-rule)" }),
    ...(o.labels?.length
      ? [row(o.labels.map((t) => text(t, "d-margin", { flex: 1, minWidth: 0, textAlign: "center", whiteSpace: "nowrap" })), { gap: 3, marginTop: 8 })]
      : o.ticks?.length ? [row(o.ticks.map((t) => text(t, "d-margin")), { justify: "between", marginTop: 8 })] : []),
  ], { width: "100%", marginTop: 18 });
}

/**
 * A STAT TILE: the figure in the UI sans at size (proportional), a label over
 * it, and a line under it that says what it is against. On the room the ink
 * is the room's cream.
 */
export function statTile(label: string, value: string, sub?: string, onRoom = false, big = false): Node {
  return stack([
    text(label, "d-eyebrow", onRoom ? { color: "rgba(243,226,198,.62)" } : {}),
    text(value, "d-k", { ...NUMBER, fontSize: big ? 44 : 30, lineHeight: big ? "48px" : "34px", marginTop: 8, ...(onRoom ? { color: "#F6EBD9" } : {}) }),
    ...(sub ? [text(sub, "d-margin", { marginTop: 6, ...(onRoom ? { color: "rgba(243,226,198,.55)" } : {}) })] : []),
  ], { minWidth: 120, flex: 1 });
}

/** A 30-day run laid out as a calendar — weekdays down, weeks across — each
 *  day's ink deepening with its words (one hue, light to dark). An empty day
 *  is an outline; today wears a dashed ring; a day with words opens its page. */
export function heatmap(values: number[], endDate: Date, o: { press?: (i: number) => ActionRef | undefined } = {}): Node {
  const N = values.length;
  const max = Math.max(1, ...values);
  const start = new Date(endDate.getTime() - (N - 1) * 86_400_000);
  const lead = (start.getUTCDay() + 6) % 7;                     // Monday first
  const weeks = Math.ceil((lead + N) / 7);
  const STEPS = [0.16, 0.34, 0.56, 0.8, 1];
  const cells: Node[][] = Array.from({ length: 7 }, () => []);
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const i = w * 7 + d - lead;
      if (i < 0 || i >= N) { cells[d]!.push(stack([], { width: 18, height: 18, flex: "none" })); continue; }
      const v = values[i] ?? 0;
      const lvl = v > 0 ? STEPS[Math.min(4, Math.floor((v / max) * 5))]! : 0;
      const today = i === N - 1;
      const cell = stack([], {
        width: 18, height: 18, flex: "none", radius: 4,
        ...(v > 0 ? { background: `color-mix(in srgb, var(--d-ink) ${Math.round(lvl * 100)}%, var(--d-sheet))` } : { border: "1.5px solid var(--d-rule)" }),
        ...(today ? { outline: "1.5px dashed var(--d-ink)", outlineOffset: 2 } : {}),
      });
      const press = o.press?.(i);
      cells[d]!.push(press && v > 0 ? { ...cell, on: { onPress: press } } : cell);
    }
  }
  const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
  return stack([
    ...cells.map((c, d) => row([text(DAY_LETTERS[d]!, "d-margin", { width: 14, flex: "none" }), ...c], { gap: 5, align: "center" })),
    row([
      text("Less", "d-margin"),
      ...STEPS.map((s) => stack([], { width: 12, height: 12, radius: 3, background: `color-mix(in srgb, var(--d-ink) ${Math.round(s * 100)}%, var(--d-sheet))` })),
      text("More", "d-margin"),
    ], { gap: 5, align: "center", marginTop: 10, marginLeft: 19 }),
  ], { gap: 5, marginTop: 16 });
}

/**
 * An app's share as donut parts: the four biggest in the validated order, the
 * rest (and the client's own "Other") as Other.
 *
 * WHY BY POSITION, NOT BY APP. A donut's neighbours are what the eye compares,
 * and the order was validated as a ring: teal and rose are only safe apart
 * (under deuteranopia they measure 4.2, far under the floor), and in this ring
 * they always sit across from each other. Pinning each app to a colour across
 * pages would put them side by side whenever the day's ranking differs from
 * the month's. The legend names every app, so nothing rides on the colour.
 */
export function appParts(rows: Array<{ app: string; words: number }>, press?: (app: string) => ActionRef | undefined): Part[] {
  const known = rows.filter((x) => x.words > 0 && x.app && x.app !== "Other");
  const other = rows.filter((x) => x.words > 0 && (!x.app || x.app === "Other")).reduce((s, x) => s + x.words, 0);
  const ps = foldParts(known.map((r) => ({ label: appName(r.app) || r.app, value: r.words, press: press?.(r.app) })));
  if (!other) return ps;
  const last = ps[ps.length - 1];
  return last && last.label === "Other" && last.color === OTHER
    ? [...ps.slice(0, -1), { ...last, value: last.value + other }]
    : [...ps, { label: "Other", value: other, color: OTHER }];
}

/** A ranked set of horizontal bars — the same lane the apps use on Insights,
 *  reused for a day's apps, a split by how it was written, its languages, an
 *  app's time of day. A row carries its own tap when one is handed in. */
export function barList(rows: Array<{ label: string; words: number; press?: ActionRef; value?: string }>): Node {
  const total = rows.reduce((s, r) => s + r.words, 0) || 1;
  return stack(rows.map((r) => {
    const pct = Math.round((r.words / total) * 100);
    // The right-hand number is the share by default — but a count ("12×") is
    // what reads where the bar is a ranking (the dictionary's most-used words),
    // so a row may name its own.
    const line = row([
      text(r.label, "d-lane-label", { width: 100, flex: "none" }),
      stack([stack([], { width: `${Math.max(2, pct)}%` }, "d-bar1-fill")], { flex: 1, minWidth: 0 }, "d-bar1"),
      text(r.value ?? `${pct}%`, "d-num", { minWidth: 48, textAlign: "right", whiteSpace: "nowrap", flex: "none" }),
    ], { align: "center", gap: 12, paddingTop: 9, paddingBottom: 9 });
    return r.press ? { ...line, on: { onPress: r.press } } : line;
  }), { marginTop: 10 });
}
