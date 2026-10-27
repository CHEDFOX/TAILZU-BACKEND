/**
 * PR CARE, A CONFLICT WITH THE DEFAULT BRANCH, AND A PUSH GITHUB REFUSES (src/code/prcare, src/code/agent/merge.ts, docs/pr-care.md sections 5 and 6).
 *
 *   - `mergeable: false`: a computer merges the default branch into the branch, the model resolves what clashes, the checks run on the result, and the SERVER
 *     commits a merge commit with two parents. Never a rebase, never a force; the branch only moves forward
 *   - two sides that changed the same logic: the person is asked which should win, and nothing is committed until they say
 *   - a conflict is dealt with once for a given pair of commits; a clean pull request is left alone
 *   - GitHub refuses a push (a protection rule): the job stops, the status comment carries exactly what GitHub said and its link, nothing is worked round,
 *     and the job waits for the person (who may stop it)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

const { call, done } = await import("./agent-rig.js");
const { careRig, CARE_EDIT, CARE_PERMS, FIXED } = await import("./care-rig.js");
const { resetSettingsStoreForTests } = await import("../src/code/agent/settings.js");
type Rig = Awaited<ReturnType<typeof careRig>>;

beforeEach(() => { resetSettingsStoreForTests(); });

const MAIN_UTIL = 'export function slug(s: string): string {\n  return s.toLowerCase().replace(/\\s+/g, "_");\n}\n';
/** Both sides' intent: dashes and a trim from the branch, and the underscores the default branch used turned into dashes too. */
const resolved = (): string => 'export function slug(s: string): string {\n  return s.toLowerCase().replace(/\\s+/g, "-").replace(/_/g, "-").replace(/^-+|-+$/g, "");\n}\n';
const markers = (baseSha: string): string =>
  `export function slug(s: string): string {\n<<<<<<< HEAD\n${FIXED}=======\n  return s.toLowerCase().replace(/\\s+/g, "_");\n>>>>>>> ${baseSha}\n}\n`;

/** A pull request that clashes with the default branch: both changed src/util.ts. The runner merges "on a computer" and hands the clash back. */
async function clashing(r: Rig) {
  const pr = await r.openPr();
  r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch));
  await r.settle();
  const mainSha = r.fake.push(r.repo, "main", { "src/util.ts": MAIN_UTIL }, "main changes slug");
  r.runner.commandResult = (cmd) => (cmd.includes("TAILZU_CONFLICT") ? { exit: 0, out: "TAILZU_CONFLICT src/util.ts" } : { exit: 0, out: "ok" });
  r.runner.changesFor = (run) => (run.commands.some((c) => c.includes("merge --no-commit")) ? [{ path: "src/util.ts", content: markers(mainSha) }] : undefined);
  return { ...pr, mainSha };
}
const baseMoved = (r: Rig) => r.care.baseMoved(r.project);

