/**
 * PROVES THE CONTESTANTS' WIRING WITH NO KEY AND NO MONEY:   npm run e2e:agents -- --prove [--agents aider,codex] [--task <id>]
 *
 * For each open-source agent that is installed: start it on the smoke task through the recording proxy, whose upstream is a scripted model (fake.ts) that
 * applies the task's known-correct patch in that agent's own protocol. Then the same run again from the cassette alone (proxy in replay mode, no upstream at
 * all). A pass means the agent started with the pinned version, reached the proxy and was counted there, edited the checkout, stopped, left a diff, the hidden
 * checks scored it, and the replay found every one of its requests (no miss), at no cost. It says nothing about how good the agent is; that is the grid.
 *
 *   --agents a,b     only these (default: every installed contestant)
 *   --task <id>      the task (default smoke-api-bug-pagination)
 *   --keep           leave the proof's cassette and transcripts in e2e/out/agent-proof (they are there either way; this stops the folder being emptied first)
 */
import "../env.js";
import fs from "node:fs";
import path from "node:path";
import { startProxy } from "../proxy.js";
import { runOne } from "../runOne.js";
import { loadTasks } from "../tasks/schema.js";
import { OUT_DIR, mkdirp, rmrf, writeJson } from "../util.js";
import { AGENTS } from "./index.js";
import { fakeAgentModel } from "./fake.js";
import { splitProxyUrl } from "./external.js";
import { toolBin, toolSpec } from "./tools.js";

export interface ProofRow {
  agent: string;
  tool: string;
  version: string;
  licence: string;
  installed: boolean;
  skipped?: string;
  record?: PassInfo;
  replay?: PassInfo;
}

export interface PassInfo { status: string; reason: string; scored: boolean; success: boolean; changed: string[]; calls: number; promptTokens: number; completionTokens: number; costUsd: number; steps: number; toolCalls: number; wallMs: number; hits: number; misses: number }

export const PROOF_AGENTS = ["aider", "opencode", "codex", "mini-swe-agent", "openhands"] as const;
const TOOL_OF: Record<string, string> = { aider: "aider", opencode: "opencode", codex: "codex", "mini-swe-agent": "mini-swe-agent", openhands: "openhands" };

/** The scripted model answers aider in the "whole file" edit format (it cannot search/replace text it has not seen); a real run uses aider's `diff`. */
process.env.E2E_AIDER_EDIT_FORMAT ??= "whole";

export async function proveAgents(o: { agents: readonly string[]; taskId: string; outDir: string; log: (s: string) => void }): Promise<ProofRow[]> {
  const task = loadTasks().find((t) => t.id === o.taskId);
  if (!task) throw new Error(`no task called ${o.taskId}`);
  const rows: ProofRow[] = [];
  const todo: string[] = [];
  for (const a of o.agents) {
    const tool = TOOL_OF[a]!;
    const spec = toolSpec(tool);
    const installed = !!toolBin(tool);
    rows.push({ agent: a, tool, version: spec.version, licence: spec.licence, installed, ...(installed ? {} : { skipped: `not installed (npm run e2e:tools -- install ${tool})` }) });
    if (installed) todo.push(a);
  }
  if (!todo.length) return rows;
  mkdirp(o.outDir);
  const cassetteDir = path.join(o.outDir, "cassettes");
  const slug = "fake/e2e-model";

  for (const pass of ["record", "replay"] as const) {
    const fake = fakeAgentModel(task);
    const proxy = await startProxy({ port: 0, mode: pass === "record" ? "record" : "replay", cassette: "proof", cassetteDir, capUsd: pass === "record" ? 1 : 0, ...(pass === "record" ? { upstream: fake } : {}), log: o.log });
    try {
      for (const a of todo) {
        const label = `fake__${a}__${task.id}`;
        const proxyUrl = `${splitProxyUrl(proxy.url).root}/run/${label}/v1`;
        const t0 = Date.now();
        o.log(`\n== ${a} (${pass})`);
        const { result, score } = await runOne(task, AGENTS[a]!, {
          model: { mode: "real", slug, ladder: [slug], proxyUrl }, budgetPaise: 500, timeoutSec: 420, outDir: path.join(o.outDir, pass), repeat: 1, log: (s) => o.log(`   ${s}`),
        });
        const usage = proxy.usage(label);
        const stats = proxy.runs()[label];
        const info: PassInfo = {
          status: result.status, reason: result.reason, scored: true, success: score.success, changed: (result.changes ?? []).map((c) => c.path),
          calls: usage.calls, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, costUsd: usage.costUsd,
          steps: result.metrics.steps, toolCalls: result.metrics.toolCalls, wallMs: Date.now() - t0, hits: stats?.hits ?? 0, misses: stats?.misses.length ?? 0,
        };
        rows.find((r) => r.agent === a)![pass] = info;
        o.log(`   ${result.status}${result.reason ? ` (${result.reason})` : ""}; score ${score.success ? "PASS" : "fail"}; ${info.calls} call(s), ${info.promptTokens}+${info.completionTokens} tokens, changed ${info.changed.join(", ") || "nothing"}; ${(info.wallMs / 1000).toFixed(1)}s${pass === "replay" ? `; ${info.hits} replayed, ${info.misses} miss(es)` : ""}`);
      }
    } finally { await proxy.close(); }
  }
  return rows;
}

