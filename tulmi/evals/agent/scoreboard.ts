/**
 * THE SCOREBOARD: one run, as JSON for the next run to be held to, and as
 * markdown for a person to read.
 *
 *   evals/agent/out/<stamp>/scoreboard.json   the Scoreboard type: every trial's graders, and the metrics
 *   evals/agent/out/<stamp>/scoreboard.md     a header, the metrics overall, by language and by family,
 *                                             then the failures, grouped by grader, each with the task's intent
 *
 * The header names what the numbers depend on: the mode, the models, the
 * commit, a hash of each system prompt (a change of score can be put beside a
 * change of prompt), and whether the server sent receipts. Adversarial tasks
 * are counted under "adversarial" and again under their attack.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { grade, passed } from "./graders/index.js";
import { costOf, metricsOf, type TrialScore } from "./metrics.js";
import type { GraderId, Lang, Metrics, Scoreboard, Task, Trace } from "./types.js";

/** A trial as the scoreboard keeps it, with the bench's own failure when it broke. */
export type TrialRow = TrialScore & { error?: string };

/**
 * One trial, graded and costed. A skipped trial carries only why; one the
 * bench broke on fails, with the graders' view kept beside the error.
 */
export function scoreTrial(task: Task, trace: Trace): { trial: TrialRow; estimated: boolean } {
  const cost = costOf(trace.calls);
  const calls = trace.calls.length;
  if (trace.skipped) return { trial: { pass: false, skipped: trace.skipped, graders: [], calls, costUsd: 0 }, estimated: false };
  const graders = grade(task, trace);
  const first = trace.turns[0]?.firstMs;
  const outcome = trace.turns.at(-1)?.response.receipt?.outcome;
  return {
    trial: {
      pass: !trace.error && passed(graders), graders, calls, costUsd: cost.usd,
      ...(first !== undefined ? { firstMs: first } : {}),
      ...(trace.turns.length ? { doneMs: trace.turns.reduce((n, t) => n + t.ms, 0) } : {}),
      ...(outcome ? { outcome } : {}),
      ...(trace.error ? { error: trace.error } : {}),
    },
    estimated: cost.estimated,
  };
}

const LANGS: Lang[] = ["en", "hinglish", "hi"];

export function buildScoreboard(o: Omit<Scoreboard, "version" | "overall" | "byLang" | "byFamily">): Scoreboard {
  const byLang = Object.fromEntries(LANGS.map((l) => [l, metricsOf(o.results.filter((r) => r.lang === l), o.mode)])) as Record<Lang, Metrics>;
  const families = [...new Set(o.results.flatMap((r) => (r.attack ? [r.family, `adversarial:${r.attack}`] : [r.family])))].sort();
  const byFamily = Object.fromEntries(families.map((f) => [f, metricsOf(o.results.filter((r) => r.family === f || `adversarial:${r.attack}` === f), o.mode)]));
  return { version: 1, ...o, overall: metricsOf(o.results, o.mode), byLang, byFamily };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number | null) => (x === null ? "–" : `${Math.round(x)}`);
const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 5 : 3)}`;

function row(name: string, m: Metrics): string {
  // A slice of nothing but XFAIL tasks has no pass@1 of its own: shown as a dash, not as 0%.
  const own = m.tasks > m.xfail + m.xpass;
  return `| ${name} | ${m.tasks} | ${m.trials} | ${own ? pct(m.passAt1) : "–"} | ${pct(m.passAt1All)} | ${own ? pct(m.passHatK) : "–"} (k=${m.k}) | ${pct(m.silentFailureRate)} | ${m.unsafeActions} / ${m.unsafeProposals} | ${pct(m.needlessAskRate)} | ${ms(m.firstEventMs.p50)} / ${ms(m.firstEventMs.p95)} | ${ms(m.doneMs.p50)} / ${ms(m.doneMs.p95)} | ${m.modelCallsPerTask.toFixed(2)} | ${usd(m.costUsd)} | ${m.skipped} | ${m.xfail} / ${m.xpass} |`;
}

const HEAD = [
  "| | tasks | trials | pass@1 | pass@1 (all) | pass^k | silent failures | unsafe done / proposed | needless asks | first ms p50 / p95 | done ms p50 / p95 | calls per trial | cost | skipped | XFAIL / XPASS |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
];

/**
 * The scoreboard for a person. `intents` is each task's one line (what it
 * protects); `estimatedCost` marks a cost worked out from tokens.
 */
export function scoreboardMarkdown(s: Scoreboard, intents: Record<string, string>, o: { estimatedCost?: boolean } = {}): string {
  const receipts = s.results.some((r) => r.trials.some((t) => t.graders.some((g) => g.id === "receipt" && g.severity === "hard")));
  const lines = [
    `# Roz Bench: ${s.mode}`,
    "",
    `- started: ${s.startedAt}`,
    `- models: ${s.models.join(", ") || "–"}`,
    `- git: ${s.git}`,
    `- prompts: ${Object.entries(s.prompts).map(([k, v]) => `${k} ${v.slice(0, 12)}`).join(", ") || "–"}`,
    `- receipts: ${receipts ? "present" : "none from this server"}`,
    `- filters: ${JSON.stringify(s.filters)}`,
    ...(o.estimatedCost ? ["- cost: estimated from tokens where OpenRouter sent no cost"] : []),
    "",
    "## Overall",
    "",
    ...HEAD,
    row("all", s.overall),
    "",
    "## By language",
    "",
    ...HEAD,
    ...LANGS.filter((l) => s.byLang[l]?.tasks).map((l) => row(l, s.byLang[l])),
    "",
    "## By family",
    "",
    ...HEAD,
    ...Object.entries(s.byFamily).map(([f, m]) => row(f, m)),
    "",
  ];

  const failures = new Map<GraderId, string[]>();
  const broken: string[] = [];
  const unexpected: string[] = [];
  for (const r of s.results) {
    const label = (detail: string) => `- \`${r.taskId}\`${r.xfail ? " (xfail)" : ""}: ${intents[r.taskId] ?? ""} — ${detail}`;
    for (const [i, t] of (r.trials as TrialRow[]).entries()) {
      const tag = r.trials.length > 1 ? ` (trial ${i + 1})` : "";
      if (t.error) broken.push(label(`${t.error}${tag}`));
      for (const g of t.graders) {
        if (g.pass || g.severity === "soft") continue;
        const list = failures.get(g.id) ?? [];
        list.push(label(`${g.detail}${tag}`));
        failures.set(g.id, list);
      }
    }
    const scored = r.trials.filter((t) => !t.skipped);
    if (r.xfail && scored.length && scored.every((t) => t.pass)) unexpected.push(`- \`${r.taskId}\`: passes; take its xfail off`);
  }
  lines.push("## Failures", "");
  if (!failures.size && !broken.length) lines.push("None.", "");
  for (const [id, list] of [...failures].sort(([a], [b]) => a.localeCompare(b))) lines.push(`### ${id}`, "", ...list, "");
  if (broken.length) lines.push("### the bench itself", "", ...broken, "");
  if (unexpected.length) lines.push("## XPASS", "", ...unexpected, "");
  return lines.join("\n");
}

/** Writes both files into `dir`; returns their paths. */
export function writeScoreboard(dir: string, s: Scoreboard, md: string): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const json = join(dir, "scoreboard.json"), mdPath = join(dir, "scoreboard.md");
  writeFileSync(json, `${JSON.stringify(s, null, 2)}\n`);
  writeFileSync(mdPath, md.endsWith("\n") ? md : `${md}\n`);
  return { json, md: mdPath };
}
