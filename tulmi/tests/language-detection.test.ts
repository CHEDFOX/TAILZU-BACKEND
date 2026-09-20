/**
 * The detection contract: the BACKEND identifies the speech. We never ask the
 * user what language they're about to speak, and we never let a stale UI
 * preference constrain what the recognizer is allowed to hear.
 *
 * This regressed badly once: a language code from the onboarding screen was
 * passed straight into the provider's `language` parameter, which PINS
 * recognition to that language — so a user who tapped "Hindi" once had their
 * English and Marathi force-decoded as Hindi, and Hinglish code-switching (the
 * flagship case) broke outright.
 */
import { describe, expect, it } from "vitest";
import { detectScript, leadsOnScript, romanHindiScore, readsAsRomanHindi, mixesEnglishAndRomanHindi, transliterated } from "../src/pipeline/stt.js";
import { buildAssistSystem } from "../src/pipeline/assistPrompt.js";

describe("detectScript — observed, not declared", () => {
  it("reads Devanagari", () => {
    expect(detectScript("अरे, कसा आहेस? खूप दिवस झाले.")).toBe("devanagari");
  });

  it("reads romanized Hinglish as LATIN — never Devanagari", () => {
    // The whole point: this must NOT be reported as Devanagari, or the
    // downstream prompt would tell the model to answer in a script the user
    // never used.
    expect(detectScript("yaar kal ka plan cancel karna padega, sorry")).toBe("latin");
  });

  it("reads the major Indic scripts", () => {
    expect(detectScript("வணக்கம், எப்படி இருக்கிறீர்கள்?")).toBe("tamil");
    expect(detectScript("నమస్కారం, ఎలా ఉన్నారు?")).toBe("telugu");
    expect(detectScript("আপনি কেমন আছেন?")).toBe("bengali");
    expect(detectScript("તમે કેમ છો?")).toBe("gujarati");
    expect(detectScript("ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ?")).toBe("gurmukhi");
    expect(detectScript("ನೀವು ಹೇಗಿದ್ದೀರಿ?")).toBe("kannada");
    expect(detectScript("നിങ്ങൾ എങ്ങനെ ഉണ്ട്?")).toBe("malayalam");
    expect(detectScript("آپ کیسے ہیں؟")).toBe("arabic");
  });

  it("calls a mixed sentence by its NON-Latin script (an English brand name doesn't flip it)", () => {
    // "मैं WhatsApp पर भेज दूंगा" — Devanagari sentence, Latin brand name.
    expect(detectScript("मैं WhatsApp पर भेज दूंगा")).toBe("devanagari");
  });

  it("returns unknown for empty / punctuation-only input", () => {
    expect(detectScript("")).toBe("unknown");
    expect(detectScript("   ")).toBe("unknown");
    expect(detectScript("... !!! ???")).toBe("unknown");
  });
});

describe("assist prompt — the observed script is stated as fact", () => {
  it("names the captured script, as how to read what was said", () => {
    // It used to be stated so the model could not drift the OUTPUT script.
    // From the English default the output script is decided elsewhere, and
    // the fact is kept for the other half of its job: romanized Hindi read
    // as English is a different sentence.
    const s = buildAssistSystem({ hasContext: false, script: "latin" });
    expect(s).toContain("arrived in latin script");
    expect(s).toMatch(/that is how to read it/i);
  });

  it("says nothing when the script is unknown (no misleading claim)", () => {
    const s = buildAssistSystem({ hasContext: false, script: "unknown" });
    expect(s).not.toContain("arrived in");
    const none = buildAssistSystem({ hasContext: false });
    expect(none).not.toContain("arrived in");
  });

  it("keeps the deliberate paragraph breaks when the conditional line is absent", () => {
    // The script line is conditional; filtering it must not collapse the
    // blank-line separators that structure the rest of the prompt.
    const s = buildAssistSystem({ hasContext: false });
    expect(s).toContain("\n\n");
  });
});

