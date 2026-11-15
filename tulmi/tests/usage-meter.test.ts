/**
 * The usage meter (src/you/usage.ts): the owner's limits in US dollars of what the use really costs us. ONE MONTH, ONE ALLOWANCE: Lite's
 * month is $35, Elite's $450, the free plan's $3, and every one of them may be spent on whatever days of the month the person likes. The
 * month was once cut into five windows with their own amounts; USAGE_STRETCHES puts that back, and it is tested here too, because a way
 * back nobody tests is not a way back. The burn brake (src/you/limits.ts) is the floor under one month: a ceiling on one hour's spend that
 * is not a plan rule and never says "you have run out". Dollars become paise at CODE_USD_INR, the rate the records were counted at. From
 * the billing cycle or the calendar month on the person's clock; the plans; the config, validated; the words every screen says; and the
 * gate Keylessbord and Ask ask (metering.setUsageGate). Never an amount in what a person reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

import Fastify from "fastify";
import { getConfig, resetConfigForTests } from "../src/config.js";
import { enforceQuota, quotaBody, quotaHeaders, setUsageGate } from "../src/usage/metering.js";
import { Spending, holdJobsToUsage } from "../src/you/limits.js";
import { MemoryYouStore } from "../src/you/store.js";
import {
  burnCapPaise, cycleOf, howLine, installHoldCheck, nearLine, outLine, parseStretchesUsd, percent, planOf, refusalOf, spentSince,
  stretchAmounts, stretchesOf, tiersOf, timesFree, usageNow, usdToMeterPaise, whenWords, type PlanConfig,
} from "../src/you/usage.js";

const DAY = 86_400_000, MIN = 60_000, HOUR = 60 * MIN, IST = 330;
const at = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m, d, h, mi) - IST * MIN;
/** A dollar is 8,800 paise at 88 rupees to the dollar. */
const USD = 8800;
const cfg: PlanConfig = {
  USAGE_FREE_MONTH_USD: 3, USAGE_LITE_STRETCHES_USD: [4, 8, 6, 10, 7], USAGE_ELITE_STRETCHES_USD: [50, 70, 80, 100, 150],
  PLAN_ELITE_PRODUCTS: "x0_elite_monthly,elite", USAGE_CARRY_OVER: false, FREE_FOR_ALL: false, CODE_USD_INR: 88,
};
/** The same owner's numbers with the five windows put back (USAGE_STRETCHES), which is the way out of this change. */
const winCfg: PlanConfig = { ...cfg, USAGE_STRETCHES: true };
const paidEnt = { entitlement: "TAILZU AIR", active: true };
const eliteEnt = { entitlement: "TAILZU AIR", active: true, product: "x0_elite_monthly" };
const lite = planOf(paidEnt, cfg);
const elite = planOf(eliteEnt, cfg);
const free = planOf(null, cfg);
const liteWin = planOf(paidEnt, winCfg);
const eliteWin = planOf(eliteEnt, winCfg);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** What the server's own config makes of a plain paid account: Lite, $35 a month. The Spending tests read the real config, not `cfg`. */
const LITE_ENT = { entitlement: "pro", active: true } as never;

describe("the month's windows, when they are switched on", () => {
  it("are 4, 5, 6 and 7 days, then whatever is left: 8 in a 30-day month, 9 in 31, 6 in February", () => {
    const days = (s: number, e: number) => stretchesOf(s, e).map((x) => x.days);
    expect(days(at(2026, 10, 1), at(2026, 11, 1))).toEqual([4, 5, 6, 7, 8]);
    expect(days(at(2026, 9, 1), at(2026, 10, 1))).toEqual([4, 5, 6, 7, 9]);
    expect(days(at(2026, 1, 1), at(2026, 2, 1))).toEqual([4, 5, 6, 7, 6]);
    const nov = stretchesOf(at(2026, 10, 1), at(2026, 11, 1));
    expect(nov[2]!.startsAt).toBe(at(2026, 10, 10));
    expect(nov[4]!.startsAt).toBe(at(2026, 10, 23));
    expect(nov[4]!.endsAt).toBe(at(2026, 11, 1));
    expect(stretchesOf(at(2026, 10, 1), at(2026, 11, 1), false)).toEqual([{ n: 1, startsAt: at(2026, 10, 1), endsAt: at(2026, 11, 1), days: 30 }]);
  });

  it("start from the billing cycle when there is one, else the calendar month on the person's clock", () => {
    expect(cycleOf(at(2026, 9, 28, 19), IST)).toEqual({ startsAt: at(2026, 9, 1), endsAt: at(2026, 10, 1) });
    // Bought on the 14th at 9:30 in the morning (IST): the month runs 14th to 14th, at that time.
    const anchor = Date.UTC(2026, 6, 14, 4, 0);
    expect(cycleOf(Date.UTC(2026, 9, 20), IST, anchor)).toEqual({ startsAt: Date.UTC(2026, 9, 14, 4, 0), endsAt: Date.UTC(2026, 10, 14, 4, 0) });
    expect(cycleOf(Date.UTC(2026, 9, 10), IST, anchor)).toEqual({ startsAt: Date.UTC(2026, 8, 14, 4, 0), endsAt: Date.UTC(2026, 9, 14, 4, 0) });
    // An anchor on the 31st lands on the last day of a shorter month.
    const end = Date.UTC(2026, 0, 31, 6);
    expect(cycleOf(Date.UTC(2026, 1, 15), IST, end)).toEqual({ startsAt: Date.UTC(2026, 0, 31, 6), endsAt: Date.UTC(2026, 1, 28, 6) });
  });
});

