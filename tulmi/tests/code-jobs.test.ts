/**
 * The environment router (src/code/jobs/router.ts): where each step of a coding
 * job that needs a computer runs, and what happens when the place goes quiet.
 *
 * Everything runs against the fake GitHub (github-fake.ts), in-memory stores, a
 * fake place for GitHub's free computers and one for paid compute
 * (jobs-fakes.ts), and ONE fake clock the whole rig reads (jobs-rig.ts). The
 * placement rule itself, as a pure function, is in code-jobs-placement.test.ts;
 * the HTTP routes are in code-jobs-routes.test.ts.
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

const { rig, LAPTOP, DESKTOP, MIN, SEC, SECRET_ENV } = await import("./jobs-rig.js");
const { LEASE_MS, MAX_REASSIGNMENTS, LIVE_JOBS_MAX, monthKey } = await import("../src/code/jobs/types.js");
const { isNeedsApproval } = await import("../src/code/policy.js");
const { githubMinutesLeft } = await import("../src/code/jobs/placement.js");
type Rig = Awaited<ReturnType<typeof rig>>;

afterEach(() => { vi.useRealTimers(); });

/** Everything about a job, as the person would see it. */
const look = async (r: Rig, id: string) => r.jobs.jobWithSteps("alice", id);

/** A PC is online, a job asks for a step, and the PC has been given it. */
async function onPc(r: Rig, o: { commands?: string[]; estimate?: number } = {}) {
  await r.beat(LAPTOP);
  const j = await r.job();
  const { step } = await r.jobs.requestExec(j.id, o.commands ?? ["npm ci", "npm test"], 300, o.estimate ?? 3);
  const given = await r.jobs.next("alice", LAPTOP);
  return { job: j, step, given: given! };
}

describe("making a job", () => {
  it("starts queued on a branch X0 Bot made, with the task cut to 500 characters", async () => {
    const r = await rig();
    const j = await r.job("x".repeat(900), 250);
    expect(j).toMatchObject({
      userId: "alice", projectId: r.project.id, branch: r.branch, state: "queued", placement: "none", leaseHolder: null, leaseEpoch: 0,
      leaseExpiresAt: null, checkpoint: { stepIndex: -1, headSha: "", notes: "" }, budgetPaise: 250, spentPaise: 0, reassignments: 0, waitingOn: null,
    });
    expect([...j.task]).toHaveLength(500);
    expect((await r.jobs.listJobs("alice")).map((x) => x.id)).toEqual([j.id]);
  });

  it("is turned away for a blank task, a bad budget, a branch X0 Bot didn't make, a deleted branch, and somebody else's project", async () => {
    const r = await rig();
    await expect(r.jobs.createJob("alice", r.project.id, r.branch, "   ")).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.createJob("alice", r.project.id, r.branch, "t", -1)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.createJob("alice", r.project.id, r.branch, "t", 1.5)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.createJob("alice", r.project.id, "main", "t")).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.createJob("alice", r.project.id, "tailzu/never-made-0000", "t")).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.createJob("bob", r.project.id, r.branch, "t")).rejects.toMatchObject({ code: "not_found" });
    await r.store.setBranchState(r.project.id, r.branch, "deleted");
    await expect(r.jobs.createJob("alice", r.project.id, r.branch, "t")).rejects.toMatchObject({ code: "branch_deleted" });
  });

  it("starts none while the person's account waits to be deleted, saying nothing about the account; kept, it starts again", async () => {
    const { deletionStore, forgetLeaving } = await import("../src/you/deletion.js");
    const r = await rig();
    await deletionStore().schedule("alice", 0, 7 * 86_400_000);
    forgetLeaving("alice");
    const e = await r.job("make the build pass").catch((x) => x);
    expect(e).toMatchObject({ code: "account_leaving", message: "Your bots are stopped for now." });
    expect(e.message).not.toMatch(/delet|account/i);
    expect(await r.jobs.listJobs("alice")).toEqual([]);
    await deletionStore().cancel("alice");
    forgetLeaving("alice");
    await expect(r.job("make the build pass")).resolves.toMatchObject({ state: "queued" });
  });

  it("allows 20 that are not over, and a cancelled one makes room", async () => {
    const r = await rig();
    const made = [];
    for (let i = 0; i < LIVE_JOBS_MAX; i += 1) made.push(await r.job(`task ${i}`));
    await expect(r.job("one more")).rejects.toMatchObject({ code: "too_many" });
    await r.jobs.cancelJob(made[0]!.id);
    await expect(r.job("one more")).resolves.toMatchObject({ state: "queued" });
  });

  it("is the person's own: another person gets not found for it, and for its steps", async () => {
    const r = await rig();
    const j = await r.job();
    await expect(r.jobs.job("bob", j.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.jobWithSteps("bob", j.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await r.jobs.listJobs("bob")).toEqual([]);
  });
});

