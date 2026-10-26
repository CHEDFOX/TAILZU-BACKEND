/**
 * THE CUES IN A REQUEST: WHAT IT SAYS ABOUT WHERE THE CHANGE IS, READ FOR NOTHING.
 *
 * "Make the Sign up button say Join now", "handleLogin throws on an empty email",
 * "POST /api/users should validate the body", "TypeError: x is not a function at
 * fetchUsers (src/lib/api.ts:5:10)". A person points at the code in a few ways,
 * and every one of them can be read off the words with no model:
 *
 *   quoted      the strings in quotes, which are almost always something on a
 *               screen ("Create account"), or a name when they look like one
 *   uiPhrases   the words next to a UI word: the Sign up button, the settings
 *               title, a button that says Create account
 *   uiWords     button, label, heading, modal, form, navbar...: the request is
 *               about something a person sees, so visible text is the signal
 *   identifiers camelCase, snake_case, PascalCase and SCREAMING_SNAKE, and the
 *               single words in backticks
 *   paths       src/lib/api.ts, SignupForm.tsx, a folder with a trailing slash
 *   routes      /api/users, /settings, POST /orders
 *   errors      the lines that are an error (TypeError: ..., error TS2345, panic:)
 *   frames      `path:line` out of a stack trace (JavaScript, Python, Go...),
 *               never a frame inside node_modules or site-packages
 *   nouns       what is left: the feature words, singular, in the order said
 *
 * Code in a fenced block is read for its identifiers, paths, errors and frames
 * (a pasted stack trace is the best cue there is) but its strings are not taken
 * for something on a screen.
 *
 * Pure. Nothing here reads a store or a model.
 */
import { languageOf } from "../project/lang.js";

export interface Frame { path: string; line?: number }

export interface Cues {
  /** Strings in quotes that are on a screen now (or may be). */
  quoted: string[];
  /** Strings in quotes that are what the person wants it to say instead ("to 'Join now'"): never searched, the code does not have them yet. */
  replacements: string[];
  uiPhrases: string[];
  uiWords: string[];
  identifiers: string[];
  paths: string[];
  dirs: string[];
  extensions: string[];
  routes: string[];
  errors: string[];
  frames: Frame[];
  nouns: string[];
  /** The nouns, up to three, as one phrase. */
  phrase: string;
  /** The request is about something a person sees, so visible text is the strong signal. */
  ui: boolean;
}

export const EMPTY_CUES: Readonly<Cues> = {
  quoted: [], replacements: [], uiPhrases: [], uiWords: [], identifiers: [], paths: [], dirs: [], extensions: [], routes: [], errors: [], frames: [], nouns: [], phrase: "", ui: false,
};

// ----------------------------------------------------------------- the lists

/** Words for something a person reads on a screen: the text next to one of these is searched as visible text. */
const TEXT_UI = ["button", "label", "link", "heading", "title", "placeholder", "tab", "tooltip", "toast", "banner", "caption", "headline", "subtitle", "hint", "snackbar", "popup"];
/** Words for something a person sees and touches. */
const OTHER_UI = [
  "text", "copy", "wording", "message", "modal", "dialog", "form", "field", "input", "checkbox", "dropdown", "select", "page", "screen", "navbar", "nav", "sidebar", "header",
  "footer", "menu", "card", "icon", "logo", "color", "colour", "font", "theme", "layout", "homepage", "landing", "hero", "cta", "ui", "widget", "textbox", "toggle", "switch",
];
const UI_SET = new Set([...TEXT_UI, ...OTHER_UI]);
const TEXT_UI_RE = TEXT_UI.join("|");

const WORD = "[\\p{L}\\p{N}'’&-]+";