describe("the meter: one month, one allowance", () => {
  const now = at(2026, 9, 28, 19, 40); // Wed 28 Oct

  it("a month is worth exactly what the five old windows were worth together: Lite $35, Elite $450, free $3", () => {
    expect(lite.monthPaise).toBe(35 * USD);
    expect(elite.monthPaise).toBe(450 * USD);
    expect(free.monthPaise).toBe(3 * USD);
    // The same amounts the config lists one by one, added up: nothing had to be re-entered to make this change.
    expect(lite.monthPaise).toBe(sum(liteWin.stretchPaise!));
    expect(elite.monthPaise).toBe(sum(eliteWin.stretchPaise!));
    // And no plan has windows any more, so every line about use says "this month".
    for (const p of [lite, elite, free]) {
      expect(p.windows).toBe(false);
      expect(p.stretchPaise).toBeNull();
    }
  });

  it("the whole month is the one meter: it starts again when the month does, and that is all there is", () => {
    const u = usageNow({ events: [{ at: at(2026, 9, 3), paise: 20 * USD }, { at: at(2026, 9, 27), paise: 1.5 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(u.stretch).toMatchObject({ n: 1, of: 1, days: 31, startsAt: at(2026, 9, 1), resetsAt: at(2026, 10, 1) });
    expect(u.month).toMatchObject({ startsAt: at(2026, 9, 1), resetsAt: at(2026, 10, 1), days: 31 });
    expect(u.allowancePaise).toBe(35 * USD);
    expect(u.stretch.used).toBeCloseTo(21.5 / 35, 4);
    expect(u.stretch.used).toBe(u.month.used);
    expect(u.leftPaise).toBe(13.5 * USD);
    expect(u.state).toBe("ok");
  });

  it("spending on day 1 does not refuse on day 2: the allowance is the month's, not a window's", () => {
    // $6 on the first of October — more than the first window used to allow all by itself.
    const dayOne = [{ at: at(2026, 9, 1, 10), paise: 6 * USD }];
    const dayTwo = usageNow({ events: dayOne, now: at(2026, 9, 2, 10), tzOffsetMinutes: IST, plan: lite });
    expect(dayTwo.state).toBe("ok");
    expect(dayTwo.leftPaise).toBe(29 * USD);
    // This is the wall that was taken down: with the windows back, the very same spend has the person out on day two.
    const walled = usageNow({ events: dayOne, now: at(2026, 9, 2, 10), tzOffsetMinutes: IST, plan: liteWin });
    expect(walled.state).toBe("out");
    expect(walled.leftPaise).toBe(0);
  });

  it("nothing refuses until the month's total is reached, however the days fall", () => {
    const heavyDays = [1, 2, 3, 4, 5].map((d) => ({ at: at(2026, 9, d, 12), paise: 6.9 * USD })); // $34.50 in the first five days
    const nearly = usageNow({ events: heavyDays, now, tzOffsetMinutes: IST, plan: lite });
    expect(nearly.state).toBe("near");
    expect(nearly.leftPaise).toBe(0.5 * USD);
    expect(nearLine(nearly, now, IST)).toBe("You've used most of this month. It resets Sun.");
    // The last half-dollar, and only then is it out.
    const spent = usageNow({ events: [...heavyDays, { at: at(2026, 9, 6), paise: 0.5 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(spent.state).toBe("out");
    expect(spent.leftPaise).toBe(0);
    expect(outLine(spent, now, IST)).toBe("You've reached this month's limit. It resets Sun.");
    expect(refusalOf(spent, now, IST)).toEqual({
      code: "quota_exceeded", reason: "usage_limit", message: "You've reached this month's limit. It resets Sun.",
      resetsAt: at(2026, 10, 1), upgrade: false,
    });
  });

  it("near from 80% of the month, out at all of it", () => {
    const near = usageNow({ events: [{ at: at(2026, 9, 27), paise: 0.8 * 35 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(near.state).toBe("near");
    const under = usageNow({ events: [{ at: at(2026, 9, 27), paise: 0.79 * 35 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(under.state).toBe("ok");
    expect(nearLine(under, now, IST)).toBeNull();
  });

  it("the free plan is the same shape, only smaller: $3 for the month, one meter, every line this month", () => {
    expect(free).toMatchObject({ id: "free", windows: false, stretchPaise: null, monthPaise: 3 * USD, upgrade: true });
    const u = usageNow({ events: [{ at: at(2026, 9, 2), paise: 0.8 * 3 * USD }], now, tzOffsetMinutes: IST, plan: free });
    expect(u.plan.windows).toBe(false);
    expect(u.stretch).toMatchObject({ n: 1, of: 1, used: 0.8, startsAt: at(2026, 9, 1), resetsAt: at(2026, 10, 1), days: 31 });
    expect(u.state).toBe("near");
    expect(nearLine(u, now, IST)).toBe("You've used most of this month. It resets Sun.");
    expect(howLine(u)).toBe("Your plan's use is counted by the month, and starts again when the month does. Use it whenever you like.");
    const out = usageNow({ events: [{ at: at(2026, 9, 2), paise: 3 * USD }], now, tzOffsetMinutes: IST, plan: free });
    expect(refusalOf(out, now, IST)).toEqual({
      code: "quota_exceeded", reason: "usage_limit", message: "You've reached this month's limit. It resets Sun.",
      resetsAt: at(2026, 10, 1), upgrade: true,
    });
    const spread = usageNow({ events: [{ at: at(2026, 9, 2), paise: 2 * USD }, { at: at(2026, 9, 27), paise: 0.99 * USD }], now, tzOffsetMinutes: IST, plan: free });
    expect(spread.state).toBe("near");
    expect(spread.leftPaise).toBe(Math.floor(0.01 * USD));
  });

  it("a billing month resets at the time it was bought, and the one meter follows it", () => {
    const anchor = Date.UTC(2026, 6, 14, 3, 30); // 9 am IST
    const u = usageNow({ events: [], now: Date.UTC(2026, 9, 15, 6), tzOffsetMinutes: IST, anchor, plan: lite });
    expect(u.stretch.startsAt).toBe(Date.UTC(2026, 9, 14, 3, 30));
    expect(u.stretch.resetsAt).toBe(Date.UTC(2026, 10, 14, 3, 30));
    expect(u.month.resetsAt).toBe(u.stretch.resetsAt);
    expect(whenWords(u.stretch.resetsAt, Date.UTC(2026, 9, 15, 6), IST)).toBe("Sat 14 Nov");
  });
});

describe("the way back: USAGE_STRETCHES puts the five windows back as they were", () => {
  const now = at(2026, 9, 28, 19, 40); // Wed 28 Oct, window 5 (23–31 Oct, 9 days of 31): Lite's $7

  it("this window is its own amount (Lite's fifth, $7), whatever its days; this month the sum ($35); nothing carries over", () => {
    const u = usageNow({ events: [{ at: at(2026, 9, 3), paise: 30_000 }, { at: at(2026, 9, 27), paise: 3.5 * USD }], now, tzOffsetMinutes: IST, plan: liteWin });
    expect(u.stretch).toMatchObject({ n: 5, of: 5, days: 9, startsAt: at(2026, 9, 23), resetsAt: at(2026, 10, 1) });
    expect(u.allowancePaise).toBe(7 * USD);
    expect(u.stretch.used).toBe(0.5);
    expect(u.month.used).toBeCloseTo((30_000 + 3.5 * USD) / (35 * USD), 4);
    expect(u.state).toBe("ok");
    expect(u.leftPaise).toBe(3.5 * USD);
  });

  it("each of the five windows may use its own amount: Lite $4, $8, $6, $10, $7; Elite $50, $70, $80, $100, $150", () => {
    // November 2026: 1–4, 5–9, 10–15, 16–22, 23–30.
    const days = [2, 6, 12, 20, 27];
    const allowance = (plan: typeof liteWin, d: number) => usageNow({ events: [], now: at(2026, 10, d, 12), tzOffsetMinutes: IST, plan }).allowancePaise / USD;
    expect(days.map((d) => allowance(liteWin, d))).toEqual([4, 8, 6, 10, 7]);
    expect(days.map((d) => allowance(eliteWin, d))).toEqual([50, 70, 80, 100, 150]);
    // The windows keep their days: 4, 5, 6, 7, then the rest (8 in November).
    expect(days.map((d) => usageNow({ events: [], now: at(2026, 10, d, 12), tzOffsetMinutes: IST, plan: liteWin }).stretch.days)).toEqual([4, 5, 6, 7, 8]);
  });

  it("says this stretch again on every line, and the month's own limit still ends it", () => {
    const out = usageNow({ events: [{ at: at(2026, 9, 27), paise: 7 * USD }], now, tzOffsetMinutes: IST, plan: liteWin });
    expect(out.state).toBe("out");
    expect(outLine(out, now, IST)).toBe("You've reached this stretch's limit. It resets Sun.");
    expect(howLine(out)).toContain("five stretches");
    const nearly = usageNow({ events: [{ at: at(2026, 9, 27), paise: 0.8 * 7 * USD }], now, tzOffsetMinutes: IST, plan: liteWin });
    expect(nearLine(nearly, now, IST)).toBe("You've used most of this stretch. It resets Sun.");
    // The month's $35 used in earlier windows: out, though this window has used nothing.
    const month = usageNow({ events: [{ at: at(2026, 9, 2), paise: 35 * USD }], now, tzOffsetMinutes: IST, plan: liteWin });
    expect(month.state).toBe("out");
    expect(refusalOf(month, now, IST).message).toBe("You've reached this month's limit. It resets Sun.");
  });

  it("with carry-over, what the earlier windows' amounts left is this one's too", () => {
    const carryCfg: PlanConfig = { ...winCfg, USAGE_CARRY_OVER: true };
    const carryLite = planOf(paidEnt, carryCfg);
    const events = [{ at: at(2026, 9, 2), paise: 1000 }, { at: at(2026, 9, 27), paise: 7 * USD }];
    expect(usageNow({ events, now, tzOffsetMinutes: IST, plan: liteWin }).state).toBe("out");
    const carried = usageNow({ events, now, tzOffsetMinutes: IST, plan: carryLite });
    expect(carried.allowancePaise).toBe(35 * USD - 1000);
    expect(carried.state).toBe("ok");
    // In the second window: the first's $4 and the second's $8, less what the first used.
    const second = usageNow({ events: [{ at: at(2026, 9, 2), paise: 1000 }], now: at(2026, 9, 6), tzOffsetMinutes: IST, plan: carryLite });
    expect(second.allowancePaise).toBe(12 * USD - 1000);
  });

  it("the last window takes whatever amounts are left", () => {
    expect(stretchAmounts([4, 8, 6, 10, 7], 3, 5)).toEqual({ own: 6, through: 18 });
    expect(stretchAmounts([4, 8, 6, 10, 7], 5, 5)).toEqual({ own: 7, through: 35 });
    expect(stretchAmounts([4, 8, 6, 10, 7], 4, 4)).toEqual({ own: 17, through: 35 });
  });
});

describe("the words", () => {
  it("say a share and a day, never an amount", () => {
    expect(percent(0.644)).toBe("64%");
    expect(percent(-1)).toBe("0%");
    expect(whenWords(at(2026, 10, 1), at(2026, 9, 28), IST)).toBe("Sun");
    expect(whenWords(at(2026, 10, 1, 9, 30), at(2026, 9, 28), IST)).toBe("Sun 9:30 am");
    expect(whenWords(at(2026, 10, 14), at(2026, 9, 28), IST)).toBe("Sat 14 Nov");
    expect(howLine({ plan: { ...liteWin } })).toContain("five stretches");
    const now = at(2026, 9, 28);
    for (const plan of [lite, elite, free, liteWin, eliteWin]) {
      const u = usageNow({ events: [{ at: now - DAY, paise: 1e9 }], now, tzOffsetMinutes: IST, plan });
      for (const s of [howLine(u), outLine(u, now, IST), refusalOf(u, now, IST).message, howLine({ plan: { ...u.plan, carryOver: true } })]) {
        expect(s).not.toMatch(/₹|\$|paise|rupee|dollar|cent/i);
      }
    }
  });

  it("never say stretch on a plan used by the month, which is every plan now", () => {
    const now = at(2026, 9, 28);
    for (const plan of [lite, elite, free]) {
      const u = usageNow({ events: [{ at: now - DAY, paise: 1e9 }], now, tzOffsetMinutes: IST, plan });
      for (const s of [howLine(u), outLine(u, now, IST), refusalOf(u, now, IST).message]) expect(s).not.toMatch(/stretch/i);
      const near = usageNow({ events: [{ at: now - DAY, paise: Math.round(plan.monthPaise * 0.9) }], now, tzOffsetMinutes: IST, plan });
      expect(nearLine(near, now, IST)).not.toMatch(/stretch/i);
    }
  });
});

describe("the plans", () => {
  it("free ($3), Lite's month, a paid tier of its own, and everyone while X0 Bot is free", () => {
    expect(planOf(null, cfg)).toMatchObject({ id: "free", monthPaise: 26_400, stretchPaise: null, windows: false, upgrade: true });
    expect(planOf(paidEnt, cfg)).toMatchObject({ id: "paid", name: "Lite", paid: true, stretchPaise: null, monthPaise: 308_000, windows: false, upgrade: false });
    expect(planOf(paidEnt, winCfg)).toMatchObject({ id: "paid", stretchPaise: [35_200, 70_400, 52_800, 88_000, 61_600], monthPaise: 308_000, windows: true });
    expect(planOf({ entitlement: "Max", active: true }, { ...cfg, USAGE_TIERS: '{"max": "10,20,30,40,50"}' })).toMatchObject({ id: "Max", monthPaise: 150 * USD });
    expect(planOf({ entitlement: "Max", active: true }, { ...cfg, USAGE_TIERS: '{"max": [10, 20, 30, 40, 50]}' }).monthPaise).toBe(150 * USD);
    // A tier that is not five amounts is Lite's.
    expect(planOf({ entitlement: "Max", active: true }, { ...cfg, USAGE_TIERS: '{"max": 200000}' })).toMatchObject({ id: "paid", monthPaise: 35 * USD });
    expect(planOf(null, { ...cfg, FREE_FOR_ALL: true })).toMatchObject({ id: "everyone", monthPaise: 35 * USD, windows: false, upgrade: false });
    expect(planOf(null, { ...winCfg, FREE_FOR_ALL: true })).toMatchObject({ id: "everyone", monthPaise: 35 * USD, windows: true });
    expect(planOf(null, { ...cfg, USAGE_CARRY_OVER: true }).carryOver).toBe(true);
    expect([...tiersOf("not json")]).toEqual([]);
    expect([...tiersOf('{"pro": "1,2,3,4,5", "bad": "1,2,3"}')]).toEqual([["pro", [1, 2, 3, 4, 5]]]);
  });

  it("Elite by the product bought, on either store or Razorpay; Lite and the old yearly plan otherwise", () => {
    const on = (product?: string) => planOf({ entitlement: "TAILZU AIR", active: true, ...(product ? { product } : {}) }, cfg);
    for (const p of ["x0_elite_monthly", "x0_elite_monthly:monthly", "elite"]) {
      expect(on(p)).toMatchObject({ id: "elite", name: "Elite", monthPaise: 450 * USD, stretchPaise: null, paid: true });
    }
    expect(planOf(eliteEnt, winCfg).stretchPaise).toEqual([50, 70, 80, 100, 150].map((x) => x * USD));
    for (const p of ["TAILZU_MONT", "tailzu_annu", "lite", undefined]) expect(on(p)).toMatchObject({ name: "Lite", monthPaise: 35 * USD, paid: true });
  });

  /**
   * Abuse prevention's hold (src/trust) is the one thing that still changes what a plan may spend, and it has to keep working through
   * this change: it used to show as "no windows", which is now true of everybody, so what it really does — the $3 month instead of the
   * $35 one — is what is checked.
   */
  it("a held account drops to the free month, and nobody else is touched", () => {
    const everyone = { ...cfg, FREE_FOR_ALL: true };
    try {
      installHoldCheck((id) => id === "u-held");
      expect(planOf(null, everyone, { userId: "u-held" })).toMatchObject({ name: "Free", paid: false, monthPaise: 3 * USD, windows: false });
      expect(planOf(null, everyone, { userId: "u-other" }).monthPaise).toBe(35 * USD);
      // A payer is never held: the paid branches are reached first.
      expect(planOf(paidEnt, everyone, { userId: "u-held" }).monthPaise).toBe(35 * USD);
    } finally { installHoldCheck(null); }
  });

  it("dollars become paise at the one rate (CODE_USD_INR), so the meter counts dollars whatever it is", () => {
    expect(usdToMeterPaise(0.34, 88)).toBe(2992);
    expect(planOf(null, { ...cfg, CODE_USD_INR: 90 }).monthPaise).toBe(27_000);
    // At any rate, a call that cost $35 fills Lite's month exactly.
    for (const fx of [80, 88, 95.5]) {
      const plan = planOf({ entitlement: "x", active: true }, { ...cfg, CODE_USD_INR: fx });
      const u = usageNow({ events: [{ at: at(2026, 9, 27), paise: usdToMeterPaise(35, fx) }], now: at(2026, 9, 28), tzOffsetMinutes: IST, plan });
      expect(u.stretch.used).toBe(1);
    }
  });

  it("how many times the free month a plan is: Lite 35 / 3 → 11, Elite 450 / 3 → 150", () => {
    expect(timesFree("lite", cfg)).toBe(11);
    expect(timesFree("elite", cfg)).toBe(150);
    expect(timesFree("lite", { ...cfg, USAGE_FREE_MONTH_USD: 0.1, USAGE_LITE_STRETCHES_USD: [0.1, 0.1, 0.1, 0.1, 0.2] })).toBe(6);
  });
});

/**
 * THE BURN BRAKE. It is the floor under one month, not a plan rule: it says no to one hour that spends like no real hour does, and says
 * it in the overload guard's words. The numbers here are the ones the owner will read off the config, so they are spelled out.
 */
describe("the burn brake", () => {
  it("is a share of the plan's own month, so it rises with the plan and is never a typed-in number", () => {
    // 720 hours in a month; at 48 an hour may spend what 48 average hours would. $2.33 on Lite, $30 on Elite.
    expect(burnCapPaise(lite.monthPaise, 48)).toBe(Math.round((35 * USD) / 720 * 48));
    expect(burnCapPaise(lite.monthPaise, 48) / USD).toBeCloseTo(2.33, 2);
    expect(burnCapPaise(elite.monthPaise, 48) / USD).toBeCloseTo(30, 2);
    expect(burnCapPaise(free.monthPaise, 48) / USD).toBeCloseTo(0.2, 2);
    // Switched off, and never a cap of nothing.
    expect(burnCapPaise(lite.monthPaise, 0)).toBe(0);
    expect(burnCapPaise(0, 48)).toBe(0);
    expect(burnCapPaise(1, 48)).toBe(1);
  });

  it("counts only what was spent inside the hour", () => {
    const now = at(2026, 9, 28, 19);
    const events = [{ at: now - 30 * MIN, paise: 100 }, { at: now - 90 * MIN, paise: 5000 }, { at: now - MIN, paise: 7 }];
    expect(spentSince(events, now - HOUR)).toBe(107);
    expect(spentSince(events, now - 2 * HOUR)).toBe(5107);
  });

  it("fires on an absurd burst, and what it says is the busy line, never a quota one", async () => {
    const now = at(2026, 9, 10, 14);
    const store = new MemoryYouStore();
    const spending = new Spending({ store, jobs: null, entitlement: async () => LITE_ENT, now: () => now });
    // Nothing spent: nothing to brake, and the month is nowhere near used.
    expect(await spending.burning("u")).toBe(false);
    await expect(spending.gate("u")).resolves.toBeUndefined();

    // A runaway: $3 in the last ten minutes, which is more than a Lite hour's ceiling of $2.33 and about a hundred heavy minutes.
    for (let i = 0; i < 12; i += 1) await store.addSpend("u", "code", Math.round(0.25 * USD), now - (10 - i / 2) * MIN);
    spending.forget("u");
    expect(await spending.burning("u")).toBe(true);
    const u = await spending.usage("u");
    // Their month is not spent — not even a tenth of it — so "you've run out" would be a lie.
    expect(u.state).toBe("ok");
    expect(u.month.used).toBeLessThan(0.1);
    expect(await spending.refusal("u")).toBeNull();

    const err = await spending.gate("u").then(() => null, (e: unknown) => e as { code: string; message: string; status: number });
    expect(err?.code).toBe("overloaded");
    expect(err?.status).toBe(429);
    expect(err?.message).toBe("X0 Bot is busy right now. Try again in a moment.");
    expect(err?.message).not.toMatch(/limit|run out|used|plan|upgrade/i);
  });

  it("lets the same spend through once the hour has rolled on, and when it is switched off", async () => {
    const burst = at(2026, 9, 10, 14);
    const store = new MemoryYouStore();
    for (let i = 0; i < 12; i += 1) await store.addSpend("u", "code", Math.round(0.25 * USD), burst - i * MIN);
    // Two hours later the burst is behind the window, and the month itself still has almost all of it left.
    const later = new Spending({ store, jobs: null, entitlement: async () => LITE_ENT, now: () => burst + 2 * 60 * MIN });
    expect(await later.burning("u")).toBe(false);
    await expect(later.gate("u")).resolves.toBeUndefined();
    // And with USAGE_BURN_TIMES=0 there is no brake at all.
    vi.stubEnv("USAGE_BURN_TIMES", "0");
    resetConfigForTests();
    try {
      const off = new Spending({ store, jobs: null, entitlement: async () => LITE_ENT, now: () => burst });
      expect(await off.burning("u")).toBe(false);
    } finally { vi.unstubAllEnvs(); resetConfigForTests(); }
  });
});

/** A Xode job's budget, held to what is LEFT OF THE MONTH — the clamp that used to be a window's remainder. */
describe("a job's budget against the meter", () => {
  const now = at(2026, 9, 2, 11); // the 2nd of October: under the windows this was day two of a $4 window
  /** Who the routes see with DEV_SKIP_AUTH on, so the spend has to be written under that id to count. */
  const WHO = "dev-user";
  const ask = async (spentPaise: number, payload: Record<string, unknown>, path = "/v1/code/jobs") => {
    const store = new MemoryYouStore();
    if (spentPaise > 0) await store.addSpend(WHO, "code", spentPaise, at(2026, 9, 1, 9));
    const spending = new Spending({ store, jobs: null, entitlement: async () => LITE_ENT, now: () => now });
    const app = Fastify();
    app.post("/v1/code/jobs", async (req) => req.body);
    app.post("/v1/code/jobs/:id/budget", async (req) => req.body);
    holdJobsToUsage(app, spending, { defaultBudget: () => 3000 } as never);
    const r = await app.inject({ method: "POST", url: path, payload });
    await app.close();
    return { status: r.statusCode, body: r.json() as Record<string, unknown> };
  };

  it("clamps what a new job asks for to the month's remainder, not a window's", async () => {
    // $6 already spent on the 1st. The month has $29 left; the first window would have had nothing.
    const r = await ask(6 * USD, { budgetPaise: 1_000_000 });
    expect(r.status).toBe(200);
    expect(r.body.budgetPaise).toBe(29 * USD);
  });

  it("leaves a budget the month can afford exactly as it was asked for", async () => {
    const r = await ask(6 * USD, { budgetPaise: 5000 });
    expect(r.body.budgetPaise).toBe(5000);
  });

  it("clamps a Keep going the same way, and refuses once the month is gone", async () => {
    const more = await ask(30 * USD, { addPaise: 1_000_000 }, "/v1/code/jobs/j1/budget");
    expect(more.body.addPaise).toBe(5 * USD);
    const none = await ask(35 * USD, { budgetPaise: 100 });
    expect(none.status).toBe(429);
    expect(none.body).toMatchObject({ code: "quota_exceeded", reason: "usage_limit" });
    expect(String(none.body.message)).toBe("You've reached this month's limit. It resets Sun 1 Nov.");
  });

  it("turns a job away with the busy line, not a quota one, when the hour is burning", async () => {
    const store = new MemoryYouStore();
    for (let i = 0; i < 12; i += 1) await store.addSpend(WHO, "code", Math.round(0.25 * USD), now - i * MIN);
    const spending = new Spending({ store, jobs: null, entitlement: async () => LITE_ENT, now: () => now });
    const app = Fastify();
    app.post("/v1/code/jobs", async (req) => req.body);
    holdJobsToUsage(app, spending, { defaultBudget: () => 3000 } as never);
    const r = await app.inject({ method: "POST", url: "/v1/code/jobs", payload: { budgetPaise: 500 } });
    await app.close();
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ code: "overloaded", message: "X0 Bot is busy right now. Try again in a moment." });
    expect(r.headers["retry-after"]).toBe("60");
  });
});

describe("the config: the owner's numbers, validated", () => {
  afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });
  const load = (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    resetConfigForTests();
    return getConfig();
  };

  it("defaults: Free $3 a month, Lite $35, Elite $450, no windows, and the burn brake at 48", () => {
    const c = load({});
    expect(c.USAGE_FREE_MONTH_USD).toBe(3);
    expect(c.USAGE_LITE_STRETCHES_USD).toEqual([4, 8, 6, 10, 7]);
    expect(c.USAGE_ELITE_STRETCHES_USD).toEqual([50, 70, 80, 100, 150]);
    expect(sum(c.USAGE_LITE_STRETCHES_USD)).toBe(35);
    expect(sum(c.USAGE_ELITE_STRETCHES_USD)).toBe(450);
    // The windows are off, and the way back is one setting.
    expect(c.USAGE_STRETCHES).toBe(false);
    expect(c.USAGE_BURN_TIMES).toBe(48);
    expect(planOf({ entitlement: "x", active: true }, c)).toMatchObject({ windows: false, monthPaise: 35 * c.CODE_USD_INR * 100 });
  });

  it("USAGE_STRETCHES=true puts the five windows back with no other setting touched", () => {
    const c = load({ USAGE_STRETCHES: "true" });
    const plan = planOf({ entitlement: "x", active: true }, c);
    expect(plan.windows).toBe(true);
    expect(plan.stretchPaise).toHaveLength(5);
    expect(sum(plan.stretchPaise!)).toBe(plan.monthPaise);
  });

  it("set as written, with spaces and cents; empty is the default", () => {
    const c = load({ USAGE_LITE_STRETCHES_USD: " 4.5, 8 ,6,10,7.25", USAGE_ELITE_STRETCHES_USD: "", USAGE_FREE_MONTH_USD: "2.5" });
    expect(c.USAGE_LITE_STRETCHES_USD).toEqual([4.5, 8, 6, 10, 7.25]);
    expect(c.USAGE_ELITE_STRETCHES_USD).toEqual([50, 70, 80, 100, 150]);
    expect(c.USAGE_FREE_MONTH_USD).toBe(2.5);
  });

  it("anything but five positive amounts stops the boot, naming the setting", () => {
    for (const bad of ["4,8,6,10", "4,8,6,10,7,1", "4,8,6,10,-7", "4,8,6,10,0", "4,8,six,10,7", "4,,6,10,7"]) {
      expect(() => load({ USAGE_LITE_STRETCHES_USD: bad })).toThrow(/USAGE_LITE_STRETCHES_USD/);
      vi.unstubAllEnvs();
    }
    expect(() => load({ USAGE_ELITE_STRETCHES_USD: "50,70,80,100" })).toThrow(/USAGE_ELITE_STRETCHES_USD/);
    vi.unstubAllEnvs();
    expect(() => load({ USAGE_FREE_MONTH_USD: "0" })).toThrow(/USAGE_FREE_MONTH_USD/);
    expect(parseStretchesUsd("4,8,6,10,7")).toEqual([4, 8, 6, 10, 7]);
    expect(parseStretchesUsd("4,8,6")).toBeNull();
    expect(parseStretchesUsd(5)).toBeNull();
  });
});

describe("the gate Keylessbord and Ask ask", () => {
  afterEach(() => setUsageGate(null));
  it("refuses with the meter's sentence before anything else, and lets through when the meter cannot answer", async () => {
    setUsageGate(async () => "You've reached this month's limit. It resets Sun.");
    expect(await enforceQuota({ id: "u" })).toBe("You've reached this month's limit. It resets Sun.");
    setUsageGate(async () => { throw new Error("down"); });
    expect(await enforceQuota({ id: "u" })).toBeNull();
    setUsageGate(null);
    expect(await enforceQuota({ id: "u" })).toBeNull();
  });

  it("a sentence is still the month's refusal, with the code every app already knows", () => {
    expect(quotaBody("You've reached this month's limit. It resets Sun.")).toEqual({
      code: "quota_exceeded", message: "You've reached this month's limit. It resets Sun.",
    });
    expect(quotaHeaders("You've reached this month's limit. It resets Sun.")).toEqual({});
  });

  /**
   * THE GAP THIS CLOSES. The gate used to answer with a STRING, and every caller turned a string into `quota_exceeded` — so the
   * burn brake could not be asked on this path at all: its words would have come out wearing the quota code, opening the Usage
   * screen on a meter nowhere near full and reading as a nudge to buy a plan for a runaway that is ours. The brake guarded the
   * bots platform (`gate`) and Xode's jobs (`holdJobsToUsage`) and nothing else; Keylessbord's dictation and rewrites, the old
   * Ask, notes and the front door all go through enforceQuota, and were unbraked.
   */
  it("now carries the burn brake too: the busy code and the busy words, never a quota one", async () => {
    const now = at(2026, 9, 10, 14);
    const store = new MemoryYouStore();
    for (let i = 0; i < 12; i += 1) await store.addSpend("u", "code", Math.round(0.25 * USD), now - (10 - i / 2) * MIN);
    const spending = new Spending({ store, jobs: null, entitlement: async () => LITE_ENT, now: () => now });
    // Their month is barely touched, so the month's own refusal has nothing to say.
    expect(await spending.refusal("u")).toBeNull();
    setUsageGate((id) => spending.quota(id));

    const out = await enforceQuota({ id: "u" });
    expect(out).not.toBeNull();
    expect(quotaBody(out!)).toMatchObject({ code: "overloaded", reason: "too_fast", message: "X0 Bot is busy right now. Try again in a moment." });
    expect(quotaHeaders(out!)).toEqual({ "retry-after": "60" });
    expect(JSON.stringify(quotaBody(out!))).not.toMatch(/limit|run out|plan|upgrade|quota/i);
  });

  it("keeps the month's own refusal first, and in its own words, when a runaway really has spent the lot", async () => {
    const now = at(2026, 9, 10, 14);
    const store = new MemoryYouStore();
    // The whole month, all of it inside the hour: both the month and the brake would fire.
    await store.addSpend("u", "code", 35 * USD, now - 10 * MIN);
    const spending = new Spending({ store, jobs: null, entitlement: async () => LITE_ENT, now: () => now });
    expect(await spending.burning("u")).toBe(true);
    setUsageGate((id) => spending.quota(id));
    const out = await enforceQuota({ id: "u" });
    expect(quotaBody(out!)).toMatchObject({ code: "quota_exceeded", reason: "usage_limit" });
    expect(String(quotaBody(out!).message)).toMatch(/reached this month's limit/);
  });
});
