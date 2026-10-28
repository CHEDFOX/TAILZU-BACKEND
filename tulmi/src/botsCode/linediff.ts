/**
 * A LINE DIFF FOR THE REVIEW SCREEN (bots.code.review): what changed in a file, as hunks a person reads.
 *
 * GitHub's compare (code/github.ts) names the files and counts the lines but carries no patch, so the review reads the
 * file on the default branch and on the work branch and diffs them here: the longest common subsequence of the lines,
 * then the changed runs with a little context around each. Pure, no I/O. Files are capped (MAX_LINES each side) so
 * a huge file costs nothing: past the cap the file is "too big to show" and only its counts are drawn.
 */

export type LineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  /** The line's number: in the new file for ctx and add, in the old one for del. */
  n: number;
  text: string;
}

export interface Hunk { lines: DiffLine[] }

/** Lines compared at most per side; past it the diff is not drawn. */
export const MAX_LINES = 1500;
/** Unchanged lines kept around each change. */
export const CONTEXT = 2;
/** The longest line kept, so a minified file does not draw a wall. */
const LINE_CHARS = 160;

const split = (s: string): string[] => {
  if (!s) return [];
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

const clip = (t: string): string => (t.length > LINE_CHARS ? `${t.slice(0, LINE_CHARS - 1)}…` : t);

/**
 * The hunks between two texts (old, new). Null when either side is past MAX_LINES. A file that did not change has no
 * hunks; a new file is one hunk of adds; a deleted one, one of dels.
 */
export function diffLines(before: string, after: string, o: { context?: number; maxHunks?: number } = {}): Hunk[] | null {
  const a = split(before), b = split(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;
  const context = o.context ?? CONTEXT;

  // Trim the common head and tail first: most edits are small, so the table below stays small.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const am = a.slice(head, a.length - tail), bm = b.slice(head, b.length - tail);

  // LCS lengths over the middle (a.length * b.length is bounded by the caps; the middle is usually tiny).
  const rows = am.length, cols = bm.length;
  const L: Uint16Array[] = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      L[i]![j] = am[i] === bm[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    }
  }

  // The whole file as a sequence of ctx / del / add, with numbers.
  const seq: DiffLine[] = [];
  for (let k = 0; k < head; k += 1) seq.push({ kind: "ctx", n: k + 1, text: a[k]! });
  let i = 0, j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && am[i] === bm[j]) { seq.push({ kind: "ctx", n: head + j + 1, text: bm[j]! }); i += 1; j += 1; }
    // On a tie the old line goes first, as a reader expects: what was there, then what replaced it.
    else if (i < rows && (j >= cols || L[i + 1]![j]! >= L[i]![j + 1]!)) { seq.push({ kind: "del", n: head + i + 1, text: am[i]! }); i += 1; }
    else { seq.push({ kind: "add", n: head + j + 1, text: bm[j]! }); j += 1; }
  }
  for (let k = 0; k < tail; k += 1) seq.push({ kind: "ctx", n: b.length - tail + k + 1, text: b[b.length - tail + k]! });

  // The changed runs, each with `context` lines either side; runs closer than that join.
  const keep = new Array<boolean>(seq.length).fill(false);
  seq.forEach((l, k) => {
    if (l.kind === "ctx") return;
    for (let x = Math.max(0, k - context); x <= Math.min(seq.length - 1, k + context); x += 1) keep[x] = true;
  });
  const hunks: Hunk[] = [];
  let cur: DiffLine[] | null = null;
  seq.forEach((l, k) => {
    if (keep[k]) { (cur ??= []).push({ ...l, text: clip(l.text) }); return; }
    if (cur) { hunks.push({ lines: cur }); cur = null; }
  });
  if (cur) hunks.push({ lines: cur });
  return o.maxHunks ? hunks.slice(0, o.maxHunks) : hunks;
}

/** The lines a hunk covers in the new file, as a person reads it: "L4–7", "L6". */
export function hunkRange(h: Hunk): string {
  const ns = h.lines.filter((l) => l.kind !== "del").map((l) => l.n);
  if (!ns.length) return "";
  const lo = Math.min(...ns), hi = Math.max(...ns);
  return lo === hi ? `L${lo}` : `L${lo}–${hi}`;
}
