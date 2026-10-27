/**
 * THE AGENT ON CLOUDFLARE (docs/cloudflare-jobs.md): the loop driven ONE ADVANCE AT A TIME, the way a Workflow drives it
 * (AgentOrchestrator.advance, loop.ts advanceLoop), and the orchestrator's other role on the VPS, which hands jobs over.
 * Run end to end against the fake GitHub, with the real policy, over the rig (tests/agent-rig.ts).
 *
 * What is held here:
 *   - a whole job, advance by advance, ends where the loop on a server ends: the same commit, the same pull request;
 *   - a step that is out on a runner is looked at once and the advance says "wait", with a length;
 *   - the work phase gives way after `turns` rounds, each already saved;
 *   - a job waiting for the person is not claimed, asks nothing of the model, and goes on when they speak;
 *   - the claim is the second guard: a second driver finds it taken, and nothing runs twice;
 *   - an error is counted and backed off from, and the third in a row fails the job;
 *   - a job nobody came back to is ended with a report;
 *   - the VPS's role: it hands over, wakes, claims nothing, and says so when it cannot hand a job over;
 *   - the approval book is one process's memory: a question asked on the Worker is answered through the VPS's book, and back.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, done, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { createAgent } = await import("../src/code/agent/index.js");
const { routerRunner, RunPending, retryAfter } = await import("../src/code/agent/runner.js");
const { ApprovalBook } = await import("../src/code/approvals.js");
const { createWorkBranch } = await import("../src/code/projects.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;
type Advance = import("../src/code/agent/loop.js").Advance;
type RemoteJobs = import("../src/code/agent/orchestrator.js").RemoteJobs;

const RISKY = "In src/util.ts make slug() trim dashes, before the password reset link is built from it";

/** An orchestrator in the Worker's role: nothing polls, nothing is claimed unless `advance` is called. Its own approval book. */
function worker(r: Rig, o: { instanceId?: string; leaseMs?: number; book?: InstanceType<typeof ApprovalBook> } = {}) {
  return createAgent({
    code: { ...r.code, approvals: o.book ?? new ApprovalBook({ now: r.now }) }, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog,
    intake: r.intake, routeStats: r.routeStats, notify: (u, k, d) => { r.told.push({ userId: u, kind: k, data: d }); }, now: r.now, sleep: r.sleep, log: r.log,
    web: { store: null, cache: null, fetchFn: (async () => new Response("no", { status: 404 })) as never },
    runner: routerRunner({ jobs: r.jobs, store: r.jobStore, now: r.now, sleep: r.sleep, placeWaitMs: 120_000, pollMs: 2000 }),
    passive: true, instanceId: o.instanceId ?? "wf", ...(o.leaseMs ? { leaseMs: o.leaseMs } : {}),
  })!;
}

/** What a Workflow does: advance until the job needs something else, sleeping (here, moving the clock) where it is told to. */
async function drive(r: Rig, w: ReturnType<typeof worker>, jobId: string, o: { turns?: number; max?: number; stopAt?: (a: Advance) => boolean } = {}): Promise<Advance[]> {
  const seen: Advance[] = [];
  for (let i = 0; i < (o.max ?? 300); i += 1) {
    const a = await w.advance(jobId, { holder: `wf-${seen.length}`, ...(o.turns !== undefined ? { turns: o.turns } : {}) });
    seen.push(a);
    if (o.stopAt?.(a)) break;
    if (a.next === "continue") continue;
    if (a.next === "end") break;
    if (a.waitingOn === "runner" || a.waitingOn === "claim" || a.waitingOn === "retry") { await r.sleep(a.waitMs ?? 1000); continue; }
    break; // waiting for the person
  }
  return seen;
}

/** A job made and handed to the Worker's orchestrator (nothing drives it until `drive`). */
async function made(r: Rig, w: ReturnType<typeof worker>, task: string, over: { budgetPaise?: number } = {}) {
  const { branch } = await createWorkBranch(r.d, "alice", r.project.id, task);
  const job = await r.jobs.createJob("alice", r.project.id, branch, task, over.budgetPaise, { agent: true });
  await w.enqueue(job.id, task);
  return { job, branch };
}