describe("edits and the checkpoint", () => {
  it("an edit is a finished step the moment it is recorded, and moves the checkpoint", async () => {
    const r = await rig();
    const j = await r.job();
    const head = r.fake.head(r.repo, r.branch)!;
    const { job, step } = await r.jobs.addEditStep(j.id, { summary: "Fixed the import", files: ["src/a.ts", "src/b.ts"], headSha: head });
    expect(step).toMatchObject({ idx: 0, kind: "edit", status: "done", commands: ["src/a.ts", "src/b.ts"], placement: "none" });
    expect(step.finishedAt).toBe(r.now());
    expect(job).toMatchObject({ state: "running", checkpoint: { stepIndex: 0, headSha: head, notes: "Fixed the import" } });
    const second = await r.jobs.addEditStep(j.id, { files: ["a"] });
    expect(second.step.idx).toBe(1);
    expect(second.job.checkpoint).toEqual({ stepIndex: 1, headSha: head, notes: "Edited 1 file." });
  });

  it("refuses what isn't a commit id, a list of paths, or a job that is over or has a step out", async () => {
    const r = await rig();
    const j = await r.job();
    await expect(r.jobs.addEditStep(j.id, { headSha: "abc" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.addEditStep(j.id, { files: [""] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.addEditStep("nope")).rejects.toMatchObject({ code: "not_found" });
    await r.jobs.requestExec(j.id, ["ls"]);
    await expect(r.jobs.addEditStep(j.id, { files: ["a"] })).rejects.toMatchObject({ code: "step_in_flight" });
    await r.jobs.cancelJob(j.id);
    await expect(r.jobs.addEditStep(j.id, { files: ["a"] })).rejects.toMatchObject({ code: "job_over" });
  });
});

describe("a step that needs a computer", () => {
  it("goes to an online PC that is allowed, the PC is given it with read-only clone details, and its result is checkpointed", async () => {
    const r = await rig();
    await r.beat(LAPTOP);
    const j = await r.job();
    const head = r.fake.head(r.repo, r.branch)!;
    const { job: placed, step } = await r.jobs.requestExec(j.id, ["npm ci", "npm test"], 300, 3);
    expect(placed).toMatchObject({ state: "running", placement: "desktop", leaseHolder: LAPTOP, leaseEpoch: 1, leaseExpiresAt: r.now() + LEASE_MS, reason: "" });
    expect(step).toMatchObject({ idx: 0, kind: "exec", status: "dispatched", placement: "desktop", epoch: 1, startedAt: null, estimateMinutes: 3, timeoutSec: 300 });
    expect(r.told).toEqual([]); // nothing to tell: it simply runs on their own computer

    const given = (await r.jobs.next("alice", LAPTOP))!;
    expect(given).toMatchObject({
      jobId: j.id, stepIdx: 0, epoch: 1, commands: ["npm ci", "npm test"], timeoutSec: 300,
      repo: { kind: "app", cloneUrl: "https://github.com/alice/app.git", branch: r.branch, headSha: head, readTokenExpiresAt: expect.any(Number) },
    });
    // The only token it holds can read this one repo and nothing else.
    expect(r.fake.tokenPermissions(given.repo.readToken!)).toEqual({ contents: "read" });
    expect(Object.keys(given.repo).sort()).toEqual(["branch", "cloneUrl", "headSha", "kind", "readToken", "readTokenExpiresAt"]);
    expect((await look(r, j.id)).steps[0]).toMatchObject({ status: "running", startedAt: r.now() });

    r.advance(40 * SEC);
    const ack = await r.jobs.submitResult("alice", {
      jobId: j.id, stepIdx: 0, epoch: 1, exitCode: 0, outputTail: "all 12 tests passed", minutes: 0.4,
      changes: [{ path: "dist/report.txt", content: "12 passed\n" }, { path: "src/a.ts", content: "export const a = 2;\n" }],
    });
    expect(ack).toMatchObject({ ok: true, state: "running", committed: true, sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    // The SERVER committed it, to the work branch, as the bot.
    expect(r.fake.files(r.repo, r.branch)).toMatchObject({ "dist/report.txt": "12 passed\n", "src/a.ts": "export const a = 2;\n" });
    expect(r.fake.head(r.repo, r.branch)).toBe(ack.sha);
    expect(r.fake.headCommit(r.repo, r.branch).author).toEqual({ name: "Blip", email: "blip@x0bot.com" });
    const after = await look(r, j.id);
    expect(after.job).toMatchObject({
      state: "running", placement: "none", leaseHolder: null, leaseExpiresAt: null, leaseEpoch: 1,
      checkpoint: { stepIndex: 0, headSha: ack.sha, notes: "Ran npm ci and 1 more: ok and committed its changes." },
    });
    expect(after.steps[0]).toMatchObject({ status: "done", exitCode: 0, outputTail: "all 12 tests passed", minutes: 1, finishedAt: r.now() });
  });

  it("is handed to the PC again if it asks again before answering (the answer may have been lost), and only to its own PC", async () => {
    const r = await rig();
    const { given, job } = await onPc(r);
    // (a new read-only token each time: it is never kept)
    const again = (await r.jobs.next("alice", LAPTOP))!;
    expect(again).toEqual({ ...given, repo: { ...given.repo, readToken: again.repo.readToken, readTokenExpiresAt: again.repo.readTokenExpiresAt } });
    expect(r.fake.tokenPermissions(again.repo.readToken!)).toEqual({ contents: "read" });
    await r.beat(DESKTOP);
    expect(await r.jobs.next("alice", DESKTOP)).toBeNull();
    // Nobody else's PC either, even with the same device id.
    await r.beat(LAPTOP, { user: "bob" });
    expect(await r.jobs.next("bob", LAPTOP)).toBeNull();
    expect((await r.jobs.job("alice", job.id)).leaseHolder).toBe(LAPTOP);
  });

  it("counts a step that exits non-zero as failed, keeps going, and does not commit what it made", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const before = r.fake.head(r.repo, r.branch);
    const ack = await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 1, outputTail: "2 failed", minutes: 2,
      changes: [{ path: "junk.txt", content: "half-done" }],
    });
    expect(ack).toMatchObject({ ok: true, committed: false, changesIgnored: true, state: "running" });
    expect(r.fake.head(r.repo, r.branch)).toBe(before);
    const { job: after, steps } = await look(r, job.id);
    expect(steps[0]).toMatchObject({ status: "failed", exitCode: 1 });
    expect(after.checkpoint).toMatchObject({ stepIndex: 0, notes: "Ran npm ci and 1 more: failed (exit 1)." });
    expect(after.state).toBe("running");
    // The agent can go on with another step.
    const next = await r.jobs.requestExec(job.id, ["npm test"], 60, 1);
    expect(next.step.idx).toBe(1);
    expect(next.job).toMatchObject({ placement: "desktop", leaseEpoch: 2 });
  });

  it("takes one exec step at a time", async () => {
    const r = await rig();
    const { job } = await onPc(r);
    await expect(r.jobs.requestExec(job.id, ["ls"])).rejects.toMatchObject({ code: "step_in_flight" });
  });

  it("refuses commands that are not a list of 1 to 20 short commands, a timeout past an hour, or an absurd estimate", async () => {
    const r = await rig();
    const j = await r.job();
    for (const bad of [[], [""], ["  "], ["a".repeat(2001)], Array.from({ length: 21 }, () => "ls"), "ls" as unknown as string[], [1 as unknown as string]]) {
      await expect(r.jobs.requestExec(j.id, bad), JSON.stringify(bad).slice(0, 30)).rejects.toMatchObject({ code: "bad_request" });
    }
    await expect(r.jobs.requestExec(j.id, ["ls"], 0)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.requestExec(j.id, ["ls"], 3601)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.requestExec(j.id, ["ls"], 60, 361)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.requestExec(j.id, ["ls"], 60, -1)).rejects.toMatchObject({ code: "bad_request" });
    expect((await look(r, j.id)).steps).toEqual([]);
  });
});

// -------------------------------------------------------------- the leases

describe("the lease", () => {
  it("lasts 90 seconds from the dispatch, is renewed by progress and by a busy heartbeat, and by nothing else", async () => {
    const r = await rig();
    await r.beat(LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["make"], 600, 2);
    // Dispatched, not picked up: a busy heartbeat is not a step being run, so it keeps nothing.
    expect(await r.beat(LAPTOP, { busy: true })).toMatchObject({ ok: true, onlineForSec: 60, leasesRenewed: 0 });
    expect((await r.jobs.job("alice", j.id)).leaseExpiresAt).toBe(r.now() + LEASE_MS);

    const given = (await r.jobs.next("alice", LAPTOP))!;
    r.advance(50 * SEC);
    expect(await r.beat(LAPTOP, { busy: true })).toMatchObject({ leasesRenewed: 1 });
    expect((await r.jobs.job("alice", j.id)).leaseExpiresAt).toBe(r.now() + LEASE_MS);
    r.advance(50 * SEC);
    // An idle heartbeat says it is not running the step: it keeps nothing, and moves nothing.
    expect(await r.beat(LAPTOP, { busy: false })).toMatchObject({ leasesRenewed: 0 });
    expect((await r.jobs.job("alice", j.id)).leaseExpiresAt).toBe(r.now() - 50 * SEC + LEASE_MS);
    // Progress renews it.
    r.advance(30 * SEC);
    expect(await r.jobs.progress("alice", { jobId: j.id, epoch: given.epoch })).toEqual({ ok: true, leaseExpiresAt: r.now() + LEASE_MS });
    expect((await r.jobs.job("alice", j.id)).leaseExpiresAt).toBe(r.now() + LEASE_MS);
    expect(await r.jobs.tick()).toEqual({ expired: 0, moved: 0, failed: 0, woken: 0 });
  });

  it("goes up by one on every dispatch, and progress with any other epoch is refused as stale_lease", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    expect(given.epoch).toBe(1);
    await expect(r.jobs.progress("alice", { jobId: job.id, epoch: 0 })).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.progress("alice", { jobId: job.id, epoch: 2 })).rejects.toMatchObject({ code: "stale_lease" });
    await expect(r.jobs.progress("bob", { jobId: job.id, epoch: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.progress("alice", { jobId: "nope", epoch: 1 })).rejects.toMatchObject({ code: "not_found" });
    await r.jobs.submitResult("alice", { jobId: job.id, stepIdx: 0, epoch: 1, exitCode: 0, outputTail: "", minutes: 1 });
    // The step is over: its lease is gone, and so is the right to say "still going".
    await expect(r.jobs.progress("alice", { jobId: job.id, epoch: 1 })).rejects.toMatchObject({ code: "stale_lease" });
    const second = await r.jobs.requestExec(job.id, ["ls"], 60, 1);
    expect(second.job.leaseEpoch).toBe(2);
    await r.jobs.submitResult("alice", { jobId: job.id, stepIdx: 1, epoch: 2, exitCode: 0, outputTail: "", minutes: 1 });
    expect((await r.jobs.requestExec(job.id, ["ls"], 60, 1)).job.leaseEpoch).toBe(3);
  });

  it("is counted once: the same result sent again is acknowledged as a duplicate and changes nothing", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const body = { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "ok", minutes: 1, changes: [{ path: "a.txt", content: "a" }] };
    const first = await r.jobs.submitResult("alice", body);
    expect(first.committed).toBe(true);
    const commits = r.fake.commitCount(r.repo);
    expect(await r.jobs.submitResult("alice", body)).toMatchObject({ ok: true, duplicate: true, committed: false, state: "running" });
    expect(r.fake.commitCount(r.repo)).toBe(commits);
    expect((await r.jobs.job("alice", job.id)).checkpoint.stepIndex).toBe(0);
  });
});

describe("a PC that goes quiet in the middle of a step", () => {
  it("loses the lease, the step moves to GitHub's free computers from the checkpoint, the person is told, and the old PC's late result is refused", async () => {
    const r = await rig();
    await r.beat(LAPTOP);
    const j = await r.job();
    const head = r.fake.head(r.repo, r.branch)!;
    await r.jobs.addEditStep(j.id, { summary: "Added the build script", files: ["package.json"], headSha: head });
    const { step } = await r.jobs.requestExec(j.id, ["npm run build"], 600, 5);
    expect(step.idx).toBe(1);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    expect(given).toMatchObject({ stepIdx: 1, epoch: 1 });

    // 89 seconds of silence is not enough; 91 is.
    r.advance(89 * SEC);
    expect(await r.jobs.tick()).toMatchObject({ expired: 0 });
    expect((await r.jobs.job("alice", j.id)).leaseHolder).toBe(LAPTOP);
    r.advance(2 * SEC);
    expect(await r.jobs.tick()).toEqual({ expired: 1, moved: 1, failed: 0, woken: 0 });

    const moved = await look(r, j.id);
    expect(moved.job).toMatchObject({
      state: "running", placement: "github", leaseHolder: "github-run-1", leaseEpoch: 2, reassignments: 1, reason: "",
      // Resumes from the checkpoint: the edit is done, only the step that was out runs again.
      checkpoint: { stepIndex: 0, headSha: head, notes: "Added the build script" },
    });
    expect(moved.steps.map((s) => [s.idx, s.kind, s.status, s.placement, s.epoch])).toEqual([[0, "edit", "done", "none", 0], [1, "exec", "dispatched", "github", 2]]);
    expect(r.gh!.given).toHaveLength(1);
    expect(r.gh!.last.step).toMatchObject({ idx: 1, commands: ["npm run build"] });
    expect(r.gh!.last.job).toMatchObject({ leaseEpoch: 2, checkpoint: { stepIndex: 0 } });
    expect(r.toldOf("job_moved")).toEqual([{
      userId: "alice", kind: "job_moved",
      data: { jobId: j.id, projectId: r.project.id, task: "make the build pass", at: r.now(), from: "desktop", to: "github", stepIdx: 1, reason: expect.stringMatching(/GitHub/) },
    }]);
    expect(r.told.map((t) => t.kind)).toEqual(["job_moved"]);

    // The old PC wakes up and sends what it had: refused, nothing counted, nothing committed.
    const writes = r.fake.writes().length;
    await expect(r.jobs.submitResult("alice", {
      jobId: j.id, stepIdx: 1, epoch: 1, exitCode: 0, outputTail: "late", minutes: 9, changes: [{ path: "late.txt", content: "x" }],
    })).rejects.toMatchObject({ code: "stale_lease" });
    await expect(r.jobs.progress("alice", { jobId: j.id, epoch: 1 })).rejects.toMatchObject({ code: "stale_lease" });
    expect(r.fake.writes().length).toBe(writes);
    expect((await r.jobStore.getUsage("alice", monthKey(r.now()))).githubMinutes).toBe(0);
    // Nor does a heartbeat from it take the job back.
    await r.beat(LAPTOP);
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();
    expect((await r.jobs.job("alice", j.id)).placement).toBe("github");

    // GitHub's run finishes, under the epoch it was given: that one counts, and its minutes are used up.
    const ack = await r.gh!.finish(r.jobs, { minutes: 4, outputTail: "built" });
    expect(ack).toMatchObject({ ok: true, state: "running", committed: false });
    const done = await look(r, j.id);
    expect(done.job).toMatchObject({ placement: "none", leaseHolder: null, checkpoint: { stepIndex: 1 } });
    expect(done.steps[1]).toMatchObject({ status: "done", placement: "github", minutes: 4, outputTail: "built" });
    expect((await r.jobStore.getUsage("alice", monthKey(r.now()))).githubMinutes).toBe(4);
  });

  it("is never counted twice: moved to another PC, the first one's late result is refused and the second one's counts", async () => {
    const r = await rig({ github: false, paid: false });
    await r.beat(LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["make"], 600, 2);
    await r.jobs.next("alice", LAPTOP);
    r.advance(LEASE_MS + SEC);
    // The laptop is gone (no heartbeat for over a minute), and nothing else is there: the job waits and the person is told.
    expect(await r.jobs.tick()).toMatchObject({ expired: 1, moved: 1 });
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "waiting_for_compute", placement: "none", leaseHolder: null, reassignments: 1 });
    expect(r.told.map((t) => t.kind)).toEqual(["compute_paused"]);
    // Another PC comes online: the job goes to it at once.
    await r.beat(DESKTOP);
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", placement: "desktop", leaseHolder: DESKTOP, leaseEpoch: 2 });
    expect(r.told.map((t) => t.kind)).toEqual(["compute_paused"]); // moving between PCs is not news

    const before = r.fake.head(r.repo, r.branch);
    await expect(r.jobs.submitResult("alice", {
      jobId: j.id, stepIdx: 0, epoch: 1, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: "old.txt", content: "old" }],
    })).rejects.toMatchObject({ code: "stale_lease" });
    expect(r.fake.head(r.repo, r.branch)).toBe(before);

    const given = (await r.jobs.next("alice", DESKTOP))!;
    expect(given.epoch).toBe(2);
    const ack = await r.jobs.submitResult("alice", { jobId: j.id, stepIdx: 0, epoch: 2, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: "new.txt", content: "new" }] });
    expect(ack.committed).toBe(true);
    expect(Object.keys(r.fake.files(r.repo, r.branch))).toContain("new.txt");
    expect(Object.keys(r.fake.files(r.repo, r.branch))).not.toContain("old.txt");
  });

  it("is failed, with the reason, once its lease has been lost five times", async () => {
    const r = await rig({ github: false, paid: false });
    expect(MAX_REASSIGNMENTS).toBe(5);
    await r.beat(LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["make"], 600, 2);
    for (let lost = 1; lost <= MAX_REASSIGNMENTS; lost += 1) {
      await r.jobs.next("alice", LAPTOP); // picked up, then silence
      r.advance(LEASE_MS + SEC);
      const report = await r.jobs.tick();
      if (lost < MAX_REASSIGNMENTS) {
        expect(report, `lost ${lost}`).toMatchObject({ expired: 1, moved: 1, failed: 0 });
        expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "waiting_for_compute", reassignments: lost });
        await r.beat(LAPTOP); // back again: the same PC is given it again, under a new epoch
        expect((await r.jobs.job("alice", j.id)).leaseEpoch).toBe(lost + 1);
      } else {
        expect(report).toMatchObject({ expired: 1, moved: 0, failed: 1 });
      }
    }
    const { job, steps } = await look(r, j.id);
    expect(job).toMatchObject({ state: "failed", placement: "none", leaseHolder: null, leaseExpiresAt: null, reassignments: 5, leaseEpoch: 5 });
    expect(job.reason).toMatch(/kept going quiet \(5 times\)/);
    expect(steps[0]).toMatchObject({ status: "cancelled" });
    expect(r.toldOf("job_failed")).toHaveLength(1);
    expect(r.toldOf("job_failed")[0]!.data.reason).toBe(job.reason);
    // Over: nothing goes out again, whatever comes online.
    await r.beat(DESKTOP);
    await r.beat(LAPTOP);
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();
    expect(await r.jobs.next("alice", DESKTOP)).toBeNull();
    expect((await r.jobs.job("alice", j.id)).state).toBe("failed");
  });

  it("tries again on the same PC if it is still online but its runner lost the step (an idle heartbeat renews nothing)", async () => {
    const r = await rig({ github: false, paid: false });
    await r.beat(LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["make"], 600, 2);
    await r.jobs.next("alice", LAPTOP);
    for (let i = 0; i < 3; i += 1) { r.advance(30 * SEC); await r.beat(LAPTOP); } // alive, idle
    expect(await r.jobs.tick()).toMatchObject({ expired: 1, moved: 1 });
    // Still online and idle, so it was placed again at once under a new epoch, and nobody was told.
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", placement: "desktop", leaseHolder: LAPTOP, leaseEpoch: 2, reassignments: 1 });
    expect(r.told).toEqual([]);
  });
});

