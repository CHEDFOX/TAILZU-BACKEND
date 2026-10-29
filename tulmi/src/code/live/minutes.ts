/**
 * THE MONTH'S GITHUB ACTIONS MINUTES: WHEN THE PERSON IS TOLD, AND WHEN TAILZU STOPS CHOOSING GITHUB'S COMPUTERS.
 *
 * GitHub gives a free plan CODE_ACTIONS_MONTHLY_MIN (2,000) Actions minutes a month, shared with everything else the person runs there.
 * Tailzu keeps count of its own use in `code_runner_minutes` (migration 0031), one row per person and month (UTC), and two lines are drawn:
 *
 *   80%   the person gets ONE notification ("minutes_low") for the month. The store flips the row's `notified_80` in the same statement
 *         that adds the minutes, so two results arriving together tell the person once
 *   95%   placement stops choosing GitHub's computers for them and falls through to the next place (paid by their rule, or waiting),
 *         until the month turns over. 5% is left for their own work
 *
 * A public repo's minutes are not metered by GitHub, so they are never added here, and never held back by it (the provider says
 * `unmetered`, placement.ts).
 *
 * The count a placement reads is the larger of this row and the older `code_compute_usage.github_minutes`, so a release that starts
 * counting here in the middle of a month does not hand the person a fresh allowance.
 */
import { ACTIONS_MONTHLY_MIN_DEFAULT, ACTIONS_NOTIFY_AT, ACTIONS_STOP_AT } from "./limits.js";

export interface RunnerMinutes {
  userId: string;
  /** "YYYY-MM", UTC. */
  month: string;
  /** GitHub Actions minutes Tailzu used for this person in the month. */
  minutes: number;
  /** The 80% notification has been sent for the month. */
  notified80: boolean;
}

const clean = (n: number, fallback = 0): number => (Number.isFinite(n) ? Math.max(0, n) : fallback);

/** Minutes at which the person is told. */
export const notifyAtMinutes = (monthly: number): number => Math.ceil(clean(monthly, ACTIONS_MONTHLY_MIN_DEFAULT) * ACTIONS_NOTIFY_AT);
/** Minutes at which GitHub's computers stop being chosen. */
export const stopAtMinutes = (monthly: number): number => Math.ceil(clean(monthly, ACTIONS_MONTHLY_MIN_DEFAULT) * ACTIONS_STOP_AT);

/** Minutes of the month Tailzu may still use: up to the 95% line, never below zero. */
export function actionsMinutesLeft(monthly: number, used: number): number {
  return Math.max(0, Math.floor(clean(monthly, ACTIONS_MONTHLY_MIN_DEFAULT) * ACTIONS_STOP_AT) - clean(used));
}

export type ActionsLevel = "ok" | "notify" | "stop";

/** Where `used` stands against the month's allowance. */
export function actionsLevel(monthly: number, used: number): ActionsLevel {
  const allowance = clean(monthly, ACTIONS_MONTHLY_MIN_DEFAULT);
  const u = clean(used);
  if (allowance === 0) return "stop";
  if (u >= stopAtMinutes(allowance)) return "stop";
  if (u >= notifyAtMinutes(allowance)) return "notify";
  return "ok";
}

/** The sentence the person is told at 80%. */
export function minutesLowWords(monthly: number, used: number): string {
  const u = Math.round(clean(used));
  const m = Math.round(clean(monthly, ACTIONS_MONTHLY_MIN_DEFAULT));
  return `You have used ${u} of your ${m} GitHub Actions minutes this month. X0 Bot stops using them at ${stopAtMinutes(m)} so you keep some for your own work, and carries on elsewhere (your own computer, or it waits).`;
}
