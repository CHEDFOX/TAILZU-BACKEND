/**
 * THE "CONTESTANTS" AND "PARTS" SECTIONS OF THE REPORT, from a parts file (bakeoff/parts.ts).
 *
 *   Contestants   who is in the agent x model grid (pinned versions, licences, what the no-key wiring proof found), the grid itself when it has been run, and what it
 *                 will cost with the key
 *   Parts         one row per part with its winner and margin, then the numbers: page extraction, locate, edit formats, context strategy, router, the security suites,
 *                 the public benchmarks
 *
 * Both are plain HTML fragments (inline SVG bars, no libraries); `renderPartsHtml` wraps them as a page of their own. The e2e run report (html.ts) appends them
 * when a parts file exists.
 */
import type { PartsFile } from "../bakeoff/parts.js";
import type { GridSummary } from "../bakeoff/grid.js";
import { barChart, esc, page, type Bar } from "./svg.js";

const pct = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;
const inr = (x: number): string => `₹${x >= 100 ? x.toFixed(0) : x.toFixed(2)}`;

const table = (head: readonly string[], rows: readonly (readonly string[])[], numFrom = 1): string =>
  `<div class="wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i >= numFrom ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

const pill = (text: string, tone: "ok" | "bad" | "mut"): string => (tone === "mut" ? `<span class="mut">${esc(text)}</span>` : `<span class="pill ${tone}">${esc(text)}</span>`);

export interface GridFile { results: Array<{ model: string; agent: string; tasks: Array<{ id: string; success: boolean; costUsd: number; ms: number }>; stoppedEarly?: string; simulated: boolean }>; summary: GridSummary; spentInr: number; at?: string; aborted?: string }

export function contestantsSection(f: PartsFile, grid: GridFile | null = null): string {
  const c = f.contestants;
  const rows = c.rows.map((r) => {
    const p = r.proof;
    const proof = r.id === "tailzu" ? pill("the product", "mut")
      : r.skipped ? pill(`skipped: ${r.skipped}`, "bad")
      : p?.record ? `${pill(p.record.success && p.replay?.success && p.replay.misses === 0 ? "wired" : "NOT WIRED", p.record.success && p.replay?.success && p.replay.misses === 0 ? "ok" : "bad")} <span class="mut">${p.record.calls} call(s), ${p.record.promptTokens + p.record.completionTokens} tokens, replay ${p.replay?.hits ?? 0} hit(s), ${p.replay?.misses ?? 0} miss(es)</span>`
      : pill("not proved yet: npm run e2e:agents -- --prove", "mut");
    return [`<b>${esc(r.id)}</b>${r.requiresDocker ? ' <span class="pill bad">needs Docker</span>' : ""}`, esc(r.version), esc(r.licence), r.installed ? "yes" : "no", proof];
  });
  const est = c.estimate;
  let gridHtml: string;
  if (grid && grid.results.length) {
    const agents = [...new Set(grid.results.map((r) => r.agent))];
    const models = [...new Set(grid.results.map((r) => r.model))];
    const cell = (m: string, a: string): string => {
      const p = grid.summary.pairs.find((x) => x.model === m && x.agent === a);
      if (!p) return `<span class="mut">-</span>`;
      const best = grid.summary.bestAgentPerModel[m] === a;
      return `${best ? "<b>" : ""}${p.pass}/${p.n}${best ? "</b>" : ""}<br><span class="mut">${Number.isFinite(p.costPerPassUsd) ? inr(p.costPerPassUsd * f.fx) : "-"}/pass</span>${p.stoppedEarly ? '<br><span class="pill bad">stopped early</span>' : ""}`;
    };
    gridHtml = `${grid.results.some((r) => r.simulated) ? '<p class="bad">simulated draws, not a measurement</p>' : ""}`
      + table(["model", ...agents], models.map((m) => [`<code>${esc(m)}</code>`, ...agents.map((a) => cell(m, a))]))
      + `<p class="mut">Bold: the best scaffold for that model (pass rate first, then cost per pass). Spent ${inr(grid.spentInr)}${grid.at ? ` · ${esc(grid.at.slice(0, 16))}` : ""}${grid.aborted ? ` · stopped: ${esc(grid.aborted)}` : ""}.</p>`;
  } else {
    gridHtml = `<p>The agent x model grid has not been run: it needs the key. With it, <b>${est.runs} runs</b> (${est.basis.split(";")[0]}) are estimated at <b>${inr(est.totalInr)}</b>, between ${inr(est.lowInr)} and ${inr(est.highInr)}.</p>`
      + table(["agent", "tokens in / run", "tokens out / run", ...est.models.map((m) => `₹ / run at ${m.slug}`), "₹ for all its runs (low to high)"],
        est.perAgent.map((a) => [`<b>${esc(a.agent)}</b>`, String(a.tokensIn), String(a.tokensOut), ...est.models.map((m) => inr(a.inrPerRun[m.slug] ?? 0)), `${inr(a.inrLow)} to ${inr(a.inrHigh)}`]))
      + `<p class="mut">${esc(est.basis)}. Models: ${est.models.map((m) => `<code>${esc(m.slug)}</code> ($${m.inUsdPerM}/$${m.outUsdPerM} per M${m.known ? "" : ", price assumed"})`).join(", ")}.</p><pre>${esc(c.command)}</pre>`;
  }
  return `<h2 id="contestants">Contestants</h2>
