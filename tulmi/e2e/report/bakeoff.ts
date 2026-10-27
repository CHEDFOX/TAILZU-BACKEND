/**
 * THE BAKE-OFF SCOREBOARD: PASS RATE, COST PER PASS, LATENCY AND ERRORS PER CANDIDATE PER TIER, THE EDIT FORMAT EACH PREFERS, AND THE LADDERS THAT FOLLOW.
 */
import type { Summary } from "../bakeoff/engine.js";
import type { Ladders } from "../bakeoff/ladders.js";
import { BAKEOFF_TIERS } from "../bakeoff/pools.js";
import { esc, page, scatter, type Dot } from "./svg.js";

export interface BakeoffRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  mode: "real" | "sim";
  tiers: string[];
  fx: number;
  spentInr: number;
  capInr: number;
  summaries: Summary[];
  ladders: Ladders;
  excluded: Array<{ slug: string; tier: string; reason: string }>;
  aborted?: string;
  args: string[];
}

const pc = (v: number | null): string => (v === null ? "-" : `${Math.round(v * 100)}%`);
const ms = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

export function renderScoreboardText(r: BakeoffRun): string {
  const L: string[] = [`BAKE-OFF ${r.mode}${r.mode === "sim" ? " (simulated models: not a measurement)" : ""}   spent ₹${r.spentInr.toFixed(2)} of ₹${r.capInr}${r.aborted ? `   STOPPED: ${r.aborted}` : ""}`];
  for (const tier of BAKEOFF_TIERS) {
    const rows = r.summaries.filter((s) => s.tier === tier);
    if (!rows.length) continue;
    L.push("", `${tier}`, `  ${"model".padEnd(34)} ${"quality".padStart(7)} ${"probes".padStart(6)} ${"evals".padStart(6)} ${"tasks".padStart(6)} ${"₹/pass".padStart(8)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"errors".padStart(6)}  note`);
    for (const s of [...rows].sort((a, b) => (a.dropped ? 1 : 0) - (b.dropped ? 1 : 0) || b.quality - a.quality)) {
      const cpp = Number.isFinite(s.costPerPassUsd) ? (s.costPerPassUsd * r.fx).toFixed(4) : "-";
      L.push(`  ${s.slug.padEnd(34)} ${pc(s.quality).padStart(7)} ${pc(s.passRate.probes).padStart(6)} ${pc(s.passRate.evals).padStart(6)} ${pc(s.passRate.tasks).padStart(6)} ${cpp.padStart(8)} ${ms(s.latencyP50Ms).padStart(7)} ${ms(s.latencyP95Ms).padStart(7)} ${pc(s.errorRate).padStart(6)}  ${s.dropped ? `dropped (${s.dropped.round})` : ""}${s.edit ? ` edit: ${s.edit.best}` : ""}`);
    }
  }
  L.push("", "LADDERS (cheapest per pass first, quality floor applied):");
  for (const [t, l] of Object.entries(r.ladders.tiers)) L.push(`  ${t.padEnd(7)} ${l!.models.join("  ->  ")}${l!.note ? `   [${l!.note}]` : ""}`);
  for (const n of r.ladders.notes) L.push(`  note: ${n}`);
  L.push("", `CODE_MODEL_TIERS=${r.ladders.codeModelTiers}`);
  if (r.ladders.codeIndicModel) L.push(`CODE_INDIC_MODEL=${r.ladders.codeIndicModel}`);
  return L.join("\n");
}

export function renderScoreboardHtml(r: BakeoffRun): string {
  const sections = BAKEOFF_TIERS.filter((t) => r.summaries.some((s) => s.tier === t)).map((tier) => {
    const rows = r.summaries.filter((s) => s.tier === tier).sort((a, b) => (a.dropped ? 1 : 0) - (b.dropped ? 1 : 0) || b.quality - a.quality);
    const dots: Dot[] = rows.filter((s) => Number.isFinite(s.costPerPassUsd) && s.costPerPassUsd > 0).map((s) => ({ label: s.slug.split("/")[1] ?? s.slug, x: s.costPerPassUsd * r.fx, y: s.quality, tone: s.dropped ? "bad" : "ok" }));
    const body = rows.map((s) => `<tr><td><code>${esc(s.slug)}</code></td><td class="num">${pc(s.quality)}</td><td class="num">${pc(s.passRate.probes)}</td><td class="num">${pc(s.passRate.evals)}</td><td class="num">${pc(s.passRate.tasks)}</td><td class="num">${Number.isFinite(s.costPerPassUsd) ? `₹${(s.costPerPassUsd * r.fx).toFixed(4)}` : "-"}</td><td class="num">${ms(s.latencyP50Ms)}</td><td class="num">${ms(s.latencyP95Ms)}</td><td class="num">${pc(s.errorRate)}</td><td class="num">${s.jsonRepairs}/${s.badToolCalls}</td><td>${s.dropped ? `<span class="pill bad">dropped after ${esc(s.dropped.round)}</span>` : `<span class="pill ok">kept</span>`}${s.edit ? ` edit: <b>${esc(s.edit.best)}</b> (${Math.round(s.edit.rates.exact * 100)}/${Math.round(s.edit.rates.blocks * 100)}/${Math.round(s.edit.rates.diff * 100)}%)` : ""}</td></tr>`).join("");
    return `<h2>${esc(tier)}</h2><div class="wrap"><table><thead><tr><th>Model</th><th>Quality</th><th>Probes</th><th>Evals</th><th>Tasks</th><th>Cost / pass</th><th>p50</th><th>p95</th><th>Errors</th><th>JSON repairs / bad tool calls</th><th></th></tr></thead><tbody>${body}</tbody></table></div>${scatter(dots, { xLabel: "cost per pass, ₹", yLabel: "quality", logX: true })}`;
  }).join("");
  const ladders = Object.entries(r.ladders.tiers).map(([t, l]) => `<tr><td>${esc(t)}</td><td>${l!.why.map((w) => `<code>${esc(w.slug)}</code> <span class="mut">${Math.round(w.quality * 100)}%${w.costPerPassInr !== null ? `, ₹${w.costPerPassInr}/pass` : ""}</span>`).join(" &rarr; ")}${l!.note ? `<br><span class="mut">${esc(l!.note)}</span>` : ""}</td></tr>`).join("");
  const body = `<h1>Model bake-off: ${esc(r.id)}</h1>
<p class="mut">${esc(r.startedAt)} · ${r.mode === "sim" ? "<b class=\"bad\">simulated models: this proves the machinery, it is not a measurement of any model</b>" : "real models"} · spent ₹${r.spentInr.toFixed(2)} of a ₹${r.capInr} cap${r.aborted ? ` · <b class="bad">stopped: ${esc(r.aborted)}</b>` : ""}</p>
<h2>Ladders</h2><div class="wrap"><table><tbody>${ladders}</tbody></table></div>
<p>Set in the environment:</p><pre>CODE_MODEL_TIERS='${esc(r.ladders.codeModelTiers)}'${r.ladders.codeIndicModel ? `\nCODE_INDIC_MODEL=${esc(r.ladders.codeIndicModel)}` : ""}</pre>${r.ladders.notes.map((n) => `<p class="mut">${esc(n)}</p>`).join("")}
${sections}
${r.excluded.length ? `<h2>Left out by the capability filter</h2><ul>${r.excluded.map((e) => `<li><code>${esc(e.slug)}</code> (${esc(e.tier)}): ${esc(e.reason)}</li>`).join("")}</ul>` : ""}`;
  return page(`Bake-off ${r.id}`, body);
}
