/**
 * THE VPS WITH JOBS ON CLOUDFLARE (CODE_JOBS_MODE=cloudflare): the job routes as the server wires them in that mode (server.ts) —
 * the orchestrator in its remote role, no ticker — over the rig. What is held:
 *
 *   - POST /v1/code/jobs makes the job and hands it to the Worker; nothing is driven here (no model call, no claim);
 *   - a Worker that cannot be reached in three tries leaves the job failed, with a reason, in the answer;
 *   - answer, approve, deny, budget and stop write the person's word into the database and then tell the Worker's Workflow;
 *   - a result taken from a PC or GitHub wakes the job's Workflow (onStepResult);
 *   - the ticker and the orchestrator's timers do not start (the Worker's Cron Trigger is the ticker);
 *   - in local mode (the default) nothing of this exists: the same routes drive the job here, as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
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

const { agentRig, call, done, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const jobsRig = await import("./jobs-rig.js");
const { createAgent } = await import("../src/code/agent/index.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { JobsHandoff } = await import("../src/code/jobs/handoff/index.js");
const { createWorkBranch } = await import("../src/code/projects.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const RISKY = "In src/util.ts make slug() trim dashes, before the password reset link is built from it";
const apps: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

/** A Worker that records what the VPS says to it, through the real client and its signing. */
function theWorker(answer: (path: string, body: Record<string, unknown>) => Response = () => Response.json({ ok: true })) {
  const seen: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body));
    seen.push({ path, body });
    return answer(path, body);
  };
  const handoff = new JobsHandoff({ url: "https://jobs.example", secret: "s".repeat(40), fetchFn, sleep: async () => undefined });
  return { seen, handoff };
}

/** The server's wiring in cloudflare mode, over the agent rig. */
async function cloudflareServer(r: Rig, w: ReturnType<typeof theWorker>) {
  const agent = createAgent({
    code: r.code, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog, notify: (u, k, d) => { r.told.push({ userId: u, kind: k, data: d }); },
    now: r.now, sleep: r.sleep, log: r.log, remote: w.handoff, instanceId: "vps",
  })!;
  const app = Fastify();
  apps.push(app);
  registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: r.jobs, agent, tickEveryMs: null, pollMs: 0, onStepResult: (id) => { void w.handoff.wake(id, "runner"); } });
  await app.ready();
  const api = (user: string | null, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, api, agent };
}

