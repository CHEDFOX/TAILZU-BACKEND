/**
 * MERGING A PART INTO THE LEAD BRANCH: SERVER-SIDE, TWO PARENTS, THROUGH THE POLICY.
 *
 * A part is finished and reviewed on its own branch. Merging it is the PR-care merge's commit (agent/merge.ts, Workspace.mergeCommit): a commit whose parents are
 * the lead branch's head and the part branch's head, whose tree is the lead's with the part's files laid over it. Nothing is rebased and nothing is forced; the
 * lead branch only moves forward, and the commit is made by the server through the policy (the Blip author, the secret scan, the questions it asks).
 *
 * Because the parts own disjoint files, there is normally nothing to resolve, and the merge is made without a computer: for each file the part changed, the
 * lead's text is compared with the text the part was cut from. If the lead has not touched it since, the part's text goes in. If it has (a person pushed to the
 * lead branch, or a file a part was refused turned out to matter), that file is a CONFLICT, and the whole part goes through the runner merge flow instead
 * (agent/merge.ts mergePhase): a computer merges the part's branch into the lead's with git, the model judges and resolves what clashes, the project's checks
 * run on the result, and the server commits that as the merge commit.
 *
 * Merging is idempotent: a part whose files are already in the lead branch as the part has them is merged already, whether or not the lead wrote it down.
 */
import { ConnectorError } from "../../connectors/state.js";
import type { CommitFile } from "../github.js";
import { PolicyError } from "../policy.js";
import { repoRef } from "../projects.js";
import type { Run } from "../agent/run.js";
import { owns } from "./globs.js";
import type { TeamPart } from "./types.js";

export type MergeOutcome =
  | { kind: "merged"; sha: string; files: number }
  | { kind: "nothing" }
  | { kind: "conflict"; paths: string[] }
  | { kind: "refused"; why: string }
  | { kind: "retry"; why: string };

export async function textAt(r: Run, ref: string, path: string): Promise<{ ok: true; text: string | null } | { ok: false }> {
  const repo = repoRef(r.deps.projects, r.userId, r.project);
  try {
    return { ok: true, text: (await r.deps.projects.github.readFile(repo, ref, path)).text };
  } catch (err) {
    if (err instanceof ConnectorError && err.code === "not_found") return { ok: true, text: null };
    // A file that is binary or too big to read cannot be compared here: the runner's git can.
    if (err instanceof ConnectorError && ["binary_file", "too_large", "not_a_file"].includes(err.code)) return { ok: false };
    throw err;
  }
}

/** What a part changed, as the commit that merges it will carry: the files to lay over the lead branch, and the files the lead changed since the part was cut. */
export async function planMerge(r: Run, p: TeamPart, leadHead: string, partHead: string): Promise<{ files: CommitFile[]; conflicts: string[]; outside: string[] }> {
  const files: CommitFile[] = [];
  const conflicts: string[] = [];
  const outside: string[] = [];
  for (const path of [...new Set(p.paths)].sort()) {
    // The guard keeps a helper in its files; a path outside them is not merged however it got there.
    if (!owns(p.ownedPaths, path)) { outside.push(path); continue; }
    const [base, theirs, ours] = await Promise.all([textAt(r, p.baseSha ?? leadHead, path), textAt(r, partHead, path), textAt(r, leadHead, path)]);
    if (!base.ok || !theirs.ok || !ours.ok) { conflicts.push(path); continue; }
    if (ours.text === theirs.text) continue;
    if (ours.text !== base.text) { conflicts.push(path); continue; }
    files.push(theirs.text === null ? { path, content: null, delete: true } : { path, content: theirs.text });
  }
  return { files, conflicts, outside };
}

/**
 * Merges one approved part into the lead branch. Parks (through `Run.gated`) when the policy asks the person; the same call, run again after their yes, makes the commit.
 * A conflict is returned, not resolved: the caller starts the runner merge flow.
 */
export async function mergePart(r: Run, p: TeamPart): Promise<MergeOutcome> {
  const d = r.deps.projects;
  const repo = repoRef(d, r.userId, r.project);
  if (!p.branch) return { kind: "refused", why: "It has no branch." };
  const leadHead = await d.github.branchHead(repo, r.branch);
  const partHead = await d.github.branchHead(repo, p.branch);
  const { files, conflicts, outside } = await planMerge(r, p, leadHead, partHead);
  if (outside.length) return { kind: "refused", why: `Its commits changed files it does not own (${outside.slice(0, 3).join(", ")}), so it was not merged.` };
  if (conflicts.length) return { kind: "conflict", paths: conflicts };
  if (!files.length) return { kind: "nothing" };
  const message = `Merge part ${p.id} (${p.title}) into ${r.branch}\n\n${files.length} file${files.length === 1 ? "" : "s"} from ${p.branch}, built by a helper of Tailzu's team for job ${r.jobId.slice(0, 8)} and reviewed before this merge.`;
  try {
    const made = await r.gated("commit", `merge part ${p.id} (${p.title})`, (id) => r.ws.mergeCommit(files, message, partHead, id ? { approvalId: id } : {}));
    return { kind: "merged", sha: made.sha, files: files.length };
  } catch (err) {
    if (err instanceof PolicyError) return { kind: "refused", why: err.message };
    if (err instanceof ConnectorError && err.code === "branch_moved") return { kind: "retry", why: "The lead branch moved while the part was being merged." };
    throw err;
  }
}
