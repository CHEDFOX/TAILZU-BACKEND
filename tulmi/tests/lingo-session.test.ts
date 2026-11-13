/**
 * A DAY'S SESSION (src/lingo/session.ts) AND WHAT IS KEPT (src/lingo/store.ts):
 *
 *   - an item climbs: met for the first time it is only recognised, then heard and written, then SAID, and it stays
 *     on saying until it has been said enough times to count
 *   - what is nearly forgotten comes first, with a few never-seen mixed in so a session is never only revision
 *   - the same item on the same day is offered the same way, so a reload is not a different question
 *   - the store never resets an item somebody already has: its history is theirs
 *   - a streak counts the person's own days, and a gap starts it again
 */
import { describe, expect, it } from "vitest";
import { freshMemory, review } from "../src/lingo/schedule.js";
import { answered, dayOf, exerciseFor, plan, progress, shapeFor, sizeFor, streakAfter } from "../src/lingo/session.js";
import { MemoryLingoStore } from "../src/lingo/store.js";
import type { Learner, LingoItem } from "../src/lingo/types.js";

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

const learner = (over: Partial<Learner> = {}): Learner => ({
  target: "xx", from: "yy", level: "a1", goalMin: 10, calls: false, voice: null,
  streakDays: 0, lastDay: null, usedMs: T0, updatedMs: T0, ...over,
});

const item = (over: Partial<LingoItem> = {}): LingoItem => ({
  item: "aaa", kind: "word", gloss: "bbb", source: "seed", spoken: 0, memory: freshMemory(T0), ...over,
});

describe("how long a session is", () => {
  it("follows the minutes they asked for, and is never pointlessly short or endless", () => {
    expect(sizeFor(10)).toBe(40);
    expect(sizeFor(1)).toBeGreaterThanOrEqual(5);
    expect(sizeFor(1000)).toBeLessThanOrEqual(60);
  });
});

describe("an item climbs towards being said", () => {
  it("only asks for recognition the first time it is met", () => {
    expect(shapeFor(item(), T0)).toBe("choose");
  });

  it("goes back to recognition when it has been lost", () => {
    const lost = item({ memory: { ...freshMemory(T0), difficulty: 5, state: "relearning", reps: 4, lastMs: T0 } });
    expect(shapeFor(lost, T0)).toBe("choose");
  });

  it("asks for it OUT LOUD once it is held, and keeps asking until it has been said enough", () => {
    const held = item({ spoken: 0, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability: 40, reps: 4, lastMs: T0 } });
    expect(shapeFor(held, T0)).toBe("say");
    expect(shapeFor({ ...held, spoken: 1 }, T0)).toBe("say");
    // Said enough times and still well held: it can go back to being written.
    expect(shapeFor({ ...held, spoken: 2 }, T0 + DAY)).not.toBe("say");
  });
});

describe("what a session reaches for", () => {
  const held = (name: string, stability: number, dueMs: number): LingoItem =>
    item({ item: name, gloss: `${name}-means`, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability, reps: 3, dueMs, lastMs: T0 } });

  it("puts the most forgotten first", () => {
    const got = plan([held("solid", 90, T0), held("shaky", 2, T0)], learner(), T0 + 5 * DAY);
    expect(got[0]!.item).toBe("shaky");
  });

  it("mixes in things never seen, without letting them crowd out revision", () => {
    const items = [...Array(40)].map((_, i) => held(`due${i}`, 5, T0)).concat([...Array(40)].map((_, i) => item({ item: `new${i}` })));
    const got = plan(items, learner({ goalMin: 10 }), T0 + 5 * DAY);
    const fresh = got.filter((e) => e.item.startsWith("new"));
    expect(got.length).toBeLessThanOrEqual(sizeFor(10));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThanOrEqual(Math.round(sizeFor(10) * 0.35));
  });

  it("offers the same question the same way on the same day", () => {
    const pool = [item({ item: "a", gloss: "ga" }), item({ item: "b", gloss: "gb" }), item({ item: "c", gloss: "gc" }), item({ item: "d", gloss: "gd" })];
    const one = exerciseFor(pool[0]!, pool, T0);
    const two = exerciseFor(pool[0]!, pool, T0 + 1000);
    expect(one.options).toEqual(two.options);
    expect(one.correct).toBe(two.correct);
  });

  it("offers the right meaning among the choices, and says which it is", () => {
    const pool = [item({ item: "a", gloss: "ga" }), item({ item: "b", gloss: "gb" }), item({ item: "c", gloss: "gc" })];
    const ex = exerciseFor(pool[0]!, pool, T0, "choose");
    expect(ex.options).toContain("ga");
    expect(ex.options[ex.correct]).toBe("ga");
  });

  it("hands the words over shuffled for putting in order, and keeps every one", () => {
    const phrase = item({ item: "one two three four", kind: "phrase", gloss: "a phrase" });
    const ex = exerciseFor(phrase, [phrase], T0, "chips");
    expect([...ex.chips].sort()).toEqual(["four", "one", "three", "two"]);
  });
});

