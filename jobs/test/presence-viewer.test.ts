/**
 * THE PERSON'S PCS (src/userDevices.ts) AND THE APP'S LIVE VIEW (the viewer socket of src/jobRoom.ts).
 *
 * Presence: the desktop app keeps a WebSocket to the Worker; a PC is online while its socket is open and it has said hello. The two Durable Objects are
 * the real ones; the PC and the app are fake clients with tickets made here (the VPS makes them in life).
 */
import { evictDurableObject, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signRequest } from "../../tulmi/src/code/jobs/handoff/sign.js";
import { roomOf } from "../src/rooms.js";
import { setWorldForTests } from "../src/world.js";
import { handleRequest } from "../src/http.js";
import { call, scriptedWorld, signed, testEnv, until } from "./helpers.js";
import { connect, newJob, openRoom, runnerFor, ticket } from "./live-helpers.js";

let h: ReturnType<typeof scriptedWorld>;
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(() => setWorldForTests(null));

const devices = (user: string) => testEnv.USER_DEVICES.get(testEnv.USER_DEVICES.idFromName(user));
const deviceTicket = (user: string, device: string, over: { ttlMs?: number; now?: number } = {}) => ticket({ kind: "device", user, device, ttlMs: over.ttlMs ?? 60_000, ...(over.now !== undefined ? { now: over.now } : {}) });
const hello = (id: string, over: Record<string, unknown> = {}) => ({ t: "hello", v: 1, deviceId: id, name: "Work laptop", allowRun: true, projects: "all", busy: false, ...over });

async function pc(user: string, id: string, over: Record<string, unknown> = {}) {
  const c = await connect("/v1/devices/connect", { ticket: deviceTicket(user, id) });
  if (!c.ok) throw new Error(`refused ${c.status} ${c.code}`);
  c.client.send(hello(id, over));
  await c.client.next((m) => m.t === "ack");
  return c.client;
}

