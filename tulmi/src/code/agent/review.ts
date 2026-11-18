/**
 * ONE JOB'S CHANGE, READ BY A MODEL OF ANOTHER FAMILY BEFORE THE PULL REQUEST IS MARKED READY (role code_review, the review tier).
 *
 * The project's checks prove that what is tested still works. They do not read the change. A team's part has been read by another
 * model since the team flow was built (`team/review.ts`), and a chat answer drawn from code is read before it goes (`chat/look.ts`,
 * role code_check). A plain job's diff was the one thing nothing ever looked at: green checks, then a pull request marked ready.
 *
 * So, once the checks have passed and the draft pull request exists, the diff is read ONCE against the task. Two models of one family
 * share blind spots, so the reviewer is never of the family that wrote the code: the review tier is a pool, the router is told the
 * writer's model, and the model that actually answered is checked again here, exactly as a part's review does.
 *
 * WHAT IT MAY CONCLUDE, AND WHAT THAT COSTS. It answers findings and nothing else: it cannot edit, commit or ask. A blocker or a
 * major finding leaves the pull request a DRAFT with the reason, so a person looks before anything merges; the rest is written in the
 * pull request and the report. It NEVER sends the job back to work, so a review cannot cost more than the one call it is — the person
 * reads it and asks for the fix if they want it.
 *
 * WHEN IT DOES NOT RUN. No reviewer of another family, too little budget left, no diff to read, a job that is a team's or a merge
 * (those have their own review), or `CODE_JOB_REVIEW` off. Then it is SKIPPED WITH THE REASON, said in the report: a review nobody
 * made is never recorded as a pass.
 *
 * THE EVIDENCE BAR APPLIES TO THE REVIEWER TOO (`work/findings.ts cleanFinding`): a claim serious enough to stop a pull request has to
 * show how it happens, from what someone controls to what comes of it, or it is kept as the lesser thing it is. After Cloudflare's
 * security-audit skill (MIT; the idea, not its text).
 */
import { z } from "zod";
import { routeStep } from "../brain/route.js";
import { familyOf } from "../brain/tiers.js";
import type { Classification } from "../brain/types.js";
import { cleanFinding, redactText, type Finding } from "../work/index.js";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";
import { partDiff, type FileChange } from "../team/diff.js";

/** The most of the diff the reviewer is shown: a review is one call, so it is bounded as a part's review is. */
export const REVIEW_DIFF_CHARS = 24_000;
/** The most it may write. */
export const REVIEW_TOKENS = 2_000;
/** Below this, a job's money is better spent finishing than reviewing. */
export const REVIEW_MIN_PAISE = 15;
/** The most findings kept from one review. */
export const REVIEW_FINDINGS_MAX = 12;

export const JobReviewVerdict = z.object({
  summary: z.string().max(600),
  findings: z.array(z.object({
    severity: z.enum(["blocker", "major", "minor", "note"]),
    path: z.string().max(300),
    line: z.number().int().min(1).nullable().optional(),
    text: z.string().min(1).max(600),
    how: z.string().max(400).nullable().optional(),
  })).max(20).optional(),
});
export type JobReviewReply = z.infer<typeof JobReviewVerdict>;

export interface ReviewFinding {
  severity: "blocker" | "major" | "minor" | "note";
  path: string;
  line?: number;
  text: string;
  /** How it happens, when the reviewer showed it: a claim that stops a pull request needs one. */
  how?: string;
  verdict?: Finding["verdict"];
}

/** What a review came to, as the job keeps it. */
export interface JobReview {
  /** "read": a model read it. "skipped": nobody did, and `note` says why — never a pass. */
  status: "read" | "skipped";
  summary: string;
  model?: string;
  /** The family that wrote the code, so a reader can see the reviewer was not its kin. */
  writerFamily?: string;
  findings: ReviewFinding[];
  /** Whether what was found keeps the pull request a draft. Code's word, not the model's. */
  blocking: boolean;
  note?: string;
  paise: number;
  at: number;
}

const BAD = new Set(["blocker", "major"]);

/** Whether what was found keeps the pull request a draft. */
export const blockingOf = (findings: readonly ReviewFinding[]): boolean => findings.some((f) => BAD.has(f.severity));

/**
 * The reviewer's findings as they are kept: only paths that are in the diff, the words and the evidence through the same door a
 * flagged finding goes through (`cleanFinding`), at most a dozen, the worst first. A blocker or major that could not show HOW it
 * happens is lowered to minor: still worth reading, no longer enough to stop a pull request on the model's word alone.
 */
