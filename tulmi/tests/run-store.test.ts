/**
 * WHERE RUNS ARE KEPT (src/runs/store.ts): the memory twin and the Supabase
 * one, held to the same script.
 *
 * What these hold down:
 *   - a step laid over its run: totals add up, steps never go down, the first
 *     step's title and first-event time stay, and a step that arrives late
 *     never overwrites how a newer one ended;
 *   - the phone's question back is claimed once, the newest only, and any
 *     older one still waiting is closed; two servers claiming at once get it
 *     once between them (the Supabase twin's compare-and-set);
 *   - the sweep closes quiet desktop runs and unanswered questions, and lets
 *     go of the retry words after a day and the title after 30 days;
 *   - someone with no account row never reaches Supabase;
 *   - runStore() is Supabase only with the service key AND AGENT_RUN_LEDGER on
 *     (off by default).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.NODE_ENV = "test";
process.env.DEV_SKIP_AUTH = "true";

const { MemoryRunStore, RunLedger, SupabaseRunStore, SWEEP_TIMES, resetRunStoreForTests, runStore, startRunSweeper } = await import("../src/runs/index.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { resetConfigForTests } = await import("../src/config.js");
type RunStore = import("../src/runs/index.js").RunStore;
type StepRecord = import("../src/runs/index.js").StepRecord;

const ANN = "11111111-2222-4333-8444-555555555555";
const BOB = "66666666-7777-4888-8999-000000000000";

/** A Supabase client that keeps tables in memory and answers the query builder's calls the way PostgREST would. */
function fakeSupabase() {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const touched: string[] = [];
  const from = (table: string) => {
    touched.push(table);
    const rows = () => (tables[table] ??= []);
    let op: "select" | "insert" | "upsert" | "update" = "select";
    let payload: Record<string, unknown> | Array<Record<string, unknown>> = {};
    let conflict: string[] = [];
    const where: Array<(r: Record<string, unknown>) => boolean> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    const run = () => {
      const match = (r: Record<string, unknown>) => where.every((f) => f(r));
      let out: Array<Record<string, unknown>> = [];
      if (op === "select") out = rows().filter(match);
      if (op === "insert") {
        for (const p of Array.isArray(payload) ? payload : [payload]) { const row = { id: rows().length + 1, ...p }; rows().push(row); out.push(row); }
      }
      if (op === "upsert") {
        const p = payload as Record<string, unknown>;
        const hit = rows().find((r) => conflict.every((k) => r[k] === p[k]));
        if (hit) { Object.assign(hit, p); out = [hit]; } else { const row = { id: randomUUID(), ...p }; rows().push(row); out = [row]; }
      }
      if (op === "update") { out = rows().filter(match); for (const r of out) Object.assign(r, payload); }
      if (order) { const { col, asc } = order; out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)); }
      if (limit !== null) out = out.slice(0, limit);
      return { data: structuredClone(out), error: null };
    };
    const b = {
      select: () => b,
      insert: (p: typeof payload) => { op = "insert"; payload = p; return b; },
      upsert: (p: Record<string, unknown>, o: { onConflict: string }) => { op = "upsert"; payload = p; conflict = o.onConflict.split(","); return b; },
      update: (p: Record<string, unknown>) => { op = "update"; payload = p; return b; },
      eq: (col: string, v: unknown) => { where.push((r) => r[col] === v); return b; },
      neq: (col: string, v: unknown) => { where.push((r) => r[col] !== v); return b; },
      is: (col: string, v: unknown) => { where.push((r) => (r[col] ?? null) === v); return b; },
      not: (col: string, opr: string, v: unknown) => { if (opr !== "is") throw new Error(`not.${opr}`); where.push((r) => (r[col] ?? null) !== v); return b; },
      in: (col: string, vs: unknown[]) => { where.push((r) => vs.includes(r[col])); return b; },
      lt: (col: string, v: string) => { where.push((r) => String(r[col]) < v); return b; },
      order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { limit = n; return b; },
      returns: () => b,
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko),
    };
    return b;
  };
  return { from, tables, touched };
}

