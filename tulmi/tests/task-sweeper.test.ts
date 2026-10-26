/**
 * The stuck-task sweeper (connectors/sweeper.ts, store.ts failStuckTasks, and
 * its start in routes/connectors.ts).
 *
 * What must hold: a task running for more than ten minutes with nothing
 * happening is failed, with the reason as its last step, when the server is
 * ready and then every minute; one running for less, and one waiting for a
 * yes however old, are left as they are; the Supabase twin fails a task only
 * if it is still running and unchanged since it was read; sweepEveryMs: null
 * turns it off; and a pass that fails never throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { MemoryConnectorStore, SupabaseConnectorStore, TASK_STEPS_MAX } = await import("../src/connectors/store.js");
const { STUCK_MS, STUCK_STEP, startTaskSweeper, sweepTasks } = await import("../src/connectors/sweeper.js");
const { registerConnectorRoutes } = await import("../src/routes/connectors.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { ALWAYS_ON } = await import("../src/connectors/catalog.js");
type Store = InstanceType<typeof MemoryConnectorStore>;

const MIN = 60_000;
const ANN = "11111111-2222-4333-8444-555555555555";
const BOB = "66666666-7777-4888-8999-000000000000";

afterEach(() => { vi.useRealTimers(); });

/** A task made `ago` ms before now, in `state`, with an approval while it waits. */
async function taskAt(store: Store, userId: string, ago: number, state: "running" | "waiting", title = "t") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() - ago);
  const t = await store.createTask(userId, { runId: `run_${title}`, title });
  const approval = state === "waiting" ? { id: "a1", connector: "google-tasks", tool: "add_task", risk: "write" as const, preview: "Add", args: { title: "Gym" }, at: Date.now() } : null;
  await store.updateTask(userId, t.id, { state, approval, steps: [{ at: Date.now(), text: "Google Tasks: Add task" }] });
  vi.useRealTimers();
  return t.id;
}

const stateOf = async (store: Store, userId: string, id: string) => (await store.getTask(userId, id))!;

describe("sweepTasks", () => {
  it("fails a task running for more than ten minutes, with the reason as its last step; leaves a nine-minute one and any waiting one", async () => {
    const store = new MemoryConnectorStore();
    const stuck = await taskAt(store, ANN, 11 * MIN, "running", "stuck");
    const busy = await taskAt(store, ANN, 9 * MIN, "running", "busy");
    const waits = await taskAt(store, ANN, 3 * 60 * MIN, "waiting", "waits");
    const theirs = await taskAt(store, BOB, 30 * MIN, "running", "theirs");
    expect(STUCK_MS).toBe(10 * MIN);
    expect(STUCK_STEP).toBe("Stopped: nothing happened for 10 minutes.");

    expect(await sweepTasks(store, Date.now())).toBe(2);
    const t = await stateOf(store, ANN, stuck);
    expect(t.state).toBe("failed");
    expect(t.steps.at(-1)!.text).toBe(STUCK_STEP);
    expect(t.steps.length).toBe(2);
    expect(t.approval).toBeNull();
    // Across everyone: the sweep is not one person's.
    expect((await stateOf(store, BOB, theirs)).state).toBe("failed");
    expect((await stateOf(store, ANN, busy)).state).toBe("running");
    const w = await stateOf(store, ANN, waits);
    expect(w.state).toBe("waiting");
    expect(w.approval).not.toBeNull();
    // Nothing left to do: a second pass changes nothing.
    expect(await sweepTasks(store, Date.now())).toBe(0);
    // Two minutes on, the nine-minute one is stuck too.
    expect(await sweepTasks(store, Date.now() + 2 * MIN)).toBe(1);
    expect((await stateOf(store, ANN, busy)).state).toBe("failed");
  });

  it("keeps the newest steps, as a task always does, and closes at most a batch at a time", async () => {
    const store = new MemoryConnectorStore();
    const id = await taskAt(store, ANN, 20 * MIN, "running");
    await store.updateTask(ANN, id, { steps: Array.from({ length: TASK_STEPS_MAX }, (_, i) => ({ at: i, text: `s${i}` })) });
    expect(await store.failStuckTasks(Date.now() + MIN, STUCK_STEP)).toBe(1);
    const steps = (await stateOf(store, ANN, id)).steps;
    expect(steps.length).toBe(TASK_STEPS_MAX);
    expect(steps[0]!.text).toBe("s1");
    expect(steps.at(-1)!.text).toBe(STUCK_STEP);

    const many = new MemoryConnectorStore();
    for (let i = 0; i < 5; i++) await taskAt(many, ANN, (20 + i) * MIN, "running", `m${i}`);
    expect(await many.failStuckTasks(Date.now() - STUCK_MS, STUCK_STEP, 3)).toBe(3);
    // The oldest first.
    const left = (await many.listTasks(ANN, 10)).filter((x) => x.state === "running").map((x) => x.title).sort();
    expect(left).toEqual(["m0", "m1"]);
  });
});

