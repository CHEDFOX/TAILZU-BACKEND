/**
 * WHAT A PERSON SEES, AND WHERE IT IS: THE VISIBLE-TEXT INDEX.
 *
 * "Change the Sign up button" names no file. The words on a screen are the one
 * handle a person has on the code, so every string a user can read is indexed
 * to file:line, and a search for "Sign up" lands on the file that draws it:
 *
 *   JSX and TSX     text between tags (on one line or standing alone on several),
 *                   {"literal"} children, and the title, placeholder, aria-label,
 *                   alt and label attributes
 *   HTML, Vue,      the same, outside <script> and <style>; the template parts
 *   Svelte, EJS...  of Jinja, ERB and Handlebars are skipped over, their literal
 *                   words kept
 *   translations    i18n JSON and YAML (and Flutter's .arb, and .properties) under
 *                   folders like locales/ and i18n/: every string value, with
 *                   its key, so the text and the key to change are both found
 *   Flutter         Text('...') and labelText, hintText, tooltip and friends
 *   Android         strings.xml (string, plurals and arrays, `translatable="false"`
 *                   left out) and literal android:text/hint in layouts
 *   iOS             .strings files, and SwiftUI's Text("..."), Button("...")
 *   Python and Go   strings passed to flash, messages.*, gettext, abort and
 *                   HttpResponse, and the template names given to render and
 *                   ExecuteTemplate (so "the login page" finds login.html)
 *   Ruby and PHP    flash/notice/alert strings, __() and trans(), view('...')
 *
 * A string is dropped if it has no letter in it, looks like code, or is longer
 * than 160 characters (cut). And a line the policy's secret scanner flags
 * (policy.ts scanForSecrets) is dropped whole: a token that sits in a string
 * next to a label never reaches the index, a model, or an answer.
 */
import { scanForSecrets } from "../policy.js";
import { I18N_DIR, baseName, extOf } from "./lang.js";
import { parseYaml, isObj, type Json } from "./parse.js";
import { blankComments } from "./symbols.js";
import { TEXTS_PER_FILE, type TextKind } from "./types.js";

export interface TextHit { line: number; text: string; kind: TextKind }

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

/** A candidate string as it would be shown, or null if it is not something a person reads. */
export function cleanText(raw: string, o: { code?: boolean } = {}): string | null {
  let s = decode(raw).replace(/\s+/g, " ").trim();
  if (s.length < 2 || !/\p{L}/u.test(s)) return null;
  if (o.code !== false) {
    // Code that wandered between a `>` and a `<`.
    if (/[=;[\]]|=>|&&|\|\||\?\.|::|\$\{|\bfunction\b|\breturn\b/.test(s)) return null;
    if (/^[\w.-]+\/[\w./-]+$/.test(s) || /^https?:\/\/\S+$/.test(s) || /^[A-Z][A-Z0-9_]+$/.test(s) || /^[\w$.]+\(.*\)$/.test(s)) return null;
  }
  if (s.length > 160) s = `${s.slice(0, 159)}…`;
  return s;
}

const lineOfIndex = (starts: number[], index: number): number => {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= index) lo = mid; else hi = mid - 1; }
  return lo + 1;
};
const startsOf = (text: string): number[] => {
  const s = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) s.push(i + 1);
  return s;
};

const ATTR = /\b(title|placeholder|aria-label|alt|label)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|\{\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n$]*)`)\s*\})/g;

/** Markup lines: attributes, text between tags, text standing alone, and (with `jsx`) {"literal"} children. */
function markupTexts(lines: string[], o: { jsx: boolean }): TextHit[] {
  const out: TextHit[] = [];
  const kindText: TextKind = o.jsx ? "jsx" : "html";
  const prevNonBlank = (i: number) => { for (let j = i - 1; j >= 0 && j >= i - 3; j -= 1) if (lines[j]!.trim()) return lines[j]!.trim(); return ""; };
  const nextNonBlank = (i: number) => { for (let j = i + 1; j < lines.length && j <= i + 3; j += 1) if (lines[j]!.trim()) return lines[j]!.trim(); return ""; };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t || /^(?:\/\/|\/\*|\*|<!--|#)/.test(t)) continue;
    for (const m of line.matchAll(ATTR)) {
      const v = cleanText(m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? "", { code: false });
      if (v && !/\{\{|\$\{|^\{/.test(v)) out.push({ line: i + 1, text: v, kind: "attr" });
    }
    let inline = false;
    // text between tags: <button>Sign up</button>
    for (const m of line.matchAll(/>([^<>{}]+)</g)) {
      if (/^\s*[=-]?>?\s*$/.test(m[1]!)) continue;
      const v = cleanText(m[1]!);
      if (v) { out.push({ line: i + 1, text: v, kind: kindText }); inline = true; }
    }
    // <b>{"Sign up"}</b>
    if (o.jsx) {
      for (const m of line.matchAll(/(?:>|^)\s*\{\s*(["'`])([^"'`\n$]+)\1\s*\}\s*(?:<|$)/g)) {
        const v = cleanText(m[2]!);
        if (v) { out.push({ line: i + 1, text: v, kind: "jsx" }); inline = true; }
      }
    }
    if (inline) continue;
    // A line of words and nothing else, between tags.
    if (!/[<>{}=;]/.test(t) || (!o.jsx && !/[<>=;]/.test(t))) {
      const prev = prevNonBlank(i);
      const next = nextNonBlank(i);
      const afterTag = prev.endsWith(">") && !prev.endsWith("=>") && !prev.endsWith("->");
      const beforeTag = next.startsWith("<") || (o.jsx && next.startsWith("{"));
      if (afterTag && beforeTag) {
        // template syntax on the line: keep the literal words around it
        const plain = t.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|<%[\s\S]*?%>/g, " ");
        const v = cleanText(plain);
        if (v) out.push({ line: i + 1, text: v, kind: kindText });
      }
    }
  }
  return out;
}

