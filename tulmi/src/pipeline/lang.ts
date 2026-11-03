/**
 * WHICH LANGUAGE A FEW WORDS ARE IN, by rules: the script first, then Hinglish (Hindi in Latin letters), then a handful of everyday
 * words of the Latin-script languages. For a voice to say an answer in (src/talk) and for the one key's brain to keep a goal in the
 * language it was said in (src/askDecide). Hinglish is hi-Latn; Latin words of no known language are und-Latn.
 */
import { detectScript, romanHindiHits, type DetectedScript } from "./script.js";

const SCRIPT_LANG: Partial<Record<DetectedScript, string>> = {
  devanagari: "hi", bengali: "bn", gurmukhi: "pa", gujarati: "gu", tamil: "ta", telugu: "te", kannada: "kn", malayalam: "ml",
};

/** Within a script that more than one language writes in: the letters that say which. */
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/u;
const KANA = /[぀-ヿ]/u;
const URDU = /[ٹڈڑںےۓ]/u;
const PERSIAN = /[پچژگ]/u;
const UKRAINIAN = /[їєґі]/iu;

/** Letters that only some Latin-script languages use: each one found is worth two everyday words. */
const MARKS: ReadonlyArray<[string, RegExp]> = [
  ["vi", /[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/giu],
  ["de", /[ßäöü]/giu], ["es", /[ñ¿¡]/giu], ["pt", /[ãõ]/giu], ["fr", /[èêëœàùûç]/giu], ["it", /[ìò]/giu], ["tr", /[ğışİ]/gu], ["pl", /[ąćęłńśźż]/giu],
];

/** A few everyday words that say which Latin-script language it is, when nothing else does. */
const LATIN: ReadonlyArray<[string, Set<string>]> = [
  ["en", new Set("the and you what is are how why when where who can could would please tell me my it this that of to in for with send remind".split(" "))],
  ["es", new Set("el la los las que qué es está por para cómo como dónde cuándo un una de del y mi tu me eso esto mañana recuérdame dime".split(" "))],
  ["fr", new Set("le la les est que qui quoi comment pourquoi où quand un une des et mon ma je tu vous ce cette moi fais dis demain".split(" "))],
  ["de", new Set("der die das ist und wie warum wo wann ein eine einem ich du mein nicht was mich morgen um an den dem mir bitte".split(" "))],
  ["pt", new Set("o os as que é está por para como onde quando um uma do da e meu você me pro uma conta manda amanhã".split(" "))],
  ["it", new Set("il lo gli che è perché come dove quando un una di del mio mia tu mi fa alla della delle cose fare domani quanto questo sono".split(" "))],
  ["nl", new Set("de het een is en ik je jij wat hoe waarom waar wanneer niet mijn met voor van morgen".split(" "))],
  ["tr", new Set("ve bir bu ne nasıl neden nerede ne zaman ben sen benim için ile yarın saat de da mı mi".split(" "))],
  ["id", new Set("dan yang di ini itu untuk dengan tidak ada akan apa bagaimana kenapa saya aku kamu besok ke".split(" "))],
  ["sw", new Set("na ya wa kwa ni za la katika hii kuwa nini vipi kesho mimi wewe tafadhali nieleze".split(" "))],
  ["pl", new Set("i w nie na że jest się co jak dlaczego gdzie kiedy mój ja ty jutro".split(" "))],
];

/** The language of these words: a tag for TTS to pick a voice by. Hinglish is hi-Latn; Latin words of no known language are und-Latn. */
export function langOf(words: string): string {
  const script = detectScript(words);
  const known = SCRIPT_LANG[script];
  if (known) return known;
  if (script === "cjk") return HANGUL.test(words) ? "ko" : KANA.test(words) ? "ja" : "zh";
  if (script === "arabic") return URDU.test(words) ? "ur" : PERSIAN.test(words) ? "fa" : "ar";
  if (script === "cyrillic") return UKRAINIAN.test(words) ? "uk" : "ru";
  if (script !== "latin") return "und";
  if (romanHindiHits(words) >= 2) return "hi-Latn";
  const ws = words.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const score = new Map<string, number>();
  for (const [lang, re] of MARKS) score.set(lang, (words.match(re)?.length ?? 0) * 2);
  for (const [lang, set] of LATIN) score.set(lang, (score.get(lang) ?? 0) + ws.filter((w) => set.has(w)).length);
  let best = "und-Latn";
  let most = 0;
  for (const [lang, n] of score) if (n > most) { best = lang; most = n; }
  return best;
}

/** A tag's language by name, for a model told which language to answer in; empty when the tag says only the script. */
const NAMES: Readonly<Record<string, string>> = {
  en: "English", "hi-Latn": "Hinglish (Hindi in Latin letters)", hi: "Hindi", bn: "Bengali", pa: "Punjabi", gu: "Gujarati", ta: "Tamil", te: "Telugu",
  kn: "Kannada", ml: "Malayalam", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian", nl: "Dutch", tr: "Turkish",
  id: "Indonesian", sw: "Swahili", pl: "Polish", vi: "Vietnamese", ko: "Korean", ja: "Japanese", zh: "Chinese", ar: "Arabic", ur: "Urdu",
  fa: "Persian", ru: "Russian", uk: "Ukrainian",
};
export const langName = (tag: string): string => NAMES[tag] ?? "";
