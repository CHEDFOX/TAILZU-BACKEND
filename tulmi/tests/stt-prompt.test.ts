import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { isUsableAlternative, sttPrompt } from "../src/pipeline/stt.js";

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
