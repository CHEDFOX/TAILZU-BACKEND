/**
 * WHAT TAILZU IS, SAID ONCE, FOR EVERY MACHINE THAT ASKS.
 *
 * Search engines rank pages; answer engines (ChatGPT, Claude, Perplexity,
 * Google's AI answers) quote them. Both reward the same thing: one entity,
 * described the same way everywhere, with facts specific enough to quote.
 * So every page, the sitemap, llms.txt and the home page's structured data
 * are built from this file, and this file is built from what the product
 * already says elsewhere:
 *
 *   the examples       SITE_UI.cases and SITE_UI.apps — sentences the site
 *                      already shows, each one a case the quality harness tests
 *   the languages      the 22 the Indic engine is built for (pipeline/stt.ts),
 *                      and every other one the site shows written clean
 *   the prices         PAYWALL_CONFIG and the allowance the server enforces
 *   the privacy lines  the privacy policy, not a paraphrase of a hope
 *
 * Nothing here is a claim the product does not make somewhere else first.
 * No ratings, no user counts, no competitor facts: a number an engine quotes
 * has to be one we can stand behind.
 */
import { SITE_UI, SITE_SHAPE, PAYWALL_CONFIG, siteCopy } from "../experience/catalog.js";
import { getConfig } from "../config.js";
import { ID, ORIGIN, OG_IMAGE, abs } from "./head.js";

export { ID, crumbsLd, pageLd } from "./head.js";

export const STORES = SITE_UI.stores;

/** Every store listing that exists: iPhone, Android, and Windows once set. */
export const STORE_LINKS: string[] = [STORES.ios, STORES.android, STORES.windows].filter(Boolean);

/** The sentence every engine should be able to lift whole. */
export const DEFINITION =
  "X0 Bot is an AI keyboard for iPhone, Android, Windows, Mac and Linux. " +
  "You speak in Hindi, Hinglish, any of India's 22 scheduled languages, English or 50+ more, " +
  "and clean, ready-to-send text lands in any app: filler gone, punctuation in, " +
  "names and numbers kept exactly as you said them. Ask, and it writes a short message, reply or email for you.";

export const HOME = {
  title: SITE_SHAPE.meta.title,
  description: SITE_SHAPE.meta.description,
  // The link card says the page's own h1 (SITE_UI.apps.title), as the card
  // image does.
  ogTitle: "X0 Bot — talk instead of type",
  ogDescription: "Talk. X0 Bot writes. Your words, spelled the way you type — not translated, not in an alphabet you don't type.",
};

// ---------------------------------------------------------------- languages

export interface Example { said: string; wrote: string; app?: string }
// The list itself lives in experience/languages.ts, so the app's Languages
// screen and these pages read the same one and can never disagree.
export { LANGS, type Lang } from "../experience/languages.js";
import { LANGS, type Lang } from "../experience/languages.js";

export const INDIA = LANGS.filter((l) => l.india && l.slug !== "hinglish");
export const WORLD = LANGS.filter((l) => !l.india);
export const PAGED = LANGS.filter((l) => l.page);
export const langBySlug = (slug: string) => PAGED.find((l) => l.slug === slug);

/**
 * Every sentence the site shows for a language, said and then written.
 *
 * From SITE_UI.cases by its label, and from the keyboard scenes: those carry
 * Hindi said in Devanagari and in English letters, so a Devanagari `say` is
 * Hindi's, and a romanised one is Hinglish's.
 */
export function examplesFor(l: Lang): Example[] {
  const out: Example[] = SITE_UI.cases
    .filter((c) => c.lang === l.name)
    .map((c) => ({ said: c.said, wrote: c.wrote }));
  if (l.slug === "hindi" || l.slug === "hinglish") {
    for (const f of SITE_UI.apps.fields) {
      const say = (f as { say?: string }).say;
      if (!say) continue;
      const devanagari = /[ऀ-ॿ]/.test(say);
      if ((l.slug === "hindi") === devanagari) out.push({ said: say, wrote: f.text, app: f.app });
    }
  }
  return out;
}

/** The first thing it wrote in this language, for a card's one line. */
export const sampleFor = (l: Lang) => examplesFor(l)[0];

// ---------------------------------------------------------------- the price

const amount = (price: string | undefined) => Number(String(price ?? "").replace(/[^0-9.]/g, "")) || 0;

