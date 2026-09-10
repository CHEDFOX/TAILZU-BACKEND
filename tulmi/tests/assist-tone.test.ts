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
    expect(g).not.toContain("Formal. Professional register");
    expect(g).not.toMatch(/Their own voice, not a style/);
  });

  it("falls back to the built-in tone guidance when no inline prompt is sent", () => {
    const g = toneGuidance("formal", undefined, undefined);
    expect(g).toContain("Formal. Professional register");
  });

  it("treats a blank inline prompt as absent (falls back to built-in)", () => {
    const g = toneGuidance("formal", undefined, "   ");
    expect(g).toContain("Formal. Professional register");
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

  it("frames it as their assistant — they talk to it, it writes for them", () => {
    // The old framing insisted the user was not talking TO the model but
    // THROUGH it, which is a distinction to hold rather than something to act
    // on. They are talking to their keyboard; it writes for them.
    expect(sys()).toMatch(/writing assistant/i);
    expect(sys()).toMatch(/tells you what they want to say/i);
    expect(sys()).toMatch(/in their voice/i);
  });

  it("carries the one principle that replaced the whole scope list", () => {
    // "Everything you return is what they send" does the work of the old
    // no-preamble, no-essay, no-explanation and no-refusal rules at once —
    // and covers the cases none of them named.
    expect(sys()).toMatch(/Everything you return is what they send/i);
    expect(sys()).toMatch(/Nothing else has anywhere to go/i);
  });

  it("settles the ambiguous case by principle rather than by example", () => {
    // Four worked examples used to teach this. One sentence decides every
    // case they covered, including the ones they did not.
    expect(sys()).toMatch(/When you cannot tell which it is, it is what they want said/i);
    expect(sys()).toMatch(/a question they dictate is a question they are sending/i);
  });

  it("stays SHORT, because a prompt that keeps growing keeps being ignored", () => {
    // The guard on this whole rewrite. v3 of this prompt reached ~4,000
    // characters of enumerated rules; each addition dimmed the lines above it.
    // If this assertion starts failing, the fix is to find which principle
    // failed to cover the new case — not to raise the number.
    const t = buildAssistSystem({ hasContext: true, targetApp: "WhatsApp", script: "latin" });
    expect(t.length).toBeLessThan(2000);
    expect(t.split("\n").filter((l) => l.trim()).length).toBeLessThan(20);
  });

  it("names no worked examples at all", () => {
    // They were the largest block in the prompt and taught four cases by
    // demonstration. The separation principle replaced them.
    const t = sys();
    expect(t).not.toContain("EXAMPLES");
    expect(t).not.toContain("→");
  });
});

describe("the tone block keeps its parts apart", () => {
  // Found by rendering the real prompt instead of reading the code. The parts
  // come from five different places — the tone, the preset's style, the user's
  // own instruction, their sign-off, their portrait — and joining on a space
  // ran them together:
  //
  //   "...typed it carefully themselves. Write in a clean, natural voice —
  //   ...clear without being clinical. never use exclamation marks If a
  //   sign-off fits the message, you may use: — R THIS USER'S STYLE PORTRAIT"
  //
  // A lowercase user instruction wedged mid-sentence and a sign-off welded to
  // the portrait's heading. Each is a separate rule and has to look like one.
  const PERSON = {
    activeTone: "none",
    customInstructions: "never use exclamation marks",
    signature: "— R",
    stylePortrait: { core: "Short sentences. Lowercase openers." },
  } as never;

  it("puts a blank line between every part", () => {
    const g = toneGuidance("none", PERSON);
    expect(g).toContain("\n\nnever use exclamation marks\n\n");
    expect(g).toMatch(/\n\nIf a sign-off fits the message/);
    expect(g).toMatch(/\n\nHOW THEY WRITE/);
  });

  it("never runs the user's instruction into the sentence before it", () => {
    const g = toneGuidance("none", PERSON);
    expect(g).not.toContain("themselves. never use");
    expect(g).not.toMatch(/exclamation marks If a sign-off/);
    expect(g).not.toMatch(/— R THIS USER'S/);
  });

  it("emits no stray blank lines when the user has set nothing", () => {
    const g = toneGuidance("none", {} as never);
    expect(g.startsWith("\n")).toBe(false);
    expect(g.endsWith("\n")).toBe(false);
    expect(g).not.toContain("\n\n\n");
  });
});
