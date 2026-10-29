/**
 * WHAT THE APPS USED TO KEEP, SENT FROM HERE (docs/server-push-audit.md, groups A and B).
 *
 * Lists and words the phone, the keyboards and the desktop each had built in, so changing one meant a store
 * release or an installer. Each app keeps today's copy as the fallback for the moment before a bootstrap or a
 * keyboard config has ever arrived; from then on these win, and the control console can change any of them.
 *
 *   desktopLists()      the desktop's one-key router (router.js), Ask's grammar (resolver.js, from the
 *                       server's own agent/grammar.ts and resolver.ts), the tray's tones, its wake names and
 *                       where "Tailzu Code activity…" goes
 *   deskVoices()        the person's own voices for the tray (per person: never a knob)
 *   keyboardLists()     swipe typing's word lists and the key click, for each keyboard
 *
 * SECURITY FLOORS ARE NOT HERE. The private and sensitive app lists, Ask's risk words, the file tools' and the
 * runner's guards stay in the apps; what the server may send for those (desktop.apps.*, desktop.agent.browsers)
 * the apps only ever add to their own, never take from.
 */
import type { Personality } from "../../../shared/types/api.js";
import { GRAMMAR_RULES } from "../agent/grammar.js";
import { RESOLVER_RULES } from "../agent/resolver.js";
import { NAME_HEARD, NAME_HEARD_FRONT_ONLY, nameWords } from "./assistantName.js";
import { applyPresetOverrides, DEFAULT_TONE, MAX_PINNED_PRESETS, TONE_LABELS, type PresetTone } from "./personalityPresets.js";

// ===================================================================== the desktop

/**
 * THE TRAY'S TONES, named as everywhere else (TONE_LABELS: "ZU", "Formal"…). The tray showed its own fallback
 * list, the ids themselves in lower case ("none", "very-casual"), because nothing sent one. The id is what the
 * tray stores and sends (personality.activeTone); the label is what it shows, translated (i18n LIST_WORD_FLAGS).
 */
export const DESKTOP_TONES: ReadonlyArray<{ id: PresetTone; label: string }> = (Object.keys(TONE_LABELS) as PresetTone[])
  .map((id) => ({ id, label: TONE_LABELS[id] }));

/**
 * The person's own voices for the tray, first, beside the tones (desktop.voices: a tray from this release on
 * shows them and picks one as the keyboard does, { activePresetId, activeTone }). Per person, so it is sent with
 * their bootstrap and never as a knob. Zu is the tones' first row, so it is not repeated.
 */
export function deskVoices(personality: Personality | null | undefined): Array<{ id: string; label: string; tone: PresetTone }> {
  const ids = Array.isArray(personality?.pinnedPresetIds) ? personality!.pinnedPresetIds! : [];
  const presets = applyPresetOverrides(personality?.presetOverrides);
  return ids
    .map((id) => presets.find((p) => p.id === id))
    .filter((p): p is (typeof presets)[number] => !!p && p.id !== "signature")
    .slice(0, MAX_PINNED_PRESETS)
    .map((p) => ({ id: p.id, label: p.name, tone: p.defaultTone ?? DEFAULT_TONE }));
}

/**
 * THE ONE-KEY ROUTER'S LISTS (desktop router.js reads each as desktop.router.<name>): where spoken words go when
 * the key comes up. Phrases match the words as router.js normalises them (lower case, no punctuation, "what's" is
 * "whats"); `screenStrong` and each task's `re` are patterns on those words, with the u flag. Add a language or
 * a mishearing of the name here and every desktop has it at its next bootstrap.
 */
