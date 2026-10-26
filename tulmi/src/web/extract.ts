/**
 * THE PAGE EXTRACTOR: HTML IN, COMPACT MARKDOWN OUT.
 *
 * Pure: a string in, a value out, no network, no clock, no files. The reader
 * (reader.ts) fetches; this decides what the page SAYS. It is ours rather
 * than a library's for two reasons. A page is hostile input that ends up in a
 * model's prompt, so what is dropped matters as much as what is kept. And it
 * has to survive the HTML that is really out there (unclosed tags, stray end
 * tags, quotes that never close, 5,000 nested divs) without throwing.
 *
 * What goes, always:
 *   - script, style, noscript, svg, template, iframe, head, canvas, media,
 *     form controls and buttons, nav (and role=navigation, search, menu);
 *   - header, footer and aside (and role=banner, contentinfo, complementary)
 *     when they are not inside <main> or <article>. A header that holds the
 *     page's heading and is mostly not links stays: plenty of blogs put the
 *     title there;
 *   - cookie and consent banners, found by the words in their id and class;
 *   - HIDDEN ELEMENTS: the hidden attribute, aria-hidden="true", and inline
 *     styles that hide (display:none, visibility:hidden, font-size:0,
 *     opacity:0, and the usual tricks: zero size with overflow hidden, a clip
 *     to nothing, text-indent or position far off screen). Text a person
 *     cannot see is where a page hides instructions for the model that reads
 *     it, so it is never read. The browser engine does the same job on
 *     COMPUTED styles (browser/engine.ts); this is the part that needs no browser;
 *   - zero-width, bidi-control, tag and other invisible characters, from every
 *     piece of text that is returned (stripInvisible). The zero-width joiner
 *     and non-joiner stay only between two non-ASCII characters, where Indic
 *     and Persian scripts and emoji need them;
 *   - comments, and every attribute except the few the rules above read: alt
 *     text, titles, aria-labels and data-* never reach the output.
 *
 * What is kept is the page's content root: <main>, else the largest <article>
 * (unless the page is a feed of many), else [role=main], else the body with its
 * link-heavy blocks (menus, tag clouds, "related" lists) removed. It is written
 * as markdown: # headings, - lists, fenced code with its language and exact
 * whitespace, `inline code`, pipe tables, link text inline (the URLs are
 * collected in `links`: absolute, deduped, 200 at most, http(s) only).
 *
 * needsBrowser: the visible text is under 200 characters AND the page looks
 * like a script-rendered shell (an empty #root, #app or #__next, many script
 * tags, or a <noscript> asking for JavaScript). Before giving up, the page's
 * own data is tried: __NEXT_DATA__, then JSON-LD articleBody and description.
 * That data is NOT shown to a person, so it is only used when there is nothing
 * else, and it goes into the prompt as untrusted like the rest (reader.ts).
 *
 * Other kinds of answer (extractContent): plain text and markdown pass
 * through, JSON is pretty-printed, and a PDF, an image or any other binary
 * is "unsupported_type".
 */
import { WebError } from "./error.js";

export interface Heading {
  /** 1 to 6. */
  level: number;
  /** Plain text, no markdown. */
  text: string;
  /** Where the heading's line starts in `text`. */
  offset: number;
}

export interface PageLink {
  text: string;
  /** Absolute, http or https. */
  url: string;
}

export interface Extracted {
  title: string;
  /** The page's language as it says it (`en`, `hi-IN`), or "" when it does not. */
  lang: string;
  /** The page as compact markdown. */
  text: string;
  headings: Heading[];
  links: PageLink[];
  /** How many fenced code blocks `text` holds. */
  codeBlocks: number;
  canonical?: string;
  /** Little to read here, and it looks like the page needs its scripts run. */
  needsBrowser: boolean;
}

/** Most links kept. */
export const LINKS_MAX = 200;
/** Under this many characters of visible text, a script-rendered shell counts as empty. */
export const THIN_TEXT = 200;
/** More HTML than this is cut off before parsing (the reader's cap is far lower). */
const HTML_MAX = 6_000_000;
/** Elements nested deeper than this are not nested: a hostile page cannot overflow the stack. */
const DEPTH_MAX = 200;
/** A candidate for the content root has to hold at least this much to be taken at its word. */
const ROOT_MIN = 100;

// ---------------------------------------------------------------- characters

/**
 * Characters nobody reads and a page can use to carry text past a person's
 * eyes: soft hyphen, Arabic letter mark, Mongolian vowel separator, zero-width
 * space, left/right marks, the bidi embeddings, overrides and isolates, word
 * joiner and the invisible math operators, the deprecated format characters,
 * Hangul fillers, variation selectors 1 to 15, the BOM, interlinear
 * annotation, and all of plane 14 (the "tag" characters that spell ASCII
 * invisibly). C0 and C1 controls go too, except tab, newline, vertical tab and
 * form feed, which the whitespace rules handle.
 */
/** Code point ranges of INVISIBLE, written as numbers so no invisible character has to sit in this file. */
const INVISIBLE_RANGES: Array<[number, number]> = [
  [0x00, 0x08], [0x0E, 0x1F], [0x7F, 0x9F], [0xAD, 0xAD], [0x61C, 0x61C], [0x180E, 0x180E], [0x200B, 0x200B], [0x200E, 0x200F],
  [0x202A, 0x202E], [0x2060, 0x2064], [0x2066, 0x206F], [0x3164, 0x3164], [0xFE00, 0xFE0E], [0xFEFF, 0xFEFF], [0xFFA0, 0xFFA0],
  [0xFFF9, 0xFFFB],
];
const hex4 = (n: number): string => "\\u" + n.toString(16).toUpperCase().padStart(4, "0");
const INVISIBLE = new RegExp(
  "[" + INVISIBLE_RANGES.map(([a, b]) => (a === b ? hex4(a) : `${hex4(a)}-${hex4(b)}`)).join("") + "]|" + hex4(0xDB40) + "[" + hex4(0xDC00) + "-" + hex4(0xDFFF) + "]",
  "g",
);
const LINE_SEPARATORS = new RegExp("[" + hex4(0x2028) + hex4(0x2029) + "]", "g");
const JOINERS = new RegExp("[" + hex4(0x200C) + hex4(0x200D) + "]", "g");

/** `s` without invisible characters. See INVISIBLE; ZWJ and ZWNJ survive only between two non-ASCII characters. */
export function stripInvisible(s: string): string {
  let out = s.replace(LINE_SEPARATORS, "\n").replace(INVISIBLE, "");
  if (JOINERS.test(out)) {
    JOINERS.lastIndex = 0;
    out = out.replace(JOINERS, (m, at: number, all: string) => (all.charCodeAt(at - 1) > 127 && all.charCodeAt(at + 1) > 127 ? m : ""));
  }
  return out;
}

