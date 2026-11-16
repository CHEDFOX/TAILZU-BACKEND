/**
 * READING THE PROBE: WHAT IS BROKEN, AND WHETHER THE PAGE IS ONE DESIGN.
 *
 * `probe.ts` runs in the page and collects; nothing in it decides anything. This file decides, in Node, where every rule has a test around it.
 *
 * It answers two different questions, and keeping them apart is the whole point.
 *
 * 1. WHAT IS BROKEN (`defects`). Objective, absolute, and true of any page whatever it is for: text nobody can read, a control that shows nothing
 *    when you tab to it, a page that scrolls sideways on a phone, motion that keeps going after the person asked it to stop. These are not opinions
 *    and they do not need a reference: 4.5:1 is 4.5:1. Each one carries the axis that repairs it WITHOUT changing the design — that field is what
 *    makes the repair round possible, and it is the difference between a linter and an agent.
 *
 * 2. WHETHER IT IS ONE DESIGN (`coherence`). A page using 11 text sizes, 23 near-identical greys and 9 corner radii is not designed, and that is a
 *    measurement rather than a matter of taste. But — and this is the part most tools get wrong — THERE IS NO PUBLISHED HEALTHY NUMBER for any of
 *    these. The percentiles that exist describe what the web does, not what is good. So every coherence measure carries its own `direction`: "lower
 *    is better" where that is genuinely true (two colours a person cannot tell apart are drift, full stop), and "unknown" where it is not, said out
 *    loud rather than dressed up as a verdict. A tool that invents thresholds gets muted, and a muted tool helps nobody.
 *
 * THE ONE IDEA HERE THAT IS NOT BORROWED. The classical work on measuring layout — economy, regularity, alignment — is all defined over a set of
 * rectangles, and the implementations approximate those rectangles from pixels with computer vision, badly enough that most of the measures were
 * never implemented at all. A browser knows every rectangle exactly, and knows which element each one belongs to. So `alignment` below is that
 * measure computed from real boxes: it can say not only that the page has forty-one alignment points instead of six, but which element made each
 * stray one. Nobody has shipped that, as far as the research could find.
 *
 * Pure: no browser, no network, no clock. Everything takes a `ProbeResult` and returns data.
 */
import type { ProbeResult, ProbeText } from "./probe.js";

// ------------------------------------------------------------------ numbers

/** Text below this many pixels is too small to read, whatever the design says. */
export const TEXT_MIN_PX = 12;
/** The share of a page's characters that must be under TEXT_MIN_PX before it is worth saying. */
export const TINY_TEXT_SHARE = 0.05;
/** WCAG 2: normal text, and text that counts as large. */
export const CONTRAST_MIN = 4.5;
export const CONTRAST_MIN_LARGE = 3;
export const LARGE_PX = 24;
export const LARGE_BOLD_PX = 18.66;
/** Two colours this close in CIEDE2000 are the same colour to a person: the just-noticeable difference. */
export const SAME_COLOUR = 2;
/** An edge within this many pixels of another is on the same alignment line. */
export const ALIGN_TOLERANCE = 2;
/** A value used on at most this many elements, within EPSILON of one used on many, is a stray rather than a step. */
export const STRAY_USES = 2;
export const NEAR_USES = 10;
/** How close a stray must be to a real step, in pixels, to be called a near-miss of it. */
export const STRAY_PX = 3;
/** The most of anything named in one finding. */
export const SHOWN = 4;

// ------------------------------------------------------------------ colour

const srgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** The WCAG 2 relative luminance of "r,g,b". */
export function luminance(rgb: string): number | null {
  const p = rgb.split(",").map((n) => Number(n));
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return null;
  const [r, g, b] = p.map((n) => srgb(Math.min(255, Math.max(0, n)) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG 2 contrast ratio, 1 to 21. The enforced floor is WCAG 2 and not the newer perceptual algorithm on purpose: that one is published but it
 * is not open source — all rights reserved, patents pending, and a licence that reaches commercial use — so it is not something to ship or to claim.
 */
export function contrast(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** sRGB "r,g,b" to CIELAB under D65. */
export function lab(rgb: string): [number, number, number] | null {
  const p = rgb.split(",").map((n) => Number(n));
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return null;
  const [r, g, b] = p.map((n) => srgb(Math.min(255, Math.max(0, n)) / 255)) as [number, number, number];
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/**
 * CIEDE2000, the standard perceptual colour difference (Sharma's formulation). Under about 2 is the just-noticeable difference, which is the only
 * threshold here that needs no justification: two colours a person cannot tell apart are not two colours.
 */
export function deltaE(a: string, b: string): number | null {
  const la = lab(a);
  const lb = lab(b);
  if (!la || !lb) return null;
  const [L1, a1, b1] = la;
  const [L2, a2, b2] = lb;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp = (x: number, y: number): number => (x === 0 && y === 0 ? 0 : (deg(Math.atan2(y, x)) + 360) % 360);
  const hp1 = hp(ap1, b1);
  const hp2 = hp(ap2, b2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(rad(dh) / 2);
  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 === 0) { /* hbar stands */ } else if (Math.abs(hp1 - hp2) <= 180) hbar /= 2;
  else hbar = (hbar + (hbar < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbar - 30)) + 0.24 * Math.cos(rad(2 * hbar)) + 0.32 * Math.cos(rad(3 * hbar + 6)) - 0.2 * Math.cos(rad(4 * hbar - 63));
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ------------------------------------------------------------------ what is broken

/** One objective defect, with the axis that repairs it without changing the design. */
export interface Defect {
  rule: string;
  /** How many places. */
  count: number;
  /** The line a person reads. */
  text: string;
  /**
   * HOW TO FIX IT WITHOUT CHANGING THE DESIGN. Every objective defect has one axis that repairs it and others that would destroy the thing the
   * person chose, and knowing which is which is what lets a job repair instead of complain. "lightness" means move the colour's lightness and
   * never its hue or chroma, so the palette keeps its identity; "snap" means move a stray value onto the step it nearly is.
   */
  fix: "lightness" | "size" | "ring" | "motion" | "width" | "snap";
  /** The places, for the model to act on. */
  where: string[];
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const isLarge = (t: ProbeText): boolean => t.px >= LARGE_PX || (t.px >= LARGE_BOLD_PX && t.weight >= 700);

/**
 * What is objectively wrong with the page. Absolute, needs no reference, and every entry names the axis that repairs it.
 * Order is worst first: a page nobody can read matters more than a page that scrolls sideways.
 */
export function defects(p: ProbeResult): Defect[] {
  const out: Defect[] = [];
  const add = (rule: string, where: string[], fix: Defect["fix"], text: (n: number, eg: string[]) => string) => {
    if (!where.length) return;
    out.push({ rule, count: where.length, fix, where: where.slice(0, SHOWN), text: text(where.length, where.slice(0, SHOWN)) });
  };

  // Text nobody can read. Invisible text is split out because a ratio near 1 is never a decision; it is always a bug, usually a missed dark-mode token.
  const invisible: string[] = [];
  const low: string[] = [];
  for (const t of p.text) {
    if (!t.fg || !t.bg || t.chars < 2) continue;
    const r = contrast(t.fg, t.bg);
    if (r === null) continue;
    if (r < 1.1) { invisible.push(t.at); continue; }
    if (r < (isLarge(t) ? CONTRAST_MIN_LARGE : CONTRAST_MIN)) low.push(`${t.at} (${r.toFixed(1)}:1)`);
  }
  add("text.invisible", invisible, "lightness", (n, eg) => `${n} run${n === 1 ? "" : "s"} of text ${n === 1 ? "is" : "are"} the same colour as what is behind ${n === 1 ? "it" : "them"} (${eg.join(", ")}), so ${n === 1 ? "it is" : "they are"} invisible. That is never a design decision; it is usually a token that has no dark-mode value.`);
  add("text.contrast", low, "lightness", (n, eg) => `${n} run${n === 1 ? "" : "s"} of text fall${n === 1 ? "s" : ""} below the contrast a person needs to read ${n === 1 ? "it" : "them"} — ${CONTRAST_MIN}:1, or ${CONTRAST_MIN_LARGE}:1 for large text (${eg.join(", ")}).`);

  // Text too small to read, weighed by how much text it is rather than how many elements.
  const chars = p.text.reduce((n, t) => n + t.chars, 0);
  const tinyChars = p.text.filter((t) => t.px > 0 && t.px < TEXT_MIN_PX).reduce((n, t) => n + t.chars, 0);
  if (chars > 0 && tinyChars / chars >= TINY_TEXT_SHARE) {
    const eg = [...new Set(p.text.filter((t) => t.px > 0 && t.px < TEXT_MIN_PX).sort((a, b) => b.chars - a.chars).map((t) => `${t.at} at ${t.px}px`))].slice(0, SHOWN);
    out.push({
      rule: "text.small", count: tinyChars, fix: "size", where: eg,
      text: `${pct(tinyChars / chars)} of the page's text is set below ${TEXT_MIN_PX}px (${eg.join(", ")}), which is below what most people can comfortably read.`,
    });
  }

  // A page that scrolls sideways on a phone. The document-level fact is the finding; the named elements are how to fix it.
  if (p.doc.scrollWidth > p.doc.clientWidth + 1 && p.viewport.w > 0) {
    const eg = p.overflow.map((o) => `${o.at} (${o.px}px past)`);
    out.push({
      rule: "layout.overflow", count: Math.round(p.doc.scrollWidth - p.doc.clientWidth), fix: "width", where: eg.slice(0, SHOWN),
      text: `At ${p.viewport.w}px wide the page scrolls sideways by ${Math.round(p.doc.scrollWidth - p.doc.clientWidth)}px${eg.length ? `, because of ${eg.slice(0, SHOWN).join(", ")}` : ""}. On a phone that means the layout is broken, not scrollable.`,
    });
  }

  // Nothing happens when you tab to it. Only elements the browser itself calls focus-visible, so a mouse-only :focus is not counted as a keyboard ring.
  const noRing = p.focus.filter((f) => f.visible && !f.changed).map((f) => f.at);
  add("focus.none", noRing, "ring", (n, eg) => `${n} control${n === 1 ? "" : "s"} show${n === 1 ? "s" : ""} nothing at all when ${n === 1 ? "it takes" : "they take"} keyboard focus (${eg.join(", ")}), so anyone using a keyboard cannot see where they are.`);

  // Motion that kept going after the page was asked for less of it.
  const moving = p.animations.map((a) => `${a.at || a.name || "an element"}${a.forever ? " (never stops)" : a.ms ? ` (${Math.round(a.ms)}ms)` : ""}`);
  add("motion.reduce", moving, "motion", (n, eg) => `${n} animation${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} still running with prefers-reduced-motion set to reduce (${eg.join(", ")}). Reduced motion means gentler, not nothing — keep the colour and opacity, drop the movement.`);

  return out;
}

// ------------------------------------------------------------------ whether it is one design

export interface Measure {
  name: string;
  value: number;
  /** What the number counts, in a few words. */
  of: string;
  /**
   * Whether anyone actually knows which way is better. "lower" only where that is beyond argument (colours a person cannot tell apart); "unknown"
   * everywhere else, said plainly. Reference percentiles describe what the web does, not what is good, and a measure that pretends otherwise is
   * how a reporting tool gets muted.
   */
  direction: "lower" | "unknown";
  /** The places that made the number what it is, when naming them helps. */
  note?: string;
}

/** A value that is almost, but not quite, one of the page's real steps. */
export interface Stray { value: string; uses: number; near: string; nearUses: number; gap: number }

const px = (v: string): number | null => { const m = /^(-?[\d.]+)px$/.exec(v.trim()); return m ? Number(m[1]) : null; };

/**
 * Values that are nearly a step but not quite: used on almost nothing, and within a few pixels of a value used on plenty. This is drift with no
 * taste in it at all — nobody chose 13px next to a 12px used 847 times — and the repair is to snap it, which is why it has a `fix` of its own.
 */
export function strays(used: Readonly<Record<string, number>>): Stray[] {
  const entries = Object.entries(used).map(([value, uses]) => ({ value, uses, n: px(value) })).filter((e) => e.n !== null) as Array<{ value: string; uses: number; n: number }>;
  const common = entries.filter((e) => e.uses >= NEAR_USES);
  const out: Stray[] = [];
  for (const e of entries) {
    if (e.uses > STRAY_USES) continue;
    let best: { value: string; uses: number; gap: number } | null = null;
    for (const c of common) {
      const gap = Math.abs(c.n - e.n);
      if (gap === 0 || gap > STRAY_PX) continue;
      if (!best || gap < best.gap) best = { value: c.value, uses: c.uses, gap };
    }
    if (best) out.push({ value: e.value, uses: e.uses, near: best.value, nearUses: best.uses, gap: best.gap });
  }
  return out.sort((a, b) => b.nearUses - a.nearUses);
}

/** Colours a person cannot tell apart, collapsed. Returns how many colours there really are, and the pairs that are the same colour twice. */
export function samePalette(colours: Readonly<Record<string, number>>): { distinct: number; raw: number; pairs: Array<[string, string]> } {
  const list = Object.keys(colours).filter((c) => /^\d+,\d+,\d+$/.test(c));
  const seen: string[] = [];
  const pairs: Array<[string, string]> = [];
  for (const c of list) {
    const twin = seen.find((s) => { const d = deltaE(s, c); return d !== null && d < SAME_COLOUR; });
    if (twin) pairs.push([twin, c]);
    else seen.push(c);
  }
  return { distinct: seen.length, raw: list.length, pairs };
}

/**
 * The grid, from real boxes. Classical layout measures want a set of rectangles and have always had to guess them from pixels; a browser knows them
 * exactly, and knows whose they are. Few alignment lines with most edges on them is a composition; dozens of near-miss lines is a page assembled.
 */
export function alignment(rects: ReadonlyArray<{ x: number; w: number; at: string }>): { lines: number; snapped: number; stray: string[] } {
  const edges: Array<{ v: number; at: string }> = [];
  for (const r of rects) { edges.push({ v: r.x, at: r.at }); edges.push({ v: r.x + r.w, at: r.at }); }
  if (!edges.length) return { lines: 0, snapped: 1, stray: [] };
  edges.sort((a, b) => a.v - b.v);
  const clusters: Array<{ at: number; members: Array<{ v: number; at: string }> }> = [];
  for (const e of edges) {
    const last = clusters[clusters.length - 1];
    if (last && e.v - last.at <= ALIGN_TOLERANCE) last.members.push(e);
    else clusters.push({ at: e.v, members: [e] });
  }
  const big = clusters.filter((c) => c.members.length >= 3);
  const onBig = big.reduce((n, c) => n + c.members.length, 0);
  // An edge that is nearly on a real line, but not on it: the ones worth naming.
  const stray: string[] = [];
  for (const c of clusters) {
    if (c.members.length >= 3) continue;
    const near = big.find((b) => Math.abs(b.at - c.at) <= ALIGN_TOLERANCE * 4);
    if (near) for (const m of c.members) if (!stray.includes(m.at)) stray.push(m.at);
  }
  return { lines: clusters.length, snapped: edges.length ? onBig / edges.length : 1, stray: stray.slice(0, SHOWN * 2) };
}

const count = (m: Readonly<Record<string, number>>): number => Object.keys(m).length;

/** Is this page one design? Numbers, each saying whether anyone knows which way is better. */
export function coherence(p: ProbeResult): Measure[] {
  const palette = samePalette({ ...p.styles.color, ...p.styles.background });
  const out: Measure[] = [
    {
      name: "colours", value: palette.distinct, of: "colours a person could actually tell apart, as drawn", direction: "unknown",
      ...(palette.pairs.length ? { note: `${palette.raw} colour values are used, but ${palette.raw - palette.distinct} of them are indistinguishable from another one already there (${palette.pairs.slice(0, SHOWN).map(([a, b]) => `${a} / ${b}`).join(", ")}). Those are drift, not choices.` } : {}),
    },
    { name: "text sizes", value: count(p.styles.fontSize), of: "distinct text sizes, as drawn", direction: "unknown" },
    { name: "typefaces", value: count(p.styles.fontFamily), of: "distinct first-choice font families", direction: "unknown" },
    { name: "spacings", value: count(p.styles.spacing), of: "distinct padding, margin and gap values", direction: "unknown" },
    { name: "radii", value: count(p.styles.radius), of: "distinct corner radii", direction: "unknown" },
    { name: "shadows", value: count(p.styles.shadow), of: "distinct shadows", direction: "unknown" },
  ];
  if (palette.pairs.length) {
    out.push({ name: "colours that are the same colour", value: palette.pairs.length, of: "pairs closer than the eye can see apart", direction: "lower" });
  }
  const grid = alignment(p.rects);
  if (grid.lines) {
    out.push({
      name: "alignment lines", value: grid.lines, of: `vertical lines the page's edges sit on, with ${pct(grid.snapped)} of edges on a shared one`,
      direction: "unknown", ...(grid.stray.length ? { note: `Nearly-but-not-quite on a line: ${grid.stray.slice(0, SHOWN).join(", ")}.` } : {}),
    });
  }
  return out;
}

/** Every stray value on the page, across the kinds that have a scale. */
export function allStrays(p: ProbeResult): Array<{ kind: string; stray: Stray }> {
  const kinds: Array<[string, Readonly<Record<string, number>>]> = [
    ["text size", p.styles.fontSize], ["spacing", p.styles.spacing], ["corner radius", p.styles.radius],
  ];
  return kinds.flatMap(([kind, used]) => strays(used).map((stray) => ({ kind, stray })));
}

/** The words the report carries. Nothing at all when the page is sound and says nothing worth saying. */
export function coherenceLines(p: ProbeResult): string[] {
  const bad = defects(p);
  const nums = coherence(p);
  const stray = allStrays(p);
  if (!bad.length && !stray.length && !nums.some((m) => m.direction === "lower" && m.value > 0)) return [];
  const out: string[] = [];
  if (bad.length) {
    out.push("What the running page showed:", ...bad.map((d) => `- ${d.text}`));
  }
  if (stray.length) {
    out.push("", "Values that are nearly one of the page's own steps, but not quite:",
      ...stray.slice(0, SHOWN * 2).map(({ kind, stray: s }) => `- ${kind} ${s.value} is used ${s.uses === 1 ? "once" : `${s.uses} times`}, ${s.gap}px from ${s.near}, which is used ${s.nearUses} times.`));
  }
  const told = nums.filter((m) => m.note || m.direction === "lower");
  if (told.length) {
    out.push("", "How much of one design it is (these are counts, not marks — for most of them nobody knows what the right number is):",
      ...told.map((m) => `- ${m.value} ${m.of}.${m.note ? ` ${m.note}` : ""}`));
  }
  return out;
}
