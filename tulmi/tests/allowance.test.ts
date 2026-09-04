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
  it("gives nothing when nothing has been used", () => {
    const a = computeAllowance([], NOW);
    expect(a.earned).toBe(0);
    expect(a.total).toBe(2500);
    expect(a.remaining).toBe(2500);
    expect(a.streakDays).toBe(0);
  });

  it("earns the first day's words on the first day", () => {
    const a = computeAllowance(day(0), NOW);
    expect(a.earned).toBe(100);
    expect(a.total).toBe(2600);
    expect(a.streakDays).toBe(1);
  });

  it("pays more for each consecutive day", () => {
    // 100 + 125 + 150.
    const a = computeAllowance([...day(2), ...day(1), ...day(0)], NOW);
    expect(a.earned).toBe(375);
    expect(a.streakDays).toBe(3);
    expect(a.nextStreakWords).toBe(175);
  });

  it("restarts the streak after a gap, and does not pay for the gap", () => {
    // Two separate runs of one day each: 100 + 100.
    const a = computeAllowance([...day(9), ...day(0)], NOW);
    expect(a.earned).toBe(200);
    expect(a.streakDays).toBe(1);
  });

  it("counts a streak that ran to yesterday as still alive", () => {
    // Someone who has not opened the app YET today has not lost their streak;
    // telling them they had would punish them at the hour they are deciding.
    const a = computeAllowance([...day(2), ...day(1)], NOW);
    expect(a.streakDays).toBe(2);
  });

  it("drops a streak that ended before yesterday", () => {
    const a = computeAllowance([...day(4), ...day(3)], NOW);
    expect(a.streakDays).toBe(0);
    expect(a.nextStreakWords).toBe(100);
  });

  it("caps one day's streak grant", () => {
    // 12 consecutive days: 100,125,…,300 then 300 flat.
    const moments = Array.from({ length: 12 }, (_, i) => day(11 - i)).flat();
    const a = computeAllowance(moments, NOW);
    const perDay = [100, 125, 150, 175, 200, 225, 250, 275, 300, 300, 300, 300];
    expect(a.earned).toBe(perDay.reduce((x, y) => x + y, 0));
    expect(a.nextStreakWords).toBe(300);
  });

  it("pays a bonus for a day of real use", () => {
    // One day, five dictations: 100 streak + 150 burst.
    const a = computeAllowance(day(0, 5), NOW);
    expect(a.earned).toBe(250);
  });

  it("does not pay the bonus for a quiet day", () => {
    const a = computeAllowance(day(0, 4), NOW);
    expect(a.earned).toBe(100);
  });

  it("pays per day, not per word — volume alone earns nothing extra", () => {
    // The whole point: transcription costs us money, returning does not.
    const light = computeAllowance(day(0, 1, 10), NOW);
    const heavy = computeAllowance(day(0, 1, 5000), NOW);
    expect(heavy.earned).toBe(light.earned);
  });

  it("caps the month's earnings", () => {
    // 40 days of heavy use would earn far more than the cap allows.
    const moments = Array.from({ length: 40 }, (_, i) => day(39 - i, 6)).flat();
    const a = computeAllowance(moments, NOW);
    expect(a.earned).toBe(5000);
    expect(a.maxed).toBe(true);
    expect(a.nextStreakWords).toBe(0);
  });

  it("never reports a negative balance", () => {
    const a = computeAllowance([{ at: NOW, words: 99_999 }], NOW);
    expect(a.remaining).toBe(0);
  });

  it("counts used words from every moment", () => {
    const a = computeAllowance([...day(1, 2, 300), ...day(0, 1, 400)], NOW);
    expect(a.used).toBe(1000);
    expect(a.remaining).toBe(a.total - 1000);
  });

  it("labels each grant so the app can name what was earned", () => {
    const a = computeAllowance([...day(1), ...day(0, 5)], NOW);
    // Newest first.
    expect(a.grants[0]).toMatchObject({ kind: "burst", words: 150 });
    expect(a.grants[1]).toMatchObject({ kind: "streak", label: "Day 2 in a row" });
    expect(a.grants[2]).toMatchObject({ kind: "streak", label: "First day back" });
  });
});
