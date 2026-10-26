/**
 * THE NAMES THAT BELONG TO TAILZU'S OWN RUNNER: THE SHADOW BRANCH AND ITS THREE FILES.
 *
 * When an exec step runs on GitHub's free computers (code/jobs/githubActions.ts),
 * Tailzu makes ONE throwaway branch in the person's repo for that step,
 * `tailzu-run/<job>-<step>-<epoch>`, holding one commit on top of the work
 * branch's checkpoint with exactly three files the SERVER wrote:
 *
 *   .github/workflows/tailzu-run.yml   the workflow GitHub runs on that push
 *   .tailzu/step.json                  what to run, and where to report
 *   .tailzu/run.mjs                    the small script that runs it and reports
 *
 * and deletes the branch when the step is over. The work branch is never touched.
 *
 * This file is only the NAMES and the tests for them, and nothing else, so the
 * policy (policy.ts) can say what is the runner's alone without importing the
 * jobs. The rule it backs: those three paths and every `tailzu-run/` branch are
 * the SERVER's. An agent's commit, and the changes a runner hands back, can
 * never write `.tailzu/` or the workflow file, and can never create or move a
 * `tailzu-run/` branch (policy.ts runner.reserved is "never"). Only the
 * server's own provider may, through the narrow action runner.shadow.
 */

/** Every shadow branch starts with this. */
export const SHADOW_PREFIX = "tailzu-run/";
export const SHADOW_WORKFLOW = ".github/workflows/tailzu-run.yml";
export const SHADOW_STEP = ".tailzu/step.json";
export const SHADOW_SCRIPT = ".tailzu/run.mjs";
/** The only paths a shadow commit may hold, in the order they are written. */
export const SHADOW_FILES: readonly string[] = [SHADOW_WORKFLOW, SHADOW_STEP, SHADOW_SCRIPT];

/** Whether a branch name is in the runner's namespace (case does not matter: a checkout on a case-folding disk would see the same folder). */
export function isShadowBranch(branch: unknown): branch is string {
  return typeof branch === "string" && branch.toLowerCase().startsWith(SHADOW_PREFIX);
}

/** Whether a repo path is one of the runner's: anything under `.tailzu/`, or its workflow file. */
export function isReservedPath(path: unknown): boolean {
  return typeof path === "string" && (/^\.tailzu(\/|$)/i.test(path) || path.toLowerCase() === SHADOW_WORKFLOW);
}

/** A job id's first eight hex digits: enough to read a branch name by, and the epoch makes it unique. */
const short = (jobId: string): string => String(jobId).replace(/[^0-9a-f]/gi, "").toLowerCase().slice(0, 8).padEnd(8, "0");

/** `tailzu-run/<job>-<step>-<epoch>`: the branch for one step of one job under one lease. */
export function shadowBranchName(jobId: string, stepIdx: number, epoch: number): string {
  return `${SHADOW_PREFIX}${short(jobId)}-${stepIdx}-${epoch}`;
}

/**
 * The branch and commit a lease holder string names. The provider writes
 * `<branch>@<sha>` as the lease's holder, so the one record the job store
 * already keeps carries what the result has to be checked against.
 */
export function holderOf(branch: string, sha: string): string {
  return `${branch}@${sha}`;
}

export function parseHolder(holder: string | null | undefined): { branch: string; sha: string } | null {
  const m = /^(tailzu-run\/[0-9a-f]{8}-\d+-\d+)@([0-9a-f]{40})$/.exec(holder ?? "");
  return m ? { branch: m[1]!, sha: m[2]! } : null;
}

/** Whether `paths` is exactly the three files and nothing else (in any order). */
export function isExactShadowSet(paths: readonly string[] | undefined): boolean {
  return Array.isArray(paths) && paths.length === SHADOW_FILES.length && new Set(paths).size === paths.length && paths.every((p) => SHADOW_FILES.includes(p));
}
