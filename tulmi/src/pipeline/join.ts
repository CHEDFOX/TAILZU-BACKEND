/**
 * TEXT THAT IS PASTED AFTER OTHER TEXT HAS TO JOIN IT.
 *
 * The desktop writes a dictation pause by pause: each stretch is uploaded on
 * its own, with what the session already wrote sent as `context`, and pasted
 * after it. Three things went wrong at every seam:
 *   - a stretch that carries on a sentence came back capitalised ("…and The
 *     deck"), because a writer handed a fragment writes a sentence;
 *   - a stretch cut at a pause came back with a full stop the speaker never
 *     reached ("I'm not a."), for the same reason;
 *   - nothing said whether a space belonged in between, so the client pasted
 *     none: "So see that andजिंदगी में."
 * The prompt now says the first two; these check them, because an instruction
 * the model keeps losing is checked in code (see cleanup.assist). The third is
 * a fact about two strings, answered here for the client as `joinWithSpace`.
 */

/** Marks that end a sentence, in the scripts we serve, with any closing quote. */
const SENTENCE_END = /[.!?…。！？।॥]["'”’»)\]]*$/u;

/**
 * Does `context` stop in the middle of a sentence, so what follows continues
 * it? A new line, a colon, or a finished sentence all mean no.
 */
export function continuesSentence(context?: string): boolean {
  const c = context ?? "";
  if (!c.trim() || /\n[^\S\n]*$/.test(c)) return false;
  const t = c.trimEnd();
  if (SENTENCE_END.test(t) || t.endsWith(":")) return false;
  return /[\p{L}\p{M}\p{N},;—–-]$/u.test(t);
}

/**
 * Words that never start a proper noun, so a capital on them mid-sentence is
 * only the writer (or the recogniser) starting a sentence that is not one.
 * Anything else — a name, "I", an acronym — keeps its capital: lowering
 * "Priya" would be worse than leaving "The".
 */
const CONTINUATION_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "so", "then", "to", "of", "in", "on", "at", "for",
  "with", "from", "by", "about", "as", "that", "which", "who", "whom", "whose", "because", "if",
  "when", "while", "where", "than", "is", "are", "was", "were", "be", "been", "being", "it", "its",
  "we", "you", "they", "he", "she", "him", "them", "us", "my", "your", "our", "their", "his", "her",
  "this", "these", "those", "there", "not", "also", "just", "even", "still", "yet", "too", "very",
  "really", "maybe", "until", "after", "before", "since", "though", "although", "unless", "whether",
  "into", "onto", "over", "under", "between", "through", "during", "without", "within", "could",
  "would", "should", "might", "must", "do", "does", "did", "have", "has", "had", "all", "some", "any",
  "no", "every", "each", "more", "most", "much", "many", "what", "how", "why", "here", "now",
  // Romanised Hindi/Urdu glue words, lowercase in a flowing Hinglish line.
  "aur", "lekin", "magar", "toh", "ki", "ke", "ka", "ko", "se", "mein", "par", "bhi", "hai", "hain",
  "tha", "thi", "nahi", "kyunki", "phir", "ya",
]);

/**
 * Words a sentence cannot end on, so a full stop after one was invented at a
 * pause: "I'm not a." / "So see that and." Deliberately few — "to", "for",
 * "with" and "of" can end a sentence ("Who is it for.") and are not here.
 */
const DANGLING = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "because", "my", "your", "our", "their", "its",
  "aur", "lekin", "magar", "kyunki", "और", "लेकिन", "मगर", "क्योंकि", "कि",
]);

/**
 * Shape a written stretch so it joins what came before: single spaces, no
 * capital on a word that only continues `context`'s unfinished sentence, and
 * no full stop after a word no sentence ends on.
 */
