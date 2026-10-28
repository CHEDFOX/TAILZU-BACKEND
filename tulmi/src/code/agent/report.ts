/**
 * WHAT THE AGENT WRITES FOR OTHER PEOPLE: THE COMMIT MESSAGE, THE PULL REQUEST AND THE REPORT.
 *
 * Three pieces of text leave the agent, and each is read by someone who was not there:
 *
 *   commitMessage   what a reviewer sees in `git log`: a short first line, then what was done
 *   prBody          the pull request: the plan, what the checks said, anything that was already
 *                   broken before Tailzu, and the whole work log (work/worklog.ts); GitHub's limit is
 *                   65,536 characters and this stays under 60,000
 *   reportText      the final message to the person: what changed, the PR link, the checks, the
 *                   findings, the cost in rupees, and what to do next. "Already broken before
 *                   Tailzu" is its own list, so that nobody reads a red check that was never
 *                   theirs as a failure of the change.
 *
 * Everything the model or the person wrote goes through the work log's redaction (a secret on
 * its own becomes [redacted], a line the secret scan flags as a whole is withheld) before it is
 * put in a commit or a pull request, which are written to the person's repo. These functions are
 * pure: the same state gives the same words.
 */
import { redactText } from "../work/index.js";
import { cut, oneLine } from "../work/model.js";
import { ANSWER_MAX_CHARS, rupees, type AgentState, type CheckSummary } from "./types.js";

const safe = (s: string, n: number): string => redactText(oneLine(s, n), n);
const list = (items: readonly string[], max = 15): string[] => items.slice(0, max).map((i) => `- ${i}`).concat(items.length > max ? [`- and ${items.length - max} more`] : []);

// ------------------------------------------------------------------ commits

