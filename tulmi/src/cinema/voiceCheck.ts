/**
 * THE VOICE-OVER, HEARD BACK. A film's narration is read by a machine and nobody listens to it before it is cut in: a line that came out
 * wrong is found by the person, in the finished film. So every voice-over is transcribed back and compared with what it was meant to say.
 *
 * What actually goes wrong, and what this catches:
 *   - a NUMBER read as another number ("ninety-nine rupees" heard as "nineteen rupees"). The worst of them: it is the one thing in an ad
 *     that must be exactly right, and it is the hardest to hear by eye in a transcript. Always a failure, however close the rest is.
 *   - a number dropped altogether.
 *   - words skipped, or a sentence cut short, which the speech engines do on long lines.
 *
 * What this must NOT do is cry wolf: every failure costs a re-record, and the recogniser makes mistakes of its own.
 *
 *   SCRIPTS. A Hinglish line is written in Latin letters ("Har baarish ki ek kahani") and comes back from the recogniser in Devanagari
 *   ("हर बारिश की एक कहानी") about as often as not. The words are right; the letters are not comparable. So when the two sides are in
 *   different scripts, the words are not compared at all: the numbers are (they survive transliteration, both sides being read as values),
 *   and so is roughly how much was said. Comparing the letters there would fail every Hindi line in the catalogue.
 *   SPELLING. Hinglish has no settled spelling: kahani, kahaani, kahānī. Within one script the words are compared by similarity, never
 *   exactly, for the same reason.
 *
 * `compareSaid` is pure, so every rule above is a test (tests/cinema-voice.test.ts). The recogniser is a port the service fills with the
 * server's own speech-to-text (pipeline/stt.ts), so this costs no new service and no model of its own.
 */

/** A word and when it was said, when the recogniser reports it (soft subtitles are timed from these: cut.ts). */
export interface SaidWord { word: string; start: number; end: number }

export interface Heard {
  text: string;
  words?: SaidWord[];
  seconds?: number;
}

export type VoiceFault = "number" | "missing" | "short" | "empty";

export interface VoiceVerdict {
  ok: boolean;
  /** Why it failed, in words for the person; empty when it passed. */
  why: string;
  fault?: VoiceFault;
  /** How alike the two readings are, 0 to 1 (1 when the scripts differ and only the numbers could be compared). */
  likeness: number;
  /** The scripts were different, so only the numbers and the length were compared. */
  crossScript: boolean;
}

/** Below this, within one script, the line was not said as written. */
export const LIKENESS_MIN = 0.86;
/** A reading this much shorter than the words asked for has dropped something, whatever the recogniser wrote. */
export const SHORT_AT = 0.72;

// ---------------------------------------------------------------------------------------------------------------------------- the numbers

/**
 * Number words that are ordinary words too, and so are never failed on. "do" and "no" are the Hindi two and nine and the commonest English
 * verb and refusal; "sat" and "char" are English words of their own. They are still read as numbers when the two readings are compared
 * word for word (both sides the same way, so nothing is lost), but a line is never failed because one of them was heard differently.
 */
const SOFT = new Set(["do", "no", "sat", "char", "che", "ath", "bis", "tis", "one", "ek", "शून्य", "एक"]);

/** 0 to 20, the tens, and the multipliers, in English and in Hindi, written both ways. A number past these is written in digits anyway. */
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Hinglish, as people type it: the spellings that differ by a vowel are all here, because the recogniser picks one and the writer another.
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, che: 6, chah: 6, saat: 7, sat: 7, aath: 8, ath: 8,
  nau: 9, no: 9, das: 10, dus: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19,
  bees: 20, bis: 20, tees: 30, tis: 30, chalis: 40, chalees: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  // Devanagari.
  "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छे": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
  "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20,
  "तीस": 30, "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90,
};