describe("a conflict with the default branch", () => {
  it("is merged in on a computer, resolved by the model, checked, and committed by the server as a merge commit with two parents", async () => {
    const r = await careRig();
    const pr = await clashing(r);
    r.json.on("care.conflict", { files: [{ path: "src/util.ts", kind: "mechanical", reason: "Both sides changed the same line; the branch's version keeps the trim." }] });
    r.model.push(call("read_file", { path: "src/util.ts" }), call("write_file", { path: "src/util.ts", content: resolved() }), done("Kept the trim and the dashes."));
    const head0 = pr.head();
    baseMoved(r);
    await r.settle();

    const [{ job, state }] = await r.careJobs();
    expect(state!.care).toMatchObject({ kind: "conflict", base: "main" });
    expect(job.state).toBe("done");
    // The merge was made on a computer, with the default branch fetched by its commit; the runner never pushed, rebased or reset.
    const merge = r.runner.runs.find((x) => x.commands.some((c) => c.includes("merge --no-commit")))!;
    expect(merge.commands.join("\n")).toContain(`git fetch --no-tags origin ${pr.mainSha}`);
    expect(r.runner.runs.flatMap((x) => x.commands).some((c) => /\b(?:rebase|push|reset|--force|checkout -B)\b/.test(c))).toBe(false);
    // The server's commit: two parents (the branch, then the default branch's commit), the resolved text, the bot as the author.
    const commit = r.fake.headCommit(r.repo, pr.branch);
    expect(r.fake.parentsOf(r.repo, pr.branch)).toEqual([head0, pr.mainSha]);
    expect(commit.author).toEqual({ name: "Blip", email: "blip@tailzu.space" });
    expect(commit.message).toContain("Merge main into");
    expect(r.fake.files(r.repo, pr.branch)["src/util.ts"]).toBe(resolved());
    // The checks ran on the resolved text before it was committed.
    expect(r.runner.runs.some((x) => x.wrapped && x.overlay.some((f) => f.path === "src/util.ts" && f.content === resolved()))).toBe(true);
    // The branch only moved forward: no ref update was a force.
    expect(r.fake.calls.filter((c) => c.method === "PATCH" && /\/git\/refs\//.test(c.url.pathname)).every((c) => c.body?.force !== true)).toBe(true);
    // The pull request merges now, and the status says it was done.
    const row = (await r.careStore.get(r.project.id, pr.number))!;
    expect(row.state.conflict).toMatchObject({ outcome: "merged" });
    expect(r.statusComments(pr.number)[0]!.body).toMatch(/Merged main into the branch \([0-9a-f]{7}\)\./);
    expect(r.fake.pulls(r.repo)).toHaveLength(1);
  });

  it("asks the person which side should win when both changed the same logic, and commits nothing until they say", async () => {
    const r = await careRig();
    const pr = await clashing(r);
    r.json.on("care.conflict", { files: [{ path: "src/util.ts", kind: "semantic", reason: "One side joins words with dashes, the other with underscores: keeping either loses the other's behaviour." }] });
    const head0 = pr.head();
    baseMoved(r);
    await r.settle();

    let [{ job, state }] = await r.careJobs();
    expect(job.state).toBe("waiting_for_you");
    expect(job.waitingOn).toBe("answer");
    expect(state!.waiting).toMatchObject({ kind: "question", from: "merge" });
    expect((state!.waiting as { options: string[] }).options).toEqual(["Keep this branch's behaviour", "Take main's behaviour", "I will resolve it myself"]);
    expect(r.fake.head(r.repo, pr.branch)).toBe(head0);
    // The status comment says the job is waiting, with the question.
    const body = r.statusComments(pr.number)[0]!.body;
    expect(body).toContain("Waiting for you");
    expect(body).toContain("Both sides changed the same logic in src/util.ts");
    // The person decides; the model is told their choice, resolves, and the server commits.
    r.model.push(call("write_file", { path: "src/util.ts", content: resolved() }), done("Kept the branch's version, as you said."));
    await r.orch.answer("alice", job.id, "Keep this branch's behaviour");
    await r.settle();
    [{ job, state }] = await r.careJobs();
    expect(job.state).toBe("done");
    expect(r.model.seen[0]!.user).toContain("The person decided: Keep this branch's behaviour");
    expect(r.fake.parentsOf(r.repo, pr.branch)).toEqual([head0, pr.mainSha]);
    expect((await r.careStore.get(r.project.id, pr.number))!.state.waiting).toBeUndefined();
  });

  it("is dealt with once for a given pair of commits, however many events say so", async () => {
    const r = await careRig();
    const pr = await clashing(r);
    r.json.on("care.conflict", { files: [{ path: "src/util.ts", kind: "mechanical", reason: "ok" }] });
    r.model.push(call("write_file", { path: "src/util.ts", content: resolved() }), done("Merged."));
    baseMoved(r);
    r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch, "synchronize"));
    baseMoved(r);
    await r.settle();
    baseMoved(r);
    await r.settle();
    expect(await r.careJobs()).toHaveLength(1);
  });

  it("leaves a pull request that merges cleanly alone", async () => {
    const r = await careRig();
    const pr = await r.openPr();
    r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch));
    await r.settle();
    // The default branch moved, in a file the pull request did not touch.
    r.fake.push(r.repo, "main", { "README.md": "# app\n\nMore words.\n" }, "main changes the readme");
    const writes = r.fake.writes().length;
    baseMoved(r);
    await r.settle();
    expect(await r.careJobs()).toEqual([]);
    expect(r.fake.writes().length).toBe(writes);
  });

  it("is looked at again later when GitHub has not worked out yet whether it merges", async () => {
    const r = await careRig();
    const pr = await clashing(r);
    r.json.on("care.conflict", { files: [{ path: "src/util.ts", kind: "mechanical", reason: "ok" }] });
    r.model.push(call("write_file", { path: "src/util.ts", content: resolved() }), done("Merged."));
    r.fake.editPull(r.repo, pr.number, { mergeable: null });
    baseMoved(r);
    await r.settle();
    expect(await r.careJobs()).toEqual([]);
    expect((await r.careStore.get(r.project.id, pr.number))!.state.recheck).toBe(true);
    // GitHub has worked it out: the sweep finds the flag and looks again.
    r.fake.editPull(r.repo, pr.number, { mergeable: false });
    await r.care.sweep();
    await r.settle();
    expect(await r.careJobs()).toHaveLength(1);
  });

  it("says so and asks nothing of the model when no computer can do the merge: nothing is changed", async () => {
    const r = await careRig({ placeWaitMs: 5_000 });
    const pr = await clashing(r);
    r.runner.open = false;
    const head0 = pr.head();
    baseMoved(r);
    await r.settle();
    const [{ job }] = await r.careJobs();
    expect(job.state).toBe("failed");
    expect(r.fake.head(r.repo, pr.branch)).toBe(head0);
    expect((await r.careStore.get(r.project.id, pr.number))!.state.conflict).toMatchObject({ outcome: "failed" });
    expect(r.careTold.filter((t) => t.kind === "needs_you")).toHaveLength(1);
    expect(r.json.of("care.conflict")).toHaveLength(0);
  });

  it("leaves a CI configuration conflict to the person, who edits workflows themselves", async () => {
    const r = await careRig({ installPermissions: { ...CARE_PERMS, workflows: "write" } });
    // A pull request that adds a workflow file (made on GitHub directly: committing one is the person's to approve).
    const { createWorkBranch, workspace } = await import("../src/code/projects.js");
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, "Change the CI");
    r.fake.push(r.repo, branch, { ".github/workflows/ci.yml": "name: ci\non: push\n" }, "ci");
    const opened = await (await workspace(r.d, "alice", r.project.id, branch)).openDraftPr("Change the CI", "body");
    const pr = { branch, number: opened.prNumber, head: () => r.fake.head(r.repo, branch)! };
    r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch));
    await r.settle();
    const mainSha = r.fake.push(r.repo, "main", { ".github/workflows/ci.yml": "name: other\non: pull_request\n" }, "main changes ci");
    r.runner.commandResult = (cmd) => (cmd.includes("TAILZU_CONFLICT") ? { exit: 0, out: "TAILZU_CONFLICT .github/workflows/ci.yml" } : { exit: 0, out: "ok" });
    r.runner.changesFor = (run) => (run.commands.some((c) => c.includes("merge --no-commit")) ? [{ path: ".github/workflows/ci.yml", content: `<<<<<<< HEAD\nname: ci\n=======\nname: other\n>>>>>>> ${mainSha}\n` }] : undefined);
    const head0 = pr.head();
    baseMoved(r);
    await r.settle();
    const [{ job }] = await r.careJobs();
    expect(job.state).toBe("failed");
    expect(job.reason).toContain("CI configuration");
    expect(r.fake.head(r.repo, pr.branch)).toBe(head0);
  });
});

