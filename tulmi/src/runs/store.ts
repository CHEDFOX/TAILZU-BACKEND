/**
 * WHERE RUNS AND THEIR PLANNER CALLS ARE KEPT.
 *
 * Two tables (supabase/migrations/0019_agent_runs.sql) behind one interface,
 * with the in-memory twin the other stores have: tests and local runs use it,
 * and so does a server with AGENT_RUN_LEDGER off (the default). Written with the service
 * key only; nothing on a device reads them.
 *
 * A step is laid over its run's row by one rule (mergeStep), the same in both
 * twins: totals add up, the step count never goes down, the first step's
 * title and first-event time are kept, and an older step arriving late never
 * overwrites how a newer one ended.
 *
 * The phone's question back waits in its run's `turns` until the person's
 * next request claims it: once, for whoever gets there first (a
 * compare-and-set, as claimWaiting is in connectors/store.ts). Any older
 * question still waiting is closed then too: a new request is not an answer
 * to it.
 *
 * Someone with no account row (a static token, the dev user) has nothing
 * written to Supabase and reads nothing back: the run still gets its
 * receipt, it is only not kept.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTurn } from "../../../shared/types/api.js";
import { supabase } from "../auth/supabase.js";
import { getConfig } from "../config.js";
import {
  SWEEP_TIMES,
  type CallRow, type RunPlatform, type RunReason, type RunRow, type RunState, type RunStore, type RunView,
  type StepRecord, type Surface, type SweepTimes,
} from "./types.js";

/** The memory twin's bound: a server with the ledger off still keeps follow-ups, and must not keep everything. */
const MEMORY_RUNS_MAX = 5000;
const MEMORY_CALLS_MAX = 20_000;
/** The Supabase sweep: rows per batch, and batches of each kind per pass (the next pass goes on). */
const SWEEP_BATCH = 200;
const SWEEP_BATCHES = 10;
/** Waiting questions read at once when one is claimed: the newest, and older ones to close. */
const WAITING_READ = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A step's record laid over the run's row as it stands (null: the run's first). The one rule both twins keep. */
export function mergeStep(cur: RunRow | null, userId: string, r: StepRecord, at: number): RunRow {
  const base: RunRow = cur ?? {
    userId, runId: r.runId, surface: r.surface, platform: r.platform, outcome: "running", reason: null,
    steps: 0, effects: 0, ms: 0, firstMs: null, path: null, mode: null, language: null, taskId: null,
    follows: null, followedBy: null, title: "", said: null, turns: null, startedAt: at, updatedAt: at, endedAt: null,
  };
  const next: RunRow = {
    ...base,
    steps: Math.max(base.steps, r.step + 1),
    effects: base.effects + Math.max(0, Math.round(r.effects)),
    ms: base.ms + Math.max(0, Math.round(r.ms)),
    firstMs: base.firstMs ?? (typeof r.firstMs === "number" ? Math.max(0, Math.round(r.firstMs)) : null),
    title: base.title || (r.title ?? ""),
    updatedAt: at,
  };
  // How the run ended is the newest step's: one that arrives after a later step has been written changes only the totals.
  if (!cur || r.step + 1 >= cur.steps) {
    next.outcome = r.outcome;
    next.reason = r.reason ?? null;
    next.endedAt = r.outcome === "running" ? null : at;
    if (r.path) next.path = r.path;
    if (r.mode) next.mode = r.mode;
    if (r.language) next.language = r.language;
  }
  // A card's task is a row of assistant_tasks (its id a UUID); anything else is not one to point at.
  if (r.taskId && UUID.test(r.taskId)) next.taskId = r.taskId;
  if (r.follows) next.follows = r.follows;
  if (r.said !== undefined) next.said = r.said;
  if (r.turns !== undefined) next.turns = r.turns;
  return next;
}

/** A run as a screen shows it: never its turns, and its words only while they are kept. */
export const viewOfRun = (r: RunRow): RunView => ({
  runId: r.runId, surface: r.surface, outcome: r.outcome, ...(r.reason ? { reason: r.reason } : {}),
  title: r.title, at: r.updatedAt, steps: r.steps, effects: r.effects,
  ...(r.taskId ? { taskId: r.taskId } : {}), ...(r.said ? { retry: r.said } : {}),
});

/** A question back with no answer: closed, its turns gone. */
const unanswered = (at: number): Partial<RunRow> => ({ outcome: "cancelled", reason: "unanswered", endedAt: at, turns: null });

// -------------------------------------------------------------------- memory

export class MemoryRunStore implements RunStore {
  private runs = new Map<string, RunRow>();
  private calls: Array<CallRow & { userId: string }> = [];
  private readonly now: () => number;

  constructor(o: { now?: () => number } = {}) {
    this.now = o.now ?? Date.now;
  }

  async saveStep(userId: string, r: StepRecord) {
    const key = `${userId}|${r.runId}`;
    const cur = this.runs.get(key) ?? null;
    if (!cur && this.runs.size >= MEMORY_RUNS_MAX) this.runs.delete(this.runs.keys().next().value!);
    this.runs.set(key, mergeStep(cur && structuredClone(cur), userId, structuredClone(r), this.now()));
  }
  async addCalls(userId: string, calls: CallRow[]) {
    this.calls.push(...calls.map((c) => ({ ...c, userId })));
    if (this.calls.length > MEMORY_CALLS_MAX) this.calls.splice(0, this.calls.length - MEMORY_CALLS_MAX);
  }
  /** The memory twin only: a run's planner calls, oldest first, for tests. */
  callsOf(userId: string, runId: string): CallRow[] {
    return this.calls.filter((c) => c.userId === userId && c.runId === runId).map(({ userId: _u, ...c }) => ({ ...c }));
  }
  async get(userId: string, runId: string) {
    const r = this.runs.get(`${userId}|${runId}`);
    return r ? structuredClone(r) : null;
  }
  async recent(userId: string, limit: number) {
    // A question that was answered goes on as the run that answered it: that one is shown.
    return [...this.runs.values()]
      .filter((r) => r.userId === userId && r.followedBy === null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(viewOfRun);
  }
  async takeFollowUp(userId: string, by: string, since: number) {
    const waiting = [...this.runs.values()]
      .filter((r) => r.userId === userId && r.surface === "phone" && r.turns !== null && r.followedBy === null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const at = this.now();
    const newest = waiting[0];
    let taken: { runId: string; turns: AgentTurn[] } | null = null;
    if (newest && newest.updatedAt >= since) {
      taken = { runId: newest.runId, turns: structuredClone(newest.turns!) };
      Object.assign(newest, { followedBy: by, turns: null, updatedAt: at });
    }
    for (const r of waiting) if (r.followedBy === null) Object.assign(r, unanswered(at));
    return taken;
  }
  async forgetRetry(userId: string, said: string) {
    for (const r of this.runs.values()) if (r.userId === userId && r.said === said) r.said = null;
  }
  async sweep(now: number, times: SweepTimes = SWEEP_TIMES) {
    let closed = 0;
    let emptied = 0;
    for (const r of this.runs.values()) {
      if (r.surface === "desktop" && r.updatedAt < now - times.quietMs) {
        if (r.outcome === "running") { Object.assign(r, { outcome: "cancelled", reason: "device_stopped", endedAt: now }); closed += 1; }
        else if (r.outcome === "needs_you" && r.reason === "question") { Object.assign(r, unanswered(now)); closed += 1; }
      }
      if (r.surface === "phone" && r.followedBy === null && r.updatedAt < now - times.followUpMs) {
        if (r.outcome === "needs_you" && r.reason === "question") { Object.assign(r, unanswered(now)); closed += 1; }
        else if (r.turns !== null) { r.turns = null; emptied += 1; }
      }
      if (r.said !== null && r.updatedAt < now - times.retryMs) { r.said = null; emptied += 1; }
      if (r.title !== "" && r.startedAt < now - times.titleMs) { r.title = ""; emptied += 1; }
    }
    return { closed, emptied };
  }
}

// ------------------------------------------------------------------ supabase

const iso = (n: number) => new Date(n).toISOString();
const ms = (v: unknown): number | null => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

interface RunDbRow {
  user_id: string; run_id: string; surface: Surface; platform: RunPlatform; outcome: RunState; reason: string | null;
  steps: number; effects: number; ms: number; first_ms: number | null; path: string | null; mode: "show" | "do" | null;
  language: string | null; task_id: string | null; follows: string | null; followed_by: string | null; title: string;
  said: string | null; turns: AgentTurn[] | null; started_at: string; updated_at: string; ended_at: string | null;
}

const rowOf = (r: RunDbRow): RunRow => ({
  userId: r.user_id, runId: r.run_id, surface: r.surface, platform: r.platform, outcome: r.outcome,
  reason: (r.reason as RunReason | null) ?? null, steps: r.steps ?? 0, effects: r.effects ?? 0, ms: r.ms ?? 0,
  firstMs: r.first_ms ?? null, path: r.path ?? null, mode: r.mode ?? null, language: r.language ?? null,
  taskId: r.task_id ?? null, follows: r.follows ?? null, followedBy: r.followed_by ?? null, title: r.title ?? "",
  said: r.said ?? null, turns: Array.isArray(r.turns) ? r.turns : null,
  startedAt: ms(r.started_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0, endedAt: ms(r.ended_at),
});

const dbOf = (r: RunRow): RunDbRow => ({
  user_id: r.userId, run_id: r.runId, surface: r.surface, platform: r.platform, outcome: r.outcome, reason: r.reason,
  steps: r.steps, effects: r.effects, ms: r.ms, first_ms: r.firstMs, path: r.path, mode: r.mode, language: r.language,
  task_id: r.taskId,
  follows: r.follows, followed_by: r.followedBy, title: r.title, said: r.said, turns: r.turns,
  started_at: iso(r.startedAt), updated_at: iso(r.updatedAt), ended_at: r.endedAt === null ? null : iso(r.endedAt),
});

const callDbOf = (userId: string, c: CallRow) => ({
  user_id: userId, run_id: c.runId, step: c.step, surface: c.surface, at: iso(c.at), model: c.model,
  provider: c.provider ?? null, served: c.served ?? null, outcome: c.outcome, ms: Math.max(0, Math.round(c.ms)),
  first_ms: c.firstMs ?? null, prompt_tokens: c.promptTokens ?? null, cached_tokens: c.cachedTokens ?? null,
  completion_tokens: c.completionTokens ?? null, reasoning_tokens: c.reasoningTokens ?? null, cost_usd: c.costUsd ?? null,
  status: c.status ?? null, picture: !!c.picture, deep: !!c.deep,
});

type Res<T> = { data: T | null; error: { message: string } | null };

/** Someone with an account row: a static token or the dev user has none, and nothing of theirs is kept. */
const hasAccount = (userId: string) => UUID.test(userId);
type Ids = Array<{ id: string }>;

function ok<T>(res: Res<T>): T | null {
  if (res.error) throw new Error(`runs store: ${res.error.message}`);
  return res.data;
}

export class SupabaseRunStore implements RunStore {
  constructor(private readonly sb: SupabaseClient) {}

  async saveStep(userId: string, r: StepRecord) {
    if (!hasAccount(userId)) return;
    const cur = ok(await this.sb.from("agent_runs").select("*").eq("user_id", userId).eq("run_id", r.runId).maybeSingle<RunDbRow>());
    const next = mergeStep(cur ? rowOf(cur) : null, userId, r, Date.now());
    ok(await this.sb.from("agent_runs").upsert(dbOf(next), { onConflict: "user_id,run_id" }));
  }
  async addCalls(userId: string, calls: CallRow[]) {
    if (!hasAccount(userId) || !calls.length) return;
    ok(await this.sb.from("agent_calls").insert(calls.map((c) => callDbOf(userId, c))));
  }
  async get(userId: string, runId: string) {
    if (!hasAccount(userId)) return null;
    const r = ok(await this.sb.from("agent_runs").select("*").eq("user_id", userId).eq("run_id", runId).maybeSingle<RunDbRow>());
    return r ? rowOf(r) : null;
  }
  async recent(userId: string, limit: number) {
    if (!hasAccount(userId)) return [];
    const rows = ok(await this.sb.from("agent_runs").select("*").eq("user_id", userId).is("followed_by", null)
      .order("updated_at", { ascending: false }).limit(limit).returns<RunDbRow[]>());
    return (rows ?? []).map((r) => viewOfRun(rowOf(r)));
  }
  async takeFollowUp(userId: string, by: string, since: number) {
    if (!hasAccount(userId)) return null;
    const waiting = ok(await this.sb.from("agent_runs").select("id, run_id, turns, updated_at").eq("user_id", userId)
      .eq("surface", "phone").not("turns", "is", null).is("followed_by", null)
      .order("updated_at", { ascending: false }).limit(WAITING_READ)
      .returns<Array<{ id: string; run_id: string; turns: AgentTurn[] | null; updated_at: string }>>()) ?? [];
    const at = iso(Date.now());
    const newest = waiting[0];
    let taken: { runId: string; turns: AgentTurn[] } | null = null;
    if (newest && (ms(newest.updated_at) ?? 0) >= since && Array.isArray(newest.turns)) {
      const won = ok(await this.sb.from("agent_runs").update({ followed_by: by, turns: null, updated_at: at })
        .eq("user_id", userId).eq("id", newest.id).is("followed_by", null).select("id").returns<Ids>());
      if (won?.length) taken = { runId: newest.run_id, turns: newest.turns };
    }
    const older = waiting.slice(taken ? 1 : 0).map((w) => w.id);
    if (older.length) {
      ok(await this.sb.from("agent_runs").update({ outcome: "cancelled", reason: "unanswered", ended_at: at, turns: null })
        .eq("user_id", userId).in("id", older).is("followed_by", null));
    }
    return taken;
  }
  async forgetRetry(userId: string, said: string) {
    if (!hasAccount(userId)) return;
    ok(await this.sb.from("agent_runs").update({ said: null }).eq("user_id", userId).eq("said", said));
  }
  async sweep(now: number, times: SweepTimes = SWEEP_TIMES) {
    const runs = () => this.sb.from("agent_runs");
    const quiet = iso(now - times.quietMs);
    const asked = iso(now - times.followUpMs);
    const kept = iso(now - times.retryMs);
    const titled = iso(now - times.titleMs);
    const at = iso(now);
    const closedRun = { outcome: "cancelled", ended_at: at };
    let closed = 0;
    let emptied = 0;
    // Each kind is picked by its condition and changed only while it still holds: a step that lands in between keeps its run.
    closed += await this.inBatches(
      () => runs().select("id").eq("surface", "desktop").eq("outcome", "running").lt("updated_at", quiet).limit(SWEEP_BATCH).returns<Ids>(),
      (ids) => runs().update({ ...closedRun, reason: "device_stopped" }).in("id", ids).eq("outcome", "running").lt("updated_at", quiet).select("id").returns<Ids>(),
    );
    closed += await this.inBatches(
      () => runs().select("id").eq("surface", "desktop").eq("outcome", "needs_you").eq("reason", "question").lt("updated_at", quiet).limit(SWEEP_BATCH).returns<Ids>(),
      (ids) => runs().update({ ...closedRun, reason: "unanswered", turns: null }).in("id", ids).eq("outcome", "needs_you").eq("reason", "question").lt("updated_at", quiet).select("id").returns<Ids>(),
    );
    closed += await this.inBatches(
      () => runs().select("id").eq("surface", "phone").eq("outcome", "needs_you").eq("reason", "question").is("followed_by", null).lt("updated_at", asked).limit(SWEEP_BATCH).returns<Ids>(),
      (ids) => runs().update({ ...closedRun, reason: "unanswered", turns: null }).in("id", ids).eq("outcome", "needs_you").is("followed_by", null).lt("updated_at", asked).select("id").returns<Ids>(),
    );
    emptied += await this.inBatches(
      () => runs().select("id").not("turns", "is", null).is("followed_by", null).lt("updated_at", asked).limit(SWEEP_BATCH).returns<Ids>(),
      (ids) => runs().update({ turns: null }).in("id", ids).is("followed_by", null).lt("updated_at", asked).select("id").returns<Ids>(),
    );
    emptied += await this.inBatches(
      () => runs().select("id").not("said", "is", null).lt("updated_at", kept).limit(SWEEP_BATCH).returns<Ids>(),
      (ids) => runs().update({ said: null }).in("id", ids).lt("updated_at", kept).select("id").returns<Ids>(),
    );
    emptied += await this.inBatches(
      () => runs().select("id").neq("title", "").lt("started_at", titled).limit(SWEEP_BATCH).returns<Ids>(),
      (ids) => runs().update({ title: "" }).in("id", ids).lt("started_at", titled).select("id").returns<Ids>(),
    );
    return { closed, emptied };
  }

  /** Ids `pick` finds, changed by `change`, a batch at a time, up to SWEEP_BATCHES batches: a pass does a bounded amount, and the next goes on. */
  private async inBatches(pick: () => PromiseLike<Res<Ids>>, change: (ids: string[]) => PromiseLike<Res<Ids>>): Promise<number> {
    let n = 0;
    for (let i = 0; i < SWEEP_BATCHES; i++) {
      const ids = (ok(await pick()) ?? []).map((r) => r.id);
      if (!ids.length) break;
      n += (ok(await change(ids)) ?? []).length;
      if (ids.length < SWEEP_BATCH) break;
    }
    return n;
  }
}

// ------------------------------------------------------------------ the one

let current: RunStore | null = null;

/** Supabase when the service client exists and the ledger is on, else memory (tests, local runs, AGENT_RUN_LEDGER off, the default). */
export function runStore(): RunStore {
  if (!current) {
    const sb = getConfig().AGENT_RUN_LEDGER ? supabase() : null;
    current = sb ? new SupabaseRunStore(sb) : new MemoryRunStore();
  }
  return current;
}

export function resetRunStoreForTests(): void { current = null; }
