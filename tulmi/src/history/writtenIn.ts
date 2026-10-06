/**
 * WHAT A NOTE WAS WRITTEN IN, read from the note itself.
 *
 * The stored `language` is the client's hint, and the hint is usually "auto":
 * a breakdown built on it says most people write in a language called Auto.
 * The written text carries the answer instead. A script names its language
 * outright (Tamil is only ever written in Tamil); Devanagari, Bengali and the
 * Arabic script are shared, so the person's own chosen languages decide
 * between the ones that share them; and Latin letters are English unless the
 * words are Hindi said in English letters (Hinglish) or plainly another
 * language's everyday words.
 *
 * Pure and cheap: a pass over the characters and one over the words. It is a
 * reading of a sentence, not a detector with a confidence score, and it is
 * only ever used to say how someone writes, never to decide how to write it.
 */

/** Scripts that name one language, or a few the person's settings choose between. */
const SCRIPTS: Array<{ re: RegExp; langs: string[] }> = [
  { re: /[ऀ-ॿ]/, langs: ["hi", "mr", "ne", "mai", "kok", "doi", "brx", "sa"] },
  { re: /[ঀ-৿]/, langs: ["bn", "as"] },
  { re: /[਀-੿]/, langs: ["pa"] },
  { re: /[઀-૿]/, langs: ["gu"] },
  { re: /[଀-୿]/, langs: ["or"] },
  { re: /[஀-௿]/, langs: ["ta"] },
  { re: /[ఀ-౿]/, langs: ["te"] },
  { re: /[ಀ-೿]/, langs: ["kn"] },
  { re: /[ഀ-ൿ]/, langs: ["ml"] },
  { re: /[؀-ۿ]/, langs: ["ur", "ks", "sd", "ar"] },
  { re: /[᱐-᱿]/, langs: ["sat"] },
  { re: /[ꯀ-꯿]/, langs: ["mni"] },
  { re: /[぀-ヿ]/, langs: ["ja"] },
  { re: /[가-힯]/, langs: ["ko"] },
  { re: /[一-鿿]/, langs: ["zh"] },
  { re: /[Ѐ-ӿ]/, langs: ["ru"] },
];

/**
 * Hindi and Urdu words as they are typed in English letters — the everyday
 * glue of a Hinglish sentence, chosen because none of them is an English word
 * a sentence could be full of by accident ("main", "to", "the" are left out).
 */
const HINGLISH = new Set((
  "hai hain tha thi the hoon hun ho raha rahi rahe kar karo karna karenge kya kyun kaise kahan kab " +
  "nahi nahin mat bhi toh aur ya lekin par pe se ko ka ki ke mein mujhe mera meri mere tera teri " +
  "tum tumhe aap aapka hum humein unka unki yeh ye woh wo kuch sab bahut thoda abhi kal aaj " +
  "baad pehle yaar bhai didi haan acha accha theek thik chalo bas bolo likho dena lena gaya gayi " +
  "hoga hogi sakta sakti chahiye matlab waise wala wali kaam ghar paisa khana jaldi"
).split(" "));

/** A language's most common short words, for telling Latin-letter languages apart. */
const LATIN: Record<string, Set<string>> = {
  en: new Set("the and is are was you i it to of in that this for with on have be not can will just what".split(" ")),
  es: new Set("el la los las que de y en es un una por con para no se lo mi estoy llego".split(" ")),
  fr: new Set("le la les et est un une des que je tu pas pour avec dans ce sur".split(" ")),
  de: new Set("der die das und ist ich nicht ein eine zu mit auf den dem auch".split(" ")),
  pt: new Set("o a os as que de e em um uma para com não eu você está".split(" ")),
  id: new Set("yang dan di ini itu saya tidak ada akan dengan untuk ke bisa".split(" ")),
};

/** The one language a note is in, as a short key ("hi", "hinglish", "en"…). */
export function writtenIn(text: string, userLanguages: readonly string[] = []): string | null {
  const t = String(text || "").trim();
  if (!t) return null;
  const mine = new Set(userLanguages.map((l) => String(l).toLowerCase()));
  // Any character of a named script decides it: a Tamil sentence with an
  // English app name in it is a Tamil sentence.
  for (const s of SCRIPTS) {
    if (!s.re.test(t)) continue;
    return s.langs.find((l) => mine.has(l)) ?? s.langs[0]!;
  }
  const words = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z']+/g) ?? [];
  if (!words.length) return null;
  const hing = words.filter((w) => HINGLISH.has(w)).length;
  if (hing >= 2 || (words.length <= 4 && hing >= 1)) return "hinglish";
  let best = "en", bestHits = 0;
  for (const [lang, set] of Object.entries(LATIN)) {
    const hits = words.filter((w) => set.has(w)).length;
    if (hits > bestHits) { best = lang; bestHits = hits; }
  }
  return best;
}

/** How each language is named on the page — in its own script, as its
 *  speakers write it. */
export const LANGUAGE_NAMES: Record<string, string> = {
  hinglish: "Hinglish", en: "English", hi: "हिन्दी", mr: "मराठी", ne: "नेपाली", mai: "मैथिली", kok: "कोंकणी",
  doi: "डोगरी", brx: "बड़ो", sa: "संस्कृतम्", bn: "বাংলা", as: "অসমীয়া", pa: "ਪੰਜਾਬੀ", gu: "ગુજરાતી",
  or: "ଓଡ଼ିଆ", ta: "தமிழ்", te: "తెలుగు", kn: "ಕನ್ನಡ", ml: "മലയാളം", ur: "اردو", ks: "کٲشُر", sd: "سنڌي",
  ar: "العربية", sat: "ᱥᱟᱱᱛᱟᱲᱤ", mni: "ꯃꯩꯇꯩꯂꯣꯟ", ja: "日本語", ko: "한국어", zh: "中文", ru: "Русский",
  es: "Español", fr: "Français", de: "Deutsch", pt: "Português", id: "Bahasa Indonesia",
};