describe("a whole job, one advance at a time", () => {
  it("ends where the loop on a server ends: the commit, the pull request, the report", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed both ends."));
    const w = worker(r);
    const { job, branch } = await made(r, w, UTIL_TASK);

    const seen = await drive(r, w, job.id);
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    // Several advances, not one: and the steps that were out on a runner were waited for, not held open.
    expect(seen.filter((a) => a.next === "continue").length).toBeGreaterThanOrEqual(5);
    expect(seen.some((a) => a.next === "wait" && a.waitingOn === "runner")).toBe(true);

    const j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    expect(j).toMatchObject({ agentHolder: null, agentExpiresAt: null });
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    const s = await r.stateNow(job.id);
    expect(s).toMatchObject({ phase: "done", report: { outcome: "done" } });
    expect(s.commits).toHaveLength(1);
    expect(s.errors).toBeUndefined();
    expect(r.toldOf("job_done")).toHaveLength(1);
    // The Worker's orchestrator drove it and nothing polled: the other orchestrator on these stores did nothing.
    expect(r.orch.running).toBe(0);
  });

  it("is the same job a server would have done: the same commit and pull request as runLoop", async () => {
    const local = await agentRig();
    local.json.on("work.plan", UTIL_PLAN);
    local.model.push(call("edit_file", UTIL_EDIT), done("Trimmed both ends."));
    const a = await local.start(UTIL_TASK);
    await local.orch.idle();

    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed both ends."));
    const w = worker(r);
    const b = await made(r, w, UTIL_TASK);
    await drive(r, w, b.job.id);

    expect(r.fake.files(r.repo, b.branch)["src/util.ts"]).toBe(local.fake.files(local.repo, a.branch)["src/util.ts"]);
    expect(r.fake.commitCount(r.repo)).toBe(local.fake.commitCount(local.repo));
    expect(r.fake.pulls(r.repo)).toHaveLength(local.fake.pulls(local.repo).length);
    const sa = await local.stateNow(a.job.id), sb = await r.stateNow(b.job.id);
    expect(sb.report!.outcome).toBe(sa.report!.outcome);
    expect(sb.verify).toMatchObject({ ran: sa.verify!.ran, ok: sa.verify!.ok });
    expect(sb.pr!.ready).toBe(sa.pr!.ready);
  });

  it("gives way after `turns` rounds of the work phase, each saved: one model turn per advance with turns 1", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("read_file", { path: "src/util.ts" }), call("list_dir", { path: "src" }), call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    const turnsAfter: number[] = [];
    const seen: Advance[] = [];
    for (let i = 0; i < 200; i += 1) {
      const a = await w.advance(job.id, { holder: `wf-${i}`, turns: 1 });
      seen.push(a);
      turnsAfter.push(r.model.turns);
      if (a.next === "end") break;
      if (a.next === "wait") await r.sleep(a.waitMs ?? 1000);
    }
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    // The model was never asked twice inside one advance.
    for (let i = 1; i < turnsAfter.length; i += 1) expect(turnsAfter[i]! - turnsAfter[i - 1]!).toBeLessThanOrEqual(1);
    expect(r.model.turns).toBe(4);
    expect((await r.jobNow(job.id)).state).toBe("done");
  });

  it("does more rounds in one advance when it is given more", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("read_file", { path: "src/util.ts" }), call("list_dir", { path: "src" }), call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    // Run to the work phase, then see how many turns one advance takes.
    const seen = await drive(r, w, job.id, { turns: 100 });
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    const few = await agentRig();
    few.json.on("work.plan", UTIL_PLAN);
    few.model.push(call("read_file", { path: "src/util.ts" }), call("list_dir", { path: "src" }), call("edit_file", UTIL_EDIT), done("ok"));
    const w2 = worker(few);
    const m2 = await made(few, w2, UTIL_TASK);
    const seen2 = await drive(few, w2, m2.job.id, { turns: 1 });
    expect(seen2.length).toBeGreaterThan(seen.length);
  });
});

