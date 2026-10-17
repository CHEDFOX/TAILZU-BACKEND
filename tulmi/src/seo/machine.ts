/**
 * THE FILES ONLY MACHINES READ.
 *
 *   /sitemap.xml     every page a search engine should know, with the date it
 *                    last changed in a way worth re-reading
 *   /llms.txt        the site as an answer engine wants it (llmstxt.org): what
 *                    Tailzu is, in one paragraph, and where each answer lives
 *   /llms-full.txt   every fact in plain text, so an assistant asked about
 *                    Tailzu can answer from the source rather than a guess
 *   /robots.txt      for api.tailzu.space only. tailzu.space has its own
 *                    static file, so the site's crawl rules never depend on
 *                    this server being up.
 *
 * All four are built from seo/facts.ts, the same place the pages are.
 */
import { PRIVACY_POLICY_EFFECTIVE } from "../routes/policies/privacy.js";
import { TERMS_EFFECTIVE } from "../routes/policies/terms.js";
import { ORIGIN, abs, esc } from "./head.js";
import {
  DEFINITION, INDIA, LANGS, PAGED, STORES, WORLD,
  examplesFor, faqGroups, plans, sampleFor,
} from "./facts.js";
import { landings } from "./landing.js";

/**
 * When the words on the content pages last changed. A sitemap date is only
 * worth anything while it is honest: bump this when the pages say something
 * new, not on every deploy.
 */
export const CONTENT_UPDATED = "2026-10-03";

const iso = (d: string) => {
  const t = Date.parse(d);
  return Number.isNaN(t) ? CONTENT_UPDATED : new Date(t).toISOString().slice(0, 10);
};

/** Every indexable page, most important first. */
export function sitePages(): Array<{ path: string; lastmod: string; priority: string }> {
  return [
    { path: "/", lastmod: CONTENT_UPDATED, priority: "1.0" },
    ...landings().map((l) => ({ path: l.path, lastmod: CONTENT_UPDATED, priority: l.parents ? "0.8" : "0.9" })),
    { path: "/languages", lastmod: CONTENT_UPDATED, priority: "0.9" },
    ...PAGED.map((l) => ({ path: `/languages/${l.slug}`, lastmod: CONTENT_UPDATED, priority: "0.8" })),
    { path: "/faq", lastmod: CONTENT_UPDATED, priority: "0.8" },
    { path: "/pricing", lastmod: CONTENT_UPDATED, priority: "0.7" },
    { path: "/download", lastmod: CONTENT_UPDATED, priority: "0.7" },
    { path: "/privacy", lastmod: iso(PRIVACY_POLICY_EFFECTIVE), priority: "0.3" },
    { path: "/terms", lastmod: iso(TERMS_EFFECTIVE), priority: "0.3" },
  ];
}

