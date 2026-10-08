/**
 * THE PAGES THAT ANSWER WHAT PEOPLE ASK.
 *
 * The landing page makes its argument in motion and says almost nothing in
 * words, which is right for a person and useless to a search engine: there
 * is no sentence on it that answers "Tamil voice typing" or "does it work
 * offline". These pages are where those answers live, in the site's own
 * room (policies/shell.ts), each one built from seo/facts.ts so no page can
 * say a different price, a different language count or a different promise.
 *
 *   /languages          every language, India's 22 first, each with what it wrote
 *   /languages/<name>   one language: its sentences, its script, its questions
 *   /faq                every question, answered so any one can be quoted alone
 *
 * The example sentences are shown exactly as written: they are the product's
 * output, so the site's every-word-capitalised rule stops at their edge.
 */
import { siteShell } from "../routes/policies/shell.js";
import {
  INDIA, LANGS, PAGED, STORES, WORLD,
  crumbsLd, examplesFor, faqGroups, faqLd, langBySlug, langFaq, pageLd, sampleFor,
  type Example, type Lang, type QA,
} from "./facts.js";
import { ID } from "./facts.js";
import { esc } from "./head.js";
/**
 * Escaped, with the names capitalising would break held as they are spelled.
 * The site capitalises every word, and "iPhone" is the one word that rule
 * turns into a misspelling.
 */
export const words = (s: string) => esc(s).replace(/\b(iPhone|iMessage)\b/g, '<span class="nc">$1</span>');

/** The handwriting the site's river is written in, for the "said" side. */
export const HAND = "family=Caveat:wght@400..600&family=Kalam:wght@300;400";

export const CSS = `
  .crumbs { font-family: var(--mono); font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: var(--dim); margin: 0 0 22px; display: flex; flex-wrap: wrap; gap: 10px; }
  .crumbs a { text-decoration: none; }
  .crumbs a:hover { color: var(--white); }
  .crumbs span[aria-hidden] { opacity: .5; }
  h2.label { font-family: var(--mono); font-weight: 400; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin: 72px 0 18px; }

  /* Said, then written: the product's own before and after. */
  .exs { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; margin: 44px 0 0; }
  .nc { text-transform: none; }
  .ex { margin: 0; background: var(--card); border: 1px solid var(--rule); border-radius: 22px; padding: 22px 24px 24px; display: flex; flex-direction: column; gap: 10px; }
  .ex .app { font-family: var(--mono); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin: 0; }
  .ex .s { font-family: 'Caveat', 'Kalam', cursive; font-size: 24px; line-height: 1.25; color: var(--grey); margin: 0; text-transform: none; }
  .ex .w { font-family: var(--serif); font-weight: 400; font-size: 24px; line-height: 1.3; letter-spacing: -.01em; color: var(--white); margin: 0; text-transform: none; }
  .ex .arrow { font-family: var(--mono); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); }

  /* Facts, two by two. */
  .facts2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px 56px; max-width: 880px; }
  .facts2 h3 { font-family: var(--serif); font-weight: 400; font-size: 24px; line-height: 1.2; margin: 0 0 6px; }
  .facts2 p { color: var(--grey); margin: 0; }
  .facts2 .native { text-transform: none; }

  /* Questions. */
  .qas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 34px 56px; max-width: 960px; }
  .qa h3 { font-family: var(--serif); font-weight: 400; font-size: 24px; line-height: 1.22; letter-spacing: -.01em; margin: 0 0 8px; text-wrap: balance; }
  .qa p { color: var(--grey); margin: 0; }

  /* Every language, as a wall of cards. */
  .langs { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
  .lang { display: flex; flex-direction: column; gap: 4px; padding: 18px 20px 20px; border: 1px solid var(--rule); border-radius: 20px; background: var(--raise); text-decoration: none; min-height: 132px; transition: border-color .2s; }
  a.lang:hover { border-color: var(--white); }
  .lang .nm { font-family: var(--serif); font-size: 22px; line-height: 1.15; }
  .lang .nt { font-size: 18px; color: var(--grey); text-transform: none; }
  .lang .sc { font-family: var(--mono); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--dim); margin-top: auto; padding-top: 10px; }
  .lang .wr { font-family: var(--serif); font-size: 16px; line-height: 1.35; color: var(--grey); text-transform: none; margin-top: 6px; }
  a.lang .go { font-family: var(--mono); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--white); }

  .gets { display: flex; flex-wrap: wrap; gap: 10px; margin: 36px 0 0; }
  .btn.ghost { background: none; color: var(--white); border: 1px solid var(--rule); }
  .btn.ghost:hover { border-color: var(--white); opacity: 1; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border: 1px solid var(--rule); border-radius: 999px; text-decoration: none; font-size: 14px; }
  .chip:hover { border-color: var(--white); }

  @media (max-width: 720px) {
    .facts2, .qas { grid-template-columns: 1fr; gap: 26px; }
    .ex .s, .ex .w { font-size: 21px; }
    h2.label { margin-top: 56px; }
  }
`;

