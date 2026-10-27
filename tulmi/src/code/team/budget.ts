/**
 * THE TEAM'S MONEY AND ITS PARALLELISM: HOW A BUDGET IS DIVIDED, AND HOW MANY HELPERS WORK AT ONCE.
 *
 * ONE BUDGET BOUNDS ALL OF IT. The person gives the lead job a budget; that is the whole team's. The lead keeps a RESERVE of 20% for itself (part 0,
 * the reviews, a conflict, the full check, the pull request) and divides the rest among the helpers by their `budgetShare`. A helper's slice is its own
 * job's budget, so the gateway stops it at its slice like any job (a part that runs out stops cleanly, the way a job does, and is reported). The slices are
 * TAKEN from the lead's wallet when they are handed out (the lead's spend goes up by the pool), so nothing the lead does afterwards can spend what a helper was
 * given, and what a part did not spend is given back when it ends (the lead's spend comes down). The figure the person sees on the lead is therefore the
 * team's whole cost, once it is over.
 *
 * PARALLEL. Helpers work at once up to `parallelCap`: CODE_TEAM_PARALLEL (3), never more than the server drives at once, and less when the places to run
 * them are few: the person's own PC first (free, and one step at a time on it), then GitHub's free computers, whose minutes are limited and shared, then
 * paid compute only by the person's own rule. With no PC and few Actions minutes left, helpers go one at a time rather than pile up waiting for a place.
 */
import type { JobStore } from "../jobs/store.js";
import { PART_PAISE_MIN, PARALLEL_DEFAULT, RESERVE_FRACTION } from "./types.js";

/** What the lead keeps back from a budget, in paise. */
export const reserveOf = (budgetPaise: number): number => Math.ceil(Math.max(0, budgetPaise) * RESERVE_FRACTION);

/**
 * The pool divided by the parts' shares, in whole paise: each slice is the pool times its share rounded down, and what is left over goes to the biggest
 * shares first, one paise each, so the slices add up to the pool exactly. Shares that are not positive count as 1. Parts in, slices out, same order.
 */
export function sliceBudgets(poolPaise: number, shares: readonly number[]): number[] {
  const pool = Math.max(0, Math.floor(poolPaise));
  if (!shares.length) return [];
  const w = shares.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  const total = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.floor((pool * x) / total));
  let left = pool - out.reduce((a, b) => a + b, 0);
  const order = w.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length) { out[order[k]![1]]! += 1; left -= 1; }
  return out;
}

/** Whether a budget can pay a team at all: the reserve, and at least PART_PAISE_MIN for each helper. What is short, in paise, when it cannot. */
export function affordable(remainingPaise: number, reservePaise: number, helpers: number): { ok: true } | { ok: false; needPaise: number } {
  const need = reservePaise + helpers * PART_PAISE_MIN;
  return remainingPaise >= need ? { ok: true } : { ok: false, needPaise: need - Math.max(0, remainingPaise) };
}

export interface Capacity {
  /** The person's PCs that could take a step now. */
  desktops: number;
  /** GitHub's free computers may be used for this project. */
  githubEnabled: boolean;
  /** Minutes of them left this month. */
  githubMinutesLeft: number;
  /** There is paid compute, by the person's rule, to fall back on. */
  paidAvailable: boolean;
}

/** About what one helper's steps use, in minutes of a computer: an install, the checks, a few runs. */
export const MINUTES_PER_HELPER = 20;

/** Helpers at once, and the sentence that says why when it is fewer than asked. */
export function parallelCap(o: { configured?: number; concurrency?: number; capacity?: Capacity }): { cap: number; why: string } {
  const asked = Math.max(1, Math.floor(o.configured ?? PARALLEL_DEFAULT));
  let cap = asked;
  let why = "";
  if (o.concurrency !== undefined && o.concurrency < cap) { cap = Math.max(1, Math.floor(o.concurrency)); why = `this server drives ${cap} job${cap === 1 ? "" : "s"} at once`; }
  const c = o.capacity;
  if (c && c.desktops === 0) {
    if (!c.githubEnabled && !c.paidAvailable) { cap = 1; why = "none of your computers is online and GitHub's free computers and paid compute are not available, so helpers go one at a time"; }
    else if (c.githubEnabled && !c.paidAvailable) {
      const byMinutes = Math.max(1, Math.floor(c.githubMinutesLeft / MINUTES_PER_HELPER));
      if (byMinutes < cap) { cap = byMinutes; why = `GitHub's free computers have ${Math.max(0, Math.floor(c.githubMinutesLeft))} minutes left this month`; }
    }
  }
  return { cap: Math.max(1, cap), why };
}

/**
 * Adds to a job's spend, or takes from it (a negative number), never below 0. A compare-and-set on the spend, like the brain's (brain/spend.ts), but one that can
 * go down: it is how a slice is taken from the lead when it is handed out and how what a part did not spend is given back. Returns the spend after, or null when
 * the job is gone or the change kept losing to others.
 */
export async function adjustSpend(store: Pick<JobStore, "getJobById" | "casJob">, jobId: string, deltaPaise: number): Promise<number | null> {
  const delta = Math.round(deltaPaise);
  for (let i = 0; i < 8; i += 1) {
    const job = await store.getJobById(jobId);
    if (!job) return null;
    if (delta === 0) return job.spentPaise;
    const next = await store.casJob(jobId, { spentPaise: job.spentPaise }, { spentPaise: Math.max(0, job.spentPaise + delta) });
    if (next) return next.spentPaise;
  }
  return null;
}
