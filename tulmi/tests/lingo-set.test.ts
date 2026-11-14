/**
 * A SET, AND WHAT COMES AFTER IT (src/lingo/set.ts):
 *
 *   - what happened in a set: learned, slipped, said out loud
 *   - THE CELEBRATION IS SCALED, and a set that went badly gets NONE. Confetti for everything makes the
 *     celebration worthless and tells somebody who just failed half a set that they did well, which they can see is
 *     untrue. The bot is warm about a bad set and does not lie about it
 *   - the next set follows the person: flying gets more new words and more speaking, struggling gets NO new words,
 *     a shorter set and a cap on how hard anything may be asked
 *   - a cap only ever makes an exercise gentler, never harder
 *   - the words that went wrong come back first in the next set, ahead of everything else due
 *   - mastery is what they can do, not a percentage of a course: speaking counts double
 */
import { describe, expect, it } from "vitest";
import {
  gestureFor, mastery, performanceOf, readSet, SET_SIZE, shapeNext, underCap, type Answered, type Performance,
} from "../src/lingo/set.js";
import { freshMemory } from "../src/lingo/schedule.js";
import { pick } from "../src/lingo/session.js";
import type { ExerciseKind, Learner, LingoItem, Verdict } from "../src/lingo/types.js";

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

const a = (item: string, verdict: Verdict, kind: ExerciseKind = "write", learnedNow = false): Answered =>
  ({ item, kind, verdict, learnedNow });

const of = (n: number, verdict: Verdict, kind: ExerciseKind = "write"): Answered[] =>
  [...Array(n)].map((_, i) => a(`w${i}`, verdict, kind));

const learner = (over: Partial<Learner> = {}): Learner => ({
  target: "es", from: "en", level: "a1", goalMin: 10, calls: false, voice: null,
  streakDays: 0, lastDay: null, usedMs: T0, updatedMs: T0, ...over,
});
const item = (over: Partial<LingoItem> = {}): LingoItem => ({
  item: "x", kind: "word", gloss: "x-means", source: "seed", spoken: 0, memory: freshMemory(T0), ...over,
});

describe("what happened in a set", () => {
  it("counts the verdicts, and what was said out loud", () => {
    const r = readSet([a("a", "right", "say"), a("b", "right", "write"), a("c", "close"), a("d", "wrong")]);
    expect(r).toMatchObject({ asked: 4, right: 2, close: 1, wrong: 1, spoken: 1 });
  });

  it("counts only a RIGHT spoken answer as spoken", () => {
    expect(readSet([a("a", "close", "say"), a("b", "wrong", "talk")]).spoken).toBe(0);
  });

  it("names what was learned and what slipped, with no repeats", () => {
    const r = readSet([a("hola", "right", "say", true), a("hola", "right", "write"), a("agua", "wrong"), a("agua", "wrong")]);
    expect(r.learned).toEqual(["hola"]);
    expect(r.slipped).toEqual(["agua"]);
  });
});

describe("how a set went", () => {
  const perf = (ans: Answered[]): Performance => performanceOf(readSet(ans));

  it("is flying only when it was nearly all right AND some of it was spoken", () => {
    expect(perf([...of(8, "right", "say"), ...of(2, "right")])).toBe("flying");
    // All right, but nothing said out loud: good, not flying. Saying things is what flying has to mean here.
    expect(perf(of(10, "right", "write"))).not.toBe("flying");
  });

  it("is struggling when a lot went wrong", () => {
    expect(perf([...of(5, "wrong"), ...of(5, "right")])).toBe("struggling");
  });

  it("is shaky when it was mostly close rather than wrong", () => {
    expect(perf([...of(6, "close"), ...of(4, "right")])).toBe("shaky");
  });

  it("is solid for an ordinary good set", () => {
    expect(perf([...of(8, "right"), ...of(2, "close")])).toBe("solid");
  });

  it("does not fall over on an empty set", () => {
    expect(perf([])).toBe("solid");
  });
});

describe("the celebration is scaled", () => {
  it("gives a bad set NO celebration at all", () => {
    const g = gestureFor("struggling");
    expect(g.cheer).toBe(false);
    expect(g.moment).toBeNull();
    expect(g.scale).toBe(0);
    expect(g.act).toBe("settle");
  });

  it("gives a shaky set no cheer either, just a settling", () => {
    expect(gestureFor("shaky").cheer).toBe(false);
    expect(gestureFor("shaky").scale).toBeLessThan(0.3);
  });

  it("saves the big one for flying, and gives solid something smaller", () => {
    expect(gestureFor("flying")).toMatchObject({ cheer: true, moment: "celebrate", scale: 1 });
    expect(gestureFor("solid").cheer).toBe(true);
    expect(gestureFor("solid").scale).toBeLessThan(gestureFor("flying").scale);
  });

  it("never celebrates harder than it did better", () => {
    const order: Performance[] = ["struggling", "shaky", "solid", "flying"];
    const scales = order.map((p) => gestureFor(p).scale);
    expect(scales).toEqual([...scales].sort((x, y) => x - y));
  });
});

