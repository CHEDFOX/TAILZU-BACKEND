/**
 * THE PAGES FOR WHAT PEOPLE TYPE INTO A SEARCH BOX.
 *
 * Nobody searches "Tailzu". They search "AI keyboard", "smart keyboard for
 * Android", "voice typing on Windows", "speech to text", "talk to ChatGPT".
 * The home page answers those in motion and almost no words, and /languages
 * answers only "<language> voice typing". These pages each answer one family
 * of searches, in words, with the product's own sentences as proof:
 *
 *   /ai-keyboard             AI keyboard, smart keyboard, intelligent keyboard
 *   /voice-typing            voice typing, speech to text, voice to text, dictation
 *   /ai-keyboard/android     AI keyboard for Android, Android voice keyboard
 *   /ai-keyboard/iphone      AI keyboard for iPhone, iPhone voice keyboard
 *   /voice-typing/windows    voice typing and dictation on Windows
 *   /voice-typing/mac        voice typing and dictation on a Mac
 *   /voice-typing/chatgpt    voice prompts for ChatGPT, Claude, Grok, Cursor
 *
 * NOT DOORWAYS. Each page says something the others do not: a different job,
 * a different device's steps, different questions. Every claim is one the
 * product makes good on today, every example is a sentence the site already
 * shows (SITE_UI), and every price and count comes from seo/facts.ts.
 */
import { siteShell } from "../routes/policies/shell.js";
import { SITE_UI } from "../experience/catalog.js";
import {
  INDIA, PAGED, WORLD, crumbsLd, faqLd, pageLd, plans,
  type Example, type QA,
} from "./facts.js";
import { ID } from "./facts.js";
import { esc } from "./head.js";
import { CSS, GETS, HAND, crumbs, exampleCard, qaList, words } from "./pages.js";

export interface Landing {
  path: string;
  /** The crumb and the tab title. */
  name: string;
  /** The whole <title>: the search title. */
  headTitle: string;
  description: string;
  eye: string;
  h1: string;
  lede: string;
  examples: Example[];
  factsTitle: string;
  facts: Array<[string, string]>;
  steps?: { title: string; items: string[] };
  faq: QA[];
  /** The breadcrumb trail above this page, before it. */
  parents?: Array<[string, string]>;
}

const total = () => INDIA.length + WORLD.length;
const free = () => plans().free;
const priceQA = (what: string): QA => free()
  ? { q: `Is ${what} free?`, a: `Yes. Tailzu is free on iPhone, Android, Windows and Mac, in every language, with no word limit.` }
  : { q: `Is ${what} free?`, a: `Yes, to start: ${plans().freeWords.toLocaleString("en-US")} words a month, free. Paid plans remove the limit.` };
const privacyQA: QA = {
  q: "What happens to my voice?",
  a: "Audio is sent for transcription and deleted right after; it is kept only if you turn on session history. Tailzu does not use your data to train third-party AI models.",
};

/** The site's own sentences, by where it shows them. */
const field = (app: string, n = 1): Example[] =>
  SITE_UI.apps.fields
    .filter((f) => f.app === app && (f as { say?: string }).say)
    .slice(0, n)
    .map((f) => ({ said: (f as { say?: string }).say!, wrote: f.text, app: f.app }));
const said = (lang: string): Example[] =>
  SITE_UI.cases.filter((c) => c.lang === lang).map((c) => ({ said: c.said, wrote: c.wrote }));
const prompts = (): Example[] => {
  const targets = SITE_UI.llm.targets as readonly string[];
  return SITE_UI.llm.prompts.map((p, i) => ({ said: p.said, wrote: p.wrote, app: targets[i] }));
};
const dev = (): Example => ({ said: SITE_UI.dev.said, wrote: SITE_UI.dev.wrote, app: SITE_UI.dev.app });

const DESKTOP_STEPS = (os: "Windows" | "Mac") => [
  os === "Windows"
    ? "Download Tailzu for Windows and run the installer."
    : "Download Tailzu for Mac and drag it into Applications.",
  "Open it and sign in, the same way you do on your phone.",
  ...(os === "Mac" ? ["Allow the microphone, and allow Tailzu to paste into other apps when macOS asks."] : []),
  "Click into any app, tap Ctrl twice (or Alt twice) and talk.",
  "Tap twice again. The clean text is pasted where your cursor is.",
];

