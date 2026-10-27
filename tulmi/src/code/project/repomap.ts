/**
 * THE REPO MAP: WHICH FILES ARE CLOSE TO WHAT THE REQUEST NAMES, BY WALKING THE DEFINITION/REFERENCE GRAPH FROM IT.
 *
 * After Aider's repo map. A file DEFINES names (functions, classes, types, constants: the symbols the brain keeps) and REFERS to names (what its parser
 * found it calling, instantiating, extending and using as a type: StoredFile.refs). A file that refers to a name another file defines depends on that
 * file. Those dependencies, plus the import edges the brain already resolves, are a graph over the repo's files. The graph is ranked by PageRank
 * PERSONALISED on the request: the walk restarts at the files and identifiers the request mentions, so the rank is proximity to what was named, not
 * popularity.
 *
 *   edges   referencer -> definer, for each name a file refers to that a different file defines; weighted the way Aider weights them:
 *             sqrt(times referred)                  a name used ten times counts, but not ten times
 *             x10  a name the request mentions      the identifier is the handle
 *             x10  a distinctive name (camelCase, snake_case, 8+ characters)    `parseConfigFile` says something, `get` does not
 *             x0.1 a name with a leading underscore (private by convention)
 *             x0.1 a name defined in more than five files (it is a convention, not a dependency)
 *           and referencer -> imported file, weight 1, so that a file read by regex (which has no references) still has its imports
 *   back    every edge also runs backwards at BACK (2) times its weight: a request that names two things is often about the code that uses both, and a walk that only follows references
 *           (Aider's) can never reach a caller. On the benchmark (evals/locate) back 0 finds none of them and back 2 most
 *   seeds   the restart distribution: a file the request names by path (1), a file that defines an identifier the request mentions (0.7; one that
 *           defines it among more than eight files is too ambiguous to seed), a file whose path has a component equal to a mentioned identifier or
 *           word (0.4)
 *   rank    power iteration, damping 0.85, a restart at the seeds (and for files with no edge at all)
 *
 * Without references (a repo read by regex, a Worker without the grammar) the graph is the import graph and the map still works, with less to go on.
 * Pure: nothing here reads a store; index.ts hands it the files and keeps the graph while the brain's row does not change.
 */
import type { StoredFile, SymbolInfo } from "./types.js";

export interface MapFile { path: string; symbols: readonly SymbolInfo[]; imports: readonly string[]; refs?: ReadonlyArray<readonly [string, number]> }

export interface MapSeeds {
  /** Names the request mentions, as written. */
  identifiers: readonly string[];
  /** Paths the request names, already found in the repo. */
  paths: readonly string[];
  /** Plain words (folder names, nouns) that may be in a path. */
  words?: readonly string[];
}

export interface MapHit {
  path: string;
  /** The walk's probability of ending at this file, 0 to 1 over all files. */
  rank: number;
  /** rank relative to the best file, 0 to 1. */
  q: number;
  /** The request names it (by path, or it defines a name the request mentions). */
  seed: boolean;
  why: string;
}

export interface MapOptions {
  /** How much of an edge's weight runs the other way. */
  back?: number;
  iterations?: number;
  damping?: number;
  /** Files returned, best first. */
  limit?: number;
}

export const DEFAULTS = { back: 2, iterations: 40, damping: 0.85, limit: 25 } as const;

const DEFINES = new Set(["function", "method", "class", "interface", "type", "enum", "struct", "trait", "const", "component", "module"]);
/** A name defined in more files than this is a convention (`render`, `handle`), not a dependency. */
const COMMON_AT = 5;
/** A mentioned identifier defined in more files than this does not name a place. */
const AMBIGUOUS_AT = 8;
const SEED = { path: 1, defines: 0.7, pathWord: 0.4 } as const;

const shortName = (n: string): string => n.slice(n.lastIndexOf(".") + 1);
const words = (s: string): string[] => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());

/** `parseConfigFile`, `parse_config_file`, anything of eight characters or more that is not one flat word. */
export function distinctive(name: string): boolean {
  return name.length >= 8 && (/[a-z][A-Z]/.test(name) || name.includes("_") || /^[A-Z][a-z]+[A-Z]/.test(name) || name.length >= 12);
}