const step = (over: Partial<StepRecord> & Pick<StepRecord, "runId">): StepRecord => ({
  surface: "desktop", platform: "mac", step: 0, outcome: "running", effects: 0, ms: 100, ...over,
});
/** A row without its clocks, which differ between the twins by the time the script takes. */
const bare = <T extends object | null>(x: T) =>
  x && Object.fromEntries(Object.entries(x).filter(([k]) => !["startedAt", "updatedAt", "endedAt", "at"].includes(k)));

/** One script, run against a store; what it saw along the way. */
async function script(store: RunStore) {
  const seen: unknown[] = [];
  // A desktop run: an action, then done; then step 0's write arriving late.
  await store.saveStep(ANN, step({ runId: "run_d1", effects: 1, firstMs: 300, title: "type hello", path: "model", mode: "do", language: "en" }));
  await store.saveStep(ANN, step({ runId: "run_d1", step: 1, outcome: "done", effects: 1, ms: 400, firstMs: 999, title: "the answer", path: "followup" }));
  await store.saveStep(ANN, step({ runId: "run_d1", step: 0, outcome: "failed", reason: "internal", effects: 1, ms: 50 }));
  seen.push(bare(await store.get(ANN, "run_d1")));
  // Two phone questions waiting, the second newer; then an answer claims the newest, once.
  const q = (n: number) => [{ said: `pay rahul ${n}`, did: "ASK", note: "What's their UPI ID?" }];
  await store.saveStep(ANN, step({ runId: "run_p1", surface: "phone", platform: "android", outcome: "needs_you", reason: "question", turns: q(1), title: "pay rahul 1", said: null }));
  await new Promise((r) => setTimeout(r, 3));
  await store.saveStep(ANN, step({ runId: "run_p2", surface: "phone", platform: "android", outcome: "needs_you", reason: "question", turns: q(2), title: "pay rahul 2", said: null }));
  seen.push(await store.takeFollowUp(BOB, "run_b", Date.now() - 60_000));
  seen.push(await store.takeFollowUp(ANN, "run_p3", Date.now() - 60_000));
  seen.push(await store.takeFollowUp(ANN, "run_p4", Date.now() - 60_000));
  seen.push(bare(await store.get(ANN, "run_p1")), bare(await store.get(ANN, "run_p2")));
  // The answer's run, which follows the question; a failed one with words to try again.
  await store.saveStep(ANN, step({ runId: "run_p3", surface: "phone", platform: "android", outcome: "done", reason: "handoff", effects: 1, follows: "run_p2", title: "pay rahul 2", said: null, turns: null, taskId: "not-a-task" }));
  await store.saveStep(ANN, step({ runId: "run_p5", surface: "phone", platform: "ios", outcome: "failed", reason: "model_unavailable", title: "what's on tomorrow", said: "what's on tomorrow", turns: null }));
  // A card, on a task that is a real one.
  await store.saveStep(ANN, step({ runId: "run_p6", surface: "phone", platform: "ios", outcome: "needs_you", reason: "approval", taskId: "99999999-2222-4333-8444-555555555555", title: "delete the dentist", said: null }));
  // Answered questions are shown as the run that answered them. (In run order: two writes in one millisecond tie.)
  seen.push((await store.recent(ANN, 10)).map(bare).sort((a, b) => String(a!.runId).localeCompare(String(b!.runId))));
  seen.push(await store.recent(BOB, 10), await store.get(BOB, "run_d1"));
  await store.addCalls(ANN, [{ runId: "run_d1", step: 0, surface: "desktop", at: Date.now(), model: "openai/gpt-6-luna", outcome: "ok", ms: 900, promptTokens: 3120, cachedTokens: 2900, completionTokens: 31, costUsd: 0.000327, picture: true }]);
  await store.addCalls(ANN, []);

  // The sweep: quiet runs, unanswered questions, then the words.
  await store.saveStep(ANN, step({ runId: "run_d2", title: "scroll the page" }));
  await store.saveStep(ANN, step({ runId: "run_d3", outcome: "needs_you", reason: "question", title: "send it" }));
  await store.saveStep(ANN, step({ runId: "run_p7", surface: "phone", platform: "ios", outcome: "needs_you", reason: "question", turns: q(7), title: "pay mom", said: null }));
  const t = Date.now();
  seen.push(await store.sweep(t + 4 * 60_000));
  seen.push(await store.sweep(t + SWEEP_TIMES.followUpMs + 1000));
  seen.push(await store.sweep(t + SWEEP_TIMES.quietMs + 1000));
  seen.push(...(await Promise.all(["run_d2", "run_d3", "run_p7"].map((id) => store.get(ANN, id)))).map((r) => [r!.outcome, r!.reason, r!.turns]));
  seen.push(await store.sweep(t + SWEEP_TIMES.retryMs + 1000));
  seen.push((await store.get(ANN, "run_p5"))!.said);
  seen.push(await store.sweep(t + SWEEP_TIMES.titleMs + 1000));
  seen.push((await store.recent(ANN, 20)).map((v) => v.title));
  seen.push(await store.sweep(t + SWEEP_TIMES.titleMs + 1000));
  return seen;
}

