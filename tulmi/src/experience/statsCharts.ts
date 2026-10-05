/**
 * THE STATS TAB'S CHARTS, drawn from what every phone already has.
 *
 * No new component: a curve is two SVG paths (the soft fill, then the line on
 * top), a column chart is a row of Stacks, a pie is the PieChart ring with its
 * hole closed. So a chart added here reaches every installed app on the next
 * fetch, without a store release.
 *
 * One palette, the Stats one: pale ink at falling strength for shares, the
 * typed pink only where typing is compared with speaking, and amber only for
 * what is still in play — today, the hour you are in.
 */
import type { Node } from "../../../shared/types/sdui.js";
import { label, t } from "./phoneLook.js";

/** Shares, biggest first: full pale, then evenly lighter steps. */
export const SHARE_INKS = [
  "#F3E2C6", "rgba(243,226,198,0.7)", "rgba(243,226,198,0.5)",
  "rgba(243,226,198,0.32)", "rgba(243,226,198,0.18)",
];

// PHONE_LOOK's colours, written out: phoneLook.ts imports this file, so its
// constants are not yet defined while this one loads.
const INK = "#F3E2C6";
const FAINT = "rgba(243,226,198,0.13)";
const AMBER = "#E8A23C";
const TYPED = "#E4587B";

export interface Slice { label: string; value: number; color: string }

/** Top N as slices, the tail folded into "Other". */
export function shareSlices(rows: Array<{ label: string; value: number }>, max = SHARE_INKS.length): Slice[] {
  const ranked = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const head = ranked.slice(0, max - 1);
  const tail = ranked.slice(max - 1).reduce((s, r) => s + r.value, 0);
  const out = head.map((r, i) => ({ label: r.label, value: r.value, color: SHARE_INKS[i]! }));
  if (tail > 0) out.push({ label: "Other", value: tail, color: SHARE_INKS[SHARE_INKS.length - 1]! });
  return out;
}

/** Said, typed and drafted, in the colours they wear everywhere else. */
export function kindSlices(k: { voice: number; typing: number; draft: number } | undefined): Slice[] {
  if (!k) return [];
  return [
    { label: "Said", value: k.voice, color: INK },
    { label: "Typed", value: k.typing, color: TYPED },
    { label: "Replies drafted", value: k.draft, color: "rgba(243,226,198,0.4)" },
  ].filter((s) => s.value > 0);
}

/**
 * A pie, a real one: the ring with its hole closed. Legend under it, in the
 * card's ink, each slice with its share.
 */
export function pie(slices: Slice[], size = 132, empty = "Nothing yet"): Node {
  return {
    type: "PieChart",
    props: {
      slices, size, thickness: Math.round(size / 2), gap: 1.5,
      legend: true, legendColor: INK, emptyLabel: empty,
    },
    style: { alignSelf: "center", width: "100%", marginTop: 4 },
  };
}

/** A ring with one number in the hole and no legend — the main view's kind. */
export function ring(slices: Slice[], size: number, centerValue: string, centerLabel: string): Node {
  return {
    type: "PieChart",
    props: {
      slices, size, thickness: Math.round(size * 0.13), gap: 2,
      legend: false, centerValue, centerLabel, emptyLabel: "Nothing yet",
    },
    style: { width: size },
  };
}

const f = (v: number) => String(Math.round(v * 2) / 2);

/** The box every curve is drawn in: 300 wide, as tall as its aspect says. */
const CURVE_W = 300;

/**
 * A smooth curve's two paths over `values`: the line, and the area under it.
 * Catmull–Rom through the points, with the handles held inside the box so the
 * curve never dips under its own baseline between two quiet days.
 */
export function curvePaths(values: number[], aspect = 3.2): { line: string; area: string; dot: string } {
  const W = CURVE_W;
  const H = Math.round(W / aspect);
  const top = 8, base = H - 2;
  const vals = values.length === 1 ? [values[0]!, values[0]!] : values.length ? values : [0, 0];
  const max = Math.max(1, ...vals);
  const pts = vals.map((v, i) => [
    (i / (vals.length - 1)) * W,
    base - (Math.max(0, v) / max) * (base - top),
  ] as const);
  const clampY = (y: number) => Math.min(base, Math.max(top - 4, y));
  let line = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
    line += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  const last = pts[pts.length - 1]!;
  const r = 4.5;
  return {
    line,
    area: `${line}L${W} ${H}L0 ${H}Z`,
    dot: `M${f(last[0] - r)} ${f(last[1])}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`,
  };
}

const FILL_BOX = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 };

