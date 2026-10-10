/**
 * NO SPEECH IN, NO TEXT OUT.
 *
 * The owner dictated two sentences on the desktop and got
 *   "So see that andजिंदगी में.I'm not aजिंदगी में."  and  "JhalThank you.Jhal"
 * The desktop uploads each pause-separated stretch on its own, so every
 * breath between two sentences reached a recogniser alone, and a recogniser
 * answers near-silence with words: "Thank you." in English, "जिंदगी में." in
 * Hindi, a syllable like "Jhal". The old defence was a list of ENGLISH phrases,
 * consulted only when the recogniser was unsure — and on exactly these clips
 * it is sure.
 *
 * So the decision rests on the AUDIO first (speechPresence: seconds of voice
 * in the clip), and on the recognisers second:
 *   - no voice and barely any sound       → nothing was said, whatever came back
 *   - a phrase recognisers invent on quiet → kept only with a voice long enough
 *                                            to have said it
 *   - more words than the voice could hold → invented (a known tail comes off
 *                                            first; what remains must fit)
 *   - one engine heard words, another heard nothing, on a quiet clip → not trusted
 * When the audio cannot be measured, the same phrases on a short clip need a
 * second engine that heard the same thing.
 *
 * A person who really says "thank you" or "धन्यवाद" keeps it: the gate is on
 * the measured voice, not on the words.
 */
import type { SpeechMeasure } from "./speechPresence.js";

/**
 * Text folded for comparison: case, punctuation and the spelling variants a
 * recogniser alternates between (nukta, chandrabindu) do not make a phrase
 * different. Apostrophes stay — "d'avoir" is one word.
 */
