/**
 * THE REALITY CHECK, FROM THE COMMAND LINE.
 *
 *   npm run e2e -- --suite bugs --model oracle
 *   npm run e2e -- --tasks 'express-*,category:question' --model fake --repeats 2
 *   npm run e2e -- --suite real --model real --repeats 3 --budget-inr 400
 *
 *   --suite <name>       a named group of tasks (all, smoke, bugs, features, refactors, questions, ui, vague, hostile, broken, long, language,
 *                        disruption, real). --list shows them with their counts
 *   --tasks <glob>       task ids with * ; `category:bug`, `tag:mined`, `repo:express`; several separated by commas. Combined with --suite: both
 *   --agent <id>        the agent under test (default tailzu; `patch` applies each task's known-correct patch; --agents lists them). External agents
 *                        (OpenHands, Aider, opencode, Codex CLI) plug in as further implementations of AgentUnderTest, e2e/agents/
 *   --part <kind>       compare one PART of an agent in isolation instead of running whole tasks: locate (ranked files vs the real fix's files),
 *                        editApply (does a proposed edit apply cleanly) or condense (does a long context's summary keep its facts)
 *   --model real         the product's own callModel over OpenRouter (needs OPENROUTER_API_KEY)
 *   --model fake         a scripted model that fails on purpose in a known way (--persona name, or rotate through them)
 *   --model oracle       applies each task's known-correct answer through the same flow, so setup, hidden tests and scoring are proven
 *   --repeats N          each task N times, for variance
 *   --budget-inr X       hard cap on what the whole run may spend (real mode); it stops cleanly when it is reached
 *   --task-budget-inr X  each job's own budget (default: the product's, 30)
 *   --parallel N         tasks at once (default 1 for real, 2 otherwise)
 *   --brain-inr X        what the repo summaries may cost per project (default 0: the brain is built without model words)
 *   --out <dir>          where the run is written (default e2e/out/<time>-<model>); `e2e/out/latest` always points at the newest
 *   --no-suite           skip running each project's own suite on the result (faster, weaker)
 *   --estimate           (with --model real) print what the run would cost, from the live OpenRouter prices, and stop; a real run prints it before it starts
 *
 * It writes results.json and a self-contained report.html. The exit code is 0 when the run completed (failures are results, not errors).
 */
import { realKey } from "./env.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { failingPersonaFor, lazy, personaByName, type Persona } from "./adapters/personas.js";
import { agentById, AGENTS, type AgentUnderTest, type ModelSpec } from "./agents/index.js";
import { loadReposFile } from "./repos.js";
import type { RunTrace } from "./runTask.js";
import { runOne } from "./runOne.js";
import type { Score } from "./score/index.js";
import { loadTasks, selectTasks, type Task } from "./tasks/schema.js";
import { SpendCap, inrToPaise, noCap } from "./spend.js";
import { CassetteStore, SpendGuard, type CassetteMode } from "./adapters/cassette.js";
import type { CassetteSetup } from "./adapters/rig.js";
import { OUT_DIR, mkdirp, pool, rmrf, sweepStaleWork, writeJson } from "./util.js";

