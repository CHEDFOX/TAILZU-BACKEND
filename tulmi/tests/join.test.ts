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
import { continuesSentence, hasPauseStop, joinPauseStops, joinWithSpace, shapeForJoin } from "../src/pipeline/join.js";
import { stripAddedClosing, stripAddedGreeting, stripEdgeFiller } from "../src/pipeline/cleanup.js";

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

describe("a full stop a pause put inside a sentence", () => {
  // The live recognizer writes every pause as a full stop, and the keyboards
  // join the pieces with a space. After a word no sentence ends on, the stop
  // is certainly the pause's.
  it("is found after a word no sentence ends on, and only there", () => {
    expect(hasPauseStop("I'm going to the. Market tomorrow.")).toBe(true);
    expect(hasPauseStop("I'll call you and. Then we decide.")).toBe(true);
    expect(hasPauseStop("Main kal aaunga aur. Phir baat karte hain.")).toBe(true);
    // A real sentence end, a letter, the end of the text, an ellipsis.
    expect(hasPauseStop("I went to the market. Then I came home.")).toBe(false);
    expect(hasPauseStop("We go with Plan A. Then we see.")).toBe(false);
    expect(hasPauseStop("I'm not a.")).toBe(false);
    expect(hasPauseStop("I was thinking and... then it hit me.")).toBe(false);
  });

  it("is found as an ellipsis after an article, as OpenAI writes a breath there", () => {
    // Measured on the deployed server: two turns, "So I was going to the..."
    // and "Market tomorrow, and then maybe the pharmacy."
    const said = "So I was going to the... Market tomorrow, and then maybe the pharmacy.";
    expect(hasPauseStop(said)).toBe(true);
    expect(joinPauseStops(said)).toBe("So I was going to the market tomorrow, and then maybe the pharmacy.");
    expect(joinPauseStops("Pick up a… Cake on the way.")).toBe("Pick up a cake on the way.");
  });

  it("is joined across, lowering the word after unless it is a name", () => {
    expect(joinPauseStops("I'm going to the. Market tomorrow.")).toBe("I'm going to the market tomorrow.");
    expect(joinPauseStops("I'll call you and. Then we decide.")).toBe("I'll call you and then we decide.");
    // "I" and acronyms keep their capitals; so does a word written as a name
    // in the middle of a sentence elsewhere.
    expect(joinPauseStops("She said that and. I agreed.")).toBe("She said that and I agreed.");
    expect(joinPauseStops("Send it to the. HR team today.")).toBe("Send it to the HR team today.");
    expect(joinPauseStops("Ask Priya, she knows my. Priya will sort it.")).toBe("Ask Priya, she knows my Priya will sort it.");
    // Nothing to join: untouched.
    const plain = "I went to the market. Then I came home.";
    expect(joinPauseStops(plain)).toBe(plain);
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

describe("a greeting nobody said comes off", () => {
  // Measured on the deployed server: with a portrait in the voice, "running
  // late be there in ten" came back "Hey! Running late, be there in ten."
  it("standing alone at the start, with none in what they said", () => {
    expect(stripAddedGreeting("Hey! Running late, be there in ten.", "running late be there in ten"))
      .toBe("Running late, be there in ten.");
    expect(stripAddedGreeting("Hi, the meeting moved to four.", "the meeting moved to four")).toBe("The meeting moved to four.");
    expect(stripAddedGreeting("Namaste! Kal milte hain.", "kal milte hain")).toBe("Kal milte hain.");
    // "him" is not "hi": the greeting is still the model's.
    expect(stripAddedGreeting("Hi! Tell him I'm late.", "tell him im late")).toBe("Tell him I'm late.");
  });

  it("stays when they said one, in any language or spelling", () => {
    for (const said of ["hey running late be there in ten", "hiii running late", "namaste running late", "नमस्ते running late"]) {
      expect(stripAddedGreeting("Hey! Running late.", said), said).toBe("Hey! Running late.");
    }
  });

  it("stays when it addresses someone, or is the whole message", () => {
    expect(stripAddedGreeting("Hey Priya, running late.", "running late")).toBe("Hey Priya, running late.");
    expect(stripAddedGreeting("Hello.", "hello")).toBe("Hello.");
    expect(stripAddedGreeting("Hi!", "")).toBe("Hi!");
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