describe("who gets the live stream, mid-utterance", () => {
  // Live dictation runs two engines and only one reaches the cursor. Until now
  // that was always the primary for the whole utterance, so a Hindi speaker
  // watched Deepgram guess at Devanagari from the first word to the last and
  // only saw Sarvam's reading after they stopped. Both engines stream; the
  // question is only which one is allowed to.
  it("hands the lead to the engine that produced a native script", () => {
    expect(leadsOnScript("मैं आज देर से आऊंगा", "may I j der se aunga")).toBe(true);
  });

  it("does not hand it over on the strength of speaking first", () => {
    // The other engine has said nothing yet. Being early is not being right,
    // and a lead taken on the first segment of a two-word warm-up would stick
    // for the rest of the dictation.
    expect(leadsOnScript("मैं आज देर से आऊंगा", "")).toBe(false);
    expect(leadsOnScript("", "anything")).toBe(false);
  });

  it("stays put when both engines agree on the script", () => {
    // Two engines both returning Devanagari is not a reason to swap between
    // them — it is a reason to leave the user's text alone and let the refine
    // step reconcile at stop.
    expect(leadsOnScript("मैं ठीक हूँ", "मैं ठीक हुँ")).toBe(false);
  });

  /**
   * ROMANIZED HINGLISH USED TO BE THE KNOWN LIMIT, and it was pinned here as
   * one: no script to see, so the lead stayed with whichever engine an
   * operator had named primary. That made recognition quality depend on a
   * guess about traffic, and a guess is wrong for everybody on the other side
   * of it.
   *
   * It is decided on the words now. Both engines heard the same audio — the
   * one that understood wrote the Hindi, the one that did not wrote English
   * that sounds like it.
   */
  it("fires on romanized Hinglish, on the words rather than the script", () => {
    expect(leadsOnScript("aaj main thoda late aaunga yaar", "today I am a little late")).toBe(true);
  });

  it("does not fire on one borrowed word in an English sentence", () => {
    // A name or a loanword is not a language. Leading with the wrong engine is
    // the expensive mistake — the refine is told candidate 1 is the more
    // reliable recognizer — so the margin has to be clear, not merely ahead.
    expect(leadsOnScript("my friend yaar is coming to the office today", "my friend is coming to the office today")).toBe(false);
  });

  it("does not fire when the other engine read it as Hindi too", () => {
    // Both understood. Swapping between them buys nothing and costs the user
    // a cursor correction.
    expect(leadsOnScript("aaj main thoda late aaunga", "aaj main thoda late aunga")).toBe(false);
  });

  it("never scores plain English as Hindi", () => {
    // The markers are chosen for being unambiguous: `the`, `to`, `me`, `main`,
    // `par`, `is` and `so` are all real transliterations AND ordinary English,
    // and any of them in the set would hand the lead to the worse engine on a
    // sentence with no Hindi in it at all.
    for (const english of [
      "the main point is to do so par for the course",
      "I have to go to the main office",
      "so do you have the time",
    ]) {
      expect(romanHindiScore(english), english).toBeLessThan(0.2);
    }
  });

  it("does not fire for a European language against English", () => {
    // Latin against Latin. The generalist is the right engine for both, and
    // handing French to the Indic specialist would be the exact mistake this
    // rule is meant to prevent in the other direction.
    expect(leadsOnScript("je serai un peu en retard", "I will be a little late")).toBe(false);
  });
});

/**
 * The evidence the no-script case is decided on.
 *
 * Two engines hear the same audio. The one that understood the speech writes
 * the Hindi function words; the one that did not writes English that sounds
 * like them. That difference is a measurement, which is the whole point —
 * before this, the case was settled by a config value.
 */
describe("romanized Hindi, measured", () => {
  it("scores real Hinglish well above plain English", () => {
    expect(romanHindiScore("yaar yeh kaam abhi tak nahi hua")).toBeGreaterThan(0.3);
    expect(romanHindiScore("this work is still not done")).toBe(0);
  });

  it("prefers the engine that heard the Hindi", () => {
    // What the two engines actually produce for one utterance: the specialist
    // writes the words, the generalist writes English that rhymes with them.
    expect(readsAsRomanHindi(
      "your yeah come up he duck nahi",      // generalist, approximating
      "yaar yeh kaam abhi tak nahi hua",     // specialist, understanding
    )).toBe(true);
  });

  it("refuses to flip on a thin margin", () => {
    // Asymmetric on purpose. Leading with the wrong engine is the expensive
    // mistake, so "slightly ahead" is not enough to take the lead.
    expect(readsAsRomanHindi(
      "okay theek hai I will come",
      "okay thik hai I will come",
    )).toBe(false);
  });

  it("leaves other languages entirely alone", () => {
    // The specialist is the wrong engine for French, and this rule must never
    // be the thing that hands it one.
    expect(readsAsRomanHindi("I will be a little late", "je serai un peu en retard")).toBe(false);
    expect(romanHindiScore("je serai un peu en retard")).toBe(0);
  });
});

