/**
 * The PNG reader and the cheap gate (src/artifacts/pixels.ts): pictures in, a decision out, no model and no dependency.
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { CELL_CHANGED, GRID_COLS, GRID_ROWS, PngError, crc32, decodePng, diffGrids, encodePng, fillRect, gate, isPng, solid, toGrid, type Raster } from "../src/artifacts/pixels.js";

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** A PNG made by hand: header fields and the already-filtered-with-0 rows (each row without its filter byte). */
function hand(o: { width: number; height: number; depth: number; colorType: number; rows: number[][]; plte?: number[]; trns?: number[]; interlace?: number }): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, o.width);
  dv.setUint32(4, o.height);
  ihdr[8] = o.depth;
  ihdr[9] = o.colorType;
  ihdr[12] = o.interlace ?? 0;
  const raw = Uint8Array.from(o.rows.flatMap((r) => [0, ...r]));
  const parts = [Uint8Array.from(SIG), chunk("IHDR", ihdr), ...(o.plte ? [chunk("PLTE", Uint8Array.from(o.plte))] : []), ...(o.trns ? [chunk("tRNS", Uint8Array.from(o.trns))] : []), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}

/** A picture that looks like a screen: a white page, a header bar, a card with a button, lines of "text". */
function screen(w = 390, h = 844, o: { button?: [number, number, number]; shift?: number; title?: boolean; aa?: boolean } = {}): Raster {
  const r = solid(w, h, [255, 255, 255]);
  fillRect(r, 0, 0, w, 56, [24, 24, 27]);
  fillRect(r, 16, 80 + (o.shift ?? 0), w - 32, 180, [244, 244, 245]);
  fillRect(r, 32, 100 + (o.shift ?? 0), 160, 18, o.title === false ? [244, 244, 245] : [30, 30, 30]);
  for (let i = 0; i < 6; i += 1) fillRect(r, 32, 130 + i * 18 + (o.shift ?? 0), 220 + ((i * 37) % 90), 8, [120, 120, 125]);
  fillRect(r, 32, 230 + (o.shift ?? 0), 120, 36, o.button ?? [37, 99, 235]);
  if (o.aa) {
    // Another renderer's anti-aliasing: a faint row (a quarter of the way to the text's colour) above and below each line of text and the title.
    for (let i = 0; i < 6; i += 1) {
      const w = 220 + ((i * 37) % 90);
      fillRect(r, 32, 129 + i * 18, w, 1, [221, 221, 223]);
      fillRect(r, 32, 138 + i * 18, w, 1, [221, 221, 223]);
    }
    fillRect(r, 32, 99, 160, 1, [190, 190, 190]);
    fillRect(r, 32, 118, 160, 1, [190, 190, 190]);
  }
  for (let i = 0; i < 8; i += 1) fillRect(r, 16, 300 + i * 50, w - 32, 40, i % 2 ? [250, 250, 250] : [240, 240, 243]);
  return r;
}

