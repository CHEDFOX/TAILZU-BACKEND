/**
 * THE VALUES IN THE CODE A QUESTION DEPENDS ON: CONFIGURATION AND CONSTANTS, AND A CHECK THAT THE ANSWER SAYS THEM.
 *
 * "What are the default limit and window?" is answered by a line of config (`const defaults = { limit: 60, windowMs: 60000 }`) and by the default
 * parameters of the function that uses it. The brain's summary of a file says "a fixed-window rate limit", and a model that is given the summary and
 * the function's name answers "a one-minute window" and never names `windowMs` (the smoke run for the rate-limit question, twice: the answer was right
 * and missed the name and the number the person asked for). So a question about code is given, besides the summary, the VALUES the located files hold:
 *
 *   exported config objects and defaults   `const defaults = { port: 3000, limit: 60 }`, `module.exports = { ... }`, a Python `DEFAULTS = { ... }`
 *   constants                              `const MAX_LIMIT = 100`, `TIMEOUT_MS = 30_000`, a Java/Kotlin/Go `static final` / `const`
 *   default parameters                     `function rateLimit({ limit = 60, windowMs = 60000 } = {})`, `def page(size=10)`
 *   environment fallbacks                  `process.env.PORT ?? 3000`, `os.getenv("PORT", "8080")`
 *   settings files                         JSON, YAML, TOML, INI and .properties files: their scalar leaves
 *
 * and after the answer is written it is CHECKED: the facts the question asks about (a fact whose name shares a word with the question) and the facts on the
 * lines the answer cites must be in the answer, by name and by value. A fact that is not is added in a line of its own, with the file and line it came from,
 * so the answer cannot leave out the one number that was asked for. Nothing here asks a model anything.
 *
 * Never a secret: a secret file is not read, a name that says it is a secret, token, password or key is skipped, and a line the secret scan flags is dropped.
 * Pure but for `gatherFacts`, which reads through the function it is given.
 */
import { scanForSecrets } from "../policy.js";
import { classOf, extOf, isSecretPath } from "../project/lang.js";

export interface Fact {
  /** The name as written: `windowMs`, `MAX_LIMIT`, `PORT`. */
  name: string;
  /** The value as written, without its quotes: `60000`, `smoke-api`, `true`. */
  value: string;
  path: string;
  line: number;
}

/** Facts kept for one file, and the characters of one value. */
export const FACTS_PER_FILE = 40;
const VALUE_MAX = 80;
const BLOCK_LINES_MAX = 40;

const NAME = String.raw`[A-Za-z_$][\w$]*`;
const LITERAL = String.raw`-?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|'[^'\\\n]*'|"[^"\\\n]*"|` + "`[^`$\\\\\\n]*`" + String.raw`|true|false|null|None|True|False|nil|undefined`;
const CONFIGISH = /(?:default|config|setting|option|limit|constant|param|env)s?$/i;
const UPPER = /^[A-Z][A-Z0-9_]{2,}$/;
const VALUEISH = /(?:default|limit|max|min|timeout|ttl|size|port|interval|threshold|retr(?:y|ies)|window|rate|count|delay|duration|expir|attempt|quota|budget|length|depth|page|batch|concurren|buffer|capacity|cache)/i;
const SECRETISH = /secret|token|passw(?:or)?d|passwd|api[_-]?key|private[_-]?key|credential|auth[_-]?key|signature|salt|pepper/i;

const scalar = (raw: string): string => {
  const v = raw.trim().replace(/^['"`]|['"`]$/g, "");
  return (/^-?\d[\d_]*(\.\d+)?$/.test(raw.trim()) ? v.replace(/_/g, "") : v).slice(0, VALUE_MAX);
};

/** Whether a fact is safe to show: no secret in its name or its line. */
function safe(path: string, name: string, line: string): boolean {
  return !SECRETISH.test(name) && !scanForSecrets([{ path, content: line }]).length;
}

/** The brace depth change of a line, ignoring what is inside quotes (good enough for a config block). */
function depthChange(line: string): number {
  let d = 0;
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "{" || c === "[") d += 1;
    else if (c === "}" || c === "]") d -= 1;
    else if (c === "/" && line[i + 1] === "/") break;
    else if (c === "#" && !/[\w$]/.test(line[i - 1] ?? " ")) break;
  }
  return d;
}

