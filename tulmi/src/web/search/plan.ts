/**
 * THE SEARCH PLANNER: A QUESTION IN, A PLAN OUT, AND A MODEL ONLY WHEN THE
 * RULES ARE NOT SURE.
 *
 *   planSearch(question, ctx?, { ask? })
 *     -> { intent, queries (3 at most), sources, site?, freshness, confidence }
 *
 * WHAT KIND OF QUESTION it is decides which sources are worth asking and what
 * to ask them, and most developer questions say so in their shape:
 *
 *   error_fix       a stack trace or an error message. The one line that names
 *                   the error is quoted, with its file paths and numbers taken
 *                   out (they are the asker's, not the error's)
 *   package_lookup  "npm zod", "pip install requests", "the serde crate",
 *                   "install left-pad"
 *   compare_libs    "X vs Y", "best library for ...", "alternatives to X"
 *   version_news    "latest", "release notes", "changelog", "what's new in", "v5"
 *   api_docs        an API or method name (useEffect, fs.readFile) with a
 *                   framework, from the question or from ctx: the framework's
 *                   official documentation host is named as `site`
 *   how_to          "how do I", "how to"
 *   general         everything else
 *
 * These are rules, and they cost nothing. Each rule that fires scores its
 * intent; the highest wins, and a rival of a different kind that also scored
 * takes some of the confidence away ("how do I install node" is how_to and
 * package_lookup at once). Two kinds that agree (a how-to about an API) are
 * merged instead. Only when the confidence is under 0.7 is the injected `ask`
 * called, with a tiny JSON schema, and its plan wins; a model that is down,
 * over budget or off-schema costs only certainty: the rules' plan comes back.
 *
 * THE QUERIES ARE SCRUBBED before they are anywhere: a question is pasted from a
 * terminal, and a terminal holds tokens. Anything that looks like a key, a token,
 * a bearer header, a JWT, an e-mail address, or an address's query string is
 * removed (scrubQuery), because a query is sent to third parties and kept in
 * a cache everyone shares. planSearch never throws.
 */
import { z } from "zod";
import { docsFor, findDocsInText, nameOf, type DocsEntry } from "./catalog.js";
import { DIRECT_SOURCES, INTENTS, type AskFn, type Freshness, type Intent, type PlanCtx, type SearchPlan, type SourceId } from "./types.js";

/** Under this the rules are not trusted on their own. */
export const PLAN_CONFIDENCE_MIN = 0.7;

const QUERY_MAX = 200;
const QUESTION_MAX = 4_000;

// ------------------------------------------------------------------ scrubbing

/** The text with anything that looks like a credential, a personal address or an address's query string taken out. Its lines are kept. */
export function scrubSecrets(s: string): string {
  return s
    .replace(/\bhttps?:\/\/[^\s"'<>)\]]+/gi, (m) => {
      try {
        const u = new URL(m);
        return `${u.hostname}${u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : ""}`; // no query, no fragment, no name:password@
      } catch {
        return " ";
      }
    })
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, " ")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, " ")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, " ")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, " ")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, " ")
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]{12,}/gi, " ")
    .replace(/\b(?:token|secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|auth)[ \t]*[=:][ \t]*\S+/gi, " ")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, " ")
    // a long run that mixes letters and digits is a token, not a word
    .replace(/(?<![\w/.-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}(?![\w/-])/g, " ");
}

/** scrubSecrets on one line of text: whitespace collapsed. */
export function scrubQuery(s: string): string {
  return scrubSecrets(s).replace(/\s+/g, " ").trim();
}

/** At most `n` characters, cut at a space. */
function cutWords(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trim();
}