// ------------------------------------------------------------------ entities

/** &nbsp; to &yuml;, which are U+00A0 to U+00FF in order. */
const LATIN1 = ("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para " +
  "middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
  "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave " +
  "aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde " +
  "ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml").split(" ");
const GREEK_UP = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho".split(" "); // U+0391..
const GREEK_UP2 = "Sigma Tau Upsilon Phi Chi Psi Omega".split(" "); // U+03A3..
const GREEK_LOW = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega".split(" "); // U+03B1..

const OTHER_ENTITIES: Record<string, number> = {
  amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, num: 35, excl: 33, dollar: 36, percnt: 37, lpar: 40, rpar: 41, ast: 42, plus: 43,
  comma: 44, period: 46, sol: 47, colon: 58, semi: 59, equals: 61, quest: 63, commat: 64, lsqb: 91, lbrack: 91, bsol: 92, rsqb: 93,
  rbrack: 93, lowbar: 95, grave: 96, lcub: 123, lbrace: 123, verbar: 124, vert: 124, rcub: 125, rbrace: 125, hyphen: 8208, dash: 8208,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732, thetasym: 977, upsih: 978, piv: 982,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, ndash: 8211, mdash: 8212, lsquo: 8216,
  rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240,
  prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364, trade: 8482, alefsym: 8501,
  larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, crarr: 8629, lArr: 8656, uArr: 8657, rArr: 8658, dArr: 8659, hArr: 8660,
  forall: 8704, part: 8706, exist: 8707, empty: 8709, nabla: 8711, isin: 8712, notin: 8713, ni: 8715, prod: 8719, sum: 8721, minus: 8722,
  lowast: 8727, radic: 8730, prop: 8733, infin: 8734, ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756,
  sim: 8764, cong: 8773, asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, nsub: 8836, sube: 8838,
  supe: 8839, oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901, lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971,
  lang: 10216, rang: 10217, loz: 9674, star: 9734, starf: 9733, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830,
  check: 10003, checkmark: 10003, cross: 10007,
};

const NAMED = new Map<string, number>();
LATIN1.forEach((n, i) => NAMED.set(n, 160 + i));
GREEK_UP.forEach((n, i) => NAMED.set(n, 913 + i));
GREEK_UP2.forEach((n, i) => NAMED.set(n, 931 + i));
GREEK_LOW.forEach((n, i) => NAMED.set(n, 945 + i));
for (const [n, cp] of Object.entries(OTHER_ENTITIES)) NAMED.set(n, cp);

/** The few a browser also reads without the closing semicolon. */
const LEGACY = ["nbsp", "copy", "quot", "amp", "reg", "lt", "gt"];

/** What a browser shows for &#128; to &#159;: the Windows-1252 letters, not the control characters. */
const CP1252 = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];

function fromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return String.fromCharCode(0xFFFD);
  if (cp >= 0x80 && cp <= 0x9F) return String.fromCodePoint(CP1252[cp - 0x80]!);
  return String.fromCodePoint(cp);
}

/** HTML character references (named, decimal, hex) as text. What is not a reference is left as it is. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,8})|([A-Za-z][A-Za-z0-9]{1,31}));?/g, (m, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return fromCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
    const semi = m.endsWith(";");
    const cp = NAMED.get(name!);
    if (cp !== undefined && (semi || LEGACY.includes(name!))) return String.fromCodePoint(cp);
    if (!semi) {
      // "&copy2024": the legacy name, then the rest as it was.
      const legacy = LEGACY.find((l) => name!.startsWith(l));
      if (legacy) return String.fromCodePoint(NAMED.get(legacy)!) + name!.slice(legacy.length);
    }
    return m;
  });
}

// ------------------------------------------------------------- the HTML tree

type Attrs = Record<string, string>;

interface El {
  k: 1;
  name: string;
  attrs: Attrs;
  parent: El | null;
  kids: HNode[];
  /** The text of a raw-text element (script, style, title, noscript, ...), when a rule needs it. */
  raw?: string;
  /** Dropped: never rendered, never counted. */
  dead?: boolean;
  /** Characters of text inside it (live nodes only, whitespace not counted). */
  len: number;
  /** Characters of that text which are inside a link. */
  linkLen: number;
  /** Links inside it. */
  links: number;
  /** A heading is inside it. */
  hasH: boolean;
  /** A block-level element is inside it. */
  blk: boolean;
}
interface Tx { k: 0; t: string }
type HNode = El | Tx;

/** The only attributes kept. Everything else is dropped as the tag is read. */
const KEEP_ATTRS = new Set([
  "id", "class", "style", "hidden", "aria-hidden", "aria-label", "role", "href", "lang", "xml:lang", "type", "rel", "charset",
  "content", "name", "property", "http-equiv", "open", "data-lang", "data-language",
]);

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Their content is text, up to the matching end tag. */
const RAW = new Set(["script", "style", "textarea", "title", "noscript", "iframe", "xmp", "noembed", "noframes"]);

/** What can sit in <head> without ending it. */
const HEAD_TAGS = new Set(["title", "meta", "link", "script", "style", "base", "noscript", "template"]);

/** Not inline: they start a new block. Anything else (and any unknown or custom tag) is inline. */
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "center", "dd", "details", "dialog", "dir", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html", "legend",
  "li", "main", "menu", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/** An open <p> ends when one of these starts. */
const P_CLOSERS = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
  "li", "dd", "dt",
]);

/** Never part of what a person reads. */
const ALWAYS_DROP = new Set([
  "script", "style", "noscript", "svg", "template", "iframe", "head", "title", "meta", "link", "base", "canvas", "object", "embed",
  "audio", "video", "map", "area", "img", "picture", "source", "track", "param", "input", "button", "select", "textarea", "option",
  "optgroup", "datalist", "output", "progress", "meter", "nav", "xmp", "noembed", "noframes", "math",
]);

/** Landmark roles dropped wherever they are. */
const ROLE_DROP = new Set(["navigation", "search", "menu", "menubar", "toolbar", "tablist"]);

/** Facts the tokenizer finds on the way, for the rules below. */
interface Facts {
  title: string;
  ogTitle: string;
  lang: string;
  canonical: string;
  base: string;
  scripts: number;
  noscript: string;
  jsonLd: string[];
  nextData: string;
  body: El | null;
}

