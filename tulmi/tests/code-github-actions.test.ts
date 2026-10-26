/**
 * GitHub's free computers as a place for the router to run a step
 * (src/code/jobs/githubActions.ts), against the fake GitHub with its fake
 * Actions (github-fake.ts), a local RS256 key standing in for GitHub's OIDC
 * key, in-memory stores and ONE fake clock (jobs-rig.ts, `actions: true`).
 *
 * What is held here: the shadow branch (one commit on the checkpoint, exactly
 * three files, the work branch never touched, the branch deleted after); the
 * policy around it (runner.shadow is the server's alone, runner.reserved is
 * "never" for agents and for a runner's changes); the permissions it needs
 * (Workflows and Actions on the App, `workflow` on a sign-in) and the router
 * moving on without them; the identity token and everything it must say; the
 * epoch fence; the quota and timeout paths of the ticker; minutes (rounded up,
 * none for a public repo, the person's own CI added); and the two routes
 * (gh-result, and GET a project with its ciNoise). The workflow, step.json
 * and run.mjs themselves are in code-run-script.test.ts. Nothing reaches the
 * network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { SignJWT, generateKeyPair } from "jose";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

// Whoever the test says is calling: the token is the user id; none is nobody.
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

const { rig, LAPTOP, MIN, SEC, ACTIONS_PERMISSIONS, KEYS, OIDC, SECRET_ENV } = await import("./jobs-rig.js");
const { FakeGithub } = await import("./github-fake.js");
const { SHADOW_FILES, parseHolder, shadowBranchName } = await import("../src/code/shadow.js");
const { RUN_MJS } = await import("../src/code/jobs/runScript.js");
const { renderWorkflow, timeoutMinutes } = await import("../src/code/jobs/workflow.js");
const { GithubActionsProvider, OIDC_ISSUER, OIDC_JWKS_URL } = await import("../src/code/jobs/githubActions.js");
const { createGithubActions, createJobs, projectDepsOf, runnerResultUrl } = await import("../src/code/jobs/index.js");
const { MemoryJobStore } = await import("../src/code/jobs/store.js");
const { LEASE_MS, GITHUB_NO_RUN_MS, GITHUB_OVERRUN_MS } = await import("../src/code/jobs/types.js");
const { choosePlacement } = await import("../src/code/jobs/placement.js");
const { ACTIONS, PolicyError, decide, isNeedsApproval } = await import("../src/code/policy.js");
const { addProject, commitToBranch, createWorkBranch, forceUpdateBranch, workspace } = await import("../src/code/projects.js");
const { syncBranch } = await import("../src/code/pulls.js");
const { createCode } = await import("../src/code/index.js");
const { MemoryCodeStore } = await import("../src/code/store.js");
const { registerCodeJobRoutes } = await import("../src/routes/codeJobs.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");
type Rig = Awaited<ReturnType<typeof rig>>;

afterEach(() => { vi.useRealTimers(); });

const SHA40 = /^[0-9a-f]{40}$/;
const WORKFLOW = ".github/workflows/tailzu-run.yml";

/** A job whose one exec step has been placed (on GitHub, when no PC is there). */
async function out(r: Rig, o: { commands?: string[]; timeoutSec?: number; estimate?: number } = {}) {
  const j = await r.job();
  const { step } = await r.jobs.requestExec(j.id, o.commands ?? ["npm ci", "npm test"], o.timeoutSec ?? 300, o.estimate ?? 3);
  const job = (await r.jobStore.getJobById(j.id))!;
  return { job, step: (await r.jobStore.getStep(j.id, step.idx))!, held: parseHolder(job.leaseHolder)! };
}
type Out = Awaited<ReturnType<typeof out>>;

/** The claims GitHub puts in the identity token of the run of this step (a push to its shadow branch, in our workflow). */
const claimsFor = (r: Rig, x: Out, over: Record<string, unknown> = {}) => ({
  repository_id: String(r.repo.id), repository: r.repo.fullName, event_name: "push", ref: `refs/heads/${x.held.branch}`, sha: x.held.sha,
  workflow_ref: `${r.repo.fullName}/${WORKFLOW}@refs/heads/${x.held.branch}`, run_id: "99", ...over,
});

/** The script's report, with a token as GitHub would give it. Everything can be bent for a test. */
async function report(r: Rig, x: Out, o: { body?: Record<string, unknown>; claims?: Record<string, unknown>; sign?: Parameters<Rig["oidc"]["sign"]>[1]; auth?: string } = {}) {
  const token = await r.oidc.sign(claimsFor(r, x, o.claims), o.sign);
  return r.actions!.handleResult(r.jobs, o.auth ?? `Bearer ${token}`, {
    jobId: x.job.id, stepIdx: x.step.idx, epoch: x.job.leaseEpoch, exitCode: 0, outputTail: "all passed", minutes: 0.5, ...o.body,
  });
}

/** What the person's job and the repo look like, so a refused report can be shown to have changed nothing. */
async function snapshot(r: Rig, x: Out) {
  return {
    job: await r.jobStore.getJobById(x.job.id), step: await r.jobStore.getStep(x.job.id, x.step.idx),
    branches: r.fake.branches(r.repo), work: r.fake.head(r.repo, r.branch), usage: await r.jobStore.getUsage("alice", "2026-10"),
  };
}

// ---------------------------------------------------------- the shadow branch

