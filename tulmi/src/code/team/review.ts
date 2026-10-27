/**
 * THE REVIEW: A MODEL OF ANOTHER FAMILY READS EACH FINISHED PART AGAINST ITS GOAL (role team_review, the review tier).
 *
 * Two models of one family share blind spots, so a part is never reviewed by the family that wrote it: the review tier is a pool, the router names the first
 * model in it of a different family from the helper's (brain/route.ts, `routeStep("review", ..., { writerModel })`), the gateway is told the writer's model as
 * well and never moves down the pool to its own kin, and the answer is checked once more here by the model that actually answered. If no model of another family
 * can be had the part is NOT reviewed by one of the same family: the review is recorded as skipped, with the reason, and the final full check is what vouches for it.
 *
 * What the reviewer sees is the part's goal and acceptance, the files it owns, what the helper said it did, what the helper's checks said, and the diff of the
 * part against the commit it was cut from (diff.ts), all as data. It answers { verdict, summary, findings }; a blocker or a major finding makes the verdict
 * "fix", whatever the model wrote in `verdict` (code decides, not the model). Findings trigger at most REVIEW_FIX_ROUNDS_MAX fix rounds in the helper.
 */
import { z } from "zod";
import { routeStep } from "../brain/route.js";
import { familyOf } from "../brain/tiers.js";
import type { Classification } from "../brain/types.js";
import { redactText } from "../work/index.js";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";
import { partDiff, diffLine, type FileChange } from "./diff.js";
import { REVIEW_DIFF_CHARS, type PartReview, type ReviewFinding, type TeamPart } from "./types.js";

export const PartReviewVerdict = z.object({
  verdict: z.enum(["pass", "fix"]),
  summary: z.string().max(600),
  findings: z.array(z.object({
    severity: z.enum(["blocker", "major", "minor", "note"]),
    path: z.string().max(300),
    line: z.number().int().min(1).nullable().optional(),
    text: z.string().min(1).max(600),
  })).max(20).optional(),
});
export type PartReviewVerdict = z.infer<typeof PartReviewVerdict>;

const REVIEW_TOKENS = 1400;

/** The findings that make a fix round: a blocker or a major one. */
export const needsFix = (f: readonly ReviewFinding[]): boolean => f.some((x) => x.severity === "blocker" || x.severity === "major");
export const hasBlocker = (f: readonly ReviewFinding[]): boolean => f.some((x) => x.severity === "blocker");

export interface ReviewInput {
  part: Pick<TeamPart, "id" | "title" | "goal" | "ownedPaths" | "acceptance" | "refused" | "summary" | "helperModel">;
  /** The part's changes: each path the helper's commits touched, as it was when the branch was cut and as it is now. */
  changes: readonly FileChange[];
  /** What the helper's own checks said. */
  checks?: string;
  classification?: Classification;
  /** The lead's remaining money for this call, in paise (a review the lead cannot afford is skipped, not a stopped job). */
  remainingPaise?: number;
}

export function reviewMessage(i: ReviewInput, diff: string): string {
  const p = i.part;
  return [
    `<request>\n${fence(cut(forModel(p.goal), 1500))}\n</request>`,
    `part ${p.id}: ${oneLine(p.title, 80)}`,
    p.acceptance.length ? `acceptance:\n<data>\n${fence(p.acceptance.map((a) => `- ${cut(forModel(a), 300)}`).join("\n"))}\n</data>` : "",
    `the files this part owns: ${p.ownedPaths.slice(0, 12).join(", ")}`,
    p.summary ? `what the helper says it did:\n<data>\n${fence(cut(forModel(p.summary), 1200))}\n</data>` : "",
    i.checks ? `what the helper's own checks said: ${cut(oneLine(i.checks, 300), 300)}` : "",
    p.refused.length ? `the helper asked for changes outside its files (it was refused): ${p.refused.slice(0, 8).join(", ")}` : "",
    `the diff of the part:\n<data>\n${fence(forModel(diff))}\n</data>`,
  ].filter(Boolean).join("\n");
}