export function plans() {
  const cfg = getConfig();
  // Free for everyone (FREE_FOR_ALL): no allowance, no paid plans to quote.
  if (cfg.FREE_FOR_ALL) return { free: true as const, freeWords: 0, earnWords: 0, lite: undefined, elite: undefined };
  // Two plans, both monthly: Lite the cheaper, Elite the other.
  const paid = (PAYWALL_CONFIG.plans ?? []).filter((p) => !p.free && p.price).sort((a, b) => amount(a.price) - amount(b.price));
  const one = (p: (typeof paid)[number] | undefined, name: string) => p ? { name: p.label ?? name, price: p.price ?? "", amount: amount(p.price) } : undefined;
  return {
    free: false as const,
    freeWords: Math.max(0, cfg.FREE_MONTHLY_WORDS),
    earnWords: Math.max(0, cfg.EARN_MAX_WORDS),
    lite: one(paid[0], "Lite"),
    elite: one(paid[1], "Elite"),
  };
}

const num = (n: number) => n.toLocaleString("en-US");

// ---------------------------------------------------------------- questions

export interface QA { q: string; a: string }
export interface QAGroup { title: string; items: QA[] }

/**
 * The long answers, for /faq and llms-full.txt. Each is one self-contained
 * answer: an engine lifts a single paragraph, never the one before it, so
 * none of them may lean on another.
 */
export function faqGroups(): QAGroup[] {
  const p = plans();
  const { lite, elite } = p;
  const prices = [
    lite ? `${lite.name} is ${lite.price} a month` : "",
    elite ? `${elite.name} is ${elite.price} a month` : "",
  ].filter(Boolean).join(". ");
  const others = WORLD.length - 1;
  return [
    {
      title: "The basics",
      items: [
        { q: "What is X0 Bot?", a: DEFINITION },
        { q: "What is an AI keyboard?", a: "A keyboard that understands what you mean, not only what it hears. X0 Bot takes your voice and types clean, ready-to-send text into whatever app you are in, and writes a short message for you when you ask." },
        { q: "Can X0 Bot write a message for me?", a: "Yes. Say what you want and who it is for, like a birthday wish for your sister or a kind reply to your landlord, and it writes it in your voice. It keeps to short pieces: no essays and no code, and in ChatGPT or Claude it writes your prompt, never the answer." },
        { q: "How is it different from Gboard voice typing or iPhone dictation?", a: "Built-in dictation types what it hears, ums and all. X0 Bot writes what you meant: filler gone, punctuation in, misheard words repaired, and your names, numbers and amounts kept exactly. It can also set the tone of the message." },
        { q: "Does X0 Bot change what I said?", a: "No. It cleans; it never rewrites. Filler words go and punctuation arrives, but your meaning, names and amounts stay as you said them." },
        { q: "Can I change the tone of my messages?", a: "Yes. Pick one of 16 voices once, from Professional and Friendly to Executive, Shakespeare or Pirate, and every message you speak is written in it." },
      ],
    },
    {
      title: "Languages",
      items: [
        { q: "Which languages does X0 Bot support?", a: `All 22 scheduled languages of India, Hinglish, English and ${others} more, including Spanish, French, Arabic, Japanese, Chinese and Korean.` },
        { q: "Does X0 Bot understand Hinglish?", a: "Natively. Speak Hindi and English in the same sentence and both stay as you said them. Nothing is forced into one language or the other." },
        { q: "Can it write Hindi in English letters?", a: "Yes, and it does by default: Hindi, like every language, comes back in English letters, the way you would type it. Want Devanagari? Say so in the sentence, like \"Hindi mein likho\"." },
        { q: "Can X0 Bot translate while I talk?", a: "Yes, when you ask. Say \"translate to English\" or \"Spanish mein likho\" and the message lands in that language." },
      ],
    },
    {
      title: "Apps and devices",
      items: [
        { q: "Which apps does X0 Bot work in?", a: "All of them. On your phone X0 Bot is a keyboard, so it works in WhatsApp, Gmail, Instagram, Slack, ChatGPT and anywhere else you can type." },
        { q: "Does X0 Bot work on Windows and Mac?", a: "Yes. Tap Ctrl twice (or Alt twice), talk, and tap twice again. The text is pasted wherever your cursor is." },
        { q: "Can I use X0 Bot to prompt ChatGPT, Claude or Grok?", a: "Yes. Say it rough and a clean, structured prompt lands in the box, with nothing added that you did not say." },
        { q: "Can developers use it in Cursor or VS Code?", a: "Yes. The desktop app types into any window, so you say the change and it lands where the cursor is." },
        { q: "Why does the iPhone keyboard ask for Full Access?", a: "An iPhone keyboard cannot reach the internet without it, and X0 Bot needs the internet to hear you." },
        { q: "Does X0 Bot work offline?", a: "No. Recognition and cleanup run on servers, so it needs a connection." },
      ],
    },
    {
      title: "Privacy",
      items: [
        { q: "Does X0 Bot store my voice?", a: "Not by default. Audio is sent for transcription and deleted right after. It is kept only if you turn on session history." },
        { q: "Is my data used to train AI models?", a: "No. X0 Bot does not use your data to train third-party AI models." },
      ],
    },
    {
      title: "Price",
      items: p.free ? [
        { q: "Is X0 Bot free?", a: "Yes. Every word, in every language, on iPhone, Android, Windows and Mac, with no word limit and nothing to pay." },
        { q: "How much does X0 Bot cost?", a: "Nothing. X0 Bot is free, and there is no paid plan to pick." },
      ] : [
        { q: "Is X0 Bot free?", a: `Yes, to start: ${num(p.freeWords)} words a month, free.` },
        { q: "How much does X0 Bot cost?", a: `${prices}. Both remove the word limit.` },
        { q: "Can I cancel any time?", a: "Yes. Cancel from the App Store, Google Play or your receipt email; the plan runs to the end of the period you paid for." },
      ],
    },
  ];
}

