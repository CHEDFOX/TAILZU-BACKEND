import { describe, expect, it } from "vitest";
import {
  PORTRAIT_DIMENSIONS,
  PORTRAIT_BOUNDS,
  portraitJsonContract,
  portraitProvenance,
} from "../src/pipeline/portraitDimensions.js";
import {
  usageSystem, portraitSystem, transcriptSystem,
} from "../src/pipeline/cleanup.js";

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

describe("the writer is told what it is revising", () => {
  // Without this, every rewrite treats the existing portrait as an equal: a
  // first impression from one afternoon and a habit confirmed across fifty
  // sittings arrive looking identical, so one odd session can overturn months.
  const seasoned = (sessions: number, days: number) => ({
    sessions,
    examples: 6,
    firstSeenAt: new Date(Date.now() - days * 86_400_000).toISOString(),
  });

  it("says outright when it has never seen this person", () => {
    const p = portraitProvenance(undefined);
    expect(p).toMatch(/FIRST thing you have ever seen/i);
    // The first portrait is the one most likely to invent a habit, and that
    // invention is then read back on every message until something contradicts
    // it. Say so where the model can act on it.
    expect(p).toMatch(/read back on every message they send/i);
  });

  it("counts the sittings and the span they cover", () => {
    const p = portraitProvenance(seasoned(23, 97));
    expect(p).toContain("23 sittings");
    expect(p).toMatch(/over about 3 months/);
    expect(p).toMatch(/6 rounds where they picked between versions/);
  });

  it("scales the wording to the age of the evidence", () => {
    expect(portraitProvenance(seasoned(2, 0))).toContain("today");
    expect(portraitProvenance(seasoned(2, 3))).toContain("over 3 days");
    expect(portraitProvenance(seasoned(2, 20))).toMatch(/over about 3 weeks/);
  });

  it("tells a young portrait to bend and an old one to hold", () => {
    // Under five sittings the text is one or two afternoons of evidence.
    expect(portraitProvenance(seasoned(2, 1))).toMatch(/still a sketch/i);
    expect(portraitProvenance(seasoned(2, 1))).toMatch(/Revise it freely/i);
    // Past that it has survived repetition, and most of the evidence behind it
    // is no longer in front of the model.
    const old = portraitProvenance(seasoned(40, 180));
    expect(old).toMatch(/Treat what is already written as established/i);
    expect(old).toMatch(/contradicts it repeatedly/i);
    expect(old).toMatch(/most of it is no longer in front of you/i);
  });

  it("handles the singular without reading like a machine", () => {
    const p = portraitProvenance(seasoned(1, 1));
    expect(p).toContain("1 sitting ");
    expect(p).not.toContain("1 sittings");
  });

  it("survives a portrait with no first-seen date", () => {
    // Rows written before the field existed. It must degrade to "today"
    // rather than producing a date in 1970.
    const p = portraitProvenance({ sessions: 9, examples: 0 });
    expect(p).toContain("9 sittings");
    expect(p).toContain("today");
  });

  it("reaches all three writers, not just the one it was written for", () => {
    const sp = seasoned(23, 97);
    for (const [name, text] of [
      ["ordinary use", usageSystem(sp)],
      ["picking", portraitSystem("Signature", sp)],
      ["spoken", transcriptSystem(sp)],
    ] as const) {
      expect(text, `${name} writer lost the provenance`).toContain("23 sittings");
      expect(text, `${name} writer lost the dimensions`).toContain("REGISTER");
      expect(text, `${name} writer lost the bounds`).toContain("Never judge them");
    }
  });
});
