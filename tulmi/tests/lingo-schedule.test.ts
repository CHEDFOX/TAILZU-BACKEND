/**
 * WHEN TO ASK SOMETHING AGAIN (src/lingo/schedule.ts):
 *
 *   - a new item is due at once, and is not counted among the due
 *   - how a mark is read: wrong starts it over, `close` brings it back sooner without starting over, and right OUT
 *     LOUD pushes it furthest out, because saying it unprompted is the strongest evidence it is theirs
 *   - the learning step is carried between sessions: without it a learner walks round the same step for ever, which
 *     is the one bug that would make the whole thing quietly useless
 *   - an item is not "learned" on the scheduler's word alone: it must have been said right, out loud, twice
 *   - a session takes the most forgotten first, and reaches for the words the person went looking for themselves
 *     before anything off a frequency list
 */
import { describe, expect, it } from "vitest";
import { due, freshMemory, learned, ratingFor, recall, review, SPOKEN_TO_LEARN, unseen } from "../src/lingo/schedule.js";
import type { ItemSource, LingoItem } from "../src/lingo/types.js";

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

const item = (over: Partial<LingoItem> = {}): LingoItem => ({
  item: "gracias", kind: "word", gloss: "thank you", source: "seed", spoken: 0, memory: freshMemory(T0), ...over,
});

describe("a new item", () => {
  it("is due at once and has been asked nothing", () => {
    const m = freshMemory(T0);
    expect(m.state).toBe("new");
    expect(m.dueMs).toBe(T0);
    expect(m.reps).toBe(0);
    expect(m.lastMs).toBeNull();
  });

  it("is not among the due: it has never been asked", () => {
    expect(due([item()], T0)).toEqual([]);
    expect(unseen([item()])).toHaveLength(1);
  });
});

describe("how a mark is read", () => {
  it("sends wrong back to the start, close in between, and right out loud furthest away", () => {
    expect(ratingFor("wrong", false)).toBeLessThan(ratingFor("close", false));
    expect(ratingFor("close", false)).toBeLessThan(ratingFor("right", false));
    expect(ratingFor("right", false)).toBeLessThan(ratingFor("right", true));
  });

  it("pushes a word said right further out than the same word tapped right", () => {
    const tapped = review(item(), "right", false, T0);
    const spoken = review(item(), "right", true, T0);
    expect(spoken.memory.dueMs).toBeGreaterThan(tapped.memory.dueMs);
    expect(spoken.memory.stability).toBeGreaterThan(tapped.memory.stability);
  });

  it("brings a close answer back sooner than a right one, without starting it over", () => {
    const close = review(item(), "close", false, T0);
    const right = review(item(), "right", false, T0);
    expect(close.memory.dueMs).toBeLessThan(right.memory.dueMs);
    expect(close.memory.lapses).toBe(0);
  });

  it("counts a wrong answer as a lapse once the item was being held", () => {
    let it0 = review(item(), "right", true, T0);          // out to review
    const before = it0.memory.lapses;
    it0 = review(it0, "wrong", false, it0.memory.dueMs);
    expect(it0.memory.lapses).toBe(before + 1);
    expect(it0.memory.state).toBe("relearning");
  });

  it("only counts a time said out loud when it was actually right", () => {
    expect(review(item(), "right", true, T0).spoken).toBe(1);
    expect(review(item(), "close", true, T0).spoken).toBe(0);
    expect(review(item(), "wrong", true, T0).spoken).toBe(0);
    expect(review(item(), "right", false, T0).spoken).toBe(0);
  });
});

describe("the learning step is carried between sessions", () => {
  it("moves on to the next step instead of walking round the same one", () => {
    const first = review(item(), "right", false, T0);
    expect(first.memory.state).toBe("learning");
    expect(first.memory.steps).toBeGreaterThan(0);

    const second = review(first, "right", false, first.memory.dueMs);
    expect(second.memory.state).toBe("review");
    expect(second.memory.dueMs - second.memory.lastMs!).toBeGreaterThan(DAY);
  });

  it("walks round the same step for ever when the step is lost, which is what this guards", () => {
    const first = review(item(), "right", false, T0);
    const lost = { ...first, memory: { ...first.memory, steps: 0 } };
    const second = review(lost, "right", false, first.memory.dueMs);
    expect(second.memory.state).toBe("learning");
    expect(second.memory.dueMs - second.memory.lastMs!).toBeLessThan(DAY);
  });
});

describe("whether an item is theirs", () => {
  it("is not learned on the scheduler's word alone: it has to have been said", () => {
    const held: LingoItem = item({ spoken: 0, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability: 30, reps: 5, lastMs: T0 } });
    expect(learned(held)).toBe(false);
    expect(learned({ ...held, spoken: SPOKEN_TO_LEARN })).toBe(true);
  });

  it("is not learned while it is still being held only briefly", () => {
    const shaky: LingoItem = item({ spoken: 9, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability: 2, reps: 3, lastMs: T0 } });
    expect(learned(shaky)).toBe(false);
  });
});

describe("what a session reaches for", () => {
  const held = (name: string, stability: number, dueMs: number): LingoItem =>
    item({ item: name, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability, reps: 3, dueMs, lastMs: T0 } });

  it("takes what is due, the most forgotten first", () => {
    const solid = held("solid", 60, T0 + DAY);
    const shaky = held("shaky", 2, T0 + DAY);
    const order = due([solid, shaky], T0 + 5 * DAY).map((i) => i.item);
    expect(order[0]).toBe("shaky");
    expect(order).toHaveLength(2);
  });

  it("leaves alone what is not due yet", () => {
    expect(due([held("later", 10, T0 + 30 * DAY)], T0 + DAY)).toEqual([]);
  });

  it("takes only as many as asked for", () => {
    const many = [held("a", 1, T0), held("b", 2, T0), held("c", 3, T0)];
    expect(due(many, T0 + 10 * DAY, 2)).toHaveLength(2);
  });

  it("reaches for the words they went looking for before anything off a list", () => {
    const of = (s: ItemSource) => item({ item: s, source: s });
    const order = unseen([of("seed"), of("heard"), of("asked"), of("said")]).map((i) => i.item);
    expect(order).toEqual(["said", "asked", "heard", "seed"]);
  });
});

describe("how likely they are to still have it", () => {
  it("is nothing for an item never asked, and falls away as the days pass", () => {
    expect(recall(freshMemory(T0), T0)).toBe(0);
    const m = review(item(), "right", true, T0).memory;
    const soon = recall(m, m.lastMs! + DAY);
    const later = recall(m, m.lastMs! + 60 * DAY);
    expect(soon).toBeGreaterThan(later);
    expect(later).toBeGreaterThanOrEqual(0);
    expect(soon).toBeLessThanOrEqual(1);
  });
});
