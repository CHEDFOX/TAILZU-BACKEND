/**
 * A BRANCH'S LIFE AFTER IT IS MADE: KEEPING IT CURRENT, SEEING WHAT IT
 * CHANGED, AND THE PULL REQUEST FROM OPEN TO MERGED.
 *
 *   sync        merge the default branch INTO the branch, so it keeps up
 *   diff        what the branch changes: files and counts, never contents
 *   prStatus    where the pull request is: state, draft, mergeable, reviews
 *   prComments  what reviewers wrote (untrusted text; see github.ts pullComments)
 *   markReady   take the pull request out of draft
 *   closePr     close it without merging
 *   mergePr     merge it (requestMerge / confirmMerge are its two steps)
 *   deleteWorkBranch   remove a branch from GitHub
 *
 * Every function takes the person's id and finds things BY it, as projects.ts
 * does: a project that isn't theirs is "not found". Every WRITE (sync, ready,
 * close, merge, delete) first asks GitHub afresh whether the person can still
 * write to the repo; the reads go by what was kept ten minutes (projects.ts
 * assertAccess).
 *
 * ANY BRANCH, NOT ONLY THE BOT'S. A branch the bot made is recorded in the
 * store (`own`). Any other branch of the project works too: its pull request is
 * found on GitHub by the branch's name. What differs is the policy (policy.ts):
 * keeping its own branch current is free; keeping another one current is a
 * question. Marking ready, closing, merging and deleting are questions for
 * every branch. The default branch can be asked about too, but deleting it is
 * the strictest question there is (Face ID, every time).
 *
 * A question is two requests, not two kinds of function: the first call does
 * nothing and answers `{ needsApproval: true, approvalId, action, summary,
 * faceId }`; the same call again with `{ approvalId }` does it, once, within
 * ten minutes, and only if the branch or pull request is still at the commit
 * that was looked at ("changed_since_approval" otherwise). A standing
 * permission the person gave for the project skips the question. A call made
 * with `attended: false` (nobody to ask) is refused as "needs_you" instead.
 *
 * TAILZU NEVER RESOLVES A CONFLICT AND NEVER FORCES ANYTHING HERE. A sync that
 * conflicts changes nothing on GitHub, marks the branch `conflict`, and says
 * "conflict"; the person fixes it on GitHub or starts a new branch. A merge
 * that GitHub holds back for branch protection is "protected_branch", said
 * plainly, and not tried another way.
 *
 * MERGING looks at the pull request first (it must be open, not a draft, from
 * this branch, with no known conflicts), then asks. The approval is bound to
 * this person, project, branch, pull request and head commit; the merge is a
 * squash of exactly that commit.
 *
 * A recorded branch's `state` (active, pr_open, conflict, merged, closed,
 * deleted) is kept up as these happen, and by GitHub's webhook when things
 * happen on GitHub (webhook.ts). A deleted branch keeps its record.
 */
import { ConnectorError } from "../connectors/oauth.js";
import { assertMergeable, validBranchName, type BranchDiff, type PullComment, type PullInfo, type RepoRef } from "./github.js";
import { gate, guardRead, type GateOptions, type Gated } from "./policy.js";
import { assertAccess, gateBase, notFound, ownProject, repoRef, type ProjectDeps } from "./projects.js";
import type { BranchState, CodeBranch, CodeProject } from "./store.js";

/** Where a branch is after a pull request is seen to be in `state`. */
function stateFromPull(rec: CodeBranch, pull: PullInfo): BranchState | null {
  const next: BranchState = pull.state === "merged" ? "merged" : pull.state === "closed" ? "closed" : "pr_open";
  if (next === rec.state) return null;
  // A conflict found by a sync stays until a sync gets past it.
  return next === "pr_open" && rec.state === "conflict" ? null : next;
}

interface Loaded { project: CodeProject; rec: CodeBranch; repo: RepoRef; own: boolean }

/**
 * The person's project and a branch of it, with the access rule applied
 * (afresh for a write). A branch the bot made has its record; any other branch
 * gets a blank one, which nothing is ever saved to. A deleted branch is
 * refused unless `deleted` says it is fine.
 */
