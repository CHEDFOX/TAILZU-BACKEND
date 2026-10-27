/**
 * The VPS's calls to the jobs Worker (src/code/jobs/handoff/client.ts): signed afresh for every attempt, three attempts, a final
 * answer for the ones that will not change, and what each of start, wake and build owes its caller.
 */
import { describe, expect, it } from "vitest";
import { HANDOFF_ATTEMPTS, HandoffError, JobsHandoff, jobsHandoffFromConfig } from "../src/code/jobs/handoff/index.js";
import { MemoryNonceStore, verifyRequest } from "../src/code/jobs/handoff/sign.js";

const SECRET = "k".repeat(40);
const JOB = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000002";
const SHA = "b".repeat(40);

interface Sent { url: string; init: RequestInit; body: string; headers: Headers }

/** A Worker that answers from a list, and checks each call's signature the way the Worker would. */
function worker(answers: Array<Response | Error | ((s: Sent) => Response)>) {
  const sent: Sent[] = [];
  const nonces = new MemoryNonceStore();
  const verdicts: unknown[] = [];
  const queue = [...answers];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    const s: Sent = { url, init, body: String(init.body), headers };
    sent.push(s);
    verdicts.push(await verifyRequest({ secret: SECRET, method: "POST", path: new URL(url).pathname, body: s.body, header: (n) => headers.get(n), nonces }));
    const next = queue.shift() ?? Response.json({ ok: true });
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(s) : next;
  };
  return { fetchFn, sent, verdicts };
}

const client = (w: ReturnType<typeof worker>, over: Partial<ConstructorParameters<typeof JobsHandoff>[0]> = {}) => {
  const waits: number[] = [];
  const h = new JobsHandoff({ url: "https://jobs.example/", secret: SECRET, fetchFn: w.fetchFn, sleep: async (ms) => { waits.push(ms); }, ...over });
  return { h, waits };
};

describe("start", () => {
  it("posts { jobId } to /v1/start, signed", async () => {
    const w = worker([]);
    await client(w).h.start(JOB);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.url).toBe("https://jobs.example/v1/start");
    expect(JSON.parse(w.sent[0]!.body)).toEqual({ jobId: JOB });
    expect(w.verdicts).toEqual([{ ok: true }]);
  });

  it("signs a path prefix the Worker is mounted under, as the Worker sees it", async () => {
    const w = worker([]);
    await client(w, { url: "https://example.com/jobs" }).h.start(JOB);
    expect(w.sent[0]!.url).toBe("https://example.com/jobs/v1/start");
    expect(w.verdicts).toEqual([{ ok: true }]);
  });

  it("tries three times with a new nonce each time, and gives up with an error the caller can act on", async () => {
    const w = worker([new Response("", { status: 503 }), new Error("connection reset"), new Response("", { status: 502 })]);
    const { h, waits } = client(w);
    await expect(h.start(JOB)).rejects.toMatchObject({ name: "HandoffError", code: "unreachable" });
    expect(w.sent).toHaveLength(HANDOFF_ATTEMPTS);
    expect(HANDOFF_ATTEMPTS).toBe(3);
    expect(w.verdicts).toEqual([{ ok: true }, { ok: true }, { ok: true }]); // none was mistaken for a replay
    expect(new Set(w.sent.map((s) => s.headers.get("x-tailzu-nonce"))).size).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("goes on when the second try gets through", async () => {
    const w = worker([new Response("", { status: 500 }), Response.json({ ok: true, created: true })]);
    await expect(client(w).h.start(JOB)).resolves.toBeUndefined();
    expect(w.sent).toHaveLength(2);
  });

  it("retries a 408, a 425 and a 429 too", async () => {
    for (const status of [408, 425, 429]) {
      const w = worker([new Response("", { status }), Response.json({ ok: true })]);
      await client(w).h.start(JOB);
      expect(w.sent).toHaveLength(2);
    }
  });

  it("does not retry an answer that will not change: a bad signature, a bad request, a missing route", async () => {
    for (const status of [400, 401, 404]) {
      const w = worker([new Response("", { status })]);
      await expect(client(w).h.start(JOB)).rejects.toMatchObject({ code: "rejected", status });
      expect(w.sent).toHaveLength(1);
    }
  });

  it("gives each attempt a time limit", async () => {
    const w = worker([]);
    await client(w).h.start(JOB);
    expect(w.sent[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("will not call a Worker it has no address or secret for", async () => {
    const w = worker([]);
    await expect(client(w, { url: "" }).h.start(JOB)).rejects.toMatchObject({ code: "not_configured" });
    await expect(client(w, { secret: "" }).h.start(JOB)).rejects.toMatchObject({ code: "not_configured" });
    await expect(client(w, { url: "http://jobs.example" }).h.start(JOB)).rejects.toMatchObject({ code: "not_configured" });
    expect(w.sent).toHaveLength(0);
    expect(new HandoffError("rejected", "x", 400).status).toBe(400);
  });
});

describe("wake", () => {
  it("posts { jobId, kind } to /v1/event", async () => {
    const w = worker([]);
    await client(w).h.wake(JOB, "answer");
    expect(w.sent[0]!.url).toBe("https://jobs.example/v1/event");
    expect(JSON.parse(w.sent[0]!.body)).toEqual({ jobId: JOB, kind: "answer" });
  });

  it("never throws: the word is in the database, and the Worker's cron looks again", async () => {
    const warned: object[] = [];
    const w = worker([new Error("down"), new Error("down"), new Error("down")]);
    await expect(client(w, { log: { warn: (o) => { warned.push(o); } } }).h.wake(JOB, "stop")).resolves.toBeUndefined();
    expect(w.sent).toHaveLength(3);
    expect(warned).toEqual([{ jobId: JOB, kind: "stop", error: "unreachable" }]);
  });
});

describe("build", () => {
  it("posts the ids, the mode and the head to /v1/brain, and nothing of the repo", async () => {
    const w = worker([]);
    await client(w).h.build({ userId: "alice", projectId: PROJECT, mode: "incremental", headSha: SHA });
    expect(w.sent[0]!.url).toBe("https://jobs.example/v1/brain");
    expect(JSON.parse(w.sent[0]!.body)).toEqual({ userId: "alice", projectId: PROJECT, mode: "incremental", headSha: SHA });
  });

  it("throws when the Worker cannot be reached, so the caller can mark the build failed", async () => {
    const w = worker([new Error("x"), new Error("x"), new Error("x")]);
    await expect(client(w).h.build({ userId: "alice", projectId: PROJECT, mode: "full", headSha: SHA })).rejects.toBeInstanceOf(HandoffError);
  });
});

describe("from the config", () => {
  it("is nothing in local mode, whatever else is set", () => {
    expect(jobsHandoffFromConfig({ CODE_JOBS_MODE: "local", CODE_JOBS_URL: "https://jobs.example", CODE_JOBS_SECRET: SECRET })).toBeNull();
  });

  it("is a client in cloudflare mode, that knows whether it is set up", () => {
    expect(jobsHandoffFromConfig({ CODE_JOBS_MODE: "cloudflare", CODE_JOBS_URL: "https://jobs.example", CODE_JOBS_SECRET: SECRET })!.configured).toBe(true);
    expect(jobsHandoffFromConfig({ CODE_JOBS_MODE: "cloudflare", CODE_JOBS_SECRET: SECRET })!.configured).toBe(false);
    expect(jobsHandoffFromConfig({ CODE_JOBS_MODE: "cloudflare", CODE_JOBS_URL: "https://jobs.example" })!.configured).toBe(false);
  });
});
