import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { cleanPresent } from "../src/routes/media.js";

describe("nothing is not zero", () => {
  // This was `Number(v)` and a finite check, which accepted every value
  // JavaScript will turn into 0. Sending null to clear a field set it to the
  // field's MINIMUM instead — and answered 200 with a body that looked right.
  // Found by clearing boxHeight and getting 40, which put a 9:16 film in a
  // forty-point-tall box.

  it("ignores the values that used to become a floor", () => {
    for (const v of [null, undefined, "", "   ", false, true, [], {}]) {
      expect(cleanPresent({ boxHeight: v })).toBeNull();
      expect(cleanPresent({ boxWidth: v })).toBeNull();
      expect(cleanPresent({ scale: v })).toBeNull();
    }
  });

  it("still takes a real number, and still clamps it", () => {
    expect(cleanPresent({ boxHeight: 660 })).toEqual({ boxHeight: 660 });
    // Below the floor clamps UP, which is right for a number someone meant.
    expect(cleanPresent({ boxHeight: 5 })).toEqual({ boxHeight: 40 });
    expect(cleanPresent({ boxHeight: 99999 })).toEqual({ boxHeight: 4000 });
  });

  it("still takes a numeric string, since a form field sends one", () => {
    expect(cleanPresent({ boxWidth: "353.5" })).toEqual({ boxWidth: 353.5 });
  });

  it("takes zero when zero is a real answer", () => {
    // The bug was never about rejecting 0 — it was about inventing it.
    expect(cleanPresent({ inset: 0 })).toEqual({ inset: 0 });
  });

  it("keeps the good fields when one beside them is junk", () => {
    // A typo in one value must not quietly discard the rest of the call.
    expect(cleanPresent({ boxWidth: 353.5, boxHeight: null })).toEqual({ boxWidth: 353.5 });
  });
});
