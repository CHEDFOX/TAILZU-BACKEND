/**
 * WHAT THE LEAD SAYS TO OTHER PEOPLE: THE PARTS TABLE, THE REVIEW SUMMARY, THE COMBINED WORK LOG, AND THE LINKS BETWEEN PROJECTS' PULL REQUESTS.
 *
 * ONE pull request goes up (one for each project, when the goal spans several), and whoever reviews it was not there. So its body carries what the team did:
 *
 *   the parts table       each part, what it was for, how it ended, who reviewed it (and that it was not the family that wrote it), and the fix rounds
 *   the review summary    what each reviewer found, and what was left open
 *   the combined work log the lead's own log, then each helper's under its part
 *   the links             the other projects' pull requests, in each of them
 *
 * Everything the model or a person wrote goes through the work log's redaction before it is put in the person's repo (agent/report.ts says the same). Pure, except
 * the functions that read the work logs and write the pull requests' descriptions.
 */
import { ConnectorError } from "../../connectors/state.js";
import { PolicyError, gateFree } from "../policy.js";
import { gateBase, ownProject, repoRef } from "../projects.js";
import type { Run } from "../agent/run.js";
import { redactText, renderWorklog, worklogMarkdown, worklogStore } from "../work/index.js";
import { cut, oneLine } from "../work/model.js";
import { unfinished } from "./lead.js";
import type { PartReview, TeamState } from "./types.js";

const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n+/g, " ").replace(/</g, "&lt;");
const safe = (s: string, n: number): string => esc(redactText(oneLine(s, n), n));

/** The tags around the links block in a pull request's description, so it is replaced and not added again. */
export const LINKS_OPEN = "<!-- tailzu-team-links -->";
export const LINKS_CLOSE = "<!-- /tailzu-team-links -->";

/** What the review of a part says in a word. */
function reviewWord(rev: PartReview | undefined): string {
  if (!rev) return "not reviewed";
  if (rev.verdict === "skipped") return "review skipped";
  const bad = rev.findings.filter((f) => f.severity === "blocker" || f.severity === "major").length;
  return `${rev.verdict === "pass" ? "passed" : `${bad} to fix`}${rev.model ? ` (${rev.model})` : ""}`;
}