export function crumbs(trail: Array<[string, string]>): string {
  return `<nav class="crumbs" aria-label="Breadcrumb">${trail.map(([name, href], i) =>
    (i ? '<span aria-hidden="true">/</span>' : "") +
    (i === trail.length - 1 ? `<span aria-current="page">${esc(name)}</span>` : `<a href="${esc(href)}">${esc(name)}</a>`)).join("")}</nav>`;
}

/** "ta", or "ta-Latn" for Tamil written in English letters, which is how it is written back. */
const tagFor = (lang: Lang | undefined, text: string) => {
  if (!lang || lang.slug === "hinglish") return "";
  const latinText = lang.script !== "Latin" && !/[^\p{Script=Latin}\p{P}\p{N}\s]/u.test(text);
  return ` lang="${lang.code}${latinText ? "-Latn" : ""}"`;
};

export function exampleCard(e: Example, lang?: Lang): string {
  const dir = ' dir="auto"';
  return `<figure class="ex">
    ${e.app ? `<p class="app">${esc(e.app)}</p>` : ""}
    <p class="s"${tagFor(lang, e.said)}${dir}>${esc(e.said)}</p>
    <span class="arrow" aria-hidden="true">Written</span>
    <p class="w"${tagFor(lang, e.wrote)}${dir}>${esc(e.wrote)}</p>
  </figure>`;
}

export function qaList(items: QA[]): string {
  return `<div class="qas">${items.map((it) =>
    `<div class="qa"><h3>${words(it.q)}</h3><p>${words(it.a)}</p></div>`).join("")}</div>`;
}

export const GETS = `<div class="gets">
  <a class="btn" href="${STORES.ios}">App Store</a>
  <a class="btn" href="${STORES.android}">Google Play</a>
  ${STORES.windowsInstaller
    ? `<a class="btn" href="${STORES.windowsInstaller}">Windows</a>
  <a class="btn ghost" href="/download">Mac</a>`
    : `<a class="btn ghost" href="/download">Windows and Mac</a>`}
</div>`;

// ---------------------------------------------------------------- /languages

export function languagesHubHtml(): string {
  const path = "/languages";
  const card = (l: Lang) => {
    const ex = sampleFor(l);
    const inner = `<span class="nm">${esc(l.name)}</span>` +
      (l.native !== l.name ? `<span class="nt" lang="${l.code}" dir="auto">${esc(l.native)}</span>` : "") +
      (ex ? `<span class="wr"${tagFor(l, ex.wrote)} dir="auto">${esc(ex.wrote)}</span>` : "") +
      `<span class="sc">${esc(l.script)}</span>` +
      (l.page ? `<span class="go">Read more</span>` : "");
    return l.page ? `<a class="lang" href="/languages/${l.slug}">${inner}</a>` : `<div class="lang">${inner}</div>`;
  };
  const hinglish = LANGS.find((l) => l.slug === "hinglish")!;
  const india = [INDIA[0], hinglish, ...INDIA.slice(1)];
  const total = INDIA.length + WORLD.length;
  const title = `Voice Typing in ${total} Languages, All 22 Indian Languages — Tailzu`;
  const description = `AI keyboard and voice typing in ${total} languages: all 22 of India, Hinglish, English and ${WORLD.length - 1} more. Speak, and clean text lands in any app.`;
  return siteShell({
    title: "Languages",
    headTitle: title,
    path,
    description,
    fonts: HAND,
    css: CSS,
    ld: [
      pageLd(path, "Voice typing languages", description, { "@type": ["WebPage", "CollectionPage"] }),
      crumbsLd([["Tailzu", "/"], ["Languages", path]]),
      {
        "@type": "ItemList",
        name: "Languages Tailzu writes",
        numberOfItems: india.length + WORLD.length,
        itemListElement: [...india, ...WORLD].map((l, i) => ({
          "@type": "ListItem", position: i + 1, name: l.name,
          ...(l.page ? { url: `https://tailzu.space/languages/${l.slug}` } : {}),
        })),
      },
    ],
    main: `
${crumbs([["Tailzu", "/"], ["Languages", path]])}
<p class="eye">Voice typing</p>
<h1>Every language you speak.</h1>
<p class="lede">All 22 languages of India, Hinglish, English and ${WORLD.length - 1} more. It writes the way you type.</p>
<p class="lede" style="margin-top:14px"><a href="/ai-keyboard">What the AI keyboard does</a> · <a href="/voice-typing">How voice typing works</a></p>

<h2 class="label">India · ${india.length}</h2>
<div class="langs">${india.map(card).join("")}</div>

<h2 class="label">The world · ${WORLD.length}</h2>
<div class="langs">${WORLD.map(card).join("")}</div>

${GETS}`,
  });
}

