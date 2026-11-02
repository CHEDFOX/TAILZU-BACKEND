/**
 * Slips: the moments a dictation is better left as said (a question to an AI, a correction, a restart).
 */

import { hasPauseStop, pauseCutClauses, contentWords } from "../join.js";
import { detectScript, romanHindiHits, INDIC_SCRIPTS, englishShare } from "../stt.js";
import { wordCount } from "./output.js";

/**
 * WHAT A FIRST ANSWER GETS WRONG THAT CODE CAN SEE.
 *
 * Each principle in the prompt holds most of the time, and "most" is the
 * complaint: Hindi came back in English, a correction kept both halves, a
 * filler stayed, a sentence grew, Devanagari came back where English letters
 * were asked for — each now and then, and on every client, because they all
 * share this one call. Restating a principle more loudly has been tried in
 * this file many times. What works is checking the answer and, when it broke
 * a rule that can be checked, asking once more with the rule named.
 *
 * Only what can be measured is checked, and each check is narrow, because a
 * false alarm costs a second call and a wrong one could undo a good answer:
 *
 *   alphabet    no language was asked for, and letters other than English
 *               ones came back
 *   translated  no language was asked for, they spoke Hindi or Hinglish (or
 *               in another script), and what came back has none of it and
 *               reads as English
 *   added       far longer than what they said, with nothing asked of it
 *   correction  "no wait…" kept, where only the correction should be
 *   filler      "um", "uh" kept, or a spoken "like" between commas
 *   restart     a sentence begun again with both starts kept ("how they
 *               are, how they can …"), where only the second should be
 *   pause       a full stop a pause put inside a sentence ("going to the.
 *               Market") kept — see join.hasPauseStop
 *   cut         the words a pause cut short left out with the stop, as if
 *               they were a false start: "So I was going to the. Market
 *               tomorrow." → "Market tomorrow." See join.pauseCutClauses
 *   empty      nothing written for words they really said (assist() checks
 *               it: slipIn is only handed an answer)
 *   carried     in an AI app, a request ("write a birthday message for my
 *               mom") carried out instead of written as their prompt
 *   question    they asked someone something, and what came back is neither
 *               a question nor opens as one ("whats the population of india
 *               right now" → "population of India right now")
 *   dropped     under a quarter of their words came back: "mail it to
 *               priya@example.com please" → "priya@example.com"
 *
 * The last two only where the field is for sentences (fieldShapesIt): in a
 * search box or a number field, both are the right answer.
 */
export type Slip = "alphabet" | "translated" | "added" | "correction" | "filler" | "restart" | "long" | "pause" | "cut" | "empty" | "carried" | "question" | "dropped";

/**
 * A request to an AI, by its verb: "write …", "can you make …", "please
 * explain …". In ChatGPT that sentence IS the prompt. Carried out, the verb
 * is the first thing to go ("Happy birthday, Mom!" has no "write" in it), and
 * a prompt written well keeps it, so its absence is the measure.
 */
const ASKS_AN_AI = /^(?:(?:please|pls|hey|ok|okay)[\s,]+)?(?:(?:can|could|would)\s+you\s+)?(write|draft|create|make|generate|give|list|compose|summari[sz]e|explain|translate|plan|suggest|describe|rewrite)\b/i;

const CORRECTION = /\b(?:no,? wait|wait,? no|scratch that|sorry,? i meant?|i meant?,? no)\b/i;
const FILLER_WORD = /(?:^|[^\p{L}])(?:u+m+|u+h+|uhm+|erm+)(?=$|[^\p{L}])/iu;
/** Speech's filler that is a word: "how do they do it, like, without …". Set
 *  off by commas it is never the word they mean, and nobody types it. */
const SPOKEN_FILLER = /,\s*(?:like|you know)\s*,/i;
/** A sentence begun again with both goes kept: "how they are, how they can
 *  possibly …", "I was going to, I was going to call". The same two words
 *  open both, a few words apart. "Thank you, thank you" is said twice, not
 *  begun again, and is left alone. */
