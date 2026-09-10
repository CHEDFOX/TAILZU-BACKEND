import { describe, expect, it } from "vitest";
import {
  PORTRAIT_DIMENSIONS,
  PORTRAIT_BOUNDS,
  portraitJsonContract,
} from "../src/pipeline/portraitDimensions.js";

/**
 * The portrait is the product's memory of a person. It is written by three
 * different callers and read by every single refine, so the two things that
 * matter are that the three agree on what to look for, and that none of them
 * wanders from describing a voice into assessing a human being.
 */
describe("one list, read by every writer", () => {
  // There used to be three lists. The picking path looked for punctuation and
  // emoji; the spoken path did not; and both then overwrote the same field. A
  // spoken session silently dropped whatever the picking path had learned
  // about punctuation, because its prompt was never told punctuation mattered.
  const MUST_NOTICE = [
    "REGISTER", "DIRECTNESS", "DISTANCE", "ORDER", "SHAPE",
    "LEXICON", "TYPOGRAPHY", "FRAMING", "SWITCHING", "ELLIPSIS",
  ];

  it("covers the things that actually decide a sentence", () => {
    for (const d of MUST_NOTICE) {
      expect(PORTRAIT_DIMENSIONS, `missing dimension: ${d}`).toContain(d);
    }
  });

  it("asks for the lexicon QUOTED, because the recognizer eats those words", () => {
    // portraitTerms() pulls the quoted spans out of the portrait and feeds
    // them to STT as biasing. Unquoted, there is nothing to pull, and the
    // speech engine learns nothing from months of training.
    expect(PORTRAIT_DIMENSIONS).toMatch(/quoted exactly and in their own script/i);
  });

  it("asks for script per language, not just which languages", () => {
    // The difference between Devanagari and romanized Hinglish is the whole
    // ballgame for an Indic user, and it is a property of how they write each
    // language rather than of the language.
    expect(PORTRAIT_DIMENSIONS).toMatch(/which script they write each in/i);
  });
});

describe("what a portrait may never contain", () => {
  // The ask was for a portrait built with real psychology. The honest form of
  // that is pragmatics — register, distance, hedging, order — not a trait
  // diagnosis. Text does not carry a reliable trait signal, and "conscientious"
  // does not tell a writing model whether to open with a greeting.
  it("rules out trait, mood and circumstance inference by name", () => {
    for (const forbidden of [
      "personality traits", "mood", "mental state", "intelligence",
      "age", "gender", "politics", "health", "circumstances",
    ]) {
      expect(PORTRAIT_BOUNDS, `should forbid: ${forbidden}`).toContain(forbidden);
    }
  });

  it("requires every line to be checkable against the messages", () => {
    // The test of an observation is that another reader could disagree with it
    // by looking. A judgement cannot be checked, which is why it survives
    // indefinitely once written.
    expect(PORTRAIT_BOUNDS).toMatch(/another reader could check against the same messages/i);
  });

  it("forbids judging them, not just profiling them", () => {
    // A portrait that starts grading someone's grammar has stopped describing
    // a voice and started assessing one — and it is then reproduced into
    // everything they write.
    expect(PORTRAIT_BOUNDS).toMatch(/Never judge them/i);
    expect(PORTRAIT_BOUNDS).toMatch(/reproduced, not assessing/i);
  });

  it("keeps the mechanism out of the portrait's own text", () => {
    expect(PORTRAIT_BOUNDS).toMatch(/nothing about the training, the conversation/i);
  });
});

describe("the output contract", () => {
  it("is one shape, whether or not a tone is being trained", () => {
    expect(portraitJsonContract()).toContain('"core"');
    expect(portraitJsonContract()).not.toContain("toneNote");
    expect(portraitJsonContract("Signature")).toContain('"toneNote"');
    expect(portraitJsonContract("Signature")).toContain("Signature");
  });

  it("bounds the core, because it rides on every request the user makes", () => {
    // Unbounded, it grows each round and eventually crowds out the message
    // the model is supposed to be writing.
    expect(portraitJsonContract()).toMatch(/≤130 words/);
  });
});