/** The curve's drawing: fill, then line, then (maybe) today's dot. */
function curveNode(aspect: number, paths: { line?: string; area?: string; dot?: string }, bindTo?: string, stroke = INK, fill = FAINT): Node {
  const H = Math.round(CURVE_W / aspect);
  const svg = (key: "area" | "line" | "dot", props: Record<string, unknown>): Node => ({
    type: "SVG",
    props: { viewBox: `0 0 ${CURVE_W} ${H}`, d: paths[key] ?? "", ...props },
    ...(bindTo ? { bind: { d: `${bindTo}.${key}` } } : {}),
    style: FILL_BOX,
  });
  return {
    type: "Stack",
    style: { width: "100%", aspectRatio: aspect },
    children: [
      svg("area", { fill, stroke: "none", strokeWidth: 0 }),
      svg("line", { fill: "none", stroke, strokeWidth: 2 }),
      ...(paths.dot ? [svg("dot", { fill: AMBER, stroke: "none", strokeWidth: 0 })] : []),
    ],
  };
}

/** A smooth curve over `values`, filled softly beneath; labels under it. */
export function curve(
  values: number[],
  opts: { aspect?: number; stroke?: string; fill?: string; markLast?: boolean; labels?: string[] } = {},
): Node {
  const aspect = opts.aspect ?? 3.2;
  const p = curvePaths(values, aspect);
  const chart = curveNode(aspect, { line: p.line, area: p.area, ...(opts.markLast ? { dot: p.dot } : {}) }, undefined, opts.stroke, opts.fill);
  if (!opts.labels?.length) return chart;
  return { type: "Stack", children: [chart, axis(opts.labels)] };
}

/**
 * The same curve, its paths read from state (`${path}.line`, `.area`) — so
 * one card can draw whichever day was tapped.
 */
export function boundCurve(path: string, aspect: number, labels: string[]): Node {
  return { type: "Stack", children: [curveNode(aspect, {}, path), axis(labels)] };
}

/** The hours a day curve is labelled with. */
export const HOUR_LABELS = ["12 am", "6 am", "12 pm", "6 pm", "12 am"];
export const DAY_ASPECT = 3.4;

/** Labels spread under a chart, first at the left edge and last at the right. */
export function axis(labels: string[]): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
    children: labels.map((l) => label(l, { fontSize: 8.5, letterSpacing: 1, color: "rgba(243,226,198,0.42)" })),
  };
}

/**
 * Columns: one per value, the tallest at full strength, `mark` in amber.
 * `labels` sits under each column; leave one blank to skip it.
 */
export function columns(
  values: number[],
  labels: string[] = [],
  opts: { height?: number; mark?: number; gap?: number; showValues?: boolean } = {},
): Node {
  const height = opts.height ?? 84;
  const max = Math.max(1, ...values);
  return {
    type: "Stack",
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "flex-end", gap: opts.gap ?? 4, height: height + (opts.showValues ? 16 : 0) },
        children: values.map((v, i) => ({
          type: "Stack",
          style: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
          children: [
            ...(opts.showValues && v > 0 ? [label(compact(v), { fontSize: 8, letterSpacing: 0.4, color: "rgba(243,226,198,0.6)", marginBottom: 4 })] : []),
            {
              type: "Stack",
              style: {
                width: "100%",
                height: v > 0 ? Math.max(3, Math.round((v / max) * height)) : 2,
                borderTopLeftRadius: 3, borderTopRightRadius: 3,
                backgroundColor: i === opts.mark ? AMBER : v === max ? INK : v > 0 ? "rgba(243,226,198,0.45)" : FAINT,
              },
            },
          ],
        } as Node)),
      },
      ...(labels.length ? [{
        type: "Stack",
        style: { flexDirection: "row", gap: opts.gap ?? 4, marginTop: 6 },
        children: labels.map((l) => ({
          type: "Stack", style: { flex: 1, alignItems: "center" },
          children: l ? [label(l, { fontSize: 8, letterSpacing: 0.6, color: "rgba(243,226,198,0.45)" })] : [],
        } as Node)),
      } as Node] : []),
    ],
  };
}

/** Rows of name, bar and value — for things with long names (apps, words). */
/** The typed pink, for a row that is typing set against speech. */
export const TYPED_INK = TYPED;

export function meters(rows: Array<{ name: string; value: number; text: string; color?: string }>, width = 92): Node {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return {
    type: "Stack",
    style: { gap: 12, marginTop: 4 },
    children: rows.map((r) => ({
      type: "Stack",
      style: { flexDirection: "row", alignItems: "center", gap: 12 },
      children: [
        t(r.name, "ui", 12, { width, color: INK }),
        {
          type: "Stack",
          style: { flex: 1, height: 6, borderRadius: 3, backgroundColor: FAINT, overflow: "hidden" },
          children: [{ type: "Stack", style: { width: `${((r.value / max) * 100).toFixed(1)}%`, height: 6, borderRadius: 3, backgroundColor: r.color ?? INK } }],
        },
        label(r.text, { width: 64, textAlign: "right", color: "rgba(243,226,198,0.7)", letterSpacing: 0.6 }),
      ],
    } as Node)),
  };
}

