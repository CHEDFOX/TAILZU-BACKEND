/**
 * Command mode — trailing "…MAKE IT SHORTER" style overrides.
 *
 * The user speaks (or types) a natural-language override at the TAIL of their
 * dictation to steer the cleanup for one run. This module detects that trailer
 * with regex, strips it out of the transcript, and returns a discriminated
 * Command the cleanup pipeline can apply as a per-run prompt addendum.
 *
 *   "hey uh the meeting is at three, MAKE IT SHORTER"
 *     → transcript = "hey uh the meeting is at three"
 *     → command    = { kind: "shorter" }
 *
 * Design constraints:
 *  - Trailing-only: the command must be the LAST utterance. Mid-sentence uses
 *    like "the article is shorter" must NOT match.
 *  - Multi-command: if the user chained "MAKE IT SHORTER, MAKE IT LONGER",
 *    only the tail (the last one) applies.
 *  - Case-insensitive; tolerant of trailing punctuation (".", "!", "…").
 */
import type { Command } from "../../../shared/types/api.js";
import { LANGS } from "../experience/languages.js";

// Common "please make it" / "now make it" preamble. Kept non-capturing so
// the whole match can be sliced off the transcript in one go.
const MAKE_IT =
  "(?:please\\s+)?(?:now\\s+)?(?:make\\s+it|make\\s+this|make\\s+that)";

// Trailing bag: punctuation + whitespace we allow after the command word.
const TAIL = "[\\s.!?…,\"'\\)\\]]*";

/**
 * The optional connector a command may open with: ",", "and", "then", space —
 * up to two of the words, so "…, and then make it shorter" leaves no "and"
 * behind in the message. Two, not any number: an unbounded run would be
 * re-tried from every word of "and and and…", which is the same quadratic
 * scan this prefix exists to prevent.
 *
 * `(?<!\\s)` IS THE LOAD-BEARING PART. Every pattern is tail-anchored but the
 * search is not, so without it the engine tried a match at every space of a
 * long run, and each try re-scanned the rest of the run: 10,000 spaces took
 * over a second per request, on the event loop. A match can only begin where
 * a run of spaces begins — the leftmost match already did — so this changes
 * no result, only how many starts are tried.
 */
const LEAD = "(?<!\\s)[,;\\-—…]?\\s*(?:(?:and|then)\\s+){0,2}";

/** Words for how something should feel, as people ask for it. */
const STYLE = "(?:polite|nicer|nice|sweeter|sweet|cuter|cute|funnier|funny|witty|warmer|warm|friendlier|friendly|kinder|kind|gentler|gentle|softer|soft|respectful|professional|confident|assertive|firm|direct|humble|apologetic|romantic|flirty|cheesy|dramatic|poetic|grateful|thankful|enthusiastic|excited|happier|happy|cheerful|serious|sincere|heartfelt|emotional|loving|caring|sarcastic|savage|cooler|cool|chill|simpler|simple|clearer|clear|concise|punchy|catchy|persuasive|urgent|positive|encouraging|motivational|classy|elegant|smooth|natural|personal|lighter|light|playful|sassy|cute)";
const STYLE_ADVERB = "(?:nicely|politely|sweetly|kindly|gently|softly|warmly|professionally|respectfully|romantically|confidently|firmly|humbly|playfully|sarcastically|seriously|sincerely|simply|clearly|briefly)";
/** "a bit", "much more", "less", "very"… before the word. */
const DEGREE = "(?:(?:a\\s+)?(?:bit|little|lot|touch)\\s+(?:more\\s+)?|(?:much|way)\\s+more\\s+|more\\s+|less\\s+|very\\s+|super\\s+|really\\s+|extra\\s+|quite\\s+)?";

/**
 * Ordered list of (regex, factory) pairs. Every regex is anchored to $ so it
 * only matches at the tail. We accept a small optional leading connector
 * (",", "and", "then", "…", filler space) so the stripped transcript comes
 * back clean without a dangling comma.
 */
