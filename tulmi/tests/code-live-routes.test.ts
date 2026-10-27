/**
 * THE LIVE SESSION'S ROUTES ON THE VPS (src/routes/codeJobs.ts): the pass for a PC's presence socket (POST /v1/code/runner/ticket), the pass for
 * the app watching a job (POST /v1/code/jobs/:id/live), and the person's word to a working job (POST /v1/code/jobs/:id/message). The passes are signed
 * tickets for the Worker (code/live/tickets.ts), short-lived and one-time; the Worker's own checks of them are in jobs/test.
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
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { readTicket } = await import("../src/code/live/tickets.js");
const { DEVICE_TICKET_TTL_MS, VIEWER_TICKET_TTL_MS, SAID_MAX_CHARS } = await import("../src/code/live/limits.js");
const { createWorkBranch } = await import("../src/code/projects.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const SOME = "00000000-0000-4000-8000-000000000000";
/** The secret both sides share, made at run time. */
const SECRET = ["live", "routes", "shared", "z".repeat(40)].join("-");
const DEVICE = "laptop-0001";

const apps: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

async function server(r: Rig, o: { live?: { jobsUrl: string; secret: string; now?: () => number } | null; agent?: boolean; code?: boolean; jobs?: boolean } = {}) {
  const app = Fastify();
  apps.push(app);
  registerCodeJobRoutes(app, {
    rateLimit: RL, code: o.code === false ? null : r.code, jobs: o.jobs === false ? null : r.jobs, tickEveryMs: null, pollMs: 0,
    ...(o.agent === false ? {} : { agent: r.orch }), ...(o.live === null ? {} : { live: o.live ?? { jobsUrl: "https://jobs.example", secret: SECRET, now: r.now } }),
  });
  await app.ready();
  const send = (user: string | null, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, send };
}

/** A job of alice's that is waiting for her (so it stays open). */
async function parkedJob(r: Rig) {
  r.json.on("work.plan", UTIL_PLAN);
  r.model.push(call("ask_user", { question: "Which?" }), call("edit_file", UTIL_EDIT), done("ok"));
  const { job } = await r.start(UTIL_TASK);
  await r.orch.idle();
  return job;
}

describe("the passes are off unless the jobs run on the Worker", () => {
  it("answers 404 live_off to both ticket routes when the live session is not set up, after checking who is asking", async () => {
    const r = await agentRig();
    const s = await server(r, { live: null });
    for (const url of ["/v1/code/runner/ticket", `/v1/code/jobs/${SOME}/live`]) {
      expect((await s.send(null, "POST", url, { deviceId: DEVICE })).statusCode, url).toBe(401);
      const res = await s.send("alice", "POST", url, { deviceId: DEVICE });
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toMatchObject({ code: "live_off" });
    }
  });

  it("answers 404 code_off and 503 not_configured like every other route, before anything else", async () => {
    const r = await agentRig();
    const off = await server(r, { code: false, jobs: false });
    const unset = await server(r, { jobs: false });
    for (const [method, url] of [["POST", "/v1/code/runner/ticket"], ["POST", `/v1/code/jobs/${SOME}/live`], ["POST", `/v1/code/jobs/${SOME}/message`]] as const) {
      expect((await off.send("alice", method, url, {})).json(), url).toMatchObject({ code: "code_off" });
      expect((await unset.send("alice", method, url, {})).statusCode, url).toBe(503);
    }
  });
});

describe("POST /v1/code/runner/ticket", () => {
  it("gives a signed device pass for the person's own computer, good for two minutes, with the Worker's address", async () => {
    const r = await agentRig();
    const s = await server(r);
    const res = await s.send("alice", "POST", "/v1/code/runner/ticket", { deviceId: DEVICE });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string; ticket: string; expiresAt: number };
    expect(body.url).toBe("wss://jobs.example/v1/devices/connect");
    expect(body.expiresAt).toBe(r.now() + DEVICE_TICKET_TTL_MS);
    expect(DEVICE_TICKET_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
    const read = readTicket(SECRET, body.ticket, "device", r.now());
    expect(read.ok && read.claims).toMatchObject({ k: "device", u: "alice", d: DEVICE, x: body.expiresAt });
    // for the device kind only, and not past its time, and not with another secret
    expect(readTicket(SECRET, body.ticket, "viewer", r.now())).toMatchObject({ ok: false, reason: "wrong_kind" });
    expect(readTicket(SECRET, body.ticket, "device", r.now() + DEVICE_TICKET_TTL_MS + 1)).toMatchObject({ ok: false, reason: "expired" });
    expect(readTicket(SECRET + "x", body.ticket, "device", r.now())).toMatchObject({ ok: false });
    expect(res.body).not.toContain(SECRET);
  });

  it("makes every pass one of a kind, so a pass seen once is no use again", async () => {
    const r = await agentRig();
    const s = await server(r);
    const a = (await s.send("alice", "POST", "/v1/code/runner/ticket", { deviceId: DEVICE })).json() as { ticket: string };
    const b = (await s.send("alice", "POST", "/v1/code/runner/ticket", { deviceId: DEVICE })).json() as { ticket: string };
    const ra = readTicket(SECRET, a.ticket, "device", r.now());
    const rb = readTicket(SECRET, b.ticket, "device", r.now());
    expect(a.ticket).not.toBe(b.ticket);
    expect(ra.ok && rb.ok && ra.claims.n).not.toBe(ra.ok && rb.ok && rb.claims.n);
  });

  it("is for the person who asks: the pass names them, whatever the body says", async () => {
    const r = await agentRig();
    const s = await server(r);
    const res = await s.send("bob", "POST", "/v1/code/runner/ticket", { deviceId: DEVICE, userId: "alice", user: "alice", u: "alice" });
    const read = readTicket(SECRET, (res.json() as { ticket: string }).ticket, "device", r.now());
    expect(read.ok && read.claims.u).toBe("bob");
  });

  it("wants the computer's id, of a sane shape", async () => {
    const r = await agentRig();
    const s = await server(r);
    for (const body of [{}, { deviceId: 5 }, { deviceId: "short" }, { deviceId: "has spaces in it" }, { deviceId: "x".repeat(101) }, { deviceId: "../../etc/passwd" }, []]) {
      const res = await s.send("alice", "POST", "/v1/code/runner/ticket", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code: "bad_request" });
    }
  });

  it("makes the address from the Worker's, whatever way it was written: http becomes ws, https wss, a trailing slash goes", async () => {
    const r = await agentRig();
    for (const [jobsUrl, want] of [["https://jobs.example/", "wss://jobs.example"], ["http://127.0.0.1:8787", "ws://127.0.0.1:8787"], ["  https://jobs.example//  ", "wss://jobs.example"]] as const) {
      const s = await server(r, { live: { jobsUrl, secret: SECRET, now: r.now } });
      const res = await s.send("alice", "POST", "/v1/code/runner/ticket", { deviceId: DEVICE });
      expect((res.json() as { url: string }).url).toBe(`${want}/v1/devices/connect`);
    }
  });
});