describe("one sentence, two languages, one script", () => {
  // The script fact fixed romanized Hindi being pushed into Devanagari. It
  // cannot reach this: "the deploy is done but abhi testing baaki hai" is
  // Latin end to end, so "Theirs was latin." is true and settles nothing, and
  // the model repairs whichever language is outnumbered. It came back "The
  // deploy is done, but testing is still pending." on the deployed server,
  // three runs of three, with a rule in the prompt forbidding exactly that.
  const mixed = [
    "the deploy is done but abhi testing baaki hai",
    "kal ka meeting cancel ho gaya so please inform the team",
    "I will be there by 5 lekin traffic bahut zyada hai",
  ];
  for (const t of mixed) {
    it(`sees the mixture: ${t.slice(0, 32)}…`, () =>
      expect(mixesEnglishAndRomanHindi(t)).toBe(true));
  }

  // The cost of a false positive is telling someone writing plain English
  // that they are writing two languages, so both sides must be clearly there.
  const notMixed = [
    "the deploy is done but testing is still pending",
    "please send me the invoice before friday and copy priya",
    // Hindi with English NOUNS in it is not a mixture — those are the very
    // words Hindi borrows, which is why only function words count.
    "mera deploy ka kaam abhi baaki hai",
    "yaar kal ka plan cancel ho gaya hai",
    "ok",
    "",
    "12345",
  ];
  for (const t of notMixed) {
    it(`leaves it alone: ${JSON.stringify(t.slice(0, 32))}`, () =>
      expect(mixesEnglishAndRomanHindi(t)).toBe(false));
  }
});

describe("what the prompt is told about a mixed sentence", () => {
  it("states it as an observation, not another rule", () => {
    // The rule was already there and lost three runs of three. An observation
    // about THIS sentence is not something to weigh — which is exactly why
    // the script line works where the script rule alone did not.
    const t = buildAssistSystem({ hasContext: false, script: "latin", mixedLanguages: true });
    expect(t).toMatch(/in two languages at once/i);
    // The observation now points the other way. Same reflex either way: the
    // model treats one half as settled — the outnumbered language as the
    // mistake, or the English clause as the finished part — so the fact has
    // to say how far the job reaches.
    expect(t).toMatch(/both halves are in scope/i);
    expect(t).toMatch(/not the part that is already finished/i);
  });

  it("says nothing when the sentence is in one language", () => {
    const t = buildAssistSystem({ hasContext: false, script: "latin" });
    expect(t).not.toMatch(/two languages at once/i);
  });

  it("does not push the prompt past its length guard", () => {
    // The file's own rule: adding to it should feel expensive. If this fails,
    // the fix is to find which line is now redundant — not to raise the cap.
    const t = buildAssistSystem({
      hasContext: true, targetApp: "WhatsApp", script: "latin",
      mixedLanguages: true, hasAlternative: true,
    });
    expect(t.length).toBeLessThan(2400);
  });
});

describe("transliteration is caught on the way out", () => {
  // The prompt has forbidden this in four wordings across four deployed runs,
  // holding sometimes and not others; at temperature 0 it now fails every
  // time, which makes it a decision rather than a wobble. An instruction the
  // model keeps losing is not an instruction, it is a hope.
  it("catches their own words re-spelled in another alphabet", () => {
    expect(transliterated(
      "mujhe kal subah jaldi uthna hai",
      "मुझे कल सुबह जल्दी उठना है।",
    )).toBe(true);
    expect(transliterated(
      "yaar kal ka plan cancel ho gaya hai",
      "यार कल का प्लान कैंसल हो गया है।",
    )).toBe(true);
  });

  it("leaves a genuine translation request alone", () => {
    // THIS IS WHAT MAKES THE GUARD SAFE TO ENFORCE. Someone asking to be
    // written in Hindi is doing something different from being transliterated
    // without asking, and English prose carries no romanized Indic markers.
    expect(transliterated(
      "please send me the invoice before friday",
      "कृपया शुक्रवार से पहले मुझे चालान भेजें।",
    )).toBe(false);
  });

  it("does nothing when nothing changed alphabet", () => {
    expect(transliterated("mujhe kal jaldi uthna hai", "Mujhe kal jaldi uthna hai.")).toBe(false);
    expect(transliterated("मुझे कल जल्दी उठना है", "मुझे कल जल्दी उठना है।")).toBe(false);
    expect(transliterated("", "मुझे कल")).toBe(false);
    expect(transliterated("mujhe kal jaldi uthna hai", "")).toBe(false);
  });

  it("needs real evidence, not one shared word", () => {
    // A single marker could be a loanword or a coincidence; two is a sentence.
    expect(transliterated("the hai brand launch", "द हाय ब्रांड लॉन्च")).toBe(false);
  });
});
