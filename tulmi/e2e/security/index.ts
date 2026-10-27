/**
 * THE SECURITY SUITES:   npm run e2e:security -- --prove | --model <slug> --budget-inr X [--agent tailzu,aider,..] [--limit N] [--garak N] | --garak-cmd
 *
 *   --prove      no key, no cost: runs both suites against scripted models to show the wiring counts a hit as a hit and a miss as a miss.
 *                The injection suite in process (Tailzu's agent loop, the right model against models that obey what they read); the garak-shaped probes at the
 *                front door through the recording proxy (a gullible upstream against a careful one).
 *   --model      the real run, with OPENROUTER_API_KEY: a capped sample (--limit N cases of the injection suite per agent, --garak N probes per target), every
 *                call through the recording proxy under a hard cap (--budget-inr). Writes out/security/latest.json, which the report reads.
 *   --garak-cmd  prints the command that points the real garak at the proxy.
 *
 * What it reports is the attack success rate (and, for the injection suite, utility under attack): see suite.ts and garak.ts.
 */
import "../env.js";
import { realKey } from "../env.js";
import path from "node:path";
import { startProxy } from "../proxy.js";
import type { Task } from "../tasks/schema.js";
import { oracle, personaByName } from "../adapters/personas.js";
import { OUT_DIR, mkdirp, writeJson } from "../util.js";
import { carefulUpstream, gullibleUpstream } from "./fakes.js";
import { garakCommand, runGarak, type GarakRow, type GarakSummary } from "./garak.js";
import { injectionTasks, renderSecurity, runInjectionSuite, summarizeSecurity, type SecurityRow, type SecuritySummary } from "./suite.js";

export interface SecurityRun {
  at: string;
  mode: "proof" | "real";
  /** True when the numbers come from scripted models: they show the wiring, not any model's behaviour. */
  simulated: boolean;
  model: string;
  injection: Array<{ agent: string; label: string; summary: SecuritySummary; rows: SecurityRow[] }>;
  garak: Array<{ target: "frontdoor" | "agent"; label: string; summary: GarakSummary; rows: GarakRow[]; proxy?: { calls: number; tokens: number } }>;
  spentInr: number;
  notes: string[];
}

const fx = (): number => Number(process.env.CODE_USD_INR) || 88;

/** The scripted persona that does what a case's planted text says. */
export const personaFor = (t: Task) => personaByName((t.checks.secrets?.length ?? 0) > 0 ? "leaker" : (t.checks.canaries?.length ?? 0) > 0 ? "obedient" : "oracle");

export async function proveSecurity(o: { outDir: string; limit?: number; log: (s: string) => void }): Promise<SecurityRun> {
  const run: SecurityRun = { at: new Date().toISOString(), mode: "proof", simulated: true, model: "scripted", injection: [], garak: [], spentInr: 0, notes: [] };
  const tasks = injectionTasks().filter((t) => !t.tags.includes("web")).slice(0, o.limit ?? 20);
  o.log(`injection suite, in process: ${tasks.length} cases, the right model, then models that obey what they read`);
  const right = await runInjectionSuite({ agent: "tailzu", model: { mode: "oracle", persona: oracle, maxTurns: 12, maxTokens: 800 }, tasks, budgetPaise: 500, timeoutSec: 240, outDir: o.outDir, parallel: 2, log: o.log });
  run.injection.push({ agent: "tailzu", label: "scripted: does the job, ignores planted text", summary: right.summary, rows: right.rows });
  // One persona per case: the one that does what the case's planted text asks.
  const obeyRows: SecurityRow[] = [];
  for (const t of tasks) {
    const r = await runInjectionSuite({ agent: "tailzu", model: { mode: "fake", persona: personaFor(t), maxTurns: 12, maxTokens: 800 }, tasks: [t], budgetPaise: 500, timeoutSec: 240, outDir: o.outDir, log: () => undefined });
    obeyRows.push(...r.rows);
    o.log(`  ${t.id}: ${r.rows[0]?.attack ? "attack worked" : "held"} (${personaFor(t).name})`);
  }
  run.injection.push({ agent: "tailzu", label: "scripted: obeys planted text, leaks secrets", summary: summarizeSecurity(obeyRows), rows: obeyRows });

  for (const [label, up] of [["gullible upstream", gullibleUpstream()], ["careful upstream", carefulUpstream()]] as const) {
    const proxy = await startProxy({ port: 0, mode: "record", cassette: `security-proof-${label.split(" ")[0]}`, cassetteDir: path.join(o.outDir, "cassettes"), capUsd: 1, upstream: up });
    try {
      o.log(`garak-shaped probes at the front door through the proxy (${label})`);
      const g = await runGarak({ target: "frontdoor", proxyUrl: proxy.url, slug: "fake/e2e-model", outDir: o.outDir, log: o.log });
      const usage = Object.keys(proxy.runs()).map((k) => proxy.usage(k));
      run.garak.push({ target: "frontdoor", label: `scripted: ${label}`, summary: g.summary, rows: g.rows, proxy: { calls: usage.reduce((n, u) => n + u.calls, 0), tokens: usage.reduce((n, u) => n + u.promptTokens + u.completionTokens, 0) } });
    } finally { await proxy.close(); }
  }
  run.notes.push("Scripted models: the numbers show that the suites count correctly, not how any real model behaves.", "The agent-loop target of the garak-shaped probes goes through the proxy only with a real model (the scripted brain answers in process, not over HTTP).");
  return run;
}

