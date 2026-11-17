/**
 * WHAT FILLS A UNIT FOR A PAIR, AND WALKING THE PATH (src/lingo/lessons.ts, course.ts).
 *
 *   - a unit is written once for a pair and kept: the second learner on it waits for nothing
 *   - a unit that could not be written is NOT kept, because a thin one kept now is taught for ever
 *   - a unit is done when most of it is held AND said, not when its items have been shown
 *   - one stubborn word does not hold somebody at unit 3 for a fortnight
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { MemoryLessonBank, ENOUGH, briefFor, tidyDraft, unitFor } = await import("../src/lingo/lessons.js");
const { UNITS, unitDone, after, placeOf } = await import("../src/lingo/course.js");

const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const FOOD = UNITS.find((u) => u.key === "food")!;

/** A model door that answers with whatever it is told to, and counts how often it was opened. */
function stubModel(reply: unknown, ok = true) {
  const calls: string[] = [];
  const call = async (input: { messages: Array<{ content: unknown }> }) => {
    calls.push(String(input.messages[input.messages.length - 1]?.content ?? ""));
    return ok ? { json: reply, paise: 1, model: "stub" } : { paise: 0, model: "stub" };
  };
  return { call: call as never, calls };
}

const draft = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ text: `frase ${i}`, meaning: `phrase ${i}`, kind: "phrase" as const })) });

describe("writing a unit for a pair", () => {
  it("is written once and then kept, so the next person on the pair waits for nothing", async () => {
    const bank = new MemoryLessonBank();
    const m = stubModel(draft(10));
    const ctx = { userId: "u1", budget: { maxPaise: 500 } as never, call: m.call };

    const first = await unitFor(bank, ctx, "es", "ta", "food");
    expect(first?.length).toBe(10);
    expect(m.calls.length).toBe(1);

    // Somebody else, same pair, same unit: nothing is written and nothing is asked for.
    const second = await unitFor(bank, ctx, "es", "ta", "food");
    expect(second?.length).toBe(10);
    expect(m.calls.length, "the model is not asked twice for the same unit of the same pair").toBe(1);
  });

  it("tells the model the pair and the goal, and nothing about any person", async () => {
    const brief = briefFor(FOOD, "es", "ta");
    expect(brief).toContain("es");
    expect(brief).toContain("ta");
    expect(brief).toContain(FOOD.goal);
    expect(brief).toContain(FOOD.about);
    expect(brief).not.toMatch(/user|person|learner|name/i);
  });

  it("keeps nothing when the model could not do it, rather than a thin unit taught for ever", async () => {
    const bank = new MemoryLessonBank();
    const down = stubModel(null, false);
    expect(await unitFor(bank, { userId: "u1", budget: {} as never, call: down.call }, "es", "ta", "food")).toBeNull();
    expect(await bank.get("es", "ta", "food")).toBeNull();

    // And a unit that came back nearly empty is refused the same way.
    const thin = stubModel(draft(ENOUGH - 1));
    expect(await unitFor(bank, { userId: "u1", budget: {} as never, call: thin.call }, "es", "ta", "food")).toBeNull();
    expect(await bank.get("es", "ta", "food")).toBeNull();
  });

  it("throws away half an item and a repeat, and never exceeds what the unit asked for", () => {
    const out = tidyDraft({ items: [
      { text: "hola", meaning: "hello", kind: "word" },
      { text: " hola ", meaning: "hi again", kind: "word" },
      { text: "", meaning: "nothing", kind: "word" },
      { text: "adiós", meaning: "   ", kind: "word" },
      { text: "gracias", meaning: "thanks", kind: "word" },
    ] }, 10);
    expect(out.map((o) => o.text)).toEqual(["hola", "gracias"]);
    expect(tidyDraft(draft(40), 6).length).toBe(6);
  });
});

describe("when a unit is done", () => {
  const held = (p: number) => () => p;
  const made = (n: number, spoken: number, unit = "food") => Array.from({ length: n }, () => ({ unit, spoken }));

  it("needs most of it held AND said, not merely shown", () => {
    // Every item shown and held, none ever said: the goal is something you can SAY, so it is not done.
    expect(unitDone(made(10, 0), "food", held(1))).toBe(false);
    expect(unitDone(made(10, 1), "food", held(1))).toBe(true);
    // Said, but gone cold.
    expect(unitDone(made(10, 1), "food", held(0.2))).toBe(false);
  });

  it("does not hold somebody there for one stubborn word", () => {
    const mostly = [...made(8, 1), ...made(2, 0)];
    expect(unitDone(mostly, "food", held(1))).toBe(true);
  });

  it("is never done before it has started", () => {
    expect(unitDone([], "food", held(1))).toBe(false);
    expect(unitDone(made(10, 1, "hello"), "food", held(1))).toBe(false);
  });

  it("runs out at the end of the path rather than off it", () => {
    expect(after(UNITS[UNITS.length - 1]!.key)).toBeNull();
    expect(after("hello")?.key).toBe(UNITS[1]!.key);
    expect(placeOf("hello")).toEqual({ at: 1, of: UNITS.length });
  });
});
