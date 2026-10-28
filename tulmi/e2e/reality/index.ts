/**
 * THE REALITY PLAN, FROM THE COMMAND LINE:   npm run reality -- --budget-inr N [--plan quick|standard|deep] [--estimate]
 *
 * One command that runs the end-to-end tests and comparisons (our bot against open-source agents, models against models, parts against parts) with real
 * performance measures, and learns the most for the least spend: an adaptive, staged plan that stops spending as soon as the answers are clear (stages.ts).
 *
 *   --estimate         print the per-stage rupee estimate from the live prices and the plan's maximum, and stop. MANDATORY before spending: a paid run refuses to start
 *                      without an estimate made for its plan in the last day.
 *   --stages 0,1,4     only these stages (0 free, 1 probes, 2 smoke, 3 sample, 4 comparisons, 5 parts)
 *   --mode             real (default; needs the key and --budget-inr), replay (cassettes only), scripted (Tailzu's real flow on scripted models), sim (drawn outcomes)
 *   --prove            no key: stage 0 for real, the rest from cassettes, the stopping rule on a simulated clear winner and a simulated tie, and a scripted run of the real flow
 *   --commands         print the commands for a session where installs are allowed, and stop
 *
 * The results store (e2e/results/*.jsonl) is read first and written as work finishes: nothing that is in it for the current code is paid for again.
 * Every flag is checked; an unknown one is an error and nothing runs.
 */
import "../env.js";
import { realKey } from "../env.js";
import path from "node:path";
import { CliExit, parseCli, requireBudget, runCli, type CliSpec } from "../cli.js";
import { OUT_DIR, mkdirp, writeJson } from "../util.js";
import { RealExecutor, type Executor } from "./exec.js";
import { buildCtx, estimateStages, fxRate, PLAN_SPECS, renderEstimate, requireReceipt, totalsOf, writeReceipt, type Ctx, type RealityOptions } from "./plan.js";
import { commandList, missingRepos, missingTools } from "./installs.js";
import { writeReport, type PlanEstimate } from "./report.js";
import { SimExecutor, type SimScenario } from "./sim.js";
import { newState, replaySweep, runStages, type RunState } from "./stages.js";
import { codeFingerprint } from "./fingerprint.js";
import type { Mode, PlanName, StageId } from "./types.js";

export const REALITY_SPEC: CliSpec = {
  name: "npm run reality --",
  about: "the reality plan: staged, adaptive end-to-end tests and comparisons that stop spending as soon as the answers are clear",
  positionals: false,
  flags: {
    plan: { kind: "string", value: "quick|standard|deep", about: "how much to learn: about 12, about 24 or all 65 tasks (default quick)" },
    "budget-inr": { kind: "number", value: "N", about: "REQUIRED for a paid run: the hard cap in rupees for the whole plan (no default)" },
    estimate: { kind: "bool", about: "print the per-stage estimate from the live prices and the plan's maximum, and stop (mandatory before a paid run)" },
    "all-plans": { kind: "bool", about: "with --estimate: the three plans side by side" },
    stages: { kind: "list", value: "0,1,4", about: "only these stages (default 0,1,2,3,4,5)" },
    groups: { kind: "list", value: "agents,models", about: "the comparisons of stage 4 (default both)" },
    agents: { kind: "list", value: "tailzu,aider", about: "the contestants of the agents comparison (default by plan)" },
    models: { kind: "list", value: "a,b", about: "the models of the models comparison (default: the best of the probe scoreboard)" },
    "agent-model": { kind: "string", value: "<slug>", about: "the one model every contestant uses (default: the first code-tier candidate)" },
    mode: { kind: "string", value: "real|replay|scripted|sim", about: "real (default), cassettes only, the real flow on scripted models, or drawn outcomes" },
    sim: { kind: "string", value: "clear|tie|mixed", about: "with --mode sim: the truth the draws come from (default clear)" },
    persona: { kind: "string", value: "oracle|fake", about: "with --mode scripted: right answers or known wrong ones (default oracle)" },
    "task-limit": { kind: "number", about: "cap the sample and the comparisons at N tasks (a quick look)" },
    seed: { kind: "number", about: "the seed of the draws and the bootstrap (default 1)" },
    confidence: { kind: "number", about: "P(best) needed to stop a comparison (default 0.9)" },
    install: { kind: "bool", about: "try to install the projects the tasks need (otherwise those tasks are skipped: needs a session where installs are allowed)" },
    "no-suite": { kind: "bool", about: "stage 0: do not run the offline tests" },
    "no-typecheck": { kind: "bool", about: "stage 0: do not run tsc" },
    "no-free-parts": { kind: "bool", about: "stage 0: do not run the free part bake-offs" },
    judge: { kind: "bool", about: "judge rubric criteria with a real model (a little dearer) instead of the keyword stub that never decides" },
    prove: { kind: "bool", about: "no key: stage 0 for real, the rest from cassettes and simulations; writes e2e/REALITY.md" },
    summary: { kind: "bool", about: "write the committed summary e2e/REALITY.md from this run" },
    commands: { kind: "bool", about: "print the commands for a session where installs are allowed, and stop" },
    "results-dir": { kind: "string", value: "<dir>", about: "the results store (default e2e/results)" },
    out: { kind: "string", value: "<dir>", about: "where this run's report is written (default e2e/out/reality/<time>)" },
  },
  examples: ["npm run reality -- --plan quick --estimate", "npm run reality -- --plan quick --budget-inr 60", "npm run reality -- --stages 0", "npm run reality -- --prove", "npm run reality -- --plan standard --stages 4 --groups agents --install --budget-inr 150"],
  notes: ["Stage 0 is free and always first. A paid run (mode real, any of stages 1 to 5) needs --budget-inr and an estimate made for its plan in the last 24 hours.", "Exit: 0 done, 2 a mistake in the command, 4 a stage was aborted (30% over its estimate)."],
};

