/**
 * THE LANDING PAGE, AS A MACHINE READS IT.
 *
 * tailzu.space draws its words from GET /v1/site once its script runs. Most
 * of what reads a page does not run scripts: the crawlers behind ChatGPT,
 * Claude and Perplexity, link previews, and a search engine on its first
 * pass. To them the page was a title that said "Tailzu", an empty FAQ and
 * empty steps. This writes the backend's own words into the page's HTML, so
 * the first read is the real one; the script still takes over as before.
 *
 * Only what sits between the page's SEO markers is touched:
 *
 *   SEO:HEAD          title, summary, canonical, link card, icons, JSON-LD
 *   SEO:steps         the three steps           (SITE_UI.how)
 *   SEO:toneSaid      the tones' sentence       (SITE_UI.tone.said)
 *   SEO:toneGrid      the tones                 (SITE_UI.tone.tones)
 *   SEO:faq           the questions             (SITE_UI.faq, filled)
 *   SEO:faqCopy       the script's own fallback questions, so a page whose
 *                     /v1/site call fails still says the same thing
 *
 *   npx tsx scripts/sync-site.mts ../../tailzu-web/index.html           write
 *   npx tsx scripts/sync-site.mts ../../tailzu-web/index.html --check   exit 1 if stale
 *
 * The free allowance comes from FREE_MONTHLY_WORDS, as on the server: set it
 * to production's value when syncing if production changed it.
 */
import fs from "node:fs";

// Config validation wants the server's keys; none of them are used here.
for (const [k, v] of Object.entries({
  OPENROUTER_API_KEY: "unused", OPENAI_API_KEY: "unused", STT_PROVIDER: "openai", DEV_SKIP_AUTH: "true", NODE_ENV: "development",
})) process.env[k] ??= v;

const { SITE_UI } = await import("../src/experience/catalog.js");
const { HOME, appLd, faqLd, homeFaq, orgLd, pageLd, websiteLd } = await import("../src/seo/facts.js");
const { esc, headTags } = await import("../src/seo/head.js");

const file = process.argv[2];
const check = process.argv.includes("--check");
if (!file) { console.error("usage: sync-site.mts <index.html> [--check]"); process.exit(2); }

// The same markup the page's own script builds (paintBelow), so the swap to
// the live copy changes nothing a reader can see.
const steps = SITE_UI.how.steps
  .map((s, i) => `<div class="step"><p class="n">0${i + 1}</p><h3>${esc(s.title)}</h3></div>`).join("");
const toneGrid = SITE_UI.tone.tones
  .map((t, i) => `<div class="tcard t${i % 8}"><span class="tn">${esc(t.name)}</span><p>${esc(t.text)}</p></div>`).join("");
const faq = homeFaq()
  .map((it) => `<div class="qa"><h3>${esc(it.q)}</h3><p>${esc(it.a)}</p></div>`).join("");
const faqCopy = [
  "    faq: {",
  `      title: ${JSON.stringify(SITE_UI.faq.title)},`,
  "      items: [",
  SITE_UI.faq.items.map((it) => `        { q: ${JSON.stringify(it.q)}, a: ${JSON.stringify(it.a)} }`).join(",\n"),
  "      ]",
  "    },",
].join("\n");
const head = headTags({
  path: "/",
  title: HOME.title,
  description: HOME.description,
  ogTitle: HOME.ogTitle,
  ogDescription: HOME.ogDescription,
  ld: [orgLd(), websiteLd(), appLd(), pageLd("/", "Tailzu", HOME.description), faqLd(homeFaq(), "/")],
});

/** Replace what lies between an opening marker (to the end of its own
 *  comment or line) and its closing marker. */
function fill(src: string, open: RegExp, close: string, body: string): string {
  const m = open.exec(src);
  if (!m) throw new Error(`marker not found: ${open}`);
  const from = m.index + m[0].length;
  const to = src.indexOf(close, from);
  if (to < 0) throw new Error(`closing marker not found: ${close}`);
  return src.slice(0, from) + body + src.slice(to);
}

const before = fs.readFileSync(file, "utf8");
let html = before;
html = fill(html, /<!-- SEO:HEAD[\s\S]*?-->\n/, "<!-- /SEO:HEAD -->", `${head}\n`);
html = fill(html, /<!-- SEO:steps -->/, "<!-- /SEO:steps -->", steps);
html = fill(html, /<!-- SEO:toneSaid -->/, "<!-- /SEO:toneSaid -->", esc(SITE_UI.tone.said));
html = fill(html, /<!-- SEO:toneGrid -->/, "<!-- /SEO:toneGrid -->", toneGrid);
html = fill(html, /<!-- SEO:faq -->/, "<!-- /SEO:faq -->", faq);
html = fill(html, /\/\/ SEO:faqCopy[^\n]*\n/, "    // /SEO:faqCopy", `${faqCopy}\n`);

if (check) {
  if (html !== before) { console.error(`${file} is stale: run scripts/sync-site.mts`); process.exit(1); }
  console.log("site in sync");
} else {
  fs.writeFileSync(file, html);
  console.log(html === before ? "site already in sync" : `synced ${file}`);
}