describe("POST /v1/code/jobs/:id/live", () => {
  it("gives the owner a signed viewer pass for this job's room, good for two minutes", async () => {
    const r = await agentRig();
    const job = await parkedJob(r);
    const s = await server(r);
    const res = await s.send("alice", "POST", `/v1/code/jobs/${job.id}/live`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string; ticket: string; expiresAt: number };
    expect(body.url).toBe(`wss://jobs.example/v1/rooms/${job.id}/watch`);
    expect(body.expiresAt).toBe(r.now() + VIEWER_TICKET_TTL_MS);
    const read = readTicket(SECRET, body.ticket, "viewer", r.now());
    expect(read.ok && read.claims).toMatchObject({ k: "viewer", u: "alice", j: job.id });
    expect(readTicket(SECRET, body.ticket, "runner", r.now())).toMatchObject({ ok: false, reason: "wrong_kind" });
  });

  it("is the owner's only: another person, or a job that is not there, is a 404 and no pass", async () => {
    const r = await agentRig();
    const job = await parkedJob(r);
    const s = await server(r);
    for (const [user, id] of [["bob", job.id], ["alice", SOME], ["alice", "not-an-id"]] as const) {
      const res = await s.send(user, "POST", `/v1/code/jobs/${id}/live`);
      expect(res.statusCode, `${user} ${id}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "not_found" });
      expect(res.body).not.toContain("ticket");
    }
  });
});

describe("POST /v1/code/jobs/:id/message", () => {
  it("puts the person's words in front of the job's next model turn, and says it was delivered", async () => {
    const r = await agentRig();
    const job = await parkedJob(r);
    const s = await server(r);
    const res = await s.send("alice", "POST", `/v1/code/jobs/${job.id}/message`, { text: "  Trim both ends please  " });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ delivered: true });
    await r.orch.answer("alice", job.id, "Yes");
    await r.orch.idle();
    expect(r.model.seen.at(-1)!.messages).toContain("Trim both ends please");
    expect((await r.stateNow(job.id)).work.said?.[0]?.text).toBe("Trim both ends please");
  });

  it("is the owner's only, wants words of a size that is allowed, and is not for a job that is over", async () => {
    const r = await agentRig();
    const job = await parkedJob(r);
    const s = await server(r);
    const url = `/v1/code/jobs/${job.id}/message`;
    expect((await s.send(null, "POST", url, { text: "hi" })).statusCode).toBe(401);
    expect((await s.send("bob", "POST", url, { text: "hi" })).json()).toMatchObject({ code: "not_found" });
    for (const body of [{}, { text: "" }, { text: "   " }, { text: 5 }, { text: "x".repeat(SAID_MAX_CHARS + 1) }, []]) {
      const res = await s.send("alice", "POST", url, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.json()).toMatchObject({ code: "bad_request" });
    }
    await r.orch.stopJob("alice", job.id);
    const over = await s.send("alice", "POST", url, { text: "hi" });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ code: "job_over" });
  });

  it("answers 404 agent_off where the agent is not switched on, and 404 live_off where no inbox is", async () => {
    const r = await agentRig();
    const job = await parkedJob(r);
    const noAgent = await server(r, { agent: false });
    expect((await noAgent.send("alice", "POST", `/v1/code/jobs/${job.id}/message`, { text: "hi" })).json()).toMatchObject({ code: "agent_off" });
    const bare = await agentRig({ live: { progress: () => undefined } });
    const { branch } = await createWorkBranch(bare.d, "alice", bare.project.id, "a task");
    const made = await bare.jobs.createJob("alice", bare.project.id, branch, "a task", undefined, { agent: true });
    const s = await server(bare);
    const res = await s.send("alice", "POST", `/v1/code/jobs/${made.id}/message`, { text: "hi" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "live_off" });
  });
});
