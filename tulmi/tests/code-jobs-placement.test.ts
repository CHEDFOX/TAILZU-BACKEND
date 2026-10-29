/**
 * The pieces of the job router that stand alone (src/code/jobs): the placement
 * rule as a pure function (its whole truth table), GitHub's free-minutes
 * estimate, the device book, the jobs' stores (memory, and the Supabase twin
 * against a recording stub), the ticker, the lock, what a step's output keeps,
 * the setting, and the pushes the person gets. The router working on a real
 * (fake) repo is in code-jobs.test.ts; the routes are in code-jobs-routes.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const {
  choosePlacement, githubMinutesLeft, rupees, GITHUB_FREE_MINUTES_DEFAULT, GITHUB_HEADROOM,
} = await import("../src/code/jobs/placement.js");
const { DeviceBook, allows } = await import("../src/code/jobs/devices.js");
const { MemoryJobStore, SupabaseJobStore, TooManySteps, DEFAULT_SETTINGS } = await import("../src/code/jobs/store.js");
const { startJobTicker } = await import("../src/code/jobs/ticker.js");
const { KeyedLock, keepOutput, tailBytes } = await import("../src/code/jobs/util.js");
const types = await import("../src/code/jobs/types.js");
const { CodeNeedsAccount } = await import("../src/code/store.js");
const { DEVICE_ONLINE_MS, LEASE_MS, TICK_MS, MAX_REASSIGNMENTS, OUTPUT_TAIL_BYTES, STEPS_MAX, brief, monthKey, isEnded } = types;

type Ctx = Parameters<typeof choosePlacement>[0];

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ----------------------------------------------------------- the numbers

describe("the numbers the router goes by", () => {
  it("are the ones the founder set: a lease of 90 seconds, a PC online for 60, a tick every 15, five moves, an 8 KB tail", () => {
    expect(LEASE_MS).toBe(90_000);
    expect(DEVICE_ONLINE_MS).toBe(60_000);
    expect(DEVICE_ONLINE_MS).toBeLessThan(LEASE_MS); // a PC that went quiet is out of the choice before its lease runs out
    expect(TICK_MS).toBe(15_000);
    expect(MAX_REASSIGNMENTS).toBe(5);
    expect(OUTPUT_TAIL_BYTES).toBe(8192);
    expect(types.TASK_KEEP).toBe(500);
    expect(types.LONG_POLL_MS).toBe(25_000);
    expect(GITHUB_FREE_MINUTES_DEFAULT).toBe(2000);
    expect(GITHUB_HEADROOM).toBe(0.1);
  });

  it("names the states and the ones that end", () => {
    expect(types.JOB_STATES).toEqual(["queued", "running", "waiting_for_compute", "waiting_for_you", "paused", "done", "failed", "cancelled"]);
    expect(types.PLACEMENTS).toEqual(["none", "desktop", "github", "paid"]);
    expect(types.JOB_STATES.filter(isEnded)).toEqual(["done", "failed", "cancelled"]);
  });

  it("works out a UTC month, and the first line of a task", () => {
    expect(monthKey(Date.UTC(2026, 9, 31, 23, 59, 59))).toBe("2026-10");
    expect(monthKey(Date.UTC(2026, 10, 1, 0, 0, 0))).toBe("2026-11");
    expect(monthKey(Date.UTC(2027, 0, 1))).toBe("2027-01");
    expect(brief("fix the build\nthen the tests")).toBe("fix the build");
    expect(brief("x".repeat(100), 10)).toBe("xxxxxxxxx…");
    expect(brief("  short  ")).toBe("short");
  });
});

// ------------------------------------------------- GitHub's free minutes

describe("GitHub's free minutes", () => {
  it("are 2,000 a month less a tenth kept back, less what Tailzu used, never below zero", () => {
    expect(githubMinutesLeft(2000, 0)).toBe(1800);
    expect(githubMinutesLeft(2000, 1)).toBe(1799);
    expect(githubMinutesLeft(2000, 1800)).toBe(0);
    expect(githubMinutesLeft(2000, 5000)).toBe(0);
    expect(githubMinutesLeft(100, 0)).toBe(90);
    expect(githubMinutesLeft(0, 0)).toBe(0);
    expect(githubMinutesLeft(3000, 500)).toBe(2200);
    // Whole minutes: a tenth of 15 is 1.5, so 13 (not 13.5) are ours.
    expect(githubMinutesLeft(15, 0)).toBe(13);
    // A different headroom, and nonsense in.
    expect(githubMinutesLeft(2000, 0, 0.5)).toBe(1000);
    expect(githubMinutesLeft(2000, 0, 0)).toBe(2000);
    expect(githubMinutesLeft(Number.NaN, 5)).toBe(0);
    expect(githubMinutesLeft(2000, Number.NaN)).toBe(1800);
    expect(githubMinutesLeft(-5, 0)).toBe(0);
    expect(githubMinutesLeft(2000, -50)).toBe(1800);
  });

  it("are CODE_GITHUB_FREE_MINUTES, 2000 by default", async () => {
    const { getConfig, resetConfigForTests } = await import("../src/config.js");
    const { freeMinutesFromEnv } = await import("../src/code/jobs/index.js");
    resetConfigForTests();
    expect(getConfig().CODE_GITHUB_FREE_MINUTES).toBe(2000);
    expect(freeMinutesFromEnv()).toBe(2000);
    process.env.CODE_GITHUB_FREE_MINUTES = "500";
    resetConfigForTests();
    expect(freeMinutesFromEnv()).toBe(500);
    process.env.CODE_GITHUB_FREE_MINUTES = "0";
    resetConfigForTests();
    expect(freeMinutesFromEnv()).toBe(0);
    delete process.env.CODE_GITHUB_FREE_MINUTES;
    resetConfigForTests();
  });

  it("show money as rupees", () => {
    expect(rupees(0)).toBe("₹0");
    expect(rupees(200)).toBe("₹2");
    expect(rupees(1250)).toBe("₹12.50");
    expect(rupees(5)).toBe("₹0.05");
    expect(rupees(-3)).toBe("₹0");
    expect(rupees(99.6)).toBe("₹1");
  });
});

// ------------------------------------------------------- the truth table

const base: Ctx = {
  desktops: 0, githubEnabled: false, githubMinutesLeft: 0, paidRule: "never", paidAvailable: true, paidLeftPaise: 0, estimateMinutes: 5, estimatePaise: 500,
};
const ctx = (over: Partial<Ctx>): Ctx => ({ ...base, ...over });

describe("choosePlacement: the cheapest place there is", () => {
  const rows: Array<[string, Partial<Ctx>, string]> = [
    // 1. The person's own PC beats everything.
    ["a PC is online", { desktops: 1 }, "desktop"],
    ["two PCs are online", { desktops: 2 }, "desktop"],
    ["a PC is online, GitHub has minutes, paid is on automatic", { desktops: 1, githubEnabled: true, githubMinutesLeft: 1000, paidRule: "auto", paidLeftPaise: 99_999 }, "desktop"],
    ["a PC is online and nothing else is", { desktops: 1, paidAvailable: false }, "desktop"],
    // 2. Then GitHub's free computers.
    ["no PC, GitHub on with minutes to spare", { githubEnabled: true, githubMinutesLeft: 1800 }, "github"],
    ["no PC, GitHub has exactly the minutes the step needs", { githubEnabled: true, githubMinutesLeft: 5 }, "github"],
    ["no PC, GitHub on, paid on automatic", { githubEnabled: true, githubMinutesLeft: 10, paidRule: "auto", paidLeftPaise: 99_999 }, "github"],
    ["no PC, GitHub on, paid ask", { githubEnabled: true, githubMinutesLeft: 10, paidRule: "ask" }, "github"],
    ["no PC, GitHub on, a step with no estimate (counts as a minute)", { githubEnabled: true, githubMinutesLeft: 1, estimateMinutes: 0 }, "github"],
    ["no PC, GitHub on, a step of 4.2 minutes (counts as 5)", { githubEnabled: true, githubMinutesLeft: 5, estimateMinutes: 4.2 }, "github"],
    // 3. Then paid, by the rule.
    ["no PC, GitHub off, paid on automatic and inside the cap", { paidRule: "auto", paidLeftPaise: 500 }, "paid"],
    ["no PC, GitHub used up, paid on automatic and inside the cap", { githubEnabled: true, githubMinutesLeft: 4, paidRule: "auto", paidLeftPaise: 10_000 }, "paid"],
    ["no PC, GitHub used up, paid ask but the person said yes for this job", { githubEnabled: true, githubMinutesLeft: 0, paidRule: "ask", paidLeftPaise: 500 }, "paid"],
    ["no PC, a free step on paid compute", { paidRule: "auto", paidLeftPaise: 0, estimatePaise: 0 }, "paid"],
  ];
  for (const [name, over, want] of rows) {
    it(`${name}: ${want}`, () => {
      const c = choosePlacement(ctx(over));
      expect(c).toMatchObject({ placement: want, reason: expect.any(String) });
      expect("wait" in c || "ask" in c).toBe(false);
    });
  }

  it("asks, never with a price, when paid is the only place left and the rule or the cap says to", () => {
    const ask = choosePlacement(ctx({ paidRule: "ask" }));
    expect(ask).toEqual({ ask: true, estimatePaise: 500, reason: expect.stringMatching(/Paid compute needs your yes, as you asked\.$/) });
    expect(ask.reason).not.toMatch(/₹/);
    const over = choosePlacement(ctx({ paidRule: "auto", paidLeftPaise: 499 }));
    expect(over).toEqual({ ask: true, estimatePaise: 500, reason: expect.stringMatching(/go over your monthly automatic limit/) });
    expect(choosePlacement(ctx({ paidRule: "auto", paidLeftPaise: 0 }))).toMatchObject({ ask: true });
    // GitHub's minutes short by one: still asks.
    expect(choosePlacement(ctx({ githubEnabled: true, githubMinutesLeft: 4, paidRule: "ask" }))).toMatchObject({ ask: true, estimatePaise: 500 });
    // The price is whole paise, rounded up.
    expect(choosePlacement(ctx({ paidRule: "ask", estimatePaise: 12.2 }))).toMatchObject({ ask: true, estimatePaise: 13 });
  });

  it("waits, and says why, when there is nowhere", () => {
    const never = choosePlacement(ctx({}));
    expect(never).toEqual({
      wait: true,
      reason: "None of your computers is online and allowed for this project, GitHub's free computers aren't set up for this project, and paid compute is off. It will carry on by itself when one is.",
    });
    expect(choosePlacement(ctx({ githubEnabled: true, githubMinutesLeft: 4 }))).toMatchObject({
      wait: true, reason: expect.stringContaining("this month's free GitHub minutes are used up"),
    });
    // The rule allows paid but there is none on this server: wait, never ask for money that can't be spent.
    const none = choosePlacement(ctx({ paidRule: "auto", paidLeftPaise: 99_999, paidAvailable: false }));
    expect(none).toMatchObject({ wait: true, reason: expect.stringContaining("there is no paid compute to use") });
    expect(choosePlacement(ctx({ paidRule: "ask", paidAvailable: false }))).toMatchObject({ wait: true });
    // "never" beats a budget the person said yes to earlier.
    expect(choosePlacement(ctx({ paidRule: "never", paidLeftPaise: 99_999 }))).toMatchObject({ wait: true });
  });

  it("holds for EVERY combination of the facts (checked against the rule written out the long way)", () => {
    let n = 0;
    for (const desktops of [0, 1, 3])
      for (const githubEnabled of [false, true])
        for (const githubMinutesLeft of [0, 4, 5, 6, 1800])
          for (const paidRule of ["never", "ask", "auto"] as const)
            for (const paidAvailable of [false, true])
              for (const paidLeftPaise of [0, 499, 500, 501, 100_000])
                for (const estimateMinutes of [0, 1, 5])
                  for (const estimatePaise of [0, 500]) {
                    const c: Ctx = { desktops, githubEnabled, githubMinutesLeft, paidRule, paidAvailable, paidLeftPaise, estimateMinutes, estimatePaise };
                    const got = choosePlacement(c);
                    const label = JSON.stringify(c);
                    n += 1;
                    const need = Math.max(1, Math.ceil(estimateMinutes));
                    const canPaid = paidRule !== "never" && paidAvailable;
                    let want: "desktop" | "github" | "paid" | "ask" | "wait";
                    if (desktops > 0) want = "desktop";
                    else if (githubEnabled && need <= githubMinutesLeft) want = "github";
                    else if (canPaid && estimatePaise <= paidLeftPaise) want = "paid";
                    else if (canPaid) want = "ask";
                    else want = "wait";
                    const kind = "placement" in got ? got.placement : "ask" in got ? "ask" : "wait";
                    expect(kind, label).toBe(want);
                    expect(got.reason.length, label).toBeGreaterThan(20);
                    // The invariants the product depends on, stated on their own.
                    if (desktops > 0) expect(kind, label).toBe("desktop");
                    if (kind === "github") expect(desktops === 0 && githubEnabled, label).toBe(true);
                    if (kind === "paid") expect(desktops === 0 && paidRule !== "never" && paidAvailable && !(githubEnabled && need <= githubMinutesLeft), label).toBe(true);
                    if (paidRule === "never" || !paidAvailable) expect(["paid", "ask"], label).not.toContain(kind);
                    if ("ask" in got) expect(got.estimatePaise, label).toBe(estimatePaise);
                  }
    expect(n).toBe(3 * 2 * 5 * 3 * 2 * 5 * 3 * 2);
  });
});

// --------------------------------------------------------- the device book

describe("the device book", () => {
  const beat = (id: string, o: Partial<Parameters<InstanceType<typeof DeviceBook>["beat"]>[1]> = {}) =>
    ({ deviceId: id, name: id, allowRun: true, projects: "all" as const, busy: false, ...o });

  it("holds a PC online for 60 seconds from its last heartbeat, and says when a heartbeat changes what it can do", () => {
    const book = new DeviceBook();
    expect(book.beat("u", beat("d1"), 1000)).toBe(true); // new
    expect(book.beat("u", beat("d1"), 31_000)).toBe(false); // nothing changed
    expect(book.online("u", "d1", 31_000 + DEVICE_ONLINE_MS)).toMatchObject({ deviceId: "d1", lastSeen: 31_000 });
    expect(book.online("u", "d1", 31_000 + DEVICE_ONLINE_MS + 1)).toBeNull();
    expect(book.beat("u", beat("d1"), 31_000 + DEVICE_ONLINE_MS + 5)).toBe(true); // back from offline
    expect(book.beat("u", beat("d1", { busy: true }), 100_000)).toBe(true);
    expect(book.beat("u", beat("d1", { busy: true }), 110_000)).toBe(false);
    expect(book.beat("u", beat("d1", { busy: true, allowRun: false }), 120_000)).toBe(true);
    expect(book.beat("u", beat("d1", { busy: true, allowRun: false, projects: ["p1"] }), 130_000)).toBe(true);
    expect(book.beat("u", beat("d1", { busy: true, allowRun: false, projects: ["p1"] }), 140_000)).toBe(false);
    expect(book.beat("u", beat("d1", { busy: true, allowRun: false, projects: ["p1", "p2"] }), 150_000)).toBe(true);
    expect(book.beat("u", beat("d1", { busy: true, allowRun: false, projects: ["p2", "p1"] }), 160_000)).toBe(false); // the same list
    expect(book.beat("u", beat("d1", { busy: true, allowRun: false, projects: "all" }), 170_000)).toBe(true);
  });

  it("is each person's own: the same device id of another person is another device", () => {
    const book = new DeviceBook();
    book.beat("alice", beat("shared-id", { name: "A" }), 1000);
    book.beat("bob", beat("shared-id", { name: "B" }), 1000);
    expect(book.onlineFor("alice", 1000).map((d) => d.name)).toEqual(["A"]);
    expect(book.onlineFor("bob", 1000).map((d) => d.name)).toEqual(["B"]);
    expect(book.online("alice", "nobody", 1000)).toBeNull();
    expect(book.onlineFor("carol", 1000)).toEqual([]);
  });

  it("picks, for a project, the PCs that are online, allowed to run, allowed on it and idle, the freshest first", () => {
    const book = new DeviceBook();
    book.beat("u", beat("all-old"), 1000);
    book.beat("u", beat("all-new"), 5000);
    book.beat("u", beat("only-p1", { projects: ["p1"] }), 3000);
    book.beat("u", beat("only-p2", { projects: ["p2"] }), 4000);
    book.beat("u", beat("no-run", { allowRun: false }), 4000);
    book.beat("u", beat("busy", { busy: true }), 4000);
    book.beat("u", beat("none", { projects: [] }), 4000);
    expect(book.capable("u", "p1", 6000).map((d) => d.deviceId)).toEqual(["all-new", "only-p1", "all-old"]);
    expect(book.capable("u", "p2", 6000).map((d) => d.deviceId)).toEqual(["all-new", "only-p2", "all-old"]);
    expect(book.capable("u", "p3", 6000).map((d) => d.deviceId)).toEqual(["all-new", "all-old"]);
    // 62 seconds on, all-old (heard at 1000) is offline.
    expect(book.capable("u", "p1", 62_000).map((d) => d.deviceId)).toEqual(["all-new", "only-p1"]);
    expect(allows({ projects: "all" }, "x")).toBe(true);
    expect(allows({ projects: ["a"] }, "a")).toBe(true);
    expect(allows({ projects: ["a"] }, "b")).toBe(false);
  });

  it("keeps no more than 20 per person (the one heard longest ago goes) and forgets the long gone", () => {
    const book = new DeviceBook();
    for (let i = 0; i < 25; i += 1) book.beat("u", beat(`device-${String(i).padStart(2, "0")}`), 1000 + i);
    const ids = book.onlineFor("u", 2000).map((d) => d.deviceId);
    expect(ids).toHaveLength(20);
    expect(ids).not.toContain("device-00");
    expect(ids).toContain("device-24");
    expect(book.size).toBe(20);
    expect(book.prune(1000 + 10 * 60_000)).toBe(0);
    expect(book.prune(1000 + 10 * 60_000 + 30)).toBe(20); // everything heard more than 10 minutes ago goes
    expect(book.size).toBe(0);
  });
});

// ---------------------------------------------------------- the stores

describe("the jobs' store (memory)", () => {
  const newJob = { userId: "alice", projectId: "p1", branch: "tailzu/x-1111", task: "t", budgetPaise: 0 };

  it("changes a job only if the epoch, the state and the expiry are what the caller read: the fence", async () => {
    let t = 1000;
    const store = new MemoryJobStore(() => t);
    const j = await store.createJob(newJob);
    expect(j).toMatchObject({ state: "queued", leaseEpoch: 0, createdAt: 1000, updatedAt: 1000 });
    t = 2000;
    // The right epoch changes it; the answer is the job as it is now.
    const a = await store.casJob(j.id, { leaseEpoch: 0, states: ["queued"] }, { state: "running", placement: "desktop", leaseHolder: "d", leaseEpoch: 1, leaseExpiresAt: 5000 });
    expect(a).toMatchObject({ state: "running", leaseEpoch: 1, updatedAt: 2000 });
    // The same change from someone who read it before: refused, and nothing moved.
    expect(await store.casJob(j.id, { leaseEpoch: 0 }, { state: "failed" })).toBeNull();
    expect(await store.casJob(j.id, { leaseEpoch: 1, states: ["queued", "waiting_for_compute"] }, { state: "failed" })).toBeNull();
    expect((await store.getJobById(j.id))!.state).toBe("running");
    // The lease must have run out by then.
    expect(await store.casJob(j.id, { leaseEpoch: 1, leaseExpiredBy: 4999 }, { state: "failed" })).toBeNull();
    expect(await store.casJob(j.id, { leaseEpoch: 1, leaseExpiredBy: 5000 }, { leaseHolder: null })).toMatchObject({ leaseHolder: null });
    await store.casJob(j.id, {}, { leaseExpiresAt: null });
    expect(await store.casJob(j.id, { leaseExpiredBy: 9999 }, { state: "failed" })).toBeNull(); // no expiry set any more: not "expired"
    expect(await store.casJob("nope", {}, { state: "failed" })).toBeNull();
    // What comes back is a copy.
    const got = (await store.getJobById(j.id))!;
    got.checkpoint.notes = "tampered";
    expect((await store.getJobById(j.id))!.checkpoint.notes).toBe("");
  });

  it("scopes a job to its person and lists newest first, and counts the ones that are not over", async () => {
    const store = new MemoryJobStore();
    const a = await store.createJob(newJob);
    const b = await store.createJob({ ...newJob, task: "second" });
    await store.createJob({ ...newJob, userId: "bob" });
    expect(await store.getJob("bob", a.id)).toBeNull();
    expect((await store.listJobs("alice", 10)).map((j) => j.id)).toEqual([b.id, a.id]);
    expect((await store.listJobs("alice", 1)).map((j) => j.id)).toEqual([b.id]);
    expect(await store.countLive("alice")).toBe(2);
    await store.casJob(a.id, {}, { state: "cancelled" });
    await store.casJob(b.id, {}, { state: "waiting_for_you" });
    expect(await store.countLive("alice")).toBe(1);
  });

  it("finds the running jobs a holder has, the leases that ran out (oldest first), and the jobs that wait for a place or a yes to paid", async () => {
    const store = new MemoryJobStore();
    const mk = async (patch: Parameters<InstanceType<typeof MemoryJobStore>["casJob"]>[2], user = "alice") => {
      const j = await store.createJob({ ...newJob, userId: user });
      await store.casJob(j.id, {}, patch);
      return j.id;
    };
    const held = await mk({ state: "running", placement: "desktop", leaseHolder: "d1", leaseExpiresAt: 3000 });
    const earlier = await mk({ state: "running", placement: "github", leaseHolder: "run-1", leaseExpiresAt: 2000 });
    await mk({ state: "running", placement: "desktop", leaseHolder: "d2", leaseExpiresAt: 9000 });
    await mk({ state: "running", placement: "none", leaseExpiresAt: 1 }); // between steps: no lease to lose
    await mk({ state: "waiting_for_compute", placement: "none", leaseExpiresAt: 1 });
    expect((await store.findHeld("alice", "desktop", "d1")).map((j) => j.id)).toEqual([held]);
    expect(await store.findHeld("bob", "desktop", "d1")).toEqual([]);
    expect(await store.findHeld("alice", "github", "d1")).toEqual([]);
    expect((await store.listExpired(3000, 10)).map((j) => j.id)).toEqual([earlier, held]);
    expect((await store.listExpired(2999, 10)).map((j) => j.id)).toEqual([earlier]);
    expect(await store.listExpired(3000, 1)).toHaveLength(1);

    const store2 = new MemoryJobStore();
    const w = async (patch: Parameters<InstanceType<typeof MemoryJobStore>["casJob"]>[2], user = "alice") => {
      const j = await store2.createJob({ ...newJob, userId: user });
      await store2.casJob(j.id, {}, patch);
      return j.id;
    };
    const compute = await w({ state: "waiting_for_compute" });
    const paid = await w({ state: "waiting_for_you", waitingOn: "paid" });
    await w({ state: "waiting_for_you", waitingOn: "commit" }); // a yes only the person can give: not for the ticker to move
    await w({ state: "running" });
    const bobs = await w({ state: "waiting_for_compute" }, "bob");
    expect((await store2.listWaiting(10)).map((j) => j.id).sort()).toEqual([compute, paid, bobs].sort());
    expect((await store2.listWaiting(10, "alice")).map((j) => j.id).sort()).toEqual([compute, paid].sort());
    expect(await store2.listWaiting(1)).toHaveLength(1);
  });

  it("numbers steps from 0, keeps them in order, updates them, and stops at the most a job can have", async () => {
    const store = new MemoryJobStore();
    const j = await store.createJob(newJob);
    const s0 = await store.addStep(j.id, { kind: "exec", commands: ["a"], timeoutSec: 5, estimateMinutes: 2, status: "pending" });
    const s1 = await store.addStep(j.id, { kind: "edit", commands: ["f.ts"], timeoutSec: 0, estimateMinutes: 0, status: "done", finishedAt: 7 });
    expect([s0.idx, s1.idx]).toEqual([0, 1]);
    expect(s0).toMatchObject({ placement: "none", epoch: 0, startedAt: null, finishedAt: null, exitCode: null, outputTail: "", minutes: 0 });
    expect(s1.finishedAt).toBe(7);
    expect(await store.updateStep(j.id, 0, { status: "running", epoch: 3, startedAt: 9, exitCode: 2, outputTail: "x", minutes: 4 }))
      .toMatchObject({ status: "running", epoch: 3, startedAt: 9, exitCode: 2, outputTail: "x", minutes: 4 });
    expect(await store.updateStep(j.id, 5, { status: "done" })).toBeNull();
    expect((await store.listSteps(j.id)).map((s) => s.idx)).toEqual([0, 1]);
    expect(await store.getStep(j.id, 1)).toMatchObject({ kind: "edit" });
    expect(await store.getStep(j.id, 2)).toBeNull();
    expect(await store.listSteps("nope")).toEqual([]);
    for (let i = 2; i < STEPS_MAX; i += 1) await store.addStep(j.id, { kind: "edit", commands: [], timeoutSec: 0, estimateMinutes: 0, status: "done" });
    await expect(store.addStep(j.id, { kind: "edit", commands: [], timeoutSec: 0, estimateMinutes: 0, status: "done" })).rejects.toBeInstanceOf(TooManySteps);
  });

  it("keeps the person's settings (never, no cap, GitHub on until they say otherwise) and adds up a month's use", async () => {
    const store = new MemoryJobStore();
    expect(await store.getSettings("alice")).toEqual({ userId: "alice", ...DEFAULT_SETTINGS });
    expect(DEFAULT_SETTINGS).toEqual({ paidRule: "never", autoCapPaise: 0, githubEnabled: true });
    expect(await store.saveSettings("alice", { paidRule: "auto", autoCapPaise: 5000 })).toEqual({ userId: "alice", paidRule: "auto", autoCapPaise: 5000, githubEnabled: true });
    expect(await store.saveSettings("alice", { githubEnabled: false })).toEqual({ userId: "alice", paidRule: "auto", autoCapPaise: 5000, githubEnabled: false });
    expect((await store.getSettings("bob")).paidRule).toBe("never");

    expect(await store.getUsage("alice", "2026-10")).toEqual({ userId: "alice", month: "2026-10", githubMinutes: 0, paidPaise: 0 });
    await store.addUsage("alice", "2026-10", { githubMinutes: 10 });
    await store.addUsage("alice", "2026-10", { paidPaise: 250, githubMinutes: 2.6 });
    await store.addUsage("alice", "2026-11", { githubMinutes: -5, paidPaise: -5 }); // never subtracts
    expect(await store.getUsage("alice", "2026-10")).toMatchObject({ githubMinutes: 13, paidPaise: 250 });
    expect(await store.getUsage("alice", "2026-11")).toMatchObject({ githubMinutes: 0, paidPaise: 0 });
    expect(await store.getUsage("bob", "2026-10")).toMatchObject({ githubMinutes: 0 });
  });
});

describe("the jobs' store (Supabase)", () => {
  const UID = "11111111-1111-4111-8111-111111111111";
  const PID = "22222222-2222-4222-8222-222222222222";
  const JID = "33333333-3333-4333-8333-333333333333";

  /** A Supabase client that records what is asked of it and answers every query with `answer`. */
  function stub(answer: unknown) {
    const log: Array<[string, unknown[]]> = [];
    const chain = (): unknown => new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answer);
        return (...args: unknown[]) => { log.push([String(prop), args]); return chain(); };
      },
    });
    return { sb: { from: (t: string) => { log.push(["from", [t]]); return chain(); }, rpc: (f: string, a: unknown) => { log.push(["rpc", [f, a]]); return chain(); } }, log };
  }
  const row = (o: Record<string, unknown> = {}) => ({
    id: JID, user_id: UID, project_id: PID, branch: "tailzu/x-1111", task: "t", state: "running", placement: "desktop", lease_holder: "d1", lease_epoch: 2,
    lease_expires_at: "2026-10-26T12:01:30.000Z", checkpoint: { stepIndex: 3, headSha: "a".repeat(40), notes: "n" }, budget_paise: 500, spent_paise: 100,
    reassignments: 1, reason: null, waiting_on: null, created_at: "2026-10-26T12:00:00.000Z", updated_at: "2026-10-26T12:00:05.000Z", ...o,
  });

  it("reads a row as a job, with a checkpoint that is whatever sense can be made of it", async () => {
    const got = await new SupabaseJobStore(stub({ data: row(), error: null }).sb as never).getJobById(JID);
    expect(got).toEqual({
      id: JID, userId: UID, projectId: PID, branch: "tailzu/x-1111", task: "t", state: "running", placement: "desktop", leaseHolder: "d1", leaseEpoch: 2,
      leaseExpiresAt: Date.parse("2026-10-26T12:01:30.000Z"), checkpoint: { stepIndex: 3, headSha: "a".repeat(40), notes: "n" }, budgetPaise: 500, spentPaise: 100,
      reassignments: 1, reason: "", waitingOn: null, agent: false, agentHolder: null, agentEpoch: 0, agentExpiresAt: null,
      createdAt: Date.parse("2026-10-26T12:00:00.000Z"), updatedAt: Date.parse("2026-10-26T12:00:05.000Z"),
    });
    const odd = await new SupabaseJobStore(stub({ data: row({ checkpoint: { stepIndex: "x", headSha: 5 }, lease_holder: null, lease_expires_at: null }), error: null }).sb as never).getJobById(JID);
    expect(odd).toMatchObject({ checkpoint: { stepIndex: -1, headSha: "", notes: "" }, leaseHolder: null, leaseExpiresAt: null });
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).getJobById("not-a-uuid")).toBeNull();
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).getJobById(JID)).toBeNull();
    await expect(new SupabaseJobStore(stub({ data: null, error: { message: "boom" } }).sb as never).getJobById(JID)).rejects.toThrow(/code jobs store: boom/);
  });

  it("makes a change to a lease one UPDATE with the epoch, state and expiry as conditions, and answers null when none held", async () => {
    const s = stub({ data: row({ lease_epoch: 3 }), error: null });
    const got = await new SupabaseJobStore(s.sb as never).casJob(JID, { leaseEpoch: 2, states: ["running"], leaseExpiredBy: 5000 }, {
      state: "running", leaseEpoch: 3, leaseHolder: null, leaseExpiresAt: 9000, checkpoint: { stepIndex: 1, headSha: "", notes: "" }, waitingOn: "paid", reassignments: 2,
    });
    expect(got).toMatchObject({ leaseEpoch: 3 });
    const update = s.log.find(([m]) => m === "update")![1][0] as Record<string, unknown>;
    expect(update).toMatchObject({
      state: "running", lease_epoch: 3, lease_holder: null, lease_expires_at: new Date(9000).toISOString(), waiting_on: "paid", reassignments: 2,
      checkpoint: { stepIndex: 1, headSha: "", notes: "" }, updated_at: expect.any(String),
    });
    expect(s.log.filter(([m]) => ["eq", "in", "lte"].includes(m)).map(([m, a]) => [m, ...a])).toEqual([
      ["eq", "id", JID], ["eq", "lease_epoch", 2], ["in", "state", ["running"]], ["lte", "lease_expires_at", new Date(5000).toISOString()],
    ]);
    // Nothing matched: null.
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).casJob(JID, { leaseEpoch: 1 }, { state: "failed" })).toBeNull();
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).casJob("nope", {}, { state: "failed" })).toBeNull();
  });

  it("asks for the running jobs of a holder, the leases that ran out, and the jobs that wait", async () => {
    const held = stub({ data: [row()], error: null });
    expect(await new SupabaseJobStore(held.sb as never).findHeld(UID, "desktop", "d1")).toHaveLength(1);
    expect(held.log.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["user_id", UID], ["state", "running"], ["placement", "desktop"], ["lease_holder", "d1"]]);
    const expired = stub({ data: [row()], error: null });
    await new SupabaseJobStore(expired.sb as never).listExpired(5000, 7);
    expect(expired.log).toEqual(expect.arrayContaining([
      ["eq", ["state", "running"]], ["neq", ["placement", "none"]], ["lte", ["lease_expires_at", new Date(5000).toISOString()]], ["limit", [7]],
    ]));
    const waiting = stub({ data: [row({ state: "waiting_for_compute" })], error: null });
    await new SupabaseJobStore(waiting.sb as never).listWaiting(10, UID);
    expect(waiting.log).toEqual(expect.arrayContaining([
      ["in", ["state", ["waiting_for_compute", "waiting_for_you"]]], ["or", ["waiting_on.is.null,waiting_on.eq.paid"]], ["eq", ["user_id", UID]],
    ]));
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).listExpired(1, 1)).toEqual([]);
  });

  it("makes a job and a step, numbering the step one past the last", async () => {
    const made = stub({ data: row({ state: "queued", placement: "none", lease_epoch: 0 }), error: null });
    await new SupabaseJobStore(made.sb as never).createJob({ userId: UID, projectId: PID, branch: "tailzu/x-1111", task: "t", budgetPaise: 250 });
    expect(made.log.find(([m]) => m === "insert")![1][0]).toEqual({ user_id: UID, project_id: PID, branch: "tailzu/x-1111", task: "t", budget_paise: 250 });
    await expect(new SupabaseJobStore(made.sb as never).createJob({ userId: "alice", projectId: PID, branch: "b", task: "t", budgetPaise: 0 })).rejects.toBeInstanceOf(CodeNeedsAccount);

    const stepRow = { job_id: JID, idx: 4, kind: "exec", commands: ["a", 5, "b"], timeout_sec: 60, estimate_minutes: 2, status: "pending", placement: "none", epoch: 0, started_at: null, finished_at: null, exit_code: null, output_tail: null, minutes: 0 };
    const answers = [{ data: [{ idx: 3 }], error: null }, { data: stepRow, error: null }];
    const log: Array<[string, unknown[]]> = [];
    const chain = (): unknown => new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(log.some(([m]) => m === "insert") ? answers[1] : answers[0]);
        return (...args: unknown[]) => { log.push([String(prop), args]); return chain(); };
      },
    });
    const step = await new SupabaseJobStore({ from: () => chain() } as never).addStep(JID, { kind: "exec", commands: ["a", "b"], timeoutSec: 60, estimateMinutes: 2, status: "pending" });
    expect(step).toMatchObject({ idx: 4, commands: ["a", "b"], outputTail: "", exitCode: null });
    expect(log.find(([m]) => m === "insert")![1][0]).toMatchObject({ job_id: JID, idx: 4, kind: "exec", commands: ["a", "b"], timeout_sec: 60, estimate_minutes: 2, status: "pending", placement: "none", finished_at: null });
  });

  it("keeps settings and adds a month's use inside the database", async () => {
    const getS = new SupabaseJobStore(stub({ data: null, error: null }).sb as never);
    expect(await getS.getSettings(UID)).toEqual({ userId: UID, ...DEFAULT_SETTINGS });
    const saved = stub({ data: { user_id: UID, paid_rule: "auto", auto_cap_paise: 700, github_enabled: false }, error: null });
    expect(await new SupabaseJobStore(saved.sb as never).saveSettings(UID, { paidRule: "auto", autoCapPaise: 700, githubEnabled: false })).toEqual({ userId: UID, paidRule: "auto", autoCapPaise: 700, githubEnabled: false });
    expect(saved.log.find(([m]) => m === "upsert")![1]).toEqual([
      { user_id: UID, paid_rule: "auto", auto_cap_paise: 700, github_enabled: false, updated_at: expect.any(String) }, { onConflict: "user_id" },
    ]);

    const usage = stub({ data: { user_id: UID, month: "2026-10", github_minutes: 12, paid_paise: 340 }, error: null });
    expect(await new SupabaseJobStore(usage.sb as never).addUsage(UID, "2026-10", { githubMinutes: 12.4, paidPaise: 340 })).toEqual({ userId: UID, month: "2026-10", githubMinutes: 12, paidPaise: 340 });
    expect(usage.log.find(([m]) => m === "rpc")![1]).toEqual(["code_add_usage", { p_user: UID, p_month: "2026-10", p_minutes: 12, p_paise: 340 }]);
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).getUsage(UID, "2026-11")).toEqual({ userId: UID, month: "2026-11", githubMinutes: 0, paidPaise: 0 });
    await expect(new SupabaseJobStore(usage.sb as never).addUsage("alice", "2026-10", {})).rejects.toBeInstanceOf(CodeNeedsAccount);
  });

  it("lists the jobs running on one kind of place, whatever their lease says, and fences a change by the place too", async () => {
    const running = stub({ data: [row({ placement: "github" })], error: null });
    expect(await new SupabaseJobStore(running.sb as never).listRunning("github", 9)).toHaveLength(1);
    expect(running.log).toEqual(expect.arrayContaining([["eq", ["state", "running"]], ["eq", ["placement", "github"]], ["limit", [9]]]));
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).listRunning("github", 1)).toEqual([]);
    const cas = stub({ data: row(), error: null });
    await new SupabaseJobStore(cas.sb as never).casJob(JID, { leaseEpoch: 2, states: ["running"], placement: "github" }, { state: "failed" });
    expect(cas.log).toEqual(expect.arrayContaining([["eq", ["placement", "github"]]]));
  });

  it("remembers that GitHub's minutes are used up for a month in the month's usage row, and writes nothing else of it", async () => {
    const yes = stub({ data: { github_exhausted: true }, error: null });
    expect(await new SupabaseJobStore(yes.sb as never).isGithubExhausted(UID, "2026-10")).toBe(true);
    expect(yes.log).toEqual(expect.arrayContaining([["from", ["code_compute_usage"]], ["select", ["github_exhausted"]], ["eq", ["month", "2026-10"]]]));
    expect(await new SupabaseJobStore(stub({ data: null, error: null }).sb as never).isGithubExhausted(UID, "2026-10")).toBe(false);
    expect(await new SupabaseJobStore(stub({ data: { github_exhausted: null }, error: null }).sb as never).isGithubExhausted(UID, "2026-10")).toBe(false);
    const marked = stub({ data: { user_id: UID }, error: null });
    await new SupabaseJobStore(marked.sb as never).markGithubExhausted(UID, "2026-10");
    expect(marked.log.find(([m]) => m === "upsert")![1]).toEqual([{ user_id: UID, month: "2026-10", github_exhausted: true }, { onConflict: "user_id,month" }]);
    await expect(new SupabaseJobStore(marked.sb as never).markGithubExhausted("alice", "2026-10")).rejects.toBeInstanceOf(CodeNeedsAccount);
    await expect(new SupabaseJobStore(stub({ data: null, error: { message: "no such column" } }).sb as never).isGithubExhausted(UID, "2026-10")).rejects.toThrow(/code jobs store/);
  });

  it("counts the jobs that are not over", async () => {
    const s = stub({ data: null, error: null, count: 4 });
    expect(await new SupabaseJobStore(s.sb as never).countLive(UID)).toBe(4);
    expect(s.log).toEqual(expect.arrayContaining([["not", ["state", "in", "(done,failed,cancelled)"]], ["eq", ["user_id", UID]]]));
  });
});