/** Two to four figures side by side: the number, and what it counts. */
export function tiles(items: Array<{ value: string; name: string; live?: boolean }>): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", gap: 8, marginTop: 14 },
    children: items.map((it) => ({
      type: "Stack",
      style: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "rgba(243,226,198,0.06)" },
      children: [
        t(it.value, "writtenLight", 19, { color: it.live ? AMBER : INK, letterSpacing: -0.3 }),
        label(it.name, { fontSize: 8.5, marginTop: 4 }),
      ],
    } as Node)),
  };
}

/** One small line of the card: what, then how much, in small type. */
export function line(name: string, value: string, small = false): Node {
  return {
    type: "Stack",
    style: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12,
      paddingVertical: small ? 7 : 9, borderBottomWidth: 1, borderBottomColor: "rgba(243,226,198,0.08)",
    },
    children: [
      t(name, "ui", small ? 11.5 : 12.5, { color: "rgba(243,226,198,0.7)" }),
      t(value, "uiMedium", small ? 11.5 : 12.5, { color: INK, flexShrink: 1, textAlign: "right" }),
    ],
  };
}

/** A line whose value (and maybe name) is read from state. */
export function boundLine(name: string | { path: string }, valuePath: string, small = false): Node {
  const nameNode = t(typeof name === "string" ? name : "", "ui", small ? 11.5 : 12.5, { color: "rgba(243,226,198,0.7)" });
  return {
    type: "Stack",
    style: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12,
      paddingVertical: small ? 7 : 9, borderBottomWidth: 1, borderBottomColor: "rgba(243,226,198,0.08)",
    },
    children: [
      typeof name === "string" ? nameNode : { ...nameNode, bind: { content: name.path } },
      { ...t("", "uiMedium", small ? 11.5 : 12.5, { color: INK, flexShrink: 1, textAlign: "right" }), bind: { content: valuePath } },
    ],
  };
}

/** Tiles whose numbers are read from state. */
export function boundTiles(items: Array<{ path: string; name: string }>): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", gap: 8, marginTop: 14 },
    children: items.map((it) => ({
      type: "Stack",
      style: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "rgba(243,226,198,0.06)" },
      children: [
        { ...t("", "writtenLight", 19, { letterSpacing: -0.3 }), bind: { content: it.path } },
        label(it.name, { fontSize: 8.5, marginTop: 4 }),
      ],
    } as Node)),
  };
}

/** A sub-heading inside a card. */
export function part(name: string): Node {
  return t(name, "uiBold", 10.5, {
    marginTop: 26, marginBottom: 10, letterSpacing: 1.3, textTransform: "uppercase", color: "rgba(243,226,198,0.6)",
  });
}

/** 24 hours as a curve, labelled at midnight, six, noon and six. */
export function dayCurve(hours: number[]): Node {
  const h = hours.length === 24 ? hours : new Array(24).fill(0);
  return curve(h, { aspect: DAY_ASPECT, labels: HOUR_LABELS });
}

/** 1,234 as "1.2k" where a column is too narrow for the whole number. */
export function compact(v: number): string {
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(v));
}

/** Seconds as a person says them: "40 sec", "12 min", "1 h 05". */
export function said(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/**
 * A MONTH AS A VOICE: one rounded bar a day, as tall as what was said that
 * day, mirrored about a centre line the way a recording is drawn. Quiet days
 * are a dot on the line; today is amber, because today is not over — except
 * where nothing may be amber (the You tab), which passes markToday: false.
 */
export function waveform(values: number[], opts: { height?: number; markToday?: boolean } = {}): Node {
  const height = opts.height ?? 72;
  const mark = opts.markToday !== false;
  const max = Math.max(1, ...values);
  return {
    type: "Stack",
    style: { flexDirection: "row", alignItems: "center", gap: 3, height },
    children: values.map((v, i) => {
      const share = v > 0 ? Math.max(0.12, v / max) : 0;
      const today = mark && i === values.length - 1;
      return {
        type: "Stack",
        style: {
          flex: 1,
          height: v > 0 ? Math.round(share * height) : 4,
          borderRadius: 3,
          backgroundColor: today ? AMBER : v > 0 ? INK : "rgba(243,226,198,0.22)",
          opacity: today || v <= 0 ? 1 : 0.4 + 0.6 * share,
        },
      } as Node;
    }),
  };
}
