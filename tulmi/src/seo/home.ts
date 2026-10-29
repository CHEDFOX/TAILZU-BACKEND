/**
 * THE HOME PAGE, AS A MACHINE READS IT: what scripts/sync-site.mts writes
 * into x0bot.com's index.html, kept here so a test can hold every line of
 * it.
 *
 * The page draws its words from GET /v1/site once its script runs. Most of
 * what reads a page does not run scripts: the crawlers behind ChatGPT, Claude
 * and Perplexity, link previews, and a search engine on its first pass. So
 * the backend's own words are written into the HTML between the page's SEO
 * markers, in the same markup the page's own paint code builds, and the
 * script takes over from there with nothing a reader can see changing.
 *
 *   SEO:HEAD     title, summary, canonical, link card, icons, JSON-LD
 *                (and, on the redesigned page, its films as VideoObjects)
 *   SEO:steps    the three steps           (SITE_UI.how.steps)
 *   SEO:toneSaid the tones' sentence       (SITE_UI.tone.said)
 *   SEO:toneGrid the tones                 (SITE_UI.tone.tones)
 *   SEO:faq      the questions             (SITE_UI.faq, filled)
 *   SEO:faqCopy  the script's own fallback questions, inside its `C`
 *
 * and on the redesigned page (2026), all four or none:
 *
 *   SEO:hero     the category line, the h1 and the lede (SITE_UI.apps)
 *   SEO:line     the hero's first line, said, written and its receipt
 *   SEO:langs    a link to every language page, in LANGS order
 *   SEO:siteCopy every other SITE_UI key, as the script's own fallback `C`,
 *                so a page whose /v1/site call fails says what the server
 *                says, and no hand-kept copy can drift from it
 *
 * A page with none of the four is the page from before the redesign: its
 * six markers are filled as they always were and nothing else is touched.
 * A page with some but not all of them is half-built, and stops the sync.
 *
 * A page with SEO:HEAD alone (the paper page, 2026: its words are its own)
 * gets its head and nothing else, and that head names no films and no
 * questions, since the page shows neither.
 */
import { SITE_UI, siteCopy } from "../experience/catalog.js";
import {
  HOME, LANGS, appLd, faqLd, filmLd, homeFaq, homeFilms, orgLd, pageLd, websiteLd,
} from "./facts.js";
import { esc, headTags } from "./head.js";

/** The redesign's markers, as the sync finds them. */
export const REDESIGN_MARKERS = {
  hero: "<!-- SEO:hero -->",
  line: "<!-- SEO:line -->",
  langs: "<!-- SEO:langs -->",
  siteCopy: "// SEO:siteCopy",
} as const;

// ---------------------------------------------------------------- the six

export const stepsHtml = () => SITE_UI.how.steps
  .map((s, i) => `<div class="step"><p class="n">0${i + 1}</p><h3>${esc(s.title)}</h3></div>`).join("");

export const toneGridHtml = () => SITE_UI.tone.tones
  .map((t, i) => `<div class="tcard t${i % 8}"><span class="tn">${esc(t.name)}</span><p>${esc(t.text)}</p></div>`).join("");

export const faqHtml = () => homeFaq()
  .map((it) => `<div class="qa"><h3>${esc(it.q)}</h3><p>${esc(it.a)}</p></div>`).join("");

/**
 * A value as JavaScript source inside an inline <script>. JSON is a JS
 * expression; every "<" is written < — the same string to the parser —
 * so nothing in the copy can close the script ("</script") or open the
 * HTML comment state ("<!--") that changes how the rest of it is read.
 */
export const jsValue = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export const faqCopyJs = () => [
  "    faq: {",
  `      title: ${jsValue(SITE_UI.faq.title)},`,
  "      items: [",
  siteCopy().faq.items.map((it) => `        { q: ${jsValue(it.q)}, a: ${jsValue(it.a)} }`).join(",\n"),
  "      ]",
  "    },",
].join("\n");

/** The home page's head. The films' structured data goes only into a page
 *  that has the films, so the page from before the redesign never points a
 *  search engine at a video it does not have; and the questions only into a
 *  page that shows them (the head-only page does not). */