/** Words that begin a UI phrase without being part of it. */
const LEAD_STOP = new Set([
  "the", "a", "an", "our", "my", "your", "this", "that", "these", "those", "on", "in", "of", "to", "for", "at", "by", "and", "or", "with", "from", "into", "also", "please", "can", "you", "we",
  "should", "it", "its", "change", "update", "fix", "make", "rename", "add", "remove", "edit", "set", "replace", "say", "says", "text", "wording", "new", "old", "current", "existing", "is", "are", "be",
  "when", "if", "then", "so", "but", "i", "want", "need", "would", "like", "have", "has", "all", "every", "each", "some", "any", "other", "another", "first", "last", "main", "primary", "secondary",
]);

/** The last word of a UI phrase that says what kind of control it is, not what it is called. */
/** Words that end the text of a button in a sentence about it: "the button that says Get started is cut off". */
const PHRASE_END = new Set(["is", "are", "was", "were", "does", "doesn't", "do", "should", "needs", "need", "has", "have", "looks", "gets", "goes", "keeps", "isn't", "won't", "can't", "cannot", "to", "and", "or", "but", "so", "when", "if", "on", "in", "at", "for", "with", "from", "because", "which", "that"]);
const FIELD_WORDS = new Set(["field", "input", "box", "textbox", "area", "control", "element", "widget"]);

const STOP = new Set([
  ...LEAD_STOP,
  "get", "got", "let", "lets", "use", "used", "using", "way", "thing", "things", "stuff", "something", "anything", "everything", "nothing", "bit", "lot", "many", "much", "more", "most", "less",
  "does", "did", "done", "doing", "not", "dont", "doesnt", "isnt", "arent", "cant", "wont", "will", "was", "were", "been", "being", "than", "too", "very", "just", "still", "even", "only", "also",
  "what", "which", "who", "where", "why", "how", "there", "here", "they", "them", "their", "his", "her", "him", "she", "out", "off", "over", "under", "about", "after", "before", "while", "because",
  "make", "makes", "making", "made", "build", "write", "show", "shows", "display", "improve", "implement", "refactor", "modify", "delete", "create", "move", "work", "works", "working", "broken", "bug",
  "issue", "problem", "error", "errors", "fail", "fails", "failing", "wrong", "right", "good", "better", "best", "nice", "look", "looks", "feel", "want", "wants", "think", "know", "see", "try", "check",
  "now", "again", "back", "into", "onto", "via", "per", "etc", "code", "app", "application", "website", "site", "project", "file", "files", "function", "class", "component", "variable", "name", "value",
  "bhai", "yaar", "karo", "kar", "do", "ko", "ka", "ki", "ke", "me", "mein", "se", "hai", "ho", "wala", "wali", "ye", "yeh", "woh", "aur", "par",
  ...UI_SET,
]);

/** Names of products and languages that are PascalCase without being something in the project's code. */
const BRANDS = new Set([
  "JavaScript", "TypeScript", "GitHub", "GitLab", "BitBucket", "OpenAI", "PostgreSQL", "MongoDB", "MySQL", "GraphQL", "NodeJS", "NextJS", "ReactJS", "VueJS", "YouTube", "LinkedIn",
  "WhatsApp", "PayPal", "FaceBook", "TikTok", "iPhone", "iPad", "macOS", "iOS", "ChatGPT", "DeepSeek", "OpenRouter", "SendGrid", "CloudFlare", "DigitalOcean", "VSCode", "IntelliJ", "PyCharm",
  "FastAPI", "ExpressJS", "TailwindCSS", "DevOps", "RazorPay", "SupaBase", "FireBase", "WebSocket", "WebSockets", "OAuth", "JSON", "README",
]);

// ----------------------------------------------------------------- the pieces

const codeBlock = /```[^\n]*\n([\s\S]*?)```/g;

/** The request without its fenced code, and the code on its own. */
function split(task: string): { prose: string; code: string } {
  let code = "";
  const prose = task.replace(codeBlock, (_m, body: string) => { code += `${body}\n`; return "\n"; });
  return { prose, code };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const uniq = <T>(xs: T[], max: number, key: (x: T) => string = (x) => String(x)): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of xs) { const k = key(x); if (!k || seen.has(k)) continue; seen.add(k); out.push(x); if (out.length >= max) break; }
  return out;
};