export function landings(): Landing[] {
  const n = total();
  return [
    {
      path: "/ai-keyboard",
      name: "AI keyboard",
      headTitle: "AI Keyboard for iPhone, Android, Windows & Mac — Tailzu",
      description: `Tailzu is a smart AI keyboard: speak in any of ${n} languages and clean text lands in any app, or ask it to write a short message, reply or email for you.`,
      eye: "AI keyboard",
      h1: "The AI keyboard that writes what you mean.",
      lede: "Talk in any app. It writes it clean, in your voice. Ask, and it writes it for you.",
      examples: [...field("WhatsApp", 2), ...field("Mail", 2)],
      factsTitle: "What makes it an AI keyboard",
      facts: [
        ["Speak, and it writes", "Filler goes, punctuation arrives, misheard words are repaired, and your names, numbers and amounts stay exactly as you said them."],
        ["It writes for you", "Ask for a birthday wish, a sorry message, a reply or a short email, and say who it is for. It writes it in your voice."],
        [`${n} languages`, `All 22 languages of India, Hinglish, English and ${WORLD.length - 1} more. Two languages in one sentence stay two.`],
        ["Your tone, every time", "Pick one of 16 voices, from Professional and Friendly to Shakespeare or Pirate, and every message is written in it."],
        ["Every app", "A keyboard on iPhone and Android. On Windows and Mac, tap Ctrl twice and talk into any window."],
        ["It knows its job", "Short pieces only: no essays and no code. In ChatGPT or Claude it writes your prompt, never the answer."],
      ],
      faq: [
        { q: "What is an AI keyboard?", a: `A keyboard that understands what you mean, not only what it hears. Tailzu takes your voice, in any of ${n} languages, and types clean, ready-to-send text into whatever app you are in.` },
        { q: "Is Tailzu a smart keyboard?", a: "Yes. It removes filler, adds punctuation, repairs misheard words, keeps your names and numbers, and writes a short message for you when you ask." },
        { q: "Can an AI keyboard write messages for me?", a: "Tailzu can. Say what you want and who it is for, like a birthday wish for your sister or a kind reply to your landlord, and it writes it. It keeps to short pieces: no essays and no code." },
        { q: "How is it different from Gboard or the iPhone keyboard?", a: "Built-in voice typing types what it hears, ums and all. Tailzu writes what you meant, in the tone you pick, and can write a message for you when you ask." },
        { q: "Does it work in WhatsApp, Gmail and Instagram?", a: "Yes. It is a keyboard, so it works in every app you type in." },
        priceQA("the Tailzu AI keyboard"),
        privacyQA,
      ],
    },
    {
      path: "/voice-typing",
      name: "Voice typing",
      headTitle: "Voice Typing: Speech to Text in Any App — Tailzu",
      description: `Voice typing that writes what you meant. Speak Hindi, English or any of ${n} languages, and clean, punctuated text lands in WhatsApp, Gmail or any app.`,
      eye: "Voice typing",
      h1: "Voice typing that writes what you meant.",
      lede: "Speech to text, without the ums. Say it once, send it as it is.",
      examples: [...said("English"), ...said("Hinglish"), ...said("Spanish")],
      factsTitle: "Speech to text, finished",
      facts: [
        ["Punctuation, done", "Full stops, commas and question marks arrive on their own. You never say \"comma\"."],
        ["Filler, gone", "Ums, ahs, repeats and false starts are left out. When you correct yourself, only the correction stays."],
        ["Mishearing, repaired", "Speech recognition slips. Tailzu writes the word you meant, and the names you add to your words come out spelled your way."],
        ["Your facts, kept", "Names, numbers, amounts and times stay exactly as you said them. It cleans; it never rewrites."],
        ["Any language", `${n} languages, from Hindi, Tamil and Bengali to Spanish, Arabic and Japanese. It translates only when you ask.`],
        ["Any app, any device", "iPhone, Android, Windows and Mac. Wherever there is a cursor, that is where it types."],
      ],
      faq: [
        { q: "What is the best way to type with my voice?", a: "Use a keyboard that cleans up as it types. Tailzu turns what you say into finished text, punctuation and all, in whatever app you are using." },
        { q: "Does Tailzu add punctuation automatically?", a: "Yes. Full stops, commas and question marks are added for you, and filler words are removed." },
        { q: "How is it different from Google voice typing or Apple dictation?", a: "Built-in dictation types what it hears, ums and all. Tailzu writes what you meant: filler gone, punctuation in, misheard words repaired, and your names and numbers kept exactly." },
        { q: "Can I voice type in Hindi, Tamil or Bengali?", a: `Yes, in all 22 languages of India, Hinglish, and ${WORLD.length - 1} more languages besides English.` },
        { q: "Does voice typing work offline?", a: "No. Recognition and cleanup run on servers, so Tailzu needs a connection." },
        priceQA("Tailzu voice typing"),
      ],
    },
    {
      path: "/ai-keyboard/android",
      parents: [["AI keyboard", "/ai-keyboard"]],
      name: "Android",
      headTitle: "AI Keyboard for Android: Voice Typing in Any App — Tailzu",
      description: "An AI keyboard for Android. Tap the mic in WhatsApp, Gmail or any app, talk in any language, and clean, ready-to-send text is typed for you.",
      eye: "Android",
      h1: "The AI keyboard for Android.",
      lede: "Tap the mic in any app, talk, and clean text is typed for you.",
      examples: [...field("WhatsApp", 2), ...field("Reminders", 1)],
      factsTitle: "On your Android phone",
      facts: [
        ["A keyboard of its own", "Tailzu is a full keyboard. Switch to it from any app, and back to your usual one whenever you like."],
        ["Every app", "WhatsApp, Gmail, Instagram, Slack, ChatGPT: anywhere you can type, you can talk."],
        ["Writes for you", "Ask for a reply or a wish, say who it is for, and it writes it in your voice."],
        [`${n} languages`, "Hindi, Hinglish and every language of India, English, and the world's other major languages."],
      ],
      steps: { title: "Start in a minute", items: [
        "Install Tailzu from Google Play.",
        "Open it and sign in.",
        "Turn on the Tailzu keyboard when the app asks, and choose it.",
        "In any app, tap the mic and talk.",
      ] },
      faq: [
        { q: "Does Tailzu replace my Android keyboard?", a: "Only while you use it. It is a keyboard of its own, and you can switch between it and your usual one at any time." },
        { q: "Does it work in WhatsApp on Android?", a: "Yes. It is a keyboard, so it works in WhatsApp and every other app you type in." },
        { q: "Can it write in Hindi or Hinglish on Android?", a: "Yes. Speak Hindi, Hinglish or any of India's languages; it writes in English letters by default, or in your language's own script when you ask." },
        priceQA("the Android keyboard"),
        privacyQA,
      ],
    },
    {
      path: "/ai-keyboard/iphone",
      parents: [["AI keyboard", "/ai-keyboard"]],
      name: "iPhone",
      headTitle: "AI Keyboard for iPhone: Voice Typing in Any App — Tailzu",
      description: "An AI keyboard for iPhone. Talk in iMessage, WhatsApp or any app, in any language, and clean, ready-to-send text is typed for you.",
      eye: "iPhone",
      h1: "The AI keyboard for iPhone.",
      lede: "Switch to Tailzu in any app, tap the mic, talk. It types it clean.",
      examples: [...field("Mail", 1), ...field("Message", 1), ...field("Notes", 1)],
      factsTitle: "On your iPhone",
      facts: [
        ["A keyboard of its own", "Tailzu sits beside your usual keyboard. Tap the globe key to switch to it and back."],
        ["Every app", "iMessage, WhatsApp, Mail, Instagram, ChatGPT: anywhere you can type, you can talk."],
        ["Writes for you", "Ask for a reply or a wish, say who it is for, and it writes it in your voice."],
        [`${n} languages`, "Hindi, Hinglish and every language of India, English, and the world's other major languages."],
      ],
      steps: { title: "Start in a minute", items: [
        "Install Tailzu from the App Store, open it and sign in.",
        "Go to Settings, General, Keyboard, Keyboards, Add New Keyboard, and choose Tailzu.",
        "Tap Tailzu there and turn on Allow Full Access, so it can reach the internet to hear you.",
        "In any app, tap the globe key to switch to Tailzu, then tap the mic.",
      ] },
      faq: [
        { q: "Why does the iPhone keyboard ask for Full Access?", a: "An iPhone keyboard cannot reach the internet without it, and Tailzu needs the internet to hear you." },
        { q: "Does it work in iMessage and WhatsApp?", a: "Yes. It is a keyboard, so it works in every app you type in on your iPhone." },
        { q: "Can it write in Hindi or Hinglish on iPhone?", a: "Yes. Speak Hindi, Hinglish or any of India's languages; it writes in English letters by default, or in your language's own script when you ask." },
        priceQA("the iPhone keyboard"),
        privacyQA,
      ],
    },
    {
      path: "/voice-typing/windows",
      parents: [["Voice typing", "/voice-typing"]],
      name: "Windows",
      headTitle: "Voice Typing for Windows 10 and 11 — Tailzu",
      description: "Voice typing for Windows. Tap Ctrl twice in Word, Outlook, Chrome or any app, talk, and clean text is pasted at your cursor. Meeting notes too.",
      eye: "Windows",
      h1: "Voice typing for Windows.",
      lede: "Tap Ctrl twice in any window, talk, and it is typed where your cursor is.",
      examples: [...said("English"), dev()],
      factsTitle: "On your PC",
      facts: [
        ["Any window", "Word, Outlook, Chrome, Slack, Notepad, your code editor: wherever the cursor is, that is where the text lands."],
        ["Two taps, no hotkey to learn", "Tap Ctrl twice, or Alt twice, to start and to stop. Nothing to hold down."],
        ["Meeting notes", "Press Ctrl+Alt+N and Tailzu listens to you and the call, then gives you a summary, what mattered, and who said what."],
        ["The same account", "Your voice, your words and your languages come with you from your phone."],
      ],
      steps: { title: "Start in a minute", items: DESKTOP_STEPS("Windows") },
      faq: [
        { q: "Does Tailzu work on Windows 10 and Windows 11?", a: "Yes. Install it, sign in, and tap Ctrl twice in any app to talk." },
        { q: "Does it work in Word, Outlook and Chrome?", a: "Yes. It types into any window: documents, email, browsers, chat apps and code editors." },
        { q: "How is it different from Windows voice typing?", a: "Windows voice typing types what it hears. Tailzu writes what you meant, filler gone and punctuation in, in any of its languages, and can take meeting notes." },
        priceQA("Tailzu for Windows"),
        privacyQA,
      ],
    },
    {
      path: "/voice-typing/mac",
      parents: [["Voice typing", "/voice-typing"]],
      name: "Mac",
      headTitle: "Voice Typing for Mac: Dictation in Any App — Tailzu",
      description: "Voice typing for Mac. Tap Control twice in Mail, Notes, Slack or any app, talk, and clean text is pasted at your cursor. Meeting notes too.",
      eye: "Mac",
      h1: "Voice typing for Mac.",
      lede: "Tap Control twice in any app, talk, and it is typed where your cursor is.",
      examples: [...said("English"), dev()],
      factsTitle: "On your Mac",
      facts: [
        ["Any app", "Mail, Notes, Slack, Chrome, Safari, your code editor: wherever the cursor is, that is where the text lands."],
        ["Two taps", "Tap Control twice, or Option twice, to start and to stop. Nothing to hold down."],
        ["Meeting notes", "Press Command+Option+N and Tailzu listens to you and the call, then gives you a summary, what mattered, and who said what."],
        ["The same account", "Your voice, your words and your languages come with you from your phone."],
      ],
      steps: { title: "Start in a minute", items: DESKTOP_STEPS("Mac") },
      faq: [
        { q: "How is it different from Mac dictation?", a: "Mac dictation types what it hears. Tailzu writes what you meant, filler gone and punctuation in, in any of its languages, and can take meeting notes." },
        { q: "Why does it ask to control my Mac?", a: "To paste the text where your cursor is, macOS asks you to allow it once. It types only what you dictate." },
        { q: "Does it work on Apple silicon and Intel Macs?", a: "Yes. The Mac app runs on both." },
        priceQA("Tailzu for Mac"),
        privacyQA,
      ],
    },
    {
      path: "/voice-typing/chatgpt",
      parents: [["Voice typing", "/voice-typing"]],
      name: "ChatGPT, Claude and Grok",
      headTitle: "Talk to ChatGPT, Claude and Grok: Voice Prompts — Tailzu",
      description: "Say your prompt the way you think it. Tailzu types a clean prompt into ChatGPT, Claude, Grok, Cursor or any AI app, with nothing added you did not say.",
      eye: "AI apps",
      h1: "Say the prompt. Skip the typing.",
      lede: "Talk to ChatGPT, Claude and Grok the way you think. A clean prompt lands in the box.",
      examples: [...prompts(), dev()],
      factsTitle: "Prompts, spoken",
      facts: [
        ["Say it rough", "Ramble, pause, change your mind. The prompt that lands is clean and complete."],
        ["Your prompt, not its answer", "In an AI app, Tailzu writes the prompt and leaves the answering to the AI. Nothing is added that you did not say."],
        ["Every AI app", "ChatGPT, Claude, Grok, Gemini, Perplexity: on your phone it is a keyboard, so it works in all of them."],
        ["For developers", "On Windows and Mac it types into Cursor, VS Code or any editor: say the change, and it lands at the cursor."],
      ],
      faq: [
        { q: "Can I talk to ChatGPT with Tailzu?", a: "Yes. Say your prompt and a clean version is typed into ChatGPT's box, ready to send." },
        { q: "Does Tailzu answer my prompt itself?", a: "No. In an AI app it writes your prompt, and the AI you are using answers it." },
        { q: "Does it work in Claude, Grok and Gemini?", a: "Yes. It is a keyboard on your phone and types into any window on your computer, so it works in every AI app." },
        { q: "Can developers use it in Cursor or VS Code?", a: "Yes. The desktop app types into any window, so you say the change and it lands where the cursor is." },
        priceQA("Tailzu"),
      ],
    },
  ];
}

