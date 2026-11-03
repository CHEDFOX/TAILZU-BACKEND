/**
 * WHICH LANGUAGE A FEW WORDS ARE IN, by rules: the script first, then Hinglish (Hindi in Latin letters), then a handful of everyday
 * words of the Latin-script languages. For a voice to say an answer in (src/talk) and for the one key's brain to keep a goal in the
 * language it was said in (src/askDecide). Hinglish is hi-Latn; Latin words of no known language are und-Latn.
 */
import { detectScript, romanHindiHits, type DetectedScript } from "./script.js";

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
