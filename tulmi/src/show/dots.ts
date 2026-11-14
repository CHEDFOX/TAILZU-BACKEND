/**
 * EVERY PICTURE A BOT DRAWS, AS DOTS: ONE MONOCHROME, MINIMAL LOOK FOR WHATEVER IT IS.
 *
 *   barsPic(items, w)        a run of numbers: a row of dots a number, as many as its share of the largest, on a faint track
 *   linePic(items, w, h)     a line through the values, dotted, its points bigger, on a faint baseline
 *   meterPic(value, max, w)  a row of dots, as many inked as the share done
 *   drawPic(block, w)        a model's drawing: every outline dotted along its length, every fill a hex grid of dots inside it
 *   glyphPic(kind, size)     the small marks the callouts wear (a warning, a note, a tip, a good thing), in dots
 *
 * A picture is its box and five numbers a dot (home x, home y, radius, tone, group), drawn as an SVG's circles by every build, and
 * cut into pieces that spring in (experience/bots/show.ts). Tone is how much ink: ink, grey, soft, faint; there is no colour.
 * `group` is the order the dots come in: a bar after the bar above it, a line from left to right, a drawing shape by shape.
 *
 * Paths are read in the SVG grammar the checker lets through (M L H V C S Q T A Z, absolute and relative), flattened, and dotted at
 * an even pitch, so a drawing reads the same whatever its scale. A picture is held to MAX_PIC_DOTS by spacing its dots wider.
 *
 * Pure: the same block, the same dots.
 */
import type { Block, DrawShape } from "./types.js";

export const TONE = { ink: 1, grey: 0.62, soft: 0.36, faint: 0.18 } as const;

/** The most dots one picture may have (the node's own cap is a little above it). */
export const MAX_PIC_DOTS = 1_400;

export interface DotPic {
  w: number;
  h: number;
  /** x, y, r, tone, group, for every dot. */
  d: number[];
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

class Pen {
  d: number[] = [];
  add(x: number, y: number, r: number, t: number, g: number): void { this.d.push(r1(x), r1(y), r1(r), Math.round(t * 100) / 100, g); }
  get n(): number { return this.d.length / 5; }
}

// ===================================================================== numbers

/** One row a bar: its height in points, and how far apart its dots are. */
export const BAR_ROW = 18;
const BAR_PITCH = 7;
const BAR_R = 2.6;

/** A run of numbers as rows of dots: each row as many inked dots as its share of the largest (the last one partly), on a faint track. */
export function barsPic(items: ReadonlyArray<{ value: number }>, w: number): DotPic {
  const pen = new Pen();
  const top = Math.max(...items.map((i) => Math.abs(i.value)), 0) || 1;
  const slots = Math.max(4, Math.floor((w - BAR_R * 2) / BAR_PITCH) + 1);
  items.forEach((it, row) => {
    const y = row * BAR_ROW + BAR_ROW / 2;
    const filled = (Math.abs(it.value) / top) * (slots - 1) + (it.value === 0 ? 0 : 1);
    const tone = it.value < 0 ? TONE.soft : TONE.ink;
    for (let i = 0; i < slots; i++) {
      const x = BAR_R + i * BAR_PITCH;
      if (i < Math.floor(filled)) pen.add(x, y, BAR_R, tone, row);
      else if (i === Math.floor(filled) && filled % 1 > 0.15) pen.add(x, y, Math.max(0.9, BAR_R * (filled % 1)), tone, row);
      else pen.add(x, y, 1.1, TONE.faint, row);
    }
  });
  return { w, h: items.length * BAR_ROW, d: pen.d };
}

/** A line through the values: dotted along its length, a bigger dot at each value, a faint dotted baseline under it. */
export function linePic(items: ReadonlyArray<{ value: number }>, w: number, h = 96): DotPic {
  const pen = new Pen();
  const pad = 6;
  const vals = items.map((i) => i.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = items.map((it, k) => [pad + (k * (w - 2 * pad)) / Math.max(1, items.length - 1), pad + (1 - (it.value - lo) / span) * (h - 2 * pad)] as const);
  for (let x = pad; x <= w - pad + 0.01; x += 8) pen.add(x, h - pad + 3, 0.9, TONE.faint, 0);
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k]!, [bx, by] = pts[k + 1]!;
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / 4.5));
    for (let i = 1; i < n; i++) pen.add(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, 1.5, TONE.grey, k);
  }
  pts.forEach(([x, y], k) => pen.add(x, y, 3.2, TONE.ink, k));
  return { w, h, d: pen.d };
}

