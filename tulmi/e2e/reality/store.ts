/**
 * THE RESULTS STORE: EVERY MEASUREMENT KEPT, KEYED SO THAT NOTHING IS PAID FOR TWICE.
 *
 * e2e/results/*.jsonl (committed): one JSON line per measurement, appended and never edited.
 *
 *   key = (kind, agent, model, item, code fingerprint, prompt version)
 *
 *   kind     probe (a capability probe of a model), task (a task through an agent), smoke (a smoke item), part (a part bake-off), replay (a cassette replayed)
 *   agent    tailzu, aider, ...; "-" for a probe (it is about a model, not an agent)
 *   model    an OpenRouter slug, or "ladders" for the product's own tier table, or "-" when there is none
 *   item     the task id, the probe id, the smoke item id, the part id
 *   code     fingerprint.ts: the hash of the files that feed that kind of result (a contestant: its pinned version)
 *   prompt   fingerprint.ts: the hash of the words the models were given (and the scorer that judged it)
 *
 * A key that is in the store is REUSED: the plan asks `reusable(key)` before every paid call and runs only what is missing or whose code or prompt changed. The same
 * key may hold several lines (repeats of a flaky run); they are all kept and the latest is "the" answer. A result made on simulated models (`source: "sim"`) lives in
 * its own folder and is never read by a real run, and a real result is never read by a simulated one.
 *
 * `source`: real (a model was called and paid), replay (a recording of a paid call, replayed for nothing; `costInr` is what it cost when recorded), sim.
 */
import fs from "node:fs";
import path from "node:path";
import { E2E_DIR, mkdirp } from "../util.js";
import type { Perf } from "./perf.js";

export type ResultKind = "probe" | "task" | "smoke" | "part" | "replay";
export type ResultSource = "real" | "replay" | "sim";

export interface ResultKey { kind: ResultKind; agent: string; model: string; item: string; code: string; prompt: string }

export interface StoredResult extends ResultKey {
  at: string;
  /** The reality run that made it. */
  run: string;
  source: ResultSource;
  ok: boolean;
  /** 0..1: a probe's score, a task's share of checks passed. */
  score?: number;
  /** Rupees it cost (for a replay: what it cost when it was recorded). */
  costInr: number;
  wallMs: number;
  category?: string;
  perf?: Perf;
  detail?: string;
  /** Free data of the kind: a probe's error counts, a part's table, a replay's baseline. */
  data?: unknown;
}

export const DEFAULT_RESULTS_DIR = path.join(E2E_DIR, "results");

export const keyOf = (k: ResultKey): string => [k.kind, k.agent, k.model, k.item, k.code, k.prompt].join("|");
const FILE: Record<ResultKind, string> = { probe: "probes.jsonl", task: "tasks.jsonl", smoke: "smoke.jsonl", part: "parts.jsonl", replay: "replays.jsonl" };

export class ResultsStore {
  private readonly byKey = new Map<string, StoredResult[]>();
  private readonly byItem = new Map<string, StoredResult[]>();
  private all: StoredResult[] = [];

  /** `accept`: the sources this store may read back (a real run reads real and replayed results; a simulated one only its own). */
  constructor(readonly dir: string, readonly accept: readonly ResultSource[] = ["real", "replay"]) {}

  load(): this {
    this.byKey.clear(); this.byItem.clear(); this.all = [];
    if (!fs.existsSync(this.dir)) return this;
    for (const f of Object.values(FILE)) {
      const file = path.join(this.dir, f);
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { this.index(JSON.parse(line) as StoredResult); } catch { /* a torn last line is not a result */ }
      }
    }
    return this;
  }

  private index(r: StoredResult): void {
    if (!this.accept.includes(r.source)) return;
    const k = keyOf(r);
    this.byKey.set(k, [...(this.byKey.get(k) ?? []), r]);
    const ik = `${r.kind}|${r.agent}|${r.model}|${r.item}`;
    this.byItem.set(ik, [...(this.byItem.get(ik) ?? []), r]);
    this.all.push(r);
  }

  /** Writes a result (one line) and keeps it. */
  append(r: StoredResult): void {
    mkdirp(this.dir);
    fs.appendFileSync(path.join(this.dir, FILE[r.kind]), `${JSON.stringify(r)}\n`);
    this.index(r);
  }

  /** The runs under exactly this key (code and prompt as they are now), oldest first. */
  runs(k: ResultKey): StoredResult[] { return this.byKey.get(keyOf(k)) ?? []; }
  /** The latest run under this key. */
  get(k: ResultKey): StoredResult | undefined { const l = this.runs(k); return l[l.length - 1]; }
  /** Whether a paid call for this key can be skipped: a result of the same code and prompt is in the store. */
  reusable(k: ResultKey): boolean { return this.runs(k).length > 0; }

  /** Every run of an (agent, model, item) under ANY code or prompt: what it did before, for flakiness and for regressions. */
  history(kind: ResultKind, agent: string, model: string, item: string): StoredResult[] { return this.byItem.get(`${kind}|${agent}|${model}|${item}`) ?? []; }

  /** Every stored run, or those passing the filter. */
  list(f?: (r: StoredResult) => boolean): StoredResult[] { return f ? this.all.filter(f) : [...this.all]; }

  /** The latest run of each key, optionally filtered: "the current answer" per measurement. */
  latest(f?: (r: StoredResult) => boolean): StoredResult[] {
    const out: StoredResult[] = [];
    for (const l of this.byKey.values()) { const r = l[l.length - 1]!; if (!f || f(r)) out.push(r); }
    return out;
  }

  get size(): number { return this.all.length; }
}

/** Where a run keeps its results: the committed folder for a real one, a throwaway folder (git-ignored) for a simulated one. */
export function storeFor(mode: "real" | "sim" | "replay", o: { dir?: string; outDir: string }): ResultsStore {
  // A simulated or scripted run keeps its results in a folder of its own inside the store's folder or the run's output, never among the real measurements.
  if (mode === "sim") return new ResultsStore(path.join(o.dir ?? o.outDir, "sim-results"), ["sim"]).load();
  return new ResultsStore(o.dir ?? DEFAULT_RESULTS_DIR, ["real", "replay"]).load();
}
