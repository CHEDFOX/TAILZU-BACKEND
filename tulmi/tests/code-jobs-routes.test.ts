/**
 * The Code bot's jobs and the runner protocol over HTTP (src/routes/codeJobs.ts):
 * off, not set up, behind a session; making, reading and cancelling a job; the
 * person's two yeses; the compute settings; and a PC's heartbeat, its wait for
 * work, its progress and its result, through a real Fastify with the fake GitHub
 * behind it. What the router decides is in code-jobs.test.ts.
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

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

const { rig, LAPTOP, DESKTOP, SEC, SECRET_ENV } = await import("./jobs-rig.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { LEASE_MS } = await import("../src/code/jobs/types.js");
type Rig = Awaited<ReturnType<typeof rig>>;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const NOBODY = "00000000-0000-4000-8000-000000000000";

afterEach(() => { vi.useRealTimers(); });

async function server(r: Rig, o: { pollMs?: number; tickEveryMs?: number | null; jobs?: boolean } = {}) {
  const app = Fastify();
  registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: o.jobs === false ? null : r.jobs, tickEveryMs: o.tickEveryMs ?? null, pollMs: o.pollMs ?? 0 });
  await app.ready();
  const call = (user: string | null, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, call };
}

const ROUTES: Array<["GET" | "POST" | "PUT", string]> = [
  ["POST", "/v1/code/jobs"], ["GET", "/v1/code/jobs"], ["GET", `/v1/code/jobs/${NOBODY}`], ["POST", `/v1/code/jobs/${NOBODY}/cancel`],
  ["POST", `/v1/code/jobs/${NOBODY}/compute-ok`], ["POST", `/v1/code/jobs/${NOBODY}/commit-ok`],
  ["GET", "/v1/code/settings/compute"], ["PUT", "/v1/code/settings/compute"],
  ["POST", "/v1/code/runner/heartbeat"], ["GET", `/v1/code/runner/next?deviceId=${LAPTOP}`], ["POST", "/v1/code/runner/progress"], ["POST", "/v1/code/runner/result"],
];

describe("with the Code bot off, or GitHub not set up, or nobody signed in", () => {
  it("answers 404 code_off on every route, with or without a session", async () => {
    const app = Fastify();
    registerCodeJobRoutes(app, { rateLimit: RL, code: null, jobs: null });
    await app.ready();
    for (const [method, url] of ROUTES) {
      for (const headers of [{}, who("alice")]) {
        const res = await app.inject({ method, url, headers, ...(method !== "GET" ? { payload: {} } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json()).toMatchObject({ code: "code_off" });
      }
    }
    await app.close();
  });

  it("answers 503 not_configured on every route when there is no GitHub client to run jobs with, before asking for a session", async () => {
    const r = await rig();
    const s = await server(r, { jobs: false });
    for (const [method, url] of ROUTES) {
      for (const user of [null, "alice"]) {
        const res = await s.call(user, method, url, method !== "GET" ? {} : undefined);
        expect(res.statusCode, `${method} ${url}`).toBe(503);
        expect(res.json()).toMatchObject({ code: "not_configured" });
      }
    }
    await s.app.close();
  });

  it("answers 401 on every route without a session", async () => {
    const r = await rig();
    const s = await server(r);
    for (const [method, url] of ROUTES) {
      const res = await s.call(null, method, url, method !== "GET" ? {} : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toMatchObject({ code: "unauthorized" });
    }
    await s.app.close();
  });
});

describe("jobs", () => {
  it("are made on a branch Tailzu made, listed newest first, read with their steps, and only the person's own", async () => {
    const r = await rig();
    const s = await server(r);
    const bad = await s.call("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch: r.branch });
    expect(bad.statusCode).toBe(400);
    expect((await s.call("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch: r.branch, task: "t", budgetPaise: "lots" })).statusCode).toBe(400);
    expect((await s.call("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch: "main", task: "t" })).statusCode).toBe(404);
    expect((await s.call("bob", "POST", "/v1/code/jobs", { projectId: r.project.id, branch: r.branch, task: "t" })).statusCode).toBe(404);
    expect((await s.call("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch: r.branch, task: "   " })).json()).toMatchObject({ code: "bad_request" });

    const made = await s.call("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch: r.branch, task: "make the build pass", budgetPaise: 300 });
    expect(made.statusCode).toBe(200);
    const job = made.json().job;
    expect(job).toMatchObject({ userId: "alice", state: "queued", branch: r.branch, budgetPaise: 300, checkpoint: { stepIndex: -1 } });
    const second = (await s.call("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch: r.branch, task: "another" })).json().job;
    expect((await s.call("alice", "GET", "/v1/code/jobs")).json().jobs.map((j: { id: string }) => j.id)).toEqual([second.id, job.id]);
    expect((await s.call("bob", "GET", "/v1/code/jobs")).json()).toEqual({ jobs: [] });

    await r.beat(LAPTOP);
    await r.jobs.requestExec(job.id, ["npm test"], 60, 1);
    const one = (await s.call("alice", "GET", `/v1/code/jobs/${job.id}`)).json();
    expect(one.job).toMatchObject({ id: job.id, state: "running", placement: "desktop" });
    expect(one.steps).toEqual([expect.objectContaining({ idx: 0, kind: "exec", commands: ["npm test"], status: "dispatched", placement: "desktop", epoch: 1 })]);
    expect((await s.call("bob", "GET", `/v1/code/jobs/${job.id}`)).statusCode).toBe(404);
    expect((await s.call("alice", "GET", `/v1/code/jobs/${NOBODY}`)).statusCode).toBe(404);
    expect((await s.call("alice", "GET", "/v1/code/jobs/not-an-id")).statusCode).toBe(404);
    await s.app.close();
  });

  it("are cancelled by their person only, and a cancelled job's PC is given nothing", async () => {
    const r = await rig();
    const s = await server(r);
    await r.beat(LAPTOP);
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["ls"], 60, 1);
    expect((await s.call("bob", "POST", `/v1/code/jobs/${job.id}/cancel`)).statusCode).toBe(404);
    expect((await r.jobs.job("alice", job.id)).state).toBe("running");
    const res = await s.call("alice", "POST", `/v1/code/jobs/${job.id}/cancel`);
    expect(res.statusCode).toBe(200);
    expect(res.json().job).toMatchObject({ state: "cancelled", placement: "none", leaseHolder: null });
    expect((await s.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}`)).statusCode).toBe(204);
    expect((await s.call("alice", "POST", `/v1/code/jobs/${job.id}/cancel`)).json().job.state).toBe("cancelled");
    await s.app.close();
  });

  it("have a yes to paid compute that works only after the question, and a yes to a commit that is the usual two steps", async () => {
    const r = await rig();
    const s = await server(r);
    await r.jobStore.addUsage("alice", "2026-10", { githubMinutes: 1800 });
    expect((await s.call("alice", "PUT", "/v1/code/settings/compute", { paidRule: "ask" })).statusCode).toBe(200);
    const job = await r.job();
    expect((await s.call("alice", "POST", `/v1/code/jobs/${job.id}/compute-ok`, {})).json()).toMatchObject({ code: "not_waiting" });
    await r.jobs.requestExec(job.id, ["pytest"], 60, 5);
    expect((await s.call("alice", "POST", `/v1/code/jobs/${job.id}/compute-ok`, { maxPaise: 10 })).statusCode).toBe(400);
    expect((await s.call("alice", "POST", `/v1/code/jobs/${job.id}/compute-ok`, { maxPaise: "ten" })).statusCode).toBe(400);
    expect((await s.call("bob", "POST", `/v1/code/jobs/${job.id}/compute-ok`, {})).statusCode).toBe(404);
    const ok = await s.call("alice", "POST", `/v1/code/jobs/${job.id}/compute-ok`, { maxPaise: 800 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().job).toMatchObject({ state: "running", placement: "paid", budgetPaise: 800 });
    await s.app.close();

    // The commit.
    const r2 = await rig({ github: false, paid: false });
    const s2 = await server(r2);
    await r2.beat(LAPTOP);
    const j2 = await r2.job();
    await r2.jobs.requestExec(j2.id, ["build"], 60, 1);
    const given = (await r2.jobs.next("alice", LAPTOP))!;
    const result = await s2.call("alice", "POST", "/v1/code/runner/result", {
      jobId: j2.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: ".env", content: SECRET_ENV }],
    });
    expect(result.json()).toEqual({ ok: true, state: "waiting_for_you", committed: false, waitingForYou: true });
    const head = r2.fake.head(r2.repo, r2.branch);
    const q = await s2.call("alice", "POST", `/v1/code/jobs/${j2.id}/commit-ok`, {});
    expect(q.statusCode).toBe(200);
    expect(q.json()).toMatchObject({ needsApproval: true, action: "commit.secret", faceId: true, approvalId: expect.any(String) });
    expect(r2.fake.head(r2.repo, r2.branch)).toBe(head);
    expect((await s2.call("alice", "POST", `/v1/code/jobs/${j2.id}/commit-ok`, { approvalId: "made-up" })).statusCode).toBe(409);
    expect((await s2.call("alice", "POST", `/v1/code/jobs/${j2.id}/commit-ok`, { approvalId: 5 })).statusCode).toBe(400);
    expect((await s2.call("bob", "POST", `/v1/code/jobs/${j2.id}/commit-ok`, {})).statusCode).toBe(404);
    const done = await s2.call("alice", "POST", `/v1/code/jobs/${j2.id}/commit-ok`, { approvalId: q.json().approvalId });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ committed: true, sha: r2.fake.head(r2.repo, r2.branch), job: { state: "running" } });
    expect((await s2.call("alice", "POST", `/v1/code/jobs/${j2.id}/commit-ok`, {})).json()).toMatchObject({ code: "not_waiting" });
    await s2.app.close();
  });
});

describe("the compute settings", () => {
  it("start at never, GitHub on; change a bit at a time; say what is left of GitHub's free minutes this month; refuse nonsense", async () => {
    const r = await rig();
    const s = await server(r);
    const first = (await s.call("alice", "GET", "/v1/code/settings/compute")).json();
    expect(first).toEqual({
      settings: { paidRule: "never", autoCapPaise: 0, githubEnabled: true },
      githubFreeMinutes: { allowance: 2000, headroomPercent: 10, used: 0, left: 1800 },
      usage: { month: "2026-10", githubMinutes: 0, paidPaise: 0 },
      providers: { github: true, paid: true },
    });
    const a = await s.call("alice", "PUT", "/v1/code/settings/compute", { paidRule: "auto", autoCapPaise: 50_000 });
    expect(a.json().settings).toEqual({ paidRule: "auto", autoCapPaise: 50_000, githubEnabled: true });
    const b = await s.call("alice", "PUT", "/v1/code/settings/compute", { githubEnabled: false });
    expect(b.json().settings).toEqual({ paidRule: "auto", autoCapPaise: 50_000, githubEnabled: false });
    expect((await s.call("bob", "GET", "/v1/code/settings/compute")).json().settings.paidRule).toBe("never");
    for (const bad of [{ paidRule: "always" }, { paidRule: 1 }, { autoCapPaise: -1 }, { autoCapPaise: 1.5 }, { autoCapPaise: 2_000_000 }, { githubEnabled: "yes" }]) {
      const res = await s.call("alice", "PUT", "/v1/code/settings/compute", bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json().code).toBe("bad_request");
    }
    // Unchanged by the refusals; an empty change changes nothing.
    expect((await s.call("alice", "PUT", "/v1/code/settings/compute", {})).json().settings).toEqual({ paidRule: "auto", autoCapPaise: 50_000, githubEnabled: false });
    await r.jobStore.addUsage("alice", "2026-10", { githubMinutes: 25, paidPaise: 700 });
    const after = (await s.call("alice", "GET", "/v1/code/settings/compute")).json();
    expect(after.githubFreeMinutes).toMatchObject({ used: 25, left: 1775 });
    expect(after.usage).toEqual({ month: "2026-10", githubMinutes: 25, paidPaise: 700 });
    await s.app.close();

    const none = await rig({ github: false, paid: false });
    const s2 = await server(none);
    expect((await s2.call("alice", "GET", "/v1/code/settings/compute")).json().providers).toEqual({ github: false, paid: false });
    await s2.app.close();
  });

  it("a rule that frees a waiting job lets it go at once", async () => {
    const r = await rig();
    const s = await server(r);
    await r.jobStore.addUsage("alice", "2026-10", { githubMinutes: 1800 });
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["x"], 60, 5);
    expect((await r.jobs.job("alice", job.id)).state).toBe("waiting_for_compute");
    await s.call("alice", "PUT", "/v1/code/settings/compute", { paidRule: "auto", autoCapPaise: 10_000 });
    expect((await r.jobs.job("alice", job.id))).toMatchObject({ state: "running", placement: "paid" });
    await s.app.close();
  });
});

describe("the runner protocol", () => {
  const beat = (s: Awaited<ReturnType<typeof server>>, over: Record<string, unknown> = {}, user = "alice") =>
    s.call(user, "POST", "/v1/code/runner/heartbeat", { deviceId: LAPTOP, name: "Work laptop", allowRun: true, projects: "all", busy: false, ...over });

  it("takes a heartbeat, and refuses one that isn't what it says", async () => {
    const r = await rig();
    const s = await server(r);
    const ok = await beat(s);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, onlineForSec: 60, leasesRenewed: 0 });
    for (const bad of [{ deviceId: "x" }, { allowRun: "true" }, { projects: "some" }, { projects: [5] }, { busy: "no" }]) {
      const res = await beat(s, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json().code).toBe("bad_request");
    }
    expect((await s.call("alice", "POST", "/v1/code/runner/heartbeat")).statusCode).toBe(400);
    expect((await s.call("alice", "POST", "/v1/code/runner/heartbeat", [])).statusCode).toBe(400);
    await s.app.close();
  });

  it("answers next with 204 when there is nothing, 409 to a PC it hasn't heard from, 400 without a device id, and the step as JSON when there is one", async () => {
    const r = await rig();
    const s = await server(r);
    expect((await s.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}`)).statusCode).toBe(409);
    expect((await s.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}`)).json().code).toBe("unknown_device");
    expect((await s.call("alice", "GET", "/v1/code/runner/next")).statusCode).toBe(400);
    expect((await s.call("alice", "GET", "/v1/code/runner/next?deviceId=x")).statusCode).toBe(400);
    await beat(s);
    const none = await s.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}`);
    expect(none.statusCode).toBe(204);
    expect(none.body).toBe("");

    const job = await r.job();
    await r.jobs.requestExec(job.id, ["npm ci", "npm test"], 300, 3);
    const got = await s.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}`);
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({
      jobId: job.id, stepIdx: 0, epoch: 1, commands: ["npm ci", "npm test"], timeoutSec: 300,
      repo: { kind: "app", cloneUrl: "https://github.com/alice/app.git", branch: r.branch, headSha: r.fake.head(r.repo, r.branch) },
    });
    // Another person's PC with the same id gets nothing.
    expect((await s.call("bob", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}`)).statusCode).toBe(409);
    await s.app.close();
  });

  it("holds the PC's request until a step is dispatched to it, up to the wait it asked for", async () => {
    const r = await rig();
    const s = await server(r, { pollMs: 5000 });
    await beat(s);
    const waiting = s.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}`);
    const settled = vi.fn();
    void waiting.then(settled);
    await new Promise((res) => setTimeout(res, 40));
    expect(settled).not.toHaveBeenCalled();
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["make"], 60, 1);
    const res = await waiting;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobId: job.id, commands: ["make"] });

    // It can ask for no wait at all, and never gets more than the server's.
    const t0 = Date.now();
    await r.jobs.cancelJob(job.id);
    expect((await s.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}&wait=0`)).statusCode).toBe(204);
    expect(Date.now() - t0).toBeLessThan(1000);
    await s.app.close();

    const short = await server(r, { pollMs: 60 });
    const t1 = Date.now();
    expect((await short.call("alice", "GET", `/v1/code/runner/next?deviceId=${LAPTOP}&wait=999`)).statusCode).toBe(204);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(40);
    expect(Date.now() - t1).toBeLessThan(2000);
    await short.app.close();
  });

  it("keeps the lease on progress, and refuses a stale one with 409 stale_lease", async () => {
    const r = await rig();
    const s = await server(r);
    await beat(s);
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["make"], 60, 1);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    r.advance(60 * SEC);
    const ok = await s.call("alice", "POST", "/v1/code/runner/progress", { jobId: job.id, epoch: given.epoch });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, leaseExpiresAt: r.now() + LEASE_MS });
    const stale = await s.call("alice", "POST", "/v1/code/runner/progress", { jobId: job.id, epoch: given.epoch + 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "stale_lease" });
    expect((await s.call("alice", "POST", "/v1/code/runner/progress", { jobId: job.id })).statusCode).toBe(400);
    expect((await s.call("bob", "POST", "/v1/code/runner/progress", { jobId: job.id, epoch: given.epoch })).statusCode).toBe(404);
    await s.app.close();
  });

  it("takes a result, commits its changes on the server, and refuses the old PC's with 409 stale_lease", async () => {
    const r = await rig({ github: false, paid: false });
    const s = await server(r);
    await beat(s);
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["make"], 60, 1);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    const body = { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "built", minutes: 1, changes: [{ path: "out/a.txt", content: "a" }, { path: "gone.txt", content: null }] };
    r.fake.push(r.repo, r.branch, { "gone.txt": "to delete" }, "someone adds a file");
    const res = await s.call("alice", "POST", "/v1/code/runner/result", body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: "running", committed: true, sha: r.fake.head(r.repo, r.branch) });
    expect(r.fake.files(r.repo, r.branch)["out/a.txt"]).toBe("a");
    expect(r.fake.files(r.repo, r.branch)["gone.txt"]).toBeUndefined();
    // Nothing in what the PC gets back that could write.
    expect(res.body).not.toMatch(/token/i);

    const dup = await s.call("alice", "POST", "/v1/code/runner/result", body);
    expect(dup.json()).toMatchObject({ ok: true, duplicate: true });
    const stale = await s.call("alice", "POST", "/v1/code/runner/result", { ...body, epoch: given.epoch + 5 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "stale_lease" });
    for (const bad of [{}, { ...body, epoch: 0 }, { ...body, changes: "x" }, { ...body, exitCode: "0" }]) {
      expect((await s.call("alice", "POST", "/v1/code/runner/result", bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await s.call("bob", "POST", "/v1/code/runner/result", body)).statusCode).toBe(404);
    await s.app.close();
  });

  it("takes a result bigger than the server's usual 1 MB body, up to 4 MB", async () => {
    const r = await rig({ github: false, paid: false });
    const s = await server(r);
    await beat(s);
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["gen"], 60, 1);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    const big = "x".repeat(900 * 1024);
    const res = await s.call("alice", "POST", "/v1/code/runner/result", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1,
      changes: [{ path: "big1.txt", content: big }, { path: "big2.txt", content: big }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().committed).toBe(true);
    // Past 4 MB it is turned away.
    const huge = await s.call("alice", "POST", "/v1/code/runner/result", { jobId: job.id, stepIdx: 0, epoch: 1, exitCode: 0, minutes: 1, outputTail: "y".repeat(4.5 * 1024 * 1024) });
    expect(huge.statusCode).toBe(413);
    await s.app.close();
  });

  it("is the PC of the person who signed in: a heartbeat from another person doesn't make a PC online for the first", async () => {
    const r = await rig({ github: false, paid: false });
    const s = await server(r);
    await beat(s, {}, "bob");
    const job = await r.job();
    const { job: waiting } = await r.jobs.requestExec(job.id, ["x"], 60, 1);
    expect(waiting.state).toBe("waiting_for_compute");
    await s.app.close();
  });
});

describe("the ticker, started and stopped with the server", () => {
  it("starts when the server is ready, takes back a lease that ran out every 15 seconds, and stops when the server closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const r = await rig();
    await r.beat(LAPTOP);
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["make"], 60, 1);
    await r.jobs.next("alice", LAPTOP);
    expect((await r.jobs.job("alice", job.id)).placement).toBe("desktop");

    const s = await server(r, { tickEveryMs: 15_000 });
    expect(vi.getTimerCount()).toBe(1);
    r.advance(LEASE_MS + 5 * SEC); // the PC has been silent for over 90 seconds
    await vi.advanceTimersByTimeAsync(0);
    // (the first pass runs at once, when the server is ready, and it had nothing to do before the clock moved.)
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await r.jobs.job("alice", job.id)).toMatchObject({ placement: "github", reassignments: 1, leaseEpoch: 2 });
    await s.app.close();
    expect(vi.getTimerCount()).toBe(0);

    // Off with null: no timer at all.
    const quiet = await server(r, { tickEveryMs: null });
    expect(vi.getTimerCount()).toBe(0);
    await quiet.app.close();
  });
});