/** Words that multiply what came before them. */
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, lakh: 100_000, lac: 100_000, crore: 10_000_000, million: 1_000_000, billion: 1_000_000_000,
  sau: 100, hazaar: 1_000, hazar: 1_000, hajaar: 1_000, karod: 10_000_000,
  "सौ": 100, "हज़ार": 1_000, "हजार": 1_000, "लाख": 100_000, "करोड़": 10_000_000, "करोड": 10_000_000,
};

/** Devanagari digits, and the Arabic ones, as plain digits. */
const digitsOf = (s: string): string => s.replace(/[०-९]/g, (d) => String(d.codePointAt(0)! - 0x0966));

/**
 * A line read as a run of words and numbers: every number, however it was written, becomes its value. So "99", "ninety nine", "ninyanve"
 * and "निन्यानवे" are one and the same thing, and a line written one way and heard the other still agrees, word for word.
 */
export interface Said { v: number; soft: boolean }
export const isNumber = (x: string | Said): x is Said => typeof x !== "string";

export function read(text: string): (string | Said)[] {
  const words = tokens(text);
  const out: (string | Said)[] = [];
  let run = 0;
  let has = false;
  let soft = false;
  const flush = () => {
    if (has) out.push({ v: run, soft });
    run = 0;
    has = false;
    soft = false;
  };
  for (const w of words) {
    const plain = w.replace(/[,%]/g, "");
    if (/^\d+(\.\d+)?$/.test(plain)) {
      flush();
      out.push({ v: Number(plain), soft: false });
      continue;
    }
    const unit = UNITS[w];
    if (unit !== undefined) {
      // "twenty two" is one number, "two two" (a telephone number read out) is two of them.
      if (has && run % 10 === 0 && run >= 20 && unit < 10) run += unit;
      else if (has && run >= 100 && unit < 100) run += unit;
      else { flush(); run = unit; }   // the flush clears `soft`, so the word's own doubt is marked after it
      has = true;
      if (SOFT.has(w)) soft = true;
      continue;
    }
    const scale = SCALES[w];
    if (scale !== undefined) {
      run = (has && run > 0 ? run : 1) * scale;
      has = true;
      // A scale makes it a number beyond doubt: "do sau" is five hundred, not the verb.
      soft = false;
      continue;
    }
    // "and" between the parts of one number ("a hundred and five") joins them; anywhere else it is just a word.
    if ((w === "and" || w === "aur" || w === "और") && has) continue;
    flush();
    out.push(w);
  }
  flush();
  return out;
}

/**
 * The numbers a line must get right, as values, in the order they are said: the ones written beyond doubt. One is left out (in Hindi "ek"
 * is the article as much as the number, and in English "one" is a pronoun), and so are the words of SOFT.
 */
export const numbersIn = (text: string): number[] => read(text).filter((x) => isNumber(x) && !x.soft && x.v !== 1).map((x) => (x as Said).v);

/** A line as words with its numbers written as digits, so that the two readings are compared the same way. */
export const saidWords = (text: string): string[] => read(text).map((x) => (isNumber(x) ? String(x.v) : x));

// ---------------------------------------------------------------------------------------------------------------------------- the words

const PUNCT = /[.,!?;:"'“”‘’()\[\]—–\-…。，！？；：、「」『』]/g;

/** A line as comparable words: no punctuation, one case, Devanagari digits as digits. */
export function tokens(text: string): string[] {
  return digitsOf(text).toLowerCase().replace(PUNCT, " ").split(/\s+/).filter(Boolean);
}

export type Script = "latin" | "devanagari" | "cjk" | "other";

/** Which script a line is mostly written in. */
export function scriptOf(text: string): Script {
  let latin = 0, deva = 0, cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++;
    else if (c >= 0x0900 && c <= 0x097f) deva++;
    else if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af)) cjk++;
  }
  const most = Math.max(latin, deva, cjk);
  if (most === 0) return "other";
  return most === deva ? "devanagari" : most === cjk ? "cjk" : "latin";
}

