/**
 * PLACEMENT ON THE WORKER, WITH THE PERSON'S PCS BACK IN THE CHOICE (src/desktops.ts, src/userDevices.ts).
 *
 * The known gap: in cloudflare mode the user's own PC was never used, because which PCs are online lived in the VPS's memory. Here the real router
 * (tulmi's agent rig) is given the Worker's provider for the person's PCs, which asks the person's Durable Object, and the order is the agreed
 * one: the PC if it is online; GitHub's computers; paid by the person's rule; wait.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTicket } from "../../tulmi/src/code/live/tickets.js";
import { sessionOffers } from "../../tulmi/src/code/live/offers.js";
import { SESSION_COMMAND } from "../../tulmi/src/code/live/protocol.js";
import { CloudDesktopProvider, devicesOf } from "../src/desktops.js";
import { setWorldForTests } from "../src/world.js";
import { SECRET, scriptedWorld, testEnv, until } from "./helpers.js";
import { connect, ticket, type Client } from "./live-helpers.js";

process.env.RUNTIME = "worker";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.CONNECTOR_TOKEN_KEY = btoa("0123456789abcdef0123456789abcdef");

const { agentRig } = await import("../../tulmi/tests/agent-rig.js");
const { createJobs } = await import("../../tulmi/src/code/jobs/index.js");
const { createWorkBranch } = await import("../../tulmi/src/code/projects.js");

let h: ReturnType<typeof scriptedWorld>;
const open: Client[] = [];
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(async () => {
  setWorldForTests(null);
  // Every PC a test connected goes offline, so the next test starts with the person's computers as nothing.
  for (const c of open.splice(0)) { try { c.ws.close(1000, "done"); } catch { /* gone */ } }
  await until(async () => (await devicesOf(testEnv)("alice").online()).length === 0 && (await devicesOf(testEnv)("bob").online()).length === 0);
});

async function setup(o: { actions?: boolean | { monthlyMin: number }; deaf?: boolean } = {}) {
  const r = await agentRig();
  let ref: ReturnType<typeof createJobs> = null;
  const real = devicesOf(testEnv);
  // `deaf`: the person's object lists the PC but cannot hand it the offer (its socket went between the question and the send).
  const devices: ConstructorParameters<typeof CloudDesktopProvider>[0]["devices"] = o.deaf
    ? (u) => { const d = real(u); return { capable: (p) => d.capable(p), online: () => d.online(), cancel: (a, b, c) => d.cancel(a, b, c), offer: async () => false }; }
    : real;
  const desktop = new CloudDesktopProvider({ devices, store: r.jobStore, router: () => ref });
  const jobs = createJobs({
    code: r.code, store: r.jobStore, github: r.runner, desktop, now: r.now, notify: (u, k, d) => { r.told.push({ userId: u, kind: k, data: d }); },
    offerSession: sessionOffers({ secret: SECRET, jobsUrl: "https://jobs.example", idleSec: 120, now: r.now }), ...(o.actions ? { actions: o.actions } : {}),
  })!;
  ref = jobs;
  r.runner.router = jobs;
  // a PC that comes online wakes the person's waiting jobs, as the Worker's ticker port does
  h.ticker.wake = (userId: string) => jobs.wake(userId);
  const { branch } = await createWorkBranch(r.d, "alice", r.project.id, "task");
  const job = await jobs.createJob("alice", r.project.id, branch, "task", undefined, { agent: true });
  return { r, jobs, job, branch };
}

async function pc(user: string, id: string, over: Record<string, unknown> = {}) {
  const c = await connect("/v1/devices/connect", { ticket: ticket({ kind: "device", user, device: id, ttlMs: 60_000 }) });
  if (!c.ok) throw new Error(`refused ${c.status} ${c.code}`);
  c.client.send({ t: "hello", v: 1, deviceId: id, name: "Work laptop", allowRun: true, projects: "all", busy: false, ...over });
  await c.client.next((m) => m.t === "ack");
  open.push(c.client);
  return c.client;
}