describe("a step on GitHub's free computers", () => {
  it("is one throwaway branch: a single new commit on the checkpoint with the three server-written files, and the work branch is not touched", async () => {
    const r = await rig({ actions: true });
    const headBefore = r.fake.head(r.repo, r.branch)!;
    const filesBefore = r.fake.files(r.repo, r.branch);
    const setupWrites = r.fake.writes().length;
    const x = await out(r, { commands: ["npm ci", "npm test"], timeoutSec: 300 });

    expect(x.job).toMatchObject({ state: "running", placement: "github", leaseEpoch: 1 });
    expect(x.held).toEqual({ branch: shadowBranchName(x.job.id, 0, 1), sha: expect.stringMatching(SHA40) });
    expect(x.held.branch).toMatch(/^tailzu-run\/[0-9a-f]{8}-0-1$/);
    expect(x.job.leaseHolder).toBe(`${x.held.branch}@${x.held.sha}`);
    expect(x.job.leaseExpiresAt).toBe(r.now() + LEASE_MS);
    expect(x.step).toMatchObject({ status: "dispatched", placement: "github", epoch: 1, startedAt: r.now() });

    // The branch exists, at one commit whose parent is where the work branch was, and nothing else was branched.
    expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch, x.held.branch].sort());
    expect(r.fake.head(r.repo, x.held.branch)).toBe(x.held.sha);
    expect(r.fake.parentsOf(r.repo, x.held.branch)).toEqual([headBefore]);
    // Exactly three files more than the work branch has, and the rest as it was.
    const files = r.fake.files(r.repo, x.held.branch);
    expect(Object.keys(files).filter((p) => !(p in filesBefore)).sort()).toEqual([...SHADOW_FILES].sort());
    for (const [p, c] of Object.entries(filesBefore)) expect(files[p], p).toBe(c);
    expect(Object.keys(files)).toHaveLength(Object.keys(filesBefore).length + 3);
    // What the three files hold.
    expect(files[WORKFLOW]).toBe(renderWorkflow(timeoutMinutes(300)));
    expect(files[".tailzu/run.mjs"]).toBe(RUN_MJS);
    expect(JSON.parse(files[".tailzu/step.json"]!)).toEqual({
      jobId: x.job.id, stepIdx: 0, epoch: 1, commands: ["npm ci", "npm test"], timeoutSec: 300, baseSha: headBefore,
      resultUrl: "https://api.tailzu.test/v1/code/runner/gh-result", audience: "tailzu",
    });
    // The commit is the bot's, and says what it is for.
    expect(r.fake.headCommit(r.repo, x.held.branch)).toMatchObject({ author: { name: "Blip" }, message: expect.stringMatching(/temporary branch/) });

    // The work branch is exactly as it was, and no write of the whole thing went near it.
    expect(r.fake.head(r.repo, r.branch)).toBe(headBefore);
    expect(r.fake.files(r.repo, r.branch)).toEqual(filesBefore);
    const writes = r.fake.writes().slice(setupWrites);
    expect(writes.map((c) => `${c.method} ${c.url.pathname.replace("/repos/alice/app", "")}`)).toEqual([
      "POST /git/trees", "POST /git/commits", "POST /git/refs",
    ]);
    expect(writes[2]!.body.ref).toBe(`refs/heads/${x.held.branch}`);
    // GitHub started the run for it; nothing is counted yet and nobody was told anything.
    expect(r.fake.runsOf(r.repo)).toEqual([expect.objectContaining({ branch: x.held.branch, headSha: x.held.sha, event: "push", status: "in_progress" })]);
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(0);
    expect(r.told).toEqual([]);
  });

  it("is made with a token that may write workflow files, and reads a run with one that may read Actions", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    const create = r.fake.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/git/refs")).at(-1)!;
    expect(create.body.ref).toBe(`refs/heads/${x.held.branch}`);
    const token = create.headers.authorization!.replace(/^Bearer /, "");
    expect(r.fake.tokenPermissions(token)).toMatchObject({ contents: "write", workflows: "write" });
    await r.jobs.tick();
    const list = r.fake.calls.find((c) => c.url.pathname.endsWith("/actions/runs"))!;
    expect(r.fake.tokenPermissions(list.headers.authorization!.replace(/^Bearer /, ""))).toMatchObject({ actions: "read" });
    expect(list.url.search).toBe(`?branch=${encodeURIComponent(x.held.branch)}&per_page=1`);
    expect(r.fake.tokenPermissions(list.headers.authorization!.replace(/^Bearer /, ""))).not.toHaveProperty("workflows");
  });

  it("sits on the checkpoint, not on wherever the work branch is now", async () => {
    const r = await rig({ actions: true });
    const j = await r.job();
    const checkpoint = r.fake.head(r.repo, r.branch)!;
    await r.jobs.addEditStep(j.id, { summary: "edited", files: ["src/a.ts"], headSha: checkpoint });
    const moved = r.fake.push(r.repo, r.branch, { "late.txt": "pushed after the checkpoint\n" });
    expect(moved).not.toBe(checkpoint);
    await r.jobs.requestExec(j.id, ["ls"], 60, 1);
    const held = parseHolder((await r.jobStore.getJobById(j.id))!.leaseHolder)!;
    expect(r.fake.parentsOf(r.repo, held.branch)).toEqual([checkpoint]);
    expect(r.fake.files(r.repo, held.branch)).not.toHaveProperty("late.txt");
    expect(JSON.parse(r.fake.files(r.repo, held.branch)[".tailzu/step.json"]!).baseSha).toBe(checkpoint);
    // The branch moved on is still where it moved to.
    expect(r.fake.head(r.repo, r.branch)).toBe(moved);
  });

  it("takes the branch's head when no step has finished yet (there is no checkpoint)", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    expect(x.job.checkpoint.headSha).toBe("");
    expect(r.fake.parentsOf(r.repo, x.held.branch)).toEqual([r.fake.head(r.repo, r.branch)]);
  });

  it("reports back through the identity token: the result is counted once, the changes are committed to the WORK branch by the server, and the shadow branch is deleted", async () => {
    const r = await rig({ actions: true });
    const x = await out(r, { commands: ["npm run build"] });
    const ack = await report(r, x, {
      body: { minutes: 0.4, outputTail: "built", changes: [{ path: "dist/report.txt", content: "12 passed\n" }, { path: "src/a.ts", content: "export const a = 2;\n" }] },
    });
    expect(ack).toMatchObject({ ok: true, state: "running", committed: true, sha: expect.stringMatching(SHA40) });
    // The server committed the runner's files to the work branch as the bot; the throwaway branch is gone.
    expect(r.fake.files(r.repo, r.branch)).toMatchObject({ "dist/report.txt": "12 passed\n", "src/a.ts": "export const a = 2;\n" });
    expect(r.fake.head(r.repo, r.branch)).toBe(ack.sha);
    expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
    expect(Object.keys(r.fake.files(r.repo, r.branch)).some((p) => p.startsWith(".tailzu"))).toBe(false);
    // The step and the job moved on, the checkpoint is the new commit, and the minute was counted.
    const done = (await r.jobs.jobWithSteps("alice", x.job.id));
    expect(done.steps[0]).toMatchObject({ status: "done", exitCode: 0, outputTail: "built", minutes: 1, placement: "github" });
    expect(done.job).toMatchObject({ state: "running", placement: "none", leaseHolder: null, checkpoint: { stepIndex: 0, headSha: ack.sha } });
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(1);
    // The same report again changes nothing.
    expect(await report(r, x, { body: { minutes: 0.4, outputTail: "built" } })).toMatchObject({ ok: true, duplicate: true });
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(1);
  });

  it("deletes the shadow branch after a step that failed, too, and commits nothing from it", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    const head = r.fake.head(r.repo, r.branch);
    const ack = await report(r, x, { body: { exitCode: 2, outputTail: "tests failed", changes: [{ path: "x.txt", content: "no\n" }] } });
    expect(ack).toMatchObject({ ok: true, committed: false, changesIgnored: true });
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
    expect((await r.jobStore.getStep(x.job.id, 0))).toMatchObject({ status: "failed", exitCode: 2 });
  });

  it("goes to the next place when the shadow branch can't be made: the job waits, nothing is left behind, and the person is told", async () => {
    const r = await rig({ actions: true });
    r.fake.failWith = { prefix: "/repos/alice/app/git/refs", status: 500 };
    const x = await out(r);
    expect(x.job).toMatchObject({ state: "waiting_for_compute", placement: "none", leaseHolder: null });
    expect(x.step.status).toBe("pending");
    expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
    expect(r.toldOf("compute_paused")).toHaveLength(1);
  });

  it("is left alone when the person switched GitHub's computers off", async () => {
    const r = await rig({ actions: true });
    await r.jobs.saveSettings("alice", { githubEnabled: false });
    const x = await out(r);
    expect(x.job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
    expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
    expect(r.fake.calls.some((c) => c.url.pathname.includes("/actions/"))).toBe(false);
    await r.jobs.saveSettings("alice", { githubEnabled: true });
    expect((await r.jobStore.getJobById(x.job.id))).toMatchObject({ state: "running", placement: "github" });
  });

  it("deletes the branch it just made if another server moved the job before the holder was written (no orphan, no run left going)", async () => {
    const r = await rig({ actions: { permissions: { ...ACTIONS_PERMISSIONS, actions: "write" } } });
    const original = r.jobStore.casJob.bind(r.jobStore);
    r.jobStore.casJob = async (id, expectation, patch) => {
      if (typeof patch.leaseHolder === "string") await original(id, {}, { leaseEpoch: 99 }); // somebody else got there first
      return original(id, expectation, patch);
    };
    await out(r);
    expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
    expect(r.fake.runsOf(r.repo)[0]).toMatchObject({ status: "completed", conclusion: "cancelled" });
  });

  it("lets go of the branch when the job is cancelled while the step is out: the run is cancelled if the App may, the branch is deleted, and the late report is refused", async () => {
    const r = await rig({ actions: { permissions: { ...ACTIONS_PERMISSIONS, actions: "write" } } });
    const x = await out(r);
    await r.jobs.cancelJob(x.job.id);
    expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
    expect(r.fake.runsOf(r.repo)[0]).toMatchObject({ status: "completed", conclusion: "cancelled" });
    await expect(report(r, x)).rejects.toMatchObject({ code: "stale_lease" });
  });
});

// ------------------------------------------------------------------- policy