/**
 * How alike two readings are, 0 to 1: the longest run of words they share, both ways. A word heard a little differently (kahani, kahaani)
 * counts as the same when its letters nearly match, which is what a transliterated language needs.
 */
export function likeness(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  // The longest common subsequence, words counted as equal when they are close enough.
  const n = a.length, m = b.length;
  let prev = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const row = new Array<number>(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      row[j] = near(a[i - 1]!, b[j - 1]!) ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!);
    }
    prev = row;
  }
  return (2 * prev[m]!) / (n + m);
}

/** Two words near enough to be the same one: equal, or differing by a letter or two in a word long enough for that to be spelling. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  const allowed = a.length >= 7 ? 2 : a.length >= 4 ? 1 : 0;
  return allowed > 0 && distance(a, b) <= allowed;
}

/** How many letters apart two words are (capped: the caller only cares about small numbers). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...new Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

// ---------------------------------------------------------------------------------------------------------------------------- the verdict

/**
 * What was meant against what was heard. `heardAs` overrides the expected words for a line the recogniser always writes another way (a
 * name, a made-up word): the voice is still checked, against the spelling it really comes back in.
 */
export function compareSaid(said: string, heard: string, o: { heardAs?: string | null } = {}): VoiceVerdict {
  const want = (o.heardAs?.trim() || said).trim();
  const wantWords = saidWords(want);
  const gotWords = saidWords(heard);
  if (!gotWords.length) {
    return { ok: false, why: "Nothing was heard in the recording.", fault: "empty", likeness: 0, crossScript: false };
  }

  // The numbers first: they survive any script and any spelling, and a wrong one is always a failure.
  const wantNums = numbersIn(want);
  const gotNums = numbersIn(heard);
  for (const [i, n] of wantNums.entries()) {
    const at = gotNums[i];
    if (at === undefined) return { ok: false, why: `"${n}" was not said.`, fault: "missing", likeness: 0, crossScript: false };
    if (at !== n) return { ok: false, why: `"${n}" was read as "${at}".`, fault: "number", likeness: 0, crossScript: false };
  }

  const crossScript = scriptOf(want) !== scriptOf(heard);
  // Different scripts (a Hinglish line heard back in Devanagari): the letters cannot be compared, so only how much was said is.
  if (crossScript) {
    const ratio = gotWords.length / Math.max(1, wantWords.length);
    if (ratio < SHORT_AT) return { ok: false, why: "The recording stops before the line does.", fault: "short", likeness: 1, crossScript };
    return { ok: true, why: "", likeness: 1, crossScript };
  }

  const score = Math.round(likeness(wantWords, gotWords) * 1000) / 1000;
  if (gotWords.length / Math.max(1, wantWords.length) < SHORT_AT) {
    return { ok: false, why: "The recording stops before the line does.", fault: "short", likeness: score, crossScript };
  }
  if (score < LIKENESS_MIN) {
    return { ok: false, why: `It was read as "${heard.trim().slice(0, 80)}".`, fault: "missing", likeness: score, crossScript };
  }
  return { ok: true, why: "", likeness: score, crossScript };
}

// ------------------------------------------------------------------------------------------------------------------ reading it again

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** A whole number under a thousand, in words. */
function inWords(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]!}` : "");
  return `${ONES[Math.floor(n / 100)]!} hundred${n % 100 ? ` ${inWords(n % 100)}` : ""}`;
}

/**
 * The line with its numbers written out in words, for a second reading. A voice engine reads "99" aloud by guessing, and guesses wrong
 * often enough to matter ("nineteen", or "nine nine"); given "ninety-nine" it has nothing to guess. Decimals, years, times and anything
 * with its own punctuation are left alone: written out they would be read worse, not better.
 */
export function spellNumbers(line: string): string {
  return line.replace(/(?<![\d.,:/%-])(\d{1,3})(?![\d.,:/%-])/g, (m) => {
    const n = Number(m);
    return n >= 0 && n <= 999 ? inWords(n) : m;
  });
}

