/**
 * A QR CODE FOR A LINK (bots.approve in the window: "Scan with your phone's camera", a UPI payment the person pays on their phone).
 *
 *   qrOf(text) -> { size, modules }     the symbol, without its quiet zone: modules[y][x] true is dark
 *   qrPath(qr, quiet) -> string         one SVG path of the dark modules, in a viewBox of size + 2 * quiet
 *
 * ISO/IEC 18004 in byte mode at error correction level M, versions 1 to 10 (up to 213 bytes: a UPI link is about 120), the mask
 * with the lowest penalty. Small and dependency-free; tests/bots-shell.test.ts checks it against the standard's own sample.
 */

/** Level M: per version, the error-correction codewords per block, and the blocks as [count, data codewords]. */
const M: Array<{ ec: number; blocks: Array<[number, number]> }> = [
  { ec: 10, blocks: [[1, 16]] }, { ec: 16, blocks: [[1, 28]] }, { ec: 26, blocks: [[1, 44]] }, { ec: 18, blocks: [[2, 32]] },
  { ec: 24, blocks: [[2, 43]] }, { ec: 16, blocks: [[4, 27]] }, { ec: 18, blocks: [[4, 31]] }, { ec: 22, blocks: [[2, 38], [2, 39]] },
  { ec: 22, blocks: [[3, 36], [2, 37]] }, { ec: 26, blocks: [[4, 43], [1, 44]] },
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

export interface Qr { version: number; mask: number; size: number; modules: boolean[][] }

// ------------------------------------------------------------------ Reed-Solomon over GF(256), x^8 + x^4 + x^3 + x^2 + 1

const EXP = new Array<number>(512);
const LOG = new Array<number>(256).fill(0);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0);

function ecOf(data: number[], n: number): number[] {
  // The generator (x - a^0)(x - a^1)...(x - a^(n-1)), highest power first, without its leading 1.
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= mul(g, EXP[i]!); });
    gen = next;
  }
  const rem = new Array<number>(n).fill(0);
  for (const d of data) {
    const f = d ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i + 1]!, f);
  }
  return rem;
}

// ------------------------------------------------------------------ the symbol

function codewords(bytes: number[], version: number): number[] {
  const spec = M[version - 1]!;
  const dataLen = spec.blocks.reduce((n, [c, d]) => n + c * d, 0);
  const bits: number[] = [];
  const put = (v: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks: number[][] = [];
  let at = 0;
  for (const [count, len] of spec.blocks) for (let i = 0; i < count; i++) { blocks.push(data.slice(at, at + len)); at += len; }
  const ecs = blocks.map((b) => ecOf(b, spec.ec));
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < spec.ec; i++) for (const e of ecs) out.push(e[i]!);
  return out;
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(words: number[], version: number, mask: number): boolean[][] {
  const size = 17 + 4 * version;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { mod[y]![x] = dark; fn[y]![x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[version - 1]!;
  for (const ay of al) for (const ax of al) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Format (level M = 00, then the mask), BCH(15,5), masked with 0x5412.
  const fdata = mask;
  let rem = fdata;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fbits = ((fdata << 10) | rem) ^ 0x5412;
  const bit = (v: number, i: number) => ((v >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(fbits, i));
  set(8, 7, bit(fbits, 6)); set(8, 8, bit(fbits, 7)); set(7, 8, bit(fbits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(fbits, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(fbits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(fbits, i));
  set(8, size - 8, true);
  if (version >= 7) {
    let r = version;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const vbits = (version << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit(vbits, i)); set(b, a, bit(vbits, i));
    }
  }
  // The data, two columns at a time from the right, up then down, skipping the timing column.
  const total = words.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - v : v;
        if (fn[y]![x]) continue;
        if (i < total) { mod[y]![x] = bit(words[i >>> 3]!, 7 - (i & 7)); i++; }
        if (MASKS[mask]!(x, y)) mod[y]![x] = !mod[y]![x];
      }
    }
  }
  return mod;
}

/** How hard a symbol is to read (the standard's four rules, the finder-like rule as runs of 1:1:3:1:1 with light around). */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) p += 3 + (run - 5);
      run = 1;
    }
    for (let i = 0; i + 6 < n; i++) {
      const s = [0, 1, 2, 3, 4, 5, 6].map((k) => get(i + k));
      if (s[0] && !s[1] && s[2] && s[3] && s[4] && !s[5] && s[6]) {
        const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !get(i - k));
        const lightAfter = [7, 8, 9, 10].every((k) => i + k >= n || !get(i + k));
        if (lightBefore || lightAfter) p += 40;
      }
    }
  };
  for (let y = 0; y < n; y++) line((x) => m[y]![x]!);
  for (let x = 0; x < n; x++) line((y) => m[y]![x]!);
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y]![x]) dark++;
    if (x + 1 < n && y + 1 < n && m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) p += 3;
  }
  p += Math.max(0, Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
  return p;
}

/** The smallest version that holds `text` (UTF-8 bytes); null when it is longer than version 10 holds. `mask` forces one (tests). */
export function qrOf(text: string, o: { mask?: number; version?: number } = {}): Qr | null {
  const bytes = [...Buffer.from(text, "utf8")];
  let version = 0;
  for (let v = o.version ?? 1; v <= 10; v++) {
    const cap = M[v - 1]!.blocks.reduce((n, [c, d]) => n + c * d, 0) * 8 - 4 - (v <= 9 ? 8 : 16);
    if (bytes.length * 8 <= cap) { version = v; break; }
  }
  if (!version) return null;
  const words = codewords(bytes, version);
  let best: { mask: number; modules: boolean[][]; p: number } | null = null;
  for (const mask of o.mask !== undefined ? [o.mask] : [0, 1, 2, 3, 4, 5, 6, 7]) {
    const modules = build(words, version, mask);
    const p = o.mask !== undefined ? 0 : penalty(modules);
    if (!best || p < best.p) best = { mask, modules, p };
  }
  return { version, mask: best!.mask, size: 17 + 4 * version, modules: best!.modules };
}

/** The dark modules as one SVG path (runs along each row), offset by the quiet zone. */
export function qrPath(q: Qr, quiet = 4): string {
  let d = "";
  q.modules.forEach((rowOf, y) => {
    for (let x = 0; x < q.size; x++) {
      if (!rowOf[x]) continue;
      let len = 1;
      while (x + len < q.size && rowOf[x + len]) len++;
      d += `M${x + quiet} ${y + quiet}h${len}v1h-${len}z`;
      x += len - 1;
    }
  });
  return d;
}
