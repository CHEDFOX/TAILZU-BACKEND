/**
 * THE ROOM'S SESSION HUB (src/jobRoom.ts, src/http.ts): a runner connects with a one-time, signed, expiring ticket for this job; the agent's command
 * goes to it with the staged overlay; the output streams back; the result is kept and the job's Workflow is woken with an event (no RPC is held
 * open for a command); the session closes when idle, over its limit, or before the person is asked; a runner that goes takes what it was running
 * with it. The runner here is a fake client speaking the protocol over a real WebSocket to the real Durable Object.
 */
import { evictDurableObject, introspectWorkflowInstance, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signTicket } from "../../tulmi/src/code/live/tickets.js";
import { roomDeps } from "../src/jobRoom.js";
import { roomOf } from "../src/rooms.js";
import { setWorldForTests } from "../src/world.js";
import { SECRET, scriptedWorld, testEnv, until } from "./helpers.js";
import { connect, newJob, openRoom, runnerFor, runnerTicket, ticket } from "./live-helpers.js";

let h: ReturnType<typeof scriptedWorld>;
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(() => { setWorldForTests(null); roomDeps.now = () => Date.now(); });

const path = (id: string, which = "runner") => `/v1/rooms/${id}/${which}`;
const exec = (jobId: string, tag: string, o: { commands?: string[]; overlay?: Array<{ path: string; content: string | null }>; timeoutSec?: number } = {}) =>
  roomOf(testEnv, jobId).queueExec({ jobId, tag, commands: o.commands ?? ["npm test"], timeoutSec: o.timeoutSec ?? 60, overlay: o.overlay ?? [] });