/** A final list of queries: scrubbed, one line each, no repeats, at most three, none empty. */
export function finishQueries(qs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of qs) {
    const t = cutWords(scrubQuery(q), QUERY_MAX);
    const k = t.toLowerCase();
    if (t.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

// ------------------------------------------------------------------- cleaning

const FILLER = /^\s*(?:hey|hi|hello|ok|okay|so|please|pls|plz|can you|could you|would you|i want to know|i need to know|tell me|help me|i have a question[:,]?)[\s,:-]+/i;
const HOW_PREFIX = /^\s*(?:how (?:do|can|could|should|would|to)(?: i| we| you| one)?(?: to)?|what(?:'s| is) the (?:best |right |correct |proper |easiest |simplest )?(?:way|syntax) to|is there a way to|how-to)\s+/i;

/** The question without its politeness, its trailing question mark, or its length. */
export function cleanQuestion(text: string, stripHow = false): string {
  let t = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 6 && FILLER.test(t); i += 1) t = t.replace(FILLER, "");
  if (stripHow) t = t.replace(HOW_PREFIX, "");
  return cutWords(t.replace(/[?!.\s]+$/, "").trim(), QUERY_MAX);
}

// -------------------------------------------------------------------- the context

const WEB_LANGS = new Set(["javascript", "typescript", "js", "ts", "html", "css", "node", "nodejs", "jsx", "tsx"]);
const lc = (a: string[] | undefined) => (a ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

type Registry = "npm" | "pypi" | "crates";

function registryOfWord(w: string): Registry | undefined {
  const x = w.toLowerCase();
  if (/^(npm|npmjs|yarn|pnpm|node|nodejs|node\.js|javascript|typescript|js|ts)$/.test(x)) return "npm";
  if (/^(pip|pip3|pypi|python|python3)$/.test(x)) return "pypi";
  if (/^(cargo|crate|crates|crates\.io|rust)$/.test(x)) return "crates";
  return undefined;
}

/** The registries to ask: from the words of the question, else from ctx, else all three. */
function registriesFor(text: string, ctx: PlanCtx, explicit?: Registry): Registry[] {
  if (explicit) return [explicit];
  const words = text.toLowerCase().match(/[a-z][a-z0-9.#+-]*/g) ?? [];
  for (const w of words) { const r = registryOfWord(w); if (r) return [r]; }
  for (const l of lc(ctx.languages)) { const r = registryOfWord(l); if (r) return [r]; }
  const fw = docsFor(ctx.framework);
  if (fw?.registry) return [fw.registry];
  return ["npm", "pypi", "crates"];
}

/** Whether the question or the project is about the web platform, where MDN is worth asking. */
function isWebish(text: string, ctx: PlanCtx, fw: DocsEntry | undefined): boolean {
  if (lc(ctx.languages).some((l) => WEB_LANGS.has(l))) return true;
  if (fw?.web) return true;
  if (lc(ctx.deps).some((d) => docsFor(d)?.web)) return true;
  return findDocsInText(text).some((d) => d.web);
}

/** Names that belong to one language's standard library or platform, so a question that uses one needs no framework named: the first word of a dotted name, or a bare one. */
const JS_GLOBALS = new Set((
  "Array Object Promise Map Set WeakMap WeakSet String Number Boolean BigInt Math JSON Date RegExp Symbol Intl Reflect Proxy Error URL URLSearchParams Blob FormData Headers Request Response " +
  "AbortController window document navigator console localStorage sessionStorage history location fetch XMLHttpRequest WebSocket Worker IntersectionObserver MutationObserver ResizeObserver " +
  "Element Node Event EventTarget HTMLElement CSS structuredClone queueMicrotask requestAnimationFrame setTimeout setInterval"
).split(" "));
const NODE_MODULES = new Set("fs child_process Buffer stream worker_threads readline zlib cluster dgram http https net os path crypto util events url process dns".split(" "));
const PY_MODULES = new Set("os sys re itertools collections pathlib subprocess asyncio datetime functools typing logging argparse shutil threading multiprocessing unittest dataclasses csv sqlite3 urllib random time string abc enum math json".split(" "));
/** Node modules that Python has under the same name: Node's, unless the project is Python. */
const SHARED_NAMES = new Set(["os", "path", "http", "https", "net", "crypto", "util", "events", "url", "process", "dns"]);

/** The documentation an API name points at, from the standard library or platform it belongs to. */
function docsOfIdentifier(ids: string[], ctx: PlanCtx): DocsEntry | undefined {
  const python = lc(ctx.languages).some((l) => l === "python" || l === "py");
  for (const id of ids) {
    const head = id.split(".")[0]!;
    if (JS_GLOBALS.has(head)) return docsFor("javascript");
    // `os` is both Python's module and Node's; these are the parts only Python's has.
    if (/^os\.(?:path|environ|getenv|getcwd|listdir|makedirs|walk|system|remove)\b/.test(id)) return docsFor("python");
    if (PY_MODULES.has(head) && id.includes(".") && (python || !NODE_MODULES.has(head))) return docsFor("python");
    if (NODE_MODULES.has(head) && id.includes(".") && !(python && SHARED_NAMES.has(head))) return docsFor("node");
  }
  return undefined;
}

/**
 * The framework a question is about: named in it, else ctx.framework, else the
 * first dependency with official docs, else the one an API name in it belongs to
 * (`Array.prototype.map` is JavaScript's, `os.path.join` Python's), else the
 * project's language.
 */
function frameworkOf(text: string, ctx: PlanCtx, ids: string[] = []): DocsEntry | undefined {
  const named = findDocsInText(text)[0];
  if (named) return named;
  const given = docsFor(ctx.framework);
  if (given) return given;
  for (const d of lc(ctx.deps)) { const e = docsFor(d); if (e && e.id !== "typescript") return e; }
  const fromName = docsOfIdentifier(ids, ctx);
  if (fromName) return fromName;
  for (const l of lc(ctx.languages)) { const e = docsFor(l === "ts" ? "typescript" : l === "js" ? "javascript" : l); if (e) return e; }
  return undefined;
}

const siteOf = (d: DocsEntry | undefined): string[] | undefined => (d ? d.hosts.slice(0, 2) : undefined);
/** One word for what the project is built with, to add to a query. */
const hintOf = (ctx: PlanCtx): string => (ctx.framework?.trim() || lc(ctx.languages)[0] || "").toLowerCase();

// -------------------------------------------------------------------- the rules

interface Candidate {
  intent: Intent;
  score: number;
  plan: Omit<SearchPlan, "confidence" | "intent">;
}

// --- error_fix ---

const FRAME = /^\s*at\s+(?:async\s+)?(?:[^\s(]+(?:\s+\[as [^\]]+\])?\s+)?\(?[^()\s]+:\d+(?::\d+)?\)?\s*$/m;
const FRAME_JAVA = /^\s*at\s+[\w$.]+\([\w$]+\.(?:java|kt|scala):\d+\)/m;
const PY_TRACE = /Traceback \(most recent call last\)|^\s*File "[^"]+", line \d+/m;
const GO_PANIC = /^panic: |^goroutine \d+ \[/m;
const NAMED = /\b(?:[A-Z][A-Za-z0-9_]*(?:Error|Exception)|Error(?=:)|ERR_[A-Z0-9_]+|E(?:NOENT|ACCES|ADDRINUSE|CONNREFUSED|PERM|EXIST|MFILE|PIPE|AI_AGAIN))\b/;
const TOOL = /(?:error TS\d+:|error\[E\d+\]:|npm ERR! |fatal: |panic: |Segmentation fault|Cannot find module|Module not found|command not found|Permission denied|No such file or directory|is not defined|is not a function|undefined is not|Unexpected token|Unhandled (?:Promise )?[Rr]ejection|exited with code \d+|cannot find (?:name|symbol)|could not (?:find|resolve|compile))/i;
const ERRORY_WORDS = /\b(?:error|exception|crash(?:es|ed|ing)?|fail(?:s|ed|ing|ure)?|not working|doesn'?t work|won'?t (?:start|build|run|compile)|bug|broken|stack ?trace)\b/i;
const FRAME_LINE = /^(?:at\s|File "|\^+$|[~^\s]+$|\d+\s*\||[>|]\s)/;

/** The one line that names the error, or null. */
function errorKeyLine(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tb = lines.findIndex((l) => /^Traceback \(most recent call last\)/.test(l));
  if (tb >= 0) {
    // Python puts the error last.
    for (let i = lines.length - 1; i > tb; i -= 1) {
      const l = lines[i]!;
      if (!FRAME_LINE.test(l) && /^[\w.]*(?:Error|Exception|Warning|Exit|Interrupt)\b/.test(l)) return l;
    }
  }
  if (lines.length > 1) {
    for (const l of lines) {
      if (FRAME_LINE.test(l)) continue;
      const m = NAMED.exec(l) ?? TOOL.exec(l);
      if (m) return l.slice(m.index);
    }
    return null;
  }
  // One line: a question that carries an error message, quoted or not.
  const one = lines[0] ?? "";
  const m = NAMED.exec(one) ?? TOOL.exec(one);
  if (!m) return null;
  // "error: port 3000 already in use EADDRINUSE": the words ahead of the code are part of the message.
  if (/^(?:error|fatal|failed|warning)\b[:\s]/i.test(one)) return one.replace(/\s+(?:when|while|after|and then|but)\s+.*$/i, "").replace(/\?.*$/, "");
  const before = one[m.index - 1];
  const closers: Record<string, string> = { '"': '"', "'": "'", "`": "`", "“": "”", "‘": "’" };
  if (before && closers[before]) {
    const end = one.lastIndexOf(closers[before]!);
    if (end > m.index) return one.slice(m.index, end);
  }
  return one.slice(m.index).replace(/\s+(?:when|while|after|and then|but)\s+.*$/i, "").replace(/\?.*$/, "");
}

/** An error line without the asker's paths, line numbers, addresses and ids, ready to be quoted. */
export function cleanErrorLine(line: string): string {
  return cutWords(
    line
      .replace(/^(?:Uncaught|Unhandled)\s+/i, "")
      .replace(/(?:[A-Za-z]:)?[\\/][\w.@~+\\/-]*\.\w{1,6}(?::\d+){0,2}/g, " ") // /src/app.ts:12:5, C:\proj\x.js
      .replace(/(?:^|\s)\.{0,2}\/[\w./@-]+/g, " ") // ./local/thing, ../up/there
      .replace(/\b[\w.-]+\.(?:[jt]sx?|mjs|cjs|py|rs|go|java|kt|rb|php|cs|cpp|c|h|vue|svelte)(?::\d+){0,2}\b/g, " ") // bare file names
      .replace(/\b0x[0-9a-f]+\b/gi, " ")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
      .replace(/\b[0-9a-f]{16,}\b/gi, " ")
      .replace(/:\d+(?::\d+)?\b/g, " ")
      .replace(/(?<![\w.-])\d+(?:\.\d+)*(?:ms|s|kb|mb|gb|b|%|px)?(?![\w.-])/gi, " ") // whole numbers, versions and sizes, never the 2345 in TS2345
      .replace(/\(\s*\)/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s:,;.-]+|[\s:,;.-]+$/g, ""),
    140,
  );
}

function detectError(text: string, ctx: PlanCtx): Candidate | null {
  const frames = FRAME.test(text) || FRAME_JAVA.test(text) || PY_TRACE.test(text) || GO_PANIC.test(text);
  const line = errorKeyLine(text);
  const key = line ? cleanErrorLine(line) : "";
  const named = NAMED.test(text) || TOOL.test(text);
  let score = 0;
  if (key.length >= 6 && frames) score = 0.95;
  else if (key.length >= 6 && /^(?:error|[\w.]*(?:Error|Exception)|ERR_\w+|E[A-Z]{3,}|error TS\d+|error\[E\d+\]|npm ERR!|fatal|panic)\b/i.test(key)) score = text.split(/\r?\n/).length > 1 ? 0.9 : 0.85;
  else if (key.length >= 6 && named) score = 0.8;
  else if (frames) score = 0.8;
  else if (ERRORY_WORDS.test(text)) score = 0.55;
  if (score === 0) return null;

  const hint = hintOf(ctx);
  const lib = /node_modules[\\/](@[\w.-]+[\\/][\w.-]+|[\w.-]+)/.exec(text)?.[1]?.replace(/\\/g, "/");
  const queries = key.length >= 6
    ? finishQueries([
      `"${key}"`,
      hint && !key.toLowerCase().includes(hint) ? `${key} ${hint}` : key,
      lib ? `${lib} ${cutWords(key, 80)}` : "",
    ])
    : finishQueries([cleanQuestion(text, true), hint ? `${cleanQuestion(text, true)} ${hint}` : ""]);
  return { intent: "error_fix", score, plan: { queries, sources: ["github", "stackoverflow"], freshness: "any" } };
}

// --- package_lookup ---

const NAME = String.raw`(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*`;
const PKG_A = new RegExp(String.raw`\b(npm|npmjs|yarn|pnpm|pip3?|pypi|cargo|crates?(?:\.io)?)\s+(?:(?:i|install|add|package|crate|module|info|show|search|called|named)\s+)*(${NAME})`, "i");
const PKG_B = new RegExp(String.raw`(?<![\w@./-])(${NAME})\s+(?:(?:npm|pip|pypi|python|node|js|rust|cargo)\s+)?(?:package|module|crate)\b`, "i");
const PKG_C = new RegExp(String.raw`\binstall\s+(${NAME})(?![\w@/-])`, "i");
const NAME_STOP = new Set((
  "the a an this that it to on in for how what is with using my your new latest best good any some all me you we i of and or not can do does why where when which who one " +
  "no named such another other package packages library libraries module modules crate crates version install add node python rust npm pip cargo yarn pnpm run start test build dev audit ci init publish exec link cache login config help which there"
).split(" "));

function pkgName(raw: string | undefined): string | null {
  const n = (raw ?? "").replace(/[.,;:!?]+$/, "");
  if (!n || n.length > 214 || NAME_STOP.has(n.toLowerCase())) return null;
  return n;
}

function detectPackage(text: string, ctx: PlanCtx): Candidate | null {
  const one = text.replace(/\s+/g, " ").trim();
  const howy = /^(?:how|why|can|could|should)\b/i.test(one);
  let name: string | null = null;
  let explicit: Registry | undefined;
  let score = 0;
  const a = PKG_A.exec(one);
  if (a && pkgName(a[2])) { name = pkgName(a[2]); explicit = registryOfWord(a[1]!); score = 0.9; }
  if (!name) {
    const b = PKG_B.exec(one);
    const bn = pkgName(b?.[1]);
    if (bn && !/\b(?:best|good|top|popular|which|any|a|an)\s+\S+\s+(?:package|module|crate)\b/i.test(one)) { name = bn; score = 0.8; }
  }
  if (!name) {
    const c = PKG_C.exec(one);
    const cn = pkgName(c?.[1]);
    if (cn && !howy && one.split(" ").length <= 8) { name = cn; score = 0.75; }
  }
  if (!name) return null;
  if (howy && score < 0.9) score -= 0.15; // "how do I use the zod package" is a how-to that names a package
  const registries = registriesFor(one, ctx, explicit);
  return { intent: "package_lookup", score, plan: { queries: finishQueries([name]), sources: [...registries, "github"], freshness: "any" } };
}

// --- compare_libs ---

const VS = /([@\w./#+-]+)\s+(?:vs\.?|versus|v\.s\.)\s+([@\w./#+-]+)/i;
const BEST = /\bbest\s+(?:[\w+#.-]+\s+){0,2}?(?:library|libraries|package|packages|framework|frameworks|tool|tools|module|modules|lib|libs)\s+(?:for|to)\s+(.+)$/i;
const ALT = /\balternatives?\s+(?:to|for)\s+([@\w./#+-]+)/i;

function detectCompare(text: string, ctx: PlanCtx): Candidate | null {
  const one = text.replace(/\s+/g, " ").trim();
  const lang = lc(ctx.languages)[0] ?? "";
  const vs = VS.exec(one);
  if (vs) {
    const x = vs[1]!.replace(/[.,;:!?]+$/, "");
    const y = vs[2]!.replace(/[.,;:!?]+$/, "");
    // Not the registries: they would be searched for the words "x vs y", and a package that happens to mention both would beat the discussion.
    return {
      intent: "compare_libs", score: 0.9,
      plan: { queries: finishQueries([`${x} vs ${y}`, `${x} vs ${y} comparison`, `${x} or ${y} which to use`]), sources: ["hn", "github"], freshness: "year" },
    };
  }
  const best = BEST.exec(one);
  if (best) {
    const subj = cleanQuestion(best[1]!.replace(/\b(?:in|with|on|for)\s+(?:2\d{3})\b/i, ""));
    return {
      intent: "compare_libs", score: 0.85,
      plan: {
        queries: finishQueries([`best ${lang} library for ${subj}`, `${subj} library comparison`, `${subj} ${lang} libraries`]),
        sources: ["hn", "github"], freshness: "year",
      },
    };
  }
  const alt = ALT.exec(one);
  if (alt) {
    const x = alt[1]!.replace(/[.,;:!?]+$/, "");
    return { intent: "compare_libs", score: 0.8, plan: { queries: finishQueries([`${x} alternatives`, `${x} vs`]), sources: ["hn", "github"], freshness: "year" } };
  }
  if (/\b(?:compare|comparison|which (?:library|package|framework|lib) (?:should|to|is|do))\b/i.test(one)) {
    return { intent: "compare_libs", score: 0.7, plan: { queries: finishQueries([cleanQuestion(one, true)]), sources: ["hn", "github"], freshness: "year" } };
  }
  return null;
}

// --- version_news ---

const NEWS_STRONG = /\b(?:release notes?|changelog|change log|what'?s new|new in|breaking changes?|new version|latest version|newest version|latest release|upgrade to|migrat\w+ to|end of life|eol|deprecat\w+)\b/i;
const NEWS_WEAK = /\b(?:latest|newest|release[sd]?)\b|\bv\d+(?:\.\d+)*\b/i;

function detectVersionNews(text: string, ctx: PlanCtx): Candidate | null {
  const one = text.replace(/\s+/g, " ").trim();
  const strong = NEWS_STRONG.test(one);
  const weak = NEWS_WEAK.test(one);
  if (!strong && !weak) return null;
  const subject = findDocsInText(one)[0] ?? docsFor(ctx.framework);
  const name = subject ? nameOf(subject) : "";
  const regs = subject?.registry ? [subject.registry] : registriesFor(one, ctx);
  const base = cleanQuestion(one, true);
  const fresh: Freshness = /\b(?:latest|newest|today|this (?:week|month)|recent(?:ly)?|just (?:released|out))\b/i.test(one) ? "month" : "year";
  return {
    intent: "version_news", score: strong ? 0.85 : 0.6,
    plan: {
      queries: finishQueries([base, name ? `${name} release notes` : "", name ? `${name} changelog` : ""]),
      sources: ["github", "hn", ...(subject ? regs.slice(0, 1) : [])],
      ...(siteOf(subject) ? { site: siteOf(subject) } : {}),
      freshness: fresh,
    },
  };
}

// --- how_to ---

const HOW_START = /^\s*(?:(?:hey|hi|ok|okay|so|please|pls|can you|could you|tell me|help me)[\s,:-]+)*(?:how (?:do|can|could|should|would|to)\b|how-to\b|what(?:'s| is) the (?:best |right |correct |proper |easiest |simplest )?(?:way|syntax) to\b|is there a way to\b)/i;
const HOW_ANY = /\b(?:how (?:do|can|could|should|would) (?:i|we|you)|how to|step by step|tutorial|guide to)\b/i;

function detectHowTo(text: string, ctx: PlanCtx): Candidate | null {
  const one = text.replace(/\s+/g, " ").trim();
  const start = HOW_START.test(one);
  if (!start && !HOW_ANY.test(one)) return null;
  const fw = frameworkOf(one, ctx);
  const hint = findDocsInText(one).length ? "" : hintOf(ctx);
  const stripped = cleanQuestion(one, true);
  const sources: SourceId[] = ["stackoverflow"];
  if (isWebish(one, ctx, fw)) sources.push("mdn");
  return {
    intent: "how_to", score: start ? 0.8 : 0.7,
    plan: {
      queries: finishQueries([hint ? `${stripped} ${hint}` : stripped, cleanQuestion(one)]),
      sources, ...(siteOf(fw) ? { site: siteOf(fw) } : {}),
      freshness: /\b(?:latest|newest|modern|2025|2026)\b/i.test(one) ? "year" : "any",
    },
  };
}

// --- api_docs ---

const NOT_IDENT_EXT = /\.(?:js|jsx|ts|tsx|mjs|cjs|json|md|py|rs|go|html|css|scss|yml|yaml|toml|lock|txt|env|sh|com|org|io|dev|net|app|ai|co|in|xml|svg|png|jpg|vue|svelte)$/i;
const NOT_IDENT_WORD = new Set(["iphone", "ipad", "macos", "ios", "ipados", "watchos", "tvos", "youtube", "javascript", "typescript", "github", "postgresql", "mongodb", "graphql", "openai", "chatgpt", "webassembly", "wordpress"]);

/**
 * API and method names in a question, the likeliest to be what is asked about
 * first: a dotted name (`Array.prototype.map`), then one in backticks, then a hook,
 * then a call, then a bare camelCase word (which is as likely to be a parameter
 * the question names, `thisArg`, as the thing it is about); within a kind, in
 * the order they appear.
 */
export function findIdentifiers(text: string): string[] {
  const found: Array<{ at: number; kind: number; id: string }> = [];
  const add = (at: number, kind: number, id: string) => {
    const t = id.replace(/\(\)$/, "").replace(/[.,;:]+$/, "");
    if (t.length < 3 || t.length > 80 || NOT_IDENT_EXT.test(t) || NOT_IDENT_WORD.has(t.toLowerCase()) || /^\d/.test(t) || /^\d+(?:\.\d+)+$/.test(t)) return;
    if (!found.some((f) => f.id === t)) found.push({ at, kind, id: t });
  };
  for (const m of text.matchAll(/(?<![\w$./-])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(?![\w$])/g)) add(m.index!, 0, m[1]!);
  for (const m of text.matchAll(/`([^`\s]{2,80})`/g)) add(m.index!, 1, m[1]!);
  for (const m of text.matchAll(/\b(use[A-Z][A-Za-z0-9]*)\b/g)) add(m.index!, 2, m[1]!);
  for (const m of text.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*\(\)/g)) add(m.index!, 3, m[1]!);
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\(\)/g)) add(m.index!, 3, m[1]!);
  for (const m of text.matchAll(/\b([a-z]+[A-Z][A-Za-z0-9]*)\b/g)) add(m.index!, 4, m[1]!);
  return found.sort((a, b) => a.kind - b.kind || a.at - b.at).map((f) => f.id);
}

function detectApi(text: string, ctx: PlanCtx): Candidate | null {
  const one = text.replace(/\s+/g, " ").trim();
  const ids = findIdentifiers(one);
  const named = findDocsInText(one)[0];
  const fw = frameworkOf(one, ctx, ids);
  const wantsDocs = /\b(?:docs?|documentation|api reference|reference|signature|parameters?|arguments?|returns?|options)\b/i.test(one);
  if (!ids.length && !(wantsDocs && fw)) return null;
  if (!fw) return ids.length ? { intent: "api_docs", score: 0.5, plan: { queries: finishQueries([cleanQuestion(one, true)]), sources: ["stackoverflow"], freshness: "any" } } : null;
  const id = ids[0];
  const fwWord = fw.id === "javascript" ? "" : nameOf(fw);
  const sources: SourceId[] = isWebish(one, ctx, fw) ? ["mdn", "stackoverflow"] : ["stackoverflow"];
  return {
    intent: "api_docs", score: id ? (named ? 0.88 : 0.85) : 0.7,
    plan: {
      queries: finishQueries([id ? `${fwWord} ${id}` : `${fwWord} ${cleanQuestion(one, true)}`, cleanQuestion(one, true)]),
      sources, site: siteOf(fw), freshness: "any",
    },
  };
}

// ------------------------------------------------------------------ the plan

/** Intents whose plans can be one plan: a how-to about an API asks the same places. */
const AGREE: ReadonlyArray<readonly [Intent, Intent]> = [["api_docs", "how_to"], ["error_fix", "how_to"], ["version_news", "package_lookup"]];
const agree = (a: Intent, b: Intent) => AGREE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
/** Which wins a tie. */
const PRIORITY: Intent[] = ["error_fix", "package_lookup", "compare_libs", "version_news", "api_docs", "how_to", "general"];

function dedupe<T>(xs: T[]): T[] { return [...new Set(xs)]; }

/** Default sources for an intent, for a plan a model made without any worth keeping. */
export function defaultSources(intent: Intent, text: string, ctx: PlanCtx): SourceId[] {
  const fw = frameworkOf(text, ctx);
  switch (intent) {
    case "package_lookup": return [...registriesFor(text, ctx), "github"];
    case "api_docs": return isWebish(text, ctx, fw) ? ["mdn", "stackoverflow"] : ["stackoverflow"];
    case "error_fix": return ["github", "stackoverflow"];
    case "how_to": return isWebish(text, ctx, fw) ? ["stackoverflow", "mdn"] : ["stackoverflow"];
    case "compare_libs": return ["hn", "github"];
    case "version_news": return ["github", "hn"];
    default: return ["stackoverflow", "wikipedia"];
  }
}

/** The plan the rules make, with a confidence. Pure and free. */
export function planByRules(question: string, ctx: PlanCtx = {}): SearchPlan {
  // Scrubbed before anything else reads it: a secret cut in half by a later truncation would no longer look like one.
  const text = scrubSecrets(String(question ?? "").slice(0, QUESTION_MAX)).trim();
  const found = [
    detectError(text, ctx), detectPackage(text, ctx), detectCompare(text, ctx), detectVersionNews(text, ctx),
    detectApi(text, ctx), detectHowTo(text, ctx),
  ].filter((c): c is Candidate => c !== null).sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.intent) - PRIORITY.indexOf(b.intent));
  // An error message is the strongest shape there is, and the names inside it (x.map, a module's name) are not API or package questions.
  const err = found.findIndex((c) => c.intent === "error_fix" && c.score >= 0.8);
  if (err > 0) found.unshift(...found.splice(err, 1));

  const top = found[0];
  if (!top || !top.plan.queries.length) {
    const q = finishQueries([cleanQuestion(text)]);
    return { intent: "general", queries: q.length ? q : [cleanQuestion(text).slice(0, 80) || "programming"], sources: defaultSources("general", text, ctx), freshness: "any", confidence: 0.4 };
  }

  let plan: Omit<SearchPlan, "confidence" | "intent"> = top.plan;
  let penalty = 0;
  for (const rival of found.slice(1)) {
    if (rival.score < 0.6) continue;
    if (agree(top.intent, rival.intent)) {
      plan = {
        ...plan,
        queries: finishQueries([...plan.queries, ...rival.plan.queries]),
        sources: dedupe([...plan.sources, ...rival.plan.sources]),
        ...(plan.site ?? rival.plan.site ? { site: plan.site ?? rival.plan.site } : {}),
      };
    } else if (!penalty && !(top.intent === "error_fix" && top.score >= 0.8) && top.score - rival.score < 0.15) {
      penalty = 0.15; // two different kinds of question, about equally likely
    }
  }
  return { intent: top.intent, ...plan, confidence: Math.round(Math.max(0.2, top.score - penalty) * 100) / 100 };
}

// ------------------------------------------------------------ the model's turn

export const ModelPlan = z.object({
  intent: z.enum(INTENTS),
  queries: z.array(z.string().min(2).max(300)).min(1).max(3),
  sources: z.array(z.enum(DIRECT_SOURCES)).max(6).default([]),
  site: z.array(z.string().max(100)).max(3).optional(),
  freshness: z.enum(["any", "year", "month"]).default("any"),
  confidence: z.number().min(0).max(1).default(0.7),
}).strict();

const HOST_SHAPE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[\w./-]*)?$/;

/** The rules' plan with what a valid model plan says laid over it. */
function merge(rules: SearchPlan, m: z.infer<typeof ModelPlan>, text: string, ctx: PlanCtx): SearchPlan {
  const queries = finishQueries(m.queries);
  const sources = dedupe(m.sources);
  const site = (m.site ?? []).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "")).filter((s) => HOST_SHAPE.test(s));
  const useSite = site.length ? site : rules.site;
  return {
    intent: m.intent,
    queries: queries.length ? queries : rules.queries,
    sources: sources.length ? sources : defaultSources(m.intent, text, ctx),
    ...(useSite?.length ? { site: useSite.slice(0, 3) } : {}),
    freshness: m.freshness,
    confidence: Math.round(Math.min(0.9, Math.max(0.3, m.confidence)) * 100) / 100,
  };
}

/**
 * The plan for a question. Rules first; when they are under 0.7 sure and an
 * `ask` is given, a tiny model has its say. Never throws.
 */
export async function planSearch(question: string, ctx: PlanCtx = {}, opts: { ask?: AskFn; signal?: AbortSignal } = {}): Promise<SearchPlan> {
  const rules = planByRules(question, ctx);
  if (rules.confidence >= PLAN_CONFIDENCE_MIN || !opts.ask) return rules;
  const text = String(question ?? "").slice(0, QUESTION_MAX).trim();
  try {
    const reply = await opts.ask({
      level: "tiny", purpose: "plan_search", role: "search_plan", json: ModelPlan, maxTokens: 300,
      ...(opts.signal ? { signal: opts.signal } : {}),
      user: JSON.stringify({
        question: scrubQuery(text).slice(0, 1_500),
        project: { languages: lc(ctx.languages).slice(0, 6), framework: ctx.framework ?? null, deps: lc(ctx.deps).slice(0, 12) },
        rules: { intent: rules.intent, queries: rules.queries },
      }),
    });
    const parsed = ModelPlan.safeParse(reply.json);
    return parsed.success ? merge(rules, parsed.data, text, ctx) : rules;
  } catch {
    // A model that is down or over budget costs certainty, not the search.
    return rules;
  }
}