describe("a step that is out on a runner", () => {
  it("is looked at once per advance: wait, runner, with a length that grows, until it reports", async () => {
    const r = await agentRig();
    r.runner.hold = true;
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);

    // prepare is quick; baseline asks for a step and it is not answered.
    const first = await drive(r, w, job.id, { stopAt: (a) => a.next === "wait" && a.waitingOn === "runner" });
    const wait = first.at(-1) as Extract<Advance, { next: "wait" }>;
    expect(wait).toMatchObject({ next: "wait", waitingOn: "runner", waitMs: 10_000 });
    expect(wait.wakeAt).toBeGreaterThan(r.now());
    // The step's mark is in the state, so that the next advance takes it over instead of asking for another.
    const asked = (await r.stateNow(job.id)).run!;
    expect(asked).toMatchObject({ tag: "baseline" });
    expect(asked.at).toBeLessThanOrEqual(r.now());
    expect(r.runner.runs).toHaveLength(1);

    // Looked at again, not answered: still waiting, still the same step.
    const again = (await w.advance(job.id, { holder: "wf-x" })) as Extract<Advance, { next: "wait" }>;
    expect(again).toMatchObject({ next: "wait", waitingOn: "runner" });
    expect(r.runner.runs).toHaveLength(1);
    // ...and less often the longer it takes.
    await r.sleep(70_000);
    expect(((await w.advance(job.id, { holder: "wf-y" })) as Extract<Advance, { next: "wait" }>).waitMs).toBe(30_000);
    await r.sleep(300_000);
    expect(((await w.advance(job.id, { holder: "wf-z" })) as Extract<Advance, { next: "wait" }>).waitMs).toBe(60_000);

    // It reports: the next advance goes on, and the step is not asked for twice.
    await r.runner.release();
    r.runner.hold = false;
    const rest = await drive(r, w, job.id);
    expect(rest.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(r.runner.runs.filter((x) => x.wrapped && x.commands.some((c) => /baseline|kind=/.test(c))).length).toBeGreaterThanOrEqual(1);
  });

  it("gives up on a place that never comes, after the time it was first asked for, not the time of the latest look", async () => {
    const r = await agentRig({ placeWaitMs: 120_000 });
    r.runner.open = false; // no computer at all
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    const first = await drive(r, w, job.id, { stopAt: (a) => a.next === "wait" && a.waitingOn === "runner" });
    expect(first.at(-1)).toMatchObject({ waitingOn: "runner" });
    // Each look is a fresh Run; the clock since the FIRST ask is what counts: 3 minutes on, baseline is given up on and the job goes on.
    await r.sleep(180_000);
    const next = await w.advance(job.id, { holder: "wf-late" });
    expect(next.next).toBe("continue");
    const s = await r.stateNow(job.id);
    expect(s.baseline).toMatchObject({ status: "unknown" });
    expect(s.run).toBeUndefined();
  });

  it("routerRunner: once throws RunPending for a step that has not finished, and the waits are measured from startedAt", async () => {
    const r = await agentRig();
    r.runner.hold = true;
    const { job } = await r.start("x", { enqueue: false });
    const runner = routerRunner({ jobs: r.jobs, store: r.jobStore, now: r.now, sleep: r.sleep, placeWaitMs: 120_000, pollMs: 2000 });
    const idx: number[] = [];
    const ctl = { once: true, onStep: async (i: number) => { idx.push(i); } };
    await expect(runner.run(job, { commands: ["echo hi"], timeoutSec: 60, estimateMinutes: 1 }, ctl)).rejects.toBeInstanceOf(RunPending);
    // The same step taken over by a later look, with the time it was asked for long gone: given up on, as a step that ran past its time.
    const out = await runner.run(await r.jobNow(job.id), { commands: ["echo hi"], timeoutSec: 60, estimateMinutes: 1, adopt: idx[0]! }, { ...ctl, startedAt: r.now() - 10 * 60_000 });
    expect(out).toMatchObject({ status: "timeout" });
    expect([retryAfter(0), retryAfter(59_999), retryAfter(60_000), retryAfter(299_999), retryAfter(300_000)]).toEqual([10_000, 10_000, 30_000, 30_000, 60_000]);
  });
});