describe("the PNG reader", () => {
  it("reads what the writer made, in RGBA and RGB, with every filter and with a different one on each row", () => {
    const img = screen(70, 50);
    img.data[3] = 128; // one half-transparent pixel
    for (const filter of [0, 1, 2, 3, 4, "mixed"] as const) {
      const back = decodePng(encodePng(img, { filter }));
      expect([back.width, back.height]).toEqual([70, 50]);
      expect(Array.from(back.data), `filter ${filter}`).toEqual(Array.from(img.data));
    }
    const rgb = decodePng(encodePng(img, { rgb: true, filter: "mixed" }));
    for (let i = 0; i < 70 * 50; i += 1) {
      expect([rgb.data[i * 4], rgb.data[i * 4 + 1], rgb.data[i * 4 + 2]]).toEqual([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]);
      expect(rgb.data[i * 4 + 3]).toBe(255);
    }
  });

  it("reads gray, gray with alpha, 16 bits a sample, and palette pictures of 8, 4 and 2 bits", () => {
    const gray = decodePng(hand({ width: 3, height: 1, depth: 8, colorType: 0, rows: [[0, 128, 255]] }));
    expect(Array.from(gray.data)).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    const ga = decodePng(hand({ width: 2, height: 1, depth: 8, colorType: 4, rows: [[10, 255, 20, 100]] }));
    expect(Array.from(ga.data)).toEqual([10, 10, 10, 255, 20, 20, 20, 100]);
    const sixteen = decodePng(hand({ width: 2, height: 1, depth: 16, colorType: 2, rows: [[0xff, 0x00, 0x80, 0x00, 0x12, 0x34, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]].map((r) => r.slice(0, 12)) }));
    expect(Array.from(sixteen.data)).toEqual([0xff, 0x80, 0x12, 255, 0x01, 0x03, 0x05, 255]);
    const pal8 = decodePng(hand({ width: 3, height: 1, depth: 8, colorType: 3, rows: [[0, 1, 2]], plte: [255, 0, 0, 0, 255, 0, 0, 0, 255], trns: [255, 128] }));
    expect(Array.from(pal8.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255]);
    // 4 bits: two pixels in a byte, high nibble first; 2 bits: four in a byte.
    const pal4 = decodePng(hand({ width: 3, height: 1, depth: 4, colorType: 3, rows: [[0x01, 0x20]], plte: [10, 20, 30, 40, 50, 60, 70, 80, 90] }));
    expect(Array.from(pal4.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]);
    const pal2 = decodePng(hand({ width: 5, height: 1, depth: 2, colorType: 3, rows: [[0b00011011, 0b01000000]], plte: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3] }));
    expect(Array.from(pal2.data).filter((_, i) => i % 4 === 0)).toEqual([0, 1, 2, 3, 1]);
    // 1-bit gray: black and white.
    const bw = decodePng(hand({ width: 4, height: 1, depth: 1, colorType: 0, rows: [[0b10100000]] }));
    expect(Array.from(bw.data).filter((_, i) => i % 4 === 0)).toEqual([255, 0, 255, 0]);
  });

  it("refuses what it will not read, in words: not a PNG, damaged, cut off, interlaced, too big, a made-up colour type", () => {
    const good = encodePng(solid(8, 8, [1, 2, 3]));
    expect(isPng(good)).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(() => decodePng(new TextEncoder().encode("<html>an error page</html>"))).toThrow(/not a PNG/);
    const damaged = Uint8Array.from(good);
    damaged[40] = (damaged[40]! + 1) & 255;
    expect(() => decodePng(damaged)).toThrow(PngError);
    expect(() => decodePng(damaged)).toThrow(/damaged|could not be read/);
    expect(() => decodePng(good.subarray(0, good.length - 20))).toThrow(/cut off/);
    expect(() => decodePng(hand({ width: 1, height: 1, depth: 8, colorType: 0, rows: [[0]], interlace: 1 }))).toThrow(/interlaced/);
    expect(() => decodePng(hand({ width: 1, height: 1, depth: 8, colorType: 5, rows: [[0]] }))).toThrow(/colour type/);
    expect(() => decodePng(hand({ width: 1, height: 1, depth: 3, colorType: 0, rows: [[0]] }))).toThrow(/bit depth/);
    expect(() => decodePng(good, { maxPixels: 10 })).toThrow(/too big/);
    expect(() => decodePng(hand({ width: 3, height: 3, depth: 8, colorType: 0, rows: [[0, 0, 0]] }))).toThrow(/short|could not be read/);
  });
});

