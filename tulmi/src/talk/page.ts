/**
 * THE WHOLE PAGE, MADE SMALL: WHAT A MODEL IS SHOWN OF THE PAGE OR DOCUMENT IN FRONT OF THE PERSON.
 *
 *   readPage(body.page, clean)        the device's page, kept to what it may hold (text cut at PAGE_TEXT_MAX, never refused)
 *   reducePage(page, words, max)      -> { text, parts, cut }: under PAGE_MAX_CHARS, for the voice chat (src/talk) and Ask's first step
 *
 * The desktop reads the whole page or document, not only what is on screen (the accessibility tree, or by scrolling), and sends its
 * outline, its text (already cut to 20,000 characters there) and `where`: a few words of what is on screen now. A model is shown:
 *
 *   1. the outline (its headings), at most a quarter of the cap
 *   2. the part around `where`, when it is found in the text
 *   3. the parts whose words match what the person said, best first, shown in page order
 *   4. with room left and nothing matched, the start of the page
 *
 * A page that fits whole is shown whole. The cap is hard. Pure; the caller fences the text (it is data, written by whoever made the page).
 */

export interface PageText {
  outline?: string[];
  text?: string;
  where?: string;
  source?: "tree" | "scroll" | "none";
}

/** The most of a page's text a device may send; more is cut, not refused (the page is a help, not the ask). */
export const PAGE_TEXT_MAX = 20_000;
/** The most of a page a model is shown. */
export const PAGE_MAX_CHARS = 4_000;
const OUTLINE_MAX = 200;
const OUTLINE_LINE = 120;
const OUTLINE_SHARE = 0.25;
const WHERE_MAX = 300;
/** Around `where`: this much, a quarter of it before. */
const WHERE_CHARS = 1_200;
/** A part of the page, for matching. */
const CHUNK = 500;
const TERMS_MAX = 12;
const SOURCES = new Set(["tree", "scroll", "none"]);