const mk = (name: string, attrs: Attrs): El => ({ k: 1, name, attrs, parent: null, kids: [], len: 0, linkLen: 0, links: 0, hasH: false, blk: false });

const isSpace = (c: number): boolean => c === 32 || c === 10 || c === 9 || c === 13 || c === 12;
const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

const rawEnds = new Map<string, RegExp>();
function rawEnd(name: string): RegExp {
  let re = rawEnds.get(name);
  if (!re) { re = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi"); rawEnds.set(name, re); }
  return re;
}

/**
 * HTML to a tree, the way a browser would make one for the cases that matter
 * here and without ever failing for the ones that do not: unclosed <p> and
 * <li>, a missing </head>, stray end tags (ignored), end tags for something
 * never opened, an attribute quote that never closes (the value runs to the
 * next >), a tag cut off by the end of the file (dropped), and nesting so deep
 * it would overflow the stack (past DEPTH_MAX, new elements are not nested).
 */
function parse(html: string, facts: Facts): El {
  const root = mk("#root", Object.create(null) as Attrs);
  const stack: El[] = [root];
  const ignored: Record<string, number> = Object.create(null);
  const n = html.length;
  let inHead = false;

  const top = (): El => stack[stack.length - 1]!;
  const push = (e: El) => { stack.push(e); if (e.name === "head") inHead = true; };
  const pop = () => { const e = stack.pop()!; if (e.name === "head") inHead = false; };
  const popTo = (i: number) => { while (stack.length > i) pop(); };

  /** Closes the nearest of `targets` open now, going up only through what may sit inside one. */
  const closeScan = (targets: string[], passes: (name: string) => boolean) => {
    for (let i = stack.length - 1; i >= 1; i--) {
      const name = stack[i]!.name;
      if (targets.includes(name)) { popTo(i); return; }
      if (!passes(name)) return;
    }
  };
  const inlineOrDiv = (name: string) => !BLOCK.has(name) || name === "div" || name === "p" || name === "address";

  const text = (t: string) => {
    const e = top();
    const s = decodeEntities(t);
    if (!s) return;
    const last = e.kids[e.kids.length - 1];
    if (last && last.k === 0) last.t += s;
    else e.kids.push({ k: 0, t: s });
  };

  const note = (e: El) => {
    const a = e.attrs;
    switch (e.name) {
      case "html": if (!facts.lang) facts.lang = a.lang ?? a["xml:lang"] ?? ""; break;
      case "body": if (!facts.body) facts.body = e; break;
      case "title": if (!facts.title && !stack.some((s) => s.name === "svg")) facts.title = decodeEntities(e.raw ?? ""); break;
      case "base": if (!facts.base && a.href) facts.base = a.href; break;
      case "link": if (!facts.canonical && a.href && /(^|\s)canonical(\s|$)/i.test(a.rel ?? "")) facts.canonical = a.href; break;
      case "meta": {
        const key = (a.property ?? a.name ?? "").toLowerCase();
        if (key === "og:title" && !facts.ogTitle) facts.ogTitle = a.content ?? "";
        if ((a["http-equiv"] ?? "").toLowerCase() === "content-language" && !facts.lang) facts.lang = a.content ?? "";
        break;
      }
      case "script": {
        facts.scripts += 1;
        const type = (a.type ?? "").toLowerCase();
        if (e.raw && type.includes("ld+json") && facts.jsonLd.length < 20) facts.jsonLd.push(e.raw);
        else if (e.raw && a.id === "__NEXT_DATA__" && !facts.nextData) facts.nextData = e.raw;
        break;
      }
      case "noscript": if (facts.noscript.length < 4000) facts.noscript += ` ${e.raw ?? ""}`.slice(0, 2000); break;
    }
  };

  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { text(html.slice(i)); break; }
    if (lt > i) text(html.slice(i, lt));
    i = lt;
    const c = html.charCodeAt(i + 1);

    if (c === 33) { // <!
      if (html.startsWith("<!--", i)) {
        const end = html.startsWith("<!-->", i) ? i + 2 : html.indexOf("-->", i + 4);
        i = end < 0 ? n : end + 3;
      } else if (html.startsWith("<![CDATA[", i)) {
        const end = html.indexOf("]]>", i + 9);
        text(html.slice(i + 9, end < 0 ? n : end));
        i = end < 0 ? n : end + 3;
      } else {
        const end = html.indexOf(">", i + 2);
        i = end < 0 ? n : end + 1;
      }
      continue;
    }
    if (c === 63) { // <?
      const end = html.indexOf(">", i + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }

    if (c === 47) { // </
      if (!isLetter(html.charCodeAt(i + 2))) {
        const end = html.indexOf(">", i + 2);
        i = end < 0 ? n : end + 1;
        continue;
      }
      let j = i + 2;
      while (j < n) { const d = html.charCodeAt(j); if (isSpace(d) || d === 47 || d === 62) break; j++; }
      const name = html.slice(i + 2, j).toLowerCase();
      const end = html.indexOf(">", j);
      i = end < 0 ? n : end + 1;
      if (ignored[name]) { ignored[name]! -= 1; continue; }
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s]!.name === name) { popTo(s); break; }
      }
      continue;
    }

    if (!isLetter(c)) { text("<"); i += 1; continue; }

    // A start tag.
    let j = i + 1;
    while (j < n) { const d = html.charCodeAt(j); if (isSpace(d) || d === 47 || d === 62) break; j++; }
    const name = html.slice(i + 1, j).toLowerCase();
    const attrs: Attrs = Object.create(null);
    let selfClose = false;
    let closed = false;
    while (j < n) {
      let d = html.charCodeAt(j);
      if (isSpace(d)) { j++; continue; }
      if (d === 47) { if (html.charCodeAt(j + 1) === 62) selfClose = true; j++; continue; }
      if (d === 62) { j++; closed = true; break; }
      const as = j;
      j++; // a name takes at least one character, so an '=' that starts one cannot stall the loop
      while (j < n) { d = html.charCodeAt(j); if (isSpace(d) || d === 61 || d === 62 || d === 47) break; j++; }
      const an = html.slice(as, j).toLowerCase();
      while (j < n && isSpace(html.charCodeAt(j))) j++;
      let val = "";
      if (html.charCodeAt(j) === 61) {
        j++;
        while (j < n && isSpace(html.charCodeAt(j))) j++;
        const q = html.charCodeAt(j);
        if (q === 34 || q === 39) {
          const e = html.indexOf(q === 34 ? "\"" : "'", j + 1);
          if (e < 0) { // the quote never closes: the value runs to the end of the tag
            const gt = html.indexOf(">", j + 1);
            val = html.slice(j + 1, gt < 0 ? n : gt);
            j = gt < 0 ? n : gt;
          } else { val = html.slice(j + 1, e); j = e + 1; }
        } else {
          const vs = j;
          while (j < n) { d = html.charCodeAt(j); if (isSpace(d) || d === 62) break; j++; }
          val = html.slice(vs, j);
        }
      }
      if (KEEP_ATTRS.has(an) && !(an in attrs)) attrs[an] = decodeEntities(val);
    }
    if (!closed) { i = n; break; } // cut off by the end of the file
    i = j;

    // The head ends at the first thing that does not belong in it.
    if (inHead && !HEAD_TAGS.has(name)) {
      const h = stack.findIndex((e) => e.name === "head");
      if (h > 0) popTo(h);
    }
    if ((name === "html" || name === "body") && stack.some((e) => e.name === name)) continue;

    const el = mk(name, attrs);

    if (RAW.has(name) && !selfClose) {
      const re = rawEnd(name);
      re.lastIndex = i;
      const m = re.exec(html);
      const stop = m ? m.index : n;
      const wanted = name === "title" || name === "noscript" || (name === "script" && (/ld\+json/i.test(attrs.type ?? "") || attrs.id === "__NEXT_DATA__"));
      if (wanted) el.raw = html.slice(i, Math.min(stop, i + 3_000_000));
      const gt = m ? html.indexOf(">", stop) : -1;
      i = gt < 0 ? n : gt + 1;
      note(el);
      el.parent = top();
      top().kids.push(el);
      continue;
    }

    // Implied end tags.
    if (P_CLOSERS.has(name) && top().name === "p") pop();
    switch (name) {
      case "li": closeScan(["li"], inlineOrDiv); break;
      case "dt": case "dd": closeScan(["dt", "dd"], inlineOrDiv); break;
      case "tr": closeScan(["tr"], (nm) => inlineOrDiv(nm) || nm === "td" || nm === "th"); break;
      case "td": case "th": closeScan(["td", "th"], inlineOrDiv); break;
      case "thead": case "tbody": case "tfoot":
        closeScan(["thead", "tbody", "tfoot"], (nm) => inlineOrDiv(nm) || nm === "tr" || nm === "td" || nm === "th"); break;
    }

    note(el);
    el.parent = top();
    top().kids.push(el);
    if (VOID.has(name) || (selfClose && !BLOCK.has(name))) continue;
    if (stack.length >= DEPTH_MAX) { ignored[name] = (ignored[name] ?? 0) + 1; continue; }
    push(el);
  }
  return root;
}

