/**
 * ARE WE BUILDING THE SAME APP OVER AND OVER? CONVERGENCE AS A NUMBER.
 *
 * Every catalogue of "AI design tells" warns about the same thing and none of them solves it: fix the first set of defaults and the fixes converge
 * too. Avoid the purple gradient and everyone lands on cream-and-terracotta instead. One of them admits its own first demo did exactly that. The
 * reason nobody solves it is that CONVERGENCE IS INVISIBLE FROM INSIDE ONE PAGE. Every app we build can be individually good and the set of them
 * still be one app wearing different names, and no check on a single page can ever see it.
 *
 * It is visible across runs, though, and that is a thing only we can look at: a product that builds many apps knows what it built last time. So
 * this takes the decisions a finished page actually embodies — not what anyone intended, what it came out as — reduces them to a short fingerprint,
 * and then the question "have we made this before" is a lookup rather than a worry.
 *
 * WHAT IS IN THE FINGERPRINT. Only things that are properties of the DESIGN rather than of the content:
 *
 *   hue          the family the page's strongest colour belongs to. Not the exact colour — two blues are the same decision
 *   ink          whether it is light-on-dark or dark-on-light, which is the single most visible choice a page makes
 *   steps        how many text sizes and radii it uses: the grain of the system, coarse or fine
 *   round        how round it is, in tiers, because 8px and 10px are not different decisions
 *   silhouette   the SHAPE of the page with the content taken out — blocks by row and width, quantised hard. A hero over three equal cards has a
 *                silhouette, and it is the same silhouette whatever the cards say. This is the structural half, and it is the half that catches
 *                "we have shipped this layout nine times" when every one of them had different colours
 *
 * WHAT IS NOT. No judgement at all. This file never says a page is bad, or that a repeat is wrong — a person who asks for the same thing twice
 * should get it twice, and a house style is a legitimate thing to have. It says only HOW CONCENTRATED the recent set is, which is a fact. What to
 * do about it belongs to whoever is reading, and the honest default is: show the number and let it argue for itself.
 *
 * Pure. No store, no clock, no network: a fingerprint goes in, a distribution comes out.
 */
import type { ProbeResult } from "./probe.js";
import { lab } from "./coherence.js";

/** How many recent projects the question "have we made this before" looks back over. */
export const RECENT = 10;
/** A share of the recent set landing on one answer, above which the set has stopped spreading out. */
export const CONCENTRATED = 0.5;

/** The decisions a finished page embodies, short enough to keep for every project. */
export interface Fingerprint {
  /** The family the strongest colour belongs to, or "none" for a page with no colour in it. */
  hue: string;
  /** "light" or "dark": what the page is mostly made of. */
  ink: string;
  /** How many text sizes and corner radii, as a coarse grain. */
  steps: { text: number; radius: number };
  /** How round, in tiers nobody would argue about: "square", "soft", "round", "pill". */
  round: string;
  /** The page's shape with the content taken out. */
  silhouette: string;
}

/**
 * The colour wheel as people name it, in HSL degrees. These are naming boundaries, not a perceptual measurement — the family is what a person
 * would CALL the colour, and "blue" has to mean blue. (CIELAB's own hue angle is the better perceptual quantity and it is used below for how
 * colourful something is, but its angles do not line up with the names at all: #0000FF sits near 306 degrees there, not 240.)
 */
const FAMILIES: ReadonlyArray<[string, number]> = [
  ["red", 15], ["orange", 45], ["yellow", 70], ["lime", 100], ["green", 150], ["teal", 190],
  ["blue", 255], ["indigo", 280], ["violet", 310], ["pink", 345], ["red", 361],
];

/** The family a hue belongs to. Two blues are the same decision, which is the point of naming families rather than keeping degrees. */
export function family(hueDeg: number): string {
  const h = ((hueDeg % 360) + 360) % 360;
  for (const [name, upTo] of FAMILIES) if (h < upTo) return name;
  return "red";
}

