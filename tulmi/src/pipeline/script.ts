/**
 * WHICH SCRIPT A TEXT IS WRITTEN IN, AND HOW MUCH OF IT IS ROMANIZED HINDI.
 *
 * Split out of stt.ts, whose other half drives the speech engines (groq-sdk, the
 * speech-presence probe: child_process, fs). The Code bot's request classifier
 * needs only these pure functions, and the Cloudflare jobs Worker that bundles
 * it must not carry a speech-to-text SDK for them. stt.ts re-exports all of it,
 * so every existing import keeps working.
 */

/**
 * ROMANIZED HINDI, WITHOUT A SCRIPT TO SEE IT BY.
 *
 * Script is the strongest evidence of which engine understood the speech, and
 * it is the only evidence the stop-time reconciliation had. That left one case
 * undecided — romanized Hinglish, written in Latin by both engines — and an
 * undecided case fell back to whichever engine an operator had named primary.
 * So recognition quality depended on a guess about traffic, and that guess is
 * wrong for every user who falls on the other side of it.
 *
 * These are the evidence for the case script cannot reach. Two engines hear
 * the SAME audio: one that understood "yeh kaam nahi ho raha" writes those
 * words, and one that did not writes English that sounds like them. So the
 * count differs, and the difference is a measurement rather than a preference.
 *
 * Every word here is chosen for being unambiguous. `the`, `to`, `me`, `main`,
 * `par`, `is`, `so`, `do` and `have` are all real Hindi transliterations AND
 * ordinary English, and including any of them would score plain English as
 * Hindi — which would hand the lead to whichever engine was worse.
 */
export const ROMAN_HINDI = new Set([
  "hai", "hain", "haan", "nahi", "nahin", "tha", "thi", "thay", "hoga", "hogi",
  "kya", "kyun", "kyon", "kyunki", "kaise", "kahan", "kaun", "kitna", "kitne",
  "aap", "tum", "tumhara", "mera", "meri", "mere", "tera", "teri", "uska", "uski",
  "hamara", "hamare", "unka", "unki", "yeh", "woh", "koi", "kuch", "sab", "sabhi",
  "karo", "karna", "karke", "kiya", "karta", "karte", "karti", "raha", "rahi", "rahe",
  "gaya", "gayi", "diya", "liya", "milega", "chahiye", "sakta", "sakte", "sakti",
  "bhi", "toh", "phir", "abhi", "lekin", "magar", "isliye", "matlab", "waise",
  "bahut", "bohot", "zyada", "thoda", "jaldi", "bilkul", "accha", "achha",
  "theek", "thik", "yaar", "bhai", "arre", "arey", "wala", "wali", "ekdum",
  // The grammar, which was the gap: the list had pronouns and verbs but not
  // the particles that hold a Hindi sentence together, so "kal ka meeting
  // cancel ho gaya so please inform the team" scored on one word.
  //
  // NOTHING THAT IS ALSO AN ENGLISH WORD. "hi", "to", "so", "par", "in" and
  // "at" are all real romanized Hindi and all excluded, because a marker that
  // fires on English would make every English sentence look part-Hindi and
  // the mixture signal worthless in the direction that matters most.
  "kal", "aaj", "ka", "ki", "ke", "ko", "ho", "hota", "hote", "hoti",
  "aur", "mein", "se", "tak", "ab", "jab", "tab", "agar", "bas", "sirf",
  "baaki", "jaana", "aana", "dena", "lena", "wapas", "zaroor", "shayad",
]);

/** How many romanized-Indic marker words are in here, as a count.
 *  The fraction above answers "how much of this is Hindi"; some questions
 *  want "is any of it", and a long English sentence dilutes a real signal. */
export function romanHindiHits(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words?.length) return 0;
  let hits = 0;
  for (const w of words) if (ROMAN_HINDI.has(w)) hits++;
  return hits;
}

/**
 * Which script the transcript actually came back in — deterministic, free, and
 * far more reliable than hoping the writing model notices on its own.
 *
 * Feeds the cleanup prompt a FACT ("the user spoke in Latin script") so
 * romanized Hinglish can't be silently converted to Devanagari, and gets
 * recorded on history rows as a passive signal about what this user really
 * speaks — learned by observation, never by asking.
 */
export type DetectedScript =
  | "latin" | "devanagari" | "tamil" | "telugu" | "bengali" | "gujarati"
  | "gurmukhi" | "kannada" | "malayalam" | "arabic" | "cjk" | "cyrillic" | "unknown";

const SCRIPT_RANGES: Array<{ script: DetectedScript; re: RegExp }> = [
  { script: "devanagari", re: /[ऀ-ॿ]/g },
  { script: "bengali", re: /[ঀ-৿]/g },
  { script: "gurmukhi", re: /[਀-੿]/g },
  { script: "gujarati", re: /[઀-૿]/g },
  { script: "tamil", re: /[஀-௿]/g },
  { script: "telugu", re: /[ఀ-౿]/g },
  { script: "kannada", re: /[ಀ-೿]/g },
  { script: "malayalam", re: /[ഀ-ൿ]/g },
  { script: "arabic", re: /[؀-ۿݐ-ݿ]/g },
  { script: "cyrillic", re: /[Ѐ-ӿ]/g },
  { script: "cjk", re: /[぀-ヿ一-鿿가-힯]/g },
  { script: "latin", re: /[A-Za-z]/g },
];

export function detectScript(text: string): DetectedScript {
  if (!text.trim()) return "unknown";
  let best: DetectedScript = "unknown";
  let bestCount = 0;
  for (const { script, re } of SCRIPT_RANGES) {
    const count = (text.match(re) ?? []).length;
    // Non-Latin scripts win ties: a Devanagari sentence with an English brand
    // name in it is Devanagari, not Latin.
    if (count > bestCount || (count > 0 && count === bestCount && script !== "latin")) {
      best = script;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : "unknown";
}

export const INDIC_SCRIPTS = new Set<DetectedScript>([
  "devanagari", "tamil", "telugu", "bengali", "gujarati",
  "gurmukhi", "kannada", "malayalam",
]);
