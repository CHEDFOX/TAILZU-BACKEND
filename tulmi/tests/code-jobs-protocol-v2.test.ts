/**
 * THE DESKTOP PROTOCOL, VERSION 2 (docs/desktop-runner-session.md): the four gaps the desktop runner's notes named.
 *
 *   1. an offer carries the project's id and name, so the app can say what it is running for;
 *   2. `decline` releases the lease AT ONCE and the step goes elsewhere (never back to the computer that said no);
 *   3. `hello` / heartbeat state what the computer is (live-only, container, os, arch), and placement respects it;
 *   4. the allow list can say "all except" these projects, and is no longer cut at 200.
 *
 * Against the real router over the fake GitHub, one clock (jobs-rig.ts); the Worker's half is in jobs/test/protocol-v2.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

// Whoever the test says is calling: the token is the user id.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { rig, LAPTOP, DESKTOP } = await import("./jobs-rig.js");
const { DeviceBook, allows } = await import("../src/code/jobs/devices.js");
const { readHeartbeat, readProjectAllow } = await import("../src/code/jobs/router.js");
const { parseFromDevice, SESSION_COMMAND, DEVICE_PROTOCOL_VERSION } = await import("../src/code/live/protocol.js");
const { DEVICE_PROJECTS_MAX } = await import("../src/code/jobs/types.js");
type Rig = Awaited<ReturnType<typeof rig>>;

afterEach(() => { vi.useRealTimers(); });

const beat = (r: Rig, deviceId: string, over: Record<string, unknown> = {}, user = "alice") =>
  r.jobs.heartbeat(user, { deviceId, name: deviceId, allowRun: true, projects: "all", busy: false, ...over });

describe("1. an offer carries the project", () => {
  it("names the project by id and by its name on GitHub, on the HTTP runner's step (the Worker builds its offers with the same function)", async () => {
    const r = await rig();
    await beat(r, LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["npm test"], 300, 2);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    expect(given).toMatchObject({ jobId: j.id, projectId: r.project.id, projectName: "alice/app", commands: ["npm test"] });
    // the same through the function an offer is built with
    const stepRow = (await r.jobStore.listSteps(j.id))[0]!;
    const built = await r.jobs.runnerStepFor((await r.jobs.job("alice", j.id)), stepRow);
    expect(built).toMatchObject({ projectId: r.project.id, projectName: "alice/app" });
  });
});

describe("2. a decline releases the lease at once", () => {
  async function declined() {
    const r = await rig();
    await beat(r, LAPTOP);
    await beat(r, DESKTOP);
    const j = await r.job();
    const { job: placed, step } = await r.jobs.requestExec(j.id, ["npm test"], 300, 2);
    const holder = placed.leaseHolder!;
    const other = holder === LAPTOP ? DESKTOP : LAPTOP;
    return { r, j, step, placed, holder, other };
  }

  it("takes the lease back in the same call, and gives the step to the other computer, not the one that said no", async () => {
    const { r, j, step, placed, holder, other } = await declined();
    expect(placed).toMatchObject({ placement: "desktop", state: "running" });
    const out = await r.jobs.decline("alice", { jobId: j.id, epoch: placed.leaseEpoch, deviceId: holder, reason: "I am on battery" });
    expect(out).toMatchObject({ ok: true, placement: "desktop", state: "running" });
    const after = await r.jobs.job("alice", j.id);
    expect(after.leaseHolder).toBe(other);
    expect(after.leaseEpoch).toBe(placed.leaseEpoch + 1);
    // no waiting for 90 seconds: the clock did not move
    expect((await r.jobStore.getStep(j.id, step.idx))!.declined).toEqual([holder]);
    // it is not counted as the computer going quiet
    expect(after.reassignments).toBe(0);
    // the one that said no is never offered the step again, however it asks
    expect(await r.jobs.next("alice", holder)).toBeNull();
    expect(await r.jobs.next("alice", other)).toMatchObject({ jobId: j.id, stepIdx: step.idx, epoch: after.leaseEpoch });
  });

  it("goes to GitHub's computers when no other computer is left, and the step is told so", async () => {
    const r = await rig();
    await beat(r, LAPTOP);
    const j = await r.job();
    const { job: placed } = await r.jobs.requestExec(j.id, ["npm test"], 300, 2);
    const out = await r.jobs.decline("alice", { jobId: j.id, epoch: placed.leaseEpoch, deviceId: LAPTOP });
    expect(out).toMatchObject({ placement: "github", state: "running" });
    expect(r.gh!.given).toHaveLength(1);
    expect(r.toldOf("job_moved")).toHaveLength(1);
  });

  it("waits, and tells the person, when there is nowhere else", async () => {
    const r = await rig({ github: false, paid: false });
    await beat(r, LAPTOP);
    const j = await r.job();
    const { job: placed } = await r.jobs.requestExec(j.id, ["npm test"], 300, 2);
    const out = await r.jobs.decline("alice", { jobId: j.id, epoch: placed.leaseEpoch, deviceId: LAPTOP });
    expect(out).toMatchObject({ placement: "none", state: "waiting_for_compute" });
    expect(r.toldOf("compute_paused")).toHaveLength(1);
    // it goes on by itself when another computer comes online
    await beat(r, DESKTOP);
    expect((await r.jobs.job("alice", j.id)).leaseHolder).toBe(DESKTOP);
  });

  it("refuses a decline from a computer that does not hold the lease, with a stale epoch, for a step that is not out, or from another person", async () => {
    const { r, j, placed, holder, other } = await declined();
    await expect(r.jobs.decline("alice", { jobId: j.id, epoch: placed.leaseEpoch, deviceId: other })).rejects.toMatchObject({ code: "stale_lease" });
    await expect(r.jobs.decline("alice", { jobId: j.id, epoch: placed.leaseEpoch + 5, deviceId: holder })).rejects.toMatchObject({ code: "stale_lease" });
    await expect(r.jobs.decline("bob", { jobId: j.id, epoch: placed.leaseEpoch, deviceId: holder })).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.decline("alice", { jobId: "nope", epoch: 1, deviceId: holder })).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.decline("alice", { jobId: j.id, epoch: 0, deviceId: holder })).rejects.toMatchObject({ code: "bad_request" });
    // nothing moved
    expect((await r.jobs.job("alice", j.id)).leaseHolder).toBe(holder);
    // a second decline of the same lease is stale: the first one took it back
    await r.jobs.decline("alice", { jobId: j.id, epoch: placed.leaseEpoch, deviceId: holder });
    await expect(r.jobs.decline("alice", { jobId: j.id, epoch: placed.leaseEpoch, deviceId: holder })).rejects.toMatchObject({ code: "stale_lease" });
  });

  it("is the HTTP route too: the same answer, and a result from the one that declined is refused", async () => {
    const { r, j, placed, holder } = await declined();
    const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
    const Fastify = (await import("fastify")).default;
    const app = Fastify();
    registerCodeJobRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, code: r.code, jobs: r.jobs, tickEveryMs: null });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/v1/code/runner/decline", headers: { authorization: "Bearer alice" }, payload: { jobId: j.id, epoch: placed.leaseEpoch, deviceId: holder } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, placement: "desktop" });
    const late = await app.inject({ method: "POST", url: "/v1/code/runner/decline", headers: { authorization: "Bearer alice" }, payload: { jobId: j.id, epoch: placed.leaseEpoch, deviceId: holder } });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe("stale_lease");
    await app.close();
  });
});

describe("3. the computer says what it is", () => {
  it("reads capabilities in a heartbeat, refuses a wrong kind, and a computer that says none is a plain one", () => {
    const hb = readHeartbeat({ deviceId: "laptop-0001", allowRun: true, projects: "all", capabilities: { liveOnly: true, container: false, os: "darwin", arch: "arm64" } });
    expect(hb.capabilities).toEqual({ liveOnly: true, container: false, os: "darwin", arch: "arm64" });
    expect(readHeartbeat({ deviceId: "laptop-0001", allowRun: true, projects: "all" }).capabilities).toBeUndefined();
    expect(() => readHeartbeat({ deviceId: "laptop-0001", allowRun: true, projects: "all", capabilities: { liveOnly: "yes" } })).toThrow(/true or false/);
    expect(() => readHeartbeat({ deviceId: "laptop-0001", allowRun: true, projects: "all", capabilities: { os: 5 } })).toThrow(/short words/);
    const book = new DeviceBook();
    book.beat("alice", hb, 1000);
    book.beat("alice", readHeartbeat({ deviceId: "plain-00001", allowRun: true, projects: "all" }), 1000);
    expect(book.online("alice", "laptop-0001", 1000)!.capabilities).toEqual({ liveOnly: true, container: false, os: "darwin", arch: "arm64" });
    expect(book.online("alice", "plain-00001", 1000)!.capabilities).toEqual({ liveOnly: false, container: false, os: "", arch: "" });
  });

  it("gives a live-only computer a live session and no ordinary step", async () => {
    const r = await rig();
    await beat(r, LAPTOP, { capabilities: { liveOnly: true } });
    const j = await r.job();
    // an ordinary step is not offered to it: GitHub's computers take it
    const ordinary = await r.jobs.requestExec(j.id, ["npm test"], 300, 2);
    expect(ordinary.job.placement).toBe("github");
    await r.jobs.cancelExec(j.id);
    // a live session is
    const session = await r.jobs.requestExec(j.id, [SESSION_COMMAND], 600, 5, { keepChanges: false });
    expect(session.job).toMatchObject({ placement: "desktop", leaseHolder: LAPTOP });
  });

  it("prefers a computer that is not in a container, then the one heard from last; and a container still works when it is the only one", async () => {
    const r = await rig();
    await beat(r, DESKTOP, { capabilities: { container: true } });
    r.advance(1000);
    await beat(r, LAPTOP);
    const j = await r.job();
    expect((await r.jobs.requestExec(j.id, ["a"], 60, 1)).job.leaseHolder).toBe(LAPTOP);
    await r.jobs.cancelExec(j.id);
    await beat(r, LAPTOP, { busy: true });
    expect((await r.jobs.requestExec(j.id, ["b"], 60, 1)).job.leaseHolder).toBe(DESKTOP);
  });

  it("accepts capabilities in a version 2 hello and in a state frame, and refuses them in a version 1 hello", () => {
    const hello = { t: "hello", v: 2, deviceId: "laptop-0001", allowRun: true, projects: "all", capabilities: { liveOnly: true, container: true, os: "linux", arch: "x64" } };
    expect(parseFromDevice(JSON.stringify(hello))).toMatchObject({ t: "hello", v: 2, capabilities: { liveOnly: true, container: true, os: "linux", arch: "x64" } });
    // a version 1 hello without them is as it was
    expect(parseFromDevice(JSON.stringify({ ...hello, v: 1, capabilities: undefined }))).toMatchObject({ t: "hello", v: 1 });
    expect(parseFromDevice(JSON.stringify({ ...hello, v: 1 }))).toBeNull();
    expect(parseFromDevice(JSON.stringify({ ...hello, v: 3 }))).toBeNull();
    expect(parseFromDevice(JSON.stringify({ ...hello, capabilities: { liveOnly: 1 } }))).toBeNull();
    expect(parseFromDevice(JSON.stringify({ t: "state", capabilities: { liveOnly: false } }))).toMatchObject({ t: "state", capabilities: { liveOnly: false, container: false } });
    expect(DEVICE_PROTOCOL_VERSION).toBe(2);
  });
});

describe("4. the allow list", () => {
  it("says \"all except\" these projects, as well as \"all\" and a list", () => {
    expect(allows({ projects: "all" }, "p1")).toBe(true);
    expect(allows({ projects: ["p1"] }, "p1")).toBe(true);
    expect(allows({ projects: ["p1"] }, "p2")).toBe(false);
    expect(allows({ projects: { allExcept: ["p2"] } }, "p1")).toBe(true);
    expect(allows({ projects: { allExcept: ["p2"] } }, "p2")).toBe(false);
    expect(allows({ projects: { allExcept: [] } }, "anything")).toBe(true);
  });

  it("is read from a heartbeat in all three forms, and anything else is refused with the forms named", () => {
    expect(readProjectAllow("all")).toBe("all");
    expect(readProjectAllow(["a", "b"])).toEqual(["a", "b"]);
    expect(readProjectAllow({ allExcept: ["a"] })).toEqual({ allExcept: ["a"] });
    for (const bad of [{ allExcept: "a" }, { allExcept: ["a"], extra: 1 }, { except: ["a"] }, "some", 5, [1], [""], [`${"x".repeat(65)}`]]) {
      expect(() => readProjectAllow(bad), JSON.stringify(bad)).toThrow(/allExcept/);
    }
  });

  it("has no cut at 200 any more: a long list of ids, or of exceptions, is kept", () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `project-${i}`);
    expect(DEVICE_PROJECTS_MAX).toBeGreaterThan(1200);
    expect(readProjectAllow(ids)).toHaveLength(1200);
    const except = readProjectAllow({ allExcept: ids }) as { allExcept: string[] };
    expect(except.allExcept).toHaveLength(1200);
    expect(() => readProjectAllow(Array.from({ length: DEVICE_PROJECTS_MAX + 1 }, (_, i) => `p${i}`))).toThrow(/at most/);
    // and a version 2 frame carries them
    const frame = parseFromDevice(JSON.stringify({ t: "hello", v: 2, deviceId: "laptop-0001", allowRun: true, projects: { allExcept: ids } }));
    expect(frame && frame.t === "hello" && frame.projects).toEqual({ allExcept: ids });
    // a version 1 hello is still cut at 200, and cannot say "all except"
    expect(parseFromDevice(JSON.stringify({ t: "hello", v: 1, deviceId: "laptop-0001", allowRun: true, projects: ids }))).toBeNull();
    expect(parseFromDevice(JSON.stringify({ t: "hello", v: 1, deviceId: "laptop-0001", allowRun: true, projects: { allExcept: ["a"] } }))).toBeNull();
  });

  it("decides placement: a computer that is all-except a project is not given that project's step, and is given every other", async () => {
    const r = await rig();
    const other = await r.another();
    await beat(r, LAPTOP, { projects: { allExcept: [r.project.id] } });
    const mine = await r.job();
    expect((await r.jobs.requestExec(mine.id, ["a"], 60, 1)).job.placement).toBe("github");
    const theirs = await r.jobs.createJob("alice", other.project.id, other.branch, "other task", 0);
    expect((await r.jobs.requestExec(theirs.id, ["b"], 60, 1)).job).toMatchObject({ placement: "desktop", leaseHolder: LAPTOP });
  });
});
