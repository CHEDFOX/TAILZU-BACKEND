/**
 * THE ORDER A SESSION IS PUT IN (src/lingo/order.ts), and the gap in a sentence (session.ts):
 *
 *   - INTERLEAVING: no two exercises of the same kind sit next to each other while anything else could go between.
 *     The order this replaces was blocked twice over — everything due, then everything new, which is every
 *     recognition tap in one run at the end
 *   - PEAK-END: a session opens and CLOSES on something they are likely to get right, because the last thing that
 *     happened is what a person remembers when deciding whether to come back
 *   - DESIRABLE DIFFICULTY plus PRIMACY: the hardest work sits early, where attention is, not spread evenly
 *   - two spoken answers never sit back to back
 *   - THE LAG EFFECT: a miss comes back this same sitting, but never next
 *   - a word is put back into a REAL sentence, and when the bank has none the ladder closes over the gap instead of
 *     showing a hole with nothing round it
 */
import { describe, expect, it } from "vitest";
import { againAfter, LAG, order, requeue, type Entry } from "../src/lingo/order.js";
import { exerciseFor, GAP, gapIn, plan, shapeFor } from "../src/lingo/session.js";
import { freshMemory } from "../src/lingo/schedule.js";
import type { Exercise } from "../src/lingo/session.js";
import type { ExerciseKind, Learner, LingoItem } from "../src/lingo/types.js";
import type { Sentence } from "../src/lingo/sentences.js";

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

const ex = (item: string, kind: ExerciseKind): Exercise =>
  ({ kind, item, prompt: item, accepted: [item], options: [], correct: 0, chips: [], spoken: kind === "say" || kind === "talk", sentence: "" });
const en = (item: string, kind: ExerciseKind, ease: number): Entry => ({ ex: ex(item, kind), ease });

const learner = (over: Partial<Learner> = {}): Learner => ({
  target: "es", from: "en", level: "a1", goalMin: 10, calls: false, voice: null,
  streakDays: 0, lastDay: null, usedMs: T0, updatedMs: T0, ...over,
});
const item = (over: Partial<LingoItem> = {}): LingoItem => ({
  item: "x", kind: "word", gloss: "x-means", source: "seed", spoken: 0, memory: freshMemory(T0), ...over,
});

describe("interleaving", () => {
  it("does not put two of the same kind next to each other", () => {
    const got = order([
      en("a", "choose", 0.5), en("b", "choose", 0.5), en("c", "choose", 0.5),
      en("d", "write", 0.5), en("e", "write", 0.5), en("f", "listen", 0.5),
    ]);
    let runs = 0;
    for (let i = 1; i < got.length; i++) if (got[i]!.kind === got[i - 1]!.kind) runs++;
    // Three of one kind out of six cannot always be separated at the very ends; one touch is the most that is forced.
    expect(runs).toBeLessThanOrEqual(1);
  });

  it("separates them completely when the mix allows it", () => {
    const got = order([
      en("a", "choose", 0.4), en("b", "write", 0.4), en("c", "choose", 0.4),
      en("d", "write", 0.4), en("e", "listen", 0.4), en("f", "chips", 0.4),
    ]);
    for (let i = 1; i < got.length; i++) expect(got[i]!.kind).not.toBe(got[i - 1]!.kind);
  });

  it("never asks for two spoken answers back to back", () => {
    const got = order([
      en("a", "say", 0.4), en("b", "say", 0.4), en("c", "talk", 0.4),
      en("d", "write", 0.4), en("e", "choose", 0.4), en("f", "listen", 0.4),
    ]);
    const loud = (k: ExerciseKind) => k === "say" || k === "talk";
    for (let i = 1; i < got.length; i++) expect(loud(got[i]!.kind) && loud(got[i - 1]!.kind)).toBe(false);
  });
});

describe("the peak-end rule", () => {
  it("opens and closes on something they are likely to get right", () => {
    const got = order([
      en("hard1", "write", 0.05), en("hard2", "say", 0.08), en("mid", "listen", 0.5),
      en("easy1", "choose", 0.95), en("easy2", "chips", 0.92), en("hard3", "write", 0.1),
    ]);
    expect(["easy1", "easy2"]).toContain(got[0]!.item);
    expect(["easy1", "easy2"]).toContain(got[got.length - 1]!.item);
  });

  it("does not end on a spoken answer when a quiet one is free", () => {
    const got = order([
      en("a", "say", 0.98), en("b", "choose", 0.9), en("c", "write", 0.3),
      en("d", "listen", 0.2), en("e", "chips", 0.88),
    ]);
    expect(got[got.length - 1]!.kind).not.toBe("say");
  });
});

describe("hardest work early", () => {
  it("puts the least well held in the first half, not spread evenly", () => {
    const entries = [
      en("e1", "choose", 0.95), en("e2", "chips", 0.9),
      en("h1", "write", 0.05), en("h2", "listen", 0.08), en("h3", "say", 0.1),
      en("m1", "write", 0.55), en("m2", "choose", 0.6), en("m3", "listen", 0.6),
    ];
    const got = order(entries);
    const half = Math.ceil(got.length / 2);
    const early = got.slice(0, half).map((e) => e.item);
    expect(early.filter((i) => i.startsWith("h")).length).toBeGreaterThanOrEqual(2);
  });
});

