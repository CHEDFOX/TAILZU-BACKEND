/**
 * THE AGENT'S FREE-FORM MODE, PLAN-FIRST AND REWIND (src/code/agent, docs/code-agent.md sections 12 to 14): end to end over the rig (tests/agent-rig.ts).
 *
 *   - FREE-FORM: the model decides the order of explore, change and run (no locate, no fixed plan), inside the same rails: the budget, the policy, the staged
 *     changeset, a step cap and a run cap of its own, checkpoints, data that is never an instruction, and verify before commit
 *   - VERIFY COMES FIRST AND THE COMMIT CHECKS IT: edits the checks have not passed are never committed, by any order of phases
 *   - PLAN-FIRST: "always show me the plan first" sends every task's plan to the person for a yes, in either mode; a job's own word beats the project's
 *   - REWIND: before the commit the staged edits come back as they stood after a step and the job goes on; after it a NEW commit returns the files, through the
 *     policy, with the history left as it is
 *   - the routes: mode and planFirst on a job, the project's settings, the points a rewind can go to, and the rewind itself
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

const { agentRig, call, done, UTIL_PLAN, UTIL_EDIT, UTIL_TASK } = await import("./agent-rig.js");
const { resetSettingsStoreForTests, settingsStore } = await import("../src/code/agent/settings.js");
const { resetRewindStoreForTests } = await import("../src/code/agent/rewind.js");
const { FREEFORM_STEPS_MAX, FREEFORM_RUNS_MAX, RUNS_MAX } = await import("../src/code/agent/types.js");
const { commitStaged, Unverified, stagedFingerprint } = await import("../src/code/agent/phases.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { createWorkBranch } = await import("../src/code/projects.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

beforeEach(() => { resetSettingsStoreForTests(); resetRewindStoreForTests(); });

const OPEN = "Why does slug() leave stray dashes at the ends? Find out and fix it.";
const NEW_FILE = { path: "src/new.ts", content: "export const n = 1;\n" };

/** A job made on a fresh work branch and handed to the agent in the given mode. */
async function startMode(r: Rig, task: string, o: { mode?: "guided" | "freeform"; planFirst?: boolean } = {}) {
  const { job, branch } = await r.start(task, { enqueue: false });
  await r.orch.enqueue(job.id, task, o);
  return { job, branch };
}
const callsOf = async (r: Rig, id: string) => (await r.stateNow(id)).work.exchanges.flatMap((e) => e.calls.map((c) => c.name));

