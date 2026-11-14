/**
 * THE FILES A JOB CHANGED THAT ITS TASK NEVER POINTED AT.
 *
 * A change should touch what it must and leave the rest alone. An agent reading a lot of code is tempted by what it passes: a tidy-up here, a
 * rename there, a lint fix in a file it only opened to understand. Each one is defensible on its own and together they turn a two-file change
 * into a twelve-file one that nobody can review.
 *
 * So the staged files are set against what the task pointed at, from what the project already knows, with NO MODEL:
 *
 *   the plan's files, the located targets   where the job was told, or decided, the change belongs
 *   the locate funnel's top files           what the request's own words, names and the index point at (work/locate.ts fusedFor, the free half)
 *   a path written in the task itself       the person named it
 *   their importers and imported files      a call site that must change with a signature is the change, not a detour (the brain's neighbors)
 *   the tests covering them                 a test of what changed belongs to it
 *   a manifest or lockfile                  a dependency the work needed shows up here
 *   a NEW file in the same folder          a new module beside the one it belongs with is how a project grows; EDITING an unrelated
 *                                           neighbour is the drive-by this is looking for, so the folder alone excuses nothing
 *
 * What is left is NOT called wrong. The funnel is a guess and this is a guess about a guess, so it is INFORMATIONAL, both times it is used:
 *
 *   - once, mid-work, as a line in the next turn's prompt: these are not files the task pointed at, so if one is not needed for this change, put
 *     it back. It costs nothing (no model, no runner) and it is said ONCE a job, so it cannot nag a model into reverting work it needs;
 *   - in the report and the pull request, as what to look at first.
 *
 * It never refuses an edit and never fails a job. The team's owned-path guard (team/guard.ts) is the one that refuses, and it refuses because a
 * helper's part really does own its files; here nobody knows better than the model what this change needs.
 */
import { dirName, isLockfile, isTestPath } from "../project/lang.js";
import { isConfigPath } from "../work/impact.js";
import type { BrainHandle } from "../project/index.js";
import { fusedFor } from "../work/locate.js";
import type { AgentState } from "./types.js";

/** What the funnel's ranking counts as pointing at the task: the top few, as `hintsOf` shows them. */
export const SCOPE_HINTS_MAX = 8;
/** The most files named in one note or report line. */
export const SCOPE_SHOWN = 8;

type ScopeBrain = Pick<BrainHandle, "neighbors" | "testsFor">;

/** Every path the task points at, before the neighbours are added. */
function pointedAt(s: Pick<AgentState, "task" | "plan" | "located">, hinted: readonly string[]): Set<string> {
  const out = new Set<string>(hinted);
  for (const step of s.plan?.steps ?? []) for (const f of step.files) out.add(f.path);
  for (const t of s.located?.targets ?? []) out.add(t.path);
  // A path the person wrote in the task, in any of the shapes they write it.
  for (const m of String(s.task ?? "").matchAll(/[\w./-]*[\w-]+\.[a-zA-Z][\w]{0,8}\b/g)) {
    const p = m[0].replace(/^\.\//, "");
    if (p.includes(".") && !p.endsWith(".")) out.add(p);
  }
  return out;
}

/**
 * The staged paths the task never pointed at. `brain` is read for the neighbours and tests of what it did point at; a brain that cannot answer
 * only makes the set smaller, which means a file is named that need not have been, so every read is guarded.
 */
export async function outsideScope(
  s: Pick<AgentState, "task" | "plan" | "located">,
  staged: readonly { path: string; action: "edit" | "create" | "delete" }[],
  brain: ScopeBrain,
  hinted: readonly string[],
): Promise<string[]> {
  const core = pointedAt(s, hinted);
  if (!core.size) return [];
  const related = new Set(core);
  const folders = new Set([...core].map(dirName));
  await Promise.all([...core].map(async (p) => {
    const n = await brain.neighbors(p).catch(() => null);
    for (const x of [...(n?.imports ?? []), ...(n?.importedBy ?? [])]) related.add(x);
    for (const t of await brain.testsFor(p).catch(() => [])) related.add(t);
  }));
  return staged.filter(({ path: p, action }) => {
    if (related.has(p)) return false;
    // A manifest or lockfile follows from the work, and a test beside a related file belongs to it.
    if (isConfigPath(p) || isLockfile(p)) return false;
    if (isTestPath(p) && [...related].some((x) => dirName(x) === dirName(p))) return false;
    // A NEW file beside a related one is how a project grows. An edit to one that happens to share the folder is not excused by that:
    // in a project whose source sits in one directory, the folder would excuse everything.
    if (action === "create" && folders.has(dirName(p))) return false;
    return true;
  }).map((f) => f.path);
}

/** The paths the funnel points at for this task: the free half of locate, as `hintsOf` uses it. No model. */
export async function hintedPaths(task: string, brain: Parameters<typeof fusedFor>[1]): Promise<string[]> {
  let fused;
  try { fused = await fusedFor(task, brain); } catch { return []; }
  const top = fused[0]?.score ?? 0;
  return fused.filter((f, i) => i < SCOPE_HINTS_MAX && f.score >= 0.3 * top).map((f) => f.path);
}

const list = (paths: readonly string[]): string => {
  const shown = paths.slice(0, SCOPE_SHOWN).join(", ");
  return paths.length > SCOPE_SHOWN ? `${shown} and ${paths.length - SCOPE_SHOWN} more` : shown;
};

/** The line the model is shown, once: said as the guess it is. */
export function scopeNote(paths: readonly string[]): string | null {
  if (!paths.length) return null;
  return `You have staged ${paths.length === 1 ? "a file" : "files"} the task did not point at and the project's index does not connect to it: ${list(paths)}. `
    + `That is often right: a call site, a type, a config, a test. But if ${paths.length === 1 ? "it is" : "any of them is"} a tidy-up or a fix that is not part of this task, `
    + "put it back as it was and keep this change to what was asked; flag_finding is where something noticed elsewhere belongs. Say with note what you decided.";
}

/** The line the report and the pull request carry. */
export function scopeLine(paths: readonly string[]): string | null {
  return paths.length ? `Also changed, beyond what the task pointed at: ${list(paths)}. Worth a look first.` : null;
}
