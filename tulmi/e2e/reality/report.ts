/**
 * THE REPORT: ONE SELF-CONTAINED HTML PAGE (e2e/out/reality/latest.html) AND A SHORT MARKDOWN SUMMARY THAT IS COMMITTED (e2e/REALITY.md).
 *
 * What it says, in the order a person needs it:
 *   1. a verdict per area (working, weak or broken, with the results behind it)
 *   2. the five things to fix next, clustered from the failures by stage and cause, with examples
 *   3. the winner of each comparison and how sure we are, with the rounds that stopped it and the efficiency frontier (success against rupees per success)
 *   4. the performance of each arm: success, where it failed, cost per success, time to green, steps, tool errors, wasted steps, questions, regressions, safety, variance
 *   5. the CODE_MODEL_TIERS the evidence supports
 *   6. what is still unknown, and the cheapest next run that would answer it
 *   7. the stages: estimate against spend, what was reused, what was cut short; stage 0's finds (the offline suite, the cassettes, the free parts)
 *   8. the commands to run the big comparisons in a session where installs are allowed
 * A simulated or scripted run says so in its first line and in every section that rests on it. No library: inline SVG, colours from CSS variables for both themes.
 */
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, mkdirp } from "../util.js";
import { summaryFingerprint } from "./fingerprint.js";
import { analyze, frontier, type Analysis, type ArmSummary } from "./analysis.js";
import { commandList, missingRepos, missingTools } from "./installs.js";
import { totalsOf, type Ctx } from "./plan.js";
import type { RunState } from "./stages.js";
import type { ComparisonReport, StageEstimate } from "./types.js";

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const inr = (x: number): string => `₹${x >= 100 ? x.toFixed(0) : x.toFixed(2)}`;
const pct = (x: number, d = 0): string => `${(x * 100).toFixed(d)}%`;
const secs = (ms: number | null): string => (ms === null ? "-" : `${(ms / 1000).toFixed(0)}s`);

export interface PlanEstimate { plan: string; tasks: number; stages: StageEstimate[] }

export interface ReportInput {
  main: RunState;
  /** The no-key proof (--prove): stage 0 is real, the rest is replayed, simulated or scripted. */
  prove?: boolean;
  /** The simulated runs that prove the stopping rule (a clear winner, a tie), shown apart. */
  demos: Array<{ title: string; state: RunState }>;
  /** The estimates of the three plans, for the summary. */
  plans: PlanEstimate[];
  estimates: StageEstimate[];
}

const STATUS_ICON: Record<string, string> = { working: "✔", weak: "◐", broken: "✘", unknown: "?" };

const CSS = `
:root{--bg:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--mute:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--accent:#2a78d6;--good:#006300;--goodbg:#e4f3e4;--warn:#8a5a00;--warnbg:#fdf0d2;--bad:#b02a2a;--badbg:#fbe4e4;--unk:#52514e;--unkbg:#eceae4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#898781;--grid:#2c2c2a;--axis:#383835;--accent:#3987e5;--good:#0ca30c;--goodbg:#10301a;--warn:#fab219;--warnbg:#3a2d0a;--bad:#ec7a7a;--badbg:#3a1616;--unk:#c3c2b7;--unkbg:#2c2c2a}}
:root[data-theme="dark"]{--bg:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--mute:#898781;--grid:#2c2c2a;--axis:#383835;--accent:#3987e5;--good:#0ca30c;--goodbg:#10301a;--warn:#fab219;--warnbg:#3a2d0a;--bad:#ec7a7a;--badbg:#3a1616;--unk:#c3c2b7;--unkbg:#2c2c2a}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--grid)}h3{font-size:14px;margin:18px 0 6px}
p{margin:6px 0}.mut{color:var(--ink2)}.banner{background:var(--warnbg);color:var(--warn);border:1px solid var(--warn);border-radius:6px;padding:8px 12px;margin:10px 0;font-weight:600}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.card{background:var(--surface);border:1px solid var(--grid);border-radius:8px;padding:8px 14px;min-width:130px}.card b{display:block;font-size:22px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;background:var(--surface)}th,td{border-bottom:1px solid var(--grid);padding:5px 8px;text-align:left;vertical-align:top}th{color:var(--ink2);font-weight:600;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pill{display:inline-block;border-radius:999px;padding:0 9px;font-size:12px;font-weight:600;white-space:nowrap}.pill.working{background:var(--goodbg);color:var(--good)}.pill.weak{background:var(--warnbg);color:var(--warn)}.pill.broken{background:var(--badbg);color:var(--bad)}.pill.unknown{background:var(--unkbg);color:var(--unk)}
code,pre{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}pre{white-space:pre-wrap;background:var(--surface);border:1px solid var(--grid);border-radius:6px;padding:8px 10px;margin:6px 0;overflow-x:auto}
details{margin:6px 0}summary{cursor:pointer}ol.fix>li{margin:10px 0}.ex{color:var(--ink2);font-size:12px}
svg text{fill:var(--ink);font-size:12px}svg .m{fill:var(--ink2)}svg .grid{stroke:var(--grid);stroke-width:1}svg .axis{stroke:var(--axis);stroke-width:1}svg .front{stroke:var(--ink2);stroke-width:2;fill:none}
`;

