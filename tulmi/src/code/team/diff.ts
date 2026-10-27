/**
 * A DIFF A REVIEWER CAN READ: WHAT ONE PART CHANGED, FROM THE TEXT OF EACH FILE BEFORE AND AFTER.
 *
 * The reviewer (review.ts) is shown the part's diff against its goal. GitHub's compare API gives a patch per file, but it is capped, reads whole
 * branches and cannot be run offline, so the diff is made here from the two texts the lead already reads (the part's base commit and its head):
 * a line diff with a few lines of context, a hunk header, `+` and `-`. A file that is new is shown as added, one that is gone as deleted. The whole is cut
 * to a number of characters, and says what it left out. Pure.
 */
export interface FileChange { path: string; before: string | null; after: string | null }

const CONTEXT = 3;
/** Above this many cells the exact diff is not made: the lines that differ between the common start and the common end are shown as one block. */
const CELLS_MAX = 2_500_000;

type Op = { t: " " | "-" | "+"; line: string };

function ops(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const head = a.slice(0, start).map((line): Op => ({ t: " ", line }));
  const tail = a.slice(endA).map((line): Op => ({ t: " ", line }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length * y.length > CELLS_MAX) return [...head, ...x.map((line): Op => ({ t: "-", line })), ...y.map((line): Op => ({ t: "+", line })), ...tail];
  // Longest common subsequence of the middle.
  const w = y.length + 1;
  const dp = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const mid: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { mid.push({ t: " ", line: x[i]! }); i += 1; j += 1; }
    else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) { mid.push({ t: "-", line: x[i]! }); i += 1; }
    else { mid.push({ t: "+", line: y[j]! }); j += 1; }
  }
  while (i < x.length) mid.push({ t: "-", line: x[i++]! });
  while (j < y.length) mid.push({ t: "+", line: y[j++]! });
  return [...head, ...mid, ...tail];
}

/** One file's change as unified-diff text with hunk headers; "" when the texts are the same. */
export function fileDiff(c: FileChange): string {
  if (c.before === c.after) return "";
  const head = `--- ${c.before === null ? "/dev/null" : `a/${c.path}`}\n+++ ${c.after === null ? "/dev/null" : `b/${c.path}`}`;
  const lines = (t: string | null): string[] => (t === null || t === "" ? [] : t.replace(/\n$/, "").split("\n"));
  const all = ops(lines(c.before), lines(c.after));
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((o, n) => {
    if (o.t === " ") return;
    for (let k = Math.max(0, n - CONTEXT); k <= Math.min(all.length - 1, n + CONTEXT); k += 1) keep[k] = true;
  });
  const out: string[] = [head];
  let oldNo = 1;
  let newNo = 1;
  let n = 0;
  while (n < all.length) {
    if (!keep[n]) { if (all[n]!.t !== "+") oldNo += 1; if (all[n]!.t !== "-") newNo += 1; n += 1; continue; }
    const o0 = oldNo;
    const n0 = newNo;
    const body: string[] = [];
    let oc = 0;
    let nc = 0;
    while (n < all.length && keep[n]) {
      const o = all[n]!;
      body.push(`${o.t}${o.line.slice(0, 300)}`);
      if (o.t !== "+") { oc += 1; oldNo += 1; }
      if (o.t !== "-") { nc += 1; newNo += 1; }
      n += 1;
    }
    out.push(`@@ -${oc === 0 ? o0 - 1 : o0},${oc} +${nc === 0 ? n0 - 1 : n0},${nc} @@`, ...body);
  }
  return out.join("\n");
}

/**
 * The part's whole diff, file by file in path order, cut to `max` characters. A file that does not fit is named with the size of its change instead of
 * being half shown; `omitted` says how many.
 */
export function partDiff(changes: readonly FileChange[], max: number): { text: string; files: number; omitted: number } {
  const sorted = [...changes].sort((a, b) => (a.path < b.path ? -1 : 1));
  const out: string[] = [];
  let size = 0;
  let omitted = 0;
  let files = 0;
  for (const c of sorted) {
    const d = fileDiff(c);
    if (!d) continue;
    files += 1;
    if (size + d.length > max) {
      omitted += 1;
      const plus = d.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      const minus = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
      out.push(`(${c.path}: +${plus} -${minus}, not shown: the diff is too long)`);
      continue;
    }
    size += d.length + 1;
    out.push(d);
  }
  return { text: out.join("\n"), files, omitted };
}

/** The diff as a short line for the work log. */
export const diffLine = (d: { files: number; omitted: number }): string => `${d.files} file${d.files === 1 ? "" : "s"} changed${d.omitted ? `, ${d.omitted} too long to show` : ""}`;