export const DESKTOP_ROUTER = {
  heardAs: [
    // X0 however the recognizer spells it ("XO", "x o", "X zero", "ex oh", "zero bot", "X0 Bot": assistantName.ts).
    { name: "x0", heard: NAME_HEARD.map(nameWords).filter((f) => !f.includes("tail")) },
    // Its old name, so a habit keeps working.
    { name: "tailzu", heard: ["tailzu", "tail zu", "tailzoo", "tail zoo", "tell zu", "tell zoo", "telzu", "tel zu", "taylzu", "tailsu", "tailzoo", "टेलज़ू", "टेलजू", "टेल्ज़ू", "टेल ज़ू"] },
    { name: "blip", heard: ["blip", "blipp", "ब्लिप"] },
  ],
  // Ways of hearing the name that are ordinary words too ("love you, xo"): the name only at the start, never at the end.
  frontOnly: [...NAME_HEARD_FRONT_ONLY],
  greetings: [
    "hey", "hi", "hello", "ok", "okay", "o", "oye", "oi", "arre", "are", "arey", "suno", "listen", "yo", "हे", "अरे",
    "सुनो", "ओ", "ओके", "हाय", "हेलो",
  ],
  notesPre: [
    "please", "pls", "plz", "can you", "could you", "will you", "would you", "kindly", "zara", "jara", "ab", "now",
    "lets", "let us", "go ahead and", "ok", "okay", "अब", "ज़रा", "जरा", "प्लीज़", "प्लीज",
  ],
  notesSuffix: [
    "please", "pls", "plz", "now", "for me", "na", "abhi", "ab", "jaldi", "yaar", "ji", "thanks", "thank you",
    "for this meeting", "of this meeting", "for the meeting", "of the meeting", "for this call", "of this call",
    "for the call", "of the call", "now please", "ना", "अभी", "जल्दी", "प्लीज़", "प्लीज", "जी",
  ],
  notesStart: [
    "take", "taking", "start", "start taking", "begin", "begin taking", "record", "start recording", "turn on",
    "switch on", "keep",
  ],
  notesStartHi: [
    "on", "start", "shuru", "lo", "le lo", "lelo", "lena", "lena shuru karo", "lena shuru kar do", "lijiye", "lijie",
    "banao", "bana lo", "banana shuru karo", "shuru karo", "shuru kar do", "start karo", "start kar do", "chalu karo",
    "chalu kar do", "on karo", "on kar do", "likho", "likhna shuru karo",
  ],
  notesStartDeva: [
    "लो", "ले लो", "लेना शुरू करो", "लेना शुरू कर दो", "शुरू करो", "शुरू कर दो", "बनाओ", "बना लो", "चालू करो",
    "चालू कर दो", "लिखो",
  ],
  notesStop: [
    "stop", "stop taking", "end", "finish", "turn off", "switch off", "pause", "done with", "close", "stop recording",
  ],
  notesStopHi: [
    "off", "stop", "done", "band", "band karo", "band kar do", "bas", "bas karo", "rok do", "roko", "ruko", "stop karo",
    "stop kar do", "khatam karo", "khatam kar do", "khatam", "off karo", "off kar do", "lena band karo",
    "lena band kar do",
  ],
  notesStopDeva: [
    "बंद करो", "बंद कर दो", "बंद", "रोको", "रोक दो", "बस", "बस करो", "ख़त्म करो", "खत्म करो", "ख़त्म", "खत्म",
    "लेना बंद करो",
  ],
  questionStart: [
    "what", "whats", "why", "how", "hows", "where", "wheres", "when", "whens", "who", "whos", "whom", "whose", "which",
    "can you", "could you", "would you", "will you", "do you", "did you", "does", "do i", "did i", "is", "isnt", "are",
    "arent", "was", "were", "should", "shall", "may i", "can i", "could i", "have you", "has", "kya", "kaise", "kaisa",
    "kaisi", "kahan", "kahaan", "kab", "kaun", "kaunsa", "kaunsi", "kyun", "kyon", "kyu", "kitna", "kitne", "kitni",
    "क्या", "कैसे", "कैसा", "कहाँ", "कहां", "कब", "कौन", "क्यों", "क्यूँ", "कितना", "कितने", "कितनी",
  ],
  questionEnd: [
    "kya", "kya hai", "hai kya", "kaise", "kahan hai", "kab hai", "kaun hai", "kyun", "kya hua", "क्या", "क्या है",
    "है क्या", "कैसे", "कहाँ है", "कब है", "कौन है", "क्यों", "क्या हुआ",
  ],
  commandVerbs: [
    "open", "close", "show", "find", "search", "look up", "lookup", "go to", "take me to", "navigate to", "click",
    "press", "tap", "scroll", "tell me", "explain", "summarize", "summarise", "translate", "read", "play", "pause",
    "resume", "send", "set", "turn on", "turn off", "switch", "remind", "schedule", "book", "plan", "fix", "create",
    "make", "add", "delete", "remove", "move", "rename", "start", "stop", "check", "help", "give me", "list", "compare",
    "order", "call", "email", "message", "text", "write", "draft", "copy", "save", "download", "upload", "share", "mute",
    "unmute", "zoom", "minimize", "maximize", "refresh", "reload", "undo", "redo", "select", "highlight", "bookmark",
    "install", "update", "run", "launch", "quit", "exit", "cancel", "join", "leave", "reply", "forward", "organize",
    "organise", "sort", "clean up", "empty",
  ],
  commandEnd: [
    "kholo", "khol do", "dikhao", "dikha do", "batao", "bata do", "bhejo", "bhej do", "dhoondho", "dhundo", "dhundho",
    "search karo", "band karo", "band kar do", "chalao", "chala do", "samjhao", "samjha do", "padho", "padh do", "likho",
    "likh do", "karo", "kar do", "kijiye", "kariye", "खोलो", "खोल दो", "दिखाओ", "दिखा दो", "बताओ", "बता दो", "भेजो",
    "भेज दो", "ढूंढो", "ढूँढो", "चलाओ", "चला दो", "समझाओ", "समझा दो", "पढ़ो", "पढ़ दो", "लिखो", "लिख दो", "करो", "कर दो",
    "कीजिए", "करिए",
  ],
  screenThings: [
    "page", "window", "app", "error", "button", "screen", "tab", "message", "email", "mail", "chart", "graph", "code",
    "file", "thing", "word", "line", "setting", "settings", "option", "menu", "icon", "link", "popup", "pop up",
    "dialog", "warning", "notification", "form", "field", "table", "slide", "sheet", "doc", "document", "video", "image",
    "picture", "photo", "diagram", "equation", "function", "site", "website", "webpage", "spreadsheet", "cell", "column",
    "row", "folder",
  ],
  screenStrong: [
    "(?:^| )(?:on|in|from) (?:my|the|this) screen(?: |$)", "^(?:what|whats) (?:is |s )?(?:this|that|here)$",
    "^(?:what|whats) (?:does|do|is|s) (?:this|that) (?:\\S+ )?(?:mean|means|say|says|do|does)(?: |$)",
    "(?:^| )what am i (?:looking at|seeing)(?: |$)",
    "^(?:where|wheres)(?: is| s| do i find| can i find| do i click| do i)? .*(?:button|option|setting|settings|menu|icon|tab|link|toggle|switch)(?: |$)",
    "^how do i .+ (?:here|in this app|in this page|in this window|on this page|on this screen)(?: |$)",
    "(?:^| )(?:yeh|ye|yah) (?:kya hai|kya he)$", "(?:^| )(?:screen|page|window) (?:par|pe|mein|me) ",
    "(?:^| )(?:यह|ये) क्या है$", "(?:^| )स्क्रीन (?:पर|पे|में)(?: |$)",
  ],
  explain: [
    "explain", "summarize", "summarise", "define", "what does", "what do", "whats", "what is", "meaning of",
    "tell me about", "is this", "is that", "are these", "why", "how does", "who is", "who was", "samjhao", "samjha do",
    "iska matlab", "is ka matlab", "matlab kya", "iska meaning",
  ],
  explainAnywhere: [
    "kya matlab", "matlab kya", "मतलब",
  ],
  writeStart: [
    "write", "reply", "respond", "draft", "compose", "make it", "make this", "rewrite", "rephrase", "translate", "say",
    "tell him", "tell her", "tell them", "let him know", "let her know", "let them know", "likho", "likh do",
    "reply karo", "jawab do", "bolo ki", "kaho ki", "लिखो", "लिख दो", "जवाब दो",
  ],
  writeEnd: [
    "in hindi", "in english", "in hinglish", "formally", "formal", "casually", "shorter", "longer", "in bullet points",
    "as bullets", "politely", "hindi mein", "english mein", "हिंदी में",
  ],
  bots: [
    { slug: "plan", names: ["plan bot", "planner bot"] },
    { slug: "travel", names: ["travel bot"] },
    { slug: "code", names: ["code bot", "coding bot"] },
    { slug: "keybot", names: ["keybot", "key bot"] },
  ],
  tasks: [
    { slug: "plan", re: "^(?:plan|organi[sz]e|sort out|block) (?:my|the|our) (?:day|week|weekend|morning|afternoon|evening|night|saturday|sunday|monday|tuesday|wednesday|thursday|friday|tomorrow|today|schedule|calendar|month)(?: |$)" },
    { slug: "plan", re: "^(?:add|put) .+ (?:to|on|in|into) my calendar(?: |$)" },
    { slug: "plan", re: "^schedule (?:a |an |my )?(?:meeting|call|reminder|catch up|catchup|sync)(?: |$)" },
    { slug: "plan", re: "^remind me(?: |$)" },
    { slug: "plan", re: "^(?:whats|what is) on (?:my calendar|my schedule|today|tomorrow)(?: |$)" },
    { slug: "plan", re: "^(?:set|create) (?:a |an )?(?:reminder|meeting|event)(?: |$)" },
    { slug: "plan", re: "(?:^| )(?:plan|schedule) (?:karo|kar do|banao|bana do)$" },
    { slug: "travel", re: "^(?:book|find|search|search for|look for|get) (?:me |us )?(?:a |an |some |the |cheap |cheapest )?(?:flight|flights|train|trains|train tickets|hotel|hotels|cab|taxi|bus|ticket|tickets|stay|homestay|room|rooms)(?: |$)" },
    { slug: "travel", re: "^plan (?:a |my |our |the )?(?:trip|holiday|vacation|getaway)(?: |$)" },
    { slug: "travel", re: "(?:^| )(?:flight|ticket|tickets|hotel|train) (?:book karo|book kar do)$" },
    { slug: "code", re: "^fix (?:the |a |this |that |my )?(?:.+ )?(?:bug|bugs|issue|issues|error|errors|crash|test|tests|build)(?: |$)" },
    { slug: "code", re: "^(?:deploy|refactor|ship) " },
    { slug: "code", re: "^(?:open|create|make|raise) (?:a |an )?(?:pr|pull request)(?: |$)" },
    { slug: "code", re: "^(?:fix|add|update|change|write|remove) .+ in (?:my |the )?(?:repo|project|codebase|code)(?: |$)" },
    { slug: "code", re: "^(?:write|add) (?:a |an |some )?(?:test|tests|unit test|unit tests|endpoint|api|function|migration)(?: |$)" },
    { slug: "code", re: "(?:^| )(?:bug|issue) fix (?:karo|kar do)$" },
  ],
} as const;

