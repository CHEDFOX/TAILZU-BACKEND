import { describe, expect, it } from "vitest";
import { normalise, editDistance, score } from "../src/pipeline/wer.js";

/**
 * The bench (scripts/stt-bench.ts) is what decides which speech engine ships,
 * so the arithmetic underneath it has to be right before anyone reads a number
 * off it. These run without audio, keys or spend — which is the point: the
 * bench costs money, this does not, and this is where a silent error would
 * live.
 */
describe("normalise", () => {
  it("strips the things the writing step fixes anyway", () => {
    // An engine must not be marked down for punctuation and case: refine
    // repairs both on every single request, so scoring them measures nothing
    // about the recognizer.
    expect(normalise("Hey, Rahul!  How ARE you?")).toBe("hey rahul how are you");
  });

  it("strips Indic and Arabic punctuation too, not just English", () => {
    // The bench exists for Indian languages. A strip set that only knows
    // full stops leaves a danda attached to the last word of every Hindi
    // sentence and fails that word against a clean reference.
    expect(normalise("मैं ठीक हूँ। तुम कैसे हो॥")).toBe("मैं ठीक हूँ तुम कैसे हो");
    expect(normalise("كيف حالك؟")).toBe("كيف حالك");
  });

  it("leaves a clean sentence alone", () => {
    expect(normalise("aaj main late aaunga")).toBe("aaj main late aaunga");
  });
});

describe("editDistance", () => {
  it("is zero for identical sequences and length for empty ones", () => {
    expect(editDistance(["a", "b"], ["a", "b"])).toBe(0);
    expect(editDistance([], ["a", "b", "c"])).toBe(3);
    expect(editDistance(["a", "b"], [])).toBe(2);
  });

  it("counts one edit each for a substitution, an insertion and a deletion", () => {
    expect(editDistance(["a", "b", "c"], ["a", "x", "c"])).toBe(1);
    expect(editDistance(["a", "c"], ["a", "b", "c"])).toBe(1);
    expect(editDistance(["a", "b", "c"], ["a", "c"])).toBe(1);
  });
});

describe("score", () => {
  it("gives a perfect transcript zero error", () => {
    const s = score("aaj main thoda late aaunga", "Aaj main thoda late aaunga.");
    expect(s.wer).toBe(0);
    expect(s.cer).toBe(0);
  });

  it("charges one word in five for one wrong word", () => {
    const s = score("aaj main thoda late aaunga", "aaj main thoda late aayunga");
    expect(s.wer).toBeCloseTo(0.2, 5);
    // One letter inside a 22-character sentence is a far smaller character
    // error than a word error, which is the whole reason both are reported.
    expect(s.cer).toBeLessThan(s.wer);
  });

  it("scores a mostly-right Devanagari sentence fairly by CER, harshly by WER", () => {
    // The case that justifies CER. Indic scripts pack a clause into few
    // space-separated tokens, so a couple of wrong characters can fail most of
    // the "words" — reporting WER alone would make the Indic specialist look
    // catastrophic on exactly the audio it handles best.
    const ref = "मैं आज थोड़ा देर से आऊंगा";
    const hyp = "मैं आज थोडा देर से आउंगा";
    const s = score(ref, hyp);
    expect(s.cer).toBeLessThan(0.2);
    expect(s.wer).toBeGreaterThan(s.cer);
  });

  it("calls a transliterated transcript a total loss, because it is one", () => {
    // Sarvam in the wrong mode returns Latin for Devanagari speech, and the
    // user sees a sentence they cannot send. No character survives, so both
    // rates must be 1 — a scorer that shrugged at this would hide the exact
    // misconfiguration the bench is meant to catch.
    // At or above 1, not exactly 1: the Latin transcript is also LONGER in
    // characters than the Devanagari one, and an error rate is edits over
    // reference length, so a wrong-and-longer answer legitimately exceeds 100%.
    const s = score("मैं ठीक हूँ", "main theek hoon");
    expect(s.wer).toBeGreaterThanOrEqual(1);
    expect(s.cer).toBeGreaterThanOrEqual(1);
  });

  it("treats silence against speech, and speech against silence, as total", () => {
    expect(score("kuch bhi", "").wer).toBe(1);
    expect(score("", "kuch bhi").wer).toBe(1);
    expect(score("", "").wer).toBe(0);
  });

  it("goes ABOVE 1 when an engine hallucinates a paragraph over a short clip", () => {
    // Not a bug, and worth pinning so nobody "fixes" it by clamping. An error
    // rate is edits over REFERENCE length, so inventing twenty words over a
    // three-word clip is more than a 100% failure and should read that way.
    // Clamping to 1 would make a hallucinating engine indistinguishable from
    // one that simply got every word wrong.
    const s = score("haan theek hai", "haan theek hai " + "aur phir ".repeat(20));
    expect(s.wer).toBeGreaterThan(1);
  });
});
