/**
 * THE BOTS APP'S GLYPHS: line icons, the status marks, the Tailzu dot mark and the living tab icons.
 *
 * Every glyph is an `SVG` node. A line icon is one stroked path (any build draws it); a status mark and a tab
 * icon are `shapes` (the Bots kit's extension, shared/types/sdui.ts SvgShape), because they mix fills and strokes
 * and move: a working bot's dot breathes, the tab icons pop and draw when their tab opens. Reduce Motion stops
 * all of it on both clients; the states still read, because shape and colour carry them (STYLE.md).
 */
import type { Node, SvgShape } from "../../../../shared/types/sdui.js";

/** The greys and the ink (STYLE.md: colour belongs only to bots). */
export const INK = "#0a0a0a";
export const IDLE = "#8a8a8a";

// ------------------------------------------------------------------ shapes → paths

/** A circle as a path, so a stroked icon stays one path. */
const circ = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** A rounded rectangle as a path. */
const rect = (x: number, y: number, w: number, h: number, r: number): string =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

/** The design's line icons (24 viewBox, stroked, round caps). One path each. */
export const ICONS = {
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16",
  keyboard: rect(2.5, 6, 19, 12, 2.5) + "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8",
  calendar: rect(3.5, 4.5, 17, 16, 2.5) + "M3.5 9.5h17M8 2.5v4M16 2.5v4M7.5 13.5h3M7.5 16.5h6",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" + circ(12, 10, 2.4),
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  mic: rect(9, 3, 6, 11, 3) + "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
  send: "M12 19V5M6 11l6-6 6 6",
  person: circ(12, 8, 4) + "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 5l7 7-7 7",
  down: "M6 9l6 6 6-6",
  more: "M5.5 12h.01M12 12h.01M18.5 12h.01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18",
  stop: rect(7, 7, 10, 10, 2),
  search: circ(11, 11, 6.5) + "M20 20l-4.2-4.2",
  today: rect(3.5, 5, 17, 15.5, 2.5) + "M3.5 9.5h17M8 3v4M16 3v4",
  notes: rect(5, 3.5, 14, 17, 2.5) + "M8.5 8.5h7M8.5 12h7M8.5 15.5h4",
  computer: rect(4, 5, 16, 11, 1.8) + "M2.5 19h19",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8" + circ(16, 7, 2) + circ(10, 17, 2),
  phone: rect(7, 2.5, 10, 19, 2.5) + "M11 18.5h2",
  lock: rect(5, 10.5, 14, 10, 2) + "M8 10.5V8a4 4 0 0 1 8 0v2.5",
  share: "M12 15V4M8 8l4-4 4 4M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  clip: "M20 11.5l-7.6 7.6a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4",
  folder: "M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
  shield: "M12 3l7 3v5.5c0 4.4-3 7.9-7 9.5-4-1.6-7-5.1-7-9.5V6zM9 12l2 2 4-4",
  pr: circ(6, 6, 2.2) + circ(6, 18, 2.2) + circ(18, 18, 2.2) + "M6 8.2v7.6M18 15.8V10a3 3 0 0 0-3-3h-4M13 4.5L10.5 7 13 9.5",
  // A person's own bots, by what they are for.
  dumbbell: "M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11",
  book: "M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13",
  rupee: "M7 4.5h10M7 9h10M9.5 4.5c3.2 0 5 1.7 5 4.5s-1.8 4.5-5 4.5H8l7 6.5",
  pot: "M4.5 11h15v2.5a6 6 0 0 1-6 6h-3a6 6 0 0 1-6-6zM2.5 11h19M9.5 7.5c0-1.2 1-1.6 1-2.8M14 7.5c0-1.2 1-1.6 1-2.8",
  bag: "M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8",
  spark: "M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z",
} as const;
export type IconName = keyof typeof ICONS;

export interface IconOpts {
  size?: number;
  color?: string;
  /** Stroke width in the 24 grid. STYLE.md: 1.9 (1.8 on bot tiles). */
  weight?: number;
  /** Read aloud; absent, the icon is decoration. */
  label?: string;
}

/** A line icon. Plain `SVG` with one path: every build draws it. */
export function icon(name: IconName, o: IconOpts = {}): Node {
  const size = o.size ?? 24;
  return {
    type: "SVG",
    props: {
      viewBox: "0 0 24 24", d: ICONS[name], fill: "none", stroke: o.color ?? INK, strokeWidth: o.weight ?? 1.9,
      strokeLinecap: "round", strokeLinejoin: "round", ...(o.label ? { accessibilityLabel: o.label } : {}),
    },
    style: { width: size, height: size, flexShrink: 0 },
  };
}

