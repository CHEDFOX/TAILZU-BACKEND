/**
 * THE MERGE PHASE: THE DEFAULT BRANCH IS MERGED INTO A CONFLICTING BRANCH ON A RUNNER, THE MODEL RESOLVES WHAT CLASHES, THE SERVER COMMITS THE MERGE.
 *
 * Only a PR-care job for a pull request that GitHub says has conflicts (`mergeable_state: dirty`) comes here (code/prcare, docs/pr-care.md). What happens:
 *
 *   run       one runner step, with `capture`: the branch is checked out, the default branch's head is fetched BY COMMIT, and `git merge --no-commit --no-ff` is
 *             run on it. What the merge left in the working tree (the merged files, the conflicting ones with their markers) comes back as the step's changes and
 *             is STAGED, so the model reads and edits it with the tools it has. The conflicting files are named in the output (TAILZU_CONFLICT lines)
 *   judge     the cheap tier is shown each conflicting file and says whether the two sides can both be kept (imports, formatting, neighbouring edits: mechanical) or
 *             both changed the same logic so that picking one loses behaviour (semantic). A semantic one is a QUESTION to the person with three answers; nothing
 *             is resolved blind
 *   resolve   the work phase: the model removes the markers (it keeps both sides' behaviour, or the person's choice). Verify refuses a file that still has them,
 *             then runs the project's checks; then commit
 *
 * The commit is a MERGE COMMIT with two parents (the branch's head, and the default branch's head that was merged in), made by the server through the Git Data
 * API and the policy (agent/phases.ts commitStaged → Workspace.mergeCommit). Tailzu never rebases and never force-pushes: the head is the first parent, so the
 * branch only moves forward. A conflict in `.github/workflows` is not resolved at all: Tailzu never edits CI.
 */
import { z } from "zod";
import { isWorkflowPath } from "../policy.js";
import { repoRef } from "../projects.js";
import { askJson, cut, fence, forModel } from "../work/model.js";
import { Refused } from "./changeset.js";
import { BudgetStop, EndJob, LostClaim, Park, type Run } from "./run.js";
import type { MergeState } from "./types.js";

/** A file with both ends of a conflict marker in it. */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}(?: |$)/m.test(text) && /^>{7}(?: |$)/m.test(text);
}

/** The commands of the merge step: the head of the default branch is fetched by its commit, so the commit the merge brings in is exactly the one the server will name as the second parent. */
export function mergeCommands(baseSha: string): string[] {
  return [
    // A shallow checkout cannot find a merge base; a complete one says so (and that is fine).
    "git fetch --no-tags --unshallow origin 2>/dev/null || true",
    `git fetch --no-tags origin ${baseSha}`,
    `git -c user.name=Tailzu -c user.email=noreply@tailzu.space merge --no-commit --no-ff ${baseSha} 2>&1 || true`,
    "git diff --name-only --diff-filter=U | sed 's/^/TAILZU_CONFLICT /'",
    // The working tree is what is read back: conflicting files with their markers included.
    "git add -A",
  ];
}

/** The paths the merge step named as conflicting. */
export function conflictedIn(output: string): string[] {
  return [...new Set([...output.matchAll(/^TAILZU_CONFLICT (.+)$/gm)].map((m) => m[1]!.trim()).filter(Boolean))];
}

export const ConflictVerdict = z.object({
  files: z.array(z.object({ path: z.string().min(1).max(500), kind: z.enum(["mechanical", "semantic"]), reason: z.string().max(300) })).max(12),
});

const FILE_CHARS = 3000;
const JUDGED_MAX = 6;

