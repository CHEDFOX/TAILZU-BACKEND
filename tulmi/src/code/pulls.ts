/**
 * A WORK BRANCH'S LIFE AFTER IT IS MADE: KEEPING IT CURRENT, SEEING WHAT IT
 * CHANGED, AND THE PULL REQUEST FROM OPEN TO MERGED.
 *
 *   sync        merge the default branch INTO the work branch, so it keeps up
 *   diff        what the branch changes: files and counts, never contents
 *   prStatus    where the pull request is: state, draft, mergeable, reviews
 *   prComments  what reviewers wrote (untrusted text; see github.ts pullComments)
 *   markReady   take the pull request out of draft
 *   closePr     close it without merging
 *   requestMerge / confirmMerge   the two steps of a merge (below)
 *   deleteWorkBranch   once it is merged or closed, remove the branch from GitHub
 *
 * Every function takes the person's id and finds things BY it, as projects.ts
 * does: a project or branch that isn't theirs is "not found". Every WRITE
 * (sync, ready, close, merge, delete) first asks GitHub afresh whether the
 * person can still write to the repo; the reads go by what was kept ten
 * minutes (projects.ts assertAccess).
 *
 * TAILZU NEVER RESOLVES A CONFLICT AND NEVER FORCES ANYTHING. A sync that
 * conflicts changes nothing on GitHub, marks the branch `conflict`, and says
 * "conflict"; the person fixes it on GitHub or starts a new branch.
 *
 * MERGING IS TWO STEPS because it writes to the default branch:
 *   1. requestMerge looks at the pull request (it must be open, not a draft,
 *      from this work branch, with no known conflicts), keeps a one-use,
 *      ten-minute approval bound to this person, project, branch and head
 *      commit (approvals.ts), and returns it with a summary to show;
 *   2. confirmMerge with that approval squash-merges, asking GitHub to merge
 *      THAT commit. If the branch moved since step 1, nothing is merged
 *      ("changed_since_approval").
 * The phone will put Face ID in front of step 2.
 *
 * A branch's `state` (active, pr_open, conflict, merged, closed, deleted) is
 * kept up as these happen, and by GitHub's webhook when things happen on
 * GitHub (webhook.ts). A deleted branch keeps its record.
 */
import { ConnectorError } from "../connectors/oauth.js";
import { assertMergeable, assertWorkBranch, type BranchDiff, type PullComment, type PullInfo } from "./github.js";
import { assertAccess, notFound, ownProject, recordedBranch, repoRef, type ProjectDeps } from "./projects.js";
import type { BranchState, CodeBranch, CodeProject } from "./store.js";

/** Where a branch is after a pull request is seen to be in `state`. */
function stateFromPull(rec: CodeBranch, pull: PullInfo): BranchState | null {
  const next: BranchState = pull.state === "merged" ? "merged" : pull.state === "closed" ? "closed" : "pr_open";
  if (next === rec.state) return null;
  // A conflict found by a sync stays until a sync gets past it.
  return next === "pr_open" && rec.state === "conflict" ? null : next;
}

interface Loaded { project: CodeProject; rec: CodeBranch; repo: ReturnType<typeof repoRef> }

/** The person's project and a branch recorded in it, with the access rule applied (afresh for a write). A deleted branch is refused unless `deleted` says it is fine. */
async function load(d: ProjectDeps, userId: string, projectId: string, branch: string, o: { fresh: boolean; deleted?: boolean }): Promise<Loaded> {
  const project = await ownProject(d, userId, projectId);
  const rec = await recordedBranch(d, project, branch);
  if (rec.state === "deleted" && !o.deleted) throw new ConnectorError("branch_deleted", "That branch has been deleted from GitHub.");
  await assertAccess(d, userId, project, o.fresh);
  return { project, rec, repo: repoRef(d, userId, project) };
}

/** The pull request Tailzu opened for the branch. */
function prNumberOf(rec: CodeBranch): number {
  if (rec.prNumber === null) throw notFound("a pull request for that branch");
  return rec.prNumber;
}

/** Notes what GitHub says about the pull request in the branch's state, if that moves it. */
async function follow(d: ProjectDeps, rec: CodeBranch, pull: PullInfo): Promise<void> {
  const next = stateFromPull(rec, pull);
  if (next) await d.store.setBranchState(rec.projectId, rec.branch, next);
}

// ------------------------------------------------------------ keeping current

/**
 * Merges the default branch into the work branch. "merged" or "up_to_date" on
 * success; a conflict marks the branch `conflict` and throws "conflict".
 */
export async function syncBranch(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<{ status: "merged" | "up_to_date"; sha?: string }> {
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: true });
  assertWorkBranch(rec.branch, repo.defaultBranch);
  let done;
  try {
    done = await d.github.mergeDefaultInto(repo, rec.branch);
  } catch (err) {
    if (err instanceof ConnectorError && err.code === "conflict") await d.store.setBranchState(projectId, rec.branch, "conflict");
    throw err;
  }
  if (rec.state === "conflict") await d.store.setBranchState(projectId, rec.branch, rec.prNumber === null ? "active" : "pr_open");
  return done;
}

// ------------------------------------------------------------ what changed

