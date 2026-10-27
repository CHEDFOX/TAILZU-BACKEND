/** A just-enough source map reader: given a position in generated code, the position in the source it came from. */

export interface SourceMapLike {
  mappings: string;
}

/** Positions are 1-based lines and 1-based columns on both sides. */
export type Lookup = (line: number, col: number) => { line: number; col: number } | undefined;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const m = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

/** Segments of each generated line: [generatedCol, sourceLine, sourceCol] (all 0-based), ascending by generatedCol. */
export function decodeMappings(mappings: string): number[][][] {
  const lines: number[][][] = [];
  let line: number[][] = [];
  let srcLine = 0;
  let srcCol = 0;
  let genCol = 0;
  let i = 0;
  const n = mappings.length;
  const readField = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const c = mappings.charCodeAt(i++);
      const digit = c < 128 ? B64_INDEX[c]! : -1;
      if (digit < 0) return result; // malformed: stop reading rather than loop
      result += (digit & 31) * 2 ** shift;
      shift += 5;
      if ((digit & 32) === 0) break;
    }
    return result % 2 === 1 ? -(result - 1) / 2 : result / 2;
  };
  while (i < n) {
    const c = mappings[i]!;
    if (c === ";") {
      lines.push(line);
      line = [];
      genCol = 0;
      i++;
      continue;
    }
    if (c === ",") {
      i++;
      continue;
    }
    genCol += readField();
    const next = mappings[i];
    if (next === undefined || next === "," || next === ";") {
      continue; // a segment with only a generated column maps nowhere
    }
    readField(); // source index: there is only one source
    srcLine += readField();
    srcCol += readField();
    const after = mappings[i];
    if (after !== undefined && after !== "," && after !== ";") readField(); // name index
    line.push([genCol, srcLine, srcCol]);
  }
  lines.push(line);
  return lines;
}

export function makeLookup(map: SourceMapLike | undefined): Lookup {
  if (!map || typeof map.mappings !== "string") return () => undefined;
  const decoded = decodeMappings(map.mappings);
  return (line, col) => {
    const segs = decoded[line - 1];
    if (!segs || segs.length === 0) return undefined;
    const g = col - 1;
    let lo = 0;
    let hi = segs.length - 1;
    if (segs[0]![0]! > g) return undefined;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid]![0]! <= g) lo = mid;
      else hi = mid - 1;
    }
    const seg = segs[lo]!;
    return { line: seg[1]! + 1, col: seg[2]! + 1 + Math.max(0, g - seg[0]!) };
  };
}
