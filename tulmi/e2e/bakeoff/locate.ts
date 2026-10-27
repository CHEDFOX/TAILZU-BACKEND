/**
 * LOCATE BAKE-OFF (FREE: NO MODEL): WHERE DOES THE CHANGE BELONG? OUR FUNNEL, AIDER'S REPO MAP AND PLAIN GREP, ON THE REAL BUG AND QUESTION TASKS.
 *
 * The question: given only what the person typed, does the file the real fix changed (a bug) or the files an answer must point to (a question) come first
 * in the list? Ground truth is the task's own: `truth.files` (and `near`) for a bug, `truth.answerFiles` for a question, on the repo at the task's pinned commit.
 * Scores: top-1 and top-3 (is a right file first / among the first three), top-5, and MRR (the reciprocal of the first right file's place).
 *
 *   tailzu-funnel   our locate's free half (work/locate.ts fusedFor): the cues of the request, the six signals (path, text, symbol, file, feature, repo map), fused.
 *                   No model, no confidence threshold, no one-hop: the list the model would be asked to choose from.
 *   aider-map       Aider 0.86.2's repo map as Aider uses it before a turn: the request's identifiers and file names personalize the PageRank over its
 *                   tree-sitter definition/reference graph (bakeoff/py/aider_repomap.py, in Aider's venv); a file's place is where its best-ranked definition comes.
 *   grep            every non-stopword term of the request, `git grep -ciw` for each; files ranked by the rarity-weighted number of distinct terms they hold.
 *   chance          for reference: the expected score of a random order of the repo's files.
 *
 * Also reported, as its own line and not as a rank: what `aider --show-repo-map` prints (the map Aider would show with nothing in the chat). The CLI sorts
 * the files it shows by name, so it has no order to score; the question for it is whether a right file is in the map at all, and how many files the map shows.
 */
import fs from "node:fs";
import path from "node:path";
import { fusedFor } from "../../src/code/work/locate.js";
import { oracle } from "../adapters/personas.js";
import { createRig, USER } from "../adapters/rig.js";
import { toolBin, toolDir } from "../agents/tools.js";
import { loadTasks, type Task } from "../tasks/schema.js";
import { E2E_DIR, WORK_DIR, git, mkdirp, rmrf, run } from "../util.js";
import { materialize } from "../validate.js";

// ----------------------------------------------------------------------- scoring

export const goldFor = (t: Pick<Task, "category" | "truth">): string[] => [...(t.category === "question" ? (t.truth.answerFiles ?? []) : t.truth.files), ...(t.truth.near ?? [])];

export interface Rank { n: number; top1: boolean; top3: boolean; top5: boolean; rr: number; at: number }

/** Where the first right file comes in a ranked list (0 when it does not). */
export function rankOf(ranked: readonly string[], gold: readonly string[]): Rank {
  const i = ranked.findIndex((f) => gold.includes(f));
  return { n: ranked.length, top1: i === 0, top3: i >= 0 && i < 3, top5: i >= 0 && i < 5, rr: i >= 0 ? 1 / (i + 1) : 0, at: i + 1 };
}

export interface LocateTotals { n: number; top1: number; top3: number; top5: number; mrr: number }

export function totalsOf(ranks: readonly Rank[]): LocateTotals {
  const n = ranks.length;
  const f = (g: (r: Rank) => number): number => (n ? ranks.reduce((s, r) => s + g(r), 0) / n : 0);
  return { n, top1: f((r) => Number(r.top1)), top3: f((r) => Number(r.top3)), top5: f((r) => Number(r.top5)), mrr: f((r) => r.rr) };
}

/** The chance a random order of `files` files puts at least one of `gold` right files among the first k. */
export function chanceTopK(files: number, gold: number, k: number): number {
  if (files <= 0 || gold <= 0) return 0;
  if (gold >= files || k >= files) return 1;
  let miss = 1;
  for (let i = 0; i < Math.min(k, files); i += 1) miss *= Math.max(0, (files - gold - i) / (files - i));
  return 1 - miss;
}

// ----------------------------------------------------------------------- plain grep

const STOP = new Set(("a an and are as at be been but by can could did do does for from get gets had has have how i if in into is it its just like make makes me my not of on or our out " +
  "please should so some than that the their them then there these they this to up us use used uses was we what when where which who why will with without would you your " +
  "fix fixes bug bugs wrong right issue problem error errors work works working want need needs add change changes update new old also still instead").split(/\s+/));

