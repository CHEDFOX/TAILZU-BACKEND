/**
 * POST /v1/internal/code/notify (src/routes/codeInternal.ts): the Worker's way to the push engine. The signature is the one the
 * VPS makes (jobs-handoff-sign.test.ts), so the cases here are the route's own: who is told, which jobs, which kinds, and that
 * the route is not there unless jobs run on Cloudflare.
 */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { NOTIFY_PATH } from "../src/code/jobs/handoff/protocol.js";
import { MemoryNonceStore, SIGNATURE_WINDOW_MS, signRequest } from "../src/code/jobs/handoff/sign.js";
import { MemoryJobStore } from "../src/code/jobs/store.js";
import type { NotifyData, NotifyKind } from "../src/code/jobs/types.js";
import { registerCodeInternalRoutes } from "../src/routes/codeInternal.js";

const SECRET = "n".repeat(40);
let clock = 1_800_000_000_000;

async function setup(over: { secret?: string | null } = {}) {
  const store = new MemoryJobStore(() => clock);
  const told: Array<{ userId: string; kind: NotifyKind; data: NotifyData }> = [];
  // The server's own JSON parser (server.ts): it parses, and keeps no raw body for this route; the route does that itself.
  const app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => {
    const raw = typeof body === "string" ? body.trim() : "";
    if (raw === "") return done(null, {});
    try { done(null, JSON.parse(raw)); } catch (err) { (err as { statusCode?: number }).statusCode = 400; done(err as Error, undefined); }
  });
  registerCodeInternalRoutes(app, {
    rateLimit: { rateLimit: { max: 1000, timeWindow: 1000 } }, secret: over.secret === undefined ? SECRET : over.secret, store,
    notify: async (userId, kind, data) => { told.push({ userId, kind, data }); }, nonces: new MemoryNonceStore(() => clock), now: () => clock,
  });
  await app.ready();
  const mine = await store.createJob({ userId: "alice", projectId: "p-1", branch: "tailzu/x", task: "Fix the login bug\nand then the logout one", budgetPaise: 3000, agent: true });
  const plain = await store.createJob({ userId: "bob", projectId: "p-2", branch: "tailzu/y", task: "Not an agent's", budgetPaise: 3000 });
  const post = async (payload: object | string, o: { secret?: string; now?: number; nonce?: string; headers?: Record<string, string> } = {}) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const signed = signRequest({ secret: o.secret ?? SECRET, method: "POST", path: NOTIFY_PATH, body, now: o.now ?? clock, ...(o.nonce ? { nonce: o.nonce } : {}) });
    const res = await app.inject({ method: "POST", url: NOTIFY_PATH, payload: body, headers: { "content-type": "application/json", ...signed, ...(o.headers ?? {}) } });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  };
  return { app, store, told, mine, plain, post };
}

describe("the signature", () => {
  it("lets a signed call through and tells the push engine", async () => {
    const s = await setup();
    const r = await s.post({ jobId: s.mine.id, kind: "needs_you", text: "Which file is the login form?", at: clock - 5_000 });
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(s.told).toHaveLength(1);
    expect(s.told[0]).toMatchObject({ userId: "alice", kind: "needs_you" });
    expect(s.told[0]!.data).toMatchObject({ jobId: s.mine.id, projectId: "p-1", task: "Fix the login bug", at: clock - 5_000, reason: "Which file is the login form?" });
  });

  it("refuses a wrong secret, no signature, an expired one and a replay, and tells nobody", async () => {
    const s = await setup();
    const ok = { jobId: s.mine.id, kind: "job_done", text: "Done" };
    expect((await s.post(ok, { secret: "x".repeat(40) })).json.code).toBe("bad_signature");
    const bare = await s.app.inject({ method: "POST", url: NOTIFY_PATH, payload: JSON.stringify(ok), headers: { "content-type": "application/json" } });
    expect(bare.statusCode).toBe(401);
    const old = await s.post(ok, { now: clock - SIGNATURE_WINDOW_MS - 1_000 });
    expect(old).toMatchObject({ status: 401, json: { code: "expired" } });
    expect((await s.post(ok, { nonce: "once-0123456789abcdef" })).status).toBe(200);
    expect(await s.post(ok, { nonce: "once-0123456789abcdef" })).toMatchObject({ status: 401, json: { code: "replayed" } });
    expect(s.told).toHaveLength(1); // only the one that was signed and new
  });

  it("checks the exact bytes: a body changed after it was signed is refused", async () => {
    const s = await setup();
    const body = JSON.stringify({ jobId: s.mine.id, kind: "job_done", text: "Done" });
    const signed = signRequest({ secret: SECRET, method: "POST", path: NOTIFY_PATH, body, now: clock });
    const res = await s.app.inject({ method: "POST", url: NOTIFY_PATH, payload: body.replace("Done", "Gone"), headers: { "content-type": "application/json", ...signed } });
    expect(res.statusCode).toBe(401);
    expect(s.told).toHaveLength(0);
  });

  it("is not there at all unless jobs run on Cloudflare: no secret, no route", async () => {
    const s = await setup({ secret: null });
    expect((await s.post({ jobId: s.mine.id, kind: "job_done", text: "" })).status).toBe(404);
    expect(s.told).toHaveLength(0);
  });
});