const ALL_STAGES: StageId[] = [0, 1, 2, 3, 4, 5];

function executorFor(ctx: Ctx, capInr: number): Executor {
  if (ctx.mode === "sim") return new SimExecutor({ scenario: ctx.sim, seed: ctx.seed, fx: ctx.fx, catalog: ctx.catalog, outDir: ctx.outDir, log: ctx.log });
  return new RealExecutor({ mode: ctx.mode, fx: ctx.fx, catalog: ctx.catalog, outDir: ctx.outDir, capInr, log: ctx.log, persona: ctx.persona, judge: ctx.judge, skipSuite: false });
}

async function planEstimates(base: RealityOptions): Promise<PlanEstimate[]> {
  const out: PlanEstimate[] = [];
  for (const plan of ["quick", "standard", "deep"] as PlanName[]) {
    const c = await buildCtx({ ...base, plan, stages: ALL_STAGES, estimateOnly: true, mode: "real", log: () => undefined });
    out.push({ plan, tasks: c.sample.ordered.length, stages: estimateStages(c) });
  }
  return out;
}

export interface Parsed { opts: RealityOptions; estimateOnly: boolean; allPlans: boolean; prove: boolean; summary: boolean; commands: boolean }

export function optionsFrom(argv: readonly string[]): Parsed {
  const p = parseCli(REALITY_SPEC, argv);
  const plan = (p.str("plan") ?? "quick") as PlanName;
  if (!(plan in PLAN_SPECS)) throw new CliExit(2, `--plan is quick, standard or deep, not ${plan}`);
  const mode = (p.str("mode") ?? "real") as Mode;
  if (!["real", "replay", "scripted", "sim"].includes(mode)) throw new CliExit(2, "--mode is real, replay, scripted or sim");
  const sim = (p.str("sim") ?? "clear") as SimScenario;
  if (!["clear", "tie", "mixed"].includes(sim)) throw new CliExit(2, "--sim is clear, tie or mixed");
  const persona = (p.str("persona") ?? "oracle") as "oracle" | "fake";
  if (!["oracle", "fake"].includes(persona)) throw new CliExit(2, "--persona is oracle or fake");
  const stages = (p.has("stages") ? p.list("stages") : ALL_STAGES.map(String)).map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new CliExit(2, `--stages takes numbers from 0 to 5, not "${s}"`);
    return n as StageId;
  });
  const groups = (p.has("groups") ? p.list("groups") : ["agents", "models"]).map((g) => {
    if (g !== "agents" && g !== "models") throw new CliExit(2, `--groups is agents and/or models, not "${g}"`);
    return g;
  });
  const confidence = p.num("confidence") ?? 0.9;
  if (!(confidence > 0.5 && confidence < 1)) throw new CliExit(2, "--confidence is between 0.5 and 1");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const outDir = path.resolve(p.str("out") ?? path.join(OUT_DIR, "reality", `${stamp}-${mode}`));
  const opts: RealityOptions = {
    plan, budgetInr: p.num("budget-inr") ?? 0, mode, estimateOnly: p.has("estimate"), stages: [...new Set(stages)].sort(), groups, ...(p.has("agents") ? { agents: p.list("agents") } : {}), ...(p.has("models") ? { models: p.list("models") } : {}),
    ...(p.str("agent-model") ? { agentModel: p.str("agent-model")! } : {}), ...(p.num("task-limit") !== undefined ? { taskLimit: p.num("task-limit")! } : {}), ...(p.str("results-dir") ? { resultsDir: path.resolve(p.str("results-dir")!) } : {}), outDir, seed: p.num("seed") ?? 1, confidence,
    install: p.has("install"), skipSuite: p.has("no-suite"), skipTypecheck: p.has("no-typecheck"), freeParts: !p.has("no-free-parts"), judge: p.has("judge"), sim, persona, log: (s) => console.log(s),
  };
  return { opts, estimateOnly: p.has("estimate"), allPlans: p.has("all-plans"), prove: p.has("prove"), summary: p.has("summary"), commands: p.has("commands") };
}