export function phraseKey(text: string): string {
  return (text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/़/g, "")          // nukta: ज़िंदगी = जिंदगी
    .replace(/ँ/g, "ं")    // chandrabindu → anusvara: हाँ = हां
    .replace(/[‘’`]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What recognisers write when nobody spoke, by language. Each is also
 * something a person can really say, which is why none of these is removed
 * on sight: they need a voice long enough to have said them.
 */
const NOISE_PHRASES: string[] = [
  // English — the Whisper family's answers to silence, a breath, a chair.
  "thank you", "thank you so much", "thank you very much", "thank you guys", "thank you all",
  "thank you everyone", "thanks", "thanks a lot", "thanks so much", "thanks guys", "thanks everyone",
  "thank you bye", "you", "bye", "bye bye", "goodbye", "okay", "ok", "oh", "so", "the end",
  "i'm sorry", "thank you for listening",
  // Hindi / Marathi (Devanagari). "हम" ("we") is a word and is not here.
  "जिंदगी में", "जिन्दगी में", "धन्यवाद", "बहुत बहुत धन्यवाद", "आपका धन्यवाद", "आपका बहुत बहुत धन्यवाद",
  "शुक्रिया", "बहुत शुक्रिया", "नमस्ते", "नमस्कार", "सब्सक्राइब करें", "सब्सक्राइब", "ओके", "हाँ", "जी",
  "ठीक है", "अच्छा",
  // Urdu.
  "شکریہ", "بہت شکریہ", "خدا حافظ", "اللہ حافظ",
  // Bengali, and the rest of the Indic scripts we serve.
  "ধন্যবাদ", "অনেক ধন্যবাদ", "নমস্কার", "நன்றி", "வணக்கம்", "ధన్యవాదాలు", "ధన్యవాదం", "આભાર",
  "ਧੰਨਵਾਦ", "ಧನ್ಯವಾದಗಳು", "ಧನ್ಯವಾದ", "നന്ദി",
  // Romanised Indic, and the short syllables a recogniser makes of a breath.
  "dhanyavaad", "dhanyavad", "dhanyawad", "dhanyawaad", "shukriya", "bahut shukriya", "namaste",
  "namaskar", "zindagi mein", "zindagi me", "jindagi mein", "jhal", "haan", "ji", "accha", "achha",
  "theek hai", "thik hai",
  // The other languages the recogniser is primed for.
  "gracias", "muchas gracias", "merci", "merci beaucoup", "danke", "vielen dank", "danke schön",
  "obrigado", "obrigada", "muito obrigado", "شكرا", "شكرا لكم", "شكرا جزيلا", "ありがとうございました",
  "ありがとう", "감사합니다", "谢谢", "谢谢大家", "спасибо", "спасибо за внимание",
];

/**
 * Nobody dictates these into a keyboard: video outros and subtitle credits
 * from the recognisers' training data. Removed whole or as a trailing clause
 * on every path, whatever the audio says.
 */
const BOILERPLATE_PHRASES: string[] = [
  "thanks for watching", "thank you for watching", "please subscribe", "subscribe to my channel",
  "don't forget to subscribe", "don't forget to like and subscribe", "like and subscribe",
  "see you next time", "see you in the next video", "subtitles by the amara org community",
  "देखने के लिए धन्यवाद", "चैनल को सब्सक्राइब करें", "हमारे चैनल को सब्सक्राइब करें",
  "वीडियो को लाइक करें", "সাবস্ক্রাইব করুন", "আমাদের চ্যানেলটি সাবস্ক্রাইব করুন", "سبسکرائب کریں",
  "subtítulos realizados por la comunidad de amara org", "gracias por ver", "gracias por ver el video",
  "sous titres réalisés par la communauté d'amara org", "merci d'avoir regardé",
  "untertitel im auftrag des zdf", "untertitel der amara org community", "ご視聴ありがとうございました",
  "시청해주셔서 감사합니다", "시청해 주셔서 감사합니다", "谢谢观看", "字幕由amara org社区提供",
  "спасибо за просмотр", "продолжение следует", "субтитры сделал dimatorzok", "اشتركوا في القناة",
];

const NOISE = new Set(NOISE_PHRASES.map(phraseKey));
const BOILERPLATE = new Set(BOILERPLATE_PHRASES.map(phraseKey));

/** The sounds that are never words, in the alphabets they get written in.
 *  음 and 嗯 too: the quality run's "mm" came back from the recogniser as a
 *  Korean "음." and went into the field as that. */
const FILLER_WORD = /^(?:h+m+|m+h*m+|u+m+|u+h+|e+r+m*|a+h+|हु?म्म+|हुं+|उम्म+|ह्म+|হু+ম+|হুঁ+|উ+ম+|হ্ম+|음+|嗯+)$/u;

/** Sentences, split after their closing mark (any script). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…।॥。！？])\s*/u).map((s) => s.trim()).filter(Boolean);
}

/**
 * Is this whole transcript something recognisers write for silence? Also
 * true for a run of them ("Thank you. Bye.", "जिंदगी में. जिंदगी में.").
 */
export function isKnownHallucination(text: string): boolean {
  const parts = sentences(text);
  return parts.length > 0 && parts.every((s) => {
    const k = phraseKey(s);
    return !!k && (NOISE.has(k) || BOILERPLATE.has(k));
  });
}

/** True when every word is a hesitation sound: "Hmm.", "um uh", "हम्म". */
export function isFillerOnly(text: string): boolean {
  const words = phraseKey(text).split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => FILLER_WORD.test(w));
}

/**
 * Non-speech annotations a recogniser writes into the text — "[Music]",
 * "[BLANK_AUDIO]", "(upbeat music)", "♪". Never words anyone said.
 */
const ANNOTATION = /\[[^\]\n]{1,40}\]|\((?:[^)\n]{0,20}\b)?(?:music|applause|laughs?|laughter|sighs?|coughs?|silence|inaudible|noise|blank[_ ]audio)\b[^)\n]{0,20}\)|[♪♫]+/giu;

/**
 * Remove what is never speech: annotations anywhere, boilerplate as the whole
 * text or as its trailing sentences.
 */
export function stripBoilerplate(text: string): string {
  let t = (text ?? "").replace(ANNOTATION, " ").replace(/[^\S\n]+/g, " ").trim();
  if (!t) return "";
  if (BOILERPLATE.has(phraseKey(t))) return "";
  const parts = sentences(t);
  while (parts.length > 1 && BOILERPLATE.has(phraseKey(parts[parts.length - 1]!))) parts.pop();
  if (parts.length && BOILERPLATE.has(phraseKey(parts[parts.length - 1]!))) return "";
  t = parts.join(" ");
  return /^[\s\p{P}\p{S}]*$/u.test(t) ? "" : t;
}

/** Characters written without spaces between words. */
const UNSPACED = /[぀-ヿ㐀-鿿฀-๿]/gu;

/**
 * How many words the speaker had to say to produce this text. Scripts that
 * write words without spaces (Chinese, Japanese, Thai) count about two
 * characters to a word.
 */
export function spokenWords(text: string): number {
  let n = 0;
  for (const token of (text ?? "").split(/\s+/)) {
    if (!/[\p{L}\p{N}]/u.test(token)) continue;
    const unspaced = token.match(UNSPACED)?.length ?? 0;
    n += unspaced ? Math.ceil(unspaced / 2) + (/[a-z0-9]/i.test(token) ? 1 : 0) : 1;
  }
  return n;
}

/**
 * The most words `voicedSeconds` of voice can hold. Fast speech is about four
 * words a second of speaking and a voice is voiced for well under all of it,
 * so seven words per voiced second, plus two, is generous in every language —
 * it has to be, because dropping a real sentence is the worse mistake.
 */
export function wordCapacity(voicedSeconds: number): number {
  return 2 + 7 * Math.max(0, voicedSeconds);
}

/** Below this much voice, and without a breath's worth of other sound, nothing was said. */
export const NO_VOICE_S = 0.12;
/** Unvoiced sound shorter than this is a breath, a click or a knock, not whispering. */
export const BREATH_MAX_S = 1.0;
/** Voice this long is clearly someone talking, whatever another engine
 *  heard: Whisper drops a real short "haan ji" as no-speech now and then,
 *  and that must not cost the other engine's correct reading. */
export const CLEAR_VOICE_S = 0.35;
/** Voice needed to have really said one of the NOISE phrases. */
export function knownPhraseMinVoice(text: string): number {
  return spokenWords(text) >= 2 ? 0.3 : 0.2;
}
/** Without a measurement, a clip this short (or this small) could be only a breath. */
export const SHORT_CLIP_S = 3;
export const SHORT_CLIP_BYTES = 64_000;

export type GateReason =
  | "boilerplate"      // outro / subtitle credit / annotation only
  | "filler"           // only hesitation sounds
  | "no-speech"        // the audio holds no voice
  | "hallucination"    // a phrase recognisers invent, without the voice to have said it
  | "too-many-words"   // more words than the voice could hold
  | "uncorroborated";  // one engine heard words where another heard nothing, on a quiet clip

export interface SpeechEvidence {
  /** The audio measurement; null/undefined when it could not be made. */
  measure?: SpeechMeasure | null;
  /** Clip length from a header or the provider; 0 when unknown. */
  clipSeconds?: number;
  /** Clip size, for when its length is unknown. */
  clipBytes?: number;
  /** The recogniser's own reading of the clip. */
  confidence?: "high" | "low" | "unknown";
  /** Other engines' readings of the same clip ("" = ran and heard nothing). */
  others?: string[];
}

export interface GateResult {
  text: string;
  /** Why text that came back was withheld; absent when it was kept. */
  dropped?: GateReason;
}

function sameReading(a: string, b: string): boolean {
  const ka = phraseKey(a);
  return !!ka && ka === phraseKey(b);
}

/**
 * Take a known phrase off the END of a transcript whose voice cannot account
 * for it: "The deck is done. Thank you." on a clip with a second of voice.
 * Only a whole trailing sentence, or a trailing run in another script
 * ("I'm not a जिंदगी में") — never a word out of the middle.
 */
function stripUnsupportedTail(text: string, capacity: number): string {
  let t = text;
  for (let i = 0; i < 3 && spokenWords(t) > capacity; i++) {
    const parts = sentences(t);
    if (parts.length > 1 && isKnownHallucination(parts[parts.length - 1]!)) {
      t = parts.slice(0, -1).join(" ");
      continue;
    }
    // A trailing run in a different script from what came before it.
    const m = /^(.*?[\p{Script=Latin}\d][^\p{L}]*?)\s*([^\p{Script=Latin}]+)$/su.exec(t);
    if (m && /\p{L}/u.test(m[2]!) && isKnownHallucination(m[2]!)) {
      t = m[1]!.trim();
      continue;
    }
    break;
  }
  return t;
}

/**
 * The decision. `raw` is what the recogniser returned; the result is what may
 * be written — possibly nothing.
 */
export function gateTranscript(raw: string, ev: SpeechEvidence = {}): GateResult {
  const original = (raw ?? "").trim();
  if (!original) return { text: "" };
  let text = stripBoilerplate(original);
  if (!text) return { text: "", dropped: "boilerplate" };
  // A hesitation is not a message, however clearly it was voiced.
  if (isFillerOnly(text)) return { text: "", dropped: "filler" };

  const known = isKnownHallucination(text);
  const others = ev.others ?? [];
  const corroborated = others.some((o) => sameReading(o, text));
  // Another engine RAN on this audio and heard nothing at all.
  const contradicted = !corroborated && others.some((o) => !o.trim());
  // A truncated measure covers only the start of a long clip: not evidence
  // about the rest, so it is not used.
  const m = ev.measure && !ev.measure.truncated ? ev.measure : null;

  if (m) {
    if (m.voicedSeconds < NO_VOICE_S && m.activeSeconds < BREATH_MAX_S) return { text: "", dropped: "no-speech" };
    if (known && m.voicedSeconds < knownPhraseMinVoice(text)) return { text: "", dropped: "hallucination" };
    const capacity = wordCapacity(m.voicedSeconds);
    text = stripUnsupportedTail(text, capacity);
    const words = spokenWords(text);
    // A short text on too little voice is invented outright; a long one only
    // when it is far past what the voice could hold (the measure can run
    // short on a quiet or clipped recording, and dropping a real sentence is
    // the worst thing this can do).
    if (words > capacity && (words <= 4 || words > 2 * capacity)) return { text: "", dropped: "too-many-words" };
    if (contradicted && words <= 3 && m.voicedSeconds < CLEAR_VOICE_S) return { text: "", dropped: "uncorroborated" };
    return { text };
  }

  // No measurement (no ffmpeg, an unreadable clip, a long one). Lean on the
  // recognisers, and treat a short or small clip as possibly only a breath.
  const secs = ev.clipSeconds ?? 0;
  const short = secs > 0 ? secs <= SHORT_CLIP_S : (ev.clipBytes ?? 0) > 0 && (ev.clipBytes ?? 0) <= SHORT_CLIP_BYTES;
  if (known && (ev.confidence === "low" || (short && !corroborated))) return { text: "", dropped: "hallucination" };
  if (short && contradicted && spokenWords(text) <= 3) return { text: "", dropped: "uncorroborated" };
  return { text };
}
