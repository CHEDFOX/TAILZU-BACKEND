/**
 * A REVIEWER'S COMMENT, READ: WHAT KIND OF ASK IS IT, AND WHAT TO WRITE BACK.
 *
 * One call of the `care_review` role, on the cheap tier, for each new comment on a pull request Tailzu looks after (docs/pr-care.md section 4):
 *
 *   small      a nit, a rename, a typo, a missing guard or test: a few lines, nothing else changes, nobody needs to decide. Tailzu does it (a job on the
 *              branch), replies under the comment, and resolves the thread once the change is on the branch
 *   large      a redesign, a new feature, a change across modules, a choice between ways, anything that could break behaviour. Tailzu replies with a PROPOSAL
 *              (what it would change, what it touches, what could break) and tells the person; it changes nothing until they say so
 *   question   why, or what for. Tailzu answers from the job's work log alone, and says so when the log does not show the reason
 *   other      thanks, approval, chat. Nothing is done
 *
 * The comment is somebody else's words: it goes to the model as DATA, fenced, with the code it is on and the work log. Two rules are not left to the model:
 * a comment that asks to skip, disable or weaken a test or a check is never a "small" ask (it is made a proposal that says Tailzu will not), and the reply
 * is cut and cleaned of anything that looks like a secret before it is written to a public page.
 */
import { z } from "zod";
import { askJson, cut, forModel, oneLine, type ModelCtx } from "../work/model.js";
import { redactText } from "../work/worklog.js";
import { CARE_REPLY_MAX } from "./types.js";

export const REVIEW_KINDS = ["small", "large", "question", "other"] as const;

export const ReviewVerdict = z.object({
  kind: z.enum(REVIEW_KINDS),
  summary: z.string().max(400),
  reply: z.string().max(CARE_REPLY_MAX * 2),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/** What the model is shown of one comment. */
export interface ReviewInput {
  title: string;
  author: string;
  /** The comment's words, as written. */
  body: string;
  /** Where on the diff, when it is a review comment. */
  path?: string;
  line?: number;
  /** The lines of the file around the comment, as they are now. */
  code?: string;
  /** What the job that made this pull request wrote down: its decisions and steps, cut. */
  workLog: string;
}

const COMMENT_SHOWN = 1500;
const CODE_SHOWN = 1500;
const LOG_SHOWN = 2000;

/** Text in a tag it cannot close. */
const wrap = (tag: string, attrs: string, text: string): string =>
  `<${tag}${attrs}>\n${text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`)}\n</${tag}>`;

const attr = (v: string): string => v.replace(/["<>\n]/g, " ").slice(0, 160);

/** The dynamic message of the call, exactly as evals/care_review.jsonl holds it. */
export function reviewInput(i: ReviewInput): string {
  const where = i.path ? ` path="${attr(i.path)}"${i.line ? ` line="${i.line}"` : ""}` : "";
  return [
    `<pull_request>${oneLine(i.title, 200)}</pull_request>`,
    wrap("comment", ` author="${attr(i.author)}"${where}`, forModel(cut(i.body, COMMENT_SHOWN))),
    ...(i.code ? [wrap("code", i.path ? ` path="${attr(i.path)}"` : "", forModel(cut(i.code, CODE_SHOWN)))] : []),
    wrap("work_log", "", forModel(cut(i.workLog || "(nothing was written down)", LOG_SHOWN))),
  ].join("\n");
}

/**
 * A comment that asks Tailzu to get CI green or the review done by skipping, disabling, deleting or loosening a test or a check. Whatever the model said,
 * such a comment is not a small ask: Tailzu never does that, and says so.
 */
const TEST_WORDS = String.raw`tests?|specs?|assert(?:ion)?s?|checks?|lint(?:er|ing)?|coverage|ci|type[- ]?check(?:ing)?`;
const WEAKEN_OBJECT = String.raw`(?:(?:the|this|that|those|these|failing|flaky|broken|unit|new|old|a|an|its|their|any)\s+){0,3}(?:\w+\s+){0,2}?(?:${TEST_WORDS})`;
/** "skip the failing test", "disable that flaky test", "remove the lint check", "mark it as flaky": the verb and the thing it is done to. */
const WEAKEN = new RegExp(
  String.raw`\b(?:(?:skip|disable|comment(?:ed)?\s+out|delete|remove|drop|ignore|xfail|loosen|relax|weaken|silence|bypass|turn\s+off)\s+${WEAKEN_OBJECT}|mark\s+(?:\w+\s+){0,3}(?:flaky|skipped))\b`, "i",
);
/** "just skip it": the thing is said elsewhere in the comment, so the comment has to speak of a test or a check at all. */
const WEAKEN_IT = /\b(?:skip|disable|comment(?:ed)?\s+out|bypass|silence|turn\s+off|ignore)\s+(?:it|them|that|this|those)\b/i;
const SPEAKS_OF_TESTS = new RegExp(String.raw`\b(?:${TEST_WORDS})\b`, "i");
const XFAIL = /\bxfail\b/i;

export const asksToWeaken = (body: string): boolean => WEAKEN.test(body) || XFAIL.test(body) || (WEAKEN_IT.test(body) && SPEAKS_OF_TESTS.test(body));

const REFUSAL = "I won't skip, disable, delete or loosen a test or a check to get this through. If the test is wrong, tell me what it should check instead and I will change it to that; if the code is wrong, I will fix the code.";

/** The verdict as it is used: cut and cleaned, and a request to weaken a test made a proposal that says no. */
export function settle(v: ReviewVerdict, comment: string): ReviewVerdict {
  const clean = (t: string, n: number): string => redactText(t.replace(/\r\n?/g, "\n").trim(), n);
  if (asksToWeaken(comment) && (v.kind === "small" || v.kind === "other")) {
    return { kind: "large", summary: oneLine(v.summary, 300) || "The comment asks to skip or loosen a test or check.", reply: REFUSAL };
  }
  return { kind: v.kind, summary: oneLine(redactText(v.summary, 300), 300), reply: clean(v.reply, CARE_REPLY_MAX) };
}

/** The model's verdict on one comment, or null when no model could be reached or the call was not affordable (the comment is then left for the next event). */
export async function readComment(ctx: ModelCtx, i: ReviewInput): Promise<ReviewVerdict | null> {
  const asked = await askJson(ctx, {
    tier: "cheap", purpose: "care.review", role: "care_review", schema: ReviewVerdict, maxTokens: 500, user: reviewInput(i),
  });
  return asked.ok ? settle(asked.value, i.body) : null;
}