/** What the branch changes against the default branch (at most 300 files; no contents, no patches). */
export async function branchDiff(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<BranchDiff> {
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: false });
  return d.github.compare(repo, rec.branch);
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
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: false });
  const pull = await d.github.getPull(repo, prNumberOf(rec));
  await follow(d, rec, pull);
  return {
    number: pull.number, url: pull.url, title: pull.title, state: pull.state, draft: pull.draft,
    mergeable: pull.mergeable, mergeableState: pull.mergeableState, headSha: pull.headSha,
    reviewDecision: await d.github.reviewDecision(repo, pull), reviewComments: pull.reviewComments, lastReviewAt: rec.lastReviewAt,
  };
}

/** What reviewers and others wrote on the pull request, at most 100, as the bot reads them later. UNTRUSTED TEXT: github.ts pullComments. */
export async function prComments(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<{ comments: PullComment[]; truncated: boolean }> {
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: false });
  return d.github.pullComments(repo, prNumberOf(rec));
}

/** Takes the pull request out of draft. Already out of draft is fine. */
export async function markReady(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<{ draft: false }> {
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: true });
  const pull = await d.github.getPull(repo, prNumberOf(rec));
  if (pull.state !== "open") throw new ConnectorError("pr_not_open", pull.state === "merged" ? "That pull request is already merged." : "That pull request is closed.");
  if (pull.draft) await d.github.markReady(repo, pull);
  await follow(d, rec, pull);
  return { draft: false };
}

/** Closes the pull request without merging it. Already closed is fine; a merged one can't be. */
export async function closePr(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<{ state: "closed" }> {
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: true });
  const number = prNumberOf(rec);
  const pull = await d.github.getPull(repo, number);
  if (pull.state === "merged") {
    await follow(d, rec, pull);
    throw new ConnectorError("pr_merged", "That pull request is already merged.");
  }
  if (pull.state === "open") await d.github.closePull(repo, number);
  await d.store.setBranchState(projectId, rec.branch, "closed");
  return { state: "closed" };
}

// ------------------------------------------------------------ merging, in two steps

export interface MergeRequest {
  needsApproval: true;
  approvalId: string;
  /** Epoch ms after which the approval is no good. */
  expiresAt: number;
  summary: { title: string; into: string; files: number; additions: number; deletions: number; headSha: string };
}

/** Step one: nothing is merged. Looks at the pull request and returns an approval to say yes with. */
export async function requestMerge(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<MergeRequest> {
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: true });
  const number = prNumberOf(rec);
  const pull = await d.github.getPull(repo, number);
  await follow(d, rec, pull);
  assertMergeable(pull, repo, rec.branch);
  const a = d.approvals.issue({ userId, projectId, branch: rec.branch, prNumber: number, headSha: pull.headSha });
  return {
    needsApproval: true, approvalId: a.id, expiresAt: a.expiresAt,
    summary: { title: pull.title, into: pull.baseRef, files: pull.changedFiles, additions: pull.additions, deletions: pull.deletions, headSha: pull.headSha },
  };
}

/** Step two: squash-merges what step one looked at, if the branch is still at that commit. The approval is used up either way. */
export async function confirmMerge(d: ProjectDeps, userId: string, projectId: string, branch: string, approvalId: string): Promise<{ merged: true; sha: string }> {
  const taken = d.approvals.take(approvalId, { userId, projectId, branch });
  if (!taken.ok) {
    throw taken.reason === "expired"
      ? new ConnectorError("approval_expired", "That approval ran out. Look at the pull request again to merge it.")
      : new ConnectorError("approval_invalid", "That isn't an approval I have for this branch. Look at the pull request again to merge it.");
  }
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: true });
  if (rec.prNumber !== taken.approval.prNumber) {
    throw new ConnectorError("changed_since_approval", "The pull request changed after you looked at it. Nothing was merged; look at it again.");
  }
  const done = await d.github.mergePull(repo, rec.branch, taken.approval.prNumber, taken.approval.headSha);
  await d.store.setBranchState(projectId, rec.branch, "merged");
  return { merged: true, sha: done.sha };
}

// ------------------------------------------------------------ tidying up

/**
 * Deletes the branch from GitHub once its pull request is merged or closed
 * (an open one, or none, is "branch_in_use": the work isn't done), and keeps the
 * record, with the state `deleted`. A branch that is already gone is fine.
 */
export async function deleteWorkBranch(d: ProjectDeps, userId: string, projectId: string, branch: string): Promise<{ state: "deleted" }> {
  const { rec, repo } = await load(d, userId, projectId, branch, { fresh: true, deleted: true });
  if (rec.state === "deleted") return { state: "deleted" };
  // Not from what was recorded, which the webhook may be late with: from the pull request as it is now.
  const pull = rec.prNumber === null ? null : await d.github.getPull(repo, rec.prNumber);
  if (!pull || pull.state === "open") {
    throw new ConnectorError("branch_in_use", "That branch's work isn't finished. Merge or close its pull request first.");
  }
  await d.github.deleteBranch(repo, rec.branch);
  await d.store.setBranchState(projectId, rec.branch, "deleted");
  return { state: "deleted" };
}