// ------------------------------------------------------- GitHub, then paid

describe("GitHub's free computers", () => {
  it("take a step when no PC is there and the month's free minutes (less a tenth) can cover it", async () => {
    const r = await rig({ freeMinutes: 100 }); // 90 usable
    expect(githubMinutesLeft(100, 0)).toBe(90);
    const j = await r.job();
    const { job, step } = await r.jobs.requestExec(j.id, ["npm test"], 600, 90);
    expect(job).toMatchObject({ state: "running", placement: "github", leaseHolder: "github-run-1", leaseEpoch: 1 });
    expect(step).toMatchObject({ status: "dispatched", placement: "github" });
    await r.gh!.finish(r.jobs, { minutes: 80 });
    expect((await r.jobStore.getUsage("alice", monthKey(r.now()))).githubMinutes).toBe(80);
    // 10 are left of the 90: a 11-minute step doesn't fit, a 10-minute one does.
    expect((await r.jobs.requestExec(j.id, ["a"], 60, 11)).job.state).toBe("waiting_for_compute");
  });

  it("are left alone when the person switched them off, or when the provider can't be asked", async () => {
    const r = await rig();
    await r.jobs.saveSettings("alice", { githubEnabled: false });
    const j = await r.job();
    const first = await r.jobs.requestExec(j.id, ["ls"], 60, 1);
    expect(first.job).toMatchObject({ state: "waiting_for_compute" });
    expect(first.job.reason).toMatch(/GitHub's free computers aren't set up for this project/);
    expect(r.gh!.asked).toEqual([]);
    await r.jobs.saveSettings("alice", { githubEnabled: true });
    // Turning them back on frees the waiting job straight away.
    expect((await r.jobs.job("alice", j.id)).placement).toBe("github");

    const r2 = await rig();
    r2.gh!.broken = true;
    const j2 = await r2.job();
    expect((await r2.jobs.requestExec(j2.id, ["ls"], 60, 1)).job.state).toBe("waiting_for_compute");
  });

  it("are given up on when they refuse the step: the job tries the next place, or waits and tries again next time", async () => {
    const r = await rig();
    await r.jobs.saveSettings("alice", { paidRule: "auto", autoCapPaise: 100_000 });
    r.gh!.failNext = 1;
    const j = await r.job();
    const { job } = await r.jobs.requestExec(j.id, ["ls"], 60, 2);
    // GitHub said no after all; paid was allowed automatically.
    expect(job).toMatchObject({ state: "running", placement: "paid", leaseHolder: "paid-run-1" });
    expect(job.leaseEpoch).toBe(2); // the failed dispatch used one

    const r2 = await rig({ paid: false });
    r2.gh!.failNext = 1;
    const j2 = await r2.job();
    const w = await r2.jobs.requestExec(j2.id, ["ls"], 60, 2);
    expect(w.job).toMatchObject({ state: "waiting_for_compute", placement: "none", leaseHolder: null });
    expect(w.step.status).toBe("pending");
    expect(await r2.jobs.tick()).toMatchObject({ woken: 1 });
    expect(await r2.jobs.job("alice", j2.id)).toMatchObject({ state: "running", placement: "github", leaseEpoch: 2 });
  });
});

