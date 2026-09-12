/**
 * Multi-hypothesis fusion: when two recognizers hear the same audio and
 * disagree, the writing step reconciles them instead of one being discarded.
 *
 * Two engines fail in DIFFERENT places — on "kal ka plan WhatsApp pe bhej
 * dena" the Indic model tends to win the Hindi and the generalist tends to win
 * the brand name — so each usually holds part of the truth. Picking one can
 * never have both.
 *
 * The load-bearing constraint is the no-invention rule: given two readings, a
 * model will otherwise average them into a fluent third sentence nobody said,
 * which is worse than picking one outright.
 */
import { describe, expect, it } from "vitest";
import { buildAssistSystem } from "../src/pipeline/assistPrompt.js";
import { transcriptsAgree, isUsableAlternative } from "../src/pipeline/stt.js";

describe("transcriptsAgree — only real disagreement is worth a second opinion", () => {
  it("treats casing and punctuation differences as agreement", () => {
    // The providers differ constantly here and it means nothing.
    expect(transcriptsAgree("Kal ka plan cancel karna padega.", "kal ka plan cancel karna padega")).toBe(true);
    expect(transcriptsAgree("hey,  how are   you?", "Hey how are you")).toBe(true);
  });

  it("flags a genuine word difference", () => {
    // Exactly the case fusion exists for: same audio, different brand name.
    expect(
      transcriptsAgree("kal ka plan WhatsApp pe bhej dena", "kal ka plan whats up pe bhej dena"),
    ).toBe(false);
  });

  it("flags a script difference as disagreement", () => {
    expect(transcriptsAgree("kaise ho", "कैसे हो")).toBe(false);
  });
});

describe("isUsableAlternative — a failed call is not a second opinion", () => {
  it("accepts a comparable-length reading", () => {
    expect(
      isUsableAlternative("kal ka plan WhatsApp pe bhej dena", "kal ka plan whats up pe bhej dena"),
    ).toBe(true);
  });

  it("rejects a truncated fragment", () => {
    // A provider that died mid-call must not be fused in as an equal candidate.
    expect(isUsableAlternative("kal ka plan WhatsApp pe bhej dena kal shaam tak", "kal")).toBe(false);
  });

  it("rejects an empty reading", () => {
    expect(isUsableAlternative("something real", "")).toBe(false);
    expect(isUsableAlternative("", "something real")).toBe(false);
  });
});

describe("assist prompt — reconciliation block", () => {
  const withAlt = () => buildAssistSystem({ hasContext: false, hasAlternative: true });

  it("is ABSENT when the recognizers agreed (the common case stays untouched)", () => {
    const s = buildAssistSystem({ hasContext: false });
    expect(s).not.toContain("candidates");
    expect(s).not.toContain("Candidate 1");
  });

  it("appears when a second reading is present", () => {
    expect(withAlt()).toMatch(/two recognizers heard this and disagreed/i);
    expect(withAlt()).toContain("two candidates");
  });

  it("forbids inventing words absent from both candidates", () => {
    // The load-bearing half. Given two readings a model will happily average
    // them into a fluent third sentence nobody said, which is worse than
    // simply picking one.
    expect(withAlt()).toMatch(/invent nothing that is in neither/i);
  });

  it("allows taking the better reading where they differ — the point of fusing", () => {
    expect(withAlt()).toMatch(/keep what they agree on/i);
    expect(withAlt()).toMatch(/take the plausible reading where they differ/i);
  });

  it("breaks ties toward the primary recognizer", () => {
    expect(withAlt()).toMatch(/Candidate 1 is the more reliable one/i);
  });

  it("settles what was said BEFORE the writing task, not after", () => {
    // Reconciliation is a pre-step. Placed after the writing contract it reads
    // as an afterthought about output rather than a decision about input.
    const s = withAlt();
    expect(s.indexOf("two candidates")).toBeLessThan(s.indexOf("Part of what they say"));
  });

  it("never leaks the mechanism into the user's text", () => {
    expect(withAlt()).toMatch(/Never mention that there were two/i);
  });

  it("still carries the writing contract alongside reconciliation", () => {
    // Fusion is a pre-step, not a replacement — the separation principle and
    // the observed script must survive it.
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true, script: "latin" });
    expect(s).toMatch(/When you cannot tell which it is, it is what they want said/i);
    expect(s).toContain("Theirs was latin.");
  });
});
