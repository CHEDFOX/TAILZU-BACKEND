/**
 * THE GUARDS ON THE ROUTES THAT SPEND MONEY (src/routes/guarded.ts): artifact make and edit, job create, and the code doors that ask a model.
 *
 * What these hold down:
 *   - no room is a 429 with Retry-After and the place in the queue (the same words on every route), and nothing is made or asked;
 *   - a request that is wrong from the body alone is a 400 and never takes a permit;
 *   - a double tap is one artifact and one job, the second shown the first's answer; the same Idempotency-Key for another request is a 409;
 *   - a route whose answer depends on what the server holds (an edit, "build it", the next step of an intake) joins a run that is out but does
 *     not replay a finished one, unless the client sent a key: "make it bigger" twice is two edits;
 *   - the permit comes back however the work ends, and an answer that was an error is not replayed;
 *   - each route is guarded by its own lane's limits (a person's one free permit is shared by their requests, not by two people's).
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
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

const { Guard } = await import("../src/guard/index.js");
const { registerArtifactRoutes } = await import("../src/routes/artifacts.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { registerCodeRoutes } = await import("../src/routes/code.js");
const { rig: artifactRig, idOf } = await import("./artifacts-rig.js");
const { rig: jobsRig } = await import("./jobs-rig.js");
const { projectRig, built } = await import("./project-rig.js");
type Sent = import("./artifacts-rig.js").Sent;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const PAGE = `<main>\n  <h1>Poll</h1>\n  <button id="vote">Vote</button>\n</main>\n`;
/** A guard with one permit and no queue: the second request in finds no room. */
const tight = () => new Guard({ limiter: { global: 1, perUser: 1, perUserFree: 1, queueMax: 0, queuePerUser: 0 } });

const expectBusy = (res: { statusCode: number; headers: Record<string, unknown>; json(): unknown }) => {
  expect(res.statusCode).toBe(429);
  expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  expect(res.json()).toMatchObject({ code: "overloaded", position: expect.any(Number), retryAfterSec: expect.any(Number), message: expect.any(String) });
};

// ------------------------------------------------------------------ artifacts

