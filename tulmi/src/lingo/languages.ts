/**
 * THE LANGUAGES THE PICKER OFFERS, and finding one in them.
 *
 * THE LIST LIVES HERE, ON THE SERVER, and that is the whole point of it being a list at all. The picker is a screen
 * the server draws and the search runs here (`GET /v1/lingo/languages?q=`), so adding a language, fixing a name or
 * reordering the suggestions is a DEPLOY and never an app release. Nothing below is compiled into a phone.
 *
 * Each language is named TWICE: in itself (`name`) and in the language the person reads (`en` for now, which the
 * screens pair with it). Somebody looking for their own language looks for the word they call it by, not the word
 * English calls it by, so "Deutsch" has to be findable as "Deutsch".
 *
 * `alt` is the rest of what people type: another name for it ("Mandarin", "Farsi", "Castellano"), or the name in a
 * script they are not typing in. Search folds both sides through src/lingo/grade.ts `fold`, so "espanol" finds
 * "Español" and "turkce" finds "Türkçe" — the same folding that marks an answer, so the picker and the marking can
 * never disagree about what a word is.
 *
 * WHERE A NAME COVERS MORE THAN ONE LANGUAGE, THERE ARE TWO ROWS. "Chinese" is Mandarin and Cantonese; "Portuguese"
 * is Brazil and Portugal; "Norwegian" is Bokmål and Nynorsk. A picker can simply show both, which is better than
 * asking afterwards: the choice is made where it is visible, and it changes every sentence they are ever taught.
 *
 * This is not a closed set. A course is still a pair of tags and nothing here gates it (routes/bots/lingo.ts checks
 * the SHAPE of a tag only), so a language nobody added still works if it is asked for by tag.
 */
import { fold } from "./grade.js";

export interface Language {
  /** BCP-47, as the course stores it. */
  tag: string;
  /** What the language calls itself. */
  name: string;
  /** What English calls it. The screens show it under `name` when they differ. */
  en: string;
  /** Anything else somebody might type for it. */
  alt?: readonly string[];
}

/**
 * Offered in the picker. Ordered by nothing: `suggested()` decides what is shown before anybody searches, and the
 * rest is sorted by its English name for a stable list.
 */
