/**
 * LOCATE: WHERE IN THE REPO DOES THIS REQUEST BELONG? A FUNNEL, CHEAP END FIRST.
 *
 *   locate(task, brain, { model, read? })
 *     -> { targets: [{ path, lines?, why, signals, score }], related, tests, confidence, question? }
 *
 * Most of the cost of a coding job is paid in the first minute, by a model
 * reading the wrong files. The brain (layer 4) already knows the repo, so finding
 * the right one is a search problem first and a model problem only when the
 * search is honestly unsure:
 *
 *   1. CUES (cues.ts), for nothing: the quoted strings, the UI words, the
 *      identifiers, the paths, the routes, the error lines and stack frames, and
 *      the feature nouns of the request.
 *   2. SIX SIGNALS, each a ranked list of files, each a read of the brain:
 *        path     a file the request names (or a stack frame points at)
 *        text     the strings a person sees (findTexts): very strong for UI tasks
 *        symbol   functions, classes and routes (findSymbols)
 *        file     path and summary words (findFiles)
 *        feature  the feature map (feature)
 *        map      the repo map (project/repomap.ts): the files nearest, in the definition/reference graph, to the files and identifiers the request
 *                 names, by PageRank restarted at them. It finds what the other five cannot: the callers and the callees of the thing that was named
 *      How central a file is and how often it changes are a weak prior, no more.
 *      When the free cues find fewer than two STRONG hits, the cheap tier is asked
 *      once for synonyms (signup, register, create account) and the signals run
 *      again with them.
 *   3. FUSION. Weighted reciprocal-rank fusion: a file's score is the sum, over
 *      the signals that found it, of the signal's weight times how good the match
 *      was times 1/(K + rank). A file two signals agree on beats a file one signal
 *      found, however well. The sum is squashed into [0, 1).
 *   4. ONE HOP. neighbors() of the top three (who imports them, what they import)
 *      and testsFor(): the places a change spills into.
 *   5. CONFIDENCE, from the margin between the first and the second and from how
 *      many of the signals that found anything agree on the first:
 *        over 0.75     done, no model
 *        0.45 to 0.75  the cheap tier reads excerpts of the top eight (the head,
 *                      the exports, the matched lines and the 20 around them) and
 *                      picks; if it cannot separate two, it is a tie
 *        under 0.45, or a tie that is still there: a crisp question with two or
 *                      three labelled options. The agent loop turns it into
 *                      needs_you
 *
 * A model that is down, or a job that cannot afford a call, costs only the step
 * it was for: the answer so far stands, with the confidence it had. `read` is the
 * workspace's file read; without it the excerpts are what the brain knows (the
 * summary, the exports, the matched strings).
 *
 * Everything a model is shown of the request is fenced as data, and a request the
 * secret scan flags is not shown to it at all.
 */
import { z } from "zod";
import type { BrainHandle } from "../project/index.js";
import type { MapHit } from "../project/repomap.js";
import { tokenize } from "../project/search.js";
import { isTestPath } from "../project/lang.js";
import type { StoredFile } from "../project/types.js";
import { scanForSecrets } from "../policy.js";
import { errorMessage, extractCues, isVague, looksLikeIdentifier, type Cues } from "./cues.js";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "./model.js";

// ------------------------------------------------------------------- shapes

export type SignalId = "path" | "text" | "symbol" | "file" | "feature" | "map";

/** What locate asks of a brain. `repoMap` is optional: a brain without it (a test's stand-in) simply has no sixth signal. */
export type LocateBrain = Pick<BrainHandle, "findFiles" | "findSymbols" | "findTexts" | "neighbors" | "testsFor" | "feature" | "features" | "file"> & Partial<Pick<BrainHandle, "repoMap">>;

/** How the repo map takes part. The defaults are what ships; the benchmark (evals/locate) turns the pieces on and off. */
export interface MapSettings {
  /** false: no repo map at all (the five signals only). */
  on?: boolean;
  /** What the signal counts for in the fusion. */
  weight?: number;
  /** How much of an edge's weight runs backwards (callers of what was named). */
  back?: number;
  /** Whether the files the request names (and the ones that define what it names) are in the map's own list, or only the files near them. */
  seeds?: boolean;
}

export const MAP_DEFAULTS = { on: true, weight: 2.5, back: 2, seeds: false } as const satisfies Required<MapSettings>;

export interface LocateTarget {
  path: string;
  /** Where the evidence points (a matched string, a symbol, a frame), not how far the change goes. */
  lines?: [number, number];
  why: string;
  signals: SignalId[];
  /** 0 to 1. */
  score: number;
}

export interface RelatedFile { path: string; relation: "imports" | "imported_by"; of: string }

export interface LocateOption {
  label: "A" | "B" | "C";
  /** A file, or the name of a part of the app when no file stood out. */
  title: string;
  path?: string;
  why: string;
}

