/**
 * THE USAGE METER, THE WAY THE PERSON SEES IT: how much of this stretch and of this month is used, and when each starts again. Never an
 * amount: what the use cost us stays ours (spend.ts, the admin's logs); the person sees "This stretch · 64% used · resets Thu 9 am".
 *
 *   the plan       ours, per plan (config.ts USAGE_*): the free plan's month, a paid plan's (or a paid tier's own, USAGE_TIERS). While
 *                  FREE_FOR_ALL is on, everyone has a paid plan's month and nothing is offered to buy.
 *   the month      from the person's billing cycle when billing has one (the day and time their paid period turns over), else the
 *                  calendar month on their own clock
 *   the stretches  a paid month is used in five: days 1–4, 5–9, 10–15, 16–22, and 23 to the month's end (8 days in a 30-day month,
 *                  fewer in February). Each may use the month's limit × its days / the month's days. What a stretch did not use is
 *                  gone when it ends, unless USAGE_CARRY_OVER is on (then the month's allowance so far, less what was used before it).
 *                  The free plan is one stretch, the month, unless USAGE_FREE_WINDOWS is on.
 *   near, out      near from USAGE_NEAR (80%) of the stretch or the month; out at all of either.
 *
 * Pure: limits.ts (Spending) reads the records and the entitlement, this adds them up. The words every screen says are here too, so the
 * refusal a job gets and the line the Usage page shows can never disagree.
 */

import type { UsageRefusalBody } from "../../../shared/types/api.js";

export const DAY_MS = 86_400_000;
/** Where each stretch starts, in days from the month's start: days 1–4, 5–9, 10–15, 16–22, 23 to the end. */
export const STRETCH_STARTS = [0, 4, 9, 15, 22] as const;

export interface UsagePlan {
  /** "free", "paid", or a paid tier's entitlement id. */
  id: string;
  /** What the screens call it. */
  name: string;
  paid: boolean;
  /** The month's limit, in paise of what the use costs us. Never shown. */
  monthPaise: number;
  /** Used in stretches (paid), or as one month. */
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

/** The meter for one person now. Pure. */
export function usageNow(i: { events: UsageEvent[]; now: number; tzOffsetMinutes: number; anchor?: number | null; plan: UsagePlan; nearAt?: number }): UsageNow {
  const { plan } = i;
  const cycle = cycleOf(i.now, i.tzOffsetMinutes, i.anchor);
  const monthDays = Math.max(1, Math.round((cycle.endsAt - cycle.startsAt) / DAY_MS));
  const all = stretchesOf(cycle.startsAt, cycle.endsAt, plan.windows);
  const cur = all.find((s) => i.now >= s.startsAt && i.now < s.endsAt) ?? all[all.length - 1]!;
  let usedMonth = 0, usedStretch = 0, usedBefore = 0;
  for (const e of i.events) {
    if (!(e.paise > 0) || e.at < cycle.startsAt || e.at >= cycle.endsAt) continue;
    usedMonth += e.paise;
    if (e.at >= cur.startsAt && e.at < cur.endsAt) usedStretch += e.paise;
    else if (e.at < cur.startsAt) usedBefore += e.paise;
  }
  const own = (plan.monthPaise * cur.days) / monthDays;
  // Carried over: the month's allowance up to this stretch's end, less what the stretches before it used.
  const daysThrough = Math.round((cur.endsAt - cycle.startsAt) / DAY_MS);
  const allowance = Math.max(0, plan.carryOver && plan.windows ? (plan.monthPaise * daysThrough) / monthDays - usedBefore : own);
  const frac = (used: number, of: number) => (of > 0 ? used / of : used > 0 ? 1 : 0);
  const stretchUsed = frac(usedStretch, allowance);
  const monthUsed = frac(usedMonth, plan.monthPaise);
  const near = i.nearAt ?? 0.8;
  const state = stretchUsed >= 1 || monthUsed >= 1 ? "out" : stretchUsed >= near || monthUsed >= near ? "near" : "ok";
  return {
    plan: { id: plan.id, name: plan.name, paid: plan.paid, windows: plan.windows, carryOver: plan.carryOver, upgrade: plan.upgrade },
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

/** USAGE_TIERS as written: {"pro": 50000}. Anything else is no tiers. */
export function tiersOf(spec: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!spec) return out;
  try {
    const raw = JSON.parse(spec) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const n = Number(v);
        if (k.trim() && Number.isFinite(n) && n >= 0) out.set(k.trim().toLowerCase(), Math.round(n));
      }
    }
  } catch { /* not JSON: no tiers */ }
  return out;
}

export interface PlanConfig {
  USAGE_FREE_MONTH_PAISE: number;
  USAGE_PAID_MONTH_PAISE: number;
  USAGE_TIERS?: string;
  USAGE_FREE_WINDOWS: boolean;
  USAGE_CARRY_OVER: boolean;
  FREE_FOR_ALL: boolean;
}

/** The plan a person is on, from their entitlement (null: free) and our config. */
export function planOf(entitlement: { entitlement: string; active: boolean } | null, c: PlanConfig): UsagePlan {
  const carryOver = c.USAGE_CARRY_OVER;
  if (entitlement?.active) {
    const tier = tiersOf(c.USAGE_TIERS).get(entitlement.entitlement.trim().toLowerCase());
    return { id: tier !== undefined ? entitlement.entitlement : "paid", name: "Pro", paid: true, monthPaise: tier ?? c.USAGE_PAID_MONTH_PAISE, windows: true, carryOver, upgrade: false };
  }
  // Free for everyone, for now: everyone has a paid plan's month, and nothing is for sale.
  if (c.FREE_FOR_ALL) return { id: "everyone", name: "Free", paid: false, monthPaise: c.USAGE_PAID_MONTH_PAISE, windows: true, carryOver, upgrade: false };
  return { id: "free", name: "Free", paid: false, monthPaise: c.USAGE_FREE_MONTH_PAISE, windows: c.USAGE_FREE_WINDOWS, carryOver, upgrade: true };
}
