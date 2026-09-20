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

  // --- Language: speak anything, send English --------------------------
  //
  // These were the mirror of this until v7 of the cleanup prompt: they
  // asserted that romanized Hindi came back romanized and that a mixture
  // stayed mixed. The product rule reversed — talk the way you talk, send
  // something a colleague can read — and a harness that keeps measuring the
  // old rule reports the new one as a regression on every run.
  {
    id: "lang/hinglish-becomes-english",
    intent: "Romanized Hindi is spoken; English is what gets sent.",
    input: "yaar kal ka plan cancel ho gaya hai, ab agle hafte milte hain",
    mustBeScript: "latin",
    mustNotContain: ["yaar", "kal ka", "agle hafte", "ho gaya"],
  },
  {
    id: "lang/devanagari-becomes-english",
    intent: "Native script in, English out. The script of the input decides nothing about the output.",
    input: "मैं थोड़ा लेट पहुँचूँगा, मीटिंग शुरू कर देना",
    mustBeScript: "latin",
  },
  {
    id: "lang/setting-is-the-target",
    intent:
      "A saved language is a choice, not a bias. Hindi on the account means the " +
      "message comes back in Hindi, in its own script — the one case where English is not the answer.",
    input: "kal subah nikalna hai, alarm laga dena",
    language: "hi",
    mustBeScript: "devanagari",
  },
  {
    id: "lang/mixed-becomes-english",
    intent:
      "A sentence carrying both languages comes back wholly in English. The half " +
      "already in English is not the finished part — stopping there is the failure this case exists for.",
    input: "the deploy is done but abhi testing baaki hai",
    mustBeScript: "latin",
    mustContain: ["deploy"],
    mustNotContain: ["abhi", "baaki"],
  },
  {
    id: "lang/asked-for-another",
    intent:
      "English is a default, not a policy: one sentence of theirs replaces it. " +
      "The request itself is never part of the message.",
    input: "tell Priya the deploy is done, write it in hindi",
    mustBeScript: "devanagari",
    mustNotContain: ["write it in hindi", "in hindi"],
  },
  {
    id: "lang/not-translated-english",
    intent:
      "ENGLISH, NOT TRANSLATED ENGLISH. Carrying the sentence across word for " +
      "word passes 'write in English' and fails the product: idiom is where it " +
      "gives itself away, so the literal reading of each phrase is what this forbids.",
    input: "yaar mera dimaag kharab ho gaya hai, kal se dekh raha hoon aur kuch samajh nahi aa raha",
    mustBeScript: "latin",
    mustNotContain: ["my brain has gone bad", "my mind is spoiled", "brain is corrupted", "since tomorrow"],
  },
  {
    id: "lang/name-is-not-translated",
    intent:
      "Writing in English is not licence to find the nearest English word for a " +
      "name or for a thing English has no word for.",
    input: "Diwali ke liye Ramesh ko invite kar dena",
    mustBeScript: "latin",
    mustContain: ["ramesh"],
    mustNotContain: ["festival of lights"],
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

  // --- Script: the input's script is for reading it ------------------------
  //
  // The observed script used to pin the OUTPUT too. It now says only how to
  // read what was said, and these measure that the reading still works: a
  // sentence misread as English is a different sentence, whichever language
  // it is written back in.
  {
    id: "script/hinglish-read-correctly",
    intent:
      "Romanized Hinglish, read as Hinglish rather than as broken English, and sent as English.",
    input: "yaar kal ka plan cancel karna padega, sorry",
    script: "latin",
    mustBeScript: "latin",
    mustContain: ["cancel"],
    mustNotContain: ["yaar", "padega"],
  },
  {
    id: "script/devanagari-read-correctly",
    intent: "Native-script input is read in its own script and sent as English.",
    input: "मैं आज ऑफिस नहीं आ पाऊंगा, तबीयत ठीक नहीं है",
    script: "devanagari",
    mustBeScript: "latin",
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