describe("the policy around the runner's branch and files", () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    project: { id: "p" }, branch: "tailzu-run/3f9a1c2b-0-1", defaultBranch: "main", attended: false, connection: "app" as const, scopes: [], server: true, ...over,
  });

  it("has runner.shadow as a free action, and runner.reserved as a never", () => {
    expect(ACTIONS["runner.shadow"].tier).toBe("free");
    expect(ACTIONS["runner.reserved"].tier).toBe("never");
    expect(decide("runner.reserved", ctx())).toMatchObject({ effect: "deny", tier: "never" });
  });

  it("allows runner.shadow only for the server, on a tailzu-run/ ref, with exactly the three files (or none, to delete)", () => {
    expect(decide("runner.shadow", ctx({ paths: [...SHADOW_FILES] }))).toMatchObject({ effect: "allow", tier: "free" });
    expect(decide("runner.shadow", ctx())).toMatchObject({ effect: "allow" }); // a delete holds no files
    expect(decide("runner.shadow", ctx({ paths: [...SHADOW_FILES].reverse() }))).toMatchObject({ effect: "allow" });
    // Not the server (an agent's commit, a runner's changes): never.
    expect(decide("runner.shadow", ctx({ server: false, paths: [...SHADOW_FILES] }))).toMatchObject({ effect: "deny", reason: "never" });
    expect(decide("runner.shadow", ctx({ server: undefined }))).toMatchObject({ effect: "deny", reason: "never" });
    // Another ref.
    for (const branch of ["main", "tailzu/make-it-pass-1a2b", "Tailzu-Run/3f9a1c2b-0-1", "tailzu-runs/x", "tailzu-run", undefined, "tailzu-run/../main"]) {
      expect(decide("runner.shadow", ctx({ branch })), String(branch)).toMatchObject({ effect: "deny", reason: "never" });
    }
    // Other files, more files, fewer files, a file twice.
    for (const paths of [
      [...SHADOW_FILES, "src/a.ts"], [".tailzu/step.json"], [WORKFLOW, ".tailzu/step.json", ".tailzu/other.mjs"], [WORKFLOW, WORKFLOW, ".tailzu/run.mjs"], ["src/a.ts"], [],
    ]) {
      expect(decide("runner.shadow", ctx({ paths })), paths.join(",")).toMatchObject({ effect: "deny", reason: "never" });
    }
  });

  it("a person's deny for runner.shadow stops the provider (free actions can be forbidden): the step goes elsewhere and no branch is made", async () => {
    const r = await rig({ actions: true });
    await r.store.addGrant(r.project.id, { action: "runner.shadow", effect: "deny" });
    const x = await out(r);
    expect(x.job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
    expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
  });

  it("refuses an agent's commit that touches .tailzu/ or the runner's workflow, whatever else is true, and no grant lifts it", async () => {
    const r = await rig({ actions: true });
    await r.store.addGrant(r.project.id, { action: "workflow.write", effect: "allow" });
    await r.store.addGrant(r.project.id, { action: "commit.other_branch", effect: "allow" });
    const head = r.fake.head(r.repo, r.branch);
    for (const path of [".tailzu/step.json", ".tailzu/run.mjs", ".tailzu/new-file.txt", ".TAILZU/x", ".github/workflows/tailzu-run.yml", ".GitHub/Workflows/Tailzu-Run.yml"]) {
      for (const branch of [r.branch, "main"]) {
        const err = await commitToBranch(r.d, "alice", r.project.id, branch, [{ path, content: "x\n" }], "sneaky").catch((e) => e);
        expect(err, `${path} on ${branch}`).toBeInstanceOf(PolicyError);
        expect(err).toMatchObject({ code: "never", info: { action: "runner.reserved", tier: "never", faceId: false } });
      }
    }
    // Deleting them is as much a write.
    await expect(commitToBranch(r.d, "alice", r.project.id, r.branch, [{ path: ".tailzu/step.json", content: null }], "no")).rejects.toMatchObject({ code: "never" });
    // One of them among ordinary files refuses the whole commit.
    await expect(commitToBranch(r.d, "alice", r.project.id, r.branch, [{ path: "a.txt", content: "ok\n" }, { path: ".tailzu/x", content: "y" }], "mixed")).rejects.toMatchObject({ code: "never" });
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    // Through the workspace the agent holds, the same.
    const ws = await workspace(r.d, "alice", r.project.id, r.branch);
    await expect(ws.commit([{ path: ".tailzu/step.json", content: "{}" }], "via the workspace")).rejects.toMatchObject({ code: "never" });
    // Ordinary files, and an ordinary workflow, are as they were: the first is free, the other a question.
    expect(await commitToBranch(r.d, "alice", r.project.id, r.branch, [{ path: "tailzu-notes.md", content: "fine\n" }], "ok")).toMatchObject({ sha: expect.stringMatching(SHA40) });
    const wf = await commitToBranch(r.d, "alice", r.project.id, r.branch, [{ path: ".github/workflows/ci.yml", content: "name: ci\n" }], "a workflow", { attended: true });
    expect(isNeedsApproval(wf) || "sha" in wf).toBe(true);
  });

  it("refuses an agent making or moving a tailzu-run/ branch: a commit to one, a force-push to one, a sync of one", async () => {
    const r = await rig({ actions: true });
    const shadowName = "tailzu-run/3f9a1c2b-0-1";
    const setupWrites = r.fake.writes().length;
    await expect(commitToBranch(r.d, "alice", r.project.id, shadowName, [{ path: "a.txt", content: "x\n" }], "m")).rejects.toMatchObject({ code: "never", info: { action: "runner.reserved" } });
    await expect(commitToBranch(r.d, "alice", r.project.id, "TAILZU-RUN/x", [{ path: "a.txt", content: "x\n" }], "m")).rejects.toMatchObject({ code: "never" });
    await expect(forceUpdateBranch(r.d, "alice", r.project.id, shadowName, "a".repeat(40))).rejects.toMatchObject({ code: "never" });
    await expect(syncBranch(r.d, "alice", r.project.id, shadowName)).rejects.toMatchObject({ code: "never" });
    expect(r.fake.writes().length).toBe(setupWrites);
  });

  it("refuses a runner's changes that touch the runner's files: nothing is committed, the step fails with `never`, and the branch is still deleted", async () => {
    for (const bad of [".tailzu/step.json", ".tailzu/run.mjs", ".tailzu/extra", WORKFLOW]) {
      const r = await rig({ actions: true });
      const x = await out(r);
      const head = r.fake.head(r.repo, r.branch);
      const ack = await report(r, x, { body: { changes: [{ path: "ok.txt", content: "fine\n" }, { path: bad, content: "tampered\n" }] } });
      expect(ack, bad).toMatchObject({ ok: true, committed: false, refused: "never" });
      expect(r.fake.head(r.repo, r.branch), bad).toBe(head);
      expect(r.fake.files(r.repo, r.branch)).not.toHaveProperty("ok.txt");
      expect(await r.jobStore.getStep(x.job.id, 0)).toMatchObject({ status: "failed", outputTail: expect.stringContaining("did not commit the changes: never") });
      expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
    }
  });

  it("refuses a PC's changes to those files the same way", async () => {
    const r = await rig();
    await r.beat(LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["ls"], 60, 1);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    const ack = await r.jobs.submitResult("alice", {
      jobId: j.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: ".tailzu/run.mjs", content: "evil" }],
    });
    expect(ack).toMatchObject({ committed: false, refused: "never" });
  });
});

// ------------------------------------------------------------ the permissions

describe("when GitHub's free computers can't be used", () => {
  const ask = (r: Rig) => r.actions!.available({ userId: "alice", projectId: r.project.id, jobId: "j", estimateMinutes: 3, now: r.now() });

  it("needs the install to have Workflows: write and Actions: read (or write); without either, `needs_workflow_permission`", async () => {
    const base = { contents: "write", pull_requests: "write", metadata: "read" };
    const cases: Array<[string, Record<string, string>, boolean]> = [
      ["neither", base, false], ["workflows only", { ...base, workflows: "write" }, false], ["actions only", { ...base, actions: "read" }, false],
      ["workflows read, actions read", { ...base, workflows: "read", actions: "read" }, false], ["workflows write, actions read", { ...base, workflows: "write", actions: "read" }, true],
      ["workflows write, actions write", { ...base, workflows: "write", actions: "write" }, true],
    ];
    for (const [name, permissions, ok] of cases) {
      const r = await rig({ actions: { permissions } });
      expect(await ask(r), name).toEqual(ok ? expect.objectContaining({ ok: true, places: 1 }) : { ok: false, reason: "needs_workflow_permission" });
    }
  });

  it("is moved past by the router: with a PC the step runs there, with none the job waits and says what is missing", async () => {
    const r = await rig({ actions: { permissions: { contents: "write", pull_requests: "write", metadata: "read" } } });
    const x = await out(r);
    expect(x.job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
    expect(x.job.reason).toMatch(/Workflows and Actions permissions/);
    expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
    expect(r.toldOf("compute_paused")).toHaveLength(1);
    // The person gives the App the permissions on GitHub: a couple of minutes later the job goes on by itself.
    r.fake.installs.get(101)!.permissions = { ...ACTIONS_PERMISSIONS };
    r.advance(3 * MIN);
    await r.jobs.tick();
    expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ state: "running", placement: "github" });

    const r2 = await rig({ actions: { permissions: { contents: "write", pull_requests: "write", metadata: "read" } } });
    await r2.beat(LAPTOP);
    expect((await out(r2)).job).toMatchObject({ placement: "desktop", leaseHolder: LAPTOP });
  });

  it("is unavailable for a project that isn't the person's, or isn't there", async () => {
    const r = await rig({ actions: true });
    expect(await r.actions!.available({ userId: "bob", projectId: r.project.id, jobId: "j", estimateMinutes: 1, now: r.now() })).toEqual({ ok: false, reason: "not_found" });
    expect(await r.actions!.available({ userId: "alice", projectId: "nope", jobId: "j", estimateMinutes: 1, now: r.now() })).toEqual({ ok: false, reason: "not_found" });
    expect(await ask(r)).toMatchObject({ ok: true });
  });
});