const ANSWER_MYSELF = /\b(?:myself|my\s+own|i'?ll\s+(?:do|resolve|fix)|khud)\b/i;

export async function mergePhase(r: Run): Promise<void> {
  const s = r.state;
  const m: MergeState = (s.merge ??= { stage: "run", base: s.care?.base ?? r.project.defaultBranch, baseSha: "", headSha: "", conflicted: [] });
  if (m.stage === "run") await runMerge(r, m);
  if (m.stage === "uptodate") {
    await r.log.decision(`The branch already has everything in ${m.base}, so there is nothing to merge.`);
    s.phase = "report";
    await r.save();
    return;
  }
  if (m.stage === "judge") await judge(r, m);
  // Resolve: the model's turn. What it is told is the task, once, with the files and the person's choice.
  s.task = [
    s.task,
    `The merge of ${m.base} into this branch is staged. ${m.conflicted.length ? `These files clash, and hold conflict markers (<<<<<<<, =======, >>>>>>>) you must remove: ${m.conflicted.join(", ")}. ` : "Nothing clashes. "}`
    + "Keep the behaviour of both sides; do not drop a change to make the clash go away, and do not weaken or delete a test. "
    + `${m.choice ? `The person decided: ${cut(forModel(m.choice), 300)} ` : ""}If keeping both loses behaviour and you cannot tell which to keep, ask the person. Call done when no marker is left.`,
  ].join("\n\n");
  s.phase = "work";
  await r.save();
}

async function runMerge(r: Run, m: MergeState): Promise<void> {
  const d = r.deps.projects;
  const repo = repoRef(d, r.userId, r.project);
  m.headSha = await d.github.branchHead(repo, r.branch);
  m.baseSha = await d.github.branchHead(repo, m.base);
  await r.log.note(`Merging ${m.base} (${m.baseSha.slice(0, 7)}) into the branch on a computer.`);
  const out = await r.runStep("merge", { commands: mergeCommands(m.baseSha), timeoutSec: 600, estimateMinutes: 4, capture: true, why: "Merge the default branch into the branch" });
  if (out.status === "cancelled") throw new LostClaim();
  if (out.status !== "done") throw new EndJob("failed", `No computer was free to merge ${m.base} into the branch (${cut(out.reason, 120)}). Nothing was changed.`);
  if (out.exitCode !== 0) throw new EndJob("failed", `The merge could not be set up (exit ${out.exitCode}). The end of what it printed: ${cut(out.outputTail.trim().split("\n").slice(-4).join(" | "), 300)}. Nothing was changed.`);
  const conflicted = conflictedIn(out.outputTail);
  const changes = out.changes ?? [];
  if (!changes.length && !conflicted.length) { m.stage = "uptodate"; await r.save(); return; }
  if (conflicted.some(isWorkflowPath)) {
    throw new EndJob("failed", `The conflict is in CI configuration (${conflicted.filter(isWorkflowPath)[0]}), which Tailzu never edits. Resolve it on GitHub, or merge ${m.base} into the branch yourself. Nothing was changed.`);
  }
  try {
    // The merge's result is the staged set: what the model reads and edits, and what the merge commit holds. A file the default branch changed is staged as it is merged
    // (its path is the base's own, not a model's edit, so it is not run through the editing rules: a workflow file that came in from the base is the policy's to ask about).
    for (const c of changes) r.tools.changes.stage(c.path, c.content, { existed: true, original: null });
  } catch (err) {
    if (err instanceof Refused) throw new EndJob("failed", `${m.base} has too many changes to merge in here (${err.message}) Update the branch on GitHub instead. Nothing was changed.`);
    throw err;
  }
  m.conflicted = conflicted;
  m.stage = "judge";
  await r.log.decision(conflicted.length ? `Merged ${m.base} in: ${conflicted.length} file${conflicted.length === 1 ? "" : "s"} clash (${conflicted.slice(0, 4).join(", ")}).` : `Merged ${m.base} in with no clash (${changes.length} file${changes.length === 1 ? "" : "s"} changed).`);
  await r.save();
  // What the step kept is taken: it is the person's code, and is not left in the step.
  await r.deps.jobs.clearCaptured?.(r.jobId, out.stepIdx).catch(() => undefined);
}

/** Mechanical or semantic: the question asked once, the answer taken when it comes. */
async function judge(r: Run, m: MergeState): Promise<void> {
  const s = r.state;
  const w = s.waiting;
  if (w?.kind === "question" && w.from === "merge" && w.answer !== undefined) {
    await r.log.question(w.question, w.answer);
    s.waiting = undefined;
    if (ANSWER_MYSELF.test(w.answer)) throw new EndJob("failed", "You said you would resolve it yourself, so Tailzu left the branch as it is. Nothing was changed.");
    m.choice = w.answer.slice(0, 400);
    m.stage = "resolve";
    return;
  }
  if (!m.conflicted.length) { m.stage = "resolve"; return; }
  const shown = m.conflicted.slice(0, JUDGED_MAX).map((p) => `<file path="${p.replace(/["<>\n]/g, " ")}">\n${fence(forModel(cut(r.tools.changes.get(p)?.content ?? "", FILE_CHARS)))}\n</file>`);
  const res = await askJson(r.model(), {
    tier: "cheap", purpose: "care.conflict", role: "care_conflict", schema: ConflictVerdict, maxTokens: 600,
    user: `Merging ${m.base} into a branch left these files in conflict. Each shows both sides between the conflict markers.\n\n${shown.join("\n\n")}`,
  });
  if (!res.ok && res.reason === "budget") throw new BudgetStop(res.needPaise ?? 0);
  if (!res.ok && res.reason === "aborted") throw new LostClaim();
  // A model that cannot be reached cannot say the sides can both be kept: the person is asked, never a guess.
  const semantic = res.ok ? res.value.files.filter((f) => f.kind === "semantic" && m.conflicted.includes(f.path)) : m.conflicted.slice(0, JUDGED_MAX).map((path) => ({ path, kind: "semantic" as const, reason: "I could not tell whether both sides can be kept." }));
  if (!semantic.length) { m.stage = "resolve"; await r.save(); return; }
  s.waiting = {
    kind: "question", from: "merge", at: r.now(), options: ["Keep this branch's behaviour", `Take ${m.base}'s behaviour`, "I will resolve it myself"],
    question: `Both sides changed the same logic in ${semantic.slice(0, 3).map((f) => f.path).join(", ")}, and keeping either one loses behaviour: ${cut(semantic[0]!.reason, 160)} Which should win?`,
  };
  await r.save();
  throw new Park("answer", cut(`Both sides changed the same logic in ${semantic[0]!.path}. Which should win?`, 160));
}