/** Narrows a plan to a few tasks for a quick look or a proof. */
function limited(ctx: Ctx, n: number | undefined): Ctx {
  if (!n) return ctx;
  const ordered = ctx.sample.ordered.slice(0, n);
  return { ...ctx, sample: { ...ctx.sample, ordered }, spec: { ...ctx.spec, compareTasks: Math.min(ctx.spec.compareTasks, n), tasks: n } };
}

export async function runReality(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = optionsFrom(argv);
  const { opts } = parsed;
  const taskLimit = opts.taskLimit;

  if (parsed.commands) {
    const c = await buildCtx({ ...opts, estimateOnly: true, mode: "real", log: () => undefined });
    const es = estimateStages({ ...c, stages: ALL_STAGES });
    console.log(commandList({ plan: opts.plan, budgetInr: Math.ceil(totalsOf(es).maxInr), missingRepos: missingRepos(), missingTools: missingTools(), estimateByStage: Object.fromEntries(es.map((e) => [e.stage, e.expectedInr])) }).join("\n"));
    return 0;
  }

  if (parsed.estimateOnly) {
    const plans: PlanName[] = parsed.allPlans ? ["quick", "standard", "deep"] : [opts.plan];
    for (const plan of plans) {
      const ctx = limited(await buildCtx({ ...opts, plan }), taskLimit);
      // What the recordings already answer is part of the estimate, and replaying them costs nothing: do it first, once per code state.
      if (!ctx.store.latest((r) => r.kind === "replay" && r.code === codeFingerprint("task")).length && ctx.mode === "real") {
        console.log("(first, every recorded cassette is replayed for ₹0, so that the estimate knows what is already paid)");
        await replaySweep(newState(ctx, null as unknown as Executor));
        const again = limited(await buildCtx({ ...opts, plan }), taskLimit);
        Object.assign(ctx, { store: again.store, sample: again.sample });
      }
      const es = estimateStages(ctx);
      console.log(`${renderEstimate(ctx, es)}\n`);
      writeReceipt(ctx, estimateStages({ ...ctx, stages: ALL_STAGES }));
    }
    console.log("the estimate is kept: a paid run for this plan may now start (npm run reality -- --plan <p> --budget-inr N)");
    return 0;
  }

  if (parsed.prove) return prove(parsed);

  const spends = opts.mode === "real" && opts.stages.some((s) => s >= 1);
  // The cap and the estimate before the key: a forgotten --budget-inr or a skipped estimate stops the run whether or not a key is set.
  const cap = requireBudget(parseCli(REALITY_SPEC, argv), spends, "a paid reality run");
  const ctx = limited(await buildCtx(opts), taskLimit);
  const estimates = estimateStages(ctx);
  if (spends) {
    requireReceipt(ctx);
    if (!realKey) { console.error("OPENROUTER_API_KEY is not set, so a paid run cannot start. Stage 0 is free: npm run reality -- --stages 0. To prove the plan without a key: --prove."); return 2; }
  }
  console.log(`${renderEstimate(ctx, estimates)}\n`);
  mkdirp(ctx.outDir);
  const exec = executorFor(ctx, cap);
  const st = newState(ctx, exec);
  try { await runStages(st); } finally { await exec.close(); }
  st.spentInr = opts.mode === "real" ? exec.spentInr() : st.spentInr;
  return finish(st, estimates, [], parsed.summary);
}

