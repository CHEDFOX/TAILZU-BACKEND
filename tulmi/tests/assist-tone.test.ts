import { describe, expect, it } from "vitest";
import {
  toneGuidance,
  buildAssistSystem,
  MAX_TONE_PROMPT,
} from "../src/pipeline/assistPrompt.js";
import type { Personality } from "../../shared/types/api.js";

describe("toneGuidance — inline tone prompt", () => {
  it("uses the inline prompt verbatim as the voice (built-in / custom, no registry)", () => {
    const g = toneGuidance("my-pirate", undefined, "Talk like a pirate; say arr.");
    expect(g).toContain("Talk like a pirate; say arr.");
    // The built-in "formal"/"none" guidance must NOT bleed in.
    expect(g).not.toContain("Formal and professional");
    expect(g).not.toContain("keep the user's own words");
  });

  it("falls back to the built-in tone guidance when no inline prompt is sent", () => {
    const g = toneGuidance("formal", undefined, undefined);
    expect(g).toContain("Formal and professional");
  });

  it("treats a blank inline prompt as absent (falls back to built-in)", () => {
    const g = toneGuidance("formal", undefined, "   ");
    expect(g).toContain("Formal and professional");
  });

  it("caps an overlong inline prompt at MAX_TONE_PROMPT", () => {
    const huge = "x".repeat(MAX_TONE_PROMPT + 500);
    const g = toneGuidance(undefined, undefined, huge);
    // Only the capped slice of x's should appear.
    expect(g).toContain("x".repeat(MAX_TONE_PROMPT));
    expect(g).not.toContain("x".repeat(MAX_TONE_PROMPT + 1));
  });

  it("still layers the user's global customInstructions + signature onto an inline voice", () => {
    const personality: Personality = {
      customInstructions: "Avoid exclamation marks.",
      signature: "— Alex",
    };
    const g = toneGuidance("custom", personality, "Be breezy and short.");
    expect(g).toContain("Be breezy and short.");
    expect(g).toContain("Avoid exclamation marks.");
    expect(g).toContain("— Alex");
  });

  it("buildAssistSystem threads tonePrompt into the TONE section", () => {
    const sys = buildAssistSystem({
      tone: "whatever",
      tonePrompt: "Sound like a formal butler.",
      hasContext: false,
    });
    expect(sys).toContain("TONE: Sound like a formal butler.");
  });
});

describe("what the refiner is told it is", () => {
  const sys = () => buildAssistSystem({ hasContext: false });

  it("names the product and the surface, so the model knows what it is inside", () => {
    expect(sys()).toContain("Tailzu");
    expect(sys().toLowerCase()).toContain("keyboard");
  });

  it("says the user is talking THROUGH it, not to it", () => {
    // The single line that decides most hard cases: an angry message dictated
    // at a third party must be written, not answered.
    expect(sys()).toMatch(/talking THROUGH you/);
  });

  it("allows the small writing that belongs inside a message", () => {
    const t = sys();
    expect(t).toMatch(/poem/i);
    expect(t).toMatch(/in their voice/i);
  });

  it("rules out the work that stops being a message", () => {
    const t = sys();
    for (const kind of ["essays", "code", "homework", "research"]) {
      expect(t).toContain(kind);
    }
  });

  it("refuses by writing something shorter, never by explaining itself", () => {
    // A keyboard that answers "I can't help with that" has typed a sentence
    // the user must now delete.
    expect(sys()).toMatch(/no refusal, no apology/i);
  });
});
