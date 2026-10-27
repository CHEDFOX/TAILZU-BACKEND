/**
 * THE ONE-PAGE RESULT OF A SMOKE RUN: PASS OR FAIL PER STAGE, PER ITEM, WITH THE COST. A table in the terminal, and the same as a self-contained HTML page.
 */
import { SMOKE_STAGES, STAGE_NAMES, type ItemResult, type SmokeStage } from "./types.js";

export interface SmokeRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: string;
  cassette?: { name: string; mode: string; file: string };
  models: { primary: string; fallback: string; tiers: "smoke" | "default" };
  capInr: number;
  spentInr: number;
  /** What the replayed answers had cost when recorded (not spent now). */
  replayedInr: number;
  estimatedInr: number;
  fx: number;
  items: ItemResult[];
  aborted?: string;
  /** For --changed: the files and stages that were re-run. */
  changed?: { files: string[]; stages: string[]; items: string[] };
  misses: Array<{ item: string; purpose?: string; model: string; summary: string }>;
}

const mark = (v: { ok: boolean } | undefined): string => (v ? (v.ok ? "pass" : "FAIL") : "-");
const inr = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;

export function stageTotals(items: ItemResult[]): Record<SmokeStage, { pass: number; fail: number }> {
  const t = {} as Record<SmokeStage, { pass: number; fail: number }>;
  for (const s of SMOKE_STAGES) {
    const vs = items.map((i) => i.stages[s]).filter((v): v is NonNullable<typeof v> => !!v);
    t[s] = { pass: vs.filter((v) => v.ok).length, fail: vs.filter((v) => !v.ok).length };
  }
  return t;
}

