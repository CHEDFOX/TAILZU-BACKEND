/**
 * What is pasted after other text has to join it.
 *
 * The desktop writes a dictation pause by pause, each stretch pasted after
 * the last, and the seams showed: "So see that andजिंदगी में.I'm not a…".
 * Beside the invented words (speech-gate.test.ts), three things were wrong at
 * every seam — no space, a capital on a word that carries a sentence on, and a
 * full stop at a pause the speaker never reached.
 */
import { describe, expect, it } from "vitest";
import { continuesSentence, joinWithSpace, shapeForJoin } from "../src/pipeline/join.js";
import { stripAddedClosing, stripEdgeFiller } from "../src/pipeline/cleanup.js";

describe("does the text before stop mid-sentence?", () => {
  it("yes after a word, a comma or a dash", () => {
    for (const c of ["So see that and", "Hi Priya,", "the plan —", "kal milte", "मैं कल"]) {
      expect(continuesSentence(c), c).toBe(true);
    }
  });

  it("no after a finished sentence, a colon, a new line, or nothing", () => {
    for (const c of ["Done.", "Really?", "Wow!", "मैं कल आऊंगा।", "Notes:", "first line\n", "", "   ", undefined]) {
      expect(continuesSentence(c), String(c)).toBe(false);
    }
  });
});

describe("a stretch is shaped to carry the sentence on", () => {
  it("lowers a capital that only starts a sentence the speaker did not start", () => {
    expect(shapeForJoin("The deck is done.", "So see that and")).toBe("the deck is done.");
    expect(shapeForJoin("And then we left.", "We ate,")).toBe("and then we left.");
    expect(shapeForJoin("Aur phir hum gaye", "kal hum market gaye")).toBe("aur phir hum gaye");
  });

  it("never lowers a name, an acronym or I", () => {
    expect(shapeForJoin("Priya said yes.", "I asked")).toBe("Priya said yes.");
    expect(shapeForJoin("I'm not a", "So see that and")).toBe("I'm not a");
    expect(shapeForJoin("THE END", "and that was")).toBe("THE END");
    expect(shapeForJoin("Will you come?", "I wonder")).toBe("Will you come?");
  });

  it("leaves a new sentence its capital", () => {
    expect(shapeForJoin("The deck is done.", "Hi Priya.")).toBe("The deck is done.");
    expect(shapeForJoin("The deck is done.", undefined)).toBe("The deck is done.");
  });

  it("drops a full stop after a word no sentence ends on", () => {
    expect(shapeForJoin("I'm not a.", undefined)).toBe("I'm not a");
    expect(shapeForJoin("So see that and.", undefined)).toBe("So see that and");
    expect(shapeForJoin("मैं जाना चाहता था लेकिन।", undefined)).toBe("मैं जाना चाहता था लेकिन");
  });

  it("keeps it where a sentence really ends, or on a letter", () => {
    expect(shapeForJoin("Who is it for.", undefined)).toBe("Who is it for.");
    expect(shapeForJoin("We went with plan A.", undefined)).toBe("We went with plan A.");
    expect(shapeForJoin("and then...", undefined)).toBe("and then...");
  });

  it("tidies spacing without touching line breaks", () => {
    expect(shapeForJoin("  hello   there \t friend  ", undefined)).toBe("hello there friend");
    expect(shapeForJoin("- one  \n-  two", undefined)).toBe("- one\n- two");
  });
});

describe("the client is told whether a space goes between", () => {
  it("yes between two words", () => {
    expect(joinWithSpace("So see that and", "I'm not a")).toBe(true);
    expect(joinWithSpace("So see that and", "जिंदगी में")).toBe(true);
    expect(joinWithSpace("मैं कल", "आऊंगा।")).toBe(true);
  });

  it("no when there is nothing to join, or the separation is already there", () => {
    expect(joinWithSpace(undefined, "Hello")).toBe(false);
    expect(joinWithSpace("", "Hello")).toBe(false);
    expect(joinWithSpace("Hello ", "there")).toBe(false);
    expect(joinWithSpace("Line one\n", "Line two")).toBe(false);
    expect(joinWithSpace("Hello", "")).toBe(false);
  });

  it("no before punctuation that belongs to the word before it, or after an opening bracket", () => {
    expect(joinWithSpace("Hello", ", and you?")).toBe(false);
    expect(joinWithSpace("Wait", "?")).toBe(false);
    expect(joinWithSpace("He said (", "quietly)")).toBe(false);
  });

  it("no between two scripts written without spaces; yes for Korean, which has them", () => {
    expect(joinWithSpace("明天见", "好的")).toBe(false);
    expect(joinWithSpace("ありがとう", "ございます")).toBe(false);
    expect(joinWithSpace("내일", "만나요")).toBe(true);
  });
});

describe("a closing nobody said comes off, in any language it comes back in", () => {
  it("still strips an English one they never said", () => {
    expect(stripAddedClosing("Hi Priya, the deck is done. Thank you.", "hi priya the deck is done"))
      .toBe("Hi Priya, the deck is done.");
  });

  it("strips a romanised or Devanagari one they never said", () => {
    expect(stripAddedClosing("Sab theek hai. Dhanyavaad.", "सब ठीक है")).toBe("Sab theek hai.");
    expect(stripAddedClosing("सब ठीक है। धन्यवाद।", "सब ठीक है")).toBe("सब ठीक है।");
  });

  it("keeps one they said, whatever alphabet the writer spelled it in", () => {
    expect(stripAddedClosing("Sab theek hai. Dhanyavaad.", "सब ठीक है धन्यवाद")).toBe("Sab theek hai. Dhanyavaad.");
    expect(stripAddedClosing("Sab theek hai. Shukriya.", "sab theek hai shukriya")).toBe("Sab theek hai. Shukriya.");
    expect(stripAddedClosing("The deck is done. Thank you.", "the deck is done, thanks")).toBe("The deck is done. Thank you.");
  });

  it("gives their word back when the whole output is a closing they never said", () => {
    expect(stripAddedClosing("Thank you.", "Jhal")).toBe("Jhal");
    expect(stripAddedClosing("Thank you.", "thank you")).toBe("Thank you.");
    expect(stripAddedClosing("Okay.", "okay")).toBe("Okay.");
  });
});

describe("filler at the join", () => {
  it("comes off without putting a capital into the middle of a sentence", () => {
    expect(stripEdgeFiller("Um, market today.", true)).toBe("market today.");
    expect(stripEdgeFiller("हम्म, कल आऊंगा।", true)).toBe("कल आऊंगा।");
  });

  it("still gives a sentence of its own its capital back", () => {
    expect(stripEdgeFiller("Um, market today.", false)).toBe("Market today.");
    expect(stripEdgeFiller("Um, market today.")).toBe("Market today.");
  });
});