async function load(d: ProjectDeps, userId: string, projectId: string, branch: string, o: { fresh: boolean; deleted?: boolean }): Promise<Loaded> {
  const project = await ownProject(d, userId, projectId);
  if (!validBranchName(branch)) throw notFound("that branch in this project");
  const known = await d.store.getBranch(project.id, branch);
  if (known?.state === "deleted" && !o.deleted) throw new ConnectorError("branch_deleted", "That branch has been deleted from GitHub.");
  await assertAccess(d, userId, project, o.fresh);
  const rec: CodeBranch = known ?? {
    projectId: project.id, branch, task: "", baseSha: "", prNumber: null, prUrl: null, state: "active", lastReviewAt: null, createdAt: 0,
  };
  return { project, rec, repo: repoRef(d, userId, project), own: known !== null && branch !== project.defaultBranch };
}

/** The pull request for the branch: the one recorded when the bot opened it, else the open one GitHub has for that branch. */
async function prNumberOf(d: ProjectDeps, l: Loaded): Promise<number> {
  if (l.rec.prNumber !== null) return l.rec.prNumber;
  if (!l.own) {
    const found = await d.github.findOpenPull(l.repo, l.rec.branch);
    if (found) return found.number;
  }
  throw notFound("a pull request for that branch");
}

/** Notes what GitHub says about the pull request in the branch's state, if that moves it. Only for a branch the bot made: it is the only one with a record. */
async function follow(d: ProjectDeps, l: Loaded, pull: PullInfo): Promise<void> {
  if (!l.own) return;
  const next = stateFromPull(l.rec, pull);
  if (next) await d.store.setBranchState(l.rec.projectId, l.rec.branch, next);
}

// ------------------------------------------------------------ keeping current

/**
 * Merges the default branch into the branch. "merged" or "up_to_date" on
 * success; a conflict marks the branch `conflict` and throws "conflict". Free
 * on a branch the bot made; a question on any other.
 */
export async function syncBranch(
  d: ProjectDeps, userId: string, projectId: string, branch: string, o: GateOptions = {},
): Promise<Gated<{ status: "merged" | "up_to_date"; sha?: string }>> {
  const l = await load(d, userId, projectId, branch, { fresh: true });
  if (l.rec.branch === l.project.defaultBranch) {
    throw new ConnectorError("bad_branch", "The default branch is what the others are brought up to; there is nothing to bring it up to.");
  }
  return gate({
    ...gateBase(d, userId, l.project), ...o, action: "branch.sync", branch: l.rec.branch, ownBranch: l.own,
    head: () => d.github.branchHead(l.repo, l.rec.branch),
    summary: (head) => ({ bringIn: l.project.defaultBranch, ...(head !== undefined ? { at: head } : {}) }),
    run: async () => {
      let done;
      try {
        done = await d.github.mergeDefaultInto(l.repo, l.rec.branch);
      } catch (err) {
        if (err instanceof ConnectorError && err.code === "conflict" && l.own) await d.store.setBranchState(projectId, l.rec.branch, "conflict");
        throw err;
      }
      if (l.own && l.rec.state === "conflict") await d.store.setBranchState(projectId, l.rec.branch, l.rec.prNumber === null ? "active" : "pr_open");
      return done;
    },
  });
}

// ------------------------------------------------------------ what changed

