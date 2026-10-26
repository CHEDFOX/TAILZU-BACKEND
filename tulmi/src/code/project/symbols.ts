/**
 * WHAT A FILE DEFINES AND WHERE: ITS EXPORTED NAMES AND ITS HTTP ROUTES, FROM REGEXES, NO MODEL.
 *
 * No parser is added (no tree-sitter): each language gets a handful of regular
 * expressions over lines of code whose comments have been blanked out first, so
 * a function mentioned in a comment is not a function. They are written for
 * ACCURACY OVER BREADTH: a pattern is in only if it is almost always right, and
 * every one has a fixture in tests/code-project-symbols.test.ts. A thing they
 * miss is a symbol the index lacks, which costs a search; a thing they invent
 * is a wrong place to go, which costs a change.
 *
 *   TS/JS/JSX    export function|class|interface|type|enum|const|default, export
 *                lists, CommonJS exports; components (a capitalised function in
 *                a .tsx/.jsx file, or wrapped in memo/forwardRef); top-level
 *                (column 0) functions and classes that are not exported
 *   Python       def, class, methods as Class.method, UPPER constants; a name
 *                with a leading underscore is not exported
 *   Go           func, methods as Type.Method, type, const, var; an upper-case
 *                name is exported
 *   Rust         pub fn|struct|enum|trait|type|const|static|mod
 *   Java/Kotlin  public classes, interfaces, enums, records, public methods;
 *                Kotlin class, object, fun, const val
 *   Dart         class, mixin, enum, extension, typedef, top-level functions;
 *                a class that extends a Widget is a component
 *   Ruby, PHP, Swift, C#, and a generic fallback for the rest
 *
 * ROUTES, as symbols of kind "route" with a verb and the path as written:
 *   express, fastify, hono, koa-router  app.get('/x', handler) (and .route, and
 *                                       fastify.route({url}); NOT a client's
 *                                       axios.get('/x'), which has no handler)
 *   NestJS                              @Controller('x') with @Get(':id')
 *   Next.js                             app/ and pages/ paths (path-based)
 *   FastAPI, Flask                      @app.get('/x'), @app.route('/x', methods=[..])
 *   Django                              path('x/', view), re_path, url
 *   Rails                               routes.rb get/post/resources/root
 *   Go                                  HandleFunc, Handle, r.GET("/x"), "GET /x"
 *   Rust, Spring, Laravel, ASP.NET, Flutter's GoRoute
 *
 * Also recorded as symbols, because they are what a person asks "where" about:
 * the environment variables a file reads (kind "env") and where a program
 * starts (kind "entry").
 */
import { baseName } from "./lang.js";
import { SYMBOLS_PER_FILE, type SymbolInfo } from "./types.js";

// ------------------------------------------------------------- blanking

