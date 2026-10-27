/**
 * The runner behind run.ts and tests/code-work-locate-map.test.ts: builds the brains, runs the tasks under each map setting, tabulates.
 * (Kept apart from bench.ts so that the config the rigs read is set before any of this is imported.)
 */
import { MemoryProjectBrainStore } from "../../src/code/project/store.js";
import type { StoredFile } from "../../src/code/project/types.js";
import { MAP_DEFAULTS, type MapSettings } from "../../src/code/work/locate.js";
import { projectRig, built } from "../../tests/project-rig.js";
import { acmeFiles } from "../../tests/project-repo.js";
import { ACME_TASKS, appSources, baseSignals, generateCallers, generateDefined, rankOf, score, splitOf, type Score, type Task } from "./bench.js";
import type { BaseSignals } from "../../src/code/work/locate.js";

export interface Variant { name: string; map: MapSettings }

export const VARIANTS: readonly Variant[] = [
  { name: "five signals (map off)", map: { on: false } },
  { name: "with the repo map (shipped)", map: { ...MAP_DEFAULTS } },
];

export const GRID: readonly Variant[] = [1, 2].flatMap((back) => [1.0, 1.5, 2.0, 2.5, 3.0].flatMap((weight) => [false, true].map((seeds): Variant => ({
  name: `back ${back}, weight ${weight}, ${seeds ? "seeds in" : "seeds out"}`, map: { on: true, back, weight, seeds },
}))));

export interface BenchResult {
  tasks: Record<string, Task[]>;
  /** variant name, then set, then split: the score. */
  scores: Record<string, Record<string, Record<string, Score>>>;
  /** variant name, then set ("defined", "callers"): the score on the DEV tasks. */
  grid?: Record<string, Record<string, Score>>;
  facts: { acmeFiles: number; appFiles: number; appFilesWithRefs: number; appRefEdges: number };
}

async function brainOf(files: Record<string, string | Buffer>) {
  const r = await projectRig({ files, budgetPaise: 0 });
  await built(r);
  const brain = await r.brain.open("alice", r.projectId);
  const rows = await (r.brainStore as MemoryProjectBrainStore).listFiles(r.projectId);
  return { brain, rows };
}

export async function runLocateBench(o: { grid?: boolean; /** Tasks generated per set (the command line takes 120; the test fewer, since each task is ranked twice). */ max?: number } = {}): Promise<BenchResult> {
  const acme = await brainOf(acmeFiles());
  const app = await brainOf(appSources());
  const tasks: Record<string, Task[]> = {
    fixtures: ACME_TASKS.map((t) => ({ ...t, set: "fixtures", split: splitOf(t.id) })),
    defined: generateDefined(app.rows, o.max),
    callers: generateCallers(app.rows, o.max),
  };
  const brainFor = (t: Task) => (t.set === "fixtures" ? acme.brain : app.brain);
  // The five signals of a task do not change with the map: they are made once.
  const bases = new Map<string, BaseSignals>();
  for (const list of Object.values(tasks)) for (const t of list) bases.set(t.id, await baseSignals(t.text, brainFor(t) as never));
  const scores: BenchResult["scores"] = {};
  for (const v of VARIANTS) {
    scores[v.name] = {};
    for (const [set, list] of Object.entries(tasks)) {
      // Each task is ranked once; the halves and the whole are read off the same ranks.
      const ranks: number[] = [];
      for (const t of list) ranks.push(await rankOf(brainFor(t) as never, t, bases.get(t.id)!, v.map));
      scores[v.name]![set] = {};
      for (const split of ["dev", "test", "all"]) scores[v.name]![set]![split] = score(ranks.filter((_, i) => split === "all" || list[i]!.split === split));
    }
  }
  let grid: BenchResult["grid"];
  if (o.grid) {
    grid = {};
    for (const v of GRID) {
      grid[v.name] = {};
      for (const set of ["defined", "callers"]) {
        const ranks: number[] = [];
        for (const t of tasks[set]!.filter((x) => x.split === "dev")) ranks.push(await rankOf(brainFor(t) as never, t, bases.get(t.id)!, v.map));
        grid[v.name]![set] = score(ranks);
      }
    }
  }
  const withRefs = app.rows.filter((f: StoredFile) => f.refs?.length).length;
  return {
    tasks, scores, ...(grid ? { grid } : {}),
    facts: { acmeFiles: acme.rows.length, appFiles: app.rows.length, appFilesWithRefs: withRefs, appRefEdges: app.rows.reduce((a: number, f: StoredFile) => a + (f.refs?.length ?? 0), 0) },
  };
}

const p = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
const row = (s: Score) => `n ${String(s.n).padStart(3)}  top1 ${p(s.top1)}  top3 ${p(s.top3)}  top5 ${p(s.top5)}  top8 ${p(s.top8)}  MRR ${s.mrr.toFixed(3)}`;

export function printLocateBench(r: BenchResult): void {
  console.log(`\nAcme Shop brain: ${r.facts.acmeFiles} files. tulmi/src brain: ${r.facts.appFiles} files, ${r.facts.appFilesWithRefs} with references (${r.facts.appRefEdges} names).`);
  for (const set of Object.keys(r.tasks)) {
    console.log(`\n${set} (${r.tasks[set]!.length} tasks)`);
    for (const split of set === "fixtures" ? ["all"] : ["dev", "test"]) {
      for (const v of Object.keys(r.scores)) console.log(`  ${split.padEnd(5)} ${v.padEnd(30)} ${row(r.scores[v]![set]![split]!)}`);
    }
  }
  if (r.grid) {
    console.log("\nGRID on the DEV tasks (sorted by the callers' MRR)");
    for (const [k, s] of Object.entries(r.grid).sort((a, b) => b[1].callers!.mrr - a[1].callers!.mrr)) console.log(`  ${k.padEnd(38)} callers ${row(s.callers!)} | defined top1 ${p(s.defined!.top1)} MRR ${s.defined!.mrr.toFixed(3)}`);
  }
}
