/**
 * What the recogniser is primed with: the scripts a person writes in and the words they use.
 */

import type { LanguageHint } from "../../../../shared/types/api.js";

/**
 * ALWAYS undefined — we never pin the recognizer to a language.
 *
 * This used to pass any non-"auto" hint straight into the provider's
 * `language` parameter, which PINS recognition to that one language. The hint
 * comes from a UI preference the user set once (the onboarding language
 * screen), so a user who tapped "Hindi" months ago had their English and
 * Marathi force-decoded as Hindi — and Hinglish, the flagship case, broke
 * outright, because a pinned decoder cannot switch languages mid-sentence.
 *
 * The product rule is that the BACKEND identifies the speech; we never rely on
 * the user having declared it. So the hint is now a soft bias in the prompt
 * (see sttPrompt) — it nudges spelling and script without ever constraining
 * what the model is allowed to hear.
 */
export function sttLanguage(_hint: LanguageHint | undefined): string | undefined {
  return undefined;
}

// The prompt is a STYLE EXEMPLAR, not an instruction — Whisper-family models
// continue its register, script, and punctuation habits. So it does three
// jobs: warn about code-switching, and (critically for Indian users) pin the
// SCRIPT. Left alone, these models transliterate Latin-script Hinglish into
// Devanagari on a whim, which then propagates through cleanup and lands as
// text the user didn't write. Naming the languages we serve most also lifts
// recognition on them.
/**
 * Whisper's prompt biases spelling/vocabulary — fold in the user's dictionary
 * and (softly) whatever language they tend to speak.
 *
 * The language hint lands HERE rather than in the provider's `language`
 * parameter: as prose it nudges the decoder toward the right vocabulary and
 * script while leaving it free to hear whatever was actually said, including a
 * different language or a mid-sentence switch. Pinning the parameter does the
 * opposite — it forecloses detection entirely (see sttLanguage).
 */
/**
 * A short line of ordinary text in the language — and, above all, the
 * SCRIPT — the speaker is likely to use. Whisper's prompt is not an
 * instruction channel: the decoder treats it as the transcript that came
 * just before, and continues in the same language and script. A paragraph of
 * English instructions therefore did the opposite of what it said — it told
 * the decoder the preceding speech was English, and Hindi came back
 * romanized, or translated, or as a mix of both. Exemplars carry no
 * instructions at all; they only set the script.
 */
const SCRIPT_EXEMPLARS: Record<string, string> = {
  hi: "हाँ, कल सुबह मिलते हैं।",
  mr: "हो, उद्या सकाळी भेटू.",
  ta: "சரி, நாளை காலை சந்திப்போம்.",
  te: "సరే, రేపు ఉదయం కలుద్దాం.",
  bn: "ঠিক আছে, কাল সকালে দেখা হবে।",
  gu: "હા, કાલે સવારે મળીએ.",
  pa: "ਹਾਂ, ਕੱਲ੍ਹ ਸਵੇਰੇ ਮਿਲਦੇ ਹਾਂ।",
  kn: "ಸರಿ, ನಾಳೆ ಬೆಳಿಗ್ಗೆ ಭೇಟಿಯಾಗೋಣ.",
  ml: "ശരി, നാളെ രാവിലെ കാണാം.",
  ur: "ٹھیک ہے، کل صبح ملتے ہیں۔",
  // Romanized by choice: Hinglish speakers want Latin script back.
  hinglish: "Haan, kal subah milte hain office mein.",
  en: "Yes, let's meet tomorrow morning.",
  es: "Sí, nos vemos mañana por la mañana.",
  fr: "Oui, on se voit demain matin.",
  de: "Ja, wir sehen uns morgen früh.",
  pt: "Sim, vamos nos ver amanhã de manhã.",
  ar: "نعم، نلتقي غدًا صباحًا.",
  ja: "はい、明日の朝に会いましょう。",
  ko: "네, 내일 아침에 만나요.",
  zh: "好的，明天早上见。",
  ru: "Да, увидимся завтра утром.",
};

/**
 * What Whisper is told before it listens.
 *
 * With a language hint: a short exemplar in that language's script, then
 * the user's dictionary terms. With "auto": the terms alone — no prose in any
 * language, so nothing tips the decoder before it has heard a word. Empty
 * when there is nothing to say; the SDK omits an undefined prompt.
 */
/**
 * The words this person actually reaches for, pulled out of their portrait.
 *
 * The portrait is worth giving the recognizer — it is the only record of how
 * this user talks — but NOT as prose. Whisper's prompt is not an instruction
 * channel: the decoder treats it as the transcript that came just before and
 * continues it. Hand it "Short sentences. Lowercase openers. Says 'yaar'." and
 * you have told the decoder the speaker was just describing someone, which is
 * both useless and echoable.
 *
 * What IS the right shape is their vocabulary, and a portrait is full of it —
 * the writing model is asked for observable habits, so it quotes the words
 * they use. Those quoted spans are exactly what biasing wants: real terms, in
 * their script, with no sentence around them to continue.
 *
 * Capped at eight. The prompt is a short run-up; past that it stops biasing
 * and starts competing with the audio.
 */
export function portraitTerms(
  portraitCore?: string,
  /** The portrait's own word list, when it has one. Far better than scraping
   *  the prose: these are already the exact terms, already deduped, already in
   *  the user's script — and they accumulate across sessions rather than
   *  surviving only as long as the last rewrite happened to mention them. */
  words?: Array<{ term: string }>,
): string | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words ?? []) {
    const term = w?.term?.trim();
    const key = term?.toLowerCase();
    if (!term || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 8) return out.join(", ");
  }
  const core = portraitCore?.trim();
  if (!core) return out.length ? out.join(", ") : undefined;
  // Straight and curly quotes, single and double. The portrait model uses all
  // of them, and which one it picks is not something to depend on.
  for (const m of core.matchAll(/['"\u2018\u2019\u201C\u201D]([^'"\u2018\u2019\u201C\u201D]{1,40})['"\u2018\u2019\u201C\u201D]/g)) {
    const term = m[1].trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 8) break;
  }
  return out.length ? out.join(", ") : undefined;
}

export function sttPrompt(
  vocabulary?: string,
  hint?: LanguageHint,
  languages?: string[],
  portraitCore?: string,
  portraitWords?: Array<{ term: string }>,
): string | undefined {
  // The user's own set leads; the single hint is the fallback for anyone who
  // has not answered the Languages card. Capped at three: the prompt is a
  // short run-up, and past that it starts to read as a passage of its own.
  const keys = (languages?.length ? languages : hint ? [hint] : [])
    .map((l) => String(l).toLowerCase())
    .filter((l) => l && l !== "auto");
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const k of keys) {
    // Own keys only: a language called "constructor" is not an exemplar.
    const ex = Object.hasOwn(SCRIPT_EXEMPLARS, k) ? SCRIPT_EXEMPLARS[k] : undefined;
    if (!ex || seen.has(k)) continue;
    seen.add(k);
    parts.push(ex);
    if (seen.size >= 3) break;
  }
  const terms = vocabulary?.replace(/\s*\n\s*/g, ", ").trim();
  if (terms) parts.push(terms);
  // Their own words, after their own dictionary. The dictionary is what they
  // told us to spell correctly; these are what they were observed to say.
  const learned = portraitTerms(portraitCore, portraitWords);
  if (learned) parts.push(learned);
  return parts.length ? parts.join(" ") : undefined;
}