/** The part of a Vue/Svelte/Astro file that is markup: `<script>` and `<style>` blanked out, newlines kept. */
function blankBlocks(text: string, tags: string[]): string {
  let out = text;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), (b) => b.replace(/[^\n]/g, " "));
  }
  return out.replace(/<!--[\s\S]*?-->/g, (b) => b.replace(/[^\n]/g, " "));
}

// ---------------------------------------------------------- translations

function flatten(v: Json, prefix: string, out: Array<[string, string]>, depth = 0): void {
  if (out.length >= 600 || depth > 8) return;
  if (typeof v === "string") { out.push([prefix, v]); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out, depth + 1)); return; }
  if (isObj(v)) for (const [k, x] of Object.entries(v)) { if (!k.startsWith("@")) flatten(x, prefix ? `${prefix}.${k}` : k, out, depth + 1); }
}

function i18nTexts(path: string, text: string): TextHit[] {
  const e = extOf(path);
  const pairs: Array<[string, string]> = [];
  if (e === "json" || e === "arb" || e === "jsonc" || e === "json5") {
    try { flatten(JSON.parse(text) as Json, "", pairs); } catch { return []; }
  } else if (e === "yml" || e === "yaml") {
    flatten(parseYaml(text), "", pairs);
  } else if (e === "properties") {
    for (const l of text.split("\n")) { const m = /^\s*([\w.\-]+)\s*[=:]\s*(.+?)\s*$/.exec(l); if (m && !l.trimStart().startsWith("#")) pairs.push([m[1]!, m[2]!]); }
  } else return [];
  const lines = text.split("\n");
  let cursor = 0;
  const out: TextHit[] = [];
  for (const [key, value] of pairs) {
    const v = cleanText(value, { code: false });
    if (!v) continue;
    const leaf = key.replace(/\[\d+\]$/, "").split(".").pop() ?? key;
    // The line is where the leaf key is first met at or after the last one: files list their keys in order.
    let line = 0;
    for (let i = cursor; i < lines.length; i += 1) {
      if (lines[i]!.includes(`"${leaf}"`) || new RegExp(`^\\s*(?:-\\s*)?['"]?${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]?\\s*[:=]`).test(lines[i]!)) { line = i + 1; cursor = i + 1; break; }
    }
    out.push({ line: line || 1, text: `${key}: ${v}`, kind: "i18n" });
  }
  return out;
}

// ---------------------------------------------------------------- Flutter

