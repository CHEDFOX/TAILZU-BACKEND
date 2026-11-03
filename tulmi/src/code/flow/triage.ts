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

export async function triage(ctx: ModelCtx, i: TriageInput, now = Date.now()): Promise<Triage> {
  const r = await askJson(ctx, {
    tier: "cheap", purpose: "flow.triage", role: "code_triage", schema: TriageOut, maxTokens: 900,
    user: [
      block("plan", [`Goal: ${i.plan.goal}`, ...i.plan.steps.map((s, n) => `${n + 1}. ${s}`)].join("\n")),
      ...(i.keep ? [block("keep", `Must not change: ${i.keep}`)] : []),
      block("doing", oneLine(i.doing, 300) || "working on the plan"),
      block("message", cut(i.message, 2000) || "(no words, only the picture)"),
      ...(i.picture ? [block("picture", cut(i.picture, 1500))] : []),
    ].join("\n\n"),
  });
  if (!r.ok) {
    return { kind: "addon", affects: [], say: "Got it. I've passed this to the work.", paise: 0 };
  }
  const v = r.value;
  const affects = [...new Set((v.affects ?? []).filter((n) => n <= i.plan.steps.length))].sort((a, b) => a - b);
  const say = oneLine(v.say, 1500) || defaultSay(v.kind);
  if (v.kind === "change" && v.steps?.length) {
    const plan: ProjectPlan = {
      ...i.plan, v: i.plan.v + 1, goal: oneLine(v.goal || i.plan.goal, 200), steps: v.steps.map((s) => oneLine(s, 200)).filter(Boolean).slice(0, STEPS_MAX),
      status: "proposed", change: oneLine(v.change ?? "", 200) || undefined, at: now,
    };
    return { kind: "change", affects, say, plan, paise: r.paise };
  }
  // A change with no new steps is not a change anyone can approve: it goes to the job as words.
  return { kind: v.kind === "change" ? "addon" : v.kind, affects: v.kind === "change" ? [] : affects, say, paise: r.paise };
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

/** What the job is told, by kind: an add-on as the person's words; a change as which steps wait; a yes as the new plan. */
export function jobNote(t: Triage, message: string, picture?: string): string | null {
  const pic = picture ? `\n\nThey sent a picture with it. What it shows: ${cut(picture, 1200)}` : "";
  if (t.kind === "addon") return `${cut(message, 2000)}${pic}`;
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