describe("paid compute", () => {
  /** GitHub's free minutes all used up this month. */
  async function spentGithub(r: Rig) { await r.jobStore.addUsage("alice", monthKey(r.now()), { githubMinutes: 1800 }); }

  it('"ask": the job waits for a yes and the person is asked once; their yes runs it on paid compute', async () => {
    const r = await rig();
    await spentGithub(r);
    await r.jobs.saveSettings("alice", { paidRule: "ask" });
    const j = await r.job();
    const { job, step } = await r.jobs.requestExec(j.id, ["pytest"], 600, 5);
    expect(job).toMatchObject({ state: "waiting_for_you", waitingOn: "paid", placement: "none", leaseHolder: null, leaseEpoch: 0 });
    expect(job.reason).toMatch(/Paid compute needs your yes, as you asked\.$/);
    expect(step.status).toBe("pending");
    expect(r.toldOf("compute_ask")).toEqual([{
      userId: "alice", kind: "compute_ask",
      data: { jobId: j.id, projectId: r.project.id, task: "make the build pass", at: r.now(), stepIdx: 0, reason: job.reason, estimatePaise: 500 },
    }]);
    expect(r.pd!.given).toEqual([]);
    // Looking again does not ask again.
    await r.jobs.tick();
    await r.jobs.tick();
    expect(r.told).toHaveLength(1);

    const ok = await r.jobs.approvePaid("alice", j.id);
    expect(ok).toMatchObject({ state: "running", placement: "paid", leaseHolder: "paid-run-1", leaseEpoch: 1, budgetPaise: 500, waitingOn: null, reason: "" });
    expect(r.pd!.last.step).toMatchObject({ idx: 0, commands: ["pytest"] });

    // It reports what it used; that is added to the job and to the month.
    await r.pd!.finish(r.jobs, { paise: 430, minutes: 4 });
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", placement: "none", spentPaise: 430, budgetPaise: 500 });
    expect(await r.jobStore.getUsage("alice", monthKey(r.now()))).toMatchObject({ githubMinutes: 1800, paidPaise: 430 });

    // 70 paise are left of what they said yes to: the next step of 5 minutes asks again.
    const again = await r.jobs.requestExec(j.id, ["pytest -x"], 600, 5);
    expect(again.job).toMatchObject({ state: "waiting_for_you", waitingOn: "paid" });
    expect(r.toldOf("compute_ask")).toHaveLength(2);
    // They can say how much more: it must cover the step, and counts from what has been spent already.
    await expect(r.jobs.approvePaid("alice", j.id, 499)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.jobs.approvePaid("alice", j.id, 0)).rejects.toMatchObject({ code: "bad_request" });
    const more = await r.jobs.approvePaid("alice", j.id, 2000);
    expect(more).toMatchObject({ placement: "paid", budgetPaise: 430 + 2000 });
  });

  it("a yes only counts while the job is waiting for it, for its own person, and not when the rule is never", async () => {
    const r = await rig();
    await spentGithub(r);
    await r.jobs.saveSettings("alice", { paidRule: "ask" });
    const j = await r.job();
    await expect(r.jobs.approvePaid("alice", j.id)).rejects.toMatchObject({ code: "not_waiting" }); // nothing asked yet
    await r.jobs.requestExec(j.id, ["pytest"], 600, 5);
    await expect(r.jobs.approvePaid("bob", j.id)).rejects.toMatchObject({ code: "not_found" });
    await r.jobs.saveSettings("alice", { paidRule: "never" });
    // Switching to "never" took the question away: the job is only waiting for a computer now.
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "waiting_for_compute", waitingOn: null });
    await expect(r.jobs.approvePaid("alice", j.id)).rejects.toMatchObject({ code: "not_waiting" });
    await r.jobs.saveSettings("alice", { paidRule: "ask" });
    expect((await r.jobs.job("alice", j.id)).state).toBe("waiting_for_you");
    r.pd!.open = false;
    await expect(r.jobs.approvePaid("alice", j.id)).rejects.toMatchObject({ code: "paid_unavailable" });
    expect(r.pd!.given).toEqual([]);
  });

  it('"never" (the default): the job pauses and the person is told once; a PC coming online continues it at once', async () => {
    const r = await rig();
    await spentGithub(r);
    const j = await r.job();
    const { job } = await r.jobs.requestExec(j.id, ["pytest"], 600, 5);
    expect(job).toMatchObject({ state: "waiting_for_compute", waitingOn: null, placement: "none" });
    expect(job.reason).toBe("None of your computers is online and allowed for this project, this month's free GitHub minutes are used up, and paid compute is off. It will carry on by itself when one is.");
    expect(r.told.map((t) => t.kind)).toEqual(["compute_paused"]);
    expect(r.told[0]!.data).toMatchObject({ jobId: j.id, stepIdx: 0, reason: job.reason });
    expect(r.pd!.given).toEqual([]);
    await r.jobs.tick();
    r.advance(10 * MIN);
    await r.jobs.tick();
    expect(r.told).toHaveLength(1);
    expect((await r.jobs.job("alice", j.id)).state).toBe("waiting_for_compute");

    // A desktop heartbeat arrives. No tick needed.
    const ack = await r.beat(LAPTOP);
    expect(ack).toMatchObject({ ok: true });
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", placement: "desktop", leaseHolder: LAPTOP, leaseEpoch: 1, reason: "" });
    const given = (await r.jobs.next("alice", LAPTOP))!;
    expect(given).toMatchObject({ jobId: j.id, stepIdx: 0, commands: ["pytest"] });
    expect(r.told).toHaveLength(1); // carrying on is not news
  });

  it('"auto": within the monthly cap it runs on paid compute without asking; past the cap it asks; raising the cap or saying yes lets it go', async () => {
    const r = await rig();
    await spentGithub(r);
    await r.jobs.saveSettings("alice", { paidRule: "auto", autoCapPaise: 1000 });
    const j = await r.job();
    const first = await r.jobs.requestExec(j.id, ["pytest"], 600, 5); // about 500
    expect(first.job).toMatchObject({ state: "running", placement: "paid" });
    expect(r.told).toEqual([]);
    await r.pd!.finish(r.jobs, { paise: 700, minutes: 5 });
    expect((await r.jobStore.getUsage("alice", monthKey(r.now()))).paidPaise).toBe(700);

    // 300 are left of 1000; another 500 would go over.
    const second = await r.jobs.requestExec(j.id, ["pytest"], 600, 5);
    expect(second.job).toMatchObject({ state: "waiting_for_you", waitingOn: "paid" });
    expect(second.job.reason).toMatch(/over your monthly automatic limit/);
    expect(r.toldOf("compute_ask")).toHaveLength(1);
    expect(r.toldOf("compute_ask")[0]!.data.estimatePaise).toBe(500);
    // A smaller step still fits the 300 that are left.
    // (Raising the cap lets the waiting one go by itself.)
    await r.jobs.saveSettings("alice", { autoCapPaise: 5000 });
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", placement: "paid", leaseEpoch: 2 });
    await r.pd!.finish(r.jobs, { paise: 500 });

    // Over the cap again, and this time the person says yes for this job.
    await r.jobs.saveSettings("alice", { autoCapPaise: 1000 });
    const third = await r.jobs.requestExec(j.id, ["pytest"], 600, 5);
    expect(third.job.state).toBe("waiting_for_you");
    const yes = await r.jobs.approvePaid("alice", j.id);
    expect(yes).toMatchObject({ state: "running", placement: "paid" });
  });

  it('"auto" with a step that fits the room that is left', async () => {
    const r = await rig();
    await spentGithub(r);
    await r.jobs.saveSettings("alice", { paidRule: "auto", autoCapPaise: 1000 });
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["a"], 600, 5);
    await r.pd!.finish(r.jobs, { paise: 700 });
    const small = await r.jobs.requestExec(j.id, ["b"], 600, 3); // 300: exactly what is left
    expect(small.job).toMatchObject({ state: "running", placement: "paid" });
  });

  it("is not used when there is none on this server, whatever the rule says: the job waits instead of asking for money it can't spend", async () => {
    const r = await rig({ paid: false });
    await spentGithub(r);
    await r.jobs.saveSettings("alice", { paidRule: "auto", autoCapPaise: 100_000 });
    const j = await r.job();
    const { job } = await r.jobs.requestExec(j.id, ["a"], 600, 5);
    expect(job).toMatchObject({ state: "waiting_for_compute" });
    expect(job.reason).toMatch(/there is no paid compute to use/);
    expect(r.told.map((t) => t.kind)).toEqual(["compute_paused"]);
  });

  it("prefers a free place the moment one appears, even while it waits for a yes to paid", async () => {
    const r = await rig();
    await spentGithub(r);
    await r.jobs.saveSettings("alice", { paidRule: "ask" });
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["a"], 600, 5);
    expect((await r.jobs.job("alice", j.id)).state).toBe("waiting_for_you");
    await r.beat(LAPTOP);
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", placement: "desktop" });
    expect(r.pd!.given).toEqual([]);
  });
});

