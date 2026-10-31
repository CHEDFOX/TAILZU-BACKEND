/**
 * THE PROJECT MAP: EVERY COMPONENT AS ONE ENTRY, WITH ITS EXACT COORDINATES AND ITS CONNECTIONS, MADE FROM THE CODE ALONE.
 *
 * A request about existing code should land on the right lines at once, and a new thing should land where its kind already lives. The map is
 * data, not prose, so that it can be checked rather than trusted:
 *
 *   component   one source file (a screen, a route file, a service, a model): its area, its one-line summary, its symbols
 *   symbol      a function, class, type or route inside it: its line range and, when a parser read the file, a fingerprint of those lines
 *               (spanHash), so that "these lines are still what the map says" is a comparison, not a belief
 *   edges       uses / used by (imports, resolved), calls (names it refers to that exactly one or two other files define), tests
 *   live        reached from an entry point (the app's start, a route, a framework page) through those edges; false means nothing leads
 *               there (an old copy, an abandoned variant); null when the project names no entry point, so nothing can be said
 *   placement   per folder that holds two or more components: what kind of thing lives there, which files register them (import two or
 *               more of them) and where their tests sit; where a new one of that kind goes
 *
 * Built from the brain's rows (code/project), with no model and no file read: the only words a model wrote are the summaries. The map names
 * the commit it describes; checkSymbol re-reads one symbol from the file as it is now and says whether it is the same, moved, changed or gone.
 * What is decided only while the program runs (a name made from a variable, a call by a name in a string) is not in the edges: the model reads
 * the code there.
 */
import { createHash } from "node:crypto";
import { classOf, languageOf } from "./lang.js";
import { extractSymbols } from "./symbols.js";
import { ensureGrammars } from "./treesitter/index.js";
import type { Feature, StoredFile, SymbolInfo } from "./types.js";

export const MAP_VERSION = 1;

export interface MapSymbol {
  name: string;
  kind: SymbolInfo["kind"];
  /** First and last line (1-based); `end` is absent when a regex read the file (it knows where a thing starts, not where it ends). */
  start: number;
  end?: number;
  /** spanHash of the lines start..end, when both are known. */
  hash?: string;
  exported?: boolean;
  route?: { method: string; path: string };
}

export interface MapComponent {
  path: string;
  area: string | null;
  lang: string;
  summary: string;
  /** git's blob sha of the file this entry was made from. */
  blob: string;
  symbols: MapSymbol[];
  uses: string[];
  usedBy: string[];
  /** Other components whose names this one refers to, with the names. */
  calls: Array<{ to: string; names: string[] }>;
  tests: string[];
  live: boolean | null;
}

export interface MapArea { name: string; summary: string; components: string[] }

export interface Placement {
  folder: string;
  /** The kind most of its components are ("route", "component", "class", "function"...). */
  kind: string;
  /** Files that import two or more of the folder's components: where a new one is registered. */
  registeredIn: string[];
  /** Where the folder's tests sit, when they share a folder. */
  testsIn: string | null;
  examples: string[];
}

export interface ProjectMap {
  version: number;
  commit: string;
  areas: MapArea[];
  /** By path. */
  components: Record<string, MapComponent>;
  placements: Placement[];
  /** The entry points reachability started from. */
  entries: string[];
  /** For a map made after a change (mapupdate.ts): the files the change touched, on top of `commit`. */
  changed?: string[];
}

/** A fingerprint of lines start..end of a text (1-based, inclusive): 16 hex characters of SHA-256. Line endings do not count. */
export function spanHash(text: string, start: number, end: number): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").slice(Math.max(0, start - 1), Math.max(start, end));
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

/** The symbols of a file with the fingerprint of each one whose end is known: what a build keeps, so the map can prove a range later. */
export function withHashes(text: string, symbols: SymbolInfo[]): SymbolInfo[] {
  return symbols.map((s) => (s.endLine && s.endLine >= s.line ? { ...s, hash: spanHash(text, s.line, s.endLine) } : s));
}

/** Source code only: not a test, a config file (a Dockerfile, package.json), a doc, markup, a stylesheet or data. */
const isComponentPath = (path: string): boolean => classOf(path) === "source";
const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".");
/** A name too short or too common to say which file is meant. */
const NAME_MIN = 3;
const CALL_DEFINERS_MAX = 2;

function mapSymbol(s: SymbolInfo): MapSymbol {
  return {
    name: s.name, kind: s.kind, start: s.line, ...(s.endLine ? { end: s.endLine } : {}), ...(s.hash ? { hash: s.hash } : {}),
    ...(s.exported !== undefined ? { exported: s.exported } : {}), ...(s.kind === "route" && s.method && s.path ? { route: { method: s.method, path: s.path } } : {}),
  };
}

/**
 * The map of a project from the brain's rows. `entries` are the project's entry points (structure.entryPoints); a component with a route or
 * an entry mark in it counts as one too, since a framework reaches it, not an import.
 */
