/**
 * THE SMOKE SUITE: `npm run e2e -- --suite smoke`. NINE SHORT ITEMS ACROSS THE WHOLE REAL FLOW, FOR A FEW RUPEES.
 *
 *   1 a bug fix with a hidden test      2 a feature with a hidden test       3 a code question with known answer files
 *   4 an artifact made, then one element edited                              5 a front-door batch of 12 messages (intent, visual, clarify)
 *   6 a quick research run on cached pages                                   7 a prompt injection that must not be obeyed
 *   8 a planted secret that must never be committed                          9 a picture read by the vision tier
 *
 * On two tiny fixture projects (e2e/fixtures: a Node API and a React app, a handful of files each), so the context a model reads stays tiny. Every tier uses the
 * cheapest capable model (qwen/qwen3.7-flash, then deepseek/deepseek-v4.1-flash; `--tiers default` uses the product's ladders), at most 800 tokens a call and 20
 * agent turns a task, under a hard cap (`--budget-inr`, REQUIRED for a run that calls a real model: there is no default) that stops the run cleanly. Before anything is spent an estimate is printed from the live
 * OpenRouter prices. The result is one page: pass or fail per stage, per item, with the cost.
 *
 * CASSETTES. `--record` saves every model request and answer (e2e/cassettes/<name>.jsonl.gz, `--cassette smoke` by default); `--replay` runs everything from them
 * at zero cost; `--mixed` replays what is recorded and calls the model for the rest (and adds it); a miss in a strict replay fails the run. `--changed`
 * re-runs only the items the code changed since the recording can affect (mixed), and replays the rest.
 *
 * Without a key, `--model oracle` and `--model fake` prove the suite itself: a scripted model that answers right, or wrong in a known way, through the same
 * gateway and the same cassettes.
 */
import "../env.js";
import { realKey } from "../env.js";
import { CliExit, parseCli, requireBudget, runCli, type CliSpec } from "../cli.js";
import fs from "node:fs";
import path from "node:path";
import { CassetteStore, SpendGuard, type CassetteMode } from "../adapters/cassette.js";
import type { CassetteSetup } from "../adapters/rig.js";
import type { ModelMode } from "../adapters/models.js";
import { loadCatalog, type Catalog } from "../catalog.js";
import { getRepo, installRepo, isInstalled } from "../repos.js";
import { loadTasks, type Task } from "../tasks/schema.js";
import { OUT_DIR, mkdirp, pool, rmrf, writeJson } from "../util.js";
import { affectedBy, changedFiles, hashSources, loadHashes, metaFile, saveHashes, type RunParams } from "./changed.js";
import { estimateSmoke, SHAPE, type ItemShape } from "./estimate.js";
import { artifactItem, frontItem, researchItem, taskItem, visionItem, type SmokeCtx } from "./items.js";
import { renderHtml, renderText, type SmokeRun } from "./report.js";
import { resetConfigForTests } from "../../src/config.js";
import { resetTierTableForTests } from "../../src/code/brain/tiers.js";
import { smokeTierOverrides, smokeTiers, SMOKE_FALLBACK, SMOKE_MAX_TOKENS, SMOKE_MAX_TURNS, SMOKE_PRIMARY } from "./tiers.js";
import type { ItemResult } from "./types.js";

export interface SmokeOptions {
  mode: ModelMode;
  cassetteMode: CassetteMode | null;
  cassetteName: string;
  loose: boolean;
  capInr: number;
  tiers: "smoke" | "default";
  primary: string;
  fallback: string;
  maxTurns: number;
  parallel: number;
  outDir: string;
  /** Re-run only what the code changed since the recording can affect. */
  changed: boolean;
  /** Item numbers or ids to run (all when empty). */
  only: string[];
  estimateOnly: boolean;
  log: (s: string) => void;
  /** For tests: a catalog instead of the network's. */
  catalog?: Catalog;
}

interface Planned { n: number; id: string; kind: ItemShape["kind"]; run: (ctx: SmokeCtx, i: number) => Promise<ItemResult> }

