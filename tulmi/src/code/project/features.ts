/**
 * THE FEATURES OF A PROJECT: WHICH FILES ARE "AUTH", WHICH ARE "PAYMENTS", WHICH ARE "THE SETTINGS SCREEN".
 *
 * A person asks for a feature ("make the checkout remember the address"), not a
 * file. So the files are clustered into features, with no model, from what the
 * code itself says:
 *
 *   route segments   a file that serves /api/auth/login is about auth
 *   folder names     src/features/billing/..., app/settings/page.tsx, lib/screens/profile/
 *                    (generic folders like src, components, utils, lib are looked
 *                    through, and a container folder like features/ or modules/
 *                    names the feature by the folder after it)
 *   file names       PaymentForm.tsx, payment_service.py, useSettings.ts, where the
 *                    same word starts several file names
 *   co-change        a file that always changes with the files of one feature
 *   imports          a file whose neighbours in the import graph are a feature's
 *
 * Each file lands in at most one feature, by that order of evidence. A feature
 * needs two files, or one file with two routes. The result is `{ name, files[], routes[],
 * texts[] }`, which the cheap model then NAMES and describes (summarize.ts); if
 * it never does, these names and a plain summary stand.
 */
import { baseName, dirName, extOf } from "./lang.js";
import type { Aggregate } from "./hotspots.js";
import { type Feature, type PackageInfo, type SymbolInfo } from "./types.js";

/** Folders that say what KIND of code is in them, not what it is for. */
const GENERIC = new Set([
  "src", "lib", "libs", "app", "apps", "packages", "package", "components", "component", "ui", "utils", "util", "helpers", "helper", "common", "shared", "core", "internal", "pkg", "cmd",
  "api", "apis", "v1", "v2", "v3", "routes", "route", "controllers", "controller", "services", "service", "models", "model", "views", "view", "pages", "page", "screens", "screen",
  "store", "stores", "state", "hooks", "types", "typings", "config", "configs", "constants", "assets", "public", "static", "styles", "style", "css", "test", "tests", "spec", "specs",
  "__tests__", "mocks", "__mocks__", "fixtures", "index", "main", "java", "kotlin", "com", "org", "net", "io", "www", "web", "server", "client", "backend", "frontend", "mobile",
  "ios", "android", "widgets", "widget", "domain", "data", "presentation", "infrastructure", "application", "handlers", "handler", "middleware", "middlewares", "scripts", "tools",
  "build", "layouts", "layout", "templates", "template", "include", "includes", "source", "sources", "resources", "res", "values", "drawable", "base", "default", "generated",
  "bin", "dist", "docs", "doc", "examples", "example", "samples", "sample", "e2e", "integration", "unit", "modules", "module", "features", "feature", "domains", "entities", "dto", "dtos",
  "schemas", "schema", "migrations", "seeds", "db", "database", "repositories", "repository", "providers", "provider", "interfaces", "plugins", "plugin", "extensions", "lib_",
]);
/** A folder whose children are the features. */
const CONTAINER = new Set(["features", "feature", "modules", "module", "domains", "screens", "screen", "pages", "page", "views", "view", "routes", "route", "controllers", "controller", "handlers", "resources"]);

const words = (s: string): string[] =>
  s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^A-Za-z0-9]+/g, " ").trim().toLowerCase().split(" ").filter(Boolean);