interface RefEdge { from: number; name: string; to: number[]; w: number }

export class RepoGraph {
  readonly paths: string[];
  private readonly index = new Map<string, number>();
  /** Short name to the files that define it. */
  readonly defs = new Map<string, number[]>();
  private readonly defNames: Array<Set<string>>;
  private readonly tokens: Array<Set<string>>;
  private readonly refEdges: RefEdge[] = [];
  /** The reference edges leaving each file, and those arriving at it (for saying how two files are tied). */
  private readonly leaving: RefEdge[][];
  private readonly arriving: RefEdge[][];
  private readonly importEdges: Array<[number, number]> = [];
  readonly stats: { files: number; defined: number; refEdges: number; importEdges: number; withRefs: number };

  constructor(files: readonly MapFile[]) {
    this.paths = files.map((f) => f.path);
    this.paths.forEach((p, i) => this.index.set(p, i));
    this.defNames = files.map(() => new Set<string>());
    this.tokens = files.map((f) => new Set(words(f.path)));
    this.leaving = files.map(() => []);
    this.arriving = files.map(() => []);
    files.forEach((f, i) => {
      for (const s of f.symbols) {
        if (!DEFINES.has(s.kind) || s.exported === false) continue;
        const name = shortName(s.name);
        if (name.length < 3) continue;
        this.defNames[i]!.add(name);
        const list = this.defs.get(name);
        if (!list) this.defs.set(name, [i]); else if (!list.includes(i)) list.push(i);
      }
    });
    let withRefs = 0;
    files.forEach((f, i) => {
      for (const imp of f.imports) { const j = this.index.get(imp); if (j !== undefined && j !== i) this.importEdges.push([i, j]); }
      if (f.refs?.length) withRefs += 1;
      for (const [name, count] of f.refs ?? []) {
        const definers = this.defs.get(name)?.filter((j) => j !== i);
        if (!definers?.length) continue;
        let w = Math.sqrt(Math.max(1, count));
        if (distinctive(name)) w *= 10;
        if (name.startsWith("_")) w *= 0.1;
        if ((this.defs.get(name)?.length ?? 0) > COMMON_AT) w *= 0.1;
        const edge = { from: i, name, to: definers, w };
        this.refEdges.push(edge);
        this.leaving[i]!.push(edge);
        for (const j of definers) this.arriving[j]!.push(edge);
      }
    });
    this.stats = { files: files.length, defined: this.defs.size, refEdges: this.refEdges.length, importEdges: this.importEdges.length, withRefs };
  }

  has(path: string): boolean { return this.index.has(path); }

  /** The restart distribution for a request, or null when the request names nothing in this repo. */
  private seeds(s: MapSeeds): { p: Float64Array; why: Map<number, string> } | null {
    const p = new Float64Array(this.paths.length);
    const why = new Map<number, string>();
    const bump = (i: number, w: number, text: string) => { p[i] = (p[i] ?? 0) + w; if (!why.has(i)) why.set(i, text); };
    for (const path of s.paths) { const i = this.index.get(path); if (i !== undefined) bump(i, SEED.path, "named in the request"); }
    const mentioned = new Set(s.identifiers);
    for (const id of mentioned) {
      const definers = this.defs.get(id);
      if (definers && definers.length <= AMBIGUOUS_AT) for (const j of definers) bump(j, SEED.defines, `defines ${id}`);
    }
    const asked = new Set([...mentioned].flatMap(words).concat((s.words ?? []).flatMap(words)).filter((w) => w.length >= 3));
    if (asked.size) {
      let hits = 0;
      for (let i = 0; i < this.tokens.length && hits < 40; i += 1) {
        const t = this.tokens[i]!;
        // A path whose name holds every word of a mentioned identifier (`SignupForm.tsx` for signupForm) is as good as a named path.
        const match = [...asked].filter((w) => t.has(w)).length;
        if (match && match >= Math.min(2, asked.size)) { bump(i, SEED.pathWord * Math.min(1, match / 2), "its path has words of the request"); hits += 1; }
      }
    }
    let sum = 0;
    for (const v of p) sum += v;
    if (sum <= 0) return null;
    for (let i = 0; i < p.length; i += 1) p[i]! /= sum;
    return { p, why };
  }