// ------------------------------------------------------------------------------------ the frontier

/** Success rate against rupees per success, one point per arm, 95% Wilson bars, the efficiency frontier joined, ours in the accent colour and the rest in ink. */
export function frontierSvg(arms: readonly ArmSummary[]): string {
  const withCost = arms.filter((a) => a.n > 0);
  if (withCost.length < 2) return `<p class="mut">The frontier needs at least two arms with results.</p>`;
  const finite = withCost.filter((a) => Number.isFinite(a.costPerSuccess.point) && a.costPerSuccess.point > 0);
  if (!finite.length) return `<p class="mut">No arm has a success yet, so there is no cost per success to plot.</p>`;
  const W = 720, H = 380, m = { l: 52, r: 120, t: 16, b: 48 };
  const lo = Math.log10(Math.min(...finite.map((a) => a.costPerSuccess.point)) / 1.6);
  const hi = Math.log10(Math.max(...finite.map((a) => a.costPerSuccess.point)) * 1.6);
  const span = hi - lo || 1;
  const x = (v: number): number => m.l + ((Math.log10(v) - lo) / span) * (W - m.l - m.r);
  const xInf = W - m.r + 36;
  const y = (v: number): number => H - m.b - v * (H - m.t - m.b);
  const front = frontier(withCost.map((a) => ({ id: `${a.group}/${a.id}`, rate: a.rate, cost: Number.isFinite(a.costPerSuccess.point) ? a.costPerSuccess.point : Number.POSITIVE_INFINITY })));
  const pts = withCost.map((a) => ({ a, cx: Number.isFinite(a.costPerSuccess.point) && a.costPerSuccess.point > 0 ? x(a.costPerSuccess.point) : xInf, ours: /^tailzu(:|$)/.test(a.id) && !/:(fake)$/.test(a.id) }));
  const onF = pts.filter((p) => front.has(`${p.a.group}/${p.a.id}`) && Number.isFinite(p.a.costPerSuccess.point)).sort((p, q) => p.cx - q.cx);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line class="grid" x1="${m.l}" x2="${W - m.r + 60}" y1="${y(t)}" y2="${y(t)}"/><text class="m" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${Math.round(t * 100)}%</text>`).join("");
  const xt: string[] = [];
  for (let e = Math.ceil(lo * 2) / 2; e <= hi; e += 0.5) { const v = 10 ** e; xt.push(`<line class="axis" x1="${x(v)}" x2="${x(v)}" y1="${H - m.b}" y2="${H - m.b + 4}"/><text class="m" x="${x(v)}" y="${H - m.b + 18}" text-anchor="middle">${v >= 10 ? v.toFixed(0) : v.toFixed(1)}</text>`); }
  const marks = pts.map((p) => {
    const colour = p.ours ? "var(--accent)" : "var(--ink2)";
    const w = p.a.wilson95;
    const tip = `${p.a.id}: ${p.a.pass}/${p.a.n} pass (${pct(p.a.rate)}; 95% ${pct(w.lo)} to ${pct(w.hi)}), ${Number.isFinite(p.a.costPerSuccess.point) ? `${inr(p.a.costPerSuccess.point)} per success` : "no success yet"}${p.a.dominatedBy ? `, dominated by ${p.a.dominatedBy}` : ""}`;
    return `<g><title>${esc(tip)}</title><line x1="${p.cx}" x2="${p.cx}" y1="${y(w.lo)}" y2="${y(w.hi)}" stroke="${colour}" stroke-width="2" opacity="0.55"/><circle cx="${p.cx}" cy="${y(p.a.rate)}" r="5.5" fill="${colour}" stroke="var(--surface)" stroke-width="2"/><text x="${p.cx + 9}" y="${y(p.a.rate) + 4}" ${p.ours ? 'font-weight="700"' : ""}>${esc(p.a.id.replace(/^tailzu:/, "ours: ").replace(/^ours: ladders$/, "ours (current ladders)").slice(0, 26))}</text></g>`;
  }).join("");
  const line = onF.length >= 2 ? `<polyline class="front" points="${onF.map((p) => `${p.cx},${y(p.a.rate)}`).join(" ")}"><title>the efficiency frontier: no arm beats these on both success and cost</title></polyline>` : "";
  return `<svg role="img" aria-label="Success rate against rupees per success, one point per arm" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${ticks}${xt.join("")}<line class="axis" x1="${m.l}" x2="${W - m.r + 60}" y1="${H - m.b}" y2="${H - m.b}"/>${line}${marks}<text class="m" x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle">rupees per success (log scale; right edge: no success yet)</text><text class="m" x="14" y="${H / 2}" transform="rotate(-90 14 ${H / 2})" text-anchor="middle">success rate</text></svg>`;
}

