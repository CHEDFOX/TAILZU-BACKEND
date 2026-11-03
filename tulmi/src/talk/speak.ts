/**
 * THE ANSWER AS IT IS SAID: ITS MOOD, ITS WORDS IN WHOLE PIECES, AND NOTHING THAT LOOKS LIKE A SECRET.
 *
 *   readMood(text)          the mood tag the answer starts with ("[laugh] Ha, …"), and the words after it
 *   new Speaker(out, o)     write(piece) as the model writes; flush() at the end; reset() when a model's words are void
 *   langOf(words)           the language of this turn's words: a BCP 47 tag, or "und-<Script>" when only the script is known
 *   sorryWords(lang)        the short apology for an answer cut off after it had begun
 *
 * THE MOOD. The answering model (role talk_reply) starts with one tag in square brackets, one of MOODS. The Speaker holds the first
 * characters until the tag is read (at most MOOD_HEAD), says the mood, and drops the tag from the words. No tag, or one it does not know:
 * talk (a few near words are read as theirs: happy is laugh, think is ponder, sad is sorry, no is nope).
 *
 * THE WORDS go out whole, as the live channel's do (live/askStream.ts sendable): a piece ends at a space, never inside a word, so a
 * Devanagari conjunct or an emoji is never cut in two. Before each piece the words so far are checked by the guard (bots/run.ts scrub):
 * once they look like they hold a secret nothing more is said, and `blocked` says so.
 */
import { sendable } from "../live/askStream.js";
import { detectScript, romanHindiHits, type DetectedScript } from "../pipeline/script.js";

export const MOODS = ["talk", "laugh", "ponder", "done", "sorry", "surprised", "shy", "nope"] as const;
export type Mood = (typeof MOODS)[number];

/** How far into an answer its mood tag may end. */
export const MOOD_HEAD = 24;

const NEAR: Readonly<Record<string, Mood>> = {
  happy: "laugh", joy: "laugh", funny: "laugh", haha: "laugh", smile: "laugh",
  think: "ponder", thinking: "ponder", hmm: "ponder",
  sad: "sorry", apologetic: "sorry", oops: "sorry",
  wow: "surprised", surprise: "surprised", shocked: "surprised",
  blush: "shy", embarrassed: "shy",
  no: "nope", refuse: "nope",
  ok: "done", yes: "done", finished: "done",
  neutral: "talk", calm: "talk",
};

/** A tag's word, as a mood: one of MOODS, a near word, else talk. */
export function moodOf(tag: string): Mood {
  const t = tag.trim().toLowerCase();
  return (MOODS as readonly string[]).includes(t) ? (t as Mood) : NEAR[t] ?? "talk";
}

const TAG = /^\s*\[([\p{L} _-]{1,16})\]\s*/u;

/** The mood an answer starts with and its words after the tag; `tagged` false when it has none. */
export function readMood(text: string): { mood: Mood; text: string; tagged: boolean } {
  const m = TAG.exec(text);
  return m ? { mood: moodOf(m[1]!), text: text.slice(m[0].length), tagged: true } : { mood: "talk", text, tagged: false };
}

export interface SpeakerOut {
  mood(m: Mood): void;
  text(piece: string): void;
}

export class Speaker {
  private head = "";
  private reading = true;
  private pending = "";
  private sent = "";
  private stop = false;

  constructor(private readonly out: SpeakerOut, private readonly o: { guard?: (text: string) => boolean; onBlock?: () => void } = {}) {}

  /** What was said, out to the device. */
  get spoken(): string { return this.sent; }
  /** Something was said: a model failing now cannot be replaced without two voices in one answer. */
  get begun(): boolean { return this.sent.length > 0; }
  /** The guard stopped it. */
  get blocked(): boolean { return this.stop; }

  write(piece: string): void {
    if (this.stop || typeof piece !== "string" || !piece) return;
    if (this.reading) {
      this.head += piece;
      const lead = this.head.trimStart();
      if (!lead) return;
      if (lead.startsWith("[")) {
        const close = lead.indexOf("]");
        if (close < 0 && lead.length < MOOD_HEAD) return;
        const r = readMood(this.head);
        this.reading = false;
        this.out.mood(r.mood);
        this.pending += r.tagged ? r.text : this.head.trimStart();
      } else {
        this.reading = false;
        this.out.mood("talk");
        this.pending += lead;
      }
      this.head = "";
    } else {
      this.pending += piece;
    }
    this.send(false);
  }