describe("the two stores keep runs alike", () => {
  it("memory and Supabase answer the same script the same way", async () => {
    const memory = await script(new MemoryRunStore());
    const sb = fakeSupabase();
    const supa = await script(new SupabaseRunStore(sb as never));
    expect(supa).toEqual(memory);

    // What the script saw, on both.
    expect(memory[0]).toEqual({
      userId: ANN, runId: "run_d1", surface: "desktop", platform: "mac", outcome: "done", reason: null, steps: 2, effects: 3, ms: 550,
      firstMs: 300, path: "followup", mode: "do", language: "en", taskId: null, follows: null, followedBy: null, title: "type hello", said: null, turns: null,
    });
    expect(memory.slice(1, 4)).toEqual([null, { runId: "run_p2", turns: [{ said: "pay rahul 2", did: "ASK", note: "What's their UPI ID?" }] }, null]);
    expect(memory[4]).toMatchObject({ outcome: "cancelled", reason: "unanswered", turns: null, followedBy: null });
    expect(memory[5]).toMatchObject({ outcome: "needs_you", reason: "question", turns: null, followedBy: "run_p3" });
    const views = memory[6] as Array<{ runId: string }>;
    expect(views.map((v) => v.runId).sort()).toEqual(["run_d1", "run_p1", "run_p3", "run_p5", "run_p6"]);
    expect(views.find((v) => v.runId === "run_p5")).toEqual({ runId: "run_p5", surface: "phone", outcome: "failed", reason: "model_unavailable", title: "what's on tomorrow", steps: 1, effects: 0, retry: "what's on tomorrow" });
    expect(views.find((v) => v.runId === "run_p6")).toMatchObject({ taskId: "99999999-2222-4333-8444-555555555555" });
    expect(views.find((v) => v.runId === "run_p3")).not.toHaveProperty("taskId");
    expect(memory.slice(7, 9)).toEqual([[], null]);
    // Nothing at 4 minutes; the phone's question at 5; the quiet desktop run and its question at 10.
    expect(memory.slice(9, 12)).toEqual([{ closed: 0, emptied: 0 }, { closed: 1, emptied: 0 }, { closed: 2, emptied: 0 }]);
    expect(memory.slice(12, 15)).toEqual([["cancelled", "device_stopped", null], ["cancelled", "unanswered", null], ["cancelled", "unanswered", null]]);
    expect(memory.slice(15, 17)).toEqual([{ closed: 0, emptied: 1 }, null]);
    expect(memory[17]).toEqual({ closed: 0, emptied: 9 });
    expect(memory[18]).toEqual(Array(8).fill(""));
    expect(memory[19]).toEqual({ closed: 0, emptied: 0 });

    // The Supabase rows are the columns 0019 makes; an id that is no task's is not written as one.
    expect(Object.keys(sb.tables.agent_runs![0]!).sort()).toEqual([
      "effects", "ended_at", "first_ms", "followed_by", "follows", "id", "language", "mode", "ms", "outcome", "path", "platform", "reason",
      "run_id", "said", "started_at", "steps", "surface", "task_id", "title", "turns", "updated_at", "user_id"]);
    expect(sb.tables.agent_runs!.find((r) => r.run_id === "run_p3")!.task_id).toBeNull();
    expect(Object.keys(sb.tables.agent_calls![0]!).sort()).toEqual([
      "at", "cached_tokens", "completion_tokens", "cost_usd", "deep", "first_ms", "id", "model", "ms", "outcome", "picture", "prompt_tokens",
      "provider", "reasoning_tokens", "run_id", "served", "status", "step", "surface", "user_id"]);
    expect(sb.tables.agent_calls![0]).toMatchObject({ user_id: ANN, run_id: "run_d1", cost_usd: 0.000327, picture: true, deep: false, provider: null });
  });

  it("lists a person's runs newest first, as many as asked for, and only theirs", async () => {
    let t = 1_000_000;
    const store = new MemoryRunStore({ now: () => t });
    for (const id of ["run_a1", "run_a2", "run_a3"]) { t += 1000; await store.saveStep(ANN, step({ runId: id, outcome: "done" })); }
    t += 1000;
    await store.saveStep(ANN, step({ runId: "run_a1", step: 1, outcome: "done" }));
    await store.saveStep(BOB, step({ runId: "run_b1", outcome: "done" }));
    expect((await store.recent(ANN, 10)).map((v) => [v.runId, v.at])).toEqual([["run_a1", 1_004_000], ["run_a3", 1_003_000], ["run_a2", 1_002_000]]);
    expect((await store.recent(ANN, 2)).map((v) => v.runId)).toEqual(["run_a1", "run_a3"]);
  });

  it("lets go of the words to try again with, wherever they are those words, for that person only: both twins alike", async () => {
    const run = async (store: RunStore) => {
      const failed = (runId: string, said: string) => step({ runId, surface: "phone", platform: "ios", outcome: "failed", reason: "model_unavailable", title: said, said });
      await store.saveStep(ANN, failed("run_f1", "add gym tomorrow"));
      await store.saveStep(ANN, failed("run_f2", "call papa"));
      await store.saveStep(BOB, failed("run_f3", "add gym tomorrow"));
      await store.forgetRetry(ANN, "add gym tomorrow");
      return Promise.all([store.get(ANN, "run_f1"), store.get(ANN, "run_f2"), store.get(BOB, "run_f3")].map(async (r) => [(await r)!.said, (await r)!.title]));
    };
    const memory = await run(new MemoryRunStore());
    expect(memory).toEqual([[null, "add gym tomorrow"], ["call papa", "call papa"], ["add gym tomorrow", "add gym tomorrow"]]);
    expect(await run(new SupabaseRunStore(fakeSupabase() as never))).toEqual(memory);
  });

  it("two servers taking the same question at once: one gets it", async () => {
    const sb = fakeSupabase();
    const store = new SupabaseRunStore(sb as never);
    await store.saveStep(ANN, step({ runId: "run_q", surface: "phone", platform: "android", outcome: "needs_you", reason: "question", turns: [{ said: "pay rahul", did: "ASK", note: "UPI ID?" }] }));
    const got = await Promise.all([store.takeFollowUp(ANN, "run_x", 0), store.takeFollowUp(ANN, "run_y", 0)]);
    expect(got.filter(Boolean)).toHaveLength(1);
    const row = sb.tables.agent_runs![0]!;
    expect(["run_x", "run_y"]).toContain(row.followed_by);
    // The one that lost did not close the question the other one took.
    expect(row).toMatchObject({ outcome: "needs_you", turns: null });
  });

  it("someone with no account row never reaches Supabase", async () => {
    const sb = fakeSupabase();
    const store = new SupabaseRunStore(sb as never);
    for (const who of ["static-0123456789ab", "dev-user"]) {
      await store.saveStep(who, step({ runId: "run_s" }));
      await store.addCalls(who, [{ runId: "run_s", step: 0, surface: "desktop", at: 1, model: "m", outcome: "ok", ms: 1 }]);
      expect(await store.get(who, "run_s")).toBeNull();
      expect(await store.recent(who, 5)).toEqual([]);
      expect(await store.takeFollowUp(who, "run_t", 0)).toBeNull();
      await store.forgetRetry(who, "x");
    }
    expect(sb.touched).toEqual([]);
  });

  it("the memory twin stays bounded, as a server with the ledger off keeps it", async () => {
    const store = new MemoryRunStore();
    for (let i = 0; i < 5001; i++) await store.saveStep(ANN, step({ runId: `run_${String(i).padStart(6, "0")}` }));
    expect(await store.get(ANN, "run_000000")).toBeNull();
    expect(await store.get(ANN, "run_005000")).not.toBeNull();
  });
});