// ------------------------------------------------------------------------------------- the pieces

const table = (head: readonly string[], rows: readonly (readonly string[])[], numFrom = 99): string =>
  `<div class="wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i >= numFrom ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

const pill = (v: string): string => `<span class="pill ${v}">${STATUS_ICON[v]} ${v}</span>`;

function comparisonHtml(c: ComparisonReport, arms: ArmSummary[], simulated: boolean): string {
  const mine = arms.filter((a) => a.group === c.id);
  const rows = mine.map((a) => [
    `<b>${esc(a.id)}</b>${a.dominatedBy ? ` <span class="mut">(dropped: ${esc(a.dominatedBy)} beats it on success and cost)</span>` : ""}`,
    `${a.pass}/${a.n}`, `${pct(a.rate)} <span class="mut">(${pct(a.wilson95.lo)} to ${pct(a.wilson95.hi)})</span>`, a.pBest.toFixed(2),
    Number.isFinite(a.costPerSuccess.point) ? `${inr(a.costPerSuccess.point)} <span class="mut">(${inr(a.costPerSuccess.lo)} to ${Number.isFinite(a.costPerSuccess.hi) ? inr(a.costPerSuccess.hi) : "∞"})</span>` : "no success",
    a.onFrontier ? "yes" : "",
  ]);
  const endText: Record<ComparisonReport["ended"], string> = {
    clear: "DECIDED: the leader is the best with the confidence asked for", last: "DECIDED: every other arm is dominated", tie: "NO WINNER: the tasks ran out with the intervals still overlapping (a tie at this resolution)",
    budget: "STOPPED by the money before the answer was clear", overrun: "ABORTED: the stage ran 30% over its estimate", short: "TOO FEW RESULTS to conclude anything",
  };
  return `<h3>${esc(c.title)} ${simulated ? '<span class="pill weak">simulated</span>' : ""}</h3>
