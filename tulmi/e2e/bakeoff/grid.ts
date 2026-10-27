/**
 * THE GRID: EVERY (MODEL, AGENT) PAIR ON THE SAME TASKS, SO A MODEL IS COMPARED INSIDE EACH AGENT'S OWN LOGIC AND NOT ONLY OURS.
 *
 *   npm run bakeoff -- --grid --models qwen/qwen3.7-flash,deepseek/deepseek-v4.1-flash --agents tailzu,aider --tasks 'tag:smoke' --budget-inr 25
 *
 * Each pair runs the tasks one after another through the agent (agents/index.ts: any AgentUnderTest), with the model's slug as the only model, behind the
 * recording proxy (proxy.ts) so that an agent that speaks HTTP can be pointed at it and every run is recorded once and replayed for free. THE EARLY STOP, per pair:
 * after its first two tasks a pair is stopped when it has passed none of them and another pair on the same two tasks has passed at least one at no higher cost
 * per pass (a pair that is clearly losing is not paid to lose on the rest). The report gives the best scaffold per model and the best model per scaffold: the
 * pass rate first, the cheaper per pass among equals.
 *
 * `--model sim`: no agent is run; each pair's result is drawn (a model's simulated quality, shifted a little by the agent), to exercise the logic for nothing.
 */
import "../env.js";
import { realKey } from "../env.js";
import fs from "node:fs";
import path from "node:path";
import { CassetteStore, SpendGuard, type CassetteMode } from "../adapters/cassette.js";
import { agentById, AGENTS } from "../agents/index.js";
import { loadCatalog } from "../catalog.js";
import { startProxy } from "../proxy.js";
import { runOne } from "../runOne.js";
import { loadTasks, selectTasks, type Task } from "../tasks/schema.js";
import { OUT_DIR, mkdirp, writeJson } from "../util.js";
import { esc, page } from "../report/svg.js";
import { pinnedTiers } from "./engine.js";
import { quality, unit } from "./sim.js";

export interface PairResult { model: string; agent: string; tasks: Array<{ id: string; success: boolean; costUsd: number; ms: number }>; stoppedEarly?: string; simulated: boolean }

export interface GridSummary {
  pairs: Array<{ model: string; agent: string; pass: number; n: number; costUsd: number; costPerPassUsd: number; stoppedEarly?: string }>;
  bestAgentPerModel: Record<string, string>;
  bestModelPerAgent: Record<string, string>;
}

const rate = (p: { pass: number; n: number }): number => (p.n ? p.pass / p.n : 0);
const cpp = (p: { pass: number; costUsd: number }): number => (p.pass > 0 ? p.costUsd / p.pass : Number.POSITIVE_INFINITY);

export function summarizeGrid(results: readonly PairResult[]): GridSummary {
  const pairs = results.map((r) => ({
    model: r.model, agent: r.agent, pass: r.tasks.filter((t) => t.success).length, n: r.tasks.length, costUsd: r.tasks.reduce((n, t) => n + t.costUsd, 0),
    costPerPassUsd: cpp({ pass: r.tasks.filter((t) => t.success).length, costUsd: r.tasks.reduce((n, t) => n + t.costUsd, 0) }), ...(r.stoppedEarly ? { stoppedEarly: r.stoppedEarly } : {}),
  }));
  const better = (a: typeof pairs[number], b: typeof pairs[number]): number => rate(b) - rate(a) || a.costPerPassUsd - b.costPerPassUsd;
  const bestAgentPerModel: Record<string, string> = {};
  const bestModelPerAgent: Record<string, string> = {};
  for (const m of new Set(pairs.map((p) => p.model))) bestAgentPerModel[m] = [...pairs.filter((p) => p.model === m)].sort(better)[0]!.agent;
  for (const a of new Set(pairs.map((p) => p.agent))) bestModelPerAgent[a] = [...pairs.filter((p) => p.agent === a)].sort(better)[0]!.model;
  return { pairs, bestAgentPerModel, bestModelPerAgent };
}

/** Whether a pair should be stopped after `after` tasks: it has passed none, and another pair has passed one or more of the same tasks at no higher cost per pass. */
export function losingPair(mine: PairResult, others: readonly PairResult[], after = 2): boolean {
  if (mine.tasks.length < after) return false;
  const head = mine.tasks.slice(0, after);
  if (head.some((t) => t.success)) return false;
  const mineCpp = cpp({ pass: 0, costUsd: 0 });
  return others.some((o) => {
    const h = o.tasks.slice(0, after);
    if (h.length < after) return false;
    const pass = h.filter((t) => t.success).length;
    return pass >= 1 && cpp({ pass, costUsd: h.reduce((n, t) => n + t.costUsd, 0) }) <= mineCpp;
  });
}

export interface GridOptions {
  mode: "real" | "sim";
  models: string[];
  agents: string[];
  tasks: Task[];
  capInr: number;
  cassetteMode: CassetteMode | null;
  cassetteName: string;
  stopAfter: number;
  early: boolean;
  outDir: string;
  log: (s: string) => void;
}

