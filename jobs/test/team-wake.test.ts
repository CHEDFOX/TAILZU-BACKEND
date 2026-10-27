/**
 * LEAD AND HELPERS ON CLOUDFLARE (docs/code-team.md, "On Cloudflare"): a helper is a job with a Workflow of its own, and a lead that is waiting for its helpers waits for an
 * event, not for a timer. The Workflows and the room are the real ones in Miniflare; what each advance of a job answers is written in the test (the loop, the team and the
 * claim are tested where they live, in tulmi/tests/code-team-*.test.ts).
 */
import { introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { roomOf } from "../src/rooms.js";
import { setWorldForTests, teamPorts } from "../src/world.js";
import { call, gate, scriptedWorld, testEnv, until, uuid } from "./helpers.js";
import { connect, ticket } from "./live-helpers.js";

let h: ReturnType<typeof scriptedWorld>;
let added: Array<{ userId: string; jobId: string; addPaise: number }>;
beforeEach(() => {
  h = scriptedWorld();
  setWorldForTests(h.world);
  added = [];
});
afterEach(() => setWorldForTests(null));

const ports = () => teamPorts(testEnv, () => ({ addBudget: async (userId, jobId, addPaise) => { added.push({ userId, jobId, addPaise }); } }));
const calls = (id: string) => h.agent.calls.filter((c) => c.jobId === id).length;
const waitTeam = (waitMs = 600_000) => ({ next: "wait" as const, waitingOn: "team" as const, wakeAt: 1, waitMs });

describe("a lead waiting for its helpers", () => {
  it("is woken by a helper that ended, long before its wait is up", async () => {
    const lead = uuid(501);
    const helper = uuid(502);
    h.agent.script(lead, [waitTeam(), { next: "end", why: "finished" }]);
    h.agent.script(helper, [{ next: "continue" }, { next: "end", why: "finished" }]);
    await using leadInst = await introspectWorkflowInstance(testEnv.AGENT_JOB, lead);
    await using helperInst = await introspectWorkflowInstance(testEnv.AGENT_JOB, helper);
    await testEnv.AGENT_JOB.create({ id: lead, params: { jobId: lead } });
    await until(() => calls(lead) === 1);
    expect((await ports().start(helper)) ?? null).toBeNull();
    await helperInst.waitForStatus("complete");
    await new Promise((r) => setTimeout(r, 100)); // parked for ten minutes: it does not look at its helpers again by itself
    expect(calls(lead)).toBe(1);
    await ports().wake(lead); // what the helper's end does for its lead
    await leadInst.waitForStatus("complete");
    expect(await leadInst.getOutput()).toEqual({ ended: "finished", advances: 2 });
  });

  it("keeps a wake that arrives before the Workflow got to waiting", async () => {
    const lead = uuid(503);
    const hold = gate<ReturnType<typeof waitTeam>>();
    h.agent.script(lead, [hold.promise, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, lead);
    await testEnv.AGENT_JOB.create({ id: lead, params: { jobId: lead } });
    await until(() => calls(lead) === 1); // the advance is still working on its helpers
    expect(await ports().wake(lead)).toBeUndefined(); // a helper ended in the meantime
    hold.open(waitTeam());
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 2 });
  });

  it("looks at its helpers again when the time is up, and a lead nobody wakes still goes on", async () => {
    const lead = uuid(504);
    h.agent.script(lead, [waitTeam(20_000), waitTeam(20_000), { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, lead);
    await inst.modify(async (m) => {
      await m.forceEventTimeout({ name: "wait-0" });
      await m.forceEventTimeout({ name: "wait-1" });
    });
    await testEnv.AGENT_JOB.create({ id: lead, params: { jobId: lead } });
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 3 });
    expect(h.agent.abandoned).toEqual([]); // a team that is slow is not a person who never came
  });

  it("is woken by an event of kind team from the VPS, which the Worker accepts", async () => {
    const lead = uuid(505);
    h.agent.script(lead, [waitTeam(), { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, lead);
    await testEnv.AGENT_JOB.create({ id: lead, params: { jobId: lead } });
    await until(() => calls(lead) === 1);
    const woke = await call("/v1/event", { jobId: lead, kind: "team" });
    expect(woke.status).toBe(200);
    expect(woke.json.delivered).toBe(true);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 2 });
    expect((await call("/v1/event", { jobId: lead, kind: "not-a-kind" })).status).toBe(400);
  });
});

