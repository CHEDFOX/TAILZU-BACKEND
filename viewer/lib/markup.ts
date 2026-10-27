/**
 * HTML and SVG, read as text: a tokenizer, the HTML preparer (element ids, scripts and event handlers taken out so
 * the viewer can run them under a strict CSP) and the SVG sanitiser.
 *
 * Neither needs a DOM, so both run (and are tested) anywhere. The SVG sanitiser works on tokens and writes its output out
 * itself, in one canonical form: nothing the browser might read differently ever leaves it.
 */
import { ELEMENT_ID_ATTR } from "../../tulmi/src/artifacts/protocol.js";
import { lineColAt, lineStarts } from "./text.js";

export interface Attr {
  name: string;
  lname: string;
  /** null for a bare attribute (`hidden`). */
  value: string | null;
  /** The attribute in the source: from its name to the end of its value. */
  s: number;
  e: number;
  /** Where the value starts (inside the quotes), or -1. */
  vs: number;
}

export type Tok =
  | { k: "text"; s: number; e: number }
  | { k: "comment"; s: number; e: number }
  | { k: "decl"; s: number; e: number }
  | { k: "cdata"; s: number; e: number; text: string }
  | { k: "open"; s: number; e: number; name: string; lname: string; nameEnd: number; attrs: Attr[]; selfClose: boolean }
  | { k: "close"; s: number; e: number; name: string; lname: string }
  /** A tag, comment or script that the text ends in the middle of (the source is still being written). Always the last token. */
  | { k: "partial"; s: number };

const isWs = (c: string | undefined): boolean => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";
const isAlpha = (c: string | undefined): boolean => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));

const RAW_HTML = new Set(["script", "style", "textarea", "title"]);
const RAW_SVG = new Set(["script", "style"]);

export function tokenize(src: string, mode: "html" | "svg" = "html"): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  const raw = mode === "html" ? RAW_HTML : RAW_SVG;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      toks.push({ k: "text", s: i, e: n });
      break;
    }
    if (lt > i) toks.push({ k: "text", s: i, e: lt });
    i = lt;
    const next = src[i + 1];
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) {
        toks.push({ k: "partial", s: i });
        break;
      }
      toks.push({ k: "comment", s: i, e: end + 3 });
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end < 0) {
        toks.push({ k: "partial", s: i });
        break;
      }
      toks.push({ k: "cdata", s: i, e: end + 3, text: src.slice(i + 9, end) });
      i = end + 3;
    } else if (next === "!" || next === "?") {
      const end = src.indexOf(">", i);
      if (end < 0) {
        toks.push({ k: "partial", s: i });
        break;
      }
      toks.push({ k: "decl", s: i, e: end + 1 });
      i = end + 1;
    } else if (next === "/" && isAlpha(src[i + 2])) {
      let j = i + 2;
      while (j < n && !isWs(src[j]) && src[j] !== ">" && src[j] !== "/") j++;
      const end = src.indexOf(">", j);
      if (end < 0) {
        toks.push({ k: "partial", s: i });
        break;
      }
      const name = src.slice(i + 2, j);
      toks.push({ k: "close", s: i, e: end + 1, name, lname: name.toLowerCase() });
      i = end + 1;
    } else if (isAlpha(next)) {
      const open = readOpen(src, i);
      if (!open) {
        toks.push({ k: "partial", s: i });
        break;
      }
      toks.push(open);
      i = open.e;
      if (!open.selfClose && raw.has(open.lname)) {
        const re = new RegExp(`</${open.lname}(?=[\\s/>])`, "ig");
        re.lastIndex = i;
        const m = re.exec(src);
        if (!m) {
          toks.pop();
          toks.push({ k: "partial", s: open.s });
          break;
        }
        if (m.index > i) toks.push({ k: "text", s: i, e: m.index });
        i = m.index;
      }
    } else {
      // A `<` that is not a tag (a < b): text.
      toks.push({ k: "text", s: i, e: i + 1 });
      i++;
    }
  }
  return toks;
}