export async function runGrid(o: GridOptions): Promise<{ results: PairResult[]; summary: GridSummary; spentInr: number; aborted?: string }> {
  const fx = Number(process.env.CODE_USD_INR) || 88;
  const catalog = await loadCatalog({ offline: o.mode === "sim" || o.cassetteMode === "replay" });
  const guard = o.mode === "real" && o.cassetteMode !== "replay" ? new SpendGuard(o.capInr / fx) : undefined;
  const results: PairResult[] = [];
  const pairs = o.models.flatMap((m) => o.agents.map((a) => ({ model: m, agent: a })));
  const stopped = new Set<string>();
  let aborted: string | undefined;
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
  if (o.mode === "real" && o.agents.some((a) => a !== "tailzu")) {
    // An agent that speaks HTTP is pointed at this: recorded once, replayed for free, under the same cap.
    proxy = await startProxy({ port: 0, mode: o.cassetteMode ?? "record", cassette: o.cassetteName, ...(guard ? { capUsd: o.capInr / fx } : {}), log: o.log });
    o.log(`recording proxy on ${proxy.url} (per-run: ${proxy.url.replace(/\/v1$/, "")}/run/<model>__<agent>__<task>/v1)`);
  }
  const store = o.cassetteMode ? new CassetteStore(o.cassetteName) : undefined;
  if (store) { if (o.cassetteMode === "record") store.reset(); else store.load(); }
  mkdirp(o.outDir);
  try {
    // Task by task, across all pairs, so that "after two tasks" compares pairs on the same tasks.
    for (const p of pairs) results.push({ model: p.model, agent: p.agent, tasks: [], simulated: o.mode === "sim" });
    for (const [ti, task] of o.tasks.entries()) {
      for (const r of results) {
        const key = `${r.model}|${r.agent}`;
        if (stopped.has(key)) continue;
        if (guard?.exhausted) { aborted = `the spend cap of ₹${o.capInr} was reached`; break; }
        const t0 = Date.now();
        if (o.mode === "sim") {
          const info = catalog.models.get(r.model);
          const q = Math.max(0.05, Math.min(0.98, quality(r.model) + (unit("agent", r.agent) - 0.5) * 0.3));
          const usd = ((62_000 * (info?.inUsdPerM ?? 0.3) + 5_200 * (info?.outUsdPerM ?? 1.2)) / 1e6) * (0.8 + unit("cost", r.agent));
          r.tasks.push({ id: task.id, success: unit("grid", r.model, r.agent, task.id) < q, costUsd: usd, ms: 30_000 });
        } else {
          const agent = agentById(r.agent);
          const info = catalog.models.get(r.model);
          const { result, score } = await runOne(task, agent, {
            model: { mode: "real", slug: r.model, ladder: [r.model], tiers: pinnedTiers(r.model, info), ...(store ? { cassette: { store, mode: o.cassetteMode!, ...(guard ? { guard } : {}) }, wire: true } : {}), ...(proxy ? { proxyUrl: `${proxy.url.replace(/\/v1$/, "")}/run/${encodeURIComponent(`${r.model}__${r.agent}__${task.id}`.replace(/[^A-Za-z0-9._-]/g, "_"))}/v1` } : {}) },
            budgetPaise: 3000, timeoutSec: 900, outDir: o.outDir, repeat: 1, log: (s) => o.log(`    ${r.model} × ${r.agent} ${task.id}: ${s}`), brainBudgetPaise: 0,
          });
          void result;
          r.tasks.push({ id: task.id, success: score.success, costUsd: (score.metrics.costPaise + score.metrics.judgePaise) / fx / 100, ms: Date.now() - t0 });
        }
        o.log(`${r.model} × ${r.agent} ${task.id}: ${r.tasks[r.tasks.length - 1]!.success ? "pass" : "FAIL"}`);
      }
      if (aborted) break;
      if (o.early && ti + 1 === o.stopAfter) {
        for (const r of results) {
          const key = `${r.model}|${r.agent}`;
          if (!stopped.has(key) && losingPair(r, results.filter((x) => x !== r), o.stopAfter)) { stopped.add(key); r.stoppedEarly = `no pass in its first ${o.stopAfter} tasks while another pair passed`; o.log(`${r.model} × ${r.agent}: stopped early (clearly losing)`); }
        }
      }
    }
  } finally { await proxy?.close(); }
  return { results, summary: summarizeGrid(results), spentInr: (guard?.spentUsd ?? 0) * fx, ...(aborted ? { aborted } : {}) };
}