async function made(r: Rig, api: Awaited<ReturnType<typeof cloudflareServer>>["api"], task: string, body: Record<string, unknown> = {}) {
  const { branch } = await createWorkBranch(r.d, "alice", r.project.id, task);
  return api("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch, task, ...body });
}

describe("making a job", () => {
  it("makes it, hands it to the Worker (signed, by id), and drives nothing here", async () => {
    const r = await agentRig();
    const w = theWorker();
    const s = await cloudflareServer(r, w);
    const res = await made(r, s.api, UTIL_TASK);
    expect(res.statusCode).toBe(200);
    const job = res.json().job;
    expect(job).toMatchObject({ userId: "alice", state: "queued", agent: true });
    expect(job.checkpoint.agent).toBeUndefined();
    expect(w.seen).toEqual([{ path: "/v1/start", body: { jobId: job.id } }]);
    await s.agent.idle();
    expect(r.model.turns).toBe(0);
    expect(r.json.calls).toHaveLength(0);
    expect(await r.jobNow(job.id)).toMatchObject({ state: "queued", agentHolder: null, agentEpoch: 0 });
    // The whole request is in its state for the Worker to find (the job keeps 500 characters of it).
    expect((await r.stateNow(job.id)).task).toBe(UTIL_TASK);
  });

  it("leaves a job the Worker could not be told about failed, with the reason in the answer and the person told", async () => {
    const r = await agentRig();
    const w = theWorker(() => new Response("", { status: 503 }));
    const s = await cloudflareServer(r, w);
    const res = await made(r, s.api, UTIL_TASK);
    expect(res.statusCode).toBe(200);
    expect(w.seen).toHaveLength(3); // three tries
    expect(res.json().job).toMatchObject({ state: "failed" });
    expect(res.json().job.reason).toContain("could not hand this job to the machine that runs it, after trying three times");
    expect((await r.jobNow(res.json().job.id)).state).toBe("failed");
    expect(r.toldOf("job_failed")).toHaveLength(1);
  });

  it("a Worker that refuses the call (a wrong secret) fails the job at once, without more tries", async () => {
    const r = await agentRig();
    const w = theWorker(() => new Response("", { status: 401 }));
    const s = await cloudflareServer(r, w);
    const res = await made(r, s.api, UTIL_TASK);
    expect(w.seen).toHaveLength(1);
    expect(res.json().job.state).toBe("failed");
  });
});

/** The Worker's own orchestrator over the same stores (passive: it drives a job only when told to advance it). */
async function workerOf(r: Rig, instanceId = "wf") {
  const { routerRunner } = await import("../src/code/agent/runner.js");
  return createAgent({
    code: r.code, jobs: r.jobs, store: r.jobStore, brain: r.brain, call: r.model.call as never, worklog: r.worklog, now: r.now, sleep: r.sleep, log: r.log,
    web: { store: null, cache: null, fetchFn: (async () => new Response("no", { status: 404 })) as never },
    runner: routerRunner({ jobs: r.jobs, store: r.jobStore, now: r.now, sleep: r.sleep, placeWaitMs: 120_000, pollMs: 2000 }),
    passive: true, instanceId,
  })!;
}

/** What a Workflow does: advance until the job is over or waiting for the person. */
async function runToTheWait(r: Rig, wk: Awaited<ReturnType<typeof workerOf>>, id: string) {
  for (let i = 0; i < 200; i += 1) {
    const x = await wk.advance(id, { holder: `wf-${i}` });
    if (x.next === "end" || (x.next === "wait" && (x.waitingOn === "answer" || x.waitingOn === "approval" || x.waitingOn === "budget"))) return x;
    if (x.next === "wait") await r.sleep(x.waitMs ?? 1000);
  }
  throw new Error("the job did not settle");
}

/** A job made through the VPS's route, run by the Worker's orchestrator to its first wait, and the record of calls cleared. */
async function parkedJob(task: string, script: (r: Rig) => void, body: Record<string, unknown> = {}) {
  const r = await agentRig();
  script(r);
  const w = theWorker();
  const s = await cloudflareServer(r, w);
  const id = (await made(r, s.api, task, body)).json().job.id as string;
  const wk = await workerOf(r);
  const first = await runToTheWait(r, wk, id);
  w.seen.length = 0;
  return { r, w, s, id, wk, first };
}

describe("the person's word", () => {
  it("answer: written to the job, then the Workflow is told; for the owner only", async () => {
    const { r, w, s, id, wk, first } = await parkedJob(UTIL_TASK, (r) => {
      r.json.on("work.plan", UTIL_PLAN);
      r.model.push(call("ask_user", { question: "Which?" }), call("edit_file", UTIL_EDIT), done("ok"));
    });
    expect(first).toMatchObject({ waitingOn: "answer" });
    expect((await s.api("bob", "POST", `/v1/code/jobs/${id}/answer`, { answer: "x" })).statusCode).toBe(404);
    expect((await s.api("alice", "POST", `/v1/code/jobs/${id}/answer`, { answer: "   " })).statusCode).toBe(400);
    expect(w.seen).toEqual([]); // nothing was written, so nobody is told

    const res = await s.api("alice", "POST", `/v1/code/jobs/${id}/answer`, { answer: "this one" });
    expect(res.statusCode).toBe(200);
    expect(res.json().job).toMatchObject({ state: "running", waitingOn: null });
    expect(w.seen).toEqual([{ path: "/v1/event", body: { jobId: id, kind: "answer" } }]);
    expect(await runToTheWait(r, wk, id)).toEqual({ next: "end", why: "finished" });
  });

  it("approve: the question changes nothing and tells nobody; the yes is written, then the Workflow is told", async () => {
    const { r, w, s, id, wk } = await parkedJob(RISKY, (r) => {
      r.json.on("work.plan", UTIL_PLAN);
      r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    });
    const q = (await s.api("alice", "POST", `/v1/code/jobs/${id}/approve`, {})).json() as { approvalId: string; needsApproval: boolean };
    expect(q.needsApproval).toBe(true);
    expect(w.seen).toEqual([]);
    const yes = await s.api("alice", "POST", `/v1/code/jobs/${id}/approve`, { approvalId: q.approvalId });
    expect(yes.json()).toMatchObject({ approved: true });
    expect(w.seen).toEqual([{ path: "/v1/event", body: { jobId: id, kind: "approve" } }]);
    expect(await runToTheWait(r, wk, id)).toEqual({ next: "end", why: "finished" });
  });

  it("stop: the job is cancelled in the database, then the Workflow is told to end", async () => {
    const { r, w, s, id, wk } = await parkedJob(RISKY, (r) => { r.json.on("work.plan", UTIL_PLAN); });
    const stopped = await s.api("alice", "POST", `/v1/code/jobs/${id}/stop`);
    expect(stopped.json().job.state).toBe("cancelled");
    expect(w.seen).toEqual([{ path: "/v1/event", body: { jobId: id, kind: "stop" } }]);
    expect(await wk.advance(id, { holder: "wf-after" })).toEqual({ next: "end", why: "over" });
    expect((await r.jobNow(id)).state).toBe("cancelled");
  });

  it("deny: a plan not approved ends the job, and the Workflow is told", async () => {
    const { s, id, w } = await parkedJob(RISKY, (r) => { r.json.on("work.plan", UTIL_PLAN); });
    expect((await s.api("alice", "POST", `/v1/code/jobs/${id}/deny`)).json().job.state).toBe("cancelled");
    expect(w.seen).toEqual([{ path: "/v1/event", body: { jobId: id, kind: "deny" } }]);
  });

  it("budget: more money is written, then the Workflow is told", async () => {
    const { r, w, s, id, wk, first } = await parkedJob(UTIL_TASK, (r) => {
      r.json.on("work.plan", UTIL_PLAN);
      r.model.push(call("edit_file", UTIL_EDIT), done("ok"));
    }, { budgetPaise: 0 });
    expect(first).toMatchObject({ waitingOn: "budget" });
    const res = await s.api("alice", "POST", `/v1/code/jobs/${id}/budget`, { addPaise: 3000 });
    expect(res.statusCode).toBe(200);
    expect(res.json().job).toMatchObject({ budgetPaise: 3000, state: "running" });
    expect(w.seen).toEqual([{ path: "/v1/event", body: { jobId: id, kind: "budget" } }]);
    expect(await runToTheWait(r, wk, id)).toEqual({ next: "end", why: "finished" });
  });

  it("an event the Worker does not answer is not the person's problem: their word is in the database and the request succeeded", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "Which?" }), call("edit_file", UTIL_EDIT), done("ok"));
    let down = false;
    const w = theWorker(() => (down ? new Response("", { status: 500 }) : Response.json({ ok: true })));
    const s = await cloudflareServer(r, w);
    const id = (await made(r, s.api, UTIL_TASK)).json().job.id as string;
    const wk = await workerOf(r);
    await runToTheWait(r, wk, id);
    down = true;
    w.seen.length = 0;
    const res = await s.api("alice", "POST", `/v1/code/jobs/${id}/answer`, { answer: "this one" });
    expect(res.statusCode).toBe(200);
    expect(w.seen).toHaveLength(3); // tried three times
    expect(await r.jobNow(id)).toMatchObject({ state: "running" });
    expect((await r.stateNow(id)).waiting).toMatchObject({ kind: "question", answer: "this one" });
    // ...and the Worker, when it does look (its cron, or the next event), finds it.
    expect(await runToTheWait(r, wk, id)).toEqual({ next: "end", why: "finished" });
  });
});