function readOpen(src: string, start: number): Extract<Tok, { k: "open" }> | null {
  const n = src.length;
  let j = start + 1;
  while (j < n && !isWs(src[j]) && src[j] !== ">" && src[j] !== "/") j++;
  const name = src.slice(start + 1, j);
  const nameEnd = j;
  const attrs: Attr[] = [];
  let selfClose = false;
  for (;;) {
    while (j < n && isWs(src[j])) j++;
    if (j >= n) return null;
    const c = src[j]!;
    if (c === ">") {
      j++;
      break;
    }
    if (c === "/") {
      if (src[j + 1] === ">") {
        selfClose = true;
        j += 2;
        break;
      }
      j++;
      continue;
    }
    const as = j;
    while (j < n && !isWs(src[j]) && src[j] !== "=" && src[j] !== ">" && src[j] !== "/") j++;
    if (j === as) {
      j++; // a stray "=" or quote where a name should start
      continue;
    }
    const aname = src.slice(as, j);
    let k = j;
    while (k < n && isWs(src[k])) k++;
    let value: string | null = null;
    let vs = -1;
    if (src[k] === "=") {
      k++;
      while (k < n && isWs(src[k])) k++;
      if (k >= n) return null;
      const q = src[k]!;
      if (q === '"' || q === "'") {
        const end = src.indexOf(q, k + 1);
        if (end < 0) return null;
        vs = k + 1;
        value = src.slice(vs, end);
        j = end + 1;
      } else {
        vs = k;
        while (k < n && !isWs(src[k]) && src[k] !== ">") k++;
        value = src.slice(vs, k);
        j = k;
      }
    }
    attrs.push({ name: aname, lname: aname.toLowerCase(), value, s: as, e: j, vs });
  }
  return { k: "open", s: start, e: j, name, lname: name.toLowerCase(), nameEnd, attrs, selfClose };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The few character references that matter in an attribute value that holds code. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

// ------------------------------------------------------------------------------------------------ html

export interface HtmlScript {
  /** Position in the list; the placeholder in the HTML is `<template data-tz-s="index">`. */
  index: number;
  kind: "classic" | "module";
  /** `src=` as written, or null for an inline script. */
  src: string | null;
  code: string;
  /** Where `code` starts in the original source (1-based). */
  line: number;
  col: number;
}

export interface HtmlHandler {
  /** The element carries `data-tz-h="…,index,…"`. */
  index: number;
  /** "click" for `onclick`. */
  event: string;
  code: string;
  line: number;
  col: number;
}

export interface PreparedHtml {
  html: string;
  scripts: HtmlScript[];
  handlers: HtmlHandler[];
  ids: number;
}

const NO_ID = new Set(["html", "head", "title", "meta", "link", "script", "style", "base", "noscript", "template"]);
const JS_TYPES = /^(?:(?:text|application)\/(?:x-)?(?:java|ecma|j|live)script(?:1\.\d)?|module)?$/;

/**
 * Prepare an HTML artifact to be written into a blank document that has a strict CSP:
 *  - every visible element gets `data-tz-id="line:col"` of its `<` in the original text;
 *  - `<script>` elements are taken out (their code returned, a `<template data-tz-s>` left in their place) so the viewer can
 *    run them in order as blob scripts;
 *  - `on…=` attributes are taken out (their code returned, `data-tz-h` left on the element) so the viewer can bind them;
 *  - `<meta http-equiv=refresh>` and `<base>` are dropped.
 * While the source is still streaming (`streaming`), scripts and handlers are dropped and nothing runs.
 */
export interface PrepareOptions {
  streaming?: boolean;
  attr?: string;
  /** Markup put right after the doctype: ends up in <head>. When the source has no doctype, `<!doctype html>` is added first, so a fragment is
   *  laid out in standards mode. */
  afterDoctype?: string;
  /** Markup put last (it may depend on the scripts and handlers found): ends up at the end of <body>. */
  atEnd?: string | ((found: { scripts: HtmlScript[]; handlers: HtmlHandler[] }) => string);
}

export function prepareHtml(src: string, opts: PrepareOptions = {}): PreparedHtml {
  const attrName = opts.attr ?? ELEMENT_ID_ATTR;
  const starts = lineStarts(src);
  const toks = tokenize(src, "html");
  const out: string[] = [];
  const scripts: HtmlScript[] = [];
  const handlers: HtmlHandler[] = [];
  let ids = 0;
  let headAt = 0;
  let sawDoctype = false;
  const finish = (): PreparedHtml => {
    if (opts.afterDoctype !== undefined) out.splice(headAt, 0, (sawDoctype ? "" : "<!doctype html>") + opts.afterDoctype);
    if (opts.atEnd) out.push(typeof opts.atEnd === "function" ? opts.atEnd({ scripts, handlers }) : opts.atEnd);
    return { html: out.join(""), scripts, handlers, ids };
  };

  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t]!;
    switch (tok.k) {
      case "partial":
        return finish();
      case "decl":
        out.push(src.slice(tok.s, tok.e));
        if (!sawDoctype && /^<!doctype/i.test(src.slice(tok.s, tok.s + 9))) {
          sawDoctype = true;
          headAt = out.length;
        }
        break;
      case "text":
      case "comment":
      case "close":
        out.push(src.slice(tok.s, tok.e));
        break;
      case "cdata":
        out.push(src.slice(tok.s, tok.e));
        break;
      case "open": {
        if (tok.lname === "script") {
          const type = (tok.attrs.find((a) => a.lname === "type")?.value ?? "").trim().toLowerCase();
          const srcAttr = tok.attrs.find((a) => a.lname === "src")?.value ?? null;
          const body = toks[t + 1];
          const text = body && body.k === "text" ? body : undefined;
          const close = toks[t + (text ? 2 : 1)];
          const hasClose = close && close.k === "close" && close.lname === "script";
          if (!JS_TYPES.test(type)) {
            // A data block (JSON, a template): inert, kept as it is.
            out.push(src.slice(tok.s, tok.e));
            break;
          }
          // Skip the body and the closing tag.
          if (text) t++;
          if (hasClose) t++;
          if (opts.streaming || tok.attrs.some((a) => a.lname === "nomodule")) break;
          const code = text ? src.slice(text.s, text.e) : "";
          const at = lineColAt(starts, text ? text.s : tok.e);
          const index = scripts.length;
          scripts.push({ index, kind: type === "module" ? "module" : "classic", src: srcAttr === null ? null : decodeEntities(srcAttr).trim(), code, line: at.line, col: at.col });
          out.push(`<template data-tz-s="${index}"></template>`);
          break;
        }
        if (tok.lname === "base") break;
        if (tok.lname === "meta" && tok.attrs.some((a) => a.lname === "http-equiv" && (a.value ?? "").trim().toLowerCase() === "refresh")) break;

        const drop = new Set<number>();
        const mine: number[] = [];
        tok.attrs.forEach((a, k) => {
          if (a.lname.length > 2 && a.lname.startsWith("on") && a.value !== null) {
            drop.add(k);
            if (!opts.streaming) {
              const at = lineColAt(starts, a.vs);
              mine.push(handlers.length);
              handlers.push({ index: handlers.length, event: a.lname.slice(2), code: decodeEntities(a.value), line: at.line, col: at.col });
            }
          }
        });
        const wantsId = !NO_ID.has(tok.lname);
        if (!wantsId && drop.size === 0) {
          out.push(src.slice(tok.s, tok.e));
          break;
        }
        let idText = "";
        if (wantsId) {
          const at = lineColAt(starts, tok.s);
          idText = ` ${attrName}="${at.line}:${at.col}"`;
          ids++;
        }
        if (drop.size === 0) {
          out.push(src.slice(tok.s, tok.nameEnd), idText, src.slice(tok.nameEnd, tok.e));
          break;
        }
        const kept = tok.attrs.filter((_, k) => !drop.has(k)).map((a) => src.slice(a.s, a.e));
        const marker = mine.length ? ` data-tz-h="${mine.join(",")}"` : "";
        out.push("<", tok.name, idText, marker, kept.length ? " " + kept.join(" ") : "", tok.selfClose ? "/>" : ">");
        break;
      }
    }
  }
  return finish();
}