/** Several shapes in one glyph (the kit's SVG extension). */
export function shapes(list: SvgShape[], o: { size?: number; viewBox?: string; label?: string; width?: number; height?: number } = {}): Node {
  const size = o.size ?? 24;
  return {
    type: "SVG",
    props: { viewBox: o.viewBox ?? "0 0 24 24", shapes: list, ...(o.label ? { accessibilityLabel: o.label } : {}) },
    style: { width: o.width ?? size, height: o.height ?? size, flexShrink: 0 },
  };
}

// ------------------------------------------------------------------ the Tailzu mark

const MARK_DOTS: Array<[number, number, number]> = [
  [17, 4, 2], [26, 7, 2], [30, 16, 2], [27, 25, 2], [17, 30, 2], [7, 25, 2], [4, 16, 2], [8, 7, 2], [13, 15, 2.6], [21, 15, 2.6],
];

/** The Tailzu dot mark: eight dots in a ring, two eyes. */
/**
 * THE KEYBOARD'S MIC KEY, AS IT IS: a dark round window with the bot peeking in from below, his paws on its rim
 * (catalog.ts "kb.mic.bot": "peek", drawn by the keyboard's PeekBotView.swift / TulmiPeekBot.kt). This is that
 * drawing's peek pose, still, in the same units (the key's radius is 1, centre 0 0, y down) and the same colours
 * (keyboardKnobsData.ts kb.mic.bot.*). The keyboard clips to the window; an SVG shape cannot clip, so each shape is
 * cut to the window here, and the shell's gradient and the rim's soft shadow are laid in bands.
 */
const PEEK = {
  window: "#2E2B28", shell: "#FBF0DE", shellShade: "#E9D0A8", visor: "#1D1C1B", glow: "#FFF1D6", clay: "#C9683F",
} as const;
type Pt = [number, number];
const disc = (cx: number, cy: number, r: number, n = 40): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)] as Pt);
function roundRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const k = Math.min(r, w / 2, h / 2), out: Pt[] = [];
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 8; i++) { const a = from + (i / 8) * (Math.PI / 2); out.push([cx + k * Math.cos(a), cy + k * Math.sin(a)]); }
  };
  corner(x + w - k, y + k, -Math.PI / 2); corner(x + w - k, y + h - k, 0); corner(x + k, y + h - k, Math.PI / 2); corner(x + k, y + k, Math.PI);
  return out;
}
const band = (y0: number, y1: number): Pt[] => [[-2, y0], [2, y0], [2, y1], [-2, y1]];
/** `poly` cut to the convex `edge` (Sutherland–Hodgman; both wound the same way). */
function cut(poly: Pt[], edge: Pt[]): Pt[] {
  let out = poly;
  for (let i = 0; i < edge.length && out.length; i++) {
    const [a, b] = [edge[i]!, edge[(i + 1) % edge.length]!];
    const inside = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const meet = (p: Pt, q: Pt): Pt => {
      const d = (b[0] - a[0]) * (q[1] - p[1]) - (b[1] - a[1]) * (q[0] - p[0]);
      const t = ((b[0] - a[0]) * (a[1] - p[1]) - (b[1] - a[1]) * (a[0] - p[0])) / d;
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    };
    const src = out; out = [];
    for (let j = 0; j < src.length; j++) {
      const p = src[j]!, q = src[(j + 1) % src.length]!;
      if (inside(q)) { if (!inside(p)) out.push(meet(p, q)); out.push(q); } else if (inside(p)) out.push(meet(p, q));
    }
  }
  return out;
}
const WINDOW = disc(0, 0, 1, 96);
const pathOf = (poly: Pt[]) => poly.length < 3 ? "" : `M${poly.map(([x, y]) => `${+x.toFixed(3)} ${+y.toFixed(3)}`).join("L")}Z`;
/** A filled shape, cut to the window. */
const inWindow = (poly: Pt[], fill: string, opacity?: number): SvgShape[] => {
  const d = pathOf(cut(poly, WINDOW));
  return d ? [{ d, fill, ...(opacity === undefined ? {} : { opacity }) }] : [];
};
const mix = (a: string, b: string, t: number) => "#" + [1, 3, 5].map((i) => {
  const v = Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t);
  return v.toString(16).padStart(2, "0");
}).join("");