describe("the person's word to a job that is working (POST /v1/code/jobs/:id/message)", () => {
  it("is handed to the Worker's room, signed, and written nowhere here: the room keeps it and wakes the Workflow", async () => {
    const { r, w, s, id } = await parkedJob(UTIL_TASK, (r) => {
      r.json.on("work.plan", UTIL_PLAN);
      r.model.push(call("ask_user", { question: "Which?" }), call("edit_file", UTIL_EDIT), done("ok"));
    });
    const res = await s.api("alice", "POST", `/v1/code/jobs/${id}/message`, { text: "  Keep the name slug  " });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ delivered: true });
    expect(w.seen).toEqual([{ path: "/v1/message", body: { jobId: id, text: "Keep the name slug" } }]);
    // nothing of it is in the job's state here: the room has it, and the loop takes it at its next turn
    expect((await r.stateNow(id)).work.said ?? []).toEqual([]);
  });

  it("is the owner's only and words only, checked here before the Worker is troubled", async () => {
    const { s, id, w } = await parkedJob(UTIL_TASK, (r) => {
      r.json.on("work.plan", UTIL_PLAN);
      r.model.push(call("ask_user", { question: "Which?" }), done("ok"));
    });
    expect((await s.api("bob", "POST", `/v1/code/jobs/${id}/message`, { text: "x" })).statusCode).toBe(404);
    expect((await s.api("alice", "POST", `/v1/code/jobs/${id}/message`, { text: "  " })).statusCode).toBe(400);
    expect((await s.api("alice", "POST", `/v1/code/jobs/${id}/message`, {})).statusCode).toBe(400);
    expect(w.seen).toEqual([]);
  });

  it("tells the person it was not sent when the Worker could not be reached, rather than saying it was", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "Which?" }), done("ok"));
    let down = false;
    const w = theWorker(() => (down ? new Response("", { status: 500 }) : Response.json({ ok: true })));
    const s = await cloudflareServer(r, w);
    const id = (await made(r, s.api, UTIL_TASK)).json().job.id as string;
    await runToTheWait(r, await workerOf(r), id);
    down = true;
    w.seen.length = 0;
    const res = await s.api("alice", "POST", `/v1/code/jobs/${id}/message`, { text: "hello" });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "unreachable" });
    expect(w.seen).toHaveLength(3); // tried three times
  });

  it("is refused for a job that is over", async () => {
    const { s, id, w } = await parkedJob(UTIL_TASK, (r) => {
      r.json.on("work.plan", UTIL_PLAN);
      r.model.push(call("ask_user", { question: "Which?" }), done("ok"));
    });
    await s.api("alice", "POST", `/v1/code/jobs/${id}/stop`);
    w.seen.length = 0;
    const res = await s.api("alice", "POST", `/v1/code/jobs/${id}/message`, { text: "hello" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "job_over" });
    expect(w.seen).toEqual([]);
  });
});

