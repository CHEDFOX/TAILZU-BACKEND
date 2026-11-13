/**
 * MARKING AN ANSWER (src/lingo/grade.ts):
 *
 *   - case, punctuation and stray spaces are not mistakes; any of the accepted answers is right
 *   - the marks over letters missing is `close`/accent, not wrong: they knew the word
 *   - one slipped letter in a long enough answer is `close`/spelling, but a SHORT word one letter away is a different
 *     word ("gato"/"pato") and is marked wrong, because forgiving it would teach the wrong one
 *   - the right words in the wrong order say so
 *   - speech is marked more kindly than typing: speech-to-text drops accents and mishears small words, and spelling
 *     is not what is being tested out loud
 *   - an empty answer is `silence`, not a wrong word
 *   - nothing here returns a sentence: only a reason code the screens word themselves
 */
import { describe, expect, it } from "vitest";
import { distance, fold, gradeChips, gradeChoice, gradeSpoken, gradeText, slipBudget, tidy } from "../src/lingo/grade.js";

describe("tidying an answer", () => {
  it("sets aside case, punctuation and stray spaces, and keeps the marks over letters", () => {
    expect(tidy("  ¿Cómo estás?  ")).toBe("cómo estás");
    expect(tidy("El perro, grande!")).toBe("el perro grande");
  });

  it("folds the marks off when asked, and only then", () => {
    expect(fold("¿Cómo estás?")).toBe("como estas");
    expect(tidy("café")).not.toBe(fold("café"));
    expect(fold("café")).toBe("cafe");
    // A letter of its own, not a mark over one, so folding leaves it alone.
    expect(fold("Grüße")).toBe("gruße");
  });
});

describe("how far apart two answers are", () => {
  it("counts single-letter changes and gives up past the cap", () => {
    expect(distance("gato", "gato", 2)).toBe(0);
    expect(distance("gato", "pato", 2)).toBe(1);
    expect(distance("hola", "adios", 2)).toBeGreaterThan(2);
  });

  it("counts two swapped neighbours as one slip, not two", () => {
    expect(distance("gracais", "gracias", 2)).toBe(1);
    expect(distance("teh", "the", 2)).toBe(1);
  });

  it("allows a short answer no slips at all", () => {
    expect(slipBudget("abcd")).toBe(0);
    expect(slipBudget("abcdefg")).toBe(1);
    expect(slipBudget("a".repeat(20))).toBe(2);
    expect(slipBudget("a".repeat(40))).toBe(3);
  });
});

describe("a typed answer", () => {
  const accepted = ["the dog is big", "the dog's big"];

  it("is right whatever the case and punctuation", () => {
    expect(gradeText("The Dog Is Big!", accepted)).toMatchObject({ verdict: "right", why: "" });
    expect(gradeText("  the dog is big  ", accepted)).toMatchObject({ verdict: "right" });
  });

  it("takes any of the accepted answers, and says which it matched", () => {
    expect(gradeText("the dog's big", accepted)).toMatchObject({ verdict: "right", matched: "the dog's big" });
  });

  it("calls a missing accent close, not wrong", () => {
    const m = gradeText("como estas", ["cómo estás"]);
    expect(m).toMatchObject({ verdict: "close", why: "accent", matched: "cómo estás" });
  });

  it("forgives one slipped letter in a long enough answer", () => {
    expect(gradeText("gracais", ["gracias"])).toMatchObject({ verdict: "close", why: "spelling" });
  });

  it("does NOT forgive a short word one letter away: that is a different word", () => {
    expect(gradeText("pato", ["gato"])).toMatchObject({ verdict: "wrong", why: "word" });
    expect(gradeText("sol", ["col"])).toMatchObject({ verdict: "wrong", why: "word" });
  });

  it("says when the words were right but the order was not", () => {
    expect(gradeText("big is dog the", ["the dog is big"])).toMatchObject({ verdict: "close", why: "order" });
  });

  it("calls an empty answer silence", () => {
    expect(gradeText("   ", accepted)).toMatchObject({ verdict: "wrong", why: "silence" });
    expect(gradeText("!!!", accepted)).toMatchObject({ verdict: "wrong", why: "silence" });
  });

  it("is wrong, not close, when there is nothing to accept", () => {
    expect(gradeText("anything", [])).toMatchObject({ verdict: "wrong", why: "word" });
  });
});

describe("what they said out loud", () => {
  it("does not care about the marks speech-to-text never writes", () => {
    expect(gradeSpoken("como estas", ["cómo estás"])).toMatchObject({ verdict: "right", why: "" });
  });

  it("does not care about punctuation it invents", () => {
    expect(gradeSpoken("Cómo estás.", ["cómo estás"])).toMatchObject({ verdict: "right" });
  });

  it("is kinder than typing: one slip out loud still passes", () => {
    expect(gradeSpoken("gracia", ["gracias"])).toMatchObject({ verdict: "right" });
    expect(gradeText("gracia", ["gracias"])).toMatchObject({ verdict: "close" });
  });

  it("still hears a different sentence as wrong", () => {
    expect(gradeSpoken("buenos dias", ["cómo estás"])).toMatchObject({ verdict: "wrong", why: "word" });
  });

  it("calls nothing heard silence", () => {
    expect(gradeSpoken("", ["hola"])).toMatchObject({ verdict: "wrong", why: "silence" });
  });
});

