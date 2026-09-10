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

describe("a selected tone goes through the SAME prompt", () => {
  // There used to be two definitions of every tone: TONE_GUIDANCE here, and a
  // hand-tuned system prompt per tone in tonePrompts.ts reached through
  // refineWithTone(). Nothing called the second one — POST /v1/refine/<tone>
  // has run through assist() for a while — so the app carried a parallel
  // "formal" that no request ever saw and that had already drifted. It is
  // deleted; these tests pin the path that actually runs.
  const tones = ["formal", "casual", "very-casual", "excited"] as const;

  for (const tone of tones) {
    it(`"${tone}" still carries the separation principle and the script rule`, () => {
      // A tone is a voice, not a different contract. Picking one must not cost
      // the user instruction separation — that regressed once already, when the
      // tone endpoints had no separation layer at all and "make it shorter"
      // spoken into a tone got politely rewritten instead of executed.
      const p = buildAssistSystem({ tone, hasContext: false });
      expect(p).toMatch(/Part of what they say may be addressed to you/i);
      expect(p).toMatch(/When you cannot tell which it is, it is what they want said/i);
      expect(p).toMatch(/their language and their script, exactly as they used them/i);
      expect(p).toMatch(/Everything you return is what they send/i);
    });
  }

  it("puts each tone's own voice on the TONE line", () => {
    expect(buildAssistSystem({ tone: "formal", hasContext: false }))
      .toMatch(/TONE: Formal\. Professional register/);
    expect(buildAssistSystem({ tone: "very-casual", hasContext: false }))
      .toMatch(/TONE: Group-chat energy/);
  });

  it("keeps the tone LAST, so the voice sits next to the material it shapes", () => {
    const p = buildAssistSystem({ tone: "casual", hasContext: true, targetApp: "WhatsApp" });
    expect(p.indexOf("TONE:")).toBeGreaterThan(p.indexOf("Everything you return"));
    expect(p.indexOf("TONE:")).toBeGreaterThan(p.indexOf("decides the SHAPE"));
  });

  it("layers the learned portrait under the tone, never over it", () => {
    const p = buildAssistSystem({
      tone: "casual",
      hasContext: false,
      personality: { activeTone: "casual", stylePortrait: { core: "PORTRAIT_MARKER" } } as never,
    });
    expect(p.indexOf("TONE:")).toBeLessThan(p.indexOf("PORTRAIT_MARKER"));
  });

  it("keeps every tone short enough to read as a voice, not a spec", () => {
    // Each of these was six to eight bullets. A tone is described, not
    // specified — the bullets were an attempt to pin down by enumeration
    // something the model already knows how to hear.
    for (const tone of tones) {
      const voice = buildAssistSystem({ tone, hasContext: false }).split("TONE:")[1] ?? "";
      expect(voice.trim().length, tone).toBeLessThan(320);
    }
  });

  it("gives the DEFAULT voice the same brevity as a chosen one", () => {
    // ZU was a hundred words of "don't" — don't make it friendlier, more
    // formal, more upbeat, more polished. The default is the tone most people
    // never change, so it was the longest thing in the prompt by far.
    const zu = buildAssistSystem({ hasContext: false }).split("TONE:")[1] ?? "";
    expect(zu.trim().length).toBeLessThan(320);
    expect(zu).toMatch(/Their own voice, not a style/);
  });
});
