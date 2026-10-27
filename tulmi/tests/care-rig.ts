/**
 * THE TEST RIG FOR PR CARE (code-pr-care*.test.ts): THE AGENT RIG (tests/agent-rig.ts), WITH THE CARE ENGINE OVER THE SAME FAKE GITHUB, JOBS, AGENT AND MODEL.
 *
 * What is real: the engine, the care store (memory), the agent loop it makes jobs on, the router, the policy, the workspace. What is a script: GitHub (the fake,
 * which now has check runs, commit statuses, Actions logs behind a redirect, review threads and comments), the model, and the computer a step runs on.
 *
 * `openPr()` makes a pull request the way Tailzu does: a work branch, a commit by the bot, a draft pull request, its number written on the branch. The event
 * builders make the webhook payloads GitHub sends, with just the fields the engine reads.
 */
import type { PrCare } from "../src/code/prcare/engine.js";
import type { NotifyData, NotifyKind } from "../src/code/jobs/types.js";
import { agentRig, UTIL_EDIT, type AgentRigOptions } from "./agent-rig.js";
import type { FakeRepo } from "./github-fake.js";

/** What the App is given for PR care: Checks, Commit statuses and Actions (read), on top of Contents and Pull requests. */
export const CARE_PERMS = { contents: "write", pull_requests: "write", metadata: "read", checks: "read", statuses: "read", actions: "read" };

export const FIXED = '  return s.toLowerCase().replace(/\\s+/g, "-").replace(/^-+|-+$/g, "");\n';
/** The edit a job makes to the branch after it has been opened: it trims, and rejects the stray whitespace. */
export const CARE_EDIT = { path: "src/util.ts", old: FIXED, new: '  return s.trim().toLowerCase().replace(/\\s+/g, "-").replace(/^-+|-+$/g, "");\n' };

export async function careRig(o: AgentRigOptions = {}) {
  // The path to the module is dynamic so the env this file is imported under (the test sets it before) is the one the engine reads.
  const { createPrCare, MemoryCareStore } = await import("../src/code/prcare/index.js");
  const r = await agentRig({ installPermissions: CARE_PERMS, ...o });
  const store = new MemoryCareStore();
  const careTold: Array<{ userId: string; kind: NotifyKind; data: NotifyData }> = [];
  const care = createPrCare({
    code: r.code, jobs: r.jobs, agent: r.orch, store, call: r.model.call as never, jobStore: r.jobStore, worklog: r.worklog, now: r.now, log: r.log,
    notify: (userId, kind, data) => { careTold.push({ userId, kind, data }); },
  }) as PrCare;

  /** A pull request as Tailzu opens one: a work branch, one commit by the bot that changes src/util.ts, a draft pull request. */
  async function openPr(task = "Trim the dashes from slug", over: { files?: Array<{ path: string; content: string }> } = {}) {
    const { createWorkBranch, workspace } = await import("../src/code/projects.js");
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, task);
    const ws = await workspace(r.d, "alice", r.project.id, branch);
    await ws.commit(over.files ?? [{ path: "src/util.ts", content: "export function slug(s: string): string {\n" + FIXED + "}\n" }], "Trim dashes from slug");
    const pr = await ws.openDraftPr(task, "Trims the dashes from both ends.");
    return { branch, number: pr.prNumber, url: pr.prUrl, head: () => r.fake.head(r.repo, branch)! };
  }

  /** The status comments on a pull request (the care engine's own). */
  const statusComments = (number: number) => r.fake.conversationOf(r.repo, number).filter((c) => c.body.includes("tailzu-pr-status"));
  /** Every job PR care started, newest last, with its care context. */
  async function careJobs() {
    const { stateOf } = await import("../src/code/agent/types.js");
    const all = (await r.jobStore.listJobs("alice", 100)).reverse();
    return all.map((j) => ({ job: j, state: stateOf(j.checkpoint) })).filter((x) => x.state?.care);
  }
  /** Lets the engine's queue drain, then the agent's loops, then the engine again (a job that ended is written up on the next look). */
  async function settle() {
    await care.idle();
    await r.orch.idle();
    await care.sweep();
    await care.idle();
  }

  return { ...r, care, careStore: store, careTold, openPr, statusComments, careJobs, settle, ev: events(r.repo) };
}
export type CareRig = Awaited<ReturnType<typeof careRig>>;

// ------------------------------------------------------------ the webhook payloads

const sender = (login: string, type = "User") => ({ login, type });

/** The payloads GitHub sends, with the fields the engine reads. */
export function events(repo: FakeRepo) {
  const repository = { id: repo.id, full_name: repo.fullName };
  const pull = (number: number, branch: string) => ({ number, head: { ref: branch, repo: { id: repo.id } }, base: { ref: repo.defaultBranch, repo: { id: repo.id } } });
  return {
    pullRequest: (number: number, branch: string, action = "opened", by = "alice") => ({ action, number, pull_request: pull(number, branch), repository, sender: sender(by) }),
    checkSuite: (number: number | null, branch: string, action = "completed") => ({
      action, check_suite: { head_branch: branch, pull_requests: number === null ? [] : [pull(number, branch)] }, repository, sender: sender("github-actions[bot]", "Bot"),
    }),
    checkRun: (number: number | null, branch: string, action = "completed") => ({
      action, check_run: { check_suite: { head_branch: branch }, pull_requests: number === null ? [] : [pull(number, branch)] }, repository, sender: sender("github-actions[bot]", "Bot"),
    }),
    status: (branch: string, state = "failure") => ({ state, branches: [{ name: branch }], repository, sender: sender("ci-bot", "Bot") }),
    reviewComment: (number: number, branch: string, by: string, type = "User") => ({ action: "created", pull_request: pull(number, branch), comment: { user: sender(by, type) }, repository, sender: sender(by, type) }),
    review: (number: number, branch: string, by: string) => ({ action: "submitted", pull_request: pull(number, branch), review: { user: sender(by), state: "commented" }, repository, sender: sender(by) }),
    issueComment: (number: number, by: string, type = "User") => ({ action: "created", issue: { number, pull_request: {} }, comment: { user: sender(by, type) }, repository, sender: sender(by, type) }),
  };
}

export { UTIL_EDIT };
