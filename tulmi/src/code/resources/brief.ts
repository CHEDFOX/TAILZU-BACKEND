/**
 * THE RESEARCH BRIEF: A QUESTION, ANSWERED WITH ITS SOURCES, WEIGHED AGAINST THIS PROJECT, AND KEPT IN THE REPO.
 *
 *   researchBrief(question, { brain, workspace }, { depth, web })
 *     -> { markdown, path, commit, research }
 *
 * "Which auth library should we use?" is worth a page a team can read again in six
 * months, not a chat message. So this runs layer 3's research() (search, read the
 * pages that matter, an answer that cites them: web/research.ts, bound to the job's
 * model, budget and daily limits by webTools.ts) with the project's stack as its
 * context, and renders a brief:
 *
 *   question · short answer · details · options compared · a recommendation for
 *   THIS project · gaps · numbered sources, each with the day it was read
 *
 * The short answer, the options and the recommendation come from one more call (the
 * cheap tier for a quick brief, the code tier otherwise) that is given the cited
 * answer and the project's stack and nothing from the web: it can weigh what the
 * research found against what the project has, and cannot add a claim the research
 * did not make. It may only cite [n] for sources that exist; the rest are removed.
 * If that call cannot be had (no money, no model), the brief still stands: the
 * research answer is the details, its first paragraph the short answer, and the
 * options and the recommendation are left out and said to be.
 *
 * The brief is COMMITTED to the work branch as docs/research/<yyyy-mm-dd>-<slug>.md
 * through workspace().commit, so the policy applies as for any commit: a branch the
 * bot made takes it at once, any other branch is a question for the person
 * (`commit` is then the question, not the sha). A file of that name that exists gets
 * -2, -3... Nothing secret goes in: the text is run through the policy's scan first.
 * Research that read nothing (no source) is a BriefError("empty"), and nothing is committed.
 */
import { z } from "zod";
import type { Gated } from "../policy.js";
import type { BrainHandle } from "../project/index.js";
import type { Workspace } from "../projects.js";
import { makeWebTools, ResearchLimit, type WebToolDeps } from "../webTools.js";
import type { ResearchDepth, ResearchResult } from "../../web/research.js";
import type { PlanCtx } from "../../web/search/types.js";
import { askJson, cut, fence, oneLine, type ModelCtx } from "../work/model.js";
import { redactText } from "../work/worklog.js";

export class BriefError extends Error {
  constructor(readonly code: "limit" | "failed" | "empty", message: string) {
    super(message);
    this.name = "BriefError";
  }
}

export interface BriefProject {
  brain: Pick<BrainHandle, "status" | "deps">;
  /** The work branch's workspace: the brief is committed through it. */
  workspace: Pick<Workspace, "commit" | "read">;
}

export interface BriefOptions {
  depth: ResearchDepth;
  /** The job's model, money, fetch, search store and limits (webTools.ts), minus the project's context, which is built here. */
  web: Omit<WebToolDeps, "ctx">;
  /** Don't commit; return the markdown and the path it would go to. */
  dryRun?: boolean;
  /** Step two of a question the commit asked. */
  approvalId?: string;
  now?: () => number;
}

export interface BriefResult {
  markdown: string;
  /** Where it is (or would be) in the repo. */
  path: string;
  /** The commit, or the question the policy asked instead; null for a dry run. */
  commit: Gated<{ sha: string; parentSha: string }> | null;
  research: ResearchResult;
}

// ------------------------------------------------------------------ the weighing

const Weighed = z.object({
  shortAnswer: z.string(),
  options: z.array(z.object({
    name: z.string(), what: z.string().optional(), good: z.array(z.string()).max(5).optional(), watch: z.array(z.string()).max(5).optional(),
    fit: z.enum(["good", "poor", "unknown"]).optional(),
  })).max(6),
  recommendation: z.object({ choice: z.string(), because: z.string(), caveats: z.array(z.string()).max(4).optional() }).nullable(),
});
type Weighed = z.infer<typeof Weighed>;