describe("where a step runs, on the Worker", () => {
  it("is the person's PC when it is online: the step is offered down its socket, and GitHub is not used", async () => {
    const { r, jobs, job } = await setup();
    const c = await pc("alice", "laptop-p0001");
    const { job: placed, step } = await jobs.requestExec(job.id, ["npm test"], 600, 2);
    expect(placed).toMatchObject({ state: "running", placement: "desktop", leaseHolder: "laptop-p0001" });
    expect(r.runner.runs).toHaveLength(0);
    const offer = (await c.next((m) => m.t === "offer")).offer as Record<string, unknown>;
    expect(offer).toMatchObject({ jobId: job.id, stepIdx: step.idx, epoch: placed.leaseEpoch, commands: ["npm test"], timeoutSec: 600 });
    // the code is given as read access only, never a token that can write
    expect(offer.repo).toMatchObject({ kind: "app", cloneUrl: "https://github.com/alice/app.git" });
    expect(offer.session).toBeUndefined();
  });

  it("offers a LIVE SESSION to the PC with the way into the job's room: a ticket for exactly this step and lease", async () => {
    const { r, jobs, job } = await setup();
    const c = await pc("alice", "laptop-p0002");
    const { job: placed, step } = await jobs.requestExec(job.id, [SESSION_COMMAND], 1200, 5, { keepChanges: false });
    expect(placed).toMatchObject({ placement: "desktop", leaseHolder: "laptop-p0002" });
    const offer = (await c.next((m) => m.t === "offer")).offer as { session: { url: string; ticket: string; expiresAt: number; idleSec: number; maxSec: number }; discard: boolean; commands: string[] };
    expect(offer.commands).toEqual([SESSION_COMMAND]);
    expect(offer.discard).toBe(true);
    expect(offer.session).toMatchObject({ url: `wss://jobs.example/v1/rooms/${job.id}/runner`, idleSec: 120, maxSec: 1200 });
    const read = readTicket(SECRET, offer.session.ticket, "runner", r.now());
    expect(read.ok && read.claims).toMatchObject({ k: "runner", j: job.id, s: step.idx, e: placed.leaseEpoch });
  });

  it("is GitHub's computers when no PC is online", async () => {
    const { r, jobs, job } = await setup();
    const { job: placed } = await jobs.requestExec(job.id, ["npm test"], 600, 2);
    expect(placed.placement).toBe("github");
    await until(() => r.runner.runs.length === 1);
  });

  it("is GitHub's when the PC is busy, has run commands off, or does not allow the project; or is another person's", async () => {
    for (const [n, over] of [[1, { busy: true }], [2, { allowRun: false }], [3, { projects: ["some-other-project"] }]] as const) {
      const { jobs, job } = await setup();
      await pc("alice", `laptop-n000${n}`, over);
      const { job: placed } = await jobs.requestExec(job.id, ["npm test"], 600, 2);
      expect(placed.placement, JSON.stringify(over)).toBe("github");
    }
    const { jobs, job } = await setup();
    await pc("bob", "bobs-laptop-1");
    expect((await jobs.requestExec(job.id, ["npm test"], 600, 2)).job.placement).toBe("github");
  });

  it("is the PC again the moment it goes offline and comes back: a closed socket is offline, with no heartbeat to wait for", async () => {
    const { jobs, job } = await setup();
    const c = await pc("alice", "laptop-p0005");
    c.ws.close(1000, "bye");
    await c.closed;
    await until(async () => (await devicesOf(testEnv)("alice").online()).length === 0);
    expect((await jobs.requestExec(job.id, ["a"], 60, 1)).job.placement).toBe("github");
    await jobs.cancelExec(job.id);
    await pc("alice", "laptop-p0005");
    expect((await jobs.requestExec(job.id, ["b"], 60, 1)).job.placement).toBe("desktop");
  });

  it("moves a job that was waiting for a computer onto a PC that comes online, without waiting for the cron", async () => {
    const { r, jobs, job } = await setup();
    r.runner.open = false; // GitHub's computers say no
    const { job: waiting } = await jobs.requestExec(job.id, ["npm test"], 600, 2);
    expect(waiting.state).toBe("waiting_for_compute");
    const c = await pc("alice", "laptop-p0006");
    await c.next((m) => m.t === "offer");
    await until(async () => (await jobs.job("alice", job.id)).placement === "desktop");
    expect(r.toldOf("compute_paused")).toHaveLength(1);
  });

  it("falls back to GitHub when the PC cannot be handed the offer, and says nothing is lost", async () => {
    const { r, jobs, job } = await setup({ deaf: true });
    await pc("alice", "laptop-p0007");
    const { job: placed } = await jobs.requestExec(job.id, ["npm test"], 600, 2);
    expect(placed.placement).toBe("github");
    await until(() => r.runner.runs.length === 1);
  });

  it("stops choosing GitHub at 95% of the month's minutes and falls through to the next place; the PC is still first", async () => {
    const { r, jobs, job } = await setup({ actions: { monthlyMin: 100 } });
    const month = new Date(r.now()).toISOString().slice(0, 7);
    await r.jobStore.addRunnerMinutes("alice", month, 94, 80);
    expect((await jobs.requestExec(job.id, ["a"], 60, 1)).job.placement).toBe("github");
    await jobs.cancelExec(job.id);
    await r.jobStore.addRunnerMinutes("alice", month, 1, 80); // 95
    const second = await jobs.requestExec(job.id, ["b"], 60, 1);
    expect(second.job.state).toBe("waiting_for_compute");
    expect(second.job.reason).toMatch(/free GitHub minutes are used up/);
    await jobs.cancelExec(job.id);
    await pc("alice", "laptop-p0008");
    expect((await jobs.requestExec(job.id, ["c"], 60, 1)).job.placement).toBe("desktop");
  });
});