describe("startTaskSweeper", () => {
  it("a pass at once, then every minute, and stop stops it", async () => {
    const store = new MemoryConnectorStore();
    const first = await taskAt(store, ANN, 11 * MIN, "running", "first");
    const later = await taskAt(store, ANN, 9.5 * MIN, "running", "later");
    vi.useFakeTimers();
    const passes: number[] = [];
    const real = store.failStuckTasks.bind(store);
    store.failStuckTasks = async (...a) => { const n = await real(...a); passes.push(n); return n; };
    const stop = startTaskSweeper({ store, everyMs: MIN });
    await vi.advanceTimersByTimeAsync(0);
    expect(passes).toEqual([1]);
    expect((await stateOf(store, ANN, first)).state).toBe("failed");
    expect((await stateOf(store, ANN, later)).state).toBe("running");

    // The one that gets stuck meanwhile is caught on the minute.
    await vi.advanceTimersByTimeAsync(MIN);
    expect(passes).toEqual([1, 1]);
    expect((await stateOf(store, ANN, later)).state).toBe("failed");
    stop();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(passes.length).toBe(2);
  });

  it("a pass that fails is logged, and the next minute tries again", async () => {
    vi.useFakeTimers();
    const warned: string[] = [];
    let n = 0;
    const store = { failStuckTasks: async () => { n += 1; if (n === 1) throw new Error("database away"); return 0; } } as unknown as Store;
    const stop = startTaskSweeper({ store, everyMs: MIN, log: { info: () => {}, warn: (o) => { warned.push(JSON.stringify(o)); } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(warned).toEqual([JSON.stringify({ error: "database away" })]);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(n).toBe(2);
    stop();
  });
});

describe("started with the routes that own /v1/tasks", () => {
  async function app(o: { sweepEveryMs?: number | null; connectors?: boolean } = {}) {
    const store = new MemoryConnectorStore();
    const connectors = o.connectors === false ? null : createConnectors({ store, redirectUrl: "https://api.example.com/v1/connectors/callback", catalog: [...ALWAYS_ON] });
    const a = Fastify();
    registerConnectorRoutes(a, { rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } }, connectors, ...(o.sweepEveryMs !== undefined ? { sweepEveryMs: o.sweepEveryMs } : {}) });
    return { a, store };
  }

  it("on start (onReady), a task stuck since before the server came up is failed with the reason", async () => {
    const { a, store } = await app();
    const id = await taskAt(store, ANN, 11 * MIN, "running");
    const waits = await taskAt(store, ANN, 2 * 60 * MIN, "waiting", "w");
    await a.ready();
    await vi.waitFor(async () => expect((await stateOf(store, ANN, id)).state).toBe("failed"));
    expect((await stateOf(store, ANN, id)).steps.at(-1)!.text).toBe(STUCK_STEP);
    expect((await stateOf(store, ANN, waits)).state).toBe("waiting");
    await a.close();
  });

  it("and on the minute (here, a short one), until the server closes", async () => {
    const { a, store } = await app({ sweepEveryMs: 20 });
    await a.ready();
    const id = await taskAt(store, ANN, 11 * MIN, "running");
    await vi.waitFor(async () => expect((await stateOf(store, ANN, id)).state).toBe("failed"));
    await a.close();
    const after = await taskAt(store, ANN, 11 * MIN, "running", "after");
    await new Promise((r) => setTimeout(r, 80));
    expect((await stateOf(store, ANN, after)).state).toBe("running");
  });

  it("sweepEveryMs: null turns it off, and with connected apps off there is nothing to sweep", async () => {
    const { a, store } = await app({ sweepEveryMs: null });
    const id = await taskAt(store, ANN, 11 * MIN, "running");
    await a.ready();
    await new Promise((r) => setTimeout(r, 30));
    expect((await stateOf(store, ANN, id)).state).toBe("running");
    await a.close();
    const off = await app({ connectors: false });
    await off.a.ready();
    await off.a.close();
  });
});

// ------------------------------------------------- the Supabase twin, on a fake client

/** Just enough of supabase-js for assistant_tasks: select / update, eq / lt, order, limit, maybeSingle. */
function fakeSupabase(rows: Array<Record<string, unknown>>, o: { before?: (op: string) => void } = {}) {
  const log: string[] = [];
  const from = (table: string) => {
    let op: "select" | "update" = "select";
    let payload: Record<string, unknown> = {};
    const where: Array<(r: Record<string, unknown>) => boolean> = [];
    const said: string[] = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    const run = () => {
      o.before?.(op);
      log.push(`${op} ${table} ${said.join(" ")}`);
      let out = rows.filter((r) => where.every((f) => f(r)));
      if (op === "update") for (const r of out) Object.assign(r, payload);
      if (order) { const { col, asc } = order; out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)); }
      if (limit !== null) out = out.slice(0, limit);
      return { data: structuredClone(out), error: null };
    };
    const b = {
      select: () => b,
      update: (p: Record<string, unknown>) => { op = "update"; payload = p; return b; },
      eq: (col: string, v: unknown) => { said.push(`${col}=${String(v)}`); where.push((r) => r[col] === v); return b; },
      lt: (col: string, v: string) => { said.push(`${col}<${v}`); where.push((r) => String(r[col]) < v); return b; },
      order: (col: string, x?: { ascending?: boolean }) => { order = { col, asc: x?.ascending !== false }; return b; },
      limit: (n: number) => { limit = n; return b; },
      returns: () => b,
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko),
    };
    return b;
  };
  return { from, log };
}

