/**
 * WHICH FILE USES WHICH: THE IMPORT GRAPH, AND HOW CENTRAL EACH FILE IS IN IT.
 *
 * extractImports reads the import lines of a file (comments blanked first), and
 * resolveImport turns each into the repo files it means, for the languages
 * where that can be done from the tree alone:
 *
 *   TS/JS    relative paths with every extension and `/index`, ESM-style
 *            `./x.js` that really means x.ts, tsconfig/jsconfig `paths` and
 *            `baseUrl` (nearest config upward, `extends` followed), and the
 *            workspace packages of a monorepo by their package name
 *   Python   absolute imports against the repo root, src/ and each package
 *            manifest's folder, and relative imports (`from . import x`,
 *            `from ..y import z`), packages and modules alike
 *   Go       import paths under a go.mod's module, to the package folder's
 *            files
 *   Dart     `package:<this package>/...` and relative paths
 *   Rust (`mod x;`), Ruby (`require_relative`), C and C++ (`#include "x.h"`),
 *   Java and Kotlin (`import a.b.C`, matched to a.b/C by path)
 *
 * What does not resolve (a package from npm, a standard library) is simply not
 * an edge: the graph is the repo's own.
 *
 * rankFiles gives each file 0 to 1 for how central it is: half its in-degree
 * (how many files import it) and half a PageRank-lite over 20 iterations, both
 * scaled to the busiest file. Imports FROM test files are left out of the rank,
 * since a file is not central because tests cover it.
 */
import { baseName, dirName } from "./lang.js";
import { blankComments } from "./symbols.js";
import type { CoreEntry } from "./types.js";

export interface RawImport {
  spec: string;
  /** Python: the leading dots of a relative import. */
  level?: number;
  /** Python: the names after `import`, which may be submodules. */
  names?: string[];
}

// -------------------------------------------------------------- extraction

const JS_BLANK = { slash: true, hash: false, triple: false, backtick: true, apostrophe: "string" as const };
const C_BLANK = { slash: true, hash: false, triple: false, backtick: false, apostrophe: "char" as const };
const PY_BLANK = { slash: false, hash: true, triple: true, backtick: false, apostrophe: "string" as const };
const DART_BLANK = { slash: true, hash: false, triple: true, backtick: false, apostrophe: "string" as const };
const HASH_BLANK = { slash: false, hash: true, triple: false, backtick: false, apostrophe: "string" as const };