const SCALAR_CONST = new RegExp(String.raw`^\s{0,2}(?:export\s+)?(?:(?:public|private|protected|static|final|readonly|const|let|var|val|pub)\s+)+(?:[A-Za-z_<>\[\]]+\s+)?(${NAME})\s*(?::\s*[\w<>\[\]| ]+\s*)?=\s*(${LITERAL})\s*;?\s*(?:\/\/.*|#.*)?$`);
const PY_CONST = new RegExp(String.raw`^([A-Z][A-Z0-9_]{2,})\s*(?::\s*\w+\s*)?=\s*(${LITERAL})\s*(?:#.*)?$`);
const BLOCK_START = new RegExp(String.raw`^\s{0,2}(?:export\s+)?(?:(?:const|let|var|val|final|static)\s+)?(${NAME})\s*(?::\s*[^=]+)?[:=]\s*\{\s*(?:\/\/.*|#.*)?$`);
const EXPORTS_START = /^\s{0,2}(?:module\.)?exports(?:\.([\w$]+))?\s*=\s*\{\s*$/;
const PAIR = new RegExp(String.raw`^\s*["']?(${NAME})["']?\s*[:=]\s*(${LITERAL})\s*,?\s*(?:\/\/.*|#.*)?$`);
const DEFAULT_PARAM = new RegExp(String.raw`(?<![\w.$=!<>])(${NAME})\s*=\s*(${LITERAL})(?=\s*[,)}\]])`, "g");
const SIGNATURE = /\b(?:function|def|fn|func)\b|=>|\)\s*\{|\)\s*:|^\s*(?:async\s+)?(?:constructor|[\w$]+)\s*\(/;
const ENV_JS = new RegExp(String.raw`process\.env\.([A-Z][A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*(${LITERAL})`, "g");
const ENV_PY = new RegExp(String.raw`(?:os\.getenv|os\.environ\.get|getenv)\(\s*["']([A-Z][A-Z0-9_]*)["']\s*,\s*(${LITERAL})\s*\)`, "g");

/** The configuration and constants a source file holds (see the header). Line numbers are the file's own. */
export function constantsOf(path: string, text: string): Fact[] {
  if (isSecretPath(path)) return [];
  const out: Fact[] = [];
  const seen = new Set<string>();
  const add = (name: string, value: string, line: number, src: string): void => {
    if (out.length >= FACTS_PER_FILE || !name || value === "" || !safe(path, name, src)) return;
    const key = `${name}=${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, value: scalar(value), path, line });
  };
  const lines = text.split("\n");
  const ext = extOf(path);

  // A settings file: its scalar leaves, with the key as the name (a nested key by its last part).
  if (["json", "yaml", "yml", "toml", "ini", "properties", "cfg", "conf"].includes(ext) && !/(?:^|\/)package(?:-lock)?\.json$|(?:^|\/)tsconfig[^/]*\.json$/.test(path)) {
    lines.forEach((l, i) => {
      const m = /^\s*"?([A-Za-z_][\w.-]*)"?\s*[:=]\s*(.+?)\s*,?\s*$/.exec(l);
      if (!m || /[{[]\s*$/.test(m[2]!)) return;
      const v = m[2]!.replace(/\s+#.*$/, "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      if (v === "" || /[{}[\]]/.test(v) || v.length > VALUE_MAX) return;
      add(m[1]!, v, i + 1, l);
    });
    return out;
  }
  if (classOf(path) === "doc") return [];

  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (/^\s*(?:\/\/|#|\*|\/\*)/.test(l)) continue;

    // An object of configuration or defaults: every `key: literal` in it.
    const start = BLOCK_START.exec(l) ?? EXPORTS_START.exec(l);
    const holder = start ? (start[1] ?? "exports") : "";
    if (start && (CONFIGISH.test(holder) || UPPER.test(holder) || holder === "exports")) {
      let depth = depthChange(l);
      for (let j = i + 1; j < lines.length && j <= i + BLOCK_LINES_MAX && depth > 0; j += 1) {
        const inner = lines[j]!;
        const p = PAIR.exec(inner);
        if (p) add(p[1]!, p[2]!, j + 1, inner);
        depth += depthChange(inner);
      }
      continue;
    }

    // A constant on one line.
    const c = SCALAR_CONST.exec(l) ?? PY_CONST.exec(l);
    if (c && (UPPER.test(c[1]!) || VALUEISH.test(c[1]!))) { add(c[1]!, c[2]!, i + 1, l); continue; }

    // The defaults of a function's parameters.
    if (SIGNATURE.test(l) && l.includes("=") && l.includes("(")) {
      for (const m of l.matchAll(DEFAULT_PARAM)) add(m[1]!, m[2]!, i + 1, l);
    }

    // An environment variable with a fallback.
    for (const re of [ENV_JS, ENV_PY]) for (const m of l.matchAll(re)) add(m[1]!, m[2]!, i + 1, l);
  }
  return out;
}

/** The config-like files among some paths: a file that exists to hold settings, constants or defaults. */
export const CONFIG_FILE = /(?:^|\/)(?:[\w.-]*(?:config|configs|settings?|constants?|defaults?|options|env)[\w.-]*)\.[a-z0-9]+$|(?:^|\/)(?:config|configs|settings|constants)\//i;
export const isConfigPath = (path: string): boolean => CONFIG_FILE.test(path) && !isSecretPath(path);

/** Reads some files and takes the values out of them: at most `files` files and `max` facts. A file that cannot be read is skipped. */
export async function gatherFacts(paths: readonly string[], read: (path: string) => Promise<string | null>, o: { files?: number; max?: number } = {}): Promise<{ facts: Fact[]; texts: Map<string, string> }> {
  const facts: Fact[] = [];
  const texts = new Map<string, string>();
  const unique = [...new Set(paths)].filter((p) => !isSecretPath(p)).slice(0, o.files ?? 5);
  const got = await Promise.allSettled(unique.map(async (p) => ({ p, text: await read(p) })));
  for (const g of got) {
    if (g.status !== "fulfilled" || g.value.text === null || g.value.text === undefined) continue;
    texts.set(g.value.p, g.value.text);
    facts.push(...constantsOf(g.value.p, g.value.text));
  }
  return { facts: facts.slice(0, o.max ?? 60), texts };
}

// ------------------------------------------------------------------ what the answer must say

const STOP = new Set([
  "what", "where", "which", "when", "does", "this", "that", "with", "from", "into", "have", "code", "project", "client", "goes", "back", "applied", "work", "works", "default",
  "defaults", "value", "values", "there", "their", "your", "about", "tell", "file", "files", "function", "used", "uses", "using", "happens", "return", "returns", "also", "then",
]);

/** The words of a name: `windowMs` is window and ms, `MAX_LIMIT` is max and limit; a trailing s is not a difference. */
export function wordsOfName(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase().replace(/s$/, ""));
}

const questionWords = (q: string): Set<string> => new Set((q.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.replace(/s$/, "")));

/** `path:line` and `path:from-to` in a text. */
const CITE = /(?<![\w/.:@-])((?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7}):(\d{1,6})(?:[-–](\d{1,6}))?(?![\w:])/g;
/** The widest cited range whose every fact is taken as named by the answer (a long range is a pointer to a region, not a claim about each line). */
const CITED_SPAN_MAX = 6;

/**
 * The facts an answer must carry: those whose name shares a word with the question (the question asks about the limit and the window; `limit` and `windowMs`),
 * and those on a line the answer cites (it says "see src/config.js:6", so what is on line 6 is what it rests on). At most six, the question's first.
 */
export function requiredFacts(facts: readonly Fact[], question: string, answer: string): Fact[] {
  const asked = questionWords(question);
  const byQuestion = facts.filter((f) => wordsOfName(f.name).some((w) => w.length >= 3 && asked.has(w)));
  const cites = [...answer.matchAll(CITE)].map((m) => ({ path: m[1]!.replace(/^\.\//, ""), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) })).filter((c) => c.to - c.from <= CITED_SPAN_MAX);
  const byCite = facts.filter((f) => cites.some((c) => c.path === f.path && f.line >= c.from && f.line <= c.to));
  const out: Fact[] = [];
  for (const f of [...byQuestion, ...byCite]) if (!out.some((o) => o.name === f.name && o.value === f.value)) out.push(f);
  return out.slice(0, 6);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a text names a fact: the identifier, in any of its spellings (`windowMs`, `window_ms`, `window ms`). */
function namesIt(text: string, f: Fact): boolean {
  const parts = f.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return new RegExp(`(?<![A-Za-z0-9])${parts.map(escapeRe).join("[\\s_\\-.]?")}(?![A-Za-z0-9])`, "i").test(text);
}

/** The ways a value is written: a number with or without separators, and (for a name in milliseconds or seconds) as a duration. */
function valueForms(f: Fact): RegExp[] {
  const v = f.value;
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const grouped = v.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const forms = [new RegExp(`(?<![\\d.])${escapeRe(v)}(?![\\d])`), new RegExp(`(?<![\\d.])${escapeRe(grouped)}(?![\\d])`), new RegExp(`(?<![\\d.])${escapeRe(grouped.replace(/,/g, " "))}(?![\\d])`)];
    const n = Number(v);
    if (/(?:ms|millis|milliseconds)$/i.test(f.name) && n >= 1000 && n % 1000 === 0) {
      const s = n / 1000;
      forms.push(new RegExp(`(?<![\\d.])${s}\\s?(?:s|sec|secs|seconds?)\\b`, "i"));
      if (s % 60 === 0) forms.push(new RegExp(`(?<![\\d.])${s / 60}\\s?(?:m|min|mins|minutes?)\\b`, "i"), ...(s === 60 ? [/\b(?:a|one)\s+minute\b/i] : []));
    }
    return forms;
  }
  if (/^(true|false|null|none|nil|undefined)$/i.test(v)) return [];
  return [new RegExp(escapeRe(v), "i")];
}

/** Whether an answer carries a fact: its name and its value. A boolean or a null is carried by its name. */
export function covers(answer: string, f: Fact): boolean {
  if (!namesIt(answer, f)) return false;
  const forms = valueForms(f);
  return forms.length === 0 || forms.some((re) => re.test(answer));
}

/** The facts the answer must carry that it does not. */
export function missingFacts(facts: readonly Fact[], question: string, answer: string): Fact[] {
  return requiredFacts(facts, question, answer).filter((f) => !covers(answer, f));
}

/** The answer with a line for what it left out, each fact with the file and line it was read at. */
export function withMissing(answer: string, missing: readonly Fact[]): string {
  if (!missing.length) return answer;
  const line = missing.map((f) => `\`${f.name}\` is ${/^-?[\d.]+$|^(true|false|null)$/i.test(f.value) ? f.value : `\`${f.value}\``} (${f.path}:${f.line})`).join("; ");
  return `${answer.trimEnd()}\n\nFrom the code: ${line}.`;
}

/** Names in an answer that point into code: what it puts in backticks, and words shaped like identifiers (camelCase, snake_case, dotted). */
function namesIn(answer: string): string[] {
  const out = new Set<string>();
  for (const m of answer.matchAll(/`([^`\n]{3,60})`/g)) for (const w of m[1]!.match(/[A-Za-z_$][\w$.]{2,}/g) ?? []) out.add(w.replace(/\.$/, ""));
  for (const w of answer.match(/\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b[a-z0-9]+_[a-z0-9_]+\b|\b[a-z]\w*\.[a-z]\w*\b/g) ?? []) out.add(w);
  return [...out].filter((w) => w.length >= 4 && !/^(?:https?|www)\b/.test(w));
}

/**
 * Where an answer comes from, when it says nowhere: the files that were read and hold a name the answer uses. An answer that cites any file read is left alone;
 * one that cites none is given the places (a question about code is answered with where it is decided, and the first reality run's answers often were not).
 */
export function sourcesFor(answer: string, texts: ReadonlyMap<string, string>, max = 3): string[] {
  const paths = [...texts.keys()].filter((p) => !isSecretPath(p));
  if (!paths.length || paths.some((p) => answer.includes(p))) return [];
  const names = namesIn(answer);
  if (!names.length) return [];
  const has = (text: string, n: string) => new RegExp(`(?<![\\w$])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`).test(text);
  return paths.filter((p) => names.some((n) => has(texts.get(p)!, n))).slice(0, max);
}

/** The answer with a line naming where it comes from (sourcesFor). */
export function withSources(answer: string, sources: readonly string[]): string {
  return sources.length ? `${answer.trimEnd()}\n\nWhere in the code: ${sources.join(", ")}.` : answer;
}

/** The facts as lines the model is shown, each with the place it can be cited at. */
export function factsBlock(facts: readonly Fact[], max = 24): string {
  return facts.slice(0, max).map((f) => `${f.path}:${f.line} — ${f.name} = ${f.value}`).join("\n");
}