describe("a PC's presence", () => {
  it("is online while its socket is open and it has said hello, and offline when the socket goes", async () => {
    const id = "laptop-0001";
    const c = await connect("/v1/devices/connect", { ticket: deviceTicket("alice-1", id) });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    // connected but not yet introduced: not a place anything can be sent
    expect(await devices("alice-1").online()).toEqual([]);
    c.client.send(hello(id));
    expect(await c.client.next((m) => m.t === "ack")).toEqual({ t: "ack", v: 1, deviceId: id });
    const online = await devices("alice-1").online();
    expect(online).toHaveLength(1);
    expect(online[0]).toMatchObject({ deviceId: id, name: "Work laptop", allowRun: true, projects: "all", busy: false });
    c.client.ws.close(1000, "bye");
    await c.client.closed;
    await until(async () => (await devices("alice-1").online()).length === 0);
  });

  it("is capable only if it allows running, allows the project, and is not busy", async () => {
    const c = await pc("alice-2", "laptop-0002", { allowRun: false, projects: ["p1", "p2"] });
    const d = devices("alice-2");
    expect(await d.capable("p1")).toEqual([]); // "run commands" is off
    c.send({ t: "state", allowRun: true });
    await until(async () => (await d.capable("p1")).length === 1);
    expect(await d.capable("p3")).toEqual([]); // not a project it allows
    c.send({ t: "state", busy: true });
    await until(async () => (await d.capable("p1")).length === 0);
    expect(await d.online()).toHaveLength(1); // still online, just busy
    c.send({ t: "state", busy: false, projects: "all" });
    await until(async () => (await d.capable("anything")).length === 1);
  });

  it("keeps one person's computers apart from another's", async () => {
    await pc("alice-3", "laptop-0003");
    await pc("bob-3", "desktop-0003");
    expect((await devices("alice-3").online()).map((x) => x.deviceId)).toEqual(["laptop-0003"]);
    expect((await devices("bob-3").online()).map((x) => x.deviceId)).toEqual(["desktop-0003"]);
  });

  it("lists several computers of one person, the most recently seen first", async () => {
    const a = await pc("alice-4", "laptop-0004");
    await new Promise((r) => setTimeout(r, 5));
    await pc("alice-4", "desktop-0004");
    expect((await devices("alice-4").online()).map((x) => x.deviceId)).toEqual(["desktop-0004", "laptop-0004"]);
    await new Promise((r) => setTimeout(r, 5));
    a.send({ t: "state", name: "Laptop (renamed)" });
    await until(async () => (await devices("alice-4").online())[0]!.deviceId === "laptop-0004");
  });

  it("is a ticket's person and device and no other: hello for another device is refused and hangs up", async () => {
    const c = await connect("/v1/devices/connect", { ticket: deviceTicket("alice-5", "laptop-0005") });
    if (!c.ok) throw new Error("refused");
    c.client.send(hello("someone-elses-device"));
    await c.client.next((m) => m.t === "error" && m.code === "wrong_device");
    expect((await c.client.closed).code).toBe(4003);
    expect(await devices("alice-5").online()).toEqual([]);
  });

  it("refuses a ticket that is expired, of another kind, forged, replayed or missing", async () => {
    expect(await connect("/v1/devices/connect", { ticket: deviceTicket("alice-6", "laptop-0006", { ttlMs: 1000, now: Date.now() - 60_000 }) })).toMatchObject({ ok: false, status: 401, code: "expired" });
    expect(await connect("/v1/devices/connect", { ticket: ticket({ kind: "viewer", user: "alice-6", job: newJob(300), ttlMs: 60_000 }) })).toMatchObject({ ok: false, status: 401, code: "wrong_kind" });
    expect(await connect("/v1/devices/connect", { ticket: ticket({ kind: "device", user: "alice-6", device: "laptop-0006", ttlMs: 60_000, secret: "another-secret-another-secret-another" }) })).toMatchObject({ ok: false, status: 401, code: "bad_ticket" });
    expect(await connect("/v1/devices/connect")).toMatchObject({ ok: false, status: 401 });
    const once = deviceTicket("alice-6", "laptop-0006");
    const first = await connect("/v1/devices/connect", { ticket: once, header: true });
    expect(first.ok).toBe(true);
    expect(await connect("/v1/devices/connect", { ticket: once })).toMatchObject({ ok: false, status: 401, code: "replayed" });
  });

  it("needs a WebSocket, and nothing else", async () => {
    const res = await handleRequest(new Request("https://jobs.example/v1/devices/connect", { headers: { Authorization: `Bearer ${deviceTicket("alice-7", "laptop-0007")}` } }), testEnv);
    expect(res.status).toBe(426);
    const post = await handleRequest(new Request("https://jobs.example/v1/devices/connect", { method: "POST" }), testEnv);
    expect(post.status).toBe(405);
  });

  it("is replaced when the same computer connects again", async () => {
    const old = await pc("alice-8", "laptop-0008");
    const fresh = await pc("alice-8", "laptop-0008");
    await old.next((m) => m.t === "replaced");
    expect((await old.closed).code).toBe(4000);
    expect(await devices("alice-8").online()).toHaveLength(1);
    expect(fresh.ws.readyState).toBe(1);
  });

  it("is sent a step with `offer`, and only if it is there", async () => {
    const c = await pc("alice-9", "laptop-0009");
    const offer = { jobId: newJob(301), stepIdx: 2, epoch: 4, commands: ["npm test"], timeoutSec: 600, repo: { kind: "app", cloneUrl: "https://github.com/acme/app.git", branch: "tailzu/x", headSha: "a".repeat(40) } };
    expect(await devices("alice-9").offer("laptop-0009", offer)).toBe(true);
    expect(await c.next((m) => m.t === "offer")).toEqual({ t: "offer", offer });
    expect(await devices("alice-9").cancel("laptop-0009", offer.jobId, 4)).toBe(true);
    await c.next((m) => m.t === "cancel" && m.epoch === 4);
    expect(await devices("alice-9").offer("no-such-device", offer)).toBe(false);
    c.ws.close(1000, "bye");
    await c.closed;
    await until(async () => (await devices("alice-9").online()).length === 0);
    expect(await devices("alice-9").offer("laptop-0009", offer)).toBe(false);
  });

  it("answers a plain `ping` with `pong` on its own, and is not woken by it", async () => {
    const c = await pc("alice-10", "laptop-0010");
    c.send("ping");
    await c.next((m) => m.raw === "pong");
  });

  it("is still online after the object is put to sleep: what a PC is lives in its socket", async () => {
    const c = await pc("alice-11", "laptop-0011", { name: "Sleepy" });
    await evictDurableObject(devices("alice-11"), { webSockets: "hibernate" });
    expect((await devices("alice-11").online())[0]).toMatchObject({ deviceId: "laptop-0011", name: "Sleepy", allowRun: true });
    c.send({ t: "state", busy: true });
    await until(async () => (await devices("alice-11").online())[0]!.busy === true);
  });

  it("does not hang up on a frame it does not understand", async () => {
    const c = await pc("alice-12", "laptop-0012");
    c.send("nonsense");
    c.send({ t: "state", allowRun: "yes" });
    await c.next((m) => m.t === "error" && m.code === "bad_message");
    expect(c.ws.readyState).toBe(1);
  });
});