describe("free-form", () => {
  it("runs the model's own order of explore, change and run, with no locate and no fixed plan, then checks and commits like any job", async () => {
    const r = await agentRig();
    r.model.push(
      call("search_code", { query: "slug" }), call("run", { cmd: "node -e \"console.log('probe')\"" }), call("read_file", { path: "src/util.ts" }),
      call("edit_file", UTIL_EDIT), call("run", { cmd: "npm test" }), done("The ends were never trimmed; now they are."),
    );
    const { job, branch } = await startMode(r, OPEN, { mode: "freeform" });
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    const s = await r.stateNow(job.id);
    expect(s.mode).toBe("freeform");
    expect(s.plan).toBeUndefined();
    expect(await callsOf(r, job.id)).toEqual(["search_code", "run", "read_file", "edit_file", "run", "done"]);
    // No model was asked where it belongs or what to change: the model's own steps are all there is.
    expect(r.json.calls.filter((c) => c.purpose.startsWith("work.")).map((c) => c.purpose)).toEqual([]);
    expect(r.model.turns).toBe(6);
    // The model was told, as the task's own line, that the order is its to decide, and how much it has.
    expect(r.model.seen[0]!.user).toContain("This job is free-form");
    expect(r.model.seen[0]!.user).toContain(`${FREEFORM_STEPS_MAX} steps and ${FREEFORM_RUNS_MAX} runs`);
    // Verified (the checks ran on the staged edit), then committed by the server and opened as a pull request.
    expect(s.verified).toBeTruthy();
    expect(r.runner.runs.some((x) => x.wrapped && x.overlay.some((f) => f.path === "src/util.ts"))).toBe(true);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    expect(s.report).toMatchObject({ outcome: "done" });
  });

  it("is chosen per job, per project, and by neither: free-form is the default, and a job's own word beats the project's", async () => {
    const r = await agentRig({ jobMode: null });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("a"), call("edit_file", UTIL_EDIT), done("b"), call("edit_file", UTIL_EDIT), done("c"));
    const a = await startMode(r, UTIL_TASK);
    await r.orch.idle();
    const sa = await r.stateNow(a.job.id);
    expect(sa.mode).toBe("freeform");
    // No locate and no plan were asked of a model: the default job went straight to work.
    expect(sa.plan).toBeUndefined();
    await settingsStore().put({ projectId: r.project.id, userId: "alice", mode: "guided", planFirst: false, updatedAt: r.now() });
    const b = await startMode(r, UTIL_TASK + " (again)");
    await r.orch.idle();
    expect((await r.stateNow(b.job.id)).mode).toBe("guided");
    expect((await r.stateNow(b.job.id)).plan).toBeTruthy();
    const c = await startMode(r, UTIL_TASK + " (once more)", { mode: "freeform" });
    await r.orch.idle();
    expect((await r.stateNow(c.job.id)).mode).toBe("freeform");
  });

  it("keeps the phased flow behind the knob: CODE_JOB_MODE (or the agent's jobMode) makes guided the server's default", async () => {
    const r = await agentRig({ jobMode: "guided" });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("a"));
    const a = await startMode(r, UTIL_TASK);
    await r.orch.idle();
    const s = await r.stateNow(a.job.id);
    expect(s.mode).toBe("guided");
    expect(s.plan).toBeTruthy();
    const { defaultJobMode } = await import("../src/code/agent/settings.js");
    expect(defaultJobMode()).toBe("freeform");
    expect(defaultJobMode("guided")).toBe("guided");
    process.env.CODE_JOB_MODE = "guided";
    const { resetConfigForTests } = await import("../src/config.js");
    resetConfigForTests();
    try { expect(defaultJobMode()).toBe("guided"); } finally { delete process.env.CODE_JOB_MODE; resetConfigForTests(); }
  });

  it("holds the step cap: after the last step it stops, says so, and goes on to the checks with what is staged", async () => {
    const r = await agentRig();
    for (let i = 0; i < FREEFORM_STEPS_MAX + 5; i += 1) r.model.push(call("read_file", { path: "src/util.ts" }));
    const { job } = await startMode(r, OPEN, { mode: "freeform" });
    await r.orch.idle();
    expect(r.model.turns).toBe(FREEFORM_STEPS_MAX);
    expect(r.model.left).toBe(5);
    const j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    const s = await r.stateNow(job.id);
    expect(s.notes.join(" ")).toContain("most steps one job takes");
    expect(s.report!.outcome).toBe("answer");
  });

  it("allows a free-form job more runs than a guided one, and holds its own cap", async () => {
    const r = await agentRig();
    for (let i = 0; i < FREEFORM_RUNS_MAX + 1; i += 1) r.model.push(call("run", { cmd: `echo ${i}` }));
    r.model.push(done("Looked into it."));
    const { job } = await startMode(r, OPEN, { mode: "freeform" });
    await r.orch.idle();
    // Every run the cap allows went to a computer (more than a guided job's ten), and the next one was refused.
    expect(r.runner.runs.filter((x) => x.commands[0]?.startsWith("echo "))).toHaveLength(FREEFORM_RUNS_MAX);
    expect(FREEFORM_RUNS_MAX).toBeGreaterThan(RUNS_MAX);
    const refused = (await r.stateNow(job.id)).work.exchanges.flatMap((e) => e.results).filter((x) => !x.ok && x.content.includes("runs are used already"));
    expect(refused).toHaveLength(1);
    expect(refused[0]!.content).toContain(`${FREEFORM_RUNS_MAX} runs`);
  });

  it("never lets the model commit, and a guided job keeps its 10 runs", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    for (let i = 0; i < RUNS_MAX + 1; i += 1) r.model.push(call("run", { cmd: `echo ${i}` }));
    r.model.push(done("x"));
    const { job } = await startMode(r, UTIL_TASK);
    await r.orch.idle();
    expect(r.runner.runs.filter((x) => x.commands[0]?.startsWith("echo "))).toHaveLength(RUNS_MAX);
    const results = (await r.stateNow(job.id)).work.exchanges.flatMap((e) => e.results);
    expect(results.filter((x) => !x.ok && x.content.includes(`${RUNS_MAX} runs are used already`))).toHaveLength(1);
    expect(r.model.seen[0]!.tools).not.toContain("commit");
  });
});

