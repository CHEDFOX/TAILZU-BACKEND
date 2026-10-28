/**
 * THE PLAN: WHAT EACH SIZE RUNS, WHAT EACH STAGE WILL COST FROM THE LIVE PRICES, AND THE GUARD THAT STOPS A STAGE THAT SPENDS MORE THAN THAT.
 *
 *   quick      about 12 tasks (the smallest set that touches every category and stage, plus a couple), the comparisons on the first 6 of them, 3 models
 *   standard   about 24 tasks, comparisons on 12, 5 models, every contestant
 *   deep       all 71 tasks, comparisons on all of them, 8 models, every contestant, repeats for flaky results
 *
 * THE ESTIMATE (`estimateStages`) is made before anything is spent, per stage, from OpenRouter's live prices through the proxy the environment names:
 *   expected   what the stage should spend with its early stops working (a dominated contestant dropped after the first round, a result already in the store not paid again)
 *   max        what it can spend if nothing stops early
 *   reused     what the work would have cost that the store already answers
 * `--estimate` prints it and writes a receipt; a paid run refuses to start without a receipt for its plan (so the number was seen, not just printed).
 *
 * THE GUARD (`StageBudget`): each stage gets a share of the cap and its estimate. Every run charges it; if the stage's live spend passes 130% of its estimate (and the
 * estimate plus a few paise, so that a stage estimated at ₹0.02 is not stopped by rounding), the stage is ABORTED: a StageOverrun is thrown, the stage's work stops,
 * the report says so, and the later stages are budgeted at the same ratio. Replays, scripted runs and simulations are never charged: they cost nothing.
 */
import path from "node:path";
import { ASSUMED, loadCatalog, type Catalog } from "../catalog.js";
import { CliExit } from "../cli.js";
import { contestantRows } from "../bakeoff/contestants.js";
import { isOurs } from "../agents/tailzu.js";
import { estimateGrid } from "../bakeoff/contestants.js";
import { candidateModels, contextStrategyEstimate, editFormatsEstimate, routerEstimate, strategyTasks, type PartCtx } from "../bakeoff/centparts.js";
import { loadPools } from "../bakeoff/pools.js";
import { ALL_PROBES } from "../bakeoff/probes.js";
import { tierTable } from "../../src/code/brain/tiers.js";
import { estimateRun, estimateSmoke, REAL_SHAPE, SHAPE } from "../smoke/estimate.js";
import { planItems } from "../smoke/index.js";
import { smokePromptVersion, codeFingerprint, probeVersion, taskPromptVersion } from "./fingerprint.js";
import { blockedTasks, checkRepos, contestants, runsOnAnyAgent, type Contestant, type RepoStatus } from "./installs.js";
import { PLAN_TASKS, planPool, sampleTasks, type Sample } from "./sampler.js";
import { bestModels, probeKeyNow, probeNeeds } from "./scoreboard.js";
import type { SimScenario } from "./sim.js";
import { storeFor, type ResultKey, type ResultsStore } from "./store.js";
import { StageOverrun } from "./compare.js";
import { loadTasks, selectTasks, type Task } from "../tasks/schema.js";
import { OUT_DIR, mkdirp, readJson, writeJson } from "../util.js";
import type { Arm, Mode, PlanName, StageEstimate, StageId } from "./types.js";
import { STAGE_TITLES } from "./types.js";

export interface PlanSpec {
  /** Tasks in the stratified sample. */
  tasks: number;
  /** Tasks the comparisons draw from, at most. */
  compareTasks: number;
  /** Models (besides the product's own ladders) in the model comparison. */
  models: number;
  /** Tasks run before anything is concluded, and added per round. */
  minTasks: number;
  roundSize: number;
  maxRepeats: number;
  agents: string[];
  /** The share of the budget each stage may use (what a stage does not use passes to the next). */
  share: Record<StageId, number>;
}

