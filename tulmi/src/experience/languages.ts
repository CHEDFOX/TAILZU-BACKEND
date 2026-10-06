/**
 * EVERY LANGUAGE TAILZU TAKES, in one place — for the site's /languages pages
 * (seo/facts.ts) and the app's Languages screen (experience/catalog.ts), so
 * the two can never list different things.
 *
 * India's 22 scheduled languages are the set the Indic recogniser is built for
 * (INDIC_LANGUAGES in pipeline/stt.ts), with Hinglish beside Hindi; the rest
 * are the world languages the generalist recogniser and the writing model
 * handle: every language OpenAI lists as supported by its transcription
 * models (the ones it measures under 50% word error), and the few more the
 * site already shows written clean. The engines detect
 * the language themselves: a picked language only adds its script's example
 * words to the recogniser's prompt (sttPrompt), so offering one can never
 * make a transcription fail.
 */
export interface Lang {
  slug: string;
  name: string;
  native: string;
  /** BCP 47. */
  code: string;
  script: string;
  india: boolean;
  /** What the mix with English is called, where people call it something. */
  mix?: string;
  /** Has a page of its own. */
  page?: boolean;
}

/**
 * India's 22 scheduled languages (the Eighth Schedule), which is exactly the
 * set the Indic recogniser is built for (INDIC_LANGUAGES in pipeline/stt.ts),
 * with Hinglish beside Hindi. The ones with a page are the ones the site
 * already shows written clean.
 */