describe("verify comes first, and the commit checks it", () => {
  /** A Run with nothing but what commitStaged reads before it asks GitHub for anything. */
  const fakeRun = (verified: string | undefined, staged: Array<{ path: string; content: string | null }>) => {
    const github = { branchHead: vi.fn(async () => "a".repeat(40)) };
    const files = staged.map((f) => ({ ...f, action: "edit" as const }));
    const run = {
      state: { verified, commits: [], merge: undefined, commit: undefined },
      tools: { changes: { empty: staged.length === 0, files, toCommitFiles: () => staged, paths: () => staged.map((f) => f.path), lines: () => [], size: staged.length }, invalidate: () => undefined },
      deps: { projects: { github, store: { getProject: async () => null } } },
      userId: "alice", project: { id: "p", fullName: "alice/app", repoId: 1, installationId: 1, linkKind: "app", defaultBranch: "main" }, branch: "tailzu/x", jobId: "j",
    };
    return { run: run as never, github };
  };

  it("refuses to commit edits the checks never passed, before GitHub is asked anything", async () => {
    const { run, github } = fakeRun(undefined, [{ path: "src/a.ts", content: "x" }]);
    await expect(commitStaged(run)).rejects.toBeInstanceOf(Unverified);
    expect(github.branchHead).not.toHaveBeenCalled();
  });

  it("refuses to commit edits that changed after the checks passed", async () => {
    const before = fakeRun(undefined, [{ path: "src/a.ts", content: "x" }]);
    const passed = stagedFingerprint(before.run);
    const { run, github } = fakeRun(passed, [{ path: "src/a.ts", content: "x, but different now" }]);
    await expect(commitStaged(run)).rejects.toBeInstanceOf(Unverified);
    expect(github.branchHead).not.toHaveBeenCalled();
  });

  it("commits nothing in a job whose checks fail for good, in either mode", async () => {
    const r = await agentRig();
    // The baseline passes; the same checks on the edit do not.
    r.runner.checkResult = (kind, run) => (kind === "test" && run.overlay.length ? { exit: 1, text: "FAIL slug" } : { exit: 0, text: "ok" });
    for (const mode of ["freeform", "guided"] as const) {
      r.json.on("work.plan", UTIL_PLAN);
      for (let i = 0; i < 4; i += 1) r.model.push(call("edit_file", { ...UTIL_EDIT, old: UTIL_EDIT.old }), done("Trimmed."));
      const { job, branch } = await startMode(r, OPEN + " " + mode, { mode });
      await r.orch.idle();
      expect((await r.jobNow(job.id)).state).toBe("failed");
      expect(r.fake.head(r.repo, branch)).toBe(r.fake.head(r.repo, "main"));
      r.model.queue.length = 0;
    }
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
  });
});