/** The nine items, in order. */
export function planItems(tasks: Task[]): Planned[] {
  const task = (id: string): Task => { const t = tasks.find((x) => x.id === id); if (!t) throw new Error(`the smoke task ${id} is not in e2e/tasks (run \`npm run e2e:author\`)`); return t; };
  const byTask = (n: number, id: string): Planned => ({ n, id, kind: "task", run: (ctx, i) => taskItem(task(id), ctx, n, i) });
  return [
    byTask(1, "smoke-api-bug-pagination"),
    byTask(2, "smoke-web-feature-clear-completed"),
    byTask(3, "smoke-api-question-ratelimit"),
    { n: 4, id: "smoke-artifact-create-edit", kind: "artifact", run: (ctx) => artifactItem(ctx, 4) },
    { n: 5, id: "smoke-front-door-batch", kind: "front", run: (ctx) => frontItem(ctx, 5) },
    { n: 6, id: "smoke-research-cached", kind: "research", run: (ctx) => researchItem(ctx, 6) },
    byTask(7, "smoke-api-hostile-note"),
    byTask(8, "smoke-api-secret-in-config"),
    { n: 9, id: "smoke-vision-read", kind: "vision", run: (ctx) => visionItem(ctx, 9) },
  ];
}

export async function runSmoke(o: SmokeOptions): Promise<SmokeRun> {
  const startedAt = new Date().toISOString();
  const fx = Number(process.env.CODE_USD_INR) || 88;
  const tasks = loadTasks().filter((t) => t.tags.includes("smoke"));
  let items = planItems(tasks);
  if (o.only.length) items = items.filter((p) => o.only.includes(String(p.n)) || o.only.includes(p.id));
  if (!items.length) throw new Error("no smoke item matches --items");

  // The fixture projects are installed once (the React app's few packages; the API has none).
  for (const id of ["smoke-api", "smoke-web"]) {
    const r = getRepo(id);
    if (!isInstalled(r)) { o.log(`installing the ${id} fixture's dependencies (once)`); await installRepo(r, { log: (s) => o.log(`  ${s}`) }); }
  }

  const spends = o.mode === "real" && o.cassetteMode !== "replay";
  const catalog = o.catalog ?? (await loadCatalog({ offline: o.mode !== "real" && !o.estimateOnly }));
  let primary = o.primary;
  let fallback = o.fallback;
  if (catalog.source !== "none" && o.tiers === "smoke") {
    if (!catalog.models.get(primary)) { o.log(`note: ${primary} is not in OpenRouter's catalog; using ${fallback} first`); [primary, fallback] = [fallback, primary]; }
    for (const slug of [primary, fallback]) if (!catalog.models.get(slug)) o.log(`warning: ${slug} is not in OpenRouter's catalog; its calls may fail`);
  }
  const tiers = o.tiers === "smoke" ? smokeTiers({ primary, fallback, maxTokens: SMOKE_MAX_TOKENS }, catalog) : undefined;
  if (o.tiers === "smoke") {
    // The product's own routing (what a step may cost, which tier it starts on) reads CODE_MODEL_TIERS: it is set to the smoke ladders so every decision agrees.
    process.env.CODE_MODEL_TIERS = JSON.stringify(smokeTierOverrides({ primary, fallback, maxTokens: SMOKE_MAX_TOKENS }, catalog));
    resetConfigForTests();
    resetTierTableForTests();
  }

  // The estimate, before a single call.
  const shapes: ItemShape[] = items.map((p) => ({ id: p.id, kind: p.kind, ...SHAPE[p.kind] }));
  const est = estimateSmoke(shapes, { models: [primary, fallback], catalog, fx, capInr: o.capInr, replay: o.cassetteMode === "replay" || o.mode !== "real" });
  o.log(`estimate: about ₹${est.totalInr.toFixed(2)} for ${items.length} item(s) on ${primary} (${est.models.map((m) => `${m.slug} $${m.inUsdPerM.toFixed(2)}/$${m.outUsdPerM.toFixed(2)} per M tokens`).join("; ")}); cap ₹${o.capInr}. ${est.note}`);
  if (o.estimateOnly) return { id: "estimate", startedAt, finishedAt: new Date().toISOString(), mode: o.mode, models: { primary, fallback, tiers: o.tiers }, capInr: o.capInr, spentInr: 0, replayedInr: 0, estimatedInr: est.totalInr, fx, items: [], misses: [] };

  const stamp = startedAt.replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const outDir = path.resolve(o.outDir || path.join(OUT_DIR, `${stamp}-smoke-${o.mode}`));
  mkdirp(outDir);

  // Cassettes. A real run with no cassette flag still goes through one (in the output folder), because that is where the hard cap is kept.
  const guard = spends ? new SpendGuard(o.capInr / fx) : undefined;
  let store: CassetteStore;
  let cmode: CassetteMode | null = o.cassetteMode;
  if (cmode) {
    store = new CassetteStore(o.cassetteName);
    if (o.changed) { if (!store.exists()) throw new Error(`--changed needs a recorded cassette (${store.file}): record one first with --record`); store.load(); }
    else if (cmode === "record") store.reset();
    else { store.load(); if (cmode === "replay" && !store.count) throw new Error(`the cassette ${store.file} is empty or missing: record it first with --record`); }
  } else {
    store = new CassetteStore("scratch", outDir);
    store.reset();
    cmode = "record";
  }
  const usingCassette = o.cassetteMode !== null || spends;
  let changed: SmokeRun["changed"];
  let affected = new Set<string>();
  if (o.changed) {
    const before = loadHashes(store.file);
    if (!before) throw new Error(`--changed needs the source checksums saved with the recording (${metaFile(store.file)}): record again with --record`);
    const a = affectedBy(changedFiles(before, hashSources()));
    affected = new Set(a.items);
    changed = { files: a.files, stages: a.stages, items: a.items };
    o.log(`--changed: ${a.files.length} changed file(s) -> stages ${a.stages.join(", ") || "none"} -> ${a.items.filter((id) => items.some((p) => p.id === id)).length} item(s) re-run, the rest replay`);
  }

  const capPaise = Math.round(o.capInr * 100);
  // A smoke task needs a few rupees at most; with the product's own ladders a job needs its default budget (the worst case of one call is already hundreds of paise).
  const taskBudgetPaise = o.tiers === "smoke" ? Math.max(60, Math.min(250, Math.floor(capPaise / 6))) : Math.max(300, Math.min(3000, capPaise));
  const judgePool = o.tiers === "smoke" ? [fallback, primary] : undefined;
  const results: ItemResult[] = [];
  let aborted: string | undefined;
  const setupFor = (id: string): CassetteSetup | undefined => {
    if (!usingCassette) return undefined;
    const mode: CassetteMode = o.changed ? (affected.has(id) ? "mixed" : "replay") : cmode!;
    return { store, mode, ...(guard ? { guard } : {}), ...(o.loose ? { loose: true } : {}) };
  };

  await pool(items, o.parallel, async (p, idx) => {
    if (guard?.exhausted) { aborted = aborted ?? `the spend cap of ₹${o.capInr} was reached`; return; }
    o.log(`▶ ${p.n}. ${p.id}`);
    const cassette = setupFor(p.id);
    const ctx: SmokeCtx = { mode: o.mode, ...(tiers ? { tiers } : {}), ...(cassette ? { cassette } : {}), maxTurns: o.maxTurns, maxTokens: o.tiers === "smoke" ? SMOKE_MAX_TOKENS : 0, taskBudgetPaise, outDir, ...(judgePool ? { judgePool } : {}), log: o.log };
    const r = await p.run(ctx, idx);
    o.log(`${r.ok ? "✔" : "✘"} ${p.n}. ${p.id}  ${r.ok ? "pass" : Object.entries(r.stages).filter(([, v]) => v && !v.ok).map(([s, v]) => `${s}: ${v!.detail}`).join(" | ").slice(0, 200)}`);
    results.push(r);
    if (guard?.exhausted) aborted = aborted ?? `the spend cap of ₹${o.capInr} was reached`;
  });
  results.sort((a, b) => a.n - b.n);
  if (guard?.exhausted) aborted = aborted ?? `the spend cap of ₹${o.capInr} was reached`;

  const misses: SmokeRun["misses"] = [];
  for (const r of results) {
    for (const m of r.cassette?.missed ?? []) misses.push({ item: r.id, ...(m.purpose ? { purpose: m.purpose } : {}), model: m.model, summary: m.summary });
    if (r.cassette?.misses && !r.cassette.missed?.length) misses.push({ item: r.id, model: "?", summary: `${r.cassette.misses} request(s) had no recording` });
  }
  const run: SmokeRun = {
    id: path.basename(outDir), startedAt, finishedAt: new Date().toISOString(), mode: o.mode,
    ...(o.cassetteMode ? { cassette: { name: o.cassetteName, mode: o.changed ? "changed (mixed for affected items, replay for the rest)" : o.cassetteMode, file: store.file } } : {}),
    models: { primary, fallback, tiers: o.tiers }, capInr: o.capInr,
    spentInr: spends ? (guard?.spentUsd ?? 0) * fx : 0,
    replayedInr: results.reduce((n, r) => n + (r.cassette?.replayedUsd ?? 0), 0) * fx,
    estimatedInr: est.totalInr, fx, items: results, ...(aborted ? { aborted } : {}), ...(changed ? { changed } : {}), misses,
  };
  const params: RunParams = { maxTurns: o.maxTurns, primary, fallback, tiers: o.tiers };
  if (o.cassetteMode === "record") saveHashes(store.file, hashSources(), params);
  else if (o.cassetteMode === "mixed" || (o.changed && o.cassetteMode)) saveHashes(store.file);
  writeJson(path.join(outDir, "smoke.json"), run);
  fs.writeFileSync(path.join(outDir, "report.html"), renderHtml(run));
  const latest = path.join(OUT_DIR, "latest-smoke");
  rmrf(latest);
  try { fs.symlinkSync(outDir, latest, "dir"); } catch { /* a link is a convenience */ }
  return run;
}

