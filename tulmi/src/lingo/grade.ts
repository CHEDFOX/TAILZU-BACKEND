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
 * Pure: strings in, a mark out. No clock, no store, no model, and no English — the reason is a code the screens word
 * in the person's own language (types.ts MarkReason).
 */
import type { Mark, MarkReason, Verdict } from "./types.js";

/** Marks over letters, as Unicode keeps them once a string is taken apart. */
const COMBINING = /[̀-ͯ]/g;
/** Anything that is not a letter, a number or a space, in any script. */
const NOT_WORD = /[^\p{L}\p{N}\s]/gu;

/** Lower case, no punctuation, single spaces. Keeps the marks over letters: "café" stays "café". */
export function tidy(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(NOT_WORD, " ").replace(/\s+/g, " ").trim();
}

/** Lower case, no punctuation, single spaces, and the marks over letters taken off: "café" becomes "cafe". */
export function fold(s: string): string {
  return tidy(s).normalize("NFD").replace(COMBINING, "").normalize("NFC");
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
 * HOW MANY SLIPS A TYPED ANSWER IS ALLOWED. Short answers get none, and that is deliberate: in most languages a
 * four-letter word one letter away from the answer is a DIFFERENT WORD ("gato" and "pato"), and calling that a typo
 * would teach the wrong one. Only once an answer is long enough for a slip to be obviously a slip does it get room.
 */
export function slipBudget(len: number): number {
  if (len < 5) return 0;
  if (len < 16) return 1;
  if (len < 28) return 2;
  return 3;
}

const mark = (verdict: Verdict, matched: string | null, why: MarkReason): Mark => ({ verdict, matched, why });

/**
 * A TYPED ANSWER against every answer we accept. The accepted list is the point: one prompt almost always has several
 * right answers, and a grader that knows only one is the single most common reason a learner is told they are wrong
 * when they are not.
 *
 * In order: exactly right once punctuation and case are set aside; right but for the marks over the letters; right
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
    const cap = slipBudget(Math.max(folded.length, t.length));
    if (cap < 1) continue;
    const d = distance(folded, t, cap);
    if (d <= cap && (!best || d < best.d)) best = { acc, d };
  }
  if (best) return mark("close", best.acc, "spelling");

  // The right words, put in the wrong order, is a different mistake from not knowing them, and worth saying so.
  for (const acc of list) {
    const want = fold(acc).split(" ").filter(Boolean).sort().join(" ");
    const got = folded.split(" ").filter(Boolean).sort().join(" ");
    if (want && want === got) return mark("close", acc, "order");
  }
  return mark("wrong", null, "word");
}

/**
 * WHAT THEY SAID OUT LOUD, as speech-to-text heard it. Graded more kindly than typing on purpose: speech-to-text
 * drops the marks over letters, invents punctuation and mishears small words, and none of that is the learner's
 * fault. Spelling is not being tested here — saying it is.
 */
export function gradeSpoken(transcript: string, accepted: readonly string[]): Mark {
  const heard = fold(transcript);
  if (!heard) return mark("wrong", null, "silence");
  const list = accepted.filter((x) => x.trim());
  if (!list.length) return mark("wrong", null, "word");

  for (const acc of list) if (heard === fold(acc)) return mark("right", acc, "");

  // One slip more than typing would get, because the machine in the middle makes its own.
  let best: { acc: string; d: number } | null = null;
  for (const acc of list) {
    const t = fold(acc);
    const cap = slipBudget(Math.max(heard.length, t.length)) + 1;
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