export const SUITES: Record<string, { about: string; pick: (t: Task) => boolean }> = {
  all: { about: "every task on the real projects (the smoke tasks run with their own suite: they need its cheap tier table and token caps)", pick: (t) => !t.tags.includes("smoke") },
  smoke: { about: "9 short items on tiny fixture projects, the whole real flow for a few rupees (npm run e2e -- --suite smoke)", pick: (t) => t.tags.includes("smoke") },
  quick: { about: "one task of each main kind on the real projects", pick: (t) => t.tags.includes("quick") },
  bugs: { about: "real historical bugs, mined and validated", pick: (t) => t.category === "bug" && !t.tags.includes("smoke") },
  features: { about: "features with hidden acceptance tests", pick: (t) => t.category === "feature" && !t.tags.includes("smoke") },
  refactors: { about: "wide-impact refactors", pick: (t) => t.category === "refactor" && !t.tags.includes("smoke") },
  questions: { about: "code questions with known answers", pick: (t) => t.category === "question" && !t.tags.includes("smoke") },
  ui: { about: "components from words and from a screenshot", pick: (t) => t.category === "ui" && !t.tags.includes("smoke") },
  vague: { about: "vague requests", pick: (t) => t.category === "vague" && !t.tags.includes("smoke") },
  hostile: { about: "prompt injection, planted secrets, workflow edits, destructive bait", pick: (t) => t.category === "hostile" && !t.tags.includes("smoke") },
  broken: { about: "projects with a failing test already", pick: (t) => t.category === "broken" && !t.tags.includes("smoke") },
  long: { about: "an empty repo to a small working app", pick: (t) => t.category === "long" && !t.tags.includes("smoke") },
  language: { about: "Hinglish, Hindi and voice-like phrasings", pick: (t) => t.category === "language" && !t.tags.includes("smoke") },
  disruption: { about: "a person's word mid-task, a crash, a budget that runs out", pick: (t) => t.category === "disruption" && !t.tags.includes("smoke") },
  real: { about: "the subset a model bake-off runs per code and strong candidate", pick: (t) => t.tags.includes("bakeoff") },
};

export interface RunRecord {
  task: Pick<Task, "id" | "title" | "category" | "repo" | "difficulty" | "tags" | "language">;
  repeat: number;
  mode: string;
  agent: string;
  persona: string | null;
  expectStage: string[] | null;
  /** Tailzu's own flow facts (absent for other agents). */
  trace: RunTrace | null;
  /** What the cassettes did for this run, when there were any. */
  cassette?: NonNullable<import("./agents/types.js").AgentMetrics["cassette"]>;
  result?: { status: string; reason: string; transcriptPath: string | null; answer: string; diff: string; changes: number };
  score: Score | null;
  error?: string;
  skipped?: string;
}

/**
 * Did a run of a failing persona end where it was built to? true when the run failed and the first failing stage, or any other failing stage, is one the persona
 * expects (the product's own guards can stop a bad change earlier than the persona planned, e.g. a planted secret refused at work instead of commit). null when
 * the run has no expectation (oracle, real) or did not get as far as a score.
 */
export function attributedAsExpected(r: Pick<RunRecord, "expectStage" | "score">): boolean | null {
  if (!r.expectStage?.length || !r.score) return null;
  if (r.score.success) return false;
  const failing = Object.entries(r.score.stage.verdicts).filter(([, v]) => v.status === "fail").map(([k]) => k);
  return [r.score.stage.failedAt, ...failing].some((s) => s && r.expectStage!.includes(s));
}

export interface RunFile {
  meta: {
    id: string; startedAt: string; finishedAt: string; mode: string; args: string[]; node: string; host: string; capPaise: number; spentPaise: number;
    aborted?: string; repos: Array<{ id: string; slug: string; pin: string; stack: string; tests?: number; testSec?: number }>; hasKey: boolean; fx: number;
  };
  results: RunRecord[];
}

