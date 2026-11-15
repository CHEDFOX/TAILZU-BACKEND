/**
 * THE USAGE METER, THE WAY THE PERSON SEES IT: how much of this month is used, and when it starts again. Never an amount: what the use
 * cost us stays ours (spend.ts, the admin's logs); the person sees "This month · 64% used · resets Sun 1 Nov".
 *
 *   the plan       ours, per plan (config.ts USAGE_*), in US dollars of what the use really costs us: the free plan's $3, Lite's $35,
 *                  Elite's $450, or a paid tier's own (USAGE_TIERS). Each paid month is the SUM of the five amounts the config still lists
 *                  one by one. Turned into paise at CODE_USD_INR, the rate the records' paise were counted at, so the meter counts dollars.
 *                  While FREE_FOR_ALL is on, everyone has Lite's month and nothing is offered to buy.
 *   the month      from the person's billing cycle when billing has one (the day and time their paid period turns over), else the
 *                  calendar month on their own clock. ONE allowance, spent on whatever days of the month the person likes.
 *   near, out      near from USAGE_NEAR (80%) of the month; out at all of it.
 *
 * THE MONTH USED TO BE CUT INTO FIVE WINDOWS ("stretches"), each with its own amount, so a heavy Tuesday could leave a person refused on a
 * Wednesday they had paid for. The windows were really a brake on runaway spending wearing a plan rule's clothes; the brake is now kept
 * honestly and separately in limits.ts, and the plan is what it says it is. USAGE_STRETCHES brings the windows back for a server that wants
 * them, which is why `stretchesOf`, `stretchAmounts` and the five-amount settings are all still here and all still tested.
 *
 *   the windows    with USAGE_STRETCHES on: days 1–4, 5–9, 10–15, 16–22, and 23 to the month's end (8 days in a 30-day month, fewer in
 *                  February). Each may use its own amount from the plan, whatever its length. What one did not use is gone when it ends,
 *                  unless USAGE_CARRY_OVER is on (then the amounts of the windows so far, less what was used before this one).
 *
 * Pure: limits.ts (Spending) reads the records and the entitlement, this adds them up. The words every screen says are here too, so the
 * refusal a job gets and the line the Usage page shows can never disagree.
 */

import { z } from "zod";
import type { UsageRefusalBody } from "../../../shared/types/api.js";

/**
 * A plan's month in US dollars, as written ("4,8,6,10,7"): exactly five positive amounts, in order, which add up to the month ($35).
 * config.ts validates the settings with it, so a list that is not five positive amounts stops the boot with the setting named, never a
 * quiet default: these are what every person may use. They stay five so that USAGE_STRETCHES can put the five windows back as they were.
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

const DAY_MS = 86_400_000;
/** With USAGE_STRETCHES on, where each window starts, in days from the month's start: days 1–4, 5–9, 10–15, 16–22, 23 to the end. */
const STRETCH_STARTS = [0, 4, 9, 15, 22] as const;
/** About how many hours there are in a month, for working out what an average hour of a plan costs (the burn brake). */
const HOURS_IN_MONTH = 720;

export interface UsagePlan {
  /** "free", "paid", "elite", "everyone", or a paid tier's entitlement id. */
  id: string;
  /** What the screens call it. */
  name: string;
  paid: boolean;
  /** The month's limit, in paise of what the use costs us: the sum of the plan's amounts. Never shown. */
  monthPaise: number;
  /** What each of the five windows may use, in paise, in order; null when the month is one allowance, which it is unless USAGE_STRETCHES. */
  stretchPaise: number[] | null;
  /** Used in five windows (USAGE_STRETCHES), or as one month, which it is by default. Every line about use reads off this. */
  windows: boolean;
  carryOver: boolean;
  /** A bigger plan can be bought from here (the free plan, while something is for sale). */
  upgrade: boolean;
}

export interface UsageEvent { at: number; paise: number }

export interface Stretch { n: number; startsAt: number; endsAt: number; days: number }