describe("the app's live view", () => {
  const viewerTicket = (job: string, user = "alice-v") => ticket({ kind: "viewer", user, job, ttlMs: 60_000 });

  it("is sent a snapshot, then the phase, the tool calls, the cost, the output and the session as they happen", async () => {
    const id = newJob(310);
    const room = await openRoom(id);
    const v = await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(id) });
    if (!v.ok) throw new Error(`refused ${v.status}`);
    const snap = await v.client.next((m) => m.t === "snapshot");
    expect(snap).toMatchObject({ t: "snapshot", jobId: id, session: { state: "opening" }, remote: false, ready: false });

    await room.publish({ t: "phase", phase: "work", at: 1 });
    await room.publish({ t: "tool", id: "c1", name: "grep", brief: "TODO", at: 2 });
    await room.publish({ t: "result", id: "c1", ok: true, brief: "2 lines match", at: 3 });
    await room.publish({ t: "cost", spentPaise: 120, budgetPaise: 3000, at: 4 });
    for (const t of ["phase", "tool", "result", "cost"]) await v.client.next((m) => m.t === t);

    const runner = await runnerFor(id);
    await v.client.next((m) => m.t === "session" && m.state === "open");
    await room.queueExec({ jobId: id, tag: "x", commands: ["npm test"], timeoutSec: 60, overlay: [] });
    await runner.next((m) => m.t === "exec");
    runner.send({ t: "out", id: "x", data: "running the tests\n" });
    expect(await v.client.next((m) => m.t === "out" && String(m.data).includes("running the tests"))).toMatchObject({ id: "x" });
    await room.closeSession("needs_you");
    await v.client.next((m) => m.t === "session" && m.state === "closed" && m.reason === "needs_you");
  });

  it("is shortened to what a screen shows, and anything that is not a loop event is dropped", async () => {
    const id = newJob(311);
    const room = roomOf(testEnv, id);
    const v = await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(id) });
    if (!v.ok) throw new Error("refused");
    await room.publish({ t: "tool", id: "c", name: "run", brief: "x".repeat(900), at: 1 });
    await room.publish({ t: "snapshot", jobId: "forged" } as never);
    await room.publish({ t: "out", data: "not allowed from the loop" } as never);
    const tool = await v.client.next((m) => m.t === "tool");
    expect(String(tool.brief).length).toBeLessThanOrEqual(160);
    await new Promise((r) => setTimeout(r, 40));
    expect(v.client.frames.filter((m) => m.t === "snapshot")).toHaveLength(1);
    expect(v.client.frames.some((m) => m.t === "out")).toBe(false);
  });

  it("shows a viewer that joins late what already happened", async () => {
    const id = newJob(312);
    const room = roomOf(testEnv, id);
    await room.publish({ t: "phase", phase: "plan", at: 1 });
    await room.publish({ t: "phase", phase: "work", at: 2 });
    const v = await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(id) });
    if (!v.ok) throw new Error("refused");
    const snap = await v.client.next((m) => m.t === "snapshot");
    expect((snap.events as Array<{ phase: string }>).map((e) => e.phase)).toEqual(["plan", "work"]);
  });

  it("is for the job its ticket names, once, and a viewer's ticket only", async () => {
    const id = newJob(313);
    const other = newJob(314);
    expect(await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(other) })).toMatchObject({ ok: false, status: 401, code: "wrong_job" });
    expect(await connect(`/v1/rooms/${id}/watch`, { ticket: ticket({ kind: "device", user: "alice-v", device: "laptop-0013", ttlMs: 60_000 }) })).toMatchObject({ ok: false, status: 401, code: "wrong_kind" });
    expect(await connect(`/v1/rooms/${id}/watch`, { ticket: ticket({ kind: "viewer", user: "alice-v", job: id, ttlMs: 1000, now: Date.now() - 60_000 }) })).toMatchObject({ ok: false, status: 401, code: "expired" });
    expect(await connect(`/v1/rooms/${id}/watch`)).toMatchObject({ ok: false, status: 401 });
    const t = viewerTicket(id);
    expect((await connect(`/v1/rooms/${id}/watch`, { ticket: t })).ok).toBe(true);
    expect(await connect(`/v1/rooms/${id}/watch`, { ticket: t })).toMatchObject({ ok: false, status: 401, code: "replayed" });
  });

  it("can send the person's word mid-task: kept in the room's inbox, shown to other viewers, and the Workflow woken", async () => {
    const id = newJob(315);
    h.agent.script(id, [{ next: "wait", waitingOn: "runner", waitMs: 600_000 }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await testEnv.AGENT_JOB.create({ id, params: { jobId: id } });
    await until(() => h.agent.calls.length === 1);

    const a = await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(id) });
    const b = await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(id) });
    if (!a.ok || !b.ok) throw new Error("refused");
    a.client.send({ t: "message", text: "  also update the README  " });
    await b.client.next((m) => m.t === "said" && m.text === "also update the README");
    const pending = await roomOf(testEnv, id).inboxPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ text: "also update the README" });
    await inst.waitForStatus("complete"); // the event ended the ten-minute wait
    expect(h.agent.calls).toHaveLength(2);
    // taken once acknowledged
    await roomOf(testEnv, id).inboxAck(pending.map((p) => p.id));
    expect(await roomOf(testEnv, id).inboxPending()).toEqual([]);
  });

  it("refuses an empty word, a too long one and a frame that is not one", async () => {
    const id = newJob(316);
    const v = await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(id) });
    if (!v.ok) throw new Error("refused");
    v.client.send({ t: "message", text: "   " });
    await v.client.next((m) => m.t === "error");
    v.client.send({ t: "message", text: "x".repeat(4001) });
    v.client.send("nope");
    await until(() => v.client.frames.filter((m) => m.t === "error").length >= 3);
    expect(await roomOf(testEnv, id).inboxPending()).toEqual([]);
    v.client.send({ t: "ping" });
    await v.client.next((m) => m.t === "pong");
  });

  it("does not take a command from a viewer: only the person's words", async () => {
    const id = newJob(317);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    const v = await connect(`/v1/rooms/${id}/watch`, { ticket: viewerTicket(id) });
    if (!v.ok) throw new Error("refused");
    v.client.send({ t: "exec", id: "x", commands: ["rm -rf /"], timeoutSec: 5 });
    await v.client.next((m) => m.t === "error");
    await new Promise((r) => setTimeout(r, 40));
    expect(runner.frames.some((m) => m.t === "exec")).toBe(false);
    expect(await room.execStatus("x")).toBeNull();
  });
});

