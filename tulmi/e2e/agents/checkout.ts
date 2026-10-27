/**
 * A PREPARED CHECKOUT, AND READING WHAT AN AGENT DID TO IT.
 *
 * `prepareCheckout(task)` is validate.ts's materialize: the project at the task's base, planted files laid and committed, the project's dependencies
 * hard-linked in. `collectChanges` reads what is different from that commit afterwards, with git, so it works for any agent that edits files and
 * does not care whether it committed.
 */
import fs from "node:fs";
import path from "node:path";
import type { Task } from "../tasks/schema.js";
import { materialize, type Materialized } from "../validate.js";
import { git } from "../util.js";
import type { FileChange } from "./types.js";

export const prepareCheckout = (task: Task): Promise<Materialized> => materialize(task);

const FILE_MAX = 1024 * 1024;
const FILES_MAX = 400;

/** The text files that differ from `baseSha`, and a unified diff of them. Binary, huge and ignored files are left out (and named in `skipped`). */
export async function collectChanges(dir: string, baseSha: string): Promise<{ changes: FileChange[]; diff: string; skipped: string[] }> {
  await git(dir, ["add", "-A", "-N"]);
  const raw = await git(dir, ["-c", "core.fileMode=false", "diff", "--name-status", "--no-renames", "-z", baseSha]);
  const parts = raw.split("\0");
  const changes: FileChange[] = [];
  const skipped: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]!.charAt(0);
    const p = parts[i + 1]!;
    if (!p) continue;
    if (changes.length >= FILES_MAX) { skipped.push(`${p} (too many files)`); continue; }
    if (status === "D") { changes.push({ path: p, content: null }); continue; }
    const f = path.join(dir, p);
    try {
      const st = fs.lstatSync(f);
      if (!st.isFile()) { skipped.push(`${p} (not a plain file)`); continue; }
      if (st.size > FILE_MAX) { skipped.push(`${p} (over 1 MB)`); continue; }
      const buf = fs.readFileSync(f);
      if (buf.includes(0)) { skipped.push(`${p} (binary)`); continue; }
      changes.push({ path: p, content: buf.toString("utf8") });
    } catch { skipped.push(`${p} (unreadable)`); }
  }
  const diff = await git(dir, ["-c", "core.fileMode=false", "diff", "--no-renames", "--unified=3", baseSha]);
  return { changes, diff: diff.slice(0, 400_000), skipped };
}

/** A file-change list as the { path: text | null } map the hidden-test laying uses. */
export const asFiles = (changes: readonly FileChange[]): Record<string, string | null> => Object.fromEntries(changes.map((c) => [c.path, c.content]));
