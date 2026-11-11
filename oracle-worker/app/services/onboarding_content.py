"""
Onboarding content registry — serves the language picker + birth screen.

Auth screen is text-free, so its payload is just {"authMode": ...}.
Language picker reads the LANGUAGES list. Birth screen text is produced
by onboarding_translator (LLM-translated + disk-cached).
"""

import asyncio
import os

LANGUAGES = [
    # Global / lingua franca
    {"code": "en",  "name": "English",          "greeting": "Hello",          "regions": ["US","GB","AU","CA","IN","NZ","IE","ZA"]},
    {"code": "es",  "name": "Español",          "greeting": "Hola",           "regions": ["ES","MX","AR","CO","CL","PE","VE"]},
    {"code": "fr",  "name": "Français",         "greeting": "Bonjour",        "regions": ["FR","CA","BE","CH","LU","SN","CI"]},
    {"code": "ar",  "name": "العربية",          "greeting": "مرحبا",          "regions": ["SA","EG","AE","JO","LB","IQ","MA","DZ","TN"]},
    {"code": "pt",  "name": "Português",        "greeting": "Olá",            "regions": ["BR","PT","AO","MZ"]},
    {"code": "ru",  "name": "Русский",          "greeting": "Привет",         "regions": ["RU","BY","KZ"]},
    {"code": "zh",  "name": "中文",             "greeting": "你好",           "regions": ["CN","TW","SG","HK"]},
    {"code": "ja",  "name": "日本語",            "greeting": "こんにちは",      "regions": ["JP"]},
    {"code": "ko",  "name": "한국어",            "greeting": "안녕하세요",      "regions": ["KR"]},
    {"code": "de",  "name": "Deutsch",          "greeting": "Hallo",          "regions": ["DE","AT","CH"]},
    # Indian subcontinent
    {"code": "hi",  "name": "हिंदी",            "greeting": "नमस्ते",          "regions": ["IN"]},
    {"code": "bn",  "name": "বাংলা",            "greeting": "নমস্কার",         "regions": ["IN","BD"]},
    {"code": "ta",  "name": "தமிழ்",            "greeting": "வணக்கம்",        "regions": ["IN","LK","SG","MY"]},
    {"code": "te",  "name": "తెలుగు",           "greeting": "నమస్కారం",        "regions": ["IN"]},
    {"code": "mr",  "name": "मराठी",            "greeting": "नमस्कार",         "regions": ["IN"]},
    {"code": "gu",  "name": "ગુજરાતી",          "greeting": "નમસ્તે",          "regions": ["IN"]},
    {"code": "kn",  "name": "ಕನ್ನಡ",            "greeting": "ನಮಸ್ಕಾರ",         "regions": ["IN"]},
    {"code": "ml",  "name": "മലയാളം",           "greeting": "നമസ്കാരം",        "regions": ["IN"]},
    {"code": "pa",  "name": "ਪੰਜਾਬੀ",           "greeting": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ",    "regions": ["IN","PK"]},
    {"code": "or",  "name": "ଓଡ଼ିଆ",            "greeting": "ନମସ୍କାର",         "regions": ["IN"]},
    {"code": "ur",  "name": "اردو",             "greeting": "السلام علیکم",   "regions": ["PK","IN"]},
    {"code": "as",  "name": "অসমীয়া",          "greeting": "নমস্কাৰ",         "regions": ["IN"]},
    {"code": "ne",  "name": "नेपाली",           "greeting": "नमस्ते",          "regions": ["NP","IN"]},
    {"code": "si",  "name": "සිංහල",            "greeting": "ආයුබෝවන්",        "regions": ["LK"]},
    {"code": "sa",  "name": "संस्कृतम्",        "greeting": "नमस्ते",          "regions": ["IN"]},
    # Indian subcontinent — the rest of the Eighth Schedule. Jyotish is the app's
    # deepest content and these are its home audiences; a Maithili or Santali
    # speaker reading their chart in Hindi is reading it in a second language.
    {"code": "mai", "name": "मैथिली",           "greeting": "प्रणाम",          "regions": ["IN","NP"]},
    {"code": "kok", "name": "कोंकणी",           "greeting": "नमस्कार",         "regions": ["IN"]},
    {"code": "doi", "name": "डोगरी",            "greeting": "नमस्कार",         "regions": ["IN"]},
    {"code": "ks",  "name": "کٲشُر",             "greeting": "آداب",           "regions": ["IN","PK"]},
    {"code": "sd",  "name": "سنڌي",             "greeting": "سلام",           "regions": ["PK","IN"]},
    {"code": "sat", "name": "ᱥᱟᱱᱛᱟᱲᱤ",          "greeting": "ᱡᱚᱦᱟᱨ",           "regions": ["IN","BD","NP"]},
    {"code": "mni", "name": "ꯃꯤꯇꯩꯂꯣꯟ",          "greeting": "ꯈꯨꯔꯨꯝꯖꯔꯤ",         "regions": ["IN"]},
    {"code": "brx", "name": "बड़ो",              "greeting": "खुलुमबाय",        "regions": ["IN"]},
    # Indian subcontinent — large regional languages outside the Schedule. Several
    # of these have more speakers than European languages already on this list.
    {"code": "bho", "name": "भोजपुरी",          "greeting": "प्रणाम",          "regions": ["IN","NP","MU"]},
    {"code": "mag", "name": "मगही",             "greeting": "प्रणाम",          "regions": ["IN"]},
    {"code": "awa", "name": "अवधी",             "greeting": "प्रणाम",          "regions": ["IN"]},
    {"code": "hne", "name": "छत्तीसगढ़ी",        "greeting": "जोहार",           "regions": ["IN"]},
    {"code": "raj", "name": "राजस्थानी",        "greeting": "खम्मा घणी",       "regions": ["IN"]},
    {"code": "bgc", "name": "हरियाणवी",         "greeting": "राम राम",         "regions": ["IN"]},
    {"code": "tcy", "name": "ತುಳು",             "greeting": "ನಮಸ್ಕಾರ",         "regions": ["IN"]},
    # European
    {"code": "it",  "name": "Italiano",         "greeting": "Ciao",           "regions": ["IT","CH","SM","VA"]},
    {"code": "nl",  "name": "Nederlands",       "greeting": "Hallo",          "regions": ["NL","BE"]},
    {"code": "sv",  "name": "Svenska",          "greeting": "Hej",            "regions": ["SE","FI"]},
    {"code": "no",  "name": "Norsk",            "greeting": "Hei",            "regions": ["NO"]},
    {"code": "da",  "name": "Dansk",            "greeting": "Hej",            "regions": ["DK"]},
    {"code": "fi",  "name": "Suomi",            "greeting": "Terve",          "regions": ["FI"]},
    {"code": "is",  "name": "Íslenska",         "greeting": "Halló",          "regions": ["IS"]},
    {"code": "pl",  "name": "Polski",           "greeting": "Cześć",          "regions": ["PL"]},
    {"code": "cs",  "name": "Čeština",          "greeting": "Ahoj",           "regions": ["CZ"]},
    {"code": "sk",  "name": "Slovenčina",       "greeting": "Ahoj",           "regions": ["SK"]},
    {"code": "hu",  "name": "Magyar",           "greeting": "Szia",           "regions": ["HU"]},
    {"code": "ro",  "name": "Română",           "greeting": "Salut",          "regions": ["RO","MD"]},
    {"code": "bg",  "name": "Български",        "greeting": "Здравей",        "regions": ["BG"]},
    {"code": "hr",  "name": "Hrvatski",         "greeting": "Bok",            "regions": ["HR"]},
    {"code": "sr",  "name": "Српски",           "greeting": "Здраво",         "regions": ["RS"]},
    {"code": "sl",  "name": "Slovenščina",      "greeting": "Zdravo",         "regions": ["SI"]},
    {"code": "et",  "name": "Eesti",            "greeting": "Tere",           "regions": ["EE"]},
    {"code": "lv",  "name": "Latviešu",         "greeting": "Sveiki",         "regions": ["LV"]},
    {"code": "lt",  "name": "Lietuvių",         "greeting": "Labas",          "regions": ["LT"]},
    {"code": "el",  "name": "Ελληνικά",         "greeting": "Γεια",           "regions": ["GR","CY"]},
    {"code": "tr",  "name": "Türkçe",           "greeting": "Merhaba",        "regions": ["TR","CY"]},
    {"code": "uk",  "name": "Українська",       "greeting": "Привіт",         "regions": ["UA"]},
    {"code": "be",  "name": "Беларуская",       "greeting": "Прывітанне",     "regions": ["BY"]},
    {"code": "ga",  "name": "Gaeilge",          "greeting": "Dia duit",       "regions": ["IE"]},
    {"code": "cy",  "name": "Cymraeg",          "greeting": "Helo",           "regions": ["GB"]},
    {"code": "eu",  "name": "Euskara",          "greeting": "Kaixo",          "regions": ["ES"]},
    {"code": "ca",  "name": "Català",           "greeting": "Hola",           "regions": ["ES","AD"]},
    {"code": "gl",  "name": "Galego",           "greeting": "Ola",            "regions": ["ES"]},
    {"code": "mt",  "name": "Malti",            "greeting": "Bonġu",          "regions": ["MT"]},
    {"code": "sq",  "name": "Shqip",            "greeting": "Përshëndetje",   "regions": ["AL","XK"]},
    {"code": "mk",  "name": "Македонски",       "greeting": "Здраво",         "regions": ["MK"]},
    # Middle East / Central Asia
    {"code": "he",  "name": "עברית",            "greeting": "שלום",           "regions": ["IL"]},
    {"code": "fa",  "name": "فارسی",            "greeting": "سلام",           "regions": ["IR","AF"]},
    {"code": "ku",  "name": "Kurdî",            "greeting": "Silav",          "regions": ["IQ","TR","IR","SY"]},
    {"code": "ps",  "name": "پښتو",             "greeting": "سلام",           "regions": ["AF","PK"]},
    {"code": "az",  "name": "Azərbaycan",       "greeting": "Salam",          "regions": ["AZ"]},
    {"code": "uz",  "name": "O'zbek",           "greeting": "Salom",          "regions": ["UZ"]},
    {"code": "kk",  "name": "Қазақ",            "greeting": "Сәлем",          "regions": ["KZ"]},
    {"code": "ky",  "name": "Кыргыз",           "greeting": "Салам",          "regions": ["KG"]},
    {"code": "hy",  "name": "Հայերեն",          "greeting": "Բարև",           "regions": ["AM"]},
    {"code": "ka",  "name": "ქართული",          "greeting": "გამარჯობა",      "regions": ["GE"]},
    # SE / E Asia
    {"code": "vi",  "name": "Tiếng Việt",       "greeting": "Xin chào",       "regions": ["VN"]},
    {"code": "th",  "name": "ภาษาไทย",          "greeting": "สวัสดี",         "regions": ["TH"]},
    {"code": "id",  "name": "Bahasa Indonesia", "greeting": "Halo",           "regions": ["ID"]},
    {"code": "ms",  "name": "Bahasa Melayu",    "greeting": "Helo",           "regions": ["MY","BN"]},
    {"code": "tl",  "name": "Filipino",         "greeting": "Kamusta",        "regions": ["PH"]},
    {"code": "my",  "name": "မြန်မာဘာသာ",        "greeting": "မင်္ဂလာပါ",      "regions": ["MM"]},
    {"code": "km",  "name": "ខ្មែរ",             "greeting": "ជំរាបសួរ",       "regions": ["KH"]},
    {"code": "lo",  "name": "ລາວ",              "greeting": "ສະບາຍດີ",        "regions": ["LA"]},
    {"code": "mn",  "name": "Монгол",           "greeting": "Сайн уу",        "regions": ["MN"]},
    # African
    {"code": "sw",  "name": "Kiswahili",        "greeting": "Habari",         "regions": ["KE","TZ","UG","RW"]},
    {"code": "am",  "name": "አማርኛ",             "greeting": "ሰላም",            "regions": ["ET"]},
    {"code": "ha",  "name": "Hausa",            "greeting": "Sannu",          "regions": ["NG","NE"]},
    {"code": "yo",  "name": "Yorùbá",           "greeting": "Bawo",           "regions": ["NG","BJ"]},
    {"code": "ig",  "name": "Igbo",             "greeting": "Ndewo",          "regions": ["NG"]},
    {"code": "zu",  "name": "isiZulu",          "greeting": "Sawubona",       "regions": ["ZA"]},
    {"code": "xh",  "name": "isiXhosa",         "greeting": "Molo",           "regions": ["ZA"]},
    {"code": "af",  "name": "Afrikaans",        "greeting": "Hallo",          "regions": ["ZA","NA"]},
    {"code": "so",  "name": "Soomaali",         "greeting": "Salaan",         "regions": ["SO"]},
    {"code": "om",  "name": "Oromoo",           "greeting": "Akkam",          "regions": ["ET"]},
    {"code": "rw",  "name": "Kinyarwanda",      "greeting": "Muraho",         "regions": ["RW"]},
    {"code": "mg",  "name": "Malagasy",         "greeting": "Salama",         "regions": ["MG"]},
    # Pacific / Americas
    {"code": "mi",  "name": "Māori",            "greeting": "Kia ora",        "regions": ["NZ"]},
    {"code": "haw", "name": "ʻŌlelo Hawaiʻi",   "greeting": "Aloha",          "regions": ["US"]},
    {"code": "sm",  "name": "Gagana Sāmoa",     "greeting": "Talofa",         "regions": ["WS"]},
    {"code": "to",  "name": "Lea fakatonga",    "greeting": "Mālō e lelei",   "regions": ["TO"]},
    {"code": "qu",  "name": "Runa Simi",        "greeting": "Rimaykullayki",  "regions": ["PE","BO","EC"]},
    {"code": "gn",  "name": "Avañeʼẽ",          "greeting": "Mbaʼéichapa",    "regions": ["PY"]},
    {"code": "ht",  "name": "Kreyòl",           "greeting": "Bonjou",         "regions": ["HT"]},
]

_CODES = frozenset(e["code"].lower() for e in LANGUAGES)


def supported_language(code) -> str:
    """The app language to serve for a client-supplied code, or "en".

    A language code is used as a FILE NAME (the translation caches write
    `<lang>.json`) and as an LLM prompt, so it is never taken as given: only the
    codes on the picker above pass. `pt-BR` / `zh_TW` fall back to their base
    language; anything else — `../../x`, a random string per request to force a
    cold translation — is served in English."""
    c = str(code or "en").strip().lower()
    if c in _CODES:
        return c
    base = c.replace("_", "-").split("-")[0]
    return base if base in _CODES else "en"

AUTH_MODE = "otp_code"  # "otp_code" | "magic_link"

# SIGN IN WITH APPLE IN THE WEB APP. The phone uses Apple's native sheet; the web
# leaves for Apple's page through Supabase and comes back signed in, the same road
# Google takes there. It works only once Apple is set up on the Supabase project
# behind auth.plutto.space (Authentication → Providers → Apple: a Services ID with
# Sign in with Apple, return URL https://auth.plutto.space/auth/v1/callback, and
# its secret key), so it stays off until then.
#   False    hidden on the web (the phone apps are unaffected either way)
#   "apple"  iPhone, iPad and Mac browsers only
#   True     every browser
AUTH_WEB_APPLE = "apple"

# Input methods the auth screen renders. Append a new entry and the app shows it
# instantly — no app-store update.
#
# Phone is live: Twilio Verify is configured on the Supabase project behind
# auth.plutto.space (a HOSTED project — there is no GoTrue on our VPS to
# configure, despite the custom domain). sendPhoneOtp talks to Supabase directly,
# never through this API, so this list is the only thing on our side that gates it.
#
# Identity is safe for a phone-only user: get_user keys on the JWT "sub" and reads
# email with .get(), so a token with no email claim verifies like any other, and
# profiles.email is nullable.
#
# Two live dependencies worth knowing before touching this:
#   - India needs TRAI/DLT sender registration before SMS delivers there at all.
#     Until that clears, Indian numbers fail while every other country works.
#   - Supabase's SMS rate limit is PROJECT-WIDE per hour, not per number. Set too
#     low it silently caps total sign-ins an hour across all users.
# Comment the phone line out to withdraw the option instantly, no release.
AUTH_FIELDS = [
    {"id": "email", "type": "email", "icon": "envelope", "placeholder": "you@plutto.space"},
    # No dial code in the placeholder. The country is chosen through the flag in
    # the circle now, so a "+1" here would state a country the field does not
    # hold — and it was the US one, on a screen where nothing had been picked.
    # Zeroes say "digits go here" and nothing more.
    {"id": "phone", "type": "phone", "icon": "phone", "placeholder": "0000000000"},
]

COUNTRIES = [
    {"iso": "US", "name": "United States", "dial": "+1", "flag": "\U0001F1FA\U0001F1F8"},
    {"iso": "GB", "name": "United Kingdom", "dial": "+44", "flag": "\U0001F1EC\U0001F1E7"},
    {"iso": "IN", "name": "India", "dial": "+91", "flag": "\U0001F1EE\U0001F1F3"},
    {"iso": "CA", "name": "Canada", "dial": "+1", "flag": "\U0001F1E8\U0001F1E6"},
    {"iso": "AU", "name": "Australia", "dial": "+61", "flag": "\U0001F1E6\U0001F1FA"},
    {"iso": "AE", "name": "United Arab Emirates", "dial": "+971", "flag": "\U0001F1E6\U0001F1EA"},
    {"iso": "SA", "name": "Saudi Arabia", "dial": "+966", "flag": "\U0001F1F8\U0001F1E6"},
    {"iso": "SG", "name": "Singapore", "dial": "+65", "flag": "\U0001F1F8\U0001F1EC"},
    {"iso": "DE", "name": "Germany", "dial": "+49", "flag": "\U0001F1E9\U0001F1EA"},
    {"iso": "FR", "name": "France", "dial": "+33", "flag": "\U0001F1EB\U0001F1F7"},
    {"iso": "ES", "name": "Spain", "dial": "+34", "flag": "\U0001F1EA\U0001F1F8"},
    {"iso": "IT", "name": "Italy", "dial": "+39", "flag": "\U0001F1EE\U0001F1F9"},
    {"iso": "PT", "name": "Portugal", "dial": "+351", "flag": "\U0001F1F5\U0001F1F9"},
    {"iso": "NL", "name": "Netherlands", "dial": "+31", "flag": "\U0001F1F3\U0001F1F1"},
    {"iso": "BE", "name": "Belgium", "dial": "+32", "flag": "\U0001F1E7\U0001F1EA"},
    {"iso": "CH", "name": "Switzerland", "dial": "+41", "flag": "\U0001F1E8\U0001F1ED"},
    {"iso": "AT", "name": "Austria", "dial": "+43", "flag": "\U0001F1E6\U0001F1F9"},
    {"iso": "SE", "name": "Sweden", "dial": "+46", "flag": "\U0001F1F8\U0001F1EA"},
    {"iso": "NO", "name": "Norway", "dial": "+47", "flag": "\U0001F1F3\U0001F1F4"},
    {"iso": "DK", "name": "Denmark", "dial": "+45", "flag": "\U0001F1E9\U0001F1F0"},
    {"iso": "FI", "name": "Finland", "dial": "+358", "flag": "\U0001F1EB\U0001F1EE"},
    {"iso": "IE", "name": "Ireland", "dial": "+353", "flag": "\U0001F1EE\U0001F1EA"},
    {"iso": "PL", "name": "Poland", "dial": "+48", "flag": "\U0001F1F5\U0001F1F1"},
    {"iso": "CZ", "name": "Czechia", "dial": "+420", "flag": "\U0001F1E8\U0001F1FF"},
    {"iso": "GR", "name": "Greece", "dial": "+30", "flag": "\U0001F1EC\U0001F1F7"},
    {"iso": "RO", "name": "Romania", "dial": "+40", "flag": "\U0001F1F7\U0001F1F4"},
    {"iso": "HU", "name": "Hungary", "dial": "+36", "flag": "\U0001F1ED\U0001F1FA"},
    {"iso": "RU", "name": "Russia", "dial": "+7", "flag": "\U0001F1F7\U0001F1FA"},
    {"iso": "UA", "name": "Ukraine", "dial": "+380", "flag": "\U0001F1FA\U0001F1E6"},
    {"iso": "TR", "name": "Türkiye", "dial": "+90", "flag": "\U0001F1F9\U0001F1F7"},
    {"iso": "IL", "name": "Israel", "dial": "+972", "flag": "\U0001F1EE\U0001F1F1"},
    {"iso": "EG", "name": "Egypt", "dial": "+20", "flag": "\U0001F1EA\U0001F1EC"},
    {"iso": "ZA", "name": "South Africa", "dial": "+27", "flag": "\U0001F1FF\U0001F1E6"},
    {"iso": "NG", "name": "Nigeria", "dial": "+234", "flag": "\U0001F1F3\U0001F1EC"},
    {"iso": "KE", "name": "Kenya", "dial": "+254", "flag": "\U0001F1F0\U0001F1EA"},
    {"iso": "GH", "name": "Ghana", "dial": "+233", "flag": "\U0001F1EC\U0001F1ED"},
    {"iso": "TZ", "name": "Tanzania", "dial": "+255", "flag": "\U0001F1F9\U0001F1FF"},
    {"iso": "ET", "name": "Ethiopia", "dial": "+251", "flag": "\U0001F1EA\U0001F1F9"},
    {"iso": "MA", "name": "Morocco", "dial": "+212", "flag": "\U0001F1F2\U0001F1E6"},
    {"iso": "DZ", "name": "Algeria", "dial": "+213", "flag": "\U0001F1E9\U0001F1FF"},
    {"iso": "PK", "name": "Pakistan", "dial": "+92", "flag": "\U0001F1F5\U0001F1F0"},
    {"iso": "BD", "name": "Bangladesh", "dial": "+880", "flag": "\U0001F1E7\U0001F1E9"},
    {"iso": "LK", "name": "Sri Lanka", "dial": "+94", "flag": "\U0001F1F1\U0001F1F0"},
    {"iso": "NP", "name": "Nepal", "dial": "+977", "flag": "\U0001F1F3\U0001F1F5"},
    {"iso": "CN", "name": "China", "dial": "+86", "flag": "\U0001F1E8\U0001F1F3"},
    {"iso": "HK", "name": "Hong Kong", "dial": "+852", "flag": "\U0001F1ED\U0001F1F0"},
    {"iso": "TW", "name": "Taiwan", "dial": "+886", "flag": "\U0001F1F9\U0001F1FC"},
    {"iso": "JP", "name": "Japan", "dial": "+81", "flag": "\U0001F1EF\U0001F1F5"},
    {"iso": "KR", "name": "South Korea", "dial": "+82", "flag": "\U0001F1F0\U0001F1F7"},
    {"iso": "TH", "name": "Thailand", "dial": "+66", "flag": "\U0001F1F9\U0001F1ED"},
    {"iso": "VN", "name": "Vietnam", "dial": "+84", "flag": "\U0001F1FB\U0001F1F3"},
    {"iso": "PH", "name": "Philippines", "dial": "+63", "flag": "\U0001F1F5\U0001F1ED"},
    {"iso": "ID", "name": "Indonesia", "dial": "+62", "flag": "\U0001F1EE\U0001F1E9"},
    {"iso": "MY", "name": "Malaysia", "dial": "+60", "flag": "\U0001F1F2\U0001F1FE"},
    {"iso": "BR", "name": "Brazil", "dial": "+55", "flag": "\U0001F1E7\U0001F1F7"},
    {"iso": "MX", "name": "Mexico", "dial": "+52", "flag": "\U0001F1F2\U0001F1FD"},
    {"iso": "AR", "name": "Argentina", "dial": "+54", "flag": "\U0001F1E6\U0001F1F7"},
    {"iso": "CO", "name": "Colombia", "dial": "+57", "flag": "\U0001F1E8\U0001F1F4"},
    {"iso": "CL", "name": "Chile", "dial": "+56", "flag": "\U0001F1E8\U0001F1F1"},
    {"iso": "PE", "name": "Peru", "dial": "+51", "flag": "\U0001F1F5\U0001F1EA"},
    {"iso": "NZ", "name": "New Zealand", "dial": "+64", "flag": "\U0001F1F3\U0001F1FF"},
    {"iso": "QA", "name": "Qatar", "dial": "+974", "flag": "\U0001F1F6\U0001F1E6"},
    {"iso": "KW", "name": "Kuwait", "dial": "+965", "flag": "\U0001F1F0\U0001F1FC"},
    {"iso": "BH", "name": "Bahrain", "dial": "+973", "flag": "\U0001F1E7\U0001F1ED"},
    {"iso": "OM", "name": "Oman", "dial": "+968", "flag": "\U0001F1F4\U0001F1F2"},
    {"iso": "JO", "name": "Jordan", "dial": "+962", "flag": "\U0001F1EF\U0001F1F4"},
    {"iso": "LB", "name": "Lebanon", "dial": "+961", "flag": "\U0001F1F1\U0001F1E7"},
    {"iso": "IQ", "name": "Iraq", "dial": "+964", "flag": "\U0001F1EE\U0001F1F6"},
    {"iso": "IR", "name": "Iran", "dial": "+98", "flag": "\U0001F1EE\U0001F1F7"},
    {"iso": "AF", "name": "Afghanistan", "dial": "+93", "flag": "\U0001F1E6\U0001F1EB"},
    {"iso": "KZ", "name": "Kazakhstan", "dial": "+7", "flag": "\U0001F1F0\U0001F1FF"},
    {"iso": "UZ", "name": "Uzbekistan", "dial": "+998", "flag": "\U0001F1FA\U0001F1FF"},
]


# THE RED language_transition GIF IS RETIRED. Every wait in the app is the app's
# own red ball (MicroLoader), drawn on the first frame with nothing to download.
#
# The language transition carries NO media. Without a mediaPath the app draws
# the ball (App.js TransitionMedia, every build since 33). The catalog's
# `loader.native` already asked for that, but a new user picks a language before
# any catalog exists, so it never reached them: they got ~2.4 s of black while
# the 417 KB GIF downloaded, then a blurry red square on a grey box.
LANGUAGE_TRANSITION_CONTENT = {}
# screens.loading is the wait after a first-time user finishes birth details. Every
# shipped build draws ONLY the media named here (no media = a blank screen), so the
# app's red ball comes as media: static/onboarding/ball.gif, the shipped
# ballPhysics.js rendered frame for frame (the same ball the language transition
# draws), on black: one cycle, 270 px, 50 fps (a GIF's best), 64 KB, looping. A GIF,
# not a video: a video player on an iPhone takes the audio session and stops the
# reader's music, and the web player never starts one; a GIF animates everywhere.
# Kept small because iOS holds every decoded frame (~59 MB here). The app washes
# images (a 20% tint and a light blur; on Android a darker scrim), so its red is
# brightened as far as red goes: close to the drawn ball on iOS and the web,
# visibly darker on Android. Under onboarding/, so it is downloaded during the
# language transition and plays at once; the .gif is spelled out so it resolves
# before the manifest has loaded. magazine.LOADING_GROUND keeps the screen black in
# Day. It must ship WITH this line: a missing file is a blank wait, not a fallback.
LOADING_CONTENT = {"mediaPath": "onboarding/ball.gif"}
# Its own asset — the daily warm-up is a returning-user moment.
DAILY_LOADING_CONTENT = {"mediaPath": "loaders/daily_loading"}


def _language_name(code: str) -> str:
    code = (code or "").strip().lower()
    for entry in LANGUAGES:
        if entry["code"].lower() == code:
            return entry["name"]
    return code


# Systems offered at onboarding. The user picks ONE; it becomes the single source
# of truth for their whole experience (no cross-system mixing). Order here is the
# fallback display order; the screen promotes the recommended system to the big
# top slot and renders the other two, smaller, below. Built from the SYSTEMS
# registry so ids/labels/media/colors stay in one place.
SYSTEM_SELECT_IDS = ["bphs", "western", "chinese"]


SYSTEM_SELECT_REGISTER = "poetic, minimal, soft — choosing a divination system in an astrology app"


def _system_copy_baseline():
    """The translatable English strings for the system-select screen: headings +
    per-system label/blurb. Built from the SYSTEMS registry so it tracks
    SYSTEM_SELECT_IDS. Geometry/media/colors/ids are NOT translated."""
    from app.services.catalog.data import SYSTEMS

    by_id = {s["id"]: s for s in SYSTEMS}
    systems = {}
    for sid in SYSTEM_SELECT_IDS:
        s = by_id.get(sid)
        if not s:
            continue
        systems[sid] = {"label": s["name"], "blurb": s.get("provenance") or ""}
    return {
        "title":    "Choose your path",
        "subtitle": "This shapes your entire experience. You can change it later in Settings.",
        "badge":    "Recommended for you",
        "systems":  systems,
    }


async def build_system_screen(lang: str):
    """Backend-controlled content for the onboarding system-select screen.

    Every element is data-driven (copy, ordered system list, media, recommended
    seed, AND geometry) so the screen can be reworded/restyled/relaid without an
    app build. Copy passes through the app language via the shared onboarding
    translator (English on cache miss / failure — never blocks onboarding). The
    client refines `recommended` at runtime via /recommend-system.
    """
    from app.services.catalog.data import SYSTEMS
    from app.services.onboarding_translator import translate_copy, TranslationUnavailable

    by_id = {s["id"]: s for s in SYSTEMS}
    baseline = _system_copy_baseline()
    try:
        copy = await translate_copy(baseline, "system_select", SYSTEM_SELECT_REGISTER, lang, _language_name(lang))
    except TranslationUnavailable:
        copy = baseline   # graceful: the system screen never blocks the bundle

    csys = copy.get("systems", {})
    systems = []
    for sid in SYSTEM_SELECT_IDS:
        s = by_id.get(sid)
        if not s:
            continue
        c = csys.get(sid, {})
        systems.append({
            "id":     s["id"],
            "label":  c.get("label") or s["name"],
            "blurb":  c.get("blurb") or s.get("provenance"),
            "media":  s.get("glyph"),
            "color":  s.get("color"),
            "engine": s.get("engine"),
        })
    return {
        "title":       copy.get("title"),
        "subtitle":    copy.get("subtitle"),
        "badge":       copy.get("badge"),
        "recommended": SYSTEM_SELECT_IDS[0],   # seed; client refines via /recommend-system
        "recommend":   True,
        "systems":     systems,
        # Backend-controlled geometry (px). Tune freely / per system count; the app
        # falls back to its own responsive defaults for any omitted key. Optional
        # overrides: "bigSize", "smallSize", "topPadding", "bottomPadding". Set
        # "wrap": true to flow the lower systems into a grid when there are many.
        "layout": {
            "colGap": 48,
            "rowGap": 32,
            "wrap":   False,
        },
    }


# How long the caller may wait for a translation before we answer in English and
# finish the translation in the background.
_TRANSLATE_DEADLINE_S = float(os.environ.get("ONBOARDING_TRANSLATE_TIMEOUT", "8"))


async def _birth_within_deadline(lang: str, name: str):
    """Birth-screen copy, translated if it can be had quickly, English if not.

    THIS ENDPOINT MUST NOT FAIL OR STALL, and the reason is worth stating because
    the old contract said the opposite: "raises TranslationUnavailable … the API
    layer turns that into a 5xx so the client retries."

    The client does retry — with no cap and no deadline, on a build that is already
    on people's phones and cannot be reached by an over-the-air update, because a
    fresh install runs the embedded bundle through the whole of onboarding. And the
    language transition AWAITS that retry. So a 5xx here is not a retry, it is a
    permanent hang on the loading animation with no way out but killing the app.

    That is exactly what a fresh install hits: an existing install usually
    short-circuits (its bundle is already in the chosen language and no fetch
    happens), while a fresh one must fetch, and only two languages had a warm
    translation cache — so nearly every first-time user of nearly every language was
    one cold LLM call away from a dead app. Adding fifteen languages made it worse.

    English copy for a few seconds is a small, self-correcting cost. The background
    task means the next person to choose that language gets it translated, and the
    one after that gets it from disk."""
    from app.services.onboarding_translator import get_birth_content, BIRTH_BASELINE
    if lang == "en":
        return BIRTH_BASELINE
    try:
        return await asyncio.wait_for(get_birth_content(lang, name), _TRANSLATE_DEADLINE_S)
    except Exception as e:
        print(f"[onboarding] birth copy for {lang!r} not ready ({type(e).__name__}); "
              f"serving English and warming in the background", flush=True)
        _warm(get_birth_content(lang, name))   # one-time cost, for one unlucky user
        return BIRTH_BASELINE


def _warm(coro) -> None:
    """Finish a translation off-request so the next caller finds it cached.

    The result is deliberately discarded, but the task must still be awaited by
    SOMETHING or a failure surfaces as "Task exception was never retrieved" in the
    log — noise that looks like a defect and buries the ones that are."""
    async def _run():
        try:
            await coro
        except Exception:
            pass
    try:
        asyncio.create_task(_run())
    except Exception:
        coro.close()


async def _system_within_deadline(lang: str):
    """Same guarantee as the birth copy: bounded, English on timeout, never raises.
    It is the second awaited translation on this path, so leaving it unbounded would
    have kept the endpoint hangable through a different door.

    Returns {} rather than retrying in English. A nested retry here was the third
    deadline in a chain — at the default eight seconds the worst case was nineteen,
    on a screen someone is watching an animation on. The system screen is chosen
    AFTER birth details, so an empty one costs nothing on this request; the warm
    below has it ready long before the user reaches it."""
    try:
        return await asyncio.wait_for(build_system_screen(lang), _TRANSLATE_DEADLINE_S)
    except Exception as e:
        print(f"[onboarding] system screen for {lang!r} not ready ({type(e).__name__}); "
              f"warming in the background", flush=True)
        _warm(build_system_screen(lang))
        return {}


def _welcome_cycle(lang: str, count: int = 200):
    """The auth screen's opening line, in many languages at once.

    Every other string in this payload is needed in ONE language — the reader's.
    This one is needed in a dozen, so it cannot come from the per-language
    translation the way the rest does; it is assembled by reading the same
    shipped file across languages.

    EVERY language, not a sample. This feeds a 3-second pass through the name in
    each script, and the app fits as many as the window holds — so the number
    here is a supply, not a duration, and capping it only made the pass thinner
    than it needed to be.

    The list collapses on its own: the app drops duplicate spellings, and most
    of the 109 write the name in Latin, so what actually shows is roughly one
    entry per SCRIPT. That is the right unit anyway — a pass through fifty
    identical "Plutto"s would look frozen, not multilingual.

    The reader's own goes FIRST and is never dropped, whichever of the 109 it is.
    That beat is the point of the whole sequence: a user whose language is
    missing from the rotation would be greeted in English, which is the one
    outcome it exists to prevent.
    """
    try:
        from app.services.onboarding_translator import _BUNDLED, BIRTH_BASELINE
    except Exception:
        return []

    def _entry(code):
        e = _BUNDLED.get(code) or {}
        space = e.get("welcomeSpace")
        if not (isinstance(space, str) and space.strip()):
            return None
        return {"code": code,
                "lead": e.get("welcomeLead") or BIRTH_BASELINE.get("welcomeLead"),
                "space": space,
                "brand": e.get("welcomeBrand") or BIRTH_BASELINE.get("welcomeBrand")}

    lang = (lang or "en").strip().lower()
    head = _entry(lang) or {"code": lang,
                            "lead": BIRTH_BASELINE.get("welcomeLead"),
                            "space": BIRTH_BASELINE.get("welcomeSpace"),
                            "brand": BIRTH_BASELINE.get("welcomeBrand")}
    out = [head]
    english = BIRTH_BASELINE.get("welcomeSpace")
    for e in LANGUAGES:
        code = (e.get("code") or "").lower()
        if code == lang or len(out) >= count:
            continue
        got = _entry(code)
        # Only genuinely translated languages join the rotation. Padding it with
        # English under another language's code would be a lie the screen tells
        # twelve times a minute.
        if got and got["space"] != english:
            out.append(got)
    return out


async def build_onboarding_payload(language: str):
    """Compose the full onboarding payload for the given language.

    Never raises and never stalls: every piece that needs translating is bounded,
    and falls back to English rather than failing the request. See
    _birth_within_deadline for why that matters more than the missing translation.
    """
    lang = supported_language(language)
    name = _language_name(lang)
    # CONCURRENTLY. They do not depend on each other, and awaiting them in sequence
    # made the deadlines additive — the whole point of a deadline is that the caller
    # knows the worst case, and two of them in a row doubles it.
    birth, system = await asyncio.gather(
        _birth_within_deadline(lang, name),
        _system_within_deadline(lang),
    )
    # namePrefix: the greeting before the user's name on the birth screen,
    # in the language's own native script (from LANGUAGES). Comma uses a
    # fullwidth comma for CJK so it sits right beside the name.
    _greet = next((e.get("greeting") for e in LANGUAGES if e["code"].lower() == lang), None) or "Hello"
    _comma = "，" if lang in ("zh", "ja") else ","
    birth = {**birth, "namePrefix": f"{_greet}{_comma}"}

    return {
        "language":  lang,
        "languages": LANGUAGES,
        # Onboarding step order. 'system' (system-select) runs after 'birth';
        # clients that predate it skip the unknown step harmlessly.
        "flow": ["intro", "language", "birth", "system"],
        "screens": {
            "intro": [],   # backend-driven onboarding slides (add dicts to enable)
            "auth": {"authMode": AUTH_MODE, "fields": AUTH_FIELDS, "countries": COUNTRIES,
                     "webApple": AUTH_WEB_APPLE,
                     "countrySearch": "Search", "backTopLeft": True,
                     # The eclipse at the foot of the auth screen. Extensionless —
                     # RemoteMedia resolves the real file from the manifest, so the
                     # format can change server-side without touching this.
                     #
                     # It lives under onboarding/ on purpose: that is the manifest's
                     # PINNED tier, so it is downloaded before first launch rather
                     # than streamed while the screen it belongs to is already up.
                     # Nowhere else does that distinction matter as much — this is
                     # the first thing a new user sees.
                     "eclipse": "onboarding/eclipse",
                     # 663/768 — the file's own aspect. At 0.62 the frame was a third
                     # shorter than the image and `cover` cropped 187px off it, top
                     # and bottom. Matched exactly, it fills the width with nothing
                     # lost and no letterbox.
                     "eclipseRatio": 0.863,
                     # Points to push the eclipse DOWN past the bottom edge. The
                     # arc sat too high and crowded the form; dropping it puts the
                     # bright part below the fold and leaves the glow.
                     "eclipseDrop": 90,
                     # IN A BROWSER it hangs from the TOP instead, its upper part
                     # past the edge of the window, and the form starts under it.
                     # eclipseWidth is of the app's column, eclipseCut the share of
                     # the image above the top edge, eclipseFormGap the air between
                     # the image and the first field. Phones never read this.
                     "eclipseWeb": {"eclipseWidth": 0.95, "eclipseCut": 0.5, "eclipseFormGap": 28},
                     # The opening line. 'static' shows it once and leaves it;
                     # 'cycle' runs the full rotation; 'off' hides it entirely.
                     # A value, not a release — this decision has moved four times.
                     "welcomeMode": "off",
                     "welcomeLead": birth.get("welcomeLead") or "Welcome to",
                     "welcomeSpace": birth.get("welcomeSpace") or "Your space",
                     "welcomeBrand": birth.get("welcomeBrand") or "Plutto",
                     "welcomeCycle": _welcome_cycle(lang),
                     # THE CONSENT LINE, under the sign-in methods. Continuing IS
                     # agreeing — no checkbox, one sentence, two live links. The
                     # words are the app's own (App Review reads it), the URLs are
                     # the backend's own pages, and {terms}/{privacy} are where
                     # the links go so a translation can move them.
                     "consent": {
                         "text": "Continuing means you agree to our {terms} and {privacy}.",
                         "links": {
                             "terms":   {"label": "Terms", "url": "https://api.plutto.space/terms"},
                             "privacy": {"label": "Privacy Policy", "url": "https://api.plutto.space/privacy"},
                         },
                     }},
            "birth":              birth,
            "system":             system,
            "languageTransition": LANGUAGE_TRANSITION_CONTENT,
            "loading":            LOADING_CONTENT,
            "dailyLoading":       DAILY_LOADING_CONTENT,
        },
    }


# --- plutto: full country dial-code list (backend source of truth) ---
# Flags are derived from the ISO code (regional-indicator letters), so adding a
# country is just one (ISO, name, dial) tuple. Overrides the short list above.
def _flag(iso):
    try:
        return ''.join(chr(0x1F1E6 + ord(c) - ord('A')) for c in iso.upper()[:2])
    except Exception:
        return ''

_COUNTRY_DATA = [
    ("US","United States","+1"),("GB","United Kingdom","+44"),("IN","India","+91"),
    ("CA","Canada","+1"),("AU","Australia","+61"),("AE","United Arab Emirates","+971"),
    ("SA","Saudi Arabia","+966"),("SG","Singapore","+65"),("DE","Germany","+49"),
    ("FR","France","+33"),("ES","Spain","+34"),("IT","Italy","+39"),("PT","Portugal","+351"),
    ("NL","Netherlands","+31"),("BE","Belgium","+32"),("CH","Switzerland","+41"),
    ("AT","Austria","+43"),("SE","Sweden","+46"),("NO","Norway","+47"),("DK","Denmark","+45"),
    ("FI","Finland","+358"),("IE","Ireland","+353"),("PL","Poland","+48"),("CZ","Czechia","+420"),
    ("GR","Greece","+30"),("RO","Romania","+40"),("HU","Hungary","+36"),("RU","Russia","+7"),
    ("UA","Ukraine","+380"),("TR","Turkey","+90"),("IL","Israel","+972"),("QA","Qatar","+974"),
    ("KW","Kuwait","+965"),("BH","Bahrain","+973"),("OM","Oman","+968"),("JO","Jordan","+962"),
    ("LB","Lebanon","+961"),("EG","Egypt","+20"),("MA","Morocco","+212"),("DZ","Algeria","+213"),
    ("TN","Tunisia","+216"),("ZA","South Africa","+27"),("NG","Nigeria","+234"),("KE","Kenya","+254"),
    ("GH","Ghana","+233"),("ET","Ethiopia","+251"),("TZ","Tanzania","+255"),("UG","Uganda","+256"),
    ("CN","China","+86"),("HK","Hong Kong","+852"),("TW","Taiwan","+886"),("JP","Japan","+81"),
    ("KR","South Korea","+82"),("TH","Thailand","+66"),("VN","Vietnam","+84"),("MY","Malaysia","+60"),
    ("ID","Indonesia","+62"),("PH","Philippines","+63"),("PK","Pakistan","+92"),("BD","Bangladesh","+880"),
    ("LK","Sri Lanka","+94"),("NP","Nepal","+977"),("AF","Afghanistan","+93"),("IR","Iran","+98"),
    ("IQ","Iraq","+964"),("MM","Myanmar","+95"),("KH","Cambodia","+855"),("BR","Brazil","+55"),
    ("MX","Mexico","+52"),("AR","Argentina","+54"),("CL","Chile","+56"),("CO","Colombia","+57"),
    ("PE","Peru","+51"),("VE","Venezuela","+58"),("EC","Ecuador","+593"),("BO","Bolivia","+591"),
    ("PY","Paraguay","+595"),("UY","Uruguay","+598"),("CR","Costa Rica","+506"),("PA","Panama","+507"),
    ("GT","Guatemala","+502"),("DO","Dominican Republic","+1"),("JM","Jamaica","+1"),("TT","Trinidad and Tobago","+1"),
    ("NZ","New Zealand","+64"),("FJ","Fiji","+679"),("IS","Iceland","+354"),("LU","Luxembourg","+352"),
    ("SK","Slovakia","+421"),("SI","Slovenia","+386"),("HR","Croatia","+385"),("RS","Serbia","+381"),
    ("BG","Bulgaria","+359"),("LT","Lithuania","+370"),("LV","Latvia","+371"),("EE","Estonia","+372"),
    ("CY","Cyprus","+357"),("MT","Malta","+356"),("AL","Albania","+355"),("MK","North Macedonia","+389"),
    ("BA","Bosnia and Herzegovina","+387"),("GE","Georgia","+995"),("AM","Armenia","+374"),("AZ","Azerbaijan","+994"),
    ("KZ","Kazakhstan","+7"),("UZ","Uzbekistan","+998"),("BY","Belarus","+375"),("MD","Moldova","+373"),
    ("YE","Yemen","+967"),("SY","Syria","+963"),("LY","Libya","+218"),("SD","Sudan","+249"),
    ("ZW","Zimbabwe","+263"),("ZM","Zambia","+260"),("AO","Angola","+244"),("MZ","Mozambique","+258"),
    ("CM","Cameroon","+237"),("CI","Côte d'Ivoire","+225"),("SN","Senegal","+221"),("RW","Rwanda","+250"),
    ("MN","Mongolia","+976"),("BN","Brunei","+673"),("LA","Laos","+856"),("MV","Maldives","+960"),
    ("BT","Bhutan","+975"),("MO","Macau","+853"),("PR","Puerto Rico","+1"),("HN","Honduras","+504"),
    ("NI","Nicaragua","+505"),("SV","El Salvador","+503"),
]

COUNTRIES = [{"iso": i, "name": n, "dial": d, "flag": _flag(i)} for (i, n, d) in _COUNTRY_DATA]