describe("a sign-in connection (no App install)", () => {
  /** Alice signed in with GitHub, a repo of hers added as a project through it, a work branch, and the real provider on top. */
  async function viaSignIn(o: { workflow?: boolean } = {}) {
    const fake = new FakeGithub(KEYS);
    const now = () => fake.clock.t;
    const store = new MemoryCodeStore(now);
    const code = createCode({
      store, webhookSecret: null, fetchFn: fake.fetchFn, now, app: null,
      oauth: { clientId: fake.oauthClientId, clientSecret: fake.oauthClientSecret }, oauthEnabled: true,
    });
    const signIn = async (workflow: boolean) => {
      const url = new URL((workflow ? await code.oauth!.beginWorkflow("alice") : await code.oauth!.begin("alice")).authorizeUrl);
      fake.addOAuthPerson(`code-${workflow}`, `gho_alice_${workflow}`, "alice", {
        scopes: workflow ? ["repo", "read:user", "workflow"] : ["repo", "read:user"], challenge: url.searchParams.get("code_challenge") ?? undefined,
      });
      await code.oauth!.complete(`code-${workflow}`, url.searchParams.get("state")!);
    };
    await signIn(o.workflow === true);
    const repo = fake.addRepo(900, "alice/app", { files: { "README.md": "# app\n" } });
    const d = projectDepsOf(code)!;
    const { project } = await addProject(d, "alice", repo.id);
    const { branch } = await createWorkBranch(d, "alice", project.id, "make it pass");
    const jobStore = new MemoryJobStore(now);
    const actions = createGithubActions({ code, store: jobStore, now, keys: async () => OIDC.publicKey, resultUrl: "https://api.tailzu.test/gh" })!;
    const jobs = createJobs({ code, store: jobStore, github: actions, now })!;
    return { fake, code, d, repo, project, branch, jobStore, actions, jobs, signIn };
  }

  it("needs the `workflow` scope, from the incremental sign-in (oauth.beginWorkflow); without it `needs_workflow_permission`, and the step waits", async () => {
    const s = await viaSignIn();
    expect(s.project.linkKind).toBe("oauth");
    const ctx = { userId: "alice", projectId: s.project.id, jobId: "j", estimateMinutes: 1, now: s.fake.clock.t };
    expect(await s.actions.available(ctx)).toEqual({ ok: false, reason: "needs_workflow_permission" });
    const job = await s.jobs.createJob("alice", s.project.id, s.branch, "t");
    const placed = await s.jobs.requestExec(job.id, ["ls"], 60, 1);
    expect(placed.job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
    expect(s.fake.branches(s.repo).sort()).toEqual(["main", s.branch].sort());

    // She signs in again for the extra scope; a couple of minutes later the provider sees it and the job goes on.
    await s.signIn(true);
    s.fake.clock.t += 3 * MIN;
    expect(await s.actions.available(ctx)).toMatchObject({ ok: true });
    await s.jobs.tick();
    expect(await s.jobStore.getJobById(job.id)).toMatchObject({ state: "running", placement: "github" });
  });

  it("makes and deletes the shadow branch with the person's own token (the one that has the scope), and reports back as with the App", async () => {
    const s = await viaSignIn({ workflow: true });
    const job = await s.jobs.createJob("alice", s.project.id, s.branch, "t");
    await s.jobs.requestExec(job.id, ["ls"], 60, 1);
    const live = (await s.jobStore.getJobById(job.id))!;
    const held = parseHolder(live.leaseHolder)!;
    expect(live).toMatchObject({ placement: "github" });
    expect(s.fake.branches(s.repo)).toContain(held.branch);
    expect(Object.keys(s.fake.files(s.repo, held.branch))).toEqual(expect.arrayContaining([...SHADOW_FILES]));
    const create = s.fake.calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/git/refs"))!;
    expect(create.headers.authorization).toBe("Bearer gho_alice_true");
    const sign = (over: Record<string, unknown> = {}) => new SignJWT({
      repository_id: String(s.repo.id), event_name: "push", ref: `refs/heads/${held.branch}`, sha: held.sha,
      workflow_ref: `alice/app/${WORKFLOW}@refs/heads/${held.branch}`, ...over,
    }).setProtectedHeader({ alg: "RS256" }).setIssuer(OIDC_ISSUER).setAudience("tailzu")
      .setIssuedAt(Math.floor(s.fake.clock.t / 1000)).setExpirationTime(Math.floor(s.fake.clock.t / 1000) + 600).sign(OIDC.privateKey);
    const ack = await s.actions.handleResult(s.jobs, `Bearer ${await sign()}`, {
      jobId: job.id, stepIdx: 0, epoch: 1, exitCode: 0, outputTail: "ok", minutes: 1, changes: [{ path: "out.txt", content: "x\n" }],
    });
    expect(ack).toMatchObject({ committed: true });
    expect(s.fake.branches(s.repo)).not.toContain(held.branch);
    expect(s.fake.files(s.repo, s.branch)).toMatchObject({ "out.txt": "x\n" });
  });
});

// ---------------------------------------------------------- the identity token

describe("the identity token on a result", () => {
  it("is accepted when it is GitHub's, for this repo, a push, this step's branch, our workflow and the commit the server made", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    expect(await report(r, x)).toMatchObject({ ok: true, committed: false });
    expect((await r.jobStore.getStep(x.job.id, 0))!.status).toBe("done");
  });

  /** Every way a token can be wrong: what is bent, how, and the refusal. Each leaves the job, the repo and the month's use exactly as they were. */
  const BAD: Array<[string, (r: Rig, x: Out) => Parameters<typeof report>[2], string]> = [
    ["the wrong audience", () => ({ sign: { aud: "someone-else" } }), "bad_runner_token"],
    ["the wrong issuer", () => ({ sign: { iss: "https://evil.example.com" } }), "bad_runner_token"],
    ["expired", (r) => ({ sign: { exp: Math.floor(r.now() / 1000) - 100, iat: Math.floor(r.now() / 1000) - 700 } }), "bad_runner_token"],
    ["not yet valid (nbf)", (r) => ({ sign: { nbf: Math.floor(r.now() / 1000) + 600 } }), "bad_runner_token"],
    ["signed with some other key", async () => ({ sign: { key: (await generateKeyPair("RS256")).privateKey } }), "bad_runner_token"],
    ["no Authorization header", () => ({ auth: "" }), "bad_runner_token"],
    ["not a Bearer", () => ({ auth: "Basic abc" }), "bad_runner_token"],
    ["not a token at all", () => ({ auth: "Bearer not.a.jwt" }), "bad_runner_token"],
    ["the wrong repo", () => ({ claims: { repository_id: "999999" } }), "runner_mismatch"],
    ["no repo id", () => ({ claims: { repository_id: undefined } }), "runner_mismatch"],
    ["a branch of another step", (_r, x) => ({ claims: { ref: `refs/heads/${shadowBranchName(x.job.id, 1, 1)}` } }), "runner_mismatch"],
    ["the work branch", (r) => ({ claims: { ref: `refs/heads/${r.branch}` } }), "runner_mismatch"],
    ["a tag, not the branch", (_r, x) => ({ claims: { ref: `refs/tags/${x.held.branch}` } }), "runner_mismatch"],
    ["another commit", () => ({ claims: { sha: "f".repeat(40) } }), "runner_mismatch"],
    ["no commit", () => ({ claims: { sha: undefined } }), "runner_mismatch"],
    ["another workflow", (r, x) => ({ claims: { workflow_ref: `${r.repo.fullName}/.github/workflows/ci.yml@refs/heads/${x.held.branch}` } }), "runner_mismatch"],
    ["our workflow on another ref", (r) => ({ claims: { workflow_ref: `${r.repo.fullName}/${WORKFLOW}@refs/heads/main` } }), "runner_mismatch"],
    ["no workflow", () => ({ claims: { workflow_ref: undefined } }), "runner_mismatch"],
    ["a pull request event", () => ({ claims: { event_name: "pull_request" } }), "runner_mismatch"],
    ["a manual run", () => ({ claims: { event_name: "workflow_dispatch" } }), "runner_mismatch"],
    ["an epoch the token's branch isn't for", (_r, x) => ({ body: { epoch: x.job.leaseEpoch + 1 } }), "runner_mismatch"],
    ["another step number", (_r, x) => ({ body: { stepIdx: x.step.idx + 1 } }), "runner_mismatch"],
  ];

  it.each(BAD)("is refused when it is %s", async (_name, bend, code) => {
    const r = await rig({ actions: true });
    const x = await out(r);
    const before = await snapshot(r, x);
    await expect(report(r, x, { ...(await bend(r, x)), body: { changes: [{ path: "x.txt", content: "forged\n" }], ...(await bend(r, x)).body } })).rejects.toMatchObject({ code });
    // Nothing happened: not counted, not committed, the branch (and the step) still out.
    expect(await snapshot(r, x)).toEqual(before);
    expect(r.fake.branches(r.repo)).toContain(x.held.branch);
    expect(before.job).toMatchObject({ state: "running", placement: "github" });
  });

  it("is refused when signed with HMAC and the public key as the secret (the algorithm is RS256 and nothing else)", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    const t = Math.floor(r.now() / 1000);
    const forged = await new SignJWT(claimsFor(r, x)).setProtectedHeader({ alg: "HS256" }).setIssuer(OIDC_ISSUER).setAudience("tailzu")
      .setIssuedAt(t).setExpirationTime(t + 600).sign(new TextEncoder().encode("secret"));
    await expect(report(r, x, { auth: `Bearer ${forged}` })).rejects.toMatchObject({ code: "bad_runner_token" });
  });

  it("is checked in this order: a token that isn't GitHub's is refused before anything is said about the job", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    await expect(r.actions!.handleResult(r.jobs, "Bearer junk", { jobId: "no-such-job", stepIdx: 0, epoch: 1, exitCode: 0, minutes: 1 })).rejects.toMatchObject({ code: "bad_runner_token" });
    const good = await r.oidc.sign(claimsFor(r, x));
    await expect(r.actions!.handleResult(r.jobs, `Bearer ${good}`, { jobId: "no-such-job", stepIdx: 0, epoch: 1, exitCode: 0, minutes: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(r.actions!.handleResult(r.jobs, `Bearer ${good}`, { stepIdx: 0, epoch: 1, exitCode: 0, minutes: 1 })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("is checked against the commit made for the step that is out: a token for a branch of the same name that holds some other commit is refused", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    // Somebody with push access recreates the branch name at another commit and gets GitHub to run it: the claims are all right but the sha.
    const other = r.fake.push(r.repo, r.branch, { "evil.txt": "x\n" });
    await expect(report(r, x, { claims: { sha: other } })).rejects.toMatchObject({ code: "runner_mismatch" });
  });

  it("uses GitHub's own key set by default (fetched when first needed), at the address GitHub publishes it", () => {
    expect(OIDC_ISSUER).toBe("https://token.actions.githubusercontent.com");
    expect(OIDC_JWKS_URL).toBe("https://token.actions.githubusercontent.com/.well-known/jwks");
  });

  it("uses CODE_RUNNER_OIDC_AUDIENCE (default tailzu) as the audience the script is told to ask for and the server accepts", async () => {
    resetConfigForTests();
    expect(getConfig().CODE_RUNNER_OIDC_AUDIENCE).toBe("tailzu");
    process.env.CODE_RUNNER_OIDC_AUDIENCE = "tailzu-staging";
    try {
      resetConfigForTests();
      expect(getConfig().CODE_RUNNER_OIDC_AUDIENCE).toBe("tailzu-staging");
      const r = await rig();
      const p = createGithubActions({ code: r.code, store: r.jobStore, keys: async () => OIDC.publicKey, now: r.now, resultUrl: "https://x.test/r" })!;
      expect((p as unknown as { audience: string }).audience).toBe("tailzu-staging");
    } finally {
      delete process.env.CODE_RUNNER_OIDC_AUDIENCE;
      resetConfigForTests();
    }
  });

  it("is the right kind of result address by default: PUBLIC_ORIGIN, or api.tailzu.space", () => {
    expect(runnerResultUrl()).toBe("https://api.tailzu.space/v1/code/runner/gh-result");
    process.env.PUBLIC_ORIGIN = "https://api.example.org/";
    try { expect(runnerResultUrl()).toBe("https://api.example.org/v1/code/runner/gh-result"); } finally { delete process.env.PUBLIC_ORIGIN; }
  });
});

describe("the epoch fence", () => {
  it("refuses a report from a run whose step was given to another place meanwhile, and still deletes the old branch", async () => {
    const r = await rig({ actions: true });
    const x = await out(r, { timeoutSec: 60 });
    // The run goes on far past its time; the step is moved to a PC.
    await r.beat(LAPTOP);
    r.advance(60 * SEC + GITHUB_OVERRUN_MS + 20 * SEC);
    await r.beat(LAPTOP);
    await r.jobs.tick();
    const moved = (await r.jobStore.getJobById(x.job.id))!;
    expect(moved).toMatchObject({ placement: "desktop", leaseEpoch: 2 });
    // The old run reports, late, with a token that is perfectly good for ITS branch.
    const head = r.fake.head(r.repo, r.branch);
    await expect(report(r, x, { body: { changes: [{ path: "late.txt", content: "from the old run\n" }] } })).rejects.toMatchObject({ code: "stale_lease" });
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ placement: "desktop", leaseEpoch: 2 });
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(0);
    expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
  });

  it("refuses a report for a job that has ended", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    await r.jobs.finishJob(x.job.id, { ok: false, reason: "no" });
    await expect(report(r, x)).rejects.toMatchObject({ code: "stale_lease" });
  });
});