/** The same word singular, so a prefix search for it finds the plural too ("settings" -> "setting"). */
export function stem(w: string): string {
  const x = w.toLowerCase();
  if (x.length > 4 && x.endsWith("ies")) return `${x.slice(0, -3)}y`;
  if (x.length > 3 && x.endsWith("s") && !/(?:ss|us|is)$/.test(x)) return x.slice(0, -1);
  return x;
}

/** A quoted piece that is a name (handleLogin, user_id, API_KEY), not words on a screen. */
export function looksLikeIdentifier(s: string): boolean {
  if (/\s/.test(s)) return false;
  return /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(s) || /^(?:[A-Z][a-z0-9]+){2,}$/.test(s) || /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(s) || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(s);
}

const KNOWN_EXT = (p: string): boolean => languageOf(p) !== "";

/** Quoted strings: "x", 'x', “x”, ‘x’, with the words just before each. An apostrophe inside a word (don't) is not a quote. */
function quotedIn(prose: string): Array<{ text: string; before: string }> {
  const out: Array<{ text: string; before: string }> = [];
  for (const m of prose.matchAll(/"([^"\n]{2,80})"|“([^”\n]{2,80})”|(?<![\p{L}\p{N}])'([^'\n]{2,80})'(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])‘([^’\n]{2,80})’(?![\p{L}\p{N}])/gu)) {
    const t = clean(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
    if (t.length >= 2 && t.length <= 80) out.push({ text: t, before: prose.slice(Math.max(0, m.index! - 40), m.index!) });
  }
  return out;
}

/**
 * The new wording, not the present one: "to 'Join now'" after another quoted string, "should say 'X'", "make it say 'X'".
 * ("says", "reads" and "shows" are what it does now; "say", "read" and "show" are what it should do.)
 */
function isReplacement(q: { before: string }, earlierQuoted: boolean): boolean {
  if (/\b(?:says|reads|shows|displays|is|are|labell?ed|called|titled|named)\s*$/i.test(q.before)) return false;
  if (/\b(?:say|read|show|display)\s*$/i.test(q.before)) return true;
  if (/\b(?:instead|rather)\s+(?:of\s+)?$/i.test(q.before)) return false;
  return earlierQuoted && /\b(?:to|into|with|as)\s*$/i.test(q.before);
}

/** The words typed in backticks. */
function backticked(prose: string): string[] {
  return [...prose.matchAll(/`([^`\n]{1,120})`/g)].map((m) => clean(m[1]!)).filter(Boolean);
}

/** A route in a token: starts with a slash and a letter, no file extension, not part of an address. */
function routeOf(token: string): string | null {
  const t = token.replace(/[.,;:!?)\]}'"`]+$/, "");
  if (!/^\/[A-Za-z][\w\-:{}[\].@]*(?:\/[\w\-:{}[\].@]+)*$/.test(t)) return null;
  // A last segment with an extension is a file, not an endpoint.
  if (/\.[A-Za-z0-9]{1,5}$/.test(t.slice(t.lastIndexOf("/") + 1))) return null;
  return t.length >= 2 ? t : null;
}

const FRAME_SKIP = /node_modules|site-packages|dist-packages|node:internal|<anonymous>|\(native\)|^internal\/|\/usr\/lib\/|\/lib\/python|\.pnpm\//;