export const PLAN_SPECS: Record<PlanName, PlanSpec> = {
  quick: { tasks: PLAN_TASKS.quick, compareTasks: 6, models: 3, minTasks: 4, roundSize: 2, maxRepeats: 1, agents: ["tailzu", "aider", "opencode", "mini-swe-agent"], share: { 0: 0, 1: 0.08, 2: 0.04, 3: 0.28, 4: 0.45, 5: 0.15 } },
  standard: { tasks: PLAN_TASKS.standard, compareTasks: 12, models: 5, minTasks: 4, roundSize: 3, maxRepeats: 1, agents: ["tailzu", "aider", "opencode", "codex", "openhands", "mini-swe-agent"], share: { 0: 0, 1: 0.06, 2: 0.03, 3: 0.3, 4: 0.46, 5: 0.15 } },
  deep: { tasks: PLAN_TASKS.deep, compareTasks: PLAN_TASKS.deep, models: 8, minTasks: 5, roundSize: 5, maxRepeats: 2, agents: ["tailzu", "aider", "opencode", "codex", "openhands", "mini-swe-agent"], share: { 0: 0, 1: 0.04, 2: 0.02, 3: 0.32, 4: 0.5, 5: 0.12 } },
};

export interface RealityOptions {
  plan: PlanName;
  budgetInr: number;
  mode: Mode;
  estimateOnly: boolean;
  stages: StageId[];
  groups: Array<"agents" | "models">;
  agents?: string[];
  models?: string[];
  agentModel?: string;
  resultsDir?: string;
  outDir: string;
  seed: number;
  confidence: number;
  install: boolean;
  skipSuite: boolean;
  skipTypecheck: boolean;
  freeParts: boolean;
  judge: boolean;
  sim: SimScenario;
  persona: "oracle" | "fake";
  log: (s: string) => void;
  /** For tests: a catalog and a task list instead of the network's and the folder's. */
  catalog?: Catalog;
  tasks?: Task[];
  poolsFile?: string;
  /** Cap the sample and the comparisons at this many tasks (a quick look, a proof). */
  taskLimit?: number;
  /** These tasks instead of the stratified sample (`--tasks`): ids, in the order given, or a glob (tag:, category:, repo:), in id order. */
  taskGlob?: string;
}

export interface Ctx extends RealityOptions {
  fx: number;
  catalog: Catalog;
  store: ResultsStore;
  pool: Task[];
  repos: Map<string, RepoStatus>;
  blocked: Map<string, string>;
  sample: Sample;
  spec: PlanSpec;
  /** The model the contestants share in the agents comparison. */
  agentModel: string;
  /** How the prices were read: "live" (just fetched), "cache" (the saved copy), "none" (assumed). */
  priceSource: Catalog["source"];
}

export const fxRate = (): number => Number(process.env.CODE_USD_INR) || 88;

export function priceOf(catalog: Catalog, slug: string): { inUsdPerM: number; outUsdPerM: number; assumed: boolean } {
  const m = catalog.models.get(slug);
  return m ? { inUsdPerM: m.inUsdPerM, outUsdPerM: m.outUsdPerM, assumed: false } : { ...ASSUMED, assumed: true };
}
export const inrOf = (catalog: Catalog, fx: number, slug: string, tin: number, tout: number): number => { const p = priceOf(catalog, slug); return ((tin * p.inUsdPerM + tout * p.outUsdPerM) / 1e6) * fx; };

// ------------------------------------------------------------------------------------ the context

export const taskKey = (arm: Arm, task: Task): ResultKey => ({ kind: "task", agent: arm.agent, model: arm.model, item: task.id, code: codeFingerprint("task", arm.agent), prompt: taskPromptVersion(task, arm.agent, task) });
export const smokeKey = (id: string): ResultKey => ({ kind: "smoke", agent: "tailzu", model: "smoke-ladder", item: id, code: codeFingerprint("smoke"), prompt: smokePromptVersion() });
export const LADDERS_ARM: Arm = { id: "tailzu:ladders", agent: "tailzu", model: "ladders", group: "models" };

