import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { computeAllowance, type UsageMoment } from "../src/usage/allowance.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-03-20T12:00:00Z");

/** `n` dictations on the day `daysAgo` days before NOW. */
function day(daysAgo: number, sessions = 1, words = 10): UsageMoment[] {
  const at = NOW - daysAgo * DAY;
  return Array.from({ length: sessions }, () => ({ at, words }));
}

describe("earned words", () => {
  const SEED = "user-a";
  const at = (moments: UsageMoment[]) => computeAllowance(moments, NOW, SEED);

  it("gives nothing when nothing has been used", () => {
    const a = at([]);
    expect(a.earned).toBe(0);
    expect(a.total).toBe(800);
    expect(a.remaining).toBe(800);
    expect(a.streakDays).toBe(0);
    expect(a.perVisit).toEqual([]);
  });

  it("pays something for every visit", () => {
    const a = at(day(0));
    expect(a.earned).toBeGreaterThan(0);
    expect(a.total).toBe(800 + a.earned);
    expect(a.streakDays).toBe(1);
    expect(a.perVisit).toHaveLength(1);
  });

  it("never announces what the next visit is worth", () => {
    // The whole point of the change: an amount the user can read in advance is
    // a price, and a price can be judged not worth paying.
    const a = at(day(0)) as unknown as Record<string, unknown>;
    expect(a.nextStreakWords).toBeUndefined();
  });

  it("gives the same answer every time it is asked", () => {
    // Math.random would re-roll on every request: the stats screen would
    // disagree with itself between refreshes and the quota check with both.
    const m = [...day(2), ...day(1), ...day(0)];
    expect(at(m).earned).toBe(at(m).earned);
    expect(computeAllowance(m, NOW + 5_000, SEED).earned).toBe(at(m).earned);
  });

  it("gives different users different amounts on the same day", () => {
    const m = day(0);
    const seeds = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];
    const values = new Set(seeds.map((x) => computeAllowance(m, NOW, x).earned));
    expect(values.size).toBeGreaterThan(1);
  });

  it("varies the amount across days — the reward is not a schedule", () => {
    const moments = Array.from({ length: 20 }, (_, i) => day(19 - i)).flat();
    const a = at(moments);
    const amounts = new Set(a.perVisit.map((v) => v.words));
    expect(amounts.size).toBeGreaterThan(1);
  });

  it("keeps every amount inside the published tiers", () => {
    const moments = Array.from({ length: 30 }, (_, i) => day(29 - i)).flat();
    const a = at(moments);
    for (const v of a.perVisit) {
      expect([30, 70, 150, 400]).toContain(v.words);
      expect(["small", "good", "big", "huge"]).toContain(v.tier);
    }
  });

  it("makes good days commoner as the streak grows", () => {
    // The streak tilts the odds; it never sets the number. Compare the same
    // days seen as one long run against the same count of isolated visits.
    const run = Array.from({ length: 14 }, (_, i) => day(13 - i)).flat();
    const streakAvg = at(run).earned / 14;
    let lone = 0;
    for (let i = 0; i < 14; i++) lone += computeAllowance(day(i * 3), NOW, SEED).earned;
    expect(streakAvg).toBeGreaterThan(lone / 14);
  });

  it("counts a streak that ran to yesterday as still alive", () => {
    // Someone who has not opened the app YET today has not lost their streak;
    // telling them they had would punish them at the hour they are deciding.
    expect(at([...day(2), ...day(1)]).streakDays).toBe(2);
  });

  it("drops a streak that ended before yesterday", () => {
    expect(at([...day(4), ...day(3)]).streakDays).toBe(0);
  });

  it("pays a bonus for a day of real use", () => {
    const quiet = at(day(0, 4)).earned;
    const busy = at(day(0, 5)).earned;
    expect(busy - quiet).toBe(150);
  });

  it("pays per day, not per word — volume alone earns nothing extra", () => {
    // The whole point: transcription costs us money, returning does not.
    expect(at(day(0, 1, 5000)).earned).toBe(at(day(0, 1, 10)).earned);
  });

  it("caps the month's earnings", () => {
    const moments = Array.from({ length: 40 }, (_, i) => day(39 - i, 6)).flat();
    const a = at(moments);
    expect(a.earned).toBe(1600);
    expect(a.maxed).toBe(true);
  });

  it("never reports a negative balance", () => {
    expect(at([{ at: NOW, words: 99_999 }]).remaining).toBe(0);
  });

  it("counts used words from every moment", () => {
    // Under the 800-word plan on purpose: over it, remaining clamps to zero
    // and would stop testing the sum.
    const a = at([...day(1, 2, 100), ...day(0, 1, 150)]);
    expect(a.used).toBe(350);
    expect(a.remaining).toBe(a.total - 350);
  });

  it("reports each visit for the chart, oldest first", () => {
    const a = at([...day(1), ...day(0, 5)]);
    expect(a.perVisit).toHaveLength(2);
    expect(a.perVisit[0].day < a.perVisit[1].day).toBe(true);
    // The burst bonus is folded into the day it happened, so the chart's
    // slices add up to the earned total the meter shows.
    expect(a.perVisit.reduce((n, v) => n + v.words, 0)).toBe(a.earned);
  });
});
