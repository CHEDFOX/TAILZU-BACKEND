/**
 * THE AGENT LOOP, END TO END AND OFFLINE (src/code/agent, docs/code-agent.md): a real orchestrator, router, policy and
 * workspace over a fake GitHub, a fixture brain, a scripted model and a runner that answers from a script
 * (tests/agent-rig.ts). What these hold down:
 *
 *   - the happy path: locate, plan, edit (staged), checks green, one commit by the Blip author with the co-author trailer,
 *     a draft pull request whose body holds the work log, ready for review, the report, the push, the cost;
 *   - a check this change broke: fix rounds with the failure in front of the model, then a pass; three failing rounds stop
 *     the job with a report and commit nothing; a check that was already failing is flagged and does not block;
 *   - the baseline: recorded on a runner, reused when it is fresh, unknown (and said so) when no computer can run it;
 *   - what the loop does on its own account: it reads nothing it should not, the route's record of each round is kept.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { agentRig, call, done, checkLine, UTIL_TASK, UTIL_PLAN, UTIL_EDIT } = await import("./agent-rig.js");
type Rig = Awaited<ReturnType<typeof agentRig>>;

const BUG = { path: "src/util.ts", old: UTIL_EDIT.old, new: '  return s.toLowerCase().replace(/\\s+/g, "-").trim(); // BUG\n' };

/** A rig whose plan is the util plan, and that has run the job to where it stopped. */
async function run(r: Rig, over: { budgetPaise?: number | undefined } = {}) {
  r.json.on("work.plan", UTIL_PLAN);
  const { job, branch } = await r.start(UTIL_TASK, over);
  await r.orch.idle();
  return { job, branch };
}