export const LANDING_PATHS = () => landings().map((l) => l.path);
export const landingFor = (path: string) => landings().find((l) => l.path === path);

const STEPS_CSS = `
  ol.steps { counter-reset: step; list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; max-width: 760px; }
  ol.steps li { counter-increment: step; display: grid; grid-template-columns: 44px 1fr; gap: 14px; align-items: baseline; color: var(--grey); }
  ol.steps li::before { content: "0" counter(step); font-family: var(--mono); font-size: 13px; letter-spacing: .18em; color: var(--dim); }
  .related a { margin-right: 18px; }
`;

/** Where to go next: the other pages, so every one is a tap from every other. */
function related(current: string): string {
  const all = landings().filter((l) => l.path !== current);
  return `<h2 class="label">More</h2>
<div class="chips">${all.map((l) => `<a class="chip" href="${l.path}">${words(l.parents ? `${l.parents[0]![0]} for ${l.name}` : l.name)}</a>`).join("")}<a class="chip" href="/languages">All ${total()} languages</a><a class="chip" href="/faq">FAQ</a></div>
<h2 class="label">Popular languages</h2>
<div class="chips">${PAGED.filter((l) => ["hindi", "hinglish", "tamil", "bengali", "telugu", "marathi", "spanish", "arabic", "french", "japanese"].includes(l.slug))
    .map((l) => `<a class="chip" href="/languages/${l.slug}">${esc(l.name)}</a>`).join("")}</div>`;
}

