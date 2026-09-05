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
  it("is ABSENT when the recognizers agreed (the common case stays untouched)", () => {
    const s = buildAssistSystem({ hasContext: false });
    expect(s).not.toContain("SETTLE WHAT WAS SAID");
    expect(s).not.toContain("CANDIDATE 1");
  });

  it("appears when a second reading is present", () => {
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true });
    expect(s).toContain("FIRST, SETTLE WHAT WAS SAID");
    expect(s).toContain("two different speech recognizers");
  });

  it("forbids inventing words absent from both candidates", () => {
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true });
    expect(s).toContain("NEVER introduce a word that appears in NEITHER candidate");
    expect(s).toContain("Do not smooth them into a new sentence");
  });

  it("allows taking part of each — the whole point of fusing", () => {
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true });
    expect(s).toContain("part of one candidate and part of the other");
  });

  it("breaks ties toward the primary recognizer", () => {
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true });
    expect(s).toContain("CANDIDATE 1 is the more reliable recognizer");
  });

  it("keeps reconciliation BEFORE the writing task — settle, then write", () => {
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true });
    expect(s.indexOf("SETTLE WHAT WAS SAID")).toBeLessThan(
      s.indexOf("SEPARATE message from instruction"),
    );
  });

  it("never leaks the mechanism into the user's text", () => {
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true });
    expect(s).toContain("Never mention the candidates");
  });

  it("still carries the writing contract alongside reconciliation", () => {
    // Fusion is a pre-step, not a replacement — instruction separation and
    // script fidelity must survive it.
    const s = buildAssistSystem({ hasContext: false, hasAlternative: true, script: "latin" });
    expect(s).toContain("SEPARATE message from instruction");
    expect(s).toContain("captured in LATIN script");
  });
});