// ----------------------------------------------------------- minutes and limits

describe("minutes", () => {
  it("are rounded up per job, as GitHub bills, and are at least one", async () => {
    for (const [reported, counted] of [[0, 1], [0.2, 1], [1, 1], [1.01, 2], [2.5, 3], [59.9, 60]] as const) {
      const r = await rig({ actions: true });
      const x = await out(r);
      await report(r, x, { body: { minutes: reported } });
      expect((await r.jobStore.getStep(x.job.id, 0))!.minutes, `${reported}`).toBe(counted);
      expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes, `${reported}`).toBe(counted);
    }
  });

  it("don't count toward the free estimate for a public repo (the step still records them), and a public repo isn't held back when the estimate is used up", async () => {
    const r = await rig({ actions: true, publicRepo: true, freeMinutes: 0 });
    expect(r.project.private).toBe(false);
    const x = await out(r, { estimate: 30 });
    expect(x.job).toMatchObject({ state: "running", placement: "github" });
    await report(r, x, { body: { minutes: 4.2 } });
    expect((await r.jobStore.getStep(x.job.id, 0))!.minutes).toBe(5);
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(0);
    expect((await r.jobs.settingsView("alice")).githubFreeMinutes).toMatchObject({ used: 0 });

    // A private repo with nothing left is held back.
    const p = await rig({ actions: true, freeMinutes: 0 });
    expect((await out(p)).job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
  });

  it("are held back for a private repo when the step would not fit in what is left", async () => {
    const r = await rig({ actions: true, freeMinutes: 20 }); // 18 are ours
    expect((await out(r, { estimate: 19 })).job).toMatchObject({ state: "waiting_for_compute" });
    const r2 = await rig({ actions: true, freeMinutes: 20 });
    expect((await out(r2, { estimate: 18 })).job).toMatchObject({ state: "running", placement: "github" });
  });
});

describe("the person's own CI", () => {
  const LOUD = "name: CI\non:\n  push:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
  const QUIET = "name: CI\non:\n  push:\n    branches: [main]\njobs: {}\n";
  const files = (wf?: Record<string, string>) => ({ "README.md": "# app\n", ...Object.fromEntries(Object.entries(wf ?? {}).map(([n, t]) => [`.github/workflows/${n}`, t])) });

  it("is read from the default branch before the project is used; a workflow that runs on every push is `ciNoise`, with an estimate of the extra minutes, and does not block", async () => {
    const r = await rig({ actions: true, files: files({ "ci.yml": LOUD, "lint.yaml": "on: push\njobs: {}\n", "main-only.yml": QUIET, "notes.txt": "on: push\n" }) });
    const noise = await r.actions!.ciNoiseFor("alice", r.project);
    expect(noise).toEqual({ ciNoise: true, extraMinutes: 6, workflows: [".github/workflows/ci.yml", ".github/workflows/lint.yaml"], checkedAt: r.now() });
    expect(await r.actions!.available({ userId: "alice", projectId: r.project.id, jobId: "j", estimateMinutes: 3, now: r.now() })).toEqual({ ok: true, places: 1, extraMinutes: 6 });
    // It didn't stop the step; the push is counted for the extra minutes on top of the run's own.
    const x = await out(r);
    expect(x.job).toMatchObject({ state: "running", placement: "github" });
    await report(r, x, { body: { minutes: 1.5 } });
    expect((await r.jobStore.getStep(x.job.id, 0))!.minutes).toBe(2);
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(2 + 6);
  });

  it("is quiet for a repo with no workflows, only branch-filtered ones, or a folder that can't be read", async () => {
    for (const wf of [{}, { "ci.yml": QUIET }]) {
      const r = await rig({ actions: true, files: files(wf) });
      expect(await r.actions!.ciNoiseFor("alice", r.project)).toMatchObject({ ciNoise: false, extraMinutes: 0, workflows: [] });
      expect(await r.actions!.available({ userId: "alice", projectId: r.project.id, jobId: "j", estimateMinutes: 3, now: r.now() })).toEqual({ ok: true, places: 1 });
    }
    const r = await rig({ actions: true, files: files({ "ci.yml": LOUD }) });
    r.fake.failWith = { prefix: "/repos/alice/app/contents", status: 500 };
    expect(await r.actions!.ciNoiseFor("alice", r.project)).toBeNull();
    expect((await out(r)).job).toMatchObject({ placement: "github" }); // not knowing is not a reason to stop
  });

  it("is read once an hour, and again after", async () => {
    const r = await rig({ actions: true, files: files({ "ci.yml": LOUD }) });
    const reads = () => r.fake.calls.filter((c) => c.url.pathname.endsWith("/contents/.github/workflows")).length;
    await r.actions!.ciNoiseFor("alice", r.project);
    await r.actions!.ciNoiseFor("alice", r.project);
    expect(reads()).toBe(1);
    r.advance(61 * MIN);
    await r.actions!.ciNoiseFor("alice", r.project);
    expect(reads()).toBe(2);
  });

  it("counts toward whether the step fits (the step and the extra both)", async () => {
    const r = await rig({ actions: true, freeMinutes: 20, files: files({ "ci.yml": LOUD }) }); // 18 are ours, and 3 go on the CI
    expect((await out(r, { estimate: 16 })).job).toMatchObject({ state: "waiting_for_compute" });
    const q = await rig({ actions: true, freeMinutes: 20, files: files({ "ci.yml": QUIET }) });
    expect((await out(q, { estimate: 16 })).job).toMatchObject({ state: "running", placement: "github" });
  });

  it("costs a public repo nothing", async () => {
    const r = await rig({ actions: true, publicRepo: true, files: files({ "ci.yml": LOUD }) });
    expect(await r.actions!.available({ userId: "alice", projectId: r.project.id, jobId: "j", estimateMinutes: 3, now: r.now() })).toEqual({ ok: true, places: 1, unmetered: true });
    const x = await out(r);
    await report(r, x, { body: { minutes: 1 } });
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(0);
  });
});

