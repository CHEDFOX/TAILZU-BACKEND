/**
 * The month's GitHub Actions minutes (src/code/live/minutes.ts, the router, migration 0031_code_runner_minutes.sql): the person is told ONCE at 80% of
 * CODE_ACTIONS_MONTHLY_MIN, at 95% placement stops choosing GitHub's computers and falls through to the next place, and a public repo's minutes do not
 * count. Run against the real provider for GitHub's computers (jobs-rig.ts) with the allowance made small so a few steps cross the lines. Also the way a
 * session step is offered a room: by the router to a PC, and by the provider in the step it commits.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { rig, LAPTOP, MIN } = await import("./jobs-rig.js");
const { createGithubActions, createJobs } = await import("../src/code/jobs/index.js");
const { MemoryJobStore, SupabaseJobStore } = await import("../src/code/jobs/store.js");
const { parseHolder } = await import("../src/code/shadow.js");
const { monthKey } = await import("../src/code/jobs/types.js");
const { sessionOffers } = await import("../src/code/live/offers.js");
const { SESSION_COMMAND } = await import("../src/code/live/protocol.js");
const { readTicket } = await import("../src/code/live/tickets.js");
const { actionsLevel, actionsMinutesLeft, minutesLowWords, notifyAtMinutes, stopAtMinutes } = await import("../src/code/live/minutes.js");
const { getConfig } = await import("../src/config.js");
const { NOTIFY_KINDS } = await import("../src/code/jobs/handoff/protocol.js");
type Rig = Awaited<ReturnType<typeof rig>>;

const SECRET = ["live", "minutes", "secret", "y".repeat(40)].join("-");

describe("the lines", () => {
  it("are 80% to tell the person and 95% to stop, of the month's allowance", () => {
    expect(notifyAtMinutes(2000)).toBe(1600);
    expect(stopAtMinutes(2000)).toBe(1900);
    expect(actionsMinutesLeft(2000, 0)).toBe(1900);
    expect(actionsMinutesLeft(2000, 1899)).toBe(1);
    expect(actionsMinutesLeft(2000, 1900)).toBe(0);
    expect(actionsMinutesLeft(2000, 99_999)).toBe(0);
    expect(actionsMinutesLeft(100, 94)).toBe(1);
    expect(actionsMinutesLeft(Number.NaN, 0)).toBe(1900); // nonsense falls back to the default allowance
    expect(actionsMinutesLeft(2000, Number.NaN)).toBe(1900);
    expect(actionsMinutesLeft(0, 0)).toBe(0);
  });

  it("say where a month stands", () => {
    expect(actionsLevel(100, 0)).toBe("ok");
    expect(actionsLevel(100, 79)).toBe("ok");
    expect(actionsLevel(100, 80)).toBe("notify");
    expect(actionsLevel(100, 94)).toBe("notify");
    expect(actionsLevel(100, 95)).toBe("stop");
    expect(actionsLevel(0, 0)).toBe("stop");
  });

  it("are told to the person in plain words with the figures", () => {
    const w = minutesLowWords(2000, 1612.4);
    expect(w).toContain("1612 of your 2000");
    expect(w).toContain("1900");
    expect(w.length).toBeLessThan(300);
  });

  it("are settings: 2,000 a month, 120 seconds idle, 20 minutes a job, and the live session on", () => {
    const cfg = getConfig();
    expect(cfg.CODE_ACTIONS_MONTHLY_MIN).toBe(2000);
    expect(cfg.CODE_SESSION_IDLE_SEC).toBe(120);
    expect(cfg.CODE_SESSION_MAX_MIN).toBe(20);
    expect(cfg.CODE_LIVE_SESSION).toBe(true);
  });
});

describe("the store", () => {
  it("adds minutes and says YES to the call that took the month over the line, and no to every other", async () => {
    const s = new MemoryJobStore();
    const add = (n: number) => s.addRunnerMinutes("alice", "2026-10", n, 80);
    expect(await add(30)).toEqual({ minutes: 30, crossedNotify: false });
    expect(await add(49)).toEqual({ minutes: 79, crossedNotify: false });
    expect(await add(1)).toEqual({ minutes: 80, crossedNotify: true });
    expect(await add(5)).toEqual({ minutes: 85, crossedNotify: false });
    expect(await s.getRunnerMinutes("alice", "2026-10")).toEqual({ userId: "alice", month: "2026-10", minutes: 85, notified80: true });
    // a new month starts again, another person is another row
    expect(await s.getRunnerMinutes("alice", "2026-11")).toEqual({ userId: "alice", month: "2026-11", minutes: 0, notified80: false });
    expect(await s.addRunnerMinutes("alice", "2026-11", 90, 80)).toEqual({ minutes: 90, crossedNotify: true });
    expect((await s.getRunnerMinutes("bob", "2026-10")).minutes).toBe(0);
    // one step can jump over the line at once, and rounds as the usage count does
    expect(await s.addRunnerMinutes("carol", "2026-10", 99.6, 80)).toEqual({ minutes: 100, crossedNotify: true });
    expect(await s.addRunnerMinutes("carol", "2026-10", -5, 80)).toEqual({ minutes: 100, crossedNotify: false });
  });

  it("tells the person once when two results arrive together", async () => {
    const s = new MemoryJobStore();
    const crossed = (await Promise.all([1, 2, 3, 4].map(() => s.addRunnerMinutes("alice", "2026-10", 25, 80)))).filter((r) => r.crossedNotify);
    expect(crossed).toHaveLength(1);
    expect((await s.getRunnerMinutes("alice", "2026-10")).minutes).toBe(100);
  });

  it("asks the database to do it in one call (the Supabase twin against a recording stub)", async () => {
    const log: Array<[string, unknown[]]> = [];
    const chain = (answer: unknown): unknown => new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answer);
        return (...args: unknown[]) => { log.push([String(prop), args]); return chain(answer); };
      },
    });
    const UID = "11111111-1111-4111-8111-111111111111";
    const rpcStore = new SupabaseJobStore({ from: () => chain({ data: null, error: null }), rpc: (f: string, a: unknown) => { log.push(["rpc", [f, a]]); return chain({ data: { total_minutes: 81, crossed: true }, error: null }); } } as never);
    expect(await rpcStore.addRunnerMinutes(UID, "2026-10", 12.4, 80)).toEqual({ minutes: 81, crossedNotify: true });
    expect(log.find(([m]) => m === "rpc")![1]).toEqual(["code_add_runner_minutes", { p_user: UID, p_month: "2026-10", p_minutes: 12, p_notify_at: 80 }]);
    const readStore = new SupabaseJobStore({ from: (t: string) => { log.push(["from", [t]]); return chain({ data: { actions_minutes: 40, notified_80: false }, error: null }); } } as never);
    expect(await readStore.getRunnerMinutes(UID, "2026-10")).toEqual({ userId: UID, month: "2026-10", minutes: 40, notified80: false });
    expect(log).toEqual(expect.arrayContaining([["from", ["code_runner_minutes"]]]));
    const none = new SupabaseJobStore({ from: () => chain({ data: null, error: null }) } as never);
    expect(await none.getRunnerMinutes(UID, "2026-10")).toEqual({ userId: UID, month: "2026-10", minutes: 0, notified80: false });
  });

  it("has a migration that matches: a row per person and month, row security, the function, appended to the whole schema", () => {
    const dir = join(__dirname, "..", "supabase");
    const mig = readFileSync(join(dir, "migrations", "0031_code_runner_minutes.sql"), "utf8");
    expect(mig).toMatch(/create table if not exists public\.code_runner_minutes/);
    expect(mig).toMatch(/primary key \(user_id, month\)/);
    expect(mig).toMatch(/actions_minutes integer not null default 0/);
    expect(mig).toMatch(/notified_80\s+boolean not null default false/);
    expect(mig).toMatch(/alter table public\.code_runner_minutes enable row level security/);
    expect(mig).toMatch(/create policy "users read own code runner minutes"[\s\S]*for select[\s\S]*auth\.uid\(\) = user_id/);
    expect(mig).toMatch(/revoke all on function public\.code_add_runner_minutes[\s\S]*from public, anon, authenticated/);
    expect(mig).toMatch(/grant execute on function public\.code_add_runner_minutes[\s\S]*to service_role/);
    expect(mig).toMatch(/returns table \(total_minutes integer, crossed boolean\)/);
    const all = readFileSync(join(dir, "full_schema.sql"), "utf8");
    expect(all).toContain("-- 0031_code_runner_minutes.sql");
    expect(all.slice(all.indexOf("-- 0031_code_runner_minutes.sql"))).toContain(mig.trim().split("\n").slice(-6).join("\n"));
    // it is the LAST thing in the file, after 0030
    expect(all.indexOf("-- 0031_code_runner_minutes.sql")).toBeGreaterThan(all.indexOf("-- 0030_code_agent.sql"));
  });
});

/** A router that counts the month's Actions minutes against a small allowance, over the rig's real provider for GitHub's computers. */
async function counting(r: Rig, monthlyMin = 100) {
  return createJobs({
    code: r.code, store: r.jobStore, github: r.actions, now: r.now, notify: (userId, kind, data) => { r.told.push({ userId, kind, data }); }, actions: { monthlyMin },
  })!;
}

