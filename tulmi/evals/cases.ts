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
  /**
   * How much longer the output may be than the input, as a multiple of its
   * word count. 1.4 allows repair and punctuation; it does not allow a
   * sentence to grow a greeting, a sign-off, or a finished thought.
   *
   * A RATIO rather than a ceiling, because the fault it measures is
   * proportional: "ok" becoming a paragraph and a four-line note becoming
   * eight are the same mistake, and one fixed number cannot catch both.
   */
  maxGrowth?: number;
  /**
   * The language setting the user has saved, passed through as the app does.
   * Present to prove it acts as a BIAS and never as a target — a setting read
   * as "convert to this" is the translation bug wearing the opposite sign.
   */
  language?: string;
}

export const CASES: EvalCase[] = [
  // --- Adding: the length is theirs ----------------------------------------
  //
  // Reported as "sometimes it adds things which are not needed". The principle
  // that was meant to cover it — "say only what they gave you" — did not:
  // finishing a terse thought adds no FACT, so it never read as a violation.
  // These measure the shape of the output, not its content, because that is
  // where the fault actually lives.
  {
    id: "add/terse-stays-terse",
    intent: "Four words come back as four words, repaired. Brevity is a choice, not an unfinished thought.",
    input: "reaching in ten",
    maxGrowth: 1.6,
    mustNotContain: ["hi ", "hello", "dear", "hope this", "regards", "thanks"],
  },
  {
    id: "add/no-greeting-invented",
    intent: "A message with no greeting spoken must not acquire one on the way out.",
    input: "send me the file when you get a chance",
    maxGrowth: 1.5,
    mustNotContain: ["hi ", "hello", "hey ", "dear ", "good morning"],
  },
  {
    id: "add/no-signoff-invented",
    intent: "Nor a sign-off. The watermark is off, so there is nothing that may add one.",
    input: "the meeting moved to four",
    maxGrowth: 1.6,
    mustNotContain: ["regards", "best,", "thanks,", "cheers", "sincerely"],
  },
  {
    id: "add/question-is-sent-not-answered",
    intent:
      "A question they dictate is a question they are SENDING. Answering it is the most " +
      "expensive form of adding: the reader gets an answer to something never asked of them.",
    input: "kya tum kal office aa rahe ho",
    mustBeScript: "latin",
    maxGrowth: 1.6,
    mustNotContain: ["yes", "no,", "i will", "sure"],
  },

  // --- Language: their words, this alphabet --------------------------------
  //
  // The distinction the whole section turns on, and the one "write it in
  // English" hides: the ALPHABET is English, the WORDS are theirs. These were
  // written twice — once for keeping their script, once for translating into
  // English — and both readings are failures the cases below now name.
  {
    id: "lang/hinglish-is-not-translated",
    intent: "Romanized Hindi is already in this alphabet. It comes back as itself.",
    input: "yaar kal ka plan cancel ho gaya hai, ab agle hafte milte hain",
    mustBeScript: "latin",
    mustContain: ["kal"],
    mustNotContain: ["cancelled the plan", "let us meet next week", "the plan for tomorrow"],
  },
  {
    id: "lang/devanagari-is-spelled-out",
    intent:
      "THE CHANGE IN v7. Their own alphabet comes back spelled in this one — " +
      "the same sentence, the same words, a different alphabet. Not translated, and not left in Devanagari.",
    input: "मैं थोड़ा लेट पहुँचूँगा, मीटिंग शुरू कर देना",
    mustBeScript: "latin",
    mustNotContain: ["i will be late", "start the meeting", "a little late"],
  },
  {
    id: "lang/reaching-for-the-english-word",
    intent:
      "The failure that reads as obedience: 'write it in English' is satisfied " +
      "by the English phrase that means the same thing, and that is the one thing it must not be.",
    input: "mera matlab samajh gaye",
    mustBeScript: "latin",
    mustContain: ["matlab"],
    mustNotContain: ["you understood", "did you understand", "you got my point", "what i meant"],
  },
  {
    id: "lang/mixed-stays-mixed",
    intent:
      "A sentence that switches between languages keeps switching, in the same places. " +
      "Normalising it to either one is a rewrite, not a repair.",
    input: "the deploy is done but abhi testing baaki hai",
    mustBeScript: "latin",
    mustContain: ["deploy", "abhi"],
    mustNotContain: ["testing is still pending"],
  },
  {
    id: "lang/setting-is-the-target",
    intent:
      "A saved language is a choice, and the one case where the alphabet is not " +
      "English: Hindi on the account means the message comes back in Hindi, in its own script.",
    input: "kal subah nikalna hai, alarm laga dena",
    language: "hi",
    mustBeScript: "devanagari",
  },
  {
    id: "lang/asked-for-another",
    intent:
      "The alphabet is a default, not a policy: one sentence of theirs replaces it. " +
      "The request itself is never part of the message.",
    input: "tell Priya the deploy is done, write it in hindi",
    mustBeScript: "devanagari",
    mustNotContain: ["write it in hindi", "in hindi"],
  },

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

  // --- Script: what comes back is this alphabet ----------------------------
  {
    id: "script/hinglish-already-latin",
    intent: "Romanized Hinglish is already spelled in this alphabet. Nothing to convert, nothing to translate.",
    input: "yaar kal ka plan cancel karna padega, sorry",
    script: "latin",
    mustBeScript: "latin",
    mustContain: ["cancel"],
    mustNotContain: ["we will have to cancel", "tomorrow's plan"],
  },
  {
    id: "script/devanagari-comes-back-latin",
    intent:
      "Native-script input is spelled out in English letters. The old rule sent it " +
      "back in its own script, and a keyboard that types Latin has nothing to do with that.",
    input: "मैं आज ऑफिस नहीं आ पाऊंगा, तबीयत ठीक नहीं है",
    script: "devanagari",
    mustBeScript: "latin",
    mustNotContain: ["i will not be able", "not feeling well", "office today"],
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