export function renderText(run: SmokeRun): string {
  const used = SMOKE_STAGES.filter((s) => run.items.some((i) => i.stages[s]));
  const w = 34;
  const lines: string[] = [];
  const pass = run.items.filter((i) => i.ok).length;
  lines.push(`SMOKE ${run.mode}${run.cassette ? ` (cassette ${run.cassette.name}: ${run.cassette.mode})` : ""}   ${pass}/${run.items.length} items pass   model ${run.models.primary}${run.models.tiers === "default" ? " (product ladders)" : ` / ${run.models.fallback}`}`);
  lines.push(`cost ₹${run.spentInr.toFixed(2)} of a ₹${run.capInr} cap${run.replayedInr ? `   replayed answers had cost ₹${run.replayedInr.toFixed(2)} when recorded` : ""}${run.estimatedInr ? `   (estimated ₹${run.estimatedInr.toFixed(2)})` : ""}${run.aborted ? `   STOPPED: ${run.aborted}` : ""}`);
  lines.push("");
  lines.push(`${"#".padEnd(2)} ${"item".padEnd(w)} ${used.map((s) => STAGE_NAMES[s].padEnd(8)).join(" ")} ${"cost".padStart(7)} ${"time".padStart(6)}`);
  for (const i of run.items) {
    lines.push(`${String(i.n).padEnd(2)} ${i.title.slice(0, w).padEnd(w)} ${used.map((s) => mark(i.stages[s]).padEnd(8)).join(" ")} ${inr(i.costPaise).padStart(7)} ${`${(i.ms / 1000).toFixed(0)}s`.padStart(6)}`);
  }
  const t = stageTotals(run.items);
  lines.push(`${"".padEnd(2)} ${"stage totals".padEnd(w)} ${used.map((s) => `${t[s].pass}/${t[s].pass + t[s].fail}`.padEnd(8)).join(" ")}`);
  const failing = run.items.filter((i) => !i.ok);
  if (failing.length) {
    lines.push("");
    lines.push("what failed:");
    for (const i of failing) for (const [s, v] of Object.entries(i.stages)) if (v && !v.ok) lines.push(`  ${i.n}. ${i.title} [${STAGE_NAMES[s as SmokeStage]}] ${v.detail}`);
  }
  if (run.misses.length) {
    lines.push("");
    lines.push(`cassette misses (${run.misses.length}): the pipeline asked something that was not recorded (record again, or use --mixed):`);
    for (const m of run.misses.slice(0, 5)) lines.push(`  ${m.item} ${m.purpose ?? ""} ${m.model}: ${m.summary.replace(/\s+/g, " ").slice(0, 100)}`);
  }
  if (run.changed) lines.push("", `--changed: ${run.changed.files.length} file(s) changed -> stages ${run.changed.stages.join(", ") || "none"} -> ran ${run.changed.items.length} item(s); the rest replayed`);
  return lines.join("\n");
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderHtml(run: SmokeRun): string {
  const used = SMOKE_STAGES.filter((s) => run.items.some((i) => i.stages[s]));
  const cell = (v: { ok: boolean; detail: string } | undefined): string => v ? `<td class="${v.ok ? "ok" : "bad"}" title="${esc(v.detail)}">${v.ok ? "pass" : "FAIL"}</td>` : `<td class="na">-</td>`;
  const t = stageTotals(run.items);
  const pass = run.items.filter((i) => i.ok).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smoke run</title>
<style>
:root{--bg:#fff;--fg:#0f172a;--mut:#64748b;--ok:#15803d;--okbg:#dcfce7;--bad:#b91c1c;--badbg:#fee2e2;--line:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--fg:#e2e8f0;--mut:#94a3b8;--ok:#86efac;--okbg:#14532d;--bad:#fca5a5;--badbg:#7f1d1d;--line:#1e293b}}
body{font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:16px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--mut);margin:2px 0}table{border-collapse:collapse;margin:16px 0;width:100%}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}th{color:var(--mut);font-weight:600}
td.ok{background:var(--okbg);color:var(--ok);font-weight:600}td.bad{background:var(--badbg);color:var(--bad);font-weight:700}td.na{color:var(--mut)}
td.num{text-align:right;font-variant-numeric:tabular-nums}.wrap{overflow-x:auto}code{font-size:12px}
</style></head><body>
<h1>Smoke run: ${pass} of ${run.items.length} items pass</h1>
<p>${esc(run.mode)}${run.cassette ? `, cassette <code>${esc(run.cassette.name)}</code> (${esc(run.cassette.mode)})` : ""}, models <code>${esc(run.models.primary)}</code>${run.models.tiers === "smoke" ? ` then <code>${esc(run.models.fallback)}</code>` : " (the product's ladders)"}</p>
<p>Cost ₹${run.spentInr.toFixed(2)} of a ₹${run.capInr} cap${run.replayedInr ? `; replayed answers had cost ₹${run.replayedInr.toFixed(2)} when recorded` : ""}${run.aborted ? `; <b>stopped: ${esc(run.aborted)}</b>` : ""}. ${esc(run.startedAt)}</p>
<div class="wrap"><table><thead><tr><th>#</th><th>Item</th>${used.map((s) => `<th>${esc(STAGE_NAMES[s])}</th>`).join("")}<th>Cost</th><th>Time</th></tr></thead><tbody>
${run.items.map((i) => `<tr><td>${i.n}</td><td>${esc(i.title)}</td>${used.map((s) => cell(i.stages[s])).join("")}<td class="num">${inr(i.costPaise)}</td><td class="num">${(i.ms / 1000).toFixed(0)}s</td></tr>`).join("\n")}
<tr><td></td><td><b>Stage totals</b></td>${used.map((s) => `<td><b>${t[s].pass}/${t[s].pass + t[s].fail}</b></td>`).join("")}<td></td><td></td></tr></tbody></table></div>
${run.items.some((i) => !i.ok) ? `<h2>What failed</h2><ul>${run.items.filter((i) => !i.ok).flatMap((i) => Object.entries(i.stages).filter(([, v]) => v && !v.ok).map(([s, v]) => `<li>${i.n}. ${esc(i.title)} <b>[${esc(STAGE_NAMES[s as SmokeStage])}]</b> ${esc(v!.detail)}</li>`)).join("")}</ul>` : ""}
${run.misses.length ? `<h2>Cassette misses (${run.misses.length})</h2><ul>${run.misses.slice(0, 20).map((m) => `<li>${esc(m.item)} ${esc(m.purpose ?? "")} ${esc(m.model)}: ${esc(m.summary.slice(0, 120))}</li>`).join("")}</ul>` : ""}
</body></html>`;
}
