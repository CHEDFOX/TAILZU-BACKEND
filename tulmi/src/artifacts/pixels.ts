/**
 * PIXELS, IN PURE TYPESCRIPT: A MINIMAL PNG READER, A WRITER FOR TESTS, AND THE CHEAP GATE (docs/artifacts.md section 11).
 *
 * The compare step (compare.ts) does not send a model two pictures that are the same. Before it does, both shots are cut down to a small grid of
 * lightness values and compared cell by cell; when nothing a person would see differs, the model is not asked at all. That needs the pixels, and
 * the shots arrive as PNG, so this file reads one: 8 or 16 bits a sample, gray, gray+alpha, RGB, RGBA and palette, every filter, not interlaced
 * (Chrome does not make one). `node:zlib` inflates it; there is no dependency. The CRC of every chunk is checked, so a picture cut off in transit is
 * refused instead of being compared.
 *
 * THE GATE. A shot becomes a `cols x rows` grid (64 x 128 by default) of CIE lightness, 0 to 1:
 *   - each pixel is laid over white (a transparent background is white to a person), its sRGB sample made linear, and weighed 0.2126 R + 0.7152 G + 0.0722 B
 *   - the pixels of a cell are averaged IN LINEAR LIGHT (what the eye does), and the average is turned into lightness L* (so a step of 0.1 is about the same
 *     to a person whether it is in the dark or the light)
 * Lightness alone would call a blue button and a red one the same (they are the same lightness), so the shot is also cut into a COARSE grid (16 x 32) of
 * CIELAB a* and b* (the colour, with the lightness taken out), averaged the same way.
 * Two grids are then compared cell by cell:
 *   mean      the average |difference| of lightness
 *   max       the biggest single |difference|
 *   changed   the share of cells that differ by more than CELL_CHANGED (0.1, ten points of L*)
 *   colorMax  the biggest colour distance of a coarse cell, hypot(da, db) / 100
 * The lightness grid is blurred over 3 x 3 cells before it is compared: an edge that another renderer anti-aliases a little differently splits a cell's light
 * differently, and the blur spreads that over the cells around it until it is under the threshold, while a button of another colour or a line of other
 * words, which cover whole cells, stay far over it. (A thin line moved by a whole pixel is NOT the same by this measure: the model is asked, which
 * costs little. What the gate is for is two shots of one page.) They are "the same" when the shapes agree, the colours stay under COLOR_SAME (0.12), and either
 * no cell differs by more than SAME_MAX (0.1), or at most two do and the mean is under 0.004. Noise of a few levels, a font anti-aliased a little differently
 * and a layout one pixel off stay under it; a button of another colour, a line of text that says something else and a different layout do not.
 * `difference` is one number for the rest: min(1, 2 mean + changed + colour changed / 2 + 0.25 for another shape).
 *
 * Nothing here reaches a network, a clock or a store.
 */
import { deflateSync, inflateSync } from "node:zlib";

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngError";
  }
}

