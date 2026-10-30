/**
 * WHEN THE AGENT NEEDS THE PERSON (src/code/agent, docs/code-agent.md): a question from the model or from locating where a
 * change belongs, a plan that wants a yes, a commit or a "ready for review" the policy asks about, and the budget running out.
 * In each the job is PARKED (waiting_for_you, nobody's claim), the person is pushed `needs_you`, and what they say is written
 * into the job's state so the loop goes on from where it was. Run end to end against the fake GitHub, with the real policy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, done, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
const { setUsageSpan } = await import("../src/you/span.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const BUG = { path: "src/util.ts", old: UTIL_EDIT.old, new: '  return s.toLowerCase().replace(/\\s+/g, "-").trim(); // BUG\n' };

describe("a question from the model", () => {
  it("parks the job as needs_you with the options, and goes on with the answer as the call's result", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(
      call("ask_user", { question: "Should the dashes be trimmed from the start too?", options: ["Both ends", "Only the end"] }),
      call("edit_file", UTIL_EDIT), done("Trimmed both ends, as you said."),
    );
    const { job, branch } = await r.start(UTIL_TASK);
    await r.orch.idle();

    // Parked: waiting for the person, nobody holds the claim, nothing more is spent, the person is told.
    let j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "answer", agentHolder: null, agentExpiresAt: null });
    expect(j.reason).toBe("Should the dashes be trimmed from the start too?");
    const s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "question", from: "model", options: ["Both ends", "Only the end"] });
    expect(r.toldOf("needs_you")).toHaveLength(1);
    expect(r.toldOf("needs_you")[0]!.data).toMatchObject({ jobId: job.id, reason: "Should the dashes be trimmed from the start too?" });
    const spent = j.spentPaise;
    expect(r.orch.running).toBe(0);
    // Nothing happens until they answer: a tick does not pick it up.
    expect(await r.orch.tick()).toMatchObject({ started: 0 });
    expect(r.model.turns).toBe(1);

    // They answer: the job runs again, the model gets the words as the result of its call, and finishes.
    await r.orch.answer("alice", job.id, "Both ends");
    await r.orch.idle();
    j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    expect(j.spentPaise).toBeGreaterThan(spent);
    expect(r.model.seen[1]!.messages).toContain("The person answered: Both ends");
    // The step it was answered at is kept: a free-form change that keeps reading after it is told to build (context.ts statusLine).
    expect((await r.stateNow(job.id)).work.answeredAt).toBe(1);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    expect((await r.worklog.list(job.id)).find((e) => e.kind === "question" && e.data?.answer)).toMatchObject({ data: { answer: "Both ends" } });
    expect(r.toldOf("job_done")).toHaveLength(1);
  });

  it("is answered only by its owner, only when it asked, and only with words", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("ask_user", { question: "Which?" }), done("ok"));
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    await expect(r.orch.answer("bob", job.id, "x")).rejects.toMatchObject({ code: "not_found" });
    await expect(r.orch.answer("alice", job.id, "   ")).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.orch.answer("alice", job.id, "x".repeat(4001))).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.orch.approve("alice", job.id)).rejects.toMatchObject({ code: "not_waiting" });
    await r.orch.answer("alice", job.id, "this one");
    await r.orch.idle();
    await expect(r.orch.answer("alice", job.id, "again")).rejects.toMatchObject({ code: "not_waiting" });
  });
});

describe("locating where a change belongs", () => {
  it("asks which part when the search is unsure, and goes on with the one they pick", async () => {
    const r = await agentRig();
    r.json.on("work.locate.expand", { terms: [] });
    r.json.on("work.plan", UTIL_PLAN);
    const { job } = await r.start("make it better");
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "answer" });
    const s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "question", from: "locate" });
    expect((s.waiting as { options: string[] }).options).toEqual(["A: Slugs", "B: App entry", "C: Legacy constants"]);
    expect((s.waiting as { question: string }).question).toMatch(/^I can't tell which part of the app this is about\. Which one\?\nA\) /);
    expect(r.toldOf("needs_you")).toHaveLength(1);
    // Nothing has been planned or edited yet.
    expect(r.model.turns).toBe(0);

    r.model.push(call("edit_file", UTIL_EDIT), done("Done."));
    // The answer is an option's letter.
    const options = (s.waiting as { options: string[] }).options;
    const pick = options.find((o) => o.includes("Slugs"))!;
    await r.orch.answer("alice", job.id, pick.split(":")[0]!);
    await r.orch.idle();
    const after = await r.stateNow(job.id);
    expect(after.located!.targets[0]).toMatchObject({ path: "src/util.ts", why: "you pointed at it" });
    expect((await r.worklog.list(job.id)).find((e) => e.kind === "question")).toMatchObject({ data: { answer: "A" } });
    expect((await r.jobNow(job.id)).state).toBe("done");
  });
});

describe("a plan that needs a yes", () => {
  const risky = "In src/util.ts make slug() trim dashes, before the password reset link is built from it";

  it("is sent to the person when the risk is high, and goes on only after they say yes through the approval book", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job, branch } = await r.start(risky);
    await r.orch.idle();

    let j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "approval" });
    const s = await r.stateNow(job.id);
    expect(s.plan!.risk).toBe("high");
    expect(s.waiting).toMatchObject({ kind: "approval", for: "plan", action: "job.plan", faceId: false });
    expect(s.waiting!.kind === "approval" && s.waiting.summary).toMatchObject({ risk: "high", steps: [{ n: 1, files: ["edit src/util.ts"] }] });
    expect(r.toldOf("needs_you")).toHaveLength(1);
    expect(r.model.turns).toBe(0);
    expect(r.fake.commitCount(r.repo)).toBe(1);

    // Step one of the question: nothing is done, it answers with the id to say yes with.
    const q = await r.orch.approve("alice", job.id);
    expect(q).toMatchObject({ needsApproval: true, action: "job.plan", faceId: false });
    const id = (q as { approvalId: string }).approvalId;
    // Somebody else's id, and a made-up one, do nothing.
    await expect(r.orch.approve("bob", job.id, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.orch.approve("alice", job.id, "nope")).rejects.toMatchObject({ code: "approval_invalid" });
    expect((await r.jobNow(job.id)).state).toBe("waiting_for_you");

    // Step two: yes.
    const yes = await r.orch.approve("alice", job.id, id);
    expect(yes).toMatchObject({ approved: true });
    await r.orch.idle();
    j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    // The id was used up.
    await expect(r.orch.approve("alice", job.id, id)).rejects.toMatchObject({ code: "not_waiting" });
  });

  it("stops the job when they say no: nothing is changed, nothing is spent beyond the plan", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await r.start(risky);
    await r.orch.idle();
    await expect(r.orch.deny("bob", job.id)).rejects.toMatchObject({ code: "not_found" });
    const denied = await r.orch.deny("alice", job.id);
    expect(denied).toMatchObject({ state: "cancelled", reason: "You didn't approve the plan, so nothing was changed." });
    await r.orch.idle();
    expect(r.model.turns).toBe(0);
    expect(r.fake.commitCount(r.repo)).toBe(1);
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
    await expect(r.orch.deny("alice", job.id)).rejects.toMatchObject({ code: "not_waiting" });
  });

  it("asks again, with a fresh id, when the approval ran out before they answered", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await r.start(risky);
    await r.orch.idle();
    const first = (await r.orch.approve("alice", job.id)) as { approvalId: string };
    r.fake.clock.t += 11 * 60_000;
    await expect(r.orch.approve("alice", job.id, first.approvalId)).rejects.toMatchObject({ code: "approval_expired" });
    const again = (await r.orch.approve("alice", job.id)) as { approvalId: string; expiresAt: number };
    expect(again.approvalId).not.toBe(first.approvalId);
    expect(again.expiresAt).toBeGreaterThan(r.fake.clock.t);
    await r.orch.approve("alice", job.id, again.approvalId);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
  });

  it("stops at once, with the reason, when the policy forbids the commit the plan leads to (a standing no)", async () => {
    const r = await agentRig();
    await r.store.addGrant(r.project.id, { action: "commit.own_branch", effect: "deny" });
    r.json.on("work.plan", UTIL_PLAN);
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j.state).toBe("failed");
    expect(j.reason).toBe("You told X0 Bot not to commit to a branch X0 Bot made in this project, so it won't.");
    expect(r.model.turns).toBe(0);
  });
});

describe("a commit, or a pull request, the policy asks about", () => {
  /** The branch is not one Tailzu recorded: committing to it is a question (policy.ts commit.other_branch). */
  async function other(r: Rig) {
    r.json.on("work.plan", UTIL_PLAN);
    const { job, branch } = await r.start(UTIL_TASK, { enqueue: false });
    (r.store as unknown as { branches: Map<string, unknown> }).branches.clear();
    await r.orch.enqueue(job.id, UTIL_TASK);
    return { job, branch };
  }

  it("goes through the approval flow: the plan is asked about, then the commit, and then it commits with the approval it was given", async () => {
    const r = await agentRig();
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job, branch } = await other(r);
    await r.orch.idle();

    // The plan touches something the policy asks about (committing to a branch Tailzu did not make): it waits for a yes.
    let s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "approval", for: "plan", action: "commit.other_branch" });
    expect(s.waiting!.kind === "approval" && s.waiting.summary.needs).toEqual([{ action: "commit.other_branch", label: "Commit to a branch X0 Bot didn't make", faceId: false }]);
    const q = (await r.orch.approve("alice", job.id)) as { approvalId: string };
    await r.orch.approve("alice", job.id, q.approvalId);
    await r.orch.idle();

    // Now the commit itself asks: the policy's own question, with what would be committed (names, never contents).
    expect((await r.jobNow(job.id))).toMatchObject({ state: "waiting_for_you", waitingOn: "approval" });
    s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "approval", for: "commit", action: "commit.other_branch" });
    expect(JSON.stringify(s.waiting)).not.toContain("toLowerCase");
    expect(s.waiting!.kind === "approval" && s.waiting.summary).toMatchObject({ fileCount: 1, files: [{ path: "src/util.ts", change: "write" }] });
    expect(s.work.staged.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect(r.fake.commitCount(r.repo)).toBe(1);
    expect(r.toldOf("needs_you")).toHaveLength(2);

    const commit = (await r.orch.approve("alice", job.id)) as { approvalId: string; action: string };
    expect(commit.action).toBe("commit.other_branch");
    await r.orch.approve("alice", job.id, commit.approvalId);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
  });

  it("stops the job without committing when they say no to the commit", async () => {
    const r = await agentRig();
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await other(r);
    await r.orch.idle();
    const q = (await r.orch.approve("alice", job.id)) as { approvalId: string };
    await r.orch.approve("alice", job.id, q.approvalId);
    await r.orch.idle();
    const j = await r.orch.deny("alice", job.id);
    expect(j).toMatchObject({ state: "cancelled", reason: "You didn't approve the commit, so nothing was committed." });
    expect(r.fake.commitCount(r.repo)).toBe(1);
  });

  it("stops with the reason when the policy refuses the commit outright (a standing no that came after the plan)", async () => {
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    r.model.beforeTurn = async (turn) => { if (turn === 2) await r.store.addGrant(r.project.id, { action: "commit.own_branch", effect: "deny" }); };
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j.state).toBe("failed");
    expect(j.reason).toContain("You told X0 Bot not to commit to a branch X0 Bot made in this project, so it won't. You can take that back in the project's permissions. Nothing was committed.");
    expect(r.fake.commitCount(r.repo)).toBe(1);
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
    expect((await r.stateNow(job.id)).report!.text).toContain("Nothing was committed");
  });

  it("asks before taking the pull request out of draft when there is no standing permission, and leaves it a draft when they say no", async () => {
    const r = await agentRig({ readyGrant: false });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    // Committed and opened as a draft; now it asks.
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
    let s = await r.stateNow(job.id);
    expect(s.waiting).toMatchObject({ kind: "approval", for: "ready", action: "pr.ready" });
    expect((await r.jobNow(job.id))).toMatchObject({ state: "waiting_for_you", waitingOn: "approval" });
    await r.orch.deny("alice", job.id);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    s = await r.stateNow(job.id);
    expect(s.pr).toMatchObject({ ready: false });
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
    expect(s.report!.text).toContain("(a draft)");
  });

  it("marks the pull request ready with the approval they give", async () => {
    const r = await agentRig({ readyGrant: false });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await r.start(UTIL_TASK);
    await r.orch.idle();
    const q = (await r.orch.approve("alice", job.id)) as { approvalId: string; action: string };
    expect(q.action).toBe("pr.ready");
    await r.orch.approve("alice", job.id, q.approvalId);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(false);
    expect((await r.stateNow(job.id)).pr).toMatchObject({ ready: true });
  });
});

