/**
 * THE MODEL BAKE-OFF: `npm run bakeoff -- --tiers tiny,cheap,code,strong,vision --budget-inr X`.
 *
 * Candidates per tier (pools.json) are filtered by what OpenRouter's catalog says they can do, then run in ROUNDS, easiest first: six tiny probes (add
 * `--edit-format` for the edit-format probe), then the role evals (evals/*.jsonl), then, for the code and strong tiers, a 15-turn tool task, a needle in a large real
 * codebase and a few real tasks through the whole flow. A candidate is dropped as soon as it is clearly worse than the leader at no lower cost per pass
 * (stats.ts documents the rule; `--no-early` turns it off), so only survivors reach the dear rounds. The result is a scoreboard, ladders per tier ordered by
 * cost per pass above a quality floor, and a ready CODE_MODEL_TIERS value.
 *
 *   --probes-only      only round 1 (and the edit-format probe): a few cents in all
 *   --dry              the plan and the estimated cost in rupees, nothing called (with --edit-format the edit-format probe is in it; without, the extra it would cost is named)
 *   --estimate         the same as --dry (the word the smoke suite and `e2e/run.ts` use); also for --parts and --grid: what they would cost, from the live prices, and stop
 *   --model sim        simulated models (no key, no cost): proves the machinery, measures nothing
 *   --record|--replay|--mixed --cassette <name>      every model call recorded to e2e/cassettes, or replayed for nothing
 *   --grid --models a,b --agents x,y --tasks <glob>  every (model, agent) pair on the same tasks: see grid.ts
 *   --parts [--prove] [--spend --budget-inr X] [--only a,b]   the part bake-offs: page extraction and locate for free, now; edit formats, context strategy and
 *                      router wired (their estimates, and with --prove their machinery on scripted models, with --spend the real thing); see parts.ts
 *   --fetch-pages      fetch the page corpus the extraction bake-off needs, once (e2e/cache/pages)
 *
 * A hard cap (`--budget-inr`, 100 by default for a real run) stops the run cleanly; what has been measured is written.
 */
import "../env.js";
import { realKey } from "../env.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CassetteStore, SpendGuard, type CassetteMode } from "../adapters/cassette.js";
import { loadCatalog } from "../catalog.js";
import { tailzuAgent } from "../agents/tailzu.js";
import { cloneDirOf, getRepo, isCloned } from "../repos.js";
import { renderScoreboardHtml, renderScoreboardText, type BakeoffRun } from "../report/bakeoff.js";
import { runOne } from "../runOne.js";
import { loadTasks } from "../tasks/schema.js";
import { OUT_DIR, mkdirp, writeJson } from "../util.js";
import { SHAPE } from "../smoke/estimate.js";
import { filterPools } from "./capability.js";
import { Engine, summarize } from "./engine.js";
import { buildLadders, DEFAULT_LADDER } from "./ladders.js";
import { planBakeoff, renderPlan } from "./plan.js";
import { BAKEOFF_TIERS, loadPools, type BakeoffTier } from "./pools.js";
import { simPass } from "./sim.js";
import { buildTierTable, type ModelTier } from "../../src/code/brain/tiers.js";

export interface BakeoffOptions {
  mode: "real" | "sim";
  tiers: BakeoffTier[];
  capInr: number;
  probesOnly: boolean;
  dry: boolean;
  editFormat: boolean;
  early: boolean;
  keep: number;
  wave: number;
  evalRuns: number;
  taskCount: number;
  floor: number;
  needleKb: number;
  cassetteMode: CassetteMode | null;
  cassetteName: string;
  loose: boolean;
  poolsFile?: string;
  outDir?: string;
  log: (s: string) => void;
}