export async function buildCtx(o: RealityOptions): Promise<Ctx> {
  const fx = fxRate();
  const catalog = o.catalog ?? (await loadCatalog({ maxAgeMs: o.estimateOnly || o.mode === "real" ? 0 : 6 * 3600_000, offline: o.mode === "replay" }));
  const store = storeFor(o.mode === "sim" || o.mode === "scripted" ? "sim" : "real", { ...(o.resultsDir ? { dir: o.resultsDir } : {}), outDir: o.outDir });
  const pool = planPool(o.tasks ?? loadTasks());
  // Simulated and scripted runs do not touch the projects' dependencies, so nothing is blocked for them.
  const repos = o.mode === "sim" ? new Map<string, RepoStatus>() : await checkRepos(pool, { install: o.install && !o.estimateOnly && o.mode === "real", log: o.log });
  const blocked = blockedTasks(pool, repos);
  const spec = PLAN_SPECS[o.plan];
  const history = new Map<string, { runs: number; fails: number }>();
  for (const r of store.list((x) => x.kind === "task" && x.agent === "tailzu")) { const h = history.get(r.item) ?? { runs: 0, fails: 0 }; h.runs += 1; if (!r.ok) h.fails += 1; history.set(r.item, h); }
  const answered = new Set(pool.filter((t) => store.reusable(taskKey(LADDERS_ARM, t))).map((t) => t.id));
  const code = tierTable().code.models[0] ?? "deepseek/deepseek-v4.1-flash";
  const sample = sampleTasks({
    tasks: pool, target: spec.tasks, history, answered, blocked,
    cost: (t) => { const s = REAL_SHAPE[t.category] ?? REAL_SHAPE.bug!; return inrOf(catalog, fx, code, s.inTokens, s.outTokens); },
  });
  const agentModel = o.agentModel ?? candidateModels(catalog, ["code"], 1)[0] ?? loadPools(o.poolsFile).tiers.code[0] ?? "deepseek/deepseek-v4.1-flash";
  const chosen = o.taskGlob ? chosenSample(o.taskGlob, pool, blocked) : null;
  return { ...o, fx, catalog, store, pool, repos, blocked, sample: chosen ?? sample, spec: chosen ? { ...spec, tasks: chosen.ordered.length, compareTasks: chosen.ordered.length } : spec, agentModel, priceSource: catalog.source };
}

/**
 * The tasks named on the command line, as the sample: ids in the order given (a comparison adds them in that order), or what a glob matches, in id order. A task
 * whose project cannot run here is left out and named, as the sampler does.
 */
export function chosenSample(glob: string, pool: readonly Task[], blocked: ReadonlyMap<string, string>): Sample {
  const parts = glob.split(",").map((x) => x.trim()).filter(Boolean);
  const literal = parts.every((x) => /^[a-z0-9][a-z0-9._-]*$/i.test(x) && !x.includes("*"));
  const byId = new Map(pool.map((t) => [t.id, t]));
  const picked = literal ? parts.map((id) => byId.get(id)).filter((t): t is Task => !!t) : selectTasks(pool, glob);
  if (!picked.length) throw new CliExit(2, `--tasks ${glob} matches no task`);
  const ordered = picked.filter((t) => !blocked.has(t.id));
  const skipped = picked.filter((t) => blocked.has(t.id)).map((t) => ({ id: t.id, category: t.category, repo: t.repo, reason: blocked.get(t.id)! }));
  return {
    ordered, cover: ordered, covered: { categories: [...new Set(ordered.map((t) => t.category))], stages: [] }, uncovered: [], skipped,
    why: Object.fromEntries(ordered.map((t) => [t.id, "named with --tasks"])),
  };
}

// ----------------------------------------------------------------------- what the comparisons run

export interface GroupPlan { id: string; title: string; group: "agents" | "models"; arms: Arm[]; tasks: Task[]; skipped: Array<{ arm: string; why: string }> }