<p class="mut">Tailzu's own flow against open-source coding agents run headless in the same checkout, the same model and budget cap, every call through the recording proxy, scored by the same hidden checks. Versions are pinned (<code>e2e/agents/versions.json</code>); each runs as a separate process from a scrubbed environment.</p>
${table(["agent", "version", "licence", "installed", "wiring (no key, scripted model through the proxy)"], rows, 99)}
<h3>Agent × model grid</h3>${gridHtml}`;
}

function extractionBlock(f: PartsFile): string {
  const x = f.extraction;
  if (!x) return `<p class="mut">Page extraction was not run.</p>`;
  const winnerId = x.winner?.id;
  const bars: Bar[] = [...x.results].sort((a, b) => b.withTruth.f1 - a.withTruth.f1).map((r) => ({ label: r.id, value: r.withTruth.f1, tone: r.id === winnerId ? "ok" : "plain" }));
  const results = x.results;
  const best = (g: (r: (typeof results)[number]) => number): string => [...results].sort((a, b) => g(b) - g(a))[0]?.id ?? "-";
  return `<p>${x.pages} real pages saved (docs, guides, articles, an encyclopedia, a man page, specs, listings); hand-written truth on ${x.truthPages}: key sentences that must be there, page furniture that must not, code blocks that must come through whole. Best on recall: <b>${esc(best((r) => r.withTruth.recall))}</b>; precision: <b>${esc(best((r) => r.withTruth.precision))}</b>; code kept exactly: <b>${esc(best((r) => r.withTruth.codeStrict))}</b>.</p>`
    + barChart(bars, { max: 1, format: (b) => pct(b.value), labelWidth: 120 })
    + table(["extractor", "recall", "precision", "F1", "code exact", "code text", "tokens / page", "near-empty", "errors", "ms (all pages)"],
      x.results.map((r) => [`<b>${esc(r.id)}</b> <span class="mut">${esc(r.version)} · ${esc(r.licence)}</span>`, pct(r.withTruth.recall), pct(r.withTruth.precision), pct(r.withTruth.f1), pct(r.withTruth.codeStrict), pct(r.withTruth.codeLoose), String(r.meanTokens), String(r.nearlyEmpty), String(r.errors), String(r.msTotal)]))
    + `<p class="mut">Recall: share of key sentences present. Precision: share of the page's furniture left out. Code exact: every line equal, indentation included; code text: the words are there. Truth checked against the pages: ${x.truthCheck.skipped ? esc(x.truthCheck.skipped) : `${x.truthCheck.checked} pages, ${x.truthCheck.problems.filter((p) => p.kind !== "absent-in-main").length} mistake(s), ${x.truthCheck.problems.filter((p) => p.kind === "absent-in-main").length} warning(s) (furniture that sits inside the page's own main element)`}.</p>`;
}

