/**
 * The Worker's door (src/http.ts): the signature, the nonce, the shape, and what start, event and brain do to the Workflows.
 * The nonce book is the real Durable Object.
 */
import { introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SIGNATURE_WINDOW_MS } from "../../tulmi/src/code/jobs/handoff/sign.js";
import { brainInstanceId } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import { handleRequest } from "../src/http.js";
import { setWorldForTests } from "../src/world.js";
import { SECRET, SHA, call, gate, scriptedWorld, signed, testEnv, until, uuid } from "./helpers.js";

let h: ReturnType<typeof scriptedWorld>;
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(() => setWorldForTests(null));

describe("the signature", () => {
  it("lets a good signature through", async () => {
    const r = await call("/v1/start", { jobId: uuid(10) });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it("refuses one made with another secret", async () => {
    const r = await call("/v1/start", { jobId: uuid(11) }, { secret: `${SECRET}x` });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe("bad_signature");
  });

  it("refuses a body that was changed after it was signed", async () => {
    const good = signed("/v1/start", { jobId: uuid(12) });
    const tampered = new Request(good.url, { method: "POST", headers: good.headers, body: JSON.stringify({ jobId: uuid(13) }) });
    const res = await handleRequest(tampered, testEnv);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("bad_signature");
  });

  it("refuses a signature made for another path", async () => {
    const forStart = signed("/v1/start", { jobId: uuid(14), kind: "wake" });
    const atEvent = new Request("https://jobs.example/v1/event", { method: "POST", headers: forStart.headers, body: JSON.stringify({ jobId: uuid(14), kind: "wake" }) });
    expect((await handleRequest(atEvent, testEnv)).status).toBe(401);
  });

  it("refuses a request with no signature at all", async () => {
    const res = await handleRequest(new Request("https://jobs.example/v1/start", { method: "POST", body: JSON.stringify({ jobId: uuid(15) }) }), testEnv);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("missing");
  });

  it("refuses an expired one, and one from the future, and takes one inside the window", async () => {
    const now = Date.now();
    const old = await call("/v1/start", { jobId: uuid(16) }, { now: now - SIGNATURE_WINDOW_MS - 5_000 });
    expect(old.status).toBe(401);
    expect(old.json.code).toBe("expired");
    const future = await call("/v1/start", { jobId: uuid(16) }, { now: now + SIGNATURE_WINDOW_MS + 5_000 });
    expect(future.status).toBe(401);
    expect(future.json.code).toBe("expired");
    const inside = await call("/v1/start", { jobId: uuid(16) }, { now: now - SIGNATURE_WINDOW_MS + 30_000 });
    expect(inside.status).toBe(200);
  });

  it("refuses the same request sent twice (a replay)", async () => {
    const first = signed("/v1/start", { jobId: uuid(17) });
    const again = first.clone();
    expect((await handleRequest(first, testEnv)).status).toBe(200);
    const replay = await handleRequest(again, testEnv);
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { code: string }).code).toBe("replayed");
  });

  it("does not spend a nonce on a request that failed the signature", async () => {
    const nonce = "n-0123456789abcdefghij";
    const bad = await call("/v1/start", { jobId: uuid(18) }, { secret: "wrong", nonce });
    expect(bad.status).toBe(401);
    const good = await call("/v1/start", { jobId: uuid(18) }, { nonce });
    expect(good.status).toBe(200);
  });

  it("answers 503 when the Worker has no secret, 404 for another path and 405 for a GET", async () => {
    const res = await handleRequest(signed("/v1/start", { jobId: uuid(19) }), { ...testEnv, CODE_JOBS_SECRET: "" } as typeof testEnv);
    expect(res.status).toBe(503);
    expect((await handleRequest(signed("/v1/nothing", {}), testEnv)).status).toBe(404);
    expect((await handleRequest(new Request("https://jobs.example/v1/start"), testEnv)).status).toBe(405);
    const health = await handleRequest(new Request("https://jobs.example/v1/health"), testEnv);
    expect(await health.json()).toEqual({ ok: true });
  });
});