// ---------------------------------------------------------------- /languages/<name>

export function languagePageHtml(slug: string): string | null {
  const l = langBySlug(slug);
  if (!l) return null;
  const path = `/languages/${l.slug}`;
  const exs = examplesFor(l);
  const faq = langFaq(l);
  const hinglish = l.slug === "hinglish";
  // THE NATIVE NAME IN THE TITLE: someone searching in their own language
  // types "தமிழ்", not "Tamil", and a title is the strongest thing a page says.
  const latin = l.script === "Latin";
  const title = `${l.name} Voice Typing & AI Keyboard${l.native !== l.name && !hinglish ? ` (${l.native})` : ""} — Tailzu`;
  const description = hinglish
    ? "Hinglish voice typing that keeps both languages. Speak Hindi and English in one breath; clean text lands in WhatsApp, Gmail or any app, spelled your way."
    : `${l.name} voice typing that writes what you meant. Speak ${l.name}${l.mix ? ` or ${l.mix}` : ""}, and clean text lands in WhatsApp, Gmail or any app${latin ? "." : `, in ${l.script} or English letters.`}`;
  const lede = hinglish
    ? "Hindi and English in one breath. Both stay as you said them."
    : `Speak ${l.name}. Clean text lands in any app.`;
  // Its own side of the list first (India or the world), then the other's
  // best-known, so every page links on without a wall of 74 chips.
  const near = PAGED.filter((o) => o.slug !== l.slug && o.india === l.india);
  const far = PAGED.filter((o) => o.india !== l.india).slice(0, 8);
  const siblings = [...near, ...far];

  const facts = hinglish ? [
    ["Two stay two", "Hindi words stay Hindi and English words stay English. Nothing is forced into one of them."],
    ["Spelled your way", "In English letters, the way you type Hinglish, or in Devanagari. Say \"Hindi mein likho\" for Devanagari."],
    ["Filler out, facts in", "Ums and repeats go. Names, amounts and times stay exactly as you said them."],
    ["Every app", "A keyboard on iPhone and Android. On Windows and Mac, tap Ctrl twice and talk."],
  ] : [
    // AS IT IS TODAY: the writer spells every language in English letters
    // unless the sentence asks for its own script (assistPrompt), and a page
    // that promised the script would be the first thing a reader caught out.
    ["Script", latin
      ? `<span class="native" lang="${l.code}" dir="auto">${esc(l.native)}</span> is written in Latin letters, and Tailzu writes it that way.`
      : `<span class="native" lang="${l.code}" dir="auto">${esc(l.native)}</span> is written in ${esc(l.script)}. Tailzu writes it in English letters, the way you would type it, and in ${esc(l.script)} when you say so.`],
    [l.mix ? l.mix : "With English", `${l.mix ? `${esc(l.mix)} stays ${esc(l.mix)}.` : `${esc(l.name)} and English in one sentence stay as you said them.`} Two languages stay two.`],
    ["Filler out, facts in", "Filler goes and punctuation arrives. Names, amounts and times stay exactly as you said them."],
    ["Every app", "A keyboard on iPhone and Android. On Windows and Mac, tap Ctrl twice and talk."],
  ];

  return siteShell({
    title: `${l.name} voice typing`,
    headTitle: title,
    path,
    description,
    fonts: HAND,
    css: CSS,
    ld: [
      pageLd(path, `${l.name} voice typing`, description, { inLanguage: "en", about: [{ "@id": ID.app }, { "@type": "Language", name: l.name, alternateName: l.native, identifier: l.code }] }),
      crumbsLd([["Tailzu", "/"], ["Languages", "/languages"], [l.name, path]]),
      faqLd(faq, path),
    ],
    main: `
${crumbs([["Tailzu", "/"], ["Languages", "/languages"], [l.name, path]])}
<p class="eye">${hinglish ? "Hindi + English" : `<span lang="${l.code}" dir="auto" style="text-transform:none">${esc(l.native)}</span>`}</p>
<h1>${esc(l.name)} voice typing.</h1>
<p class="lede">${esc(lede)}</p>

<div class="exs">${exs.map((e) => exampleCard(e, l)).join("")}</div>

<h2 class="label">How it writes ${esc(l.name)}</h2>
<div class="facts2">${facts.map(([h, p]) => `<div><h3>${esc(h)}</h3><p>${p.replace(/\biPhone\b/g, '<span class="nc">iPhone</span>')}</p></div>`).join("")}</div>

<h2 class="label">Asked, answered</h2>
${qaList(faq)}

${GETS}

<p class="lede" style="margin-top:28px"><a href="/ai-keyboard">${esc(l.name)} AI keyboard</a> · <a href="/voice-typing">Voice typing in every app</a></p>

<h2 class="label">More languages</h2>
<div class="chips">${siblings.map((o) => `<a class="chip" href="/languages/${o.slug}">${esc(o.name)}</a>`).join("")}<a class="chip" href="/languages">All ${INDIA.length + WORLD.length}</a></div>`,
  });
}

