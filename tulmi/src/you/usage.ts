/**
 * THE USAGE METER, THE WAY THE PERSON SEES IT: how much of this stretch and of this month is used, and when each starts again. Never an
 * amount: what the use cost us stays ours (spend.ts, the admin's logs); the person sees "This stretch · 64% used · resets Thu 9 am".
 *
 *   the plan       ours, per plan (config.ts USAGE_*), in US dollars of what the use really costs us: the free plan's month ($3), Lite's five
 *                  stretches ($4, $8, $6, $10, $7: $35), Elite's ($50, $70, $80, $100, $150: $450), or a paid tier's own (USAGE_TIERS).
 *                  Turned into paise at CODE_USD_INR, the rate the records' paise were counted at, so the meter counts dollars. While
 *                  FREE_FOR_ALL is on, everyone has Lite's stretches and nothing is offered to buy.
 *   the month      from the person's billing cycle when billing has one (the day and time their paid period turns over), else the
 *                  calendar month on their own clock
 *   the stretches  a paid month is used in five: days 1–4, 5–9, 10–15, 16–22, and 23 to the month's end (8 days in a 30-day month,
 *                  fewer in February). Each may use its own amount from the plan, whatever its length. What a stretch did not use is
 *                  gone when it ends, unless USAGE_CARRY_OVER is on (then the amounts of the stretches so far, less what was used before
 *                  it). The month may use the sum of the five.
 *   the free plan  no stretches: one allowance for the month, which starts again when the month does. Every line it gets says "this month".
 *   near, out      near from USAGE_NEAR (80%) of the stretch or the month; out at all of either.
 *
 * Pure: limits.ts (Spending) reads the records and the entitlement, this adds them up. The words every screen says are here too, so the
 * refusal a job gets and the line the Usage page shows can never disagree.
 */

import { z } from "zod";
import type { UsageRefusalBody } from "../../../shared/types/api.js";

/**
 * A plan's five stretches in US dollars, as written ("4,8,6,10,7"): exactly five positive amounts, in order. config.ts validates the
 * settings with it, so a list that is not five positive amounts stops the boot with the setting named, never a quiet default: these are
 * what every person may use.
 */
export const StretchesUsd = z
  .string()
  .transform((v) => v.split(",").map((x) => x.trim()))
  .pipe(z.array(z.coerce.number().finite().positive().max(1_000_000)).length(5, "five amounts, one per stretch"));

/** Five stretch amounts, or null when `v` is not them. */
export function parseStretchesUsd(v: unknown): number[] | null {
  const r = StretchesUsd.safeParse(v);
  return r.success ? r.data : null;
}

export const DAY_MS = 86_400_000;
/** Where each stretch starts, in days from the month's start: days 1–4, 5–9, 10–15, 16–22, 23 to the end. */
export const STRETCH_STARTS = [0, 4, 9, 15, 22] as const;

export interface UsagePlan {
  /** "free", "paid", "elite", "everyone", or a paid tier's entitlement id. */
  id: string;
  /** What the screens call it. */
  name: string;
  paid: boolean;
  /** The month's limit, in paise of what the use costs us: the sum of the stretches when there are any. Never shown. */
  monthPaise: number;
  /** What each of the five stretches may use, in paise, in order; null when the month is one allowance (the free plan). Never shown. */
  stretchPaise: number[] | null;
  /** Used in stretches (Lite, Elite), or as one month (Free). */
  windows: boolean;
  carryOver: boolean;
  /** A bigger plan can be bought from here (the free plan, while something is for sale). */
  upgrade: boolean;
}

export interface UsageEvent { at: number; paise: number }

export interface Stretch { n: number; startsAt: number; endsAt: number; days: number }

export interface UsageNow {
  plan: { id: string; name: string; paid: boolean; windows: boolean; carryOver: boolean; upgrade: boolean };
  /** This stretch (the month itself when the plan has no stretches). `used` is a fraction: 0.64 is 64%, and may pass 1. */
  stretch: { used: number; startsAt: number; resetsAt: number; n: number; of: number; days: number };
  month: { used: number; startsAt: number; resetsAt: number; days: number };
  state: "ok" | "near" | "out";
  /** What may still be used in this stretch, ours, in paise. Never shown. */
  leftPaise: number;
  /** The stretch's allowance, ours, in paise. Never shown. */
  allowancePaise: number;
}