function peekKeyShapes(): SvgShape[] {
  const Y = 0.86;                                    // the peek: his head comes up this far into the window
  const headW = 1.12, headH = 0.86, top = -headH / 2 + Y, fy = -0.05 - 0.02 + Y;
  const shell = roundRect(-headW / 2, top, headW, headH, 0.32);
  // The shell, lighter on top: its gradient in bands down the part of it the window shows.
  const shellBands: SvgShape[] = [];
  const BANDS = 6;
  for (let i = 0; i < BANDS; i++) {
    const y0 = top + (i / BANDS) * (1 - top), y1 = top + ((i + 1) / BANDS) * (1 - top) + 0.004;
    shellBands.push(...inWindow(cut(shell, band(y0, y1)), mix(PEEK.shell, PEEK.shellShade, ((y0 + y1) / 2 - top) / headH)));
  }
  const eye = (x: number) => [
    ...inWindow(roundRect(x - 0.102, fy - 0.1615, 0.204, 0.323, 0.102), PEEK.glow, 0.18),
    ...inWindow(roundRect(x - 0.06, fy - 0.095, 0.12, 0.19, 0.06), PEEK.glow),
  ];
  // The rim: a soft shadow inside it (none at 0.72 of the way out, 42% black at the edge), in rings.
  const rim: SvgShape[] = Array.from({ length: 7 }, (_, i) => {
    const r = 0.74 + i * 0.04;
    return { circle: [0, 0, r] as [number, number, number], stroke: "#000000", strokeWidth: 0.042, opacity: +(0.42 * (r - 0.72) / 0.28).toFixed(3) };
  });
  const glint = (a: number) => [0.86 * Math.cos(a * Math.PI), 0.86 * Math.sin(a * Math.PI)].map((v) => +v.toFixed(3));
  const [g0, g1] = [glint(1.08), glint(1.38)];
  return [
    { circle: [0, 0, 1], fill: PEEK.window },
    ...inWindow(disc(-headW / 2, -0.02 + Y, 0.1), PEEK.clay), ...inWindow(disc(headW / 2, -0.02 + Y, 0.1), PEEK.clay),   // ears
    { d: `M0 ${+(top + 0.02).toFixed(3)}L0 ${+(top - 0.22).toFixed(3)}`, stroke: PEEK.shellShade, strokeWidth: 0.05, linecap: "round" },   // antenna
    { circle: [0, +(top - 0.22).toFixed(3), 0.075], fill: PEEK.clay },
    ...shellBands,
    ...inWindow(roundRect(-0.4, -0.38 + Y, 0.26, 0.07, 0.035), "#FFFFFF", 0.55),                                       // highlight
    ...inWindow(roundRect(-0.42, -0.05 - 0.23 + Y, 0.84, 0.46, 0.2), PEEK.visor),
    ...eye(-0.19), ...eye(0.19),
    ...inWindow(disc(-0.5, 0.83, 0.1), PEEK.shell), ...inWindow(disc(0.5, 0.83, 0.1), PEEK.shell),                   // paws on the rim
    ...rim,
    { d: `M${g0[0]} ${g0[1]}A0.86 0.86 0 0 1 ${g1[0]} ${g1[1]}`, stroke: "#FFFFFF", strokeWidth: 0.05, opacity: 0.16, linecap: "round" },
  ];
}
const PEEK_KEY = peekKeyShapes();

/** The keyboard's mic key, `size` across: the bot peeking into his window. */
export function peekKey(size: number): Node {
  return shapes(PEEK_KEY, { size, viewBox: "-1 -1 2 2" });
}

export function tailzuMark(size = 34): Node {
  return {
    type: "SVG",
    props: { viewBox: "0 0 34 34", d: MARK_DOTS.map(([x, y, r]) => circ(x, y, r)).join(""), fill: INK, stroke: "none", accessibilityLabel: "X0 Bot" },
    style: { width: size, height: size, flexShrink: 0 },
  };
}

// ------------------------------------------------------------------ status marks

/** STYLE.md: working = the bot's colour (breathing) · needs you = filled ink · done = hollow ring · waiting = dashed ring · failed = small X. */
export type Mark = "working" | "needs" | "done" | "waiting" | "failed";

const MARK_WORDS: Record<Mark, string> = { working: "working", needs: "needs you", done: "done", waiting: "waiting", failed: "failed" };

