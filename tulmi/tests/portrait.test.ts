import { describe, expect, it } from "vitest";
import {
  PORTRAIT_DIMENSIONS,
  PORTRAIT_BOUNDS,
  portraitJsonContract,
  portraitProvenance,
  parsePortraitDraft,
  mergePortraitWords,
  MAX_PORTRAIT_WORDS,
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
  // FIELDS, NOT ONE PARAGRAPH. The portrait used to be a single prose blob
  // rewritten from scratch each session, and prose forgets: a word learned in
  // March that did not come up in April was gone by May, because the rewrite
  // had no reason to carry it.
  it("asks for the parts that accumulate separately from the ones that do not", () => {
    const c = portraitJsonContract();
    expect(c).toContain('"core"');
    expect(c).toContain('"words"');
    expect(c).toContain('"styles"');
  });

  it("asks what each word MEANS to them, not what a dictionary says", () => {
    // Knowing someone says "jugaad" tells the model to preserve it. Knowing
    // what they mean by it is what lets the model use it.
    const c = portraitJsonContract();
    expect(c).toMatch(/what THEY use it to mean/);
    expect(c).toMatch(/not a dictionary definition/);
    expect(c).toMatch(/Skip anything a dictionary of their language would carry/);
  });

  it("asks for their script, so the recognizer can be biased with the words", () => {
    expect(portraitJsonContract()).toMatch(/exactly as they write it, in their script/);
  });

  it("only asks for rhythms when the clock is actually known", () => {
    // A day-part computed against the wrong timezone is worse than none, so
    // the field is not even requested unless the app has told us the offset.
    expect(portraitJsonContract()).not.toContain('"rhythms"');
    expect(portraitJsonContract({ withRhythms: true })).toContain('"rhythms"');
    // And even then, "none" is offered as the right answer for most people.
    expect(portraitJsonContract({ withRhythms: true })).toMatch(/an empty list is the honest answer/i);
  });

  it("adds the tone note only when a tone is being trained", () => {
    expect(portraitJsonContract()).not.toContain("toneNote");
    expect(portraitJsonContract({ trainingTone: "Signature" })).toContain('"toneNote"');
    expect(portraitJsonContract({ trainingTone: "Signature" })).toContain("Signature");
  });

  it("bounds every list, because the portrait rides on every request", () => {
    const c = portraitJsonContract({ withRhythms: true });
    expect(c).toMatch(/≤130 words/);
    expect(c).toMatch(/At most 12 new ones per pass/);
    expect(c).toMatch(/styles: at most 4/);
    expect(c).toMatch(/rhythms: at most 3/);
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

describe("words accumulate; everything else is a fresh read", () => {
  // The one part of the portrait that must survive a session it did not come
  // up in. Somebody's slang is learned a term at a time over months, and a
  // rewrite-from-scratch forgets every word that happened not to appear in the
  // last forty messages.
  it("keeps what was learned before, and adds what is new", () => {
    const before = [{ term: "yaar", means: "mate, close friend" }];
    const after = mergePortraitWords(before, [{ term: "jugaad", means: "a scrappy workaround" }]);
    expect(after.map((w) => w.term)).toEqual(["jugaad", "yaar"]);
  });

  it("updates a meaning rather than storing the word twice", () => {
    // The later reading is the better-evidenced one.
    const merged = mergePortraitWords(
      [{ term: "solid", means: "good" }],
      [{ term: "Solid", means: "agreed, will do" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].means).toBe("agreed, will do");
  });

  it("moves a word that came up again to the front", () => {
    // Being used again is what makes a word current, and the front is what
    // survives the cap.
    const merged = mergePortraitWords(
      [{ term: "a", means: "1" }, { term: "b", means: "2" }],
      [{ term: "b", means: "2" }],
    );
    expect(merged[0].term).toBe("b");
  });

  it("caps the list, keeping the newest rather than the oldest", () => {
    // Dropping the newest would mean the list stops learning the moment it
    // fills up — which is the opposite of the point.
    const old = Array.from({ length: MAX_PORTRAIT_WORDS }, (_, i) => ({
      term: `old${i}`, means: "x",
    }));
    const merged = mergePortraitWords(old, [{ term: "fresh", means: "y" }]);
    expect(merged).toHaveLength(MAX_PORTRAIT_WORDS);
    expect(merged[0].term).toBe("fresh");
    expect(merged.some((w) => w.term === `old${MAX_PORTRAIT_WORDS - 1}`)).toBe(false);
  });

  it("survives a portrait that has never had a word list", () => {
    expect(mergePortraitWords(undefined, undefined)).toEqual([]);
    expect(mergePortraitWords(undefined, [{ term: "x", means: "y" }])).toHaveLength(1);
  });
});

describe("parsePortraitDraft — a missing part is fine, an invented one is not", () => {
  it("reads every field the writers can return", () => {
    const d = parsePortraitDraft(JSON.stringify({
      core: "Short sentences.",
      words: [{ term: "yaar", means: "mate" }],
      styles: [{ name: "clipped", when: "work chats" }],
      rhythms: [{ when: "early morning", vibe: "terser, no greeting" }],
      toneNote: "keeps it clipped",
    }));
    expect(d.core).toBe("Short sentences.");
    expect(d.words).toEqual([{ term: "yaar", means: "mate" }]);
    expect(d.styles?.[0].name).toBe("clipped");
    expect(d.rhythms?.[0].vibe).toBe("terser, no greeting");
    expect(d.toneNote).toBe("keeps it clipped");
  });

  it("drops a half-written entry instead of defaulting it", () => {
    // A word with no meaning is worse than no word: it reaches the prompt as
    // "term — " and the model fills the blank itself.
    const d = parsePortraitDraft(JSON.stringify({
      words: [{ term: "yaar" }, { means: "no term" }, { term: "ok", means: "fine" }],
    }));
    expect(d.words).toEqual([{ term: "ok", means: "fine" }]);
  });

  it("returns nothing at all for a reply that is not JSON", () => {
    // Which the callers then treat as "keep what we had" rather than wiping it.
    expect(parsePortraitDraft("sorry, I can't help with that")).toEqual({});
  });

  it("ignores a field of the wrong shape", () => {
    const d = parsePortraitDraft(JSON.stringify({ core: 42, words: "yaar", styles: {} }));
    expect(d.core).toBeUndefined();
    expect(d.words).toEqual([]);
    expect(d.styles).toEqual([]);
  });
});
