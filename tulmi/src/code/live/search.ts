/**
 * READ, LIST, GLOB AND GREP OVER TEXT: THE PURE PART OF THE ROOM'S TOOLS.
 *
 * The room (jobs/src/jobRoom.ts) keeps a job's files in SQLite and answers the agent from them. What it does to the text is
 * here, with no I/O, so the same code answers in the room, in the agent's fallback over GitHub's API, and in a test:
 *
 *   readLines   numbered lines `12: text`, from an offset, capped by lines, by the length of a line and in all
 *   listDir     the entries directly in a folder: folders first (`src/`), then files
 *   globPaths   a glob over paths, sorted by recent change when that is known
 *   grepFiles   ripgrep's output: `path:line:text`, `path-line-text` for context, `--` between groups
 *
 * GREP AND A PATTERN THAT WOULD NEVER FINISH. A regular expression cannot be interrupted once it is running, in any JavaScript
 * runtime, so safety is made of four things, none of which is a proof:
 *   1. the pattern is short (300 characters) and is READ before it is run: nested repetition `(a+)+`, a repeated group of
 *      alternatives that overlap `(a|aa)+`, a back-reference and a pile of unbounded repeats are refused with a reason;
 *   2. a line is cut to 1,000 characters before it is matched;
 *   3. a per-file and a total TIME budget, checked between lines. (A Workers isolate's clock only moves when the code waits for I/O,
 *      so there it cannot fire during a loop that never waits: see 4);
 *   4. a per-file and a total WORK budget (characters tested), which does not depend on a clock.
 * When any of them cuts the search short the answer says `partial: true` and why.
 */
import {
  GLOB_MAX, GREP_CONTEXT_MAX, GREP_FILE_CHARS, GREP_FILE_MS, GREP_LINE_MATCH_CHARS, GREP_OUT_CHARS, GREP_OUT_MAX, GREP_PATTERN_MAX,
  GREP_RESULTS_DEFAULT, GREP_RESULTS_MAX, GREP_TOTAL_CHARS, GREP_TOTAL_MS, LIST_MAX, READ_CHARS_MAX, READ_LINES_DEFAULT, READ_LINES_MAX, READ_LINE_CHARS,
} from "./limits.js";

// ------------------------------------------------------------------- read