/** A picture: RGBA, 8 bits, row by row. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function isPng(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  for (let i = 0; i < 8; i += 1) if (b[i] !== SIGNATURE[i]) return false;
  return true;
}

// ----------------------------------------------------------------------- crc

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// -------------------------------------------------------------------- reader

/** The most pixels a picture may have (a 4K screenshot is 8 million). */
export const PNG_MAX_PIXELS = 24_000_000;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const be32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** Reads a PNG into RGBA. Throws PngError, with a reason, for anything it will not read. */
export function decodePng(bytes: Uint8Array, o: { maxPixels?: number } = {}): Raster {
  if (!isPng(bytes)) throw new PngError("that is not a PNG");
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let seenHeader = false;
  let ended = false;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;

  let at = 8;
  while (at + 12 <= bytes.length && !ended) {
    const len = be32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const dataStart = at + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) throw new PngError("the picture is cut off");
    if (crc32(bytes, at + 4, dataEnd) !== be32(bytes, dataEnd)) throw new PngError("the picture is damaged (a chunk's checksum is wrong)");
    if (type === "IHDR") {
      if (len !== 13) throw new PngError("the header is the wrong size");
      width = be32(bytes, dataStart);
      height = be32(bytes, dataStart + 4);
      depth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0) throw new PngError("an unknown compression or filter method");
      if (bytes[dataStart + 12] !== 0) throw new PngError("interlaced pictures are not read");
      seenHeader = true;
    } else if (!seenHeader) {
      throw new PngError("the picture does not begin with its header");
    } else if (type === "PLTE") {
      palette = bytes.subarray(dataStart, dataEnd);
    } else if (type === "tRNS") {
      trns = bytes.subarray(dataStart, dataEnd);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      ended = true;
    }
    at = dataEnd + 4;
  }
  if (!seenHeader) throw new PngError("the picture has no header");
  if (!ended) throw new PngError("the picture is cut off");
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new PngError(`an unknown colour type (${colorType})`);
  const okDepth = colorType === 3 ? [1, 2, 4, 8] : colorType === 0 ? [1, 2, 4, 8, 16] : [8, 16];
  if (!okDepth.includes(depth)) throw new PngError(`a bit depth of ${depth} is not valid for this colour type`);
  if (!width || !height) throw new PngError("the picture has no size");
  if (width * height > (o.maxPixels ?? PNG_MAX_PIXELS)) throw new PngError("the picture is too big");
  if (colorType === 3 && !palette) throw new PngError("a palette picture with no palette");

  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const stride = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const expected = (rowBytes + 1) * height;
  let raw: Uint8Array;
  try {
    const whole = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
    let w = 0;
    for (const p of idat) { whole.set(p, w); w += p.length; }
    raw = inflateSync(whole, { maxOutputLength: expected + 16 });
  } catch {
    throw new PngError("the picture's data could not be read");
  }
  if (raw.length < expected) throw new PngError("the picture's data is short");

  // Undo the row filters, in place.
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(rowBytes);
  const cur = new Uint8Array(rowBytes);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const base = y * (rowBytes + 1);
    const filter = raw[base]!;
    if (filter > 4) throw new PngError(`an unknown row filter (${filter})`);
    for (let i = 0; i < rowBytes; i += 1) {
      const x = raw[base + 1 + i]!;
      const a = i >= stride ? cur[i - stride]! : 0;
      const b = prev[i]!;
      const c = i >= stride ? prev[i - stride]! : 0;
      cur[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    // Samples to RGBA.
    for (let x = 0; x < width; x += 1) {
      const o4 = (y * width + x) * 4;
      let r: number, g: number, b: number, a: number;
      if (depth === 8 || depth === 16) {
        const step = depth === 8 ? 1 : 2;
        const s = (c: number): number => cur[(x * channels + c) * step]!;
        if (colorType === 6) { r = s(0); g = s(1); b = s(2); a = s(3); }
        else if (colorType === 2) { r = s(0); g = s(1); b = s(2); a = 255; }
        else if (colorType === 4) { r = g = b = s(0); a = s(1); }
        else if (colorType === 0) { r = g = b = s(0); a = 255; }
        else { const idx = s(0); r = palette![idx * 3] ?? 0; g = palette![idx * 3 + 1] ?? 0; b = palette![idx * 3 + 2] ?? 0; a = trns?.[idx] ?? 255; }
      } else {
        const bit = x * depth;
        const v = (cur[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        if (colorType === 0) { r = g = b = Math.round((v * 255) / ((1 << depth) - 1)); a = 255; }
        else { r = palette![v * 3] ?? 0; g = palette![v * 3 + 1] ?? 0; b = palette![v * 3 + 2] ?? 0; a = trns?.[v] ?? 255; }
      }
      out[o4] = r; out[o4 + 1] = g; out[o4 + 2] = b; out[o4 + 3] = a;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

// -------------------------------------------------------------------- writer

/** A PNG of a raster: RGBA (or RGB, dropping alpha), 8 bits, every row filtered with `filter` (0 to 4, or "mixed": a different one each row). For tests and fixtures. */
export function encodePng(r: Raster, o: { rgb?: boolean; filter?: 0 | 1 | 2 | 3 | 4 | "mixed" } = {}): Uint8Array {
  const channels = o.rgb ? 3 : 4;
  const rowBytes = r.width * channels;
  const rows: Uint8Array[] = [];
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let prev = new Uint8Array(rowBytes);
  for (let y = 0; y < r.height; y += 1) {
    const line = new Uint8Array(rowBytes);
    for (let x = 0; x < r.width; x += 1) for (let c = 0; c < channels; c += 1) line[x * channels + c] = r.data[(y * r.width + x) * 4 + c]!;
    const filter = o.filter === "mixed" ? y % 5 : o.filter ?? 0;
    const f = new Uint8Array(rowBytes + 1);
    f[0] = filter;
    for (let i = 0; i < rowBytes; i += 1) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      const x = line[i]!;
      f[i + 1] = (filter === 0 ? x : filter === 1 ? x - a : filter === 2 ? x - b : filter === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c)) & 255;
    }
    rows.push(f);
    prev = line;
  }
  const raw = new Uint8Array(rows.length * (rowBytes + 1));
  rows.forEach((f, i) => raw.set(f, i * (rowBytes + 1)));
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.width);
  dv.setUint32(4, r.height);
  ihdr[8] = 8;
  ihdr[9] = o.rgb ? 2 : 6;
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}

/** A solid-colour raster. */
export function solid(width: number, height: number, [r, g, b, a = 255]: [number, number, number, number?]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a; }
  return { width, height, data };
}

/** Paints a rectangle on a raster, in place. */
export function fillRect(r: Raster, x: number, y: number, w: number, h: number, [cr, cg, cb, ca = 255]: [number, number, number, number?]): void {
  for (let yy = Math.max(0, y); yy < Math.min(r.height, y + h); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(r.width, x + w); xx += 1) {
      const o = (yy * r.width + xx) * 4;
      r.data[o] = cr; r.data[o + 1] = cg; r.data[o + 2] = cb; r.data[o + 3] = ca;
    }
  }
}

