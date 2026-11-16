/**
 * SCHEDULED CODE WORK (src/code/schedule, docs/code-schedule.md): a project's own standing job, started by the clock. What these hold down:
 *   - a schedule is kept with its first run worked out, and only on a project of the person's own;
 *   - a run goes through the ordinary door: a job with THIS schedule's budget, and the schedule remembers which job;
 *   - ONE JOB AT A TIME: a run whose last job is still working is skipped, so slow work cannot pile up behind the clock;
 *   - a run hours late (the server was down) is skipped, not run long after it meant anything;
 *   - three runs in a row that could not start pause it, with why; a project that has gone pauses it at once;
 *   - the clock moves whatever happens, so one bad run never blocks the next;
 *   - a due run is TAKEN before it starts, so two servers ticking the same minute start it once;
 *   - a person reads and steers only their own: another's is not found, never forbidden;
 *   - "Run now" runs once and leaves the schedule's own time alone.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
noNetwork();

const { CodeSchedules, MemoryCodeScheduleStore, FAILS_TO_PAUSE, SCHEDULES_MAX, DUE_PER_TICK, ScheduleError } = await import("../src/code/schedule/index.js");
const { LATE_MS } = await import("../src/routines/service.js");
type ScheduleDeps = import("../src/code/schedule/index.js").ScheduleDeps;

/** Monday, 09:00 UTC. */
const MONDAY_9 = Date.parse("2026-11-16T09:00:00Z");
const WEEKLY = { every: "week" as const, minute: 9 * 60, days: [1] };
const TASK = "update the dependencies, run the tests, and open a pull request if they pass";

function rig(over: Partial<ScheduleDeps> = {}, now = MONDAY_9) {
  const clock = { t: now };
  const started: Array<{ userId: string; projectId: string; task: string; budgetPaise: number }> = [];
  const store = new MemoryCodeScheduleStore(() => clock.t);
  let jobN = 0;
  let running = false;
  let fail: string | null = null;
  const d: ScheduleDeps = {
    store,
    project: async (userId, projectId) => (projectId === "p1" && userId === "u1" ? { id: "p1", fullName: "u1/app", defaultBranch: "main" } : null),
    startJob: async (o) => {
      if (fail) throw new Error(fail);
      started.push(o);
      return { id: `job-${(jobN += 1)}` };
    },
    jobRunning: async () => running,
    now: () => clock.t,
    ...over,
  };
  return {
    clock, started, store, s: new CodeSchedules(d),
    setRunning: (v: boolean) => { running = v; },
    setFail: (v: string | null) => { fail = v; },
  };
}

const make = (r: ReturnType<typeof rig>) => r.s.create("u1", { projectId: "p1", task: TASK, schedule: WEEKLY, tz: 0 });

