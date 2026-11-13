/**
 * MARKING AN ANSWER, ON THE SERVER, ALWAYS.
 *
 * Duolingo marks in the app and believes what the app sends back; that is why a few hundred lines of Python can farm
 * its XP all day. Nothing here runs on a phone. The app sends what the person did, this works out what it was worth,
 * and the app is never asked whether it was right.
 *
 * The band that decides whether a language app feels fair is `close`: a missing accent or one slipped letter means
 * they knew the word. Marking that wrong is untrue, and it is the fastest way to make somebody stop. Marking it right
 * teaches the mistake. So it is its own answer, with the reason, and the scheduler treats it as Hard (schedule.ts).
 *
 * EVERY SCRIPT IS A FIRST-CLASS SCRIPT HERE. No language is the one this was built for and the others bolted on: the
 * rules below are about writing systems, not about particular languages, and the ones that are not alphabets get as
 * much care as the ones that are.
 *
 * Pure: strings in, a mark out. No clock, no store, no model, and no English — the reason is a code the screens word
 * in the person's own language (types.ts MarkReason).
 */
import type { Mark, MarkReason, Verdict } from "./types.js";

/**
 * Anything that is not a letter, a number, A MARK or a space, in any script.
 *
 * `\p{M}` is not decoration and leaving it out is not a small mistake. In an abugida or an abjad the vowels ARE
 * marks: without it this expression eats them, and "कॉफ़ी" comes out as two bare consonants,
 * "காபி" likewise, and a vocalised "قَهْوَة" comes apart into
 * single letters. Both sides of a comparison are spoilt the same way, so an exact match still passes and nothing
 * looks broken — while different words quietly collapse onto each other, and Arabic written the ordinary way,
 * without its harakat, is marked wrong against an answer that carries them.
 */
const NOT_WORD = /[^\p{L}\p{N}\p{M}\s]/gu;

/**
 * THE MARKS A WRITER ROUTINELY LEAVES OFF. Dropping one of these is at worst a slip and usually not even that, so
 * `fold` takes them away before comparing: the accents of the Latin, Greek and Cyrillic scripts, the Arabic harakat
 * (hardly ever written outside scripture and schoolbooks), the Hebrew niqqud, and the Indic nukta.
 *
 * The Indic VOWEL SIGNS are deliberately not in here. Unicode files them as marks and they are nothing of the kind:
 * drop one and the word is a different word.
 */
const OPTIONAL_MARKS: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],                   // the accents of the Latin, Greek and Cyrillic scripts
  [0x0483, 0x0489],                   // Cyrillic
  [0x0591, 0x05c7],                   // Hebrew: niqqud and cantillation, written in scripture and for learners
  [0x064b, 0x065f], [0x0670, 0x0670], // Arabic harakat, hardly ever written outside scripture and schoolbooks
  [0x06d6, 0x06ed],                   // Quranic annotation
  [0x093c, 0x093c], [0x0951, 0x0954], // Devanagari: the nukta and the Vedic accents
  [0x09bc, 0x09bc], [0x0a3c, 0x0a3c], // Bengali and Gurmukhi nukta
  [0x0abc, 0x0abc], [0x0b3c, 0x0b3c], // Gujarati and Oriya nukta
  [0x0cbc, 0x0cbc],                   // Kannada nukta
];

const isOptionalMark = (cp: number): boolean => OPTIONAL_MARKS.some(([lo, hi]) => cp >= lo && cp <= hi);

/** Scripts written a character at a time, each one a word or a piece of one, chosen off a list rather than spelt. */
const BY_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Lower case, no punctuation, single spaces. Keeps every mark, so a word in any script survives it whole. */
export function tidy(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(NOT_WORD, " ").replace(/\s+/g, " ").trim();
}

/** As `tidy`, with the marks a writer leaves off taken away: "cafe" either way, and Arabic with or without harakat. */
export function fold(s: string): string {
  let out = "";
  for (const ch of tidy(s).normalize("NFD")) if (!isOptionalMark(ch.codePointAt(0)!)) out += ch;
  return out.normalize("NFC");
}

/**
 * How many slips turn one string into the other, giving up once it is past `cap`. Bounded because an answer box can
 * hold anything and we only ever care about "near" or "not".
 *
 * TWO NEIGHBOURS SWAPPED COUNTS AS ONE SLIP, not two. It is the commonest typing mistake there is ("gracais" for
 * "gracias"), and counting it as two puts it outside every budget a short answer has, which would mark the most
 * ordinary slip of all as not knowing the word.
 */