export const LANGUAGES: readonly Language[] = [
  { tag: "af", name: "Afrikaans", en: "Afrikaans" },
  { tag: "sq", name: "Shqip", en: "Albanian" },
  { tag: "am", name: "አማርኛ", en: "Amharic" },
  { tag: "ar", name: "العربية", en: "Arabic" },
  { tag: "hy", name: "Հայերեն", en: "Armenian" },
  { tag: "az", name: "Azərbaycan dili", en: "Azerbaijani" },
  { tag: "eu", name: "Euskara", en: "Basque" },
  { tag: "be", name: "Беларуская", en: "Belarusian" },
  { tag: "bn", name: "বাংলা", en: "Bengali", alt: ["bangla"] },
  { tag: "bs", name: "Bosanski", en: "Bosnian" },
  { tag: "bg", name: "Български", en: "Bulgarian" },
  { tag: "my", name: "မြန်မာဘာသာ", en: "Burmese", alt: ["myanmar"] },
  { tag: "yue", name: "粵語", en: "Cantonese", alt: ["chinese", "yue", "jyutping"] },
  { tag: "ca", name: "Català", en: "Catalan" },
  { tag: "hr", name: "Hrvatski", en: "Croatian" },
  { tag: "cs", name: "Čeština", en: "Czech" },
  { tag: "da", name: "Dansk", en: "Danish" },
  { tag: "nl", name: "Nederlands", en: "Dutch", alt: ["flemish", "holland"] },
  { tag: "en", name: "English", en: "English" },
  { tag: "eo", name: "Esperanto", en: "Esperanto" },
  { tag: "et", name: "Eesti", en: "Estonian" },
  { tag: "fil", name: "Filipino", en: "Filipino", alt: ["tagalog"] },
  { tag: "fi", name: "Suomi", en: "Finnish" },
  { tag: "fr", name: "Français", en: "French" },
  { tag: "gl", name: "Galego", en: "Galician" },
  { tag: "ka", name: "ქართული", en: "Georgian" },
  { tag: "de", name: "Deutsch", en: "German" },
  { tag: "el", name: "Ελληνικά", en: "Greek" },
  { tag: "gu", name: "ગુજરાતી", en: "Gujarati" },
  { tag: "ha", name: "Hausa", en: "Hausa" },
  { tag: "he", name: "עברית", en: "Hebrew", alt: ["ivrit"] },
  { tag: "hi", name: "हिन्दी", en: "Hindi" },
  { tag: "hu", name: "Magyar", en: "Hungarian" },
  { tag: "is", name: "Íslenska", en: "Icelandic" },
  { tag: "ig", name: "Asụsụ Igbo", en: "Igbo" },
  { tag: "id", name: "Bahasa Indonesia", en: "Indonesian", alt: ["bahasa"] },
  { tag: "ga", name: "Gaeilge", en: "Irish", alt: ["gaelic"] },
  { tag: "it", name: "Italiano", en: "Italian" },
  { tag: "ja", name: "日本語", en: "Japanese", alt: ["nihongo"] },
  { tag: "kn", name: "ಕನ್ನಡ", en: "Kannada" },
  { tag: "kk", name: "Қазақ тілі", en: "Kazakh" },
  { tag: "km", name: "ភាសាខ្មែរ", en: "Khmer", alt: ["cambodian"] },
  { tag: "ko", name: "한국어", en: "Korean", alt: ["hangul"] },
  { tag: "ku", name: "Kurdî", en: "Kurdish" },
  { tag: "lo", name: "ລາວ", en: "Lao" },
  { tag: "la", name: "Latina", en: "Latin" },
  { tag: "lv", name: "Latviešu", en: "Latvian" },
  { tag: "lt", name: "Lietuvių", en: "Lithuanian" },
  { tag: "mk", name: "Македонски", en: "Macedonian" },
  { tag: "ms", name: "Bahasa Melayu", en: "Malay" },
  { tag: "ml", name: "മലയാളം", en: "Malayalam" },
  { tag: "zh", name: "中文", en: "Mandarin Chinese", alt: ["chinese", "mandarin", "putonghua", "pinyin"] },
  { tag: "mr", name: "मराठी", en: "Marathi" },
  { tag: "mn", name: "Монгол", en: "Mongolian" },
  { tag: "ne", name: "नेपाली", en: "Nepali" },
  { tag: "nb", name: "Norsk bokmål", en: "Norwegian Bokmål", alt: ["norwegian"] },
  { tag: "nn", name: "Nynorsk", en: "Norwegian Nynorsk", alt: ["norwegian"] },
  { tag: "ps", name: "پښتو", en: "Pashto" },
  { tag: "fa", name: "فارسی", en: "Persian", alt: ["farsi", "dari"] },
  { tag: "pl", name: "Polski", en: "Polish" },
  { tag: "pt-BR", name: "Português (Brasil)", en: "Portuguese (Brazil)", alt: ["portuguese", "brazilian"] },
  { tag: "pt-PT", name: "Português (Portugal)", en: "Portuguese (Portugal)", alt: ["portuguese"] },
  { tag: "pa", name: "ਪੰਜਾਬੀ", en: "Punjabi", alt: ["panjabi"] },
  { tag: "ro", name: "Română", en: "Romanian" },
  { tag: "ru", name: "Русский", en: "Russian" },
  { tag: "sr", name: "Српски", en: "Serbian" },
  { tag: "si", name: "සිංහල", en: "Sinhala", alt: ["sinhalese"] },
  { tag: "sk", name: "Slovenčina", en: "Slovak" },
  { tag: "sl", name: "Slovenščina", en: "Slovenian" },
  { tag: "so", name: "Soomaali", en: "Somali" },
  { tag: "es", name: "Español", en: "Spanish", alt: ["castellano", "castilian"] },
  { tag: "sw", name: "Kiswahili", en: "Swahili" },
  { tag: "sv", name: "Svenska", en: "Swedish" },
  { tag: "ta", name: "தமிழ்", en: "Tamil" },
  { tag: "te", name: "తెలుగు", en: "Telugu" },
  { tag: "th", name: "ไทย", en: "Thai" },
  { tag: "tr", name: "Türkçe", en: "Turkish" },
  { tag: "uk", name: "Українська", en: "Ukrainian" },
  { tag: "ur", name: "اردو", en: "Urdu" },
  { tag: "uz", name: "Oʻzbek", en: "Uzbek" },
  { tag: "vi", name: "Tiếng Việt", en: "Vietnamese" },
  { tag: "cy", name: "Cymraeg", en: "Welsh" },
  { tag: "xh", name: "isiXhosa", en: "Xhosa" },
  { tag: "yo", name: "Yorùbá", en: "Yoruba" },
  { tag: "zu", name: "isiZulu", en: "Zulu" },
];