describe("keeping one", () => {
  it("is kept on, with its first run worked out and the schedule said in words", async () => {
    const r = rig();
    const v = await make(r);
    expect(v).toMatchObject({ projectId: "p1", status: "on", runs: 0, lastJobId: null });
    expect(v.task).toBe(TASK);
    expect(v.when).toMatch(/Monday/i);
    expect(v.nextAt).toBeGreaterThan(r.clock.t);
  });

  it("is refused on a project that is not the person's, and for a task that says nothing", async () => {
    const r = rig();
    await expect(r.s.create("u1", { projectId: "nope", task: TASK, schedule: WEEKLY })).rejects.toMatchObject({ code: "not_found" });
    await expect(r.s.create("u2", { projectId: "p1", task: TASK, schedule: WEEKLY })).rejects.toMatchObject({ code: "not_found" });
    await expect(r.s.create("u1", { projectId: "p1", task: "go", schedule: WEEKLY })).rejects.toMatchObject({ code: "bad_task" });
    await expect(r.s.create("u1", { projectId: "p1", task: TASK, schedule: { every: "fortnight" } })).rejects.toMatchObject({ code: "bad_schedule" });
    await expect(r.s.create("u1", { projectId: "p1", task: TASK, schedule: WEEKLY, budgetPaise: 5 })).rejects.toMatchObject({ code: "bad_budget" });
    expect(ScheduleError).toBeTruthy();
  });

  it("stops at the most one account keeps", async () => {
    const r = rig();
    for (let i = 0; i < SCHEDULES_MAX; i += 1) await make(r);
    await expect(make(r)).rejects.toMatchObject({ code: "too_many" });
  });

  it("is only ever the owner's to read, change or remove", async () => {
    const r = rig();
    const v = await make(r);
    expect(await r.s.list("u1")).toHaveLength(1);
    expect(await r.s.list("u2")).toEqual([]);
    await expect(r.s.update("u2", v.id, { status: "paused" })).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(r.s.remove("u2", v.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.s.runNow("u2", v.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("a run", () => {
  it("makes a job with this schedule's own budget, and remembers which job it was", async () => {
    const r = rig();
    const v = await r.s.create("u1", { projectId: "p1", task: TASK, schedule: WEEKLY, budgetPaise: 5000 });
    r.clock.t = v.nextAt!;
    const out = await r.s.tick();

    expect(out).toMatchObject({ started: 1, skipped: 0, failed: 0 });
    expect(r.started).toEqual([{ userId: "u1", projectId: "p1", task: TASK, budgetPaise: 5000 }]);
    const after = (await r.s.list("u1"))[0]!;
    expect(after).toMatchObject({ runs: 1, lastStatus: "started", lastJobId: "job-1" });
    // The clock moved on: a week later, not now.
    expect(after.nextAt).toBeGreaterThan(r.clock.t);
  });

  it("is skipped while the job it started last time is still working: one at a time", async () => {
    const r = rig();
    const v = await make(r);
    r.clock.t = v.nextAt!;
    await r.s.tick();
    r.setRunning(true);

    const next = (await r.s.list("u1"))[0]!;
    r.clock.t = next.nextAt!;
    const out = await r.s.tick();
    expect(out).toMatchObject({ started: 0, skipped: 1 });
    expect(r.started).toHaveLength(1);
    const after = (await r.s.list("u1"))[0]!;
    expect(after.lastStatus).toBe("skipped");
    expect(after.lastText).toMatch(/still working/);
    // Its clock still moved, so it is not stuck on this one for ever.
    expect(after.nextAt).toBeGreaterThan(r.clock.t);
  });

  it("is skipped when it is hours late, and the next one is as usual", async () => {
    const r = rig();
    const v = await make(r);
    r.clock.t = v.nextAt! + LATE_MS + 60_000;
    const out = await r.s.tick();
    expect(out).toMatchObject({ started: 0, skipped: 1 });
    expect(r.started).toEqual([]);
    const after = (await r.s.list("u1"))[0]!;
    expect(after.lastText).toMatch(/missed by more than three hours/);
    expect(after.status).toBe("on");
  });

  it("pauses itself after three in a row that could not start, and says why", async () => {
    const r = rig();
    const v = await make(r);
    r.setFail("GitHub said no");
    let at = v.nextAt!;
    for (let i = 0; i < FAILS_TO_PAUSE; i += 1) {
      r.clock.t = at;
      await r.s.tick();
      const row = (await r.s.list("u1"))[0]!;
      at = row.nextAt ?? at + 60_000;
    }
    const after = (await r.s.list("u1"))[0]!;
    expect(after.status).toBe("paused");
    expect(after.pausedWhy).toMatch(new RegExp(`Paused after ${FAILS_TO_PAUSE} runs in a row`));
    expect(after.pausedWhy).toContain("GitHub said no");
    expect(after.nextAt).toBeNull();
  });

  it("pauses at once when the project it ran on has gone", async () => {
    const r = rig({ project: async () => null });
    const store = r.store;
    const row = await store.create({ userId: "u1", projectId: "p1", task: TASK, schedule: WEEKLY, tz: 0, budgetPaise: 3000, nextAt: MONDAY_9 });
    r.clock.t = MONDAY_9 + 1000;
    await r.s.tick();
    const after = await store.byId(row.id);
    expect(after).toMatchObject({ status: "paused", nextAt: null });
    expect(after!.pausedWhy).toMatch(/project .* is gone/i);
  });

  it("starts at most a handful in one pass, so one tick cannot flood the router", async () => {
    const r = rig();
    for (let i = 0; i < DUE_PER_TICK + 3; i += 1) {
      await r.store.create({ userId: "u1", projectId: "p1", task: `${TASK} ${i}`, schedule: WEEKLY, tz: 0, budgetPaise: 3000, nextAt: MONDAY_9 - 1000 });
    }
    const out = await r.s.tick();
    expect(out.started).toBe(DUE_PER_TICK);
    expect(r.started).toHaveLength(DUE_PER_TICK);
  });

  it("is TAKEN before it starts, so two servers ticking the same minute start it once", async () => {
    const r = rig();
    const v = await make(r);
    r.clock.t = v.nextAt!;
    // Two passes over the same store at the same moment, as two servers would.
    const second = new CodeSchedules({
      store: r.store,
      project: async () => ({ id: "p1", fullName: "u1/app", defaultBranch: "main" }),
      startJob: async (o) => { r.started.push(o); return { id: "job-other" }; },
      jobRunning: async () => false,
      now: () => r.clock.t,
    });
    const [a, b] = await Promise.all([r.s.tick(), second.tick()]);
    expect(a.started + b.started).toBe(1);
    expect(r.started).toHaveLength(1);
    expect((await r.s.list("u1"))[0]!.runs).toBe(1);
  });

  it("is not taken twice when the same pass runs again after its time moved", async () => {
    const r = rig();
    const v = await make(r);
    r.clock.t = v.nextAt!;
    await r.s.tick();
    // The clock has moved on, so the same minute's pass finds nothing due.
    expect(await r.s.tick()).toMatchObject({ started: 0 });
    expect(r.started).toHaveLength(1);
  });

  it("never throws out of a tick when the store is down", async () => {
    const r = rig({ store: { ...new MemoryCodeScheduleStore(), due: async () => { throw new Error("the database is away"); } } as never });
    await expect(r.s.tick()).resolves.toEqual({ started: 0, skipped: 0, failed: 0 });
  });
});

describe("steering one", () => {
  it("pauses, and a paused one is not due however long it waits", async () => {
    const r = rig();
    const v = await make(r);
    const paused = await r.s.update("u1", v.id, { status: "paused" });
    expect(paused).toMatchObject({ status: "paused", nextAt: null });
    r.clock.t = MONDAY_9 + 30 * 86_400_000;
    expect(await r.s.tick()).toMatchObject({ started: 0 });
  });

  it("resumes from now, forgetting what failed before", async () => {
    const r = rig();
    const v = await make(r);
    r.setFail("nope");
    r.clock.t = v.nextAt!;
    await r.s.tick();
    await r.s.update("u1", v.id, { status: "paused" });

    r.clock.t = MONDAY_9 + 86_400_000;
    const on = await r.s.update("u1", v.id, { status: "on" });
    expect(on.status).toBe("on");
    expect(on.nextAt).toBeGreaterThan(r.clock.t);
    expect(on.pausedWhy).toBe("");
  });

  it("takes a new task, time and budget, and works the next run out again for a new time", async () => {
    const r = rig();
    const v = await make(r);
    const changed = await r.s.update("u1", v.id, { task: "run the tests and tell me what broke", budgetPaise: 1000, schedule: { every: "day", minute: 7 * 60 } });
    expect(changed.task).toBe("run the tests and tell me what broke");
    expect(changed.budgetPaise).toBe(1000);
    expect(changed.when).toMatch(/every day/i);
    expect(changed.nextAt).toBeGreaterThan(r.clock.t);
    await expect(r.s.update("u1", v.id, { status: "sideways" })).rejects.toMatchObject({ code: "bad_status" });
  });

  it("runs once on demand and leaves its own time alone", async () => {
    const r = rig();
    const v = await make(r);
    const before = v.nextAt;
    const out = await r.s.runNow("u1", v.id);
    expect(out).toMatchObject({ runs: 1, lastStatus: "started", nextAt: before });
    expect(r.started).toHaveLength(1);
  });

  it("is gone when removed", async () => {
    const r = rig();
    const v = await make(r);
    await r.s.remove("u1", v.id);
    expect(await r.s.list("u1")).toEqual([]);
    r.clock.t = MONDAY_9 + 8 * 86_400_000;
    expect(await r.s.tick()).toMatchObject({ started: 0 });
  });
});