export interface ReadOut {
  /** `12: text` per line. */
  text: string;
  /** First and last line returned (1-based); 0 and 0 when there are none. */
  from: number;
  to: number;
  /** Lines in the file. */
  total: number;
  /** There are more lines after `to` that were not returned. */
  truncated: boolean;
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Lines of a text, numbered, from `offset` (1-based, default 1) for at most `limit` lines (default 2,000), within the limits of limits.ts. */
export function readLines(content: string, offset?: number, limit?: number): ReadOut {
  const lines = content.split("\n");
  // A file that ends in a newline has an empty last piece that is not a line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const total = content === "" ? 0 : lines.length;
  const from = Math.max(1, Math.floor(Number.isFinite(offset) ? offset! : 1));
  const want = Math.min(READ_LINES_MAX, Math.max(1, Math.floor(Number.isFinite(limit) ? limit! : READ_LINES_DEFAULT)));
  if (total === 0 || from > total) return { text: "", from: 0, to: 0, total, truncated: false };
  const out: string[] = [];
  let chars = 0;
  let last = from - 1;
  for (let n = from; n <= total && n < from + want; n += 1) {
    const line = `${n}: ${cut(lines[n - 1]!, READ_LINE_CHARS)}`;
    if (chars + line.length > READ_CHARS_MAX && out.length) break;
    out.push(line);
    chars += line.length + 1;
    last = n;
  }
  return { text: out.join("\n"), from, to: last, total, truncated: last < total };
}

// ------------------------------------------------------------------- glob

/** Characters that mean something in a regular expression. */
const SPECIAL = /[.+^$()|\\{}[\]*?]/g;
const escapeRe = (s: string): string => s.replace(SPECIAL, "\\$&");
export const GLOB_MAX_CHARS = 200;

/**
 * A glob as a regular expression over a repo path (`/` separated, no leading slash). `*` is anything but `/`, `**` anything including
 * `/` (`**` + `/` also matches nothing, so `**` + `/x` matches `x`), `?` one character, `[abc]` / `[!abc]` a class, `{a,b}` either. A pattern
 * with no `/` in it matches the file's NAME at any depth (like ripgrep's `-g`); one with a `/` is read from the root of the repo.
 * Returns null for a pattern that is empty, too long, or not well formed.
 */
export function globToRegExp(pattern: string): RegExp | null {
  let g = pattern.trim().replace(/^\.\//, "");
  if (!g || g.length > GLOB_MAX_CHARS) return null;
  const anchored = g.startsWith("/");
  g = g.replace(/^\/+/, "");
  if (!g) return null;
  const nameOnly = !g.includes("/") && !anchored;
  let re = "";
  let braces = 0;
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i]!;
    if (c === "*") {
      if (g[i + 1] === "*") {
        let j = i + 2;
        while (g[j] === "*") j += 1;
        // "**/" is any number of folders, including none; a trailing "**" is anything below.
        if (g[j] === "/" && (i === 0 || g[i - 1] === "/")) { re += "(?:.*/)?"; i = j; } else { re += ".*"; i = j - 1; }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = g.indexOf("]", i + 2);
      if (end < 0) return null;
      let body = g.slice(i + 1, end);
      const negate = body.startsWith("!") || body.startsWith("^");
      if (negate) body = body.slice(1);
      if (!body) return null;
      re += `[${negate ? "^" : ""}${body.replace(/[\\\]^]/g, "\\$&")}]`;
      i = end;
    } else if (c === "{") { braces += 1; re += "(?:"; }
    else if (c === "}" && braces > 0) { braces -= 1; re += ")"; }
    else if (c === "," && braces > 0) re += "|";
    else re += escapeRe(c);
  }
  if (braces !== 0) return null;
  try {
    return new RegExp(nameOnly ? `(?:^|/)${re}$` : `^${re}$`);
  } catch {
    return null;
  }
}

export interface GlobOut {
  ok: true;
  paths: string[];
  /** All the matches, before the cap. */
  total: number;
  partial: boolean;
}

/**
 * The paths a glob matches, the most recently changed first (`recent`: path to a time, any unit; a path with none comes after those that
 * have one), then by name. At most GLOB_MAX are returned; `total` says how many matched.
 */
export function globPaths(paths: Iterable<string>, pattern: string, recent?: ReadonlyMap<string, number>, max = GLOB_MAX): GlobOut | { ok: false; error: string } {
  const re = globToRegExp(pattern);
  if (!re) return { ok: false, error: "That is not a glob I can read. Use things like src/**/*.ts, *.md, tests/{a,b}/*.js." };
  const hits: string[] = [];
  for (const p of paths) if (re.test(p)) hits.push(p);
  hits.sort((a, b) => (recent?.get(b) ?? 0) - (recent?.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  const cap = Math.max(1, Math.min(GLOB_MAX, Math.floor(max)));
  return { ok: true, paths: hits.slice(0, cap), total: hits.length, partial: hits.length > cap };
}

// ------------------------------------------------------------------- list

export interface ListOut { entries: string[]; total: number; partial: boolean }

/** The entries directly inside `dir` ("" is the root): folders first as `name/`, then files, each in name order. Null when nothing is there. */
export function listDir(paths: Iterable<string>, dir: string): ListOut | null {
  const d = dir.trim().replace(/^\.\/?$/, "").replace(/^\.\//, "").replace(/\/+$/, "");
  const prefix = d ? `${d}/` : "";
  const names = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    names.add(slash < 0 ? rest : `${rest.slice(0, slash)}/`);
  }
  if (!names.size) return null;
  const sorted = [...names].sort((x, y) => (x.endsWith("/") === y.endsWith("/") ? (x < y ? -1 : 1) : x.endsWith("/") ? -1 : 1));
  return { entries: sorted.slice(0, LIST_MAX), total: sorted.length, partial: sorted.length > LIST_MAX };
}

// ------------------------------------------------------------------- grep

/**
 * Why a pattern is not run, or null when it is. A reading of the pattern's shape, not a proof that a pattern is cheap: the budgets in
 * grepFiles are the backstop.
 */
export function patternProblem(pattern: string): string | null {
  if (!pattern) return "The pattern is empty.";
  if (pattern.length > GREP_PATTERN_MAX) return `The pattern is over ${GREP_PATTERN_MAX} characters. Search for a shorter piece of it.`;
  if (/\\[1-9]|\\k</.test(pattern)) return "A back-reference (\\1) can take for ever on a long line, so it is not run. Search for the parts separately.";

  // Walk the pattern once, keeping for each open group whether something inside it repeats, and the text of its alternatives.
  interface Group { repeats: boolean; start: number }
  const stack: Group[] = [];
  let unbounded = 0;
  let inClass = false;
  let lastClosed: Group | null = null;
  const closedText = new Map<Group, string>();
  const quantAt = (i: number): { kind: "none" | "one" | "many" | "open"; len: number } => {
    const c = pattern[i];
    if (c === "*" || c === "+") return { kind: "open", len: 1 };
    if (c === "?") return { kind: "one", len: 1 };
    if (c === "{") {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i, i + 24));
      if (!m) return { kind: "none", len: 0 };
      if (m[2] === undefined) return { kind: Number(m[1]) > 1 ? "many" : "one", len: m[0].length };
      if (m[2] === "") return { kind: "open", len: m[0].length };
      return { kind: Number(m[2]) > 1 ? "many" : "one", len: m[0].length };
    }
    return { kind: "none", len: 0 };
  };
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === "\\") { i += 1; lastClosed = null; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; lastClosed = null; continue; }
    if (c === "(") { stack.push({ repeats: false, start: i }); lastClosed = null; continue; }
    if (c === ")") {
      const g = stack.pop();
      if (g) { closedText.set(g, pattern.slice(g.start + 1, i)); lastClosed = g; } else lastClosed = null;
      continue;
    }
    const q = quantAt(i);
    if (q.kind === "none") { lastClosed = null; continue; }
    if (q.kind === "open" || q.kind === "many") {
      if (q.kind === "open") unbounded += 1;
      if (lastClosed) {
        if (lastClosed.repeats) return "Repetition inside a repeated group (like (a+)+) can take for ever on a long line, so it is not run. Make the inner part fixed, or search for it in two steps.";
        // (a|aa)+ : alternatives where one starts the other, or an empty one, under an unbounded repeat.
        if (q.kind === "open") {
          const alts = splitAlternatives((closedText.get(lastClosed) ?? "").replace(/^\?[:=!<]*/, ""));
          if (alts.length > 1 && alts.some((a, ia) => a === "" || alts.some((b, ib) => ia !== ib && b.startsWith(a)))) {
            return "A repeated group whose alternatives overlap (like (a|aa)+) can take for ever on a long line, so it is not run. Make the alternatives distinct.";
          }
        }
        lastClosed.repeats = true;
      }
      for (const g of stack) g.repeats = true;
      i += q.len - 1;
      lastClosed = null;
      continue;
    }
    i += q.len - 1;
    lastClosed = null;
  }
  if (unbounded > 5) return "That has too many open-ended repeats (* and +) to run safely on long lines. Search for a simpler piece of it.";
  return null;
}