/** The comparisons of the plan: who is in, on which tasks. Arms that cannot run here are left out with the reason. */
export function groupPlans(ctx: Ctx): GroupPlan[] {
  const out: GroupPlan[] = [];
  const scripted = ctx.mode === "scripted";
  if (ctx.groups.includes("agents")) {
    const wanted = ctx.agents ?? ctx.spec.agents;
    const rows: Contestant[] = ctx.mode === "sim" ? wanted.map((id) => ({ id, usable: true })) : scripted ? wanted.filter((a) => a === "tailzu").map((id) => ({ id, usable: true })) : contestants(wanted, contestantRows());
    const skipped = rows.filter((c) => !c.usable).map((c) => ({ arm: c.id, why: c.why ?? "cannot run here" }));
    const arms: Arm[] = scripted
      ? [{ id: "tailzu:oracle", agent: "tailzu", model: "oracle", group: "agents" }, { id: "tailzu:fake", agent: "tailzu", model: "fake", group: "agents" }]
      : rows.filter((c) => c.usable).map((c) => ({ id: `${c.id}:${ctx.agentModel}`, agent: c.id, model: ctx.agentModel, group: "agents" as const }));
    // The tasks the contestants can all take: a disruption is a scenario of Tailzu's own flow.
    const tasks = ctx.sample.ordered.filter((t) => scripted || runsOnAnyAgent(t)).slice(0, ctx.spec.compareTasks);
    if (arms.length >= 2) out.push({ id: "agents", title: `Agents on ${scripted ? "scripted models" : ctx.agentModel}`, group: "agents", arms, tasks, skipped });
    else skipped.push({ arm: "agents", why: "fewer than two agents can run here" });
    if (arms.length < 2) out.push({ id: "agents", title: "Agents", group: "agents", arms, tasks: [], skipped });
  }
  if (ctx.groups.includes("models")) {
    const k = ctx.spec.models;
    const models = ctx.models ?? bestModels(ctx.store, ctx.catalog, ctx.fx, k, ctx.poolsFile);
    const fallback = models.length ? models : candidateModels(ctx.catalog, ["code", "strong"], Math.min(k, 3));
    const arms: Arm[] = scripted
      ? [{ id: "tailzu:oracle", agent: "tailzu", model: "oracle", group: "models" }, { id: "tailzu:oracle2", agent: "tailzu", model: "oracle", group: "models" }]
      : [{ ...LADDERS_ARM }, ...fallback.map((m) => ({ id: `tailzu:${m}`, agent: "tailzu", model: m, group: "models" as const }))];
    out.push({ id: "models", title: scripted ? "Two identical scripted arms (a tie by construction)" : "Model ladders in our agent", group: "models", arms, tasks: ctx.sample.ordered.slice(0, ctx.spec.compareTasks), skipped: [] });
  }
  return out.filter((g) => g.tasks.length > 0 || g.skipped.length);
}

// ------------------------------------------------------------------------------------- estimates

/** The most a comparison can cost over its full arm x task grid (repeats of unstable results and dearer steps). */
const MAX_FACTOR = 1.7;

/**
 * The arm x task cells a comparison is expected to run once the stopping rule works: the two arms in contention run on until the answer is clear (about the first
 * round, three more rounds and a fifth of the tasks, at most all of them); every other arm is dropped after about two rounds. Of the full grid that is most of it for
 * a short list of tasks and about a quarter of it for 71.
 */
export function expectedCells(arms: number, tasks: number, minTasks: number, roundSize: number): number {
  if (arms <= 1 || tasks <= 0) return Math.max(0, arms * tasks);
  const lead = Math.min(tasks, minTasks + 3 * roundSize + Math.ceil(0.2 * tasks));
  const out = Math.min(tasks, minTasks + roundSize);
  return Math.min(arms * tasks, 2 * lead + (arms - 2) * out);
}