describe("the runner's ticket", () => {
  it("lets in a runner with a good ticket, in the query or in the Authorization header", async () => {
    const id = newJob(200);
    await openRoom(id);
    const a = await connect(path(id), { ticket: runnerTicket(id, 5, 1) });
    expect(a.ok).toBe(true);
    if (a.ok) a.client.ws.close(1000, "done");
    const id2 = newJob(201);
    await openRoom(id2);
    const b = await connect(path(id2), { ticket: runnerTicket(id2, 5, 1), header: true });
    expect(b.ok).toBe(true);
  });

  it("refuses an expired ticket", async () => {
    const id = newJob(202);
    await openRoom(id);
    const old = ticket({ kind: "runner", job: id, step: 5, epoch: 1, ttlMs: 1000, now: Date.now() - 60_000 });
    expect(await connect(path(id), { ticket: old })).toEqual({ ok: false, status: 401, code: "expired" });
  });

  it("refuses a ticket made for another job", async () => {
    const mine = newJob(203);
    const other = newJob(204);
    await openRoom(mine);
    expect(await connect(path(mine), { ticket: runnerTicket(other, 5, 1) })).toEqual({ ok: false, status: 401, code: "wrong_job" });
  });

  it("refuses a ticket of another kind, one signed with another secret, and no ticket at all", async () => {
    const id = newJob(205);
    await openRoom(id);
    expect(await connect(path(id), { ticket: ticket({ kind: "viewer", user: "u", job: id, ttlMs: 60_000 }) })).toMatchObject({ ok: false, status: 401, code: "wrong_kind" });
    expect(await connect(path(id), { ticket: signTicket({ secret: `${SECRET}x`, kind: "runner", job: id, step: 5, epoch: 1, ttlMs: 60_000 }).ticket })).toMatchObject({ ok: false, status: 401, code: "bad_ticket" });
    expect(await connect(path(id), { ticket: "t1.not-a-ticket" })).toMatchObject({ ok: false, status: 401 });
    expect(await connect(path(id))).toMatchObject({ ok: false, status: 401 });
  });

  it("is good once", async () => {
    const id = newJob(206);
    await openRoom(id);
    const t = runnerTicket(id, 5, 1);
    const first = await connect(path(id), { ticket: t });
    expect(first.ok).toBe(true);
    // the same ticket again, by anyone who saw it, while the first runner is there
    expect(await connect(path(id), { ticket: t })).toMatchObject({ ok: false, status: 401, code: "used" });
    // and when the first has gone, the session it was for is over: a ticket is not a way back in
    if (first.ok) { first.client.ws.close(1000, "done"); await first.client.closed; }
    await until(async () => (await roomOf(testEnv, id).sessionInfo()).state === "closed");
    expect(await connect(path(id), { ticket: t })).toMatchObject({ ok: false, status: 409, code: "no_session" });
  });

  it("is refused for a job that is not waiting for a runner, and for another step or an earlier lease", async () => {
    const quiet = newJob(207);
    expect(await connect(path(quiet), { ticket: runnerTicket(quiet, 5, 1) })).toMatchObject({ ok: false, status: 409, code: "no_session" });
    const id = newJob(208);
    await openRoom(id, { step: 5 });
    expect(await connect(path(id), { ticket: runnerTicket(id, 6, 1) })).toMatchObject({ ok: false, status: 409, code: "superseded" });
    const c = await runnerFor(id, 5, 3);
    expect(c.ws.readyState).toBe(1);
    expect(await connect(path(id), { ticket: runnerTicket(id, 5, 2) })).toMatchObject({ ok: false, status: 409, code: "superseded" });
    // a second runner for the same lease is not let in beside the first
    expect(await connect(path(id), { ticket: runnerTicket(id, 5, 3) })).toMatchObject({ ok: false, status: 409, code: "already_connected" });
  });

  it("is replaced by a later lease of the same step, and the earlier runner is told to go", async () => {
    const id = newJob(209);
    await openRoom(id);
    const first = await runnerFor(id, 5, 1);
    const second = await runnerFor(id, 5, 2, "desktop");
    await first.next((m) => m.t === "close" && m.reason === "superseded");
    expect((await first.closed).code).toBe(4001);
    expect((await roomOf(testEnv, id).sessionInfo())).toMatchObject({ state: "open", kind: "desktop", epoch: 2 });
    expect(second.ws.readyState).toBe(1);
  });

  it("a runner that arrives first is bound to the step the router then names", async () => {
    // A PC is sent its offer while the router is still placing the step: it can connect before the room has been told the step's number.
    const id = newJob(210);
    const room = roomOf(testEnv, id);
    await room.expectRunner({ jobId: id, idleMs: 120_000, remainingMs: 600_000, ticketTtlMs: 60_000 });
    const c = await runnerFor(id, 7, 1);
    await room.bindStep(99); // already bound by the runner: stays 7
    expect(await room.sessionInfo()).toMatchObject({ state: "open", stepIdx: 7 });
    expect(c.ws.readyState).toBe(1);
  });
});

