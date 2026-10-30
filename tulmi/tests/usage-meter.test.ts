/**
 * The usage meter (src/you/usage.ts): the owner's limits in US dollars of what the use really costs us. Lite's month is five stretches of
 * $4, $8, $6, $10 and $7 ($35), Elite's $50, $70, $80, $100 and $150 ($450), each stretch its own amount whatever its days (days 1–4, 5–9,
 * 10–15, 16–22, 23 to the end); the free plan is $3 for the month with no stretches. Dollars become paise at CODE_USD_INR, the rate the
 * records were counted at. From the billing cycle or the calendar month on the person's clock; carry-over when asked; the plans; the config,
 * validated; the words every screen says; and the gate Keybot and Ask ask (metering.setUsageGate). Never an amount in what a person reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

import { getConfig, resetConfigForTests } from "../src/config.js";
import { enforceQuota, setUsageGate } from "../src/usage/metering.js";
import {
  cycleOf, howLine, nearLine, outLine, parseStretchesUsd, percent, planOf, refusalOf, stretchAmounts, stretchesOf, tiersOf, timesFree, usageNow,
  usdToMeterPaise, whenWords, type PlanConfig,
} from "../src/you/usage.js";

const DAY = 86_400_000, MIN = 60_000, IST = 330;
const at = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m, d, h, mi) - IST * MIN;
/** A dollar is 8,800 paise at 88 rupees to the dollar. */
const USD = 8800;
const cfg: PlanConfig = {
  USAGE_FREE_MONTH_USD: 3, USAGE_LITE_STRETCHES_USD: [4, 8, 6, 10, 7], USAGE_ELITE_STRETCHES_USD: [50, 70, 80, 100, 150],
  PLAN_ELITE_PRODUCTS: "x0_elite_monthly,elite", USAGE_CARRY_OVER: false, FREE_FOR_ALL: false, CODE_USD_INR: 88,
};
const lite = planOf({ entitlement: "TAILZU AIR", active: true }, cfg);
const elite = planOf({ entitlement: "TAILZU AIR", active: true, product: "x0_elite_monthly" }, cfg);
const free = planOf(null, cfg);
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
  const now = at(2026, 9, 28, 19, 40); // Wed 28 Oct, stretch 5 (23–31 Oct, 9 days of 31): Lite's $7
  it("this stretch is its own amount (Lite's fifth, $7), whatever its days; this month the sum ($35); nothing carries over", () => {
    const u = usageNow({ events: [{ at: at(2026, 9, 3), paise: 30_000 }, { at: at(2026, 9, 27), paise: 3.5 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(u.stretch).toMatchObject({ n: 5, of: 5, days: 9, startsAt: at(2026, 9, 23), resetsAt: at(2026, 10, 1) });
    expect(u.allowancePaise).toBe(7 * USD);
    expect(u.stretch.used).toBe(0.5);
    expect(u.month.used).toBeCloseTo((30_000 + 3.5 * USD) / (35 * USD), 4);
    expect(u.state).toBe("ok");
    expect(u.leftPaise).toBe(3.5 * USD);
  });

  it("each of the five stretches may use its own amount: Lite $4, $8, $6, $10, $7; Elite $50, $70, $80, $100, $150", () => {
    // November 2026: 1–4, 5–9, 10–15, 16–22, 23–30.
    const days = [2, 6, 12, 20, 27];
    const allowance = (plan: typeof lite, d: number) => usageNow({ events: [], now: at(2026, 10, d, 12), tzOffsetMinutes: IST, plan }).allowancePaise / USD;
    expect(days.map((d) => allowance(lite, d))).toEqual([4, 8, 6, 10, 7]);
    expect(days.map((d) => allowance(elite, d))).toEqual([50, 70, 80, 100, 150]);
    // The stretches keep their days: 4, 5, 6, 7, then the rest (8 in November).
    expect(days.map((d) => usageNow({ events: [], now: at(2026, 10, d, 12), tzOffsetMinutes: IST, plan: lite }).stretch.days)).toEqual([4, 5, 6, 7, 8]);
  });

  it("near from 80%, out at all of it (or all of the month)", () => {
    const near = usageNow({ events: [{ at: at(2026, 9, 27), paise: 0.8 * 7 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(near.state).toBe("near");
    expect(nearLine(near, now, IST)).toBe("You've used most of this stretch. It resets Sun.");
    const out = usageNow({ events: [{ at: at(2026, 9, 27), paise: 7 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(out.state).toBe("out");
    expect(out.leftPaise).toBe(0);
    expect(outLine(out, now, IST)).toBe("You've reached this stretch's limit. It resets Sun.");
    expect(refusalOf(out, now, IST)).toEqual({ code: "quota_exceeded", reason: "usage_limit", message: "You've reached this stretch's limit. It resets Sun.", resetsAt: at(2026, 10, 1), upgrade: false });
    // The month's $35 used in earlier stretches: out, though this stretch has used nothing.
    const month = usageNow({ events: [{ at: at(2026, 9, 2), paise: 35 * USD }], now, tzOffsetMinutes: IST, plan: lite });
    expect(month.state).toBe("out");
    expect(refusalOf(month, now, IST).message).toBe("You've reached this month's limit. It resets Sun.");
  });

  it("with carry-over, what the earlier stretches' amounts left is this one's too", () => {
    const events = [{ at: at(2026, 9, 2), paise: 1000 }, { at: at(2026, 9, 27), paise: 7 * USD }];
    const strict = usageNow({ events, now, tzOffsetMinutes: IST, plan: lite });
    expect(strict.state).toBe("out");
    const carried = usageNow({ events, now, tzOffsetMinutes: IST, plan: { ...lite, carryOver: true } });
    expect(carried.allowancePaise).toBe(35 * USD - 1000);
    expect(carried.state).toBe("ok");
    // In the second stretch: the first's $4 and the second's $8, less what the first used.
    const second = usageNow({ events: [{ at: at(2026, 9, 2), paise: 1000 }], now: at(2026, 9, 6), tzOffsetMinutes: IST, plan: { ...lite, carryOver: true } });
    expect(second.allowancePaise).toBe(12 * USD - 1000);
  });

  it("the free plan has no stretches: $3 for the month, one meter, and every line says this month", () => {
    expect(free).toMatchObject({ id: "free", windows: false, stretchPaise: null, monthPaise: 3 * USD, upgrade: true });
    const u = usageNow({ events: [{ at: at(2026, 9, 2), paise: 0.8 * 3 * USD }], now, tzOffsetMinutes: IST, plan: free });
    expect(u.plan.windows).toBe(false);
    expect(u.stretch).toMatchObject({ n: 1, of: 1, used: 0.8, startsAt: at(2026, 9, 1), resetsAt: at(2026, 10, 1), days: 31 });
    expect(u.allowancePaise).toBe(3 * USD);
    expect(u.state).toBe("near");
    expect(nearLine(u, now, IST)).toBe("You've used most of this month. It resets Sun.");
    expect(howLine(u)).toBe("Your plan's use is counted by the month, and starts again when the month does.");
    const out = usageNow({ events: [{ at: at(2026, 9, 2), paise: 3 * USD }], now, tzOffsetMinutes: IST, plan: free });
    expect(out.state).toBe("out");
    expect(refusalOf(out, now, IST)).toEqual({ code: "quota_exceeded", reason: "usage_limit", message: "You've reached this month's limit. It resets Sun.", resetsAt: at(2026, 10, 1), upgrade: true });
    // $2 on the 2nd and $0.99 on the 27th: one month, not a stretch that started on the 23rd.
    const spread = usageNow({ events: [{ at: at(2026, 9, 2), paise: 2 * USD }, { at: at(2026, 9, 27), paise: 0.99 * USD }], now, tzOffsetMinutes: IST, plan: free });
    expect(spread.state).toBe("near");
    expect(spread.leftPaise).toBe(Math.floor(0.01 * USD));
  });

  it("a billing month resets at the time it was bought", () => {
    const anchor = Date.UTC(2026, 6, 14, 3, 30); // 9 am IST
    const u = usageNow({ events: [], now: Date.UTC(2026, 9, 15, 6), tzOffsetMinutes: IST, anchor, plan: lite });
    expect(u.stretch.startsAt).toBe(Date.UTC(2026, 9, 14, 3, 30));
    expect(u.stretch.resetsAt).toBe(Date.UTC(2026, 9, 18, 3, 30));
    expect(whenWords(u.stretch.resetsAt, Date.UTC(2026, 9, 15, 6), IST)).toBe("Sun 9 am");
  });

  it("the last stretch takes whatever amounts are left", () => {
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
    expect(howLine({ plan: { ...lite } })).toContain("five stretches");
    const now = at(2026, 9, 28);
    for (const plan of [lite, elite, free]) {
      const u = usageNow({ events: [{ at: now - DAY, paise: 1e9 }], now, tzOffsetMinutes: IST, plan });
      for (const s of [howLine(u), outLine(u, now, IST), refusalOf(u, now, IST).message, howLine({ plan: { ...u.plan, carryOver: true } })]) {
        expect(s).not.toMatch(/₹|\$|paise|rupee|dollar|cent/i);
      }
    }
  });
});

describe("the plans", () => {
  it("free ($3, the month), Lite's stretches, a paid tier of its own, and everyone while X0 Bot is free", () => {
    expect(planOf(null, cfg)).toMatchObject({ id: "free", monthPaise: 26_400, stretchPaise: null, windows: false, upgrade: true });
    expect(planOf({ entitlement: "TAILZU AIR", active: true }, cfg)).toMatchObject({
      id: "paid", name: "Lite", paid: true, stretchPaise: [35_200, 70_400, 52_800, 88_000, 61_600], monthPaise: 308_000, windows: true, upgrade: false,
    });
    expect(planOf({ entitlement: "Max", active: true }, { ...cfg, USAGE_TIERS: '{"max": "10,20,30,40,50"}' })).toMatchObject({ id: "Max", monthPaise: 150 * USD });
    expect(planOf({ entitlement: "Max", active: true }, { ...cfg, USAGE_TIERS: '{"max": [10, 20, 30, 40, 50]}' }).monthPaise).toBe(150 * USD);
    // A tier that is not five amounts is Lite's.
    expect(planOf({ entitlement: "Max", active: true }, { ...cfg, USAGE_TIERS: '{"max": 200000}' })).toMatchObject({ id: "paid", monthPaise: 35 * USD });
    expect(planOf(null, { ...cfg, FREE_FOR_ALL: true })).toMatchObject({ id: "everyone", monthPaise: 35 * USD, windows: true, upgrade: false });
    expect(planOf(null, { ...cfg, USAGE_CARRY_OVER: true }).carryOver).toBe(true);
    expect([...tiersOf("not json")]).toEqual([]);
    expect([...tiersOf('{"pro": "1,2,3,4,5", "bad": "1,2,3"}')]).toEqual([["pro", [1, 2, 3, 4, 5]]]);
  });

  it("Elite by the product bought, on either store or Razorpay; Lite and the old yearly plan otherwise", () => {
    const on = (product?: string) => planOf({ entitlement: "TAILZU AIR", active: true, ...(product ? { product } : {}) }, cfg);
    for (const p of ["x0_elite_monthly", "x0_elite_monthly:monthly", "elite"]) {
      expect(on(p)).toMatchObject({ id: "elite", name: "Elite", monthPaise: 450 * USD, stretchPaise: [50, 70, 80, 100, 150].map((x) => x * USD), paid: true });
    }
    for (const p of ["TAILZU_MONT", "tailzu_annu", "lite", undefined]) expect(on(p)).toMatchObject({ name: "Lite", monthPaise: 35 * USD, paid: true });
  });

  it("dollars become paise at the one rate (CODE_USD_INR), so the meter counts dollars whatever it is", () => {
    expect(usdToMeterPaise(0.34, 88)).toBe(2992);
    expect(planOf(null, { ...cfg, CODE_USD_INR: 90 }).monthPaise).toBe(27_000);
    // At any rate, a call that cost $7 fills Lite's fifth stretch exactly.
    for (const fx of [80, 88, 95.5]) {
      const plan = planOf({ entitlement: "x", active: true }, { ...cfg, CODE_USD_INR: fx });
      const u = usageNow({ events: [{ at: at(2026, 9, 27), paise: usdToMeterPaise(7, fx) }], now: at(2026, 9, 28), tzOffsetMinutes: IST, plan });
      expect(u.stretch.used).toBe(1);
    }
  });

  it("how many times the free month a plan is: Lite 35 / 3 → 11, Elite 450 / 3 → 150", () => {
    expect(timesFree("lite", cfg)).toBe(11);
    expect(timesFree("elite", cfg)).toBe(150);
    expect(timesFree("lite", { ...cfg, USAGE_FREE_MONTH_USD: 0.1, USAGE_LITE_STRETCHES_USD: [0.1, 0.1, 0.1, 0.1, 0.2] })).toBe(6);
  });
});

describe("the config: the owner's numbers, validated", () => {
  afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });
  const load = (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    resetConfigForTests();
    return getConfig();
  };

  it("defaults: Free $3 a month, Lite $4, $8, $6, $10, $7 ($35), Elite $50, $70, $80, $100, $150 ($450)", () => {
    const c = load({});
    expect(c.USAGE_FREE_MONTH_USD).toBe(3);
    expect(c.USAGE_LITE_STRETCHES_USD).toEqual([4, 8, 6, 10, 7]);
    expect(c.USAGE_ELITE_STRETCHES_USD).toEqual([50, 70, 80, 100, 150]);
    expect(c.USAGE_LITE_STRETCHES_USD.reduce((a, b) => a + b, 0)).toBe(35);
    expect(c.USAGE_ELITE_STRETCHES_USD.reduce((a, b) => a + b, 0)).toBe(450);
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
