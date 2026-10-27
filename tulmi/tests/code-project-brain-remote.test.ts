/**
 * The project brain when its builds run on the Cloudflare Worker (ProjectBrain `remote`, src/code/project/index.ts): this process marks
 * the brain "building" and hands the build over, one per commit; the Worker runs it with `buildHere`. Everything that READS the brain
 * is the same. Over the project rig (tests/project-rig.ts): a fake GitHub, a fake model, manual timers.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { projectRig } = await import("./project-rig.js");
const { ProjectBrain } = await import("../src/code/project/index.js");
const { BUILD_DEAD_MS } = await import("../src/code/project/types.js");
type Rig = Awaited<ReturnType<typeof projectRig>>;
type Handed = { userId: string; projectId: string; mode: "full" | "incremental"; headSha: string };

/** A brain over the rig's stores whose builds are handed to a recorder. */
function remoteBrain(r: Rig, o: { fail?: boolean } = {}) {
  const handed: Handed[] = [];
  const brain = new ProjectBrain({
    projects: r.d, store: r.brainStore, call: r.model.call, now: () => r.fake.clock.t, budgetPaise: 1000, setTimer: r.timers.set, clearTimer: r.timers.clear, debounceMs: 60_000,
    remote: { build: async (b) => { if (o.fail) throw new Error("the Worker is away"); handed.push(b); } },
  });
  return { brain, handed };
}