export function renderGridText(g: Awaited<ReturnType<typeof runGrid>>, fx: number): string {
  const L = [`GRID${g.results.some((r) => r.simulated) ? " (simulated: not a measurement)" : ""}   spent ₹${g.spentInr.toFixed(2)}${g.aborted ? `   STOPPED: ${g.aborted}` : ""}`, ""];
  L.push(`${"model".padEnd(34)} ${"agent".padEnd(12)} ${"pass".padStart(6)} ${"₹/pass".padStart(9)}  note`);
  for (const p of [...g.summary.pairs].sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : a.agent < b.agent ? -1 : 1))) L.push(`${p.model.padEnd(34)} ${p.agent.padEnd(12)} ${`${p.pass}/${p.n}`.padStart(6)} ${(Number.isFinite(p.costPerPassUsd) ? (p.costPerPassUsd * fx).toFixed(3) : "-").padStart(9)}  ${p.stoppedEarly ?? ""}`);
  L.push("", "best scaffold per model:");
  for (const [m, a] of Object.entries(g.summary.bestAgentPerModel)) L.push(`  ${m.padEnd(34)} ${a}`);
  L.push("", "best model per scaffold:");
  for (const [a, m] of Object.entries(g.summary.bestModelPerAgent)) L.push(`  ${a.padEnd(12)} ${m}`);
  return L.join("\n");
}

export function renderGridHtml(g: Awaited<ReturnType<typeof runGrid>>, fx: number): string {
  const rows = g.summary.pairs.map((p) => `<tr><td><code>${esc(p.model)}</code></td><td>${esc(p.agent)}</td><td class="num">${p.pass}/${p.n}</td><td class="num">${Number.isFinite(p.costPerPassUsd) ? `₹${(p.costPerPassUsd * fx).toFixed(3)}` : "-"}</td><td>${p.stoppedEarly ? `<span class="pill bad">stopped early</span> ${esc(p.stoppedEarly)}` : ""}</td></tr>`).join("");
  return page("Model × agent grid", `<h1>Model × agent grid</h1><p class="mut">${g.results.some((r) => r.simulated) ? "<b class=\"bad\">simulated</b> · " : ""}spent ₹${g.spentInr.toFixed(2)}</p>
<div class="wrap"><table><thead><tr><th>Model</th><th>Agent</th><th>Pass</th><th>Cost / pass</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Best scaffold per model</h2><ul>${Object.entries(g.summary.bestAgentPerModel).map(([m, a]) => `<li><code>${esc(m)}</code>: <b>${esc(a)}</b></li>`).join("")}</ul>
<h2>Best model per scaffold</h2><ul>${Object.entries(g.summary.bestModelPerAgent).map(([a, m]) => `<li><b>${esc(a)}</b>: <code>${esc(m)}</code></li>`).join("")}</ul>`);
}

export async function runGridCli(argvIn: string[]): Promise<number> {
  const arg = (n: string): string | undefined => { const i = argvIn.indexOf(`--${n}`); return i >= 0 ? argvIn[i + 1] : undefined; };
  const flag = (n: string): boolean => argvIn.includes(`--${n}`);
  const mode = (arg("model") ?? "real") as "real" | "sim";
  const cassetteMode: CassetteMode | null = flag("record") ? "record" : flag("replay") ? "replay" : flag("mixed") ? "mixed" : null;
  const models = (arg("models") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const agents = (arg("agents") ?? "tailzu").split(",").map((s) => s.trim()).filter(Boolean);
  if (!models.length) throw new Error("--grid needs --models a,b (OpenRouter slugs)");
  for (const a of agents) if (!AGENTS[a]) throw new Error(`no agent called ${a}; there are ${Object.keys(AGENTS).join(", ")}`);
  if (mode === "real" && cassetteMode !== "replay" && !realKey) { console.error("OPENROUTER_API_KEY is not set: use --model sim to exercise the grid, or --replay."); return 2; }
  const capInr = Number(arg("budget-inr") ?? (mode === "real" && cassetteMode !== "replay" ? 25 : 0));
  if (mode === "real" && cassetteMode !== "replay" && !(capInr > 0)) throw new Error("a real grid needs --budget-inr X");
  let tasks = loadTasks();
  tasks = selectTasks(tasks, arg("tasks") ?? "tag:smoke");
  if (!tasks.length) throw new Error("no task matches --tasks");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const outDir = path.resolve(arg("out") ?? path.join(OUT_DIR, "grid", `${stamp}-${mode}`));
  const g = await runGrid({ mode, models, agents, tasks, capInr, cassetteMode, cassetteName: arg("cassette") ?? "grid", stopAfter: Number(arg("stop-after") ?? 2), early: !flag("no-early"), outDir, log: (s) => console.log(s) });
  const fx = Number(process.env.CODE_USD_INR) || 88;
  writeJson(path.join(outDir, "grid.json"), { ...g, at: new Date().toISOString() });
  fs.writeFileSync(path.join(outDir, "report.html"), renderGridHtml(g, fx));
  console.log(`\n${renderGridText(g, fx)}\n\nreport: ${path.join(outDir, "report.html")}`);
  return g.aborted ? 4 : 0;
}