describe("POST /v1/start", () => {
  it("makes the job's Workflow, with the job's id", async () => {
    const id = uuid(20);
    h.agent.script(id, [{ next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    const r = await call("/v1/start", { jobId: id });
    expect(r.json.created).toBe(true);
    await inst.waitForStatus("complete");
    expect(h.agent.calls.filter((c) => c.jobId === id)).toHaveLength(1);
  });

  it("is idempotent: an instance that exists is fine, and is not run twice", async () => {
    const id = uuid(21);
    const hold = gate<{ next: "end"; why: "finished" }>();
    h.agent.script(id, [hold.promise]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    const first = await call("/v1/start", { jobId: id });
    const second = await call("/v1/start", { jobId: id });
    const third = await call("/v1/start", { jobId: id });
    expect(first.json.created).toBe(true);
    expect(second.status).toBe(200);
    expect(second.json.created).toBe(false);
    expect(third.json.created).toBe(false);
    await until(() => h.agent.calls.filter((c) => c.jobId === id).length === 1);
    hold.open({ next: "end", why: "finished" });
    await inst.waitForStatus("complete");
    expect(h.agent.calls.filter((c) => c.jobId === id)).toHaveLength(1);
    // ...and still fine once it has finished.
    expect((await call("/v1/start", { jobId: id })).json.created).toBe(false);
  });

  it("refuses an id that is not a job's", async () => {
    expect((await call("/v1/start", { jobId: "../etc/passwd" })).status).toBe(400);
    expect((await call("/v1/start", {})).status).toBe(400);
    expect((await call("/v1/start", "not json")).status).toBe(400);
  });
});

describe("POST /v1/event", () => {
  it("reaches a waiting instance", async () => {
    const id = uuid(30);
    h.agent.script(id, [{ next: "wait", waitingOn: "approval" }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await call("/v1/start", { jobId: id });
    await until(() => h.agent.calls.length === 1);
    const r = await call("/v1/event", { jobId: id, kind: "approve" });
    expect(r.status).toBe(200);
    expect(r.json.delivered).toBe(true);
    await inst.waitForStatus("complete");
    expect(h.agent.calls).toHaveLength(2);
  });

  it("says so for a job with no Workflow", async () => {
    const r = await call("/v1/event", { jobId: uuid(31), kind: "answer" });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("no_instance");
  });

  it("refuses a kind it does not know", async () => {
    expect((await call("/v1/event", { jobId: uuid(32), kind: "explode" })).status).toBe(400);
  });

  it("a stop ends the Workflow", async () => {
    const id = uuid(33);
    h.agent.script(id, [{ next: "wait", waitingOn: "answer" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await call("/v1/start", { jobId: id });
    await until(() => h.agent.calls.length === 1);
    const r = await call("/v1/event", { jobId: id, kind: "stop" });
    expect(r.json.delivered).toBe(true);
    await inst.waitForStatus("terminated");
  });

  it("an event for an instance that has finished is a quiet no", async () => {
    const id = uuid(34);
    h.agent.script(id, [{ next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await call("/v1/start", { jobId: id });
    await inst.waitForStatus("complete");
    const r = await call("/v1/event", { jobId: id, kind: "wake" });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("complete"); // the Worker says what the instance is, and nothing runs again
  });
});

describe("POST /v1/brain", () => {
  const body = (projectId: string, mode: "full" | "incremental" = "incremental", headSha = SHA) => ({ userId: "u-1", projectId, mode, headSha });

  it("makes a build with the id brain-<projectId>-<headSha>", async () => {
    const p = uuid(40);
    const id = brainInstanceId(p, SHA);
    expect(id).toBe(`brain-${p}-${SHA}`);
    expect(id.length).toBeLessThanOrEqual(100);
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, id);
    const r = await call("/v1/brain", body(p));
    expect(r.json.created).toBe(true);
    await inst.waitForStatus("complete");
    expect(h.brain.built).toHaveLength(1);
    expect(h.brain.built[0]).toMatchObject({ projectId: p, headSha: SHA, mode: "incremental" });
  });

  it("is one build per head: asking again while it runs changes nothing", async () => {
    const p = uuid(41);
    const hold = gate<void>();
    h.brain.check = async (b) => { h.brain.checked.push(b); await hold.promise; return { skip: false, reason: "" }; };
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, brainInstanceId(p, SHA));
    expect((await call("/v1/brain", body(p))).json.created).toBe(true);
    expect((await call("/v1/brain", body(p))).json.created).toBe(false);
    hold.open();
    await inst.waitForStatus("complete");
    expect(h.brain.built).toHaveLength(1);
  });

  it("a rebuild of a head already built runs the finished instance again", async () => {
    const p = uuid(42);
    await using inst = await introspectWorkflowInstance(testEnv.BUILD_BRAIN, brainInstanceId(p, SHA));
    await call("/v1/brain", body(p));
    await inst.waitForStatus("complete");
    const again = await call("/v1/brain", body(p, "full"));
    expect(again.json.created).toBe(true);
    await until(() => h.brain.built.length === 2);
    expect(h.brain.built[1]!.mode).toBe("full");
  });

  it("refuses a head that is not a commit, a project that is not an id, a mode it does not know", async () => {
    expect((await call("/v1/brain", body(uuid(43), "full", "main"))).status).toBe(400);
    expect((await call("/v1/brain", body("not-a-uuid"))).status).toBe(400);
    expect((await call("/v1/brain", { ...body(uuid(43)), mode: "everything" })).status).toBe(400);
    expect((await call("/v1/brain", { projectId: uuid(43), mode: "full", headSha: SHA })).status).toBe(400);
  });
});