export interface LocateQuestion {
  /** The question, with the options written out, ready to show. */
  text: string;
  options: LocateOption[];
}

export interface Located {
  targets: LocateTarget[];
  related: RelatedFile[];
  tests: string[];
  /** 0 to 1. */
  confidence: number;
  question?: LocateQuestion;
  /** What the model was asked, and what it cost. */
  used: { expanded: boolean; picked: boolean; paise: number; skipped?: "budget" | "down" };
}

export interface LocateOptions {
  model: ModelCtx;
  /** A file's text on the work branch (workspace().read). Without it, excerpts are what the brain knows. */
  read?: (path: string) => Promise<string | null>;
  /** Cues already extracted. */
  cues?: Cues;
  /** The repo map's part (on by default). */
  map?: MapSettings;
}

// ------------------------------------------------------------------- numbers

/** Above this the answer stands; at or below it the cheap tier reads. */
export const CONFIDENT = 0.75;
/** Below this the answer is a question. */
export const UNSURE = 0.45;
/** Reciprocal-rank fusion's constant. Small, because the lists are short and the top of each is what counts. */
export const RRF_K = 6;
/** Half-saturation of the squash from the fused sum to a score. */
const HALF = 0.7;
/** A weak prior: how central a file is and how hot, never more than this much of a score. */
const PRIOR = 0.04;
/** A hit this good is a strong hit. */
const STRONG_Q = 0.8;
const LIST_MAX = 25;
const EXCERPT_FILES = 8;
const EXCERPT_CHARS = 1500;
const WINDOW = 20;
/** The most a model call here may write. */
const EXPAND_TOKENS = 300;
const PICK_TOKENS = 500;

export interface Weights {
  path: number; text: number; symbol: number; file: number; feature: number; map?: number;
  /** What a test file's evidence counts for, against the same evidence in a source file: 1 when the request is about tests, less when it is not. */
  tests?: number;
}

/** A test file is a place the change is CHECKED, listed on its own (`tests`); it is not where a change to behaviour is made, unless the request is about tests. */
export const TEST_FILE_WEIGHT = 0.5;
const ABOUT_TESTS = /\b(?:tests?|specs?|testing|coverage|jest|vitest|pytest|mocha|unittest|e2e)\b/i;
export const wantsTests = (c: Cues): boolean => [...c.nouns, ...c.identifiers, ...c.paths, ...c.dirs, ...c.quoted].some((w) => ABOUT_TESTS.test(w) || isTestPath(w));

/** What each signal counts for, by what the request is about. */
export function weightsFor(c: Cues, map?: MapSettings): Weights {
  const w: Weights = { path: 1.6, text: 1, symbol: 0.9, file: 0.6, feature: 0.4, map: map?.weight ?? MAP_DEFAULTS.weight, tests: wantsTests(c) ? 1 : TEST_FILE_WEIGHT };
  if (c.ui) { w.text = 1.3; w.symbol = 0.8; }
  if (c.identifiers.length || c.routes.length) w.symbol = Math.max(w.symbol, 1.2);
  if (c.errors.length || c.frames.length) w.path = 1.8;
  return w;
}

// ------------------------------------------------------------------- hits

interface Hit { path: string; q: number; whys: string[]; lines: number[] }

/** Hits by file: the best quality, the reasons (three at most) and the lines. */
class Hits {
  private by = new Map<string, Hit & { n: number }>();
  add(path: string, q: number, why: string, line?: number): void {
    if (!path || q <= 0) return;
    const h = this.by.get(path) ?? { path, q: 0, whys: [], lines: [], n: 0 };
    h.q = Math.max(h.q, q);
    h.n += 1;
    if (why && !h.whys.includes(why) && h.whys.length < 3) h.whys.push(why);
    if (line !== undefined && !h.lines.includes(line) && h.lines.length < 6) h.lines.push(line);
    this.by.set(path, h);
  }
  ranked(): Hit[] {
    return [...this.by.values()].sort((a, b) => b.q - a.q || b.n - a.n || (a.path < b.path ? -1 : 1)).slice(0, LIST_MAX);
  }
}

interface Query { q: string; weight: number }

const queries = (...xs: Array<[string, number]>): Query[] => {
  const seen = new Set<string>();
  const out: Query[] = [];
  for (const [q, weight] of xs) {
    const t = q.trim();
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push({ q: t, weight });
  }
  return out;
};

