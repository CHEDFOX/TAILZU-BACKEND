/**
 * Tests for the EVAL SCORER itself.
 *
 * The scorer is what decides whether a prompt/model change was an improvement.
 * A scorer that silently passes everything is worse than having no evals at
 * all — you'd ship regressions with a green report. So the assertions get
 * asserted.
 *
 * (The eval SWEEP is a paid script — npm run eval. These tests are free: they
 * exercise the scoring logic against fixed strings, no LLM involved.)
 */
import { describe, expect, it } from "vitest";
import { scoreOutput } from "../evals/run.js";
import { CASES } from "../evals/cases.js";
import type { EvalCase } from "../evals/cases.js";

const base: EvalCase = { id: "t", intent: "t", input: "t" };

describe("scoreOutput", () => {
  it("passes a clean output with no assertions", () => {
    expect(scoreOutput(base, "anything")).toEqual([]);
  });

  it("fails an empty output when text was expected", () => {
    expect(scoreOutput(base, "   ")).toContain("output was empty");
  });

  it("enforces mustBeNonEmpty:false — noise must produce nothing", () => {
    const c = { ...base, mustBeNonEmpty: false };
    expect(scoreOutput(c, "")).toEqual([]);
    expect(scoreOutput(c, "I didn't catch that")).toHaveLength(1);
  });

  it("checks mustContain case-insensitively", () => {
    const c = { ...base, mustContain: ["WhatsApp"] };
    expect(scoreOutput(c, "send it on whatsapp")).toEqual([]);
    expect(scoreOutput(c, "send it on telegram")).toHaveLength(1);
  });

  it("catches leaked instruction text", () => {
    const c = { ...base, mustNotContain: ["write in marathi"] };
    expect(scoreOutput(c, "कसा आहेस?")).toEqual([]);
    expect(scoreOutput(c, "Write in Marathi: कसा आहेस?")).toHaveLength(1);
  });

  it("preserves facts VERBATIM — a reformatted number is still broken", () => {
    const c = { ...base, mustPreserve: ["9876543210"] };
    expect(scoreOutput(c, "call me on 9876543210")).toEqual([]);
    // "Helpfully" reformatted — must fail, this is the unforgivable one.
    expect(scoreOutput(c, "call me on 98765 43210")).toHaveLength(1);
  });

  it("enforces script fidelity in both directions", () => {
    const latin = { ...base, mustBeScript: "latin" as const };
    expect(scoreOutput(latin, "kal ka plan cancel karna padega")).toEqual([]);
    expect(scoreOutput(latin, "कल का प्लान कैंसिल करना पड़ेगा")).toHaveLength(1);

    const deva = { ...base, mustBeScript: "devanagari" as const };
    expect(scoreOutput(deva, "कसा आहेस?")).toEqual([]);
    expect(scoreOutput(deva, "kasa ahes?")).toHaveLength(1);
  });

  it("enforces maxChars", () => {
    const c = { ...base, maxChars: 10 };
    expect(scoreOutput(c, "short")).toEqual([]);
    expect(scoreOutput(c, "a".repeat(50))).toHaveLength(1);
  });

  it("reports EVERY problem at once, not just the first", () => {
    // A one-problem-at-a-time scorer turns fixing a prompt into whack-a-mole.
    const c = { ...base, mustContain: ["alpha"], mustNotContain: ["beta"], maxChars: 5 };
    expect(scoreOutput(c, "beta gamma delta")).toHaveLength(3);
  });
});

describe("the case set itself", () => {
  it("has unique ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every case a real input and a stated intent", () => {
    // The intent is printed on failure — a case nobody can interpret is a
    // case that gets deleted the first time it goes red.
    for (const c of CASES) {
      expect(c.input.length, `${c.id} has no input`).toBeGreaterThan(0);
      expect(c.intent.length, `${c.id} has no intent`).toBeGreaterThan(20);
    }
  });

  it("gives every case at least one assertion", () => {
    for (const c of CASES) {
      const asserts =
        (c.mustContain?.length ?? 0) +
        (c.mustNotContain?.length ?? 0) +
        (c.mustPreserve?.length ?? 0) +
        (c.mustBeScript ? 1 : 0) +
        (c.maxChars ? 1 : 0) +
        (c.mustBeNonEmpty === false ? 1 : 0);
      expect(asserts, `${c.id} asserts nothing — it can never fail`).toBeGreaterThan(0);
    }
  });

  it("covers the behaviors that have regressed before", () => {
    const ids = CASES.map((c) => c.id).join(" ");
    for (const area of ["instr/", "script/", "fusion/", "facts/", "silence/", "tone/"]) {
      expect(ids, `no case covers ${area}`).toContain(area);
    }
  });
});

/**
 * The growth assertion, which is the one that catches "it added things".
 *
 * Worth testing harder than the others. Every assertion above asks about the
 * CONTENT of the output, and the padding fault leaves content alone: nothing
 * is missing, nothing forbidden leaked, the script is right, and the message
 * is simply longer than what was said. A scorer bug here would pass that
 * silently, which is worse than not measuring it.
 */
describe("maxGrowth", () => {
  const c = (over: Partial<EvalCase> = {}): EvalCase => ({
    id: "t", intent: "t", input: "reaching in ten", maxGrowth: 1.6, ...over,
  });

  it("passes a repair that keeps the length", () => {
    expect(scoreOutput(c(), "Reaching in ten.")).toEqual([]);
    // Punctuation and a fixed word are repair, not addition.
    expect(scoreOutput(c(), "I'm reaching in ten.")).toEqual([]);
  });

  it("fails a terse line that grew a greeting and a sign-off", () => {
    const problems = scoreOutput(c(), "Hi there, just letting you know I will be reaching in ten minutes. Thanks!");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("grew");
    // The message names the real numbers, because "too long" without them
    // cannot be acted on.
    expect(problems[0]).toMatch(/3 → \d+ words/);
  });

  it("is proportional, not a fixed ceiling", () => {
    // The same 2x growth has to fail at both lengths, or the assertion only
    // protects short inputs — and a short note doubling is the same fault.
    const short = c({ input: "on my way", maxGrowth: 1.5 });
    const long = c({
      input: "the deploy went out this morning and the numbers look fine so far",
      maxGrowth: 1.5,
    });
    expect(scoreOutput(short, "I am on my way to you now")).not.toEqual([]);
    expect(scoreOutput(long,
      "The deploy went out this morning and the numbers look fine so far. " +
      "I will keep watching them through the afternoon and will let you know " +
      "immediately if anything at all changes for the worse.")).not.toEqual([]);
  });

  it("says nothing when the case does not ask", () => {
    // Most cases are about content. Growth must not become an assertion
    // everything is silently held to.
    expect(scoreOutput(c({ maxGrowth: undefined }), "a considerably longer rewrite of that line")).toEqual([]);
  });

  it("does not divide by an empty input", () => {
    expect(scoreOutput(c({ input: "   " }), "something")).toEqual([]);
  });
});