/** The names it answers to, besides the person's own for it (desktop.router.names): X0, the guide, and its old name. */
export const DESKTOP_WAKE_NAMES = ["X0", "Blip", "Tailzu"] as const;

/** A pattern as the desktop compiles it: its source and its flags. */
const pattern = (r: RegExp) => ({ source: r.source, flags: r.flags });

/**
 * ASK'S GRAMMAR ON THE DESKTOP (resolver.js, desktop.agent.grammar): the server's own rules, from the modules the
 * server answers with, so the copy on the computer is this one and cannot drift from it.
 */
export function desktopGrammar(): Record<string, unknown> {
  return {
    headFiller: pattern(GRAMMAR_RULES.headFiller), headAsk: pattern(GRAMMAR_RULES.headAsk), tail: pattern(GRAMMAR_RULES.tail),
    showOpening: pattern(GRAMMAR_RULES.showOpening), showAnywhere: pattern(GRAMMAR_RULES.showAnywhere),
    politeRequest: pattern(GRAMMAR_RULES.politeRequest),
    pointAsk: pattern(RESOLVER_RULES.pointAsk), pressAsk: pattern(RESOLVER_RULES.pressAsk),
    roleWords: { ...RESOLVER_RULES.roleWords },
  };
}

/** Every desktop list above, as the bootstrap's flags. `botsApp`: the Bots app is on for this person. */
export function desktopLists(o: { botsApp: boolean }): Record<string, unknown> {
  const router: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(DESKTOP_ROUTER)) router[`desktop.router.${k}`] = v;
  return {
    ...router,
    "desktop.router.names": [...DESKTOP_WAKE_NAMES],
    "desktop.agent.grammar": desktopGrammar(),
    "desktop.tones": DESKTOP_TONES.map((t) => ({ ...t })),
    // "Tailzu Code activity…" opens the Bots app's page for it, with the runner's card on it (DeskRunner).
    ...(o.botsApp ? { "desktop.runner.screenId": "bots.computer" } : {}),
  };
}