/** One step on GitHub's computers, run and reported as the script does, taking `minutes`. */
async function stepOf(r: Rig, jobs: Awaited<ReturnType<typeof counting>>, jobId: string, minutes: number, commands = ["npm test"]) {
  const { job: placed, step } = await jobs.requestExec(jobId, commands, 300, 1);
  if (placed.placement !== "github") return { placed, step, reported: false };
  const held = parseHolder(placed.leaseHolder)!;
  const token = await r.oidc.sign({
    repository_id: String(r.repo.id), repository: r.repo.fullName, event_name: "push", ref: `refs/heads/${held.branch}`, sha: held.sha,
    workflow_ref: `${r.repo.fullName}/.github/workflows/tailzu-run.yml@refs/heads/${held.branch}`, run_id: "99",
  });
  await r.actions!.handleResult(jobs, `Bearer ${token}`, { jobId, stepIdx: step.idx, epoch: placed.leaseEpoch, exitCode: 0, outputTail: "ok", minutes });
  return { placed, step, reported: true };
}

describe("the router, with the month's minutes counted", () => {
  it("tells the person once at 80%, and counts every step of a private repo", async () => {
    const r = await rig({ actions: true });
    const jobs = await counting(r);
    const j = await jobs.createJob("alice", r.project.id, r.branch, "t", 0);
    const month = monthKey(r.now());
    for (let i = 0; i < 9; i += 1) await stepOf(r, jobs, j.id, 8); // 72
    expect(r.toldOf("minutes_low")).toHaveLength(0);
    await stepOf(r, jobs, j.id, 8); // 80
    expect(r.toldOf("minutes_low")).toHaveLength(1);
    expect(r.toldOf("minutes_low")[0]!.data.reason).toContain("80 of your 100");
    expect((await r.jobStore.getRunnerMinutes("alice", month)).minutes).toBe(80);
    await stepOf(r, jobs, j.id, 8); // 88
    expect(r.toldOf("minutes_low")).toHaveLength(1);
    expect(r.toldOf("minutes_low")[0]!.userId).toBe("alice");
    // the older usage count is kept as well
    expect((await r.jobStore.getUsage("alice", month)).githubMinutes).toBe(88);
  });

  it("stops choosing GitHub's computers at 95% and falls through to the next place, until the month turns over", async () => {
    const r = await rig({ actions: true });
    const jobs = await counting(r);
    const j = await jobs.createJob("alice", r.project.id, r.branch, "t", 0);
    for (let i = 0; i < 4; i += 1) await stepOf(r, jobs, j.id, 23); // 92
    expect((await stepOf(r, jobs, j.id, 2)).placed.placement).toBe("github"); // 94: one minute left, a one minute step fits
    const full = await stepOf(r, jobs, j.id, 1);
    expect(full.placed.placement).toBe("github"); // 95
    await jobs.cancelExec(j.id).catch(() => undefined);
    const blocked = await jobs.requestExec(j.id, ["npm test"], 300, 1);
    expect(blocked.job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
    expect(blocked.job.reason).toMatch(/free GitHub minutes are used up/);
    expect(r.toldOf("compute_paused")).toHaveLength(1);
    // a PC takes it at once; paid is off; the month turning over gives GitHub back
    await r.beat(LAPTOP);
    expect((await jobs.job("alice", j.id)).placement).toBe("desktop");
    await jobs.cancelExec(j.id);
    r.advance(40 * 24 * 60 * MIN);
    await r.jobs.heartbeat("alice", { deviceId: LAPTOP, name: "x", allowRun: false, projects: "all", busy: false });
    expect((await jobs.requestExec(j.id, ["npm test"], 300, 1)).job.placement).toBe("github");
  });

  it("does not count a public repo's minutes, tell the person about them, or hold a step back for them", async () => {
    const r = await rig({ actions: true, publicRepo: true });
    const jobs = await counting(r);
    const j = await jobs.createJob("alice", r.project.id, r.branch, "t", 0);
    for (let i = 0; i < 6; i += 1) expect((await stepOf(r, jobs, j.id, 60)).placed.placement).toBe("github");
    expect((await r.jobStore.getRunnerMinutes("alice", monthKey(r.now()))).minutes).toBe(0);
    expect((await r.jobStore.getUsage("alice", monthKey(r.now()))).githubMinutes).toBe(0);
    expect(r.toldOf("minutes_low")).toHaveLength(0);
  });

  it("counts the older usage as well, so starting here in the middle of a month gives no fresh allowance", async () => {
    const r = await rig({ actions: true });
    const jobs = await counting(r);
    const j = await jobs.createJob("alice", r.project.id, r.branch, "t", 0);
    await r.jobStore.addUsage("alice", monthKey(r.now()), { githubMinutes: 94 });
    const view = await jobs.settingsView("alice");
    expect(view.githubFreeMinutes).toEqual({ allowance: 100, headroomPercent: 5, used: 94, left: 1 });
    const { job } = await jobs.requestExec(j.id, ["a", "b"], 300, 3); // needs three minutes, one is left
    expect(job.state).toBe("waiting_for_compute");
  });

  it("shows the older rule, a tenth kept back, when the minutes are not counted here", async () => {
    const r = await rig({ actions: true });
    expect((await r.jobs.settingsView("alice")).githubFreeMinutes).toEqual({ allowance: 2000, headroomPercent: 10, used: 0, left: 1800 });
    const jobs = await counting(r, 2000);
    expect((await jobs.settingsView("alice")).githubFreeMinutes).toEqual({ allowance: 2000, headroomPercent: 5, used: 0, left: 1900 });
  });

  it("knows the new kind among those the VPS and the Worker send each other", () => {
    expect(NOTIFY_KINDS).toContain("minutes_low");
    expect(NOTIFY_KINDS).toHaveLength(8);
  });
});

describe("a session step", () => {
  const offerSession = sessionOffers({ secret: SECRET, jobsUrl: "https://jobs.example", idleSec: 120 });

  it("is committed to GitHub's computers with the way into the room, the session's workflow and no changes kept", async () => {
    const r = await rig({ actions: true });
    // a router whose provider is given the way into a room
    const actions = createGithubActions({
      code: r.code, store: r.jobStore, now: r.now, keys: async () => (await import("./jobs-rig.js")).OIDC.publicKey, audience: "tailzu", resultUrl: "https://api.tailzu.test/v1/code/runner/gh-result", offerSession,
    })!;
    const jobs = createJobs({ code: r.code, store: r.jobStore, github: actions, now: r.now, offerSession })!;
    const j = await jobs.createJob("alice", r.project.id, r.branch, "t", 0);
    const { job, step } = await jobs.requestExec(j.id, [SESSION_COMMAND], 1200, 5, { keepChanges: false });
    expect(job).toMatchObject({ placement: "github", state: "running" });
    expect(step.discard).toBe(true);
    const held = parseHolder(job.leaseHolder)!;
    const files = r.fake.files(r.repo, held.branch);
    const spec = JSON.parse(files[".tailzu/step.json"]!);
    expect(spec).toMatchObject({ jobId: j.id, stepIdx: step.idx, epoch: job.leaseEpoch, commands: [SESSION_COMMAND], timeoutSec: 1200, discard: true });
    expect(spec.session).toMatchObject({ url: `wss://jobs.example/v1/rooms/${j.id}/runner`, idleSec: 120, maxSec: 1200 });
    const read = readTicket(SECRET, spec.session.ticket, "runner", r.now());
    expect(read.ok && read.claims).toMatchObject({ j: j.id, s: step.idx, e: job.leaseEpoch });
    // the session's workflow: a shallow checkout that keeps no token, a Node that has a WebSocket, the caches, and the job's limit as its timeout
    const wf = files[".github/workflows/tailzu-run.yml"]!;
    expect(wf).toContain("persist-credentials: false");
    expect(wf).toContain("fetch-depth: 1");
    expect(wf).toContain("actions/setup-node@v4");
    expect(wf).toContain("actions/cache@v4");
    expect(wf).toContain("timeout-minutes: 21");
    expect(wf).toContain("permissions:\n  contents: read\n  id-token: write");
    expect(wf).not.toContain("write-all");
  });

  it("is not committed at all by a provider with no way into a room: it is not a command to run", async () => {
    const r = await rig({ actions: true });
    const j = await r.job();
    const { job } = await r.jobs.requestExec(j.id, [SESSION_COMMAND], 600, 5, { keepChanges: false });
    expect(job.placement).not.toBe("github");
    expect(job.state).toBe("waiting_for_compute");
  });

  it("is offered to a PC with the way into the room, and the offer is a ticket for this step and this lease", async () => {
    const r = await rig({ actions: true });
    const jobs = createJobs({ code: r.code, store: r.jobStore, github: r.actions, now: r.now, offerSession })!;
    const j = await jobs.createJob("alice", r.project.id, r.branch, "t", 0);
    await jobs.heartbeat("alice", { deviceId: LAPTOP, name: "Work laptop", allowRun: true, projects: "all", busy: false });
    const { job, step } = await jobs.requestExec(j.id, [SESSION_COMMAND], 900, 5, { keepChanges: false });
    expect(job.placement).toBe("desktop");
    const next = await jobs.next("alice", LAPTOP);
    expect(next).toMatchObject({ jobId: j.id, stepIdx: step.idx, epoch: job.leaseEpoch, commands: [SESSION_COMMAND], discard: true });
    expect(next!.session).toMatchObject({ url: `wss://jobs.example/v1/rooms/${j.id}/runner`, maxSec: 900 });
    const read = readTicket(SECRET, next!.session!.ticket, "runner", r.now());
    expect(read.ok && read.claims).toMatchObject({ j: j.id, s: step.idx, e: job.leaseEpoch });
    // an ordinary step carries none
    await jobs.cancelExec(j.id);
    await jobs.requestExec(j.id, ["npm test"], 60, 1);
    expect((await jobs.next("alice", LAPTOP))!.session).toBeUndefined();
  });

  it("notes the end of a session in the checkpoint in words, not as a command that ran", async () => {
    const r = await rig({ actions: true });
    const jobs = createJobs({ code: r.code, store: r.jobStore, github: r.actions, now: r.now, offerSession })!;
    const j = await jobs.createJob("alice", r.project.id, r.branch, "t", 0);
    await jobs.heartbeat("alice", { deviceId: LAPTOP, name: "Work laptop", allowRun: true, projects: "all", busy: false });
    const { job, step } = await jobs.requestExec(j.id, [SESSION_COMMAND], 900, 5, { keepChanges: false });
    await jobs.next("alice", LAPTOP);
    await jobs.submitResult("alice", { jobId: j.id, stepIdx: step.idx, epoch: job.leaseEpoch, exitCode: 0, outputTail: "[Tailzu: live session ended (closed); 3 command(s) run]", minutes: 4 }, "desktop");
    const after = await jobs.job("alice", j.id);
    expect(after.checkpoint.notes).toBe("Closed the live session after 4 minutes.");
    expect(after.state).toBe("running");
    // and a job can be finished: no step is out
    expect((await jobs.finishJob(j.id, { ok: true })).state).toBe("done");
  });
});