  /** The files nearest to what the request names, best first; empty when it names nothing here. */
  rank(seeds: MapSeeds, opts: MapOptions = {}): MapHit[] {
    const n = this.paths.length;
    const start = this.seeds(seeds);
    if (!n || !start) return [];
    const { p, why } = start;
    const back = opts.back ?? DEFAULTS.back;
    const damping = opts.damping ?? DEFAULTS.damping;
    const iterations = opts.iterations ?? DEFAULTS.iterations;
    const mentioned = new Set(seeds.identifiers);

    // Adjacency: for each file, who it sends rank to and how much.
    const to: number[][] = Array.from({ length: n }, () => []);
    const weight: number[][] = Array.from({ length: n }, () => []);
    const link = (a: number, b: number, w: number) => { to[a]!.push(b); weight[a]!.push(w); };
    for (const e of this.refEdges) {
      const w = e.w * (mentioned.has(e.name) ? 10 : 1);
      for (const j of e.to) { link(e.from, j, w); if (back > 0) link(j, e.from, w * back); }
    }
    for (const [a, b] of this.importEdges) { link(a, b, 1); if (back > 0) link(b, a, back); }
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) { let s = 0; for (const w of weight[i]!) s += w; out[i] = s; }

    let r = Float64Array.from(p);
    for (let it = 0; it < iterations; it += 1) {
      const next = new Float64Array(n);
      let dangling = 0;
      for (let i = 0; i < n; i += 1) {
        const ri = r[i]!;
        if (!ri) continue;
        if (out[i]! <= 0) { dangling += ri; continue; }
        const share = (damping * ri) / out[i]!;
        const tj = to[i]!, wj = weight[i]!;
        for (let k = 0; k < tj.length; k += 1) next[tj[k]!]! += share * wj[k]!;
      }
      // What a file with nowhere to send it, and what is not followed, goes back to the request's own files.
      const restart = 1 - damping + damping * dangling;
      let delta = 0;
      for (let i = 0; i < n; i += 1) { next[i]! += restart * p[i]!; delta += Math.abs(next[i]! - r[i]!); }
      r = next;
      if (delta < 1e-9) break;
    }

    const order: number[] = [];
    for (let i = 0; i < n; i += 1) if (r[i]! > 0) order.push(i);
    order.sort((a, b) => r[b]! - r[a]! || (this.paths[a]! < this.paths[b]! ? -1 : 1));
    const top = order.slice(0, opts.limit ?? DEFAULTS.limit);
    const best = r[top[0] ?? 0] || 1;
    return top.map((i) => ({ path: this.paths[i]!, rank: r[i]!, q: r[i]! / best, seed: why.has(i) && p[i]! > 0, why: why.get(i) ?? this.explain(i, p, mentioned) }));
  }

  /** In a few words, how a file is tied to the seeds: it uses a name a seed defines, or a seed uses one it defines. */
  private explain(i: number, p: Float64Array, mentioned: ReadonlySet<string>): string {
    let best: { w: number; text: string } | null = null;
    for (const e of this.leaving[i]!) {
      const w = e.w * (mentioned.has(e.name) ? 10 : 1);
      for (const j of e.to) if (p[j]! > 0 && (!best || w > best.w)) best = { w, text: `uses ${e.name}, from ${this.paths[j]}` };
    }
    for (const e of this.arriving[i]!) {
      const w = e.w * (mentioned.has(e.name) ? 10 : 1);
      if (p[e.from]! > 0 && (!best || w > best.w)) best = { w, text: `defines ${e.name}, used by ${this.paths[e.from]}` };
    }
    if (best) return best.text;
    for (const [a, b] of this.importEdges) {
      if (a === i && p[b]! > 0) return `imports ${this.paths[b]}`;
      if (b === i && p[a]! > 0) return `is imported by ${this.paths[a]}`;
    }
    return "close to what the request names";
  }
}

/** The files of a brain as the graph takes them. */
export function mapFiles(files: readonly StoredFile[]): MapFile[] {
  return files.map((f) => ({ path: f.path, symbols: f.symbols, imports: f.imports, ...(f.refs ? { refs: f.refs } : {}) }));
}