describe("which of the person's PCs may be given a step", () => {
  it("never one that isn't allowed on the project, isn't allowed to run, is busy, or has gone quiet for a minute", async () => {
    const r = await rig({ github: false, paid: false });
    const other = await r.another();
    // One that was here and has been quiet for 61 seconds is offline.
    await r.beat("laptop-stale-001");
    r.advance(61 * SEC);
    await r.beat("laptop-onlyother", { projects: [other.project.id] });
    await r.beat("laptop-norun-01", { allowRun: false });
    await r.beat("laptop-busy-001", { busy: true });
    await r.beat("laptop-nothing-1", { projects: [] });
    const j = await r.job();
    const { job } = await r.jobs.requestExec(j.id, ["ls"], 60, 1);
    expect(job).toMatchObject({ state: "waiting_for_compute", placement: "none" });
    for (const id of ["laptop-onlyother", "laptop-norun-01", "laptop-busy-001", "laptop-nothing-1"]) {
      expect(await r.jobs.next("alice", id), id).toBeNull();
    }
    await expect(r.jobs.next("alice", "laptop-stale-001")).rejects.toMatchObject({ code: "unknown_device" });
    await r.jobs.tick();
    expect((await r.jobs.job("alice", j.id)).placement).toBe("none");

    // One that is allowed on it, and idle: it gets it.
    await r.beat("laptop-allowed-1", { projects: [r.project.id, other.project.id] });
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", leaseHolder: "laptop-allowed-1" });
    expect(await r.jobs.next("alice", "laptop-onlyother")).toBeNull();
    expect((await r.jobs.next("alice", "laptop-allowed-1"))!.jobId).toBe(j.id);
    // And the one that is allowed on the OTHER project is the one that gets that project's work.
    const o = await r.jobs.createJob("alice", other.project.id, other.branch, "other task");
    expect((await r.jobs.requestExec(o.id, ["ls"], 60, 1)).job).toMatchObject({ leaseHolder: "laptop-onlyother" });
  });

  it("is told it is allowed on a project only by what it said in its own last heartbeat", async () => {
    const r = await rig({ github: false, paid: false });
    const other = await r.another();
    await r.beat(LAPTOP, { projects: [other.project.id] });
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["ls"], 60, 1);
    expect((await r.jobs.job("alice", j.id)).state).toBe("waiting_for_compute");
    // It names the project in its next heartbeat: the job goes at once.
    await r.beat(LAPTOP, { projects: [other.project.id, r.project.id] });
    expect((await r.jobs.job("alice", j.id)).leaseHolder).toBe(LAPTOP);
    // It takes the project off its list after the step was given to it: it is not handed over.
    await r.beat(LAPTOP, { projects: [other.project.id] });
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();
    // And turns the switch off after it was given the step: nor then.
    await r.beat(LAPTOP, { allowRun: false });
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();
    // The lease runs out, as no one is running it.
    r.advance(LEASE_MS + SEC);
    await r.beat(LAPTOP, { allowRun: false });
    expect(await r.jobs.tick()).toMatchObject({ expired: 1 });
    expect((await r.jobs.job("alice", j.id)).state).toBe("waiting_for_compute");
  });

  it("is one step at a time: a PC holding a step is not given a second job's", async () => {
    const r = await rig({ github: false, paid: false });
    await r.beat(LAPTOP);
    const a = await r.job("first");
    const b = await r.job("second");
    await r.jobs.requestExec(a.id, ["a"], 60, 1);
    const second = await r.jobs.requestExec(b.id, ["b"], 60, 1);
    expect((await r.jobs.job("alice", a.id)).leaseHolder).toBe(LAPTOP);
    expect(second.job.state).toBe("waiting_for_compute");
    // The first finishes: the PC is free, so the second goes to it without anyone asking.
    const given = (await r.jobs.next("alice", LAPTOP))!;
    await r.jobs.submitResult("alice", { jobId: a.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1 });
    expect(await r.jobs.job("alice", b.id)).toMatchObject({ state: "running", leaseHolder: LAPTOP });
    expect((await r.jobs.next("alice", LAPTOP))!.jobId).toBe(b.id);
  });
});

// ------------------------------------------------------------ the month

describe("the month's use", () => {
  it("is recorded per calendar month (UTC), and a new month gives the free minutes back to a job that was waiting for them", async () => {
    const r = await rig();
    expect(monthKey(r.now())).toBe("2026-10");
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["a"], 60, 10);
    await r.gh!.finish(r.jobs, { minutes: 10 });
    await r.jobs.requestExec(j.id, ["b"], 60, 5);
    await r.gh!.finish(r.jobs, { minutes: 3 });
    expect(await r.jobStore.getUsage("alice", "2026-10")).toEqual({ userId: "alice", month: "2026-10", githubMinutes: 13, paidPaise: 0 });

    // October's minutes are used up: a step waits (the rule is "never").
    await r.jobStore.addUsage("alice", "2026-10", { githubMinutes: 1800 });
    const stuck = await r.jobs.requestExec(j.id, ["c"], 60, 5);
    expect(stuck.job.state).toBe("waiting_for_compute");
    expect(await r.jobs.tick()).toMatchObject({ woken: 0 });

    // November 1st: a new month, nothing used.
    r.fake.clock.t = Date.UTC(2026, 10, 1, 0, 0, 5);
    expect(monthKey(r.now())).toBe("2026-11");
    expect(await r.jobs.tick()).toMatchObject({ woken: 1 });
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "running", placement: "github" });
    await r.gh!.finish(r.jobs, { minutes: 7 });
    await r.jobStore.addUsage("alice", "2026-11", { paidPaise: 250 });
    expect(await r.jobStore.getUsage("alice", "2026-11")).toMatchObject({ githubMinutes: 7, paidPaise: 250 });
    expect(await r.jobStore.getUsage("alice", "2026-10")).toMatchObject({ githubMinutes: 1813, paidPaise: 0 });
    expect(await r.jobStore.getUsage("bob", "2026-11")).toMatchObject({ githubMinutes: 0, paidPaise: 0 });

    const view = await r.jobs.settingsView("alice");
    expect(view.usage).toEqual({ month: "2026-11", githubMinutes: 7, paidPaise: 250 });
    expect(view.githubFreeMinutes).toEqual({ allowance: 2000, headroomPercent: 10, used: 7, left: 1793 });
  });

  it("counts what a paid place used in the month its result arrived", async () => {
    const r = await rig();
    await r.jobStore.addUsage("alice", monthKey(r.now()), { githubMinutes: 1800 });
    await r.jobs.saveSettings("alice", { paidRule: "auto", autoCapPaise: 100_000 });
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["a"], 60, 2);
    r.fake.clock.t = Date.UTC(2026, 10, 2); // the run took until November
    await r.pd!.finish(r.jobs, { paise: 180 });
    expect(await r.jobStore.getUsage("alice", "2026-11")).toMatchObject({ paidPaise: 180, githubMinutes: 0 });
    expect(await r.jobStore.getUsage("alice", "2026-10")).toMatchObject({ paidPaise: 0, githubMinutes: 1800 });
  });

  it("ignores the cost a desktop result claims: only a paid place can say what it cost", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    await r.jobs.submitResult("alice", { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 50, paise: 99_999 });
    expect(await r.jobs.job("alice", job.id)).toMatchObject({ spentPaise: 0 });
    expect(await r.jobStore.getUsage("alice", monthKey(r.now()))).toMatchObject({ githubMinutes: 0, paidPaise: 0 });
  });
});