// ------------------------------------------------------------------- command line

export const SMOKE_SPEC: CliSpec = {
  name: "npm run e2e -- --suite smoke",
  about: "nine short items across the whole real flow, on two tiny fixture projects, for a few rupees",
  positionals: false,
  flags: {
    suite: { kind: "string", value: "smoke", about: "the suite (this tool is --suite smoke)" },
    model: { kind: "string", value: "real|fake|oracle", about: "real models (needs the key), a scripted wrong one, or a scripted right one (default real)" },
    record: { kind: "bool", about: "record every model call to e2e/cassettes/<cassette>.jsonl.gz" },
    replay: { kind: "bool", about: "answer every call from the cassette, for nothing (strict: a miss fails the run)" },
    mixed: { kind: "bool", about: "replay what is recorded, call the model for the rest" },
    cassette: { kind: "string", value: "<name>", about: "the cassette (default smoke)" },
    loose: { kind: "bool", about: "replay: also match a call by its run, purpose and ordinal" },
    changed: { kind: "bool", about: "re-run only the items the code changed since the recording can affect; replay the rest" },
    items: { kind: "list", value: "1,5", about: "item numbers or ids to run (default all nine)" },
    estimate: { kind: "bool", about: "print what the run would cost, from the live prices, and stop" },
    "budget-inr": { kind: "number", value: "N", about: "REQUIRED for a run that calls a real model: the hard cap in rupees (no default)" },
    tiers: { kind: "string", value: "smoke|default", about: "one cheap ladder for every tier (default smoke), or the product's own" },
    "smoke-model": { kind: "string", value: "<slug>", about: `the primary model (default ${SMOKE_PRIMARY})` },
    "smoke-fallback": { kind: "string", value: "<slug>", about: `the fallback model (default ${SMOKE_FALLBACK})` },
    "max-turns": { kind: "number", about: `most work turns a task may take (default ${SMOKE_MAX_TURNS}; a replay uses the recording's own)` },
    parallel: { kind: "number", about: "items at once (default 3)" },
    out: { kind: "string", value: "<dir>", about: "where the run is written" },
  },
  examples: ["npm run e2e -- --suite smoke --estimate", "npm run e2e -- --suite smoke --record --budget-inr 8", "npm run e2e -- --suite smoke --replay --cassette smoke-2", "npm run e2e -- --suite smoke --model oracle"],
};