/** A meter: a row of dots, as many inked as the share done (the last one partly), the rest faint. */
export function meterPic(value: number, max: number, w: number): DotPic {
  const pen = new Pen();
  const n = clamp(Math.floor(w / 9), 10, 40), pitch = (w - 6) / (n - 1);
  const filled = max > 0 ? (clamp(value, 0, max) / max) * n : 0;
  for (let i = 0; i < n; i++) {
    const x = 3 + i * pitch;
    if (i < Math.floor(filled)) pen.add(x, 6, 2.6, TONE.ink, 0);
    else if (i === Math.floor(filled) && filled % 1 > 0.15) pen.add(x, 6, Math.max(0.9, 2.6 * (filled % 1)), TONE.ink, 0);
    else pen.add(x, 6, 1.3, TONE.faint, 0);
  }
  return { w, h: 12, d: pen.d };
}

// ===================================================================== drawings

type Pt = [number, number];
interface Sub { pts: Pt[]; closed: boolean }

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/** A path, flattened into polylines (curves and arcs cut into short straight pieces). */
export function flatten(d: string): Sub[] {
  const toks = d.match(TOKEN) ?? [];
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = "", lc: Pt | null = null, lq: Pt | null = null;
  let i = 0;
  const isCmd = (t: string): boolean => /^[a-z]$/i.test(t);
  const num = (): number => (i < toks.length && !isCmd(toks[i]!) ? Number(toks[i++]) : NaN);
  const start = (px: number, py: number) => { if (!Number.isFinite(px) || !Number.isFinite(py)) return; cur = { pts: [[px, py]], closed: false }; subs.push(cur); };
  const to = (px: number, py: number) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    if (!cur) start(x, y);
    cur!.pts.push([px, py]); x = px; y = py;
  };
  const curve = (pts: (t: number) => Pt, len: number) => { const n = clamp(Math.ceil(len / 3), 4, 48); for (let k = 1; k <= n; k++) { const p = pts(k / n); to(p[0], p[1]); } };
  while (i < toks.length) {
    const at = i;
    if (isCmd(toks[i]!)) cmd = toks[i++]!;
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase() && cmd !== "Z" && cmd !== "z";
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": { const px = num() + ox, py = num() + oy; start(px, py); x = sx = px; y = sy = py; cmd = rel ? "l" : "L"; lc = lq = null; break; }
      case "L": to(num() + ox, num() + oy); lc = lq = null; break;
      case "H": to(num() + ox, y); lc = lq = null; break;
      case "V": to(x, num() + oy); lc = lq = null; break;
      case "C": case "S": {
        const s = cmd.toUpperCase() === "S";
        const c1: Pt = s ? (lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]) : [num() + ox, num() + oy];
        const c2: Pt = [num() + ox, num() + oy], e: Pt = [num() + ox, num() + oy], b: Pt = [x, y];
        const len = Math.hypot(c1[0] - b[0], c1[1] - b[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(e[0] - c2[0], e[1] - c2[1]);
        curve((t) => { const u = 1 - t; return [u * u * u * b[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0], u * u * u * b[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1]]; }, len);
        lc = c2; lq = null;
        break;
      }
      case "Q": case "T": {
        const t_ = cmd.toUpperCase() === "T";
        const c: Pt = t_ ? (lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]) : [num() + ox, num() + oy];
        const e: Pt = [num() + ox, num() + oy], b: Pt = [x, y];
        const len = Math.hypot(c[0] - b[0], c[1] - b[1]) + Math.hypot(e[0] - c[0], e[1] - c[1]);
        curve((t) => { const u = 1 - t; return [u * u * b[0] + 2 * u * t * c[0] + t * t * e[0], u * u * b[1] + 2 * u * t * c[1] + t * t * e[1]]; }, len);
        lq = c; lc = null;
        break;
      }
      case "A": {
        const rx0 = Math.abs(num()), ry0 = Math.abs(num()), rot = (num() * Math.PI) / 180, large = num() !== 0, sweep = num() !== 0;
        const ex = num() + ox, ey = num() + oy;
        arc(x, y, rx0, ry0, rot, large, sweep, ex, ey, to);
        to(ex, ey);
        lc = lq = null;
        break;
      }
      case "Z": if (cur) { (cur as Sub).closed = true; to(sx, sy); } cur = null; x = sx; y = sy; lc = lq = null; break;
      default: break;
    }
    // A command's numbers may repeat it (an M's go on as L's); a Z takes none, so a number after it is skipped.
    if (cmd.toUpperCase() === "Z") cmd = "";
    if (i === at) i++;
  }
  return subs.filter((s) => s.pts.length > 1);
}

