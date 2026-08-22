/**
 * Eval cases — the fixed set of inputs every prompt, model, or provider change
 * gets measured against.
 *
 * Without this, "did that change help?" is answered by vibes. These cases
 * encode the behaviors the product actually promises, especially the ones
 * that regressed before: instruction separation (the app is an assistant, not
 * a transcriber), script fidelity (romanized speech stays romanized),
 * transcript fusion (reconcile two readings without inventing a third), and
 * fact preservation (a dropped phone number is unforgivable).
 *
 * Scoring is DETERMINISTIC on purpose. An LLM judge would be more flexible and
 * far less trustworthy as a regression gate — the assertions here are things
 * that are true or false, not matters of taste.
 */
import type { Personality } from "../../shared/types/api.js";

export interface EvalCase {
  id: string;
  /** What this case is protecting. Shown on failure. */
  intent: string;
  /** The spoken/typed input. */
  input: string;
  /** A second recognizer's reading, for fusion cases. */
  alternative?: string;
  /** Script the STT layer observed, as the pipeline would pass it. */
  script?: string;
  tone?: string;
  personality?: Personality;
  /** Case-insensitive substrings the output MUST contain. */
  mustContain?: string[];
  /** Case-insensitive substrings the output must NOT contain. */
  mustNotContain?: string[];
  /** Unicode script the output must be written in. */
  mustBeScript?: "latin" | "devanagari";
  /** Output must be non-empty (default true; set false for the silence case). */
  mustBeNonEmpty?: boolean;
  /** Every one of these must survive input → output verbatim. */
  mustPreserve?: string[];
  /** Soft ceiling on output length, for "make it shorter" style cases. */
  maxChars?: number;
}

export const CASES: EvalCase[] = [
  // --- Instruction separation: the assistant contract ----------------------
  {
    id: "instr/marathi-friend",
    intent:
      "A command naming a language + audience, with the content quoted mid-sentence in another language. " +
      "The command must be executed, not transcribed.",
    input: "write a message for me to my dear friend asking tum kaise ho and write in marathi",
    mustBeScript: "devanagari",
    // The command itself must never appear in the message the user sends.
    mustNotContain: ["write a message", "in marathi", "write in"],
  },
  {
    id: "instr/hindi-command",
    intent: "The instruction itself arrives in Hindi. It must still be recognized as an instruction.",
    input: "boss ko bolo ki main aaj thoda late aaunga, isko formal bana do",
    mustNotContain: ["isko formal bana do", "bolo ki"],
  },
  {
    id: "instr/negative-write",
    intent:
      'The word "write" appears INSIDE the user\'s message. Treating it as a command would eat their sentence.',
    input: "I told her I would write the report tonight and send it before midnight",
    mustContain: ["report"],
  },
  {
    id: "instr/shorter",
    intent: "A length instruction is followed, and never echoed.",
    input:
      "so basically what I wanted to say is that the meeting we had yesterday was really quite productive and I think we covered everything we needed to cover, make it shorter",
    mustNotContain: ["make it shorter"],
    maxChars: 200,
  },

  // --- Script fidelity -----------------------------------------------------
  {
    id: "script/hinglish-stays-latin",
    intent:
      "Romanized Hinglish must come back in LATIN script — not converted to Devanagari, not translated to English.",
    input: "yaar kal ka plan cancel karna padega, sorry",
    script: "latin",
    mustBeScript: "latin",
  },
  {
    id: "script/devanagari-stays-devanagari",
    intent: "Native-script input stays in its own script.",
    input: "मैं आज ऑफिस नहीं आ पाऊंगा, तबीयत ठीक नहीं है",
    script: "devanagari",
    mustBeScript: "devanagari",
  },

  // --- Transcript fusion ---------------------------------------------------
  {
    id: "fusion/brand-name",
    intent:
      "Two recognizers heard the same audio; one got the brand name right. Fusion should recover it — " +
      "this is the case picking a single transcript can never win.",
    input: "kal ka plan whats up pe bhej dena",
    alternative: "kal ka plan WhatsApp pe bhej dena",
    script: "latin",
    mustContain: ["whatsapp"],
    mustBeScript: "latin",
  },
  {
    id: "fusion/no-invention",
    intent:
      "Given two readings a model will happily average them into a fluent third sentence nobody said. " +
      "It must choose between them, not invent.",
    input: "send the file to rahul before five",
    alternative: "send the file to rahul before six",
    mustNotContain: ["seven", "eight", "noon", "midnight"],
  },

  // --- Fact preservation ---------------------------------------------------
  {
    id: "facts/numbers-survive",
    intent: "A dropped or altered number is the failure users never forgive.",
    input: "tell him the total is 4750 rupees and my number is 9876543210",
    mustPreserve: ["4750", "9876543210"],
  },
  {
    id: "facts/email-survives",
    intent: "Identifiers must pass through untouched.",
    input: "mail the invoice to accounts@tailzu.space by friday",
    mustPreserve: ["accounts@tailzu.space"],
  },

  // --- Refusal / silence handling -----------------------------------------
  {
    id: "silence/empty-in-empty-out",
    intent:
      'Noise must produce NOTHING — never "I didn\'t catch that". A meta reply landing at the cursor is a failure.',
    input: "   ",
    mustBeNonEmpty: false,
  },
  {
    id: "meta/no-conversational-reply",
    intent:
      "The model must rewrite what the user wants to SEND, never answer it as if addressed to the assistant.",
    input: "can you send me the report by tomorrow morning",
    mustNotContain: ["i don't have", "as an ai", "i cannot", "sure, i"],
  },

  // --- Tone ----------------------------------------------------------------
  {
    id: "tone/formal-drops-slang",
    intent: "A formal tone removes slang and contractions without changing the meaning.",
    input: "hey can u pls send that thing asap, thx",
    tone: "formal",
    mustNotContain: ["u ", "pls", "thx", "asap"],
  },
  {
    id: "tone/none-keeps-voice",
    intent:
      'Tone "none" is a clean-up, NOT a restyle — the user\'s own wording must survive.',
    input: "i think we should probably just push it to next week honestly",
    tone: "none",
    mustContain: ["next week"],
  },

  // --- Personal vocabulary -------------------------------------------------
  {
    id: "vocab/name-spelling",
    intent: "Names from the user's dictionary keep their exact spelling.",
    input: "ask tailzu team for the update",
    personality: { vocabulary: "Tailzu\nChedfox" },
    mustPreserve: ["Tailzu"],
  },
];