export function landingHtml(path: string): string | null {
  const p = landingFor(path);
  if (!p) return null;
  const trail: Array<[string, string]> = [["Tailzu", "/"], ...(p.parents ?? []), [p.name, p.path]];
  return siteShell({
    title: p.name,
    headTitle: p.headTitle,
    path: p.path,
    description: p.description,
    fonts: HAND,
    css: CSS + STEPS_CSS,
    ld: [
      pageLd(p.path, p.name, p.description, { about: { "@id": ID.app } }),
      crumbsLd(trail),
      faqLd(p.faq, p.path),
    ],
    main: `
${crumbs(trail)}
<p class="eye">${words(p.eye)}</p>
<h1>${words(p.h1)}</h1>
<p class="lede">${words(p.lede)}</p>

${p.examples.length ? `<div class="exs">${p.examples.map((e) => exampleCard(e)).join("")}</div>` : ""}

<h2 class="label">${words(p.factsTitle)}</h2>
<div class="facts2">${p.facts.map(([h, t]) => `<div><h3>${words(h)}</h3><p>${words(t)}</p></div>`).join("")}</div>

${p.steps ? `<h2 class="label">${words(p.steps.title)}</h2>\n<ol class="steps">${p.steps.items.map((s) => `<li>${words(s)}</li>`).join("")}</ol>` : ""}

<h2 class="label">Asked, answered</h2>
${qaList(p.faq)}

${GETS}

${related(p.path)}`,
  });
}