describe("who is told, and about what", () => {
  it("tells the job's owner, whatever the body says about people", async () => {
    const s = await setup();
    await s.post({ jobId: s.mine.id, kind: "job_failed", text: "It broke", userId: "bob", user_id: "bob", to: "bob" });
    expect(s.told).toHaveLength(1);
    expect(s.told[0]!.userId).toBe("alice");
  });

  it("answers 404 for a job that does not exist, and 403 for one the Worker does not run", async () => {
    const s = await setup();
    expect(await s.post({ jobId: "00000000-0000-4000-8000-0000000000ff", kind: "job_done", text: "" })).toMatchObject({ status: 404, json: { code: "not_found" } });
    expect(await s.post({ jobId: s.plain.id, kind: "job_done", text: "" })).toMatchObject({ status: 403, json: { code: "not_an_agent_job" } });
    expect(s.told).toHaveLength(0);
  });

  it("takes the seven kinds the router knows and nothing else", async () => {
    const s = await setup();
    const kinds: NotifyKind[] = ["compute_ask", "compute_paused", "commit_ask", "job_moved", "job_done", "job_failed", "needs_you"];
    for (const kind of kinds) expect((await s.post({ jobId: s.mine.id, kind, text: "" })).status).toBe(200);
    expect(s.told.map((t) => t.kind)).toEqual(kinds);
    for (const kind of ["admin", "needs_you ", "", 5, null]) expect((await s.post({ jobId: s.mine.id, kind, text: "" })).status).toBe(400);
  });

  it("refuses a body that is not about a job", async () => {
    const s = await setup();
    for (const bad of [{}, { kind: "job_done" }, { jobId: "not-an-id", kind: "job_done" }, "not json", "[]", "null"]) {
      expect((await s.post(bad as object)).status).toBe(400);
    }
    expect(s.told).toHaveLength(0);
  });

  it("cuts the words to 300 characters, one line, and takes the extras only in the shapes it knows", async () => {
    const s = await setup();
    await s.post({ jobId: s.mine.id, kind: "job_moved", text: `${"x".repeat(400)}\nsecond line`, to: "github", estimatePaise: 450 });
    expect(s.told[0]!.data.reason!.length).toBeLessThanOrEqual(300);
    expect(s.told[0]!.data.reason).not.toContain("\n");
    expect(s.told[0]!.data).toMatchObject({ to: "github", estimatePaise: 450 });
    await s.post({ jobId: s.mine.id, kind: "job_moved", text: "", to: "the moon", estimatePaise: -5 });
    expect(s.told[1]!.data.to).toBeUndefined();
    expect(s.told[1]!.data.estimatePaise).toBeUndefined();
  });

  it("names a push once: the event time is taken from the Worker if it is believable, else now", async () => {
    const s = await setup();
    await s.post({ jobId: s.mine.id, kind: "needs_you", text: "", at: clock - 1_000 });
    await s.post({ jobId: s.mine.id, kind: "needs_you", text: "", at: clock - 3 * 24 * 60 * 60_000 });
    await s.post({ jobId: s.mine.id, kind: "needs_you", text: "" });
    expect(s.told.map((t) => t.data.at)).toEqual([clock - 1_000, clock, clock]);
  });
});