describe("a job waiting for the person", () => {
  it("is not claimed and asks nothing of the model until they speak; then it goes on", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "Trim both ends?", options: ["Yes", "No"] }), call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    const seen = await drive(r, w, job.id);
    expect(seen.at(-1)).toEqual({ next: "wait", waitingOn: "answer" });
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "answer", agentHolder: null, agentExpiresAt: null });
    const turns = r.model.turns;
    const epoch = (await r.jobNow(job.id)).agentEpoch;
    // Asked again and again (a stray event): still waiting, nothing claimed, nothing spent.
    for (let i = 0; i < 3; i += 1) expect(await w.advance(job.id, { holder: `wf-again-${i}` })).toEqual({ next: "wait", waitingOn: "answer" });
    expect(r.model.turns).toBe(turns);
    expect((await r.jobNow(job.id)).agentEpoch).toBe(epoch);

    await w.answer("alice", job.id, "Yes");
    const rest = await drive(r, w, job.id);
    expect(rest.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(r.model.seen.at(-1)!.messages).toContain("The person answered: Yes");
    expect((await r.jobNow(job.id)).state).toBe("done");
  });

  it("budget: parks with the offer, and goes on from where it was when more is added", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK, { budgetPaise: 0 });
    const seen = await drive(r, w, job.id);
    expect(seen.at(-1)).toEqual({ next: "wait", waitingOn: "budget" });
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "budget", spentPaise: 0 });
    expect(r.model.turns).toBe(0);
    await w.addBudget("alice", job.id, 3000);
    const rest = await drive(r, w, job.id);
    expect(rest.at(-1)).toEqual({ next: "end", why: "finished" });
    expect((await r.jobNow(job.id)).state).toBe("done");
  });

  it("a job the person stopped is over", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "?" }));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    await drive(r, w, job.id);
    await w.stopJob("alice", job.id);
    expect(await w.advance(job.id, { holder: "wf-after" })).toEqual({ next: "end", why: "over" });
    expect(await w.advance("00000000-0000-4000-8000-0000000000ee", { holder: "wf-none" })).toEqual({ next: "end", why: "over" });
  });
});