/** Words that say nothing about what a part is about. */
const STOP = new Set(("the and for are but not you all any can had her was one our out has him his how its may new now see two who did get let put say she too use "
  + "what when where which while with this that these those there their them they then than from into about would could should will shall have does doing done "
  + "your yours mine some such only also just very more most much many here page tell show give find read says said want need like know make "
  + "kya hai hain karo kaise kahan kaun mein main bhi aur").split(" "));

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…` : s);
// eslint-disable-next-line no-control-regex
const line = (s: string): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
// eslint-disable-next-line no-control-regex
const block = (s: string): string => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** The page as a body carries it, or null when it carries none. `clean` takes what must not reach a model out of text (a URL's query). */
export function readPage(v: unknown, clean: (s: string) => string = (s) => s): PageText | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const outline = Array.isArray(o.outline)
    ? o.outline.filter((x): x is string => typeof x === "string").map((x) => clip(clean(line(x)), OUTLINE_LINE)).filter(Boolean).slice(0, OUTLINE_MAX)
    : [];
  const text = typeof o.text === "string" ? clean(block(o.text.slice(0, PAGE_TEXT_MAX))) : "";
  const where = typeof o.where === "string" ? clip(line(o.where), WHERE_MAX) : "";
  const source = typeof o.source === "string" && SOURCES.has(o.source) ? (o.source as PageText["source"]) : undefined;
  if (!outline.length && !text) return null;
  return { ...(outline.length ? { outline } : {}), ...(text ? { text } : {}), ...(where ? { where } : {}), ...(source ? { source } : {}) };
}

/** The words of what they said worth matching on: lowercased, three letters or more, none that say nothing, at most TERMS_MAX. */
export function termsOf(words: string): string[] {
  const all = words.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  return [...new Set(all.filter((w) => [...w].length >= 3 && !STOP.has(w)))].slice(0, TERMS_MAX);
}

interface Chunk { at: number; end: number; text: string }

/** The text in parts of about CHUNK characters, cut at paragraph, line or sentence ends where it can be. */
function chunksOf(text: string): Chunk[] {
  const out: Chunk[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + CHUNK);
    if (end < text.length) {
      const span = text.slice(at, end);
      const cut = Math.max(span.lastIndexOf("\n"), span.lastIndexOf(". "), span.lastIndexOf("? "), span.lastIndexOf("! "), span.lastIndexOf("। "));
      if (cut > CHUNK / 3) end = at + cut + 1;
      else { const sp = span.lastIndexOf(" "); if (sp > CHUNK / 3) end = at + sp; }
    }
    const t = text.slice(at, end).trim();
    if (t) out.push({ at, end, text: t });
    at = end;
  }
  return out;
}

/** How well a part matches: each term it has counts, and more uses of it a little more. */
function scoreOf(text: string, terms: readonly string[]): number {
  const low = text.toLowerCase();
  let score = 0;
  for (const t of terms) {
    let n = 0;
    for (let i = low.indexOf(t); i >= 0 && n < 5; i = low.indexOf(t, i + t.length)) n += 1;
    if (n) score += 2 + Math.log2(n);
  }
  return score;
}

/** Where `where` is in the text, by its first words, ignoring case and spacing; -1 when it is not there. */
function findWhere(text: string, where: string): number {
  const probe = line(where).toLowerCase().slice(0, 80);
  if (probe.length < 4) return -1;
  const low = text.toLowerCase().replace(/\s/g, " ");
  const i = low.indexOf(probe);
  if (i >= 0) return i;
  const short = probe.split(" ").slice(0, 5).join(" ");
  return short.length >= 8 ? low.indexOf(short) : -1;
}

export interface ReducedPage {
  /** What the model is shown; empty when there is nothing. */
  text: string;
  parts: { outline: number; where: boolean; matches: number; start: boolean; whole: boolean };
  /** Something of the page was left out. */
  cut: boolean;
}

/** The page under `max` characters: the outline, around `where`, the parts that match `words`, else its start. */
export function reducePage(page: PageText | null | undefined, words: string, max = PAGE_MAX_CHARS): ReducedPage {
  const parts = { outline: 0, where: false, matches: 0, start: false, whole: false };
  if (!page) return { text: "", parts, cut: false };
  const text = page.text ?? "";
  const sections: string[] = [];
  let cut = false;

  // 1. The outline, at most a share of the cap.
  const outline = page.outline ?? [];
  if (outline.length) {
    const room = Math.floor(max * OUTLINE_SHARE);
    const lines: string[] = [];
    let n = "Outline:".length;
    for (const h of outline) {
      if (n + h.length + 3 > room) { cut = true; break; }
      lines.push(`- ${h}`);
      n += h.length + 3;
    }
    if (lines.length) { sections.push(`Outline:\n${lines.join("\n")}`); parts.outline = lines.length; }
  }
  const used = (): number => sections.reduce((n, s) => n + s.length + 1, 0);

  // A page that fits whole is shown whole.
  if (text && used() + text.length + 6 <= max) {
    sections.push(`Text:\n${text}`);
    parts.whole = true;
    return { text: sections.join("\n"), parts, cut };
  }
  if (!text) return { text: clip(sections.join("\n"), max), parts, cut };
  cut = true;

  // 2. Around where they are.
  let near: { at: number; end: number } | null = null;
  const w = page.where ? findWhere(text, page.where) : -1;
  if (w >= 0) {
    const room = Math.min(WHERE_CHARS, max - used() - 40);
    if (room > 200) {
      let at = Math.max(0, w - Math.floor(room / 4));
      let end = Math.min(text.length, at + room);
      at = Math.max(0, Math.min(at, end - room));
      const sp = text.lastIndexOf(" ", at);
      if (at > 0 && sp > at - 40) at = sp + 1;
      const ep = text.indexOf(" ", end);
      if (end < text.length && ep > 0 && ep < end + 40 && ep - at <= room) end = ep;
      near = { at, end };
      sections.push(`Around where they are:\n${at > 0 ? "…" : ""}${text.slice(at, end).trim()}${end < text.length ? "…" : ""}`);
      parts.where = true;
    }
  }

  // 3. The parts that match what they said, best first, shown in page order.
  const terms = termsOf(words);
  const chunks = chunksOf(text).filter((c) => !near || c.end <= near.at || c.at >= near.end);
  const ranked = terms.length
    ? chunks.map((c) => ({ c, s: scoreOf(c.text, terms) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.c.at - b.c.at)
    : [];
  const picked: Chunk[] = [];
  let room = max - used() - "Parts that match what they said:\n".length;
  for (const { c } of ranked) {
    if (c.text.length + 2 > room) continue;
    picked.push(c);
    room -= c.text.length + 2;
  }
  if (picked.length) {
    picked.sort((a, b) => a.at - b.at);
    sections.push(`Parts that match what they said:\n${picked.map((c) => c.text).join("\n…\n")}`);
    parts.matches = picked.length;
  }

  // 4. Nothing matched and nothing found around them: the start of the page.
  if (!picked.length && !near) {
    const left = max - used() - "The start of the page:\n".length - 1;
    if (left > 100) {
      sections.push(`The start of the page:\n${clip(text, left)}`);
      parts.start = true;
    }
  }
  return { text: clip(sections.join("\n"), max), parts, cut };
}