export const grepTerms = (request: string): string[] => [...new Set((request.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w)))].slice(0, 24);

/** Files ranked by the rarity-weighted number of the request's terms they hold (one `git grep -ciw` per term). Pure given the per-term counts. */
export function rankByGrep(perTerm: ReadonlyArray<{ term: string; counts: ReadonlyMap<string, number> }>, files: number): string[] {
  const score = new Map<string, { s: number; hits: number }>();
  for (const { counts } of perTerm) {
    const df = counts.size;
    if (!df) continue;
    const idf = Math.log(1 + files / df);
    for (const [f, c] of counts) { const e = score.get(f) ?? { s: 0, hits: 0 }; e.s += idf; e.hits += c; score.set(f, e); }
  }
  return [...score.entries()].sort((a, b) => b[1].s - a[1].s || b[1].hits - a[1].hits || (a[0] < b[0] ? -1 : 1)).map(([f]) => f);
}

async function trackedFiles(dir: string): Promise<string[]> {
  return (await git(dir, ["ls-files", "-z"])).split("\0").filter(Boolean);
}

export async function grepRank(dir: string, request: string): Promise<{ ranked: string[]; files: number }> {
  const files = await trackedFiles(dir);
  const perTerm: Array<{ term: string; counts: Map<string, number> }> = [];
  for (const term of grepTerms(request)) {
    const out = await git(dir, ["grep", "-I", "-i", "-w", "-c", "-e", term], { allowFail: true });
    const counts = new Map<string, number>();
    for (const line of out.split("\n")) { const m = /^(.*):(\d+)$/.exec(line); if (m) counts.set(m[1]!, Number(m[2])); }
    perTerm.push({ term, counts });
  }
  return { ranked: rankByGrep(perTerm, files.length), files: files.length };
}

// ----------------------------------------------------------------------- aider

const aiderHome = (): string => {
  const h = path.join(WORK_DIR, "aider-locate-home");
  mkdirp(path.join(h, ".aider", "caches"));
  fs.writeFileSync(path.join(h, ".aider", "caches", "model_prices_and_context_window.json"), "{}");
  fs.writeFileSync(path.join(h, "meta.json"), JSON.stringify({ "openai/e2e-model": { max_input_tokens: 128000, max_output_tokens: 8000, litellm_provider: "openai", mode: "chat" } }));
  return h;
};

const aiderEnv = (home: string): Record<string, string> => ({ PATH: "/usr/bin:/bin", HOME: home, LITELLM_LOCAL_MODEL_COST_MAP: "True", PYTHONHASHSEED: "0", OPENAI_API_KEY: "e2e-not-a-key", OPENAI_API_BASE: "http://127.0.0.1:9/v1", NO_COLOR: "1" });

export async function aiderMapRank(dir: string, request: string): Promise<{ ranked: string[]; ms: number }> {
  if (!toolBin("aider")) throw new Error("aider is not installed: npm run e2e:tools -- install aider");
  const py = path.join(toolDir("aider"), "bin", "python");
  const home = aiderHome();
  const reqFile = path.join(home, "request.txt");
  fs.writeFileSync(reqFile, request);
  // No -I here: isolated mode ignores PYTHONHASHSEED, and Aider's ranking depends on set order. The script is ours and runs from a neutral folder.
  const r = await run(py, ["-s", "-B", path.join(E2E_DIR, "bakeoff", "py", "aider_repomap.py"), dir, reqFile], { cwd: home, env: aiderEnv(home), timeoutMs: 180_000 });
  const line = r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (r.code !== 0 || !line) throw new Error(`aider repo map failed: ${r.stderr.trim().slice(-200)}`);
  const j = JSON.parse(line) as { ranked: string[]; ms: number };
  return { ranked: j.ranked, ms: j.ms };
}