/** How well a visible string answers a query: 1 when it is the string. */
export function textQuality(query: string, text: string): number {
  const lq = query.trim().toLowerCase();
  const x = text.toLowerCase();
  const value = x.includes(": ") ? x.slice(x.indexOf(": ") + 2) : x;
  if (value === lq || x === lq) return 1;
  if (value.startsWith(lq)) return 0.85;
  if (value.includes(lq)) return 0.7;
  const words = tokenize(lq).filter((w) => w.length >= 2);
  const doc = tokenize(x);
  if (words.length && words.every((w) => doc.some((d) => d.startsWith(w)))) return 0.45;
  // Some of the words, which the search's fall-back to "any word" finds: not a match.
  return 0;
}

const settle = async <T>(xs: Array<Promise<T>>): Promise<T[]> => (await Promise.allSettled(xs)).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

// ------------------------------------------------------------ the signals

interface Signals { path: Hit[]; text: Hit[]; symbol: Hit[]; file: Hit[]; feature: Hit[]; map?: Hit[] }

/** A path from the request or a trace, found in the brain: as written, or by its tail, or by its name. */
export async function resolvePath(brain: Pick<LocateBrain, "file" | "findFiles">, p: string): Promise<string | null> {
  const clean = p.replace(/^\.?\/+/, "");
  if (!clean) return null;
  if (await brain.file(clean)) return clean;
  const parts = clean.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const tail = parts.slice(i).join("/");
    if (await brain.file(tail)) return tail;
  }
  // A path from a build machine, or one that lost its first folder: a file whose path ends with what was written, or whose name is it and is alone.
  const name = parts[parts.length - 1]!;
  const found = (await brain.findFiles(clean.replace(/\.[^./]+$/, ""), 12).catch(() => [])).map((f) => f.path);
  const tails = found.filter((f) => f === clean || f.endsWith(`/${clean}`));
  if (tails.length === 1) return tails[0]!;
  const named = found.filter((f) => f.slice(f.lastIndexOf("/") + 1) === name);
  return named.length === 1 ? named[0]! : null;
}

async function pathSignal(brain: LocateBrain, c: Cues): Promise<Hit[]> {
  const h = new Hits();
  // The first frame is where it broke; each frame further out is a little less likely to be where it is fixed.
  for (const [i, f] of c.frames.entries()) {
    const p = await resolvePath(brain, f.path);
    if (p) h.add(p, Math.max(0.5, 1 - 0.15 * i), f.line ? `the stack trace points at line ${f.line}` : "named in the stack trace", f.line);
  }
  for (const raw of c.paths) {
    const p = await resolvePath(brain, raw);
    if (p) h.add(p, 0.95, "named in the request");
  }
  return h.ranked();
}

async function textSignal(brain: LocateBrain, c: Cues, more: Query[]): Promise<Hit[]> {
  const h = new Hits();
  const qs = queries(
    ...c.quoted.map((q): [string, number] => [q, 1]),
    ...c.uiPhrases.map((q): [string, number] => [q, 0.9]),
    ...c.errors.map((e): [string, number] => [errorMessage(e), 0.6]),
    ...(c.phrase ? [[c.phrase, c.ui ? 0.5 : 0.35] as [string, number]] : []),
    ...more.map((m): [string, number] => [m.q, m.weight]),
  ).slice(0, 10);
  const got = await settle(qs.map(async (q) => ({ q, hits: await brain.findTexts(q.q, 15) })));
  for (const { q, hits } of got) {
    for (const t of hits) h.add(t.path, textQuality(q.q, t.text) * q.weight, `shows "${cut(t.text.includes(": ") ? t.text.slice(t.text.indexOf(": ") + 2) : t.text, 60)}" (line ${t.line})`, t.line);
  }
  return h.ranked();
}

async function symbolSignal(brain: LocateBrain, c: Cues, more: Query[]): Promise<Hit[]> {
  const h = new Hits();
  const qs = queries(
    ...c.identifiers.map((q): [string, number] => [q, 1]),
    ...c.routes.map((q): [string, number] => [q, 1]),
    ...(c.phrase && c.nouns.length > 1 ? [[c.phrase, 0.55] as [string, number]] : []),
    ...c.nouns.slice(0, 4).map((q): [string, number] => [q, 0.5]),
    ...more.map((m): [string, number] => [m.q, m.weight * 0.9]),
  ).slice(0, 12);
  const got = await settle(qs.map(async (q) => ({ q, hits: await brain.findSymbols(q.q, 15) })));
  for (const { q, hits } of got) {
    for (const s of hits) {
      // (A symbol hit's `path` is its file's; a route's own path is its name.)
      const what = s.kind === "route" ? `serves ${s.method ?? "ANY"} ${s.name}` : `defines ${s.name} (${s.kind})`;
      h.add(s.path ?? "", Math.min(1, s.score / 100) * q.weight, `${what}, line ${s.line}`, s.line);
    }
  }
  return h.ranked();
}