describe("the person's word, from the VPS (POST /v1/message)", () => {
  it("is signed like the other calls, goes to the job's room and wakes its Workflow", async () => {
    const id = newJob(320);
    const ok = await call("/v1/message", { jobId: id, text: "use tabs, not spaces" });
    expect(ok).toEqual({ status: 200, json: { ok: true } });
    expect((await roomOf(testEnv, id).inboxPending()).map((p) => p.text)).toEqual(["use tabs, not spaces"]);
  });

  it("refuses an unsigned call, a replayed one, a bad job and an empty or long word", async () => {
    const id = newJob(321);
    const unsigned = await handleRequest(new Request("https://jobs.example/v1/message", { method: "POST", body: JSON.stringify({ jobId: id, text: "hi" }) }), testEnv);
    expect(unsigned.status).toBe(401);
    const once = signed("/v1/message", { jobId: id, text: "hello" }, { nonce: "n".repeat(20) });
    expect((await handleRequest(once.clone(), testEnv)).status).toBe(200);
    expect((await handleRequest(once.clone(), testEnv)).status).toBe(401);
    expect((await call("/v1/message", { jobId: "nope", text: "hi" })).status).toBe(400);
    expect((await call("/v1/message", { jobId: id, text: "  " })).status).toBe(400);
    expect((await call("/v1/message", { jobId: id, text: "x".repeat(4001) })).status).toBe(400);
    void signRequest;
    expect((await roomOf(testEnv, id).inboxPending()).map((p) => p.text)).toEqual(["hello"]);
  });
});
