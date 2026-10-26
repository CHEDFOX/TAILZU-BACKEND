/**
 * THE TASK SET: every `TASKS` export in evals/agent/tasks/*.ts, in file order.
 *
 * The task files are data (types.ts says what one is) and import nothing but
 * types and constants, so loading them reads no config and calls nothing. A
 * missing folder is an empty set, not an error: the bench and its tests run
 * with no task written.
 *
 * The fixtures (fixtures/*.ts) are the bench's own few tasks for its tests,
 * not part of the set, and load the same way.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Lang, Split, Task, TaskModule } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TASKS_DIR = join(HERE, "tasks");
export const FIXTURES_DIR = join(HERE, "fixtures");

/** The task files in a folder: .ts, not .d.ts, not a test, sorted by name. */
export function taskFiles(dir = TASKS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.includes(".test.")).sort().map((f) => join(dir, f));
}

/** Every task in every file of `dir`. A file without a TASKS array is the set's bug, said with its name. */
export async function loadTasks(dir = TASKS_DIR): Promise<Task[]> {
  const out: Task[] = [];
  for (const file of taskFiles(dir)) {
    const mod = (await import(pathToFileURL(file).href)) as Partial<TaskModule>;
    if (!Array.isArray(mod.TASKS)) throw new Error(`${file} has no TASKS array: each task file exports \`export const TASKS: Task[]\`.`);
    out.push(...mod.TASKS);
  }
  return out;
}

export const loadFixtures = (): Promise<Task[]> => loadTasks(FIXTURES_DIR);

/** What run.ts can narrow a set to. */
export interface TaskFilter {
  lang?: Lang[];
  /** Families, "adversarial", or an attack ("injection-doc"). */
  family?: string[];
  split?: Split | "all";
  /** A substring of the id. */
  id?: string;
  /** "k/n": the k-th of n shards, from 1. */
  shard?: { k: number; n: number };
}

export function filterTasks(tasks: Task[], f: TaskFilter): Task[] {
  const picked = tasks.filter((t) =>
    (!f.lang?.length || f.lang.includes(t.lang))
    && (!f.family?.length || f.family.includes(t.family) || (!!t.attack && f.family.includes(t.attack)))
    && (!f.split || f.split === "all" || t.split === f.split)
    && (!f.id || t.id.includes(f.id)));
  return f.shard ? picked.filter((_, i) => i % f.shard!.n === f.shard!.k - 1) : picked;
}