describe("plan-first", () => {
  it("sends the plan of every task to the person for a yes before any work, when the project says so, and goes on after it", async () => {
    const r = await agentRig();
    await settingsStore().put({ projectId: r.project.id, userId: "alice", mode: "guided", planFirst: true, updatedAt: r.now() });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job, branch } = await startMode(r, UTIL_TASK);
    await r.orch.idle();
    let j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "approval" });
    const s = await r.stateNow(job.id);
    expect(s.plan!.risk).not.toBe("high");
    expect(s.waiting).toMatchObject({ kind: "approval", for: "plan", action: "job.plan" });
    expect(r.model.turns).toBe(0);
    expect(r.fake.head(r.repo, branch)).toBe(r.fake.head(r.repo, "main"));
    const q = (await r.orch.approve("alice", job.id)) as { approvalId: string };
    await r.orch.approve("alice", job.id, q.approvalId);
    await r.orch.idle();
    j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
  });

  it("ends the job when the person says no to the plan, with nothing changed", async () => {
    const r = await agentRig();
    await settingsStore().put({ projectId: r.project.id, userId: "alice", mode: "guided", planFirst: true, updatedAt: r.now() });
    r.json.on("work.plan", UTIL_PLAN);
    const { job } = await startMode(r, UTIL_TASK);
    await r.orch.idle();
    const ended = await r.orch.deny("alice", job.id);
    expect(ended).toMatchObject({ state: "cancelled", reason: "You didn't approve the plan, so nothing was changed." });
    expect(r.model.turns).toBe(0);
  });

  it("applies to a free-form job too: it plans first, only then, and waits for the yes", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await startMode(r, UTIL_TASK, { mode: "freeform", planFirst: true });
    await r.orch.idle();
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "approval" });
    expect(r.json.of("work.plan")).toHaveLength(1);
    expect(r.model.turns).toBe(0);
    const q = (await r.orch.approve("alice", job.id)) as { approvalId: string };
    await r.orch.approve("alice", job.id, q.approvalId);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect((await r.stateNow(job.id)).mode).toBe("freeform");
  });

  it("is beaten by the job's own word, and is not asked of a free-form job that did not ask for it", async () => {
    const r = await agentRig();
    await settingsStore().put({ projectId: r.project.id, userId: "alice", mode: "guided", planFirst: true, updatedAt: r.now() });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await startMode(r, UTIL_TASK, { planFirst: false });
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.toldOf("needs_you")).toHaveLength(0);
    // Free-form without the setting: no plan at all.
    await settingsStore().put({ projectId: r.project.id, userId: "alice", mode: "freeform", planFirst: false, updatedAt: r.now() });
    r.model.push(call("edit_file", UTIL_EDIT), done("again"));
    const f = await startMode(r, UTIL_TASK + " (free)");
    await r.orch.idle();
    expect((await r.stateNow(f.job.id)).plan).toBeUndefined();
  });
});