describe("the claim, the second guard", () => {
  it("a second driver finds it taken and is told to come back; the model is asked once", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const a = worker(r, { instanceId: "wf-a" }), b = worker(r, { instanceId: "wf-b" });
    const { job } = await made(r, a, UTIL_TASK);
    // Up to the work phase, one advance at a time.
    for (let i = 0; i < 100 && (await r.stateNow(job.id)).phase !== "work"; i += 1) {
      const x = await a.advance(job.id, { holder: `A-${i}`, turns: 1 });
      if (x.next === "wait") await r.sleep(x.waitMs ?? 1000);
    }
    expect((await r.stateNow(job.id)).phase).toBe("work");

    // A is inside its model turn (held there).
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let inside!: () => void;
    const entered = new Promise<void>((res) => { inside = res; });
    r.model.beforeTurn = async () => { inside(); await gate; };
    const running = a.advance(job.id, { holder: "A", turns: 1 });
    await entered;

    const held = await b.advance(job.id, { holder: "B", turns: 1 });
    expect(held).toMatchObject({ next: "wait", waitingOn: "claim" });
    expect((held as { waitMs: number }).waitMs).toBeGreaterThanOrEqual(5_000);
    expect(await r.jobNow(job.id)).toMatchObject({ agentHolder: "A" });
    expect(r.model.turns).toBe(1);

    release();
    expect((await running).next).toBe("continue");
    r.model.beforeTurn = undefined;
    // A let go at the end of its advance; B takes it from there. The work was done once.
    expect(await r.jobNow(job.id)).toMatchObject({ agentHolder: null });
    const rest = await drive(r, b, job.id);
    expect(rest.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(r.model.turns).toBe(2);
    expect(r.fake.commitCount(r.repo)).toBe(2);
  });

  it("a driver whose claim was handed back finds its next write turned away, and the job is claimed again", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const a = worker(r, { instanceId: "wf-a", leaseMs: 60_000 });
    const { job } = await made(r, a, UTIL_TASK);
    await drive(r, a, job.id, { turns: 1, stopAt: () => r.model.turns > 0 });
    // A is slow in the middle of its next advance: the ticker's pass hands its claim back, and the epoch goes up.
    let handed = false;
    r.model.beforeTurn = async () => {
      if (handed) return;
      handed = true;
      r.fake.clock.t += 61_000;
      const tick = await a.tick();
      expect(tick.handedBack).toBe(1);
    };
    const seen: Advance[] = [];
    for (let i = 0; i < 100 && !handed; i += 1) { seen.push(await a.advance(job.id, { holder: `A-${i}`, turns: 1 })); if (seen.at(-1)!.next === "wait") await r.sleep(2000); }
    // The advance that was cut off says: look again shortly (the job is not over). It wrote nothing after the claim went.
    expect(seen.at(-1)).toMatchObject({ next: "wait", waitingOn: "claim", waitMs: 5_000 });
    // What was saved before stands (the edit, made once); the turn it was in is not in the state, so the next claimant asks the model for it again.
    expect((await r.stateNow(job.id)).work.staged.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect((await r.stateNow(job.id)).work.exchanges).toHaveLength(1);
    r.model.push(done("ok"));
    const rest = await drive(r, a, job.id);
    expect(rest.at(-1)).toEqual({ next: "end", why: "finished" });
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.commitCount(r.repo)).toBe(2);
  });
});

describe("an error that is not the person's", () => {
  it("is counted and backed off from (15 s, then 30 s), cleared by a phase that gets through, and the third in a row fails the job", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    // Two failures in a row at the first model turn, then it works.
    let failures = 2;
    r.model.beforeTurn = async () => { if (failures > 0) { failures -= 1; throw new Error("GitHub is down"); } };
    const seen: Advance[] = [];
    let errors: Array<number | undefined> = [];
    for (let i = 0; i < 300; i += 1) {
      const a = await w.advance(job.id, { holder: `wf-${i}`, turns: 1 });
      seen.push(a);
      errors.push((await r.stateNow(job.id)).errors);
      if (a.next === "end") break;
      if (a.next === "wait") await r.sleep(a.waitMs ?? 1000);
    }
    const retries = seen.filter((a): a is Extract<Advance, { next: "wait" }> => a.next === "wait" && a.waitingOn === "retry");
    expect(retries.map((a) => a.waitMs)).toEqual([15_000, 30_000]);
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(errors.at(-1)).toBeUndefined(); // cleared when a phase got to its end, and saved
    expect((await r.jobNow(job.id)).state).toBe("done");
  });

  it("fails the job, with a plain reason, the third time running", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    r.model.beforeTurn = async () => { throw Object.assign(new Error("GitHub is down"), { code: "github_down" }); };
    const seen: Advance[] = [];
    for (let i = 0; i < 300; i += 1) {
      const a = await w.advance(job.id, { holder: `wf-${i}`, turns: 1 });
      seen.push(a);
      if (a.next === "end") break;
      if (a.next === "wait") await r.sleep(a.waitMs ?? 1000);
    }
    expect(seen.at(-1)).toEqual({ next: "end", why: "finished" });
    const j = await r.jobNow(job.id);
    expect(j.state).toBe("failed");
    expect(j.reason).toContain("three times running (github_down)");
    expect(r.toldOf("job_failed")).toHaveLength(1);
  });
});