export function shapeForJoin(text: string, context?: string): string {
  let t = (text ?? "")
    .replace(/[^\S\n]+/g, " ")      // runs of spaces and tabs, never line breaks
    .replace(/ *\n */g, "\n")
    .trim();
  if (!t) return t;
  if (continuesSentence(context)) {
    const m = /^([A-Z])([a-z']*)(?=$|[^\p{L}])/u.exec(t);
    if (m && CONTINUATION_WORDS.has((m[1]! + m[2]!).toLowerCase())) {
      t = m[1]!.toLowerCase() + t.slice(1);
    }
  }
  // Lowercase as written: "Plan A." and "Vitamin A." are a letter, not an article.
  const end = /(?:^|[\s,;:—–-])([\p{L}\p{M}']+)([.।])$/u.exec(t);
  if (end && !/\.\.$/.test(t) && end[1] === end[1]!.toLowerCase() && DANGLING.has(end[1]!)) t = t.slice(0, -1);
  return t;
}

/**
 * A FULL STOP INSIDE A SENTENCE, LEFT BY A PAUSE.
 *
 * The live recognizer cuts speech at every pause and writes each piece as a
 * sentence of its own, and the keyboards join the pieces with a space: "I'm
 * going to the. Market tomorrow." The writer is told those stops are pauses
 * (assistPrompt.ts), but the one kind that is certainly wrong can be checked:
 * a full stop after a word no sentence ends on (DANGLING), followed by more
 * words. Lowercase only, as shapeForJoin reads it: "Plan A. Then" is a letter.
 */
const PAUSE_STOP = new RegExp(
  `(^|[\\s,;:—–-])(${[...DANGLING].join("|")})[.।]\\s+(\\p{L}[\\p{L}\\p{M}'’]*)`,
  "gu",
);

/** True when `text` has a full stop a pause put inside a sentence. */
export function hasPauseStop(text: string): boolean {
  PAUSE_STOP.lastIndex = 0;
  const hit = PAUSE_STOP.test(text ?? "");
  PAUSE_STOP.lastIndex = 0;
  return hit;
}

/**
 * Join a sentence across the pause stops in it: "going to the. Market" →
 * "going to the market". The word after keeps its capital when it is "I", an
 * acronym, or written capitalised elsewhere in the middle of a sentence —
 * then it is a name, and lowering "Priya" would be worse than the stop.
 */
export function joinPauseStops(text: string): string {
  if (!text || !hasPauseStop(text)) return text;
  return text.replace(PAUSE_STOP, (_m, sep: string, word: string, next: string) => {
    const keep = !/^\p{Lu}/u.test(next)
      || /^I(?:$|['’])/u.test(next)
      || (next.length > 1 && next === next.toUpperCase())
      || new RegExp(`[\\p{Ll},]\\s+${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{M}])`, "u").test(text);
    return `${sep}${word} ${keep ? next : next.charAt(0).toLowerCase() + next.slice(1)}`;
  });
}

/** Scripts written without spaces between words. */
const UNSPACED_CHAR = /[぀-ヿ㐀-鿿가-힯฀-๿　-〿＀-￯]/u;

/**
 * Should the client put a space between `context` (what is already there) and
 * `text` (what it is about to paste)? False when there is nothing to join,
 * when either side already brings its own separation, when `text` opens with
 * punctuation that belongs to the word before, or when both sides are in a
 * script written without spaces.
 */
export function joinWithSpace(context: string | undefined, text: string): boolean {
  const c = context ?? "";
  const t = (text ?? "").trim();
  if (!c.trim() || !t) return false;
  if (/\s$/.test(c)) return false;
  // Text that opens on a new line (a list after a sentence) brings its own
  // separation; a space before it would end the line above with one.
  if (/^[^\S\r\n]*[\r\n]/.test(text ?? "")) return false;
  if (/^[,.;:!?…%)\]}»”’。！？、，।॥]/u.test(t)) return false;
  if (/[(\[{«“‘¿¡]$/u.test(c)) return false;
  const last = [...c].pop() ?? "";
  const first = [...t][0] ?? "";
  // Hangul is spaced between words; Chinese, Japanese and Thai are not.
  const unspaced = (ch: string) => UNSPACED_CHAR.test(ch) && !/[가-힯]/u.test(ch);
  if (unspaced(last) && unspaced(first)) return false;
  return true;
}