// ===================================================================== the keyboards

/**
 * SWIPE TYPING'S CORE LIST (kb.swipe.coreWords), frequency first: a word's place is its rank. The one both
 * keyboards had embedded, now sent, so it can be tuned against the revert counters (autocorrectReverted,
 * swipeCommitted) without a release. It replaces the embedded list wholesale.
 */
export const SWIPE_CORE_WORDS: readonly string[] = [
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with", "he", "as", "you",
  "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my", "one",
  "all", "would", "there", "their", "what", "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
  "when", "make", "can", "like", "time", "no", "just", "him", "know", "take", "people", "into", "year", "your", "good",
  "some", "could", "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
  "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even", "new", "want",
  "because", "any", "these", "give", "day", "most", "us", "is", "was", "are", "been", "has", "had", "were", "said",
  "did", "having", "may", "should", "am", "place", "made", "find", "where", "much", "too", "very", "still", "being",
  "going", "before", "great", "same", "those", "both", "does", "another", "around", "thought", "while", "together",
  "children", "saw", "few", "though", "feel", "man", "men", "woman", "women", "child", "life", "world", "school",
  "state", "family", "student", "group", "country", "problem", "hand", "part", "case", "week", "company", "system",
  "program", "question", "government", "number", "night", "point", "home", "water", "room", "mother", "area", "money",
  "story", "fact", "month", "lot", "right", "study", "book", "eye", "job", "word", "business", "issue", "side", "kind",
  "head", "house", "service", "friend", "father", "power", "hour", "game", "line", "end", "member", "law", "car",
  "city", "community", "name", "president", "team", "minute", "idea", "body", "information", "nothing", "ago", "face",
  "others", "level", "office", "door", "health", "person", "art", "war", "history", "party", "result", "change",
  "morning", "reason", "research", "girl", "guy", "moment", "air", "teacher", "force", "education", "call", "try",
  "ask", "need", "become", "leave", "put", "mean", "keep", "let", "begin", "seem", "help", "talk", "turn", "start",
  "show", "hear", "play", "run", "move", "live", "believe", "hold", "bring", "happen", "write", "provide", "sit",
  "stand", "lose", "pay", "meet", "include", "continue", "set", "learn", "lead", "understand", "watch", "follow",
  "stop", "create", "speak", "read", "allow", "add", "spend", "grow", "open", "walk", "win", "offer", "remember",
  "love", "consider", "appear", "buy", "wait", "serve", "die", "send", "expect", "build", "stay", "fall", "cut",
  "reach", "kill", "remain", "little", "important", "different", "small", "large", "next", "early", "young", "public",
  "bad", "able", "best", "better", "sure", "free", "low", "late", "hard", "major", "economic", "strong", "possible",
  "whole", "real", "american", "big", "high", "old", "hello", "thanks", "thank", "please", "sorry", "okay", "yeah",
  "cool", "nice", "awesome", "happy", "tomorrow", "today", "tonight", "later", "maybe", "really", "actually",
  "definitely", "probably", "haha", "gonna", "wanna", "gotta", "yes", "no", "here", "come", "coming", "meeting",
  "message", "send", "sent", "text", "call", "called", "calling", "home", "working", "dinner", "lunch", "coffee",
  "drink", "food", "great", "night", "week", "weekend", "friday", "monday", "tuesday", "wednesday", "thursday",
  "saturday", "sunday", "don't", "can't", "won't", "didn't", "i'm", "i'll", "i've", "it's", "that's", "what's",
  "you're", "we're", "they're", "isn't", "wasn't", "couldn't", "wouldn't", "shouldn't",
];