const SYSTEM =
  "You turn a researched answer into a short brief for a developer. You are given the question, the researched answer (it cites its sources as [n]), and what the project is built with. "
  + "Write: a short answer (two sentences at most); the options the answer compares (up to six: what each is, what is good about it, what to watch, and whether it fits THIS project's stack); "
  + "and a recommendation for this project, with the reasons and any caveats. Use only what the researched answer says: add no claim of your own, and say so when the answer does not compare options "
  + "(options: []) or does not support a recommendation (recommendation: null). Keep the [n] citations on claims; cite only numbers that appear in the answer. "
  + 'Answer with JSON {"shortAnswer":"...","options":[{"name":"...","what":"...","good":["..."],"watch":["..."],"fit":"good|poor|unknown"}],"recommendation":{"choice":"...","because":"...","caveats":["..."]}|null}.';

/** [n] that name no source are removed (with the space before them, unless another citation follows): an invented source is worse than none. */
export function keepCitations(text: string, valid: ReadonlySet<number>): string {
  return text.replace(/(\s?)\[(\d{1,3})\]/g, (m, space: string, n: string, at: number, whole: string) => (valid.has(Number(n)) ? m : whole[at + m.length] === "[" ? space : ""));
}

const bullets = (xs: readonly string[] | undefined): string => (xs ?? []).map((x) => oneLine(x, 160)).filter(Boolean).join("; ");
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");