describe("handing over a build", () => {
  it("marks the brain building, hands over one full build for the default branch's head, and runs nothing here", async () => {
    const r = await projectRig();
    const { brain, handed } = remoteBrain(r);
    r.gh.reset();
    const s = await brain.start("alice", r.projectId);
    expect(s.started).toBe(true);
    expect(s.status.status).toBe("building");
    expect(s.status.progress).toMatchObject({ pct: 0, phase: "starting" });
    expect(handed).toEqual([{ userId: "alice", projectId: r.projectId, mode: "full", headSha: r.repo.head.sha }]);
    expect((await r.brainStore.getBrain(r.projectId))!.status).toBe("building");
    // Nothing was read or written by this process: no tarball, no model.
    expect(r.gh.count(/\/tarball\//)).toBe(0);
    expect(r.model.calls).toHaveLength(0);
    // done does not wait for a build in another process: it is the status at the hand-over.
    expect((await s.done).status).toBe("building");
  });

  it("asks for an incremental build once there is a brain, and a full one on request", async () => {
    const r = await projectRig();
    await r.brain.build("alice", r.projectId, { mode: "full" });
    const { brain, handed } = remoteBrain(r);
    await brain.start("alice", r.projectId);
    expect(handed.at(-1)!.mode).toBe("incremental");
    await r.brainStore.saveBrain(r.projectId, { status: "ready" });
    await brain.start("alice", r.projectId, { mode: "full" });
    expect(handed.at(-1)!.mode).toBe("full");
  });

  it("does not hand over a second time while a build is on the books and moving", async () => {
    const r = await projectRig();
    const { brain, handed } = remoteBrain(r);
    await brain.start("alice", r.projectId);
    const again = await brain.start("alice", r.projectId);
    expect(again.started).toBe(false);
    expect(again.status.status).toBe("building");
    expect(handed).toHaveLength(1);
  });

  it("hands over again when the build on the books stopped moving long ago (the Worker died)", async () => {
    const r = await projectRig();
    const { brain, handed } = remoteBrain(r);
    await brain.start("alice", r.projectId);
    r.fake.clock.t += BUILD_DEAD_MS + 1_000;
    const again = await brain.start("alice", r.projectId);
    expect(again.started).toBe(true);
    expect(handed).toHaveLength(2);
  });

  it("says in plain words that the build could not be started when the Worker could not be reached, and a retry works", async () => {
    const r = await projectRig();
    const down = remoteBrain(r, { fail: true });
    const s = await down.brain.start("alice", r.projectId);
    expect(s.status.status).toBe("failed");
    expect(s.status.error).toBe("The build could not be started. Start it again in a little while.");
    const up = remoteBrain(r);
    const again = await up.brain.start("alice", r.projectId);
    expect(again.status.status).toBe("building");
    expect(up.handed).toHaveLength(1);
  });

  it("is the person's own: another person's project, and one that does not exist, hand nothing over", async () => {
    const r = await projectRig();
    const { brain, handed } = remoteBrain(r);
    await expect(brain.start("bob", r.projectId)).rejects.toMatchObject({ code: "not_found" });
    await expect(brain.start("alice", "00000000-0000-4000-8000-0000000000aa")).rejects.toMatchObject({ code: "not_found" });
    expect(handed).toHaveLength(0);
  });

  it("build() is the same hand-over and answers with the status at that moment", async () => {
    const r = await projectRig();
    const { brain, handed } = remoteBrain(r);
    expect((await brain.build("alice", r.projectId, { mode: "full" })).status).toBe("building");
    expect(handed).toHaveLength(1);
  });
});

describe("a project that was just added", () => {
  it("is built once, in full, and not again if it has a brain", async () => {
    const r = await projectRig({ noProject: true });
    const { brain, handed } = remoteBrain(r);
    const { addProject } = await import("../src/code/projects.js");
    const added = await addProject(r.d, "alice", r.fakeRepo.id);
    expect(await brain.added("alice", added.project)).toBe(true);
    expect(handed).toEqual([expect.objectContaining({ mode: "full", projectId: added.project.id })]);
    expect(await brain.added("alice", added.project)).toBe(false);
    expect(handed).toHaveLength(1);
  });
});

describe("GitHub's push webhook", () => {
  it("marks the brain stale at once and, a quiet minute later, hands over an incremental build for the new head", async () => {
    const r = await projectRig();
    await r.brain.build("alice", r.projectId, { mode: "full" });
    const { brain, handed } = remoteBrain(r);
    r.repo.commit({ "src/lib/util.ts": "export const pushed = 1;\n" }, "someone pushed");
    r.gh.reset();
    const project = (await r.store.getProject("alice", r.projectId))!;
    await brain.pushed(project);
    expect(r.gh.calls).toHaveLength(0); // never GitHub while answering
    expect((await r.brainStore.getBrain(r.projectId))!.status).toBe("stale");
    expect(handed).toHaveLength(0);
    expect(r.timers.count).toBe(1);
    r.timers.fire();
    await vi.waitFor(() => expect(handed).toHaveLength(1));
    expect(handed[0]).toEqual({ userId: "alice", projectId: r.projectId, mode: "incremental", headSha: r.repo.head.sha });
    expect(r.model.calls.length).toBeGreaterThan(0); // from the first, local build only
  });
});

describe("ensureFresh", () => {
  it("does nothing when the brain is built from the head", async () => {
    const r = await projectRig();
    await r.brain.build("alice", r.projectId, { mode: "full" });
    const { brain, handed } = remoteBrain(r);
    expect(await brain.ensureFresh("alice", r.projectId)).toMatchObject({ fresh: true, updated: false, status: "ready", headSha: r.repo.head.sha });
    expect(handed).toHaveLength(0);
  });

  it("hands over a build, and does not wait for it, when the default branch moved on", async () => {
    const r = await projectRig();
    await r.brain.build("alice", r.projectId, { mode: "full" });
    const { brain, handed } = remoteBrain(r);
    r.repo.commit({ "src/lib/util.ts": "export const moved = 1;\n" }, "moved on");
    const out = await brain.ensureFresh("alice", r.projectId);
    expect(out).toMatchObject({ fresh: false, updated: true, status: "building" });
    expect(handed).toEqual([expect.objectContaining({ mode: "incremental", headSha: r.repo.head.sha })]);
    // Asked again while it builds (the next job): no second hand-over.
    expect(await brain.ensureFresh("alice", r.projectId)).toMatchObject({ fresh: false, updated: false, status: "building" });
    expect(handed).toHaveLength(1);
  });

  it("starts the first, full build for a project with no brain", async () => {
    const r = await projectRig();
    const { brain, handed } = remoteBrain(r);
    expect(await brain.ensureFresh("alice", r.projectId)).toMatchObject({ fresh: false, status: "building" });
    expect(handed).toEqual([expect.objectContaining({ mode: "full" })]);
  });
});

describe("the Worker's side: buildHere", () => {
  it("builds a brain the VPS marked building a moment ago, which a plain build would take for another server's work", async () => {
    const r = await projectRig();
    const vps = remoteBrain(r);
    await vps.brain.start("alice", r.projectId); // marks it building, hands over
    // The Worker, in its own process, has the real build (no `remote` here: it does the work).
    const worker = new ProjectBrain({ projects: r.d, store: r.brainStore, call: r.model.call, fetchFn: undefined, now: () => r.fake.clock.t, budgetPaise: 1000 });
    const ignored = await worker.build("alice", r.projectId, { mode: "full" });
    expect(ignored.status).toBe("building"); // left alone: it looks like somebody's build in progress
    expect(r.model.calls).toHaveLength(0);

    const view = await worker.buildHere("alice", r.projectId, { mode: "full" });
    expect(view.status).toBe("ready");
    expect(view.headSha).toBe(r.repo.head.sha);
    expect(r.model.calls.length).toBeGreaterThan(0);
    expect((await r.brainStore.getBrain(r.projectId))!.status).toBe("ready");
    expect((await vps.brain.get("alice", r.projectId)).status).toBe("ready");
  });

  it("is still the owner's: another person's project is not built", async () => {
    const r = await projectRig();
    await expect(r.brain.buildHere("bob", r.projectId, { mode: "full" })).rejects.toMatchObject({ code: "not_found" });
  });
});