describe("what a report can claim", () => {
  it("can't say what counts: a billable or paise in the body is not believed, the server works out the minutes itself", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    await report(r, x, { body: { minutes: 0.5, billable: 0, paise: 5000 } });
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(1);
    expect((await r.jobStore.getJobById(x.job.id))!.spentPaise).toBe(0);
    const r2 = await rig({ actions: true });
    const y = await out(r2);
    await report(r2, y, { body: { minutes: 0.5, billable: 99999 } });
    expect((await r2.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(1);
  });
});

describe("changes that need the person's yes", () => {
  it("wait for it as for a PC's: the step is blocked, the person is asked, the shadow branch is deleted anyway, and a yes commits them", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    const head = r.fake.head(r.repo, r.branch);
    const ack = await report(r, x, { body: { changes: [{ path: ".env", content: SECRET_ENV }, { path: "ok.txt", content: "fine\n" }] } });
    expect(ack).toMatchObject({ ok: true, committed: false, waitingForYou: true, state: "waiting_for_you" });
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
    expect(r.toldOf("commit_ask")).toHaveLength(1);
    const ask = await r.jobs.approveCommit("alice", x.job.id);
    expect(isNeedsApproval(ask)).toBe(true);
    const done = await r.jobs.approveCommit("alice", x.job.id, (ask as { approvalId: string }).approvalId);
    expect(done).toMatchObject({ committed: true });
    expect(r.fake.files(r.repo, r.branch)).toMatchObject({ "ok.txt": "fine\n" });
  });
});

describe("the GitHub client's calls for the runner", () => {
  it("makes a branch only under tailzu-run/, only on a commit, and says when the name is taken", async () => {
    const r = await rig({ actions: true });
    const repo = { installationId: 101, repoId: r.repo.id, fullName: r.repo.fullName, defaultBranch: "main", workflows: true };
    const parent = r.fake.head(r.repo, r.branch)!;
    const files = [{ path: WORKFLOW, content: "name: x\n" }];
    await expect(r.code.github!.createShadowBranch(repo, "tailzu/not-a-shadow", parent, files, "m")).rejects.toMatchObject({ code: "bad_branch" });
    await expect(r.code.github!.createShadowBranch(repo, "tailzu-run/abcd1234-0-1", "nope", files, "m")).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.code.github!.createShadowBranch(repo, "tailzu-run/abcd1234-0-1", parent, [{ path: "../x", content: "y" }], "m")).rejects.toMatchObject({ code: "bad_path" });
    const made = await r.code.github!.createShadowBranch(repo, "tailzu-run/abcd1234-0-1", parent, files, "m");
    expect(r.fake.head(r.repo, "tailzu-run/abcd1234-0-1")).toBe(made.sha);
    await expect(r.code.github!.createShadowBranch(repo, "tailzu-run/abcd1234-0-1", parent, files, "m")).rejects.toMatchObject({ code: "branch_exists" });
    // Without Workflows on the token, GitHub turns the workflow file down, in plain words.
    const noWf = { ...repo, workflows: false };
    await expect(r.code.github!.createShadowBranch(noWf, "tailzu-run/abcd1234-0-2", parent, files, "m")).rejects.toMatchObject({ code: "needs_workflow_scope" });
  });

  it("reads the newest run of a branch (none: null), cancels a run, and says no to a token without Actions", async () => {
    const r = await rig({ actions: { permissions: { ...ACTIONS_PERMISSIONS, actions: "write" } } });
    const x = await out(r);
    const base = { installationId: 101, repoId: r.repo.id, fullName: r.repo.fullName, defaultBranch: "main" };
    const run = await r.code.github!.latestRun({ ...base, actions: "read" }, x.held.branch);
    expect(run).toMatchObject({ status: "in_progress", conclusion: null, headSha: x.held.sha, event: "push", id: expect.any(Number), createdAt: r.now() });
    expect(await r.code.github!.latestRun({ ...base, actions: "read" }, "tailzu-run/00000000-9-9")).toBeNull();
    await expect(r.code.github!.latestRun(base, x.held.branch)).rejects.toMatchObject({ code: "forbidden" });
    await expect(r.code.github!.cancelRun({ ...base, actions: "read" }, run!.id)).rejects.toMatchObject({ code: "forbidden" });
    await r.code.github!.cancelRun({ ...base, actions: "write" }, run!.id);
    await r.code.github!.cancelRun({ ...base, actions: "write" }, run!.id); // over already: fine
    expect((await r.code.github!.latestRun({ ...base, actions: "read" }, x.held.branch))).toMatchObject({ status: "completed", conclusion: "cancelled" });
    await expect(r.code.github!.cancelRun({ ...base, actions: "write" }, -1)).rejects.toMatchObject({ code: "bad_request" });
  });

  it("lists a folder (none: an empty list) and tells the install's permissions as GitHub says them", async () => {
    const r = await rig({ actions: true, files: { "README.md": "x", ".github/workflows/a.yml": "on: push\n", ".github/workflows/b.yml": "on: push\n" } });
    const repo = { installationId: 101, repoId: r.repo.id, fullName: r.repo.fullName, defaultBranch: "main" };
    expect((await r.code.github!.listDir(repo, ".github/workflows", "main")).map((e) => e.name)).toEqual(["a.yml", "b.yml"]);
    expect(await r.code.github!.listDir(repo, ".github/nothing", "main")).toEqual([]);
    expect(await r.code.github!.installationPermissions(101)).toEqual(ACTIONS_PERMISSIONS);
    expect(await r.code.github!.installationScopes(101)).toEqual(expect.arrayContaining(["contents", "pull_requests", "workflow"]));
    expect(await r.code.github!.installationScopes(101)).not.toContain("actions"); // read only: the scopes list is what can be written
  });
});

