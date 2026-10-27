/** The signed call from the Worker back to the VPS (src/notify.ts), checked the way the VPS checks it. */
import { describe, expect, it } from "vitest";
import { MemoryNonceStore, verifyRequest } from "../../tulmi/src/code/jobs/handoff/sign.js";
import { NOTIFY_PATH } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import type { NotifyData } from "../../tulmi/src/code/jobs/types.js";
import { workerNotify } from "../src/notify.js";
import { SECRET, uuid } from "./helpers.js";

const data = (over: Partial<NotifyData> = {}): NotifyData => ({ jobId: uuid(70), projectId: uuid(71), task: "Fix the login bug", at: 1_800_000_000_000, reason: "Which file is the login form?", ...over });

describe("telling the person from the Worker", () => {
  it("posts { jobId, kind, text } to the VPS, signed the way the VPS verifies", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const notify = workerNotify({ PUBLIC_ORIGIN: "https://api.example.test/", CODE_JOBS_SECRET: SECRET }, { fetchFn: async (url, init) => { seen.push({ url, init }); return new Response("{}"); } });
    await notify("someone-else", "needs_you", data());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`https://api.example.test${NOTIFY_PATH}`);
    const body = String(seen[0]!.init.body);
    expect(JSON.parse(body)).toEqual({ jobId: uuid(70), kind: "needs_you", text: "Which file is the login form?", at: 1_800_000_000_000 });
    expect(body).not.toContain("someone-else"); // the body names a job, never a person
    const headers = new Headers(seen[0]!.init.headers);
    const verdict = await verifyRequest({ secret: SECRET, method: "POST", path: NOTIFY_PATH, body, header: (n) => headers.get(n), nonces: new MemoryNonceStore() });
    expect(verdict).toEqual({ ok: true });
  });

  it("carries where a job moved to and what a step would cost", async () => {
    let body = "";
    const notify = workerNotify({ PUBLIC_ORIGIN: "https://api.example.test", CODE_JOBS_SECRET: SECRET }, { fetchFn: async (_u, init) => { body = String(init.body); return new Response("{}"); } });
    await notify("u", "job_moved", data({ to: "github" }));
    await notify("u", "compute_ask", data({ estimatePaise: 450 }));
    expect(JSON.parse(body).estimatePaise).toBe(450);
  });

  it("tries twice when the VPS is having trouble, and never throws", async () => {
    let calls = 0;
    const warned: object[] = [];
    const notify = workerNotify({ PUBLIC_ORIGIN: "https://api.example.test", CODE_JOBS_SECRET: SECRET }, {
      fetchFn: async () => { calls += 1; return calls === 1 ? new Response("busy", { status: 503 }) : new Response("{}"); },
      log: { warn: (o) => { warned.push(o); } },
    });
    await notify("u", "job_done", data());
    expect(calls).toBe(2);
    expect(warned).toHaveLength(0);

    let down = 0;
    const failing = workerNotify({ PUBLIC_ORIGIN: "https://api.example.test", CODE_JOBS_SECRET: SECRET }, {
      fetchFn: async () => { down += 1; throw new Error("network"); }, log: { warn: (o) => { warned.push(o); } },
    });
    await expect(failing("u", "job_failed", data())).resolves.toBeUndefined();
    expect(down).toBe(2);
    expect(warned).toEqual([{ jobId: uuid(70), kind: "job_failed" }]);
  });

  it("does not try again for an answer that will not change", async () => {
    let calls = 0;
    const notify = workerNotify({ PUBLIC_ORIGIN: "https://api.example.test", CODE_JOBS_SECRET: SECRET }, { fetchFn: async () => { calls += 1; return new Response("no", { status: 401 }); } });
    await notify("u", "needs_you", data());
    expect(calls).toBe(1);
  });

  it("says nothing without an https address and a secret", async () => {
    let calls = 0;
    const f = async () => { calls += 1; return new Response("{}"); };
    await workerNotify({ PUBLIC_ORIGIN: "http://api.example.test", CODE_JOBS_SECRET: SECRET }, { fetchFn: f })("u", "job_done", data());
    await workerNotify({ PUBLIC_ORIGIN: "https://api.example.test" }, { fetchFn: f })("u", "job_done", data());
    await workerNotify({ CODE_JOBS_SECRET: SECRET }, { fetchFn: f })("u", "job_done", data());
    expect(calls).toBe(0);
  });
});