/**
 * Past the core list (kb.swipe.extraWords): product names, the apps people name while typing, and everyday
 * Hinglish, which no English lexicon has and which India types in Latin letters ("kal milte hain").
 */
export const SWIPE_EXTRA_WORDS: readonly string[] = [
  "tailzu", "tulmi", "keybot", "blip", "whatsapp", "instagram", "gmail", "youtube", "google", "zomato", "swiggy",
  "paytm", "phonepe", "gpay", "upi", "ola", "uber", "flipkart", "amazon", "myntra", "irctc", "zoom", "slack",
  "linkedin", "hai", "hain", "haan", "haa", "nahi", "nahin", "na", "kya", "kyun", "kyu", "kaise", "kaisa", "kaisi",
  "kab", "kahan", "kaha", "kaun", "kitna", "main", "mein", "mai", "mera", "meri", "mere", "mujhe", "tum", "tu", "tera",
  "teri", "tere", "tumhe", "aap", "aapka", "aapki", "aapko", "hum", "humko", "hamara", "woh", "wo", "yeh", "ye",
  "usko", "isko", "unko", "inko", "sab", "kuch", "koi", "bhi", "toh", "aur", "ya", "par", "lekin", "phir", "fir",
  "abhi", "ab", "kal", "aaj", "parso", "subah", "shaam", "raat", "din", "hafte", "mahina", "baje", "jaldi", "der",
  "baad", "pehle", "thoda", "thodi", "zyada", "bahut", "bohot", "bas", "accha", "acha", "achha", "theek", "thik",
  "sahi", "galat", "pakka", "chalo", "chal", "chaliye", "karo", "karna", "karta", "karti", "kar", "kiya", "kiye",
  "raha", "rahi", "rahe", "hoga", "hogi", "gaya", "gayi", "gaye", "diya", "liya", "dena", "lena", "bolo", "bol",
  "bata", "batao", "bataiye", "pata", "samjha", "samjho", "dekho", "dekh", "suno", "sun", "ruko", "ruk", "milte",
  "milna", "mil", "aana", "aao", "aaja", "jaana", "jao", "ja", "chahiye", "sakta", "sakti", "yaar", "bhai", "bhaiya",
  "didi", "dost", "ji", "haanji", "shukriya", "dhanyavaad", "namaste", "ghar", "kaam", "khana", "paani", "chai",
  "paisa", "paise", "rupaye", "matlab", "mast", "badhiya", "bekaar", "pareshan", "tension", "khush",
];

