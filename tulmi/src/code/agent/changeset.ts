/**
 * THE STAGED CHANGESET: THE EDITS THE AGENT HAS MADE AND NOT COMMITTED YET.
 *
 * The agent never writes to the repo while it works. Each edit_file, write_file and
 * delete_file lands in a changeset that lives in the job's checkpoint (state.work.staged),
 * and the SERVER commits all of it at once, after the checks, through the workspace
 * (loop.ts commit) so the policy, the secret scan, the Blip author and the co-author
 * trailer all apply. Three things follow from that:
 *
 *   - what the model reads is the work branch overlaid with the changeset (a file it
 *     edited reads as edited), and what a runner runs is the same overlay (jobs/router.ts
 *     requestExec `overlay`), so the checks see the code as it would be;
 *   - a server that dies mid-work loses nothing: the changeset is in the checkpoint, and
 *     the next one carries on without editing again;
 *   - a refusal is made HERE, up front, in words the model can act on, before anything
 *     is staged: a path under .github/workflows, a path outside the repo or inside .git,
 *     Tailzu's own runner files, an env file or a key, something that looks like a
 *     secret, a file over 1 MB. The policy would refuse or ask at commit time as well
 *     (policy.ts); this way the model hears it while it can still do something about it,
 *     and no secret is ever written into the checkpoint.
 *
 * A Refused is for the model: its message says what to do instead. Nothing here reaches
 * GitHub, a model or a store.
 */
import { COMMIT_FILES_MAX, FILE_MAX_BYTES, assertRepoPath, type CommitFile } from "../github.js";
import { isWorkflowPath, scanForSecrets } from "../policy.js";
import { isSecretPath } from "../project/lang.js";
import { isReservedPath } from "../shadow.js";
import type { OverlayFile } from "../jobs/types.js";
import { OVERLAY_MAX_BYTES, OVERLAY_MAX_FILES } from "../jobs/types.js";
import { STAGED_CHARS_MAX, STAGED_FILES_MAX, type StagedFile } from "./types.js";

/** A tool call that cannot be done, in words for the model. */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refused";
  }
}

/** A path as the model gave it, checked and cleaned: inside the repo, and one the agent may write. Throws Refused. */
export function editablePath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Refused("path is needed: a file path inside the repo, like src/index.ts.");
  const path = raw.trim().replace(/^\.\//, "");
  try {
    assertRepoPath(path);
  } catch {
    throw new Refused(`${JSON.stringify(path.slice(0, 80))} is not a path inside the repo. Use a path relative to the repo's root, with no .. and nothing in .git.`);
  }
  if (isWorkflowPath(path)) {
    throw new Refused(`${path} is CI configuration (.github/workflows). Tailzu never changes it. Leave it as it is, and say in your final answer if the change needs a workflow edit.`);
  }
  if (isReservedPath(path)) throw new Refused(`${path} belongs to Tailzu's own runner, so nothing else can write it.`);
  if (isSecretPath(path)) throw new Refused(`${path} is the kind of file that holds secrets (an env file, a key, a credentials file), and those never go in git. Put the name of the setting in .env.example instead.`);
  return path;
}

/** What kinds of secret a text looks like it holds; empty when it looks clean. */
export function secretKinds(path: string, text: string): string[] {
  return scanForSecrets([{ path, content: text }]).flatMap((h) => h.kinds);
}

/**
 * A new text for a file, checked: no bigger than a commit may carry, and not newly
 * holding something that looks like a secret. A file that already held one (the project's
 * own business) may still be edited, so long as the edit adds no new KIND of secret.
 */
export function checkedText(path: string, text: string, before: string | null): string {
  if (Buffer.byteLength(text, "utf8") > FILE_MAX_BYTES) throw new Refused(`${path} would be over 1 MB, which is more than a commit can carry. Split it up.`);
  if (text.includes("\u0000")) throw new Refused(`${path} would hold a NUL character, so it is not text.`);
  const now = secretKinds(path, text);
  if (now.length) {
    const was = new Set(before === null ? [] : secretKinds(path, before));
    const added = now.filter((k) => !was.has(k));
    if (added.length) {
      throw new Refused(`That would put something in ${path} that looks like ${[...new Set(added)].join(" and ")}. Secrets never go in git: read the value from an environment variable, and name the setting in .env.example.`);
    }
  }
  return text;
}

export class Changeset {
  /** Works on the state's own array, so what is staged is in the checkpoint the moment it is staged. */
  constructor(private readonly staged: StagedFile[]) {}