/** An SVG arc from (x1, y1) to (x2, y2), as points (the specification's endpoint-to-centre conversion). */
function arc(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number, to: (x: number, y: number) => void): void {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = clamp(Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / 3), 4, 64);
  for (let k = 1; k < n; k++) {
    const t = t1 + (dt * k) / n;
    to(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
  }
}

/** Points along polylines, every `pitch` points of length (a closed one without a doubled first dot). */
function along(subs: Sub[], pitch: number): Pt[] {
  const out: Pt[] = [];
  for (const s of subs) {
    let left = 0;
    out.push(s.pts[0]!);
    for (let k = 1; k < s.pts.length; k++) {
      const [ax, ay] = s.pts[k - 1]!, [bx, by] = s.pts[k]!;
      const len = Math.hypot(bx - ax, by - ay);
      let at = pitch - left;
      while (at <= len) { out.push([ax + ((bx - ax) * at) / len, ay + ((by - ay) * at) / len]); at += pitch; }
      left = len - (at - pitch);
    }
    if (s.closed && out.length > 1) {
      const a = out[out.length - 1]!, b = s.pts[0]!;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < pitch * 0.5) out.pop();
    }
  }
  return out;
}

/** Inside the closed polylines (even–odd), on a hex grid `pitch` apart. */
function inside(subs: Sub[], pitch: number): Pt[] {
  const polys = subs.map((s) => s.pts);
  if (!polys.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const out: Pt[] = [];
  const rowH = pitch * 0.866;
  let row = 0;
  for (let y = y0 + rowH / 2; y < y1; y += rowH, row++) {
    for (let x = x0 + (row % 2 ? pitch : pitch / 2); x < x1; x += pitch) {
      let odd = false;
      for (const p of polys) {
        for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
          const [ax, ay] = p[a]!, [bx, by] = p[b]!;
          if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) odd = !odd;
        }
      }
      if (odd) out.push([x, y]);
    }
  }
  return out;
}

/** How much ink a paint is: a name of ours, or a hex by its lightness. White (on white) and "none" are nothing. */
export function toneOf(v: string | undefined): number | null {
  if (!v || v === "none" || v === "paper") return null;
  if (v === "ink" || v === "bot") return TONE.ink;
  if (v === "grey") return TONE.grey;
  if (v === "line" || v === "surface") return TONE.faint;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return TONE.grey;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
  const l = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return l < 0.3 ? TONE.ink : l < 0.6 ? TONE.grey : l < 0.85 ? TONE.soft : l < 0.97 ? TONE.faint : null;
}