export interface UsageNow {
  plan: { id: string; name: string; paid: boolean; windows: boolean; carryOver: boolean; upgrade: boolean };
  /** The window being used, which is the whole month unless USAGE_STRETCHES. `used` is a fraction: 0.64 is 64%, and may pass 1. */
  stretch: { used: number; startsAt: number; resetsAt: number; n: number; of: number; days: number };
  month: { used: number; startsAt: number; resetsAt: number; days: number };
  state: "ok" | "near" | "out";
  /** What may still be used, ours, in paise: of the month, or of the window when there are windows. Never shown. */
  leftPaise: number;
  /** The window's allowance, ours, in paise: the month's unless USAGE_STRETCHES. Never shown. */
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

/** A month's five windows (or, as it now is unless USAGE_STRETCHES, the month as one). The last takes whatever is left. */
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
 * What window `n` (1-based) of `count` may use, and what the windows up to and including it may use together, from the plan's amounts.
 * The last window of the month takes whatever amounts are left (five in every real month: a month is never shorter than 23 days). Only
 * reached with USAGE_STRETCHES on; one month has one allowance and needs none of this.
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
  // Each window its own amount; carried over, the amounts of the windows so far, less what the ones before it used. No windows: the month.
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

/** "this month", or "this stretch" on a server that has put the five windows back (USAGE_STRETCHES). */
const spanWord = (u: Pick<UsageNow, "plan">): string => (u.plan.windows ? "this stretch" : "this month");

/** The line under a meter once most of it is used, or null: "You've used most of this month. It resets Sun 1 Nov." */
export function nearLine(u: UsageNow, now: number, tzOffsetMinutes: number): string | null {
  if (u.state !== "near") return null;
  const what = u.month.used >= u.stretch.used && u.plan.windows ? "this month" : spanWord(u);
  const at = what === "this month" ? u.month.resetsAt : u.stretch.resetsAt;
  return `You've used most of ${what}. It resets ${whenWords(at, now, tzOffsetMinutes)}.`;
}

/** At the limit: "You've reached this month's limit. It resets Sun 1 Nov." */
export function outLine(u: UsageNow, now: number, tzOffsetMinutes: number): string {
  const month = u.month.used >= 1 && u.plan.windows;
  const what = month || !u.plan.windows ? "this month's" : "this stretch's";
  const at = month ? u.month.resetsAt : u.stretch.resetsAt;
  return `You've reached ${what} limit. It resets ${whenWords(at, now, tzOffsetMinutes)}.`;
}

/** How the plan's use is counted, in a line for the Usage page. */
export function howLine(u: Pick<UsageNow, "plan">): string {
  // One month, one allowance: there is no schedule to explain, only when it comes round again.
  if (!u.plan.windows) return "Your plan's use is counted by the month, and starts again when the month does. Use it whenever you like.";
  return u.plan.carryOver
    ? "Each month is used in five stretches: 4, 5, 6 and 7 days, then the rest of the month. What a stretch doesn't use carries into the next."
    : "Each month is used in five stretches: 4, 5, 6 and 7 days, then the rest of the month. Each starts fresh.";
}

// ===================================================================== the burn brake

/**
 * THE BURN BRAKE'S CEILING for one plan, in paise an hour, or 0 when it is switched off.
 *
 * The five windows used to do this job by accident: a month cut into fifths meant a runaway could only eat a fifth of it before it had to
 * wait for a date on the calendar. One month, one allowance, has no such floor, so a loop with a bug could spend somebody's whole month
 * between lunch and the end of the afternoon. This puts the floor back on purpose, and only as a floor.
 *
 * It is worked out from the person's OWN plan's month, so it rises with the plan and is never a number somebody typed in and forgot: a
 * month is about 720 hours, and one hour may spend what `times` of those average hours would. At the default 48 that is $2.33 an hour on
 * Lite and $30 an hour on Elite, roughly ten times what a heavy real hour costs, so nobody working normally ever meets it.
 *
 * It is NOT a plan feature. See limits.ts for what a person who meets it is told, and why it is not "you have run out".
 */
export function burnCapPaise(monthPaise: number, times: number): number {
  if (!(times > 0) || !(monthPaise > 0)) return 0;
  return Math.max(1, Math.round((monthPaise / HOURS_IN_MONTH) * times));
}

/** What the spend events since `from` come to, in paise. */
export function spentSince(events: readonly UsageEvent[], from: number): number {
  let paise = 0;
  for (const e of events) if (e.paise > 0 && e.at >= from) paise += e.paise;
  return paise;
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
 * USAGE_TIERS as written: {"pro": "4,8,6,10,7"} (or [4, 8, 6, 10, 7]), the amounts a paid tier's month is the sum of in US dollars, by
 * entitlement id. A tier that is not five positive amounts is no tier (it is Lite's), and anything that is not JSON is no tiers.
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

/**
 * IS THIS ACCOUNT'S FREE USE HELD RIGHT NOW (abuse prevention, docs/trust.md §actions)?
 *
 * The answer belongs to src/trust, but this file stays pure — no store, no environment, no imports beyond the types — so the
 * check is INSTALLED here by the server at start (`installHoldCheck(slowedOrHeld)`), the way the AI permission's check is
 * installed on its own gate. Nothing installed means nobody is held, which is what every test and every server with TRUST off
 * sees. usage/allowance.ts reads the same answer through this one function, so the plan and the earned words can never
 * disagree about whether a hold is on.
 */
export type HoldCheck = (userId: string) => boolean;
let holdCheck: HoldCheck | null = null;
export function installHoldCheck(c: HoldCheck | null): void { holdCheck = c; }
export function heldFreeUse(userId: string): boolean {
  if (!userId || !holdCheck) return false;
  try { return holdCheck(userId); } catch { return false; }
}

export interface PlanConfig {
  /** The free plan's month, in US dollars: one allowance. */
  USAGE_FREE_MONTH_USD: number;
  /** The amounts Lite's month is the sum of, in US dollars ($35). */
  USAGE_LITE_STRETCHES_USD: number[];
  /** The amounts Elite's month is the sum of, in US dollars ($450). */
  USAGE_ELITE_STRETCHES_USD: number[];
  PLAN_ELITE_PRODUCTS?: string;
  USAGE_TIERS?: string;
  /** The way back to the five windows (off): the amounts above become one window each, in order, as they were. */
  USAGE_STRETCHES?: boolean;
  USAGE_CARRY_OVER: boolean;
  FREE_FOR_ALL: boolean;
  /** Rupees to the dollar: the one rate the records' paise were counted at (the gateway's). */
  CODE_USD_INR: number;
}

/**
 * The plan a person is on, from their entitlement (null: free) and our config.
 *
 * `o.userId` is only for abuse prevention's hold (src/trust, docs/trust.md §actions): while that account's free use is held,
 * it gets the free plan's $3 month instead of Lite's $35 — and nothing else changes. The refusal past it is the 429
 * `quota_exceeded` the apps have always shown, so there is no new screen and no app update, and the hold itself lives in
 * memory for an hour at a time. A payer is never held (rule 5), which is why the paid branches below are reached first.
 * Called without `o`, this function behaves exactly as it always did.
 */
export function planOf(
  entitlement: { entitlement: string; active: boolean; product?: string } | null,
  c: PlanConfig,
  o: { userId?: string } = {},
): UsagePlan {
  const carryOver = c.USAGE_CARRY_OVER;
  const paise = (usd: number) => usdToMeterPaise(usd, c.CODE_USD_INR);
  /**
   * A paid plan's allowance from the amounts the config lists: ONE month worth the sum of them, to be spent on whatever days the person
   * likes. With USAGE_STRETCHES the same amounts become the five windows again, in order, exactly as they were. `windows: false` is all
   * it takes to make the month the only span: usageNow falls through to it, and every line already has a "this month" to say.
   */
  const allowanceOf = (usd: readonly number[]) => {
    const stretchPaise = usd.map(paise);
    const monthPaise = stretchPaise.reduce((a, b) => a + b, 0);
    return c.USAGE_STRETCHES ? { stretchPaise, monthPaise, windows: true } : { stretchPaise: null, monthPaise, windows: false };
  };
  if (entitlement?.active) {
    // Elite by the product that was bought (Google adds ":<base plan>"); Lite, and a yearly plan from before, otherwise.
    const product = String(entitlement.product ?? "").split(":")[0]!.trim().toLowerCase();
    const elite = !!product && String(c.PLAN_ELITE_PRODUCTS ?? "").split(",").map((p) => p.trim().toLowerCase()).includes(product);
    if (elite) return { id: "elite", name: "Elite", paid: true, ...allowanceOf(c.USAGE_ELITE_STRETCHES_USD), carryOver, upgrade: false };
    const tier = tiersOf(c.USAGE_TIERS).get(entitlement.entitlement.trim().toLowerCase());
    return { id: tier ? entitlement.entitlement : "paid", name: "Lite", paid: true, ...allowanceOf(tier ?? c.USAGE_LITE_STRETCHES_USD), carryOver, upgrade: false };
  }
  // Free use held: the free month's one allowance, under the same name and screens as any free account.
  const theFreeMonth: UsagePlan = {
    id: c.FREE_FOR_ALL ? "everyone" : "free", name: "Free", paid: false,
    monthPaise: paise(c.USAGE_FREE_MONTH_USD), stretchPaise: null, windows: false, carryOver, upgrade: !c.FREE_FOR_ALL,
  };
  if (o.userId && heldFreeUse(o.userId)) return theFreeMonth;
  // Free for everyone, for now: everyone has Lite's month, and nothing is for sale.
  if (c.FREE_FOR_ALL) return { id: "everyone", name: "Free", paid: false, ...allowanceOf(c.USAGE_LITE_STRETCHES_USD), carryOver, upgrade: false };
  // The free plan: one allowance for the month, and never windows, whatever USAGE_STRETCHES says.
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