/** The hue as people name it, and how colourful it is in CIELAB, which is the honest measure of that. Null for a colour with no colour in it. */
function hueOf(rgb: string): { deg: number; chroma: number } | null {
  const l = lab(rgb);
  if (!l) return null;
  const chroma = Math.hypot(l[1], l[2]);
  if (chroma < 8) return null;
  const p = rgb.split(",").map(Number);
  const [r, g, b] = [p[0]! / 255, p[1]! / 255, p[2]! / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return null;
  const deg = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { deg: ((deg % 360) + 360) % 360, chroma };
}

const tierOf = (px: number): string => (px < 3 ? "square" : px < 10 ? "soft" : px < 24 ? "round" : "pill");

/**
 * The page's shape with the content taken out: each block as its row band and its width in tenths, in reading order, run-length collapsed. Three
 * equal cards in a row read as "3x3" whatever is written on them, so two pages built to the same template match even when nothing else does.
 */
export function silhouette(rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>, width: number): string {
  if (!rects.length || width <= 0) return "";
  const band = Math.max(80, Math.round(width / 2));
  const blocks = [...rects]
    .filter((r) => r.w >= width * 0.08)
    .sort((a, b) => (Math.floor(a.y / band) - Math.floor(b.y / band)) || a.x - b.x)
    .map((r) => `${Math.floor(r.y / band)}:${Math.min(10, Math.max(1, Math.round((r.w / width) * 10)))}`);
  const out: string[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    const [name, n] = last ? last.split("x") : ["", ""];
    if (name === b) out[out.length - 1] = `${b}x${Number(n || 1) + 1}`;
    else out.push(b);
  }
  return out.slice(0, 24).join(" ");
}

/** What a finished page came out as. Reads the measurement, never anyone's intention. */
export function fingerprint(p: ProbeResult): Fingerprint {
  // The strongest colour on the page: the most colourful one that is actually used, weighted by how much it is used.
  let best: { deg: number; score: number } | null = null;
  for (const [rgb, uses] of Object.entries({ ...p.styles.color, ...p.styles.background })) {
    const h = hueOf(rgb);
    if (!h) continue;
    const score = h.chroma * Math.log1p(uses);
    if (!best || score > best.score) best = { deg: h.deg, score };
  }
  // Light or dark, by how much of what is drawn is dark.
  let dark = 0;
  let lit = 0;
  for (const [rgb, uses] of Object.entries(p.styles.background)) {
    const l = lab(rgb);
    if (!l) continue;
    if (l[0] < 50) dark += uses; else lit += uses;
  }
  const radii = Object.entries(p.styles.radius).map(([v, uses]) => ({ px: parseFloat(v) || 0, uses })).sort((a, b) => b.uses - a.uses);
  return {
    hue: best ? family(best.deg) : "none",
    ink: dark > lit ? "dark" : "light",
    steps: { text: Object.keys(p.styles.fontSize).length, radius: radii.length },
    round: tierOf(radii[0]?.px ?? 0),
    silhouette: silhouette(p.rects, p.viewport.w),
  };
}

/** How concentrated one axis of the recent set is: the commonest answer, and what share of the set gave it. */
export interface Spread { axis: string; commonest: string; share: number; of: number }

/** How much the recent set repeats itself, axis by axis. A fact, not a verdict. */
export function spread(recent: readonly Fingerprint[]): Spread[] {
  if (!recent.length) return [];
  const axes: Array<[string, (f: Fingerprint) => string]> = [
    ["hue", (f) => f.hue], ["light or dark", (f) => f.ink], ["roundness", (f) => f.round], ["layout", (f) => f.silhouette || "(none)"],
  ];
  return axes.map(([axis, of]) => {
    const counts = new Map<string, number>();
    for (const f of recent) counts.set(of(f), (counts.get(of(f)) ?? 0) + 1);
    const [commonest, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return { axis, commonest, share: n / recent.length, of: recent.length };
  });
}

/**
 * Whether the thing we are about to build is one we keep building. Takes the recent set NEWEST FIRST and the one being judged, and answers only
 * where it repeats — never whether that is wrong, because a person who asks for the same thing twice should get it twice.
 */
export function seenBefore(now: Fingerprint, recent: readonly Fingerprint[]): string[] {
  const last3 = recent.slice(0, 3);
  const out: string[] = [];
  if (last3.length >= 3 && last3.every((f) => f.hue === now.hue) && now.hue !== "none") out.push(`the last three projects were all ${now.hue} too`);
  if (last3.length >= 3 && last3.every((f) => f.silhouette === now.silhouette) && now.silhouette) out.push("the last three projects had this same layout shape");
  if (last3.length >= 3 && last3.every((f) => f.round === now.round && f.ink === now.ink)) out.push(`the last three were all ${now.ink} and ${now.round} as well`);
  return out;
}

/** The words a dashboard carries. Nothing at all until there are enough projects for the question to mean anything. */
export function samenessLines(recent: readonly Fingerprint[]): string[] {
  if (recent.length < 3) return [];
  const tight = spread(recent).filter((s) => s.share > CONCENTRATED);
  const out = [`Across the last ${recent.length} projects:`];
  if (!tight.length) {
    out.push("- no single answer accounts for more than half of any axis, so the work is still spreading out.");
    return out;
  }
  for (const s of tight) {
    out.push(`- ${Math.round(s.share * 100)}% of them came out ${s.axis === "layout" ? "with the same layout shape" : `${s.commonest}${s.axis === "hue" ? "" : ` (${s.axis})`}`}.`);
  }
  out.push("That is a measurement, not a fault: it is only worth acting on where nobody asked for it.");
  return out;
}