async function fileSignal(brain: LocateBrain, c: Cues, more: Query[]): Promise<Hit[]> {
  const h = new Hits();
  const qs = queries(
    ...c.identifiers.filter((i) => /^[A-Z]/.test(i) || i.includes("_") === false).map((q): [string, number] => [q, 0.9]),
    ...c.paths.map((q): [string, number] => [q.replace(/\.[^./]+$/, ""), 0.8]),
    ...c.dirs.map((q): [string, number] => [q, 0.5]),
    ...c.routes.map((q): [string, number] => [q, 0.7]),
    ...(c.phrase ? [[c.phrase, 0.6] as [string, number]] : []),
    ...c.nouns.slice(0, 3).map((q): [string, number] => [q, 0.4]),
    ...more.map((m): [string, number] => [m.q, m.weight * 0.8]),
  ).slice(0, 12);
  const got = await settle(qs.map(async (q) => ({ q, hits: await brain.findFiles(q.q, 10) })));
  for (const { q, hits } of got) {
    for (const f of hits) {
      const why = f.symbols[0] ? `has ${f.symbols[0].name}` : f.summary ? cut(f.summary, 80) : `its path matches "${q.q}"`;
      h.add(f.path, Math.min(1, f.score / 90) * q.weight, why);
    }
  }
  return h.ranked();
}

async function featureSignal(brain: LocateBrain, c: Cues, more: Query[]): Promise<Hit[]> {
  const h = new Hits();
  const names = queries(
    ...(c.phrase ? [[c.phrase, 1] as [string, number]] : []),
    ...c.nouns.slice(0, 3).map((q): [string, number] => [q, 0.8]),
    ...more.map((m): [string, number] => [m.q, m.weight]),
  ).slice(0, 8);
  const seen = new Set<string>();
  const got = await settle(names.map(async (n) => ({ n, f: await brain.feature(n.q) })));
  for (const { n, f } of got) {
    if (!f || seen.has(f.key ?? f.name)) continue;
    seen.add(f.key ?? f.name);
    const exact = f.name.toLowerCase() === n.q.toLowerCase() || f.key?.toLowerCase() === n.q.toLowerCase();
    for (const p of f.files.slice(0, 12)) h.add(p, 0.7 * (exact ? 1 : 0.7) * n.weight, `in the "${f.name}" part of the app`);
  }
  return h.ranked();
}

/**
 * The repo map's list: the files nearest, in the graph, to the paths and identifiers the request names. Empty when the request names none, when the brain has
 * no map, or when it is switched off. A file the request itself names is by default not in this list (the path and symbol signals have it): the map is
 * for the files AROUND it, the callers and the callees.
 */
async function mapSignal(brain: LocateBrain, c: Cues, named: readonly Hit[], settings: MapSettings | undefined): Promise<Hit[]> {
  const cfg = { ...MAP_DEFAULTS, ...settings };
  if (!cfg.on || !brain.repoMap) return [];
  const identifiers = [...new Set([...c.identifiers, ...c.quoted.filter(looksLikeIdentifier)])];
  const paths = named.filter((h) => h.q >= 0.5).map((h) => h.path);
  if (!identifiers.length && !paths.length) return [];
  let found: MapHit[];
  try { found = await brain.repoMap({ identifiers, paths, words: c.dirs }, { back: cfg.back }); } catch { return []; }
  const h = new Hits();
  for (const m of found) {
    if (m.seed && !cfg.seeds) continue;
    // The best neighbour is nearly as good as a named file; the far ones count for little.
    const q = Math.min(0.9, m.q * (m.seed ? 0.9 : 0.8));
    if (q < 0.1) continue;
    h.add(m.path, q, `${m.why} (repo map)`);
  }
  return h.ranked();
}

async function runSignals(brain: LocateBrain, c: Cues, more: Query[]): Promise<Signals> {
  const [path, text, symbol, file, feature] = await Promise.all([
    pathSignal(brain, c), textSignal(brain, c, more), symbolSignal(brain, c, more), fileSignal(brain, c, more), featureSignal(brain, c, more),
  ]);
  return { path, text, symbol, file, feature };
}

/**
 * The repo map is the funnel's second look, not its first: when the five signals are already sure (over CONFIDENT: a path, a stack trace, one exact
 * symbol) the map is not asked, so that a decisive answer stays decisive and a map's neighbours never cost the answer its confidence. When they are not
 * sure, and the request does not name just one place, the map's list is added and the signals are fused again. Returns the fusion to go on with, and
 * whether the map was added.
 */