describe("the given words put in order", () => {
  const accepted = [["the", "dog", "is", "big"]];

  it("is right in the right order", () => {
    expect(gradeChips(["the", "dog", "is", "big"], accepted)).toMatchObject({ verdict: "right" });
  });

  it("is close, and says so, in the wrong order", () => {
    expect(gradeChips(["big", "the", "dog", "is"], accepted)).toMatchObject({ verdict: "close", why: "order" });
  });

  it("is wrong with a word that was never offered", () => {
    expect(gradeChips(["the", "cat", "is", "big"], accepted)).toMatchObject({ verdict: "wrong", why: "word" });
  });

  it("is silence when they put nothing", () => {
    expect(gradeChips([], accepted)).toMatchObject({ verdict: "wrong", why: "silence" });
  });
});

describe("one of a few offered meanings", () => {
  it("is right or wrong, with nothing in between", () => {
    expect(gradeChoice(2, 2, ["a", "b", "c"])).toMatchObject({ verdict: "right", matched: "c" });
    expect(gradeChoice(0, 2, ["a", "b", "c"])).toMatchObject({ verdict: "wrong", why: "word", matched: null });
  });
});

describe("every script is a first-class script", () => {
  // The vowels of an abugida or an abjad are MARKS to Unicode, not letters. A grader that strips "everything that is
  // not a letter" eats them, and then two different words quietly become the same answer.
  it("keeps a word whole in a script whose vowels are marks", () => {
    for (const w of ["\u0915\u0949\u095E\u0940", "\u0B95\u0BBE\u0BAA\u0BBF", "\u0C95\u0CBE\u0CAB\u0CBF"]) {
      expect(tidy(w)).toBe(w.normalize("NFC").toLowerCase());
      expect(tidy(w)).not.toContain(" ");
    }
  });

  it("does not let two different words collapse onto each other", () => {
    // "coffee" and "phlegm" share their consonants and differ only in the vowel marks.
    expect(gradeText("\u0915\u092B", ["\u0915\u0949\u095E\u0940"])).toMatchObject({ verdict: "wrong" });
  });

  it("accepts Arabic written the ordinary way against an answer that carries its harakat", () => {
    const bare = "\u0642\u0647\u0648\u0629";
    const vocalised = "\u0642\u064E\u0647\u0652\u0648\u064E\u0629";
    expect(fold(bare)).toBe(fold(vocalised));
    expect(gradeText(bare, [vocalised]).verdict).not.toBe("wrong");
  });

  it("treats an Indic nukta as a mark a writer leaves off, not a different word", () => {
    expect(gradeText("\u0915\u0949\u092B\u0940", ["\u0915\u0949\u095E\u0940"]).verdict).not.toBe("wrong");
  });

  it("forgives nothing in a script written a character at a time", () => {
    // Characters are picked off a list, not spelt out, so a slipped stroke is not a thing that happens: a
    // neighbouring character is simply a different word.
    expect(slipBudget("\u6211\u559C\u6B22\u5496\u5561")).toBe(0);
    expect(slipBudget("\u30B3\u30FC\u30D2\u30FC\u304C\u597D\u304D")).toBe(0);
    expect(gradeText("\u30B3\u30FC\u30D2\u30FC\u304C\u597D\u3055", ["\u30B3\u30FC\u30D2\u30FC\u304C\u597D\u304D"]))
      .toMatchObject({ verdict: "wrong", why: "word" });
    expect(gradeSpoken("\u6211\u559C\u6B22\u8336", ["\u6211\u559C\u6B22\u5496\u5561"]))
      .toMatchObject({ verdict: "wrong" });
  });

  it("still marks those scripts right when they are right", () => {
    expect(gradeText("\u6211\u559C\u6B22\u5496\u5561", ["\u6211\u559C\u6B22\u5496\u5561"])).toMatchObject({ verdict: "right" });
    expect(gradeText("\u0915\u0949\u095E\u0940", ["\u0915\u0949\u095E\u0940"])).toMatchObject({ verdict: "right" });
  });

  it("says nothing in English: every reason is a code", () => {
    const reasons = ["", "accent", "spelling", "order", "word", "silence"];
    for (const m of [gradeText("", ["a"]), gradeText("pato", ["gato"]), gradeText("como estas", ["c\u00F3mo est\u00E1s"])]) {
      expect(reasons).toContain(m.why);
    }
  });
});