describe("the sweeper", () => {
  it("sweeps soon after start and then on its beat, one pass at a time, logs what it did and what failed, and stops", async () => {
    const passes: number[] = [];
    let fail = false;
    let slow: ((v: { closed: number; emptied: number }) => void) | null = null;
    const store = {
      sweep: (now: number) => {
        passes.push(now);
        if (fail) return Promise.reject(new Error("down"));
        if (passes.length === 2) return new Promise((r) => { slow = r; });
        return Promise.resolve({ closed: passes.length === 1 ? 2 : 0, emptied: 0 });
      },
    } as unknown as RunStore;
    const logged: string[] = [];
    const log = { info: (o: object, m: string) => logged.push(`${m} ${JSON.stringify(o)}`), warn: (o: object, m: string) => logged.push(`${m} ${JSON.stringify(o)}`) };
    const stop = startRunSweeper({ store, firstMs: 5, everyMs: 20, now: () => 42, log });
    await expect.poll(() => passes.length).toBe(2);
    // The second pass is still going: the beat does not start another over it.
    await new Promise((r) => setTimeout(r, 60));
    expect(passes).toHaveLength(2);
    slow!({ closed: 0, emptied: 0 });
    fail = true;
    await expect.poll(() => logged.some((l) => l.startsWith("run sweep failed"))).toBe(true);
    stop();
    const after = passes.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(passes.length).toBe(after);
    expect(passes.every((n) => n === 42)).toBe(true);
    expect(logged[0]).toBe('run sweep {"runs":{"closed":2,"emptied":0}}');
    expect(logged.filter((l) => l.startsWith("run sweep {"))).toHaveLength(1);
  });
});