const PATTERNS: Array<{ re: RegExp; make: (m: RegExpMatchArray) => Command }> = [
  // shorter / longer
  {
    re: new RegExp(
      `${LEAD}(?:${MAKE_IT}|keep\\s+(?:it|this|that))\\s+(?:a\\s+bit\\s+|much\\s+|way\\s+|more\\s+|really\\s+|very\\s+)?(?:shorter|short|brief|crisp)${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "shorter" }),
  },
  {
    re: new RegExp(
      `${LEAD}${MAKE_IT}\\s+(?:a\\s+bit\\s+|much\\s+|way\\s+|more\\s+)?longer${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "longer" }),
  },

  // formal / casual — "make it formal" or "make it more formal"
  {
    re: new RegExp(
      `${LEAD}${MAKE_IT}\\s+(?:more\\s+)?formal${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "formal" }),
  },
  {
    re: new RegExp(
      `${LEAD}${MAKE_IT}\\s+(?:more\\s+)?casual${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "casual" }),
  },

  // bullet points — "in bullet points", "as bullets", "as a bulleted list"
  {
    re: new RegExp(
      `${LEAD}(?:in|as|to)\\s+(?:a\\s+)?bullet(?:ed)?\\s?points?${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "bulletpoints" }),
  },
  {
    re: new RegExp(
      `${LEAD}(?:in|as|to)\\s+(?:a\\s+)?bullet(?:ed)?\\s+list${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "bulletpoints" }),
  },
  {
    // Standalone "as bullets" / "as bullet" — no explicit "points"/"list".
    re: new RegExp(
      `${LEAD}(?:in|as)\\s+bullets${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "bulletpoints" }),
  },

  // translate — captures the target language. Accept 1-2 word language names
  // ("english", "brazilian portuguese", "simplified chinese"). We keep the
  // captured span loose; the LLM does the actual language mapping.
  {
    re: new RegExp(
      `${LEAD}translate\\s+(?:(?:this|it|that)\\s+)?(?:to|into|in)\\s+([A-Za-z][A-Za-z\\-]*(?:\\s+[A-Za-z][A-Za-z\\-]*)?)${TAIL}$`,
      "i",
    ),
    make: (m) => ({ kind: "translate", lang: (m[1] ?? "").trim().toLowerCase() }),
  },

  // write in X — the other way people ask for a language, and the commoner
  // one now that English is what comes back by default: "say it in Hindi",
  // "reply in Spanish". `translate` carries a finished text across; this
  // composes in that language from the start. Same destination either way.
  //
  // The verb is what anchors it. A bare "in Hindi" tail would also swallow
  // "the movie was in Hindi", and the format words have to be excluded by
  // name or "write in bullets" becomes a language called bullets — this
  // pattern starts earlier in the string than the bullets one, so without
  // the lookahead it would win the earliest-match rule.
  {
    re: new RegExp(
      `${LEAD}(?:write|say|send|reply|put|make|give\\s+(?:it|this|me))\\s+(?:(?:it|this|that)\\s+)?(?:in|into)\\s+` +
        `(?!bullets?\\b|bullet\\s|points?\\b|caps\\b|capitals?\\b|short\\b|brief\\b|full\\b|detail)` +
        `([A-Za-z][A-Za-z\\-]*(?:\\s+[A-Za-z][A-Za-z\\-]*)?)${TAIL}$`,
      "i",
    ),
    make: (m) => ({ kind: "language", lang: (m[1] ?? "").trim().toLowerCase() }),
  },

  // HOW IT SHOULD SOUND — "make it sweet", "make it sound more confident",
  // "keep it polite", "say it nicely", "in a funny way". Only the words people
  // use for a feel; "make it to the party" names none, so it stays a message.
  // Formal and casual have their own commands above and are not repeated.
  {
    re: new RegExp(
      `${LEAD}(?:${MAKE_IT}|keep\\s+(?:it|this|that))\\s+(?:sound\\s+|look\\s+|feel\\s+)?${DEGREE}(${STYLE}(?:\\s+(?:and|but)\\s+${DEGREE}${STYLE})?)${TAIL}$`,
      "i",
    ),
    make: (m) => ({ kind: "style", style: (m[1] ?? "").trim().toLowerCase() }),
  },
  {
    re: new RegExp(`${LEAD}(?:say|write|put|tell)\\s+(?:it|this|that|him|her|them)\\s+(${STYLE_ADVERB})${TAIL}$`, "i"),
    make: (m) => ({ kind: "style", style: (m[1] ?? "").trim().toLowerCase() }),
  },
  {
    re: new RegExp(`${LEAD}(?:in|with)\\s+(?:a|an)\\s+${DEGREE}(${STYLE})\\s+(?:way|tone|vibe|manner|style|voice)${TAIL}$`, "i"),
    make: (m) => ({ kind: "style", style: (m[1] ?? "").trim().toLowerCase() }),
  },

  // emoji off — "no emoji", "no emojis", "without emojis", "less emoji"
  {
    re: new RegExp(
      `${LEAD}(?:no|without|less|fewer)\\s+emojis?${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "emojiOff" }),
  },

  // emoji on — "add emoji", "with emoji", "more emojis"
  {
    re: new RegExp(
      `${LEAD}(?:add|with|more|use)\\s+emojis?${TAIL}$`,
      "i",
    ),
    make: () => ({ kind: "emojiOn" }),
  },
];