export function estimateStages(ctx: Ctx): StageEstimate[] {
  const out: StageEstimate[] = [];
  const { catalog, fx, store } = ctx;
  const pctx: PartCtx = { mode: "sim", fx, catalog, capInr: 0, cassetteName: "reality", cassetteMode: null, outDir: "", log: () => undefined };
  const live = ctx.mode === "real";

  out.push({ stage: 0, title: STAGE_TITLES[0], expectedInr: 0, maxInr: 0, reusedInr: 0, units: "the offline tests, 7 cassettes, 2 free part bake-offs", notes: ["no model is called"] });

  // 1. probes
  const needs = probeNeeds(catalog, ctx.poolsFile);
  const probeInr = (n: (typeof needs)[number]): number => { const p = ALL_PROBES.find((x) => x.id === n.probe)!; return inrOf(catalog, fx, n.model, p.tokens.in, p.tokens.out); };
  const missing = needs.filter((n) => !store.reusable(probeKeyNow(n.model, n.probe)));
  const reusedProbes = needs.length - missing.length;
  out.push({
    stage: 1, title: STAGE_TITLES[1], expectedInr: missing.reduce((n, x) => n + probeInr(x), 0), maxInr: missing.reduce((n, x) => n + probeInr(x), 0) * 1.5, reusedInr: needs.filter((n) => !missing.includes(n)).reduce((s, x) => s + probeInr(x), 0),
    units: `${new Set(missing.map((m) => m.model)).size} model(s) to probe (${missing.length} of ${needs.length} probes; ${reusedProbes} already answered under this code and probe version)`,
    notes: missing.length ? [`models: ${[...new Set(missing.map((m) => m.model))].slice(0, 8).join(", ")}${new Set(missing.map((m) => m.model)).size > 8 ? ", ..." : ""}`] : ["every probe of every candidate is in the store for this code and probe version"],
  });

  // 2. smoke
  const items = planItems(loadTasks().filter((t) => t.tags.includes("smoke"))).map((p) => ({ id: p.id, kind: p.kind }));
  const smokeMissing = items.filter((i) => !store.reusable(smokeKey(i.id)));
  const est2 = smokeMissing.length ? estimateSmoke(smokeMissing.map((i) => ({ id: i.id, kind: i.kind, ...SHAPE[i.kind] })), { models: ["qwen/qwen3.7-flash", "deepseek/deepseek-v4.1-flash"], catalog, fx, capInr: ctx.budgetInr }).totalInr : 0;
  const est2all = estimateSmoke(items.map((i) => ({ id: i.id, kind: i.kind, ...SHAPE[i.kind] })), { models: ["qwen/qwen3.7-flash", "deepseek/deepseek-v4.1-flash"], catalog, fx, capInr: ctx.budgetInr }).totalInr;
  const stale = staleSmokeItems(store);
  out.push({
    stage: 2, title: STAGE_TITLES[2], expectedInr: est2, maxInr: est2 * 1.5, reusedInr: est2all - est2, units: `${smokeMissing.length} of ${items.length} smoke items to run`,
    notes: [
      ...(smokeMissing.length ? [] : ["all nine items are in the store for this code: nothing to run"]),
      ...(stale.length ? [`NEEDS RE-RECORD (the recording no longer covers the code; not replayed, not faked): ${stale.map((x) => `${x.id} (${x.cassette})`).join(", ")}`] : []),
    ],
  });

  // 3. the stratified sample, our bot with the current ladders
  const t3 = ctx.sample.ordered.filter((t) => !store.reusable(taskKey(LADDERS_ARM, t)));
  const codeModel = tierTable().code.models[0] ?? "deepseek/deepseek-v4.1-flash";
  const strongModel = tierTable().strong.models[0] ?? "anthropic/claude-sonnet-5.5";
  const e3 = estimateRun(t3, { repeats: 1, catalog, fx, capInr: ctx.budgetInr, codeModel, strongModel });
  // Once real runs of this category have been paid, what they cost replaces the harness's typical size of a task.
  let calibrated = 0;
  const measured = t3.map((t) => { const m = measuredTaskInr(store, t.category); if (m !== null) calibrated += 1; return m; });
  if (calibrated) {
    const shape = (t: Task): number => estimateRun([t], { repeats: 1, catalog, fx, capInr: 0, codeModel, strongModel }).totalInr;
    e3.totalInr = t3.reduce((n, t, i) => n + (measured[i] ?? shape(t)), 0);
    e3.note = `${e3.note}; ${calibrated} of ${t3.length} priced from what earlier paid runs of the same category cost`;
  }
  const e3all = estimateRun(ctx.sample.ordered, { repeats: 1, catalog, fx, capInr: ctx.budgetInr, codeModel, strongModel });
  out.push({ stage: 3, title: STAGE_TITLES[3], expectedInr: e3.totalInr, maxInr: Math.min(e3.highInr, t3.length * 30), reusedInr: e3all.totalInr - e3.totalInr, units: `${t3.length} of ${ctx.sample.ordered.length} tasks to run (${ctx.sample.cover.length} cover every category and stage)`, notes: [e3.note, ...(ctx.sample.skipped.length ? [`${ctx.sample.skipped.length} task(s) left out: ${ctx.sample.skipped[0]!.reason}`] : [])] });

  // 4. comparisons
  let e4 = 0, m4 = 0, r4 = 0;
  const notes4: string[] = [];
  let cells4 = 0;
  for (const g of groupPlans(ctx)) {
    const model = g.group === "agents" ? ctx.agentModel : codeModel;
    const grid = estimateGrid({ agents: g.arms.map((a) => a.agent).filter((x, i, a) => a.indexOf(x) === i && !isOurs(x)), models: [model], tasks: 1, catalog, fx });
    let full = 0, reused = 0;
    for (const arm of g.arms) {
      for (const t of g.tasks) {
        const s = REAL_SHAPE[t.category] ?? REAL_SHAPE.bug!;
        const per = isOurs(arm.agent) ? inrOf(catalog, fx, arm.model === "ladders" || arm.model === "oracle" || arm.model === "fake" || arm.model.startsWith("{") ? codeModel : arm.model, s.inTokens, s.outTokens) : (grid.perAgent.find((p) => p.agent === arm.agent)?.inrPerRun[model] ?? 0) * (s.inTokens / REAL_SHAPE.bug!.inTokens);
        cells4 += 1;
        if (store.reusable(taskKey(arm, t))) reused += per; else full += per;
      }
    }
    const fraction = Math.min(1, expectedCells(g.arms.length, g.tasks.length, ctx.spec.minTasks, ctx.spec.roundSize) / Math.max(1, g.arms.length * g.tasks.length));
    e4 += full * fraction; m4 += full * MAX_FACTOR; r4 += reused;
    notes4.push(`${g.title}: ${g.arms.length} arm(s) [${g.arms.map((a) => a.id.replace(/^tailzu:/, "ours:")).join(", ")}] x ${g.tasks.length} task(s)`);
    for (const s of g.skipped) notes4.push(`  left out: ${s.arm} (${s.why})`);
  }
  out.push({ stage: 4, title: STAGE_TITLES[4], expectedInr: e4, maxInr: m4, reusedInr: r4, units: `${cells4} arm x task cells, stopping early`, notes: notes4.length ? notes4 : ["no comparison can run here"] });

  // 5. parts with the money left
  const mid = loadPools(ctx.poolsFile).tiers.code[0]!;
  const editModels = candidateModels(catalog, ["code", "strong"], 8).filter((m) => !store.reusable({ kind: "part", agent: "-", model: m, item: "editFormats", code: codeFingerprint("part:editFormats"), prompt: probeVersionNow() }));
  const e5a = editModels.length ? editFormatsEstimate(pctx, editModels).inr : 0;
  const st = strategyTasks(4);
  const strategyBlocked = st.filter((t) => ctx.blocked.has(t.id));
  const e5b = !strategyBlocked.length && st.length ? contextStrategyEstimate(pctx, mid, st).inr : 0;
  const smokeTasks = loadTasks().filter((t) => t.tags.includes("smoke") && ["bug", "feature"].includes(t.category) && !t.tags.includes("hostile")).length;
  const routerDone = routerAnswered(store);
  const e5c = routerDone ? 0 : routerEstimate(pctx, mid, smokeTasks).inr;
  const partsNotes = [
    editModels.length ? `edit formats for ${editModels.length} model(s) with no result: ${editModels.slice(0, 4).join(", ")}${editModels.length > 4 ? ", ..." : ""} (about ₹${e5a.toFixed(2)})` : "edit formats: every candidate has a result for this model door",
    strategyBlocked.length ? `context strategy: ${NEEDS_MSG} (${[...new Set(strategyBlocked.map((t) => t.repo))].join(", ")} not installed here)` : `context strategy on ${st.length} task(s): about ₹${e5b.toFixed(2)}`,
    routerDone ? "router: a result for this code is in the store (replayed from its cassette)" : `router: about ₹${e5c.toFixed(2)}`,
  ];
  out.push({ stage: 5, title: STAGE_TITLES[5], expectedInr: e5a + e5b + e5c, maxInr: (e5a + e5b + e5c) * 1.5, reusedInr: 0, units: `${[editModels.length ? "edit formats" : "", e5b ? "context strategy" : "", e5c ? "router" : ""].filter(Boolean).join(", ") || "nothing missing"}`, notes: partsNotes });
  void live;
  return out.filter((e) => ctx.stages.includes(e.stage));
}