function locateBlock(f: PartsFile): string {
  const l = f.locate;
  if (!l) return `<p class="mut">Locate was not run.</p>`;
  const bars: Bar[] = [...l.contestants].sort((a, b) => b.totals.top3 - a.totals.top3).map((c) => ({ label: `${c.id} top-3`, value: c.totals.top3, tone: c.id === l.winner?.id ? "ok" : "plain" }));
  bars.push({ label: "chance top-3", value: l.chance.top3, tone: "bad" });
  return `<p>${l.tasks} real tasks (${l.bugs} bugs, ${l.questions} questions) on ${new Set(l.rows.map((r) => r.repo)).size} projects at their pinned commits: does the file the real fix changed (or the files an answer must name) come first?</p>`
    + barChart(bars, { max: 1, format: (b) => pct(b.value, 0), labelWidth: 150 })
    + table(["contestant", "top-1", "top-3", "top-5", "MRR", "ms / task", "errors"], [
      ...l.contestants.map((c) => [`<b>${esc(c.id)}</b> <span class="mut">${esc(c.label)}</span>`, pct(c.totals.top1), pct(c.totals.top3), pct(c.totals.top5), c.totals.mrr.toFixed(3), String(c.msPerTask), String(c.errors)]),
      [`<span class="mut">chance (random order)</span>`, pct(l.chance.top1), pct(l.chance.top3), "", "", "", ""],
    ])
    + (l.cliMap ? `<p class="mut"><code>aider --show-repo-map</code> (what Aider shows with nothing in the chat, sorted by file name, so there is no order to score): a right file is in the map for ${pct(l.cliMap.goldInMap, 0)} of ${l.cliMap.tasks} tasks, which shows ${l.cliMap.meanFilesShown.toFixed(1)} of ${l.cliMap.meanFiles.toFixed(0)} files on average.</p>` : "")
    + `<details><summary>Every task</summary>${table(["task", "right file(s)", ...l.contestants.map((c) => c.id)], l.rows.map((r) => [`<code>${esc(r.task)}</code>`, esc(r.gold.join(", ").slice(0, 80)), ...l.contestants.map((c) => { const x = r.byContestant[c.id]; return x ? (x.error ? `<span class="bad">error</span>` : x.at ? `<span class="${x.at <= 3 ? "ok" : "mut"}">#${x.at}</span>` : `<span class="bad">not found</span>`) : "-"; })]), 2)}</details>`;
}

function centBlock(c: PartsFile["cents"][number]): string {
  const tone = c.status === "measured" ? "ok" : c.status === "proved" ? "mut" : "mut";
  return `<h3>${esc(c.title)} ${pill(c.status === "wired" ? "wired, waits for the key" : c.status === "proved" ? "machinery proved on scripted models" : "measured", tone)}</h3>
<p>${esc(c.headline)}</p>${c.winner ? `<p>Winner: <b>${esc(c.winner.id)}</b> (${esc(c.winner.by)}); margin: ${esc(c.winner.margin)}.</p>` : ""}${c.table ? table(c.table.head, c.table.rows) : ""}
${(c.tables ?? []).map((t) => `<h4>${esc(t.title)}</h4>${table(t.table.head, t.table.rows, 99)}`).join("")}
${c.notes.map((n) => `<p class="mut">${esc(n)}</p>`).join("")}<p class="mut">Real run: estimated <b>${inr(c.estimateInr)}</b> (${esc(c.estimateBasis)}).</p><pre>${esc(c.command)}</pre>`;
}

function securityBlock(f: PartsFile): string {
  const s = f.security;
  if (!s) return `<h3>Security suites</h3><p class="mut">Not run yet: <code>npm run e2e:security -- --prove</code> (no key) or <code>--model &lt;slug&gt; --budget-inr X</code>.</p>`;
  const inj = s.injection.map((i) => `<tr><td>${esc(i.agent)} <span class="mut">${esc(i.label)}</span></td><td class="num">${i.summary.n}</td><td class="num"><b>${pct(i.summary.asr, 0)}</b></td><td class="num">${pct(i.summary.utility, 0)}</td><td>${Object.entries(i.summary.byVector).map(([k, v]) => `${esc(k)} ${v.attacks}/${v.n}`).join(", ")}</td></tr>`).join("");
  const gar = s.garak.map((g) => `<tr><td>${esc(g.target)} <span class="mut">${esc(g.label)}</span></td><td class="num">${g.summary.n}</td><td class="num"><b>${pct(g.summary.asr, 0)}</b></td><td>${Object.entries(g.summary.byFamily).map(([k, v]) => `${esc(k)} ${v.hits}/${v.n}`).join(", ")}${g.proxy ? ` <span class="mut">· ${g.proxy.calls} call(s) through the proxy</span>` : ""}</td></tr>`).join("");
  return `<h3>Security suites ${pill(s.simulated ? "scripted models: wiring, not a measurement" : "measured", s.simulated ? "mut" : "ok")}</h3>
<p>Attack success rate (ASR): the share of cases in which the attacker's goal was reached. ${esc(s.at.slice(0, 16))}, model <code>${esc(s.model)}</code>.</p>
<div class="wrap"><table><thead><tr><th>Injection suite (20 AgentDojo-style cases)</th><th>cases</th><th>ASR</th><th>utility under attack</th><th>by vector (attacks/cases)</th></tr></thead><tbody>${inj}</tbody></table></div>
<div class="wrap"><table><thead><tr><th>garak-shaped probes</th><th>probes</th><th>ASR</th><th>by family (hits/probes)</th></tr></thead><tbody>${gar}</tbody></table></div>${s.notes.map((n) => `<p class="mut">${esc(n)}</p>`).join("")}`;
}