interface BlankOptions {
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

const C_LIKE: BlankOptions = { slash: true, hash: false, triple: false, backtick: false, apostrophe: "char" };
const JS_LIKE: BlankOptions = { slash: true, hash: false, triple: false, backtick: true, apostrophe: "string" };
const PY_LIKE: BlankOptions = { slash: false, hash: true, triple: true, backtick: false, apostrophe: "string" };
const HASH_LIKE: BlankOptions = { slash: false, hash: true, triple: false, backtick: false, apostrophe: "string" };
const DART_LIKE: BlankOptions = { slash: true, hash: false, triple: true, backtick: false, apostrophe: "string" };

// ---------------------------------------------------------------- helpers

/** Line start offsets, for turning an index in the text into a line number. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}
function lineAt(starts: number[], index: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

const VERBS = "get|post|put|patch|delete|options|head|all";

/** Collects symbols, one per (name, kind, line). */
class Out {
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
function capped(items: SymbolInfo[]): SymbolInfo[] {
  if (items.length <= SYMBOLS_PER_FILE) return items.sort((a, b) => a.line - b.line);
  const weight = (s: SymbolInfo) => (s.kind === "route" || s.kind === "entry" ? 0 : s.exported ? 1 : s.kind === "env" ? 3 : 2);
  const keep = items.map((s, i) => ({ s, i })).sort((a, b) => weight(a.s) - weight(b.s) || a.i - b.i).slice(0, SYMBOLS_PER_FILE);
  return keep.map((k) => k.s).sort((a, b) => a.line - b.line);
}

const upper = (s: string) => /^[A-Z]/.test(s);

/** Environment variables a file reads, by regex over the code, first use of each. */
function envNames(code: string, patterns: RegExp[], out: Out, starts: number[]): void {
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

// ------------------------------------------------------------- TS / JS

/** Receivers of `.get('/x')` that call somebody else's server rather than serve one. */
const CLIENT_RECEIVERS = /^(?:axios|http|https|\$http|request|got|ky|superagent|client|apiClient|httpClient|fetcher|supertest|agent|cy|page|ctx|context|req|res|window|navigator|history|location|router\.history)$/i;

export interface SymbolContext {
  /** Directories that hold a Next.js app (a package.json depending on `next`); "" is the repo root. */
  nextRoots?: readonly string[];
}

function isComponentRhs(rhs: string): boolean {
  return /^(?:React\.)?(?:memo|forwardRef|lazy)\s*[(<]/.test(rhs) || /^(?:observer|connect|withRouter|styled)\b/.test(rhs);
}
function isFunctionRhs(rhs: string): boolean {
  return /^(?:async\s+)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(rhs) || /^(?:async\s+)?<[^>]*>\s*\(/.test(rhs);
}

function jsSymbols(path: string, text: string, ctx: SymbolContext): SymbolInfo[] {
  const code = blankComments(text, JS_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const jsx = /\.(?:tsx|jsx)$/.test(path) || (/\.(?:js|mjs|cjs)$/.test(path) && /<\/[A-Za-z]|\/>/.test(code));
  const out = new Out();
  const fnKind = (name: string): SymbolInfo["kind"] => (jsx && upper(name) ? "component" : "function");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;

    if ((m = /^\s*export\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/.exec(line))) {
      const name = m[1] ?? "default";
      out.add({ name, kind: m[1] ? fnKind(name) : jsx ? "component" : "function", line: at, exported: true });
    } else if ((m = /^\s*export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line))) {
      out.add({ name: m[1]!, kind: fnKind(m[1]!), line: at, exported: true });
    } else if ((m = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\b\s*([A-Za-z_$][\w$]*)?/.exec(line))) {
      const name = m[1] && m[1] !== "extends" && m[1] !== "implements" ? m[1] : "default";
      out.add({ name, kind: "class", line: at, exported: true });
    } else if ((m = /^\s*export\s+(?:declare\s+)?(?:const\s+)?(interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/.exec(line))) {
      out.add({ name: m[2]!, kind: m[1] === "namespace" || m[1] === "module" ? "module" : (m[1] as "interface" | "type" | "enum"), line: at, exported: true });
    } else if ((m = /^\s*export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b[^=]*(?:=\s*(.*))?$/.exec(line))) {
      const name = m[1]!;
      // The right-hand side may start on the next line (a long arrow function's parameters).
      const rhs = (m[2] ?? "").trim() || (lines[i + 1] ?? "").trim();
      const kind: SymbolInfo["kind"] = isComponentRhs(rhs) && upper(name) ? "component" : isFunctionRhs(rhs) ? fnKind(name) : "const";
      out.add({ name, kind, line: at, exported: true });
    } else if ((m = /^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(line))) {
      if (!out.exportNamed(m[1]!)) out.add({ name: m[1]!, kind: fnKind(m[1]!), line: at, exported: true });
      else out.add({ name: "default", kind: "const", line: at, exported: true });
    } else if ((m = /^\s*export\s+default\s+(?:memo|React\.memo|forwardRef|React\.forwardRef|observer|connect)\s*\(/.exec(line))) {
      out.add({ name: "default", kind: "component", line: at, exported: true });
    } else if (/^\s*export\s+default\b/.test(line)) {
      out.add({ name: "default", kind: jsx ? "component" : "const", line: at, exported: true });
    } else if ((m = /^\s*export\s*(?:type\s*)?\{([^}]*)(\}?)/.exec(line)) && !/\bfrom\s*['"]/.test(line)) {
      // export { a, b as c }  (the list may run over several lines)
      let list = m[1]!;
      let j = i;
      let closed = m[2] === "}";
      let reExport = false;
      while (!closed && j + 1 < lines.length && j - i < 60) {
        j += 1;
        const idx = lines[j]!.indexOf("}");
        if (idx >= 0) { list += " " + lines[j]!.slice(0, idx); closed = true; reExport = /^\s*from\s*['"]/.test(lines[j]!.slice(idx + 1)); } else list += " " + lines[j]!;
      }
      if (reExport) continue;
      for (const part of list.split(",")) {
        const p = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
        if (!p) continue;
        const local = p[1]!, exportedAs = p[2] ?? p[1]!;
        if (!out.exportNamed(local) || exportedAs !== local) out.add({ name: exportedAs, kind: fnKind(exportedAs), line: at, exported: true });
      }
    } else if ((m = /^\s*module\.exports\s*=\s*\{([^}]*)\}?/.exec(line))) {
      for (const part of m[1]!.split(",")) {
        const p = /^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(part);
        if (p && !out.exportNamed(p[1]!)) out.add({ name: p[1]!, kind: "function", line: at, exported: true });
      }
    } else if ((m = /^\s*module\.exports\s*=\s*(?:class\s+)?([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(line))) {
      if (!out.exportNamed(m[1]!)) out.add({ name: m[1]!, kind: "const", line: at, exported: true });
    } else if ((m = /^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(line))) {
      out.add({ name: m[1]!, kind: isFunctionRhs(m[2]!.trim()) ? "function" : "const", line: at, exported: true });
    } else if ((m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line))) {
      out.add({ name: m[1]!, kind: fnKind(m[1]!), line: at, exported: false });
    } else if ((m = /^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line))) {
      out.add({ name: m[1]!, kind: "class", line: at, exported: false });
    } else if ((m = /^(interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(line))) {
      out.add({ name: m[2]!, kind: m[1] as "interface" | "type" | "enum", line: at, exported: false });
    } else if ((m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$/.exec(line))) {
      const rhs = m[2]!.trim() || (lines[i + 1] ?? "").trim();
      if (isComponentRhs(rhs) && upper(m[1]!)) out.add({ name: m[1]!, kind: "component", line: at, exported: false });
      else if (isFunctionRhs(rhs)) out.add({ name: m[1]!, kind: fnKind(m[1]!), line: at, exported: false });
      else if (/^[A-Z][A-Z0-9_]{2,}$/.test(m[1]!)) out.add({ name: m[1]!, kind: "const", line: at, exported: false });
    }
  }

  // HTTP routes: app.get('/x', handler), router.post(...), hono, koa-router.
  const verb = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${VERBS})\\s*\\(\\s*(['"\`])(/[^'"\`\\n]*|\\*)\\3\\s*(,)?\\s*([^\\s)][^\\n]{0,40})?`, "g");
  for (const m of code.matchAll(verb)) {
    if (CLIENT_RECEIVERS.test(m[1]!)) continue;
    // A server passes a handler after the path; a client passes nothing or a config object.
    const next = m[6];
    if (!m[5] || !next || (next.startsWith("{") && !/=>|function/.test(next) && !/^\{\s*(?:preHandler|onRequest|schema|config)\b/.test(next))) continue;
    out.add({ name: m[4]!, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[2] === "all" ? "ANY" : m[2]!.toUpperCase(), path: m[4]! });
  }
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(\s*(['"`])(\/[^'"`\n]*)\2/g)) {
    if (CLIENT_RECEIVERS.test(m[1]!)) continue;
    out.add({ name: m[3]!, kind: "route", line: lineAt(starts, m.index ?? 0), method: "ANY", path: m[3]! });
  }
  // fastify.route({ method: 'GET', url: '/x' })
  for (const m of code.matchAll(/\.\s*route\s*\(\s*\{([^}]*)\}/g)) {
    const url = /\burl\s*:\s*(['"`])([^'"`\n]+)\1/.exec(m[1]!);
    if (!url) continue;
    const meth = /\bmethod\s*:\s*(\[[^\]]*\]|['"`][A-Za-z]+['"`])/.exec(m[1]!);
    const verbs = meth ? (meth[1]!.match(/[A-Za-z]+/g) ?? []).map((v) => v.toUpperCase()).join("|") : "ANY";
    out.add({ name: url[2]!, kind: "route", line: lineAt(starts, m.index ?? 0), method: verbs || "ANY", path: url[2]! });
  }
  // NestJS: @Controller('users') ... @Get(':id')
  const ctl = /@Controller\(\s*(?:(['"`])([^'"`]*)\1)?\s*\)/.exec(code);
  if (ctl || /@(?:Get|Post|Put|Patch|Delete|All)\(/.test(code)) {
    const prefix = ctl?.[2] ? `/${ctl[2].replace(/^\/+|\/+$/g, "")}` : "";
    for (const m of code.matchAll(/@(Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g)) {
      const sub = m[3] ? `/${m[3].replace(/^\/+/, "")}` : "";
      const full = (prefix + sub) || "/";
      out.add({ name: full, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[1] === "All" ? "ANY" : m[1]!.toUpperCase(), path: full });
    }
  }

  nextRoutes(path, code, ctx, out, starts);

  envNames(code, [
    /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /\bprocess\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g,
    /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /\b(?:Bun|Deno)\.env\.(?:get\(\s*['"`])?([A-Za-z_][A-Za-z0-9_]*)/g,
  ], out, starts);
  return out.items;
}

/** Next.js: the route a file is, from where it sits (app/ and pages/). */
function nextRoutes(path: string, code: string, ctx: SymbolContext, out: Out, starts: number[]): void {
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

// ---------------------------------------------------------------- Python

function pySymbols(text: string): SymbolInfo[] {
  const code = blankComments(text, PY_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  let cls: { name: string; indent: number } | null = null;
  let pending: Array<{ method: string; path: string; line: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    let m: RegExpExecArray | null;
    if (cls && indent <= cls.indent && !/^\s*@/.test(line)) cls = null;

    if ((m = /^\s*@\s*[\w.]+\.(get|post|put|patch|delete|head|options|route|websocket|api_route)\(\s*(?:path\s*=\s*)?(['"])(.*?)\2([^)]*)/.exec(line))) {
      let method = m[1] === "route" || m[1] === "api_route" ? "GET" : m[1] === "websocket" ? "WS" : m[1]!.toUpperCase();
      if (m[1] === "route" || m[1] === "api_route") {
        const ms = /methods\s*=\s*[\[(]([^\])]*)[\])]/.exec(m[4] ?? "");
        if (ms) method = (ms[1]!.match(/[A-Za-z]+/g) ?? ["GET"]).map((v) => v.toUpperCase()).join("|");
      }
      pending.push({ method, path: m[3]!, line: i + 1 });
      continue;
    }
    if ((m = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(line))) {
      const name = m[1]!;
      const inClass = cls !== null && indent > cls.indent;
      const full = inClass ? `${cls!.name}.${name}` : name;
      if (indent === 0 || inClass) out.add({ name: full, kind: inClass ? "method" : "function", line: i + 1, exported: !name.startsWith("_") });
      for (const r of pending) out.add({ name: r.path, kind: "route", line: r.line, method: r.method, path: r.path });
      pending = [];
      continue;
    }
    if ((m = /^class\s+(\w+)/.exec(line))) {
      cls = { name: m[1]!, indent };
      out.add({ name: m[1]!, kind: "class", line: i + 1, exported: !m[1]!.startsWith("_") });
      pending = [];
      continue;
    }
    if (indent === 0 && (m = /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=[^=]/.exec(line))) {
      out.add({ name: m[1]!, kind: "const", line: i + 1, exported: true });
    } else if (indent === 0 && /^if\s+__name__\s*==\s*['"]__main__['"]/.test(line)) {
      out.add({ name: "__main__", kind: "entry", line: i + 1 });
    }
    if (!/^\s*@/.test(line)) pending = [];
  }

  // Django: path('x/', views.y), re_path(r'^x/$', ...), url(...)
  if (/\burlpatterns\b/.test(code)) {
    for (const m of code.matchAll(/\b(?:re_path|path|url)\(\s*r?(['"])(.*?)\1\s*,\s*([\w.]+(?:\.as_view\(\))?|include\([^)]*\))/g)) {
      const p = m[2]!.replace(/^\^/, "").replace(/\$$/, "");
      const route = `/${p.replace(/^\/+/, "")}`;
      out.add({ name: route, kind: "route", line: lineAt(starts, m.index ?? 0), method: "ANY", path: route });
    }
  }
  envNames(code, [
    /\bos\.environ\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, /\bos\.environ\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
    /\bos\.getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
  ], out, starts);
  return out.items;
}

// -------------------------------------------------------------------- Go

function goSymbols(text: string): SymbolInfo[] {
  const code = blankComments(text, C_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  const isMain = /^\s*package\s+main\b/m.test(code);
  let block: "const" | "var" | "type" | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if (block) {
      if (/^\)/.test(line)) { block = null; continue; }
      if ((m = /^\s+([A-Za-z_]\w*)\b/.exec(line)) && m[1] !== "_") {
        const name = m[1]!;
        if (block === "type") { if (/^\s+\w+\s+(?:struct|interface)\b/.test(line)) out.add({ name, kind: /\binterface\b/.test(line) ? "interface" : "struct", line: at, exported: upper(name) }); else out.add({ name, kind: "type", line: at, exported: upper(name) }); }
        else out.add({ name, kind: "const", line: at, exported: upper(name) });
      }
      continue;
    }
    if ((m = /^func\s+(?:\(\s*\w*\s*\*?\s*(\w+)(?:\[[^\]]*\])?\s*\)\s*)?(\w+)\s*[[(]/.exec(line))) {
      const recv = m[1], name = m[2]!;
      out.add({ name: recv ? `${recv}.${name}` : name, kind: recv ? "method" : "function", line: at, exported: upper(name) });
      if (isMain && !recv && name === "main") out.add({ name: "main", kind: "entry", line: at });
    } else if ((m = /^type\s+(\w+)(?:\[[^\]]*\])?\s+(struct|interface)\b/.exec(line))) {
      out.add({ name: m[1]!, kind: m[2] as "struct" | "interface", line: at, exported: upper(m[1]!) });
    } else if ((m = /^type\s+(\w+)(?:\[[^\]]*\])?\s+\S/.exec(line))) {
      out.add({ name: m[1]!, kind: "type", line: at, exported: upper(m[1]!) });
    } else if (/^(const|var|type)\s*\(\s*$/.test(line)) {
      block = /^const/.test(line) ? "const" : /^var/.test(line) ? "var" : "type";
    } else if ((m = /^(?:const|var)\s+(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "const", line: at, exported: upper(m[1]!) });
    }
  }

  for (const m of code.matchAll(/\.\s*(HandleFunc|Handle)\(\s*"([^"]+)"/g)) {
    const spec = m[2]!;
    const sp = /^([A-Z]+)\s+(\S+)$/.exec(spec);
    const path = sp ? sp[2]! : spec;
    out.add({ name: path, kind: "route", line: lineAt(starts, m.index ?? 0), method: sp ? sp[1]! : "ANY", path });
  }
  for (const m of code.matchAll(/\b\w+\s*\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any|ANY|Get|Post|Put|Patch|Delete|Head|Options)\(\s*"(\/[^"]*)"/g)) {
    out.add({ name: m[2]!, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[1]!.toUpperCase() === "ANY" ? "ANY" : m[1]!.toUpperCase(), path: m[2]! });
  }
  envNames(code, [/\bos\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g], out, starts);
  return out.items;
}

// -------------------------------------------------------------------- Rust

function rustSymbols(text: string): SymbolInfo[] {
  const code = blankComments(text, C_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if ((m = /^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "function", line: at, exported: true });
    } else if ((m = /^\s*pub(?:\([^)]*\))?\s+(struct|enum|trait|type|union|mod)\s+(\w+)/.exec(line))) {
      const kind = ({ struct: "struct", enum: "enum", trait: "trait", type: "type", union: "struct", mod: "module" } as const)[m[1] as "struct"];
      out.add({ name: m[2]!, kind, line: at, exported: true });
    } else if ((m = /^\s*pub(?:\([^)]*\))?\s+(?:const|static)\s+(?:mut\s+)?(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "const", line: at, exported: true });
    } else if ((m = /^(?:async\s+)?fn\s+(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "function", line: at, exported: false });
      if (m[1] === "main") out.add({ name: "main", kind: "entry", line: at });
    } else if ((m = /^(struct|enum|trait)\s+(\w+)/.exec(line))) {
      out.add({ name: m[2]!, kind: m[1] as "struct" | "enum" | "trait", line: at, exported: false });
    }
  }
  for (const m of code.matchAll(/#\[\s*(get|post|put|patch|delete|head|options)\s*\(\s*"([^"]+)"/g)) {
    out.add({ name: m[2]!, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[1]!.toUpperCase(), path: m[2]! });
  }
  for (const m of code.matchAll(/\.route\(\s*"([^"]+)"\s*,\s*(get|post|put|patch|delete|any)\(/g)) {
    out.add({ name: m[1]!, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[2] === "any" ? "ANY" : m[2]!.toUpperCase(), path: m[1]! });
  }
  envNames(code, [/\b(?:std::)?env::var(?:_os)?\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g, /\b(?:option_)?env!\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g], out, starts);
  return out.items;
}

// ------------------------------------------------------------- Java, Kotlin

function javaSymbols(text: string, kotlin: boolean): SymbolInfo[] {
  const code = blankComments(text, C_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if (kotlin) {
      if ((m = /^\s*(?:(public|internal|private|protected)\s+)?(?:(?:data|sealed|abstract|open|enum|annotation|inner|value)\s+)*(class|interface|object)\s+(\w+)/.exec(line)) && !/^\s*(?:private|protected)/.test(line)) {
        out.add({ name: m[3]!, kind: m[2] === "interface" ? "interface" : "class", line: at, exported: m[1] !== "private" && m[1] !== "protected" });
      } else if ((m = /^\s*(?:(public|internal|private|protected)\s+)?(?:(?:suspend|inline|override|operator|infix|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)\s*\(/.exec(line)) && !/^\s+(?:private|protected)/.test(line)) {
        out.add({ name: m[2]!, kind: "function", line: at, exported: m[1] !== "private" && m[1] !== "protected" });
        if (m[2] === "main") out.add({ name: "main", kind: "entry", line: at });
      } else if ((m = /^\s*(?:(public|internal)\s+)?const\s+val\s+(\w+)/.exec(line))) {
        out.add({ name: m[2]!, kind: "const", line: at, exported: true });
      }
    } else if ((m = /^\s*public\s+(?:(?:abstract|final|static|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record|@interface)\s+(\w+)/.exec(line))) {
      out.add({ name: m[2]!, kind: m[1] === "interface" || m[1] === "@interface" ? "interface" : m[1] === "enum" ? "enum" : "class", line: at, exported: true });
    } else if ((m = /^\s+public\s+(?:(?:static|final|synchronized|abstract|default)\s+)*(?:<[^>]+>\s+)?[\w.<>\[\],? ]+?\s+(\w+)\s*\(/.exec(line)) && !/\b(?:new|return|else|class|interface|enum)\b/.test(line.split("(")[0]!)) {
      out.add({ name: m[1]!, kind: "method", line: at, exported: true });
      if (m[1] === "main" && /static/.test(line)) out.add({ name: "main", kind: "entry", line: at });
    }
  }
  // Spring: @RequestMapping("/api") on the class, @GetMapping("/x") on methods.
  const base = /@RequestMapping\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)"/.exec(code);
  for (const m of code.matchAll(/@(Get|Post|Put|Patch|Delete|Request)Mapping(?:\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*(?:"([^"]*)")?)?/g)) {
    if (m[1] === "Request" && base && m[2] === base[1] && m.index === base.index) continue;
    const sub = m[2] ? `/${m[2].replace(/^\/+/, "")}` : "";
    const prefix = base && m.index !== base.index ? `/${base[1]!.replace(/^\/+|\/+$/g, "")}` : "";
    const full = (prefix + sub) || "/";
    out.add({ name: full, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[1] === "Request" ? "ANY" : m[1]!.toUpperCase(), path: full });
  }
  envNames(code, [/\bSystem\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g], out, starts);
  return out.items;
}

// -------------------------------------------------------------------- Dart

function dartSymbols(text: string): SymbolInfo[] {
  const code = blankComments(text, DART_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  const widget = /\b(?:StatelessWidget|StatefulWidget|ConsumerWidget|ConsumerStatefulWidget|HookWidget|HookConsumerWidget|InheritedWidget|Widget)\b/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if ((m = /^(?:(?:abstract|base|final|sealed|interface|mixin)\s+)*class\s+(\w+)([^{]*)/.exec(line))) {
      const name = m[1]!;
      out.add({ name, kind: /\bextends\s+[\w<>,? ]*Widget\b|\bextends\s+(?:Stateless|Stateful|Consumer|Hook)\w*/.test(m[2]!) || widget.test(m[2]!) && /\bextends\b/.test(m[2]!) ? "component" : "class", line: at, exported: !name.startsWith("_") });
    } else if ((m = /^mixin\s+(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "class", line: at, exported: !m[1]!.startsWith("_") });
    } else if ((m = /^enum\s+(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "enum", line: at, exported: !m[1]!.startsWith("_") });
    } else if ((m = /^extension\s+(\w+)?/.exec(line)) && m[1]) {
      out.add({ name: m[1]!, kind: "class", line: at, exported: !m[1]!.startsWith("_") });
    } else if ((m = /^typedef\s+(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "type", line: at, exported: !m[1]!.startsWith("_") });
    } else if ((m = /^(?:static\s+)?(?:Future<[^>]*>|Stream<[^>]*>|FutureOr<[^>]*>|void|[A-Z]\w*(?:<[^>]*>)?\??|int|double|bool|num|String|dynamic)\s+(\w+)\s*(?:<[^>]*>)?\(/.exec(line)) && m[1] !== "if" && m[1] !== "for" && m[1] !== "while" && m[1] !== "switch") {
      out.add({ name: m[1]!, kind: "function", line: at, exported: !m[1]!.startsWith("_") });
      if (m[1] === "main") out.add({ name: "main", kind: "entry", line: at });
    } else if ((m = /^(?:const|final)\s+(?:[\w<>,?]+\s+)?([a-zA-Z_]\w*)\s*=/.exec(line)) && !/^\s/.test(line)) {
      out.add({ name: m[1]!, kind: "const", line: at, exported: !m[1]!.startsWith("_") });
    } else if (/^main\s*\(/.test(line)) {
      out.add({ name: "main", kind: "entry", line: at });
    }
  }
  for (const m of code.matchAll(/\bGoRoute\(\s*(?:[^()]*?,\s*)?path\s*:\s*(['"])([^'"]+)\1/g)) {
    out.add({ name: m[2]!, kind: "route", line: lineAt(starts, m.index ?? 0), method: "GET", path: m[2]! });
  }
  envNames(code, [
    /\bString\.fromEnvironment\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, /\bPlatform\.environment\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
    /\bdotenv\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  ], out, starts);
  return out.items;
}

// -------------------------------------------------------------------- Ruby

function rubySymbols(path: string, text: string): SymbolInfo[] {
  const code = blankComments(text.replace(/^=begin[\s\S]*?^=end.*$/gm, (b) => b.replace(/[^\n]/g, " ")), HASH_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  const rails = /(?:^|\/)routes(?:\/[\w-]+)?\.rb$/.test(path);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if ((m = /^\s*(class|module)\s+([A-Z][\w:]*)/.exec(line))) {
      out.add({ name: m[2]!, kind: m[1] === "module" ? "module" : "class", line: at, exported: true });
    } else if ((m = /^(\s*)def\s+(self\.)?([\w?!=]+)/.exec(line))) {
      const name = m[3]!;
      out.add({ name: m[2] ? `self.${name}` : name, kind: m[1] ? "method" : "function", line: at, exported: !name.startsWith("_") });
    } else if ((m = /^\s*([A-Z][A-Z0-9_]+)\s*=[^=]/.exec(line)) && !/^\s{2,}/.test(line)) {
      out.add({ name: m[1]!, kind: "const", line: at, exported: true });
    }
    if (rails) {
      if ((m = /^\s*(get|post|put|patch|delete|match)\s+['"]\/?([^'"]*)['"]/.exec(line))) {
        out.add({ name: `/${m[2]}`, kind: "route", line: at, method: m[1] === "match" ? "ANY" : m[1]!.toUpperCase(), path: `/${m[2]}` });
      } else if ((m = /^\s*(resources?)\s+:(\w+)/.exec(line))) {
        out.add({ name: `/${m[2]}`, kind: "route", line: at, method: "ANY", path: `/${m[2]}` });
      } else if (/^\s*root\b/.test(line)) {
        out.add({ name: "/", kind: "route", line: at, method: "GET", path: "/" });
      }
    } else if ((m = /^\s*(get|post|put|patch|delete)\s+['"](\/[^'"]*)['"]\s*(?:,|do|\{)/.exec(line))) {
      out.add({ name: m[2]!, kind: "route", line: at, method: m[1]!.toUpperCase(), path: m[2]! });
    }
  }
  envNames(code, [/\bENV\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g, /\bENV\.fetch\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g], out, starts);
  return out.items;
}

// --------------------------------------------------------------------- PHP

function phpSymbols(text: string): SymbolInfo[] {
  const code = blankComments(text, { ...C_LIKE, hash: true, apostrophe: "string" });
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if ((m = /^\s*(?:abstract\s+|final\s+)*(class|interface|trait|enum)\s+(\w+)/.exec(line))) {
      out.add({ name: m[2]!, kind: m[1] === "interface" ? "interface" : m[1] === "trait" ? "trait" : m[1] === "enum" ? "enum" : "class", line: at, exported: true });
    } else if ((m = /^(\s*)(?:(public|protected|private)\s+)?(?:static\s+)?function\s+&?(\w+)\s*\(/.exec(line))) {
      out.add({ name: m[3]!, kind: m[1] ? "method" : "function", line: at, exported: m[2] !== "private" && m[2] !== "protected" });
    }
  }
  for (const m of code.matchAll(/\bRoute::(get|post|put|patch|delete|any|match|options)\(\s*(?:\[[^\]]*\]\s*,\s*)?(['"])([^'"]*)\2/g)) {
    const p = `/${m[3]!.replace(/^\/+/, "")}`;
    out.add({ name: p, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[1] === "any" || m[1] === "match" ? "ANY" : m[1]!.toUpperCase(), path: p });
  }
  envNames(code, [/\bgetenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, /\benv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g, /\$_(?:ENV|SERVER)\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g], out, starts);
  return out.items;
}

// ------------------------------------------------------------------- Swift

function swiftSymbols(text: string): SymbolInfo[] {
  const code = blankComments(text, { ...C_LIKE, apostrophe: "string" });
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if (/(?:^|\s)@main\b/.test(line)) out.add({ name: "main", kind: "entry", line: at });
    if ((m = /^\s*(?:@\w+\s+)*(?:(public|open|internal|private|fileprivate)\s+)?(?:final\s+)?(class|struct|enum|protocol|actor)\s+(\w+)([^{]*)/.exec(line))) {
      const view = /:\s*[^{]*\bView\b/.test(m[4]!);
      out.add({ name: m[3]!, kind: view ? "component" : m[2] === "protocol" ? "interface" : m[2] === "enum" ? "enum" : m[2] === "struct" ? "struct" : "class", line: at, exported: m[1] !== "private" && m[1] !== "fileprivate" });
    } else if ((m = /^(\s*)(?:@\w+\s+)*(?:(public|open|internal|private|fileprivate)\s+)?(?:static\s+|class\s+)?func\s+(\w+)/.exec(line)) && (m[1] === "" || m[2] === "public" || m[2] === "open")) {
      out.add({ name: m[3]!, kind: m[1] ? "method" : "function", line: at, exported: m[2] !== "private" && m[2] !== "fileprivate" });
    } else if ((m = /^\s*(?:public\s+)?typealias\s+(\w+)/.exec(line))) {
      out.add({ name: m[1]!, kind: "type", line: at, exported: true });
    }
  }
  envNames(code, [/\benvironment\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]/g], out, starts);
  return out.items;
}

// --------------------------------------------------------------------- C#

function csharpSymbols(text: string): SymbolInfo[] {
  const code = blankComments(text, C_LIKE);
  const starts = lineStarts(code);
  const lines = code.split("\n");
  const out = new Out();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if ((m = /^\s*(?:public|internal)\s+(?:(?:static|sealed|abstract|partial|readonly|unsafe)\s+)*(class|interface|struct|enum|record)\s+(\w+)/.exec(line))) {
      out.add({ name: m[2]!, kind: m[1] === "interface" ? "interface" : m[1] === "enum" ? "enum" : m[1] === "struct" ? "struct" : "class", line: at, exported: true });
    } else if ((m = /^\s+public\s+(?:(?:static|async|virtual|override|abstract|sealed|new|unsafe)\s+)*[\w<>\[\],.?]+\s+(\w+)\s*(?:<[^>]*>)?\(/.exec(line)) && !/\b(?:new|return)\b/.test(line.split("(")[0]!)) {
      out.add({ name: m[1]!, kind: "method", line: at, exported: true });
    } else if ((m = /\bstatic\s+(?:async\s+)?(?:void|int|Task(?:<int>)?)\s+Main\s*\(/.exec(line))) {
      out.add({ name: "Main", kind: "entry", line: at });
    }
  }
  if (/\bWebApplication\.CreateBuilder\b/.test(code)) out.add({ name: "Program", kind: "entry", line: 1 });
  for (const m of code.matchAll(/\[\s*Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"\s*\))?\s*\]/g)) {
    const p = `/${(m[2] ?? "").replace(/^\/+/, "")}`;
    out.add({ name: p, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[1]!.toUpperCase(), path: p });
  }
  for (const m of code.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/g)) {
    const p = `/${m[2]!.replace(/^\/+/, "")}`;
    out.add({ name: p, kind: "route", line: lineAt(starts, m.index ?? 0), method: m[1]!.toUpperCase(), path: p });
  }
  envNames(code, [/\bEnvironment\.GetEnvironmentVariable\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g], out, starts);
  return out.items;
}

// ---------------------------------------------------------------- generic

/** For the languages without a section of their own: C, C++, Scala, Elixir, Lua, shell, SQL... */
function genericSymbols(lang: string, text: string): SymbolInfo[] {
  const style = ["Shell", "Elixir", "Perl", "R", "Julia", "Terraform"].includes(lang) ? HASH_LIKE : lang === "SQL" ? { ...C_LIKE, apostrophe: "string" as const } : C_LIKE;
  const code = blankComments(text, style);
  const lines = code.split("\n");
  const out = new Out();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const at = i + 1;
    let m: RegExpExecArray | null;
    if ((m = /^\s*(?:export\s+)?(?:pub\s+)?(?:def|defp|defmodule|defmacro|function|func|fn|proc|sub|object|trait|module)\s+([A-Za-z_][\w:.]*)/.exec(line))) {
      out.add({ name: m[1]!, kind: /\b(?:object|trait|module|defmodule)\b/.test(line) ? "module" : "function", line: at, exported: true });
    } else if ((m = /^\s*(?:export\s+)?(?:abstract\s+|final\s+|sealed\s+|case\s+)*(?:class|struct|interface|enum|union)\s+([A-Za-z_]\w*)/.exec(line))) {
      out.add({ name: m[1]!, kind: /\binterface\b/.test(line) ? "interface" : /\benum\b/.test(line) ? "enum" : /\bstruct\b/.test(line) ? "struct" : "class", line: at, exported: true });
    } else if (lang === "Shell" && (m = /^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/.exec(line))) {
      out.add({ name: m[1]!, kind: "function", line: at, exported: true });
    } else if (lang === "SQL" && (m = /^\s*create\s+(?:or\s+replace\s+)?(table|view|function|procedure|index|type)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/i.exec(line))) {
      out.add({ name: m[2]!.replace(/"/g, ""), kind: m[1]!.toLowerCase() === "table" || m[1]!.toLowerCase() === "type" ? "struct" : "function", line: at, exported: true });
    } else if (/^(?:int|void)\s+main\s*\(/.test(line)) {
      out.add({ name: "main", kind: "entry", line: at });
    }
  }
  return out.items;
}

// ------------------------------------------------------------------ the door

/**
 * The symbols, routes, environment variables and entry marks of one file.
 * `lang` is lang.ts's name for its language. A file in a language with no
 * patterns, or any file of a kind that has no code in it (JSON, Markdown),
 * gives an empty list.
 */
export function extractSymbols(path: string, lang: string, text: string, ctx: SymbolContext = {}): SymbolInfo[] {
  let items: SymbolInfo[];
  switch (lang) {
    case "TypeScript": case "JavaScript": items = jsSymbols(path, text, ctx); break;
    case "Vue": case "Svelte": case "Astro": {
      const script = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(text);
      // The script's first line is the line of its <script> tag, when the code starts right after it.
      const tagLine = script ? text.slice(0, script.index).split("\n").length : 0;
      items = script ? jsSymbols(`${baseName(path)}.ts`, script[1]!, {}).map((s) => ({ ...s, line: s.line + tagLine - 1 })) : [];
      break;
    }
    case "Python": items = pySymbols(text); break;
    case "Go": items = goSymbols(text); break;
    case "Rust": items = rustSymbols(text); break;
    case "Java": items = javaSymbols(text, false); break;
    case "Kotlin": items = javaSymbols(text, true); break;
    case "Dart": items = dartSymbols(text); break;
    case "Ruby": items = rubySymbols(path, text); break;
    case "PHP": items = phpSymbols(text); break;
    case "Swift": items = swiftSymbols(text); break;
    case "C#": items = csharpSymbols(text); break;
    case "C": case "C++": case "Objective-C": case "Objective-C++": case "Scala": case "Groovy": case "Elixir": case "Lua": case "Shell": case "SQL":
    case "Perl": case "R": case "Julia": case "Haskell": case "Clojure": case "Zig": case "Nim": case "Erlang": case "OCaml": case "Elm": case "Solidity":
      items = genericSymbols(lang, text); break;
    default: items = [];
  }
  return capped(items);
}

/** TODO, FIXME and HACK markers in comments (a marker needs a comment sign before it, so a string that says TODO is not counted). */
export function countTodos(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (/(?:\/\/|#|\/\*|^\s*\*|--|<!--|;{1,2}|%)\s*(?:@?[\w.-]+\s*:\s*)?(?:TODO|FIXME|HACK|XXX)\b/.test(line)) n += 1;
  }
  return n;
}