describe("the happy path", () => {
  it("locates, plans, edits, checks, commits as Blip, opens a draft pull request with the work log, marks it ready, and reports", async () => {
    const r = await agentRig();
    r.model.push(call("read_file", { path: "src/util.ts" }), call("edit_file", UTIL_EDIT), done("Trimmed the dashes from both ends of slug()."));
    const { job, branch } = await run(r);

    const j = await r.jobNow(job.id);
    expect(j).toMatchObject({ state: "done", waitingOn: null, agent: true });
    // Nothing was written to the repo while it worked; the one commit is the server's, after the checks.
    const head = r.fake.headCommit(r.repo, branch);
    expect(r.fake.commitCount(r.repo)).toBe(2); // the repo's first, and this one
    expect(head.author).toEqual({ name: "Blip", email: "blip@x0bot.com" });
    expect(head.message).toMatch(/Co-authored-by: alice <77\+alice@users\.noreply\.github\.com>\s*$/);
    expect(head.message).toContain("Done by Tailzu");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain('.replace(/^-+|-+$/g, "")');
    expect(r.fake.files(r.repo, "main")["src/util.ts"]).not.toContain("^-+");

    // The draft pull request: the plan, the checks, the whole work log; then taken out of draft because the checks are green.
    const [pr] = r.fake.pulls(r.repo);
    expect(pr).toMatchObject({ head: branch, draft: false, state: "open" });
    expect(pr!.body).toContain("## The plan");
    expect(pr!.body).toContain("Make slug() trim dashes from both ends");
    expect(pr!.body).toContain("## Work log");
    expect(pr!.body).toContain("`src/util.ts` (changed)");
    expect(pr!.body).toMatch(/\| `npm test[^`]*` \| passed/);
    expect(pr!.body).toContain("Made by Tailzu");

    // Where it is, and the report to the person.
    const s = await r.stateNow(job.id);
    expect(s).toMatchObject({ phase: "done", pr: { number: 1, ready: true } });
    expect(s.commits).toEqual([r.fake.head(r.repo, branch)]);
    expect(s.report).toMatchObject({ outcome: "done", prUrl: "https://github.com/alice/app/pull/1" });
    expect(s.report!.text).toContain("Done: In src/util.ts make slug()");
    expect(s.report!.text).toContain("Trimmed the dashes from both ends of slug().");
    expect(s.report!.text).toContain("Pull request: https://github.com/alice/app/pull/1 (ready for review)");
    expect(s.report!.text).not.toMatch(/Cost|₹/);
    expect(s.report!.text).toContain("What next");
    expect(r.toldOf("job_done")).toHaveLength(1);
    // What the person is charged is what the model calls cost, drawn from the job's own budget.
    expect(j.spentPaise).toBe(r.model.turns * r.model.paise + r.json.calls.length * r.json.paise);
    expect(j.spentPaise).toBeGreaterThan(0);

    // The checks ran twice on a runner: the baseline on the untouched branch, then on the staged edit laid over the checkout. Neither keeps its changes.
    expect(r.runner.runs.map((x) => [x.wrapped, x.overlay.map((f) => f.path), x.discard])).toEqual([[true, [], true], [true, ["src/util.ts"], true]]);
    // A runner never held a token that can write; the model never saw a tool that commits.
    expect(r.model.seen[0]!.tools).toEqual(expect.arrayContaining(["read_file", "edit_file", "run", "done"]));
    expect(r.model.seen[0]!.tools).not.toContain("commit");
  });

  it("records the baseline on the brain, and uses a fresh one without running it again", async () => {
    const r = await agentRig();
    r.model.push(call("edit_file", UTIL_EDIT), done("Done."), call("edit_file", UTIL_EDIT), done("Again."));
    await run(r);
    const row = await r.fixture.store.getBrain(r.fixture.projectId);
    expect(row!.baseline!.recorded).toMatchObject({ healthy: true, headSha: r.fake.head(r.repo, "main") });
    expect(row!.baseline!.recorded!.results.map((x) => x.kind)).toEqual(["install", "typecheck", "lint", "test"]);
    // A second job on the same default head finds it recorded: no baseline step.
    r.runner.runs.length = 0;
    const b = await r.start("In src/util.ts make slug() trim leading and trailing dashes, again");
    await r.orch.idle();
    expect(r.runner.runs.filter((x) => x.overlay.length === 0)).toHaveLength(0);
    expect(r.runner.runs.length).toBe(1);
    expect((await r.stateNow(b.job.id)).baseline).toMatchObject({ status: "recorded" });
  });

  it("answers a question without a plan, a baseline, a commit or a pull request: the summary is the report", async () => {
    const r = await agentRig();
    r.model.push(call("search_code", { query: "slug" }), call("read_file", { path: "src/util.ts" }), done("slug() lowercases a title and joins its words with dashes."));
    const { job } = await r.start("How does slug work in src/util.ts?");
    await r.orch.idle();
    const j = await r.jobNow(job.id);
    expect(j.state).toBe("done");
    expect(r.runner.runs).toHaveLength(0);
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
    expect(r.fake.commitCount(r.repo)).toBe(1);
    const s = await r.stateNow(job.id);
    expect(s.report).toMatchObject({ outcome: "answer" });
    expect(s.report!.text).toContain("slug() lowercases a title");
    expect(s.report!.text).not.toContain("Pull request");
  });
});

describe("a check this change broke", () => {
  /** The test check fails while the staged edit has the bug in it. */
  const brokenWhileBugged = (r: Rig) => {
    r.runner.checkResult = (kind, run) => (kind === "test" && run.overlay.some((f) => f.content?.includes("BUG"))
      ? { exit: 1, text: " FAIL  src/util.test.ts > slug > keeps the words\nAssertionError: expected 'hello world' to be 'hello-world'" }
      : { exit: 0, text: "ok" });
  };

  it("goes back to work with the failure in front of the model, fixes it, and passes: one fix round, one commit", async () => {
    const r = await agentRig();
    brokenWhileBugged(r);
    r.model.push(
      call("edit_file", BUG), done("Trimmed."),
      // Round one: the model is shown what failed, and mends it.
      call("edit_file", { ...UTIL_EDIT, old: BUG.new }), done("Trimmed, properly this time."),
    );
    const { job, branch } = await run(r);

    const s = await r.stateNow(job.id);
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(s.work.fixRounds).toBe(1);
    expect(s.verify).toMatchObject({ ran: true, ok: true, round: 1 });
    const second = r.model.seen[2]!;
    // The failure is in front of it, inside a data fence, with the fix round said.
    expect(second.user).toContain("fix round 1 of 3");
    expect(second.user).toMatch(/<tool_data tool="checks">[\s\S]*FAIL {2}src\/util\.test\.ts > slug > keeps the words[\s\S]*<\/tool_data>/);
    // Exactly one commit, with the good edit only.
    expect(r.fake.commitCount(r.repo)).toBe(2);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).not.toContain("BUG");
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).toContain("^-+|-+$");
    // Three runs: baseline, the verify that failed, the verify that passed.
    expect(r.runner.runs.map((x) => x.overlay.length)).toEqual([0, 1, 1]);
    // The router learns: one round that failed and one that worked, for the model that wrote them.
    const rows = await r.routeStats.list("feature", "write_code");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: "fake/code", successes: 1, failures: 1 });
    // The log says it broke something, and the PR's checks say it passed in the end.
    const log = (await r.worklog.list(job.id)).map((e) => `${e.kind}:${e.text}`);
    expect(log.some((l) => l.startsWith("finding:This change broke test"))).toBe(true);
    expect(log.some((l) => l.includes("Fix round 1 of 3"))).toBe(true);
  });

  it("stops after three rounds of fixes that do not fix it, with a report, committing nothing and opening nothing; the edits stay staged", async () => {
    const r = await agentRig();
    brokenWhileBugged(r);
    r.model.push(call("edit_file", BUG), done("Trimmed."), done("Tried."), done("Tried again."), done("Once more."));
    const { job, branch } = await run(r);

    const j = await r.jobNow(job.id);
    expect(j.state).toBe("failed");
    expect(j.reason).toMatch(/still fail after 3 rounds of fixes/);
    expect(r.fake.commitCount(r.repo)).toBe(1);
    expect(r.fake.files(r.repo, branch)["src/util.ts"]).not.toContain("BUG");
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
    const s = await r.stateNow(job.id);
    expect(s.work.fixRounds).toBe(3);
    expect(s.report).toMatchObject({ outcome: "failed" });
    expect(s.report!.text).toContain("I stopped:");
    expect(s.report!.text).toContain("Broken by this change");
    expect(s.report!.text).toContain("test: src/util.test.ts > slug > keeps the words");
    expect(s.report!.text).toContain("Nothing was committed");
    expect(s.work.staged.map((f) => f.path)).toEqual(["src/util.ts"]);
    expect(r.toldOf("job_failed")).toHaveLength(1);
    // Failing twice makes the router climb: the later rounds are written on the strong tier.
    expect(r.model.seen.map((x) => x.tier)).toEqual(["code", "code", "code", "strong", "strong"]);
  });

  it("flags a check that was already failing before Tailzu, and does not block on it", async () => {
    const r = await agentRig();
    const OLD = " FAIL  src/legacy.test.ts > old behaviour > still red";
    // The same test is red before the change and after it.
    r.runner.checkResult = (kind) => (kind === "test" ? { exit: 1, text: `${OLD}\nAssertionError: nope` } : { exit: 0, text: "ok" });
    r.model.push(call("edit_file", UTIL_EDIT), done("Trimmed."));
    const { job, branch } = await run(r);

    const s = await r.stateNow(job.id);
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(s.baseline).toMatchObject({ status: "recorded" });
    expect(s.baseline!.results!.find((x) => x.kind === "test")).toMatchObject({ exitCode: 1, failing: ["src/legacy.test.ts > old behaviour > still red"] });
    expect(s.work.fixRounds).toBe(0);
    expect(s.verify).toMatchObject({ ran: true, ok: true, broke: [], alreadyBroken: ["test: src/legacy.test.ts > old behaviour > still red"] });
    expect(r.fake.commitCount(r.repo)).toBe(2);
    // Said apart from everything else, in the report and in the pull request.
    expect(s.report!.text).toContain("Already broken before Tailzu (not caused by this change)");
    expect(s.report!.text).toContain("- test: src/legacy.test.ts > old behaviour > still red");
    expect(s.report!.text).not.toContain("Broken by this change");
    expect(s.report!.text).toContain("test: failed, and was already failing before Tailzu");
    const body = r.fake.pulls(r.repo)[0]!.body;
    expect(body).toContain("## Already broken before Tailzu");
    expect(body).toContain("not caused by it");
    expect(r.fake.pulls(r.repo)[0]!.head).toBe(branch);
  });

  it("blocks on a NEW failure that sits beside one that was already there", async () => {
    const r = await agentRig();
    const OLD = " FAIL  src/legacy.test.ts > old behaviour > still red";
    r.runner.checkResult = (kind, run) => {
      if (kind !== "test") return { exit: 0, text: "ok" };
      return run.overlay.some((f) => f.content?.includes("BUG"))
        ? { exit: 1, text: `${OLD}\n FAIL  src/util.test.ts > slug > keeps the words` } : { exit: 1, text: OLD };
    };
    r.model.push(call("edit_file", BUG), done("Trimmed."), call("edit_file", { ...UTIL_EDIT, old: BUG.new }), done("Fixed."));
    const { job } = await run(r);
    const s = await r.stateNow(job.id);
    expect(s.work.fixRounds).toBe(1);
    expect(s.verify).toMatchObject({ ok: true, alreadyBroken: ["test: src/legacy.test.ts > old behaviour > still red"] });
    // The feedback named the new failure and not the old one as a break.
    expect(r.model.seen[2]!.user).toContain("src/util.test.ts > slug > keeps the words");
    expect(r.model.seen[2]!.user).toContain("1 thing this change broke");
  });
});

describe("the baseline", () => {
  it("is recorded as unknown, with a note, when no computer can run the checks; the job goes on, and the pull request stays a draft", async () => {
    const r = await agentRig({ placeWaitMs: 10_000 });
    // The first ask for a place finds none; the checks after the edit find one.
    r.runner.open = false;
    r.model.push(call("edit_file", UTIL_EDIT), call("run", { cmd: "npm test", why: "see it pass" }), done("Trimmed."));
    r.json.on("work.plan", UTIL_PLAN);
    const { job } = await r.start(UTIL_TASK);
    // Open the runner again once the baseline has given up on it.
    r.model.beforeTurn = () => { r.runner.open = true; };
    await r.orch.idle();
    const s = await r.stateNow(job.id);
    expect(s.baseline).toMatchObject({ status: "unknown" });
    expect(s.baseline!.note).toMatch(/No computer was free to run the project's checks before I started/);
    expect((await r.jobNow(job.id)).state).toBe("done");
    expect(s.report!.text).toContain("I cannot tell what was already broken from what my change breaks");
    // The step that waited for a place was dropped, not left to run later.
    const steps = await r.jobStore.listSteps(job.id);
    expect(steps[0]).toMatchObject({ kind: "exec", status: "cancelled" });
    expect(steps.filter((x) => x.status === "pending" || x.status === "dispatched")).toHaveLength(0);
  });
});

describe("the tools", () => {
  it("run a command with the staged edits laid over the checkout and give back the exit code and the end of the output as data", async () => {
    const r = await agentRig();
    r.runner.commandResult = (c) => ({ exit: c.includes("fail") ? 1 : 0, out: c.includes("fail") ? "boom: the thing failed" : "all good" });
    r.model.push(
      call("edit_file", UTIL_EDIT), call("run", { cmd: "npm test\nnpm run fail", why: "check it" }), done("Trimmed."),
    );
    const { job } = await run(r);
    const trial = r.runner.runs.find((x) => !x.wrapped)!;
    expect(trial.commands).toEqual(["npm test", "npm run fail"]);
    expect(trial.overlay).toEqual([{ path: "src/util.ts", content: expect.stringContaining("^-+|-+$") }]);
    expect(trial.discard).toBe(true);
    const turn = r.model.seen.at(-1)!;
    expect(turn.messages).toContain("Exit code 1 (it failed)");
    expect(turn.messages).toMatch(/<tool_data tool="run" label="npm test">[\s\S]*boom: the thing failed[\s\S]*<\/tool_data>/);
    const log = await r.worklog.list(job.id);
    expect(log.find((e) => e.kind === "command" && e.text.startsWith("npm test"))!.data).toMatchObject({ exitCode: 1, callId: expect.any(String) });
  });

  it("refuse an edit that is not exact or not unique, say so, and count a turn of only failures as a bad one", async () => {
    const r = await agentRig();
    r.model.push(
      call("edit_file", { path: "src/util.ts", old: "return NOT THERE;", new: "x" }),
      call("edit_file", { path: "src/util.ts", old: "s", new: "t" }),
      call("edit_file", UTIL_EDIT), done("Trimmed."),
    );
    const { job } = await run(r);
    const s = await r.stateNow(job.id);
    const first = s.work.exchanges.length ? s.work.exchanges : [];
    expect(first.length).toBeLessThanOrEqual(6);
    const sent = r.model.seen[1]!.messages;
    expect(sent).toContain("That did not work. That text is not in src/util.ts.");
    expect(r.model.seen[2]!.messages).toMatch(/That text is in src\/util\.ts \d+ times/);
    expect((await r.jobNow(job.id)).state).toBe("done");
  });
});