/** What `aider --show-repo-map` shows for the work tree: the files in it (it prints them sorted by name, not by rank). */
export async function aiderCliMapFiles(dir: string): Promise<string[]> {
  const bin = toolBin("aider");
  if (!bin) throw new Error("aider is not installed");
  const home = aiderHome();
  const tracked = new Set(await trackedFiles(dir));
  const r = await run(bin, ["--model", "openai/e2e-model", "--model-metadata-file", path.join(home, "meta.json"), "--show-repo-map", "--no-gitignore", "--no-check-update", "--analytics-disable", "--no-show-model-warnings", "--no-pretty", "--yes-always", "--chat-history-file", path.join(home, "chat.md"), "--input-history-file", path.join(home, "input.hist")], { cwd: dir, env: aiderEnv(home), timeoutMs: 180_000 });
  rmrf(path.join(dir, ".aider.tags.cache.v4"));
  const shown = r.stdout.split("\n").map((l) => l.replace(/:$/, "")).filter((l) => tracked.has(l));
  return [...new Set(shown)];
}

// ----------------------------------------------------------------------- our funnel

export async function funnelRank(task: Task): Promise<{ ranked: string[]; ms: number }> {
  const rig = await createRig({ mode: "oracle", persona: oracle, brainBudgetPaise: 0 });
  const t0 = Date.now();
  try {
    const h = await rig.addProjectFor(task);
    const brain = await rig.code.brain!.open(USER, h.project.id);
    const fused = await fusedFor(task.request, brain);
    return { ranked: fused.map((f) => f.path), ms: Date.now() - t0 };
  } finally { await rig.dispose(); }
}

// ----------------------------------------------------------------------- the bake-off

export interface LocateRow { task: string; category: string; repo: string; gold: string[]; files: number; byContestant: Record<string, { top: string[]; at: number; ms: number; error?: string }>; cliMap?: { shown: number; goldIn: boolean } }

export interface LocateContestantResult { id: string; label: string; totals: LocateTotals; msPerTask: number; errors: number }

export interface LocateBakeoff {
  at: string;
  tasks: number;
  bugs: number;
  questions: number;
  contestants: LocateContestantResult[];
  chance: { top1: number; top3: number };
  cliMap: { tasks: number; goldInMap: number; meanFilesShown: number; meanFiles: number } | null;
  winner: { id: string; by: string; margin: string } | null;
  rows: LocateRow[];
}

export const CONTESTANT_LABELS: Record<string, string> = {
  "tailzu-funnel": "Tailzu locate funnel (6 signals fused, no model)",
  "aider-map": "Aider 0.86.2 repo map, personalized by the request",
  grep: "plain grep (terms of the request, rarity-weighted)",
};

export function selectLocateTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => ["bug", "question"].includes(t.category) && t.repo !== "synthetic" && goldFor(t).length > 0 && t.validated?.oraclePasses !== false);
}

