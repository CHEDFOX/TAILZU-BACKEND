/**
 * THE RUN REPORT: ONE SELF-CONTAINED HTML PAGE (inline SVG, no libraries) FROM A RUN'S RESULTS.
 *
 * Success and cost at the top; success by category; where failures were blamed (front door, locate, plan, work, verify, design, commit); the models and tiers
 * the calls went to, with their cost and failure rates; every task with its stage verdicts; and the top failure causes, each with examples and the checks
 * that failed. Nothing is fetched: the page works offline and in both colour themes.
 */
import type { RunFile, RunRecord } from "../run.js";
import { STAGES } from "../score/stages.js";
import { barChart, esc, page, type Bar } from "./svg.js";

const inr = (paise: number): string => `₹${(paise / 100).toFixed(2)}`;
const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : "-");

export interface Aggregate {
  total: number;
  ran: number;
  success: number;
  costPaise: number;
  wallMs: number;
  byCategory: Array<{ category: string; n: number; success: number }>;
  failedAt: Record<string, number>;
  models: Array<{ model: string; calls: number }>;
  tiers: Array<{ tier: string; calls: number }>;
  causes: Array<{ cause: string; stage: string; count: number; examples: Array<{ task: string; detail: string }> }>;
  cassette?: { hits: number; recorded: number; misses: number; spentUsd: number; replayedUsd: number };
}

