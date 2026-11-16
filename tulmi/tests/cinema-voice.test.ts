/**
 * THE VOICE-OVER HEARD BACK (src/cinema/voiceCheck.ts):
 *
 *   - a number read as another number always fails, however close the rest is; a number dropped fails too
 *   - the numbers are read as values, so "99", "ninety nine", "ninyanve" and "निन्यानवे" are the same number
 *   - a Hinglish line heard back in Devanagari is not failed for it: the letters are not compared, the numbers and the length are
 *   - Hinglish spelling that wanders by a vowel still passes; a line cut short does not
 */
import { describe, expect, it } from "vitest";
import { compareSaid, likeness, numbersIn, scriptOf, tokens } from "../src/cinema/voiceCheck.js";

describe("the numbers in a line", () => {
  it("reads digits and words as the same values", () => {
    expect(numbersIn("99 rupees")).toEqual([99]);
    expect(numbersIn("ninety nine rupees")).toEqual([99]);
    expect(numbersIn("सिर्फ़ ९९ रुपये")).toEqual([99]);
    expect(numbersIn("twenty two")).toEqual([22]);
    expect(numbersIn("दो कप चाय")).toEqual([2]);
  });

  it("reads the scales, English and Hindi", () => {
    expect(numbersIn("five hundred")).toEqual([500]);
    expect(numbersIn("paanch sau")).toEqual([500]);
    expect(numbersIn("पांच सौ")).toEqual([500]);
    expect(numbersIn("two lakh")).toEqual([200_000]);
    expect(numbersIn("ek crore")).toEqual([10_000_000]);
  });

  it("keeps separate numbers apart", () => {
    expect(numbersIn("open 9 to 5")).toEqual([9, 5]);
    expect(numbersIn("twenty twenty six")).toEqual([20, 26]);
  });

  it("never fails on a number word that is an ordinary word too", () => {
    // "do" and "no" are the Hindi two and nine; failing an English line for them would be worse than missing one.
    expect(numbersIn("do you want chai")).toEqual([]);
    expect(numbersIn("no, not today")).toEqual([]);
    // Said beyond doubt, they count again.
    expect(numbersIn("do sau rupees")).toEqual([200]);
    expect(numbersIn("2 cup chai")).toEqual([2]);
  });

  it("still reads them as numbers when the two readings are compared", () => {
    expect(compareSaid("do cup chai", "2 cup chai").ok).toBe(true);
    expect(compareSaid("no, not today", "no not today").ok).toBe(true);
  });
});

describe("the script a line is in", () => {
  it("is read from the letters, not declared", () => {
    expect(scriptOf("Har baarish ki ek kahani")).toBe("latin");
    expect(scriptOf("हर बारिश की एक कहानी")).toBe("devanagari");
    expect(scriptOf("每场雨都有故事")).toBe("cjk");
  });

  it("drops punctuation and case from the words", () => {
    expect(tokens("Lo, garam chai!")).toEqual(["lo", "garam", "chai"]);
  });
});

describe("what was meant against what was heard", () => {
  it("passes a clean reading", () => {
    const v = compareSaid("Har baarish ki ek kahani hoti hai", "Har baarish ki ek kahani hoti hai");
    expect(v.ok).toBe(true);
    expect(v.likeness).toBe(1);
  });

  it("fails a number read as another number, however close the rest is", () => {
    const v = compareSaid("Sirf ninety nine rupees mein", "Sirf nineteen rupees mein");
    expect(v.ok).toBe(false);
    expect(v.fault).toBe("number");
    expect(v.why).toBe('"99" was read as "19".');
  });

  it("fails a number that was not said at all", () => {
    const v = compareSaid("Open from 9 in the morning", "Open in the morning");
    expect(v.ok).toBe(false);
    expect(v.fault).toBe("missing");
    expect(v.why).toBe('"9" was not said.');
  });

  it("passes a number written one way and heard the other", () => {
    expect(compareSaid("Sirf 99 rupees", "Sirf ninety nine rupees").ok).toBe(true);
    expect(compareSaid("do cup chai", "2 cup chai").ok).toBe(true);
  });

  it("does not fail a Hinglish line heard back in Devanagari", () => {
    const v = compareSaid("Har baarish ki ek kahani hoti hai", "हर बारिश की एक कहानी होती है");
    expect(v.ok).toBe(true);
    expect(v.crossScript).toBe(true);
  });

  it("still catches a wrong number across scripts", () => {
    const v = compareSaid("Sirf 99 rupees mein", "सिर्फ़ 19 रुपये में");
    expect(v.ok).toBe(false);
    expect(v.fault).toBe("number");
  });

  it("forgives Hinglish spelling that wanders by a vowel", () => {
    expect(compareSaid("Har baarish ki ek kahaani hoti hai", "Har barish ki ek kahani hoti hai").ok).toBe(true);
  });

  it("fails a reading that stops before the line does", () => {
    const v = compareSaid("Har baarish ki ek kahani hoti hai, aur har kahani mein ek chai", "Har baarish ki ek");
    expect(v.ok).toBe(false);
    expect(v.fault).toBe("short");
  });

  it("fails a silent recording", () => {
    const v = compareSaid("Lo, garam chai", "   ");
    expect(v.ok).toBe(false);
    expect(v.fault).toBe("empty");
  });

  it("takes the spelling the recogniser really uses for a name", () => {
    const plain = compareSaid("Welcome to Xooteq", "Welcome to Zooteck");
    expect(plain.ok).toBe(false);
    const told = compareSaid("Welcome to Xooteq", "Welcome to Zooteck", { heardAs: "Welcome to Zooteck" });
    expect(told.ok).toBe(true);
  });

  it("measures likeness word by word, not letter by letter", () => {
    expect(likeness(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(likeness(["a", "b", "c"], ["a", "c"])).toBeCloseTo(0.8, 2);
  });
});
