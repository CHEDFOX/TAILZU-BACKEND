/**
 * THE LEARNER PORTRAIT (src/lingo/portrait.ts): what is known about one person on one language.
 *
 * A learner model that flatters itself is worse than none, so these are mostly about what it refuses to claim:
 *   - a rate with three answers behind it does not become a verdict
 *   - a gap where somebody put the phone down is not thinking time
 *   - a time is read in the middle, so one four-minute answer does not move anything
 *   - difficulty is against that person's own pace, never against a number from outside
 *   - a level is earned on what can be produced, and never jumps on a handful of words
 */
import { describe, expect, it } from "vitest";
import { AWAY_MS, CONFIDENCE, blendMs, earnedLevel, median, portraitOf, rate, thinkingTime } from "../src/lingo/portrait.js";
import { freshMemory } from "../src/lingo/schedule.js";
import type { Learner, LingoItem, Memory } from "../src/lingo/types.js";

const T0 = Date.UTC(2026, 10, 17, 9, 0, 0);
const DAY = 86_400_000;

const learner = (over: Partial<Learner> = {}): Learner => ({
  target: "es", from: "en", level: "a1", goalMin: 10, calls: false, voice: null,
  streakDays: 0, lastDay: null, usedMs: T0, updatedMs: T0, ...over,
});
const held = (over: Partial<Memory> = {}): Memory => ({
  ...freshMemory(T0), state: "review", stability: 60, difficulty: 5, reps: 6, lastMs: T0 - DAY, dueMs: T0 + 30 * DAY, ...over,
});
const item = (over: Partial<LingoItem> = {}): LingoItem => ({
  item: "café", kind: "word", gloss: "coffee", source: "asked", spoken: 2, memory: held(), ...over,
});

describe("a rate does not become a verdict on three answers", () => {
  it("sits near the prior while the evidence is thin, and takes over once it is not", () => {
    // Nought out of three is not "they cannot do this": it is three answers.
    const thin = rate(0, 3, 0.8);
    expect(thin.p).toBeGreaterThan(0.5);
    expect(thin.sure).toBeLessThan(0.3);
    // Forty answers of its own and the prior barely matters any more.
    const thick = rate(4, 40, 0.8);
    expect(thick.p).toBeLessThan(0.3);
    expect(thick.sure).toBeGreaterThan(0.8);
  });

  it("is exactly halfway between the prior and what was seen at k answers", () => {
    const r = rate(CONFIDENCE, CONFIDENCE, 0);        // every one right, prior says none
    expect(r.p).toBeCloseTo(0.5, 6);
    expect(r.sure).toBeCloseTo(0.5, 6);
  });

  it("says nothing at all when nothing has been seen", () => {
    expect(rate(0, 0).p).toBe(0.5);
    expect(rate(0, 0).sure).toBe(0);
  });
});

describe("reading time honestly", () => {
  it("throws away a gap where they put the phone down, rather than capping it", () => {
    // Capping would quietly turn "gone for lunch" into "thought hard about it", which is worse than not knowing.
    expect(thinkingTime(T0, T0 + AWAY_MS + 1)).toBeNull();
    expect(thinkingTime(T0, T0 + 4_000)).toBe(4_000);
  });

  it("throws away an answer too fast to have been read", () => {
    expect(thinkingTime(T0, T0 + 120)).toBeNull();
  });

  it("knows nothing before the first answer", () => {
    expect(thinkingTime(null, T0)).toBeNull();
    expect(thinkingTime(undefined, T0)).toBeNull();
  });

  it("takes the middle, so one slow answer does not move anything", () => {
    expect(median([1000, 1200, 1100, 240_000])).toBe(1150);
    expect(median([])).toBe(0);
  });

  it("moves an item's time towards what is happening now without one answer owning it", () => {
    expect(blendMs(0, 5000)).toBe(5000);
    const next = blendMs(2000, 10_000);
    expect(next).toBeGreaterThan(2000);
    expect(next).toBeLessThan(6000);
  });
});