/** The text of a large real codebase (express's lib and tests, at the pin) for the needle probe. */
export function needleTextFromRepo(chars: number): string | undefined {
  try {
    const r = getRepo("express");
    if (!isCloned(r)) return undefined;
    const dir = cloneDirOf(r);
    const names = execFileSync("git", ["ls-tree", "-r", "--name-only", r.pin, "lib", "test"], { cwd: dir, encoding: "utf8" }).split("\n").filter((n) => /\.js$/.test(n));
    let out = "";
    for (const n of names) {
      if (out.length >= chars) break;
      out += `// ===== ${n}\n${execFileSync("git", ["show", `${r.pin}:${n}`], { cwd: dir, encoding: "utf8", maxBuffer: 20_000_000 })}\n`;
    }
    return out.slice(0, chars);
  } catch { return undefined; }
}

/** A tier table where only the evaluated tier is the candidate: the rest of the flow keeps the product's own ladders. */
function tierOnly(tier: BakeoffTier, slug: string, info?: { inUsdPerM: number; outUsdPerM: number }): Record<ModelTier, import("../../src/code/brain/tiers.js").TierSettings> {
  return buildTierTable({ tiers: JSON.stringify({ [tier]: { models: [slug], ...(info ? { usdPerMIn: info.inUsdPerM, usdPerMOut: info.outUsdPerM } : {}) } }) });
}