describe("after an answer", () => {
  it("counts a time said out loud only for the kinds that are out loud", () => {
    const held = item({ memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability: 20, reps: 3, lastMs: T0 } });
    expect(answered(held, "say", { verdict: "right", matched: null, why: "" }, T0).spoken).toBe(1);
    expect(answered(held, "write", { verdict: "right", matched: null, why: "" }, T0).spoken).toBe(0);
  });
});

describe("how a course is going", () => {
  it("counts only what is there, and calls nothing learned that was never said", () => {
    const held = item({ item: "x", spoken: 2, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability: 40, reps: 4, dueMs: T0 + 40 * DAY, lastMs: T0 } });
    const quiet = item({ item: "y", spoken: 0, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability: 40, reps: 4, dueMs: T0 + 40 * DAY, lastMs: T0 } });
    const p = progress([held, quiet, item({ item: "z" })], T0 + DAY);
    expect(p.items).toBe(3);
    expect(p.learned).toBe(1);
    expect(p.unseen).toBe(1);
    expect(p.held).toBeGreaterThan(0);
  });
});

describe("the streak", () => {
  it("counts the person's own day, adds one the next day, and starts again after a gap", () => {
    expect(dayOf(Date.UTC(2026, 0, 2, 1, 0), -120)).toBe("2026-01-01");
    expect(streakAfter(learner({ streakDays: 3, lastDay: "2026-03-01" }), "2026-03-01")).toEqual({ streakDays: 3, lastDay: "2026-03-01" });
    expect(streakAfter(learner({ streakDays: 3, lastDay: "2026-03-01" }), "2026-03-02")).toEqual({ streakDays: 4, lastDay: "2026-03-02" });
    expect(streakAfter(learner({ streakDays: 9, lastDay: "2026-03-01" }), "2026-03-05")).toEqual({ streakDays: 1, lastDay: "2026-03-05" });
  });
});

describe("what is kept", () => {
  it("never resets an item somebody already has", async () => {
    const store = new MemoryLingoStore();
    await store.setCourse("u1", learner(), T0);
    expect(await store.add("u1", "xx", [{ item: "hola", kind: "word", gloss: "hello", source: "seed" }], T0)).toBe(1);

    const [kept] = await store.items("u1", "xx");
    await store.save("u1", "xx", [review(kept!, "right", true, T0)], T0);

    // The same word offered again, from a list this time: the history stays.
    expect(await store.add("u1", "xx", [{ item: "hola", kind: "word", gloss: "hi", source: "seed" }], T0 + DAY)).toBe(0);
    const [again] = await store.items("u1", "xx");
    expect(again!.memory.reps).toBe(1);
    expect(again!.spoken).toBe(1);
  });

  it("keeps each person's and each language's words apart", async () => {
    const store = new MemoryLingoStore();
    await store.setCourse("u1", learner({ target: "xx" }), T0);
    await store.setCourse("u1", learner({ target: "zz" }), T0 + 1);
    await store.setCourse("u2", learner({ target: "xx" }), T0);
    await store.add("u1", "xx", [{ item: "a", kind: "word", gloss: "", source: "seed" }], T0);
    await store.add("u1", "zz", [{ item: "b", kind: "word", gloss: "", source: "seed" }], T0);
    await store.add("u2", "xx", [{ item: "c", kind: "word", gloss: "", source: "seed" }], T0);
    expect((await store.items("u1", "xx")).map((i) => i.item)).toEqual(["a"]);
    expect((await store.items("u1", "zz")).map((i) => i.item)).toEqual(["b"]);
    expect((await store.items("u2", "xx")).map((i) => i.item)).toEqual(["c"]);
  });

  it("shows the course they opened last first", async () => {
    const store = new MemoryLingoStore();
    await store.setCourse("u1", learner({ target: "xx", usedMs: T0 }), T0);
    await store.setCourse("u1", learner({ target: "zz", usedMs: T0 + DAY }), T0);
    expect((await store.courses("u1")).map((c) => c.target)).toEqual(["zz", "xx"]);
  });

  it("forgets one language, or all of them", async () => {
    const store = new MemoryLingoStore();
    await store.setCourse("u1", learner({ target: "xx" }), T0);
    await store.setCourse("u1", learner({ target: "zz" }), T0);
    await store.add("u1", "xx", [{ item: "a", kind: "word", gloss: "", source: "seed" }], T0);
    await store.forget("u1", "xx");
    expect(await store.course("u1", "xx")).toBeNull();
    expect(await store.items("u1", "xx")).toEqual([]);
    expect(await store.course("u1", "zz")).not.toBeNull();
    await store.forget("u1");
    expect(await store.courses("u1")).toEqual([]);
  });
});