const RESTART = /(?<![\p{L}'])(\p{L}+)\s+(\p{L}+)(?:\s+[\p{L}']+){1,3},\s*\1\s+\2(?![\p{L}])/iu;
const OTHER_LETTERS = /(?=\p{L})[^\p{Script=Latin}]/u;
/** A language or an alphabet named anywhere in what they said. The code only
 *  recognises a request made in English at the end ("…write it in Hindi");
 *  "isko Hindi mein likho" is left to the model, and checking its answer
 *  against English letters would undo the very thing they asked for. */
const NAMES_A_LANGUAGE = /\b(?:hindi|english|angrezi|urdu|marathi|tamil|telugu|bengali|bangla|gujarati|punjabi|kannada|malayalam|spanish|french|german|arabic|devanagari|script|alphabet|translat\w*|lipi)\b|हिंदी|हिन्दी|अंग्रेज/i;

export function slipIn(
  message: string,
  out: string,
  o: { askedLanguage?: string; instructed?: boolean; piece?: boolean; toAnAi?: boolean; field?: boolean } = {},
): Slip | null {
  const said = message.trim();
  const wrote = out.trim();
  if (!said || !wrote) return null;
  if (o.toAnAi) {
    const verb = ASKS_AN_AI.exec(said)?.[1];
    if (verb && !new RegExp(`\\b${verb.slice(0, 5)}`, "i").test(wrote)) return "carried";
  }
  if (!o.askedLanguage && !NAMES_A_LANGUAGE.test(said)) {
    if (OTHER_LETTERS.test(wrote)) return "alphabet";
    // A PIECE THEY ASKED FOR IS NOT THEIR WORDS, so it cannot have translated
    // them: an email asked for in Hinglish is rightly written in English.
    // The alphabet still holds: a shayari asked for in English letters comes
    // back in them.
    if (o.piece) return null;
    const saidScript = detectScript(said);
    // Romanized Hindi in, none of it out: every one of those words was
    // replaced, which is what translating is.
    if (saidScript === "latin" && romanHindiHits(said) >= 2 && romanHindiHits(wrote) === 0) return "translated";
    // From another alphabet, their words spelled in English letters carry no
    // English grammar ("Naan konjam late-aa varuven"); a translation does.
    if (INDIC_SCRIPTS.has(saidScript) && wordCount(said) >= 4
      && romanHindiHits(wrote) === 0 && englishShare(wrote) >= 0.1) return "translated";
  }
  // The piece they asked for is MEANT to be longer than the asking. This line
  // read a finished poem as words nobody said, asked for it again, and kept
  // the shorter answer: the request, cleaned up, instead of the poem.
  if (!o.instructed && !o.piece && wordCount(wrote) > wordCount(said) * 1.6 + 6) return "added";
  if (CORRECTION.test(wrote) && CORRECTION.test(said)) return "correction";
  if (FILLER_WORD.test(wrote) && FILLER_WORD.test(said)) return "filler";
  // A piece they asked for may use either on purpose.
  if (!o.piece && !o.instructed) {
    if (SPOKEN_FILLER.test(wrote)) return "filler";
    if (RESTART.test(wrote) && RESTART.test(said)) return "restart";
  }
  if (!o.field && !o.instructed && !o.piece && !o.toAnAi) {
    // A question they are sending stays one: a question mark, or at least
    // the words that open it. The prompt says so ("a question they dictate
    // is a question they are sending") and lost three runs of three.
    if (OPENS_A_QUESTION.test(said) && !/[?？]/.test(wrote) && !OPENS_A_QUESTION.test(wrote)) return "question";
    // Thinking aloud can halve a dictation; a quarter left is the message
    // gone. Asked again, and kept only if the second answer is clean.
    if (wordCount(said) >= 4 && wordCount(wrote) * 4 < wordCount(said)) return "dropped";
  }
  if (hasPauseStop(wrote)) return "pause";
  // Every word that carried a stretch a pause cut short, gone from the
  // answer. A stem is enough to count as kept: "go" for "going" is the
  // writer's grammar, not a lost thought.
  if (!o.field) {
    const kept = (w: string) => new RegExp(`(?<![\\p{L}])${w.slice(0, 4)}`, "iu").test(wrote);
    if (pauseCutClauses(said).some((c) => { const ws = contentWords(c); return ws.length > 0 && !ws.some(kept); })) return "cut";
  }
  return null;
}

