/**
 * THE PLAN A PERSON AND XODE AGREE ON, BEFORE ANY WORK: made when the chat opens, kept up to date with every message, approved with one tap.
 *
 *   openingPlan(ctx, i)        the first message: where the project stands, where it is heading (the owner's words, or Xode's suggestion,
 *                              said as one), the next piece of work and its steps
 *   keepPlan(ctx, i)           after a message in the chat: the same plan, or a new version when the message asks for different or more work
 *   planTask(plan, i)          the approved plan as the task a job is given: the goal, the steps, what must not change
 *
 * A plan is versioned (v); only the latest is approved. A model that is down or over budget leaves the plan as it was and says so.
 */
import { z } from "zod";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";

export type PlanStatus = "proposed" | "approved" | "working" | "done";
export interface ProjectPlan {
  v: number;
  /** The next piece of work, one line. */
  goal: string;
  /** Where the project stands now (opening only, carried along). */
  state: string;
  /** Where it is heading. */
  direction: string;
  /** The direction is Xode's suggestion, not the owner's words. */
  suggested: boolean;
  steps: string[];
  status: PlanStatus;
  /** What changed in this version, said under the plan. */
  change?: string;
  /** A mockup made for this plan (an artifact's id): approving the plan builds it, in the project's own look, and checks the result. */
  mockup?: string;
  jobId?: string;
  at: number;
}

export const STEPS_MAX = 8;
/** What code_plan_open answers (the evals read it with the same parser). */
export const PlanOut = z.object({
  state: z.string().min(2).max(600),
  direction: z.string().min(2).max(500),
  suggested: z.boolean(),
  goal: z.string().min(3).max(200),
  steps: z.array(z.string().min(2).max(200)).min(1).max(STEPS_MAX),
});
/** What code_plan_keep answers. */
export const KeepOut = z.object({
  kind: z.enum(["same", "revise"]),
  goal: z.string().max(200).optional(),
  steps: z.array(z.string().min(2).max(200)).max(STEPS_MAX).optional(),
  change: z.string().max(200).optional(),
});

export class PlanUnavailable extends Error {
  constructor(readonly reason: "budget" | "down" | "aborted") { super(`plan: ${reason}`); }
}

const block = (tag: string, text: string) => `<${tag}>\n${fence(forModel(text))}\n</${tag}>`;

export interface PlanInput {
  name: string;
  /** The book as a plan reads it (book.ts bookForPlan) and the overview's lines. */
  known: string;
  /** The owner's own words: what it is for, what comes next, what must not change, their vision. */
  owner: { for?: string; next?: string; keep?: string; vision?: string } | null;
}

function ownerBlock(o: PlanInput["owner"]): string {
  if (!o) return "(the owner gave no direction: suggest one from the project, and say it is a suggestion)";
  return [o.vision && `Vision: ${o.vision}`, o.for && `It is for: ${o.for}`, o.next && `Next: ${o.next}`, o.keep && `Must not change: ${o.keep}`].filter(Boolean).join("\n")
    || "(the owner gave no direction: suggest one from the project, and say it is a suggestion)";
}

export async function openingPlan(ctx: ModelCtx, i: PlanInput, now = Date.now()): Promise<ProjectPlan> {
  const r = await askJson(ctx, {
    tier: "cheap", purpose: "flow.plan.open", role: "code_plan_open", schema: PlanOut, maxTokens: 900,
    user: [`Project: ${oneLine(i.name, 80)}`, block("owner", ownerBlock(i.owner)), block("project", cut(i.known, 6000))].join("\n\n"),
  });
  if (!r.ok) throw new PlanUnavailable(r.reason);
  const p = r.value;
  return {
    v: 1, goal: oneLine(p.goal, 200), state: oneLine(p.state, 600), direction: oneLine(p.direction, 500), suggested: p.suggested || !i.owner,
    steps: p.steps.map((s) => oneLine(s, 200)).filter(Boolean).slice(0, STEPS_MAX), status: "proposed", at: now,
  };
}

/**
 * After a message: the plan as it should now be. `answer` is what Xode said back (so a question answered is not mistaken for new work).
 * The same plan comes back untouched (changed: false) unless the message asks for different or more work.
 */
export async function keepPlan(ctx: ModelCtx, i: { plan: ProjectPlan; message: string; answer: string; keep?: string }, now = Date.now()): Promise<{ plan: ProjectPlan; changed: boolean }> {
  const r = await askJson(ctx, {
    tier: "cheap", purpose: "flow.plan.keep", role: "code_plan_keep", schema: KeepOut, maxTokens: 700,
    user: [
      block("plan", [`Goal: ${i.plan.goal}`, ...i.plan.steps.map((s, n) => `${n + 1}. ${s}`)].join("\n")),
      ...(i.keep ? [block("keep", `Must not change: ${i.keep}`)] : []),
      block("message", cut(i.message, 2000)),
      block("answer", cut(i.answer, 1500)),
    ].join("\n\n"),
  });
  if (!r.ok || r.value.kind === "same" || !r.value.steps?.length) return { plan: i.plan, changed: false };
  const steps = r.value.steps.map((s) => oneLine(s, 200)).filter(Boolean).slice(0, STEPS_MAX);
  return {
    plan: {
      ...i.plan, v: i.plan.v + 1, goal: oneLine(r.value.goal || i.plan.goal, 200), steps, status: "proposed",
      change: oneLine(r.value.change ?? "", 200) || undefined, jobId: undefined, at: now,
    },
    changed: true,
  };
}

/** The approved plan, as the task its job is given. */
export function planTask(plan: ProjectPlan, o: { keep?: string; notes?: string[] } = {}): string {
  return [
    plan.goal,
    "",
    "The plan the owner approved (do it in this order; split it as you need, but do not do more):",
    ...plan.steps.map((s, n) => `${n + 1}. ${s}`),
    ...(o.keep ? ["", `Must not change: ${o.keep}`] : []),
    ...(o.notes?.length ? ["", "Also from the owner:", ...o.notes.map((n) => `- ${n}`)] : []),
  ].join("\n").slice(0, 4000);
}