function stackLine(view: Awaited<ReturnType<BriefProject["brain"]["status"]>>): string {
  const s = view.structure;
  if (!s) return "";
  const parts = [
    s.languages.length ? s.languages.slice(0, 3).map((l) => l.lang).join(", ") : "",
    s.frameworks.length ? s.frameworks.slice(0, 6).join(", ") : "",
    s.packageManagers.length ? `${s.packageManagers.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

const slugOf = (q: string): string => ((q.match(/[A-Za-z0-9]+/g) ?? []).join("-").toLowerCase().slice(0, 48).replace(/-+$/, "")) || "research";

/** The first paragraph of an answer that is not a heading or a fence. */
export function firstParagraph(text: string, max = 400): string {
  const p = text.split(/\n{2,}/).map((x) => x.trim()).find((x) => x && !x.startsWith("#") && !x.startsWith("```") && x.length > 20);
  return cut((p ?? text).replace(/\s+/g, " ").trim(), max);
}

export interface BriefInput {
  question: string;
  date: string;
  depth: ResearchDepth;
  research: ResearchResult;
  weighed: Weighed | null;
  stack: string;
}

/** The brief as markdown. */
export function renderBrief(b: BriefInput): string {
  const r = b.research;
  const valid = new Set(r.sources.map((s) => s.n));
  const out: string[] = [];
  out.push(`# ${cut(b.question.replace(/\s+/g, " "), 120)}`, "");
  out.push(`_Research brief, ${b.date}. Depth: ${b.depth}. Confidence: ${Math.round(r.confidence * 100)}%.${r.partial ? ` Incomplete: it stopped on ${r.stoppedBy ?? "a limit"}.` : ""}_`, "");
  out.push("## Question", "", b.question.trim(), "");
  out.push("## Short answer", "", keepCitations(b.weighed?.shortAnswer ? oneLine(b.weighed.shortAnswer, 600) : firstParagraph(r.answer), valid), "");
  out.push("## Details", "", keepCitations(r.answer.trim(), valid), "");

  out.push("## Options compared", "");
  if (b.weighed?.options.length) {
    out.push("| Option | What it is | Good | Watch out | Fits this project |", "| --- | --- | --- | --- | --- |");
    for (const o of b.weighed.options) {
      out.push(`| ${cell(keepCitations(oneLine(o.name, 80), valid))} | ${cell(keepCitations(oneLine(o.what ?? "", 160), valid))} | ${cell(keepCitations(bullets(o.good), valid))} | ${cell(keepCitations(bullets(o.watch), valid))} | ${o.fit === "good" ? "yes" : o.fit === "poor" ? "no" : "unclear"} |`);
    }
  } else {
    out.push(b.weighed ? "_The research did not compare options._" : "_Not compared: the step that weighs the options could not run. The details above are the research as it came back._");
  }
  out.push("");

  out.push("## Recommendation for this project", "");
  if (b.stack) out.push(`_This project: ${b.stack}._`, "");
  const rec = b.weighed?.recommendation;
  if (rec?.choice) {
    out.push(`**${oneLine(rec.choice, 120)}.** ${keepCitations(oneLine(rec.because, 600), valid)}`);
    for (const c of rec.caveats ?? []) out.push(`- ${keepCitations(oneLine(c, 240), valid)}`);
  } else {
    out.push(b.weighed ? "_The research does not support a recommendation yet._" : "_No recommendation was made: see the details._");
  }
  out.push("");

  if (r.gaps.length) out.push("## Gaps", "", ...r.gaps.map((g) => `- ${oneLine(g, 240)}`), "");
  out.push("## Sources", "");
  if (r.sources.length) {
    for (const s of r.sources) out.push(`${s.n}. [${cut(oneLine(s.title, 120) || s.url, 120).replace(/[[\]]/g, "")}](${s.url}), read ${new Date(s.fetchedAt).toISOString().slice(0, 10)}${s.cited ? "" : " (not cited)"}`);
  } else {
    out.push("_No sources were read._");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// ----------------------------------------------------------------------- the brief

export async function researchBrief(question: string, project: BriefProject, o: BriefOptions): Promise<BriefResult> {
  const q = redactText(String(question ?? "").replace(/\s+/g, " ").trim(), 600);
  if (q.length < 3) throw new BriefError("failed", "Say what to research.");
  const now = (o.now ?? o.web.now ?? Date.now)();
  const date = new Date(now).toISOString().slice(0, 10);
  const view = await project.brain.status().catch(() => null);
  const deps = await project.brain.deps().catch(() => []);
  const ctx: PlanCtx = {
    languages: (view?.structure?.languages ?? []).map((l) => l.lang.toLowerCase()), deps: deps.slice(0, 40).map((d) => d.name),
    ...(view?.structure?.frameworks?.[0] ? { framework: view.structure.frameworks[0].toLowerCase() } : {}),
  };

  let tools: ReturnType<typeof makeWebTools>;
  let research: ResearchResult;
  try {
    tools = makeWebTools({ ...o.web, ctx, ...(o.now ? { now: o.now } : {}) });
    research = await tools.research(q, o.depth);
  } catch (err) {
    if (err instanceof ResearchLimit) throw new BriefError("limit", "The daily limit of research runs is used up. Try again tomorrow.");
    throw new BriefError("failed", "The research could not be done. Try again in a moment.");
  }
  await tools.settled();
  // A brief with no source in it is not worth a commit in someone's repo.
  if (!research.sources.length) throw new BriefError("empty", "Nothing usable was found on the web for that question, so no brief was written. Try asking it another way.");

  // Weighed against the project: one more call, from the cited answer and the stack, with nothing from the web in it that is not already cited.
  const model: ModelCtx = {
    userId: o.web.userId, budget: o.web.budget, ...(o.web.jobId ? { jobId: o.web.jobId } : {}), ...(o.web.call ? { call: o.web.call } : {}),
    ...(o.web.gateway ? { gateway: o.web.gateway } : {}), ...(o.web.signal ? { signal: o.web.signal } : {}),
  };
  const stack = view ? stackLine(view) : "";
  const asked = await askJson(model, {
    tier: o.depth === "quick" ? "cheap" : "code", purpose: "work.brief", schema: Weighed, maxTokens: 1400, system: SYSTEM,
    user: [
      `<request>\n${fence(cut(q, 600))}\n</request>`,
      `what the project is built with: ${stack || "(not known)"}${deps.length ? `\nits dependencies: ${deps.slice(0, 30).map((d) => d.name).join(", ")}` : ""}`,
      `the researched answer (sources [${research.sources.map((s) => s.n).join(", ")}]):\n<data>\n${fence(cut(research.answer, 9000))}\n</data>`,
    ].join("\n"),
  });
  const markdown = redactText(renderBrief({ question: q, date, depth: o.depth, research, weighed: asked.ok ? asked.value : null, stack }), 60_000);

  // A name that is free: the same day's brief on the same question is -2.
  const base = `docs/research/${date}-${slugOf(q)}`;
  let path = `${base}.md`;
  for (let n = 2; n <= 6; n += 1) {
    const taken = await project.workspace.read(path).then(() => true, () => false);
    if (!taken) break;
    path = `${base}-${n}.md`;
  }
  if (o.dryRun) return { markdown, path, commit: null, research };
  const commit = await project.workspace.commit(
    [{ path, content: markdown }], `docs: research brief on ${cut(q, 60)}`, o.approvalId ? { approvalId: o.approvalId } : {},
  );
  return { markdown, path, commit, research };
}