// ------------------------------------------------------------ hidden, banners

/** CSS escapes and comments undone, so `display:\6e one` and `dis/**\/play:none` read as they render. */
function cssPlain(style: string): string {
  return style
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h: string) => { const cp = parseInt(h, 16); return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : ""; })
    .replace(/\\(.)/g, "$1");
}

const ZERO = /^[+-]?0*\.?0+(?:[a-z%]+)?$/;
const FAR = /^-\s*(?:[1-9]\d{3,}|\d{2,}\.\d+)(?:px|em|rem|vw|vh|%)?$/;

/** Whether an inline style hides the element from anyone looking at the page. */
export function hiddenByStyle(style: string): boolean {
  const p: Record<string, string> = Object.create(null);
  for (const decl of cssPlain(style).split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    p[decl.slice(0, at).trim().toLowerCase()] = decl.slice(at + 1).replace(/!\s*important/i, "").trim().toLowerCase();
  }
  if (p.display === "none") return true;
  if (p.visibility === "hidden" || p.visibility === "collapse") return true;
  if (p["font-size"] !== undefined && ZERO.test(p["font-size"])) return true;
  if (p.opacity !== undefined && ZERO.test(p.opacity)) return true;
  const clips = /^(hidden|clip)$/;
  const overflowHidden = clips.test(p.overflow ?? "") || clips.test(p["overflow-x"] ?? "") || clips.test(p["overflow-y"] ?? "");
  if (overflowHidden && [p.width, p.height, p["max-width"], p["max-height"]].some((v) => v !== undefined && ZERO.test(v))) return true;
  if (p.clip !== undefined && /^rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)$/.test(p.clip)) return true;
  if (p["clip-path"] !== undefined && /^inset\(\s*(?:100|50)%\s*\)$/.test(p["clip-path"])) return true;
  if (p["text-indent"] !== undefined && FAR.test(p["text-indent"])) return true;
  if ((p.position === "absolute" || p.position === "fixed") && [p.left, p.top, p.right, p.bottom].some((v) => v !== undefined && FAR.test(v))) return true;
  if (p.transform !== undefined && /scale\(\s*0\s*\)/.test(p.transform)) return true;
  return false;
}

const CONSENT = new RegExp([
  "onetrust", "cookiebot", "cookieconsent", "cookie-?law", "cookie-?(banner|notice|popup|modal|bar|wall|consent|manager|settings|preferences|disclaimer)",
  "cc-(window|banner|grower|revoke)", "didomi", "truste", "osano", "iubenda", "termly", "qc-cmp", "sp[_-]message", "cmp-?(container|banner|modal|wrapper)",
  "gdpr-?(banner|notice|popup|consent|bar|modal|cookie)", "consent-?(banner|manager|modal|popup|dialog|bar|notice|prompt|overlay|wall|container)",
  "privacy-?(banner|notice|popup|bar)", "evidon", "usercentrics", "klaro", "quantcast", "trustarc", "borlabs-cookie", "cky-consent",
  "moove-gdpr", "complianz", "cookiefirst", "cookie_?(bar|banner|notice|consent|law)",
].join("|"), "i");

/** A cookie or consent banner, by the words in its id, class or label. */
function looksLikeConsent(e: El): boolean {
  const a = e.attrs;
  const s = `${a.id ?? ""} ${a.class ?? ""} ${a["aria-label"] ?? ""}`;
  if (!s.trim()) return false;
  if (CONSENT.test(s)) return true;
  const role = (a.role ?? "").toLowerCase();
  return (role === "dialog" || role === "alertdialog") && /cookie|consent|gdpr/i.test(s);
}

/** Line-number gutters of code listings: never code. (`line-numbers` on the <pre> itself is only Prism's switch.) */
const GUTTER = new Set(["linenos", "lineno", "linenumber", "line-number", "line-numbers-rows", "rouge-gutter", "gutter", "blob-num", "hljs-ln-numbers", "hljs-ln-n"]);
const isGutter = (e: El): boolean => !!e.attrs.class && e.attrs.class.toLowerCase().split(/\s+/).some((t) => GUTTER.has(t));

