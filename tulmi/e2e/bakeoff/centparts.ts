/**
 * THE PART BAKE-OFFS THAT NEED CENTS: WIRED NOW, RUN ONCE THE OPENROUTER KEY EXISTS.
 *
 *   editFormats      for each candidate model, which way of asking for an edit applies cleanly and comes out right: exact replace (what edit_file does), SEARCH/REPLACE
 *                    blocks (Aider's), or a unified diff (git apply). The probe is bakeoff/editformat.ts: ten tiny edits, each asked three ways.
 *   contextStrategy  what becomes of old tool results in a long job: SUMMARY (a cheap model folds them), MASK (a one-line placeholder, no model) or HYBRID, on a subset of
 *                    real tasks through the whole flow, with the same model: pass rate, cost, prompt tokens, turns (agent/context.ts, agent/mask.ts).
 *   router           learned routing against a fixed mid tier: the product's own routing (the classifier, the tier for each step, the climb on failure, the live
 *                    route statistics) against ONE mid-tier model for everything, on the front door's labelled messages and the smoke tasks.
 *
 * Each part has the same four things: `estimate` (what it will cost, in rupees, from the catalog's prices, before anything is spent), `command` (how to run it with the
 * key), `prove` (the same machinery on scripted models: no key, no cost, flagged as not a measurement) and `run` (the real thing, under a hard cap, every model call
 * recorded to a cassette so that a second run costs nothing). The router also has a free half that is measured now: how well the classifier's RULES read the
 * labelled tasks and which tier the router sends them to.
 */
import path from "node:path";
import type { CassetteMode } from "../adapters/cassette.js";
import { CassetteStore, SpendGuard } from "../adapters/cassette.js";
import type { CassetteSetup } from "../adapters/rig.js";
import { oracle } from "../adapters/personas.js";
import { loadCatalog, type Catalog } from "../catalog.js";
import { tailzuAgent } from "../agents/tailzu.js";
import { classifyByRules } from "../../src/code/brain/classify.js";
import { baseTier } from "../../src/code/brain/route.js";
import { resetConfigForTests } from "../../src/config.js";
import { runOne } from "../runOne.js";
import { frontItem, taskItem, type SmokeCtx } from "../smoke/items.js";
import { REAL_SHAPE, SHAPE } from "../smoke/estimate.js";
import { loadTasks, selectTasks, type Task } from "../tasks/schema.js";
import { Engine, pinnedTiers } from "./engine.js";
import { EDIT_CASES, EDIT_FORMATS, scoreEditFormats, type EditFormat, type EditFormatScore } from "./editformat.js";
import { loadPools } from "./pools.js";

export type PartMode = "sim" | "real";

export interface PartCtx {
  mode: PartMode;
  fx: number;
  catalog: Catalog;
  /** Hard cap for a real run, in rupees. */
  capInr: number;
  cassetteName: string;
  cassetteMode: CassetteMode | null;
  outDir: string;
  log: (s: string) => void;
}

export interface Table { head: string[]; rows: string[][] }

export interface CentPartResult {
  id: "editFormats" | "contextStrategy" | "router";
  title: string;
  /** measured: real model, real numbers. proved: scripted models, wiring only. */
  status: "measured" | "proved" | "wired";
  headline: string;
  winner?: { id: string; by: string; margin: string };
  table?: Table;
  notes: string[];
  command: string;
  estimateInr: number;
  estimateBasis: string;
  spentInr: number;
  data?: unknown;
}

const priceOf = (cat: Catalog, slug: string): { inUsdPerM: number; outUsdPerM: number } => {
  const m = cat.models.get(slug);
  return m ? { inUsdPerM: m.inUsdPerM, outUsdPerM: m.outUsdPerM } : { inUsdPerM: 0.3, outUsdPerM: 1.2 };
};
const inrFor = (cat: Catalog, fx: number, slug: string, tokIn: number, tokOut: number): number => { const p = priceOf(cat, slug); return ((tokIn * p.inUsdPerM + tokOut * p.outUsdPerM) / 1e6) * fx; };