/** The first line of a commit: the project's own style when it has one (Conventional Commits), otherwise a plain sentence. */
export function commitMessage(state: AgentState, o: { conventional?: boolean; jobId: string }): string {
  const type = state.classification?.type;
  const first = (state.work.doneSummary ?? state.task).split(/[.\n]/)[0] ?? state.task;
  let title = safe(first, 90).replace(/^["'`]|["'`]$/g, "");
  if (!title) title = "Update";
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (o.conventional) {
    const kind = type === "bug_fix" ? "fix" : type === "refactor" ? "refactor" : type === "small_edit" ? "chore" : "feat";
    title = `${kind}: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  }
  title = cut(title, 72);
  const steps = (state.plan?.steps ?? []).slice(0, 8).map((s) => `- ${safe(s.do, 160)}`);
  const checks = state.verify?.ran ? `Checks: ${state.verify.summary}` : state.verify ? `Checks: not run (${safe(state.verify.note ?? "no computer was free", 100)}).` : "";
  return [title, "", ...(steps.length ? steps : [`- ${safe(state.task, 160)}`]), ...(checks ? ["", checks] : []), "", `Done by Tailzu (job ${o.jobId.slice(0, 8)}).`].join("\n");
}

// -------------------------------------------------------------- the checks

const STATUS_WORDS: Record<string, string> = {
  passed: "passed", broke: "failed: this change broke it", already_broken: "failed, and was already failing before Tailzu",
  fixed: "passes now (it was failing before)", unchanged_failing: "failed the same way as before",
};

function checkLines(checks: readonly CheckSummary[]): string[] {
  return checks.map((c) => `${c.kind}: ${STATUS_WORDS[c.status] ?? c.status}${c.summary && c.status !== "passed" ? ` (${cut(c.summary, 120)})` : ""}`);
}

// ------------------------------------------------------------------ the PR

export function prTitle(state: AgentState): string {
  const first = (state.work.doneSummary ?? state.task).split(/[.\n]/)[0] ?? state.task;
  const t = safe(first, 90);
  return cut(t.charAt(0).toUpperCase() + t.slice(1) || "Tailzu change", 70);
}

/** A team's part of the pull request (code/team/report.ts): why there is a team, the parts table, what the reviewers found, what is open, and the other projects' pull requests. */
export interface PrTeam { reason: string; table: string; review: readonly string[]; notes: readonly string[]; links: readonly string[] }

export function prBody(state: AgentState, o: { worklog: string; jobId: string; spentPaise: number; design?: readonly string[]; team?: PrTeam }): string {
  const out: string[] = [];
  out.push("## What this does", "", safe(state.work.doneSummary ?? state.task, 1500), "");
  if (state.plan?.steps.length) {
    out.push("## The plan", "", ...state.plan.steps.slice(0, 15).map((s) => `${s.n}. ${safe(s.do, 220)}${s.files.length ? ` (${s.files.slice(0, 6).map((f) => `\`${f.path}\``).join(", ")})` : ""}`), "");
    if (state.plan.risk !== "low") out.push(`Risk: **${state.plan.risk}**${state.plan.riskReasons.length ? `: ${state.plan.riskReasons.slice(0, 3).map((r) => safe(r, 120)).join("; ")}` : ""}.`, "");
  }
  if (o.team) {
    out.push("## The team", "", safe(o.team.reason, 300), "", "A lead split this into parts with their own files, helpers built them in parallel, and a model of another family reviewed each before the lead merged it.", "", o.team.table, "");
    if (o.team.review.length) out.push("### What the reviewers found", "", ...o.team.review, "");
    if (o.team.notes.length) out.push("### Open", "", ...o.team.notes.map((n) => `- ${n}`), "");
    if (o.team.links.length) out.push("### Related pull requests", "", ...o.team.links, "");
  }
  out.push("## Checks", "");
  const v = state.verify;
  if (!v) out.push("No checks were run for this change.");
  else if (!v.ran) out.push(`The checks were not run${v.note ? `: ${safe(v.note, 200)}` : ""}. Run them before merging.`);
  else out.push(...checkLines(v.checks).map((l) => `- ${l}`), "", v.summary.charAt(0).toUpperCase() + v.summary.slice(1));
  out.push("");
  if (v?.alreadyBroken.length) {
    out.push("## Already broken before Tailzu", "", "These were failing before this change, so they are not caused by it and were not fixed here:", ...list(v.alreadyBroken.map((n) => `\`${cut(n, 140)}\``)), "");
  }
  if (state.baseline?.status === "unknown" && state.baseline.note) out.push(`> Heads up: ${safe(state.baseline.note, 300)}`, "");
  if (o.design?.length) out.push("## Design check", "", ...o.design.map((l) => (l.startsWith("- ") ? l : safe(l, 600))), "");
  if (o.worklog.trim()) out.push(o.worklog.trim(), "");
  out.push("---", `Made by Tailzu (job \`${o.jobId.slice(0, 8)}\`) for ${rupees(o.spentPaise)}. It is a draft until the checks are green and you say it is ready.`);
  const text = out.join("\n");
  return text.length > 60_000 ? `${text.slice(0, 59_900).trimEnd()}\n\n_(cut: the rest is in the job's work log)_` : text;
}

// ---------------------------------------------------------------- the report

export interface ReportInput {
  state: AgentState;
  spentPaise: number;
  budgetPaise: number;
  outcome: "done" | "failed" | "budget" | "answer";
  /** Why it stopped, for "failed" and "budget". */
  why?: string;
  prReady?: boolean;
  /** For "budget": the top-up on offer, in paise. */
  continueWithPaise?: number;
  /** The design check, in lines (design.ts designLines), for a job built from an approved design. */
  design?: readonly string[];
  /** The team that built it, in lines (code/team/report.ts teamLines), for a lead. */
  team?: readonly string[];
}