// ------------------------------------------------------------------ the gate

export const GRID_COLS = 64;
export const GRID_ROWS = 128;
/** A cell differs by at least this (of lightness, 0 to 1) to count as changed: ten points of L*. */
export const CELL_CHANGED = 0.1;
export const SAME_MAX = 0.1;
const SAME_FEW_CELLS = 2;
const SAME_MEAN = 0.004;
/** Shapes (height over width) that differ by more than this are not the same picture. */
const SHAPE_TOLERANCE = 0.04;

export const COLOR_COLS = 16;
export const COLOR_ROWS = 32;
/** A coarse cell whose colour is further than this from the other picture's is a different colour. */
export const COLOR_SAME = 0.12;
const COLOR_CHANGED = 0.08;

export interface Grid {
  cols: number;
  rows: number;
  /** Lightness L* / 100 of each cell, row by row. */
  cells: Float32Array;
  /** The colour of the coarse grid (COLOR_COLS x COLOR_ROWS): a* and b* of each cell, / 100, interleaved. */
  color: Float32Array;
  /** The picture's height over its width, for telling shapes apart. */
  shape: number;
}

const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const lightness = (y: number): number => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 100;

/** CIELAB a* and b* (/ 100) of a colour given in linear light. */
function chromaOf(r: number, g: number, b: number): [number, number] {
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [(500 * (x - y)) / 100, (200 * (y - z)) / 100];
}