const clean = (seg: string): string | null => {
  if (!seg || /^[:{[(@]/.test(seg) || /^\d+$/.test(seg)) return null;
  const w = words(seg).join("-");
  return w && w.length >= 3 && !GENERIC.has(w) ? w : null;
};

/** The word a route is about: its first segment that is not generic, a version or a parameter. */
function routeKey(route: string): string | null {
  for (const seg of route.split("/")) {
    if (seg === "api" || /^v\d+$/.test(seg)) continue;
    const k = clean(seg);
    if (k) return k;
  }
  return null;
}

/** The folder a file's feature is named for, looking through generic folders and into containers. */
function dirKey(path: string, pkgRoots: readonly string[]): string | null {
  let rel = path;
  const pkg = pkgRoots.find((r) => path.startsWith(`${r}/`));
  if (pkg) rel = path.slice(pkg.length + 1);
  const dirs = dirName(rel).split("/").filter(Boolean);
  for (let i = 0; i < dirs.length; i += 1) {
    const d = dirs[i]!;
    const k = clean(d);
    if (k) return k;
    if (CONTAINER.has(d.toLowerCase())) {
      const next = dirs[i + 1];
      const nk = next ? clean(next) : null;
      if (nk) return nk;
    }
  }
  return null;
}

/** The first word of a file's name when it is a meaningful one: PaymentForm -> payment. */
function nameKey(path: string): string | null {
  const b = baseName(path);
  const e = extOf(path);
  const stem = (e ? b.slice(0, -(e.length + 1)) : b).replace(/\.(?:test|spec|stories|module|d)$/, "").replace(/^use(?=[A-Z])/, "");
  const first = words(stem)[0];
  return first && first.length >= 4 && !GENERIC.has(first) && !/^(?:index|main|app|base|test|mock|util|type|config|error|default)$/.test(first) ? first : null;
}

export interface FeatureFile {
  path: string;
  symbols: readonly SymbolInfo[];
  summary: string;
  rank: number;
  imports: readonly string[];
  isTest: boolean;
}

export interface FeatureInput {
  files: readonly FeatureFile[];
  /** A few visible strings per file. */
  texts: ReadonlyMap<string, readonly string[]>;
  pairs: Aggregate["pairs"];
  packages: readonly PackageInfo[];
}

const FILES_KEPT = 80;
const FEATURES_MAX = 25;

export function clusterFeatures(input: FeatureInput): Feature[] {
  const files = input.files.filter((f) => !f.isTest);
  const pkgRoots = input.packages.map((p) => p.path).filter((p) => p && p !== ".").sort((a, b) => b.length - a.length);

  // Evidence per file: [route key, folder key, name key]
  const ev = new Map<string, { route: string | null; dir: string | null; name: string | null }>();
  const count = { route: new Map<string, number>(), dir: new Map<string, number>(), name: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string | null) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
  for (const f of files) {
    const firstRoute = f.symbols.find((s) => s.kind === "route" && s.path);
    const e = { route: firstRoute?.path ? routeKey(firstRoute.path) : null, dir: dirKey(f.path, pkgRoots), name: nameKey(f.path) };
    ev.set(f.path, e);
    bump(count.route, e.route);
    bump(count.dir, e.dir);
    bump(count.name, e.name);
  }

  const assigned = new Map<string, string>();
  for (const f of files) {
    const e = ev.get(f.path)!;
    // Folder first, then the route it serves, then its name's first word: each only if it is shared or a route.
    // A file named for a word that a folder or a route already uses (SettingsForm, next to app/settings/) joins it.
    const named = e.name && (count.name.get(e.name)! >= 2 || count.dir.has(e.name) || count.route.has(e.name)) ? e.name : null;
    const key = e.dir && (count.dir.get(e.dir)! >= 2 || e.route === e.dir) ? e.dir
      : e.route ? e.route
        : named;
    if (key) assigned.set(f.path, key);
  }

  // Files with no key of their own go where their neighbours are: files they change with, and files they import or are imported by.
  const neighbours = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, w: number) => { const m = neighbours.get(a) ?? new Map(); m.set(b, (m.get(b) ?? 0) + w); neighbours.set(a, m); };
  for (const [a, b, n] of input.pairs) { add(a, b, n); add(b, a, n); }
  for (const f of files) for (const to of f.imports) { add(f.path, to, 1); add(to, f.path, 1); }
  for (const f of files) {
    if (assigned.has(f.path)) continue;
    const votes = new Map<string, number>();
    for (const [other, w] of neighbours.get(f.path) ?? []) { const k = assigned.get(other); if (k) votes.set(k, (votes.get(k) ?? 0) + w); }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (best && best[1] >= 2) assigned.set(f.path, best[0]);
  }

  const groups = new Map<string, FeatureFile[]>();
  for (const f of files) { const k = assigned.get(f.path); if (k) { const l = groups.get(k) ?? []; l.push(f); groups.set(k, l); } }

  const out: Feature[] = [];
  for (const [key, members] of groups) {
    const routes = new Set<string>();
    for (const m of members) for (const s of m.symbols) if (s.kind === "route" && s.path) routes.add(`${s.method ?? "ANY"} ${s.path}`);
    if (members.length < 2 && routes.size < 2) continue;
    members.sort((a, b) => b.rank - a.rank || (a.path < b.path ? -1 : 1));
    const texts: string[] = [];
    for (const m of members) {
      for (const t of input.texts.get(m.path) ?? []) { if (!texts.includes(t) && texts.length < 5) texts.push(t); }
      if (texts.length >= 5) break;
    }
    const lead = members.find((m) => m.summary);
    out.push({
      key,
      name: key.replace(/-/g, " "),
      summary: lead ? lead.summary : `${members.length} file${members.length === 1 ? "" : "s"}${routes.size ? ` and ${routes.size} route${routes.size === 1 ? "" : "s"}` : ""}, led by ${members[0]!.path}.`,
      files: members.slice(0, FILES_KEPT).map((m) => m.path), fileCount: members.length,
      routes: [...routes].slice(0, 12), texts,
    });
  }
  return out.sort((a, b) => b.fileCount - a.fileCount || (a.name < b.name ? -1 : 1)).slice(0, FEATURES_MAX);
}