describe("a level is earned, not announced", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => item({ item: `w${i}` }));

  it("counts only what they can produce, not what they have seen", () => {
    // Four hundred words they have only ever recognised is not A2.
    const seenOnly = many(400).map((i) => ({ ...i, spoken: 0, memory: held({ stability: 2 }) }));
    expect(earnedLevel(seenOnly, T0, "a1")).toBe("a1");
  });

  it("moves up once the words are there, and by one band at a time", () => {
    expect(earnedLevel(many(400), T0, "a1")).toBe("a2");
    // Far past B1 on paper, but they said A1: one band, not three, until it is well clear.
    expect(earnedLevel(many(1200), T0, "a1")).toBe("a2");
    expect(earnedLevel(many(1200), T0, "a2")).toBe("b1");
  });

  it("never drops somebody below what they said they were", () => {
    // Nothing learned here is not evidence they cannot speak it: they may have arrived already able to.
    expect(earnedLevel([], T0, "b1")).toBe("b1");
    expect(earnedLevel(many(50), T0, "b1")).toBe("b1");
  });

  it("rises one band at a time even when the count says more, and climbs again next time", () => {
    // The cap costs nothing because the level it works out is written back: a1 -> a2 now, a2 -> b1 next time.
    expect(earnedLevel(many(5000), T0, "a1")).toBe("a2");
    expect(earnedLevel(many(5000), T0, "a2")).toBe("b1");
    expect(earnedLevel(many(5000), T0, "b1")).toBe("b2");
  });
});

describe("the whole picture", () => {
  const items = [
    item({ item: "hola", gloss: "hello", memory: held({ thinkMs: 1500 }) }),
    item({ item: "gracias", gloss: "thanks", memory: held({ thinkMs: 1800 }) }),
    item({ item: "terco", gloss: "stubborn", memory: held({ thinkMs: 9000, lapses: 3, stability: 1 }) }),
    item({ item: "nuevo", gloss: "new", spoken: 0, memory: freshMemory(T0) }),
  ];
  const me = learner({ unit: "food", tally: {
    choose: { asked: 40, right: 38, ms: 1400 },
    speak: { asked: 20, right: 9, ms: 7000 },
    listen: { asked: 2, right: 0, ms: 3000 },
  } });

  it("puts the hardest kind first, and does not let two answers outrank twenty", () => {
    const p = portraitOf(items, me, T0);
    expect(p.kinds[0]?.kind).toBe("speak");
    // Listening was 0 of 2 — worse on the face of it, but it is two answers and the model knows that.
    const listen = p.kinds.find((k) => k.kind === "listen")!;
    const speak = p.kinds.find((k) => k.kind === "speak")!;
    expect(listen.p).toBeGreaterThan(speak.p);
    expect(listen.sure).toBeLessThan(0.3);
  });

  it("finds the word that is costing them, by their own pace and not a stopwatch", () => {
    const p = portraitOf(items, me, T0);
    expect(p.hard[0]?.item).toBe("terco");
    expect(p.hard[0]?.effort).toBeGreaterThan(1);
    expect(p.easy.map((e) => e.item)).toContain("hola");
    expect(p.easy.map((e) => e.item)).not.toContain("terco");
  });

  it("says where they are on the path, in words a person could read", () => {
    const p = portraitOf(items, me, T0);
    expect(p.unit.key).toBe("food");
    expect(p.unit.goal).toContain("order food");
    expect(p.unit.at).toBe(6);
    expect(p.unit.of).toBe(24);
  });

  it("counts what is there and invents nothing", () => {
    const p = portraitOf(items, me, T0);
    expect(p.counts.items).toBe(4);
    expect(p.counts.unseen).toBe(1);
    expect(p.counts.spoken).toBe(3);
    expect(p.hold).toBeGreaterThan(0);
    expect(p.hold).toBeLessThanOrEqual(1);
  });

  it("holds up for somebody who has done nothing at all", () => {
    const p = portraitOf([], learner(), T0);
    expect(p.counts.items).toBe(0);
    expect(p.kinds).toEqual([]);
    expect(p.thinkMs).toBe(0);
    expect(p.hold).toBe(0);
    expect(p.earned).toBe("a1");
    expect(p.unit.at).toBe(1);
    expect(Number.isFinite(p.pace)).toBe(true);
  });
});