const BY_TAG = new Map(LANGUAGES.map((l) => [l.tag.toLowerCase(), l]));

/** One language by its tag, or null. */
export const languageOf = (tag: string): Language | null => BY_TAG.get(tag.trim().toLowerCase()) ?? null;

/**
 * What the picker shows before anybody types: the ones most people come for, in that order, and never the language
 * they already speak. Short on purpose — a list of eighty is a search box, not a choice.
 */
const POPULAR = ["es", "en", "fr", "ja", "de", "zh", "ko", "it", "pt-BR", "hi", "ar", "ru"] as const;

export function suggested(from: string, limit = 8): Language[] {
  const mine = from.trim().toLowerCase();
  const out: Language[] = [];
  for (const tag of POPULAR) {
    if (tag.toLowerCase() === mine) continue;
    const l = languageOf(tag);
    if (l) out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}

/** Every language the picker can offer, by English name, minus the one they already speak. */
export function all(from = ""): Language[] {
  const mine = from.trim().toLowerCase();
  return LANGUAGES.filter((l) => l.tag.toLowerCase() !== mine).slice().sort((a, b) => a.en.localeCompare(b.en, "en"));
}

/**
 * SEARCH. Folded on both sides, so the marks over letters never hide a match: "espanol" finds Español, "turkce"
 * finds Türkçe, "francais" finds Français. It matches what the language calls itself, what English calls it, the
 * other names people use, and the tag.
 *
 * Ranked, because a picker that puts the right answer third is a worse picker: the tag exactly, then a name that
 * STARTS with what they typed, then a name that merely contains it. Alphabetical inside each band, so the list
 * never jitters between keystrokes.
 */
export function search(q: string, o: { from?: string; limit?: number } = {}): Language[] {
  const needle = fold(q);
  const pool = all(o.from ?? "");
  const limit = o.limit ?? 40;
  if (!needle) return pool.slice(0, limit);

  const scored: { l: Language; rank: number }[] = [];
  for (const l of pool) {
    const names = [l.name, l.en, ...(l.alt ?? [])].map(fold);
    const tag = fold(l.tag);
    let rank = -1;
    if (tag === needle) rank = 0;
    else if (names.some((n) => n === needle)) rank = 1;
    else if (names.some((n) => n.startsWith(needle))) rank = 2;
    else if (names.some((n) => n.split(" ").some((w) => w.startsWith(needle)))) rank = 3;
    else if (names.some((n) => n.includes(needle))) rank = 4;
    else if (tag.startsWith(needle)) rank = 5;
    if (rank >= 0) scored.push({ l, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.l.en.localeCompare(b.l.en, "en"));
  return scored.slice(0, limit).map((s) => s.l);
}
