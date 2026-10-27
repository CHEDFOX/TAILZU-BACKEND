/**
 * GLOBS FOR OWNERSHIP: DOES A PATH BELONG TO A PART, AND DO TWO PARTS' GLOBS REACH THE SAME FILE?
 *
 * A part owns the files its `ownedPaths` match. Two things are asked of them, and both must be exact because a mistake is either a helper that
 * cannot do its work or two helpers editing one file:
 *
 *   owns(globs, path)         the guard (guard.ts) and the split's coverage check: the same matcher the agent's own `glob` tool uses (live/search.ts),
 *                             so "src/api/**" means the same thing to the model that wrote it and to the code that holds the model to it
 *   globsOverlap(a, b)        whether SOME path (existing or not yet made) could match both. Decided on the patterns, not on the files that happen to exist,
 *                             because a helper creates files: "src/a/**" and "src/a/new/*.ts" overlap whether or not src/a/new has anything in it yet.
 *                             A character class ([abc]) is read as "any one character", which can only make two globs look closer than they are: it
 *                             refuses a split that was fine, never lets a bad one through
 *
 * A glob with no "/" matches the NAME at any depth ("*.md"), as everywhere else here; a trailing "/" means everything below ("src/api/").
 */
import { globToRegExp } from "../live/search.js";

/** The most globs a part may own, and the longest one. */
export const GLOBS_MAX = 30;
export const GLOB_CHARS = 200;

/** A glob as the split writes it, made exact: "./" and a leading "/" gone, a trailing "/" is "everything below". Null when it is empty, too long, or not one the matcher reads. */
export function normalizeGlob(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let g = raw.trim().replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!g || g.length > GLOB_CHARS || g.includes("\u0000")) return null;
  if (g.endsWith("/")) g = `${g}**`;
  // A bare folder name is not a file: "src/api" would own nothing. The split is told to write "src/api/", and a model that did not is not guessed at.
  if (!globToRegExp(g)) return null;
  return g;
}

/** Whether a path is matched by any of the globs. */
export function owns(globs: readonly string[], path: string): boolean {
  const p = path.replace(/^\.\//, "");
  return globs.some((g) => globToRegExp(g)?.test(p) === true);
}

/** The globs that match every file (or nearly): no part may own the whole repo. */
export function ownsEverything(glob: string): boolean {
  return /^(?:\*{1,2}|\*\*\/\*+|\*\*\/\*\.\*|\*\.\*|\*\*\/\*\*)$/.test(glob.trim());
}

// ----------------------------------------------------------------- overlap

/** `{a,b}` expanded into every alternative (nested braces too); a glob with no braces is itself. */
export function expandBraces(glob: string, limit = 64): string[] {
  const out: string[] = [];
  const walk = (g: string): void => {
    if (out.length >= limit) return;
    let depth = 0;
    let open = -1;
    for (let i = 0; i < g.length; i += 1) {
      const c = g[i]!;
      if (c === "{") { if (depth === 0) open = i; depth += 1; }
      else if (c === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0) {
          const inner = g.slice(open + 1, i);
          const parts: string[] = [];
          let d = 0;
          let from = 0;
          for (let j = 0; j < inner.length; j += 1) {
            if (inner[j] === "{") d += 1;
            else if (inner[j] === "}") d -= 1;
            else if (inner[j] === "," && d === 0) { parts.push(inner.slice(from, j)); from = j + 1; }
          }
          parts.push(inner.slice(from));
          for (const p of parts) walk(g.slice(0, open) + p + g.slice(i + 1));
          return;
        }
      }
    }
    out.push(g);
  };
  walk(glob);
  return out;
}

/** The glob as the matcher reads it: a pattern with no "/" is a name at any depth. */
function anchored(g: string): string {
  const x = g.replace(/^\/+/, "");
  return x.includes("/") || g.startsWith("/") ? x : `**/${x}`;
}

/** One path segment as tokens: a literal character, "?" (any one) or "*" (any run). A class [..] is "?". */
function tokens(seg: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < seg.length; i += 1) {
    const c = seg[i]!;
    if (c === "[") {
      const end = seg.indexOf("]", i + 2);
      if (end > 0) { out.push("?"); i = end; continue; }
    }
    if (c === "*") { if (out.at(-1) !== "*") out.push("*"); } else out.push(c === "?" ? "?" : c);
  }
  return out;
}

/** Whether some string matches both segment patterns. */
function segmentsMeet(a: string, b: string): boolean {
  const P = tokens(a);
  const Q = tokens(b);
  const memo = new Map<number, boolean>();
  const f = (i: number, j: number): boolean => {
    const key = i * (Q.length + 1) + j;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === P.length && j === Q.length) r = true;
    else if (i === P.length) r = Q[j] === "*" && f(i, j + 1);
    else if (j === Q.length) r = P[i] === "*" && f(i + 1, j);
    else if (P[i] === "*" && Q[j] === "*") r = f(i + 1, j) || f(i, j + 1);
    else if (P[i] === "*") r = f(i + 1, j) || f(i, j + 1);
    else if (Q[j] === "*") r = f(i, j + 1) || f(i + 1, j);
    else r = (P[i] === Q[j] || P[i] === "?" || Q[j] === "?") && f(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return f(0, 0);
}

/** Whether some path could match both patterns, segment by segment ("**" is any number of folders, none included). */
function pathsMeet(a: string[], b: string[]): boolean {
  const memo = new Map<number, boolean>();
  const f = (i: number, j: number): boolean => {
    const key = i * (b.length + 1) + j;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === a.length && j === b.length) r = true;
    else if (i === a.length) r = b[j] === "**" && f(i, j + 1);
    else if (j === b.length) r = a[i] === "**" && f(i + 1, j);
    else if (a[i] === "**" && b[j] === "**") r = f(i + 1, j) || f(i, j + 1);
    else if (a[i] === "**") r = f(i + 1, j) || f(i, j + 1);
    else if (b[j] === "**") r = f(i, j + 1) || f(i + 1, j);
    else r = segmentsMeet(a[i]!, b[j]!) && f(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return f(0, 0);
}

/** Whether some path (one that exists, or one a helper has yet to make) is matched by both globs. */
export function globsOverlap(a: string, b: string): boolean {
  for (const x of expandBraces(anchored(a))) {
    for (const y of expandBraces(anchored(b))) {
      if (pathsMeet(x.split("/"), y.split("/"))) return true;
    }
  }
  return false;
}

/** The pairs of parts whose globs reach the same file, with one pair of globs that does. */
export function overlaps(parts: ReadonlyArray<{ id: number; ownedPaths: readonly string[] }>): Array<{ a: number; b: number; globA: string; globB: string }> {
  const out: Array<{ a: number; b: number; globA: string; globB: string }> = [];
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const hit = firstMeeting(parts[i]!.ownedPaths, parts[j]!.ownedPaths);
      if (hit) out.push({ a: parts[i]!.id, b: parts[j]!.id, globA: hit[0], globB: hit[1] });
    }
  }
  return out;
}

function firstMeeting(as: readonly string[], bs: readonly string[]): [string, string] | null {
  for (const x of as) for (const y of bs) if (globsOverlap(x, y)) return [x, y];
  return null;
}