function hardDead(e: El): boolean {
  const a = e.attrs;
  if (ALWAYS_DROP.has(e.name)) return true;
  if ("hidden" in a) return true;
  if ((a["aria-hidden"] ?? "").trim().toLowerCase() === "true") return true;
  if (a.style && hiddenByStyle(a.style)) return true;
  if (e.name === "dialog" && !("open" in a)) return true;
  const role = (a.role ?? "").trim().toLowerCase();
  if (role && ROLE_DROP.has(role)) return true;
  return isGutter(e);
}

// ------------------------------------------------------------------- measure

interface Collect {
  mains: El[];
  articles: Array<{ el: El; nested: boolean }>;
  roleMain: El[];
  /** Length of the text in each #root, #app, #__next, #__nuxt or <app-root>. */
  shells: number[];
}

const SHELL_IDS = new Set(["root", "app", "__next", "__nuxt", "___gatsby"]);

/** Characters that are not whitespace: how much a page says, ignoring how it is laid out. */
function inkLen(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c > 32 && c !== 0xA0) n++; }
  return n;
}

/**
 * Walks the tree once, bottom up: decides what is dropped and measures what is
 * left (text, link text, links, headings). A node is dead if it is dropped
 * or sits under one that is, and dead nodes add nothing to their parents.
 * `inMain`: inside <main>, <article> or [role=main], where header, footer and
 * aside are part of the content.
 */
function visit(e: El, inMain: boolean, inArticle: boolean, c: Collect): void {
  if (hardDead(e)) { e.dead = true; return; }
  const name = e.name;
  const role = (e.attrs.role ?? "").toLowerCase();
  const isMain = name === "main" || role === "main";
  const isArticle = name === "article";
  const within = inMain || isMain || isArticle;
  let len = 0, linkLen = 0, links = 0, hasH = false, blk = false;
  for (const k of e.kids) {
    if (k.k === 0) { len += inkLen(k.t); continue; }
    visit(k, within, inArticle || isArticle, c);
    if (k.dead) continue;
    len += k.len; linkLen += k.linkLen; links += k.links;
    if (k.hasH || /^h[1-6]$/.test(k.name)) hasH = true;
    if (k.blk || BLOCK.has(k.name)) blk = true;
  }
  if (name === "a" && e.attrs.href !== undefined) { linkLen = len; links = 1; }
  e.len = len; e.linkLen = linkLen; e.links = links; e.hasH = hasH; e.blk = blk;

  // Dropped for what they turned out to hold, or for where they are.
  const chrome = !inMain && (name === "footer" || name === "aside" || role === "contentinfo" || role === "complementary");
  const banner = !inMain && (name === "header" || role === "banner");
  if (chrome) e.dead = true;
  else if (banner && !(hasH && len > 0 && linkLen / len < 0.5)) e.dead = true;
  else if (!isMain && !isArticle && name !== "body" && name !== "html" && len <= 3000 && looksLikeConsent(e)) e.dead = true;
  if (e.dead) return;

  if (isMain) (name === "main" ? c.mains : c.roleMain).push(e);
  if (isArticle) c.articles.push({ el: e, nested: inArticle });
  if (SHELL_IDS.has(e.attrs.id ?? "") || name === "app-root") c.shells.push(len);
}

const PRUNABLE = new Set(["div", "section", "ul", "ol", "dl", "table", "p", "form", "center"]);

/** Mostly links: a menu, a tag cloud, a list of related pages. */
function linkHeavy(e: El): boolean {
  if (e.len === 0) return false;
  const share = e.linkLen / e.len;
  return (e.links >= 3 && share > 0.6) || (e.links >= 2 && share >= 0.9 && e.len < 150);
}

/**
 * The body with its link-heavy blocks taken out. If that would take out nearly
 * everything (a page that IS a list of links), nothing is taken out.
 */
function pruneLinkHeavy(root: El): void {
  const cut: El[] = [];
  let removed = 0;
  const go = (e: El) => {
    for (const k of e.kids) {
      if (k.k === 0 || k.dead) continue;
      if (PRUNABLE.has(k.name) && linkHeavy(k)) { k.dead = true; cut.push(k); removed += k.len; continue; }
      go(k);
    }
  };
  go(root);
  if (root.len >= THIN_TEXT && root.len - removed < root.len * 0.2) for (const k of cut) k.dead = false;
}

/** The element whose contents are the page. */
function contentRoot(body: El, c: Collect): { el: El; prune: boolean } {
  const biggest = (els: El[]) => els.reduce<El | null>((best, e) => (!best || e.len > best.len ? e : best), null);
  const candidates: El[] = [];
  const main = biggest(c.mains);
  if (main) candidates.push(main);

  // One article is the page. Many of similar size is a feed or an index, which is the body's business.
  const tops = c.articles.filter((a) => !a.nested).map((a) => a.el);
  const article = biggest(tops);
  const feed = tops.length >= 3 && article !== null && article.len < 0.5 * tops.reduce((n, a) => n + a.len, 0);
  if (article && !feed) candidates.push(article);

  const role = biggest(c.roleMain);
  if (role) candidates.push(role);

  const enough = candidates.find((e) => e.len >= ROOT_MIN);
  if (enough) return { el: enough, prune: false };
  // Nothing claims enough. A short page is still the best of what is there; a long body is the page.
  const best = biggest(candidates);
  if (best && body.len < ROOT_MIN) return { el: best, prune: false };
  return { el: body, prune: true };
}

// -------------------------------------------------------------- markdown out

interface Block {
  text: string;
  h?: { level: number; text: string };
}

interface Ctx {
  /** At the top of the page, where a heading is a heading: not inside a list, a quote or a table. */
  top: boolean;
  base: URL | null;
  links: Map<string, PageLink>;
  code: { n: number };
}

/** All whitespace, newlines included, as one space. */
const squash = (t: string): string => t.replace(/\s+/g, " ");