export function reportText(i: ReportInput): string {
  const s = i.state;
  const out: string[] = [];
  const task = safe(s.task, 100);
  // A lead's work is its helpers' parts, merged: the files are theirs (code/team).
  const files = s.team && !s.work.staged.length ? (s.committedPaths ?? []).map((p) => `${p} (changed)`)
    : s.commit?.files?.length ? s.commit.files : s.work.staged.map((f) => `${f.path} (${f.action === "delete" ? "deleted" : f.action === "create" ? "added" : "changed"})`);
  const headline = {
    done: `Done: ${task}`, failed: `I stopped: ${task}`, budget: `I ran out of budget: ${task}`, answer: `Here is the answer: ${task}`,
  }[i.outcome];
  out.push(headline, "");
  if (i.outcome === "failed" || i.outcome === "budget") {
    if (i.why) out.push(safe(i.why, 500), "");
  }
  // An answer is the whole of what the person asked for (the names and values it must hold): it is kept nearly whole. A change's summary is a few sentences.
  if (s.work.doneSummary) out.push(i.outcome === "answer" ? "" : "What I did", safe(s.work.doneSummary, i.outcome === "answer" ? ANSWER_MAX_CHARS : 1500), "");
  if (i.outcome !== "answer") {
    if (files.length) out.push(i.outcome === "done" ? "What changed" : "What I changed but did not commit", ...list(files, 20), "");
    else if (i.outcome === "done") out.push("Nothing needed changing.", "");
  }
  if (s.pr) out.push(`Pull request: ${s.pr.url} (${s.pr.ready ? "ready for review" : "a draft"})`, "");
  const v = s.verify;
  if (v) {
    out.push("Checks");
    if (!v.ran) out.push(`- not run${v.note ? `: ${safe(v.note, 200)}` : ""}`);
    else out.push(...checkLines(v.checks).map((l) => `- ${l}`));
    out.push("");
    if (v.broke.length) out.push("Broken by this change", ...list(v.broke.map((n) => cut(n, 140))), "");
    if (v.alreadyBroken.length) out.push("Already broken before Tailzu (not caused by this change)", ...list(v.alreadyBroken.map((n) => cut(n, 140))), "");
  }
  if (s.baseline?.status === "unknown" && s.baseline.note) out.push(`Note: ${safe(s.baseline.note, 300)}`, "");
  if (i.design?.length) out.push("The design", ...i.design.map((l) => (l.startsWith("- ") ? l : safe(l, 600))), "");
  if (i.team?.length) out.push("The team", ...i.team.map((l) => (l.startsWith("- ") ? l : safe(l, 600))), "");
  if (s.findings.length) out.push("Findings", ...list(s.findings.map((f) => `${f.severity}: ${f.path}${f.line ? `:${f.line}` : ""} ${cut(f.text, 160)}`), 10), "");
  for (const n of s.notes.slice(0, 6)) out.push(`Note: ${safe(n, 300)}`);
  if (s.notes.length) out.push("");
  out.push(`Cost: ${rupees(i.spentPaise)} of ${rupees(i.budgetPaise)}.`, "");
  const next = nextSteps(i);
  if (next.length) out.push("What next", ...list(next, 6));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function nextSteps(i: ReportInput): string[] {
  const s = i.state;
  const next: string[] = [];
  if (i.outcome === "budget") {
    next.push(`Continue with ${rupees(i.continueWithPaise ?? 1000)} more, and I pick up where I stopped.`);
    next.push("Or stop here: nothing has been lost, the work so far is saved.");
    return next;
  }
  if (i.outcome === "failed") {
    if (s.work.staged.length) next.push("What I had changed but not committed is kept with this job; nothing on the branch was touched.");
    next.push("Look at the failing checks above. If you still want this, start a new job with more detail about what should happen.");
    return next;
  }
  if (s.pr) {
    next.push(s.pr.ready ? "Review the pull request, then merge it when you are happy." : "Review the draft pull request; mark it ready when you are happy with it.");
  }
  if (s.verify && !s.verify.ran) next.push("Run the project's checks yourself before merging: they could not be run here.");
  if (s.verify?.alreadyBroken.length) next.push("The checks listed as already broken were failing before this change; they are worth a job of their own.");
  const untested = s.plan?.impact.untested ?? [];
  if (untested.length) next.push(`Add tests for ${untested.slice(0, 2).join(" and ")}: nothing covers ${untested.length === 1 ? "it" : "them"}.`);
  if (s.findings.some((f) => f.severity !== "info")) next.push("Look at the findings above: I noticed them but left them alone.");
  for (const m of s.newProject?.nextMilestones ?? []) next.push(`Next milestone: ${safe(m, 120)}`);
  return next;
}
