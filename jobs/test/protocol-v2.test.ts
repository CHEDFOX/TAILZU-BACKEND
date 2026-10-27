/**
 * THE DESKTOP PROTOCOL, VERSION 2, ON THE WORKER'S SIDE (src/userDevices.ts, src/desktops.ts; docs/desktop-runner-session.md):
 * the capabilities in `hello` and how placement respects them, the allow list's "all except" and its missing cap, a `decline` that reaches the
 * router at once, and an offer that carries the project. The router's half is tulmi/tests/code-jobs-protocol-v2.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COMMAND } from "../../tulmi/src/code/live/protocol.js";
import { CloudDesktopProvider, devicesOf } from "../src/desktops.js";
import { setWorldForTests } from "../src/world.js";
import { scriptedWorld, testEnv, until } from "./helpers.js";
import { connect, newJob, ticket, type Client } from "./live-helpers.js";

let h: ReturnType<typeof scriptedWorld>;
const open: Client[] = [];
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(async () => {
  setWorldForTests(null);
  for (const c of open.splice(0)) { try { c.ws.close(1000, "done"); } catch { /* gone */ } }
  await until(async () => (await devicesOf(testEnv)("alice-v2").online()).length === 0);
});

const dev = (user = "alice-v2") => devicesOf(testEnv)(user);

async function pc(id: string, hello: Record<string, unknown> = {}, user = "alice-v2") {
  const c = await connect("/v1/devices/connect", { ticket: ticket({ kind: "device", user, device: id, ttlMs: 60_000 }) });
  if (!c.ok) throw new Error(`refused ${c.status} ${c.code}`);
  c.client.send({ t: "hello", v: 2, deviceId: id, name: "Work laptop", allowRun: true, projects: "all", busy: false, ...hello });
  open.push(c.client);
  return c.client;
}

describe("hello, version 2", () => {
  it("is acknowledged in version 2 with the capabilities as they will be used, and listed with them", async () => {
    const c = await pc("laptop-v2-01", { capabilities: { liveOnly: true, container: false, os: "darwin", arch: "arm64" } });
    expect(await c.next((m) => m.t === "ack")).toEqual({ t: "ack", v: 2, deviceId: "laptop-v2-01", capabilities: { liveOnly: true, container: false, os: "darwin", arch: "arm64" } });
    expect((await dev().online())[0]).toMatchObject({ deviceId: "laptop-v2-01", capabilities: { liveOnly: true, os: "darwin", arch: "arm64" } });
  });

  it("is answered in version 1 for a version 1 app, which is a plain computer", async () => {
    const c = await pc("laptop-v2-02", { v: 1 });
    expect(await c.next((m) => m.t === "ack")).toEqual({ t: "ack", v: 1, deviceId: "laptop-v2-02" });
    expect((await dev().online())[0]!.capabilities).toEqual({ liveOnly: false, container: false, os: "", arch: "" });
  });

  it("refuses version 2's words from a version 1 hello (a bad frame, the socket stays open) and takes them from a version 2 one", async () => {
    const c = await pc("laptop-v2-03", { v: 1, projects: { allExcept: ["p1"] } });
    await c.next((m) => m.t === "error" && m.code === "bad_message");
    expect(c.ws.readyState).toBe(1);
    c.send({ t: "hello", v: 2, deviceId: "laptop-v2-03", name: "x", allowRun: true, projects: { allExcept: ["p1"] }, busy: false });
    await c.next((m) => m.t === "ack");
    expect((await dev().online())[0]!.projects).toEqual({ allExcept: ["p1"] });
  });
});

describe("the allow list", () => {
  it("is \"all except\" a list, and a list of more than 200 is kept", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `project-${i}`);
    const c = await pc("laptop-v2-04", { projects: { allExcept: ["p-no"] } });
    await c.next((m) => m.t === "ack");
    const d = dev();
    expect(await d.capable("p-yes")).toHaveLength(1);
    expect(await d.capable("p-no")).toEqual([]);
    c.send({ t: "state", projects: ids });
    await until(async () => (await d.capable("project-250")).length === 1);
    expect(await d.capable("project-999")).toEqual([]);
    c.send({ t: "state", projects: { allExcept: ids } });
    await until(async () => (await d.capable("project-250")).length === 0);
    expect(await d.capable("project-999")).toHaveLength(1);
  });
});