async function consultMap(brain: LocateBrain, c: Cues, signals: Signals, weights: Weights, fused: Fused[], settings?: MapSettings): Promise<{ fused: Fused[]; used: boolean }> {
  if (!(settings?.on ?? MAP_DEFAULTS.on) || confidenceOf(fused).value > CONFIDENT) return { fused, used: false };
  // A request that names ONE place is about that place: its callers and callees are not asked about. Naming two or more, or none the index could place, is when the files
  // that tie them together are worth a look.
  const named = new Set<string>();
  for (const id of ["path", "symbol", "file"] as const) for (const h of signals[id]) if (h.q >= STRONG_Q) named.add(h.path);
  if (named.size === 1) return { fused, used: false };
  const map = await mapSignal(brain, c, signals.path, settings);
  if (!map.length) return { fused, used: false };
  signals.map = map;
  const again = fuse(signals, weights);
  await withPrior(brain, again);
  return { fused: again, used: true };
}

/** Strong hits: a signal that found a file almost exactly (the string itself, the symbol by name, the file by name). */
export function strongHits(s: Signals): number {
  let n = 0;
  for (const id of ["path", "text", "symbol", "file"] as const) for (const h of s[id]) if (h.q >= STRONG_Q) n += 1;
  return n;
}

// ------------------------------------------------------------------ fusion

export interface Fused {
  path: string;
  /** The squashed fusion, plus a weak prior. 0 to 1. */
  score: number;
  raw: number;
  /** The signals that found it with a real match. */
  signals: SignalId[];
  /** Signals it is in the top three of. */
  top3: SignalId[];
  whys: string[];
  lines: number[];
}

const IDS: readonly SignalId[] = ["path", "text", "symbol", "file", "feature", "map"];

export function fuse(s: Signals, w: Weights): Fused[] {
  const by = new Map<string, Fused>();
  for (const id of IDS) {
    (s[id] ?? []).forEach((h, i) => {
      const f = by.get(h.path) ?? { path: h.path, score: 0, raw: 0, signals: [], top3: [], whys: [], lines: [] };
      f.raw += (w[id] ?? 0) * h.q * ((RRF_K + 1) / (RRF_K + i + 1));
      if (h.q >= 0.3 && !f.signals.includes(id)) f.signals.push(id);
      if (i < 3 && h.q >= 0.45 && !f.top3.includes(id)) f.top3.push(id);
      for (const y of h.whys) if (!f.whys.includes(y) && f.whys.length < 4) f.whys.push(y);
      for (const l of h.lines) if (!f.lines.includes(l)) f.lines.push(l);
      by.set(h.path, f);
    });
  }
  const out = [...by.values()];
  // A test file that shares a word with the request (a helper called addTodo, a describe block) is not where the change goes: its evidence counts for less, unless
  // the request is about tests. (Without this, two test files outranked the hook that held the state in a React app, and the plan was written for the wrong files.)
  for (const f of out) if (isTestPath(f.path)) f.raw *= w.tests ?? 1;
  for (const f of out) f.score = f.raw / (f.raw + HALF);
  return out.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
}

/** The prior: central and often-changed files are likelier, a little. Only files already found are asked about. */
async function withPrior(brain: Pick<LocateBrain, "file">, fused: Fused[], n = 12): Promise<void> {
  const rows = await settle(fused.slice(0, n).map((f) => brain.file(f.path)));
  const byPath = new Map(rows.filter((r): r is StoredFile => !!r).map((r) => [r.path, r]));
  for (const f of fused.slice(0, n)) {
    const r = byPath.get(f.path);
    if (r) f.score = Math.min(0.99, f.score + PRIOR * (0.7 * r.rank + 0.3 * Math.min(1, r.hot / 10)));
  }
  fused.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
}

export interface Confidence {
  value: number;
  /** How far ahead the first is of the second, in the fused evidence: 0 for level, 1 for nothing second. */
  margin: number;
  /** Signals that have the first in their top three with a real match, and a named path counting twice. */
  support: number;
}

/** The weight of "none of these" in the evidence, so a lone weak hit is not mistaken for a sure one. */
const NONE = 0.5;

/**
 * How sure the first is. Each file's evidence is its fused sum; the first's share
 * of all the evidence (squared, so a strong hit counts for more than several
 * faint ones, with "none of these" in the pot) is the base, and the signals that
 * agree on it raise it: one signal alone caps it at 0.9 of that, two or more
 * leave it whole. A level race has a share near a half, a clear first near one,
 * and a lone faint hit near nothing.
 */
export function confidenceOf(fused: readonly Fused[]): Confidence {
  const first = fused[0];
  if (!first) return { value: 0, margin: 0, support: 0 };
  const second = fused[1]?.raw ?? 0;
  const margin = (first.raw - second) / first.raw;
  const pot = fused.reduce((a, f) => a + f.raw * f.raw, 0) + NONE * NONE;
  const support = first.top3.length + (first.top3.includes("path") ? 1 : 0);
  const value = (first.raw * first.raw / pot) * Math.min(1, 0.8 + 0.1 * support);
  return { value: Math.max(0, Math.min(1, value)), margin, support };
}

// --------------------------------------------------------------- the model