<p><b>${esc(endText[c.ended])}</b>${c.winner ? `: <b>${esc(c.winner)}</b>` : ""}. ${esc(c.final.reason)}. ${c.rounds.length} round(s), ${c.tasks.length} task(s) of the sample used; ${c.runsSaved} arm-by-task run(s) never needed; ${c.repeats} repeat(s) for unstable results.</p>
${table(["arm", "tasks passed", "success rate (95% Wilson)", "P(best)", "rupees per success (90%)", "on the frontier"], rows, 1)}
<details><summary>The rounds: what the numbers said after each</summary>${table(["round", "tasks added", "state", "what it said", "dropped"], c.rounds.map((r) => [String(r.round), esc(r.tasks.join(", ")), r.decision.state, esc(r.decision.reason), esc(r.decision.drop.join(", ") || "-")]))}</details>
${frontierSvg(mine)}`;
}

function perfHtml(arms: ArmSummary[]): string {
  if (!arms.length) return `<p class="mut">No arm has results yet.</p>`;
  const rows = arms.map((a) => {
    const p = a.perf;
    const fails = Object.entries(p.failedAt).map(([k, v]) => `${k} ${v}`).join(", ") || "-";
    return [`<b>${esc(a.id)}</b>`, `${a.pass}/${a.n}`, esc(fails), Number.isFinite(a.costPerSuccess.point) ? inr(a.costPerSuccess.point) : "-", secs(p.medianTimeToGreenMs), `${p.meanTurns.toFixed(1)} / ${p.meanToolCalls.toFixed(1)}`, pct(p.toolErrorRate), pct(p.wasteShare), p.meanQuestions.toFixed(1), String(p.regressions), p.attackRuns ? `${p.attackSuccesses}/${p.attackRuns} attacks${p.secretRuns ? `, ${p.secretLeaks}/${p.secretRuns} leaks` : ""}` : "-", `${p.flaky.tasks.length}/${p.flaky.repeated} flaky, sd ${pct(p.rateSd)}`];
  });
  return table(["arm", "pass", "failed at", "₹ / success", "time to green", "turns / tool calls", "tool errors", "wasted steps", "questions", "regressions", "safety", "variance"], rows, 1);
}

// ----------------------------------------------------------------------------------------- the page

export function buildHtml(inp: ReportInput): string {
  const st = inp.main;
  const ctx = st.ctx;
  const a = analyze(st, inp.estimates);
  const simulated = ctx.mode === "sim" || ctx.mode === "scripted";
  const counts = { working: 0, weak: 0, broken: 0, unknown: 0 } as Record<string, number>;
  for (const v of a.verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  const totals = totalsOf(inp.estimates);
  const fp = summaryFingerprint();
  const stageRows = st.stages.map((s) => [`${s.stage}. ${esc(s.title)}`, esc(s.status), inr(s.estimateInr), inr(s.spentInr), s.reusedInr ? inr(s.reusedInr) : "-", esc(s.reason ?? "")]);
  const cassetteRows = st.replays.map((r) => [`<code>${esc(r.cassette)}</code>`, r.kind, String(r.items.length), Object.entries(r.boxes).map(([k, v]) => `${v} ${k}`).join(", "), `${r.hits} / ${r.misses}`, inr(r.recordedInr), esc(r.changedFiles.length ? `${r.changedFiles.length} source file(s) changed since: ${r.changedFiles.slice(0, 3).join(", ")}${r.changedFiles.length > 3 ? ", ..." : ""} (stages ${r.affectedStages.join(", ")})` : r.note + (r.documented.length ? ` | ${r.documented[0]}` : ""))]);
  const cmds = commandList({ plan: ctx.plan, budgetInr: Math.ceil(totals.maxInr), missingRepos: missingRepos(), missingTools: missingTools(), estimateByStage: Object.fromEntries(inp.estimates.map((e) => [e.stage, e.expectedInr])) });
  const arms = a.arms;
  const body = `