export async function runBakeoff(o: BakeoffOptions): Promise<BakeoffRun | { plan: string }> {
  const startedAt = new Date().toISOString();
  const fx = Number(process.env.CODE_USD_INR) || 88;
  const pools = loadPools(o.poolsFile);
  const catalog = await loadCatalog({ offline: o.mode === "sim" || o.cassetteMode === "replay" });
  if (catalog.source === "none") o.log("note: OpenRouter's catalog could not be read and no copy is saved, so capabilities and prices are unknown; every candidate is left out");
  else o.log(`catalog: ${catalog.models.size} models (${catalog.source}${catalog.source === "cache" ? `, saved ${new Date(catalog.fetchedAt).toISOString().slice(0, 16)}` : ""})`);
  const filtered = filterPools(pools, catalog);
  const plan = planBakeoff(filtered, { fx, tiers: o.tiers, evalRuns: o.evalRuns, taskCount: o.taskCount, editFormat: o.editFormat, probesOnly: o.probesOnly, needleTokens: Math.round((o.needleKb * 1000) / 4) });
  const planText = renderPlan(plan);
  o.log(planText);
  if (o.dry) return { plan: planText };

  const stamp = startedAt.replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const outDir = path.resolve(o.outDir ?? path.join(OUT_DIR, "bakeoff", `${stamp}-${o.mode}`));
  mkdirp(outDir);
  const spends = o.mode === "real" && o.cassetteMode !== "replay";
  const guard = spends ? new SpendGuard(o.capInr / fx) : undefined;
  let cassette: { store: CassetteStore; mode: CassetteMode; loose?: boolean } | undefined;
  if (o.cassetteMode || spends) {
    const store = o.cassetteMode ? new CassetteStore(o.cassetteName) : new CassetteStore("scratch", outDir);
    const mode: CassetteMode = o.cassetteMode ?? "record";
    if (mode === "record") store.reset(); else store.load();
    if (mode === "replay" && !store.count) throw new Error(`the cassette ${store.file} is empty or missing: record it first with --record`);
    cassette = { store, mode, ...(o.loose ? { loose: true } : {}) };
  }
  const needleChars = o.needleKb * 1000;
  const needleText = o.mode === "sim" ? "function retry() {}\n".repeat(400) : needleTextFromRepo(needleChars);
  const engine = new Engine({
    mode: o.mode, catalog, fx, ...(guard ? { guard } : {}), ...(cassette ? { cassette } : {}), early: o.early, keep: o.keep, wave: o.wave, evalRuns: o.evalRuns, editFormat: o.editFormat,
    needleChars, ...(needleText ? { needleText } : {}), log: o.log,
  });

  // The real tasks, easiest first: the subset a code or strong candidate is run through the whole flow on.
  const bakeTasks = loadTasks().filter((t) => t.tags.includes("bakeoff") && ["bug", "feature", "refactor"].includes(t.category) && !t.tags.includes("smoke") && t.validated?.oraclePasses);
  const tasksFor = (tier: BakeoffTier) => [...bakeTasks].sort((a, b) => (tier === "strong" ? b.difficulty - a.difficulty : a.difficulty - b.difficulty) || (a.id < b.id ? -1 : 1)).slice(0, o.taskCount);

  const order: BakeoffTier[] = (["tiny", "vision", "cheap", "code", "strong"] as BakeoffTier[]).filter((t) => o.tiers.includes(t));
  let aborted: string | undefined;
  for (const tier of order) {
    const cands = filtered.candidates[tier];
    if (!cands.length) { o.log(`${tier}: no candidates after the capability filter`); continue; }
    for (const c of cands) engine.add(c);
    o.log(`\n== ${tier}: ${cands.length} candidate(s)`);
    await engine.probeRound(tier);
    if (!o.probesOnly && !guard?.exhausted) {
      if (tier === "code" || tier === "strong") await engine.probeRound(tier, { heavy: true });
      await engine.evalRound(tier);
      if ((tier === "code" || tier === "strong") && !guard?.exhausted) {
        await engine.taskRound(tier, tasksFor(tier), async (task, row) => {
          const t0 = Date.now();
          if (o.mode === "sim") {
            const usd = (SHAPE.task.inTokens * row.info.inUsdPerM + SHAPE.task.outTokens * row.info.outUsdPerM) / 1e6;
            return { success: simPass(row.slug, "task", task.id), costUsd: usd, ms: 20_000 + Math.floor(40_000 * (1 - (row.latenciesMs.length % 5) / 5)) };
          }
          const info = catalog.models.get(row.slug);
          const { result, score } = await runOne(task, tailzuAgent, {
            model: { mode: "real", tiers: tierOnly(tier, row.slug, info), ...(cassette ? { cassette: { ...cassette, ...(guard ? { guard } : {}) }, wire: true } : {}) },
            budgetPaise: 3000, timeoutSec: 900, outDir, repeat: 1, log: (s) => o.log(`    ${task.id}: ${s}`), brainBudgetPaise: 0,
          });
          return { success: score.success, costUsd: (score.metrics.costPaise + score.metrics.judgePaise) / fx / 100, ms: Date.now() - t0, failed: result.status === "error" };
        });
      }
    }
    if (guard?.exhausted) { aborted = `the spend cap of ₹${o.capInr} was reached`; break; }
  }

  const summaries = [...engine.rows.values()].map(summarize);
  const ladders = buildLadders(summaries, fx, { ...DEFAULT_LADDER, floor: o.floor });
  const run: BakeoffRun = {
    id: path.basename(outDir), startedAt, finishedAt: new Date().toISOString(), mode: o.mode, tiers: o.tiers, fx, spentInr: (guard?.spentUsd ?? 0) * fx, capInr: o.capInr, summaries, ladders,
    excluded: filtered.excluded, ...(aborted ? { aborted } : {}), args: process.argv.slice(2),
  };
  writeJson(path.join(outDir, "bakeoff.json"), run);
  writeJson(path.join(outDir, "ladders.json"), { ladders: ladders.tiers, codeModelTiers: ladders.codeModelTiers, codeIndicModel: ladders.codeIndicModel ?? null, notes: ladders.notes, mode: o.mode, at: run.finishedAt });
  fs.writeFileSync(path.join(outDir, "CODE_MODEL_TIERS.txt"), `${ladders.codeModelTiers}\n`);
  fs.writeFileSync(path.join(outDir, "report.html"), renderScoreboardHtml(run));
  mkdirp(OUT_DIR);
  writeJson(path.join(OUT_DIR, o.mode === "sim" ? "ladders.sim.json" : "ladders.json"), { ladders: ladders.tiers, codeModelTiers: ladders.codeModelTiers, codeIndicModel: ladders.codeIndicModel ?? null, notes: ladders.notes, mode: o.mode, at: run.finishedAt, from: path.basename(outDir) });
  return run;
}