/** The picture as a grid of lightness, and a coarse grid of colour: the pixels of a cell averaged in linear light. */
export function toGrid(r: Raster, cols = GRID_COLS, rows = GRID_ROWS): Grid {
  const sum = new Float64Array(cols * rows);
  const count = new Uint32Array(cols * rows);
  const cc = Math.min(cols, COLOR_COLS);
  const cr = Math.min(rows, COLOR_ROWS);
  const csum = new Float64Array(cc * cr * 3);
  const ccount = new Uint32Array(cc * cr);
  for (let y = 0; y < r.height; y += 1) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / r.height));
    const ky = Math.min(cr - 1, Math.floor((y * cr) / r.height));
    for (let x = 0; x < r.width; x += 1) {
      const cx = Math.min(cols - 1, Math.floor((x * cols) / r.width));
      const kx = Math.min(cc - 1, Math.floor((x * cc) / r.width));
      const o = (y * r.width + x) * 4;
      const a = r.data[o + 3]! / 255;
      // Over white: a transparent pixel is white.
      const lr = SRGB_TO_LINEAR[r.data[o]!]! * a + (1 - a);
      const lg = SRGB_TO_LINEAR[r.data[o + 1]!]! * a + (1 - a);
      const lb = SRGB_TO_LINEAR[r.data[o + 2]!]! * a + (1 - a);
      const i = cy * cols + cx;
      sum[i]! += 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      count[i]! += 1;
      const k = ky * cc + kx;
      csum[k * 3]! += lr; csum[k * 3 + 1]! += lg; csum[k * 3 + 2]! += lb;
      ccount[k]! += 1;
    }
  }
  const at = (px: number, py: number): [number, number, number] => {
    const o = (Math.min(r.height - 1, py) * r.width + Math.min(r.width - 1, px)) * 4;
    const a = r.data[o + 3]! / 255;
    return [SRGB_TO_LINEAR[r.data[o]!]! * a + 1 - a, SRGB_TO_LINEAR[r.data[o + 1]!]! * a + 1 - a, SRGB_TO_LINEAR[r.data[o + 2]!]! * a + 1 - a];
  };
  const cells = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const i = cy * cols + cx;
      if (count[i]) { cells[i] = lightness(sum[i]! / count[i]!); continue; }
      // A picture smaller than the grid leaves cells empty: they take the pixel under them.
      const [pr, pg, pb] = at(Math.floor(((cx + 0.5) * r.width) / cols), Math.floor(((cy + 0.5) * r.height) / rows));
      cells[i] = lightness(0.2126 * pr + 0.7152 * pg + 0.0722 * pb);
    }
  }
  const blurred = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      let t = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const yy = cy + dy;
          const xx = cx + dx;
          if (yy < 0 || yy >= rows || xx < 0 || xx >= cols) continue;
          t += cells[yy * cols + xx]!;
          n += 1;
        }
      }
      blurred[cy * cols + cx] = t / n;
    }
  }
  const color = new Float32Array(cc * cr * 2);
  for (let ky = 0; ky < cr; ky += 1) {
    for (let kx = 0; kx < cc; kx += 1) {
      const k = ky * cc + kx;
      const [lr, lg, lb] = ccount[k] ? [csum[k * 3]! / ccount[k]!, csum[k * 3 + 1]! / ccount[k]!, csum[k * 3 + 2]! / ccount[k]!] : at(Math.floor(((kx + 0.5) * r.width) / cc), Math.floor(((ky + 0.5) * r.height) / cr));
      const [ca, cb] = chromaOf(lr, lg, lb);
      color[k * 2] = ca;
      color[k * 2 + 1] = cb;
    }
  }
  return { cols, rows, cells: blurred, color, shape: r.height / r.width };
}

export interface GridDiff {
  /** The average |difference| over the cells, 0 to 1. */
  mean: number;
  /** The biggest |difference| of one cell. */
  max: number;
  /** The share of cells that differ by more than CELL_CHANGED. */
  changed: number;
  changedCells: number;
  /** The biggest colour distance of a coarse cell, 0 to about 1. */
  colorMax: number;
  /** The pictures have the same shape (height over width, within 4%). */
  sameShape: boolean;
  /** One number: min(1, 2 mean + changed + colour changed / 2 + 0.25 for another shape). 0 is the same picture. */
  difference: number;
  /** Nothing a person would see differs: the model need not be asked. */
  same: boolean;
}

export function diffGrids(a: Grid, b: Grid): GridDiff {
  if (a.cols !== b.cols || a.rows !== b.rows || a.color.length !== b.color.length) throw new PngError("the grids are not the same size");
  let total = 0;
  let max = 0;
  let changedCells = 0;
  for (let y = 0; y < a.rows; y += 1) {
    for (let x = 0; x < a.cols; x += 1) {
      const d = Math.abs(a.cells[y * a.cols + x]! - b.cells[y * a.cols + x]!);
      total += d;
      if (d > max) max = d;
      if (d > CELL_CHANGED) changedCells += 1;
    }
  }
  const n = a.cols * a.rows;
  const mean = total / n;
  const changed = changedCells / n;
  let colorMax = 0;
  let colorChanged = 0;
  const kn = a.color.length / 2;
  for (let k = 0; k < kn; k += 1) {
    const d = Math.hypot(a.color[k * 2]! - b.color[k * 2]!, a.color[k * 2 + 1]! - b.color[k * 2 + 1]!);
    if (d > colorMax) colorMax = d;
    if (d > COLOR_CHANGED) colorChanged += 1;
  }
  const sameShape = Math.abs(a.shape - b.shape) <= SHAPE_TOLERANCE * Math.max(a.shape, b.shape);
  const difference = Math.min(1, 2 * mean + changed + (colorChanged / kn) / 2 + (sameShape ? 0 : 0.25));
  const same = sameShape && colorMax <= COLOR_SAME && (max <= SAME_MAX || (changedCells <= SAME_FEW_CELLS && mean < SAME_MEAN));
  return { mean, max, changed, changedCells, colorMax, sameShape, difference, same };
}

/** The gate on two PNGs: how much they differ, and whether the model need not be asked. */
export function gate(a: Uint8Array, b: Uint8Array): GridDiff {
  return diffGrids(toGrid(decodePng(a)), toGrid(decodePng(b)));
}
