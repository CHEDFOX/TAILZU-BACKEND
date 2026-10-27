/**
 * HELPERS FOR WRITING TASKS BY HAND: READ THE PINNED PROJECT'S TEXT, MAKE EXACT EDITS TO IT, FILL IN THE DEFAULTS.
 *
 * A hand-written task carries a known-correct patch (the oracle) and hidden tests. The patch is written as EDITS to the project's real text at the
 * pinned commit, read from the clone, so a drift in the project (a different pin) makes an edit fail loudly here instead of producing a wrong patch.
 * `npm run e2e:author` runs every module in this folder and writes the tasks to e2e/tasks/*.json; `npm run e2e:validate` then proves each one fair.
 */
import { cloneDirOf, getRepo } from "../../repos.js";
import type { Category, Task } from "../schema.js";
import { git } from "../../util.js";

const cache = new Map<string, string>();

/** The text of a file of a project at its pin (or at `commit`), relative to the project's own root. */
export async function baseText(repoId: string, p: string, commit?: string): Promise<string> {
  const r = getRepo(repoId);
  const rev = `${commit ?? r.pin}:${r.workdir ? `${r.workdir}/` : ""}${p}`;
  const key = `${r.id}|${rev}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const text = await git(cloneDirOf(r), ["show", rev]);
  cache.set(key, text);
  return text;
}

/** The files of a folder of the project at its pin. */
export async function baseFiles(repoId: string, dir = ""): Promise<string[]> {
  const r = getRepo(repoId);
  const rev = `${r.pin}:${r.workdir ? `${r.workdir}${dir ? `/${dir}` : ""}` : dir}`;
  const out = await git(cloneDirOf(r), ["ls-tree", "-r", "--name-only", rev]);
  return out.split("\n").filter(Boolean).map((p) => (dir ? `${dir}/${p}` : p));
}

/** Replaces `old` with `now` in `text`; it must occur exactly `times` times (once by default), or the patch is wrong. */
export function edit(text: string, old: string, now: string, times = 1): string {
  const n = text.split(old).length - 1;
  if (n !== times) throw new Error(`expected ${times} occurrence(s) of ${JSON.stringify(old.slice(0, 80))}, found ${n}`);
  return text.split(old).join(now);
}

/** Applies several edits in order. */
export function edits(text: string, list: Array<[old: string, now: string] | [old: string, now: string, times: number]>): string {
  let t = text;
  for (const [old, now, times] of list) t = edit(t, old, now, times ?? 1);
  return t;
}

export interface TaskInput extends Partial<Task> {
  id: string;
  title: string;
  category: Category;
  repo: string;
  request: string;
  truth: Task["truth"];
  oracle: Task["oracle"];
}

/** A task with the defaults filled in: the pinned commit, no extra checks, a pull request expected for a change. */
export function task(t: TaskInput): Task {
  const r = t.repo === "synthetic" ? null : getRepo(t.repo);
  const change = t.oracle.kind === "patch" || t.oracle.kind === "ask_then_patch" || t.oracle.kind === "flag_broken" || t.oracle.kind === "milestones";
  return {
    difficulty: 3,
    tags: [t.category, ...(r ? [r.id] : ["synthetic"])],
    base: r ? { commit: r.pin } : { files: {} },
    checks: {},
    ...t,
    ...(change ? {} : {}),
  } as Task;
}

/** Test file paths of a project's own convention. */
export const testDir = (repoId: string): string => getRepo(repoId).test.testDirs[0] ?? "tests";

/** A task that is already written (a mined bug in its JSON file, or one of the hand-written modules), to derive a variant from. */
export async function existing(id: string): Promise<Task> {
  const { loadTasks } = await import("../schema.js");
  const hit = loadTasks().find((t) => t.id === id);
  if (hit) return structuredClone(hit);
  for (const mod of ["features", "refactors", "questions", "ui"]) {
    const m = (await import(`./${mod}.js`)) as { tasks(): Promise<Task[]> };
    const t = (await m.tasks()).find((x) => x.id === id);
    if (t) return structuredClone(t);
  }
  throw new Error(`there is no task ${id} to derive from`);
}

/** A variant of `of`: the same hidden checks and oracle, a new id and request, and what is different (planted files, canaries, a scenario). */
export type VariantOver = Omit<Partial<Task>, "truth" | "oracle" | "checks" | "base"> & {
  id: string; title: string; category: Category;
  truth?: Partial<Task["truth"]>; oracle?: Partial<Task["oracle"]>; checks?: Task["checks"]; base?: Partial<Task["base"]>;
};

export async function variant(of: string, over: VariantOver): Promise<Task> {
  const b = await existing(of);
  const { validated: _v, mined: _m, ...rest } = b;
  const base = { ...b.base, ...(over.base ?? {}) };
  const checks = { ...b.checks, ...(over.checks ?? {}) };
  const truth = { ...b.truth, ...(over.truth ?? {}) };
  const oracle = { ...b.oracle, ...(over.oracle ?? {}) };
  return { ...rest, ...over, base, checks, truth, oracle, derivedFrom: of, tags: [...new Set([...(over.tags ?? []), ...b.tags.filter((t) => !["quick"].includes(t))])] } as Task;
}

/** `text` with `insertion` put after the first occurrence of `anchor` (which must be there). */
export function insertAfter(text: string, anchor: string, insertion: string): string {
  const i = text.indexOf(anchor);
  if (i < 0) throw new Error(`the anchor ${JSON.stringify(anchor.slice(0, 60))} is not in the text`);
  return text.slice(0, i + anchor.length) + insertion + text.slice(i + anchor.length);
}