/** The home page's questions, as the page shows them: SITE_UI.faq, filled. */
export function homeFaq(): QA[] {
  const n = String(Math.max(0, getConfig().FREE_MONTHLY_WORDS));
  return siteCopy().faq.items.map((it) => ({ q: it.q, a: it.a.replace(/\{n\}/g, n) }));
}

/** Three answers a page about one language owes its reader. */
export function langFaq(l: Lang): QA[] {
  const p = plans();
  const script = l.slug === "hinglish"
    ? { q: "Does X0 Bot turn Hinglish into pure Hindi or pure English?", a: "No. Two languages stay two: Hindi words stay Hindi and English words stay English, spelled the way you type." }
    : l.india
      ? { q: `Can it write ${l.name} in English letters?`, a: `Yes, and it does by default: ${l.name} comes back in English letters, the way you would type it. Want ${l.script}? Say so in the sentence.` }
      : l.script === "Latin"
        ? { q: `Does it keep ${l.name} as ${l.name}?`, a: `Yes. Say it in ${l.name} and it is written in ${l.name}. It translates only when you ask.` }
        : { q: `Can it write ${l.name} in ${l.script}?`, a: `Yes, when you say so in the sentence. Otherwise it writes your ${l.name} in English letters, the way it is typed on any keyboard. It translates only when you ask.` };
  return [
    { q: `Can I voice type in ${l.name} on WhatsApp?`, a: `Yes. X0 Bot is a keyboard, so ${l.name} voice typing works in WhatsApp, Gmail, Instagram, ChatGPT and every other app you type in.` },
    script,
    p.free
      ? { q: `Is ${l.name} voice typing free?`, a: `Yes. ${l.name} voice typing in X0 Bot is free, with no word limit.` }
      : { q: `Is ${l.name} voice typing free?`, a: `Yes, to start: ${num(p.freeWords)} words a month, free. ${[p.lite?.name, p.elite?.name].filter(Boolean).join(" and ")} remove the limit.` },
  ];
}

// ---------------------------------------------------------------- entities

export function orgLd() {
  return {
    "@type": "Organization",
    "@id": ID.org,
    name: "X0 Bot",
    url: `${ORIGIN}/`,
    logo: { "@type": "ImageObject", url: `${ORIGIN}/icon-512.png`, width: 512, height: 512 },
    parentOrganization: { "@type": "Organization", name: "Xooteq Lab Private Limited", url: "https://xooteq.com" },
  };
}

export function websiteLd() {
  return { "@type": "WebSite", "@id": ID.site, name: "X0 Bot", url: `${ORIGIN}/`, inLanguage: "en", publisher: { "@id": ID.org } };
}

/**
 * The product, with its real prices. No aggregateRating: a rating has to
 * come from reviews a person can read, and inventing one is how a site
 * loses its rich results for good.
 */