// ---------------------------------------------------------------- /faq

/**
 * THE WAY ON TO THE LANGUAGES. The footer carries one link for all of this
 * (FAQ), so the language pages hang off the FAQ's languages answers: every
 * one a tap from there, and from the sitemap.
 */
const LANG_LINKS = `<div class="chips" style="margin-top:34px">${
  PAGED.filter((l) => l.india).concat(PAGED.filter((l) => !l.india).slice(0, 10))
    .map((l) => `<a class="chip" href="/languages/${l.slug}">${esc(l.name)}</a>`).join("")
}<a class="chip" href="/languages">All ${INDIA.length + WORLD.length} languages</a></div>`;

/** The search pages, one tap from the FAQ the footer links to. */
const DEVICE_LINKS = `<div class="chips" style="margin-top:34px">${[
  ["/ai-keyboard", "AI keyboard"], ["/voice-typing", "Voice typing"],
  ["/ai-keyboard/android", "Android"], ["/ai-keyboard/iphone", "iPhone"],
  ["/voice-typing/windows", "Windows"], ["/voice-typing/mac", "Mac"],
  ["/voice-typing/chatgpt", "ChatGPT, Claude and Grok"],
].map(([href, name]) => `<a class="chip" href="${href}">${words(name!)}</a>`).join("")}</div>`;

export function faqHtml(): string {
  const path = "/faq";
  const groups = faqGroups();
  const all = groups.flatMap((g) => g.items);
  const description = "What Tailzu is, which languages and apps it works in, what happens to your voice, and what it costs. Every question, answered in a breath.";
  return siteShell({
    title: "FAQ",
    headTitle: "Tailzu FAQ — Languages, Apps, Privacy and Price",
    path,
    description,
    css: CSS,
    ld: [
      pageLd(path, "Tailzu FAQ", description),
      crumbsLd([["Tailzu", "/"], ["FAQ", path]]),
      faqLd(all, path),
    ],
    main: `
${crumbs([["Tailzu", "/"], ["FAQ", path]])}
<p class="eye">Questions</p>
<h1>Asked, answered.</h1>
<p class="lede">Everything people ask before they talk to it, answered in a breath.</p>
${groups.map((g) => `<h2 class="label">${esc(g.title)}</h2>\n${qaList(g.items)}${g.title === "Languages" ? LANG_LINKS : ""}${g.title === "Apps and devices" ? DEVICE_LINKS : ""}`).join("\n")}

${GETS}`,
  });
}