function argv(name: string): string | undefined {
  const a = process.argv.slice(2);
  const i = a.indexOf(`--${name}`);
  return i >= 0 ? a[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);

export interface RunSpec {
  agent: AgentUnderTest;
  outDir: string;
  tasks: Task[];
  mode: "real" | "fake" | "oracle";
  repeats: number;
  persona?: string;
  parallel: number;
  cap: SpendCap;
  taskBudgetPaise?: number;
  brainPaise: number;
  skipSuite: boolean;
  log: (s: string) => void;
  tiers?: ModelSpec["tiers"];
  /** One model slug, for agents that take one. */
  slug?: string;
  timeoutSec?: number;
  onRecord?: (r: RunRecord) => void;
  isStopped?: () => boolean;
  /** Cassettes: record the model's answers, or replay them for nothing. */
  cassette?: CassetteSetup;
  /** Most work turns a task may take. */
  maxTurns?: number;
}

/** Runs and scores every (task, repeat). Never throws for a task that fails: that is a result. */
export async function runAll(spec: RunSpec): Promise<{ records: RunRecord[]; aborted?: string }> {
  const jobs = spec.tasks.flatMap((t, i) => Array.from({ length: spec.repeats }, (_, r) => ({ t, i, repeat: r + 1 })));
  const records: RunRecord[] = [];
  let aborted: string | undefined;
  await pool(jobs, spec.parallel, async ({ t, i, repeat }) => {
    const head = { task: { id: t.id, title: t.title, category: t.category, repo: t.repo, difficulty: t.difficulty, tags: t.tags, ...(t.language ? { language: t.language } : {}) }, repeat, mode: spec.mode };
    const persona: Persona | undefined = spec.mode === "fake" ? (spec.persona && spec.persona !== "rotate" ? personaByName(spec.persona) : failingPersonaFor(t, i) ?? lazy) : undefined;
    const base = { ...head, agent: spec.agent.id, persona: persona?.name ?? (spec.mode === "oracle" ? "oracle" : null), expectStage: persona?.expectStage ? (Array.isArray(persona.expectStage) ? persona.expectStage : [persona.expectStage]) : null };
    if (spec.isStopped?.()) { const r: RunRecord = { ...base, trace: null, score: null, skipped: "stopped" }; records.push(r); return; }
    const wanted = spec.taskBudgetPaise ?? t.budgetPaise ?? 3000;
    const spends = spec.mode === "real" && spec.cassette?.mode !== "replay";
    const grant = spends ? spec.cap.reserve(wanted) : wanted;
    if (spends && grant < Math.min(wanted, 600)) {
      aborted = aborted ?? `the spend cap of ₹${(spec.cap.capPaise / 100).toFixed(2)} was reached`;
      const r: RunRecord = { ...base, trace: null, score: null, skipped: "the spend cap was reached" };
      records.push(r); spec.onRecord?.(r);
      return;
    }
    spec.log(`▶ ${t.id}${spec.repeats > 1 ? ` #${repeat}` : ""} (${spec.agent.id}, ${spec.mode}${persona ? `/${persona.name}` : ""})`);
    let rec: RunRecord;
    try {
      const model: ModelSpec = { mode: spec.mode, ...(persona ? { persona } : {}), ...(spec.tiers ? { tiers: spec.tiers } : {}), ...(spec.slug ? { slug: spec.slug } : {}), ...(spec.cassette ? { cassette: spec.cassette, wire: true } : {}), ...(spec.maxTurns ? { maxTurns: spec.maxTurns } : {}) };
      const { result, score } = await runOne(t, spec.agent, {
        model, budgetPaise: grant, timeoutSec: spec.timeoutSec ?? (spec.mode === "real" ? 900 : 420), outDir: spec.outDir, repeat, log: (s) => spec.log(`  ${t.id}: ${s}`),
        brainBudgetPaise: spec.brainPaise, skipSuite: spec.skipSuite,
      });
      rec = {
        ...base, trace: result.flow ?? null, score, ...(result.metrics.cassette ? { cassette: result.metrics.cassette } : {}),
        result: { status: result.status, reason: result.reason, transcriptPath: result.transcriptPath, answer: result.answer.slice(0, 4000), diff: (result.diff ?? "").slice(0, 20_000), changes: result.changes?.length ?? 0 },
      };
      spec.log(`${score.success ? "✔" : "✘"} ${t.id}${spec.repeats > 1 ? ` #${repeat}` : ""}  ${score.success ? "success" : `failed at ${score.stage.failedAt}: ${score.stage.reason}`}  (${(result.metrics.wallMs / 1000).toFixed(1)}s, ${score.metrics.costPaise} paise)`);
      spec.cap.settle(grant, spends ? score.metrics.costPaise + score.metrics.judgePaise : 0, t.id);
    } catch (err) {
      rec = { ...base, trace: null, score: null, error: (err as Error).stack?.split("\n").slice(0, 4).join(" | ") ?? String(err) };
      spec.log(`! ${t.id}: ${(err as Error).message.slice(0, 200)}`);
      spec.cap.settle(grant, 0, t.id);
    }
    records.push(rec);
    spec.onRecord?.(rec);
  });
  records.sort((a, b) => (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : a.repeat - b.repeat));
  return { records, ...(aborted ? { aborted } : {}) };
}

export function writeRun(dir: string, file: RunFile): void {
  mkdirp(dir);
  writeJson(path.join(dir, "results.json"), file);
}

async function main(): Promise<void> {
  if (flag("list")) {
    const tasks = loadTasks();
    for (const [name, s] of Object.entries(SUITES)) console.log(`${name.padEnd(11)} ${String(tasks.filter(s.pick).length).padStart(3)}  ${s.about}`);
    const cats = new Map<string, number>();
    for (const t of tasks) cats.set(t.category, (cats.get(t.category) ?? 0) + 1);
    console.log(`\n${tasks.length} tasks: ${[...cats].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    return;
  }
  if (flag("agents")) {
    for (const a of Object.values(AGENTS)) console.log(`${a.id.padEnd(10)} modes: ${a.modes.join(", ").padEnd(18)} ${a.describe}`);
    return;
  }
  if (argv("suite") === "smoke" && !argv("agent") && !argv("part")) {
    const { runSmokeCli } = await import("./smoke/index.js");
    process.exitCode = await runSmokeCli();
    return;
  }
  const agent = agentById(argv("agent") ?? "tailzu");
  const mode = (argv("model") ?? (agent.modes.includes("oracle") ? "oracle" : "real")) as "real" | "fake" | "oracle";
  if (!agent.modes.includes(mode)) throw new Error(`the ${agent.id} agent runs in ${agent.modes.join(", ")}, not ${mode}`);
  if (!["real", "fake", "oracle"].includes(mode)) throw new Error("--model is real, fake or oracle");
  const cmode: CassetteMode | null = flag("record") ? "record" : flag("replay") ? "replay" : flag("mixed") ? "mixed" : null;
  if (mode === "real" && cmode !== "replay" && !realKey && !flag("estimate")) {
    console.error("OPENROUTER_API_KEY is not set, so a real run cannot start. Use --model fake or --model oracle to run the harness itself, --replay to run from a cassette, or add the key (tulmi/.env or the shell).");
    process.exitCode = 2;
    return;
  }
  const swept = sweepStaleWork();
  if (swept.length) console.log(`(removed ${swept.length} work folder(s) a killed run had left behind)`);
  const all = loadTasks();
  const suiteName = argv("suite");
  let tasks = all;
  if (suiteName) {
    const s = SUITES[suiteName];
    if (!s) throw new Error(`no suite called ${suiteName}; there are ${Object.keys(SUITES).join(", ")}`);
    tasks = all.filter(s.pick);
  }
  const glob = argv("tasks");
  if (glob) tasks = selectTasks(tasks, glob);
  const limit = Number(argv("limit") ?? 0);
  if (limit > 0) tasks = tasks.slice(0, limit);
  if (suiteName !== "smoke" && tasks.some((t) => t.tags.includes("smoke"))) {
    const dropped = tasks.filter((t) => t.tags.includes("smoke")).length;
    if (dropped === tasks.length && !argv("agent")) { console.error("these are smoke tasks: they run with their own suite (npm run e2e -- --suite smoke [--items 1,5]), which sets the cheap tier table and the per-call token caps they are sized for"); process.exitCode = 2; return; }
    tasks = tasks.filter((t) => !t.tags.includes("smoke"));
    console.log(`(${dropped} smoke task(s) left out: they run with --suite smoke)`);
  }
  if (!tasks.length) throw new Error("no task matches");
  if (argv("part")) {
    const { runPart } = await import("./agents/parts.js");
    const kind = argv("part") as "locate" | "editApply" | "condense";
    if (!["locate", "editApply", "condense"].includes(kind)) throw new Error("--part is locate, editApply or condense");
    const report = await runPart(kind, argv("impl") ?? agent.id, tasks, { mode }, (s) => console.log(`  ${s}`));
    mkdirp(OUT_DIR);
    writeJson(path.join(OUT_DIR, `part-${kind}-${agent.id}.json`), report);
    console.log(`${kind} (${report.impl}): score ${(report.score * 100).toFixed(0)}% over ${report.rows.length} case(s), ${report.costPaise} paise`);
    return;
  }
  const repeats = Math.max(1, Number(argv("repeats") ?? 1));
  const capInr = Number(argv("budget-inr") ?? 0);
  const spends = mode === "real" && cmode !== "replay";
  if (spends && !flag("estimate") && !(capInr > 0)) throw new Error("a real run needs --budget-inr X, a hard cap in rupees");
  const cap = spends ? new SpendCap(inrToPaise(capInr)) : noCap();
  const fxRate = Number(process.env.CODE_USD_INR) || 88;
  if (mode === "real" && (flag("estimate") || (spends && !flag("no-estimate")))) {
    const { loadCatalog } = await import("./catalog.js");
    const { estimateRun } = await import("./smoke/estimate.js");
    const { tierTable } = await import("../src/code/brain/tiers.js");
    const table = tierTable();
    const catalog = await loadCatalog({ offline: !flag("estimate") && !spends });
    const est = estimateRun(tasks, { repeats, catalog, fx: fxRate, capInr, codeModel: table.code.models[0] ?? "?", strongModel: table.strong.models[0] ?? "?" });
    console.log(`estimate: about ₹${est.totalInr.toFixed(0)} for ${tasks.length} task(s) x ${repeats} on ${est.model} (up to ₹${est.highInr.toFixed(0)} if every call went to ${est.strongModel}); cap ${capInr > 0 ? `₹${capInr}` : "none set"}. ${est.note}`);
    console.log(`  ${est.byCategory.map((c) => `${c.category} ${c.tasks} = ₹${c.inr.toFixed(0)}`).join(", ")}`);
    if (flag("estimate")) return;
  }
  let cassette: CassetteSetup | undefined;
  if (cmode) {
    const store = new CassetteStore(argv("cassette") ?? suiteName ?? "run");
    if (cmode === "record") store.reset(); else store.load();
    if (cmode === "replay" && !store.count) throw new Error(`the cassette ${store.file} is empty or missing: record it first with --record`);
    cassette = { store, mode: cmode, ...(spends ? { guard: new SpendGuard(capInr / fxRate) } : {}), ...(flag("loose") ? { loose: true } : {}) };
    console.log(`cassette ${path.relative(process.cwd(), store.file)}: ${cmode}${cmode === "replay" ? ` (${store.count} recordings, no model is called)` : cmode === "mixed" ? ` (${store.count} recordings; a miss calls the model)` : ""}`);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const dir = path.resolve(argv("out") ?? path.join(OUT_DIR, `${stamp}-${mode}${suiteName ? `-${suiteName}` : ""}`));
  const startedAt = new Date().toISOString();
  const taskBudget = argv("task-budget-inr") ? inrToPaise(Number(argv("task-budget-inr"))) : undefined;
  let stopped = false;
  const records: RunRecord[] = [];
  const meta = (aborted?: string): RunFile["meta"] => ({
    id: path.basename(dir), startedAt, finishedAt: new Date().toISOString(), mode, args: process.argv.slice(2), node: process.version, host: os.hostname(), capPaise: cap.capPaise, spentPaise: cap.spentPaise,
    ...(aborted ? { aborted } : {}), repos: loadReposFile().repos.map((r) => ({ id: r.id, slug: r.slug, pin: r.pin, stack: r.stack, ...(r.measured ? { tests: r.measured.tests, testSec: r.measured.testSec } : {}) })),
    hasKey: !!realKey, fx: Number(process.env.CODE_USD_INR) || 88,
  });
  const flush = (aborted?: string) => {
    writeRun(dir, { meta: meta(aborted), results: [...records].sort((a, b) => (a.task.id < b.task.id ? -1 : 1)) });
  };
  process.on("SIGINT", () => { stopped = true; console.log("\nstopping after the running tasks…"); });
  console.log(`${tasks.length} task(s) × ${repeats} repeat(s), model ${mode}${mode === "real" ? `, cap ₹${capInr}` : ""} → ${path.relative(process.cwd(), dir)}`);
  const res = await runAll({
    agent, outDir: dir, tasks, mode, repeats, ...(argv("persona") ? { persona: argv("persona")! } : {}), parallel: Number(argv("parallel") ?? (mode === "real" ? 1 : 2)), cap,
    ...(taskBudget ? { taskBudgetPaise: taskBudget } : {}), brainPaise: inrToPaise(Number(argv("brain-inr") ?? 0)), skipSuite: flag("no-suite"),
    ...(cassette ? { cassette } : {}), ...(argv("max-turns") ? { maxTurns: Number(argv("max-turns")) } : {}),
    log: (s) => console.log(s), onRecord: (r) => { records.push(r); flush(); }, isStopped: () => stopped,
  });
  records.length = 0;
  records.push(...res.records);
  flush(res.aborted);
  const { buildReport } = await import("./report/html.js");
  fs.writeFileSync(path.join(dir, "report.html"), buildReport({ meta: meta(res.aborted), results: res.records }));
  const latest = path.join(OUT_DIR, "latest");
  rmrf(latest);
  fs.symlinkSync(dir, latest, "dir");
  const ok = res.records.filter((r) => r.score?.success).length;
  if (cassette) {
    const t = { hits: 0, misses: 0, recorded: 0, spentUsd: 0, replayedUsd: 0 };
    for (const r of res.records) { const c = r.cassette; if (c) { t.hits += c.hits; t.misses += c.misses; t.recorded += c.recorded; t.spentUsd += c.spentUsd; t.replayedUsd += c.replayedUsd; } }
    console.log(`cassette: ${t.hits} answered from it, ${t.recorded} recorded, ${t.misses} miss(es); spent ₹${(t.spentUsd * fxRate).toFixed(2)}, replayed answers had cost ₹${(t.replayedUsd * fxRate).toFixed(2)} when recorded`);
    if (t.misses && cmode === "replay") process.exitCode = 3;
  }
  const judged = res.records.map(attributedAsExpected).filter((x): x is boolean => x !== null);
  if (judged.length) {
    console.log(`attribution: ${judged.filter(Boolean).length}/${judged.length} failing runs were blamed on the stage their persona was built to break`);
    for (const r of res.records) if (attributedAsExpected(r) === false) console.log(`  ${r.task.id} (${r.persona}): expected ${r.expectStage!.join("/")}, got ${r.score!.success ? "success" : r.score!.stage.failedAt}`);
  }
  console.log(`\n${ok}/${res.records.length} succeeded. ${res.aborted ? `Stopped early: ${res.aborted}. ` : ""}Report: ${path.relative(process.cwd(), path.join(dir, "report.html"))}`);
}

if (process.argv[1] && /e2e\/run\.[tj]s$/.test(process.argv[1])) {
  main().then(() => process.exit(process.exitCode ?? 0), (err) => { console.error(err); process.exit(1); });
}