describe("a push GitHub refuses", () => {
  it("stops the job, puts exactly what GitHub said and its link in the status, pushes nothing else, and waits; the person may stop it", async () => {
    const r = await careRig();
    const pr = await r.openPr();
    r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch));
    await r.settle();
    const run = r.fake.addCheckRun(r.repo, pr.head(), { name: "test", conclusion: "failure" });
    r.fake.setJobLog(run.id, "AssertionError: expected 'a--b' to be 'a-b'\nProcess completed with exit code 1.");
    // A rule on the repo says no to the branch.
    r.fake.protect(r.repo, pr.branch);
    r.model.push(call("read_file", { path: "src/util.ts" }), call("edit_file", CARE_EDIT), done("Trimmed the input."));
    const head0 = pr.head();
    r.care.onEvent("check_suite", r.ev.checkSuite(pr.number, pr.branch));
    await r.settle();

    const [{ job, state }] = await r.careJobs();
    expect(job.state).toBe("waiting_for_you");
    expect(job.waitingOn).toBe("answer");
    expect(state!.waiting).toMatchObject({ kind: "question", from: "push", options: ["Try again", "Stop"] });
    // Not worked round: the branch is where it was, and the only things written to GitHub are the tree and commit objects of the attempt and the status comment.
    expect(r.fake.head(r.repo, pr.branch)).toBe(head0);
    expect(r.fake.calls.filter((c) => c.method === "PATCH" && /\/git\/refs\//.test(c.url.pathname) && c.body?.force === true)).toEqual([]);
    expect(r.fake.calls.filter((c) => c.method === "POST" && /\/git\/refs$/.test(c.url.pathname) && c.body?.ref !== undefined && !/heads\/tailzu\//.test(String(c.body.ref)))).toEqual([]);
    // The person is told exactly what GitHub said, with its link.
    const status = r.statusComments(pr.number)[0]!.body;
    expect(status).toContain("Waiting for you");
    expect(status).toContain("Cannot update this protected ref.");
    expect(status).toContain("https://docs.github.com/articles/about-protected-branches");
    expect(status).toContain("does not try to get round a rule like this");
    // The person says stop: the job ends, nothing was pushed.
    await r.orch.answer("alice", job.id, "Stop");
    await r.settle();
    const ended = (await r.careJobs())[0]!;
    expect(ended.job.state).toBe("failed");
    expect(ended.job.reason).toContain("You chose to stop after GitHub refused the push");
    expect(r.fake.head(r.repo, pr.branch)).toBe(head0);
    expect((await r.careStore.get(r.project.id, pr.number))!.state.waiting).toBeUndefined();
  });

  it("tries again when the person says so and the rule is gone", async () => {
    const r = await careRig();
    const pr = await r.openPr();
    r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch));
    await r.settle();
    const run = r.fake.addCheckRun(r.repo, pr.head(), { name: "test", conclusion: "failure" });
    r.fake.setJobLog(run.id, "AssertionError: expected 'a--b' to be 'a-b'");
    r.fake.protect(r.repo, pr.branch);
    r.model.push(call("edit_file", CARE_EDIT), done("Trimmed."));
    r.care.onEvent("check_suite", r.ev.checkSuite(pr.number, pr.branch));
    await r.settle();
    const [{ job }] = await r.careJobs();
    expect(job.state).toBe("waiting_for_you");
    r.fake.unprotect(r.repo, pr.branch);
    await r.orch.answer("alice", job.id, "Try again");
    await r.settle();
    expect((await r.careJobs())[0]!.job.state).toBe("done");
    expect(r.fake.files(r.repo, pr.branch)["src/util.ts"]).toContain("s.trim()");
  });
});

describe("a pull request that ends", () => {
  it("cancels the jobs it started when it is closed under them", async () => {
    const r = await careRig();
    const pr = await clashing(r);
    r.json.on("care.conflict", { files: [{ path: "src/util.ts", kind: "semantic", reason: "Both changed the logic." }] });
    baseMoved(r);
    await r.settle();
    const [{ job }] = await r.careJobs();
    expect(job.state).toBe("waiting_for_you");
    r.fake.editPull(r.repo, pr.number, { state: "closed" });
    r.care.onEvent("pull_request", r.ev.pullRequest(pr.number, pr.branch, "closed"));
    await r.settle();
    expect((await r.careJobs())[0]!.job.state).toBe("cancelled");
    expect((await r.careStore.get(r.project.id, pr.number))!.state.ended).toBe("closed");
  });
});
