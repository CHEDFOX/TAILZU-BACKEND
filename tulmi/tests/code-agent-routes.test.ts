/**
 * THE AGENT'S ROUTES (src/routes/codeJobs.ts, docs/code-agent.md): what the app calls to steer a job the agent is working on,
 * through a real Fastify over the rig (tests/agent-rig.ts). What the orchestrator decides is in code-agent-ask.test.ts and
 * code-agent-resume.test.ts; this holds down the HTTP:
 *
 *   - a server without the agent answers 404 agent_off on the new routes, and every route wants a session;
 *   - POST /v1/code/jobs on a server with the agent: the budget left out is the server's default, an explicit 0 stays 0, the job is
 *     the agent's and is driven at once, and the checkpoint's agent state (a lot of the person's code) never goes out;
 *   - answer, approve (the two steps), deny, budget, stop and log work for the OWNER only: anyone else is told 404 not_found;
 *   - GET /v1/code/jobs/:id says where the agent is.
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

const { agentRig, call, done, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { createWorkBranch } = await import("../src/code/projects.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const SOME = "00000000-0000-4000-8000-000000000000";
const RISKY = "In src/util.ts make slug() trim dashes, before the password reset link is built from it";

const apps: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

async function server(r: Rig, o: { agent?: boolean } = {}) {
  const app = Fastify();
  apps.push(app);
  registerCodeJobRoutes(app, { rateLimit: RL, code: r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0, ...(o.agent === false ? {} : { agent: r.orch }) });
  await app.ready();
  const call = (user: string | null, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, call };
}

const NEW_ROUTES: Array<["GET" | "POST", string]> = [
  ["POST", `/v1/code/jobs/${SOME}/answer`], ["POST", `/v1/code/jobs/${SOME}/approve`], ["POST", `/v1/code/jobs/${SOME}/deny`],
  ["POST", `/v1/code/jobs/${SOME}/budget`], ["POST", `/v1/code/jobs/${SOME}/stop`], ["GET", `/v1/code/jobs/${SOME}/log`],
];

describe("a server", () => {
  it("without the agent answers 404 agent_off on the new routes, to a person with a session", async () => {
    const r = await agentRig();
    const s = await server(r, { agent: false });
    for (const [method, url] of NEW_ROUTES) {
      const res = await s.call("alice", method, url, method === "POST" ? {} : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "agent_off" });
    }
  });

  it("wants a session on every new route", async () => {
    const r = await agentRig();
    const s = await server(r);
    for (const [method, url] of NEW_ROUTES) {
      const res = await s.call(null, method, url, method === "POST" ? {} : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toMatchObject({ code: "unauthorized" });
    }
  });

  it("says not_found for a job that is not there, to everyone", async () => {
    const r = await agentRig();
    const s = await server(r);
    for (const [method, url] of NEW_ROUTES) {
      const res = await s.call("alice", method, url, method === "POST" ? { answer: "x", addPaise: 100 } : undefined);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "not_found" });
    }
  });
});

describe("making a job", () => {
  async function made(r: Rig, s: Awaited<ReturnType<typeof server>>, task: string, body: Record<string, unknown> = {}) {
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, task);
    return s.call("alice", "POST", "/v1/code/jobs", { projectId: r.project.id, branch, task, ...body });
  }

  it("gives it the server's default budget when none is sent, hands it to the agent, and drives it at once", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const s = await server(r);
    const res = await made(r, s, UTIL_TASK);
    expect(res.statusCode).toBe(200);
    const job = res.json().job;
    expect(job).toMatchObject({ budgetPaise: 3000, agent: true, state: expect.stringMatching(/queued|running/) });
    // The state of the agent, which holds the person's code, is not in what goes out.
    expect(job.checkpoint.agent).toBeUndefined();
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");

    const got = await s.call("alice", "GET", `/v1/code/jobs/${job.id}`);
    expect(got.statusCode).toBe(200);
    const body = got.json();
    expect(body.job.checkpoint.agent).toBeUndefined();
    expect(body.agent).toMatchObject({ phase: "done", staged: [], commits: [expect.any(String)], pr: { number: 1, ready: true }, verify: { ran: true, ok: true }, report: { outcome: "done" } });
    expect(body.agent.report.text).toContain("Done: ");
    const list = await s.call("alice", "GET", "/v1/code/jobs");
    expect(list.json().jobs[0].checkpoint.agent).toBeUndefined();
    // Somebody else cannot read it.
    expect((await s.call("bob", "GET", `/v1/code/jobs/${job.id}`)).statusCode).toBe(404);
  });

  it("keeps a budget of 0 sent on purpose: the job makes no model call, and waits for more", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    const s = await server(r);
    const res = await made(r, s, UTIL_TASK, { budgetPaise: 0 });
    expect(res.json().job.budgetPaise).toBe(0);
    await r.orch.idle();
    expect(await r.jobNow(res.json().job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "budget" });
    expect(r.model.turns).toBe(0);
    expect((await made(r, s, "another thing", { budgetPaise: "lots" })).statusCode).toBe(400);
  });
});

describe("answering", () => {
  it("is the owner's only, wants words, and goes on from the question with them", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(
      call("ask_user", { question: "Should the dashes be trimmed from the start too?", options: ["Both ends", "End only"] }),
      call("edit_file", UTIL_EDIT), done("Trimmed."),
    );
    const s = await server(r);
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "answer" });
    const url = `/v1/code/jobs/${job.id}/answer`;

    expect((await s.call("bob", "POST", url, { answer: "Both ends" })).statusCode).toBe(404);
    expect((await s.call("alice", "POST", url, {})).json()).toMatchObject({ code: "bad_request" });
    expect((await s.call("alice", "POST", url, { answer: "   " })).statusCode).toBe(400);
    expect((await s.call("alice", "POST", url, { answer: "x".repeat(4001) })).statusCode).toBe(400);
    expect((await r.jobNow(job.id)).state).toBe("waiting_for_you");

    const ok = await s.call("alice", "POST", url, { answer: "Both ends" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().job).toMatchObject({ id: job.id, state: "running", waitingOn: null });
    expect(ok.json().job.checkpoint.agent).toBeUndefined();
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    // Asked again, with nothing waiting: not_waiting.
    const again = await s.call("alice", "POST", url, { answer: "Both ends" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "not_waiting" });
  });
});

describe("approving and denying", () => {
  async function waitingForPlan(r: Rig) {
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job, branch } = await r.start(RISKY);
    await r.orch.idle();
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "approval" });
    return { job, branch };
  }

  it("is a question and then a yes: the first call changes nothing, the second says yes with the id the first gave", async () => {
    const r = await agentRig();
    const s = await server(r);
    const { job, branch } = await waitingForPlan(r);
    const url = `/v1/code/jobs/${job.id}/approve`;

    const q = await s.call("alice", "POST", url, {});
    expect(q.statusCode).toBe(200);
    expect(q.json()).toMatchObject({ needsApproval: true, action: "job.plan", approvalId: expect.any(String), faceId: false });
    expect((await r.jobNow(job.id)).state).toBe("waiting_for_you");
    const id = q.json().approvalId as string;

    expect((await s.call("bob", "POST", url, { approvalId: id })).statusCode).toBe(404);
    const wrong = await s.call("alice", "POST", url, { approvalId: "nope" });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toMatchObject({ code: "approval_invalid" });
    expect((await s.call("alice", "POST", url, { approvalId: 5 })).statusCode).toBe(400);

    // The id may also come in the address, as the other yeses allow.
    const yes = await s.call("alice", "POST", `${url}?approvalId=${encodeURIComponent(id)}`, {});
    expect(yes.statusCode).toBe(200);
    expect(yes.json()).toMatchObject({ approved: true, job: { id: job.id, state: "running" } });
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
  });

  it("is refused for everyone but the owner, and deny stops the job with nothing changed", async () => {
    const r = await agentRig();
    const s = await server(r);
    const { job } = await waitingForPlan(r);
    expect((await s.call("bob", "POST", `/v1/code/jobs/${job.id}/deny`, {})).statusCode).toBe(404);
    const no = await s.call("alice", "POST", `/v1/code/jobs/${job.id}/deny`, {});
    expect(no.statusCode).toBe(200);
    expect(no.json().job).toMatchObject({ state: "cancelled", reason: "You didn't approve the plan, so nothing was changed." });
    expect(r.fake.commitCount(r.repo)).toBe(1);
    expect((await s.call("alice", "POST", `/v1/code/jobs/${job.id}/deny`, {})).json()).toMatchObject({ code: "not_waiting" });
    expect((await s.call("alice", "POST", `/v1/code/jobs/${job.id}/approve`, {})).json()).toMatchObject({ code: "not_waiting" });
  });
});

describe("the budget, stopping, and the log", () => {
  it("adds to the budget (whole paise, the owner's job), and a job that stopped for the money goes on", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const s = await server(r);
    const { job } = await r.start(UTIL_TASK, { budgetPaise: 0 });
    await r.orch.idle();
    const url = `/v1/code/jobs/${job.id}/budget`;
    expect((await s.call("bob", "POST", url, { addPaise: 1000 })).statusCode).toBe(404);
    for (const bad of [{}, { addPaise: 0 }, { addPaise: -5 }, { addPaise: 1.5 }, { addPaise: "100" }]) {
      const res = await s.call("alice", "POST", url, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json()).toMatchObject({ code: "bad_request" });
    }
    const ok = await s.call("alice", "POST", url, { addPaise: 3000 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().job).toMatchObject({ budgetPaise: 3000 });
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    // A job that is over takes no more.
    const over = await s.call("alice", "POST", url, { addPaise: 100 });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ code: "job_over" });
  });

  it("stops a job that is waiting, for its owner only", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    const s = await server(r);
    const { job } = await r.start(RISKY);
    await r.orch.idle();
    const url = `/v1/code/jobs/${job.id}/stop`;
    expect((await s.call("bob", "POST", url, {})).statusCode).toBe(404);
    expect((await r.jobNow(job.id)).state).toBe("waiting_for_you");
    const res = await s.call("alice", "POST", url, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().job).toMatchObject({ state: "cancelled" });
    expect(res.json().job.checkpoint.agent).toBeUndefined();
    expect(r.model.turns).toBe(0);
  });

  it("stops a job whose loop is running: the loop ends, nothing more is written, nothing is committed", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    let open!: () => void;
    const gate = new Promise<void>((res) => { open = res; });
    let inside!: () => void;
    const reached = new Promise<void>((res) => { inside = res; });
    r.model.beforeTurn = async () => { inside(); await gate; };
    const s = await server(r);
    const { job } = await r.start(UTIL_TASK);
    await reached;
    expect(r.orch.running).toBe(1);
    const res = await s.call("alice", "POST", `/v1/code/jobs/${job.id}/stop`, {});
    expect(res.json().job).toMatchObject({ state: "cancelled" });
    open();
    await r.orch.idle();
    expect(await r.jobNow(job.id)).toMatchObject({ state: "cancelled" });
    expect(r.fake.commitCount(r.repo)).toBe(1);
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
  });

  it("gives the work log in order, to the owner only", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("read_file", { path: "src/util.ts" }), call("edit_file", UTIL_EDIT), done("Trimmed."));
    const s = await server(r);
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    const url = `/v1/code/jobs/${job.id}/log`;
    expect((await s.call("bob", "GET", url)).statusCode).toBe(404);
    const res = await s.call("alice", "GET", url);
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as Array<{ seq: number; kind: string; text: string }>;
    expect(entries.map((e) => e.seq)).toEqual([...entries.map((e) => e.seq)].sort((a, b) => a - b));
    expect(entries.map((e) => e.kind)).toEqual(expect.arrayContaining(["note", "decision", "read", "edit", "command", "step"]));
    expect(entries.find((e) => e.kind === "edit")!.text).toBe("Edited src/util.ts.");
    expect(entries.at(-1)!.text).toMatch(/ready for review/);
  });
});