describe("artifact make and edit", () => {
  const generate = (s: Sent) => (s.purpose === "classify"
    ? { json: { type: "feature", difficulty: "low", risk: "low", needs: { web: false, exec: false, vision: false, indic: false }, language: "en", confidence: 0.9, signals: [] } }
    : s.purpose === "artifact.edit" ? "<edit><old>Vote</old><new>Vote now</new></edit>" : "<h1>A clock</h1>");

  async function served(guard = new Guard()) {
    const r = artifactRig(generate, { paise: 3 });
    const app = Fastify();
    registerArtifactRoutes(app, { guard, rateLimit: RL, artifacts: { service: r.service } });
    await app.ready();
    const call = (user: string | null, url: string, payload: unknown, headers: Record<string, string> = {}) =>
      app.inject({ method: "POST", url, headers: { ...(user ? who(user) : {}), ...headers }, payload: payload as object });
    return { r, app, guard, call };
  }

  it("turn away a making when there is no room, with the place in the queue, and ask no model", async () => {
    const guard = tight();
    const t = await served(guard);
    const held = await guard.limiter.acquire("bob", "paid");
    const res = await t.call("alice", "/v1/artifacts", { type: "html", prompt: "Make a clock that shows the time" });
    expectBusy(res);
    expect(t.r.model.sent).toHaveLength(0);
    held.release();
    expect((await t.call("alice", "/v1/artifacts", { type: "html", prompt: "Make a clock that shows the time" })).statusCode).toBe(201);
  });

  it("turn away an edit the same way, and the artifact is as it was", async () => {
    const guard = tight();
    const t = await served(guard);
    const id = (await t.call("alice", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).json().artifact.id;
    const held = await guard.limiter.acquire("bob", "paid");
    expectBusy(await t.call("alice", `/v1/artifacts/${id}/edit`, { instruction: "Say Vote now on the button" }));
    expect(t.r.model.of("artifact.edit")).toHaveLength(0);
    held.release();
    expect((await t.call("alice", `/v1/artifacts/${id}/edit`, { instruction: "Say Vote now on the button" })).json()).toMatchObject({ version: 2 });
  });

  it("send a body that is wrong as 400 without taking the permit", async () => {
    const guard = tight();
    const t = await served(guard);
    const held = await guard.limiter.acquire("bob", "paid");
    // the body is checked first: even with no room, a request that could never run is told so
    expect((await t.call("alice", "/v1/artifacts", { type: "word", prompt: "x is a clock" })).statusCode).toBe(400);
    const id = "99999999-9999-4999-8999-999999999999";
    expect((await t.call("alice", `/v1/artifacts/${id}/edit`, { instruction: "" })).statusCode).toBe(400);
    expect(guard.limiter.stats().rejected).toBe(0);
    held.release();
  });

  it("make one artifact for a double tap, the second shown the first, and not another person's", async () => {
    const t = await served();
    const body = { type: "html", prompt: "Make a clock that shows the time" };
    const [a, b] = await Promise.all([t.call("alice", "/v1/artifacts", body), t.call("alice", "/v1/artifacts", body)]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json().artifact.id).toBe(a.json().artifact.id);
    expect([a.headers["idempotent-replayed"], b.headers["idempotent-replayed"]]).toContain("true");
    expect(t.r.model.of("artifact.generate")).toHaveLength(1);
    const again = await t.call("alice", "/v1/artifacts", body);
    expect(again.json().artifact.id).toBe(a.json().artifact.id);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    const bobs = await t.call("bob", "/v1/artifacts", body);
    expect(bobs.json().artifact.id).not.toBe(a.json().artifact.id);
    expect(t.r.model.of("artifact.generate")).toHaveLength(2);
    // one artifact each
    expect(await t.r.store.list("alice")).toHaveLength(1);
  });

  it("make one artifact of a double tap of a pasted one too, and a different one is its own", async () => {
    const t = await served();
    const mine = { type: "html", title: "P", content: PAGE };
    const a = await t.call("alice", "/v1/artifacts", mine);
    const b = await t.call("alice", "/v1/artifacts", mine);
    expect(b.json().artifact.id).toBe(a.json().artifact.id);
    const c = await t.call("alice", "/v1/artifacts", { ...mine, title: "Q" });
    expect(c.json().artifact.id).not.toBe(a.json().artifact.id);
  });

  it("do not replay a request that was refused: it is run again", async () => {
    const t = await served();
    const bad = { type: "react", title: "x", content: `import x from "lodash"; export default () => null;` };
    expect((await t.call("alice", "/v1/artifacts", bad)).statusCode).toBe(422);
    const again = await t.call("alice", "/v1/artifacts", bad);
    expect(again.statusCode).toBe(422);
    expect(again.headers["idempotent-replayed"]).toBeUndefined();
    expect(t.guard.idempotency.stats().entries).toBe(0);
  });

  it("let an edit be said twice: the second runs, because the artifact moved on, unless the client's key says it is the same tap", async () => {
    const t = await served();
    const id = (await t.call("alice", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).json().artifact.id;
    const say = { instruction: "Say Vote now on the button" };
    expect((await t.call("alice", `/v1/artifacts/${id}/edit`, say)).json()).toMatchObject({ version: 2 });
    const second = await t.call("alice", `/v1/artifacts/${id}/edit`, say);
    expect(second.json()).toMatchObject({ version: 3 });
    expect(second.headers["idempotent-replayed"]).toBeUndefined();
    expect(t.r.model.of("artifact.edit")).toHaveLength(2);
    // with a key, a retry is the same request and is shown the answer it had
    const key = { "idempotency-key": "edit-1" };
    expect((await t.call("alice", `/v1/artifacts/${id}/edit`, { instruction: "Add a bang", elementId: idOf(PAGE, "<h1>") }, key)).json()).toMatchObject({ version: 4 });
    const retry = await t.call("alice", `/v1/artifacts/${id}/edit`, { instruction: "Add a bang", elementId: idOf(PAGE, "<h1>") }, key);
    expect(retry.json()).toMatchObject({ version: 4 });
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect((await t.call("alice", `/v1/artifacts/${id}/edit`, { instruction: "Something else" }, key)).statusCode).toBe(409);
  });

  it("give the permit back however the work ends", async () => {
    const guard = tight();
    const t = await served(guard);
    expect((await t.call("alice", "/v1/artifacts/99999999-9999-4999-8999-999999999999/edit", { instruction: "Say Vote now" })).statusCode).toBe(404);
    expect(guard.limiter.stats().active).toBe(0);
    expect((await t.call("alice", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).statusCode).toBe(201);
    expect(guard.limiter.stats().active).toBe(0);
  });
});

// ------------------------------------------------------------------ jobs

describe("job create", () => {
  async function served(guard = new Guard()) {
    const r = await jobsRig();
    const app = Fastify();
    registerCodeJobRoutes(app, { guard, rateLimit: RL, code: r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0 });
    await app.ready();
    const call = (user: string, method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
      app.inject({ method, url, headers: { ...who(user), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { r, app, guard, call, body: (over: object = {}) => ({ projectId: r.project.id, branch: r.branch, task: "make the build pass", ...over }) };
  }

  it("makes one job for a double tap, with or without a key, and another for another task", async () => {
    const t = await served();
    const [a, b] = await Promise.all([t.call("alice", "POST", "/v1/code/jobs", t.body()), t.call("alice", "POST", "/v1/code/jobs", t.body())]);
    expect(a.statusCode).toBe(200);
    expect(b.json().job.id).toBe(a.json().job.id);
    expect((await t.call("alice", "GET", "/v1/code/jobs")).json().jobs).toHaveLength(1);
    const keyed = { "idempotency-key": "tap-9" };
    const k1 = await t.call("alice", "POST", "/v1/code/jobs", t.body({ task: "another task" }), keyed);
    const k2 = await t.call("alice", "POST", "/v1/code/jobs", t.body({ task: "another task" }), keyed);
    expect(k2.json().job.id).toBe(k1.json().job.id);
    expect(k2.headers["idempotent-replayed"]).toBe("true");
    expect((await t.call("alice", "POST", "/v1/code/jobs", t.body({ task: "yet another" }), keyed)).statusCode).toBe(409);
    expect((await t.call("alice", "GET", "/v1/code/jobs")).json().jobs).toHaveLength(2);
  });

  it("turns away a job when there is no room, makes none, and takes no permit for a bad body", async () => {
    const guard = tight();
    const t = await served(guard);
    const held = await guard.limiter.acquire("bob", "paid");
    expect((await t.call("alice", "POST", "/v1/code/jobs", { projectId: t.r.project.id, branch: t.r.branch })).statusCode).toBe(400);
    expectBusy(await t.call("alice", "POST", "/v1/code/jobs", t.body()));
    expect((await t.call("alice", "GET", "/v1/code/jobs")).json().jobs).toEqual([]);
    held.release();
    expect((await t.call("alice", "POST", "/v1/code/jobs", t.body())).statusCode).toBe(200);
  });

  it("does not replay a refusal: a job for someone else's project is a 404 every time", async () => {
    const t = await served();
    expect((await t.call("bob", "POST", "/v1/code/jobs", t.body())).statusCode).toBe(404);
    const again = await t.call("bob", "POST", "/v1/code/jobs", t.body());
    expect(again.statusCode).toBe(404);
    expect(again.headers["idempotent-replayed"]).toBeUndefined();
  });
});

// ------------------------------------------------------------------ the code doors

describe("the code doors that ask a model", () => {
  async function served(guard = new Guard()) {
    const r = await projectRig();
    await built(r);
    const app = Fastify();
    registerCodeRoutes(app, { guard, rateLimit: RL, code: r.code });
    await app.ready();
    const post = (user: string, door: string, payload: unknown, headers: Record<string, string> = {}) =>
      app.inject({ method: "POST", url: `/v1/code/projects/${r.projectId}/${door}`, headers: { ...who(user), ...headers }, payload: payload as object });
    return { r, app, guard, post };
  }
  const LOCATE = { task: "fix the label on the signup button" };

  it("turn away locate, resources and intake when there is no room, with the same words", async () => {
    const guard = tight();
    const t = await served(guard);
    const held = await guard.limiter.acquire("bob", "paid");
    expectBusy(await t.post("alice", "locate", LOCATE));
    expectBusy(await t.post("alice", "resources", { need: "schema validation" }));
    expectBusy(await t.post("alice", "intake", { request: "I want an app" }));
    // a bad body is still a 400, not a 429
    expect((await t.post("alice", "locate", { task: "x" })).statusCode).toBe(400);
    held.release();
    expect((await t.post("alice", "locate", LOCATE)).statusCode).toBe(200);
    expect(guard.limiter.stats().active).toBe(0);
  });

  it("show a repeat of locate within 30 seconds the answer it had, and leave an intake step to run each time", async () => {
    const t = await served();
    const a = await t.post("alice", "locate", LOCATE);
    const b = await t.post("alice", "locate", LOCATE);
    expect(b.json()).toEqual(a.json());
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(t.guard.idempotency.stats().replayed).toBe(1);

    const stored = t.guard.idempotency.stats().entries;
    await t.post("alice", "intake", { request: "I want an app" });
    // an intake answer is kept by the intake, not by the guard: the same words later are the next step, not a repeat
    expect(t.guard.idempotency.stats().entries).toBe(stored);
    const keyed = { "idempotency-key": "intake-1" };
    const k1 = await t.post("alice", "intake", { request: "I want a yoga booking app" }, keyed);
    const k2 = await t.post("alice", "intake", { request: "I want a yoga booking app" }, keyed);
    expect(k2.json()).toEqual(k1.json());
    expect(k2.headers["idempotent-replayed"]).toBe("true");
  });
});