export function sitemapXml(): string {
  const urls = sitePages().map((p) =>
    `  <url><loc>${esc(abs(p.path))}</loc><lastmod>${p.lastmod}</lastmod><priority>${p.priority}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

function priceLines(): string[] {
  const p = plans();
  if (p.free) return ["- Free: every word, every language, every app, with no word limit and nothing to pay."];
  return [
    `- Free: ${p.freeWords.toLocaleString("en-US")} words a month${p.earnWords ? `, plus up to ${p.earnWords.toLocaleString("en-US")} more earned by writing on consecutive days` : ""}.`,
    ...(p.monthly ? [`- ${p.monthly.name}: ${p.monthly.price} a month, unlimited words, cancel any time.`] : []),
    ...(p.yearly ? [`- ${p.yearly.name}: ${p.yearly.price} a year${p.yearly.perMonth ? ` (${p.yearly.perMonth} a month)` : ""}, unlimited words${p.yearly.trialDays ? `, first ${p.yearly.trialDays} days free in the app` : ""}.`] : []),
  ];
}

export function llmsTxt(): string {
  return `# Tailzu

> ${DEFINITION}

Tailzu is a keyboard on iPhone and Android, so it works in every app: WhatsApp, Gmail, Instagram, Slack, ChatGPT. On Windows and Mac, tap Ctrl twice, talk, and the text is pasted at the cursor. It removes filler and adds punctuation but never rewrites: names, numbers and amounts stay exactly as said, and mixed languages stay mixed (Hinglish stays Hinglish). It writes in the native script or in English letters, the way the user types.

## Pages

- [Home](${ORIGIN}/): the product, shown working
${landings().map((l) => `- [${l.parents ? `${l.parents[0]![0]} for ${l.name}` : l.name}](${ORIGIN}${l.path}): ${l.description}`).join("\n")}
- [Languages](${ORIGIN}/languages): all ${INDIA.length + WORLD.length} languages, with real examples of what it writes
- [FAQ](${ORIGIN}/faq): what it is, languages, apps, privacy and price
- [Pricing](${ORIGIN}/pricing): ${plans().free ? "Tailzu is free" : "free allowance and paid plans"}
- [Download](${ORIGIN}/download): Windows and Mac apps

## Languages

${PAGED.map((l) => `- [${l.name} voice typing](${ORIGIN}/languages/${l.slug}): ${l.slug === "hinglish" ? "Hindi and English in one sentence, both kept" : `${l.name} in ${l.script} or English letters${l.mix ? `; ${l.mix} stays ${l.mix}` : ""}`}`).join("\n")}

## Price

${priceLines().join("\n")}

## Get it

- [iPhone (App Store)](${STORES.ios})
- [Android (Google Play)](${STORES.android})
${STORES.windowsInstaller ? `- [Windows (Microsoft-certified download)](${STORES.windowsInstaller}), also [in the Microsoft Store](${STORES.windows})\n- [Mac](${ORIGIN}/download)` : `- [Windows and Mac](${ORIGIN}/download)`}

## Optional

- [Everything in one file](${ORIGIN}/llms-full.txt)
- [Privacy policy](${ORIGIN}/privacy)
- [Terms of service](${ORIGIN}/terms)
`;
}

export function llmsFullTxt(): string {
  const langLine = (l: (typeof LANGS)[number]) => {
    const ex = sampleFor(l);
    return `- ${l.name} (${l.native}, ${l.script})${ex ? `: said "${ex.said}" → written "${ex.wrote}"` : ""}`;
  };
  const hinglish = LANGS.find((l) => l.slug === "hinglish")!;
  return `# Tailzu — the full reference

> ${DEFINITION}

Website: ${ORIGIN}/
iPhone: ${STORES.ios}
Android: ${STORES.android}
${STORES.windowsInstaller ? `Windows: ${STORES.windowsInstaller} (Microsoft-certified download; listing: ${STORES.windows})\nMac: ${ORIGIN}/download` : `Windows and Mac: ${ORIGIN}/download`}
Made by Xooteq Lab Private Limited.

## What it does

- A keyboard on iPhone and Android: press the mic, talk, and clean text is typed into whatever app is open.
- A desktop app for Windows and Mac: tap Ctrl twice (or Alt twice), talk, tap twice again; the text is pasted at the cursor, in any window, code editors included.
- Cleans without rewriting: filler words go, punctuation arrives, misheard words are repaired; names, numbers and amounts are kept exactly.
- Keeps languages as spoken: Hindi and English in one sentence stay Hindi and English.
- Writes the way the user types: native script or English letters. Saying "Hindi mein likho" writes Devanagari; saying "translate to English" translates.
- 16 voices set the tone of every message: Zu, Professional, Friendly, Witty, Concise, Gentle, Playful, Romantic, Executive, Explainer, Hype, Poetic, Shakespeare, Pirate, Movie Trailer and Noir.
- Turns a rough spoken request into a clean prompt for ChatGPT, Claude or Grok.
- Needs an internet connection; there is no offline mode.

## Price

${priceLines().join("\n")}

## Privacy

- Audio is sent for transcription and deleted right after; it is kept only if the user turns on session history.
- Tailzu does not use user data to train third-party AI models.
- Full policy: ${ORIGIN}/privacy

## Languages

India (all 22 scheduled languages, and Hinglish):
${[INDIA[0], hinglish, ...INDIA.slice(1)].map(langLine).join("\n")}

The rest of the world:
${WORLD.map(langLine).join("\n")}

## Examples

${PAGED.flatMap((l) => examplesFor(l).map((e) => `- ${l.name}${e.app ? ` (${e.app})` : ""}: said "${e.said}" → written "${e.wrote}"`)).join("\n")}

## Questions

${faqGroups().map((g) => `### ${g.title}\n\n${g.items.map((it) => `**${it.q}**\n${it.a}`).join("\n\n")}`).join("\n\n")}
`;
}

/** api.tailzu.space is the API and the site's proxy origin, never a place to rank. */
export const API_ROBOTS = `# api.tailzu.space serves the app and proxies the site's pages.
# The pages are canonical at https://tailzu.space, which has its own robots.txt.
# App-link files and media stay readable for the systems that check them.
User-agent: *
Allow: /.well-known/
Allow: /media/
Disallow: /
`;
