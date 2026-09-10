import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { isUsableAlternative, sttPrompt, portraitTerms } from "../src/pipeline/stt.js";

describe("sttPrompt", () => {
  it("sends nothing for auto with no vocabulary — no prose tips the decoder", () => {
    expect(sttPrompt(undefined, "auto")).toBeUndefined();
    expect(sttPrompt(undefined, undefined)).toBeUndefined();
  });

  it("leads with a native-script exemplar for an Indic hint, never English prose", () => {
    const p = sttPrompt(undefined, "hi")!;
    expect(/[\u0900-\u097F]/.test(p)).toBe(true);
    expect(/[A-Za-z]/.test(p)).toBe(false);
  });

  it("keeps Hinglish in Latin script", () => {
    const p = sttPrompt(undefined, "hinglish")!;
    expect(/[\u0900-\u097F]/.test(p)).toBe(false);
    expect(/[A-Za-z]/.test(p)).toBe(true);
  });

  it("appends the user's terms after the exemplar", () => {
    const p = sttPrompt("Tailzu\nRohan", "hi")!;
    expect(p.endsWith("Tailzu, Rohan")).toBe(true);
  });

  it("with auto, the terms stand alone", () => {
    expect(sttPrompt("Tailzu", "auto")).toBe("Tailzu");
  });
});

describe("sttPrompt with a set of daily languages", () => {
  it("primes every selected script, not just one", () => {
    const p = sttPrompt(undefined, "auto", ["hi", "en"])!;
    expect(/[\u0900-\u097F]/.test(p)).toBe(true);   // Devanagari
    expect(/[A-Za-z]/.test(p)).toBe(true);          // Latin
  });

  it("prefers the user's set over the single hint", () => {
    const p = sttPrompt(undefined, "en", ["ta"])!;
    expect(/[\u0B80-\u0BFF]/.test(p)).toBe(true);   // Tamil
  });

  it("caps at three so the prompt stays a run-up, not a passage", () => {
    const p = sttPrompt(undefined, "auto", ["hi", "ta", "bn", "gu", "ml"])!;
    expect(/[\u0A80-\u0AFF]/.test(p)).toBe(false);  // Gujarati, 4th, dropped
    expect(/[\u0D00-\u0D7F]/.test(p)).toBe(false);  // Malayalam, 5th, dropped
  });

  it("ignores auto and unknown codes inside the set", () => {
    expect(sttPrompt(undefined, "auto", ["auto", "klingon"])).toBeUndefined();
  });

  it("still appends the user's terms", () => {
    expect(sttPrompt("Tailzu", "auto", ["hi"])!.endsWith("Tailzu")).toBe(true);
  });
});

describe("isUsableAlternative", () => {
  it("rejects a reading in a different script — a translation, not a second opinion", () => {
    expect(isUsableAlternative("कल सुबह मिलते हैं", "let us meet tomorrow morning")).toBe(false);
  });

  it("keeps a same-script disagreement", () => {
    expect(isUsableAlternative("kal ka plan whatsapp pe bhej", "kal ka plan whatsapp pe bhejo")).toBe(true);
  });

  it("still rejects a fragment", () => {
    expect(isUsableAlternative("a long enough primary reading here", "no")).toBe(false);
  });
});

describe("portraitTerms — the recognizer gets their words, never the prose", () => {
  // The portrait is the only record of how this user talks, so it is worth
  // giving the recognizer. But NOT as prose: Whisper reads its prompt as the
  // transcript that came just before and continues it. Hand it "Short
  // sentences. Says 'yaar'." and you have told the decoder the speaker was
  // describing someone — useless, and echoable into the transcript.
  //
  // The quoted spans are the right shape. The portrait model is asked for
  // observable habits, so it quotes the words they actually use.
  const CORE = "Short sentences. Lowercase openers. Says 'yaar' and \"anyway\". Rarely uses commas.";

  it("takes the quoted words and nothing around them", () => {
    expect(portraitTerms(CORE)).toBe("yaar, anyway");
  });

  it("never leaks a word of the description itself", () => {
    const t = portraitTerms(CORE) ?? "";
    for (const prose of ["Short", "sentences", "Lowercase", "Says", "commas"]) {
      expect(t, `prose leaked: ${prose}`).not.toContain(prose);
    }
  });

  it("reads curly quotes as well as straight ones", () => {
    // Which quote style the portrait model picks is not something to depend on.
    expect(portraitTerms("Says ‘bhai’ and “lowkey” a lot.")).toBe("bhai, lowkey");
  });

  it("keeps the user's own script", () => {
    expect(portraitTerms("Opens with 'नमस्ते' most mornings.")).toBe("नमस्ते");
  });

  it("drops duplicates regardless of case", () => {
    expect(portraitTerms("Says 'Yaar'. Always 'yaar'. Sometimes 'yaar' twice.")).toBe("Yaar");
  });

  it("caps at eight, because a prompt stops biasing and starts competing", () => {
    const many = Array.from({ length: 20 }, (_, i) => `'w${i}'`).join(" ");
    expect((portraitTerms(many) ?? "").split(", ")).toHaveLength(8);
  });

  it("returns nothing for an empty or unquoted portrait", () => {
    expect(portraitTerms(undefined)).toBeUndefined();
    expect(portraitTerms("   ")).toBeUndefined();
    expect(portraitTerms("Writes in short, plain sentences with no flourish.")).toBeUndefined();
  });

  it("rides the STT prompt after the user's own dictionary", () => {
    // The dictionary is what they TOLD us to spell right; the portrait terms
    // are what they were observed to say. Told beats observed.
    const p = sttPrompt("Tailzu\nRahul", "hi", ["hi"], CORE) ?? "";
    expect(p).toContain("Tailzu, Rahul");
    expect(p.indexOf("Tailzu")).toBeLessThan(p.indexOf("yaar"));
    // And the exemplar still leads, because it is what sets the script.
    expect(p.indexOf("हाँ")).toBeLessThan(p.indexOf("Tailzu"));
  });
})