// ------------------------------------------------------------------- command line

export async function runBakeoffCli(argvIn: string[] = process.argv.slice(2)): Promise<number> {
  const arg = (n: string): string | undefined => { const i = argvIn.indexOf(`--${n}`); return i >= 0 ? argvIn[i + 1] : undefined; };
  const flag = (n: string): boolean => argvIn.includes(`--${n}`);
  // One word for "say what it costs and stop" in every suite: --estimate. (For the bake-off proper it is --dry.)
  if (flag("estimate") && !flag("dry") && !flag("grid") && !flag("parts")) argvIn = [...argvIn, "--dry"];
  if (flag("grid")) { const { runGridCli } = await import("./grid.js"); return runGridCli(argvIn); }
  if (flag("parts") || flag("fetch-pages")) { const { runPartsCli } = await import("./parts.js"); return runPartsCli(argvIn); }
  const mode = (arg("model") ?? "real") as "real" | "sim";
  if (!["real", "sim"].includes(mode)) throw new Error("--model is real or sim");
  const cassetteMode: CassetteMode | null = flag("record") ? "record" : flag("replay") ? "replay" : flag("mixed") ? "mixed" : null;
  const tiers = (arg("tiers") ?? BAKEOFF_TIERS.join(",")).split(",").map((s) => s.trim()).filter(Boolean) as BakeoffTier[];
  const bad = tiers.filter((t) => !(BAKEOFF_TIERS as readonly string[]).includes(t));
  if (bad.length) throw new Error(`no such tier: ${bad.join(", ")}; the tiers are ${BAKEOFF_TIERS.join(", ")}`);
  const dry = flag("dry");
  if (mode === "real" && !dry && cassetteMode !== "replay" && !realKey) {
    console.error("OPENROUTER_API_KEY is not set, so a real bake-off cannot start.\n  - --dry prints the plan and the estimated cost without a key\n  - --model sim runs the whole machinery on simulated models\n  - --replay runs from a recording\n  - or add the key (tulmi/.env or the shell)");
    return 2;
  }
  const capInr = Number(arg("budget-inr") ?? (mode === "real" && cassetteMode !== "replay" && !dry ? 100 : 0));
  if (mode === "real" && !dry && cassetteMode !== "replay" && !(capInr > 0)) throw new Error("a real run needs --budget-inr X, a hard cap in rupees");
  const probesOnly = flag("probes-only");
  const r = await runBakeoff({
    mode, tiers, capInr: capInr || 0, probesOnly, dry, editFormat: flag("edit-format"), early: !flag("no-early"), keep: Number(arg("keep") ?? 2), wave: Number(arg("wave") ?? 8), evalRuns: Number(arg("eval-runs") ?? 1),
    taskCount: Number(arg("task-limit") ?? 6), floor: Number(arg("floor") ?? 0.7), needleKb: Number(arg("needle-kb") ?? 120), cassetteMode, cassetteName: arg("cassette") ?? "bakeoff", loose: flag("loose"),
    ...(arg("pools") ? { poolsFile: path.resolve(arg("pools")!) } : {}), ...(arg("out") ? { outDir: arg("out")! } : {}), log: (s) => { if (!dry) console.log(s); },
  });
  if ("plan" in r) { console.log(r.plan); return 0; }
  const where = arg("out") ? path.resolve(arg("out")!) : path.join(OUT_DIR, "bakeoff", r.id);
  console.log(`\n${renderScoreboardText(r)}\n\nreport: ${path.join(where, "report.html")}\nladders: ${path.join(OUT_DIR, mode === "sim" ? "ladders.sim.json" : "ladders.json")} (also ${path.join(where, "ladders.json")})`);
  return r.aborted ? 4 : 0;
}

if (process.argv[1] && /e2e\/bakeoff\/index\.[tj]s$/.test(process.argv[1])) {
  runBakeoffCli().then((c) => process.exit(c), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
