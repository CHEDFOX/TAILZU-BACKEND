/**
 * How English, Roman Hindi and transliteration show in a transcript.
 */

import { ROMAN_HINDI, romanHindiHits, detectScript, INDIC_SCRIPTS } from "../script.js";

/**
 * Do two transcripts say the same thing? Compared on content alone —
 * lowercased, punctuation stripped, whitespace collapsed — because the
 * providers differ constantly in casing and comma placement, and those
 * differences are not worth a second opinion.
 */


/**
 * English words so common that seeing several means English is really there,
 * not that one loanword drifted in. Function words only: "deploy", "testing"
 * and "meeting" are English too and are exactly the words a Hindi sentence
 * borrows, so counting them would call almost anything mixed.
 */
const ENGLISH_FUNCTION = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "am",
  "and", "but", "or", "so", "if", "then", "than", "because",
  "of", "to", "in", "on", "at", "for", "with", "from", "by", "about",
  "this", "that", "these", "those", "it", "its",
  "we", "you", "they", "he", "she", "i", "me", "my", "your", "our", "their",
  "will", "would", "can", "could", "should", "have", "has", "had",
  "not", "no", "do", "does", "did", "get", "got", "done",
]);

/**
 * One sentence, two languages, one script — the case nothing else can see.
 *
 * The writing step is told the user's SCRIPT as a measured fact, and that
 * fixed romanized Hindi being pushed into Devanagari. It cannot help here:
 * "the deploy is done but abhi testing baaki hai" is Latin from end to end, so
 * the fact is true and says nothing, and the model repairs whichever language
 * is outnumbered. It came back "The deploy is done, but testing is still
 * pending." on the deployed server, three runs out of three, with a rule in
 * the prompt explicitly forbidding it.
 *
 * So this measures the mixture too, and states it. BOTH sides have to be
 * clearly present — two Hindi markers and two English function words — because
 * the cost of a false positive is telling someone writing plain English that
 * they are writing two languages.
 */
/** How much of this is English function words, 0..1. Several of them mean the
 *  sentence's grammar is English, whatever nouns it borrows. */
export function englishShare(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words?.length) return 0;
  return words.filter((w) => ENGLISH_FUNCTION.has(w)).length / words.length;
}

export function mixesEnglishAndRomanHindi(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words || words.length < 4) return false;
  let hindi = 0;
  let english = 0;
  for (const w of words) {
    if (ROMAN_HINDI.has(w)) hindi++;
    else if (ENGLISH_FUNCTION.has(w)) english++;
  }
  return hindi >= 2 && english >= 2;
}

/**
 * How much of this reads as romanized Hindi, 0..1.
 *
 * A fraction rather than a count, because the two transcripts of one utterance
 * can differ in length and a longer wrong reading should not win on volume.
 */
export function romanHindiScore(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words?.length) return 0;
  return romanHindiHits(text) / words.length;
}


/**
 * Did the writer re-spell their words in another alphabet?
 *
 * TRANSLITERATION, NOT TRANSLATION, AND THE DIFFERENCE IS WHAT MAKES THIS
 * SAFE TO ENFORCE. "mujhe kal subah jaldi uthna hai" coming back as
 * "मुझे कल सुबह जल्दी उठना है।" is the same words in a different script —
 * nobody asked for that, and the prompt has forbidden it in four different
 * wordings across as many deployed runs, holding sometimes and not others.
 *
 * Someone asking to be written in Hindi is a different thing and must keep
 * working, so the test is narrow: their text was Latin, it carried romanized
 * Indic words, and what came back is in an Indic script. A request to
 * translate English prose has no such markers and is untouched.
 *
 * The one case this catches wrongly is someone dictating Hinglish and asking,
 * in that same sentence, to be written in Devanagari. They get their own
 * words back unchanged, which is the same thing every other guard here does.
 */
export function transliterated(input: string, output: string): boolean {
  if (!input.trim() || !output.trim()) return false;
  if (detectScript(input) !== "latin") return false;
  if (!INDIC_SCRIPTS.has(detectScript(output))) return false;
  return romanHindiHits(input) >= 2;
}

/**
 * Does the shadow read as romanized Hindi where the primary does not?
 *
 * Deliberately asymmetric. Leading with the wrong engine is the expensive
 * mistake — the refine is told candidate 1 is the more reliable recognizer —
 * so the shadow has to be CLEARLY better, not merely ahead. A margin rather
 * than a comparison is what keeps one shared word from deciding anything.
 */
export function readsAsRomanHindi(primary: string, shadow: string): boolean {
  const p = romanHindiScore(primary);
  const s = romanHindiScore(shadow);
  // At least two words in ten, and at least double the other reading. One
  // marker in a long English sentence is a name or a loanword, not a language.
  return s >= 0.2 && s >= p * 2 + 0.08;
}

/**
 * Has THIS engine's reading earned the live stream from the other one?
 *
 * Live dictation runs two engines and only one of them reaches the user's
 * cursor. Deciding that up front is impossible — you cannot route by language
 * before you have heard the language — but a committed segment is evidence,
 * and a native Indic script is the strongest kind: the generalist does not
 * spontaneously emit Devanagari. When one engine produces it and the other
 * does not, the one that did recognised the speech; the other approximated it.
 *
 * Two guards keep this from firing on noise. The other engine must have said
 * something already, because being first to speak is not evidence of being
 * right. And its reading must be in a different script, because two engines
 * agreeing on Devanagari is not a reason to swap between them.
 *
 * Romanized Hinglish has no script to see and never triggers this. That case
 * stays with whichever engine is primary.
 */
export function leadsOnScript(mine: string, theirs: string): boolean {
  if (!mine.trim() || !theirs.trim()) return false;
  if (INDIC_SCRIPTS.has(detectScript(theirs))) return false;   // they already have it
  if (INDIC_SCRIPTS.has(detectScript(mine))) return true;      // script is decisive
  // NO SCRIPT ON EITHER SIDE — romanized Hinglish, the case this used to leave
  // to whichever engine an operator had named primary. Decided on the words
  // instead, so which engine leads never depends on a guess about traffic.
  return readsAsRomanHindi(theirs, mine);
}
