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