<h1>Reality check: ${esc(ctx.plan)} plan, ${esc(ctx.mode)} mode</h1>
<p class="mut">${esc(st.startedAt)} · run ${esc(st.runId)} · code ${esc(fp.product)} · model door ${esc(fp.modelDoor)} · prompts ${esc(fp.prompts)}</p>
${simulated ? `<div class="banner">${ctx.mode === "sim" ? "SIMULATED: every number from stage 1 on is drawn from a known truth to prove the logic. It measures nothing." : "SCRIPTED: stages 3 and 4 ran Tailzu's real flow on the harness's scripted models. The outcomes are the script's, not a model's."} Stage 0 is real in every mode.</div>` : ""}
<div class="cards">
<div class="card"><span class="mut">Spent</span><b>${inr(st.spentInr)}</b><span class="mut">of ₹${ctx.budgetInr} budget</span></div>
<div class="card"><span class="mut">Plan estimate</span><b>${inr(totals.expectedInr)}</b><span class="mut">at most ${inr(totals.maxInr)}</span></div>
<div class="card"><span class="mut">Already paid (reused)</span><b>${inr(totals.reusedInr)}</b><span class="mut">never paid twice</span></div>
<div class="card"><span class="mut">Areas</span><b>${counts.working} ✔ ${counts.weak} ◐ ${counts.broken} ✘</b><span class="mut">${counts.unknown} not measured</span></div>
</div>
${st.aborted.length ? `<div class="banner">${esc(st.aborted.join("; "))}</div>` : ""}

<h2>Verdict per area</h2>
<p class="mut">Working: at least three in four pass and the 90% interval's low end is above one half. Broken: a third or fewer pass. Weak: between. "thin": fewer than five results.</p>
${table(["area", "verdict", "results", "90% interval", "basis"], a.verdicts.map((v) => [esc(v.area), pill(v.verdict), v.show ?? (v.n ? `${v.pass}/${v.n}${v.thin ? ' <span class="mut">thin</span>' : ""}` : "-"), v.n && v.lo + v.hi > 0 && v.hi - v.lo < 1 ? `${pct(v.lo)} to ${pct(v.hi)}` : "-", esc(v.basis)]))}

<h2>The five things to fix next</h2>
<p class="mut">Failures clustered by the stage that went wrong (the first stage to fail takes the blame) and the cause with file names and numbers taken out; ranked by how many and how early in the flow.</p>
${a.fixes.length ? `<ol class="fix">${a.fixes.map((f) => `<li><b>${esc(f.stage)}</b>: ${esc(f.cause)} <span class="mut">(${f.count} case(s))</span><br><span class="mut">look at: ${esc(f.where)}</span>${f.examples.map((e) => `<div class="ex"><code>${esc(e.id)}</code> [${esc(e.source)}] ${esc(e.detail)}</div>`).join("")}</li>`).join("")}</ol>` : `<p>No failures in the evidence.</p>`}

<h2>Winners, and how sure we are</h2>
${st.comparisons.some((c) => c.runs.length) ? st.comparisons.filter((c) => c.runs.length).map((c) => comparisonHtml(c, arms, simulated)).join("") : `<p>No comparison has run with results in this run${ctx.mode === "replay" ? ": replay mode answers only what was recorded, and no comparison was" : ""}. ${esc(st.stages.find((s) => s.stage === 4)?.reason ?? "")} The cheapest way to get one is in the table below.</p>`}
${inp.demos.length ? `<h3>Proof of the stopping rule, on simulated contestants</h3><p class="mut">No key: the same code, with outcomes drawn from a known truth. A clear winner must be found early and the losers dropped; a tie must not be called.</p>${inp.demos.map((d) => `<h4>${esc(d.title)}</h4>${d.state.comparisons.map((c) => comparisonHtml(c, analyze(d.state, []).arms, true)).join("")}`).join("")}` : ""}
${st.freeParts.filter((f) => f.data).map((f) => `<h3>${f.id === "extraction" ? "Page extraction (free)" : "Locate (free)"}</h3><p>Winner: <b>${esc(((f.data as { winner?: { id: string; margin: string } }).winner?.id) ?? "-")}</b> ${esc(((f.data as { winner?: { margin: string } }).winner?.margin) ?? "")}</p>`).join("")}
${[...st.parts, ...st.replayParts.map((r) => ({ id: r.id, result: r, reused: true }))].filter((p) => p.result).map((p) => `<h3>${esc(p.result!.title)} ${p.reused ? '<span class="pill unknown">replayed from its cassette</span>' : ""}</h3><p>${esc(p.result!.headline)}</p>${p.result!.winner ? `<p>Winner: <b>${esc(p.result!.winner.id)}</b> (${esc(p.result!.winner.by)}); ${esc(p.result!.winner.margin)}</p>` : ""}${p.result!.table ? table(p.result!.table.head, p.result!.table.rows) : ""}${(p.result!.tables ?? []).map((t) => `<h4>${esc(t.title)}</h4>${table(t.table.head, t.table.rows)}`).join("")}`).join("")}

