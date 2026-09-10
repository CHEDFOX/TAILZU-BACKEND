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
import { detectScript, leadsOnScript } from "../src/pipeline/stt.js";
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
  it("names the captured script so the model can't drift it", () => {
    const s = buildAssistSystem({ hasContext: false, script: "latin" });
    expect(s).toContain("Theirs was latin.");
  });

  it("says nothing when the script is unknown (no misleading claim)", () => {
    const s = buildAssistSystem({ hasContext: false, script: "unknown" });
    expect(s).not.toContain("Theirs was");
    const none = buildAssistSystem({ hasContext: false });
    expect(none).not.toContain("Theirs was");
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

  it("never fires on romanized Hinglish, which has no script to see", () => {
    // The known limit, pinned so nobody assumes it is covered. This case rides
    // on whichever engine is primary; STT_LIVE_PROVIDER exists for it.
    expect(leadsOnScript("aaj main thoda late aaunga", "today I am a little late")).toBe(false);
  });

  it("does not fire for a European language against English", () => {
    // Latin against Latin. The generalist is the right engine for both, and
    // handing French to the Indic specialist would be the exact mistake this
    // rule is meant to prevent in the other direction.
    expect(leadsOnScript("je serai un peu en retard", "I will be a little late")).toBe(false);
  });
});