const NEEDS_MSG = "needs a session where installs are allowed";

export const probeVersionNow = (): string => probeVersion();

/** What a task of this category cost on average, in rupees, in earlier PAID runs of the product's ladders; null when fewer than two were paid. */
export function measuredTaskInr(store: ResultsStore, category: string): number | null {
  const rs = store.list((r) => r.kind === "task" && r.agent === "tailzu" && r.source === "real" && r.model === "ladders" && r.category === category && r.costInr > 0);
  return rs.length >= 2 ? rs.reduce((n, r) => n + r.costInr, 0) / rs.length : null;
}

/** Whether the router part is answered for this code: both arms on the front-door batch and the two smoke tasks (six items), none of them stale. */
export function routerAnswered(store: ResultsStore): boolean {
  return store.latest((r) => r.kind === "part" && r.item.startsWith("router/") && r.code === codeFingerprint("part:router")).length >= 6;
}

/** The smoke items whose latest replay missed: the code now asks what the recording never answered, so only a paid run can say what they do. */
export function staleSmokeItems(store: ResultsStore): Array<{ id: string; cassette: string }> {
  const out = new Map<string, string>();
  for (const r of store.latest((x) => x.kind === "replay" && x.item.startsWith("smoke/") && x.code === codeFingerprint("task"))) {
    const id = r.item.split("/")[2]!;
    if ((r.data as { box?: string } | undefined)?.box === "stale" && !store.reusable(smokeKey(id))) out.set(id, r.model);
  }
  return [...out].map(([id, cassette]) => ({ id, cassette }));
}