export function distance(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * HOW MANY SLIPS AN ANSWER IS ALLOWED, by the writing system it is in.
 *
 * A character-by-character script gets NONE. Chinese, Japanese and Korean are not spelt out letter by letter; each
 * character is picked whole off a candidate list, so a slipped stroke is not a thing that happens and a neighbouring
 * character is simply a different word.
 *
 * A short alphabetic answer gets none either, for the same reason in a different shape: in most languages a
 * four-letter word one letter away from the answer is a DIFFERENT WORD ("gato" and "pato"), and calling that a typo
 * would teach the wrong one. Only once an answer is long enough for a slip to be obviously a slip does it get room.
 */
export function slipBudget(text: string): number {
  if (BY_CHARACTER.test(text)) return 0;
  const len = text.length;
  if (len < 5) return 0;
  if (len < 16) return 1;
  if (len < 28) return 2;
  return 3;
}

const mark = (verdict: Verdict, matched: string | null, why: MarkReason): Mark => ({ verdict, matched, why });

/** The longer of two strings: whichever one a slip budget should be measured against. */
const longer = (a: string, b: string): string => (a.length >= b.length ? a : b);

/**
 * A TYPED ANSWER against every answer we accept. The accepted list is the point: one prompt almost always has several
 * right answers, and a grader that knows only one is the single most common reason a learner is told they are wrong
 * when they are not.
 *
 * In order: exactly right once punctuation and case are set aside; right but for the marks a writer leaves off; right
 * but for a slip of the finger. Anything else is a different answer.
 */
export function gradeText(said: string, accepted: readonly string[]): Mark {
  const a = tidy(said);
  if (!a) return mark("wrong", null, "silence");
  const list = accepted.filter((x) => x.trim());
  if (!list.length) return mark("wrong", null, "word");

  for (const acc of list) if (a === tidy(acc)) return mark("right", acc, "");
  const folded = fold(said);
  for (const acc of list) if (folded === fold(acc)) return mark("close", acc, "accent");

  let best: { acc: string; d: number } | null = null;
  for (const acc of list) {
    const t = fold(acc);
    const cap = slipBudget(longer(folded, t));
    if (cap < 1) continue;
    const d = distance(folded, t, cap);
    if (d <= cap && (!best || d < best.d)) best = { acc, d };
  }
  if (best) return mark("close", best.acc, "spelling");

  // The right words, put in the wrong order, is a different mistake from not knowing them, and worth saying so. A
  // script that does not put spaces between its words simply never matches here, which is the right answer for it.
  for (const acc of list) {
    const want = fold(acc).split(" ").filter(Boolean);
    const got = folded.split(" ").filter(Boolean);
    if (want.length > 1 && want.length === got.length && [...want].sort().join(" ") === [...got].sort().join(" ")) {
      return mark("close", acc, "order");
    }
  }
  return mark("wrong", null, "word");
}

/**
 * WHAT THEY SAID OUT LOUD, as speech-to-text heard it. Graded more kindly than typing on purpose: speech-to-text
 * drops the marks a writer leaves off, invents punctuation and mishears small words, and none of that is the
 * learner's fault. Spelling is not being tested here — saying it is.
 *
 * A character-by-character script is the exception, and gets no extra room: the machine in the middle does not slip
 * a stroke, so a different character is a different word however it arrived.
 */
export function gradeSpoken(transcript: string, accepted: readonly string[]): Mark {
  const heard = fold(transcript);
  if (!heard) return mark("wrong", null, "silence");
  const list = accepted.filter((x) => x.trim());
  if (!list.length) return mark("wrong", null, "word");

  for (const acc of list) if (heard === fold(acc)) return mark("right", acc, "");

  let best: { acc: string; d: number } | null = null;
  for (const acc of list) {
    const t = fold(acc);
    const base = slipBudget(longer(heard, t));
    if (base === 0) continue;
    // One slip more than typing would get, because the machine in the middle makes its own.
    const cap = base + 1;
    const d = distance(heard, t, cap);
    if (d <= cap && (!best || d < best.d)) best = { acc, d };
  }
  if (best) return mark(best.d <= 1 ? "right" : "close", best.acc, best.d <= 1 ? "" : "spelling");
  return mark("wrong", null, "word");
}

/** One of a few offered meanings. Nothing to be kind about: they picked it or they did not. */
export function gradeChoice(picked: number, correct: number, options: readonly string[] = []): Mark {
  const ok = picked === correct;
  return mark(ok ? "right" : "wrong", ok ? (options[correct] ?? null) : null, ok ? "" : "word");
}

/**
 * THE GIVEN WORDS PUT IN ORDER. The words are handed to them, so the only thing being tested is the order; a slip of
 * the finger is not possible and nothing is forgiven. The right words in the wrong order is still its own reason.
 */
export function gradeChips(picked: readonly string[], accepted: readonly (readonly string[])[]): Mark {
  const got = picked.map(fold).filter(Boolean);
  if (!got.length) return mark("wrong", null, "silence");
  for (const acc of accepted) {
    const want = acc.map(fold).filter(Boolean);
    if (want.length === got.length && want.every((w, i) => w === got[i])) return mark("right", acc.join(" "), "");
  }
  for (const acc of accepted) {
    const want = [...acc.map(fold).filter(Boolean)].sort().join(" ");
    if (want && want === [...got].sort().join(" ")) return mark("close", acc.join(" "), "order");
  }
  return mark("wrong", null, "word");
}