// ------------------------------------------------------------------------------------------------ svg

const SVG_NAMES = (
  "svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath image clipPath mask pattern marker " +
  "linearGradient radialGradient stop filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix " +
  "feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur " +
  "feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence " +
  "style title desc switch a view animate animateMotion animateTransform set mpath"
).split(" ");
const SVG_CANON = new Map(SVG_NAMES.map((n) => [n.toLowerCase(), n]));

/** Elements removed together with everything inside them. */
const DROP_SUBTREE = new Set([
  "script", "foreignobject", "iframe", "frame", "frameset", "object", "embed", "applet", "audio", "video", "canvas", "source", "track",
  "form", "input", "button", "select", "textarea", "link", "meta", "base", "template", "noscript", "math", "portal",
]);

const SAFE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i;

/** CSS with every `url()` that is not a local `#id` or a data image, every `@import` and the old script hooks taken out. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\b[^;{]*;?/gi, "")
    .replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (whole, _q: string, target: string) => {
      const t = target.replace(/[\u0000- ]/g, "");
      return t.startsWith("#") || SAFE_DATA_URL.test(t) ? whole : "none";
    })
    .replace(/expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:/gi, "blocked");
}

function cleanAttr(a: Attr): string | null {
  if (!/^[A-Za-z_][\w:.-]*$/.test(a.name)) return null;
  const l = a.lname;
  if (l.startsWith("on") || l === "src" || l === "srcdoc" || l === "action" || l === "formaction" || l === "ping") return null;
  if (l.startsWith("xmlns:") && l !== "xmlns:xlink") return null;
  let v = a.value ?? "";
  if (l === "href" || l === "xlink:href") {
    const t = decodeEntities(v).replace(/[\u0000- ]/g, "");
    if (!(t.startsWith("#") || SAFE_DATA_URL.test(t))) return null;
  } else if (l === "style" || /url\s*\(|expression|javascript/i.test(v)) {
    v = sanitizeCss(decodeEntities(v));
    v = v.replace(/&/g, "&amp;");
  }
  return ` ${a.name}="${v.replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`;
}

const escText = (s: string): string => s.replace(/</g, "&lt;");

/**
 * An SVG artifact as safe markup: only SVG elements, no script of any kind, no `on…` attributes, no hrefs but `#local` and data
 * images, no CSS that loads anything. Every kept element carries its `data-tz-id`. Text that is not an `<svg>` at all is wrapped in one.
 */