// ---------------------------------------------- what a runner hands back

describe("changes a runner hands back", () => {
  it("that the policy would ask about (a secret) wait for the person: nothing is committed, they are told what kind of question and never what is in it", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const head = r.fake.head(r.repo, r.branch);
    const writes = r.fake.writes().length;
    const ack = await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "built", minutes: 2,
      changes: [{ path: "src/a.ts", content: "export const a = 3;\n" }, { path: ".env", content: SECRET_ENV }],
    });
    expect(ack).toEqual({ ok: true, state: "waiting_for_you", committed: false, waitingForYou: true });
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    expect(r.fake.writes().length).toBe(writes);

    const { job: waiting, steps } = await look(r, job.id);
    expect(waiting).toMatchObject({
      state: "waiting_for_you", waitingOn: "commit", placement: "none", leaseHolder: null, leaseExpiresAt: null,
      checkpoint: { stepIndex: -1 }, // the step is not finished until its changes are in
    });
    expect(waiting.reason).toMatch(/need your OK before X0 Bot commits them/);
    expect(steps[0]).toMatchObject({ status: "blocked", exitCode: 0, outputTail: "built", minutes: 2 });
    expect(r.toldOf("commit_ask")).toHaveLength(1);
    expect(r.toldOf("commit_ask")[0]!.data).toMatchObject({ jobId: job.id, stepIdx: 0, action: "commit.secret" });
    // Nobody was there to ask, so no question was even written down: the book of approvals is empty until the person asks.
    expect((r.code.approvals as unknown as { items: Map<string, unknown> }).items.size).toBe(0);
    const everything = JSON.stringify([r.told, waiting, steps]);
    expect(everything).not.toContain(".env");
    expect(everything).not.toContain("Zk3QpW9x");
    // The PC is free for something else, and the same result again is only acknowledged.
    expect(await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "built", minutes: 2, changes: [{ path: ".env", content: SECRET_ENV }],
    })).toMatchObject({ ok: true, duplicate: true, waitingForYou: true });

    // Their yes is the usual two steps. First the question: what, by name.
    const q = await r.jobs.approveCommit("alice", job.id);
    expect(isNeedsApproval(q)).toBe(true);
    if (!isNeedsApproval(q)) throw new Error("unreachable");
    expect(q).toMatchObject({ action: "commit.secret", faceId: true });
    expect(q.summary).toMatchObject({ fileCount: 2, flagged: [{ path: ".env" }] });
    expect(JSON.stringify(q)).not.toContain("Zk3QpW9x");
    expect((r.code.approvals as unknown as { items: Map<string, unknown> }).items.size).toBe(1);
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    // A made-up id does nothing; the real one commits exactly that.
    await expect(r.jobs.approveCommit("alice", job.id, "made-up")).rejects.toMatchObject({ code: "approval_invalid" });
    await expect(r.jobs.approveCommit("bob", job.id, q.approvalId)).rejects.toMatchObject({ code: "not_found" });
    const done = await r.jobs.approveCommit("alice", job.id, q.approvalId);
    expect(done).toMatchObject({ committed: true, sha: expect.stringMatching(/^[0-9a-f]{40}$/), job: { state: "running", waitingOn: null, reason: "" } });
    if (!("committed" in done)) throw new Error("unreachable");
    expect(r.fake.head(r.repo, r.branch)).toBe(done.sha);
    expect(r.fake.files(r.repo, r.branch)[".env"]).toBe(SECRET_ENV);
    const after = await look(r, job.id);
    expect(after.job.checkpoint).toMatchObject({ stepIndex: 0, headSha: done.sha });
    expect(after.steps[0]).toMatchObject({ status: "done" });
    // Said yes already: it can't be used twice.
    await expect(r.jobs.approveCommit("alice", job.id, q.approvalId)).rejects.toMatchObject({ code: "not_waiting" });
  });

  it("to a branch that isn't X0 Bot's own (the default branch) wait for the person; a standing permission lets them through", async () => {
    const r = await rig();
    await r.beat(LAPTOP);
    // A recorded row for the default branch: it is still never "its own".
    await r.store.addBranch({ projectId: r.project.id, branch: "main", task: "work on main", baseSha: r.fake.head(r.repo, "main")! });
    const j = await r.jobs.createJob("alice", r.project.id, "main", "work on main");
    await r.jobs.requestExec(j.id, ["npm run fmt"], 60, 1);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    expect(given.repo.branch).toBe("main");
    const main = r.fake.head(r.repo, "main");
    const ack = await r.jobs.submitResult("alice", { jobId: j.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: "fmt.txt", content: "x" }] });
    expect(ack).toMatchObject({ state: "waiting_for_you", waitingForYou: true, committed: false });
    expect(r.fake.head(r.repo, "main")).toBe(main);
    expect(r.toldOf("commit_ask")[0]!.data.action).toBe("commit.other_branch");
    const q = await r.jobs.approveCommit("alice", j.id);
    expect(q).toMatchObject({ needsApproval: true, action: "commit.other_branch", faceId: false });
    await r.jobs.cancelJob(j.id);

    // With "always let the bot commit to main" the same change just goes in.
    await r.store.addGrant(r.project.id, { action: "commit.other_branch", effect: "allow", branchPattern: "main" });
    const j2 = await r.jobs.createJob("alice", r.project.id, "main", "again");
    await r.jobs.requestExec(j2.id, ["npm run fmt"], 60, 1);
    const again = (await r.jobs.next("alice", LAPTOP))!;
    const ok = await r.jobs.submitResult("alice", { jobId: j2.id, stepIdx: 0, epoch: again.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: "fmt.txt", content: "x" }] });
    expect(ok).toMatchObject({ committed: true, state: "running" });
    expect(r.fake.files(r.repo, "main")["fmt.txt"]).toBe("x");
  });

  it("that the policy refuses (a path outside the repo, a workflow file the App may not change) are not committed, and the job goes on", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const head = r.fake.head(r.repo, r.branch);
    const bad = await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "done", minutes: 1, changes: [{ path: "../outside.txt", content: "x" }],
    });
    expect(bad).toMatchObject({ ok: true, committed: false, refused: "bad_path", state: "running" });
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
    const first = await look(r, job.id);
    expect(first.steps[0]).toMatchObject({ status: "failed", exitCode: 0 });
    expect(first.steps[0]!.outputTail).toBe("done\n[X0 Bot did not commit the changes: bad_path.]");
    expect(first.job.checkpoint).toMatchObject({ stepIndex: 0, notes: "Ran npm ci and 1 more; its changes were not committed (bad_path)." });

    await r.jobs.requestExec(job.id, ["ci"], 60, 1);
    const given2 = (await r.jobs.next("alice", LAPTOP))!;
    const wf = await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 1, epoch: given2.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: ".github/workflows/ci.yml", content: "on: push\n" }],
    });
    expect(wf).toMatchObject({ committed: false, refused: "needs_workflow_scope" });
    expect(r.fake.head(r.repo, r.branch)).toBe(head);
  });

  it("that GitHub could not take just now are asked for again: nothing is counted, the step stays out, and the second try counts once", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const body = { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "ok", minutes: 1, changes: [{ path: "a.txt", content: "a" }] };
    r.fake.failWith = { prefix: "/repos", status: 500 };
    await expect(r.jobs.submitResult("alice", body)).rejects.toMatchObject({ code: "failed" });
    r.fake.failWith = null;
    const mid = await look(r, job.id);
    expect(mid.job).toMatchObject({ state: "running", placement: "desktop", leaseEpoch: given.epoch });
    expect(mid.steps[0]).toMatchObject({ status: "running", exitCode: null });
    expect(await r.jobs.submitResult("alice", body)).toMatchObject({ ok: true, committed: true });
    expect((await look(r, job.id)).steps[0]).toMatchObject({ status: "done" });
  });

  it("are kept in memory only, and if the server forgot them the step runs again instead of the yes being lost", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: ".env", content: SECRET_ENV }],
    });
    // The whole job store is the database; the changes are not in it.
    expect(JSON.stringify([await r.jobStore.getJobById(job.id), await r.jobStore.listSteps(job.id)])).not.toContain("Zk3QpW9x");
    // A restarted server: same database, nothing in memory, no PC has said hello yet.
    const { createJobs } = await import("../src/code/jobs/index.js");
    const fresh = createJobs({ code: r.code, store: r.jobStore, github: null, paid: null, now: r.now })!;
    const out = await fresh.approveCommit("alice", job.id);
    expect(out).toMatchObject({ rerun: true, job: { state: "waiting_for_compute", waitingOn: null } });
    expect((await r.jobStore.listSteps(job.id))[0]).toMatchObject({ status: "pending", placement: "none" });
    expect(r.fake.files(r.repo, r.branch)[".env"]).toBeUndefined();
    // It carries on by itself when a PC says hello.
    await fresh.heartbeat("alice", { deviceId: LAPTOP, name: "x", allowRun: true, projects: "all", busy: false });
    expect(await fresh.job("alice", job.id)).toMatchObject({ state: "running", placement: "desktop", leaseEpoch: 2 });
  });

  it("are dropped with the job when it is cancelled while waiting for the yes", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: ".env", content: SECRET_ENV }],
    });
    const held = (r.jobs as unknown as { held: Map<string, unknown> }).held;
    expect(held.size).toBe(1);
    await r.jobs.cancelJob(job.id);
    expect(held.size).toBe(0);
    await expect(r.jobs.approveCommit("alice", job.id)).rejects.toMatchObject({ code: "not_waiting" });
    expect(r.fake.files(r.repo, r.branch)[".env"]).toBeUndefined();
    expect((await look(r, job.id)).steps[0]).toMatchObject({ status: "cancelled" });
  });

  it("never carry or need a token that can write: the PC holds a read-only one, the result has no place for any, and the server commits with its own", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const ack = await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "ok", minutes: 1, changes: [{ path: "a.txt", content: "a" }],
      // A runner that sends a token of its own is not listened to.
      token: "ghs_whatever", writeToken: "ghs_whatever", repo: { readToken: "x" },
    });
    expect(ack.committed).toBe(true);
    const minted = [...r.fake.tokens.entries()];
    const writers = minted.filter(([, t]) => t.permissions.contents === "write").map(([token]) => token);
    const readers = minted.filter(([, t]) => t.permissions.contents === "read").map(([token]) => token);
    expect(readers).toContain(given.repo.readToken);
    expect(writers.length).toBeGreaterThan(0); // the server's own, to commit
    // None of the write tokens went anywhere a PC can see, and the only token it was given reads.
    const seenByThePc = JSON.stringify([given, ack, await r.jobs.next("alice", LAPTOP)]);
    for (const w of writers) expect(seenByThePc).not.toContain(w);
    expect(r.fake.tokenPermissions(given.repo.readToken!)).toEqual({ contents: "read" });
    // The commit was made with a token that can write; the PC's read token could not have.
    const commitCalls = r.fake.calls.filter((c) => c.method === "POST" && /\/git\/commits$/.test(c.url.pathname));
    expect(commitCalls.length).toBeGreaterThan(0);
    for (const c of commitCalls) {
      const used = c.headers.authorization?.replace(/^Bearer /i, "");
      expect(used).not.toBe(given.repo.readToken);
      expect(writers).toContain(used);
    }
    // Nothing a job keeps holds a token either.
    const stored = JSON.stringify([await r.jobStore.getJobById(job.id), await r.jobStore.listSteps(job.id)]);
    for (const t of [...writers, ...readers]) expect(stored).not.toContain(t);
  });
});