/**
 * The keyboards' lists, and the key click.
 *
 * kb.key.sound was sent only for someone who chose in Keybot, and its absence meant different things: iOS clicked
 * and Android stayed quiet. Now it is said for everyone, as each keyboard behaves today, so nothing changes until
 * the console makes it one decision; Keybot's own choice still goes over it (withKeybotKeyboard).
 */
export function keyboardLists(platform: "ios" | "android"): Record<string, unknown> {
  return {
    "kb.swipe.coreWords": [...SWIPE_CORE_WORDS],
    "kb.swipe.extraWords": [...SWIPE_EXTRA_WORDS],
    "kb.key.sound": platform !== "android",
    // Keybot's "Hold space to speak" is a person's choice (withKeybotKeyboard sets it on); off for everyone else,
    // as both keyboards read its absence.
    "kb.space.holdToSpeak": false,
    ...(platform === "android" ? ANDROID_EXPLICIT : IOS_EXPLICIT),
  };
}

/**
 * KEYS THE KEYBOARDS READ THAT THE CONSOLE COULD NOT SEE: read with no default the knob manifest could find
 * (tools/knobs/keyboard-knobs.json `dynamic`), so nothing listed them. Each is sent here with the value the
 * keyboard uses when it is absent, so it is listed and changeable, and nothing changes until it is changed.
 *
 * Left absent on purpose (absence is their meaning): kb.dictation.language and kb.dictation.targetApp (overrides),
 * kb.look.force (Keybot's look), kb.personality.* and kb.quota.* (per person), kb.tones (the legacy tone list, whose
 * absence keeps the built-in one), kb.flow.tailWaitMs (its default depends on the capture), and the colours derived
 * from the keyboard's light or dark look (kb.flash.color, kb.suggestion.chip*, kb.suggestion.dividerColor).
 */
const IOS_EXPLICIT: Record<string, unknown> = {
  "kb.audio.channels": 1,
  "kb.audio.quality": "high",
  "kb.audio.sampleRate": 16000,
  "kb.confetti.colors": ["#FF3B30", "#007AFF", "#34C759", "#FFCC00", "#AF52DE", "#FF9500"],
  "kb.flash.enabled": true,
  "kb.flash.durationMs": 260,
  "kb.flash.staggerMs": 32,
  "kb.smartPeriod": true,
  "kb.smartPunctuation": true,
};
const ANDROID_EXPLICIT: Record<string, unknown> = {
  // Icons the server draws (SDUIRenderer.kt drawnIcon): none yet, so every key keeps its system drawable.
  "kb.icons": {},
};