export function cleanReviewFindings(raw: JobReviewReply["findings"], paths: ReadonlySet<string>): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const f of raw ?? []) {
    if (!paths.has(f.path)) continue;
    const claim = BAD.has(f.severity) ? "risk" : f.severity === "minor" ? "warn" : "info";
    const clean = cleanFinding({ severity: claim, path: f.path, line: f.line ?? undefined, text: f.text, how: f.how ?? undefined });
    if (!clean) continue;
    const severity = BAD.has(f.severity) && clean.verdict === "needs_checking" ? "minor" : f.severity;
    out.push({
      severity, path: clean.path, ...(clean.line !== undefined ? { line: clean.line } : {}), text: clean.text,
      ...(clean.how ? { how: clean.how } : {}), ...(clean.verdict ? { verdict: clean.verdict } : {}),
    });
    if (out.length >= REVIEW_FINDINGS_MAX) break;
  }
  const rank = { blocker: 0, major: 1, minor: 2, note: 3 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface ReviewInput {
  task: string;
  /** What the job said it did. */
  summary: string;
  /** The plan's steps, a line each, when the job had a plan. */
  plan?: readonly string[];
  changes: readonly FileChange[];
  /** What the project's checks said, in a line. */
  checks: string;
  classification?: Classification;
  /** The model that wrote the code: the reviewer is never of its family. */
  writerModel?: string;
  remainingPaise?: number;
}

/** The one message the reviewer reads. Everything from the job and the repo is data, fenced, and never an instruction. */
export function reviewMessage(i: ReviewInput, diff: string): string {
  return [
    `<request>\n${fence(cut(forModel(i.task), 1500))}\n</request>`,
    i.plan?.length ? `the plan it worked to:\n<data>\n${fence(i.plan.slice(0, 10).map((p) => `- ${cut(forModel(p), 200)}`).join("\n"))}\n</data>` : "",
    i.summary ? `what the job says it did:\n<data>\n${fence(cut(forModel(i.summary), 1200))}\n</data>` : "",
    i.checks ? `what the project's own checks said: ${cut(oneLine(i.checks, 300), 300)}` : "",
    `the diff of the change:\n<data>\n${fence(forModel(diff))}\n</data>`,
  ].filter(Boolean).join("\n");
}

/**
 * Reads one job's change. Never throws for money or a model that is down: those are a review that was skipped, with the reason,
 * because a job's work is not undone by a second opinion it could not get. A stop of the job itself is the caller's (`aborted`).
 */
export async function reviewJob(i: ReviewInput, model: ModelCtx, now: number): Promise<JobReview & { aborted?: boolean }> {
  const writer = i.writerModel?.trim() || undefined;
  const writerFamily = writer ? familyOf(writer) : undefined;
  const base = { findings: [] as ReviewFinding[], blocking: false, paise: 0, at: now, ...(writerFamily ? { writerFamily } : {}) };
  const skipped = (note: string, extra: Partial<JobReview> = {}): JobReview => ({ ...base, status: "skipped", summary: "", note, ...extra });

  const diff = partDiff(i.changes, REVIEW_DIFF_CHARS);
  if (!diff.files || !diff.text.trim()) return skipped("there was no change to read");

  const cls: Classification = i.classification ?? {
    type: "feature", difficulty: "medium", risk: "medium", needs: { web: false, exec: false, vision: false, indic: false }, language: "en", confidence: 0.8, signals: [],
  };
  const route = routeStep("review", cls, { ...(writer ? { writerModel: writer } : {}) },
    i.remainingPaise !== undefined ? { budget: { remainingPaise: i.remainingPaise, inputChars: diff.text.length + 3000, maxTokens: REVIEW_TOKENS } } : {});
  if (route.stop === "no_reviewer") return skipped("no model of a different family from the one that wrote it could be had");
  if (route.stop === "budget") return skipped("the budget left was too small for a review");
  if (i.remainingPaise !== undefined && i.remainingPaise < REVIEW_MIN_PAISE) return skipped("the budget left was too small for a review");

  const r = await askJson(model, {
    tier: "review", ...(route.model ? { model: route.model } : {}), ...(writer ? { writerModel: writer } : {}),
    purpose: "code.review", role: "code_review", schema: JobReviewVerdict, maxTokens: REVIEW_TOKENS, user: reviewMessage(i, diff.text),
  });
  if (!r.ok) {
    if (r.reason === "aborted") return { ...skipped("the review was stopped"), aborted: true };
    return skipped(r.reason === "budget" ? "the budget left was too small for a review" : "no reviewer could be reached");
  }
  // The answer came from the writer's own family (the gateway moved down the pool): not a review, whatever it says.
  if (writerFamily && familyOf(r.model) === writerFamily) {
    return skipped("the only reviewer that answered is of the family that wrote the code, which is no review", { model: r.model, paise: r.paise });
  }

  const findings = cleanReviewFindings(r.value.findings, new Set(i.changes.map((c) => c.path)));
  return {
    ...base, status: "read", summary: redactText(oneLine(forModel(r.value.summary), 600), 600),
    model: r.model, findings, blocking: blockingOf(findings), paise: r.paise,
  };
}

/** The review in words, for the report and the pull request. */
export function reviewLines(r: JobReview | undefined): string[] {
  if (!r) return [];
  if (r.status === "skipped") return [`Nobody read this change: ${r.note ?? "no reason given"}. The project's checks are all that vouch for it.`];
  const out = [`Read by ${r.model ?? "another model"}${r.writerFamily ? ", not of the family that wrote it" : ""}: ${r.summary || "nothing to say"}`];
  for (const f of r.findings) {
    out.push(`- **${f.severity}** \`${f.path}${f.line ? `:${f.line}` : ""}\`: ${f.text}${f.how ? ` — how it happens: ${f.how}` : ""}`);
  }
  if (r.blocking) out.push("The pull request is left a draft because of what is marked blocker or major above.");
  return out;
}