/** The month a moment is in: from the billing anchor when there is one (its day and time of day, month after month), else the calendar month on the person's clock. */
export function cycleOf(now: number, tzOffsetMinutes: number, anchor?: number | null): { startsAt: number; endsAt: number } {
  if (anchor && Number.isFinite(anchor)) {
    const a = new Date(anchor);
    const at = (k: number) => {
      const y = a.getUTCFullYear(), m = a.getUTCMonth() + k;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return Date.UTC(y, m, Math.min(a.getUTCDate(), last), a.getUTCHours(), a.getUTCMinutes());
    };
    // Months from the anchor to now, then step until now is inside.
    const d = new Date(now);
    let k = (d.getUTCFullYear() - a.getUTCFullYear()) * 12 + (d.getUTCMonth() - a.getUTCMonth());
    while (at(k) > now) k -= 1;
    while (at(k + 1) <= now) k += 1;
    return { startsAt: at(k), endsAt: at(k + 1) };
  }
  const local = new Date(now + tzOffsetMinutes * 60_000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth();
  return { startsAt: Date.UTC(y, m, 1) - tzOffsetMinutes * 60_000, endsAt: Date.UTC(y, m + 1, 1) - tzOffsetMinutes * 60_000 };
}

/** A month's five stretches (or the month as one). The last takes whatever is left. */
export function stretchesOf(startsAt: number, endsAt: number, windows = true): Stretch[] {
  const monthDays = Math.max(1, Math.round((endsAt - startsAt) / DAY_MS));
  if (!windows) return [{ n: 1, startsAt, endsAt, days: monthDays }];
  const starts = STRETCH_STARTS.filter((d) => d < monthDays);
  return starts.map((d, i) => {
    const end = i + 1 < starts.length ? startsAt + starts[i + 1]! * DAY_MS : endsAt;
    const s = startsAt + d * DAY_MS;
    return { n: i + 1, startsAt: s, endsAt: end, days: Math.max(1, Math.round((end - s) / DAY_MS)) };
  });
}

/**
 * What stretch `n` (1-based) of `count` may use, and what the stretches up to and including it may use together, from the plan's amounts.
 * The last stretch of the month takes whatever amounts are left (five in every real month: a month is never shorter than 23 days).
 */
export function stretchAmounts(amounts: readonly number[], n: number, count: number): { own: number; through: number } {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const i = Math.max(0, Math.min(n, count) - 1);
  const last = i + 1 >= count;
  return { own: last ? sum(amounts.slice(i)) : amounts[i] ?? 0, through: last ? sum(amounts) : sum(amounts.slice(0, i + 1)) };
}

/** The meter for one person now. Pure. */
export function usageNow(i: { events: UsageEvent[]; now: number; tzOffsetMinutes: number; anchor?: number | null; plan: UsagePlan; nearAt?: number }): UsageNow {
  const { plan } = i;
  const cycle = cycleOf(i.now, i.tzOffsetMinutes, i.anchor);
  const monthDays = Math.max(1, Math.round((cycle.endsAt - cycle.startsAt) / DAY_MS));
  const windows = plan.windows && !!plan.stretchPaise?.length;
  const all = stretchesOf(cycle.startsAt, cycle.endsAt, windows);
  const cur = all.find((s) => i.now >= s.startsAt && i.now < s.endsAt) ?? all[all.length - 1]!;
  let usedMonth = 0, usedStretch = 0, usedBefore = 0;
  for (const e of i.events) {
    if (!(e.paise > 0) || e.at < cycle.startsAt || e.at >= cycle.endsAt) continue;
    usedMonth += e.paise;
    if (e.at >= cur.startsAt && e.at < cur.endsAt) usedStretch += e.paise;
    else if (e.at < cur.startsAt) usedBefore += e.paise;
  }
  // Each stretch its own amount; carried over, the amounts of the stretches so far, less what the ones before it used. No stretches: the month.
  const amounts = windows ? stretchAmounts(plan.stretchPaise!, cur.n, all.length) : null;
  const allowance = Math.max(0, !amounts ? plan.monthPaise : plan.carryOver ? amounts.through - usedBefore : amounts.own);
  const frac = (used: number, of: number) => (of > 0 ? used / of : used > 0 ? 1 : 0);
  const stretchUsed = frac(usedStretch, allowance);
  const monthUsed = frac(usedMonth, plan.monthPaise);
  const near = i.nearAt ?? 0.8;
  const state = stretchUsed >= 1 || monthUsed >= 1 ? "out" : stretchUsed >= near || monthUsed >= near ? "near" : "ok";
  return {
    plan: { id: plan.id, name: plan.name, paid: plan.paid, windows, carryOver: plan.carryOver, upgrade: plan.upgrade },
    stretch: { used: round(stretchUsed), startsAt: cur.startsAt, resetsAt: cur.endsAt, n: cur.n, of: all.length, days: cur.days },
    month: { used: round(monthUsed), startsAt: cycle.startsAt, resetsAt: cycle.endsAt, days: monthDays },
    state,
    leftPaise: Math.max(0, Math.floor(Math.min(allowance - usedStretch, plan.monthPaise - usedMonth))),
    allowancePaise: Math.round(allowance),
  };
}

const round = (x: number) => Math.round(x * 10_000) / 10_000;

// ===================================================================== the words

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "64%": a fraction as a whole percent, never past 100. */
export const percent = (used: number): string => `${Math.max(0, Math.min(100, Math.round(used * 100)))}%`;

/** "9 am", "9:30 pm". */
function clockOf(d: Date): string {
  const h = d.getUTCHours(), m = d.getUTCMinutes(), h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/**
 * When something starts again, as a person says it: "Thu 9 am" within the week (just "Thu" when it turns at midnight), else "Sat 1 Nov".
 * On the person's own clock.
 */
export function whenWords(at: number, now: number, tzOffsetMinutes: number): string {
  const d = new Date(at + tzOffsetMinutes * 60_000);
  const day = DAYS[d.getUTCDay()]!;
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  if (at - now < 6 * DAY_MS) return midnight ? day : `${day} ${clockOf(d)}`;
  return `${day} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "this stretch" or "this month", for a plan used in stretches or by the month. */
export const spanWord = (u: Pick<UsageNow, "plan">): string => (u.plan.windows ? "this stretch" : "this month");

/** The line under a meter once most of it is used, or null: "You've used most of this stretch. It resets Thu." */
export function nearLine(u: UsageNow, now: number, tzOffsetMinutes: number): string | null {
  if (u.state !== "near") return null;
  const what = u.month.used >= u.stretch.used && u.plan.windows ? "this month" : spanWord(u);
  const at = what === "this month" ? u.month.resetsAt : u.stretch.resetsAt;
  return `You've used most of ${what}. It resets ${whenWords(at, now, tzOffsetMinutes)}.`;
}

/** At the limit: "You've reached this stretch's limit. It resets Thu 9 am." */
export function outLine(u: UsageNow, now: number, tzOffsetMinutes: number): string {
  const month = u.month.used >= 1 && u.plan.windows;
  const what = month || !u.plan.windows ? "this month's" : "this stretch's";
  const at = month ? u.month.resetsAt : u.stretch.resetsAt;
  return `You've reached ${what} limit. It resets ${whenWords(at, now, tzOffsetMinutes)}.`;
}

/** How the stretches work, in a line for the Usage page. */
export function howLine(u: Pick<UsageNow, "plan">): string {
  if (!u.plan.windows) return "Your plan's use is counted by the month, and starts again when the month does.";
  return u.plan.carryOver
    ? "Each month is used in five stretches: 4, 5, 6 and 7 days, then the rest of the month. What a stretch doesn't use carries into the next."
    : "Each month is used in five stretches: 4, 5, 6 and 7 days, then the rest of the month. Each starts fresh.";
}

/**
 * A refusal the screens can show as it is: the sentence, when it starts again, and whether a bigger plan is on offer. Its code is the
 * one every app already knows (`quota_exceeded`: the phone and the window open the screen the bootstrap names for it, `quota.screenId`,
 * which in the Bots app is Usage); `reason` tells it apart from the free plan's words.
 */
export type UsageRefusal = UsageRefusalBody;

export function refusalOf(u: UsageNow, now: number, tzOffsetMinutes: number): UsageRefusal {
  const month = u.month.used >= 1 && u.plan.windows;
  return { code: "quota_exceeded", reason: "usage_limit", message: outLine(u, now, tzOffsetMinutes), resetsAt: month ? u.month.resetsAt : u.stretch.resetsAt, upgrade: u.plan.upgrade };
}

// ===================================================================== the plans

/** US dollars of what the use costs us, as the paise the records keep: at CODE_USD_INR, the rate those paise were counted at. */
export const usdToMeterPaise = (usd: number, usdInr: number): number => Math.round(usd * usdInr * 100);

/**
 * USAGE_TIERS as written: {"pro": "4,8,6,10,7"} (or [4, 8, 6, 10, 7]), a paid tier's five stretches in US dollars, by entitlement id.
 * A tier that is not five positive amounts is no tier (it is Lite's), and anything that is not JSON is no tiers.
 */
export function tiersOf(spec: string | undefined): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!spec) return out;
  try {
    const raw = JSON.parse(spec) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const amounts = parseStretchesUsd(Array.isArray(v) ? v.join(",") : v);
        if (k.trim() && amounts) out.set(k.trim().toLowerCase(), amounts);
      }
    }
  } catch { /* not JSON: no tiers */ }
  return out;
}