describe("what a step prints", () => {
  it("keeps the last 8 KB, whole characters, and not a word of output that looks like it holds a secret", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const long = `${"é".repeat(9000)}THE END`;
    await r.jobs.submitResult("alice", { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: long, minutes: 1 });
    const kept = (await look(r, job.id)).steps[0]!.outputTail;
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(8192);
    expect(kept.endsWith("THE END")).toBe(true);
    expect(kept).not.toContain("�");

    const second = await r.jobs.requestExec(job.id, ["env"], 60, 1);
    const given2 = (await r.jobs.next("alice", LAPTOP))!;
    await r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: second.step.idx, epoch: given2.epoch, exitCode: 0, minutes: 1,
      outputTail: `PATH=/usr/bin\nGITHUB_TOKEN=${"gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}\nHOME=/root\n`,
    });
    const hidden = (await look(r, job.id)).steps[1]!.outputTail;
    expect(hidden).toBe("[Output not kept: it looked like it held a GitHub token.]");
  });
});

describe("a runner's messages", () => {
  it("are refused when they are not what the protocol says, with plain words", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const hb = (b: object) => r.jobs.heartbeat("alice", b);
    const base = { deviceId: LAPTOP, name: "x", allowRun: true, projects: "all", busy: false };
    for (const bad of [{}, { ...base, deviceId: "short" }, { ...base, deviceId: "has spaces here" }, { ...base, allowRun: "yes" }, { ...base, busy: 1 },
      { ...base, projects: "some" }, { ...base, projects: [1] }, { ...base, projects: Array.from({ length: 5001 }, (_, i) => `p${i}`) }, { ...base, projects: { allExcept: "p1" } }, { ...base, projects: { allExcept: [1] } },
      { ...base, projects: { allow: ["p1"] } }, { ...base, capabilities: { liveOnly: "yes" } }]) {
      await expect(hb(bad), JSON.stringify(bad).slice(0, 60)).rejects.toMatchObject({ code: "bad_request" });
    }
    // Protocol version 2 (docs/desktop-runner-session.md section 9): the list is not cut at 200 any more.
    await expect(hb({ ...base, projects: Array.from({ length: 201 }, (_, i) => `p${i}`) })).resolves.toMatchObject({ ok: true });
    await expect(r.jobs.next("alice", "x")).rejects.toMatchObject({ code: "bad_request" });
    const ok = { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1 };
    for (const bad of [{ ...ok, jobId: 7 }, { ...ok, stepIdx: -1 }, { ...ok, epoch: 0 }, { ...ok, epoch: 1.5 }, { ...ok, exitCode: "0" }, { ...ok, minutes: -1 },
      { ...ok, minutes: 2000 }, { ...ok, outputTail: 5 }, { ...ok, changes: "x" }, { ...ok, changes: [{ path: "", content: "x" }] },
      { ...ok, changes: [{ path: "a", content: 5 }] }, { ...ok, changes: Array.from({ length: 201 }, (_, i) => ({ path: `f${i}`, content: "" })) }]) {
      await expect(r.jobs.submitResult("alice", bad), JSON.stringify(bad).slice(0, 60)).rejects.toMatchObject({ code: "bad_request" });
    }
    await expect(r.jobs.submitResult("alice", { ...ok, jobId: "no-such-job" })).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.submitResult("bob", ok)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.jobs.submitResult("alice", { ...ok, stepIdx: 9 })).rejects.toMatchObject({ code: "stale_lease" });
    // It is still out, untouched by all of that.
    expect((await look(r, job.id)).steps[0]).toMatchObject({ status: "running" });
  });
});

// --------------------------------------------------------- cancel, finish