export function appLd() {
  const p = plans();
  const offers: object[] = [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", description: p.free ? "No word limit." : `${num(p.freeWords)} words a month.` },
  ];
  for (const plan of [p.lite, p.elite]) if (plan) offers.push({
    "@type": "Offer", name: plan.name, price: plan.amount.toFixed(2), priceCurrency: "USD",
    priceSpecification: { "@type": "UnitPriceSpecification", price: plan.amount.toFixed(2), priceCurrency: "USD", billingDuration: "P1M", unitCode: "MON" },
    description: "Unlimited words, billed monthly.",
  });
  return {
    "@type": "SoftwareApplication",
    "@id": ID.app,
    name: "X0 Bot",
    alternateName: ["X0 Bot AI Keyboard", "X0 Bot Voice Keyboard"],
    description: DEFINITION,
    url: `${ORIGIN}/`,
    applicationCategory: "UtilitiesApplication",
    applicationSubCategory: "AI keyboard",
    operatingSystem: "iOS, Android, Windows, macOS, Linux",
    // The Microsoft Store listing joins the other two once it is set
    // (catalog.WINDOWS_STORE_ID). downloadUrl is a binary's own address, so
    // for Windows it is the certified build's direct download; /download
    // stays for Mac and Linux.
    downloadUrl: [STORES.ios, STORES.android, STORES.windowsInstaller, abs("/download")].filter(Boolean),
    installUrl: STORE_LINKS,
    sameAs: STORE_LINKS,
    image: OG_IMAGE.url,
    publisher: { "@id": ID.org },
    offers,
    featureList: [
      "Voice typing in all 22 scheduled languages of India, Hinglish and English",
      `Voice typing in ${WORLD.length - 1} more languages, including Spanish, Arabic and Japanese`,
      "Removes filler words and adds punctuation; keeps names, numbers and amounts exactly",
      "Keeps mixed languages mixed: Hinglish stays Hinglish",
      "Writes in English letters by default, or in the language's own script when asked",
      "16 voices that set the tone of every message",
      "Writes a short message, reply, email, wish or caption on request; never essays or code",
      "Works as a keyboard in every app on iPhone and Android",
      "Desktop app for Windows, Mac and Linux: tap Ctrl twice, talk, and the text is pasted at the cursor",
    ],
    inLanguage: "en",
    availableOnDevice: "iPhone, Android phone, Windows PC, Mac, Linux PC",
  };
}

export function faqLd(items: QA[], path: string) {
  return {
    "@type": "FAQPage",
    "@id": `${abs(path)}#faq`,
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}


// ---------------------------------------------------------------- films

/**
 * THE FILMS THE HOME PAGE PLAYS, as a search engine's video results want
 * them: the reel's five (SITE_UI.films.items) and Typed vs said, which #how
 * plays. Each is a web cut of a film drawn by social.html (no third-party
 * imagery), published by the site under /media/: `file` is its name there,
 * `seconds` the length of the cut as published (media/manifest.json's
 * `dur`: a looped cut is shorter than its span by the cross-dissolve that
 * joins its ends), `rendered` the day the source film was rendered (its
 * commit in TAILZU-FRONTEND/tools/media/promo). Written into the home page's
 * head by scripts/sync-site.mts, and only into the redesigned page — the
 * page that has the films; the sync checks these against the manifest
 * beside the page, so a re-cut film cannot leave a wrong length here.
 */
export const FILM_MEDIA: Record<string, { file: string; seconds: number; rendered: string }> = {
  "typed-vs-said": { file: "typed-vs-said", seconds: 9.1, rendered: "2026-09-29" },
  keyless: { file: "keyless", seconds: 11.3, rendered: "2026-09-29" },
  "said-written": { file: "said-written", seconds: 12.5, rendered: "2026-09-29" },
  spanish: { file: "spanish", seconds: 8.9, rendered: "2026-09-29" },
  "to-him": { file: "to-him", seconds: 12, rendered: "2026-10-18" },
  tones: { file: "tones-1x1", seconds: 10.9, rendered: "2026-09-29" },
};

/** Typed vs said is not in the reel, so its words are films.json's own. */
const TYPED_VS_SAID = { id: "typed-vs-said", title: "Typed vs said", line: "The same message, a thumb against a voice, each on a clock." };

/** The home page's films, in the order the page shows them. */
export function homeFilms(): Array<{ id: string; title: string; line: string; file: string; seconds: number; rendered: string }> {
  return [TYPED_VS_SAID, ...SITE_UI.films.items]
    .filter((f) => FILM_MEDIA[f.id])
    .map((f) => ({ id: f.id, title: f.title, line: f.line, ...FILM_MEDIA[f.id]! }));
}

/** ISO 8601, as structured data wants a length: 9.6 → "PT9.6S". */
export const isoDuration = (seconds: number) => `PT${Number(seconds.toFixed(1))}S`;

export function filmLd(f: ReturnType<typeof homeFilms>[number]) {
  return {
    "@type": "VideoObject",
    "@id": `${ORIGIN}/#film-${f.id}`,
    name: f.title,
    description: f.line,
    thumbnailUrl: [`${ORIGIN}/media/${f.file}.webp`],
    contentUrl: `${ORIGIN}/media/${f.file}.mp4`,
    uploadDate: f.rendered,
    duration: isoDuration(f.seconds),
    about: { "@id": ID.app },
    publisher: { "@id": ID.org },
  };
}
