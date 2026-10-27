/**
 * THE LEAD'S WORK WITH THE PARTS (src/code/team, docs/code-team.md sections 5 and 6): fix rounds after a review, the order parts are merged in, a part that clashes with
 * the lead branch (the runner merge flow), and the full check that gates the one pull request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { teamRig, call, done, edit, settle, goodSplit, allGood, OVER, run, chain } = await import("./team-rig.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
const { resetRewindStoreForTests } = await import("../src/code/agent/rewind.js");
const { resetConfigForTests } = await import("../src/config.js");
type Rig = Awaited<ReturnType<typeof teamRig>>;

beforeEach(() => { resetSettingsStoreForTests(); resetRewindStoreForTests(); });
afterEach(() => resetConfigForTests());

const MAJOR = { severity: "major" as const, path: "src/api/notes.ts", line: 1, text: "The endpoint never answers 404 for a note that does not exist." };
const BLOCKER = { severity: "blocker" as const, path: "src/api/notes.ts", line: 1, text: "The export throws for every note, so the page can never show one." };

describe("fix rounds", () => {
  it("send a part back to its helper when the reviewer finds something, and merge it once the review passes", async () => {
    const r = await teamRig();
    allGood(r);
    r.verdicts.set(1, [
      { verdict: "fix", summary: "Misses the 404.", findings: [MAJOR, { severity: "note", path: "src/api/notes.ts", text: "Maybe rename this later." }] },
      { verdict: "fix", summary: "Still misses it.", findings: [MAJOR] },
      { verdict: "pass", summary: "It answers 404 now.", findings: [] },
    ]);
    r.scripts.set("p1.fix1", [edit("src/api/notes.ts", "v2", "v1"), done("Added the 404 branch.")]);
    r.scripts.set("p1.fix2", [edit("src/api/notes.ts", "v3", "v2"), done("Added the 404 branch properly.")]);
    const { job, branch } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    const p1 = s.team!.parts.find((p) => p.id === 1)!;
    expect(p1.status).toBe("merged");
    expect(p1.fixRounds).toBe(2);
    expect(p1.reviews.map((x) => x.verdict)).toEqual(["fix", "fix", "pass"]);
    expect(p1.jobIds).toHaveLength(3);
    // The fix rounds are jobs of the same helper's, on the same branch, each with the findings and nothing else new.
    const hs = (await r.helpers(job.id)).filter((h) => h.state.part!.id === 1).sort((a, b) => a.state.part!.round - b.state.part!.round);
    expect(hs.map((h) => h.state.part!.round)).toEqual([0, 1, 2]);
    expect(new Set(hs.map((h) => h.branch)).size).toBe(1);
    expect(hs[1]!.state.mode).toBe("freeform");
    expect(hs[1]!.state.work.reviewFeedback).toContain("The endpoint never answers 404");
    expect(hs[1]!.state.work.reviewFeedback).not.toContain("Maybe rename");
    const seen = r.model.seen.find((x) => x.messages.includes("A reviewer read your work against the goal and found problems (fix round 1 of 2)"));
    expect(seen).toBeTruthy();
    expect(seen!.messages).toContain('<tool_data tool="review">');
    expect(r.fake.files(r.repo, branch)["src/api/notes.ts"]).toBe('export const notes = "v3";\n');
    // Each review sees the whole part against where it was cut, so the second shows the first fix too.
    expect(r.reviews.filter((x) => x.part === 1)).toHaveLength(3);
    expect(r.reviews.filter((x) => x.part === 1)[2]!.user).toContain('+export const notes = "v3";');
    // The pull request tells what the reviewers found, round by round.
    const body = r.fake.pulls(r.repo)[0]!.body;
    expect(body).toContain("after fix round 1");
    expect(body).toContain("The endpoint never answers 404");
    expect(body).toMatch(/\| 1 \| Export API \| merged \| .* \| 2 \|/);
  });

  it("are at most two: a blocker that is still there after the second leaves the part out of the merge, and the pull request a draft", async () => {
    const r = await teamRig();
    allGood(r);
    r.verdicts.set(1, [
      { verdict: "fix", summary: "Throws.", findings: [BLOCKER] }, { verdict: "fix", summary: "Still throws.", findings: [BLOCKER] }, { verdict: "fix", summary: "Throws again.", findings: [BLOCKER] },
    ]);
    r.scripts.set("p1.fix1", [edit("src/api/notes.ts", "v2", "v1"), done("Tried.")]);
    r.scripts.set("p1.fix2", [edit("src/api/notes.ts", "v3", "v2"), done("Tried again.")]);
    const { job, branch } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    const p1 = s.team!.parts.find((p) => p.id === 1)!;
    expect(p1.status).toBe("failed");
    expect(p1.fixRounds).toBe(2);
    expect(p1.reason).toContain("after 2 fix rounds");
    expect(r.reviews.filter((x) => x.part === 1)).toHaveLength(3);
    // Not merged: the lead branch has the others' work, not this part's.
    const files = r.fake.files(r.repo, branch);
    expect(files["src/api/notes.ts"]).toBe('export const notes = "v0";\n');
    expect(files["src/web/NotePage.tsx"]).toBe('export const page = "v1";\n');
    expect(chain(r, branch).filter((c) => c.parents.length === 2)).toHaveLength(3);
    // One pull request, still a draft, and the report says which part is missing and why.
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
    expect(s.pr!.ready).toBe(false);
    expect(s.report!.text).toContain("Part 1, Export API: failed");
    expect(r.fake.pulls(r.repo)[0]!.body).toContain("Part 1 (Export API) is failed");
    expect(s.task).toContain("part 1 (Export API): failed");
  });

  it("leave a major finding that two rounds did not clear merged, said so, and the pull request a draft", async () => {
    const r = await teamRig();
    allGood(r);
    r.verdicts.set(1, [{ verdict: "fix", summary: "a", findings: [MAJOR] }, { verdict: "fix", summary: "b", findings: [MAJOR] }, { verdict: "fix", summary: "c", findings: [MAJOR] }]);
    r.scripts.set("p1.fix1", [edit("src/api/notes.ts", "v2", "v1"), done("Tried.")]);
    r.scripts.set("p1.fix2", [edit("src/api/notes.ts", "v3", "v2"), done("Tried again.")]);
    const { job } = await r.startLead();
    const { s } = await run(r, job.id);
    const p1 = s.team!.parts.find((p) => p.id === 1)!;
    expect(p1.status).toBe("merged");
    expect(s.team!.notes.join(" ")).toContain("merged with problems");
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
  });
});

describe("the order parts are merged in", () => {
  it("is dependency order: a part that builds on another is cut from the lead branch after that one is merged into it", async () => {
    const r = await teamRig();
    allGood(r);
    const split = goodSplit();
    split.parts[2]!.dependsOn = [0, 1]; // the page builds on the API
    r.json.on("team.split", split);
    const { job, branch } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    const slug = "let-people-export-a-note-as-a-pd";
    const mergeMsgs = chain(r, branch).filter((c) => c.parents.length === 2).map((c) => /^Merge part (\d)/.exec(c.message)![1]).reverse();
    expect(mergeMsgs.indexOf("1")).toBeLessThan(mergeMsgs.indexOf("2"));
    expect(mergeMsgs.sort()).toEqual(["1", "2", "3", "4"]);
    // The page's branch was cut AFTER the API's merge: the merge of part 1 is in its history, and the API's file is already there.
    const p1 = s.team!.parts.find((p) => p.id === 1)!;
    const own = chain(r, `tailzu/${slug}-p2`);
    expect(own.some((c) => c.sha === p1.mergedSha)).toBe(true);
    const p2 = s.team!.parts.find((p) => p.id === 2)!;
    expect(p2.baseSha).toBe(p1.mergedSha ?? p2.baseSha);
    expect(p2.startedAt!).toBeGreaterThanOrEqual(p1.endedAt ?? 0);
    expect(p2.dependsOn).toEqual([0, 1]);
  });

  it("leaves a part that depends on one that failed unstarted and says so", async () => {
    const r = await teamRig();
    allGood(r);
    const split = goodSplit();
    split.parts[2]!.dependsOn = [0, 1];
    r.json.on("team.split", split);
    // The API's helper fails: its checks never go green.
    let broke = false;
    r.runner.checkResult = (kind, run) => {
      const mine = run.overlay.some((f) => f.path === "src/api/notes.ts");
      if (mine && kind === "test") { broke = true; return { exit: 1, text: "FAIL src/api/notes.test.ts > the export\nAssertionError: boom" }; }
      return { exit: 0, text: "ok" };
    };
    const { job } = await r.startLead();
    const { s } = await run(r, job.id);
    expect(broke).toBe(true);
    const by = (n: number) => s.team!.parts.find((p) => p.id === n)!;
    expect(by(1).status).toBe("failed");
    expect(by(2).status).toBe("skipped");
    expect(by(2).reason).toContain("Part 1 (Export API) did not finish");
    expect(by(2).jobIds).toEqual([]);
    expect([by(3).status, by(4).status]).toEqual(["merged", "merged"]);
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(true);
  });
});

describe("a part that clashes with the lead branch", () => {
  const MARKERS = (their: string) => `<<<<<<< HEAD\nexport const notes = "someone else";\n=======\n${their}>>>>>>> abc1234\n`;
  const RESOLVED = 'export const notes = "someone else and v1";\n';

  it("goes through the runner merge flow, and the lead commits the resolution as a merge commit with two parents", async () => {
    const r = await teamRig();
    allGood(r);
    let leadBranch = "";
    // Someone pushes to the lead branch, in a file the API's helper changed, while the helper works.
    r.scripts.set("p1", [
      edit("src/api/notes.ts", "v1"), edit("src/api/notes.test.ts", "v1"), edit("src/api/routes.ts", "v1"),
      () => { r.fake.push(r.repo, leadBranch, { "src/api/notes.ts": 'export const notes = "someone else";\n' }, "someone else changes the API"); return done("Built the export endpoint."); },
    ]);
    r.json.on("care.conflict", { files: [{ path: "src/api/notes.ts", kind: "mechanical", reason: "Both sides changed the same constant; both can stay." }] });
    r.scripts.get("lead")!.push(call("read_file", { path: "src/api/notes.ts" }), call("write_file", { path: "src/api/notes.ts", content: RESOLVED }), done("Kept both sides."));
    r.runner.commandResult = (cmd) => (cmd.includes("TAILZU_CONFLICT") ? { exit: 0, out: "TAILZU_CONFLICT src/api/notes.ts" } : { exit: 0, out: "ok" });
    r.runner.changesFor = (run) => (run.commands.some((c) => c.includes("merge --no-commit")) ? [{ path: "src/api/notes.ts", content: MARKERS('export const notes = "v1";\n') }] : undefined);
    const started = await r.startLead();
    leadBranch = started.branch;
    const { s, job: j } = await run(r, started.job.id);
    expect(j.state, s.report?.text).toBe("done");
    const p1 = s.team!.parts.find((p) => p.id === 1)!;
    expect(p1.status).toBe("merged");
    expect(s.team!.merging).toBeUndefined();
    expect(s.merge).toBeUndefined();
    // A computer merged the part's branch into the lead branch with git, fetching the part's head BY COMMIT, and pushed nothing.
    const merge = r.runner.runs.find((x) => x.commands.some((c) => c.includes("merge --no-commit")))!;
    const partHead = p1.headSha!;
    expect(merge.commands.join("\n")).toContain(`git fetch --no-tags origin ${partHead}`);
    expect(r.runner.runs.flatMap((x) => x.commands).some((c) => /\b(?:rebase|push|reset|--force)\b/.test(c))).toBe(false);
    // The server's merge commit: two parents, the lead branch's head then the part's head; the resolved text; checked before it was committed.
    const m = chain(r, started.branch).find((c) => c.parents[1] === partHead)!;
    expect(m).toBeTruthy();
    expect(m.message).toContain(`Merge tailzu/`);
    expect(r.fake.files(r.repo, started.branch)["src/api/notes.ts"]).toBe(RESOLVED);
    expect(r.runner.runs.some((x) => x.wrapped && x.overlay.some((f) => f.path === "src/api/notes.ts" && f.content === RESOLVED))).toBe(true);
    // The rest of the team went on, and there is one pull request.
    expect(s.team!.parts.map((p) => p.status)).toEqual(["merged", "merged", "merged", "merged", "merged"]);
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
  });

  it("asks the person which side wins when both changed the same logic, and the rest of the team waits for the answer", async () => {
    const r = await teamRig();
    allGood(r);
    let leadBranch = "";
    r.scripts.set("p1", [
      edit("src/api/notes.ts", "v1"), edit("src/api/notes.test.ts", "v1"), edit("src/api/routes.ts", "v1"),
      () => { r.fake.push(r.repo, leadBranch, { "src/api/notes.ts": 'export const notes = "someone else";\n' }); return done("Built."); },
    ]);
    r.json.on("care.conflict", { files: [{ path: "src/api/notes.ts", kind: "semantic", reason: "One side returns a PDF, the other a CSV." }] });
    r.scripts.get("lead")!.push(call("write_file", { path: "src/api/notes.ts", content: RESOLVED }), done("Kept the part's version."));
    r.runner.commandResult = (cmd) => (cmd.includes("TAILZU_CONFLICT") ? { exit: 0, out: "TAILZU_CONFLICT src/api/notes.ts" } : { exit: 0, out: "ok" });
    r.runner.changesFor = (run) => (run.commands.some((c) => c.includes("merge --no-commit")) ? [{ path: "src/api/notes.ts", content: MARKERS('export const notes = "v1";\n') }] : undefined);
    const started = await r.startLead();
    leadBranch = started.branch;
    await settle(r, async () => (await r.jobNow(started.job.id)).state === "waiting_for_you");
    const j = await r.jobNow(started.job.id);
    expect(j.waitingOn).toBe("answer");
    const s = await r.stateNow(started.job.id);
    expect(s.waiting).toMatchObject({ kind: "question", from: "merge" });
    expect(s.team!.merging).toBe(1);
    await r.lead.answer("alice", started.job.id, "Keep this branch's behaviour");
    await settle(r, async () => OVER.includes((await r.jobNow(started.job.id)).state));
    const end = await r.stateNow(started.job.id);
    expect((await r.jobNow(started.job.id)).state, end.report?.text).toBe("done");
    expect(end.team!.parts.find((p) => p.id === 1)!.status).toBe("merged");
    expect(r.model.seen.some((x) => x.messages.includes("The person decided: Keep this branch's behaviour"))).toBe(true);
  });
});

describe("the full check", () => {
  /**
   * The lead's own runs of the checks. The first is the baseline and the next is the check of part 0 (both pass); once a helper has run, every run of the lead's is a FULL CHECK of
   * the merged branch (or of a fix laid over it), and `answer` says what the test check says to the n-th of them (from 1). The helpers' runs always pass. `prsAtCheck` is how many
   * pull requests were open when each full check ran.
   */
  function leadChecks(r: Rig, answer: (round: number) => { exit: number; text?: string }) {
    let leadId = "";
    let helperSeen = false;
    const counted = new Set<unknown>();
    let n = 0;
    const seen = { prsAtCheck: [] as number[] };
    const ok = { exit: 0, text: "ok" };
    r.runner.checkResult = (kind, run) => {
      if (!run.wrapped) return ok;
      if (!leadId && run.overlay.length === 0) leadId = run.jobId;
      if (run.jobId !== leadId) { helperSeen = true; return ok; }
      if (!helperSeen) return ok;
      if (!counted.has(run)) { counted.add(run); n += 1; seen.prsAtCheck.push(r.fake.pulls(r.repo).length); }
      return kind === "test" ? answer(n) : ok;
    };
    return seen;
  }
  const FAIL = { exit: 1, text: "FAIL src/util/format.test.ts > formats\nAssertionError: the parts do not fit" };

  it("runs on the merged branch against the baseline before the pull request is opened, and a failure it caused is fixed by the lead first", async () => {
    const r = await teamRig();
    allGood(r);
    const seen = leadChecks(r, (k) => (k === 1 ? FAIL : { exit: 0, text: "ok" }));
    // After the merges the lead fixes what the full check found.
    r.scripts.get("lead")!.push(edit("src/util/format.ts", "v2", "v1"), done("Made the formats fit."));
    const { job, branch } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    // The first full check failed and no pull request was open then; the second passed on the lead's fix, which was committed before the pull request.
    expect(seen.prsAtCheck).toEqual([0, 0]);
    expect(s.verify).toMatchObject({ ran: true, ok: true });
    expect(s.verify!.round).toBe(1);
    expect(r.fake.files(r.repo, branch)["src/util/format.ts"]).toBe('export const format = "v2";\n');
    expect(chain(r, branch)[0]!.parents).toHaveLength(1);
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    expect(r.fake.pulls(r.repo)[0]!.draft).toBe(false);
    expect(s.team!.stage).toBe("final");
    // The model that fixed it was told what was found, as the checks' output.
    expect(r.model.seen.some((x) => x.messages.includes("The checks FAILED on your last attempt") && x.messages.includes("the parts do not fit"))).toBe(true);
  });

  it("stops the job without a pull request when it still fails after three rounds, and says what is on the branch", async () => {
    const r = await teamRig();
    allGood(r);
    leadChecks(r, () => FAIL);
    r.scripts.get("lead")!.push(edit("src/util/format.ts", "v2", "v1"), done("Try 1."), edit("src/util/format.ts", "v3", "v2"), done("Try 2."), edit("src/util/format.ts", "v4", "v3"), done("Try 3."));
    const { job, branch } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state).toBe("failed");
    expect(s.report!.text).toContain("The checks still fail after 3 rounds of fixes");
    expect(s.report!.text).toContain("What the helpers built is merged on the branch, and no pull request was opened");
    expect(r.fake.pulls(r.repo)).toHaveLength(0);
    // The merged parts are on the branch; nothing was thrown away.
    expect(r.fake.files(r.repo, branch)["src/api/notes.ts"]).toBe('export const notes = "v1";\n');
  });

  it("does not hold the pull request back for a check that was already failing before Tailzu", async () => {
    const r = await teamRig();
    allGood(r);
    // The test check failed at the baseline, and fails the same way on the merged branch.
    r.runner.checkResult = (kind, run) => (run.wrapped && kind === "test" && run.overlay.length === 0 ? { exit: 1, text: "FAIL src/legacy.test.ts > the old thing\nAssertionError: old" } : { exit: 0, text: "ok" });
    const { job } = await r.startLead();
    const { s, job: j } = await run(r, job.id);
    expect(j.state, s.report?.text).toBe("done");
    expect(s.verify!.ok).toBe(true);
    expect(s.verify!.alreadyBroken.length).toBeGreaterThan(0);
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
    expect(r.fake.pulls(r.repo)[0]!.body).toContain("Already broken before Tailzu");
  });
});
