/**
 * The assistant contract: the user is the master, the app is the assistant.
 *
 * Every writing path must (a) recognize an INSTRUCTION addressed to the app
 * and separate it from the CONTENT to write, in whatever language the
 * instruction arrives, and (b) preserve the user's SCRIPT so romanized
 * Hinglish doesn't come back in Devanagari.
 *
 * These are prompt-contract tests — they assert the rules actually reach each
 * path's system prompt. Both paths regressed here before: the per-tone
 * endpoints carried no separation layer at all, so a spoken command was
 * politely rewritten instead of executed.
 */
import { describe, expect, it } from "vitest";
import { buildAssistSystem, SEPARATION_EXAMPLES } from "../src/pipeline/assistPrompt.js";
import { buildTonePrompt } from "../src/pipeline/tonePrompts.js";

describe("assist path — instruction separation", () => {
  const system = buildAssistSystem({ hasContext: false });

  it("ships the worked examples, including the Marathi command case", () => {
    expect(system).toContain(SEPARATION_EXAMPLES);
    expect(system).toContain("write in marathi");
    // The example must teach the OUTPUT, not just restate the rule.
    expect(SEPARATION_EXAMPLES).toContain("कसा आहेस");
  });

  it("teaches that an instruction may arrive in a non-English language", () => {
    expect(system).toContain("may itself be spoken in ANY language");
    expect(SEPARATION_EXAMPLES).toContain("isko formal bana do");
  });

  it("teaches the negative case — 'write' inside the message is content", () => {
    expect(system).toContain("are content, not commands");
    expect(SEPARATION_EXAMPLES).toContain("I would write the report tonight");
  });

  it("pins script fidelity so romanized speech stays romanized", () => {
    expect(system).toContain("SCRIPT:");
    expect(system).toContain("do not convert them to Devanagari");
  });
});

describe("per-tone path — instruction separation parity", () => {
  // The tone endpoints are the ones that had NO separation layer. Every tone
  // must carry it, or "make it shorter" spoken into that tone gets rewritten
  // as part of the message.
  const tones = ["formal", "casual", "very-casual", "excited"] as const;

  for (const tone of tones) {
    it(`"${tone}" separates instruction from message and keeps the script`, () => {
      const p = buildTonePrompt(tone);
      expect(p).toContain("separate MESSAGE from INSTRUCTION");
      expect(p).toContain("NEVER echo the direction back");
      expect(p).toContain("SCRIPT: keep the user's script");
    });
  }

  it("keeps the tone's own voice first — the separation layer never leads", () => {
    const p = buildTonePrompt("formal");
    expect(p.indexOf("TONE: Formal.")).toBeLessThan(p.indexOf("separate MESSAGE from INSTRUCTION"));
  });

  it("layers the learned style portrait after the tone, before the mechanics", () => {
    const p = buildTonePrompt("casual", {
      portrait: "PORTRAIT_MARKER",
      vocabulary: "Tailzu",
      language: "hi",
    });
    expect(p.indexOf("TONE: Casual.")).toBeLessThan(p.indexOf("PORTRAIT_MARKER"));
    expect(p.indexOf("PORTRAIT_MARKER")).toBeLessThan(p.indexOf("Preserve these spellings"));
    expect(p).toContain("Output language:");
  });
});
