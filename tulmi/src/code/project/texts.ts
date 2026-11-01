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
import { analyse, type RawText } from "./treesitter/index.js";
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
/** What a parser found as raw strings, cleaned the way the regex path cleans its own: judged as words a person reads, attribute values kept whole. */
function parsedTexts(raw: readonly RawText[]): TextHit[] {
  const out: TextHit[] = [];
  for (const r of raw) {
    const v = cleanText(r.raw, { code: r.code });
    if (!v) continue;
    if (r.kind === "attr" && /\{\{|\$\{|^\{/.test(v)) continue;
    out.push({ line: r.line, text: v, kind: r.kind });
  }
  return out;
}

/**
 * The messages the code gives when something is refused or fails (`throw new FrontError("daily_limit", "You've used what X0 Bot may spend…")`,
 * `raise ValueError("…")`): words a person sees though no screen holds them. Each with its code, if it has one, said as words too ("daily limit:
 * You've used…"), so a question in a person's words finds it.
 */
const MESSAGE = /\b(?:new|raise)\s+(?:[A-Z]\w*)?(?:Error|Exception)\s*\(\s*(?:(["'])([a-z][a-z0-9_]{2,40})\1\s*,\s*)?(["'`])((?:(?!\3)[^\\\n]|\\.){12,300})\3/g;
export function messageTexts(text: string): TextHit[] {
  const out: TextHit[] = [];
  const lines = text.split("\n");
  lines.forEach((line, k) => {
    if (/^\s*(?:\/\/|#|\*)/.test(line)) return;
    for (const m of line.matchAll(MESSAGE)) {
      const said = m[4]!.replace(/\$\{[^}]*\}/g, "…").replace(/\\(["'`])/g, "$1").trim();
      if (said.length < 12) continue;
      out.push({ line: k + 1, text: `${m[2] ? `${m[2].replace(/_/g, " ")}: ` : ""}${said}`, kind: "message" });
    }
  });
  return out;
}

/**
 * The same in the languages that return or raise their errors by a call: `errors.New("…")`, `fmt.Errorf("… %w", err)`, `e.BadRequestError("Failed
 * to authenticate.", err)` (Go), `anyhow!("…")`, `bail!("…")` (Rust), `throw IllegalStateException("…")` (Kotlin, Java, C#).
 */
const MESSAGE_CALL = /(?:\berrors\.New|\bfmt\.Errorf|\b[A-Za-z_]\w*Error|\b(?:anyhow|bail)!|\bthrow\s+(?:new\s+)?[A-Z]\w*(?:Error|Exception))\s*\(\s*"((?:[^"\\\n]|\\.){12,300})"/g;
const CALL_LANGS = new Set(["Go", "Rust", "Java", "Kotlin", "C#", "Scala"]);
const CODE_LANGS = new Set(["TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Kotlin", "C#", "Scala", "Ruby", "PHP", "Vue", "Svelte", "Astro"]);
export function messageCallTexts(text: string): TextHit[] {
  const out: TextHit[] = [];
  text.split("\n").forEach((line, k) => {
    if (/^\s*(?:\/\/|\*)/.test(line)) return;
    for (const m of line.matchAll(MESSAGE_CALL)) {
      const said = m[1]!.replace(/%[-+ #0-9.]*[a-zA-Z]/g, "…").replace(/\{[^}]*\}/g, "…").replace(/\\(["'])/g, "$1").trim();
      if (said.length >= 12) out.push({ line: k + 1, text: said, kind: "message" });
    }
  });
  return out;
}

/**
 * The environment settings the code reads, each where it is read: `process.env.SALT_ROTATION`, `import.meta.env.X`, `os.environ["X"]`,
 * `os.getenv("X")`, `os.Getenv("X")`, `env::var("X")`, `System.getenv("X")`, `ENV["X"]`, `getenv('X')`. So "what breaks if I rename X" and "what
 * settings does it need" find every place, in a repo too big to search file by file. The name only: never a value.
 */
const SETTING = /\b(?:process\.env\.([A-Z][A-Z0-9_]{2,})|process\.env\[\s*["'`]([A-Z][A-Z0-9_]{2,})["'`]\s*\]|import\.meta\.env\.([A-Z][A-Z0-9_]{2,})|Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]{2,})|os\.(?:environ(?:\.get)?|getenv)\s*[[(]\s*["']([A-Z][A-Z0-9_]{2,})|os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]{2,})|env::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]{2,})|System\.getenv\(\s*"([A-Z][A-Z0-9_]{2,})|ENV(?:\.fetch\(|\[)\s*["']([A-Z][A-Z0-9_]{2,})|getenv\(\s*["']([A-Z][A-Z0-9_]{2,}))/g;
export function settingTexts(text: string): TextHit[] {
  const out: TextHit[] = [];
  // pydantic's settings class: each upper-case field of a class built on BaseSettings is read from the environment by its name.
  const pydantic = /\bclass\s+\w+\s*\([^)]*\bBaseSettings\b/.test(text);
  text.split("\n").forEach((line, k) => {
    if (/^\s*(?:\/\/|#|\*)/.test(line)) return;
    const field = pydantic ? /^\s{4}([A-Z][A-Z0-9_]{2,})\s*:\s*[\w[]/.exec(line) : null;
    if (field) out.push({ line: k + 1, text: `${field[1]}: an environment setting the code reads here`, kind: "setting" });
    for (const m of line.matchAll(SETTING)) {
      const name = m.slice(1).find(Boolean);
      if (name) out.push({ line: k + 1, text: `${name}: an environment setting the code reads here`, kind: "setting" });
    }
  });
  return out;
}

/** A language as a catalog file or folder is named for it: en, en-US, en_GB, pt-BR, zh-Hans, sr-Latn-RS. */
const LOCALE = /^[a-z]{2,3}(?:[-_][A-Za-z]{2,4}){0,2}$/;
const CATALOG_EXT = /\.(?:json|jsonc|json5|ya?ml|po|properties|arb|strings|xml|toml|ts|js)$/i;
/** How English a locale is: the base a catalog's translations are of. en-US, en_US and en first, then any other en-*. */
const englishness = (locale: string): number => (/^en(?:[-_]US)?$/i.test(locale) ? 2 : /^en(?:[-_]|$)/i.test(locale) || /^Base$/.test(locale) ? 1 : 0);

/**
 * The translations of a catalog: where the same catalog is kept in several languages (public/intl/messages/en-US.json, fr-FR.json, … ;
 * locales/en/common.json, locales/fr/common.json; Android values-fr/strings.xml; iOS fr.lproj/Localizable.strings), every copy but the base
 * language's. English is the base when there is one, else the first by name. Their strings are the base's in other words: indexed once, as the
 * base, a project's text index is not 54 copies of every label, and what its code says is not crowded out (umami: 32,164 catalog strings).
 */
export function translationsOf(paths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const g of catalogsOf(paths)) for (const m of g.copies) if (m !== g.base) out.add(m);
  return out;
}

/** The catalogs kept in several languages: each one's base (English when there is one) and every copy, the base among them. */
export function catalogsOf(paths: readonly string[]): Array<{ base: string; copies: string[] }> {
  const groups = new Map<string, Array<{ path: string; locale: string }>>();
  const add = (key: string, path: string, locale: string) => { const g = groups.get(key) ?? []; g.push({ path, locale }); groups.set(key, g); };
  for (const p of paths) {
    if (!CATALOG_EXT.test(p)) continue;
    const parts = p.split("/");
    const file = parts.pop()!;
    const dir = parts.join("/");
    const stem = file.replace(/\.[^.]+$/, "").replace(/\.[^.]+$/, "");
    const folder = parts.at(-1) ?? "";
    const catalogish = I18N_DIR.test(`${dir}/`) || /\.(?:arb|po|strings)$/i.test(file);
    if (/^values(?:-([a-z]{2}(?:-r[A-Z]{2})?))?$/.test(folder) && /\.xml$/i.test(file)) add(`${parts.slice(0, -1).join("/")}|values|${file}`, p, folder === "values" ? "en" : folder.slice(7));
    else if (/\.lproj$/.test(folder)) add(`${parts.slice(0, -1).join("/")}|lproj|${file}`, p, folder.replace(/\.lproj$/, ""));
    else if (catalogish && LOCALE.test(stem)) add(`${dir}|file`, p, stem);
    else if (catalogish && LOCALE.test(folder)) add(`${parts.slice(0, -1).join("/")}|dir|${file}`, p, folder);
  }
  const out: Array<{ base: string; copies: string[] }> = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const base = [...g].sort((a, b) => englishness(b.locale) - englishness(a.locale) || (a.path < b.path ? -1 : 1))[0]!;
    out.push({ base: base.path, copies: g.map((m) => m.path) });
  }
  return out.sort((a, b) => b.copies.length - a.copies.length || (a.base < b.base ? -1 : 1));
}

/** What a project keeps of its strings when they are more than it may: what the code says first, then screens, then catalogs; in order within each. */
export function keepTexts<T extends { kind: TextKind }>(texts: readonly T[], max: number): T[] {
  if (texts.length <= max) return [...texts];
  const rank = (k: TextKind): number => (k === "setting" || k === "message" ? 0 : k === "i18n" ? 3 : k === "string" ? 2 : 1);
  return texts.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t.kind) - rank(b.t.kind) || a.i - b.i).slice(0, max).map((x) => x.t);
}

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
    const parsed = lang === "TypeScript" || lang === "JavaScript" || lang === "HTML" ? analyse(path, lang, text) : null;
    if (parsed?.texts) hits = parsedTexts(parsed.texts);
    else switch (lang) {
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
  // And what the code says when it refuses or fails, in the languages that throw like this.
  if (lang === "TypeScript" || lang === "JavaScript" || lang === "Python") hits = [...hits, ...messageTexts(text)];
  if (CALL_LANGS.has(lang)) hits = [...hits, ...messageCallTexts(text)];
  if (CODE_LANGS.has(lang)) hits = [...hits, ...settingTexts(text)];
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
  }
  // More than a file may keep (a catalog of 500 strings): the ones a person reads as words are kept, not the first ones met. What the code
  // says when it refuses or fails, then sentences, then the longest; a catalog lists its one-word labels before its messages.
  const kept = out.length <= TEXTS_PER_FILE ? out : out.map((h, i) => ({ h, i, w: worth(h) })).sort((a, b) => b.w - a.w || a.i - b.i).slice(0, TEXTS_PER_FILE).map((x) => x.h);
  return kept.sort((a, b2) => a.line - b2.line);
}

/** How much of what a person reads a string is: a message of the code first, then by its words (a sentence over a label). */
function worth(h: TextHit): number {
  const said = h.text.replace(/^[\w.[\]-]+: /, "");
  const words = said.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
  return (h.kind === "message" || h.kind === "setting" ? 100 : 0) + Math.min(words, 30) + (/[.!?…]$/.test(said) ? 5 : 0);
}