export function renderProof(rows: readonly ProofRow[]): string {
  const L = [`${"agent".padEnd(15)} ${"version".padEnd(8)} ${"record".padEnd(12)} ${"replay".padEnd(12)} calls  tokens in/out   changed`];
  for (const r of rows) {
    if (r.skipped || !r.record) { L.push(`${r.agent.padEnd(15)} ${r.version.padEnd(8)} SKIPPED: ${r.skipped ?? "not run"}`); continue; }
    const f = (p: PassInfo | undefined): string => (p ? `${p.status}/${p.success ? "pass" : "FAIL"}` : "-");
    L.push(`${r.agent.padEnd(15)} ${r.version.padEnd(8)} ${f(r.record).padEnd(12)} ${f(r.replay).padEnd(12)} ${String(r.record.calls).padStart(5)}  ${`${r.record.promptTokens}/${r.record.completionTokens}`.padEnd(15)} ${r.record.changed.join(", ")}${r.replay && r.replay.misses ? `   (${r.replay.misses} replay miss(es))` : ""}`);
  }
  return L.join("\n");
}

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  const arg = (n: string): string | undefined => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  if (!a.includes("--prove")) { console.error("usage: npm run e2e:agents -- --prove [--agents aider,codex] [--task <id>]"); process.exit(2); }
  const agents = (arg("agents") ?? PROOF_AGENTS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const x of agents) if (!(PROOF_AGENTS as readonly string[]).includes(x)) throw new Error(`no contestant called ${x}; there are ${PROOF_AGENTS.join(", ")}`);
  const outDir = path.join(OUT_DIR, "agent-proof");
  if (!a.includes("--keep")) rmrf(outDir);
  const rows = await proveAgents({ agents, taskId: arg("task") ?? "smoke-api-bug-pagination", outDir, log: (s) => console.log(s) });
  console.log(`\n${renderProof(rows)}`);
  writeJson(path.join(outDir, "proof.json"), { at: new Date().toISOString(), task: arg("task") ?? "smoke-api-bug-pagination", rows });
  fs.mkdirSync(path.join(OUT_DIR, "agents"), { recursive: true });
  writeJson(path.join(OUT_DIR, "agents", "proof.json"), { at: new Date().toISOString(), task: arg("task") ?? "smoke-api-bug-pagination", rows });
  const bad = rows.filter((r) => r.record && !(r.record.success && r.replay?.success && r.replay.misses === 0));
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && /e2e\/agents\/prove\.[tj]s$/.test(process.argv[1])) main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
