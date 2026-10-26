/**
 * WHAT THE ROUTER LEARNS: HOW EACH MODEL DOES AT EACH KIND OF STEP.
 *
 * After a step the brain says how it went (recordOutcome): which kind of
 * request it was (the classifier's type), which step, which model did it,
 * whether it worked, what it cost in paise and how long it took. One row per
 * (task type, step, model) keeps the running totals: successes, failures,
 * paise and milliseconds. Nothing about WHO asked or WHAT was asked is kept, only
 * these counts, so they are the same for everyone and carry nothing private.
 *
 * What a step counts as a success is the caller's to say: the tests passed, the
 * reviewer accepted it, the JSON held up the first time. This file only counts.
 *
 * The router uses the rows to reorder a tier's ladder (route.ts): once a model
 * has been tried at least 20 times at this kind of step and worked at least 85
 * times in 100, the CHEAPEST such model goes first. Below that, or when no model
 * has earned it, the default order stands. The thresholds are here
 * (MIN_SAMPLES, MIN_SUCCESS_RATE) so the router and its tests read the same ones.
 *
 * The rows are kept in code_route_stats (supabase/migrations/0025_code_route_stats.sql),
 * added to in one statement by code_record_route_outcome so two steps ending
 * together both count, behind one interface with the in-memory twin that tests
 * and local runs use, as the other stores do. Written with the service key
 * only; no policy lets a person read them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import type { BrainLog } from "./gateway.js";
import type { RequestType, StepName } from "./types.js";

/** Tries a model needs at a kind of step before its record counts. */
export const MIN_SAMPLES = 20;
/** The share of those tries that must have worked. */
export const MIN_SUCCESS_RATE = 0.85;

export interface RouteStat {
  taskType: string;
  step: string;
  model: string;
  successes: number;
  failures: number;
  paiseTotal: number;
  msTotal: number;
  updatedAt: number;
}

export interface RouteOutcome {
  taskType: RequestType | string;
  step: StepName | string;
  model: string;
  success: boolean;
  /** What the step cost, in paise. */
  paise?: number;
  ms?: number;
}

export interface RouteStatsStore {
  /** Adds one outcome to its row. */
  record(o: RouteOutcome): Promise<void>;
  /** Every model's row for one kind of step. */
  list(taskType: string, step: string): Promise<RouteStat[]>;
}

/** A model's row for a kind of step, or undefined when it has none. Synchronous: the router reads it while choosing. */
export type StatsLookup = (taskType: string, step: string, model: string) => RouteStat | undefined;

const whole = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
const key = (taskType: string, step: string, model: string) => `${taskType}|${step}|${model}`;

/** The rows from `list`, as a lookup. */
export function lookupOf(rows: readonly RouteStat[]): StatsLookup {
  const by = new Map(rows.map((r) => [key(r.taskType, r.step, r.model), r]));
  return (taskType, step, model) => by.get(key(taskType, step, model));
}

export const samplesOf = (s: RouteStat): number => s.successes + s.failures;
/** What a try costs on average, in paise. */
export const paisePerTry = (s: RouteStat): number => (samplesOf(s) ? s.paiseTotal / samplesOf(s) : Number.POSITIVE_INFINITY);

/**
 * Of these models, in the ladder's order, the one the record prefers for this
 * kind of step: the cheapest per try among those with at least MIN_SAMPLES tries
 * and a success rate of at least MIN_SUCCESS_RATE; the earlier on the ladder
 * wins a tie. Undefined when none has earned it, and the default order stands.
 */
export function preferredModel(candidates: readonly string[], taskType: string, step: string, stats: StatsLookup): string | undefined {
  let best: { model: string; cost: number } | undefined;
  for (const model of candidates) {
    const s = stats(taskType, step, model);
    if (!s || samplesOf(s) < MIN_SAMPLES || s.successes / samplesOf(s) < MIN_SUCCESS_RATE) continue;
    const cost = paisePerTry(s);
    if (!best || cost < best.cost) best = { model, cost };
  }
  return best?.model;
}

// -------------------------------------------------------------------- memory

const MEMORY_ROWS_MAX = 5_000;

export class MemoryRouteStatsStore implements RouteStatsStore {
  private rows = new Map<string, RouteStat>();

  constructor(private readonly now: () => number = Date.now) {}

  async record(o: RouteOutcome) {
    const k = key(o.taskType, o.step, o.model);
    const cur = this.rows.get(k);
    if (!cur && this.rows.size >= MEMORY_ROWS_MAX) this.rows.delete(this.rows.keys().next().value!);
    this.rows.set(k, {
      taskType: o.taskType, step: o.step, model: o.model,
      successes: (cur?.successes ?? 0) + (o.success ? 1 : 0),
      failures: (cur?.failures ?? 0) + (o.success ? 0 : 1),
      paiseTotal: (cur?.paiseTotal ?? 0) + whole(o.paise),
      msTotal: (cur?.msTotal ?? 0) + whole(o.ms),
      updatedAt: this.now(),
    });
  }
  async list(taskType: string, step: string) {
    return [...this.rows.values()].filter((r) => r.taskType === taskType && r.step === step).map((r) => ({ ...r }));
  }
}

// ------------------------------------------------------------------ supabase

interface StatRow {
  task_type: string; step: string; model: string; successes: number; failures: number;
  paise_total: number | string; ms_total: number | string; updated_at: string;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const statOf = (r: StatRow): RouteStat => ({
  taskType: r.task_type, step: r.step, model: r.model, successes: num(r.successes), failures: num(r.failures),
  paiseTotal: num(r.paise_total), msTotal: num(r.ms_total), updatedAt: Date.parse(r.updated_at) || 0,
});

export class SupabaseRouteStatsStore implements RouteStatsStore {
  constructor(private readonly sb: SupabaseClient) {}

  async record(o: RouteOutcome) {
    const res = await this.sb.rpc("code_record_route_outcome", {
      p_task_type: o.taskType, p_step: o.step, p_model: o.model.slice(0, 200),
      p_success: o.success, p_paise: whole(o.paise), p_ms: whole(o.ms),
    });
    if (res.error) throw new Error(`route stats store: ${res.error.message}`);
  }
  async list(taskType: string, step: string) {
    const res = await this.sb.from("code_route_stats").select("*").eq("task_type", taskType).eq("step", step).returns<StatRow[]>();
    if (res.error) throw new Error(`route stats store: ${res.error.message}`);
    return (res.data ?? []).map(statOf);
  }
}

// ------------------------------------------------------------------ the one

let current: RouteStatsStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function routeStats(): RouteStatsStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseRouteStatsStore(sb) : new MemoryRouteStatsStore();
  }
  return current;
}

export function resetRouteStatsForTests(): void { current = null; }

/**
 * Says how a step went. Never throws and never waits on anything the job needs:
 * a store that is down (or migration 0025 not run yet) costs the router its
 * learning for a while, not the job its step.
 */
export async function recordOutcome(o: RouteOutcome, deps: { store?: RouteStatsStore; log?: Pick<BrainLog, "warn"> } = {}): Promise<void> {
  try {
    await (deps.store ?? routeStats()).record(o);
  } catch (err) {
    const why = (err as Error)?.name;
    if (deps.log) deps.log.warn({ error: why }, "code brain: outcome not recorded");
    else console.warn(`[code-brain] outcome not recorded (${why})`);
  }
}
