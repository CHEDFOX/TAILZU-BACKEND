/**
 * THE SMALL TOOLS EVERY SYMBOL READER SHARES, WHETHER IT READS BY REGEX (symbols.ts) OR WITH A PARSER (treesitter/extract.ts).
 *
 * Blanking comments (so a function mentioned in a comment is not a function), turning an index into a line, collecting symbols once
 * each, and keeping at most SYMBOLS_PER_FILE of them with routes and exports first. Kept apart so that the two readers can use them
 * without importing each other.
 */
import { SYMBOLS_PER_FILE, type SymbolInfo } from "./types.js";

// ------------------------------------------------------------- blanking

export interface BlankOptions {
  /** `//` and `/* *​/` comments. */
  slash: boolean;
  /** `#` comments. */
  hash: boolean;
  /** Triple-quoted strings (Python docstrings): blanked whole, they are text, not code. */
  triple: boolean;
  /** `...` template literals span lines. */
  backtick: boolean;
  /** `'`: a string (JS, Python, Dart) or only a char literal like 'x' (C-like languages, where 'a is a lifetime). */
  apostrophe: "string" | "char";
}

const CHAR_LITERAL = /^'(?:\\.[^']*|[^\\'])'/;

/**
 * The text with its comments replaced by spaces (newlines kept, so line numbers
 * stay true). Strings are walked so `"http://x"` is not a comment.
 */
export function blankComments(text: string, o: BlankOptions): string {
  const out: string[] = [];
  const n = text.length;
  let i = 0;
  let seg = 0;
  const blank = (from: number, to: number) => {
    if (from > seg) out.push(text.slice(seg, from));
    out.push(text.slice(from, to).replace(/[^\n]/g, " "));
    seg = to;
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34 || c === 39 || (o.backtick && c === 96)) {
      if (o.triple && (c === 34 || c === 39) && text.charCodeAt(i + 1) === c && text.charCodeAt(i + 2) === c) {
        const q = text.slice(i, i + 3);
        const end = text.indexOf(q, i + 3);
        const to = end < 0 ? n : end + 3;
        blank(i, to);
        i = to;
        continue;
      }
      if (c === 39 && o.apostrophe === "char") {
        const m = CHAR_LITERAL.exec(text.slice(i, i + 12));
        i += m ? m[0].length : 1;
        continue;
      }
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 92) { j += 2; continue; }
        if (d === c) { j += 1; break; }
        if (d === 10 && c !== 96) break;
        j += 1;
      }
      i = j;
      continue;
    }
    if (o.slash && c === 47) {
      const d = text.charCodeAt(i + 1);
      if (d === 47) {
        let end = text.indexOf("\n", i);
        if (end < 0) end = n;
        blank(i, end);
        i = end;
        continue;
      }
      if (d === 42) {
        const end = text.indexOf("*/", i + 2);
        const to = end < 0 ? n : end + 2;
        blank(i, to);
        i = to;
        continue;
      }
    }
    if (o.hash && c === 35) {
      let end = text.indexOf("\n", i);
      if (end < 0) end = n;
      blank(i, end);
      i = end;
      continue;
    }
    i += 1;
  }
  if (seg < n) out.push(text.slice(seg));
  return out.join("");
}

export const C_LIKE: BlankOptions = { slash: true, hash: false, triple: false, backtick: false, apostrophe: "char" };
export const JS_LIKE: BlankOptions = { slash: true, hash: false, triple: false, backtick: true, apostrophe: "string" };
export const PY_LIKE: BlankOptions = { slash: false, hash: true, triple: true, backtick: false, apostrophe: "string" };
export const HASH_LIKE: BlankOptions = { slash: false, hash: true, triple: false, backtick: false, apostrophe: "string" };
export const DART_LIKE: BlankOptions = { slash: true, hash: false, triple: true, backtick: false, apostrophe: "string" };

// ---------------------------------------------------------------- helpers