/** The parts as a markdown table. */
export function partsTable(t: TeamState): string {
  const rows = t.parts.map((p) => {
    const rev = p.reviews.at(-1);
    const who = p.id === 0 ? "the lead" : rev?.family && rev.writerFamily ? `${rev.family} (helper: ${rev.writerFamily})` : rev?.family ?? "—";
    const status = p.noChange ? "merged, no change" : p.status;
    return `| ${p.id} | ${safe(p.title, 60)} | ${status} | ${esc(who)} | ${p.fixRounds} |`;
  });
  return ["| Part | What | Status | Reviewed by | Fix rounds |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

/** What each reviewer found, in bullets; a part with nothing to say is one line. */
export function reviewSummary(t: TeamState): string[] {
  const out: string[] = [];
  for (const p of t.parts) {
    if (p.id === 0) continue;
    if (!p.reviews.length) { out.push(`- **Part ${p.id}, ${safe(p.title, 60)}**: ${p.status === "merged" && p.noChange ? "nothing to review, its helper changed nothing" : p.kind === "repo" ? "reviewed in its own pull request" : "not reviewed"}.`); continue; }
    p.reviews.forEach((rev, i) => {
      out.push(`- **Part ${p.id}, ${safe(p.title, 60)}**, ${i === 0 ? "review" : `after fix round ${i}`}: ${reviewWord(rev)}. ${safe(rev.summary, 240)}`);
      for (const f of rev.findings.filter((x) => x.severity !== "note").slice(0, 5)) out.push(`  - ${f.severity}${f.path ? ` \`${esc(f.path)}${f.line ? `:${f.line}` : ""}\`` : ""}: ${safe(f.text, 240)}`);
    });
    if (p.refused.length) out.push(`  - The helper asked for changes outside its files: ${p.refused.slice(0, 6).map((x) => `\`${esc(x)}\``).join(", ")}.`);
  }
  return out;
}

export interface TeamPrSections {
  reason: string;
  table: string;
  review: string[];
  notes: string[];
  links: string[];
}

/** The team's sections of the pull request, and the combined work log it carries in place of the lead's alone. */
export async function teamPrSections(r: Run): Promise<{ sections: TeamPrSections; worklog: string }> {
  const t = r.state.team!;
  const parts = t.parts.filter((p) => p.jobIds.length && p.kind !== "repo");
  const lead = await worklogMarkdown(r.jobId, { ...(r.deps.worklog ? { store: r.deps.worklog } : {}), maxChars: 9000 });
  const share = Math.max(1200, Math.min(4000, Math.floor(30_000 / Math.max(1, parts.length))));
  const helpers: string[] = [];
  for (const p of parts) {
    let log = "";
    for (const id of p.jobIds) {
      const entries = await (r.deps.worklog ?? worklogStore()).list(id).catch(() => []);
      if (entries.length) log += `${log ? "\n\n" : ""}${await renderWorklog(entries, { level: 4, maxChars: Math.floor(share / p.jobIds.length) })}`;
    }
    helpers.push(`### Part ${p.id}: ${safe(p.title, 80)}\n\n${log || "_Nothing was recorded for this part._"}`);
  }
  const notes = [
    ...unfinished(t).map((p) => `Part ${p.id} (${safe(p.title, 60)}) is ${p.status}${p.reason ? `: ${safe(p.reason, 200)}` : ""}.`),
    ...t.notes.slice(0, 6).map((n) => safe(n, 300)),
  ];
  return {
    worklog: [lead, ...(helpers.length ? ["", "## The helpers' work logs", "", ...helpers] : [])].join("\n"),
    sections: { reason: t.reason, table: partsTable(t), review: reviewSummary(t), notes, links: linkLines(t) },
  };
}

/** The other projects' pull requests, one line each. */
export function linkLines(t: TeamState): string[] {
  return t.links.filter((l) => l.url).map((l) => `- ${safe(l.name, 80)}: ${l.url}`);
}

/** The team in a few lines, for the final report to the person. */
export function teamLines(t: TeamState): string[] {
  const out = [`A team built this: ${t.parts.length - (t.parts.some((p) => p.id === 0) ? 1 : 0)} part${t.parts.length === 1 ? "" : "s"}${t.parts.some((p) => p.id === 0) ? " and the shared contracts" : ""}.`];
  for (const p of t.parts) {
    const rev = p.reviews.at(-1);
    out.push(`- Part ${p.id}, ${safe(p.title, 60)}: ${p.noChange ? "merged, its helper changed nothing" : p.status}${p.fixRounds ? `, ${p.fixRounds} fix round${p.fixRounds === 1 ? "" : "s"}` : ""}${rev && rev.verdict !== "skipped" && rev.model ? `, reviewed by ${rev.model}` : rev?.verdict === "skipped" ? ", review skipped" : ""}${p.reason && p.status !== "merged" ? ` (${cut(oneLine(p.reason, 140), 140)})` : ""}`);
  }
  for (const l of t.links) if (l.url) out.push(`- ${safe(l.name, 60)}: ${l.url}`);
  return out;
}

// ------------------------------------------------------------ the links

/**
 * The pull requests of a goal that spans several projects point at each other: each one's description gets a block listing the others (and this one's, in theirs).
 * Done when all of them are open, and again if it is run again: the block is replaced, never added twice. A pull request that cannot be changed (the policy, GitHub)
 * is left as it is and said, never a failed job.
 */
export async function linkPulls(r: Run): Promise<void> {
  const s = r.state;
  const t = s.team;
  if (!t) return;
  const all: Array<{ projectId: string; name: string; url: string; number: number; branch: string }> = [];
  if (s.pr) all.push({ projectId: r.projectId, name: r.project.fullName, url: s.pr.url, number: s.pr.number, branch: r.branch });
  for (const l of t.links) if (l.url && l.number && l.branch) all.push({ projectId: l.projectId, name: l.name, url: l.url, number: l.number, branch: l.branch });
  if (all.length < 2) return;
  const d = r.deps.projects;
  for (const mine of all) {
    const others = all.filter((x) => x !== mine);
    const block = [LINKS_OPEN, "## Related pull requests", "", "This change spans several projects. The others are:", ...others.map((o) => `- ${o.name}: ${o.url}`), LINKS_CLOSE].join("\n");
    try {
      const project = mine.projectId === r.projectId ? r.project : await ownProject(d, r.userId, mine.projectId);
      const repo = repoRef(d, r.userId, project);
      const body = await d.github.pullBody(repo, mine.number);
      const without = body.replace(new RegExp(`\\n*${LINKS_OPEN}[\\s\\S]*?${LINKS_CLOSE}\\n*`), "\n\n").trimEnd();
      const next = `${without}\n\n${block}\n`;
      if (next === body) continue;
      await gateFree({
        ...gateBase(d, r.userId, project), attended: true, action: "pr.comment", branch: mine.branch, ownBranch: true,
        summary: () => ({ pullRequest: mine.number, updates: "the links to the other pull requests" }),
        run: () => d.github.updatePull(repo, mine.number, { body: next }),
      });
    } catch (err) {
      if (err instanceof ConnectorError || err instanceof PolicyError || err instanceof Error) r.note(`The link to the other pull requests could not be added to ${mine.name}#${mine.number}.`);
    }
  }
  await r.log.step(`Linked ${all.length} pull requests to each other`);
}