<h2>Performance of each arm</h2>
<p class="mut">Cost per success is all the money spent on the arm over its successes. Time to green is the median wall time of the runs that passed. Wasted steps are failed reads and edits plus reads asked again, over all steps; for an agent that reports only totals, its tool errors. Regressions are tests that passed before the change and fail after it. Variance: tasks that did not give the same answer twice, and one standard deviation of the pass rate.</p>
${perfHtml(arms)}
${a.oursAgg ? `<h3>Our bot with the product's ladders, over the sample</h3>${table(["pass", "₹ / success", "time to green", "turns", "tool errors", "wasted steps", "questions", "regressions"], [[`${a.oursAgg.pass}/${a.oursAgg.n} (${pct(a.oursAgg.rate)}; 95% ${pct(a.oursAgg.wilson.lo)} to ${pct(a.oursAgg.wilson.hi)})`, a.oursAgg.costPerSuccessInr === null ? "-" : inr(a.oursAgg.costPerSuccessInr), secs(a.oursAgg.medianTimeToGreenMs), a.oursAgg.meanTurns.toFixed(1), pct(a.oursAgg.toolErrorRate), pct(a.oursAgg.wasteShare), a.oursAgg.meanQuestions.toFixed(1), String(a.oursAgg.regressions)]])}<p class="mut">Failed at: ${esc(Object.entries(a.oursAgg.failedAt).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing failed")}. ${a.regressions.length ? `Regressions against an earlier code state: ${esc(a.regressions.map((r) => r.task).join(", "))}.` : "No task that passed under an earlier code state fails now."}</p>` : ""}

<h2>Recommended CODE_MODEL_TIERS</h2>
${simulated ? `<p class="mut">Not given for a simulated run: the evidence would be invented.</p>` : a.recommendation && a.recommendation.ladders.tiers && Object.keys(a.recommendation.ladders.tiers).length ? `<pre>CODE_MODEL_TIERS=${esc(a.recommendation.codeModelTiers)}${a.recommendation.codeIndicModel ? `\nCODE_INDIC_MODEL=${esc(a.recommendation.codeIndicModel)}` : ""}</pre>${a.recommendation.notes.map((n) => `<p class="mut">${esc(n)}</p>`).join("")}<p class="mut">Built from probe results under the current model door (cheapest per pass above the 0.7 floor, at most four rungs); a tier with no evidence keeps the product's ladder; a model that obeyed a planted instruction is off the head of strong and review. No role evals or task results back it unless they are in the table above.</p>` : `<p>Not enough evidence in the store to recommend ladders.</p>`}

<h2>What we still do not know, and the cheapest next run</h2>
${table(["what is unknown", "the run that answers it", "about", "what it settles"], a.unknowns.map((u) => [esc(u.what), `<code>${esc(u.command)}</code>`, u.costInr ? inr(u.costInr) : "₹0", esc(u.resolves)]))}
${a.unknowns.length ? `<p><b>Cheapest next run:</b> <code>${esc(a.unknowns[0]!.command)}</code> (${a.unknowns[0]!.costInr ? inr(a.unknowns[0]!.costInr) : "₹0"}).</p>` : ""}

<h2>The stages</h2>
${table(["stage", "status", "estimate", "spent", "already paid", "why"], stageRows, 2)}
${st.stages.map((s) => `<details><summary>${s.stage}. ${esc(s.title)}</summary><pre>${esc(s.lines.join("\n") || "(nothing to report)")}</pre></details>`).join("")}