export async function runLocateBakeoff(o: { tasks?: readonly Task[]; contestants?: readonly string[]; cli?: boolean; log?: (s: string) => void } = {}): Promise<LocateBakeoff> {
  const log = o.log ?? (() => undefined);
  const tasks = o.tasks ?? selectLocateTasks(loadTasks());
  const ids = o.contestants ?? ["tailzu-funnel", "aider-map", "grep"];
  const rows: LocateRow[] = [];
  const ranks: Record<string, Rank[]> = Object.fromEntries(ids.map((i) => [i, []]));
  const ms: Record<string, number[]> = Object.fromEntries(ids.map((i) => [i, []]));
  const errors: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const chance1: number[] = [], chance3: number[] = [];
  const cli = { tasks: 0, goldIn: 0, shown: 0, files: 0 };
  const aiderOn = !!toolBin("aider");
  for (const t of tasks) {
    const gold = goldFor(t);
    let m: Awaited<ReturnType<typeof materialize>> | null = null;
    try {
      m = await materialize(t);
      const files = (await trackedFiles(m.dir)).length;
      const row: LocateRow = { task: t.id, category: t.category, repo: t.repo, gold, files, byContestant: {} };
      chance1.push(chanceTopK(files, gold.length, 1)); chance3.push(chanceTopK(files, gold.length, 3));
      for (const id of ids) {
        const t0 = Date.now();
        try {
          let ranked: string[];
          if (id === "tailzu-funnel") ranked = (await funnelRank(t)).ranked;
          else if (id === "aider-map") { if (!aiderOn) throw new Error("aider is not installed"); ranked = (await aiderMapRank(m.dir, t.request)).ranked; }
          else if (id === "grep") ranked = (await grepRank(m.dir, t.request)).ranked;
          else throw new Error(`no locate contestant called ${id}`);
          const r = rankOf(ranked, gold);
          ranks[id]!.push(r);
          ms[id]!.push(Date.now() - t0);
          row.byContestant[id] = { top: ranked.slice(0, 3), at: r.at, ms: Date.now() - t0 };
        } catch (err) {
          errors[id]! += 1;
          ranks[id]!.push({ n: 0, top1: false, top3: false, top5: false, rr: 0, at: 0 });
          row.byContestant[id] = { top: [], at: 0, ms: Date.now() - t0, error: (err as Error).message.slice(0, 120) };
        }
      }
      if ((o.cli ?? true) && aiderOn) {
        try { const shown = await aiderCliMapFiles(m.dir); cli.tasks += 1; cli.shown += shown.length; cli.files += files; const goldIn = shown.some((f) => gold.includes(f)); if (goldIn) cli.goldIn += 1; row.cliMap = { shown: shown.length, goldIn }; } catch { /* the CLI line is a side metric */ }
      }
      rows.push(row);
      log(`locate: ${t.id}: ${ids.map((i) => `${i} #${row.byContestant[i]!.at || "-"}`).join("  ")}`);
    } finally { m?.dispose(); }
  }
  const contestants: LocateContestantResult[] = ids.map((id) => ({ id, label: CONTESTANT_LABELS[id] ?? id, totals: totalsOf(ranks[id]!), msPerTask: ms[id]!.length ? Math.round(ms[id]!.reduce((a, b) => a + b, 0) / ms[id]!.length) : 0, errors: errors[id]! }));
  const ranked = contestants.filter((c) => c.errors < tasks.length).sort((a, b) => b.totals.top3 - a.totals.top3 || b.totals.top1 - a.totals.top1 || b.totals.mrr - a.totals.mrr);
  const best = ranked[0], second = ranked[1];
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    at: new Date().toISOString(), tasks: tasks.length, bugs: tasks.filter((t) => t.category === "bug").length, questions: tasks.filter((t) => t.category === "question").length,
    contestants, chance: { top1: mean(chance1), top3: mean(chance3) },
    cliMap: cli.tasks ? { tasks: cli.tasks, goldInMap: cli.goldIn / cli.tasks, meanFilesShown: cli.shown / cli.tasks, meanFiles: cli.files / cli.tasks } : null,
    winner: best ? { id: best.id, by: "top-3, then top-1", margin: second ? `top-3 ${((best.totals.top3 - second.totals.top3) * 100).toFixed(1)} points and top-1 ${((best.totals.top1 - second.totals.top1) * 100).toFixed(1)} points over ${second.id}` : "no other contestant ran" } : null,
    rows,
  };
}

export function renderLocate(r: LocateBakeoff): string {
  const pc = (x: number): string => `${(x * 100).toFixed(1)}%`.padStart(7);
  const L = [`LOCATE: ${r.tasks} tasks (${r.bugs} bugs, ${r.questions} questions) on real repos at their pinned commits`];
  L.push(`${"contestant".padEnd(15)} ${"top-1".padStart(7)} ${"top-3".padStart(7)} ${"top-5".padStart(7)} ${"MRR".padStart(6)} ${"ms/task".padStart(8)}  errors`);
  for (const c of r.contestants) L.push(`${c.id.padEnd(15)} ${pc(c.totals.top1)} ${pc(c.totals.top3)} ${pc(c.totals.top5)} ${c.totals.mrr.toFixed(3).padStart(6)} ${String(c.msPerTask).padStart(8)}  ${c.errors}`);
  L.push(`${"chance".padEnd(15)} ${pc(r.chance.top1)} ${pc(r.chance.top3)}`);
  if (r.winner) L.push(`winner: ${r.winner.id}, ${r.winner.margin}`);
  if (r.cliMap) L.push(`aider --show-repo-map (default budget, nothing in the chat): a right file is in the map for ${(r.cliMap.goldInMap * 100).toFixed(0)}% of ${r.cliMap.tasks} tasks; it shows ${r.cliMap.meanFilesShown.toFixed(1)} of ${r.cliMap.meanFiles.toFixed(0)} files on average (sorted by name: no rank to score)`);
  return L.join("\n");
}