describe("rewind before the commit", () => {
  /** A job that edited a file, wrote another, and asked the person a question: parked after two steps. */
  async function parked(r: Rig) {
    r.model.push(call("edit_file", UTIL_EDIT), call("write_file", NEW_FILE), call("ask_user", { question: "Keep going?" }));
    const { job, branch } = await startMode(r, OPEN, { mode: "freeform" });
    await r.orch.idle();
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "answer" });
    return { job, branch };
  }

  it("lists a point for each step, with what was staged then", async () => {
    const r = await agentRig();
    const { job } = await parked(r);
    expect(await r.orch.checkpoints("alice", job.id)).toEqual([
      expect.objectContaining({ step: 1, files: ["src/util.ts"] }),
      expect.objectContaining({ step: 2, files: ["src/util.ts", "src/new.ts"] }),
    ]);
    await expect(r.orch.checkpoints("bob", job.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("puts the staged edits back as they stood after a step, drops what came after, and the job goes on from there", async () => {
    const r = await agentRig();
    const { job, branch } = await parked(r);
    const epoch = (await r.jobNow(job.id)).agentEpoch;
    const out = await r.orch.rewind("alice", job.id, 1);
    expect(out).toMatchObject({ kind: "restored", step: 1 });
    const s = await r.stateNow(job.id);
    expect(s.work.staged.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect(s.work.exchanges).toEqual([]);
    expect(s.work.turns).toBe(1);
    expect(s.phase).toBe("work");
    expect(s.waiting).toBeUndefined();
    expect(s.rewinds).toEqual([expect.objectContaining({ to: 1, kind: "restored" })]);
    // The loop that was running (or would have) is fenced off: the claim's epoch moved.
    expect((await r.jobNow(job.id)).agentEpoch).toBeGreaterThan(epoch);
    // The points after the one gone back to are gone; the work log says so.
    expect((await r.orch.checkpoints("alice", job.id)).map((c) => c.step)).toEqual([1]);
    expect((await r.worklog.list(job.id)).some((e) => e.kind === "decision" && /Went back to step 1/.test(e.text))).toBe(true);
    // It goes on: finishes with the edit it kept, and the file it had written since is not in the commit.
    r.model.push(done("Finished with the first edit."));
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    expect(r.fake.files(r.repo, branch)["src/new.ts"]).toBeUndefined();
  });

  it("goes back to before any work with step 0", async () => {
    const r = await agentRig();
    const { job } = await parked(r);
    await r.orch.rewind("alice", job.id, 0);
    const s = await r.stateNow(job.id);
    expect(s.work.staged).toEqual([]);
    expect(s.work.turns).toBe(0);
    r.model.push(done("Nothing needed changing."));
    await r.orch.idle();
    expect((await r.stateNow(job.id)).report).toMatchObject({ outcome: "answer" });
  });

  it("is the owner's only, wants a step that was kept, and a job that is not over", async () => {
    const r = await agentRig();
    const { job } = await parked(r);
    await expect(r.orch.rewind("bob", job.id, 1)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.orch.rewind("alice", job.id, 9)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.orch.rewind("alice", job.id, -1)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.orch.rewind("alice", job.id, 1.5)).rejects.toMatchObject({ code: "bad_request" });
    await r.orch.stopJob("alice", job.id);
    await expect(r.orch.rewind("alice", job.id, 1)).rejects.toMatchObject({ code: "job_over" });
  });
});

describe("rewind after the commit", () => {
  async function committed(r: Rig) {
    r.model.push(call("edit_file", UTIL_EDIT), call("write_file", NEW_FILE), done("Edited slug and added a constant."));
    const { job, branch } = await startMode(r, OPEN, { mode: "freeform" });
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.files(r.repo, branch)["src/new.ts"]).toBe(NEW_FILE.content);
    return { job, branch, head: r.fake.head(r.repo, branch)! };
  }

  it("makes a NEW commit that returns the files to how they were at the step; the history is left as it is", async () => {
    const r = await agentRig();
    const { job, branch, head } = await committed(r);
    const out = await r.orch.rewind("alice", job.id, 1);
    expect(out).toMatchObject({ kind: "reverted", step: 1, files: ["src/new.ts"] });
    const made = out as { sha: string };
    // A new commit on top of the old head: the old commit is still its parent, nothing was reset, forced or rebased.
    expect(r.fake.head(r.repo, branch)).toBe(made.sha);
    expect(r.fake.parentsOf(r.repo, branch)).toEqual([head]);
    expect(r.fake.headCommit(r.repo, branch).message).toContain("Go back to step 1");
    expect(r.fake.headCommit(r.repo, branch).author).toEqual({ name: "Blip", email: "blip@tailzu.space" });
    expect(r.fake.calls.filter((c) => c.method === "PATCH" && /\/git\/refs\//.test(c.url.pathname)).every((c) => c.body?.force !== true)).toBe(true);
    // The file written after step 1 is gone; the edit made at step 1 stays.
    expect(r.fake.files(r.repo, branch)["src/new.ts"]).toBeUndefined();
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    const s = await r.stateNow(job.id);
    expect(s.commits).toEqual([head, made.sha]);
    expect(s.rewinds).toEqual([expect.objectContaining({ to: 1, kind: "reverted", sha: made.sha })]);
  });

  it("goes all the way back with step 0, and makes no commit when the branch already is what the step had", async () => {
    const r = await agentRig();
    const { job, branch } = await committed(r);
    const all = await r.orch.rewind("alice", job.id, 0);
    expect(all).toMatchObject({ kind: "reverted", step: 0 });
    expect((all as { files: string[] }).files.sort()).toEqual(["src/new.ts", "src/util.ts"]);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toBe(r.fake.files(r.repo, "main")["src/util.ts"]);
    const head = r.fake.head(r.repo, branch);
    const again = await r.orch.rewind("alice", job.id, 0);
    expect(again).toMatchObject({ kind: "reverted", sha: null, files: [] });
    expect(r.fake.head(r.repo, branch)).toBe(head);
  });

  it("goes through the policy like any commit: a standing no stops it, and nothing is pushed", async () => {
    const r = await agentRig();
    const { job, branch, head } = await committed(r);
    await r.store.addGrant(r.project.id, { action: "commit.own_branch", effect: "deny", branchPattern: "tailzu/*" });
    await expect(r.orch.rewind("alice", job.id, 0)).rejects.toMatchObject({ code: "policy_denied" });
    expect(r.fake.head(r.repo, branch)).toBe(head);
  });
});

describe("the routes", () => {
  const apps: Array<{ close: () => Promise<unknown> }> = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });
  async function server(r: Rig) {
    const app = Fastify();
    apps.push(app);
    registerCodeJobRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, code: r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0, agent: r.orch });
    await app.ready();
    return (user: string | null, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
      app.inject({ method, url, ...(user ? { headers: { authorization: `Bearer ${user}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  }

  it("make a job in the mode asked for, and refuse a mode or a plan-first that is not one", async () => {
    const r = await agentRig();
    const req = await server(r);
    r.model.push(call("search_code", { query: "slug" }), done("Looked."));
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, OPEN);
    const body = { projectId: r.project.id, branch, task: OPEN };
    expect((await req("alice", "POST", "/v1/code/jobs", { ...body, mode: "wild" })).statusCode).toBe(400);
    expect((await req("alice", "POST", "/v1/code/jobs", { ...body, planFirst: "yes" })).statusCode).toBe(400);
    const made = await req("alice", "POST", "/v1/code/jobs", { ...body, mode: "freeform" });
    expect(made.statusCode).toBe(200);
    await r.orch.idle();
    const got = (await req("alice", "GET", `/v1/code/jobs/${made.json().job.id}`)).json();
    expect(got.agent).toMatchObject({ mode: "freeform", planFirst: false, steps: 2 });
  });

  it("keep a project's settings for the owner only, and use them for the next job", async () => {
    const r = await agentRig();
    const req = await server(r);
    const url = `/v1/code/projects/${r.project.id}/settings`;
    expect((await req(null, "GET", url)).statusCode).toBe(401);
    expect((await req("bob", "GET", url)).statusCode).toBe(404);
    expect((await req("bob", "PUT", url, { mode: "freeform" })).statusCode).toBe(404);
    expect((await req("alice", "GET", url)).json()).toEqual({ settings: { mode: "guided", planFirst: false, team: "auto" } });
    expect((await req("alice", "PUT", url, { planFirst: true })).json()).toEqual({ settings: { mode: "guided", planFirst: true, team: "auto" } });
    expect((await req("alice", "PUT", url, { mode: "freeform" })).json()).toEqual({ settings: { mode: "freeform", planFirst: true, team: "auto" } });
    expect((await req("alice", "PUT", url, { mode: "wild" })).statusCode).toBe(400);
    expect((await req("alice", "PUT", url, { planFirst: 1 })).statusCode).toBe(400);
    expect((await req("alice", "PUT", url, { team: "sometimes" })).statusCode).toBe(400);
    expect((await req("alice", "GET", url)).json()).toEqual({ settings: { mode: "freeform", planFirst: true, team: "auto" } });
    r.json.on("work.plan", UTIL_PLAN);
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    const s = await r.stateNow(job.id);
    expect(s).toMatchObject({ mode: "freeform", planFirst: true });
    expect(await r.jobNow(job.id)).toMatchObject({ state: "waiting_for_you", waitingOn: "approval" });
  });

  it("list the points a rewind can go to and rewind, for the owner only", async () => {
    const r = await agentRig();
    const req = await server(r);
    r.model.push(call("edit_file", UTIL_EDIT), call("write_file", NEW_FILE), call("ask_user", { question: "Keep going?" }));
    const { job } = await startMode(r, OPEN, { mode: "freeform" });
    await r.orch.idle();
    const pts = `/v1/code/jobs/${job.id}/checkpoints`;
    expect((await req(null, "GET", pts)).statusCode).toBe(401);
    expect((await req("bob", "GET", pts)).statusCode).toBe(404);
    expect((await req("alice", "GET", pts)).json().checkpoints.map((c: { step: number }) => c.step)).toEqual([1, 2]);
    const rw = `/v1/code/jobs/${job.id}/rewind`;
    expect((await req(null, "POST", rw, { toStep: 1 })).statusCode).toBe(401);
    expect((await req("bob", "POST", rw, { toStep: 1 })).statusCode).toBe(404);
    expect((await req("alice", "POST", rw, { toStep: "one" })).statusCode).toBe(400);
    expect((await req("alice", "POST", rw, { toStep: 40 })).statusCode).toBe(404);
    const ok = await req("alice", "POST", rw, { toStep: 1 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ kind: "restored", step: 1 });
    expect(ok.json().job.checkpoint.agent).toBeUndefined();
    r.model.push(done("Done."));
    await r.orch.idle();
  });
});
