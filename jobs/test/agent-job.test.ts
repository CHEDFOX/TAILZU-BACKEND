/**
 * The AgentJob Workflow, for real in Miniflare (its steps, its waits, its retries), over a SCRIPTED loop: what each advance of a
 * job answers is written in the test. (The loop itself, the claim and the checkpoints are tested where they live, in tulmi/tests;
 * `AgentOrchestrator.advance` is driven through a whole job there.)
 */
import { introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setWorldForTests } from "../src/world.js";
import { call, gate, scriptedWorld, testEnv, until, uuid } from "./helpers.js";

let h: ReturnType<typeof scriptedWorld>;
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(() => setWorldForTests(null));

const make = (id: string) => testEnv.AGENT_JOB.create({ id, params: { jobId: id } });

describe("AgentJob", () => {
  it("drives the loop one advance per step until the job ends", async () => {
    const id = uuid(1);
    h.agent.script(id, [{ next: "continue" }, { next: "continue" }, { next: "continue" }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await make(id);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 4 });
    expect(h.agent.calls.map((c) => c.jobId)).toEqual([id, id, id, id]);
    // Each advance is a step of its own, named in order.
    expect(await inst.waitForStepResult({ name: "advance-0" })).toEqual({ next: "continue" });
    expect(await inst.waitForStepResult({ name: "advance-3" })).toEqual({ next: "end", why: "finished" });
  });

  it("gives each advance its own claimant name and the Worker's turns setting", async () => {
    const id = uuid(2);
    h.agent.script(id, [{ next: "continue" }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await make(id);
    await inst.waitForStatus("complete");
    const [a, b] = h.agent.calls;
    expect(a!.holder).not.toBe(b!.holder);
    expect(a!.holder).toMatch(/^wf-[A-Za-z0-9-]{1,8}-0-1$/);
    expect(b!.holder).toMatch(/-1-1$/);
    expect(a!.turns).toBe(2); // ADVANCE_TURNS in wrangler.jsonc
  });

  it("waits for the person with waitForEvent, and an event from the VPS wakes it", async () => {
    const id = uuid(3);
    h.agent.script(id, [{ next: "continue" }, { next: "wait", waitingOn: "answer" }, { next: "continue" }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await make(id);
    await until(() => h.agent.calls.length === 2);
    await new Promise((r) => setTimeout(r, 100)); // parked: nothing more is asked of the loop while the person has not spoken
    expect(h.agent.calls).toHaveLength(2);
    const woke = await call("/v1/event", { jobId: id, kind: "answer" });
    expect(woke.status).toBe(200);
    expect(woke.json.delivered).toBe(true);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 4 });
    expect(h.agent.calls).toHaveLength(4);
  });

  it("keeps an event that arrives before the Workflow got to waiting", async () => {
    const id = uuid(4);
    const hold = gate<{ next: "wait"; waitingOn: "approval" }>();
    h.agent.script(id, [hold.promise, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await make(id);
    await until(() => h.agent.calls.length === 1); // the first advance is in progress
    const early = await call("/v1/event", { jobId: id, kind: "approve" });
    expect(early.status).toBe(200);
    hold.open({ next: "wait", waitingOn: "approval" }); // ...and only now does the job park
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 2 });
  });

  it("a person who never comes ends the job with a report instead of failing the Workflow", async () => {
    const id = uuid(5);
    h.agent.script(id, [{ next: "wait", waitingOn: "budget" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await inst.modify(async (m) => { await m.forceEventTimeout({ name: "wait-0" }); });
    await make(id);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "timeout", advances: 1 });
    expect(h.agent.abandoned).toHaveLength(1);
    expect(h.agent.abandoned[0]!.jobId).toBe(id);
    expect(h.agent.abandoned[0]!.why).toContain("Nobody replied for 7 days");
    expect(h.agent.abandoned[0]!.why).toContain("nothing else was changed");
  });

  it("looks at a step that is out on a runner again, on the runner's report or when the time is up", async () => {
    const id = uuid(6);
    h.agent.script(id, [
      { next: "wait", waitingOn: "runner", wakeAt: 1, waitMs: 10_000 },
      { next: "wait", waitingOn: "runner", wakeAt: 2, waitMs: 30_000 },
      { next: "end", why: "finished" },
    ]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await inst.modify(async (m) => {
      await m.forceEventTimeout({ name: "wait-0" }); // the time is up
      await m.mockEvent({ type: "wake", payload: { kind: "runner" } }); // ...and the second time the runner reports
    });
    await make(id);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 3 });
  });

  it("sleeps through a claim somebody else holds and a failure it is backing off from", async () => {
    const id = uuid(7);
    h.agent.script(id, [
      { next: "wait", waitingOn: "claim", wakeAt: 1, waitMs: 5_000 },
      { next: "wait", waitingOn: "retry", wakeAt: 2, waitMs: 15_000 },
      { next: "end", why: "finished" },
    ]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await inst.modify(async (m) => { await m.disableSleeps(); });
    await make(id);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 3 });
  });

  it("retries a step that throws, and ends the job when it is out of tries", async () => {
    const id = uuid(8);
    h.agent.script(id, [new Error("the database is away")]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await inst.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "advance-0" }, new Error("the database is away"));
    });
    await make(id);
    await inst.waitForStatus("complete");
    const out = (await inst.getOutput()) as { ended: string };
    expect(out.ended).toMatch(/^errored/);
    expect(h.agent.abandoned).toHaveLength(1);
    expect(h.agent.abandoned[0]!.why).toContain("went wrong on Tailzu's side");
  });

  it("goes on after a step that failed once", async () => {
    const id = uuid(9);
    h.agent.script(id, [{ next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await inst.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "advance-0" }, new Error("blip"), 1);
    });
    await make(id);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 1 });
    expect(h.agent.abandoned).toHaveLength(0);
  });

  it("refuses a Workflow that was not given a job id", async () => {
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, "not-a-job");
    await testEnv.AGENT_JOB.create({ id: "not-a-job", params: { jobId: "nope" } });
    await inst.waitForStatus("errored");
    expect(h.agent.calls).toHaveLength(0);
  });
});
