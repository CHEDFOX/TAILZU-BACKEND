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
  "Tailzu is an AI keyboard for iPhone, Android, Windows and Mac. " +
  "You speak in Hindi, Hinglish, any of India's 22 scheduled languages, English or 50+ more, " +
  "and clean, ready-to-send text lands in any app: filler gone, punctuation in, " +
  "names and numbers kept exactly as you said them. Ask, and it writes a short message, reply or email for you.";

export const HOME = {
  title: SITE_SHAPE.meta.title,
  description: SITE_SHAPE.meta.description,
  ogTitle: "Tailzu — say it badly, send it perfect",
  ogDescription: "Talk. Tailzu writes. Your words, spelled the way you type — not translated, not in an alphabet you don't type.",
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
  if (cfg.FREE_FOR_ALL) return { free: true as const, freeWords: 0, earnWords: 0, monthly: undefined, yearly: undefined };
  const paid = (PAYWALL_CONFIG.plans ?? []).filter((p) => !p.free && p.price);
  const yearly = paid.find((p) => /year/i.test(p.period ?? "") || /annual/i.test(p.id ?? ""));
  const monthly = paid.find((p) => p !== yearly);
  return {
    free: false as const,
    freeWords: Math.max(0, cfg.FREE_MONTHLY_WORDS),
    earnWords: Math.max(0, cfg.EARN_MAX_WORDS),
    monthly: monthly ? { name: monthly.label ?? "Lite", price: monthly.price ?? "", amount: amount(monthly.price) } : undefined,
    yearly: yearly ? {
      name: yearly.label ?? "Elite",
      price: yearly.price ?? "",
      amount: amount(yearly.price),
      perMonth: (yearly.period ?? "").match(/\$[0-9.]+/)?.[0] ?? "",
      trialDays: Number((yearly.note ?? "").match(/(\d+)\s*days?\s*free/i)?.[1] ?? 0),
    } : undefined,
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
  const lite = p.monthly, elite = p.yearly;
  const prices = [
    lite ? `${lite.name} is ${lite.price} a month` : "",
    elite ? `${elite.name} is ${elite.price} a year${elite.perMonth ? ` (${elite.perMonth} a month)` : ""}${elite.trialDays ? `, with the first ${elite.trialDays} days free in the app` : ""}` : "",
  ].filter(Boolean).join(". ");
  const others = WORLD.length - 1;
  return [
    {
      title: "The basics",
      items: [
        { q: "What is Tailzu?", a: DEFINITION },
        { q: "What is an AI keyboard?", a: "A keyboard that understands what you mean, not only what it hears. Tailzu takes your voice and types clean, ready-to-send text into whatever app you are in, and writes a short message for you when you ask." },
        { q: "Can Tailzu write a message for me?", a: "Yes. Say what you want and who it is for, like a birthday wish for your sister or a kind reply to your landlord, and it writes it in your voice. It keeps to short pieces: no essays and no code, and in ChatGPT or Claude it writes your prompt, never the answer." },
        { q: "How is it different from Gboard voice typing or iPhone dictation?", a: "Built-in dictation types what it hears, ums and all. Tailzu writes what you meant: filler gone, punctuation in, misheard words repaired, and your names, numbers and amounts kept exactly. It can also set the tone of the message." },
        { q: "Does Tailzu change what I said?", a: "No. It cleans; it never rewrites. Filler words go and punctuation arrives, but your meaning, names and amounts stay as you said them." },
        { q: "Can I change the tone of my messages?", a: "Yes. Pick one of 16 voices once, from Professional and Friendly to Executive, Shakespeare or Pirate, and every message you speak is written in it." },
      ],
    },
    {
      title: "Languages",
      items: [
        { q: "Which languages does Tailzu support?", a: `All 22 scheduled languages of India, Hinglish, English and ${others} more, including Spanish, French, Arabic, Japanese, Chinese and Korean.` },
        { q: "Does Tailzu understand Hinglish?", a: "Natively. Speak Hindi and English in the same sentence and both stay as you said them. Nothing is forced into one language or the other." },
        { q: "Can it write Hindi in English letters?", a: "Yes, and it does by default: Hindi, like every language, comes back in English letters, the way you would type it. Want Devanagari? Say so in the sentence, like \"Hindi mein likho\"." },
        { q: "Can Tailzu translate while I talk?", a: "Yes, when you ask. Say \"translate to English\" or \"Spanish mein likho\" and the message lands in that language." },
      ],
    },
    {
      title: "Apps and devices",
      items: [
        { q: "Which apps does Tailzu work in?", a: "All of them. On your phone Tailzu is a keyboard, so it works in WhatsApp, Gmail, Instagram, Slack, ChatGPT and anywhere else you can type." },
        { q: "Does Tailzu work on Windows and Mac?", a: "Yes. Tap Ctrl twice (or Alt twice), talk, and tap twice again. The text is pasted wherever your cursor is." },
        { q: "Can I use Tailzu to prompt ChatGPT, Claude or Grok?", a: "Yes. Say it rough and a clean, structured prompt lands in the box, with nothing added that you did not say." },
        { q: "Can developers use it in Cursor or VS Code?", a: "Yes. The desktop app types into any window, so you say the change and it lands where the cursor is." },
        { q: "Why does the iPhone keyboard ask for Full Access?", a: "An iPhone keyboard cannot reach the internet without it, and Tailzu needs the internet to hear you." },
        { q: "Does Tailzu work offline?", a: "No. Recognition and cleanup run on servers, so it needs a connection." },
      ],
    },
    {
      title: "Privacy",
      items: [
        { q: "Does Tailzu store my voice?", a: "Not by default. Audio is sent for transcription and deleted right after. It is kept only if you turn on session history." },
        { q: "Is my data used to train AI models?", a: "No. Tailzu does not use your data to train third-party AI models." },
      ],
    },
    {
      title: "Price",
      items: p.free ? [
        { q: "Is Tailzu free?", a: "Yes. Every word, in every language, on iPhone, Android, Windows and Mac, with no word limit and nothing to pay." },
        { q: "How much does Tailzu cost?", a: "Nothing. Tailzu is free, and there is no paid plan to pick." },
      ] : [
        { q: "Is Tailzu free?", a: `Yes, to start: ${num(p.freeWords)} words a month, free${p.earnWords ? `, and up to ${num(p.earnWords)} more earned by writing on consecutive days` : ""}.` },
        { q: "How much does Tailzu cost?", a: `${prices}. Both remove the word limit.` },
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
    ? { q: "Does Tailzu turn Hinglish into pure Hindi or pure English?", a: "No. Two languages stay two: Hindi words stay Hindi and English words stay English, spelled the way you type." }
    : l.india
      ? { q: `Can it write ${l.name} in English letters?`, a: `Yes, and it does by default: ${l.name} comes back in English letters, the way you would type it. Want ${l.script}? Say so in the sentence.` }
      : l.script === "Latin"
        ? { q: `Does it keep ${l.name} as ${l.name}?`, a: `Yes. Say it in ${l.name} and it is written in ${l.name}. It translates only when you ask.` }
        : { q: `Can it write ${l.name} in ${l.script}?`, a: `Yes, when you say so in the sentence. Otherwise it writes your ${l.name} in English letters, the way it is typed on any keyboard. It translates only when you ask.` };
  return [
    { q: `Can I voice type in ${l.name} on WhatsApp?`, a: `Yes. Tailzu is a keyboard, so ${l.name} voice typing works in WhatsApp, Gmail, Instagram, ChatGPT and every other app you type in.` },
    script,
    p.free
      ? { q: `Is ${l.name} voice typing free?`, a: `Yes. ${l.name} voice typing in Tailzu is free, with no word limit.` }
      : { q: `Is ${l.name} voice typing free?`, a: `Yes, to start: ${num(p.freeWords)} words a month, free. ${[p.monthly?.name, p.yearly?.name].filter(Boolean).join(" and ")} remove the limit.` },
  ];
}

// ---------------------------------------------------------------- entities

export function orgLd() {
  return {
    "@type": "Organization",
    "@id": ID.org,
    name: "Tailzu",
    url: `${ORIGIN}/`,
    logo: { "@type": "ImageObject", url: `${ORIGIN}/icon-512.png`, width: 512, height: 512 },
    parentOrganization: { "@type": "Organization", name: "Xooteq Lab Private Limited", url: "https://xooteq.com" },
  };
}

export function websiteLd() {
  return { "@type": "WebSite", "@id": ID.site, name: "Tailzu", url: `${ORIGIN}/`, inLanguage: "en", publisher: { "@id": ID.org } };
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
  if (p.monthly) offers.push({
    "@type": "Offer", name: p.monthly.name, price: p.monthly.amount.toFixed(2), priceCurrency: "USD",
    priceSpecification: { "@type": "UnitPriceSpecification", price: p.monthly.amount.toFixed(2), priceCurrency: "USD", billingDuration: "P1M", unitCode: "MON" },
    description: "Unlimited words, billed monthly.",
  });
  if (p.yearly) offers.push({
    "@type": "Offer", name: p.yearly.name, price: p.yearly.amount.toFixed(2), priceCurrency: "USD",
    priceSpecification: { "@type": "UnitPriceSpecification", price: p.yearly.amount.toFixed(2), priceCurrency: "USD", billingDuration: "P1Y", unitCode: "ANN" },
    description: `Unlimited words, billed yearly.${p.yearly.trialDays ? ` ${p.yearly.trialDays} days free in the app.` : ""}`,
  });
  return {
    "@type": "SoftwareApplication",
    "@id": ID.app,
    name: "Tailzu",
    alternateName: ["Tailzu AI Keyboard", "Tailzu Voice Keyboard"],
    description: DEFINITION,
    url: `${ORIGIN}/`,
    applicationCategory: "UtilitiesApplication",
    applicationSubCategory: "AI keyboard",
    operatingSystem: "iOS, Android, Windows, macOS",
    // The Microsoft Store listing joins the other two once it is set
    // (catalog.WINDOWS_STORE_ID); /download stays for Mac and the installer.
    downloadUrl: [...STORE_LINKS, abs("/download")],
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
      "Desktop app for Windows and Mac: tap Ctrl twice, talk, and the text is pasted at the cursor",
    ],
    inLanguage: "en",
    availableOnDevice: "iPhone, Android phone, Windows PC, Mac",
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