describe("cancelling", () => {
  it("stops anything from being dispatched: a waiting job stays waiting, and a PC that comes online is given nothing", async () => {
    const r = await rig({ github: false, paid: false });
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["ls"], 60, 1);
    expect((await r.jobs.job("alice", j.id)).state).toBe("waiting_for_compute");
    const c = await r.jobs.cancelJob(j.id);
    expect(c).toMatchObject({ state: "cancelled", placement: "none", leaseHolder: null, reason: "You stopped this job." });
    await r.beat(LAPTOP);
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();
    expect(await r.jobs.tick()).toEqual({ expired: 0, moved: 0, failed: 0, woken: 0 });
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "cancelled", placement: "none", leaseEpoch: 0 });
    expect((await look(r, j.id)).steps[0]).toMatchObject({ status: "cancelled" });
    expect(r.told).toEqual([`compute_paused`].map((kind) => expect.objectContaining({ kind })));
    // A second cancel changes nothing; no more requests are taken.
    expect(await r.jobs.cancelJob(j.id)).toEqual(c);
    await expect(r.jobs.requestExec(j.id, ["ls"])).rejects.toMatchObject({ code: "job_over" });
    await expect(r.jobs.approvePaid("alice", j.id)).rejects.toMatchObject({ code: "not_waiting" });
  });

  it("drops the step that is out: the PC's late result and progress are refused, the place is told to let go, and the epoch moves on", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    const c = await r.jobs.cancelJob(job.id);
    expect(c).toMatchObject({ state: "cancelled", placement: "none", leaseHolder: null, leaseExpiresAt: null, leaseEpoch: given.epoch + 1 });
    const writes = r.fake.writes().length;
    await expect(r.jobs.submitResult("alice", {
      jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1, changes: [{ path: "late.txt", content: "x" }],
    })).rejects.toMatchObject({ code: "stale_lease" });
    await expect(r.jobs.progress("alice", { jobId: job.id, epoch: given.epoch })).rejects.toMatchObject({ code: "stale_lease" });
    expect(r.fake.writes().length).toBe(writes);
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();

    // On GitHub's computers, the provider is told to stop the run.
    const g = await rig();
    const j = await g.job();
    await g.jobs.requestExec(j.id, ["ls"], 60, 1);
    const given2 = g.gh!.last;
    await g.jobs.cancelJob(j.id);
    expect(g.gh!.letGo.map((x) => x.id)).toEqual([j.id]);
    await expect(g.gh!.finish(g.jobs, { given: given2 })).rejects.toMatchObject({ code: "stale_lease" });
    expect((await g.jobStore.getUsage("alice", monthKey(g.now()))).githubMinutes).toBe(0);
  });

  it("is only the person's own job's to do over the routes' helper (job), and finishing a job is idempotent", async () => {
    const r = await rig();
    const j = await r.job();
    await expect(r.jobs.job("bob", j.id)).rejects.toMatchObject({ code: "not_found" });
    const done = await r.jobs.finishJob(j.id, { ok: true, summary: "All green" });
    expect(done).toMatchObject({ state: "done", checkpoint: { notes: "All green" } });
    expect(await r.jobs.finishJob(j.id, { ok: false, reason: "too late" })).toMatchObject({ state: "done" });
    expect(await r.jobs.cancelJob(j.id)).toMatchObject({ state: "done" });
    expect(r.toldOf("job_done")).toHaveLength(1);
    expect(r.toldOf("job_failed")).toHaveLength(0);
  });
});

describe("finishing a job", () => {
  it("done needs no step out; failed stops the step that is, tells the person why, and refuses its late result", async () => {
    const r = await rig();
    const { job, given } = await onPc(r);
    await expect(r.jobs.finishJob(job.id, { ok: true })).rejects.toMatchObject({ code: "step_in_flight" });
    await expect(r.jobs.finishJob(job.id, { ok: "yes" } as never)).rejects.toMatchObject({ code: "bad_request" });
    const failed = await r.jobs.finishJob(job.id, { ok: false, reason: "The tests need a database I can't start." });
    expect(failed).toMatchObject({ state: "failed", reason: "The tests need a database I can't start.", placement: "none", leaseHolder: null });
    expect(r.toldOf("job_failed")).toEqual([expect.objectContaining({ kind: "job_failed", data: expect.objectContaining({ jobId: job.id, reason: "The tests need a database I can't start." }) })]);
    await expect(r.jobs.submitResult("alice", { jobId: job.id, stepIdx: 0, epoch: given.epoch, exitCode: 0, outputTail: "", minutes: 1 })).rejects.toMatchObject({ code: "stale_lease" });

    const ok = await rig();
    const j = await ok.job();
    await ok.jobs.addEditStep(j.id, { files: ["a"] });
    expect(await ok.jobs.finishJob(j.id, { ok: true })).toMatchObject({ state: "done" });
    expect(ok.toldOf("job_done")).toHaveLength(1);
  });
});

// ---------------------------------------------------------- long polling

describe("a PC waiting for work", () => {
  it("is answered the moment a step is dispatched to it, and not before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const r = await rig();
    await r.beat(LAPTOP);
    let answer: unknown = "pending";
    const waiting = r.jobs.next("alice", LAPTOP, { waitMs: 25_000 }).then((s) => { answer = s; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(answer).toBe("pending");
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["npm test"], 60, 1);
    await waiting;
    expect(answer).toMatchObject({ jobId: j.id, commands: ["npm test"], epoch: 1 });
    // The timer is gone: nothing is left to fire.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is told there is nothing after the wait, can hang up, and one PC's step wakes only that PC", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const r = await rig({ github: false, paid: false });
    await r.beat(LAPTOP);
    await r.beat(DESKTOP, { allowRun: false });
    const results: Record<string, unknown> = {};
    const a = r.jobs.next("alice", LAPTOP, { waitMs: 25_000 }).then((s) => { results.a = s; });
    const ac = new AbortController();
    const b = r.jobs.next("alice", DESKTOP, { waitMs: 25_000, signal: ac.signal }).then((s) => { results.b = s; });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(results).toEqual({});
    await vi.advanceTimersByTimeAsync(1);
    await a;
    expect(results.a).toBeNull();
    ac.abort();
    await b;
    expect(results.b).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect((r.jobs as unknown as { waiters: Map<string, unknown> }).waiters.size).toBe(0);
    // Already hung up: answered at once.
    const gone = new AbortController();
    gone.abort();
    await expect(r.jobs.next("alice", LAPTOP, { waitMs: 25_000, signal: gone.signal })).resolves.toBeNull();
  });

  it("is told to say hello first if the server doesn't know it, and gets nothing while its own switch is off", async () => {
    const r = await rig();
    await expect(r.jobs.next("alice", LAPTOP, { waitMs: 100 })).rejects.toMatchObject({ code: "unknown_device" });
    await r.beat(LAPTOP, { allowRun: false });
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();
  });
});

describe("a job whose repo can no longer be used", () => {
  it("is failed with the reason when its PC asks for it, instead of being handed out again and again", async () => {
    const r = await rig({ github: false, paid: false });
    await r.beat(LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["ls"], 60, 1);
    await r.store.removeInstallation("alice", 101); // the person took the App away
    expect(await r.jobs.next("alice", LAPTOP)).toBeNull();
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ state: "failed", placement: "none", leaseHolder: null });
    expect(r.toldOf("job_failed")).toHaveLength(1);
  });
});

describe("two servers looking at the same job at once", () => {
  it("only one takes a lease back: one that read the job before it was renewed moves nothing", async () => {
    const r = await rig();
    await r.beat(LAPTOP);
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["make"], 60, 1);
    const given = (await r.jobs.next("alice", LAPTOP))!;
    r.advance(LEASE_MS + SEC);
    const seen = (await r.jobStore.getJobById(j.id))!; // what the other server read: the lease has run out
    expect(seen.leaseExpiresAt!).toBeLessThanOrEqual(r.now());
    // Meanwhile the PC's progress renews it.
    await r.jobs.progress("alice", { jobId: j.id, epoch: given.epoch });
    vi.spyOn(r.jobStore, "listExpired").mockResolvedValueOnce([seen]);
    vi.spyOn(r.jobStore, "getJobById").mockResolvedValue(seen);
    expect(await r.jobs.tick()).toEqual({ expired: 0, moved: 0, failed: 0, woken: 0 });
    vi.restoreAllMocks();
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ placement: "desktop", leaseHolder: LAPTOP, leaseEpoch: 1, reassignments: 0 });
    expect(r.gh!.given).toEqual([]);
  });

  it("only one dispatches a waiting job: one that read it before it was given out gives it to nobody", async () => {
    const r = await rig({ github: false, paid: false });
    const j = await r.job();
    await r.jobs.requestExec(j.id, ["make"], 60, 1);
    const seen = (await r.jobStore.getJobById(j.id))!; // waiting_for_compute, epoch 0
    const seenSteps = await r.jobStore.listSteps(j.id); // and its step still pending
    expect(seen).toMatchObject({ state: "waiting_for_compute", leaseEpoch: 0 });
    expect(seenSteps[0]!.status).toBe("pending");
    await r.beat(LAPTOP); // this server gives it to the laptop
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ leaseHolder: LAPTOP, leaseEpoch: 1 });
    // The other server, still holding what it read, tries too, with a second PC online as far as it knows.
    await r.beat(DESKTOP);
    vi.spyOn(r.jobStore, "listWaiting").mockResolvedValueOnce([seen]);
    vi.spyOn(r.jobStore, "getJobById").mockResolvedValue(seen);
    vi.spyOn(r.jobStore, "listSteps").mockResolvedValue(seenSteps);
    expect(await r.jobs.wake("alice")).toBe(0);
    vi.restoreAllMocks();
    expect(await r.jobs.job("alice", j.id)).toMatchObject({ leaseHolder: LAPTOP, leaseEpoch: 1 });
    expect((await look(r, j.id)).steps[0]).toMatchObject({ status: "dispatched", epoch: 1 });
    expect(await r.jobs.next("alice", DESKTOP)).toBeNull();
  });
});
