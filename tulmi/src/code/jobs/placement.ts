/**
 * WHERE A STEP THAT NEEDS A COMPUTER SHOULD RUN: THE CHEAPEST PLACE THERE IS.
 *
 * choosePlacement is one pure function: facts in, a decision out, nothing read
 * and nothing written, so the whole truth table can be tested. The router
 * (router.ts) gathers the facts and does what it says. The order is the
 * whole rule:
 *
 *   1. THE PERSON'S OWN PC. Free, and the code never leaves their machine. It
 *      counts only if a Tailzu desktop app of theirs is online, has switched
 *      "run commands" on, is allowed on this project, and is not busy.
 *   2. GITHUB'S FREE COMPUTERS (GitHub Actions). Free up to GitHub's monthly
 *      allowance (2,000 minutes by default, CODE_GITHUB_FREE_MINUTES), which
 *      is shared with everything else the person runs there, so Tailzu counts
 *      only its own use and keeps a tenth back. It counts only if the project
 *      has it set up (the provider says so: githubActions.ts) and the person
 *      hasn't switched it off. A public repo isn't metered, so the allowance
 *      doesn't hold it back; and the CI of the person's own that the push would
 *      also start is added to the step's minutes. Once a step pushed to GitHub
 *      never ran or never reported, the router sets the minutes left to 0 for
 *      the rest of the month.
 *   3. PAID COMPUTE, and only by the person's own rule:
 *        never   it is not used. The step waits;
 *        ask     it is used only for as much as the person has said yes to
 *                for this job, so the first time it asks;
 *        auto    it is used without asking while this month's paid use stays
 *                inside the cap the person set, and asks beyond it.
 *      An "ask" is a question, never a charge.
 *   4. OTHERWISE IT WAITS, and the router tells the person and goes on by
 *      itself when a place frees up.
 *
 * The answer is `{ placement, reason }`, `{ wait, reason }` or
 * `{ ask, reason, estimatePaise }`. `reason` is plain words, fit to show.
 */
import type { ComputeKind, PaidRule } from "./types.js";

export interface PlacementCtx {
  /** The person's PCs that could take this step now: online, allowed to run, allowed on this project, and idle. */
  desktops: number;
  /** The person hasn't switched GitHub's free computers off, there is a provider, and this project has it set up. */
  githubEnabled: boolean;
  /** Minutes of GitHub's free allowance still counted as ours this month (githubMinutesLeft). */
  githubMinutesLeft: number;
  /** Minutes the step would also cost because the person's own CI runs on its push (an estimate; absent: none). */
  githubExtraMinutes?: number;
  /** The repo is public: its minutes aren't metered, so the free allowance does not hold the step back. */
  githubUnmetered?: boolean;
  /** Why the provider said no, as a short code, for the sentence that explains a wait. */
  githubWhy?: string;
  paidRule: PaidRule;
  /** There is paid compute on this server to use at all. */
  paidAvailable: boolean;
  /** Paise that may be spent on this step without asking: what the rule allows plus what the person said yes to for this job. */
  paidLeftPaise: number;
  /** How long the step is expected to run. */
  estimateMinutes: number;
  /** What that would cost on paid compute, in paise. */
  estimatePaise: number;
}

export type PlacementChoice =
  | { placement: ComputeKind; reason: string }
  | { wait: true; reason: string }
  | { ask: true; reason: string; estimatePaise: number };

/** GitHub's free allowance is shared with the person's other work; keep this share back. */
export const GITHUB_HEADROOM = 0.1;
/** GitHub's own monthly allowance on a free plan, in minutes. */
export const GITHUB_FREE_MINUTES_DEFAULT = 2000;

/**
 * The minutes of GitHub's free allowance Tailzu may still use this month:
 * the allowance less a tenth kept back, less what Tailzu has already used.
 * Never below zero. An estimate: GitHub's own meter is the truth, and only
 * Tailzu's use is on Tailzu's.
 */
export function githubMinutesLeft(freeMinutes: number, usedMinutes: number, headroom = GITHUB_HEADROOM): number {
  const free = Number.isFinite(freeMinutes) ? Math.max(0, freeMinutes) : 0;
  const used = Number.isFinite(usedMinutes) ? Math.max(0, usedMinutes) : 0;
  return Math.max(0, Math.floor(free * (1 - headroom)) - used);
}

/** Paise as rupees for a sentence: 1250 is "₹12.50", 200 is "₹2". */
export function rupees(paise: number): string {
  const p = Math.max(0, Math.round(paise));
  const whole = Math.floor(p / 100);
  const part = p % 100;
  return part === 0 ? `₹${whole}` : `₹${whole}.${String(part).padStart(2, "0")}`;
}

export function choosePlacement(ctx: PlacementCtx): PlacementChoice {
  const minutes = Math.max(1, Math.ceil(Number.isFinite(ctx.estimateMinutes) ? ctx.estimateMinutes : 1));

  // 1. The person's own PC.
  if (ctx.desktops > 0) return { placement: "desktop", reason: "Your own computer is online and allowed to run this project." };

  // 2. GitHub's free computers. A public repo isn't metered; otherwise the step, and the CI of the person's own it would also start, must fit.
  const extra = Math.max(0, Math.ceil(Number.isFinite(ctx.githubExtraMinutes ?? 0) ? ctx.githubExtraMinutes ?? 0 : 0));
  if (ctx.githubEnabled && (ctx.githubUnmetered === true || minutes + extra <= ctx.githubMinutesLeft)) {
    return { placement: "github", reason: "GitHub's free computers have minutes left this month." };
  }

  // 3. Paid compute, by the person's rule.
  const noPc = "none of your computers is online and allowed for this project";
  const noGithub = ctx.githubEnabled ? "this month's free GitHub minutes are used up" : GITHUB_WHY[ctx.githubWhy ?? ""] ?? "GitHub's free computers aren't set up for this project";
  if (ctx.paidRule !== "never" && ctx.paidAvailable) {
    const estimatePaise = Math.max(0, Math.ceil(ctx.estimatePaise));
    if (estimatePaise <= Math.max(0, ctx.paidLeftPaise)) {
      return {
        placement: "paid",
        reason: ctx.paidRule === "auto"
          ? `Paid compute is on automatic and this fits your monthly limit (about ${rupees(estimatePaise)}).`
          : `You said yes to paid compute for this job (about ${rupees(estimatePaise)}).`,
      };
    }
    return {
      ask: true, estimatePaise,
      reason: ctx.paidRule === "auto"
        ? `${cap(noPc)} and ${noGithub}, and paid compute (about ${rupees(estimatePaise)}) would go over your monthly automatic limit. It needs your yes.`
        : `${cap(noPc)} and ${noGithub}. Paid compute would cost about ${rupees(estimatePaise)} and you asked to be asked first.`,
    };
  }

  // 4. Nowhere: wait.
  const noPaid = ctx.paidRule === "never" ? "paid compute is off" : "there is no paid compute to use";
  return { wait: true, reason: `${cap(noPc)}, ${noGithub}, and ${noPaid}. It will carry on by itself when one is.` };
}

/** What a provider's short reason for saying no means, in the sentence that explains a wait. */
const GITHUB_WHY: Record<string, string> = {
  needs_workflow_permission: "GitHub's free computers need the Tailzu GitHub App to have the Workflows and Actions permissions (or your sign-in to allow workflows)",
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