/** The model's findings, cleaned: only paths that are in the diff, text without secrets, at most a dozen. */
export function cleanFindings(raw: PartReviewVerdict["findings"], paths: ReadonlySet<string>): ReviewFinding[] {
  return (raw ?? []).slice(0, 12).map((f): ReviewFinding => ({
    severity: f.severity, path: paths.has(f.path) ? f.path : "", ...(typeof f.line === "number" ? { line: f.line } : {}), text: redactText(oneLine(f.text, 400), 400),
  })).filter((f) => f.text);
}

/** The findings as the words a helper's fix round is given (data to act on). */
export function findingsText(findings: readonly ReviewFinding[], summary = ""): string {
  const lines = findings.filter((f) => f.severity !== "note").map((f) => `- ${f.severity}${f.path ? ` ${f.path}${f.line ? `:${f.line}` : ""}` : ""}: ${f.text}`);
  return [summary ? `Reviewer's summary: ${summary}` : "", ...lines].filter(Boolean).join("\n");
}

/**
 * Reviews one part. Never throws for money or a model that is down: those are a review that was skipped, with the reason, because the lead's job is not to
 * be stopped by a second opinion it could not get. (A stop of the lead itself is the caller's: `aborted`.)
 */
export async function reviewDiff(model: ModelCtx, i: ReviewInput, round: number, now: number): Promise<PartReview & { aborted?: boolean }> {
  const writer = i.part.helperModel;
  const writerFamily = writer ? familyOf(writer) : undefined;
  const base = { round, findings: [] as ReviewFinding[], paise: 0, at: now, ...(writerFamily ? { writerFamily } : {}) };
  const skipped = (summary: string, extra: Partial<PartReview> = {}): PartReview => ({ ...base, verdict: "skipped", summary, ...extra });

  const diff = partDiff(i.changes, REVIEW_DIFF_CHARS);
  if (!diff.files) return skipped("The part's diff is empty, so there is nothing to review.");

  const cls: Classification = i.classification ?? { type: "feature", difficulty: "medium", risk: "medium", needs: { web: false, exec: false, vision: false, indic: false }, language: "en", confidence: 0.8, signals: [] };
  const route = routeStep("review", cls, { ...(writer ? { writerModel: writer } : {}) }, i.remainingPaise !== undefined ? { budget: { remainingPaise: i.remainingPaise, inputChars: diff.text.length + 3000 } } : {});
  if (route.stop === "no_reviewer") return skipped("No model of a different family from the helper's could be had, so this part was not reviewed.");
  if (route.stop === "budget") return skipped("The lead's budget is too short for a review, so this part was not reviewed.");

  const r = await askJson(model, {
    tier: "review", ...(route.model ? { model: route.model } : {}), ...(writer ? { writerModel: writer } : {}), purpose: "team.review", role: "team_review",
    schema: PartReviewVerdict, maxTokens: REVIEW_TOKENS, user: reviewMessage(i, diff.text),
  });
  if (!r.ok) {
    if (r.reason === "aborted") return { ...skipped("The review was stopped."), aborted: true };
    return skipped(r.reason === "budget" ? "The lead's budget is too short for a review, so this part was not reviewed." : "No reviewer could be reached, so this part was not reviewed.");
  }
  const family = familyOf(r.model);
  // The answer came from the writer's own family (the gateway moved down the pool): not a review, whatever it says.
  if (writerFamily && family === writerFamily) return skipped("The only reviewer that answered is of the same family as the helper, so this part was not reviewed.", { model: r.model, family, paise: r.paise });
  const findings = cleanFindings(r.value.findings, new Set(i.changes.map((c) => c.path)));
  const fix = needsFix(findings);
  return {
    ...base, verdict: fix ? "fix" : "pass", model: r.model, family, summary: redactText(oneLine(r.value.summary, 400), 400) || (fix ? "Problems found." : "No problems found."),
    findings, paise: r.paise,
  };
}

export { diffLine };
