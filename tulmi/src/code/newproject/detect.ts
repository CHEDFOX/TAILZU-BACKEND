/**
 * IS THIS REPO EMPTY? THE QUESTION THAT DECIDES WHETHER THERE IS A PROJECT TO CHANGE OR ONE TO START.
 *
 * "Build me a booking app" in a repo with a README and a LICENSE is a new project,
 * not a change, and the classifier already says so when it is told the repo is empty
 * (brain/classify.ts `plan_project`). This is what tells it. A repo is empty when:
 *
 *   - it has no commits, or no files the brain counted (structure.fileCount is 0), or
 *   - everything in it is the boilerplate GitHub puts in a new repo and nothing is code:
 *     a README, a LICENSE, a .gitignore and the like (.gitattributes, .editorconfig,
 *     CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, .github templates and funding files...).
 *
 * "Nothing is code" is read off the brain: no row that is not boilerplate, no
 * language, framework, package manager or lockfile found, no entry point, no
 * binary or vendored file skipped, and only a handful of files the brain did not
 * read (a LICENSE and a .gitignore are not text it reads, so they are the files
 * that make up the difference between the tree and its rows). A brain that has not
 * been built says nothing: it is not called empty.
 */
import type { BrainHandle } from "../project/index.js";
import { baseName } from "../project/lang.js";

export type EmptyReason = "no_commits" | "no_files" | "only_boilerplate" | "has_files" | "not_built";

export interface EmptyVerdict {
  empty: boolean;
  reason: EmptyReason;
  /** The boilerplate that was found, when that is all there is. */
  found: string[];
}

/** Files that are in a repo because a host or a habit put them there, not because someone built something. */
const BOILERPLATE = [
  /^readme(?:\.[a-z]+)?$/i, /^licen[sc]e(?:[.-][\w.-]+)?$/i, /^copying(?:\.[a-z]+)?$/i, /^notice(?:\.[a-z]+)?$/i, /^unlicense$/i,
  /^\.gitignore$/, /^\.gitattributes$/, /^\.gitkeep$/, /^\.keep$/, /^\.nojekyll$/, /^\.editorconfig$/,
  /^contributing(?:\.[a-z]+)?$/i, /^code_of_conduct(?:\.[a-z]+)?$/i, /^security(?:\.[a-z]+)?$/i, /^changelog(?:\.[a-z]+)?$/i, /^authors(?:\.[a-z]+)?$/i, /^codeowners$/i, /^funding\.ya?ml$/i,
];

export function isBoilerplate(path: string): boolean {
  if (/^\.github\//i.test(path)) return true;
  return BOILERPLATE.some((re) => re.test(baseName(path)));
}

/** Files in the tree that the brain does not hold a row for and still call an empty repo: the LICENSE, the .gitignore... */
const UNREAD_MAX = 8;

export async function emptyRepoVerdict(brain: Pick<BrainHandle, "status" | "paths">): Promise<EmptyVerdict> {
  const view = await brain.status();
  if (view.status === "none" || !view.structure) return { empty: false, reason: "not_built", found: [] };
  const s = view.structure;
  if (!view.headSha && s.fileCount === 0) return { empty: true, reason: "no_commits", found: [] };
  if (s.fileCount === 0) return { empty: true, reason: "no_files", found: [] };

  const paths = await brain.paths(300);
  const code = paths.filter((p) => !isBoilerplate(p));
  const unread = s.fileCount - paths.length;
  const noCode = s.languages.length === 0 && s.frameworks.length === 0 && s.packageManagers.length === 0 && s.lockfiles.length === 0 && s.entryPoints.length === 0 && s.commands.length === 0;
  const nothingElse = s.skipped.binary === 0 && s.skipped.vendored === 0 && s.skipped.generated === 0 && s.skipped.tooBig === 0 && s.secretFiles.length === 0;
  if (code.length === 0 && noCode && nothingElse && unread <= UNREAD_MAX) return { empty: true, reason: "only_boilerplate", found: paths.slice(0, 20) };
  return { empty: false, reason: "has_files", found: [] };
}

/** Whether a repo has nothing in it to build on. */
export async function isEmptyRepo(brain: Pick<BrainHandle, "status" | "paths">): Promise<boolean> {
  return (await emptyRepoVerdict(brain)).empty;
}