describe("the placement rule for GitHub's computers", () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    desktops: 0, githubEnabled: true, githubMinutesLeft: 10, paidRule: "never" as const, paidAvailable: false, paidLeftPaise: 0, estimateMinutes: 4, estimatePaise: 0, ...over,
  });

  it("counts the extra minutes of the person's own CI with the step, and not at all for an unmetered (public) repo", () => {
    expect(choosePlacement(ctx())).toMatchObject({ placement: "github" });
    expect(choosePlacement(ctx({ githubExtraMinutes: 6 }))).toMatchObject({ placement: "github" });
    expect(choosePlacement(ctx({ githubExtraMinutes: 7 }))).toMatchObject({ wait: true });
    expect(choosePlacement(ctx({ githubExtraMinutes: 700, githubUnmetered: true, githubMinutesLeft: 0 }))).toMatchObject({ placement: "github" });
    expect(choosePlacement(ctx({ githubUnmetered: true, githubEnabled: false }))).toMatchObject({ wait: true });
  });

  it("says in plain words why it isn't set up when the provider said needs_workflow_permission", () => {
    const w = choosePlacement(ctx({ githubEnabled: false, githubWhy: "needs_workflow_permission" }));
    expect(w).toMatchObject({ wait: true, reason: expect.stringMatching(/Workflows and Actions permissions/) });
    expect(choosePlacement(ctx({ githubEnabled: false, githubWhy: "something_else" }))).toMatchObject({ reason: expect.stringMatching(/aren't set up for this project/) });
    expect(choosePlacement(ctx({ githubEnabled: false }))).toMatchObject({ reason: expect.stringMatching(/aren't set up for this project/) });
    expect(choosePlacement(ctx({ githubMinutesLeft: 0 }))).toMatchObject({ reason: expect.stringMatching(/free GitHub minutes are used up/) });
  });
});

// ---------------------------------------------------------------- the ticker

describe("the ticker, looking at a step on GitHub", () => {
  it("keeps the lease alive while the run goes on, far past 90 seconds, and the step is not moved", async () => {
    const r = await rig({ actions: true });
    const x = await out(r, { timeoutSec: 600 });
    for (let i = 0; i < 12; i += 1) {
      r.advance(45 * SEC);
      await r.jobs.tick();
      const j = (await r.jobStore.getJobById(x.job.id))!;
      expect(j, `after ${(i + 1) * 45} seconds`).toMatchObject({ state: "running", placement: "github", leaseEpoch: 1, leaseHolder: x.job.leaseHolder, reassignments: 0 });
      expect(j.leaseExpiresAt).toBe(r.now() + LEASE_MS);
    }
    // 9 minutes in, it reports as usual.
    expect(await report(r, x, { body: { minutes: 8.7 } })).toMatchObject({ ok: true });
    expect((await r.jobStore.getUsage("alice", "2026-10")).githubMinutes).toBe(9);
  });

  it("without the ticker the lease runs out, as for any place that went quiet (it is the ticker that keeps it)", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    r.advance(LEASE_MS + 1);
    const lost = (await r.jobStore.listExpired(r.now(), 10)).map((j) => j.id);
    expect(lost).toEqual([x.job.id]);
  });

  describe("a run that never appears, or ends without reporting (the free minutes are used up, or Actions is off)", () => {
    it("is waited for three minutes; after that the person's GitHub minutes are marked used up for the month, the step is moved from the checkpoint, the branch is deleted and the person gets job_moved", async () => {
      const r = await rig({ actions: true });
      r.fake.actionsDown.add(r.repo.id);
      const x = await out(r);
      expect(r.fake.runsOf(r.repo)).toEqual([]);
      r.advance(GITHUB_NO_RUN_MS - 30 * SEC);
      await r.jobs.tick();
      expect(await r.jobStore.isGithubExhausted("alice", "2026-10")).toBe(false);
      expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ placement: "github", leaseEpoch: 1 });

      await r.beat(LAPTOP);
      r.advance(31 * SEC);
      const report1 = await r.jobs.tick();
      expect(report1).toMatchObject({ expired: 1, moved: 1, failed: 0 });
      expect(await r.jobStore.isGithubExhausted("alice", "2026-10")).toBe(true);
      expect(await r.jobStore.isGithubExhausted("alice", "2026-11")).toBe(false);
      expect(await r.jobStore.isGithubExhausted("bob", "2026-10")).toBe(false);
      // Moved to the PC, with the same step, under a new lease.
      const moved = (await r.jobStore.getJobById(x.job.id))!;
      expect(moved).toMatchObject({ state: "running", placement: "desktop", leaseHolder: LAPTOP, leaseEpoch: 2, reassignments: 1 });
      expect(await r.jobStore.getStep(x.job.id, 0)).toMatchObject({ status: "dispatched", placement: "desktop", epoch: 2 });
      expect(r.toldOf("job_moved")).toEqual([{ userId: "alice", kind: "job_moved", data: expect.objectContaining({ jobId: x.job.id, from: "github", to: "desktop", stepIdx: 0 }) }]);
      expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
      // The month shows it.
      expect((await r.jobs.settingsView("alice")).githubFreeMinutes).toMatchObject({ exhausted: true, left: 0 });
    });

    it("stops the router choosing GitHub for that person for the rest of the month, whatever the count says; the new month gives it back", async () => {
      const r = await rig({ actions: true });
      await r.jobStore.markGithubExhausted("alice", "2026-10");
      const x = await out(r);
      expect(x.job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
      expect(x.job.reason).toMatch(/free GitHub minutes are used up/);
      expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
      // The same for a public repo, which is otherwise never held back.
      const pub = await rig({ actions: true, publicRepo: true });
      await pub.jobStore.markGithubExhausted("alice", "2026-10");
      expect((await out(pub)).job).toMatchObject({ state: "waiting_for_compute" });
      // November.
      r.advance(7 * 24 * 60 * MIN);
      expect(monthOf(r.now())).toBe("2026-11");
      await r.jobs.tick();
      expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ state: "running", placement: "github" });
    });

    it("is the same for a run that ended without reporting (failed, timed out, never started); a run someone cancelled by hand is moved without the flag", async () => {
      for (const [conclusion, flagged] of [["failure", true], ["startup_failure", true], ["timed_out", true], ["cancelled", false]] as const) {
        const r = await rig({ actions: true });
        const x = await out(r);
        await r.beat(LAPTOP);
        r.fake.finishRun(r.repo, x.held.branch, conclusion);
        r.advance(20 * SEC);
        await r.beat(LAPTOP);
        await r.jobs.tick();
        const j = (await r.jobStore.getJobById(x.job.id))!;
        expect(j, conclusion).toMatchObject({ placement: "desktop", leaseEpoch: 2, reassignments: 1 });
        expect(await r.jobStore.isGithubExhausted("alice", "2026-10"), conclusion).toBe(flagged);
        expect(r.toldOf("job_moved"), conclusion).toHaveLength(1);
        expect(r.fake.branches(r.repo), conclusion).not.toContain(x.held.branch);
      }
    });

    it("waits (the job is told it is paused) when there is nowhere else to go, and carries on by itself when a PC appears", async () => {
      const r = await rig({ actions: true });
      r.fake.actionsDown.add(r.repo.id);
      const x = await out(r);
      r.advance(GITHUB_NO_RUN_MS + 1);
      await r.jobs.tick();
      expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ state: "waiting_for_compute", placement: "none" });
      expect(r.toldOf("compute_paused")).toHaveLength(1);
      expect(r.toldOf("job_moved")).toEqual([]);
      await r.beat(LAPTOP);
      expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ state: "running", placement: "desktop" });
      expect(r.toldOf("job_moved")).toEqual([]); // it was never running anywhere else when the PC came: it was waiting
    });

    it("fails a job whose step has been lost five times, with the reason, like any lease lost too often", async () => {
      const r = await rig({ actions: true });
      const j = await r.job();
      await r.jobs.requestExec(j.id, ["ls"], 60, 1);
      // A run cancelled by hand is not taken for the minutes running out, so the step comes back to GitHub each time.
      for (let i = 1; i <= 5; i += 1) {
        const now = (await r.jobStore.getJobById(j.id))!;
        expect(now, `loss ${i}`).toMatchObject({ state: "running", placement: "github", leaseEpoch: i, reassignments: i - 1 });
        r.fake.finishRun(r.repo, parseHolder(now.leaseHolder)!.branch, "cancelled");
        r.advance(20 * SEC);
        await r.jobs.tick();
      }
      expect(await r.jobStore.getJobById(j.id)).toMatchObject({ state: "failed", reassignments: 5, reason: expect.stringMatching(/kept going quiet/) });
      expect(r.toldOf("job_failed")).toHaveLength(1);
      expect(r.fake.branches(r.repo).sort()).toEqual(["main", r.branch].sort());
    });
  });

  describe("a run that goes on past its time", () => {
    it("is given the step's own timeout and two minutes more; then, with Actions: read only, GitHub's own timeout is left to end it, the branch is deleted and the step is moved without marking the minutes used up", async () => {
      const r = await rig({ actions: true });
      const x = await out(r, { timeoutSec: 120 });
      await r.beat(LAPTOP);
      for (let t = 0; t < 120 + GITHUB_OVERRUN_MS / 1000; t += 30) {
        r.advance(30 * SEC);
        await r.beat(LAPTOP);
        await r.jobs.tick();
        expect(await r.jobStore.getJobById(x.job.id), `at ${t + 30}s`).toMatchObject({ placement: "github", leaseEpoch: 1 });
      }
      r.advance(15 * SEC); // 4 minutes and a bit: timeout (2) + 2
      await r.beat(LAPTOP);
      await r.jobs.tick();
      expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ placement: "desktop", leaseEpoch: 2 });
      expect(await r.jobStore.isGithubExhausted("alice", "2026-10")).toBe(false);
      // Not allowed to cancel: no cancel was tried, and the run is left to GitHub's own timeout-minutes.
      expect(r.fake.calls.filter((c) => c.url.pathname.endsWith("/cancel"))).toEqual([]);
      expect(r.fake.runsOf(r.repo)[0]).toMatchObject({ status: "in_progress", conclusion: null });
      expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
      expect(r.toldOf("job_moved")).toHaveLength(1);
    });

    it("is cancelled when the App has Actions: write", async () => {
      const r = await rig({ actions: { permissions: { ...ACTIONS_PERMISSIONS, actions: "write" } } });
      const x = await out(r, { timeoutSec: 60 });
      await r.beat(LAPTOP);
      for (let i = 0; i < 5; i += 1) { r.advance(45 * SEC); await r.beat(LAPTOP); await r.jobs.tick(); }
      expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ placement: "desktop", leaseEpoch: 2 });
      const cancels = r.fake.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/cancel"));
      expect(cancels).toHaveLength(1);
      expect(r.fake.tokenPermissions(cancels[0]!.headers.authorization!.replace(/^Bearer /, ""))).toMatchObject({ actions: "write" });
      expect(r.fake.runsOf(r.repo)[0]).toMatchObject({ status: "completed", conclusion: "cancelled" });
      expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
    });

    it("is judged by the clock alone when GitHub can't be asked: moved once it is long past its time, and not before", async () => {
      const r = await rig({ actions: true });
      const x = await out(r, { timeoutSec: 60 });
      r.fake.failWith = { prefix: "/repos/alice/app/actions", status: 500 };
      r.advance(5 * MIN); // past 60 seconds and two minutes more
      expect(await r.jobs.tick()).toMatchObject({ expired: 1, moved: 1 });
      // Not the minutes running out, so GitHub is still a place: the step starts again from the checkpoint, on a branch of its own.
      const again = (await r.jobStore.getJobById(x.job.id))!;
      expect(again).toMatchObject({ state: "running", placement: "github", leaseEpoch: 2, reassignments: 1 });
      expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
      expect(r.fake.branches(r.repo)).toContain(parseHolder(again.leaseHolder)!.branch);
      expect(await r.jobStore.isGithubExhausted("alice", "2026-10")).toBe(false);

      const r2 = await rig({ actions: true });
      const y = await out(r2, { timeoutSec: 600 });
      r2.fake.failWith = { prefix: "/repos/alice/app/actions", status: 500 };
      r2.advance(5 * MIN); // GitHub says nothing, and the step has time yet: not given up on, and not "no run" either
      expect(await r2.jobs.tick()).toMatchObject({ expired: 0 });
      expect(await r2.jobStore.getJobById(y.job.id)).toMatchObject({ placement: "github", leaseEpoch: 1, leaseExpiresAt: r2.now() + LEASE_MS });
    });
  });

  it("looks at the run once per tick per step, newest run on the branch only", async () => {
    const r = await rig({ actions: true });
    await out(r);
    r.fake.calls.length = 0;
    await r.jobs.tick();
    await r.jobs.tick();
    expect(r.fake.calls.filter((c) => c.url.pathname.endsWith("/actions/runs"))).toHaveLength(2);
  });

  it("ignores a run for some other commit on the branch name, as no run", async () => {
    const r = await rig({ actions: true });
    const x = await out(r);
    r.fake.runsOf(r.repo)[0]!.headSha = "e".repeat(40);
    r.advance(GITHUB_NO_RUN_MS + 1);
    await r.jobs.tick();
    expect(await r.jobStore.isGithubExhausted("alice", "2026-10")).toBe(true);
    expect((await r.jobStore.getJobById(x.job.id))!.placement).not.toBe("github");
  });
});