// -------------------------------------------------------- the ticker

describe("the ticker", () => {
  it("passes at once, then every 15 seconds, never two at the same time, and stop stops it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    let release: () => void = () => {};
    const tick = vi.fn(async () => ({ expired: 0, moved: 0, failed: 0, woken: 0 }));
    const stop = startJobTicker({ jobs: { tick } });
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TICK_MS - 1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(tick).toHaveBeenCalledTimes(5);
    stop();
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(tick).toHaveBeenCalledTimes(5);

    // A pass that is still running holds the next one off.
    tick.mockReset();
    tick.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ expired: 1, moved: 1, failed: 0, woken: 0 }); }));
    const stop2 = startJobTicker({ jobs: { tick }, everyMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop2();
  });

  it("logs a pass that fails and tries the next, and says what it did when it did something", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const log = { info: vi.fn(), warn: vi.fn() };
    const tick = vi.fn()
      .mockRejectedValueOnce(new Error("database is away"))
      .mockResolvedValueOnce({ expired: 2, moved: 2, failed: 0, woken: 1 })
      .mockResolvedValue({ expired: 0, moved: 0, failed: 0, woken: 0 });
    const stop = startJobTicker({ jobs: { tick }, log });
    await vi.advanceTimersByTimeAsync(0);
    expect(log.warn).toHaveBeenCalledWith({ error: "database is away" }, "code jobs: tick failed");
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(log.info).toHaveBeenCalledWith({ expired: 2, moved: 2, failed: 0, woken: 1 }, expect.stringMatching(/leases taken back/));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(log.info).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("the ticker, with the agent loop's worker", () => {
  it("asks the worker to hand back claims and pick up jobs on the same pass, says so when it did, and a worker that fails costs the next pass nothing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const log = { info: vi.fn(), warn: vi.fn() };
    const tick = vi.fn(async () => ({ expired: 0, moved: 0, failed: 0, woken: 0 }));
    const agents = {
      tick: vi.fn()
        .mockResolvedValueOnce({ handedBack: 1, started: 2 })
        .mockRejectedValueOnce(new Error("agent store is away"))
        .mockResolvedValue({ handedBack: 0, started: 0 }),
    };
    const stop = startJobTicker({ jobs: { tick }, agents, log });
    await vi.advanceTimersByTimeAsync(0);
    expect(agents.tick).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith({ handedBack: 1, started: 2 }, expect.stringMatching(/claims handed back, jobs picked up/));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(log.warn).toHaveBeenCalledWith({ error: "agent store is away" }, "code jobs: tick failed");
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(agents.tick).toHaveBeenCalledTimes(3);
    expect(log.info).toHaveBeenCalledTimes(1);
    // The router's own pass ran each time, before the worker's.
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    // A server without the agent has none to ask.
    const none = vi.fn(async () => ({ expired: 0, moved: 0, failed: 0, woken: 0 }));
    const stop2 = startJobTicker({ jobs: { tick: none }, agents: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(none).toHaveBeenCalledTimes(1);
    stop2();
  });
});

// ------------------------------------------------------- small tools

describe("the lock", () => {
  it("lets one thing at a time run per key, in order, and a failure releases it", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const a = lock.run("k", async () => { order.push("a1"); await wait(15); order.push("a2"); return 1; });
    const b = lock.run("k", async () => { order.push("b1"); throw new Error("boom"); });
    const c = lock.run("k", async () => { order.push("c1"); return 3; });
    const other = lock.run("other", async () => { order.push("o"); return 0; });
    expect(await a).toBe(1);
    await expect(b).rejects.toThrow("boom");
    expect(await c).toBe(3);
    await other;
    expect(order).toEqual(["a1", "o", "a2", "b1", "c1"]);
    await wait(0);
    expect(lock.size).toBe(0);
  });
});

describe("what is kept of a step's output", () => {
  it("is the last 8 KB, cut at a character, and nothing at all of output that looks like a secret", () => {
    expect(keepOutput("")).toBe("");
    expect(keepOutput(undefined)).toBe("");
    expect(keepOutput(5)).toBe("");
    expect(keepOutput("all good")).toBe("all good");
    const big = "a".repeat(20_000) + "TAIL";
    const kept = keepOutput(big);
    expect(Buffer.byteLength(kept)).toBe(OUTPUT_TAIL_BYTES);
    expect(kept.endsWith("TAIL")).toBe(true);
    const wide = "€".repeat(5000); // three bytes each
    const cut = tailBytes(wide, 10);
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(10);
    expect(cut).toBe("€€€");
    expect(tailBytes("short", 100)).toBe("short");
    expect(keepOutput("aws key AKIA" + "IOSFODNN7EXAMPLE here")).toBe("[Output not kept: it looked like it held an AWS access key.]");
    expect(keepOutput("-----BEGIN RSA " + "PRIVATE KEY-----\nMIIE")).toMatch(/a private key/);
  });
});

// ------------------------------------------------------ the person is told

describe("the pushes", () => {
  const DAY = 24 * 60 * 60_000;
  async function pushRig() {
    const { PushEngine } = await import("../src/push/engine.js");
    const { MemoryPushStore } = await import("../src/push/store.js");
    const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
    const { initPush, notifyCodeJob } = await import("../src/push/index.js");
    const store = new MemoryPushStore();
    store.candidatesList = [{
      userId: "user-a", tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: 0 }],
      lastSeenAt: null, createdAt: Date.now() - 60 * DAY, locale: null, entitled: false, tzOffsetMin: 0,
    }];
    const sent: Array<Record<string, any>> = [];
    const sender = {
      send: async (m: Array<Record<string, any>>) => { sent.push(...m); return m.map(() => ({ status: "ok" as const, id: "t" })); },
      receipts: async () => ({}),
    };
    initPush({ store, sender });
    return { store, sent, notifyCodeJob, PUSH_DEFAULTS, PushEngine };
  }
  const data = (o: Record<string, unknown> = {}) => ({ jobId: "job-1", projectId: "p", task: "make the build pass", at: 1000, ...o });

  it("say in plain words what happened to a job, once per moment, and open the screen the control plane names", async () => {
    const { sent, notifyCodeJob } = await pushRig();
    await notifyCodeJob("user-a", "compute_ask", data({ estimatePaise: 1250, stepIdx: 0 }));
    await notifyCodeJob("user-a", "compute_paused", data({ at: 2000 }));
    await notifyCodeJob("user-a", "commit_ask", data({ at: 3000, action: "commit.secret" }));
    await notifyCodeJob("user-a", "job_moved", data({ at: 4000, from: "desktop", to: "github" }));
    await notifyCodeJob("user-a", "job_done", data({ at: 5000 }));
    await notifyCodeJob("user-a", "job_failed", data({ at: 6000, reason: "It kept going quiet." }));
    expect(sent.map((m) => [m.title, m.body])).toEqual([
      ["Paid compute needs your OK", "“make the build pass” has no free computer to run on. Say yes to run it on paid compute."],
      ["Waiting for a computer", "“make the build pass” will carry on by itself when one of your computers is online."],
      ["Changes waiting for your OK", "“make the build pass” has changes ready and needs your OK to commit them."],
      ["Moved to another computer", "“make the build pass” is carrying on on GitHub's free computers."],
      ["Done", "“make the build pass” is finished."],
      ["Couldn't finish", "“make the build pass” stopped. It kept going quiet."],
    ]);
    expect(sent.map((m) => m.data.kind)).toEqual(["code_compute_ask", "code_compute_paused", "code_commit_ask", "code_job_moved", "code_job_done", "code_job_failed"]);
    expect(sent.every((m) => m.data.jobId === "job-1" && m.data.screenId === "home")).toBe(true);
    // The same moment again is not sent again; a later one is.
    await notifyCodeJob("user-a", "job_done", data({ at: 5000 }));
    expect(sent).toHaveLength(6);
    await notifyCodeJob("user-a", "compute_paused", data({ at: 9000 }));
    expect(sent).toHaveLength(7);
    // No price, whatever the estimate.
    await notifyCodeJob("user-a", "compute_ask", data({ at: 7000, estimatePaise: 500 }));
    expect(sent.at(-1)!.body).not.toMatch(/₹/);
    // Somebody with no phone, or no engine, is nobody's problem.
    await expect(notifyCodeJob("nobody", "job_done", data())).resolves.toBeUndefined();
  });

  it("tell the person once, in the router's own words, that the month's free GitHub minutes are running low", async () => {
    const { sent, notifyCodeJob } = await pushRig();
    const { minutesLowWords } = await import("../src/code/live/minutes.js");
    const reason = minutesLowWords(2000, 1612);
    await notifyCodeJob("user-a", "minutes_low", data({ at: 8000, reason }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe("GitHub minutes running low");
    expect(sent[0]!.body).toBe("You have used 1612 of your 2000 GitHub Actions minutes this month. Past 95% Tailzu uses your own computer instead, or waits.");
    expect(sent[0]!.data).toMatchObject({ kind: "code_minutes_low", jobId: "job-1", screenId: "home" });
    await notifyCodeJob("user-a", "minutes_low", data({ at: 8000, reason }));
    expect(sent).toHaveLength(1);
  });

  it("are all in the control plane's defaults, switched on, each with words, and none of them counts toward the planned pushes' fatigue", async () => {
    const { PUSH_DEFAULTS } = await pushRig();
    const { EVENT_PUSH_KINDS } = await import("../src/push/defaults.js");
    const kinds = EVENT_PUSH_KINDS.filter((k) => k.startsWith("code_"));
    expect(kinds).toEqual(["code_compute_ask", "code_compute_paused", "code_commit_ask", "code_job_moved", "code_job_done", "code_job_failed", "code_needs_you", "code_minutes_low"]);
    for (const k of kinds) {
      expect(PUSH_DEFAULTS.flags[`push.${k}.enabled`], k).toBe(true);
      expect(typeof PUSH_DEFAULTS.flags[`push.${k}.screenId`], k).toBe("string");
      expect(PUSH_DEFAULTS.labels[`push.${k}.title`]!.length, k).toBeGreaterThan(3);
      expect(PUSH_DEFAULTS.labels[`push.${k}.body`]!.length, k).toBeGreaterThan(10);
    }
  });

  it("can be switched off one by one by the control plane", async () => {
    const { PushEngine, sent, store, PUSH_DEFAULTS } = await (async () => {
      const r = await pushRig();
      return r;
    })();
    const off = structuredClone(PUSH_DEFAULTS);
    off.flags["push.code_job_done.enabled"] = false;
    const engine = new PushEngine(store, { send: async (m: Array<Record<string, any>>) => { sent.push(...m); return m.map(() => ({ status: "ok" as const, id: "t" })); }, receipts: async () => ({}) }, () => off, { info: () => {}, warn: () => {} });
    expect(await engine.notify("user-a", { kind: "code_job_done", key: "x:1", vars: { task: "t" } })).toBeNull();
    expect(await engine.notify("user-a", { kind: "code_job_failed", key: "x:1", vars: { task: "t", reason: "r" } })).toMatchObject({ sent: true });
  });
});