/** Pieces of inline text (with "\n" only where a <br> was) as one tidy line or lines. */
function tidy(parts: string[]): string {
  return parts.join("").replace(/ {2,}/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function codeSpan(t: string): string {
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  // Markdown wants a space inside the fence only when the code itself starts or ends with a backtick.
  return t.startsWith("`") || t.endsWith("`") ? `${fence} ${t} ${fence}` : `${fence}${t}${fence}`;
}

/** All the text inside an element, markup ignored (live nodes only). */
function textOf(e: El, out: string[] = []): string {
  for (const k of e.kids) {
    if (k.k === 0) out.push(k.t);
    else if (!k.dead) {
      const apart = k.name === "br" || BLOCK.has(k.name);
      if (apart) out.push(" ");
      textOf(k, out);
      if (apart) out.push(" ");
    }
  }
  return out.join("");
}

const ANCHOR_MARK = /^[#¶§🔗∞¤\s]+$/u;

function addLink(el: El, md: string, ctx: Ctx): void {
  const href = (el.attrs.href ?? "").trim();
  if (!href || href.startsWith("#") || ctx.links.size >= LINKS_MAX) return;
  const text = stripInvisible(md.replace(/`/g, "")).replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text) return;
  let u: URL;
  try { u = new URL(href, ctx.base ?? undefined); } catch { return; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return;
  u.username = ""; u.password = "";
  const url = u.href;
  if (url.length > 2048 || ctx.links.has(url)) return;
  ctx.links.set(url, { text, url });
}

/** Inline content: text, code, links, <br>. Block elements met in here are flattened with spaces round them. */
function inlineKids(kids: HNode[], buf: string[], ctx: Ctx): void {
  for (const k of kids) {
    if (k.k === 0) buf.push(squash(k.t));
    else if (!k.dead) inline(k, buf, ctx);
  }
}

function inline(el: El, buf: string[], ctx: Ctx): void {
  switch (el.name) {
    case "br": buf.push("\n"); return;
    case "wbr": return;
    case "code": case "kbd": case "samp": case "tt": {
      const t = squash(textOf(el)).trim();
      if (t) buf.push(codeSpan(t));
      return;
    }
    case "a": {
      const sub: string[] = [];
      inlineKids(el.kids, sub, ctx);
      const md = tidy(sub);
      // A heading's permalink mark (a pilcrow, a #) is chrome, not text.
      if (ANCHOR_MARK.test(md)) return;
      buf.push(...sub);
      addLink(el, md, ctx);
      return;
    }
    case "pre": { buf.push(" ", squash(textOf(el)), " "); return; }
  }
  if (BLOCK.has(el.name)) { buf.push(" "); inlineKids(el.kids, buf, ctx); buf.push(" "); return; }
  inlineKids(el.kids, buf, ctx);
}

/** The text of a line (heading, table cell) on one line, markup as in a paragraph. */
function oneLine(kids: HNode[], ctx: Ctx): string {
  const sub: string[] = [];
  inlineKids(kids, sub, ctx);
  return tidy(sub).replace(/\n/g, " ");
}

/** Contents of a <pre>: exact whitespace, <br> as a newline, one line per block child, gutters left out. */
function preText(el: El, out: string[]): void {
  const endsLine = () => out.length === 0 || out[out.length - 1]!.endsWith("\n");
  for (const k of el.kids) {
    if (k.k === 0) { out.push(k.t); continue; }
    if (k.dead) continue;
    if (k.name === "br") { out.push("\n"); continue; }
    const lineWise = k.name === "div" || k.name === "p" || k.name === "li" || k.name === "tr";
    if (lineWise && !endsLine()) out.push("\n");
    preText(k, out);
    if (lineWise && !endsLine()) out.push("\n");
  }
}

const LANG_CLASS = /(?:^|\s)(?:language|lang|highlight)-([A-Za-z0-9_+#.-]{1,30})(?=\s|$)/;

/** The language of a code listing from the class names the highlighters use, on the <pre>, its <code>, or the wrapper around it. */
function codeLang(pre: El): string {
  const code = pre.kids.find((k): k is El => k.k === 1 && k.name === "code");
  // Sphinx and VuePress put it on the <div> round the <pre>, sometimes two deep.
  const chain: Array<El | null | undefined> = [pre, code, pre.parent, pre.parent?.parent, pre.parent?.parent?.parent];
  for (const e of chain) {
    if (!e || e.name === "#root" || e.name === "body" || e.name === "html") continue;
    const named = e.attrs["data-lang"] ?? e.attrs["data-language"];
    if (named && /^[A-Za-z0-9_+#.-]{1,30}$/.test(named)) return named.toLowerCase();
    const m = LANG_CLASS.exec(e.attrs.class ?? "");
    if (m) {
      const lang = m[1]!.toLowerCase().replace(/^source-/, "");
      if (lang !== "default" && lang !== "none" && lang !== "notranslate") return lang;
    }
  }
  return "";
}

function codeBlock(el: El, ctx: Ctx, out: Block[]): void {
  const parts: string[] = [];
  preText(el, parts);
  let t = stripInvisible(parts.join("").replace(/\r\n?/g, "\n"));
  if (t.startsWith("\n")) t = t.slice(1); // a browser drops the first newline of a <pre>
  t = t.replace(/\s+$/, "");
  if (!t.trim()) return;
  const longest = Math.max(2, ...(t.match(/`{3,}/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  ctx.code.n += 1;
  out.push({ text: `${fence}${codeLang(el)}\n${t}\n${fence}` });
}

function list(el: El, ctx: Ctx, out: Block[]): void {
  const ordered = el.name === "ol";
  const inner: Ctx = { ...ctx, top: false };
  const items: string[] = [];
  let n = 0;
  const item = (kids: HNode[]) => {
    const sub: Block[] = [];
    flow(kids, inner, sub);
    if (!sub.length) return;
    n += 1;
    const marker = ordered ? `${n}. ` : "- ";
    const pad = " ".repeat(marker.length);
    const lines: string[] = [];
    sub.forEach((b, bi) => b.text.split("\n").forEach((ln, li) => lines.push((bi === 0 && li === 0 ? marker : pad) + ln)));
    items.push(lines.join("\n"));
  };
  for (const k of el.kids) {
    if (k.k === 0) { if (inkLen(k.t)) item([k]); continue; }
    if (k.dead) continue;
    if (k.name === "li") item(k.kids);
    else if ((k.name === "ul" || k.name === "ol") && items.length) {
      // A list nested straight inside a list belongs to the item before it.
      const sub: Block[] = [];
      list(k, inner, sub);
      if (sub.length) items[items.length - 1] += "\n" + sub[0]!.text.split("\n").map((l) => "  " + l).join("\n");
    } else item([k]);
  }
  if (items.length) out.push({ text: items.join("\n") });
}

function table(el: El, ctx: Ctx, out: Block[]): void {
  const rows: El[] = [];
  const captions: El[] = [];
  const collect = (e: El) => {
    for (const k of e.kids) {
      if (k.k === 0 || k.dead) continue;
      if (k.name === "tr") rows.push(k);
      else if (k.name === "thead" || k.name === "tbody" || k.name === "tfoot") collect(k);
      else if (k.name === "caption") captions.push(k);
    }
  };
  collect(el);
  const cells = rows.map((r) => r.kids.filter((c): c is El => c.k === 1 && !c.dead && (c.name === "td" || c.name === "th")));
  const cols = Math.max(0, ...cells.map((r) => r.length));
  const all = cells.flat();
  const hasTh = all.some((c) => c.name === "th");
  const hasTable = (e: El): boolean => e.kids.some((k) => k.k === 1 && !k.dead && (k.name === "table" || hasTable(k)));
  const nested = all.some(hasTable);
  const avg = all.length ? all.reduce((s, c) => s + c.len, 0) / all.length : 0;
  const data = cols >= 2 && !nested && avg <= 300 && (rows.length >= 2 || hasTh);

  if (!data) { flow(el.kids, ctx, out); return; }

  const flat: Ctx = { ...ctx, top: false };
  if (captions[0]) { const t = oneLine(captions[0].kids, flat); if (t) out.push({ text: t }); }
  const lines = cells
    .map((r) => r.map((c) => oneLine(c.kids, flat).replace(/\|/g, "\\|")))
    .filter((r) => r.some(Boolean));
  if (lines.length < 1) return;
  const row = (r: string[]) => "| " + Array.from({ length: cols }, (_, i) => r[i] ?? "").join(" | ") + " |";
  out.push({ text: [row(lines[0]!), "| " + Array(cols).fill("---").join(" | ") + " |", ...lines.slice(1).map(row)].join("\n") });
}

/** One block-level element, into blocks. */
function block(el: El, ctx: Ctx, out: Block[]): void {
  switch (el.name) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      const level = Number(el.name[1]);
      const md = oneLine(el.kids, ctx);
      if (!md) return;
      if (ctx.top) out.push({ text: `${"#".repeat(level)} ${md}`, h: { level, text: md.replace(/`/g, "").slice(0, 300) } });
      else out.push({ text: md });
      return;
    }
    case "ul": case "ol": case "menu": case "dir": list(el, ctx, out); return;
    case "pre": codeBlock(el, ctx, out); return;
    case "table": table(el, ctx, out); return;
    case "hr": out.push({ text: "---" }); return;
    case "blockquote": {
      const sub: Block[] = [];
      flow(el.kids, { ...ctx, top: false }, sub);
      if (sub.length) out.push({ text: sub.map((b) => b.text).join("\n\n").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") });
      return;
    }
    case "a": { // a link around blocks (a clickable card): its text is the card's text
      const text = tidy([squash(textOf(el))]);
      if (text) addLink(el, text, ctx);
      break;
    }
  }
  flow(el.kids, ctx, out);
}

/** Children as blocks: runs of inline content become paragraphs, block elements render themselves. */
function flow(kids: HNode[], ctx: Ctx, out: Block[]): void {
  const buf: string[] = [];
  const flush = () => {
    const t = tidy(buf);
    buf.length = 0;
    if (t) out.push({ text: t });
  };
  for (const k of kids) {
    if (k.k === 0) { buf.push(squash(k.t)); continue; }
    if (k.dead) continue;
    if (BLOCK.has(k.name) || k.blk) { flush(); block(k, ctx, out); continue; }
    inline(k, buf, ctx);
  }
  flush();
}

// -------------------------------------------------- the page's own data (JSON)

function tagsOut(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** JSON-LD: articleBody wherever it is, else description. */
function jsonLdText(raws: string[]): string[] {
  const bodies: string[] = [];
  const descriptions: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v.slice(0, 200)) walk(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.articleBody === "string") bodies.push(o.articleBody);
    if (typeof o.description === "string") descriptions.push(o.description);
    for (const x of Object.values(o)) if (x && typeof x === "object") walk(x, depth + 1);
  };
  for (const raw of raws) { try { walk(JSON.parse(raw), 0); } catch { /* broken JSON-LD is common */ } }
  const pick = bodies.length ? bodies : descriptions;
  return [...new Set(pick.map(tagsOut).filter(Boolean))];
}

/** __NEXT_DATA__: every string that reads like prose (a few words, no URL, no markup of its own). */
function nextDataText(raw: string): string[] {
  const out: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || total > 40_000 || out.length > 80) return;
    if (typeof v === "string") {
      const s = tagsOut(v);
      if (s.length >= 80 && s.split(" ").length >= 12 && !/^(https?:|\/|\{|\[)/.test(s) && !seen.has(s)) { seen.add(s); out.push(s); total += s.length; }
      return;
    }
    if (v === null || typeof v !== "object") return;
    for (const x of Array.isArray(v) ? v.slice(0, 500) : Object.values(v)) walk(x, depth + 1);
  };
  try { walk(JSON.parse(raw), 0); } catch { /* not ours to fix */ }
  return out;
}

const ENABLE_JS = /(?:enable|turn on|requires?|need|must have)[^.<]{0,40}javascript|javascript[^.<]{0,40}(?:disabled|required|enabled|must be)/i;

// -------------------------------------------------------------------- extract

/**
 * A page's HTML as what it says. Never throws. `baseUrl` is the address the
 * HTML came from, for the links; a <base href> in the page overrides it.
 */
export function extract(html: string, baseUrl: string): Extracted {
  const facts: Facts = { title: "", ogTitle: "", lang: "", canonical: "", base: "", scripts: 0, noscript: "", jsonLd: [], nextData: "", body: null };
  const root = parse(html.length > HTML_MAX ? html.slice(0, HTML_MAX) : html, facts);
  const body = facts.body ?? root;

  const collect: Collect = { mains: [], articles: [], roleMain: [], shells: [] };
  visit(root, false, false, collect);

  let base: URL | null = null;
  try { base = new URL(baseUrl); } catch { base = null; }
  if (facts.base) { try { base = new URL(facts.base, base ?? undefined); } catch { /* keep the page's address */ } }

  const chosen = contentRoot(body, collect);
  if (chosen.prune) pruneLinkHeavy(chosen.el);

  const ctx: Ctx = { top: true, base, links: new Map(), code: { n: 0 } };
  const blocks: Block[] = [];
  // A hidden body is a page with nothing on it.
  if (!chosen.el.dead) flow(chosen.el.kids, ctx, blocks);

  const headings: Heading[] = [];
  const parts: string[] = [];
  let pos = 0;
  for (const b of blocks) {
    const text = stripInvisible(b.text);
    if (!text.trim()) continue;
    if (parts.length) pos += 2;
    if (b.h) headings.push({ level: b.h.level, text: stripInvisible(b.h.text), offset: pos });
    parts.push(text);
    pos += text.length;
  }
  let text = parts.join("\n\n");
  let codeBlocks = ctx.code.n;
  let kept = headings;

  const clean = (s: string) => stripInvisible(s).replace(/\s+/g, " ").trim().slice(0, 300);
  const title = clean(facts.title) || clean(facts.ogTitle) || headings.find((h) => h.level === 1)?.text || "";

  // Little to read, and the page looks like a shell its scripts fill in.
  let needsBrowser = false;
  if (text.length < THIN_TEXT) {
    const askedForJs = ENABLE_JS.test(tagsOut(facts.noscript));
    const looksScripted = facts.scripts >= 4 || collect.shells.some((n) => n < 60) || askedForJs;
    if (looksScripted) {
      const own = [...(facts.nextData ? nextDataText(facts.nextData) : []), ...jsonLdText(facts.jsonLd)].map(stripInvisible);
      const fallback = [...new Set(own)].join("\n\n");
      if (fallback.length > text.length) { text = fallback; kept = []; codeBlocks = 0; }
      needsBrowser = text.length < THIN_TEXT;
    }
  }

  let canonical: string | undefined;
  if (facts.canonical) {
    try {
      const u = new URL(facts.canonical, base ?? undefined);
      if (u.protocol === "http:" || u.protocol === "https:") canonical = u.href;
    } catch { /* not a usable address */ }
  }

  return {
    title,
    lang: stripInvisible(facts.lang).trim().slice(0, 35),
    text,
    headings: kept,
    links: [...ctx.links.values()],
    codeBlocks,
    ...(canonical ? { canonical } : {}),
    needsBrowser,
  };
}

// ----------------------------------------------------------- other kinds

/** What a content type is, as far as reading goes. "sniff": the type says nothing, look at the bytes. */
export type ContentKind = "html" | "markdown" | "text" | "json" | "unsupported";

/** Types that are text under another name. */
const TEXTUAL_APPLICATION = /^application\/(?:xml|javascript|x-javascript|ecmascript|yaml|x-yaml|toml|x-sh|x-httpd-php|sql|graphql|x-ndjson|x-www-form-urlencoded|rtf)$/;

export function contentKind(contentType: string): ContentKind | "sniff" {
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") return "sniff";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (mime === "application/json" || mime === "text/json" || mime.endsWith("+json")) return "json";
  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/") || mime.startsWith("font/")) return "unsupported";
  if (mime.startsWith("text/") || TEXTUAL_APPLICATION.test(mime) || mime.endsWith("+xml")) return "text";
  return "unsupported";
}

/** For an answer whose type says nothing: a PDF or anything with NUL bytes is binary; HTML announces itself; the rest is text. */
export function sniffKind(head: Uint8Array): ContentKind {
  const n = Math.min(head.length, 1024);
  let start = 0;
  while (start < n && (head[start] === 0xEF || head[start] === 0xBB || head[start] === 0xBF || head[start]! <= 32)) start++;
  const lead = String.fromCharCode(...head.subarray(start, Math.min(n, start + 16))).toLowerCase();
  if (lead.startsWith("%pdf")) return "unsupported";
  for (let i = 0; i < n; i++) if (head[i] === 0) return "unsupported";
  if (lead.startsWith("<!doctype html") || lead.startsWith("<html")) return "html";
  if (lead.startsWith("{") || lead.startsWith("[")) return "json";
  return "text";
}

const bareText = (text: string): Extracted => ({ title: "", lang: "", text, headings: [], links: [], codeBlocks: 0, needsBrowser: false });

/** Headings, fences and links of a markdown document, found without changing it. */
function markdownParts(text: string, base: URL | null): Extracted {
  const headings: Heading[] = [];
  let codeBlocks = 0;
  let fence: string | null = null;
  let off = 0;
  for (const line of text.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (f) { fence = f[1]!; codeBlocks += 1; }
      else {
        const h = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
        if (h) headings.push({ level: h[1]!.length, text: stripInvisible(h[2]!.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "")).trim().slice(0, 300), offset: off });
      }
    } else if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null;
    off += line.length + 1;
  }
  const links = new Map<string, PageLink>();
  for (const m of text.matchAll(/(?<!!)\[([^\]\n]{1,200})\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    if (links.size >= LINKS_MAX) break;
    if (m[2]!.startsWith("#")) continue;
    try {
      const u = new URL(m[2]!, base ?? undefined);
      if ((u.protocol === "http:" || u.protocol === "https:") && !links.has(u.href)) links.set(u.href, { text: stripInvisible(m[1]!).trim(), url: u.href });
    } catch { /* not an address */ }
  }
  return { ...bareText(text), title: headings.find((h) => h.level === 1)?.text ?? "", headings, links: [...links.values()], codeBlocks };
}

/**
 * Whatever came back, as an Extracted. `kind` is from contentKind (or
 * sniffKind). Plain text and markdown pass through (invisible characters
 * stripped), JSON is pretty-printed, HTML goes through extract(). A kind that
 * is "unsupported" throws WebError("unsupported_type").
 */
export function extractContent(body: string, kind: ContentKind, baseUrl: string): Extracted {
  let base: URL | null = null;
  try { base = new URL(baseUrl); } catch { base = null; }
  switch (kind) {
    case "html": return extract(body, baseUrl);
    case "json": {
      let pretty = body;
      try { pretty = JSON.stringify(JSON.parse(body), null, 2); } catch { /* not JSON after all: as it came */ }
      return bareText(stripInvisible(pretty).trim());
    }
    case "markdown": return markdownParts(stripInvisible(body).trim(), base);
    case "text": {
      const text = stripInvisible(body).trim();
      // A .md file is often served as text/plain.
      return base && /\.(?:md|markdown|mdx)$/i.test(base.pathname) ? markdownParts(text, base) : bareText(text);
    }
    default: throw new WebError("unsupported_type");
  }
}

// ---------------------------------------------------------------- charsets

/**
 * Bytes as text. The charset comes from the Content-Type header, else from
 * the first kilobytes of the document (<meta charset> or http-equiv), else
 * UTF-8; a name TextDecoder does not know is UTF-8 too.
 */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  let label = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType)?.[1] ?? "";
  if (!label) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
    label = /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head)?.[1] ?? "";
  }
  try {
    return new TextDecoder(label || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
