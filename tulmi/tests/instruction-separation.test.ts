/**
 * The assistant contract, as principles.
 *
 * Someone talks to their keyboard and it writes for them. Two things have to
 * survive on EVERY writing path: it must tell what is addressed to it apart
 * from what is meant for someone else, in whatever language that arrives, and
 * it must keep the user's script so romanized Hinglish does not come back in
 * Devanagari.
 *
 * These used to be pinned by asserting on a five-bullet procedure and four
 * worked examples. Both paths now state one sentence each instead, and these
 * tests assert THAT — not the phrasing of a list that no longer exists. The
 * per-tone endpoints regressed here once with no separation layer at all, so
 * a spoken command was politely rewritten instead of executed.
 */
import { describe, expect, it } from "vitest";
import { buildAssistSystem } from "../src/pipeline/assistPrompt.js";
import { buildTonePrompt } from "../src/pipeline/tonePrompts.js";

describe("assist path — instruction separation", () => {
  const system = buildAssistSystem({ hasContext: false });

  it("states what is addressed to it and what is not, in one sentence", () => {
    expect(system).toMatch(/Part of what they say may be addressed to you/i);
    expect(system).toMatch(/Do that part; write the rest/i);
  });

  it("decides the ambiguous case by default, rather than by example", () => {
    // "write"/"tell"/"send" inside what someone is saying to a third party.
    // Four examples taught this; one default settles it, and settles the
    // cases the examples never reached.
    expect(system).toMatch(/When you cannot tell which it is, it is what they want said/i);
  });

  it("never echoes the direction back into the message", () => {
    expect(system).toMatch(/Do that part; write the rest/i);
    expect(system).toMatch(/a question they dictate is a question they are sending/i);
  });

  it("pins script fidelity so romanized speech stays romanized", () => {
    expect(system).toMatch(/their language and their script, exactly as they used them/i);
    const latin = buildAssistSystem({ hasContext: false, script: "latin" });
    expect(latin).toContain("Theirs was latin.");
  });

  it("carries no language-specific instruction at all", () => {
    // The old prompt listed Hindi, Marathi, Hinglish and Tamil by name and
    // showed Devanagari examples — which reads as a prompt for those
    // languages. "Their language, exactly as they used it" covers every
    // language there is, including the ones nobody listed.
    for (const named of ["Marathi", "Hinglish", "Devanagari", "Tamil"]) {
      expect(system, `should not name ${named}`).not.toContain(named);
    }
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
      expect(p).toMatch(/Part of the input may be addressed to you/i);
      expect(p).toMatch(/never echo it back/i);
      expect(p).toMatch(/When you cannot tell which it is, it is what they want said/i);
      expect(p).toMatch(/Keep their language and their script exactly as they used them/i);
    });
  }

  it("puts the shared contract first and the tone's own voice next to its work", () => {
    const p = buildTonePrompt("formal");
    expect(p.indexOf("Everything you return")).toBeLessThan(p.indexOf("TONE: Formal."));
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

  it("keeps every tone short enough to be read as a voice, not a spec", () => {
    // Each of these was six to eight bullets. A tone is described, not
    // specified — the bullets were an attempt to pin down by enumeration
    // something the model already knows how to hear.
    for (const tone of tones) {
      const voice = buildTonePrompt(tone).split("TONE:")[1] ?? "";
      expect(voice.trim().length, tone).toBeLessThan(320);
    }
  });
});