/** Match every pattern once, return the earliest tail match (or null). */
function matchTail(text: string): { start: number; command: Command } | null {
  let best: { start: number; command: Command } | null = null;
  for (const { re, make } of PATTERNS) {
    const m = text.match(re);
    if (!m || m.index == null) continue;
    // Earliest tail-anchored match wins — every regex ends at text.length,
    // so the one starting earliest ate the most trailing text (including
    // its own leading connector).
    if (!best || m.index < best.start) {
      best = { start: m.index, command: make(m) };
    }
  }
  return best;
}

/**
 * Detect a command at the tail of the raw transcript.
 *
 * Only the TAIL command applies — but chained commands
 * ("…MAKE IT SHORTER, MAKE IT LONGER") are peeled off iteratively so the
 * remaining transcript is clean text with no leftover command phrases.
 * The FIRST detected command (the true tail) is the one returned; earlier
 * chained commands are discarded along with their phrase.
 */
export function detectCommand(rawTranscript: string): {
  transcript: string;
  command: Command | null;
} {
  const raw = rawTranscript ?? "";
  if (!raw.trim()) return { transcript: raw, command: null };

  let text = raw;
  let head: Command | null = null;
  // Bounded loop: each peel strictly shortens `text`. Guard with a hard cap
  // so a pathological regex can never spin forever.
  for (let i = 0; i < 8; i++) {
    const hit = matchTail(text);
    if (!hit) break;
    if (head === null) head = hit.command;
    text = text.slice(0, hit.start).replace(/(?<![\s,;:.\-—…])[\s,;:.\-—…]+$/, "").trim();
    if (!text) break;
  }

  return { transcript: text, command: head };
}

/** Every language Tailzu takes, by the name people say it, plus the few other
 *  names they use for some of them. */
const LANGUAGE_WORDS = new Set([
  ...LANGS.map((l) => l.name.toLowerCase()),
  "mandarin", "cantonese", "tagalog", "farsi", "bangla", "oriya", "roman hindi",
]);

/** "japanese", "simplified chinese", "brazilian portuguese" → a language. */
function knownLanguage(lang: string): string | null {
  const l = lang.trim().toLowerCase();
  if (LANGUAGE_WORDS.has(l)) return l;
  const last = l.split(/\s+/).pop() ?? "";
  return LANGUAGE_WORDS.has(last) ? l : null;
}

/**
 * THE INSTRUCTION, TAKEN OFF BEFORE THE WRITER EVER SEES IT.
 *
 * "How are you? Write this in Japanese" came back as
 * "How are you?日本語で書いてください": the message left in English and the
 * instruction translated into the message. The prompt says, in so many words,
 * to do the instruction and write the rest, and it lost — the same lesson as
 * the prompt leak and the echoed context: an instruction the model keeps
 * losing is checked in code, not argued for in prose.
 *
 * So a trailing instruction that is unmistakably one is cut here, and the
 * writer is handed the message and the instruction separately. What it never
 * sees, it cannot write.
 *
 * UNMISTAKABLY is the whole design. detectCommand matches by the tail alone,
 * which is right for its own caller and too loose to cut words out of a
 * message: "tell him I will reply in Spanish" ends in a command-shaped phrase
 * and is a sentence. Two things make a tail an instruction here:
 *
 *   - a boundary before it: the message ended ("…you? Write this in
 *     Japanese"), or the instruction opens with a break or a connector
 *     ("…, make it shorter", "…and make it formal"). Without one, the words
 *     run straight on from the message and may belong to it.
 *   - for a language, a language: "write it in bold" is not one.
 *
 * Anything that fails either stays in the message, where the prompt's own
 * separation still applies. A cut that is wrong loses their words; a cut that
 * is missed only leaves the writer to decide, as it always did.
 */
export function splitInstruction(text: string): { message: string; command: Command | null } {
  const raw = (text ?? "").trim();
  const none = { message: raw, command: null };
  if (!raw) return none;
  const { transcript, command } = detectCommand(raw);
  const cut = transcript.trim();
  if (!command || !cut || !raw.startsWith(cut)) return none;
  // detectCommand takes the full stop with the instruction. It belongs to the
  // sentence it ended, and is the clearest boundary there is.
  const stop = /^[.!?…]+/.exec(raw.slice(cut.length))?.[0] ?? "";
  const message = cut + stop;
  const tail = raw.slice(message.length);
  const bounded = /[.!?…]$/.test(message)
    || /^[^\S\n]*\n/.test(tail) // a line break ends a sentence as surely as a full stop
    || /^\s*(?:[,;:—–…-]|(?:and|then|also|please|now)\b)/i.test(tail);
  if (!bounded) return none;
  if (command.kind === "language" || command.kind === "translate") {
    const lang = knownLanguage(command.lang);
    if (!lang) return none;
    return { message, command: { ...command, lang } };
  }
  return { message, command };
}