describe("runStore()", () => {
  it("with AGENT_RUN_LEDGER=false the ledger keeps runs in memory, and still sends receipts", async () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:1";
    process.env.SUPABASE_SERVICE_KEY = "service";
    process.env.AGENT_RUN_LEDGER = "false";
    try {
      resetConfigForTests();
      resetRunStoreForTests();
      const watch = new RunLedger().begin({ userId: ANN, runId: "run_off1", surface: "phone", platform: "ios", step: 0, said: "where is export" });
      const lines: string[] = [];
      const sink = new EventSink((l) => lines.push(l), watch.sink);
      sink.emit({ t: "heard", text: "where is export", mode: "show" });
      sink.emit({ t: "done" });
      expect(lines.map((l) => JSON.parse(l).t)).toEqual(["heard", "receipt", "done"]);
      await watch.end({ path: "model", mode: "show", words: 0, audioSeconds: 0 });
      expect(runStore()).toBeInstanceOf(MemoryRunStore);
      expect(await runStore().get(ANN, "run_off1")).toMatchObject({ outcome: "done", title: "where is export" });
    } finally {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
      delete process.env.AGENT_RUN_LEDGER;
      resetConfigForTests();
      resetRunStoreForTests();
    }
  });

  it("is Supabase only with the service key and AGENT_RUN_LEDGER on; memory otherwise", () => {
    const read = () => { resetConfigForTests(); resetRunStoreForTests(); return runStore(); };
    expect(read()).toBeInstanceOf(MemoryRunStore);
    process.env.SUPABASE_URL = "http://127.0.0.1:1";
    process.env.SUPABASE_SERVICE_KEY = "service";
    try {
      // Off by default: it is turned on once the privacy policy says what it keeps.
      expect(read()).toBeInstanceOf(MemoryRunStore);
      process.env.AGENT_RUN_LEDGER = "true";
      expect(read()).toBeInstanceOf(SupabaseRunStore);
      expect(runStore()).toBe(runStore());
      process.env.AGENT_RUN_LEDGER = "false";
      expect(read()).toBeInstanceOf(MemoryRunStore);
    } finally {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
      delete process.env.AGENT_RUN_LEDGER;
      read();
    }
  });
});