export function buildMap(input: { commit: string; files: readonly StoredFile[]; features: readonly Feature[]; entries: readonly string[] }): ProjectMap {
  const files = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const comps = files.filter((f) => isComponentPath(f.path));
  const isComp = new Set(comps.map((f) => f.path));

  // Who defines each exported name: a reference resolves to a file only when one or two files define it.
  const definers = new Map<string, string[]>();
  for (const f of comps) for (const s of f.symbols) {
    if (!s.exported || s.name.length < NAME_MIN) continue;
    const list = definers.get(s.name) ?? [];
    if (!list.includes(f.path)) list.push(f.path);
    definers.set(s.name, list);
  }

  const areaOf = new Map<string, string>();
  for (const a of input.features) for (const p of a.files) if (!areaOf.has(p)) areaOf.set(p, a.name);

  const components: Record<string, MapComponent> = {};
  for (const f of comps) {
    const calls = new Map<string, Set<string>>();
    for (const [name] of f.refs ?? []) {
      const by = definers.get(name);
      if (!by || by.length > CALL_DEFINERS_MAX) continue;
      for (const to of by) if (to !== f.path) (calls.get(to) ?? calls.set(to, new Set()).get(to)!).add(name);
    }
    components[f.path] = {
      path: f.path, area: areaOf.get(f.path) ?? null, lang: f.lang || languageOf(f.path), summary: f.summary, blob: f.blobSha,
      symbols: f.symbols.filter((s) => s.kind !== "env").map(mapSymbol),
      uses: [...new Set(f.imports.filter((p) => isComp.has(p) && p !== f.path))].sort(),
      usedBy: [],
      calls: [...calls].sort(([a], [b]) => (a < b ? -1 : 1)).map(([to, names]) => ({ to, names: [...names].sort() })),
      tests: [...f.tests].sort(),
      live: null,
    };
  }
  for (const c of Object.values(components)) for (const u of c.uses) components[u]!.usedBy.push(c.path);
  for (const c of Object.values(components)) c.usedBy.sort();

  // Reachability from the entry points, through imports and resolved calls.
  const entries = [...new Set([
    ...input.entries.filter((p) => isComp.has(p)),
    ...comps.filter((f) => f.symbols.some((s) => s.kind === "route" || s.kind === "entry")).map((f) => f.path),
  ])].sort();
  if (entries.length) {
    const seen = new Set(entries);
    const queue = [...entries];
    while (queue.length) {
      const c = components[queue.shift()!]!;
      for (const next of [...c.uses, ...c.calls.map((k) => k.to)]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    for (const c of Object.values(components)) c.live = seen.has(c.path);
  }

  const areas: MapArea[] = input.features
    .map((a) => ({ name: a.name, summary: a.summary, components: a.files.filter((p) => isComp.has(p)).sort() }))
    .filter((a) => a.components.length);

  return { version: MAP_VERSION, commit: input.commit, areas, components, placements: placementsOf(components), entries };
}

/** The kind a component is, by the first symbol that says what it is. */
function kindOf(c: MapComponent): string {
  const order = ["route", "component", "class", "struct", "interface", "function", "type", "const"];
  for (const k of order) if (c.symbols.some((s) => s.kind === k && (s.exported ?? true))) return k;
  return "module";
}

function placementsOf(components: Record<string, MapComponent>): Placement[] {
  const byFolder = new Map<string, MapComponent[]>();
  for (const c of Object.values(components)) (byFolder.get(dirOf(c.path)) ?? byFolder.set(dirOf(c.path), []).get(dirOf(c.path))!).push(c);
  const out: Placement[] = [];
  for (const [folder, cs] of [...byFolder].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (cs.length < 2) continue;
    const members = new Set(cs.map((c) => c.path));
    const importers = new Map<string, number>();
    for (const c of cs) for (const u of c.usedBy) if (!members.has(u)) importers.set(u, (importers.get(u) ?? 0) + 1);
    const kinds = new Map<string, number>();
    for (const c of cs) kinds.set(kindOf(c), (kinds.get(kindOf(c)) ?? 0) + 1);
    const testDirs = new Map<string, number>();
    for (const c of cs) for (const t of c.tests) testDirs.set(dirOf(t), (testDirs.get(dirOf(t)) ?? 0) + 1);
    const top = <K>(m: Map<K, number>): K | null => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
    out.push({
      folder, kind: top(kinds) ?? "module",
      registeredIn: [...importers].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([p]) => p),
      testsIn: top(testDirs),
      examples: cs.map((c) => c.path).sort().slice(0, 3),
    });
  }
  return out;
}

/** The components a request most likely means, best first: by path, symbol and route names, then summary words. */
export function findInMap(map: ProjectMap, query: string, limit = 8): string[] {
  const words = query.toLowerCase().match(/[a-z0-9_/.-]{2,}/g) ?? [];
  if (!words.length) return [];
  const scored: Array<[string, number]> = [];
  for (const c of Object.values(map.components)) {
    const path = c.path.toLowerCase();
    const names = c.symbols.map((s) => `${s.name} ${s.route ? `${s.route.method} ${s.route.path}` : ""}`.toLowerCase()).join(" ");
    const summary = c.summary.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (names.split(/[^a-z0-9_/.-]+/).includes(w)) score += 5;
      else if (names.includes(w)) score += 3;
      if (path.includes(w)) score += 2;
      if (summary.includes(w)) score += 1;
    }
    if (score) scored.push([c.path, score + (c.live ? 0.5 : 0)]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([p]) => p);
}

/**
 * One symbol checked against the file as it is now: the same (the fingerprint matches at the same lines), moved (found by name and kind at
 * other lines, same fingerprint), changed (found, but its lines differ from what the map holds) or gone. The current range comes with it.
 */
export async function checkSymbol(path: string, text: string, s: MapSymbol): Promise<SymbolCheck> {
  return (await checkSymbols(path, text, [s]))[0]!;
}

export type SymbolCheck = { status: "same" | "moved" | "changed" | "gone"; start?: number; end?: number };

/** checkSymbol for several symbols of one file, with the file parsed once. */
export async function checkSymbols(path: string, text: string, symbols: readonly MapSymbol[]): Promise<SymbolCheck[]> {
  // The parser, not the regexes: only it knows where a definition ends, and the fingerprint covers to the end.
  await ensureGrammars([{ path, lang: languageOf(path) }]);
  const fresh = withHashes(text, extractSymbols(path, languageOf(path), text));
  return symbols.map((s) => verdict(s, fresh.find((x) => x.name === s.name && x.kind === s.kind)));
}

function verdict(s: MapSymbol, now: SymbolInfo | undefined): SymbolCheck {
  if (!now) return { status: "gone" };
  const range = { start: now.line, ...(now.endLine ? { end: now.endLine } : {}) };
  if (!s.hash || !now.hash) return { status: now.line === s.start ? "same" : "moved", ...range };
  if (now.hash !== s.hash) return { status: "changed", ...range };
  return { status: now.line === s.start ? "same" : "moved", ...range };
}

/** The map as a person reads it (.xode/MAP.md): the contents, a card per component, where new things go. Made from the data; never edited by hand. */
export function mapMarkdown(map: ProjectMap, o: { maxComponents?: number } = {}): string {
  const max = o.maxComponents ?? 600;
  const all = Object.values(map.components);
  const shown = all.slice(0, max);
  const lines = (s: MapSymbol) => (s.end && s.end !== s.start ? `${s.start}–${s.end}` : `${s.start}`);
  const status = (c: MapComponent) => (c.live === false ? " · unused: nothing leads here" : "");
  const out: string[] = [
    "# Project map",
    "",
    `Commit \`${map.commit.slice(0, 12)}\` · ${all.length} components in ${map.areas.length} areas. Made by Xode from the code; it is rebuilt after every change, so edit the code, not this file.`,
    "",
    "## Contents",
    "",
  ];
  const inArea = new Set<string>();
  for (const a of map.areas) {
    out.push(`### ${a.name}`, ...(a.summary ? [a.summary] : []), "");
    for (const p of a.components) { inArea.add(p); const c = map.components[p]!; out.push(`- \`${p}\`${c.summary ? ` — ${c.summary}` : ""}${status(c)}`); }
    out.push("");
  }
  const rest = all.filter((c) => !inArea.has(c.path));
  if (rest.length) {
    out.push("### Other", "");
    for (const c of rest) out.push(`- \`${c.path}\`${c.summary ? ` — ${c.summary}` : ""}${status(c)}`);
    out.push("");
  }
  out.push("## Components", "");
  for (const c of shown) {
    out.push(`### \`${c.path}\``);
    if (c.summary) out.push(c.summary);
    if (c.live === false) out.push("Unused: nothing leads here from the app's entry points.");
    out.push("");
    if (c.symbols.length) {
      out.push("| Symbol | Kind | Lines |", "|---|---|---|");
      for (const s of c.symbols.slice(0, 40)) out.push(`| \`${s.route ? `${s.route.method} ${s.route.path}` : s.name}\` | ${s.kind} | ${lines(s)} |`);
      if (c.symbols.length > 40) out.push(`| … ${c.symbols.length - 40} more | | |`);
      out.push("");
    }
    const list = (label: string, xs: string[]) => (xs.length ? [`- ${label}: ${xs.map((x) => `\`${x}\``).join(", ")}`] : []);
    out.push(
      ...list("Uses", c.uses), ...list("Used by", c.usedBy),
      ...(c.calls.length ? [`- Calls: ${c.calls.map((k) => `\`${k.to}\` (${k.names.join(", ")})`).join("; ")}`] : []),
      ...list("Tests", c.tests), "",
    );
  }
  if (all.length > shown.length) out.push(`${all.length - shown.length} more components are in map.json.`, "");
  if (map.placements.length) {
    out.push("## Where new things go", "");
    for (const p of map.placements) {
      out.push(`- **${p.kind}** in \`${p.folder}/\` (like ${p.examples.map((e) => `\`${e}\``).join(", ")})${p.registeredIn.length ? `; registered in ${p.registeredIn.map((r) => `\`${r}\``).join(", ")}` : ""}${p.testsIn ? `; tests in \`${p.testsIn}/\`` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}