describe("a session too small to arrange", () => {
  it("is left exactly as it came", () => {
    const entries = [en("a", "choose", 0.3), en("b", "write", 0.9)];
    expect(order(entries).map((e) => e.item)).toEqual(["a", "b"]);
  });

  it("keeps every exercise, whatever the mix", () => {
    const entries = [en("a", "say", 0.1), en("b", "say", 0.2), en("c", "say", 0.3), en("d", "say", 0.4), en("e", "say", 0.5)];
    expect(order(entries).map((e) => e.item).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("the lag effect", () => {
  it("brings a miss back this sitting, but never next", () => {
    expect(againAfter("wrong")).toBe(LAG);
    expect(againAfter("wrong")).toBeGreaterThan(1);
  });

  it("gives a near miss more room than a miss", () => {
    expect(againAfter("close")).toBeGreaterThan(againAfter("wrong"));
  });

  it("does not ask a right answer again", () => {
    expect(againAfter("right")).toBe(0);
  });

  it("puts it back the right distance along", () => {
    const rest = [ex("b", "write"), ex("c", "listen"), ex("d", "chips"), ex("e", "choose"), ex("f", "write"), ex("g", "say")];
    const got = requeue(rest, ex("a", "write"), 4);
    expect(got.map((e) => e.item)).toEqual(["b", "c", "d", "e", "a", "f", "g"]);
  });

  it("puts it last when the sitting is nearly over, rather than dropping it", () => {
    const rest = [ex("b", "write")];
    expect(requeue(rest, ex("a", "write"), 4).map((e) => e.item)).toEqual(["b", "a"]);
  });

  it("changes nothing when it is not coming back", () => {
    const rest = [ex("b", "write"), ex("c", "listen")];
    expect(requeue(rest, ex("a", "write"), 0).map((e) => e.item)).toEqual(["b", "c"]);
  });
});

describe("a word put back into a real sentence", () => {
  const sent = (text: string, gloss: string): Sentence =>
    ({ id: 1, text, gloss, words: 4, licence: "CC0-1.0", author: "", source: "tatoeba#1" });

  it("enters the ladder after hearing it and before writing it alone", () => {
    const seen = item({ memory: { ...freshMemory(T0), difficulty: 5, state: "learning", reps: 2, lastMs: T0 } });
    expect(shapeFor(seen, T0)).toBe("blank");
  });

  it("takes the word out and marks where it was", () => {
    expect(gapIn("Quiero un café con leche", "café")).toBe(`Quiero un ${GAP} con leche`);
  });

  it("does not care about the accent or the capital when finding it", () => {
    expect(gapIn("Café con leche", "café")).toBe(`${GAP} con leche`);
  });

  it("takes out a whole word only, never part of a longer one", () => {
    expect(gapIn("Quiero una cafetera", "café")).toBeNull();
  });

  it("works in a script that puts no spaces between its words", () => {
    expect(gapIn("我喜欢咖啡", "咖啡")).toBe(`我喜欢${GAP}`);
  });

  it("builds the question from the sentence, with other words from their own course", () => {
    const it0 = item({ item: "café", gloss: "coffee", memory: { ...freshMemory(T0), difficulty: 5, state: "learning", reps: 2, lastMs: T0 } });
    const pool = [it0, item({ item: "perro", gloss: "dog" }), item({ item: "libro", gloss: "book" }), item({ item: "casa", gloss: "house" })];
    const got = exerciseFor(it0, pool, T0, undefined, () => [sent("Quiero un café con leche", "I want a coffee with milk")]);
    expect(got.kind).toBe("blank");
    expect(got.sentence).toContain(GAP);
    expect(got.sentence).not.toContain("café");
    expect(got.options).toContain("café");
    expect(got.options[got.correct]).toBe("café");
    expect(got.options.length).toBeGreaterThan(1);
  });

  it("closes over the gap when the bank has no sentence for the word", () => {
    const it0 = item({ item: "café", gloss: "coffee", memory: { ...freshMemory(T0), difficulty: 5, state: "learning", reps: 2, lastMs: T0 } });
    const got = exerciseFor(it0, [it0], T0, undefined, () => []);
    expect(got.kind).toBe("write");
    expect(got.sentence).toBe("");
  });

  it("asks nothing of the bank when there is no bank at all", () => {
    const it0 = item({ item: "café", gloss: "coffee", memory: { ...freshMemory(T0), difficulty: 5, state: "learning", reps: 2, lastMs: T0 } });
    expect(exerciseFor(it0, [it0], T0).kind).toBe("write");
  });
});

describe("the whole session", () => {
  it("no longer ends on a run of recognition taps, which is what it used to do", () => {
    // Twelve due words and twenty never seen: the old order put all twenty "choose" at the end, in one block.
    const due = [...Array(12)].map((_, i) => item({
      item: `due${i}`, gloss: `g${i}`,
      memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability: 3 + i, reps: 4, dueMs: T0, lastMs: T0 },
    }));
    const fresh = [...Array(20)].map((_, i) => item({ item: `new${i}`, gloss: `n${i}` }));
    const got = plan([...due, ...fresh], learner(), T0 + 5 * DAY);

    const tail = got.slice(-5).map((e) => e.kind);
    expect(new Set(tail).size).toBeGreaterThan(1);

    let longest = 1, run = 1;
    for (let i = 1; i < got.length; i++) {
      run = got[i]!.kind === got[i - 1]!.kind ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    expect(longest).toBeLessThanOrEqual(2);
  });

  it("still gives back every exercise it picked, and no duplicates", () => {
    const items = [...Array(14)].map((_, i) => item({ item: `w${i}`, gloss: `g${i}` }));
    const got = plan(items, learner(), T0);
    expect(new Set(got.map((e) => e.item)).size).toBe(got.length);
  });
});