  get files(): readonly StagedFile[] { return this.staged; }
  get size(): number { return this.staged.length; }
  get empty(): boolean { return this.staged.length === 0; }
  paths(): string[] { return this.staged.map((f) => f.path); }
  get(path: string): StagedFile | undefined { return this.staged.find((f) => f.path === path); }
  chars(): number { return this.staged.reduce((n, f) => n + (f.content?.length ?? 0), 0); }

  /**
   * Stages a file's new text (or null: deleted). `existed` is whether the path is in the
   * work branch; it decides edit, create or delete, and a file created and deleted in the
   * same job is simply gone from the changeset. An edit that puts a file back as it is on
   * the branch (`original`) is removed from the changeset too: there is nothing to commit.
   */
  stage(path: string, content: string | null, o: { existed: boolean; original: string | null }): StagedFile | null {
    const at = this.staged.findIndex((f) => f.path === path);
    if (content === null && !o.existed) {
      if (at >= 0) this.staged.splice(at, 1);
      return null;
    }
    if (content !== null && o.existed && o.original === content) {
      if (at >= 0) this.staged.splice(at, 1);
      return null;
    }
    const entry: StagedFile = { path, content, action: content === null ? "delete" : o.existed ? "edit" : "create" };
    const prev = at >= 0 ? this.staged[at] : undefined;
    if (at >= 0) this.staged[at] = entry;
    else {
      if (this.staged.length >= Math.min(STAGED_FILES_MAX, COMMIT_FILES_MAX)) {
        throw new Refused(`${this.staged.length} files are staged already, which is as many as one change carries. Finish up with what is staged, or split the work.`);
      }
      this.staged.push(entry);
    }
    if (this.chars() > STAGED_CHARS_MAX) {
      if (prev) this.staged[at] = prev;
      else this.staged.pop();
      throw new Refused("That would stage more text than one change carries. Finish up with what is staged, or split the work.");
    }
    return entry;
  }

  /** For the commit: every staged file, as the workspace commits it. */
  toCommitFiles(): CommitFile[] {
    return this.staged.map((f) => (f.content === null ? { path: f.path, content: null, delete: true } : { path: f.path, content: f.content }));
  }

  /** For a run: the files a runner lays over its checkout. Throws Refused when there is more than a step can carry. */
  toOverlay(): OverlayFile[] {
    if (this.staged.length > OVERLAY_MAX_FILES) throw new Refused(`${this.staged.length} files are staged, more than a run can carry (${OVERLAY_MAX_FILES}).`);
    const bytes = this.staged.reduce((n, f) => n + (f.content === null ? 0 : Buffer.byteLength(f.content, "utf8")), 0);
    if (bytes > OVERLAY_MAX_BYTES) throw new Refused(`The staged edits are ${Math.ceil(bytes / 1024)} KB, more than a run can carry (${OVERLAY_MAX_BYTES / 1024} KB). Make smaller changes, or finish up without running them.`);
    return this.staged.map((f) => ({ path: f.path, content: f.content }));
  }

  /** What changed, in one line each, for the log and the report. */
  lines(): string[] {
    const verb = { edit: "changed", create: "added", delete: "deleted" } as const;
    return this.staged.map((f) => `${f.path} (${verb[f.action]})`);
  }

  clear(): void { this.staged.length = 0; }
}

/** Replaces `old` with `next` in `text` when `old` occurs exactly once. Otherwise a Refused that says what was found. */
export function replaceOnce(path: string, text: string, old: unknown, next: unknown): string {
  if (typeof old !== "string" || old === "") throw new Refused("old is needed: the exact text to replace, copied from the file, with enough around it to be the only one.");
  if (typeof next !== "string") throw new Refused("new is needed: the text to put in its place (it may be empty to remove the old text).");
  if (old === next) throw new Refused("old and new are the same, so nothing would change.");
  const first = text.indexOf(old);
  if (first < 0) {
    const line = old.split("\n").find((l) => l.trim().length > 6)?.trim();
    const near = line && text.includes(line) ? ` A line of it, ${JSON.stringify(line.slice(0, 60))}, is there, so the difference is in the spacing or the lines around it: read the file again and copy the text exactly.` : " Read the file again and copy the text exactly, spaces and all.";
    throw new Refused(`That text is not in ${path}.${near}`);
  }
  const second = text.indexOf(old, first + old.length);
  if (second >= 0) {
    let n = 0;
    for (let at = text.indexOf(old); at >= 0; at = text.indexOf(old, at + old.length)) n += 1;
    throw new Refused(`That text is in ${path} ${n} times. Include more of the lines around it so it is the only one.`);
  }
  return text.slice(0, first) + next + text.slice(first + old.length);
}