describe("a job nobody came back to", () => {
  it("is ended with a report that says so, and the person is told", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "Which?" }));
    const w = worker(r);
    const { job } = await made(r, w, UTIL_TASK);
    await drive(r, w, job.id);
    await w.abandon(job.id, "Nobody replied for 7 days, so I stopped here.");
    const j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "failed", reason: "Nobody replied for 7 days, so I stopped here." });
    const s = await r.stateNow(job.id);
    expect(s).toMatchObject({ phase: "done", waiting: undefined });
    expect(s.report).toMatchObject({ outcome: "failed" });
    expect(s.report!.text).toContain("Nobody replied for 7 days");
    expect(r.toldOf("job_failed")).toHaveLength(1);
    // Over is over: asking again changes nothing.
    await w.abandon(job.id, "again");
    expect((await r.jobNow(job.id)).reason).toBe("Nobody replied for 7 days, so I stopped here.");
  });
});

describe("the VPS's role: hand over, wake, claim nothing", () => {
  function remote() {
    const log: Array<[string, string, string?]> = [];
    const jobs: RemoteJobs = {
      start: async (id) => { log.push(["start", id]); },
      wake: async (id, kind) => { log.push(["wake", id, kind]); },
    };
    return { jobs, log };
  }
  function vps(r: Rig, rj: RemoteJobs, book?: InstanceType<typeof ApprovalBook>) {
    return createAgent({
      code: { ...r.code, approvals: book ?? new ApprovalBook({ now: r.now }) }, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog,
      now: r.now, sleep: r.sleep, log: r.log, remote: rj, instanceId: "vps",
    })!;
  }

  it("hands a new job to the Worker and runs nothing itself", async () => {
    const r = await agentRig();
    const rj = remote();
    const v = vps(r, rj.jobs);
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, UTIL_TASK);
    const job = await r.jobs.createJob("alice", r.project.id, branch, UTIL_TASK, undefined, { agent: true });
    const out = await v.enqueue(job.id, UTIL_TASK);
    expect(rj.log).toEqual([["start", job.id]]);
    expect(out).toMatchObject({ id: job.id, state: "queued", agent: true });
    // The whole request is in its state, for the Worker to find.
    expect((await r.stateNow(job.id)).task).toBe(UTIL_TASK);
    expect(await v.poll()).toBe(0);
    expect(await v.tick()).toEqual({ handedBack: 0, started: 0 });
    v.start();
    await v.idle();
    expect(r.model.turns).toBe(0);
    expect((await r.jobNow(job.id)).agentEpoch).toBe(0);
  });

  it("fails the job, with a reason the person can read, when the Worker cannot be reached", async () => {
    const r = await agentRig();
    const v = vps(r, { start: async () => { throw Object.assign(new Error("down"), { code: "unreachable" }); }, wake: async () => undefined });
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, UTIL_TASK);
    const job = await r.jobs.createJob("alice", r.project.id, branch, UTIL_TASK, undefined, { agent: true });
    const out = await v.enqueue(job.id, UTIL_TASK);
    expect(out).toMatchObject({ state: "failed" });
    expect(out!.reason).toContain("could not hand this job to the machine that runs it, after trying three times");
    expect(out!.reason).toContain("Nothing was changed");
    expect(r.toldOf("job_failed")).toHaveLength(1);
    expect(r.model.turns).toBe(0);
  });

  it("wakes the Workflow for the person's word: answer, approve, deny, budget and stop; and each one only for its owner", async () => {
    const r = await agentRig();
    const rj = remote();
    const w = worker(r);
    const v = vps(r, rj.jobs);
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "Which?" }));
    const { job } = await made(r, w, UTIL_TASK);
    await drive(r, w, job.id);
    rj.log.length = 0;

    await expect(v.answer("bob", job.id, "x")).rejects.toMatchObject({ code: "not_found" });
    await expect(v.stopJob("bob", job.id)).rejects.toMatchObject({ code: "not_found" });
    expect(rj.log).toEqual([]);

    await v.answer("alice", job.id, "this one");
    expect(rj.log).toEqual([["wake", job.id, "answer"]]);
    expect(await r.jobNow(job.id)).toMatchObject({ state: "running", waitingOn: null }); // written to the database before the Workflow is told

    await v.stopJob("alice", job.id);
    expect(rj.log.at(-1)).toEqual(["wake", job.id, "stop"]);
    expect((await r.jobNow(job.id)).state).toBe("cancelled");
  });

  it("wakes it for a yes, a no (which ends a plan), and more money", async () => {
    const rj = remote();
    // approve
    const a = await agentRig();
    a.json.on("work.plan", UTIL_PLAN);
    a.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const aw = worker(a), av = vps(a, rj.jobs);
    const m = await made(a, aw, RISKY);
    await drive(a, aw, m.job.id);
    const q = (await av.approve("alice", m.job.id)) as { approvalId: string };
    rj.log.length = 0;
    await av.approve("alice", m.job.id, q.approvalId);
    expect(rj.log).toEqual([["wake", m.job.id, "approve"]]);
    // deny
    const d = await agentRig();
    d.json.on("work.plan", UTIL_PLAN);
    const dw = worker(d), dv = vps(d, rj.jobs);
    const n = await made(d, dw, RISKY);
    await drive(d, dw, n.job.id);
    rj.log.length = 0;
    expect(await dv.deny("alice", n.job.id)).toMatchObject({ state: "cancelled" });
    expect(rj.log).toEqual([["wake", n.job.id, "deny"]]);
    // budget
    const b = await agentRig();
    b.json.on("work.plan", UTIL_PLAN);
    b.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    const bw = worker(b), bv = vps(b, rj.jobs);
    const k = await made(b, bw, UTIL_TASK, { budgetPaise: 0 });
    await drive(b, bw, k.job.id);
    rj.log.length = 0;
    await bv.addBudget("alice", k.job.id, 3000);
    expect(rj.log).toEqual([["wake", k.job.id, "budget"]]);
    // ...but adding money to a job that is not waiting for it wakes nothing
    rj.log.length = 0;
    await av.addBudget("alice", m.job.id, 100);
    expect(rj.log).toEqual([]);
  });
});