function cleanFramePath(raw: string): string {
  return raw.replace(/^file:\/\//, "").replace(/^webpack(?:-internal)?:\/\/[^/]*\//, "").replace(/^\/_next\/static\/[^/]*\//, "").replace(/\?.*$/, "").replace(/^\.\//, "");
}

/** `path:line` pairs out of a stack trace, and the function names in it. */
function framesIn(text: string): { frames: Frame[]; fns: string[] } {
  const frames: Frame[] = [];
  const fns: string[] = [];
  const add = (rawPath: string, line: string | undefined, fn?: string) => {
    const full = rawPath;
    if (FRAME_SKIP.test(full)) return;
    const path = cleanFramePath(full);
    if (!path || !KNOWN_EXT(path)) return;
    frames.push({ path, ...(line ? { line: Number(line) } : {}) });
    if (fn && /^[A-Za-z_$][\w$.]*$/.test(fn) && !/^(?:Object|Module|Function|async|new|anonymous|process|Promise|Array|Generator)\b/.test(fn)) fns.push(fn.split(".").pop()!);
  };
  // JavaScript: at fn (path:line:col)   at path:line:col
  for (const m of text.matchAll(/\bat\s+(?:(?:async\s+)?([\w$.<>]+)\s+)?\(?((?:file:\/\/|webpack[^\s:]*:\/\/)?[^\s()]+?\.[A-Za-z0-9]{1,5}):(\d+)(?::\d+)?\)?/g)) add(m[2]!, m[3], m[1]);
  // Python: File "path", line N, in fn
  for (const m of text.matchAll(/File "([^"]+)", line (\d+)(?:, in ([\w<>.]+))?/g)) add(m[1]!, m[2], m[3]);
  // Go, Rust, Java and the rest: path.ext:line
  for (const m of text.matchAll(/(?<![\w/.-])((?:[\w.@-]+\/)*[\w.@-]+\.(?:go|rs|java|kt|dart|rb|php|swift|cs|c|cc|cpp|ts|tsx|js|jsx|mjs|py)):(\d+)(?::\d+)?/g)) add(m[1]!, m[2]);
  const seen = new Set<string>();
  return { frames: frames.filter((f) => { const k = `${f.path}:${f.line ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6), fns: uniq(fns, 6) };
}

const ERROR_LINE = /^\s*(?:(?:Uncaught|Unhandled)\s+)?(?:[\w.]+\.)?[A-Z]\w*(?:Error|Exception)\b[:\s(]|^\s*(?:(?:Uncaught|Unhandled)\s+)?Error\b\s*[:(]|\berror\s+TS\d{3,5}\b|\berror\[E\d{4}\]|^\s*(?:npm\s+)?ERR!|\bpanic:|\bTraceback \(most recent call last\)|^\s*(?:Error|FATAL|Fatal error)\b:?|\b(?:Cannot|Could not|Failed to)\b.{4,}|\bis not (?:defined|a function|iterable)\b|\bundefined is not\b|\bcannot read propert/i;

function errorsIn(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = clean(line);
    if (t.length < 8 || t.length > 300) continue;
    // A stack frame is not the error.
    if (/^\s*at\s/.test(line) || /^File "/.test(t)) continue;
    if (ERROR_LINE.test(t)) out.push(t);
  }
  return uniq(out, 3);
}

/** The words of an error's message with its type taken off: "TypeError: Invalid email" -> "Invalid email". */
export function errorMessage(line: string): string {
  const m = /^(?:(?:Uncaught|Unhandled)\s+)?(?:[\w.]+\.)?\w*(?:Error|Exception)\s*[:(]\s*(.+?)\)?$/.exec(line) ?? /^(?:FATAL|Fatal error)\s*:\s*(.+)$/i.exec(line);
  return clean(m?.[1] ?? "");
}

function identifiersIn(text: string, extra: string[]): string[] {
  const out: string[] = [...extra];
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const w = m[0];
    if (w.length < 4 || w.length > 60 || BRANDS.has(w) || /(?:Error|Exception)$/.test(w)) continue;
    if (looksLikeIdentifier(w)) out.push(w);
  }
  return out;
}

/** Text next to a UI word: "the Sign up button" -> "Sign up". */
function uiPhrasesIn(prose: string): string[] {
  const out: string[] = [];
  const trim = (raw: string, endAtVerb = false): string => {
    let words = raw.split(/\s+/).filter(Boolean);
    if (endAtVerb) { const at = words.findIndex((w, i) => i > 0 && PHRASE_END.has(w.toLowerCase())); if (at > 0) words = words.slice(0, at); }
    while (words.length && LEAD_STOP.has(words[0]!.toLowerCase())) words.shift();
    while (words.length > 3) words.shift();
    // "the email field" names the email, not a field.
    while (words.length > 1 && FIELD_WORDS.has(words[words.length - 1]!.toLowerCase())) words.pop();
    return words.join(" ").replace(/^['’"“‘]+|['’"”’]+$/g, "").replace(/\s['’"”]+/g, " ").replace(/[-&]+$/, "").trim();
  };
  const before = new RegExp(`((?:${WORD}\\s+){1,4})(?:${TEXT_UI_RE})s?\\b`, "giu");
  for (const m of prose.matchAll(before)) {
    const p = trim(m[1]!);
    if (p.length >= 3 && !LEAD_STOP.has(p.toLowerCase())) out.push(p);
  }
  // button that says Sign up / a link called Pricing / labelled Save: the text it shows now. ("to say Join now" is the new text, and is not searched.)
  const says = new RegExp(`(?:\\b(?:that|which|currently|now|saying)\\s+(?:says?|reads?|shows?)|\\blabell?ed|\\btitled|\\bcalled|\\bnamed)\\s+(${WORD}(?:\\s+${WORD}){0,3})`, "giu");
  for (const m of prose.matchAll(says)) {
    const p = trim(m[1]!, true);
    if (p.length >= 3) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------- the whole

export function extractCues(task: string): Cues {
  const text = String(task ?? "").slice(0, 8000);
  const { prose, code } = split(text);
  const all = `${prose}\n${code}`;

  const ticks = backticked(prose);
  const found = quotedIn(prose);
  const replacements: string[] = [];
  const pieces: string[] = [];
  found.forEach((q, i) => { if (isReplacement(q, i > 0)) replacements.push(q.text); else pieces.push(q.text); });

  // Tokens: paths, dirs, routes.
  const paths: string[] = [];
  const dirs: string[] = [];
  const routes: string[] = [];
  const frameHints: Frame[] = [];
  for (const raw of all.split(/[\s,;()"'`<>[\]{}]+/)) {
    if (!raw) continue;
    const t = raw.replace(/[.,;:!?]+$/, "");
    if (!t) continue;
    const route = routeOf(t);
    if (route && !/^\/[\w-]+\.[A-Za-z0-9]+$/.test(route)) { routes.push(route); continue; }
    const withLine = /^(.*?[^\s:]):(\d+)(?::\d+)?$/.exec(t);
    const bare = withLine ? withLine[1]! : t;
    if (/^[\w@.\-/]+$/.test(bare) && bare.includes("/") && bare.endsWith("/") && bare.length > 2 && !bare.startsWith("//")) { dirs.push(bare.replace(/^\.\//, "").replace(/\/+$/, "")); continue; }
    if (/^[\w@.\-/]+$/.test(bare) && /\.[A-Za-z0-9]{1,8}$/.test(bare) && KNOWN_EXT(bare) && !/^\d+(?:\.\d+)+$/.test(bare) && !/^https?:/i.test(bare) && !FRAME_SKIP.test(bare)) {
      const p = cleanFramePath(bare);
      if (p.length >= 3) {
        paths.push(p);
        if (withLine) frameHints.push({ path: p, line: Number(withLine[2]) });
      }
    }
  }
  // Quoted and backticked pieces that are routes or paths.
  for (const piece of [...pieces, ...ticks]) {
    const r = routeOf(piece);
    if (r) routes.push(r);
    else if (/^[\w@.\-/]+$/.test(piece) && piece.includes(".") && KNOWN_EXT(piece) && !/^https?:/i.test(piece)) paths.push(cleanFramePath(piece));
  }
  // A route with a verb in front: POST /api/users. (The path is the cue; the verb only helps a person read it.)

  const { frames: traced, fns } = framesIn(all);
  const frames = uniq([...traced, ...frameHints], 6, (f) => `${f.path}:${f.line ?? ""}`);
  const errors = errorsIn(all);

  // Names are read from the words of the request, not from the frames of a trace or the paths in it (those are found by their files).
  const named = all.split("\n").filter((l) => !/^\s*at\s/.test(l) && !/^\s*File "/.test(l)).join("\n")
    .replace(/https?:\/\/\S+/g, " ").replace(/[\w@.\-/]*[./][\w@.\-/]*\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?|[\w@.\-]+\/[\w@.\-/]*/g, " ");
  const identifiers = uniq(
    identifiersIn(named, [
      ...ticks.filter((t) => /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/.test(t) && t.length >= 3).map((t) => t.replace(/\(\)$/, "").split(".").pop()!),
      ...pieces.filter(looksLikeIdentifier),
      // Only the frame the error came from: the callers are named by their files.
      ...fns.slice(0, 1),
    ]),
    12,
  ).filter((w) => !BRANDS.has(w));

  // Strings on a screen: quoted pieces that are not names, paths or routes.
  const quoted = uniq(pieces.filter((p) => !looksLikeIdentifier(p) && !routeOf(p) && !(p.includes("/") && !p.includes(" ")) && !(/^[\w@.\-/]+$/.test(p) && KNOWN_EXT(p))), 6, (p) => p.toLowerCase());

  const uiPhrases = uniq(uiPhrasesIn(prose), 4, (p) => p.toLowerCase()).filter((p) => !quoted.some((q) => q.toLowerCase() === p.toLowerCase()));
  const lower = prose.toLowerCase();
  const uiWords = uniq((lower.match(/[a-z]+/g) ?? []).filter((w) => UI_SET.has(w)), 6);

  const extensions = uniq([...paths, ...frames.map((f) => f.path)].map((p) => /\.([A-Za-z0-9]+)$/.exec(p)?.[1]?.toLowerCase() ?? "").filter(Boolean), 4);

  // The nouns: the words of the request outside quotes, code, names, paths and traces.
  const bare = prose
    .replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`|https?:\/\/\S+/g, " ")
    .replace(/(?<![\p{L}\p{N}])'[^'\n]{2,80}'(?![\p{L}\p{N}])/gu, " ")
    .split("\n").filter((l) => !/^\s*at\s/.test(l) && !/^\s*File "/.test(l) && !ERROR_LINE.test(clean(l))).join("\n")
    .replace(/[\w@.\-/]*[./][\w@.\-/]*(?::\d+(?::\d+)?)?/g, (t) => (/^\w+\.$/.test(t) || !/[\w]/.test(t) ? t : " "))
    .split(/[\s,;()<>[\]{}]+/)
    .join(" ");
  const nouns = uniq(
    (bare.match(/[\p{L}][\p{L}\p{N}]*/gu) ?? [])
      .filter((w) => !looksLikeIdentifier(w) && !BRANDS.has(w))
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
      .map(stem),
    8,
  );
  // A quoted string's own words are not feature words, but a UI phrase's are ("signup" in "the signup button").
  const phrase = nouns.slice(0, 3).join(" ");

  const ui = uiWords.length > 0 || quoted.length > 0 || uiPhrases.length > 0;
  return {
    quoted, replacements: uniq(replacements, 4, (p) => p.toLowerCase()), uiPhrases, uiWords, identifiers, paths: uniq(paths, 8), dirs: uniq(dirs, 4), extensions, routes: uniq(routes, 4), errors, frames, nouns, phrase, ui,
  };
}

/** How many cues of the kinds that point at code (not at words) were found. */
export function hardCues(c: Cues): number {
  return c.identifiers.length + c.paths.length + c.routes.length + c.frames.length;
}

/** Nothing in the request says where the change is. */
export function isVague(c: Cues): boolean {
  return c.quoted.length === 0 && c.uiPhrases.length === 0 && hardCues(c) === 0 && c.errors.length === 0 && c.nouns.length === 0;
}
