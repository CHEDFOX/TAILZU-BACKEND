/**
 * WHAT A PART CHANGED, AS THE TEXT OF EACH FILE BEFORE AND AFTER: THE REVIEWER'S INPUT.
 *
 * The files are the ones the part's commits touched (recorded from its helper's jobs), read at the commit the branch was cut from and at the branch's head. A file
 * that cannot be read as text (binary, over a megabyte) is left out of the diff; the reviewer is told how many files it is shown.
 */
import type { Run } from "../agent/run.js";
import { textAt } from "./integrate.js";
import type { FileChange } from "./diff.js";
import type { TeamPart } from "./types.js";

/** The most files of one part that are read for a review. */
export const REVIEW_FILES_MAX = 60;

export async function fileDiffOf(r: Run, p: TeamPart): Promise<FileChange[]> {
  const out: FileChange[] = [];
  const from = p.baseSha;
  const to = p.headSha ?? p.branch;
  if (!from || !to) return out;
  for (const path of [...new Set(p.paths)].sort().slice(0, REVIEW_FILES_MAX)) {
    const [before, after] = await Promise.all([textAt(r, from, path), textAt(r, to, path)]);
    if (!before.ok || !after.ok) continue;
    out.push({ path, before: before.text, after: after.text });
  }
  return out;
}