describe("a result from a runner", () => {
  it("wakes the job's Workflow, once the router has taken it", async () => {
    const r = await jobsRig.rig({ github: false, paid: false });
    const woken: string[] = [];
    const app = Fastify();
    apps.push(app);
    registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0, onStepResult: (id) => woken.push(id) });
    await app.ready();
    const api = (user: string, url: string, payload: unknown) => app.inject({ method: "POST", url, headers: who(user), payload: payload as object });
    await r.beat(jobsRig.LAPTOP);
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["make"], 60, 1);
    const given = (await r.jobs.next("alice", jobsRig.LAPTOP))!;
    const body = { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "built", minutes: 1 };

    expect((await api("alice", "/v1/code/runner/result", { ...body, epoch: given.epoch + 5 })).statusCode).toBe(409);
    expect((await api("bob", "/v1/code/runner/result", body)).statusCode).toBe(404);
    expect(woken).toEqual([]); // a result that was refused wakes nobody
    expect((await api("alice", "/v1/code/runner/result", body)).statusCode).toBe(200);
    expect(woken).toEqual([job.id]);
  });

  it("is a hook that is optional: the routes are as they were without it", async () => {
    const r = await jobsRig.rig({ github: false, paid: false });
    const app = Fastify();
    apps.push(app);
    registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0 });
    await app.ready();
    await r.beat(jobsRig.LAPTOP);
    const job = await r.job();
    await r.jobs.requestExec(job.id, ["make"], 60, 1);
    const given = (await r.jobs.next("alice", jobsRig.LAPTOP))!;
    const res = await app.inject({ method: "POST", url: "/v1/code/runner/result", headers: who("alice"), payload: { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1 } });
    expect(res.statusCode).toBe(200);
  });
});

describe("no ticker, and local mode as it was", () => {
  it("starts neither the ticker nor the orchestrator's timer when the server says tickEveryMs null (what cloudflare mode does)", async () => {
    const r = await agentRig();
    const w = theWorker();
    const started = vi.spyOn(r.orch, "start");
    const app = Fastify();
    apps.push(app);
    const agent = createAgent({ code: r.code, jobs: r.jobs, store: r.jobStore, brain: r.brain, now: r.now, sleep: r.sleep, remote: w.handoff })!;
    const spy = vi.spyOn(agent, "start");
    const tickSpy = vi.spyOn(r.jobs, "tick");
    registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: r.jobs, agent, tickEveryMs: null });
    await app.ready();
    expect(spy).not.toHaveBeenCalled();
    expect(tickSpy).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
    expect(await agent.tick()).toEqual({ handedBack: 0, started: 0 });
  });

  it("in local mode a job made through the same route is driven here, at once, and nothing is handed over", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const app = Fastify();
    apps.push(app);
    registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: r.jobs, agent: r.orch, tickEveryMs: null, pollMs: 0 });
    await app.ready();
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, UTIL_TASK);
    const res = await app.inject({ method: "POST", url: "/v1/code/jobs", headers: who("alice"), payload: { projectId: r.project.id, branch, task: UTIL_TASK } });
    expect(res.statusCode).toBe(200);
    await r.orch.idle();
    expect((await r.jobNow(res.json().job.id)).state).toBe("done");
    expect(r.model.turns).toBeGreaterThan(0);
  });
});