export interface Totals { expectedInr: number; maxInr: number; reusedInr: number }
export const totalsOf = (es: readonly StageEstimate[]): Totals => ({ expectedInr: es.reduce((n, e) => n + e.expectedInr, 0), maxInr: es.reduce((n, e) => n + e.maxInr, 0), reusedInr: es.reduce((n, e) => n + e.reusedInr, 0) });

export function renderEstimate(ctx: Ctx, es: readonly StageEstimate[]): string {
  const t = totalsOf(es);
  const L: string[] = [];
  L.push(`REALITY PLAN ${ctx.plan.toUpperCase()}   mode ${ctx.mode}   prices: ${ctx.priceSource === "live" ? "OpenRouter's catalog, fetched now" : ctx.priceSource === "cache" ? `the saved copy of ${new Date(ctx.catalog.fetchedAt).toISOString().slice(0, 16)} (the network did not answer)` : "ASSUMED (the catalog could not be read)"}   ₹${ctx.fx} to the dollar`);
  L.push(`${"stage".padEnd(58)} ${"expected".padStart(10)} ${"at most".padStart(10)} ${"already paid".padStart(13)}`);
  for (const e of es) {
    L.push(`${`${e.stage}. ${e.title}`.slice(0, 58).padEnd(58)} ${`₹${e.expectedInr.toFixed(2)}`.padStart(10)} ${`₹${e.maxInr.toFixed(2)}`.padStart(10)} ${(e.reusedInr > 0 ? `₹${e.reusedInr.toFixed(2)}` : "-").padStart(13)}`);
    L.push(`     ${e.units}`);
    for (const n of e.notes) L.push(`     - ${n}`);
  }
  L.push(`${"PLAN".padEnd(58)} ${`₹${t.expectedInr.toFixed(2)}`.padStart(10)} ${`₹${t.maxInr.toFixed(2)}`.padStart(10)} ${(t.reusedInr > 0 ? `₹${t.reusedInr.toFixed(2)}` : "-").padStart(13)}`);
  L.push(`"expected" counts the early stops working; "at most" is what it costs if nothing stops early; "already paid" is work the results store answers (never paid twice). A stage that spends more than 30% over its expected figure is stopped.`);
  if (ctx.budgetInr > 0) L.push(`budget ₹${ctx.budgetInr}: ${t.maxInr <= ctx.budgetInr ? "covers the plan's maximum" : t.expectedInr <= ctx.budgetInr ? `covers the expected cost; the maximum (₹${t.maxInr.toFixed(2)}) is held back by the stage caps and the early stops` : `is LESS than the expected cost (₹${t.expectedInr.toFixed(2)}): the later stages will be cut short`}`);
  return L.join("\n");
}