export interface PlanConfig {
  /** The free plan's month, in US dollars: one allowance, no stretches. */
  USAGE_FREE_MONTH_USD: number;
  /** Lite's five stretches, in US dollars. */
  USAGE_LITE_STRETCHES_USD: number[];
  /** Elite's five stretches, in US dollars. */
  USAGE_ELITE_STRETCHES_USD: number[];
  PLAN_ELITE_PRODUCTS?: string;
  USAGE_TIERS?: string;
  USAGE_CARRY_OVER: boolean;
  FREE_FOR_ALL: boolean;
  /** Rupees to the dollar: the one rate the records' paise were counted at (the gateway's). */
  CODE_USD_INR: number;
}

/** The plan a person is on, from their entitlement (null: free) and our config. */
export function planOf(entitlement: { entitlement: string; active: boolean; product?: string } | null, c: PlanConfig): UsagePlan {
  const carryOver = c.USAGE_CARRY_OVER;
  const paise = (usd: number) => usdToMeterPaise(usd, c.CODE_USD_INR);
  const inStretches = (usd: readonly number[]) => {
    const stretchPaise = usd.map(paise);
    return { stretchPaise, monthPaise: stretchPaise.reduce((a, b) => a + b, 0), windows: true };
  };
  if (entitlement?.active) {
    // Elite by the product that was bought (Google adds ":<base plan>"); Lite, and a yearly plan from before, otherwise.
    const product = String(entitlement.product ?? "").split(":")[0]!.trim().toLowerCase();
    const elite = !!product && String(c.PLAN_ELITE_PRODUCTS ?? "").split(",").map((p) => p.trim().toLowerCase()).includes(product);
    if (elite) return { id: "elite", name: "Elite", paid: true, ...inStretches(c.USAGE_ELITE_STRETCHES_USD), carryOver, upgrade: false };
    const tier = tiersOf(c.USAGE_TIERS).get(entitlement.entitlement.trim().toLowerCase());
    return { id: tier ? entitlement.entitlement : "paid", name: "Lite", paid: true, ...inStretches(tier ?? c.USAGE_LITE_STRETCHES_USD), carryOver, upgrade: false };
  }
  // Free for everyone, for now: everyone has Lite's stretches, and nothing is for sale.
  if (c.FREE_FOR_ALL) return { id: "everyone", name: "Free", paid: false, ...inStretches(c.USAGE_LITE_STRETCHES_USD), carryOver, upgrade: false };
  // The free plan: one allowance for the month, no stretches.
  return { id: "free", name: "Free", paid: false, monthPaise: paise(c.USAGE_FREE_MONTH_USD), stretchPaise: null, windows: false, carryOver, upgrade: true };
}

/** How many times the free month a plan's month is, from the config the meter enforces: Lite 35 / 3 → 11, Elite 450 / 3 → 150. */
export function timesFree(tier: string, c: Pick<PlanConfig, "USAGE_FREE_MONTH_USD" | "USAGE_LITE_STRETCHES_USD" | "USAGE_ELITE_STRETCHES_USD">): number {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const month = tier === "elite" ? sum(c.USAGE_ELITE_STRETCHES_USD) : sum(c.USAGE_LITE_STRETCHES_USD);
  // Cents, so 35 / 3 is not 11.999… and 0.1 + 0.2 is not a hair under a whole time.
  const free = Math.round(c.USAGE_FREE_MONTH_USD * 100);
  return free > 0 ? Math.floor(Math.round(month * 100) / free) : 0;
}