export const LANGS: Lang[] = [
  { slug: "hindi", name: "Hindi", native: "हिन्दी", code: "hi", script: "Devanagari", india: true, mix: "Hinglish", page: true },
  { slug: "hinglish", name: "Hinglish", native: "Hinglish", code: "hi-Latn", script: "English letters", india: true, page: true },
  { slug: "bengali", name: "Bengali", native: "বাংলা", code: "bn", script: "Bengali", india: true, mix: "Banglish", page: true },
  { slug: "telugu", name: "Telugu", native: "తెలుగు", code: "te", script: "Telugu", india: true, mix: "Tenglish", page: true },
  { slug: "marathi", name: "Marathi", native: "मराठी", code: "mr", script: "Devanagari", india: true, page: true },
  { slug: "tamil", name: "Tamil", native: "தமிழ்", code: "ta", script: "Tamil", india: true, mix: "Tanglish", page: true },
  { slug: "urdu", name: "Urdu", native: "اردو", code: "ur", script: "Perso-Arabic", india: true, page: true },
  { slug: "gujarati", name: "Gujarati", native: "ગુજરાતી", code: "gu", script: "Gujarati", india: true, page: true },
  { slug: "kannada", name: "Kannada", native: "ಕನ್ನಡ", code: "kn", script: "Kannada", india: true, mix: "Kanglish", page: true },
  { slug: "malayalam", name: "Malayalam", native: "മലയാളം", code: "ml", script: "Malayalam", india: true, mix: "Manglish", page: true },
  { slug: "odia", name: "Odia", native: "ଓଡ଼ିଆ", code: "or", script: "Odia", india: true, page: true },
  { slug: "punjabi", name: "Punjabi", native: "ਪੰਜਾਬੀ", code: "pa", script: "Gurmukhi", india: true, page: true },
  { slug: "nepali", name: "Nepali", native: "नेपाली", code: "ne", script: "Devanagari", india: true, page: true },
  { slug: "assamese", name: "Assamese", native: "অসমীয়া", code: "as", script: "Assamese", india: true },
  { slug: "maithili", name: "Maithili", native: "मैथिली", code: "mai", script: "Devanagari", india: true },
  { slug: "santali", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", code: "sat", script: "Ol Chiki", india: true },
  { slug: "kashmiri", name: "Kashmiri", native: "کٲشُر", code: "ks", script: "Perso-Arabic", india: true },
  { slug: "sindhi", name: "Sindhi", native: "سنڌي", code: "sd", script: "Perso-Arabic", india: true },
  { slug: "konkani", name: "Konkani", native: "कोंकणी", code: "kok", script: "Devanagari", india: true },
  { slug: "dogri", name: "Dogri", native: "डोगरी", code: "doi", script: "Devanagari", india: true },
  { slug: "manipuri", name: "Manipuri", native: "ꯃꯩꯇꯩꯂꯣꯟ", code: "mni", script: "Meetei Mayek", india: true },
  { slug: "bodo", name: "Bodo", native: "बड़ो", code: "brx", script: "Devanagari", india: true },
  { slug: "sanskrit", name: "Sanskrit", native: "संस्कृतम्", code: "sa", script: "Devanagari", india: true },
  // The rest of the world: OpenAI's supported transcription languages, and the
  // few more the site already shows written clean.
  { slug: "english", name: "English", native: "English", code: "en", script: "Latin", india: false },
  { slug: "spanish", name: "Spanish", native: "Español", code: "es", script: "Latin", india: false },
  { slug: "french", name: "French", native: "Français", code: "fr", script: "Latin", india: false },
  { slug: "portuguese", name: "Portuguese", native: "Português", code: "pt", script: "Latin", india: false },
  { slug: "german", name: "German", native: "Deutsch", code: "de", script: "Latin", india: false },
  { slug: "italian", name: "Italian", native: "Italiano", code: "it", script: "Latin", india: false },
  { slug: "dutch", name: "Dutch", native: "Nederlands", code: "nl", script: "Latin", india: false },
  { slug: "polish", name: "Polish", native: "Polski", code: "pl", script: "Latin", india: false },
  { slug: "ukrainian", name: "Ukrainian", native: "Українська", code: "uk", script: "Cyrillic", india: false },
  { slug: "russian", name: "Russian", native: "Русский", code: "ru", script: "Cyrillic", india: false },
  { slug: "greek", name: "Greek", native: "Ελληνικά", code: "el", script: "Greek", india: false },
  { slug: "turkish", name: "Turkish", native: "Türkçe", code: "tr", script: "Latin", india: false },
  { slug: "arabic", name: "Arabic", native: "العربية", code: "ar", script: "Arabic", india: false },
  { slug: "hebrew", name: "Hebrew", native: "עברית", code: "he", script: "Hebrew", india: false },
  { slug: "persian", name: "Persian", native: "فارسی", code: "fa", script: "Perso-Arabic", india: false },
  { slug: "swahili", name: "Swahili", native: "Kiswahili", code: "sw", script: "Latin", india: false },
  { slug: "indonesian", name: "Indonesian", native: "Bahasa Indonesia", code: "id", script: "Latin", india: false },
  { slug: "filipino", name: "Filipino", native: "Filipino", code: "fil", script: "Latin", india: false },
  { slug: "thai", name: "Thai", native: "ไทย", code: "th", script: "Thai", india: false },
  { slug: "vietnamese", name: "Vietnamese", native: "Tiếng Việt", code: "vi", script: "Latin", india: false },
  { slug: "chinese", name: "Chinese", native: "中文", code: "zh", script: "Chinese characters", india: false },
  { slug: "japanese", name: "Japanese", native: "日本語", code: "ja", script: "Japanese", india: false },
  { slug: "korean", name: "Korean", native: "한국어", code: "ko", script: "Hangul", india: false },
  { slug: "sinhala", name: "Sinhala", native: "සිංහල", code: "si", script: "Sinhala", india: false },
  { slug: "afrikaans", name: "Afrikaans", native: "Afrikaans", code: "af", script: "Latin", india: false },
  { slug: "armenian", name: "Armenian", native: "Հայերեն", code: "hy", script: "Armenian", india: false },
  { slug: "azerbaijani", name: "Azerbaijani", native: "Azərbaycan dili", code: "az", script: "Latin", india: false },
  { slug: "belarusian", name: "Belarusian", native: "Беларуская", code: "be", script: "Cyrillic", india: false },
  { slug: "bosnian", name: "Bosnian", native: "Bosanski", code: "bs", script: "Latin", india: false },
  { slug: "bulgarian", name: "Bulgarian", native: "Български", code: "bg", script: "Cyrillic", india: false },
  { slug: "catalan", name: "Catalan", native: "Català", code: "ca", script: "Latin", india: false },
  { slug: "croatian", name: "Croatian", native: "Hrvatski", code: "hr", script: "Latin", india: false },
  { slug: "czech", name: "Czech", native: "Čeština", code: "cs", script: "Latin", india: false },
  { slug: "danish", name: "Danish", native: "Dansk", code: "da", script: "Latin", india: false },
  { slug: "estonian", name: "Estonian", native: "Eesti", code: "et", script: "Latin", india: false },
  { slug: "finnish", name: "Finnish", native: "Suomi", code: "fi", script: "Latin", india: false },
  { slug: "galician", name: "Galician", native: "Galego", code: "gl", script: "Latin", india: false },
  { slug: "hungarian", name: "Hungarian", native: "Magyar", code: "hu", script: "Latin", india: false },
  { slug: "icelandic", name: "Icelandic", native: "Íslenska", code: "is", script: "Latin", india: false },
  { slug: "kazakh", name: "Kazakh", native: "Қазақ тілі", code: "kk", script: "Cyrillic", india: false },
  { slug: "latvian", name: "Latvian", native: "Latviešu", code: "lv", script: "Latin", india: false },
  { slug: "lithuanian", name: "Lithuanian", native: "Lietuvių", code: "lt", script: "Latin", india: false },
  { slug: "macedonian", name: "Macedonian", native: "Македонски", code: "mk", script: "Cyrillic", india: false },
  { slug: "malay", name: "Malay", native: "Bahasa Melayu", code: "ms", script: "Latin", india: false },
  { slug: "maori", name: "Maori", native: "Te Reo Māori", code: "mi", script: "Latin", india: false },
  { slug: "norwegian", name: "Norwegian", native: "Norsk", code: "no", script: "Latin", india: false },
  { slug: "romanian", name: "Romanian", native: "Română", code: "ro", script: "Latin", india: false },
  { slug: "serbian", name: "Serbian", native: "Српски", code: "sr", script: "Cyrillic", india: false },
  { slug: "slovak", name: "Slovak", native: "Slovenčina", code: "sk", script: "Latin", india: false },
  { slug: "slovenian", name: "Slovenian", native: "Slovenščina", code: "sl", script: "Latin", india: false },
  { slug: "swedish", name: "Swedish", native: "Svenska", code: "sv", script: "Latin", india: false },
  { slug: "welsh", name: "Welsh", native: "Cymraeg", code: "cy", script: "Latin", india: false },
];

/**
 * EVERY LANGUAGE HAS A PAGE. Someone searching "Swahili voice typing" or
 * "Kazakh keyboard" is looking for exactly this, and a language listed with
 * nowhere to land told them nothing. The ones the site has sentences for show
 * them; the rest say what is true of every language and nothing more.
 */
for (const l of LANGS) l.page = true;