/** One status mark. `size` 8 in lists and rows, 10 on a decision card's label. */
export function statusMark(mark: Mark, o: { color?: string; size?: number; still?: boolean } = {}): Node {
  const list: SvgShape[] =
    mark === "working" ? [{ circle: [4, 4, 4], fill: o.color ?? INK, ...(o.still ? {} : { motion: "breathe" as const }) }]
    : mark === "needs" ? [{ circle: [4, 4, 4], fill: INK }]
    : mark === "done" ? [{ circle: [4, 4, 3.25], stroke: INK, strokeWidth: 1.5 }]
    : mark === "waiting" ? [{ circle: [4, 4, 3.25], stroke: INK, strokeWidth: 1.5, dash: "1.7 1.7" }]
    : [{ d: "M1 1l6 6M7 1L1 7", stroke: INK, strokeWidth: 1.6, linecap: "round" }];
  return shapes(list, { size: o.size ?? 8, viewBox: "0 0 8 8", label: MARK_WORDS[mark] });
}

// ------------------------------------------------------------------ the living tab icons

/** What the tab icons show: the person's four bots (colour, and whether each is working), what needs them, and how much of this stretch is used. */
export interface TabLive {
  /** Up to four bots, in their own colours. */
  dots: Array<{ color: string; working: boolean }>;
  needs: number;
  /** The colour of a working bot, when one is. */
  workingColor?: string;
  /** How much of this stretch is used (the usage meter), 0..1. Never an amount. */
  used: number;
}

const RING = 2 * Math.PI * 9; // 56.55, the You ring's length
const DOT_AT: Array<[number, number]> = [[7.5, 7.5], [16.5, 7.5], [7.5, 16.5], [16.5, 16.5]];

/** Bots: your bots as four dots. Open, they pop in 60 ms apart; at rest a working bot's dot breathes in its colour, the rest are grey rings. */
function botsGlyph(active: boolean, live: TabLive): SvgShape[] {
  return DOT_AT.map(([x, y], i) => {
    const d = live.dots[i];
    if (active) return { circle: [x, y, 3.9], fill: d?.color ?? IDLE, motion: "pop", ...(i ? { delayMs: i * 60 } : {}) };
    if (d?.working) return { circle: [x, y, 3.6], fill: d.color, motion: "breathe" };
    return { circle: [x, y, 3.2], stroke: IDLE, strokeWidth: 1.6 };
  });
}

/** Activity: a timeline whose beads are the status marks. Top: needs you (ink). Middle: working (the bot's colour). Bottom: done (a ring). */
function activityGlyph(active: boolean, live: TabLive): SvgShape[] {
  const line = active ? INK : IDLE;
  const hollow = (y: number): SvgShape => ({ circle: [6, y, 2.4], fill: "#ffffff", stroke: line, strokeWidth: 1.6 });
  return [
    { d: "M6 4v16", stroke: active ? INK : "#d4d4d4", strokeWidth: 1.6 },
    live.needs > 0 ? { circle: [6, 5, 3], fill: INK, ...(active ? { motion: "pop" as const } : {}) } : hollow(5),
    live.workingColor ? { circle: [6, 12, 2.8], fill: live.workingColor, motion: "breathe" } : hollow(12),
    hollow(19),
    { d: "M11.5 5h9M11.5 12h6.5M11.5 19h8", stroke: line, strokeWidth: 1.8, linecap: "round" },
  ];
}

/** You: you at the centre, ringed by how much of this stretch is used. Open, the ring draws to it. */
function youGlyph(active: boolean, live: TabLive): SvgShape[] {
  const arc = Math.round(Math.max(0, Math.min(1, live.used)) * RING * 10) / 10;
  return [
    { circle: [12, 12, 9], stroke: active ? "#e6e6e6" : "#ededed", strokeWidth: 2.2 },
    ...(arc > 0 ? [{
      circle: [12, 12, 9] as [number, number, number], stroke: active ? INK : IDLE, strokeWidth: 2.2, linecap: "round" as const,
      dash: `${arc} ${Math.round(RING * 100) / 100}`, rotate: -90, ...(active ? { motion: "draw" as const } : {}),
    }] : []),
    { circle: [12, 12, 3.4], fill: active ? INK : IDLE },
  ];
}

export type TabId = "bots" | "activity" | "you";

/** A living tab icon: 26 on the phone's bar, 22 in the window's sidebar. */
export function tabGlyph(tab: TabId, active: boolean, live: TabLive, size = 26): Node {
  const list = tab === "bots" ? botsGlyph(active, live) : tab === "activity" ? activityGlyph(active, live) : youGlyph(active, live);
  return shapes(list, { size });
}