async function finish(st: RunState, estimates: ReturnType<typeof estimateStages>, demos: Array<{ title: string; state: RunState }>, summary: boolean, prove = false): Promise<number> {
  const plans = await planEstimates({ ...st.ctx, estimateOnly: true, catalog: st.ctx.catalog });
  writeJson(path.join(st.ctx.outDir, "reality.json"), {
    runId: st.runId, startedAt: st.startedAt, finishedAt: st.finishedAt, plan: st.ctx.plan, mode: st.ctx.mode, budgetInr: st.ctx.budgetInr, spentInr: st.spentInr, stages: st.stages, comparisons: st.comparisons,
    replays: st.replays.map((r) => ({ cassette: r.cassette, kind: r.kind, hits: r.hits, misses: r.misses, boxes: r.boxes, documented: r.documented })), aborted: st.aborted,
  });
  // The commands and the "cheapest next run" table must agree with the plan table: all three come from the store as it is NOW (this run's replays already count),
  // not from the start of the run.
  const fresh = plans.find((p) => p.plan === st.ctx.plan)?.stages;
  const out = writeReport({ main: st, prove, demos, plans, estimates: fresh ?? (estimates.length ? estimates : estimateStages({ ...st.ctx, stages: ALL_STAGES })) }, { summary });
  console.log(`\nreality run ${st.runId}: ${st.stages.map((s) => `${s.stage}:${s.status}`).join(" ")}; spent ${st.ctx.mode === "real" ? `₹${st.spentInr.toFixed(2)}` : "nothing (no model was paid)"}`);
  for (const c of st.comparisons) console.log(`  ${c.title}: ${c.ended}${c.winner ? ` -> ${c.winner}` : ""} (${c.final.reason})`);
  console.log(`report: ${path.relative(process.cwd(), out.latest)}${out.md ? `\nsummary: ${path.relative(process.cwd(), out.md)}` : ""}`);
  return st.aborted.length ? 4 : 0;
}

/** The proof with no key: stage 0 for real; stages 1 to 5 from the cassettes; the stopping rule on a simulated clear winner and a simulated tie; the real flow on scripted models. */
async function prove(parsed: Parsed): Promise<number> {
  const { opts } = parsed;
  const base = { ...opts, estimateOnly: false, log: opts.log };
  const taskLimit = opts.taskLimit;
  // 1. replay mode: the whole plan against the cassettes. Stage 0 is real; the rest says honestly what has no recording.
  const mainCtx = limited(await buildCtx({ ...base, mode: "replay", stages: ALL_STAGES, outDir: path.join(opts.outDir, "replay") }), taskLimit);
  const estimates = estimateStages({ ...mainCtx, stages: ALL_STAGES });
  console.log(`${renderEstimate(mainCtx, estimates)}\n`);
  mkdirp(mainCtx.outDir);
  const mainExec = executorFor(mainCtx, 0);
  const main = newState(mainCtx, mainExec);
  await runStages(main);
  await mainExec.close();
  // 2. the stopping rule on simulated contestants: a clear winner, a tie.
  const demos: Array<{ title: string; state: RunState }> = [];
  for (const scenario of ["clear", "tie"] as SimScenario[]) {
    const ctx = limited(await buildCtx({ ...base, mode: "sim", sim: scenario, stages: [3, 4], outDir: path.join(opts.outDir, `sim-${scenario}`), plan: "deep", seed: 1, ...(opts.agents ? {} : { agents: ["tailzu", "aider", "opencode", "codex", "openhands", "mini-swe-agent"] }) }), taskLimit);
    console.log(`\n--- simulated ${scenario} ---`);
    mkdirp(ctx.outDir);
    const ex = executorFor(ctx, 0);
    const state = newState(ctx, ex);
    await runStages(state);
    demos.push({ title: scenario === "clear" ? "A simulated clear winner (ours is truly 92%, the rest 20 to 46%)" : "A simulated tie (every arm is truly 55%)", state });
  }
  // 3. the real flow on scripted models (free): stage 3 (our bot) and stage 4 (a right arm against a wrong one, then two identical arms).
  const scripted = limited(await buildCtx({ ...base, mode: "scripted", stages: [3, 4], outDir: path.join(opts.outDir, "scripted"), plan: "quick", persona: "oracle", skipSuite: true }), taskLimit ?? 6);
  console.log("\n--- scripted: Tailzu's real flow on the harness's scripted models ---");
  mkdirp(scripted.outDir);
  const sx = executorFor(scripted, 0);
  const sState = newState(scripted, sx);
  try { await runStages(sState); } finally { await sx.close(); }
  demos.push({ title: `Tailzu's real flow, scripted: a right arm against a wrong one (agents), then two identical right arms (models); ${scripted.sample.ordered.length} task(s)`, state: sState });
  return finish(main, estimates, demos, true, true);
}

if (process.argv[1] && /e2e\/reality\/index\.[tj]s$/.test(process.argv[1])) {
  runCli(() => runReality()).then((c) => process.exit(c), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}

void fxRate;