  /** The words written so far are void (that model failed before anything was said). */
  reset(): void {
    if (this.sent) return;
    this.head = "";
    this.pending = "";
    this.reading = true;
  }

  /** The answer is over: what is held goes. */
  flush(): void {
    if (this.reading && this.head.trim()) {
      const r = readMood(this.head);
      this.out.mood(r.mood);
      this.pending += r.text;
      this.head = "";
      this.reading = false;
    }
    this.send(true);
  }

  /** Words of our own (an apology), said whole after what was said. */
  say(words: string): void {
    if (!words) return;
    this.pending = "";
    const piece = this.sent && !/\s$/.test(this.sent) ? ` ${words}` : words;
    this.sent += piece;
    this.out.text(piece);
  }

  private send(final: boolean): void {
    if (this.stop || !this.pending) return;
    const k = sendable(this.pending, final);
    if (k <= 0) return;
    if (this.o.guard?.(this.sent + this.pending)) {
      this.stop = true;
      this.pending = "";
      this.o.onBlock?.();
      return;
    }
    const piece = this.pending.slice(0, k);
    this.pending = this.pending.slice(k);
    if (!this.sent && !piece.trim()) return;
    this.sent += piece;
    this.out.text(piece);
  }
}

const SCRIPT_LANG: Partial<Record<DetectedScript, string>> = {
  devanagari: "hi", bengali: "bn", gurmukhi: "pa", gujarati: "gu", tamil: "ta", telugu: "te", kannada: "kn", malayalam: "ml",
  arabic: "und-Arab", cyrillic: "und-Cyrl", cjk: "und-Hani",
};

/** A few words that say which Latin-script language it is, when nothing else does. */
const LATIN: ReadonlyArray<[string, Set<string>]> = [
  ["en", new Set("the and you what is are how why when where who can could would please tell me my it this that of to in for with".split(" "))],
  ["es", new Set("el la los las que qué es está por para cómo como dónde cuándo por qué un una de del y mi tu".split(" "))],
  ["fr", new Set("le la les est que qui quoi comment pourquoi où quand un une des et mon ma je tu vous ce cette".split(" "))],
  ["de", new Set("der die das ist und wie warum wo wann ein eine ich du mein nicht was".split(" "))],
  ["pt", new Set("o a os as que é está por para como onde quando um uma de do da e meu você".split(" "))],
  ["it", new Set("il lo la gli che è perché come dove quando un una di del e mio tu".split(" "))],
];

/** The language of these words: a tag for TTS to pick a voice by. Hinglish is hi-Latn; Latin words of no known language are und-Latn. */
export function langOf(words: string): string {
  const script = detectScript(words);
  const known = SCRIPT_LANG[script];
  if (known) return known;
  if (script !== "latin") return "und";
  if (romanHindiHits(words) >= 2) return "hi-Latn";
  const ws = words.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let best = "und-Latn";
  let most = 0;
  for (const [lang, set] of LATIN) {
    const n = ws.filter((w) => set.has(w)).length;
    if (n > most) { best = lang; most = n; }
  }
  return best;
}

const SORRY: Readonly<Record<string, string>> = {
  en: "Sorry, I lost my train of thought. Ask me again?",
  hi: "माफ़ कीजिए, बात पूरी नहीं हो पाई। फिर से पूछेंगे?",
  "hi-Latn": "Sorry, baat poori nahi ho paayi. Phir se poochhenge?",
  es: "Perdona, perdí el hilo. ¿Me lo preguntas otra vez?",
  fr: "Pardon, j'ai perdu le fil. Tu peux redemander ?",
  de: "Entschuldige, ich habe den Faden verloren. Fragst du noch einmal?",
  pt: "Desculpa, perdi o fio. Pode perguntar de novo?",
  it: "Scusa, ho perso il filo. Me lo richiedi?",
};

/** The short apology for an answer cut off after it had begun, in the turn's language when there are words for it. */
export const sorryWords = (lang: string): string => SORRY[lang] ?? SORRY.en!;