function publicBlock(f: PartsFile): string {
  const p = f.publicBench;
  return `<h3>Public benchmarks ${pill(p.status === "skipped" ? "skipped here" : "Docker available", p.status === "skipped" ? "mut" : "ok")}</h3><p>${esc(p.reason)}.</p>
${table(["benchmark", "what", "sample", "licence"], p.benchmarks.map((b) => [`<code>${esc(b.id)}</code>`, esc(b.what), esc(b.sample), esc(b.licence)]), 99)}<details><summary>How to run the 5-task samples with Docker (Harbor ${esc(p.harbor.version)})</summary><pre>${esc(p.howTo.join("\n"))}</pre></details>`;
}

export function partsSection(f: PartsFile): string {
  const rows: string[][] = [];
  if (f.extraction) rows.push(["Page extraction", pill("measured", "ok"), f.extraction.winner ? `<b>${esc(f.extraction.winner.id)}</b>` : "-", f.extraction.winner ? esc(f.extraction.winner.margin) : "", "₹0"]);
  if (f.locate) rows.push(["Locate", pill("measured", "ok"), f.locate.winner ? `<b>${esc(f.locate.winner.id)}</b>` : "-", f.locate.winner ? esc(f.locate.winner.margin) : "", "₹0"]);
  for (const c of f.cents) rows.push([esc(c.title), pill(c.status === "wired" ? "wired" : c.status, c.status === "measured" ? "ok" : "mut"), c.winner ? `<b>${esc(c.winner.id)}</b>${c.status === "proved" ? ' <span class="mut">(scripted)</span>' : ""}` : '<span class="mut">waits for the key</span>', c.winner ? esc(c.winner.margin) : "", `${inr(c.estimateInr)} with the key`]);
  if (f.security) rows.push(["Security: injection suite + garak-shaped probes", pill(f.security.simulated ? "proved" : "measured", f.security.simulated ? "mut" : "ok"), '<span class="mut">attack success rate, below</span>', "", f.security.simulated ? "capped sample with the key" : inr(f.security.spentInr)]);
  rows.push(["Public benchmarks", pill(f.publicBench.status === "skipped" ? "skipped" : "docker", "mut"), '<span class="mut">no daemon here</span>', "", "needs Docker"]);
  return `<h2 id="parts">Parts</h2>
<p class="mut">Each piece of an agent against its alternatives, on its own ground truth, without running a whole agent. ${esc(f.at.slice(0, 16))}.</p>
${table(["part", "status", "winner", "margin", "cost"], rows, 99)}
<h3>Page extraction ${pill("free", "ok")}</h3>${extractionBlock(f)}
<h3>Locate ${pill("free", "ok")}</h3>${locateBlock(f)}
${f.cents.map(centBlock).join("")}
${securityBlock(f)}
${publicBlock(f)}${f.notes.map((n) => `<p class="mut">${esc(n)}</p>`).join("")}`;
}

export function renderPartsHtml(f: PartsFile, grid: GridFile | null = null): string {
  return page("Reality check: contestants and parts", `<h1>Contestants and parts</h1><p class="mut">${esc(f.at)} · parts file ${esc(f.id)}</p>${contestantsSection(f, grid)}${partsSection(f)}`);
}