describe("the next set follows the person", () => {
  const last = readSet([a("agua", "wrong"), a("leche", "wrong")]);

  it("gives a struggling person NO new words, a shorter set, and a cap", () => {
    const s = shapeNext("struggling", last);
    expect(s.newRoom).toBe(0);
    expect(s.size).toBeLessThan(SET_SIZE);
    expect(s.rungCap).toBe("listen");
    expect(s.pushSpoken).toBe(false);
  });

  it("holds a shaky person back from producing, without stopping new words entirely", () => {
    const s = shapeNext("shaky", last);
    expect(s.rungCap).toBe("blank");
    expect(s.newRoom).toBeGreaterThan(0);
    expect(s.newRoom).toBeLessThan(shapeNext("solid", last).newRoom);
  });

  it("opens up for somebody flying: more new words, and push for speaking", () => {
    const s = shapeNext("flying", last);
    expect(s.rungCap).toBeNull();
    expect(s.pushSpoken).toBe(true);
    expect(s.newRoom).toBeGreaterThan(shapeNext("solid", last).newRoom);
  });

  it("carries what went wrong into the next set, whatever the performance", () => {
    for (const p of ["flying", "solid", "shaky", "struggling"] as Performance[]) {
      expect(shapeNext(p, last).revisit).toEqual(["agua", "leche"]);
    }
  });
});

describe("a cap only ever makes things gentler", () => {
  it("holds a hard kind down to the cap", () => {
    expect(underCap("talk", "listen")).toBe("listen");
    expect(underCap("write", "blank")).toBe("blank");
  });

  it("leaves an already-gentler kind exactly as it is", () => {
    expect(underCap("choose", "write")).toBe("choose");
    expect(underCap("listen", "say")).toBe("listen");
  });

  it("does nothing at all with no cap", () => {
    expect(underCap("talk", null)).toBe("talk");
  });
});

describe("the words that went wrong come back first", () => {
  it("puts them ahead of everything else that is due", () => {
    const held = (name: string, stability: number): LingoItem =>
      item({ item: name, gloss: `${name}!`, memory: { ...freshMemory(T0), difficulty: 5, state: "review", stability, reps: 4, dueMs: T0, lastMs: T0 } });
    const items = [held("solid", 90), held("other", 80), held("agua", 70)];
    const got = pick(items, learner(), T0 + 5 * DAY, {
      size: 3, newRoom: 0, rungCap: null, pushSpoken: false, revisit: ["agua"],
    });
    expect(got[0]!.item).toBe("agua");
  });

  it("brings in no new words when the shape says none", () => {
    const items = [...Array(6)].map((_, i) => item({ item: `new${i}` }));
    const got = pick(items, learner(), T0, { size: 6, newRoom: 0, rungCap: null, pushSpoken: false, revisit: [] });
    expect(got).toEqual([]);
  });
});

describe("mastery", () => {
  it("is nothing at the start", () => {
    expect(mastery([], T0).value).toBe(0);
    expect(mastery([item()], T0).value).toBe(0);
  });

  it("counts speaking double: two courses with the same recall differ by what was said", () => {
    const base = { ...freshMemory(T0), difficulty: 5, state: "review" as const, stability: 40, reps: 4, lastMs: T0 };
    const quiet = [item({ item: "a", spoken: 0, memory: base }), item({ item: "b", spoken: 0, memory: base })];
    const loud = [item({ item: "a", spoken: 3, memory: base }), item({ item: "b", spoken: 3, memory: base })];
    expect(mastery(loud, T0 + DAY).value).toBeGreaterThan(mastery(quiet, T0 + DAY).value);
  });

  it("reports its parts, so a page can show them without working anything out", () => {
    const base = { ...freshMemory(T0), difficulty: 5, state: "review" as const, stability: 40, reps: 4, lastMs: T0 };
    const m = mastery([item({ item: "a", spoken: 2, memory: base }), item({ item: "b" })], T0 + DAY);
    expect(m.met).toBe(1);
    expect(m.spoken).toBe(1);
    expect(m.learned).toBe(1);
    expect(m.held).toBeGreaterThan(0);
    expect(m.value).toBeLessThanOrEqual(1);
  });
});
