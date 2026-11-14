/**
 * EVERY PICTURE AS DOTS (src/show/dots.ts):
 *
 *   - a bar is as many inked dots as its share of the largest (the last one partly), on a faint track; a meter the same, in one row
 *   - a line is dotted along its length, its values bigger dots, on a faint baseline; it comes in left to right (its groups)
 *   - a path is read in the SVG grammar (absolute and relative, curves, arcs, closing) and dotted at an even pitch; a fill is a hex grid
 *     inside it; a paint is a tone, never a colour; white on white and "none" draw nothing
 *   - a drawing is held to the dot budget by spacing its dots wider, and keeps none outside its box
 *   - the callouts' marks are dots
 */
import { describe, expect, it } from "vitest";
import { BAR_ROW, MAX_PIC_DOTS, TONE, barsPic, drawPic, flatten, glyphPic, linePic, meterPic, toneOf, type DotPic } from "../src/show/dots.js";

const dots = (p: DotPic) => Array.from({ length: p.d.length / 5 }, (_v, i) => ({ x: p.d[i * 5]!, y: p.d[i * 5 + 1]!, r: p.d[i * 5 + 2]!, t: p.d[i * 5 + 3]!, g: p.d[i * 5 + 4]! }));

describe("numbers", () => {
  it("draws a bar as its share of the largest in inked dots, on a faint track, a row each", () => {
    const p = barsPic([{ value: 10 }, { value: 5 }, { value: 0 }], 200);
    expect(p.h).toBe(3 * BAR_ROW);
    const rows = [0, 1, 2].map((g) => dots(p).filter((d) => d.g === g));
    const inked = rows.map((r) => r.filter((d) => d.t === TONE.ink).length);
    expect(inked[0]).toBe(rows[0]!.length);
    expect(inked[1]).toBeGreaterThan(rows[1]!.length * 0.4);
    expect(inked[1]).toBeLessThan(rows[1]!.length * 0.65);
    expect(inked[2]).toBe(0);
    expect(rows[2]!.every((d) => d.t === TONE.faint)).toBe(true);
    // every dot of a row on its row's line
    expect(new Set(rows[1]!.map((d) => d.y))).toEqual(new Set([BAR_ROW * 1.5]));
  });

  it("draws a line dotted along its length, its values as bigger inked dots, coming in left to right", () => {
    const p = linePic([{ value: 1 }, { value: 4 }, { value: 2 }], 300, 96);
    const big = dots(p).filter((d) => d.t === TONE.ink);
    expect(big).toHaveLength(3);
    expect(big.map((d) => d.g)).toEqual([0, 1, 2]);
    // the highest value at the top
    expect(big[1]!.y).toBeLessThan(big[0]!.y);
    expect(dots(p).filter((d) => d.t === TONE.grey).length).toBeGreaterThan(40);
    expect(dots(p).some((d) => d.t === TONE.faint)).toBe(true);
  });

  it("draws a meter as one row, inked for the share done", () => {
    const p = meterPic(25, 100, 200);
    const all = dots(p);
    const inked = all.filter((d) => d.t === TONE.ink);
    expect(inked.length / all.length).toBeGreaterThan(0.2);
    expect(inked.length / all.length).toBeLessThan(0.32);
    expect(dots(meterPic(0, 100, 200)).every((d) => d.t === TONE.faint)).toBe(true);
    expect(dots(meterPic(100, 100, 200)).every((d) => d.t === TONE.ink)).toBe(true);
  });
});

describe("paths", () => {
  it("reads the SVG grammar, absolute and relative, and closes what Z closes", () => {
    const subs = flatten("M0 0 L10 0 H20 V10 l-5 5 z m30 0 h10 v10 h-10 Z");
    expect(subs).toHaveLength(2);
    expect(subs[0]!.closed).toBe(true);
    expect(subs[0]!.pts.slice(0, 5)).toEqual([[0, 0], [10, 0], [20, 0], [20, 10], [15, 15]]);
    // the relative move after a close starts from where the last figure began
    expect(subs[1]!.pts[0]).toEqual([30, 0]);
    expect(subs[1]!.closed).toBe(true);
  });

  it("cuts curves and arcs into short pieces that end where they should", () => {
    const end = (d: string) => flatten(d)[0]!.pts.at(-1)!;
    const near = (a: number[], b: number[]) => expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeLessThan(0.01);
    near(end("M0 0 C10 20 30 20 40 0"), [40, 0]);
    near(end("M0 0 Q20 30 40 0 T80 0"), [80, 0]);
    near(end("M0 0 C10 20 30 20 40 0 S70 -20 80 0"), [80, 0]);
    near(end("M10 50 A40 40 0 0 1 90 50"), [90, 50]);
    // a half circle bulges by its radius
    const arc = flatten("M10 50 A40 40 0 0 1 90 50")[0]!.pts;
    expect(Math.min(...arc.map((p) => p[1]))).toBeLessThan(11);
    expect(flatten("M0 0 C10 20 30 20 40 0")[0]!.pts.length).toBeGreaterThan(8);
  });

  it("skips what it cannot read without losing the rest", () => {
    expect(flatten("M0 0 L10")).toHaveLength(0);
    expect(flatten("M0 0 L10 0 L")[0]!.pts).toEqual([[0, 0], [10, 0]]);
    expect(flatten("")).toEqual([]);
  });
});