// ----------------------------------------------------------------------------------- the receipt

const RECEIPT = (plan: string): string => path.join(OUT_DIR, "reality", `estimate-${plan}.json`);
export const RECEIPT_HOURS = 24;

export function writeReceipt(ctx: Ctx, es: readonly StageEstimate[]): void {
  mkdirp(path.dirname(RECEIPT(ctx.plan)));
  writeJson(RECEIPT(ctx.plan), { plan: ctx.plan, at: new Date().toISOString(), mode: ctx.mode, prices: ctx.priceSource, totals: totalsOf(es), stages: es.map((e) => ({ stage: e.stage, expectedInr: e.expectedInr, maxInr: e.maxInr })) });
}

/** A paid run needs the estimate to have been made, for the same plan, in the last day. */
export function requireReceipt(ctx: Ctx, now = Date.now()): void {
  const r = (() => { try { return readJson<{ plan: string; at: string }>(RECEIPT(ctx.plan)); } catch { return null; } })();
  const fresh = r && r.plan === ctx.plan && now - Date.parse(r.at) < RECEIPT_HOURS * 3600_000;
  if (!fresh) throw new CliExit(2, `a paid run needs its estimate first: run\n  npm run reality -- --plan ${ctx.plan} --estimate\nand look at what it says (the receipt is kept for ${RECEIPT_HOURS} hours and is for one plan).`);
}

// --------------------------------------------------------------------------------- the stage guard

export class StageBudget {
  spentInr = 0;
  /** Set when the stage was stopped for spending too much. */
  overrun: StageOverrun | null = null;
  constructor(readonly stage: StageId, readonly estimateInr: number, readonly capInr: number, readonly enforce: boolean, readonly factor = 1.3, readonly floorInr = 0.1) {}

  leftInr(): number { return this.enforce ? Math.max(0, this.capInr - this.spentInr) : Number.POSITIVE_INFINITY; }

  /** The most the stage may spend before it is stopped: 130% of its estimate (and the estimate plus a few paise), never past its cap. */
  get limitInr(): number { return Math.max(this.estimateInr * this.factor, this.estimateInr + this.floorInr); }

  charge(inr: number, _what = ""): void {
    this.spentInr += inr;
    if (this.enforce && this.spentInr > this.limitInr) {
      this.overrun = new StageOverrun(this.stage, this.spentInr, this.estimateInr);
      throw this.overrun;
    }
  }
}