/** What the branch changes against the default branch (at most 300 files; no contents, no patches). */
export async function branchDiff(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<BranchDiff> {
  const l = await load(d, userId, projectId, branch, { fresh: false });
  await guardRead(d.store, l.project, l.rec.branch);
  return d.github.compare(l.repo, l.rec.branch);
}

// ------------------------------------------------------------ the pull request

export interface PrStatus {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  headSha: string;
  /** What reviewers decided, when GitHub says. */
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
  /** How many review comments there are. */
  reviewComments: number;
  lastReviewAt: number | null;
}

/** Where the branch's pull request is. Also brings the branch's state up to date with it. */
export async function prStatus(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<PrStatus> {
  const l = await load(d, userId, projectId, branch, { fresh: false });
  await guardRead(d.store, l.project, l.rec.branch);
  const pull = await d.github.getPull(l.repo, await prNumberOf(d, l));
  await follow(d, l, pull);
  return {
    number: pull.number, url: pull.url, title: pull.title, state: pull.state, draft: pull.draft,
    mergeable: pull.mergeable, mergeableState: pull.mergeableState, headSha: pull.headSha,
    reviewDecision: await d.github.reviewDecision(l.repo, pull), reviewComments: pull.reviewComments, lastReviewAt: l.rec.lastReviewAt,
  };
}

/** What reviewers and others wrote on the pull request, at most 100, as the bot reads them later. UNTRUSTED TEXT: github.ts pullComments. */
export async function prComments(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<{ comments: PullComment[]; truncated: boolean }> {
  const l = await load(d, userId, projectId, branch, { fresh: false });
  await guardRead(d.store, l.project, l.rec.branch);
  return d.github.pullComments(l.repo, await prNumberOf(d, l));
}

/** Takes the pull request out of draft (a question). One that is out of draft already is fine, and asks nothing. */
export async function markReady(d: ProjectDeps, userId: string, projectId: string, branch: string, o: GateOptions = {}): Promise<Gated<{ draft: false }>> {
  const l = await load(d, userId, projectId, branch, { fresh: true });
  const number = await prNumberOf(d, l);
  const pull = await d.github.getPull(l.repo, number);
  if (pull.state !== "open") throw new ConnectorError("pr_not_open", pull.state === "merged" ? "That pull request is already merged." : "That pull request is closed.");
  if (!pull.draft) {
    await follow(d, l, pull);
    return { draft: false };
  }
  return gate({
    ...gateBase(d, userId, l.project), ...o, action: "pr.ready", branch: l.rec.branch, ownBranch: l.own, prNumber: number,
    head: async () => pull.headSha,
    summary: () => ({ title: pull.title, number, headSha: pull.headSha }),
    run: async () => {
      await d.github.markReady(l.repo, pull);
      await follow(d, l, pull);
      return { draft: false as const };
    },
  });
}

/** Closes the pull request without merging it (a question). One that is closed already is fine; a merged one can't be. */
export async function closePr(d: ProjectDeps, userId: string, projectId: string, branch: string, o: GateOptions = {}): Promise<Gated<{ state: "closed" }>> {
  const l = await load(d, userId, projectId, branch, { fresh: true });
  const number = await prNumberOf(d, l);
  const pull = await d.github.getPull(l.repo, number);
  if (pull.state === "merged") {
    await follow(d, l, pull);
    throw new ConnectorError("pr_merged", "That pull request is already merged.");
  }
  const done = async () => {
    if (l.own) await d.store.setBranchState(projectId, l.rec.branch, "closed");
    return { state: "closed" as const };
  };
  if (pull.state !== "open") return done();
  return gate({
    ...gateBase(d, userId, l.project), ...o, action: "pr.close", branch: l.rec.branch, ownBranch: l.own, prNumber: number,
    head: async () => pull.headSha,
    summary: () => ({ title: pull.title, number, headSha: pull.headSha }),
    run: async () => {
      await d.github.closePull(l.repo, number);
      return done();
    },
  });
}

// ------------------------------------------------------------ merging, in two steps

/**
 * Merges the branch's pull request: a squash of exactly the commit that was
 * looked at. Step one (no `approvalId`) looks at the pull request, which must
 * be open, not a draft, from this branch, with no known conflicts, and answers
 * with the question and what would be merged (title, base, files, additions,
 * deletions, head commit). Step two (with the `approvalId` it gave) merges, if
 * the branch still points at that commit; if it moved, nothing is merged
 * ("changed_since_approval"). The approval is single use and lasts ten
 * minutes. With a standing permission for `pr.merge`, step one merges.
 */
export async function mergePr(
  d: ProjectDeps, userId: string, projectId: string, branch: string, o: GateOptions = {},
): Promise<Gated<{ merged: true; sha: string }>> {
  const l = await load(d, userId, projectId, branch, { fresh: true });
  const number = await prNumberOf(d, l);
  const pull = await d.github.getPull(l.repo, number);
  await follow(d, l, pull);
  assertMergeable(pull, l.repo, l.rec.branch);
  return gate({
    ...gateBase(d, userId, l.project), ...o, action: "pr.merge", branch: l.rec.branch, ownBranch: l.own, prNumber: number,
    head: async () => pull.headSha,
    summary: () => ({ title: pull.title, into: pull.baseRef, files: pull.changedFiles, additions: pull.additions, deletions: pull.deletions, headSha: pull.headSha }),
    run: async (approved) => {
      const done = await d.github.mergePull(l.repo, l.rec.branch, number, approved?.headSha ?? pull.headSha);
      if (l.own) await d.store.setBranchState(projectId, l.rec.branch, "merged");
      return { merged: true as const, sha: done.sha };
    },
  });
}

/** Step one of a merge: nothing is merged; the question comes back (or, with a standing permission, the merge). */
export const requestMerge = (d: ProjectDeps, userId: string, projectId: string, branch: string, o: GateOptions = {}) =>
  mergePr(d, userId, projectId, branch, { ...o, approvalId: undefined });

/** Step two of a merge: squash-merges what step one looked at, if the branch is still at that commit. The approval is used up either way. */
export const confirmMerge = (d: ProjectDeps, userId: string, projectId: string, branch: string, approvalId: string, o: GateOptions = {}) =>
  mergePr(d, userId, projectId, branch, { ...o, approvalId });

// ------------------------------------------------------------ tidying up

/**
 * Deletes the branch from GitHub (a question; Face ID for the default branch,
 * which is the strictest one there is), and keeps the record of one the bot
 * made, with the state `deleted`. A branch the bot made is deleted only once
 * its pull request is merged or closed (an open one, or none, is
 * "branch_in_use": the work isn't done); any other branch with an open pull
 * request is the same. A branch that is already gone is fine.
 */
export async function deleteWorkBranch(d: ProjectDeps, userId: string, projectId: string, branch: string, o: GateOptions = {}): Promise<Gated<{ state: "deleted" }>> {
  const l = await load(d, userId, projectId, branch, { fresh: true, deleted: true });
  if (l.rec.state === "deleted") return { state: "deleted" };
  const isDefault = l.rec.branch === l.project.defaultBranch;
  if (l.own) {
    // Not from what was recorded, which the webhook may be late with: from the pull request as it is now.
    const pull = l.rec.prNumber === null ? null : await d.github.getPull(l.repo, l.rec.prNumber);
    if (!pull || pull.state === "open") {
      throw new ConnectorError("branch_in_use", "That branch's work isn't finished. Merge or close its pull request first.");
    }
  } else if (!isDefault && (await d.github.findOpenPull(l.repo, l.rec.branch))) {
    throw new ConnectorError("branch_in_use", "That branch has an open pull request. Merge or close it first.");
  }
  let head: string;
  try {
    head = await d.github.branchHead(l.repo, l.rec.branch);
  } catch (err) {
    // Already gone from GitHub (a merge can delete its branch itself): nothing to delete, nothing to ask.
    if (err instanceof ConnectorError && err.code === "not_found" && l.own) {
      await d.store.setBranchState(projectId, l.rec.branch, "deleted");
      return { state: "deleted" };
    }
    throw err;
  }
  return gate({
    ...gateBase(d, userId, l.project), ...o, action: isDefault ? "branch.delete_default" : "branch.delete", branch: l.rec.branch, ownBranch: l.own,
    head: async () => head,
    summary: () => ({ delete: l.rec.branch, at: head, defaultBranch: isDefault }),
    run: async () => {
      await d.github.deleteBranch(l.repo, l.rec.branch);
      if (l.own) await d.store.setBranchState(projectId, l.rec.branch, "deleted");
      return { state: "deleted" as const };
    },
  });
}