describe("what a computer can take", () => {
  it("is a live session only for a live-only computer, and never a step it declined; a computer outside a container comes first", async () => {
    const d = dev();
    const a = await pc("live-only-v201", { capabilities: { liveOnly: true } });
    await a.next((m) => m.t === "ack");
    expect(await d.capable("p")).toEqual([]);
    expect((await d.capable("p", { session: true })).map((x) => x.deviceId)).toEqual(["live-only-v201"]);
    const b = await pc("in-a-box-v2001", { capabilities: { container: true } });
    await b.next((m) => m.t === "ack");
    await new Promise((r) => setTimeout(r, 5));
    const c = await pc("laptop-v2-0005");
    await c.next((m) => m.t === "ack");
    // the laptop, then the one in a container; the live-only one only for a session
    expect((await d.capable("p")).map((x) => x.deviceId)).toEqual(["laptop-v2-0005", "in-a-box-v2001"]);
    expect((await d.capable("p", { session: true })).map((x) => x.deviceId)).toEqual(["laptop-v2-0005", "live-only-v201", "in-a-box-v2001"]);
    expect((await d.capable("p", { skip: ["laptop-v2-0005"] })).map((x) => x.deviceId)).toEqual(["in-a-box-v2001"]);
  });

  it("is asked step by step by the provider: it looks at the commands (a session or not) and at who declined", async () => {
    const live = await pc("live-only-v202", { capabilities: { liveOnly: true } });
    await live.next((m) => m.t === "ack");
    const provider = new CloudDesktopProvider({
      devices: devicesOf(testEnv), store: { findHeld: async () => [] },
      router: () => ({ runnerStepFor: async (job: { id: string }, step: { idx: number }) => ({ jobId: job.id, stepIdx: step.idx, epoch: 1, projectId: "p", projectName: "acme/app", commands: ["x"], timeoutSec: 60, repo: {} }) }) as never,
    });
    const ctx = { userId: "alice-v2", projectId: "p", jobId: "j", estimateMinutes: 1, now: Date.now() };
    const step = (commands: string[], declined: string[] = []) => ({ idx: 0, commands, declined }) as never;
    expect((await provider.availableFor(ctx, step(["npm test"]))).ok).toBe(false);
    expect((await provider.availableFor(ctx, step([SESSION_COMMAND]))).ok).toBe(true);
    expect((await provider.availableFor(ctx, step([SESSION_COMMAND], ["live-only-v202"]))).ok).toBe(false);
  });

  it("is offered a step that names its project, id and name, as the router builds it", async () => {
    const c = await pc("laptop-v2-0006");
    await c.next((m) => m.t === "ack");
    const offer = { jobId: newJob(401), stepIdx: 1, epoch: 2, projectId: newJob(402), projectName: "acme/app", commands: ["npm test"], timeoutSec: 60, repo: { kind: "app" } };
    expect(await dev().offer("laptop-v2-0006", offer)).toBe(true);
    expect((await c.next((m) => m.t === "offer")).offer).toMatchObject({ projectId: offer.projectId, projectName: "acme/app" });
  });
});

describe("decline", () => {
  it("reaches the router at once, with who said no, instead of waiting for the lease to run out", async () => {
    const c = await pc("laptop-v2-0007");
    await c.next((m) => m.t === "ack");
    const jobId = newJob(403);
    c.send({ t: "decline", jobId, epoch: 3, reason: "on battery" });
    await until(() => h.ticker.declines.length === 1);
    expect(h.ticker.declines[0]).toEqual({ userId: "alice-v2", jobId, epoch: 3, deviceId: "laptop-v2-0007", reason: "on battery" });
  });

  it("is of no consequence when the router refuses it (a late decline, a lease it does not hold)", async () => {
    h.ticker.decline = async () => { throw new Error("stale_lease"); };
    const c = await pc("laptop-v2-0008");
    await c.next((m) => m.t === "ack");
    c.send({ t: "decline", jobId: newJob(404), epoch: 1 });
    c.send("ping");
    await c.next((m) => m.raw === "pong");
    expect(c.ws.readyState).toBe(1);
  });
});