/** Line start offsets, for turning an index in the text into a line number. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}
export function lineAt(starts: number[], index: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

export const VERBS = "get|post|put|patch|delete|options|head|all";

/** Collects symbols, one per (name, kind, line). */
export class Out {
  readonly items: SymbolInfo[] = [];
  private seen = new Set<string>();
  add(s: SymbolInfo): void {
    const key = `${s.kind}|${s.name}|${s.line}|${s.method ?? ""}|${s.path ?? ""}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push(s);
  }
  /** Marks an earlier symbol of that name as exported. Returns whether there was one. */
  exportNamed(name: string): boolean {
    let found = false;
    for (const s of this.items) if (s.name === name && s.kind !== "route" && s.kind !== "env") { s.exported = true; found = true; }
    return found;
  }
}

/** At most SYMBOLS_PER_FILE: routes first, then exported, then the rest; line order within. */
export function capped(items: SymbolInfo[]): SymbolInfo[] {
  if (items.length <= SYMBOLS_PER_FILE) return items.sort((a, b) => a.line - b.line);
  const weight = (s: SymbolInfo) => (s.kind === "route" || s.kind === "entry" ? 0 : s.exported ? 1 : s.kind === "env" ? 3 : 2);
  const keep = items.map((s, i) => ({ s, i })).sort((a, b) => weight(a.s) - weight(b.s) || a.i - b.i).slice(0, SYMBOLS_PER_FILE);
  return keep.map((k) => k.s).sort((a, b) => a.line - b.line);
}

export const upper = (s: string) => /^[A-Z]/.test(s);

/** Environment variables a file reads, by regex over the code, first use of each. */
export function envNames(code: string, patterns: RegExp[], out: Out, starts: number[]): void {
  const seen = new Set<string>();
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const name = m[1]!;
      if (seen.has(name) || seen.size >= 40) continue;
      seen.add(name);
      out.add({ name, kind: "env", line: lineAt(starts, m.index ?? 0) });
    }
  }
}


// ----------------------------------------------------------------- environment

/** The patterns for the environment variables a file reads, by language family. Shared with the parser path (treesitter/extract.ts), which reads these by regex too. */
export const ENV = {
  js: [
    /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /\bprocess\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g,
    /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /\b(?:Bun|Deno)\.env\.(?:get\(\s*['"`])?([A-Za-z_][A-Za-z0-9_]*)/g,
  ],
  py: [
    /\bos\.environ\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, /\bos\.environ\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
    /\bos\.getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  ],
  go: [/\bos\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g],
  rust: [/\b(?:std::)?env::var(?:_os)?\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g, /\b(?:option_)?env!\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g],
  java: [/\bSystem\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g],
  dart: [
    /\bString\.fromEnvironment\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, /\bPlatform\.environment\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
    /\bdotenv\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  ],
  ruby: [/\bENV\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, /\bENV\.fetch\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g],
  php: [/\bgetenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, /\benv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, /\$_(?:ENV|SERVER)\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g],
  swift: [/\benvironment\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]/g],
  csharp: [/\bEnvironment\.GetEnvironmentVariable\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g],
} as const satisfies Record<string, RegExp[]>;


/** Receivers of `.get('/x')` that call somebody else's server rather than serve one. */
export const CLIENT_RECEIVERS = /^(?:axios|http|https|\$http|request|got|ky|superagent|client|apiClient|httpClient|fetcher|supertest|agent|cy|page|ctx|context|req|res|window|navigator|history|location|router\.history)$/i;

export interface SymbolContext {
  /** Directories that hold a Next.js app (a package.json depending on `next`); "" is the repo root. */
  nextRoots?: readonly string[];
}


/** A right-hand side that makes a capitalised name a component, not a plain function: memo(...), forwardRef(...), lazy(...), observer, connect... */
export function isComponentRhs(rhs: string): boolean {
  return /^(?:React\.)?(?:memo|forwardRef|lazy)\s*[(<]/.test(rhs) || /^(?:observer|connect|withRouter|styled)\b/.test(rhs);
}

/** Next.js: the route a file is, from where it sits (app/ and pages/). */
export function nextRoutes(path: string, code: string, ctx: SymbolContext, out: Out, starts: number[]): void {
  const roots = ctx.nextRoots;
  if (!roots?.length || !/\.(?:tsx?|jsx?|mdx?)$/.test(path)) return;
  const root = roots.filter((r) => r === "" || path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  if (root === undefined) return;
  const rel = root ? path.slice(root.length + 1) : path;
  const m = /^(?:src\/)?(app|pages)\/(.+)$/.exec(rel);
  if (!m) return;
  const segs = m[2]!.replace(/\.[a-z]+$/, "").split("/");
  const leaf = segs.pop()!;
  const fix = (seg: string) => seg.replace(/^\[\.\.\.(\w+)\]$/, "*$1").replace(/^\[\[\.\.\.(\w+)\]\]$/, "*$1").replace(/^\[(\w+)\]$/, ":$1");
  const dirs = segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@")).map(fix);
  if (m[1] === "app") {
    if (leaf === "page") {
      out.add({ name: `/${dirs.join("/")}`, kind: "route", line: 1, method: "GET", path: `/${dirs.join("/")}` });
    } else if (leaf === "route") {
      const verbs = [...code.matchAll(/\bexport\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)];
      for (const v of verbs) out.add({ name: `/${dirs.join("/")}`, kind: "route", line: lineAt(starts, v.index ?? 0), method: v[1]!, path: `/${dirs.join("/")}` });
    }
    return;
  }
  // pages/: index is the folder itself; _app, _document, _error are not routes.
  if (leaf.startsWith("_")) return;
  const parts = leaf === "index" ? dirs : [...dirs, fix(leaf)];
  const route = `/${parts.join("/")}`;
  const api = parts[0] === "api";
  out.add({ name: route, kind: "route", line: 1, method: api ? "ANY" : "GET", path: route });
}