/** A drawing on its own canvas, `w` points wide (its height follows), as dots: outlines along their length, fills inside. */
export function drawPic(b: Extract<Block, { type: "draw" }>, w: number): DotPic {
  const s = w / b.width, h = Math.max(8, Math.round(b.height * s));
  let pitch = 5.5;
  for (let attempt = 0; attempt < 6; attempt++) {
    const pen = new Pen();
    b.shapes.forEach((sh: DrawShape, g) => {
      const subs: Sub[] = sh.circle
        ? [{ pts: Array.from({ length: 64 }, (_v, k) => [sh.circle![0] + sh.circle![2] * Math.cos((k / 64) * Math.PI * 2), sh.circle![1] + sh.circle![2] * Math.sin((k / 64) * Math.PI * 2)] as Pt), closed: true }]
        : flatten(sh.d ?? "");
      const scaled = subs.map((x) => ({ closed: x.closed, pts: x.pts.map(([px, py]) => [px * s, py * s] as Pt) }));
      const fill = toneOf(sh.fill), stroke = toneOf(sh.stroke);
      if (fill !== null) {
        const closed = scaled.filter((x) => x.closed || sh.circle);
        for (const [x, y] of inside(closed.length ? closed : scaled, pitch * 1.18)) pen.add(x, y, clamp(pitch * 0.34, 1.2, 2.4), fill, g);
      }
      if (stroke !== null) {
        const r = clamp((sh.width ?? Math.max(b.width, b.height) / 120) * s * 0.55, 1.1, 3.4);
        for (const [x, y] of along(scaled, Math.max(pitch, r * 2.6))) pen.add(x, y, r, stroke, g);
      }
    });
    if (pen.n <= MAX_PIC_DOTS) return { w, h, d: keepInside(pen.d, w, h) };
    pitch *= Math.sqrt(pen.n / MAX_PIC_DOTS) * 1.05;
  }
  return { w, h, d: [] };
}

/** Dots outside the box are dropped: the canvas would only cut them in half. */
function keepInside(d: number[], w: number, h: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 5) {
    const x = d[i]!, y = d[i + 1]!, r = d[i + 2]!;
    if (x + r < 0 || y + r < 0 || x - r > w || y - r > h) continue;
    out.push(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!, d[i + 4]!);
  }
  return out;
}

/** A picture held to `max` dots by keeping every k-th (a screen's budget, experience/bots/show.ts); unchanged when it already fits. */
export function thinPic(pic: DotPic, max: number): DotPic {
  const n = pic.d.length / 5;
  if (n <= max) return pic;
  const every = Math.ceil(n / Math.max(1, max));
  const d: number[] = [];
  for (let i = 0; i < n; i += every) d.push(...pic.d.slice(i * 5, i * 5 + 5));
  return { w: pic.w, h: pic.h, d };
}

// ===================================================================== small marks

export type GlyphKind = "info" | "tip" | "warn" | "good";

/** A callout's mark, `size` points square, in dots: a note's i, a tip's spark, a warning's !, a good thing's tick. */
export function glyphPic(kind: GlyphKind, size = 16): DotPic {
  const pen = new Pen();
  const u = size / 16, r = 1.4 * u, c = size / 2;
  if (kind === "warn") { for (let k = 0; k < 4; k++) pen.add(c, (2.5 + k * 2.6) * u, r, TONE.ink, 0); pen.add(c, 14 * u, r * 1.15, TONE.ink, 0); }
  else if (kind === "info") { pen.add(c, 2.8 * u, r * 1.15, TONE.grey, 0); for (let k = 0; k < 3; k++) pen.add(c, (7 + k * 2.9) * u, r, TONE.grey, 0); }
  else if (kind === "tip") { pen.add(c, c, r * 1.2, TONE.ink, 0); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, d = (k % 2 ? 4.2 : 6.2) * u; pen.add(c + Math.cos(a) * d, c + Math.sin(a) * d, r * (k % 2 ? 0.7 : 0.95), TONE.ink, 0); } }
  else for (const [x, y] of [[2.5, 8.5], [4.6, 10.6], [6.7, 12.7], [9, 10.4], [11.2, 8.2], [13.4, 6]] as const) pen.add(x * u, y * u, r, TONE.ink, 0);
  return { w: size, h: size, d: pen.d };
}