export function sanitizeSvg(src: string, opts: { attr?: string } = {}): { svg: string; ids: number } {
  const attrName = opts.attr ?? ELEMENT_ID_ATTR;
  const starts = lineStarts(src);
  const toks = tokenize(src, "svg");
  const out: string[] = [];
  let ids = 0;
  let sawSvg = false;
  let skip: string | null = null;
  let depth = 0;

  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t]!;
    if (skip !== null) {
      if (tok.k === "open" && tok.lname === skip && !tok.selfClose) depth++;
      else if (tok.k === "close" && tok.lname === skip && --depth === 0) skip = null;
      continue;
    }
    switch (tok.k) {
      case "partial":
        t = toks.length;
        break;
      case "comment":
      case "decl":
        break;
      case "text":
        out.push(escText(src.slice(tok.s, tok.e)));
        break;
      case "cdata":
        out.push(escText(tok.text));
        break;
      case "close": {
        const canon = SVG_CANON.get(tok.lname);
        if (canon) out.push(`</${canon}>`);
        break;
      }
      case "open": {
        if (DROP_SUBTREE.has(tok.lname)) {
          if (!tok.selfClose) {
            skip = tok.lname;
            depth = 1;
          }
          break;
        }
        const canon = SVG_CANON.get(tok.lname);
        if (!canon) break; // an HTML wrapper: its tags go, what is inside stays
        if (canon === "animate" || canon === "set" || canon === "animateMotion" || canon === "animateTransform") {
          const target = tok.attrs.find((a) => a.lname === "attributename")?.value ?? "";
          if (/^(?:xlink:)?href$/i.test(target.trim()) || /^on/i.test(target.trim())) {
            if (!tok.selfClose) {
              skip = tok.lname;
              depth = 1;
            }
            break;
          }
        }
        if (canon === "svg") sawSvg = true;
        const at = lineColAt(starts, tok.s);
        ids++;
        let tag = `<${canon} ${attrName}="${at.line}:${at.col}"`;
        for (const a of tok.attrs) {
          if (a.lname === attrName) continue;
          const text = cleanAttr(a);
          if (text) tag += text;
        }
        if (canon === "style") {
          // Raw text: the next token is the CSS, then the closing tag.
          const body = toks[t + 1];
          const text = body && body.k === "text" ? body : undefined;
          if (text) t++;
          const close = toks[t + 1];
          if (close && close.k === "close" && close.lname === "style") t++;
          out.push(tag, ">", text ? sanitizeCss(src.slice(text.s, text.e)).replace(/</g, "&lt;") : "", "</style>");
          break;
        }
        out.push(tag, tok.selfClose ? "/>" : ">");
        break;
      }
    }
  }
  let svg = out.join("");
  if (!sawSvg && svg.trim()) svg = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  return { svg, ids };
}
