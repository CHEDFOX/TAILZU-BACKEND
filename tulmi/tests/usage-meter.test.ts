/**
 * The usage meter (src/you/usage.ts): a month in five stretches (days 1–4, 5–9, 10–15, 16–22, 23 to the end), each allowed the month's
 * limit × its days / the month's days, from the billing cycle or the calendar month on the person's clock; carry-over when asked; the plans;
 * the words every screen says; and the gate Keybot and Ask ask (metering.setUsageGate). Never an amount in what a person reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

import { enforceQuota, setUsageGate } from "../src/usage/metering.js";
import {
  cycleOf, howLine, nearLine, outLine, percent, planOf, refusalOf, stretchesOf, tiersOf, usageNow, whenWords, type UsagePlan,
} from "../src/you/usage.js";

const DAY = 86_400_000, MIN = 60_000, IST = 330;
const at = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m, d, h, mi) - IST * MIN;
const paid: UsagePlan = { id: "paid", name: "Pro", paid: true, monthPaise: 31_000, windows: true, carryOver: false, upgrade: false };
const free: UsagePlan = { id: "free", name: "Free", paid: false, monthPaise: 5000, windows: false, carryOver: false, upgrade: true };
const cfg = { USAGE_FREE_MONTH_PAISE: 5000, USAGE_PAID_MONTH_PAISE: 50_000, USAGE_FREE_WINDOWS: false, USAGE_CARRY_OVER: false, FREE_FOR_ALL: false };

describe("the month's stretches", () => {
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

describe("the meter", () => {
  const now = at(2026, 9, 28, 19, 40); // Wed 28 Oct, stretch 5 (23–31 Oct, 9 days of 31)
  it("this stretch is its share of the month (9/31 here), this month the whole; nothing carries over", () => {
    const u = usageNow({ events: [{ at: at(2026, 9, 3), paise: 3000 }, { at: at(2026, 9, 27), paise: 4500 }], now, tzOffsetMinutes: IST, plan: paid });
    expect(u.stretch).toMatchObject({ n: 5, of: 5, days: 9, startsAt: at(2026, 9, 23), resetsAt: at(2026, 10, 1) });
    expect(u.allowancePaise).toBe(9000);
    expect(u.stretch.used).toBe(0.5);
    expect(u.month.used).toBeCloseTo(7500 / 31_000, 4);
    expect(u.state).toBe("ok");
    expect(u.leftPaise).toBe(4500);
  });

  it("near from 80%, out at all of it (or all of the month)", () => {
    const near = usageNow({ events: [{ at: at(2026, 9, 27), paise: 7300 }], now, tzOffsetMinutes: IST, plan: paid });
    expect(near.state).toBe("near");
    expect(nearLine(near, now, IST)).toBe("You've used most of this stretch. It resets Sun.");
    const out = usageNow({ events: [{ at: at(2026, 9, 27), paise: 9000 }], now, tzOffsetMinutes: IST, plan: paid });
    expect(out.state).toBe("out");
    expect(out.leftPaise).toBe(0);
    expect(outLine(out, now, IST)).toBe("You've reached this stretch's limit. It resets Sun.");
    expect(refusalOf(out, now, IST)).toEqual({ code: "quota_exceeded", reason: "usage_limit", message: "You've reached this stretch's limit. It resets Sun.", resetsAt: at(2026, 10, 1), upgrade: false });
  });

  it("with carry-over, what earlier stretches left is this one's too", () => {
    const events = [{ at: at(2026, 9, 2), paise: 1000 }, { at: at(2026, 9, 27), paise: 9000 }];
    const strict = usageNow({ events, now, tzOffsetMinutes: IST, plan: paid });
    expect(strict.state).toBe("out");
    const carried = usageNow({ events, now, tzOffsetMinutes: IST, plan: { ...paid, carryOver: true } });
    expect(carried.allowancePaise).toBe(30_000);
    expect(carried.stretch.used).toBe(0.3);
    expect(carried.state).toBe("ok");
  });

  it("a free plan is one stretch, the month, and says so", () => {
    const u = usageNow({ events: [{ at: at(2026, 9, 2), paise: 4000 }], now, tzOffsetMinutes: IST, plan: free });
    expect(u.stretch).toMatchObject({ n: 1, of: 1, used: 0.8 });
    expect(u.state).toBe("near");
    expect(nearLine(u, now, IST)).toBe("You've used most of this month. It resets Sun.");
    expect(howLine(u)).toBe("Your plan's use is counted by the month, and starts again when the month does.");
    expect(refusalOf({ ...u, state: "out" }, now, IST).upgrade).toBe(true);
  });

  it("a billing month resets at the time it was bought", () => {
    const anchor = Date.UTC(2026, 6, 14, 3, 30); // 9 am IST
    const u = usageNow({ events: [], now: Date.UTC(2026, 9, 15, 6), tzOffsetMinutes: IST, anchor, plan: paid });
    expect(u.stretch.startsAt).toBe(Date.UTC(2026, 9, 14, 3, 30));
    expect(u.stretch.resetsAt).toBe(Date.UTC(2026, 9, 18, 3, 30));
    expect(whenWords(u.stretch.resetsAt, Date.UTC(2026, 9, 15, 6), IST)).toBe("Sun 9 am");
  });
});

describe("the words", () => {
  it("say a share and a day, never an amount", () => {
    expect(percent(0.644)).toBe("64%");
    expect(percent(-1)).toBe("0%");
    expect(whenWords(at(2026, 10, 1), at(2026, 9, 28), IST)).toBe("Sun");
    expect(whenWords(at(2026, 10, 1, 9, 30), at(2026, 9, 28), IST)).toBe("Sun 9:30 am");
    expect(whenWords(at(2026, 10, 14), at(2026, 9, 28), IST)).toBe("Sat 14 Nov");
    expect(howLine({ plan: { ...paid } })).toContain("five stretches");
    for (const s of [howLine({ plan: paid }), howLine({ plan: { ...paid, carryOver: true } })]) expect(s).not.toMatch(/₹|paise|rupee/i);
  });
});

describe("the plans", () => {
  it("free, paid, a paid tier of its own, and everyone while Tailzu is free", () => {
    expect(planOf(null, cfg)).toMatchObject({ id: "free", monthPaise: 5000, windows: false, upgrade: true });
    expect(planOf(null, { ...cfg, USAGE_FREE_WINDOWS: true }).windows).toBe(true);
    expect(planOf({ entitlement: "TAILZU AIR", active: true }, cfg)).toMatchObject({ id: "paid", paid: true, monthPaise: 50_000, windows: true, upgrade: false });
    expect(planOf({ entitlement: "Max", active: true }, { ...cfg, USAGE_TIERS: '{"max": 200000}' })).toMatchObject({ id: "Max", monthPaise: 200_000 });
    expect(planOf(null, { ...cfg, FREE_FOR_ALL: true })).toMatchObject({ id: "everyone", monthPaise: 50_000, windows: true, upgrade: false });
    expect(planOf(null, { ...cfg, USAGE_CARRY_OVER: true }).carryOver).toBe(true);
    expect([...tiersOf("not json")]).toEqual([]);
    expect([...tiersOf('{"pro": 1000, "bad": -1}')]).toEqual([["pro", 1000]]);
  });

  it("Elite by the product bought, on either store or Razorpay; Lite and the old yearly plan otherwise", () => {
    const c = { ...cfg, USAGE_ELITE_MONTH_PAISE: 500_000, PLAN_ELITE_PRODUCTS: "x0_elite_monthly,elite" };
    const on = (product?: string) => planOf({ entitlement: "TAILZU AIR", active: true, ...(product ? { product } : {}) }, c);
    for (const p of ["x0_elite_monthly", "x0_elite_monthly:monthly", "elite"]) expect(on(p)).toMatchObject({ id: "elite", name: "Elite", monthPaise: 500_000, paid: true });
    for (const p of ["TAILZU_MONT", "tailzu_annu", "lite", undefined]) expect(on(p)).toMatchObject({ name: "Lite", monthPaise: 50_000, paid: true });
    // Without a setting of its own, Elite is ten Lites, as its price is.
    expect(planOf({ entitlement: "TAILZU AIR", active: true, product: "elite" }, { ...cfg, PLAN_ELITE_PRODUCTS: "elite" }).monthPaise).toBe(500_000);
  });
});

describe("the gate Keybot and Ask ask", () => {
  afterEach(() => setUsageGate(null));
  it("refuses with the meter's sentence before anything else, and lets through when the meter cannot answer", async () => {
    setUsageGate(async () => "You've reached this stretch's limit. It resets Sun.");
    expect(await enforceQuota({ id: "u" })).toBe("You've reached this stretch's limit. It resets Sun.");
    setUsageGate(async () => { throw new Error("down"); });
    expect(await enforceQuota({ id: "u" })).toBeNull();
    setUsageGate(null);
    expect(await enforceQuota({ id: "u" })).toBeNull();
  });
});