export function headHtml(withFilms: boolean, withFaq = true): string {
  return headTags({
    path: "/",
    title: HOME.title,
    description: HOME.description,
    ogTitle: HOME.ogTitle,
    ogDescription: HOME.ogDescription,
    ld: [
      orgLd(), websiteLd(), appLd(), pageLd("/", "X0 Bot", HOME.description), ...(withFaq ? [faqLd(homeFaq(), "/")] : []),
      ...(withFilms ? homeFilms().map(filmLd) : []),
    ],
  });
}

/**
 * The films the head describes, held to what the site really publishes:
 * each film's .mp4 and .webp poster in the page's media/ folder, and its
 * length in media/manifest.json (the media workstream's list of every cut),
 * when there is one. A search engine shown a video that 404s, or a length
 * the file does not have, stops trusting the rest of the page's data.
 * Returns what is wrong; an empty list is a pass.
 */
export function filmProblems(
  manifest: { media?: Record<string, { file?: string; dur?: number }> } | null,
  exists: (file: string) => boolean,
): string[] {
  const out: string[] = [];
  const cuts = Object.values(manifest?.media ?? {});
  for (const f of homeFilms()) {
    for (const ext of ["mp4", "webp"]) if (!exists(`${f.file}.${ext}`)) out.push(`media/${f.file}.${ext} is missing`);
    if (!manifest) continue;
    const cut = cuts.find((c) => c.file === `${f.file}.mp4`);
    if (!cut) out.push(`media/manifest.json has no ${f.file}.mp4`);
    else if (typeof cut.dur === "number" && Math.abs(cut.dur - f.seconds) > 0.15) {
      out.push(`${f.id}: facts.FILM_MEDIA says ${f.seconds} s, media/${f.file}.mp4 is ${cut.dur} s`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the redesign's

/**
 * The h1, as the page's paint code builds it: the title's `human` part (when
 * the title starts with it) in <em>, the human half; the last word, without
 * its trailing punctuation, in <span class="kw"> (the word the page turns
 * into keys); everything else as text. The accessible name is the title,
 * whatever the spans.
 */
export function titleHtml(title: string, human?: string): string {
  let out = "", rest = title;
  if (human && title.startsWith(human)) { out = `<em>${esc(human)}</em>`; rest = title.slice(human.length); }
  const last = /([\p{L}\p{N}][\p{L}\p{N}'’-]*)([^\p{L}\p{N}]*)$/u.exec(rest);
  if (!last) return out + esc(rest);
  return out + esc(rest.slice(0, last.index)) + `<span class="kw">${esc(last[1]!)}</span>` + esc(last[2]!);
}

export function heroLines(): string[] {
  const a = SITE_UI.apps;
  return [
    `<p class="kind" id="appsKind">${esc(a.kind)}</p>`,
    `<h1 id="appsTitle">${titleHtml(a.title, a.human)}</h1>`,
    `<p class="lede" id="appsLede">${esc(a.lede)}</p>`,
  ];
}

/**
 * The language a said line is in, as a BCP 47 code for its `lang`: a case's
 * own (its `lang` name in LANGS), or for a keyboard scene's instruction,
 * Hindi in Devanagari and Hinglish in English letters — the same rule the
 * language pages use (facts.examplesFor).
 */
export function lineLang(said: string): string {
  const c = SITE_UI.cases.find((x) => x.said === said);
  if (c) return LANGS.find((l) => l.name === c.lang)?.code ?? "en";
  return /[ऀ-ॿ]/.test(said) ? "hi" : "hi-Latn";
}

export function lineLines(): string[] {
  const l = SITE_UI.lines[0];
  return [
    `<p class="said" id="lineSaid" lang="${esc(lineLang(l.said))}">${esc(l.said)}</p>`,
    `<p class="wrote" id="lineWrote">${esc(l.wrote)}</p>`,
    `<p class="note" id="lineNote">${esc(l.note)}</p>`,
  ];
}

/**
 * A link to every language page, each named in its own script and in
 * English: 75 internal links a crawler follows from the home page. A
 * language whose own name is its English one (English, Hinglish) is named
 * once. The English name is marked as English, so a screen reader does not
 * read "Hindi" in a Hindi voice.
 */
export function langsLines(): string[] {
  return LANGS.filter((l) => l.page).map((l) => {
    const own = `<span class="ln">${esc(l.native)}</span>`;
    const en = l.native === l.name ? "" : ` <span class="le" lang="en">${esc(l.name)}</span>`;
    return `<a class="lang" href="/languages/${esc(l.slug)}" lang="${esc(l.code)}">${own}${en}</a>`;
  });
}

/** Every SITE_UI key but `faq` (faqCopy has it), one property a line. */
export function siteCopyLines(): string[] {
  return Object.entries(siteCopy())
    .filter(([k]) => k !== "faq")
    .map(([k, v]) => `    ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${jsValue(v)},`);
}

// ---------------------------------------------------------------- the fill

/** Replace what lies between an opening marker (to the end of its own
 *  comment or line) and its closing marker. */
export function fill(src: string, open: RegExp, close: string, body: string): string {
  const m = open.exec(src);
  if (!m) throw new Error(`marker not found: ${open}`);
  const from = m.index + m[0].length;
  const to = src.indexOf(close, from);
  if (to < 0) throw new Error(`closing marker not found: ${close}`);
  return src.slice(0, from) + body + src.slice(to);
}

/** Fill a marker pair with markup, one element a line, at the indent of the
 *  opening marker's line (when the marker starts that line), so the page's
 *  source reads the same after a sync as before it. */
export function fillLines(src: string, open: string, close: string, lines: string[]): string {
  const at = src.indexOf(open);
  if (at < 0) throw new Error(`marker not found: ${open}`);
  const lineStart = src.lastIndexOf("\n", at) + 1;
  const lead = src.slice(lineStart, at);
  const indent = /^[ \t]*$/.test(lead) ? lead : "";
  const body = `\n${lines.map((l) => indent + l).join("\n")}\n${indent}`;
  return fill(src, new RegExp(open.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")), close, body);
}

export interface SyncResult {
  html: string;
  /** The page carries the redesign's markers (all four). */
  redesigned: boolean;
  /** The page carries SEO:HEAD and no other marker (the 2026 paper page):
   *  only its head is written. */
  headOnly: boolean;
}

/** The page's own markers beside SEO:HEAD, from before the redesign. */
export const BODY_MARKERS = ["<!-- SEO:steps -->", "<!-- SEO:toneSaid -->", "<!-- SEO:toneGrid -->", "<!-- SEO:faq -->", "// SEO:faqCopy"] as const;

/** Write every marker the page has. Pure: the CLI reads and writes files. */
export function syncHome(src: string): SyncResult {
  const present = Object.entries(REDESIGN_MARKERS).filter(([, m]) => src.includes(m)).map(([k]) => k);
  if (present.length && present.length < Object.keys(REDESIGN_MARKERS).length) {
    const missing = Object.entries(REDESIGN_MARKERS).filter(([k]) => !present.includes(k)).map(([, m]) => m);
    throw new Error(`marker not found: ${missing.join(", ")} (the page has ${present.join(", ")}; the redesign's markers come together)`);
  }
  const redesigned = present.length > 0;
  const headOnly = !redesigned && !BODY_MARKERS.some((m) => src.includes(m));

  let html = src;
  html = fill(html, /<!-- SEO:HEAD[\s\S]*?-->\n/, "<!-- /SEO:HEAD -->", `${headHtml(redesigned, !headOnly)}\n`);
  if (headOnly) return { html, redesigned, headOnly };
  html = fill(html, /<!-- SEO:steps -->/, "<!-- /SEO:steps -->", stepsHtml());
  html = fill(html, /<!-- SEO:toneSaid -->/, "<!-- /SEO:toneSaid -->", esc(SITE_UI.tone.said));
  html = fill(html, /<!-- SEO:toneGrid -->/, "<!-- /SEO:toneGrid -->", toneGridHtml());
  html = fill(html, /<!-- SEO:faq -->/, "<!-- /SEO:faq -->", faqHtml());
  html = fill(html, /\/\/ SEO:faqCopy[^\n]*\n/, "    // /SEO:faqCopy", `${faqCopyJs()}\n`);
  if (redesigned) {
    html = fillLines(html, REDESIGN_MARKERS.hero, "<!-- /SEO:hero -->", heroLines());
    html = fillLines(html, REDESIGN_MARKERS.line, "<!-- /SEO:line -->", lineLines());
    html = fillLines(html, REDESIGN_MARKERS.langs, "<!-- /SEO:langs -->", langsLines());
    html = fill(html, /\/\/ SEO:siteCopy[^\n]*\n/, "    // /SEO:siteCopy", `${siteCopyLines().join("\n")}\n`);
  }
  return { html, redesigned, headOnly };
}