/** The top-level alternatives of a group's body. */
function splitAlternatives(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inClass = false;
  let cur = "";
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]!;
    if (c === "\\") { cur += c + (body[i + 1] ?? ""); i += 1; continue; }
    if (inClass) { cur += c; if (c === "]") inClass = false; continue; }
    if (c === "[") inClass = true;
    else if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "|" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** The pattern as a RegExp (ripgrep's `(?i)` at the start is honoured), or the reason it is not run. */
export function compilePattern(pattern: string, ignoreCase = false): { ok: true; re: RegExp } | { ok: false; error: string } {
  let p = pattern;
  let ci = ignoreCase;
  if (p.startsWith("(?i)")) { ci = true; p = p.slice(4); }
  const problem = patternProblem(p);
  if (problem) return { ok: false, error: problem };
  try {
    return { ok: true, re: new RegExp(p, ci ? "i" : "") };
  } catch (err) {
    return { ok: false, error: `That is not a regular expression JavaScript can read (${cut(String((err as Error)?.message ?? "invalid").replace(/^Invalid regular expression: /, ""), 100)}). Escape characters like ( ) [ ] { } . * + ? with a backslash.` };
  }
}

export interface GrepFile { path: string; content: string }

export interface GrepOptions {
  /** A file, or a folder (everything below it). */
  path?: string;
  /** Only paths this glob matches. */
  glob?: string;
  ignoreCase?: boolean;
  /** Lines of context around a match (0 to 5). */
  context?: number;
  /** Only the paths that have a match. */
  filesOnly?: boolean;
  /** Most matching lines (or files, with filesOnly) returned. */
  maxResults?: number;
}

export interface GrepBudget {
  now: () => number;
  fileMs: number;
  totalMs: number;
  fileChars: number;
  totalChars: number;
}

export interface GrepOk {
  ok: true;
  /** ripgrep-like: `path:line:text`; with context, `path-line-text` and `--` between groups. With filesOnly, one path a line. */
  text: string;
  /** Matching lines (or files, with filesOnly) returned. */
  matches: number;
  /** Files that have a match. */
  files: number;
  /** Files looked at. */
  scanned: number;
  /** The answer is not the whole story: a budget or the cap on results cut the search short. */
  partial: boolean;
  why?: "results" | "time" | "work" | "files";
}
export type GrepOut = GrepOk | { ok: false; error: string };

export function defaultBudget(over: Partial<GrepBudget> = {}): GrepBudget {
  return { now: () => Date.now(), fileMs: GREP_FILE_MS, totalMs: GREP_TOTAL_MS, fileChars: GREP_FILE_CHARS, totalChars: GREP_TOTAL_CHARS, ...over };
}

/** Whether `path` is inside the scope `scope` (a file, or a folder, written with or without a trailing slash). */
export function inScope(path: string, scope: string | undefined): boolean {
  if (!scope) return true;
  const s = scope.trim().replace(/^\.\/?/, "").replace(/\/+$/, "");
  return !s || path === s || path.startsWith(`${s}/`);
}

/** Order paths by name, the order grepFiles expects its files in. */
export const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Searches files for a pattern, line by line, in the order `files` gives them (by path: the caller sorts, or reads them from a database
 * `ORDER BY path`). It is read lazily, so a caller that holds the files in a database can hand over a generator, and a search that is
 * cut short never reads the rest.
 */
export function grepFiles(files: Iterable<GrepFile>, pattern: string, o: GrepOptions = {}, budget: Partial<GrepBudget> = {}): GrepOut {
  const compiled = compilePattern(pattern, o.ignoreCase === true);
  if (!compiled.ok) return compiled;
  const re = compiled.re;
  let globRe: RegExp | null = null;
  if (o.glob) {
    globRe = globToRegExp(o.glob);
    if (!globRe) return { ok: false, error: "That glob is not one I can read. Use things like *.ts or src/**/*.tsx." };
  }
  const b = defaultBudget(budget);
  const max = Math.max(1, Math.min(GREP_RESULTS_MAX, Math.floor(o.maxResults ?? GREP_RESULTS_DEFAULT)));
  const context = Math.max(0, Math.min(GREP_CONTEXT_MAX, Math.floor(o.context ?? 0)));
  const started = b.now();

  const out: string[] = [];
  let outChars = 0;
  let matches = 0;
  let withMatch = 0;
  let scanned = 0;
  let chars = 0;
  let partial = false;
  let why: GrepOk["why"];
  const stop = (reason: NonNullable<GrepOk["why"]>): void => { partial = true; why ??= reason; };
  /** `--` goes between two groups of lines that do not touch, only when there is context to separate. */
  let groups = 0;
  const startGroup = (): void => { if (context > 0 && groups > 0) out.push("--"); groups += 1; };

  for (const f of files) {
    if (!inScope(f.path, o.path) || (globRe && !globRe.test(f.path))) continue;
    if (b.now() - started > b.totalMs) { stop("time"); break; }
    if (chars >= b.totalChars) { stop("work"); break; }
    scanned += 1;
    const lines = f.content.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const fileStart = b.now();
    let fileChars = 0;
    const hits: number[] = [];
    const room = max - matches;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const len = Math.min(line.length, GREP_LINE_MATCH_CHARS);
      fileChars += len;
      chars += len;
      if (fileChars > b.fileChars || chars > b.totalChars) { stop("work"); break; }
      if (i % 200 === 199) {
        const t = b.now();
        if (t - fileStart > b.fileMs || t - started > b.totalMs) { stop("time"); break; }
      }
      if (re.test(len === line.length ? line : line.slice(0, len))) {
        hits.push(i);
        // One more than there is room for says there is more to find.
        if (o.filesOnly || hits.length > room) break;
      }
    }
    if (!hits.length) continue;
    if (room <= 0) { stop("results"); break; }

    if (o.filesOnly) {
      withMatch += 1;
      matches += 1;
      out.push(f.path);
      outChars += f.path.length + 1;
      if (matches >= max) {
        // Exactly `max` files is the whole answer only if no other file matches: the next hit decides (room is 0 then).
        continue;
      }
    } else {
      const shown = hits.slice(0, room);
      const mark = new Set(shown);
      const show = new Set<number>();
      for (const h of shown) for (let k = Math.max(0, h - context); k <= Math.min(lines.length - 1, h + context); k += 1) show.add(k);
      withMatch += 1;
      let prev = -2;
      for (const k of [...show].sort((x, y) => x - y)) {
        if (k > prev + 1) startGroup();
        const sep = mark.has(k) ? ":" : "-";
        const row = `${f.path}${sep}${k + 1}${sep}${cut(lines[k]!, GREP_OUT_CHARS)}`;
        out.push(row);
        outChars += row.length + 1;
        prev = k;
      }
      matches += shown.length;
      if (hits.length > room) { stop("results"); break; }
    }
    if (outChars > GREP_OUT_MAX) { stop("results"); break; }
  }
  return { ok: true, text: out.join("\n"), matches, files: withMatch, scanned, partial, ...(why ? { why } : {}) };
}