describe("SupabaseConnectorStore.failStuckTasks", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const now = Date.parse("2026-10-24T10:00:00.000Z");
  const row = (id: string, state: string, updated: number, extra: Record<string, unknown> = {}) => ({
    id, user_id: ANN, run_id: `run_${id}`, state, title: id, steps: [{ at: 1, text: "a step" }], approval: null,
    created_at: iso(updated), updated_at: iso(updated), ...extra,
  });

  it("reads the oldest running ones, and fails each only if it is still running and unchanged since it was read", async () => {
    const rows = [
      row("old", "running", now - 30 * MIN, { approval: { id: "x" } }),
      row("moved", "running", now - 20 * MIN),
      row("fresh", "running", now - 2 * MIN),
      row("waits", "waiting", now - 5 * 60 * MIN),
      row("done", "done", now - 60 * MIN),
    ];
    // Between the read and the writes, "moved" is approved and written by someone else.
    let reads = 0;
    const sb = fakeSupabase(rows, { before: (op) => { if (op === "update" && reads++ === 0) { const m = rows.find((r) => r.id === "moved")!; m.updated_at = iso(now - MIN); } } });
    const store = new SupabaseConnectorStore(sb as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    expect(await store.failStuckTasks(now - STUCK_MS, STUCK_STEP)).toBe(1);
    vi.useRealTimers();

    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by("old")).toMatchObject({ state: "failed", approval: null, updated_at: iso(now) });
    expect((by("old").steps as Array<{ text: string }>).map((s) => s.text)).toEqual(["a step", STUCK_STEP]);
    expect(by("moved").state).toBe("running");
    expect(by("fresh").state).toBe("running");
    expect(by("waits").state).toBe("waiting");
    expect(by("done").state).toBe("done");
    // The read: running, older than the cut-off, oldest first. Each write: by id, still running, unchanged.
    expect(sb.log[0]).toBe(`select assistant_tasks state=running updated_at<${iso(now - STUCK_MS)}`);
    expect(sb.log[1]).toBe(`update assistant_tasks id=old state=running updated_at=${iso(now - 30 * MIN)}`);
    expect(sb.log[2]).toBe(`update assistant_tasks id=moved state=running updated_at=${iso(now - 20 * MIN)}`);
    expect(sb.log.length).toBe(3);
  });

  it("is across everyone: no user id is asked for or needed", async () => {
    const rows = [row("a", "running", now - 30 * MIN), { ...row("b", "running", now - 30 * MIN), user_id: "dev-user" }];
    const sb = fakeSupabase(rows);
    const store = new SupabaseConnectorStore(sb as never);
    expect(await store.failStuckTasks(now - STUCK_MS, STUCK_STEP, 200)).toBe(2);
    expect(sb.log.every((l) => !l.includes("user_id"))).toBe(true);
  });
});