export const SynonymReply = z.object({ terms: z.array(z.string()).max(12) });
export const PickReply = z.object({ picks: z.array(z.object({ path: z.string(), why: z.string().optional() })).max(3), sure: z.boolean() });

/** The terms a model offered, as they are kept: short, plain, once each, nothing a secret scan flags. */
export function cleanTerms(raw: readonly unknown[], max = 8): string[] {
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const s = oneLine(t, 40).toLowerCase().replace(/[^\p{L}\p{N} _./-]+/gu, " ").replace(/\s+/g, " ").trim();
    if (s.length < 3 || out.includes(s) || scanForSecrets([{ path: "term.txt", content: s }]).length) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

async function expandTerms(task: string, c: Cues, brain: LocateBrain, ctx: ModelCtx): Promise<{ terms: string[]; paise: number; skipped?: "budget" | "down" }> {
  const features = (await brain.features().catch(() => [])).slice(0, 12).map((f) => f.name);
  // The words already tried come from the request: none of them goes to a model if the request holds a secret, and none that is one on its own.
  const tainted = scanForSecrets([{ path: "request.txt", content: task }]).length > 0;
  const shown = tainted ? [] : [...c.quoted, ...c.uiPhrases, ...c.nouns, ...c.identifiers].filter((w) => !scanForSecrets([{ path: "term.txt", content: w }]).length).slice(0, 12);
  const r = await askJson(ctx, {
    tier: "cheap", purpose: "work.locate.expand", schema: SynonymReply, maxTokens: EXPAND_TOKENS, role: "locate_terms",
    user: [
      `<request>\n${fence(cut(forModel(task), 600))}\n</request>`,
      `words already tried: ${shown.join(", ") || "(none)"}`,
      features.length ? `parts of this app: ${features.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
  });
  if (!r.ok) return { terms: [], paise: 0, skipped: r.reason === "budget" ? "budget" : "down" };
  const tried = new Set([...c.nouns, ...c.quoted.map((q) => q.toLowerCase())]);
  return { terms: cleanTerms(r.value.terms).filter((t) => !tried.has(t)), paise: r.paise };
}

/** What a model is shown of one candidate: the summary, the exports, the head, and the lines the evidence points at with 20 on each side. */
export async function excerptFor(f: Fused, row: StoredFile | null, read: LocateOptions["read"]): Promise<string> {
  const out: string[] = [];
  if (row?.summary) out.push(`summary: ${cut(row.summary, 200)}`);
  const exported = (row?.symbols ?? []).filter((s) => s.kind !== "env" && s.kind !== "entry" && (s.exported !== false || s.kind === "route"));
  if (exported.length) out.push(`exports: ${exported.slice(0, 12).map((s) => (s.kind === "route" ? `${s.method ?? "ANY"} ${s.path ?? s.name}` : `${s.kind} ${s.name}`)).join(", ")}`);
  if (f.whys.length) out.push(`matched: ${f.whys.join("; ")}`);
  let text: string | null = null;
  if (read) { try { text = await read(f.path); } catch { text = null; } }
  if (text && !scanForSecrets([{ path: f.path, content: text }]).length) {
    const lines = text.split("\n");
    out.push(`head:\n${cut(lines.slice(0, 14).join("\n"), 500)}`);
    const seen: Array<[number, number]> = [];
    for (const l of f.lines.slice(0, 3)) {
      const from = Math.max(1, l - WINDOW), to = Math.min(lines.length, l + WINDOW);
      if (seen.some(([a, b]) => from <= b && to >= a)) continue;
      seen.push([from, to]);
      out.push(`lines ${from}-${to}:\n${cut(lines.slice(from - 1, to).map((x, i) => `${from + i}: ${x.slice(0, 160)}`).join("\n"), 700)}`);
    }
  }
  return cut(out.join("\n"), EXCERPT_CHARS);
}

async function pickFrom(task: string, fused: Fused[], brain: LocateBrain, read: LocateOptions["read"], ctx: ModelCtx): Promise<{ picks: Array<{ path: string; why: string }>; sure: boolean; paise: number } | { skipped: "budget" | "down" }> {
  const top = fused.slice(0, EXCERPT_FILES);
  const rows = await settle(top.map((f) => brain.file(f.path)));
  const byPath = new Map(rows.filter((r): r is StoredFile => !!r).map((r) => [r.path, r]));
  const parts: string[] = [];
  for (const f of top) parts.push(`<excerpt path="${f.path}">\n${fence(await excerptFor(f, byPath.get(f.path) ?? null, read))}\n</excerpt>`);
  const r = await askJson(ctx, {
    tier: "cheap", purpose: "work.locate.pick", schema: PickReply, maxTokens: PICK_TOKENS, role: "locate_pick",
    user: `<request>\n${fence(cut(forModel(task), 800))}\n</request>\n${parts.join("\n")}`,
  });
  if (!r.ok) return { skipped: r.reason === "budget" ? "budget" : "down" };
  const asked = new Set(top.map((f) => f.path));
  const picks: Array<{ path: string; why: string }> = [];
  for (const p of r.value.picks) {
    if (!asked.has(p.path) || picks.some((x) => x.path === p.path)) continue;
    picks.push({ path: p.path, why: oneLine(p.why, 160) });
  }
  return { picks, sure: r.value.sure && picks.length > 0, paise: r.paise };
}

// ---------------------------------------------------------------- the answer

const LABELS = ["A", "B", "C"] as const;

const whyOf = (f: Pick<Fused, "whys" | "signals">): string => f.whys[0] ?? (f.signals.length ? `matched by ${f.signals.join(" and ")}` : "a possible match");

function targetOf(f: Fused, why?: string): LocateTarget {
  const lines = f.lines.length ? ([Math.min(...f.lines), Math.max(...f.lines)] as [number, number]) : undefined;
  return { path: f.path, ...(lines ? { lines } : {}), why: why ? cut(why, 200) : whyOf(f), signals: f.signals, score: Math.round(f.score * 1000) / 1000 };
}

/** The question for a request that cannot be placed: two or three labelled options, written out. */
export async function questionFor(fused: readonly Fused[], brain: Pick<LocateBrain, "features">): Promise<LocateQuestion> {
  const distinct: Fused[] = [];
  for (const f of fused) { if (!distinct.some((d) => d.path === f.path)) distinct.push(f); if (distinct.length === 3) break; }
  const options: LocateOption[] = distinct.map((f, i) => ({ label: LABELS[i]!, title: f.path, path: f.path, why: cut(whyOf(f), 140) }));
  let lead = distinct.length > 1
    ? "I found more than one place this could be. Which one do you mean?"
    : distinct.length === 1 ? "I found one possible place but I am not sure. Is this it?" : "I can't tell where this belongs. Which part of the app is it about?";
  if (options.length < 2) {
    // Too little to choose between: the parts of the app fill the options.
    const features = (await brain.features().catch(() => [])).filter((f) => !options.some((o) => o.path && f.files.includes(o.path))).slice(0, 3 - options.length);
    for (const f of features) options.push({ label: LABELS[options.length]!, title: f.name, path: f.files[0], why: cut(f.summary || `${f.fileCount} files`, 140) });
    if (!distinct.length && options.length) lead = "I can't tell which part of the app this is about. Which one?";
  }
  const text = [lead, ...options.map((o) => `${o.label}) ${o.title}: ${o.why}`), "Or tell me another."].join("\n");
  return { text, options };
}

async function around(brain: LocateBrain, targets: LocateTarget[]): Promise<{ related: RelatedFile[]; tests: string[] }> {
  const top = targets.slice(0, 3);
  const [near, tested] = await Promise.all([
    settle(top.map(async (t) => ({ t, n: await brain.neighbors(t.path) }))),
    settle(top.map((t) => brain.testsFor(t.path))),
  ]);
  const have = new Set(targets.map((t) => t.path));
  const related: RelatedFile[] = [];
  for (const { t, n } of near) {
    for (const p of n.importedBy.slice(0, 8)) if (!have.has(p) && !related.some((r) => r.path === p)) related.push({ path: p, relation: "imported_by", of: t.path });
    for (const p of n.imports.slice(0, 8)) if (!have.has(p) && !related.some((r) => r.path === p)) related.push({ path: p, relation: "imports", of: t.path });
  }
  const tests = [...new Set(tested.flat())].filter((p) => !have.has(p));
  // The tests are what a change to the target is checked by: a test the importers' neighbours found is a test file, not a place to work.
  return { related: related.filter((r) => !isTestPath(r.path)).slice(0, 12), tests: tests.slice(0, 10) };
}

// ------------------------------------------------------------------- locate

export async function locate(task: string, brain: LocateBrain, opts: LocateOptions): Promise<Located> {
  const text = String(task ?? "");
  const cues = opts.cues ?? extractCues(text);
  const used: Located["used"] = { expanded: false, picked: false, paise: 0 };
  const done = async (targets: LocateTarget[], confidence: number, question?: LocateQuestion): Promise<Located> => ({
    targets, ...(await around(brain, targets)), confidence: Math.round(confidence * 1000) / 1000, ...(question ? { question } : {}), used,
  });
  if (isVague(cues)) return done([], 0, await questionFor([], brain));

  const weights = weightsFor(cues, opts.map);
  let signals = await runSignals(brain, cues, []);
  let fused = fuse(signals, weights);
  await withPrior(brain, fused);
  // Not sure yet? The repo map takes a look (consultMap).
  fused = (await consultMap(brain, cues, signals, weights, fused, opts.map)).fused;
  let { value: confidence, margin } = confidenceOf(fused);

  // Not sure, and fewer than two strong hits: a cheap model offers other words for the same thing, and the signals run again with them.
  // (Two strong hits that do not settle it are two places, not a vocabulary problem: synonyms would not help.)
  if (confidence <= CONFIDENT && strongHits(signals) < 2) {
    const e = await expandTerms(text, cues, brain, opts.model);
    used.expanded = !e.skipped;
    used.paise += e.paise;
    if (e.skipped) used.skipped = e.skipped;
    if (e.terms.length) {
      signals = await runSignals(brain, cues, e.terms.map((q) => ({ q, weight: 0.6 })));
      fused = fuse(signals, weights);
      await withPrior(brain, fused);
      fused = (await consultMap(brain, cues, signals, weights, fused, opts.map)).fused;
      ({ value: confidence, margin } = confidenceOf(fused));
    }
  }
  if (!fused.length) return done([], 0, await questionFor([], brain));

  const toTargets = (): LocateTarget[] => {
    const first = fused[0]!;
    if (confidence > CONFIDENT) return fused.filter((f, i) => i === 0 || (i < 4 && f.score >= 0.65 * first.score)).map((f) => targetOf(f));
    return fused.filter((f, i) => i < 5 && f.score >= 0.4 * first.score).map((f) => targetOf(f));
  };

  if (confidence > CONFIDENT) return done(toTargets(), confidence);

  let tie = fused.length > 1 && margin < 0.15;
  if (confidence >= UNSURE) {
    // The middle: a cheap model reads the top eight and picks.
    const p = await pickFrom(text, fused, brain, opts.read, opts.model);
    if ("skipped" in p) {
      used.skipped = used.skipped ?? p.skipped;
    } else {
      used.picked = true;
      used.paise += p.paise;
      if (p.picks.length) {
        const rank = new Map(p.picks.map((x, i) => [x.path, i]));
        const why = new Map(p.picks.map((x) => [x.path, x.why]));
        // The picks go first, in the model's order; a pick the model is sure of is as good as a confident search.
        fused = [...fused.filter((f) => rank.has(f.path)).sort((a, b) => rank.get(a.path)! - rank.get(b.path)!), ...fused.filter((f) => !rank.has(f.path))];
        if (p.sure) {
          confidence = Math.max(confidence, 0.8);
          tie = false;
          const picked = fused.filter((f) => rank.has(f.path));
          return done(picked.map((f) => targetOf({ ...f, score: Math.max(f.score, 0.8) }, why.get(f.path) || undefined)), confidence);
        }
        // Unsure: one pick is a likely answer; two are a tie.
        if (p.picks.length === 1) { confidence = Math.max(confidence, 0.6); tie = false; } else { confidence = Math.min(confidence, 0.55); tie = true; }
      } else {
        // The model could not say, and there is more than one to choose from.
        tie = fused.length > 1;
        // With ONE candidate, "none of these" is the model declining the only place the search found: a lone weak match that the reader would not pick is not an
        // answer to go and work on (the smoke run: validateItem matched the word "item", the reader declined, and the job was planned on validate.js at 0.57). It is
        // asked about instead ("I found one possible place but I am not sure. Is this it?").
        if (fused.length === 1) confidence = Math.min(confidence, UNSURE - 0.01);
      }
    }
  }

  const targets = toTargets();
  if (confidence < UNSURE || tie) return done(targets, confidence, await questionFor(fused, brain));
  return done(targets, confidence);
}

/**
 * The funnel's first half on its own, for measuring: the fused list of files for a request, with no model asked and no threshold applied.
 * (locate() adds the cheap tier, the questions and the one hop out; this is what they all start from.)
 */
export async function fusedFor(task: string, brain: LocateBrain, map?: MapSettings): Promise<Fused[]> {
  return fusedWith(brain, await baseSignals(task, brain), map);
}

/** The five signals of a request, which do not depend on the map's settings: a benchmark that tries many settings computes them once. */
export interface BaseSignals { cues: Cues; signals: Signals }
export async function baseSignals(task: string, brain: LocateBrain): Promise<BaseSignals> {
  const cues = extractCues(String(task ?? ""));
  return { cues, signals: await runSignals(brain, cues, []) };
}

/** The base signals plus the repo map under these settings, fused. */
export async function fusedWith(brain: LocateBrain, base: BaseSignals, map?: MapSettings): Promise<Fused[]> {
  const signals: Signals = { ...base.signals };
  const weights = weightsFor(base.cues, map);
  const fused = fuse(signals, weights);
  await withPrior(brain, fused);
  return (await consultMap(brain, base.cues, signals, weights, fused, map)).fused;
}

export { looksLikeIdentifier };