<h2>Stage 0, what the free checks found</h2>
${st.suite ? `<p>Offline suite: ${st.suite.tests ? `<b>${st.suite.tests.passed}/${st.suite.tests.total}</b> tests pass in ${st.suite.tests.files} file(s) (${st.suite.tests.seconds}s)${st.suite.tests.failing.length ? `; failing: ${esc(st.suite.tests.failing.join("; "))}` : ""}` : esc(st.suite.skipped ?? "not run")}. ${st.suite.typecheck ? `Type check ${st.suite.typecheck.ok ? "clean" : "FAILS: " + esc(st.suite.typecheck.errors[0] ?? "")}.` : ""} ${st.suite.oracle.validated} of ${st.suite.oracle.tasks} tasks have a proven oracle.</p>` : ""}
${cassetteRows.length ? table(["cassette", "kind", "items", "boxes", "answers served / requests not recorded", "recorded cost", "note"], cassetteRows, 2) : ""}
<p class="mut">same: replayed to the same outcome (kept as a result of the current code). stale: the code now asks something the recording does not hold, so only a paid re-record can say what the item does now (it is never counted as a failure or a pass). regressed / fixed: no miss, and the outcome differs from the recorded run's.</p>

<h2>Commands for a session where installs are allowed</h2>
<pre>${esc(cmds.join("\n"))}</pre>
${ctx.sample.skipped.length ? `<p class="mut">${ctx.sample.skipped.length} task(s) were left out here: ${esc(ctx.sample.skipped[0]!.reason)}.</p>` : ""}
<p class="mut">Plan estimates: ${inp.plans.map((p) => `${p.plan} ${inr(totalsOf(p.stages).expectedInr)} expected, at most ${inr(totalsOf(p.stages).maxInr)}`).join("; ")}.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reality check</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

// ---------------------------------------------------------------------------------- the summary

