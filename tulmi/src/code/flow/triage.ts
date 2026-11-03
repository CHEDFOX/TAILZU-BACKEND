/**
 * WHAT A MESSAGE SENT WHILE XODE WORKS MEANS FOR THE WORK: does it change the approved plan, or not?
 *
 *   triage(ctx, i)   one cheap call, one of:
 *     question   it asks something: answered now, from the plan and what the job is doing; the work goes on
 *     addon      a detail or an extra that fits the plan without redoing anything (a colour, a name, a picture to follow): handed to the
 *                job; the work goes on
 *     change     it asks for different work, or undoes or reorders a step: a new version of the plan, for the person's yes; only the
 *                steps it touches (affects) wait, the rest go on
 *     mockup     it asks to see a design first: a mockup is made; the work goes on
 *     stop       it asks to stop the work: confirmed with the person, never done on a guess
 *     note       thanks, ok, a remark: said back to, nothing else
 *
 * A picture is read first (its description, by the vision tier) and judged with the words. The rule is the whole point: only a change to
 * the plan stops anything, and then only the part it touches. A model that cannot answer reads as "addon": the words still reach the job,
 * which is never worse than dropping them.
 */
import { z } from "zod";
import { classifyByRules } from "../brain/classify.js";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";
import { STEPS_MAX, type ProjectPlan } from "./plan.js";

export const TRIAGE_KINDS = ["question", "addon", "change", "mockup", "stop", "note"] as const;
export type TriageKind = (typeof TRIAGE_KINDS)[number];

export interface Triage {
  kind: TriageKind;
  /** Plan steps (1-based) a change touches: these wait for the person's yes. */
  affects: number[];
  /** What Xode says back: the answer to a question, else one short line on what happens now. */
  say: string;
  /** For a change: the plan's next version. */
  plan?: ProjectPlan;
  paise: number;
}

/** What code_triage answers (the evals read it with the same parser). */
export const TriageOut = z.object({
  kind: z.enum(TRIAGE_KINDS),
  affects: z.array(z.number().int().min(1).max(STEPS_MAX)).max(STEPS_MAX).default([]),
  say: z.string().max(1500),
  goal: z.string().max(200).optional(),
  steps: z.array(z.string().min(2).max(200)).max(STEPS_MAX).optional(),
  change: z.string().max(200).optional(),
});

export interface TriageInput {
  plan: ProjectPlan;
  /** What the job is doing now, in a line ("Working · step 2: the results page"). */
  doing: string;
  message: string;
  /** A picture sent with it, as the vision tier described it. */
  picture?: string;
  keep?: string;
}

const block = (tag: string, text: string) => `<${tag}>\n${fence(forModel(text))}\n</${tag}>`;

/** The language a reply is written in, read from the person's own words by rules (never a guess from the project). */
export function replyLanguage(message: string): string {
  if (!message.trim()) return "English";
  const l = classifyByRules(message, { repoEmpty: false }).language;
  // A language is named only when the message is in it; any other (Tamil, Bengali, Arabic...) is answered in its own.
  return l === "hinglish" ? "Hinglish (Hindi in Latin letters)" : l === "hi" ? "Hindi" : l === "other" ? "the same language and script as <message>" : "English";
}