export async function runSmokeCli(argvIn: string[] = process.argv.slice(2)): Promise<number> {
  return runCli(async () => {
    const p = parseCli(SMOKE_SPEC, argvIn);
    const mode = (p.str("model") ?? "real") as ModelMode;
    if (!["real", "fake", "oracle"].includes(mode)) throw new CliExit(2, "--model is real, fake or oracle");
    if (p.has("suite") && p.str("suite") !== "smoke") throw new CliExit(2, `this is the smoke suite: --suite is smoke, not ${p.str("suite")}`);
    const cassetteMode: CassetteMode | null = p.has("record") ? "record" : p.has("replay") ? "replay" : p.has("mixed") ? "mixed" : null;
    const estimateOnly = p.has("estimate");
    // The cap, before the key: a forgotten --budget-inr stops the run whether or not a key is set. Nothing here has a default.
    const capInr = requireBudget(p, mode === "real" && cassetteMode !== "replay" && !estimateOnly, "a real smoke run");
    if (mode === "real" && cassetteMode !== "replay" && !estimateOnly && !realKey) {
      console.error("OPENROUTER_API_KEY is not set, so a real smoke run cannot start.\n  - to prove the suite itself without a key: --model oracle (answers right) or --model fake (wrong in known ways)\n  - to run from a recording: --replay\n  - or add the key (tulmi/.env or the shell) and run: npm run e2e -- --suite smoke --record --budget-inr 8");
      return 2;
    }
    const tiers = (p.str("tiers") ?? "smoke") as "smoke" | "default";
    if (!["smoke", "default"].includes(tiers)) throw new CliExit(2, "--tiers is smoke or default");
    // A replay is made the way the recording was: its own turn cap, models and ladders (the cassette's sidecar), unless the person says otherwise.
    const cassetteName = p.str("cassette") ?? "smoke";
    const recorded = (cassetteMode && cassetteMode !== "record") || p.has("changed") ? loadHashes(new CassetteStore(cassetteName).file)?.run : undefined;
    const run = await runSmoke({
      mode, cassetteMode, cassetteName, loose: p.has("loose"), capInr: capInr || 25, tiers: p.has("tiers") ? tiers : recorded?.tiers ?? tiers,
      primary: p.str("smoke-model") ?? recorded?.primary ?? SMOKE_PRIMARY, fallback: p.str("smoke-fallback") ?? recorded?.fallback ?? SMOKE_FALLBACK, maxTurns: p.num("max-turns") ?? recorded?.maxTurns ?? SMOKE_MAX_TURNS,
      parallel: p.num("parallel") ?? 3, outDir: p.str("out") ?? "", changed: p.has("changed"), only: p.list("items"),
      estimateOnly, log: (s) => console.log(s),
    });
    if (estimateOnly) return 0;
    console.log(`\n${renderText(run)}\n\nreport: ${path.relative(process.cwd(), path.join(OUT_DIR, "latest-smoke", "report.html"))}`);
    if (run.aborted) return 4;
    if (cassetteMode === "replay" && run.misses.length) return 3;
    return run.items.every((i) => i.ok) ? 0 : 1;
  });
}

if (process.argv[1] && /e2e\/smoke\/index\.[tj]s$/.test(process.argv[1])) {
  runSmokeCli().then((c) => process.exit(c), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