const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);

// ---------------------------------------------------------------------- routes

describe("the routes", () => {
  const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
  async function server(r: Rig, o: { provider?: boolean; code?: boolean } = {}) {
    const app = Fastify();
    registerCodeJobRoutes(app, {
      rateLimit: RL, code: o.code === false ? null : r.code, jobs: r.jobs, tickEveryMs: null, pollMs: 0, githubActions: o.provider === false ? null : r.actions,
    });
    await app.ready();
    return app;
  }

  it("POST /v1/code/runner/gh-result takes the result on GitHub's token alone (no session), and answers as /runner/result does", async () => {
    const r = await rig({ actions: true });
    const app = await server(r);
    const x = await out(r);
    const token = await r.oidc.sign(claimsFor(r, x));
    const res = await app.inject({
      method: "POST", url: "/v1/code/runner/gh-result", headers: { authorization: `Bearer ${token}` },
      payload: { jobId: x.job.id, stepIdx: 0, epoch: 1, exitCode: 0, outputTail: "ok", minutes: 0.3, changes: [{ path: "dist/x.txt", content: "x\n" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: "running", committed: true, sha: expect.stringMatching(SHA40) });
    expect(r.fake.files(r.repo, r.branch)).toMatchObject({ "dist/x.txt": "x\n" });
    expect(r.fake.branches(r.repo)).not.toContain(x.held.branch);
    await app.close();
  });

  it("answers 401 for a token that isn't GitHub's, 403 for a good one that is for something else, 409 for a stale epoch, 400 for a bad body", async () => {
    const r = await rig({ actions: true });
    const app = await server(r);
    const x = await out(r);
    const post = (token: string | null, payload: unknown) => app.inject({
      method: "POST", url: "/v1/code/runner/gh-result", ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), payload: payload as object,
    });
    const body = { jobId: x.job.id, stepIdx: 0, epoch: 1, exitCode: 0, outputTail: "", minutes: 1 };
    expect((await post(null, body)).statusCode).toBe(401);
    expect((await post(null, body)).json()).toMatchObject({ code: "bad_runner_token" });
    expect((await post("junk", body)).statusCode).toBe(401);
    expect((await post(await r.oidc.sign(claimsFor(r, x), { aud: "other" }), body)).statusCode).toBe(401);
    const wrongRepo = await post(await r.oidc.sign(claimsFor(r, x, { repository_id: "1" })), body);
    expect(wrongRepo.statusCode).toBe(403);
    expect(wrongRepo.json()).toMatchObject({ code: "runner_mismatch" });
    expect((await post(await r.oidc.sign(claimsFor(r, x)), { ...body, exitCode: "zero" })).statusCode).toBe(400);
    // The job is untouched by all of that, and then a stale epoch.
    expect(await r.jobStore.getJobById(x.job.id)).toMatchObject({ placement: "github", leaseEpoch: 1 });
    await r.jobs.cancelJob(x.job.id);
    const stale = await post(await r.oidc.sign(claimsFor(r, x)), body);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "stale_lease" });
    await app.close();
  });

  it("answers 404 code_off with the Code bot off, and 503 not_configured when this server has no GitHub provider", async () => {
    const r = await rig({ actions: true });
    const off = await server(r, { code: false });
    expect((await off.inject({ method: "POST", url: "/v1/code/runner/gh-result", payload: {} })).statusCode).toBe(404);
    expect((await off.inject({ method: "POST", url: "/v1/code/runner/gh-result", payload: {} })).json()).toMatchObject({ code: "code_off" });
    await off.close();
    const none = await server(r, { provider: false });
    const res = await none.inject({ method: "POST", url: "/v1/code/runner/gh-result", payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "not_configured" });
    await none.close();
  });

  it("GET /v1/code/projects/:id gives the project with ciNoise, the estimate of the extra minutes, and which workflows", async () => {
    const r = await rig({ actions: true, files: { "README.md": "# app\n", ".github/workflows/ci.yml": "on: push\njobs: {}\n", ".github/workflows/q.yml": "on:\n  push:\n    branches: [main]\n" } });
    const app = await server(r);
    const get = (user: string | null, id: string) => app.inject({ method: "GET", url: `/v1/code/projects/${id}`, ...(user ? { headers: { authorization: `Bearer ${user}` } } : {}) });
    const res = await get("alice", r.project.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().project).toMatchObject({
      id: r.project.id, fullName: "alice/app", private: true, linkKind: "app", ciNoise: true, ciNoiseMinutes: 3, ciNoiseWorkflows: [".github/workflows/ci.yml"],
    });
    expect((await get(null, r.project.id)).statusCode).toBe(401);
    expect((await get("bob", r.project.id)).statusCode).toBe(404);
    expect((await get("alice", "not-a-project")).statusCode).toBe(404);
    await app.close();

    const quiet = await rig({ actions: true });
    const app2 = await server(quiet);
    expect((await app2.inject({ method: "GET", url: `/v1/code/projects/${quiet.project.id}`, headers: { authorization: "Bearer alice" } })).json().project)
      .toMatchObject({ ciNoise: false, ciNoiseMinutes: 0, ciNoiseWorkflows: [] });
    await app2.close();

    // A server with no GitHub computers can't say: null, not false.
    const bare = await rig({ actions: true });
    const app3 = await server(bare, { provider: false });
    expect((await app3.inject({ method: "GET", url: `/v1/code/projects/${bare.project.id}`, headers: { authorization: "Bearer alice" } })).json().project)
      .toMatchObject({ ciNoise: null, ciNoiseMinutes: 0, ciNoiseWorkflows: [] });
    await app3.close();
  });

  it("shows on the compute settings that GitHub's minutes are used up this month, only when they are", async () => {
    const r = await rig({ actions: true });
    expect((await r.jobs.settingsView("alice")).githubFreeMinutes).toEqual({ allowance: 2000, headroomPercent: 10, used: 0, left: 1800 });
    await r.jobStore.markGithubExhausted("alice", "2026-10");
    expect((await r.jobs.settingsView("alice")).githubFreeMinutes).toEqual({ allowance: 2000, headroomPercent: 10, used: 0, left: 0, exhausted: true });
  });
});

describe("the wiring", () => {
  it("builds the provider whenever there is a GitHub client (the App or the sign-in), and not otherwise", async () => {
    const r = await rig();
    expect(createGithubActions({ code: r.code, store: r.jobStore })).toBeInstanceOf(GithubActionsProvider);
    expect(createGithubActions({ code: { ...r.code, github: null }, store: r.jobStore })).toBeNull();
    expect(projectDepsOf({ ...r.code, github: null })).toBeNull();
    expect(createJobs({ code: { ...r.code, github: null }, store: r.jobStore })).toBeNull();
  });

  it("is a place the router knows by its kind", async () => {
    const r = await rig({ actions: true });
    expect(r.actions!.kind).toBe("github");
    expect((await r.jobs.settingsView("alice")).providers).toEqual({ github: true, paid: true });
  });
});