describe("the ports a lead starts and wakes its helpers with", () => {
  it("start a helper's Workflow once, however many times they are asked", async () => {
    const helper = uuid(506);
    h.agent.script(helper, [{ next: "continue" }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, helper);
    await ports().start(helper);
    await ports().start(helper); // the lead came back after a crash and asked again
    await inst.waitForStatus("complete");
    await ports().start(helper); // ...and once more after the helper is done: nothing throws, nothing runs again
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 2 });
    expect(calls(helper)).toBe(2);
  });

  it("wake a lead that has no Workflow, or one that is over, without a fuss", async () => {
    await expect(ports().wake(uuid(507))).resolves.toBeUndefined();
    const lead = uuid(508);
    h.agent.script(lead, [{ next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, lead);
    await testEnv.AGENT_JOB.create({ id: lead, params: { jobId: lead } });
    await inst.waitForStatus("complete");
    await expect(ports().wake(lead)).resolves.toBeUndefined();
  });

  it("give a helper that ran out more money and wake its Workflow, which is waiting for exactly that", async () => {
    const helper = uuid(509);
    h.agent.script(helper, [{ next: "wait", waitingOn: "budget" }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, helper);
    await testEnv.AGENT_JOB.create({ id: helper, params: { jobId: helper } });
    await until(() => calls(helper) === 1);
    await ports().addBudget!("user-1", helper, 700);
    expect(added).toEqual([{ userId: "user-1", jobId: helper, addPaise: 700 }]);
    await inst.waitForStatus("complete");
    expect(await inst.getOutput()).toEqual({ ended: "finished", advances: 2 });
  });
});

describe("the team board in the app's live view", () => {
  const viewer = (job: string) => ticket({ kind: "viewer", user: "alice-t", job, ttlMs: 60_000 });

  it("is shortened to a few fields for each part, and nothing of the person's code", async () => {
    const id = uuid(510);
    const room = roomOf(testEnv, id);
    const v = await connect(`/v1/rooms/${id}/watch`, { ticket: viewer(id) });
    if (!v.ok) throw new Error(`refused ${v.status}`);
    await v.client.next((m) => m.t === "snapshot");
    await room.publish({
      t: "team", at: 5,
      parts: [
        { id: 0, title: "Shared contracts", status: "merged", jobId: uuid(511), spentPaise: 120, budgetPaise: 400, diff: "SECRET CODE", ownedPaths: ["src/**"] },
        { id: 1, title: "x".repeat(300), status: "running", spentPaise: "lots", budgetPaise: 900 },
        null,
        "not a part",
      ],
    } as never);
    const board = await v.client.next((m) => m.t === "team");
    const parts = (board as unknown as { parts: Array<{ title: string }> }).parts;
    expect(parts[1]!.title.length).toBeLessThanOrEqual(80);
    parts[1]!.title = "(short)";
    expect(board).toEqual({
      t: "team", at: 5,
      parts: [
        { id: 0, title: "Shared contracts", status: "merged", jobId: uuid(511), spentPaise: 120, budgetPaise: 400 },
        { id: 1, title: "(short)", status: "running", spentPaise: 0, budgetPaise: 900 },
      ],
    });
    expect(JSON.stringify(board)).not.toContain("SECRET");
  });

  it("shows at most twelve parts, and a viewer that joins late is sent the board as it was", async () => {
    const id = uuid(512);
    const room = roomOf(testEnv, id);
    const parts = Array.from({ length: 20 }, (_, k) => ({ id: k, title: `part ${k}`, status: "waiting", spentPaise: 0, budgetPaise: 100 }));
    await room.publish({ t: "team", at: 1, parts } as never);
    const v = await connect(`/v1/rooms/${id}/watch`, { ticket: viewer(id) });
    if (!v.ok) throw new Error(`refused ${v.status}`);
    const snap = await v.client.next((m) => m.t === "snapshot");
    const board = (snap.events as Array<{ t: string; parts: unknown[] }>).find((e) => e.t === "team");
    expect(board?.parts).toHaveLength(12);
  });
});