export async function triage(ctx: ModelCtx, i: TriageInput, now = Date.now()): Promise<Triage> {
  const r = await askJson(ctx, {
    tier: "cheap", purpose: "flow.triage", role: "code_triage", schema: TriageOut, maxTokens: 900,
    user: [
      block("plan", [`Goal: ${i.plan.goal}`, ...i.plan.steps.map((s, n) => `${n + 1}. ${s}`)].join("\n")),
      ...(i.keep ? [block("keep", `Must not change: ${i.keep}`)] : []),
      block("doing", oneLine(i.doing, 300) || "working on the plan"),
      block("message", cut(i.message, 2000) || "(no words, only the picture)"),
      `Write say in ${replyLanguage(i.message)}.`,
      ...(i.picture ? [block("picture", cut(i.picture, 1500))] : []),
    ].join("\n\n"),
  });
  if (!r.ok) {
    return { kind: "addon", affects: [], say: "Got it. I've passed this to the work.", paise: 0 };
  }
  const v = r.value;
  const affects = [...new Set((v.affects ?? []).filter((n) => n <= i.plan.steps.length))].sort((a, b) => a - b);
  const say = oneLine(v.say, 1500) || defaultSay(v.kind);
  // A "change" with no new plan (the same steps, or none: new work Xode put off) never reaches the job, or it would start on it unasked:
  // it is said back to. One that only rewords one step (a smaller text, a colour) is a detail: it goes to the job, nothing waits for a yes.
  if (v.kind === "change" && (!v.steps?.length || sameSteps(i.plan.steps, v.steps))) return { kind: "note", affects: [], say, paise: r.paise };
  if (v.kind === "change" && minorChange(i.plan.steps, v.steps!)) return { kind: "addon", affects: [], say, paise: r.paise };
  if (v.kind === "change" && v.steps?.length) {
    const plan: ProjectPlan = {
      ...i.plan, v: i.plan.v + 1, goal: oneLine(v.goal || i.plan.goal, 200), steps: v.steps.map((s) => oneLine(s, 200)).filter(Boolean).slice(0, STEPS_MAX),
      status: "proposed", change: oneLine(v.change ?? "", 200) || undefined, at: now,
    };
    return { kind: "change", affects, say, plan, paise: r.paise };
  }
  return { kind: v.kind, affects, say, paise: r.paise };
}

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
const sameSteps = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((s, n) => s.trim().toLowerCase() === b[n]!.trim().toLowerCase());
/** The same steps, at most one of them reworded and still mostly the same words: not a change anyone needs to approve. */
export function minorChange(was: readonly string[], now: readonly string[]): boolean {
  if (was.length !== now.length) return false;
  const differ = now.map((s, n) => [was[n]!, s] as const).filter(([a, b]) => a.trim().toLowerCase() !== b.trim().toLowerCase());
  if (differ.length > 1) return false;
  if (!differ.length) return true;
  const [a, b] = [words(differ[0]![0]), words(differ[0]![1])];
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
}

function defaultSay(k: TriageKind): string {
  switch (k) {
    case "addon": return "Got it. I'll fold that into the work.";
    case "mockup": return "Making a mockup now. The work goes on meanwhile.";
    case "stop": return "Do you want me to stop the work?";
    case "note": return "Noted.";
    default: return "Here's what I know.";
  }
}

/**
 * What the job is told, by kind: an add-on as the person's words; a change as which steps wait; a yes as the new plan. A picture always
 * reaches the job, whatever the kind (a screenshot of a review, a design to follow): answering about it never drops it.
 */
export function jobNote(t: Triage, message: string, picture?: string): string | null {
  const pic = picture ? `\n\nThey sent a picture with it. What it shows: ${cut(picture, 1200)}` : "";
  if (t.kind === "addon" || (picture && (t.kind === "question" || t.kind === "note" || t.kind === "mockup"))) return `${cut(message, 2000)}${pic}`;
  if (t.kind === "change" && t.affects.length) {
    return `The person asked for a change that touches step${t.affects.length > 1 ? "s" : ""} ${t.affects.join(", ")} of the plan. Hold off on ${t.affects.length > 1 ? "those" : "that step"} until they approve the new plan; carry on with the others.${pic}`;
  }
  if (t.kind === "change") return `The person asked for a change to the plan; it waits for their yes. Carry on with what it does not touch.${pic}`;
  return null;
}

/** The job, told the new plan is approved. */
export function approvedNote(plan: ProjectPlan): string {
  return [`The person approved version ${plan.v} of the plan${plan.change ? ` (${plan.change})` : ""}. Follow it from here:`, `Goal: ${plan.goal}`, ...plan.steps.map((s, n) => `${n + 1}. ${s}`)].join("\n").slice(0, 3900);
}
