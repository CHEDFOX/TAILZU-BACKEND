/**
 * WHAT A CHANGE TOOK AWAY: THE PUBLIC SURFACE OF THE FILES IT TOUCHED, BEFORE AND AFTER.
 *
 * The project's checks prove that what is tested still works. They say nothing about what no test covers, and most
 * projects cover a fraction: an exported function dropped in a rewrite, a route no longer registered, a component
 * renamed and its last caller missed. The tests stay green and the feature is gone. The person finds it, not the job.
 *
 * So, in verify, beside the comparison with the baseline: for every staged file the exported names and the HTTP routes
 * are read from the branch's text and from the staged text (`project/symbols.ts extractSymbols`: regexes over blanked
 * comments, no model and no parser, every pattern with a fixture), and anything that was there and is not any more is
 * a REMOVAL. One the task asked for is its business; one it did not is given back to the model as a fix round, with the
 * names, exactly as a check this change broke is. `testlock.ts` guards the project's tests the same way, by counting.
 *
 * Narrow on purpose, because a false alarm costs a round of the person's money:
 *   - only what is visible from outside the file (`exported`) and routes; a private helper is the file's own business;
 *   - a name that MOVED is not a removal: gone from one staged file and there in another (any staged file, or a file the
 *     job read) is a refactor, which is what a refactor looks like;
 *   - a file the job DELETED is read the same way, so moving a module's contents elsewhere is fine and dropping them is not;
 *   - a task that asks for something to go (remove, delete, drop, rename, deprecate, replace) turns the check off, as the
 *     test lock does: the person asked;
 *   - it never blocks the commit by itself. It is one fix round like any other, inside the rounds already capped at three,
 *     and what it could not read it says nothing about.
 */
import { languageOf, isCodeLanguage, isTestPath } from "../project/lang.js";
import { extractSymbols } from "../project/symbols.js";
import type { SymbolInfo } from "../project/types.js";
import type { StagedFile } from "./types.js";

/** One thing a file showed the rest of the project: an exported name, or a route it served. */
export interface SurfaceItem {
  /** `name:<name>` for a name, `route:VERB path` for a route: what makes it the same thing before and after. The KIND is left out on
   *  purpose, so turning an exported function into an exported const of the same name is the refactor it is, not a removal. */
  key: string;
  /** What to call it in the words the model reads. */
  label: string;
}

/** A removal: something the branch had and the staged text does not. */
export interface Lost extends SurfaceItem {
  path: string;
}

/** The most removals named in one round of feedback: enough to act on, not a wall of text. */
export const LOST_SHOWN = 12;

/**
 * The task asked for something to go, so a removal is the point of the job. Deliberately wide: the cost of turning the
 * check off when it was not wanted is a missed warning in the report, and the cost of leaving it on is a wasted round.
 */
export const REMOVAL_ASKED = /\b(?:remove|delete|drop|deprecate|rename|replace|retire|strip|prune|unregister|migrate\s+off|get\s+rid\s+of|take\s+out|clean\s*up|dead\s+code|unused)\b/i;

const labelOf = (s: SymbolInfo): string =>
  s.kind === "route" ? `the route ${[s.method, s.path].filter(Boolean).join(" ")}` : `${s.kind === "component" ? "component" : s.kind} ${s.name}`;

const keyOf = (s: SymbolInfo): string =>
  s.kind === "route" ? `route:${[s.method, s.path].filter(Boolean).join(" ")}` : `name:${s.name}`;

/** Whether this file's surface is worth reading: code, and not a test (the test lock has those). */
export function watchedPath(path: string): boolean {
  return isCodeLanguage(languageOf(path)) && !isTestPath(path);
}

/**
 * What `text` shows the rest of the project: its exported names and its routes. A name with no `exported` flag is only
 * counted when it is a route (routes carry none), so a language whose symbols say nothing about visibility contributes
 * its routes and nothing else, rather than every local function it happens to define.
 */
export function surfaceOf(path: string, text: string): SurfaceItem[] {
  const out = new Map<string, SurfaceItem>();
  for (const s of extractSymbols(path, languageOf(path), text)) {
    if (s.kind === "env" || s.kind === "entry") continue;
    if (s.kind !== "route" && s.exported !== true) continue;
    if (!s.name && s.kind !== "route") continue;
    const key = keyOf(s);
    if (!out.has(key)) out.set(key, { key, label: labelOf(s) });
  }
  return [...out.values()];
}

/**
 * What the staged edits took away. `before` is each staged path's text on the work branch (null: the path is new, so it
 * had no surface); `after` is the staged text (null: deleted). A key that turns up in any staged file's new surface has
 * moved, not gone.
 */
export function lostSurface(files: readonly { path: string; before: string | null; after: string | null }[]): Lost[] {
  const kept = new Set<string>();
  for (const f of files) {
    if (f.after === null || !watchedPath(f.path)) continue;
    for (const item of surfaceOf(f.path, f.after)) kept.add(item.key);
  }
  const lost: Lost[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (f.before === null || !watchedPath(f.path)) continue;
    for (const item of surfaceOf(f.path, f.before)) {
      if (kept.has(item.key) || seen.has(item.key)) continue;
      seen.add(item.key);
      lost.push({ ...item, path: f.path });
    }
  }
  return lost;
}

/** What the model is shown for a round of fixing, or null when nothing went missing. */
export function lostFeedback(lost: readonly Lost[]): string | null {
  if (!lost.length) return null;
  const shown = lost.slice(0, LOST_SHOWN);
  const lines = shown.map((l) => `- ${l.label}, which ${l.path} had`);
  const more = lost.length > shown.length ? `\n(and ${lost.length - shown.length} more)` : "";
  return `The checks passed, but your change takes away ${lost.length === 1 ? "something" : "things"} the project showed the rest of itself, and no test covers ${lost.length === 1 ? "it" : "them"}:\n`
    + `${lines.join("\n")}${more}\n\n`
    + "Nothing in the task asked for that. For each one: put it back if it was dropped by accident, or, if it moved or was renamed on purpose, make sure every "
    + "use of the old name is updated (grep for it) and say so with note. Then call done again.";
}

/** The staged files as the check reads them, with each path's text on the branch. */
export async function surfaceInput(
  staged: readonly StagedFile[],
  branchText: (path: string) => Promise<string | null>,
): Promise<{ path: string; before: string | null; after: string | null }[]> {
  const watched = staged.filter((f) => watchedPath(f.path));
  return Promise.all(watched.map(async (f) => ({
    path: f.path,
    // A file we cannot read (binary, too big, gone) has no surface to compare: it is left out rather than called a removal.
    before: await branchText(f.path).catch(() => null),
    after: f.content,
  })));
}