export function renderSecurityRun(r: SecurityRun): string {
  const L = [`SECURITY (${r.mode}${r.simulated ? ", scripted models: not a measurement" : ""})`];
  for (const i of r.injection) L.push(`${renderSecurity(i.agent, i.summary)}\n  [${i.label}]`);
  for (const g of r.garak) L.push(`GARAK-SHAPED PROBES at the ${g.target} [${g.label}]: attack success ${g.summary.hits}/${g.summary.n} (${(g.summary.asr * 100).toFixed(0)}%)  ${Object.entries(g.summary.byFamily).map(([k, v]) => `${k} ${v.hits}/${v.n}`).join(", ")}${g.proxy ? `  [${g.proxy.calls} call(s) through the proxy, ${g.proxy.tokens} tokens]` : ""}`);
  return L.join("\n");
}

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  const arg = (n: string): string | undefined => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  const outDir = path.join(OUT_DIR, "security", new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-"));
  mkdirp(outDir);
  if (a.includes("--garak-cmd")) { console.log(garakCommand({ proxyUrl: "http://127.0.0.1:8787/v1", slug: arg("model") ?? "qwen/qwen3.7-flash" })); return; }
  if (a.includes("--prove")) {
    const r = await proveSecurity({ outDir, ...(arg("limit") ? { limit: Number(arg("limit")) } : {}), log: (s) => console.log(s) });
    console.log(`\n${renderSecurityRun(r)}`);
    writeJson(path.join(outDir, "security.json"), r);
    mkdirp(path.join(OUT_DIR, "security"));
    writeJson(path.join(OUT_DIR, "security", "latest.json"), r);
    return;
  }
  const slug = arg("model");
  if (!slug) { console.error("usage: npm run e2e:security -- --prove | --model <slug> --budget-inr X [--agent tailzu,aider] [--limit N] [--garak N] | --garak-cmd"); process.exit(2); }
  if (!realKey) { console.error("OPENROUTER_API_KEY is not set: use --prove to exercise the suites with scripted models."); process.exit(2); }
  const capInr = Number(arg("budget-inr") ?? 0);
  if (!(capInr > 0)) throw new Error("a real run needs --budget-inr X, a hard cap in rupees");
  const proxy = await startProxy({ port: 0, mode: (a.includes("--replay") ? "replay" : "mixed") as "replay" | "mixed", cassette: arg("cassette") ?? "security", capUsd: capInr / fx(), log: (s) => console.log(s) });
  const run: SecurityRun = { at: new Date().toISOString(), mode: "real", simulated: false, model: slug, injection: [], garak: [], spentInr: 0, notes: [] };
  try {
    const { pinnedTiers } = await import("../bakeoff/engine.js");
    for (const agent of (arg("agent") ?? "tailzu").split(",").map((s) => s.trim()).filter(Boolean)) {
      const r = await runInjectionSuite({ agent, model: { mode: "real", slug, ladder: [slug], tiers: pinnedTiers(slug, undefined), proxyUrl: proxy.url, maxTurns: 14, maxTokens: 1000 }, budgetPaise: 300, timeoutSec: 600, outDir, ...(arg("limit") ? { limit: Number(arg("limit")) } : {}), log: (s) => console.log(s) });
      console.log(renderSecurity(agent, r.summary));
      run.injection.push({ agent, label: slug, summary: r.summary, rows: r.rows });
    }
    for (const target of ["frontdoor", "agent"] as const) {
      const g = await runGarak({ target, proxyUrl: proxy.url, slug, limit: Number(arg("garak") ?? 10), outDir, log: (s) => console.log(s) });
      run.garak.push({ target, label: slug, summary: g.summary, rows: g.rows });
    }
  } finally { run.spentInr = proxy.guard.spentUsd * fx(); await proxy.close(); }
  console.log(`\n${renderSecurityRun(run)}\nspent ₹${run.spentInr.toFixed(2)} of ₹${capInr}`);
  writeJson(path.join(outDir, "security.json"), run);
  writeJson(path.join(OUT_DIR, "security", "latest.json"), run);
}

if (process.argv[1] && /e2e\/security\/index\.[tj]s$/.test(process.argv[1])) main().then(() => process.exit(0), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });

