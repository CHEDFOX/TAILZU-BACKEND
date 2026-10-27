/** Offsets, lines and columns in a source text. Lines and columns are 1-based; a column counts UTF-16 code units. */

export function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 10) starts.push(i + 1);
    else if (c === 13) {
      if (src.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

export function lineColAt(starts: readonly number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo]! + 1 };
}

export function offsetAt(starts: readonly number[], line: number, col: number, length: number): number {
  const l = Math.min(Math.max(line, 1), starts.length) - 1;
  return Math.min(starts[l]! + Math.max(col, 1) - 1, length);
}

/** Text inserted into a source at original offsets (ascending), so a position in the edited text can be mapped back. */
export interface Insert {
  at: number;
  len: number;
}

/** A position in the text after the inserts → the position in the original text. A position inside an insert maps to where it was made. */
export function toOriginalOffset(inserts: readonly Insert[], edited: number): number {
  let shift = 0;
  for (const ins of inserts) {
    const start = ins.at + shift;
    if (edited < start) break;
    if (edited < start + ins.len) return ins.at;
    shift += ins.len;
  }
  return edited - shift;
}

/** Splice the inserts' texts into the source. */
export function applyInserts(src: string, inserts: readonly (Insert & { text: string })[]): string {
  if (inserts.length === 0) return src;
  let out = "";
  let last = 0;
  for (const ins of inserts) {
    out += src.slice(last, ins.at) + ins.text;
    last = ins.at;
  }
  return out + src.slice(last);
}

export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