/** What the second ask says. Ours, so it is a plain turn, not fenced. */
export const REDO: Record<Slip, string> = {
  alphabet: "That is in another alphabet. Write their same words in English letters, the way they would type them: spell each word, never translate it.",
  translated: "That translated their words into English. Write their own words, in the language they spoke, only cleaned up, in English letters.",
  added: "That added words they did not say. Write only what they said.",
  correction: "They corrected themselves there: what came after \"no wait\" (or \"I mean\", \"scratch that\") replaces what came before it. Write the sentence once, with only the corrected version, and leave out the words that made the correction.",
  filler: "Filler went through (an \"um\", a spoken \"like\"). Leave it out.",
  restart: "A sentence they began again went through with both starts. Keep only the start they went on with, and write that sentence once.",
  long: "That is too long for what they asked. Write it much shorter, the length that kind of message really is.",
  pause: "A full stop is still where they only paused, in the middle of a sentence. Join that sentence across the pause, and end sentences only where they really end.",
  cut: "Words they said went missing where they paused. That full stop was a breath, not a false start: it is one sentence with what follows. Write it whole, joined across the pause.",
  empty: "That wrote nothing, but they did say something. Write what they said, as the message they meant.",
  carried: "That did what they asked. Here what they say is their prompt to an AI assistant: write the prompt itself, cleaned up, and do not carry it out.",
  question: "That turned their question into something else. They are asking someone this: write it as their question.",
  dropped: "That kept almost none of what they said. Only filler and thinking aloud go: the rest is their message, written whole.",
};

/**
 * Their own words, when they go out as they were said: a capital to start
 * and an end mark, as anyone typing would give them.
 *
 * Every fallback below sends what they SAID — a writer that translated twice,
 * a leaked prompt, a request carried out in an AI app, an empty answer — and
 * it arrived exactly as typed into the keyboard: "what time does the movie
 * start", lowercase and open-ended, which is what "it is not doing anything
 * at all" looks like from the field. Only English letters, only three words
 * or more, and no capital where it carries on a sentence already there. A
 * question mark only where it opens as a question, in English or Hinglish.
 *
 * "When", "where" and "how" open a question only with a verb after them:
 * "when is the meeting" asks, "when you get home call me" does not. "What a
 * day" is not a question either. The capital goes only on a plain lowercase
 * word ("iPhone", an address or a link keep theirs), and no full stop is put
 * on the end of an address or a link.
 */
const QUESTION_VERBS = "is|are|was|were|am|do|does|did|can|could|would|will|should|shall|has|have|had";
export const OPENS_A_QUESTION = new RegExp(
  "^(?:what(?!\\s+an?\\b)|whats|what's|why|who|whom|whose|which|kya|kab|kahan|kahaan|kaun|kyun|kyon|kaise|kitna|kitne|kitni"
  + `|(?:when|where)\\s+(?:${QUESTION_VERBS})|how\\s+(?:${QUESTION_VERBS}|much|many|long|far|old|often|come|about)`
  + "|(?:can|could|would|will|should|shall)\\s+(?:you|u|we|i)|(?:is|are|was|were)\\s+(?:it|this|that|there|you|they|we|he|she)"
  + "|(?:does|did|do)\\s+(?:you|u|it|he|she|they|we))\\b",
  "i",
);