describe("a command", () => {
  it("goes to the runner with the staged overlay, streams back, and is answered with its exit code and tail", async () => {
    const id = newJob(220);
    await openRoom(id);
    const runner = await runnerFor(id);
    const overlay = [{ path: "src/a.ts", content: "export const a = 1;\n" }, { path: "src/gone.ts", content: null }];
    const queued = await exec(id, "call_1", { commands: ["npm test", "echo done"], overlay, timeoutSec: 120 });
    expect(queued).toMatchObject({ tag: "call_1" });
    const frame = await runner.next((m) => m.t === "exec");
    expect(frame).toEqual({ t: "exec", id: "call_1", commands: ["npm test", "echo done"], timeoutSec: 120, overlay, discard: true });

    runner.send({ t: "out", id: "call_1", data: "PASS src/a.test.ts\n" });
    runner.send({ t: "out", id: "call_1", data: "1 passed\n" });
    runner.send({ t: "done", id: "call_1", exitCode: 0, ms: 1234 });
    await until(async () => (await roomOf(testEnv, id).execStatus("call_1"))?.status === "done");
    const got = await roomOf(testEnv, id).execStatus("call_1");
    expect(got).toEqual({ tag: "call_1", status: "done", exitCode: 0, outputTail: "PASS src/a.test.ts\n1 passed\n", ms: 1234 });
    // the same command asked again is the same command
    expect(await exec(id, "call_1")).toEqual(got);
  });

  it("keeps only the end of the output, and none of it if it looks like it holds a secret", async () => {
    const id = newJob(221);
    await openRoom(id);
    const runner = await runnerFor(id);
    await exec(id, "t1");
    await runner.next((m) => m.t === "exec");
    runner.send({ t: "out", id: "t1", data: `${"x".repeat(20_000)}\nthe end\n` });
    runner.send({ t: "done", id: "t1", exitCode: 1, ms: 5 });
    await until(async () => (await roomOf(testEnv, id).execStatus("t1"))?.status === "done");
    const v = await roomOf(testEnv, id).execStatus("t1");
    expect(v?.outputTail?.length).toBeLessThanOrEqual(8192);
    expect(v?.outputTail?.endsWith("the end\n")).toBe(true);

    await exec(id, "t2");
    await runner.next((m) => m.t === "exec" && m.id === "t2");
    const key = ["ghp", "A".repeat(36)].join("_");
    runner.send({ t: "out", id: "t2", data: `token ${key}\n` });
    runner.send({ t: "done", id: "t2", exitCode: 0, ms: 5 });
    await until(async () => (await roomOf(testEnv, id).execStatus("t2"))?.status === "done");
    const v2 = await roomOf(testEnv, id).execStatus("t2");
    expect(v2?.outputTail).toMatch(/Output not kept/);
    expect(v2?.outputTail).not.toContain(key);
  });

  it("waits its turn: one at a time, in order", async () => {
    const id = newJob(222);
    await openRoom(id);
    const runner = await runnerFor(id);
    await exec(id, "a");
    await exec(id, "b");
    await runner.next((m) => m.t === "exec" && m.id === "a");
    await new Promise((r) => setTimeout(r, 60));
    expect(runner.frames.filter((m) => m.t === "exec")).toHaveLength(1);
    expect(await roomOf(testEnv, id).execStatus("b")).toMatchObject({ status: "queued" });
    runner.send({ t: "done", id: "a", exitCode: 0, ms: 1 });
    await runner.next((m) => m.t === "exec" && m.id === "b");
    expect(await roomOf(testEnv, id).execStatus("a")).toMatchObject({ status: "done" });
    expect(await roomOf(testEnv, id).execStatus("b")).toMatchObject({ status: "running" });
  });

  it("is waiting when no runner has come yet, and goes the moment one does", async () => {
    const id = newJob(223);
    await openRoom(id);
    expect(await exec(id, "early")).toMatchObject({ status: "queued" });
    const runner = await runnerFor(id);
    await runner.next((m) => m.t === "exec" && m.id === "early");
  });

  it("wakes the job's Workflow with an event when the command is done, so no call is held open for it", async () => {
    const id = newJob(224);
    // The job parks waiting for the runner, as the loop does when a command is still out.
    h.agent.script(id, [{ next: "wait", waitingOn: "runner", waitMs: 600_000 }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await testEnv.AGENT_JOB.create({ id, params: { jobId: id } });
    await until(() => h.agent.calls.length === 1);
    await openRoom(id);
    const runner = await runnerFor(id);
    await exec(id, "slow");
    await runner.next((m) => m.t === "exec");
    await new Promise((r) => setTimeout(r, 80));
    expect(h.agent.calls).toHaveLength(1); // still waiting: the command has not finished
    runner.send({ t: "done", id: "slow", exitCode: 0, ms: 10 });
    await inst.waitForStatus("complete");
    expect(h.agent.calls).toHaveLength(2); // the event ended the wait long before its ten minutes
  });

  it("is lost, with a reason, when the runner goes in the middle of it", async () => {
    const id = newJob(225);
    await openRoom(id);
    const runner = await runnerFor(id);
    await exec(id, "mid");
    await runner.next((m) => m.t === "exec");
    runner.ws.close(1000, "bye");
    await until(async () => (await roomOf(testEnv, id).execStatus("mid"))?.status === "lost");
    expect(await roomOf(testEnv, id).execStatus("mid")).toMatchObject({ status: "lost", note: expect.stringMatching(/disconnected/) });
    expect(await roomOf(testEnv, id).sessionInfo()).toMatchObject({ state: "closed", closeReason: "error" });
  });

  it("is lost, and the runner told to stop, when it runs past its time", async () => {
    const id = newJob(226);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    await exec(id, "hang", { timeoutSec: 1 });
    await runner.next((m) => m.t === "exec");
    roomDeps.now = () => Date.now() + 60_000; // past its second and the grace
    expect(await runDurableObjectAlarm(room)).toBe(true);
    expect(await room.execStatus("hang")).toMatchObject({ status: "lost", note: expect.stringMatching(/ran past its time/) });
    await runner.next((m) => m.t === "cancel" && m.id === "hang");
  });

  it("can be dropped by the caller that gave up on it", async () => {
    const id = newJob(227);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    await exec(id, "x");
    await runner.next((m) => m.t === "exec");
    await room.cancelExec("x");
    await runner.next((m) => m.t === "cancel" && m.id === "x");
    expect(await room.execStatus("x")).toMatchObject({ status: "lost" });
  });

  it("does not take a bad frame for a reason to hang up", async () => {
    const id = newJob(228);
    await openRoom(id);
    const runner = await runnerFor(id);
    runner.send("this is not json");
    runner.send({ t: "done", id: "nothing", exitCode: "x" });
    await runner.next((m) => m.t === "error" && m.code === "bad_message");
    expect(runner.ws.readyState).toBe(1);
    await exec(id, "still-works");
    await runner.next((m) => m.t === "exec");
  });

  it("answers a plain `ping` with `pong` without waking the room", async () => {
    const id = newJob(229);
    await openRoom(id);
    const runner = await runnerFor(id);
    runner.send("ping");
    await runner.next((m) => m.raw === "pong");
  });

  it("survives the room being put to sleep with the runner connected", async () => {
    const id = newJob(230);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    await evictDurableObject(room, { webSockets: "hibernate" });
    await exec(id, "after-sleep", { commands: ["echo hi"] });
    await runner.next((m) => m.t === "exec" && m.id === "after-sleep");
    runner.send({ t: "done", id: "after-sleep", exitCode: 0, ms: 3 });
    await until(async () => (await roomOf(testEnv, id).execStatus("after-sleep"))?.status === "done");
    expect(await roomOf(testEnv, id).sessionInfo()).toMatchObject({ state: "open", connected: true });
  });
});

describe("the rules of the session", () => {
  it("opens late: nothing is open until the room is told to expect a runner", async () => {
    const id = newJob(240);
    expect(await roomOf(testEnv, id).sessionInfo()).toMatchObject({ state: "none", connected: false });
    await openRoom(id);
    expect(await roomOf(testEnv, id).sessionInfo()).toMatchObject({ state: "opening", connected: false });
    await runnerFor(id);
    expect(await roomOf(testEnv, id).sessionInfo()).toMatchObject({ state: "open", connected: true, kind: "github" });
  });

  it("closes when idle, by an alarm, and not before", async () => {
    const id = newJob(241);
    const room = await openRoom(id, { idleMs: 120_000 });
    const runner = await runnerFor(id);
    await exec(id, "one");
    await runner.next((m) => m.t === "exec");
    runner.send({ t: "done", id: "one", exitCode: 0, ms: 1 });
    await until(async () => (await room.execStatus("one"))?.status === "done");
    // a minute on: not idle for two minutes yet
    roomDeps.now = () => Date.now() + 60_000;
    await runDurableObjectAlarm(room);
    expect((await room.sessionInfo()).state).toBe("open");
    // two minutes and a bit on: closed, the runner told why, the time counted
    roomDeps.now = () => Date.now() + 130_000;
    expect(await runDurableObjectAlarm(room)).toBe(true);
    expect(await room.sessionInfo()).toMatchObject({ state: "closed", closeReason: "idle", connected: false });
    await runner.next((m) => m.t === "close" && m.reason === "idle");
    expect((await runner.closed).code).toBe(1000);
    expect((await room.sessionInfo()).usedMs).toBeGreaterThan(0);
  });

  it("does not close while a command is running, and a command restarts the idle time", async () => {
    const id = newJob(242);
    const room = await openRoom(id, { idleMs: 5_000 });
    const runner = await runnerFor(id);
    await exec(id, "long", { timeoutSec: 600 });
    await runner.next((m) => m.t === "exec");
    roomDeps.now = () => Date.now() + 60_000;
    await runDurableObjectAlarm(room);
    expect((await room.sessionInfo()).state).toBe("open");
    expect(await room.execStatus("long")).toMatchObject({ status: "running" });
  });

  it("closes before the person is asked anything: needs_you ends the session at once", async () => {
    const id = newJob(243);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    expect(await room.closeSession("needs_you")).toEqual({ closed: true });
    await runner.next((m) => m.t === "close" && m.reason === "needs_you");
    expect(await room.sessionInfo()).toMatchObject({ state: "closed", closeReason: "needs_you" });
    // and again is nothing
    expect(await room.closeSession("needs_you")).toEqual({ closed: false });
    // a runner that was never connected is closed too, so the step it was placed for is not left waiting
    const id2 = newJob(244);
    const r2 = await openRoom(id2);
    expect(await r2.closeSession("needs_you")).toEqual({ closed: true });
    expect(await connect(path(id2), { ticket: runnerTicket(id2, 5, 1) })).toMatchObject({ ok: false, status: 409 });
  });

  it("has a cap on the session time of a job: the alarm closes it, and no more is given", async () => {
    const id = newJob(245);
    const room = await openRoom(id, { remainingMs: 90_000 });
    const runner = await runnerFor(id);
    const budget = await room.sessionBudget(20 * 60_000);
    expect(budget).toMatchObject({ ok: true });
    roomDeps.now = () => Date.now() + 100_000;
    expect(await runDurableObjectAlarm(room)).toBe(true);
    expect(await room.sessionInfo()).toMatchObject({ state: "closed", closeReason: "cap" });
    await runner.next((m) => m.t === "close" && m.reason === "cap");
    // the time is added up across sessions: with 20 minutes of allowance and 19m50s used, the next session is not given
    await runInDurableObject(room, async (_i, state) => { state.storage.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('used_ms', ?)", String(19 * 60_000 + 50_000)); });
    expect(await room.sessionBudget(20 * 60_000)).toEqual({ ok: false, reason: "cap" });
    expect(await room.sessionBudget(25 * 60_000)).toMatchObject({ ok: true });
  });

  it("gives up on a runner that never connects", async () => {
    const id = newJob(246);
    const room = roomOf(testEnv, id);
    await room.expectRunner({ jobId: id, idleMs: 120_000, remainingMs: 600_000, ticketTtlMs: 1_000 });
    await room.bindStep(5);
    await exec(id, "waiting");
    roomDeps.now = () => Date.now() + 5 * 60_000;
    expect(await runDurableObjectAlarm(room)).toBe(true);
    expect(await room.sessionInfo()).toMatchObject({ state: "closed", closeReason: "expired" });
    expect(await room.execStatus("waiting")).toMatchObject({ status: "lost" });
  });

  it("is closed when the job ends, and the runner is told", async () => {
    const id = newJob(247);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    await room.endJob();
    await runner.next((m) => m.t === "close" && m.reason === "job_end");
    expect(await room.status()).toMatchObject({ state: "empty", session: { state: "none" } });
  });
});
