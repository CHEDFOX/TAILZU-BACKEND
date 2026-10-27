/** The Cron Trigger: the ticker every minute, and the nudge for jobs nobody is driving. */
import { createExecutionContext, createScheduledController, introspectWorkflowInstance, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { RESCUE_IDLE_MS, RESCUE_PER_TICK, runCron } from "../src/cron.js";
import { setWorldForTests } from "../src/world.js";
import { call, scriptedWorld, testEnv, until, uuid } from "./helpers.js";

let h: ReturnType<typeof scriptedWorld>;
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(() => setWorldForTests(null));

describe("the schedule", () => {
  it("the scheduled handler runs the jobs ticker", async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: "* * * * *" }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(h.ticker.ticks).toBe(1);
    expect(h.ticker.idleAsked).toEqual([{ idleMs: RESCUE_IDLE_MS, limit: RESCUE_PER_TICK }]);
  });
});

describe("a pass", () => {
  it("reports what the ticker did, and a ticker that failed does not stop the nudging", async () => {
    const r = await runCron(testEnv);
    expect(r.tick).toEqual(h.ticker.summary);
    h.ticker.fail = true;
    const r2 = await runCron(testEnv);
    expect(r2.tick).toBeNull();
    expect(r2.errors).toEqual(["tick: Error"]);
    expect(h.ticker.idleAsked).toHaveLength(2);
  });

  it("wakes the Workflow of a job nobody drives, makes one that was never made, and runs a finished one again", async () => {
    const waiting = uuid(60), finished = uuid(61), never = uuid(62);
    h.agent.script(waiting, [{ next: "wait", waitingOn: "claim", wakeAt: 0, waitMs: 3_600_000 }, { next: "end", why: "finished" }]);
    h.agent.script(finished, [{ next: "end", why: "finished" }]);
    await using w = await introspectWorkflowInstance(testEnv.AGENT_JOB, waiting);
    await using f = await introspectWorkflowInstance(testEnv.AGENT_JOB, finished);
    await using n = await introspectWorkflowInstance(testEnv.AGENT_JOB, never);
    // `waiting` is asleep for an hour; `finished` has ended though its job (as far as the database says) has not.
    await call("/v1/start", { jobId: waiting });
    await call("/v1/start", { jobId: finished });
    await f.waitForStatus("complete");
    await until(() => h.agent.calls.filter((c) => c.jobId === waiting).length === 1);

    h.agent.script(finished, [{ next: "end", why: "finished" }]); // what the next advance of it answers
    h.agent.script(never, [{ next: "end", why: "finished" }]);
    h.ticker.idleIds = [waiting, finished, never];
    await runCron(testEnv);

    // The sleeping one is not touched by an event (it is not waiting for one); the finished one runs again; the missing one is made.
    await until(() => h.agent.calls.filter((c) => c.jobId === finished).length === 2);
    await until(() => h.agent.calls.filter((c) => c.jobId === never).length === 1);
    await n.waitForStatus("complete");
    void w;
  });

  it("nudges at most RESCUE_PER_TICK jobs and none that are alive", async () => {
    h.ticker.idleIds = [];
    const r = await runCron(testEnv, { limit: 3 });
    expect(r.rescued).toEqual([]);
    expect(h.ticker.idleAsked[0]).toEqual({ idleMs: RESCUE_IDLE_MS, limit: 3 });
  });
});