/** The part of a failure's reason that says WHAT went wrong, without the names of files and numbers that make every instance unique. */
export function causeOf(reason: string): string {
  return reason
    .replace(/`[^`]*`/g, "`…`").replace(/"[^"]*"/g, "\"…\"").replace(/\b[\w./-]+\.(?:js|ts|tsx|jsx|py|json|md)\b/g, "<file>").replace(/\d+/g, "N")
    .replace(/\s+/g, " ").trim().slice(0, 90);
}

export function aggregate(f: RunFile): Aggregate {
  const rs = f.results;
  const scored = rs.filter((r) => r.score);
  const cats = new Map<string, { n: number; success: number }>();
  const failedAt: Record<string, number> = {};
  const models = new Map<string, number>();
  const tiers = new Map<string, number>();
  const causes = new Map<string, { cause: string; stage: string; count: number; examples: Array<{ task: string; detail: string }> }>();
  const cass = { hits: 0, recorded: 0, misses: 0, spentUsd: 0, replayedUsd: 0 };
  let hasCass = false;
  for (const r of rs) {
    const c = cats.get(r.task.category) ?? { n: 0, success: 0 };
    c.n += 1;
    if (r.score?.success) c.success += 1;
    cats.set(r.task.category, c);
    if (r.cassette) { hasCass = true; cass.hits += r.cassette.hits; cass.recorded += r.cassette.recorded; cass.misses += r.cassette.misses; cass.spentUsd += r.cassette.spentUsd; cass.replayedUsd += r.cassette.replayedUsd; }
    const s = r.score;
    if (!s) continue;
    for (const [m, n] of Object.entries(s.metrics.models)) models.set(m, (models.get(m) ?? 0) + n);
    for (const [t, n] of Object.entries(s.metrics.tiers)) tiers.set(t, (tiers.get(t) ?? 0) + n);
    if (s.success) continue;
    const stage = s.stage.failedAt ?? "work";
    failedAt[stage] = (failedAt[stage] ?? 0) + 1;
    const cause = causeOf(s.stage.reason || s.checks.find((x) => !x.ok && x.required)?.detail || "it did not meet the task's checks");
    const key = `${stage}|${cause}`;
    const e = causes.get(key) ?? { cause, stage, count: 0, examples: [] };
    e.count += 1;
    if (e.examples.length < 3) e.examples.push({ task: r.task.id, detail: (s.stage.reason || s.checks.filter((x) => !x.ok && x.required).map((x) => x.detail).join("; ")).slice(0, 220) });
    causes.set(key, e);
  }
  return {
    total: rs.length, ran: scored.length, success: scored.filter((r) => r.score!.success).length,
    costPaise: scored.reduce((n, r) => n + r.score!.metrics.costPaise + r.score!.metrics.judgePaise, 0), wallMs: scored.reduce((n, r) => n + r.score!.metrics.wallMs, 0),
    byCategory: [...cats].map(([category, v]) => ({ category, ...v })).sort((a, b) => (a.category < b.category ? -1 : 1)),
    failedAt, models: [...models].map(([model, calls]) => ({ model, calls })).sort((a, b) => b.calls - a.calls),
    tiers: [...tiers].map(([tier, calls]) => ({ tier, calls })).sort((a, b) => b.calls - a.calls),
    causes: [...causes.values()].sort((a, b) => b.count - a.count).slice(0, 10), ...(hasCass ? { cassette: cass } : {}),
  };
}

const dot = (v: { status: string; reason: string } | undefined): string => {
  if (!v || v.status === "skip") return `<td class="mut" title="not applicable">-</td>`;
  return `<td class="${v.status === "ok" ? "ok" : "bad"}" title="${esc(v.reason)}">${v.status === "ok" ? "ok" : "FAIL"}</td>`;
};

export function buildReport(f: RunFile): string {
  const a = aggregate(f);
  const m = f.meta;
  const fx = m.fx || 88;
  const cards = [
    ["Success", `${a.success}/${a.ran}`, pct(a.success, a.ran)], ["Cost", inr(a.costPaise), m.capPaise ? `of ${inr(m.capPaise)} cap` : "no cap"],
    ["Wall time", `${(a.wallMs / 60000).toFixed(1)} min`, `${a.ran} runs`], ["Mode", m.mode, m.hasKey ? "key present" : "no key"],
  ].map(([k, v, s]) => `<div class="card"><span class="mut">${esc(k!)}</span><b>${esc(v!)}</b><span class="mut">${esc(s!)}</span></div>`).join("");
  const catBars: Bar[] = a.byCategory.map((c) => ({ label: c.category, value: c.success, of: c.n, tone: c.success === c.n ? "ok" : c.success === 0 ? "bad" : "mid" }));
  const failBars: Bar[] = STAGES.map((s) => ({ label: s, value: a.failedAt[s] ?? 0, tone: (a.failedAt[s] ?? 0) ? "bad" : "plain" }));
  const modelBars: Bar[] = a.models.slice(0, 12).map((x) => ({ label: x.model, value: x.calls, tone: "plain" }));
  const tierBars: Bar[] = a.tiers.map((x) => ({ label: x.tier, value: x.calls, tone: "plain" }));
  const rows = f.results.map((r: RunRecord) => {
    const s = r.score;
    const v = s?.stage.verdicts;
    return `<tr><td><code>${esc(r.task.id)}</code>${r.repeat > 1 ? ` #${r.repeat}` : ""}<br><span class="mut">${esc(r.task.category)} · ${esc(r.agent)}${r.persona ? ` · ${esc(r.persona)}` : ""}</span></td>`
      + `<td class="${s?.success ? "ok" : "bad"}">${r.skipped ? "skipped" : r.error ? "error" : s?.success ? "success" : "failed"}</td>`
      + STAGES.map((st) => dot(v?.[st])).join("")
      + `<td class="num">${s ? inr(s.metrics.costPaise + s.metrics.judgePaise) : "-"}</td><td class="num">${s ? `${(s.metrics.wallMs / 1000).toFixed(0)}s` : "-"}</td><td class="num">${s ? s.metrics.turns : "-"}</td></tr>`;
  }).join("");
  const causes = a.causes.map((c) => `<details><summary><b>${c.count}×</b> <span class="pill bad">${esc(c.stage)}</span> ${esc(c.cause)}</summary>${c.examples.map((e) => `<pre><b>${esc(e.task)}</b>\n${esc(e.detail)}</pre>`).join("")}</details>`).join("") || `<p class="mut">No failures.</p>`;
  const body = `
<h1>Reality check: ${esc(m.id)}</h1>
<p class="mut">${esc(m.startedAt)} to ${esc(m.finishedAt)} · node ${esc(m.node)} · ${esc(m.args.join(" "))}${m.aborted ? ` · <b class="bad">stopped: ${esc(m.aborted)}</b>` : ""}</p>
<div class="cards">${cards}</div>
<h2>Success by category</h2>${barChart(catBars, { max: Math.max(1, ...a.byCategory.map((c) => c.n)) })}
<h2>Where the failures were blamed</h2>${barChart(failBars, { max: Math.max(1, ...Object.values(a.failedAt)), format: (b) => String(b.value) })}
<h2>Top failure causes</h2>${causes}
<h2>Models and tiers the calls went to</h2><div style="display:flex;flex-wrap:wrap;gap:24px"><div style="flex:1;min-width:300px">${barChart(modelBars, { format: (b) => String(b.value), labelWidth: 220 })}</div><div style="flex:1;min-width:260px">${barChart(tierBars, { format: (b) => String(b.value) })}</div></div>
${a.cassette ? `<h2>Cassettes</h2><p>${a.cassette.hits} answer(s) replayed, ${a.cassette.recorded} recorded, ${a.cassette.misses} miss(es). Spent ₹${(a.cassette.spentUsd * fx).toFixed(2)}; the replayed answers had cost ₹${(a.cassette.replayedUsd * fx).toFixed(2)} when recorded.</p>` : ""}
<h2>Every run</h2><div class="wrap"><table><thead><tr><th>Task</th><th>Result</th>${STAGES.map((s) => `<th>${s}</th>`).join("")}<th>Cost</th><th>Time</th><th>Turns</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>The projects</h2><div class="wrap"><table><thead><tr><th>Project</th><th>Stack</th><th>Pinned at</th><th>Tests</th></tr></thead><tbody>${m.repos.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.stack)}</td><td><code>${esc(r.pin.slice(0, 10))}</code></td><td>${r.tests ?? "-"}${r.testSec ? ` in ${r.testSec}s` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  return page(`Reality check ${m.id}`, body);
}