describe("the approval book is one process's memory", () => {
  it("a plan asked about on the Worker is answered through the VPS's book, and the commit that follows goes through the Worker's", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    // Two processes, two books: nothing is shared but the database.
    const w1 = worker(r, { instanceId: "wf-1", book: new ApprovalBook({ now: r.now }) });
    const v = createAgent({
      code: { ...r.code, approvals: new ApprovalBook({ now: r.now }) }, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog,
      now: r.now, sleep: r.sleep, log: r.log, remote: { start: async () => undefined, wake: async () => undefined }, instanceId: "vps",
    })!;
    const { job } = await made(r, w1, RISKY);
    await drive(r, w1, job.id);
    const s0 = await r.stateNow(job.id);
    expect(s0.waiting).toMatchObject({ kind: "approval", for: "plan" });
    expect(s0.waiting!.kind === "approval" && s0.waiting.bound).toMatchObject({ id: s0.waiting!.kind === "approval" ? s0.waiting.approvalId : "", userId: "alice", projectId: r.project.id });

    const q = (await v.approve("alice", job.id)) as { approvalId: string; needsApproval: boolean };
    expect(q.needsApproval).toBe(true);
    // The VPS never issued that approval; it takes it because the job's state carries the record.
    const yes = await v.approve("alice", job.id, q.approvalId);
    expect(yes).toMatchObject({ approved: true });
    // A second yes with the same id is not a yes: the job moved on.
    await expect(v.approve("alice", job.id, q.approvalId)).rejects.toMatchObject({ code: "not_waiting" });

    // The Worker, another isolate (a fresh book), goes on.
    const w2 = worker(r, { instanceId: "wf-2", book: new ApprovalBook({ now: r.now }) });
    const rest = await drive(r, w2, job.id);
    expect(rest.at(-1)).toEqual({ next: "end", why: "finished" });
    expect((await r.jobNow(job.id)).state).toBe("done");
  });

  it("a yes the policy asks for at commit time is taken by a Worker isolate that did not ask", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const w1 = worker(r, { instanceId: "wf-1" });
    const v = createAgent({
      code: { ...r.code, approvals: new ApprovalBook({ now: r.now }) }, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog,
      now: r.now, sleep: r.sleep, log: r.log, remote: { start: async () => undefined, wake: async () => undefined }, instanceId: "vps",
    })!;
    // A branch Tailzu did not make: committing to it is a question.
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, UTIL_TASK);
    const job = await r.jobs.createJob("alice", r.project.id, branch, UTIL_TASK, undefined, { agent: true });
    (r.store as unknown as { branches: Map<string, unknown> }).branches.clear();
    await w1.enqueue(job.id, UTIL_TASK);
    await drive(r, w1, job.id);
    const plan = (await v.approve("alice", job.id)) as { approvalId: string };
    await v.approve("alice", job.id, plan.approvalId);
    await drive(r, worker(r, { instanceId: "wf-2" }), job.id);

    const s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "approval", for: "commit", action: "commit.other_branch" });
    const commit = (await v.approve("alice", job.id)) as { approvalId: string };
    await v.approve("alice", job.id, commit.approvalId);
    // Yet another isolate, yet another empty book: the commit goes through with the approval it was given.
    const rest = await drive(r, worker(r, { instanceId: "wf-3" }), job.id);
    expect(rest.at(-1)).toEqual({ next: "end", why: "finished" });
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
  });

  it("an approval that ran out is expired, as it is on one server", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    const w = worker(r);
    const v = createAgent({
      code: { ...r.code, approvals: new ApprovalBook({ now: r.now }) }, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog,
      now: r.now, sleep: r.sleep, log: r.log, remote: { start: async () => undefined, wake: async () => undefined }, instanceId: "vps",
    })!;
    const { job } = await made(r, w, RISKY);
    await drive(r, w, job.id);
    const q = (await v.approve("alice", job.id)) as { approvalId: string };
    r.fake.clock.t += 11 * 60_000;
    await expect(v.approve("alice", job.id, q.approvalId)).rejects.toMatchObject({ code: "approval_expired" });
    const again = (await v.approve("alice", job.id)) as { approvalId: string };
    expect(again.approvalId).not.toBe(q.approvalId);
    expect((await v.approve("alice", job.id, again.approvalId))).toMatchObject({ approved: true });
  });

  it("the book's peek and restore: only a good approval, exactly as issued, and never longer than it lived", () => {
    let t = 1_000;
    const book = new ApprovalBook({ now: () => t, ttlMs: 10_000 });
    const a = book.issue({ userId: "u", projectId: "p", action: "commit.other_branch", branch: "b", headSha: "h" });
    expect(book.peek(a.id)).toEqual(a);
    expect(book.peek("nope")).toBeNull();
    const other = new ApprovalBook({ now: () => t, ttlMs: 10_000 });
    expect(other.restore(a)).toBe(true);
    expect(other.take(a.id, { userId: "u", projectId: "p", action: "commit.other_branch", branch: "b" })).toMatchObject({ ok: true, approval: { headSha: "h" } });
    expect(other.take(a.id, { userId: "u", projectId: "p", action: "commit.other_branch", branch: "b" })).toEqual({ ok: false, reason: "unknown" });
    t += 20_000;
    expect(book.peek(a.id)).toBeNull();
    expect(new ApprovalBook({ now: () => t }).restore(a)).toBe(false);
    // Another person's key still does not find it.
    t = 1_000;
    const third = new ApprovalBook({ now: () => t });
    third.restore(a);
    expect(third.take(a.id, { userId: "mallory", projectId: "p", action: "commit.other_branch", branch: "b" })).toEqual({ ok: false, reason: "unknown" });
  });
});