describe("the cheap gate", () => {
  const png = (r: Raster) => encodePng(r);

  it("calls two copies of one picture the same, with a difference of nothing", () => {
    const g = gate(png(screen()), png(screen()));
    expect(g).toMatchObject({ same: true, sameShape: true, max: 0, changedCells: 0 });
    expect(g.difference).toBe(0);
  });

  it("calls a picture the same when only noise differs, or a font is anti-aliased differently", () => {
    const a = screen();
    const noisy = screen();
    let seed = 7;
    for (let i = 0; i < noisy.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 7) - 3;
      for (let c = 0; c < 3; c += 1) noisy.data[i + c] = Math.max(0, Math.min(255, noisy.data[i + c]! + n));
    }
    const g1 = gate(png(a), png(noisy));
    expect(g1.same).toBe(true);
    expect(g1.max).toBeLessThan(0.1);
    const g2 = gate(png(a), png(screen(390, 844, { aa: true })));
    expect(g2.same).toBe(true);
    expect(g2.max).toBeLessThan(0.1);
    // A transparent background is a white one to a person.
    const clear = screen();
    for (let i = 0; i < clear.data.length; i += 4) if (clear.data[i] === 255 && clear.data[i + 1] === 255 && clear.data[i + 2] === 255) clear.data[i + 3] = 0;
    expect(gate(png(a), png(clear)).same).toBe(true);
  });

  it("does not call a picture the same when a button is another colour, a title is gone, or a block moved", () => {
    const a = screen();
    const red = gate(png(a), png(screen(390, 844, { button: [220, 38, 38] })));
    expect(red.same).toBe(false);
    // The same lightness, another colour: the colour grid is what says so.
    expect(red.changedCells).toBe(0);
    expect(red.colorMax).toBeGreaterThan(0.5);
    const noTitle = gate(png(a), png(screen(390, 844, { title: false })));
    expect(noTitle.same).toBe(false);
    const moved = gate(png(a), png(screen(390, 844, { shift: 30 })));
    expect(moved.same).toBe(false);
    for (const g of [red, noTitle, moved]) {
      expect(g.difference).toBeGreaterThan(0.005);
      expect(g.difference).toBeLessThan(1);
    }
  });

  it("is certain of two very different pictures, and of two shapes that are not the same shape", () => {
    const a = screen();
    const b = solid(390, 844, [10, 10, 10]);
    fillRect(b, 40, 300, 300, 300, [250, 240, 20]);
    const far = gate(png(a), png(b));
    expect(far.same).toBe(false);
    expect(far.difference).toBeGreaterThan(0.5);
    // The same content on a page of another shape (a desktop shot against a phone one) is not the same picture.
    const wide = gate(png(solid(1280, 800, [255, 255, 255])), png(solid(390, 844, [255, 255, 255])));
    expect(wide).toMatchObject({ sameShape: false, same: false });
    expect(wide.difference).toBeGreaterThanOrEqual(0.25);
  });

  it("is a number that grows with the change", () => {
    const a = screen();
    const small = gate(png(a), png(screen(390, 844, { button: [220, 38, 38] }))).difference;
    const big = gate(png(a), png(solid(390, 844, [0, 0, 0]))).difference;
    expect(big).toBeGreaterThan(small);
  });

  it("makes a grid of lightness: white is 1, black is 0, and a mid gray is about half (by L*)", () => {
    expect(toGrid(solid(20, 20, [255, 255, 255])).cells.every((c) => Math.abs(c - 1) < 1e-3)).toBe(true);
    expect(toGrid(solid(20, 20, [0, 0, 0])).cells.every((c) => c < 1e-3)).toBe(true);
    const mid = toGrid(solid(20, 20, [119, 119, 119])).cells[0]!;
    expect(mid).toBeGreaterThan(0.48);
    expect(mid).toBeLessThan(0.52);
    const g = toGrid(solid(10, 10, [255, 255, 255]));
    expect([g.cols, g.rows]).toEqual([GRID_COLS, GRID_ROWS]);
    expect(CELL_CHANGED).toBe(0.1);
    expect(() => diffGrids(toGrid(solid(4, 4, [0, 0, 0]), 8, 8), toGrid(solid(4, 4, [0, 0, 0]), 4, 4))).toThrow(PngError);
  });

  it("averages in linear light: a checkerboard of black and white is the lightness of its average, not of its parts", () => {
    const r = solid(64, 128, [255, 255, 255]);
    for (let y = 0; y < 128; y += 1) for (let x = 0; x < 64; x += 1) if ((x + y) % 2 === 0) fillRect(r, x, y, 1, 1, [0, 0, 0]);
    const l = toGrid(r, 8, 8).cells[0]!;
    // Half the light of white is about L* 76, a lot lighter than the 50 of an average of the sample values.
    expect(l).toBeGreaterThan(0.7);
    expect(l).toBeLessThan(0.82);
  });
});