describe("drawings", () => {
  const draw = (shapes: unknown[], w = 200, h = 100) => ({ type: "draw" as const, width: w, height: h, shapes: shapes as never });

  it("dots an outline along its length at an even pitch, and fills a closed shape with a hex grid", () => {
    const line = drawPic(draw([{ d: "M0 50 L200 50", stroke: "ink", width: 2 }]), 200);
    const xs = dots(line).map((d) => d.x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.2);
    const square = drawPic(draw([{ d: "M50 20 L150 20 L150 80 L50 80 Z", fill: "grey" }]), 200);
    const inside = dots(square);
    expect(inside.length).toBeGreaterThan(60);
    expect(inside.every((d) => d.x > 50 && d.x < 150 && d.y > 20 && d.y < 80)).toBe(true);
    expect(inside.every((d) => d.t === TONE.grey)).toBe(true);
  });

  it("scales to the room, keeps the shapes in order, and paints in tones only", () => {
    const p = drawPic(draw([{ circle: [50, 50, 20], stroke: "#3E6E8E" }, { circle: [150, 50, 20], fill: "ink" }]), 400);
    expect(p.w).toBe(400);
    expect(p.h).toBe(200);
    const g0 = dots(p).filter((d) => d.g === 0), g1 = dots(p).filter((d) => d.g === 1);
    expect(g0.every((d) => d.t === TONE.grey)).toBe(true);
    expect(g1.every((d) => d.t === TONE.ink)).toBe(true);
    expect(Math.max(...g0.map((d) => d.x))).toBeLessThan(150);
  });

  it("holds a busy drawing to the dot budget, and keeps no dot outside its box", () => {
    const rings = Array.from({ length: 40 }, (_v, k) => ({ circle: [50, 50, 48 - k], fill: "ink", stroke: "ink" }));
    const p = drawPic(draw(rings, 100, 100), 440);
    expect(p.d.length / 5).toBeLessThanOrEqual(MAX_PIC_DOTS);
    expect(p.d.length / 5).toBeGreaterThan(200);
    const out = drawPic(draw([{ d: "M-50 -50 L250 150", stroke: "ink" }]), 200);
    expect(dots(out).every((d) => d.x + d.r >= 0 && d.y + d.r >= 0 && d.x - d.r <= 200 && d.y - d.r <= 100)).toBe(true);
  });

  it("reads a paint as a tone: ink, grey, soft, faint, or nothing", () => {
    expect(toneOf("ink")).toBe(TONE.ink);
    expect(toneOf("#0a0a0a")).toBe(TONE.ink);
    expect(toneOf("grey")).toBe(TONE.grey);
    expect(toneOf("#A9573A")).toBe(TONE.grey);
    expect(toneOf("#e6e6e6")).toBe(TONE.faint);
    expect(toneOf("#ffffff")).toBeNull();
    expect(toneOf("none")).toBeNull();
    expect(toneOf(undefined)).toBeNull();
    expect(drawPic(draw([{ circle: [50, 50, 20], fill: "paper" }]), 200).d).toEqual([]);
  });
});

describe("marks", () => {
  it("draws each callout's mark in dots, inside its box", () => {
    for (const k of ["info", "tip", "warn", "good"] as const) {
      const p = glyphPic(k, 16);
      expect(p.d.length / 5, k).toBeGreaterThan(3);
      expect(dots(p).every((d) => d.x >= 0 && d.x <= 16 && d.y >= 0 && d.y <= 16), k).toBe(true);
    }
  });
});