export function buildMarkdown(inp: ReportInput): string {
  const st = inp.main;
  const ctx = st.ctx;
  const a = analyze(st, inp.estimates);
  const fp = summaryFingerprint();
  const L: string[] = [];
  L.push(`# Reality check: where Tailzu stands`, "");
  L.push(`Written by \`npm run reality ${inp.prove ? "-- --prove" : ""}\` (${inp.prove ? "the no-key proof: stage 0 for real, the rest replayed from cassettes, simulated or scripted" : `${ctx.mode} mode, plan ${ctx.plan}`}) on ${st.startedAt.slice(0, 10)} at code \`${fp.product}\`, model door \`${fp.modelDoor}\`. The page with the charts is \`e2e/out/reality/latest.html\`; the measurements are \`e2e/results/*.jsonl\`.`);
  if (ctx.mode === "sim" || ctx.mode === "scripted") L.push("", `**${ctx.mode === "sim" ? "SIMULATED" : "SCRIPTED"} run.** Only stage 0 is real. Everything under "Proof of the stopping rule" is drawn from a known truth and measures nothing.`);
  L.push("", "## What it costs", "", "| plan | tasks | expected | at most | already paid |", "|---|---|---|---|---|");
  for (const p of inp.plans) { const t = totalsOf(p.stages); L.push(`| ${p.plan} | ${p.tasks} | ${inr(t.expectedInr)} | ${inr(t.maxInr)} | ${inr(t.reusedInr)} |`); }
  L.push("", `Prices: ${ctx.priceSource === "live" ? "OpenRouter's live catalog, fetched through the proxy-aware fetch" : ctx.priceSource === "cache" ? `the saved copy of the catalog from ${new Date(ctx.catalog.fetchedAt).toISOString().slice(0, 10)} (the network did not answer in this run; a paid run refetches them live)` : "ASSUMED (the catalog could not be read)"}; "expected" counts the sequential stops working; a stage that spends 30% over its expected figure is aborted. A paid run needs \`npm run reality -- --plan <p> --estimate\` first.`);
  L.push("", "## Stage 0 (free, real)", "");
  for (const l of st.stages.find((s) => s.stage === 0)?.lines ?? []) L.push(`- ${l}`);
  L.push("", "## Verdict per area", "", "| area | verdict | results | basis |", "|---|---|---|---|");
  for (const v of a.verdicts) L.push(`| ${v.area} | ${STATUS_ICON[v.verdict]} ${v.verdict} | ${v.show ?? (v.n ? `${v.pass}/${v.n}${v.thin ? " (thin)" : ""}` : "-")} | ${v.basis} |`);
  L.push("", "## The five things to fix next", "");
  a.fixes.forEach((f, i) => { L.push(`${i + 1}. **${f.stage}**: ${f.cause} (${f.count} case(s)). Look at: ${f.where}.`); for (const e of f.examples) L.push(`   - \`${e.id}\` [${e.source}] ${e.detail.replace(/\n/g, " ").slice(0, 160)}`); });
  if (!a.fixes.length) L.push("No failures in the evidence.");
  L.push("", "## Winners", "");
  const real = st.comparisons.filter((c) => c.runs.length);
  if (!real.length) L.push("No comparison has run on real models yet: the cassettes hold none (see \"What we still do not know\" for the cheapest run that gives one).");
  for (const c of real) L.push(`- ${c.title}: ${c.ended === "clear" || c.ended === "last" ? `**${c.winner}** (${c.final.reason})` : `no winner (${c.ended}: ${c.final.reason})`}`);
  if (inp.demos.length) {
    L.push("", "### Proof of the stopping rule (simulated contestants, no key)", "");
    for (const d of inp.demos) for (const c of d.state.comparisons) L.push(`- ${d.title}, ${c.title}: ${c.ended === "clear" || c.ended === "last" ? `winner **${c.winner}** named after ${c.rounds.length} round(s) on ${c.tasks.length} task(s); ${c.runsSaved} run(s) never needed; dropped: ${[...new Set(c.rounds.flatMap((r) => r.decision.drop))].join(", ") || "none"}` : `no winner called: ${c.ended}, ${c.final.reason}`}`);
  }
  L.push("", "## Recommended CODE_MODEL_TIERS", "");
  if (a.recommendation && Object.keys(a.recommendation.ladders.tiers).length && ctx.mode !== "sim" && ctx.mode !== "scripted") L.push("```", `CODE_MODEL_TIERS=${a.recommendation.codeModelTiers}`, ...(a.recommendation.codeIndicModel ? [`CODE_INDIC_MODEL=${a.recommendation.codeIndicModel}`] : []), "```", ...a.recommendation.notes.map((n) => `- ${n}`));
  else L.push("Not enough evidence in the store yet.");
  L.push("", "## What we still do not know, and the cheapest next run", "", "| unknown | run | about |", "|---|---|---|");
  for (const u of a.unknowns) L.push(`| ${u.what} | \`${u.command}\` | ${u.costInr ? inr(u.costInr) : "₹0"} |`);
  L.push("", "## Commands for a session where installs are allowed", "", "```sh", ...commandList({ plan: ctx.plan, budgetInr: Math.ceil(totalsOf(inp.estimates).maxInr), missingRepos: missingRepos(), missingTools: missingTools(), estimateByStage: Object.fromEntries(inp.estimates.map((e) => [e.stage, e.expectedInr])) }), "```", "");
  return L.join("\n");
}

export function writeReport(inp: ReportInput, o: { summary: boolean }): { html: string; latest: string; md?: string } {
  const html = path.join(inp.main.ctx.outDir, "report.html");
  mkdirp(inp.main.ctx.outDir);
  fs.writeFileSync(html, buildHtml(inp));
  const latest = path.join(OUT_DIR, "reality", "latest.html");
  mkdirp(path.dirname(latest));
  fs.copyFileSync(html, latest);
  let md: string | undefined;
  if (o.summary) {
    md = path.join(path.resolve(OUT_DIR, ".."), "REALITY.md");
    fs.writeFileSync(md, buildMarkdown(inp));
  }
  return { html, latest, ...(md ? { md } : {}) };
}

export type { Analysis, Ctx };