describe("the budget", () => {
  afterEach(() => setUsageSpan(null));

  it("is the server's default when a job is made without one, and a budget of 0 sent on purpose means no model calls", async () => {
    const r = await agentRig();
    const a = await r.start(UTIL_TASK, { enqueue: false });
    expect(a.job.budgetPaise).toBe(3000);
    const b = await r.start("another small thing in src/util.ts", { budgetPaise: 0, enqueue: false });
    expect(b.job.budgetPaise).toBe(0);
  });

  it("stops cleanly with no model call when the job has no budget, offers more, and goes on from where it was when it is given", async () => {
    // A paid plan: the person's month is used in stretches (you/span.ts, set by the You routes over the meter).
    setUsageSpan(async () => true);
    const r = await agentRig();
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job } = await r.start(UTIL_TASK, { budgetPaise: 0 });
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "budget", spentPaise: 0 });
    // Not one model call was made for a job that may spend nothing: the classifier fell back to its rules, the plan was refused.
    expect(r.json.calls.filter((c) => c.purpose === "work.plan")).toHaveLength(0);
    expect(r.model.turns).toBe(0);
    const s = await r.stateNow(job.id);
    expect(s.report).toMatchObject({ outcome: "budget", continueWithPaise: 1000 });
    expect(s.report!.text).toContain("I paused to check with you");
    expect(s.report!.text).toContain("Keep going, and I pick up where I stopped.");
    expect(s.report!.text).not.toMatch(/₹/);
    expect(r.toldOf("needs_you")).toHaveLength(1);
    expect(r.toldOf("needs_you")[0]!.data.reason).toBe("This job has used a lot of this stretch. Keep going?");

    await expect(r.orch.addBudget("bob", job.id, 1000)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.orch.addBudget("alice", job.id, 0)).rejects.toMatchObject({ code: "bad_request" });
    await expect(r.orch.addBudget("alice", job.id, 1.5)).rejects.toMatchObject({ code: "bad_request" });
    const more = await r.orch.addBudget("alice", job.id, 3000);
    expect(more.budgetPaise).toBe(3000);
    await r.orch.idle();
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(r.fake.commitCount(r.repo)).toBe(2);
  });

  it("a free account has no stretches: the pause says this month; where the plan cannot be known, words true for every plan", async () => {
    for (const [span, reason] of [
      [async () => false, "This job has used a lot of this month. Keep going?"],
      [null, "This job has used what it was given. Keep going?"],
      [async () => { throw new Error("meter down"); }, "This job has used what it was given. Keep going?"],
    ] as const) {
      setUsageSpan(span);
      const r = await agentRig();
      r.json.on("work.plan", UTIL_PLAN);
      const { job } = await r.start(UTIL_TASK, { budgetPaise: 0 });
      await r.orch.idle();
      expect((await r.jobNow(job.id)).waitingOn).toBe("budget");
      expect(r.toldOf("needs_you")[0]!.data.reason).toBe(reason);
    }
  });

  it("commits nothing when the money runs out mid-work and the checks are worse than the baseline: the edits stay staged, and more budget resumes the work", async () => {
    setUsageSpan(async () => true);
    // Each model call costs 100 paise; the budget lets the plan and two turns through.
    const r = await agentRig({ paise: 100 });
    r.runner.checkResult = (kind, run) => (kind === "test" && run.overlay.some((f) => f.content?.includes("BUG")) ? { exit: 1, text: " FAIL  src/util.test.ts > slug > keeps the words" } : { exit: 0, text: "ok" });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", BUG), call("read_file", { path: "src/util.ts" }), call("read_file", { path: "README.md" }));
    const { job, branch } = await r.start(UTIL_TASK, { budgetPaise: 450 });
    await r.orch.idle();

    let j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "budget" });
    let s = await r.stateNow(job.id);
    expect(s.report).toMatchObject({ outcome: "budget" });
    expect(s.report!.text).toContain("makes the project's checks worse than they were, so I did NOT commit it");
    expect(s.report!.text).toContain("What I changed but did not commit");
    expect(s.report!.text).toContain("- src/util.ts (changed)");
    // Nothing on the branch, nothing opened; the edit is still staged in the checkpoint.
    expect(r.fake.commitCount(r.repo)).toBe(1);
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
    expect(s.work.staged.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect(s.verify).toMatchObject({ ran: true, ok: false });
    expect(j.spentPaise).toBe(306);
    const told = r.toldOf("needs_you");
    expect(told).toHaveLength(1);
    // Honest about why: what is left is NOT nothing, it is less than the next step's reservation, and the report says so, in usage words.
    expect(told[0]!.data.reason).toBe("This job's next step needs more of this stretch. Keep going?");
    expect(s.report!.text).toContain("The next step needs more than this job has left");
    expect(s.report!.text).not.toMatch(/₹|used what it was given/);

    // They add budget; the model carries on from the staged edit and mends it.
    r.model.push(call("edit_file", { ...UTIL_EDIT, old: BUG.new }), done("Trimmed."));
    const top = s.report!.continueWithPaise!;
    await r.orch.addBudget("alice", job.id, top);
    await r.orch.idle();
    j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    s = await r.stateNow(job.id);
    expect(s.commits).toHaveLength(1);
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).not.toContain("BUG");
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(false);
  });

  it("commits what it has, as part of the work, when the money runs out and the checks come out no worse than the baseline", async () => {
    const r = await agentRig({ paise: 100 });
    r.json.on("work.plan", UTIL_PLAN);
    r.model.push(call("edit_file", UTIL_EDIT), call("read_file", { path: "src/util.ts" }), call("read_file", { path: "README.md" }));
    const { job, branch } = await r.start(UTIL_TASK, { budgetPaise: 450 });
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "waiting_for_you", waitingOn: "budget" });
    const s = await r.stateNow(job.id);
    expect(s.report!.text).toContain("passed the checks, so it is committed");
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.fake.headCommit(r.repo, branch).message).toContain("the budget ran out before the rest");
    expect(s.work.staged).toEqual([]);
    expect(s.commits).toHaveLength(1);
    // No pull request yet: the work is not finished.
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
  });
});