/** The models a tier of the shipped pools names, those the catalog knows (and, for tool tiers, that take tools). */
export function candidateModels(cat: Catalog, tiers: readonly ("tiny" | "cheap" | "code" | "strong")[], max: number): string[] {
  const pools = loadPools();
  const out: string[] = [];
  for (const t of tiers) for (const s of pools.tiers[t]) {
    const m = cat.models.get(s);
    if (m && (t === "tiny" || t === "cheap" || m.tools) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, max);
}

const withStrategy = async <T>(strategy: string | undefined, f: () => Promise<T>): Promise<T> => {
  const before = process.env.CODE_CONTEXT_STRATEGY;
  if (strategy) process.env.CODE_CONTEXT_STRATEGY = strategy; else delete process.env.CODE_CONTEXT_STRATEGY;
  resetConfigForTests();
  try { return await f(); } finally { if (before === undefined) delete process.env.CODE_CONTEXT_STRATEGY; else process.env.CODE_CONTEXT_STRATEGY = before; resetConfigForTests(); }
};

const pct = (x: number): string => `${Math.round(x * 100)}%`;

function cassetteFor(ctx: PartCtx, guard: SpendGuard | undefined): CassetteSetup | undefined {
  if (ctx.mode !== "real") return undefined;
  const store = new CassetteStore(ctx.cassetteName);
  const mode: CassetteMode = ctx.cassetteMode ?? "mixed";
  if (mode === "record") store.reset(); else store.load();
  return { store, mode, ...(guard ? { guard } : {}) };
}

// ================================================================== edit formats

export const editFormatsEstimate = (ctx: PartCtx, models: readonly string[]): { inr: number; basis: string } => {
  const calls = EDIT_CASES.length * EDIT_FORMATS.length;
  const inr = models.reduce((n, s) => n + inrFor(ctx.catalog, ctx.fx, s, calls * 700, calls * 200), 0);
  return { inr, basis: `${models.length} model(s) x ${calls} calls (${EDIT_CASES.length} edits x ${EDIT_FORMATS.length} formats) of about 700 tokens in, 200 out` };
};

export async function runEditFormats(ctx: PartCtx, o: { models?: string[] } = {}): Promise<CentPartResult> {
  const models = o.models ?? candidateModels(ctx.catalog, ["code", "strong"], ctx.mode === "sim" ? 4 : 8);
  const est = editFormatsEstimate(ctx, models);
  const guard = ctx.mode === "real" ? new SpendGuard(ctx.capInr / ctx.fx) : undefined;
  const cassette = cassetteFor(ctx, guard);
  const engine = new Engine({ mode: ctx.mode, catalog: ctx.catalog, fx: ctx.fx, ...(guard ? { guard } : {}), ...(cassette ? { cassette } : {}), early: false, keep: 1, wave: 1, evalRuns: 0, editFormat: true, needleChars: 0, log: ctx.log });
  const rows: Array<{ model: string; score: EditFormatScore; inr: number }> = [];
  for (const slug of models) {
    if (guard?.exhausted) break;
    const kit = engine.kitFor(slug, "edit");
    const score = await scoreEditFormats((input) => kit.call(input) as never);
    rows.push({ model: slug, score, inr: kit.logs.reduce((n, l) => n + l.paise, 0) / 100 });
    ctx.log(`  edit formats ${slug}: exact ${pct(score.rates.exact)}, blocks ${pct(score.rates.blocks)}, diff ${pct(score.rates.diff)} -> ${score.best}`);
  }
  const mean = (f: EditFormat): number => (rows.length ? rows.reduce((n, r) => n + r.score.rates[f], 0) / rows.length : 0);
  const ranked = [...EDIT_FORMATS].sort((a, b) => mean(b) - mean(a));
  const winner = rows.length ? { id: ranked[0]!, by: "mean share of edits applied cleanly and exactly right, over the models", margin: `${((mean(ranked[0]!) - mean(ranked[1]!)) * 100).toFixed(1)} points over ${ranked[1]}` } : undefined;
  return {
    id: "editFormats", title: "Edit formats per model", status: ctx.mode === "sim" ? "proved" : "measured",
    headline: rows.length ? `best overall: ${ranked[0]} (${pct(mean(ranked[0]!))}); per model: ${rows.map((r) => `${r.model.split("/")[1] ?? r.model} ${r.score.best}`).join(", ")}` : "no model ran",
    ...(winner ? { winner } : {}),
    table: { head: ["model", "exact replace", "search/replace blocks", "unified diff", "best", "calls", "cost ₹"], rows: rows.map((r) => [r.model, pct(r.score.rates.exact), pct(r.score.rates.blocks), pct(r.score.rates.diff), r.score.best, String(r.score.calls), r.inr.toFixed(2)]) },
    notes: [ctx.mode === "sim" ? "Simulated models: each is right or wrong by a fixed draw from its slug. This shows the probe, the scoring and the report work; it measures no model." : "Real models through the cassette: a second run replays for nothing.", "The format a model gets right most often is the one to prefer for it; the product's edit_file is the exact format."],
    command: `npm run bakeoff -- --tiers code,strong --probes-only --edit-format --budget-inr ${Math.max(5, Math.ceil(est.inr * 1.5))}   (or: npm run bakeoff -- --parts --spend --only editFormats)`,
    estimateInr: est.inr, estimateBasis: est.basis, spentInr: (guard?.spentUsd ?? 0) * ctx.fx, data: rows,
  };
}

// ================================================================== context strategy

export const STRATEGIES = ["summary", "mask", "hybrid"] as const;

/** A subset of real tasks for the strategy comparison: bugs and features that need some turns, one per project, the oracle proven. */
export function strategyTasks(n: number): Task[] {
  const all = loadTasks().filter((t) => ["bug", "feature", "refactor"].includes(t.category) && !t.tags.includes("smoke") && !t.tags.includes("injection-suite") && t.validated?.oraclePasses && t.difficulty >= 2);
  const byRepo = new Map<string, Task>();
  for (const t of [...all].sort((a, b) => b.difficulty - a.difficulty || (a.id < b.id ? -1 : 1))) if (!byRepo.has(t.repo)) byRepo.set(t.repo, t);
  return [...byRepo.values()].slice(0, n);
}

export function contextStrategyEstimate(ctx: PartCtx, model: string, tasks: readonly Task[]): { inr: number; basis: string } {
  const inr = tasks.reduce((n, t) => { const s = REAL_SHAPE[t.category] ?? REAL_SHAPE.bug!; return n + STRATEGIES.length * inrFor(ctx.catalog, ctx.fx, model, s.inTokens, s.outTokens); }, 0);
  return { inr, basis: `${tasks.length} task(s) x ${STRATEGIES.length} strategies at ${model}, each about the size of a ${tasks[0]?.category ?? "bug"} task in REAL_SHAPE (${REAL_SHAPE.bug!.inTokens / 1000}k tokens in)` };
}

export async function runContextStrategy(ctx: PartCtx, o: { model?: string; tasks?: Task[]; count?: number } = {}): Promise<CentPartResult> {
  const model = o.model ?? loadPools().tiers.code[0]!;
  const tasks = o.tasks ?? (ctx.mode === "sim" ? selectTasks(loadTasks(), "smoke-api-bug-pagination") : strategyTasks(o.count ?? 4));
  const est = contextStrategyEstimate(ctx, model, tasks);
  const guard = ctx.mode === "real" ? new SpendGuard(ctx.capInr / ctx.fx) : undefined;
  const cassette = cassetteFor(ctx, guard);
  const rows: Array<{ strategy: string; pass: number; n: number; costPaise: number; promptTokens: number; turns: number; applied: boolean }> = [];
  for (const strategy of STRATEGIES) {
    const acc = { strategy, pass: 0, n: 0, costPaise: 0, promptTokens: 0, turns: 0, applied: true };
    for (const t of tasks) {
      if (guard?.exhausted) break;
      const task = ctx.mode === "sim" ? { ...t, budgetPaise: 3000 } : t;
      const info = ctx.catalog.models.get(model);
      const { result, score } = await withStrategy(strategy, () => runOne(task, tailzuAgent, {
        model: ctx.mode === "sim"
          ? { mode: "oracle", persona: oracle, maxTurns: 12, maxTokens: 800 }
          : { mode: "real", slug: model, ladder: [model], tiers: pinnedTiers(model, info), ...(cassette ? { cassette: { ...cassette, run: `${strategy}|${t.id}` }, wire: true } : {}) },
        budgetPaise: ctx.mode === "sim" ? 3000 : 3000, timeoutSec: ctx.mode === "sim" ? 240 : 900, outDir: path.join(ctx.outDir, "strategy", strategy), repeat: 1, log: () => undefined, brainBudgetPaise: 0,
      }));
      acc.n += 1;
      if (score.success) acc.pass += 1;
      acc.costPaise += score.metrics.costPaise;
      acc.promptTokens += result.metrics.promptTokens;
      acc.turns += result.flow?.agent?.turns ?? result.metrics.steps;
      if (result.flow?.agent && result.flow.agent.strategy !== strategy) acc.applied = false;
      ctx.log(`  context strategy ${strategy} on ${t.id}: ${score.success ? "pass" : "FAIL"}, ${result.metrics.steps} turn(s), strategy seen by the agent: ${result.flow?.agent?.strategy ?? "?"}`);
    }
    rows.push(acc);
  }
  const ranked = [...rows].filter((r) => r.n).sort((a, b) => b.pass / b.n - a.pass / a.n || a.costPaise - b.costPaise);
  const [best, second] = ranked;
  const winner = best && second ? { id: best.strategy, by: "pass rate, then cost", margin: `${((best.pass / best.n - second.pass / second.n) * 100).toFixed(0)} points of pass rate and ₹${((second.costPaise - best.costPaise) / 100 / Math.max(1, best.n)).toFixed(2)} per task over ${second.strategy}` } : undefined;
  return {
    id: "contextStrategy", title: "Context strategy: summary, mask or hybrid", status: ctx.mode === "sim" ? "proved" : "measured",
    headline: rows.every((r) => r.applied) ? `${rows.map((r) => `${r.strategy} ${r.pass}/${r.n}`).join(", ")}` : "the strategy was NOT applied as asked for some run",
    ...(winner ? { winner } : {}),
    table: { head: ["strategy", "pass", "mean cost ₹", "mean prompt tokens", "mean turns", "applied"], rows: rows.map((r) => [r.strategy, `${r.pass}/${r.n}`, (r.costPaise / 100 / Math.max(1, r.n)).toFixed(2), String(Math.round(r.promptTokens / Math.max(1, r.n))), (r.turns / Math.max(1, r.n)).toFixed(1), r.applied ? "yes" : "NO"]) },
    notes: [ctx.mode === "sim" ? "A scripted model that does the same on every strategy: this proves CODE_CONTEXT_STRATEGY reaches the agent (the `applied` column reads it back from the agent's own state), not which strategy is better." : `One model (${model}) for all three, the same tasks, a cassette per run.`, "The JetBrains 'Complexity Trap' result to test: masking about halves cost against a raw agent at an equal solve rate; a summary costs an extra model call per fold."],
    command: `npm run bakeoff -- --parts --spend --only contextStrategy --budget-inr ${Math.max(10, Math.ceil(est.inr * 1.5))}`,
    estimateInr: est.inr, estimateBasis: est.basis, spentInr: (guard?.spentUsd ?? 0) * ctx.fx, data: rows,
  };
}

// ================================================================== router

/** The free half: the classifier's rules against the labels of every task that has one, and the tier the router would send each to. */
export function routerFree(): { n: number; typeRight: number; difficultyRight: number; confident: number; tiers: Record<string, number> } {
  const labelled = loadTasks().filter((t) => t.oracle.classify);
  let typeRight = 0, difficultyRight = 0, confident = 0;
  const tiers: Record<string, number> = {};
  for (const t of labelled) {
    const cls = classifyByRules(t.request, { repoEmpty: !!t.base.empty });
    if (cls.type === t.oracle.classify!.type) typeRight += 1;
    if (t.oracle.classify!.difficulty && cls.difficulty === t.oracle.classify!.difficulty) difficultyRight += 1;
    if (cls.confidence >= 0.7) confident += 1;
    const tier = baseTier("write_code", cls).tier;
    tiers[tier] = (tiers[tier] ?? 0) + 1;
  }
  const withDifficulty = labelled.filter((t) => t.oracle.classify!.difficulty).length;
  return { n: labelled.length, typeRight: typeRight / (labelled.length || 1), difficultyRight: withDifficulty ? difficultyRight / withDifficulty : 0, confident: confident / (labelled.length || 1), tiers };
}

export function routerEstimate(ctx: PartCtx, mid: string, smokeTasks: number): { inr: number; basis: string } {
  const per = (slug: string) => inrFor(ctx.catalog, ctx.fx, slug, SHAPE.task.inTokens, SHAPE.task.outTokens) * smokeTasks + inrFor(ctx.catalog, ctx.fx, slug, SHAPE.front.inTokens * 4, SHAPE.front.outTokens * 4);
  return { inr: per(mid) * 2, basis: `2 arms (routed, fixed mid ${mid}) x (${smokeTasks} smoke task(s) at the smoke task size + the 12 labelled front-door messages)` };
}

export async function runRouter(ctx: PartCtx, o: { mid?: string } = {}): Promise<CentPartResult> {
  const mid = o.mid ?? loadPools().tiers.code[0]!;
  const tasks = loadTasks().filter((t) => t.tags.includes("smoke") && ["bug", "feature"].includes(t.category) && !t.tags.includes("hostile"));
  const est = routerEstimate(ctx, mid, tasks.length);
  const free = routerFree();
  const guard = ctx.mode === "real" ? new SpendGuard(ctx.capInr / ctx.fx) : undefined;
  const cassette = cassetteFor(ctx, guard);
  const arms: Array<{ id: string; tiers: SmokeCtx["tiers"] | undefined }> = [{ id: "routed", tiers: undefined }, { id: `fixed-mid`, tiers: pinnedTiers(mid, ctx.catalog.models.get(mid)) }];
  const rows: Array<{ arm: string; front: string; frontOk: boolean; pass: number; n: number; costPaise: number }> = [];
  for (const arm of arms) {
    const sctx: SmokeCtx = {
      mode: ctx.mode === "sim" ? "oracle" : "real", maxTurns: 12, maxTokens: 800, taskBudgetPaise: ctx.mode === "sim" ? 3000 : 250, outDir: path.join(ctx.outDir, "router", arm.id), log: () => undefined,
      ...(arm.tiers ? { tiers: arm.tiers } : {}), ...(cassette ? { cassette: { ...cassette } } : {}),
    };
    const front = await frontItem(sctx, 1);
    let pass = 0, cost = front.costPaise;
    for (const [i, t] of tasks.entries()) {
      if (guard?.exhausted) break;
      const r = await taskItem(ctx.mode === "sim" ? { ...t, budgetPaise: 3000 } : t, sctx, 2 + i, i);
      if (r.ok) pass += 1;
      cost += r.costPaise;
    }
    rows.push({ arm: arm.id, front: front.detail, frontOk: front.ok, pass, n: tasks.length, costPaise: cost });
    ctx.log(`  router arm ${arm.id}: front door ${front.detail}, tasks ${pass}/${tasks.length}, ₹${(cost / 100).toFixed(2)}`);
  }
  const [a, b] = rows;
  const winner = a && b ? (() => { const [w, l] = a.pass !== b.pass ? (a.pass > b.pass ? [a, b] : [b, a]) : (a.costPaise <= b.costPaise ? [a, b] : [b, a]); return { id: w.arm, by: "smoke-task passes, then cost", margin: `${w.pass - l.pass} more pass(es) and ₹${((l.costPaise - w.costPaise) / 100).toFixed(2)} less than ${l.arm}` }; })() : undefined;
  return {
    id: "router", title: "Router: learned routing against a fixed mid tier", status: ctx.mode === "sim" ? "proved" : "measured",
    headline: `rules read ${pct(free.typeRight)} of ${free.n} labelled tasks' type right (confident on ${pct(free.confident)}); ${rows.map((r) => `${r.arm}: ${r.pass}/${r.n} tasks, front door ${r.front}`).join("; ")}`,
    ...(winner ? { winner } : {}),
    table: { head: ["arm", "front door (labelled messages)", "smoke tasks", "cost ₹"], rows: rows.map((r) => [r.arm, r.front, `${r.pass}/${r.n}`, (r.costPaise / 100).toFixed(2)]) },
    notes: [
      `MEASURED NOW, FREE: the classifier's rules against the labels of ${free.n} tasks: type ${pct(free.typeRight)}, difficulty ${pct(free.difficultyRight)}; ${pct(free.confident)} are read with confidence 0.7 or more (the rest go to the tiny model). The code-writing step would go to: ${Object.entries(free.tiers).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
      ctx.mode === "sim" ? "The arms run on a scripted model, which answers the same way whatever tier it is asked on: this proves both arms run, are priced and compared; it says nothing about routing." : "The live route statistics (src/code/brain/stats.ts) need 20 outcomes per task type, step and model before they change a choice (MIN_SAMPLES): at this sample size the routed arm is the rules, the tier map and the climb ladder.",
    ],
    command: `npm run bakeoff -- --parts --spend --only router --budget-inr ${Math.max(10, Math.ceil(est.inr * 1.5))}`,
    estimateInr: est.inr, estimateBasis: est.basis, spentInr: (guard?.spentUsd ?? 0) * ctx.fx, data: { free, rows },
  };
}

export async function makeCtx(o: { mode: PartMode; capInr?: number; cassetteMode?: CassetteMode | null; cassetteName?: string; outDir: string; log: (s: string) => void }): Promise<PartCtx> {
  const fx = Number(process.env.CODE_USD_INR) || 88;
  const catalog = await loadCatalog({ offline: o.mode === "sim" });
  return { mode: o.mode, fx, catalog, capInr: o.capInr ?? 0, cassetteName: o.cassetteName ?? "parts", cassetteMode: o.cassetteMode ?? null, outDir: o.outDir, log: o.log };
}