function flutterTexts(code: string): TextHit[] {
  const starts = startsOf(code);
  const out: TextHit[] = [];
  const push = (index: number, raw: string) => {
    const v = cleanText(raw.replace(/\$\{[^}]*\}/g, "").replace(/\$\w+/g, ""), { code: false });
    if (v) out.push({ line: lineOfIndex(starts, index), text: v, kind: "flutter" });
  };
  for (const m of code.matchAll(/\bText\(\s*(?:const\s+)?(?:r)?(['"])((?:\\.|(?!\1)[^\n\\])*)\1/g)) push(m.index ?? 0, m[2]!);
  for (const m of code.matchAll(/\b(?:labelText|hintText|helperText|errorText|tooltip|semanticsLabel|semanticLabel|title|label)\s*:\s*(?:const\s+)?(['"])((?:\\.|(?!\1)[^\n\\])*)\1/g)) push(m.index ?? 0, m[2]!);
  return out;
}

// ---------------------------------------------------------------- Android

const unAndroid = (s: string) => s.replace(/\\(['"@?])/g, "$1").replace(/\\n/g, " ").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "");

function androidTexts(path: string, text: string): TextHit[] {
  const starts = startsOf(text);
  const out: TextHit[] = [];
  if (/\/res\/values[^/]*\//.test(`/${path}`)) {
    for (const m of text.matchAll(/<string\s+([^>]*?)>([\s\S]*?)<\/string>/g)) {
      const name = /name="([^"]+)"/.exec(m[1]!)?.[1];
      if (!name || /translatable="false"/.test(m[1]!)) continue;
      const v = cleanText(unAndroid(m[2]!), { code: false });
      if (v) out.push({ line: lineOfIndex(starts, m.index ?? 0), text: `${name}: ${v}`, kind: "android" });
    }
    for (const m of text.matchAll(/<(string-array|plurals)\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      for (const it of m[3]!.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
        const v = cleanText(unAndroid(it[1]!), { code: false });
        if (v) out.push({ line: lineOfIndex(starts, (m.index ?? 0) + (m[0]!.indexOf(it[0]!))), text: `${m[2]}: ${v}`, kind: "android" });
      }
    }
  } else {
    for (const m of text.matchAll(/android:(?:text|hint|contentDescription|title)\s*=\s*"([^"@][^"]*)"/g)) {
      const v = cleanText(unAndroid(m[1]!), { code: false });
      if (v) out.push({ line: lineOfIndex(starts, m.index ?? 0), text: v, kind: "android" });
    }
  }
  return out;
}

// -------------------------------------------------------------------- iOS

function iosTexts(path: string, text: string): TextHit[] {
  const starts = startsOf(text);
  const out: TextHit[] = [];
  if (extOf(path) === "strings") {
    const body = blankComments(text, { slash: true, hash: false, triple: false, backtick: false, apostrophe: "char" });
    for (const m of body.matchAll(/^[ \t]*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm)) {
      const v = cleanText(m[2]!.replace(/\\"/g, '"').replace(/\\n/g, " "), { code: false });
      if (v) out.push({ line: lineOfIndex(starts, m.index ?? 0), text: `${m[1]}: ${v}`, kind: "ios" });
    }
  } else {
    for (const m of text.matchAll(/\b(?:Text|Button|Label|Toggle|Section|NavigationLink|TextField|SecureField|navigationTitle|alert|confirmationDialog)\(\s*"((?:[^"\\\n]|\\.)+)"/g)) {
      const v = cleanText(m[1]!.replace(/\\\([^)]*\)/g, ""), { code: false });
      if (v) out.push({ line: lineOfIndex(starts, m.index ?? 0), text: v, kind: "ios" });
    }
  }
  return out;
}

// --------------------------------------------------- Python, Go, Ruby, PHP

interface Rule { re: RegExp; group: number; kind: TextKind }

const PY_RULES: Rule[] = [
  { re: /\bflash\(\s*[fFrR]?(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\bmessages\.(?:success|error|info|warning|debug)\(\s*[^,()]+,\s*[fFrR]?(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /(?:^|[^\w.])(?:_|gettext|ugettext|gettext_lazy|_l|lazy_gettext)\(\s*[fFrR]?(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\babort\(\s*\d+\s*,\s*[fFrR]?(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\b(?:HttpResponse|PlainTextResponse|HTMLResponse)\(\s*[fFrR]?(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\b(?:render_template|render_template_string|get_template|render_to_string|TemplateResponse|render)\(\s*(?:request\s*,\s*)?(['"])([^'"]+\.(?:html?|jinja2?|j2|txt|xml|md))\1/g, group: 2, kind: "string" },
];
const GO_RULES: Rule[] = [
  { re: /\.(?:HTML)\(\s*[\w.]+\s*,\s*"([^"\n]+)"/g, group: 1, kind: "string" },
  { re: /\.String\(\s*[\w.]+\s*,\s*"([^"\n]+)"/g, group: 1, kind: "string" },
  { re: /\b(?:ParseFiles|ParseGlob|ExecuteTemplate)\(\s*(?:\w+\s*,\s*)?"([^"\n]+)"/g, group: 1, kind: "string" },
  { re: /\bhttp\.Error\(\s*\w+\s*,\s*"([^"\n]+)"/g, group: 1, kind: "string" },
  { re: /\bfmt\.Fprint(?:f|ln)?\(\s*\w+\s*,\s*"([^"\n]+)"/g, group: 1, kind: "string" },
  { re: /\bAddFlash\(\s*"([^"\n]+)"/g, group: 1, kind: "string" },
];
const RUBY_RULES: Rule[] = [
  { re: /\bflash(?:\[:\w+\]|\.\w+)\s*=\s*(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\b(?:notice|alert):\s*(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\b(?:t|I18n\.t)\(\s*(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\brender\s+(?:template:\s*|partial:\s*)?(['"])([\w\/.-]+)\1/g, group: 2, kind: "string" },
];
const PHP_RULES: Rule[] = [
  { re: /(?:^|[^\w>])(?:__|_e|trans|trans_choice)\(\s*(['"])(.+?)\1/g, group: 2, kind: "string" },
  { re: /\bview\(\s*(['"])([\w.\-/]+)\1/g, group: 2, kind: "string" },
  { re: /\bwith\(\s*['"](?:success|error|status|message|warning)['"]\s*,\s*(['"])(.+?)\1/g, group: 2, kind: "string" },
];

function ruleTexts(code: string, rules: Rule[]): TextHit[] {
  const starts = startsOf(code);
  const out: TextHit[] = [];
  for (const rule of rules) {
    for (const m of code.matchAll(rule.re)) {
      const v = cleanText(m[rule.group]!.replace(/\{[^}]*\}|%\(\w+\)s|%[sd]/g, "").replace(/\s+/g, " "), { code: false });
      if (v) out.push({ line: lineOfIndex(starts, m.index ?? 0), text: v, kind: rule.kind });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the door

const HASH = { slash: false, hash: true, triple: false, backtick: false, apostrophe: "string" as const };
const PYB = { slash: false, hash: true, triple: true, backtick: false, apostrophe: "string" as const };
const CB = { slash: true, hash: false, triple: false, backtick: false, apostrophe: "char" as const };

/**
 * The visible strings of one file, with the line each is on. Strings on a line
 * the secret scanner flags are left out. At most 200 per file.
 */
export function extractTexts(path: string, lang: string, text: string): TextHit[] {
  let hits: TextHit[] = [];
  const e = extOf(path);
  const b = baseName(path).toLowerCase();
  if ((I18N_DIR.test(path) && ["json", "jsonc", "json5", "yml", "yaml", "properties"].includes(e)) || e === "arb" || /^messages[\w_-]*\.properties$/.test(b)) {
    hits = i18nTexts(path, text);
  } else if (e === "strings" || (lang === "Swift" && /\b(?:Text|Button|Label|Toggle|navigationTitle)\(\s*"/.test(text))) {
    hits = iosTexts(path, text);
  } else if (e === "xml") {
    hits = /\/res\//.test(`/${path}`) ? androidTexts(path, text) : [];
  } else {
    switch (lang) {
      case "TypeScript": case "JavaScript": {
        const jsx = /\.(?:tsx|jsx)$/.test(path) || /<\/[A-Za-z]|\/>/.test(text);
        hits = jsx ? markupTexts(text.split("\n"), { jsx: true }) : [];
        break;
      }
      case "Vue": hits = markupTexts(blankBlocks(text, ["script", "style"]).split("\n"), { jsx: false }); break;
      case "Svelte": case "Astro": hits = markupTexts(blankBlocks(text, ["script", "style"]).split("\n"), { jsx: false }); break;
      case "HTML": case "EJS": case "Handlebars": case "ERB": case "Jinja": hits = markupTexts(blankBlocks(text, ["script", "style"]).split("\n"), { jsx: false }); break;
      case "Dart": hits = flutterTexts(blankComments(text, { slash: true, hash: false, triple: false, backtick: false, apostrophe: "string" })); break;
      case "Python": hits = ruleTexts(blankComments(text, PYB), PY_RULES); break;
      case "Go": hits = ruleTexts(blankComments(text, CB), GO_RULES); break;
      case "Ruby": hits = ruleTexts(blankComments(text, HASH), RUBY_RULES); break;
      case "PHP": hits = ruleTexts(blankComments(text, { ...CB, apostrophe: "string" }), PHP_RULES); break;
      case "Swift": hits = []; break;
      default: hits = [];
    }
  }
  if (!hits.length) return [];

  // Secrets: if the file holds nothing the scanner flags, every string stands; otherwise each is judged with its own line.
  if (scanForSecrets([{ path, content: text }]).length) {
    const lines = text.split("\n");
    hits = hits.filter((h) => !scanForSecrets([{ path, content: `${lines[h.line - 1] ?? ""}\n${h.text}` }]).length);
  }
  const seen = new Set<string>();
  const out: TextHit[] = [];
  for (const h of hits) {
    const k = `${h.line}|${h.kind}|${h.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= TEXTS_PER_FILE) break;
  }
  return out.sort((a, b2) => a.line - b2.line);
}