export function extractImports(path: string, lang: string, text: string): RawImport[] {
  const out: RawImport[] = [];
  const seen = new Set<string>();
  const add = (i: RawImport) => {
    const key = `${i.level ?? 0}|${i.spec}|${(i.names ?? []).join(",")}`;
    if (!seen.has(key) && out.length < 400) { seen.add(key); out.push(i); }
  };
  switch (lang) {
    case "TypeScript": case "JavaScript": case "Vue": case "Svelte": case "Astro": {
      const code = blankComments(text, JS_BLANK);
      for (const m of code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?(['"])([^'"\n]+)\1/g)) add({ spec: m[2]! });
      for (const m of code.matchAll(/\b(?:require|import)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g)) add({ spec: m[2]! });
      for (const m of code.matchAll(/\bimport\s+\w+\s*=\s*require\(\s*(['"])([^'"\n]+)\1\s*\)/g)) add({ spec: m[2]! });
      break;
    }
    case "Python": {
      const code = blankComments(text, PY_BLANK);
      const lines = code.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        let m: RegExpExecArray | null;
        if ((m = /^\s*import\s+(.+)$/.exec(line))) {
          for (const part of m[1]!.split(",")) { const mod = /^\s*([\w.]+)/.exec(part); if (mod) add({ spec: mod[1]! }); }
        } else if ((m = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/.exec(line))) {
          let rest = m[3]!;
          // from x import (a,\n b)
          if (rest.includes("(") && !rest.includes(")")) {
            let j = i;
            while (j + 1 < lines.length && !rest.includes(")") && j - i < 40) { j += 1; rest += " " + lines[j]!; }
          }
          const names = rest.replace(/[()]/g, "").split(",").map((n) => /^\s*(\w+|\*)/.exec(n)?.[1] ?? "").filter((n) => n && n !== "*");
          add({ spec: m[2]!, level: m[1]!.length, names });
        }
      }
      break;
    }
    case "Go": {
      const code = blankComments(text, C_BLANK);
      for (const block of code.matchAll(/\bimport\s*\(([\s\S]*?)\)/g)) for (const m of block[1]!.matchAll(/"([^"\n]+)"/g)) add({ spec: m[1]! });
      for (const m of code.matchAll(/^\s*import\s+(?:[\w.]+\s+)?"([^"\n]+)"/gm)) add({ spec: m[1]! });
      break;
    }
    case "Dart": {
      const code = blankComments(text, DART_BLANK);
      for (const m of code.matchAll(/^\s*(?:import|export|part)\s+(['"])([^'"\n]+)\1/gm)) add({ spec: m[2]! });
      break;
    }
    case "Rust": {
      const code = blankComments(text, C_BLANK);
      for (const m of code.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) add({ spec: m[1]! });
      break;
    }
    case "Ruby": {
      const code = blankComments(text, HASH_BLANK);
      for (const m of code.matchAll(/^\s*require_relative\s+['"]([^'"\n]+)['"]/gm)) add({ spec: m[1]! });
      break;
    }
    case "C": case "C++": case "Objective-C": case "Objective-C++": {
      const code = blankComments(text, C_BLANK);
      for (const m of code.matchAll(/^\s*#\s*include\s+"([^"\n]+)"/gm)) add({ spec: m[1]! });
      break;
    }
    case "Java": case "Kotlin": {
      const code = blankComments(text, C_BLANK);
      for (const m of code.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?\s*;?\s*$/gm)) add({ spec: m[1]! });
      break;
    }
    default: break;
  }
  void path;
  return out;
}

// ---------------------------------------------------------------- resolving

interface TsScope {
  /** The folder the config is in. */
  dir: string;
  /** baseUrl made repo-relative, or null. */
  baseUrl: string | null;
  /** Each path pattern with the folder its targets are relative to. */
  paths: Array<{ prefix: string; suffix: string; wildcard: boolean; targets: string[]; from: string }>;
}

export interface Resolver {
  files: ReadonlySet<string>;
  ts: TsScope[];
  goModules: Array<{ dir: string; module: string }>;
  goDirs: Map<string, string[]>;
  dartPackages: Array<{ dir: string; name: string }>;
  workspace: Map<string, { dir: string; main: string }>;
  pyRoots: string[];
  /** Java/Kotlin: a path's tail ("com/acme/Foo.java") to the files that end that way. */
  tails: Map<string, string[]>;
}

/** Joins and normalises a repo-relative path; null if it climbs out of the repo. */
export function joinPath(base: string, rel: string): string | null {
  const parts = (base ? base.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") { if (!out.length) return null; out.pop(); } else out.push(p);
  }
  return out.join("/");
}

const TS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json", ".vue", ".svelte", ".d.ts"];
const JS_TO_TS: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

function tsConfigsOf(core: Record<string, CoreEntry>): TsScope[] {
  const byPath = new Map<string, Record<string, unknown>>();
  for (const [p, e] of Object.entries(core)) if (e.kind === "tsconfig") byPath.set(p, e.data);
  const scopes = new Map<string, TsScope>();
  for (const [path, own] of byPath) {
    // Walk `extends` to the first config that sets each thing.
    let baseUrl: string | null = null;
    let paths: Record<string, string[]> | null = null;
    let pathsFrom = "";
    let cur: { path: string; data: Record<string, unknown> } | null = { path, data: own };
    for (let hop = 0; cur && hop < 6; hop += 1) {
      const d = cur.data as { baseUrl?: string; paths?: Record<string, string[]>; hasPaths?: boolean; extends?: string };
      if (baseUrl === null && d.baseUrl) { baseUrl = joinPath(dirName(cur.path), d.baseUrl); }
      if (paths === null && d.hasPaths) { paths = d.paths ?? {}; pathsFrom = dirName(cur.path); }
      const ext = d.extends;
      if (!ext || !ext.startsWith(".")) break;
      let next = joinPath(dirName(cur.path), ext);
      if (next && !byPath.has(next)) next = byPath.has(`${next}.json`) ? `${next}.json` : byPath.has(`${next}/tsconfig.json`) ? `${next}/tsconfig.json` : null;
      cur = next && byPath.has(next) ? { path: next, data: byPath.get(next)! } : null;
    }
    const dir = dirName(path);
    const scope = scopes.get(dir) ?? { dir, baseUrl: null, paths: [] };
    if (baseUrl !== null && scope.baseUrl === null) scope.baseUrl = baseUrl;
    for (const [pattern, targets] of Object.entries(paths ?? {})) {
      const star = pattern.indexOf("*");
      // Targets are relative to baseUrl when there is one, otherwise to the config that holds `paths`.
      scope.paths.push({
        prefix: star < 0 ? pattern : pattern.slice(0, star), suffix: star < 0 ? "" : pattern.slice(star + 1), wildcard: star >= 0,
        targets, from: baseUrl !== null ? baseUrl : pathsFrom,
      });
    }
    scopes.set(dir, scope);
  }
  return [...scopes.values()].sort((a, b) => b.dir.length - a.dir.length);
}

export function buildResolver(filesIn: Iterable<string>, core: Record<string, CoreEntry>): Resolver {
  const files = new Set(filesIn);
  const goModules: Resolver["goModules"] = [];
  const dartPackages: Resolver["dartPackages"] = [];
  const workspace = new Map<string, { dir: string; main: string }>();
  const pyRoots = new Set<string>([""]);
  for (const [path, e] of Object.entries(core)) {
    const dir = dirName(path);
    const d = e.data as Record<string, unknown>;
    if (e.kind === "gomod" && typeof d.module === "string" && d.module) goModules.push({ dir, module: d.module });
    if (e.kind === "pubspec" && typeof d.name === "string" && d.name) dartPackages.push({ dir, name: d.name });
    if (e.kind === "npm" && typeof d.name === "string" && d.name) workspace.set(d.name, { dir, main: typeof d.main === "string" ? d.main : "" });
    if (["pyproject", "requirements", "pipfile", "pysetup"].includes(e.kind)) { pyRoots.add(dir); pyRoots.add(dir ? `${dir}/src` : "src"); }
  }
  for (const p of files) {
    if (p.endsWith(".py")) {
      const m = /^((?:.*\/)?(?:src|lib|app|backend|server|python))\//.exec(p);
      if (m && m[1]!.split("/").length <= 3) pyRoots.add(m[1]!);
    }
  }
  const goDirs = new Map<string, string[]>();
  const tails = new Map<string, string[]>();
  for (const p of files) {
    if (p.endsWith(".go") && !p.endsWith("_test.go")) {
      const d = dirName(p);
      const list = goDirs.get(d) ?? [];
      list.push(p);
      goDirs.set(d, list);
    } else if (p.endsWith(".java") || p.endsWith(".kt")) {
      const parts = p.split("/");
      for (let i = 0; i < parts.length - 1; i += 1) {
        const tail = parts.slice(i).join("/");
        const list = tails.get(tail) ?? [];
        list.push(p);
        tails.set(tail, list);
      }
    }
  }
  for (const list of goDirs.values()) list.sort();
  goModules.sort((a, b) => b.module.length - a.module.length);
  return { files, ts: tsConfigsOf(core), goModules, goDirs, dartPackages, workspace, pyRoots: [...pyRoots].sort(), tails };
}

/** The repo file a TS/JS path means: the path itself, with an extension, or as a folder's index. */
function tryJs(r: Resolver, base: string | null): string | null {
  if (base === null) return null;
  const has = (p: string) => r.files.has(p);
  if (has(base) && /\.[a-z]+$/.test(base) && !/\.(?:md|txt)$/.test(base)) return base;
  const ext = /\.(?:js|jsx|mjs|cjs)$/.exec(base)?.[0];
  if (ext) {
    const stem = base.slice(0, -ext.length);
    for (const t of JS_TO_TS[ext] ?? []) if (has(stem + t)) return stem + t;
  }
  for (const e of TS_EXTS) if (has(base + e)) return base + e;
  for (const e of TS_EXTS) if (has(`${base}/index${e}`)) return `${base}/index${e}`;
  return null;
}

function resolveJs(r: Resolver, spec: string, from: string): string[] {
  if (spec.startsWith(".")) { const f = tryJs(r, joinPath(dirName(from), spec)); return f ? [f] : []; }
  if (/^(?:node:|https?:|data:|virtual:)/.test(spec)) return [];
  const dir = dirName(from);
  for (const scope of r.ts) {
    if (scope.dir !== "" && dir !== scope.dir && !dir.startsWith(`${scope.dir}/`)) continue;
    for (const p of scope.paths) {
      let captured: string | null = null;
      if (p.wildcard) { if (spec.startsWith(p.prefix) && spec.endsWith(p.suffix) && spec.length >= p.prefix.length + p.suffix.length) captured = spec.slice(p.prefix.length, spec.length - p.suffix.length); }
      else if (spec === p.prefix) captured = "";
      if (captured === null) continue;
      for (const t of p.targets) {
        const f = tryJs(r, joinPath(p.from, p.wildcard ? t.replace("*", captured) : t));
        if (f) return [f];
      }
    }
    if (scope.baseUrl !== null) {
      const f = tryJs(r, joinPath(scope.baseUrl, spec));
      if (f) return [f];
    }
  }
  // A workspace package, by name: `@acme/ui`, `@acme/ui/button`.
  const m = /^(@[^/]+\/[^/]+|[^/@][^/]*)(?:\/(.+))?$/.exec(spec);
  const pkg = m ? r.workspace.get(m[1]!) : undefined;
  if (m && pkg) {
    const tries: string[] = [];
    if (m[2]) tries.push(joinPath(pkg.dir, m[2]) ?? "", joinPath(pkg.dir, `src/${m[2]}`) ?? "");
    else {
      if (pkg.main) tries.push(joinPath(pkg.dir, pkg.main) ?? "");
      tries.push(joinPath(pkg.dir, "src/index") ?? "", joinPath(pkg.dir, "index") ?? "", joinPath(pkg.dir, "lib/index") ?? "", joinPath(pkg.dir, "src/main") ?? "");
    }
    for (const t of tries) { const f = t ? tryJs(r, t) : null; if (f) return [f]; }
  }
  return [];
}

function resolvePython(r: Resolver, imp: RawImport, from: string): string[] {
  const found = new Set<string>();
  const tryModule = (base: string | null) => {
    if (base === null) return false;
    if (r.files.has(`${base}.py`)) { found.add(`${base}.py`); return true; }
    if (r.files.has(`${base}/__init__.py`)) { found.add(`${base}/__init__.py`); return true; }
    return false;
  };
  const withNames = (base: string | null) => {
    if (base === null) return;
    const isPkg = tryModule(base);
    let any = false;
    for (const n of imp.names ?? []) if (tryModule(joinPath(base, n))) any = true;
    return isPkg || any;
  };
  if ((imp.level ?? 0) > 0) {
    let dir = dirName(from);
    for (let i = 1; i < imp.level!; i += 1) dir = dirName(dir);
    withNames(imp.spec ? joinPath(dir, imp.spec.replace(/\./g, "/")) : dir === "" ? "" : dir);
    // `from . import x` with the package itself: its __init__
    if (!imp.spec && r.files.has(dir ? `${dir}/__init__.py` : "__init__.py")) found.add(dir ? `${dir}/__init__.py` : "__init__.py");
    return [...found].filter((f) => f !== from);
  }
  const rel = imp.spec.replace(/\./g, "/");
  for (const root of r.pyRoots) {
    if (withNames(joinPath(root, rel))) break;
  }
  return [...found].filter((f) => f !== from);
}

function resolveGo(r: Resolver, spec: string): string[] {
  for (const m of r.goModules) {
    if (spec === m.module || spec.startsWith(`${m.module}/`)) {
      const dir = joinPath(m.dir, spec.slice(m.module.length)) ?? "";
      return (r.goDirs.get(dir) ?? []).slice(0, 20);
    }
  }
  return [];
}

function resolveDart(r: Resolver, spec: string, from: string): string[] {
  if (spec.startsWith("dart:")) return [];
  const pkg = /^package:([^/]+)\/(.+)$/.exec(spec);
  if (pkg) {
    const p = r.dartPackages.find((x) => x.name === pkg[1]);
    const f = p ? joinPath(p.dir, `lib/${pkg[2]}`) : null;
    return f && r.files.has(f) ? [f] : [];
  }
  if (/^[a-z]+:/.test(spec)) return [];
  const f = joinPath(dirName(from), spec);
  return f && r.files.has(f) ? [f] : [];
}

/** The repo files an import means, resolved against the tree. Empty for anything outside the repo. */
export function resolveImport(r: Resolver, imp: RawImport, from: string, lang: string): string[] {
  let out: string[] = [];
  switch (lang) {
    case "TypeScript": case "JavaScript": case "Vue": case "Svelte": case "Astro": out = resolveJs(r, imp.spec, from); break;
    case "Python": out = resolvePython(r, imp, from); break;
    case "Go": out = resolveGo(r, imp.spec); break;
    case "Dart": out = resolveDart(r, imp.spec, from); break;
    case "Rust": {
      const dir = ["main.rs", "lib.rs", "mod.rs"].includes(baseName(from)) ? dirName(from) : joinPath(dirName(from), baseName(from).replace(/\.rs$/, "")) ?? "";
      for (const c of [joinPath(dir, `${imp.spec}.rs`), joinPath(dir, `${imp.spec}/mod.rs`)]) if (c && r.files.has(c)) { out = [c]; break; }
      break;
    }
    case "Ruby": {
      const f = joinPath(dirName(from), imp.spec.endsWith(".rb") ? imp.spec : `${imp.spec}.rb`);
      out = f && r.files.has(f) ? [f] : [];
      break;
    }
    case "C": case "C++": case "Objective-C": case "Objective-C++": {
      const f = joinPath(dirName(from), imp.spec);
      out = f && r.files.has(f) ? [f] : [];
      break;
    }
    case "Java": case "Kotlin": {
      const tail = imp.spec.replace(/\./g, "/");
      const hit = r.tails.get(`${tail}.java`) ?? r.tails.get(`${tail}.kt`);
      // Several files ending the same way is a coincidence of names, not an import.
      out = hit && hit.length === 1 ? [hit[0]!] : [];
      break;
    }
    default: break;
  }
  return out.filter((f) => f !== from);
}

// ------------------------------------------------------------------ ranking

/** The graph's edges as a map from file to the files it imports (each of them a file of the repo). */
export type Edges = ReadonlyMap<string, readonly string[]>;

export function reverseEdges(edges: Edges): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const [from, tos] of edges) for (const to of tos) { const l = rev.get(to); if (l) l.push(from); else rev.set(to, [from]); }
  return rev;
}

/**
 * 0 to 1 for each file: half in-degree and half PageRank-lite (20 iterations,
 * damping 0.85, dangling files spread evenly), each scaled to the highest.
 * `ignoreFrom` leaves out the imports of some files (tests).
 */
export function rankFiles(paths: readonly string[], edges: Edges, ignoreFrom: (path: string) => boolean = () => false): Map<string, number> {
  const n = paths.length;
  const out = new Map<string, number>();
  if (!n) return out;
  const index = new Map(paths.map((p, i) => [p, i]));
  const outs: number[][] = paths.map(() => []);
  const indeg = new Array<number>(n).fill(0);
  for (const [from, tos] of edges) {
    const i = index.get(from);
    if (i === undefined || ignoreFrom(from)) continue;
    for (const to of new Set(tos)) {
      const j = index.get(to);
      if (j === undefined || j === i) continue;
      outs[i]!.push(j);
      indeg[j]! += 1;
    }
  }
  const d = 0.85;
  let pr = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < 20; it += 1) {
    const next = new Array<number>(n).fill((1 - d) / n);
    let dangling = 0;
    for (let i = 0; i < n; i += 1) {
      const o = outs[i]!;
      if (!o.length) { dangling += pr[i]!; continue; }
      const share = (d * pr[i]!) / o.length;
      for (const j of o) next[j]! += share;
    }
    const spread = (d * dangling) / n;
    for (let i = 0; i < n; i += 1) next[i]! += spread;
    pr = next;
  }
  const maxIn = Math.max(1, ...indeg);
  const maxPr = Math.max(...pr);
  const minPr = Math.min(...pr);
  for (let i = 0; i < n; i += 1) {
    // PageRank scaled between the quietest and the busiest file, so a repo with no edges at all is all zeros, not all one half.
    const score = 0.5 * (indeg[i]! / maxIn) + 0.5 * (maxPr > minPr ? (pr[i]! - minPr) / (maxPr - minPr) : 0);
    out.set(paths[i]!, Math.round(score * 10_000) / 10_000);
  }
  return out;
}
