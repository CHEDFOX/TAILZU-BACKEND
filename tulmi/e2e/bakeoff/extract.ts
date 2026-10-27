/**
 * PAGE EXTRACTION BAKE-OFF (FREE: NO MODEL): OUR src/web/extract.ts AGAINST DEFUDDLE, MOZILLA READABILITY AND TRAFILATURA, ON ABOUT FORTY SAVED REAL PAGES.
 *
 *   npm run bakeoff -- --parts            runs this with the other free parts and writes the numbers to the report
 *   npm run bakeoff -- --fetch-pages      fetches the corpus once (corpus.ts) into e2e/cache/pages
 *
 * THE CONTESTANTS (all pinned, see agents/versions.json)
 *   tailzu       src/web/extract.ts: HTML in, compact markdown out
 *   defuddle     Defuddle 0.19.5 (MIT) on a linkedom DOM, `markdown: true`, no network
 *   readability  @mozilla/readability 0.6.0 (Apache-2.0) on a linkedom DOM; it returns HTML, which a small neutral converter (below) turns into text with
 *                headings, lists and fenced `<pre>` blocks, the same for everyone who returns HTML
 *   trafilatura  Trafilatura 2.3.1 (Apache-2.0), a separate Python process, `output_format="markdown"`, tables and formatting kept
 *
 * THE SCORES, on the pages that have hand-written ground truth (extract-truth.json, 15 pages):
 *   recall      the share of the page's key sentences and headings (`must`) that are in the output
 *   precision   the share of the page's furniture (`absent`: menus, banners, footers, sidebars, cookie notices) that is NOT in the output
 *   F1          the harmonic mean of the two
 *   code        the share of the page's code blocks (`code`) that came through: STRICT = every line equal, indentation and blank lines included; LOOSE = the
 *               text is there, whatever the whitespace
 * Phrases are matched on words: case, punctuation and markdown marks are ignored, so `**bold**`, a link or an escape does not hide a phrase.
 * On all pages (with or without truth): output size in tokens (a fourth of the characters), pages that came out nearly empty, errors, time.
 * The truth is checked against the pages first (checkTruth): a phrase the page does not contain, or furniture that is really in the body, is a mistake in the
 * truth file and is reported, not silently scored.
 */
import path from "node:path";
import { extract } from "../../src/web/extract.js";
import { toolBin } from "../agents/tools.js";
import { E2E_DIR, readJson, run } from "../util.js";
import { PAGES_DIR, savedPages, type PageSpec } from "./corpus.js";

// ----------------------------------------------------------------------- matching

/** Words only: lower case, every run of anything that is not a letter or a digit becomes one space. */
export const squash = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whether the output holds the phrase, as whole words in order. */
export const hasPhrase = (output: string, phrase: string): boolean => {
  const p = squash(phrase);
  return p === "" ? false : ` ${squash(output)} `.includes(` ${p} `);
};

const lines = (s: string): string[] => s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));

/** STRICT: the snippet's lines, one after another, equal to lines of the output (trailing spaces aside). */
export function codeStrict(output: string, snippet: string): boolean {
  const want = lines(snippet);
  while (want.length && want[want.length - 1] === "") want.pop();
  while (want.length && want[0] === "") want.shift();
  if (!want.length) return false;
  const have = lines(output);
  outer: for (let i = 0; i + want.length <= have.length; i += 1) {
    for (let j = 0; j < want.length; j += 1) if (have[i + j] !== want[j]) continue outer;
    return true;
  }
  return false;
}

/** LOOSE: the snippet's text is in the output, whatever the whitespace and punctuation between its words. */
export const codeLoose = (output: string, snippet: string): boolean => hasPhrase(output, snippet);

// ----------------------------------------------------------------------- truth

export interface PageTruth { must: string[]; absent: string[]; code: string[]; note?: string }
export interface TruthFile { note: string; pages: Record<string, PageTruth> }

export const loadTruth = (): TruthFile => readJson<TruthFile>(path.join(E2E_DIR, "bakeoff", "extract-truth.json"));

export interface PageScore {
  id: string;
  mustHit: number; mustTotal: number; mustMissed: string[];
  absentLeaked: string[]; absentTotal: number;
  codeStrict: number; codeLoose: number; codeTotal: number; codeLost: string[];
}

export function scorePage(output: string, t: PageTruth, id = ""): PageScore {
  const missed = t.must.filter((m) => !hasPhrase(output, m));
  const leaked = t.absent.filter((a) => hasPhrase(output, a));
  const strict = t.code.filter((c) => codeStrict(output, c));
  const loose = t.code.filter((c) => codeLoose(output, c));
  return {
    id, mustHit: t.must.length - missed.length, mustTotal: t.must.length, mustMissed: missed,
    absentLeaked: leaked, absentTotal: t.absent.length,
    codeStrict: strict.length, codeLoose: loose.length, codeTotal: t.code.length, codeLost: t.code.filter((c) => !strict.includes(c)).map((c) => c.split("\n")[0]!.slice(0, 60)),
  };
}

export interface Totals {
  recall: number; precision: number; f1: number; codeStrict: number; codeLoose: number;
  /** Counts behind the shares. */
  must: number; mustHit: number; absent: number; absentLeaked: number; code: number; codeStrictHit: number; codeLooseHit: number;
}

const share = (a: number, b: number): number => (b ? a / b : 1);

export function totalsOf(scores: readonly PageScore[]): Totals {
  const sum = (f: (s: PageScore) => number): number => scores.reduce((n, s) => n + f(s), 0);
  const must = sum((s) => s.mustTotal), mustHit = sum((s) => s.mustHit);
  const absent = sum((s) => s.absentTotal), leaked = sum((s) => s.absentLeaked.length);
  const code = sum((s) => s.codeTotal), cs = sum((s) => s.codeStrict), cl = sum((s) => s.codeLoose);
  const recall = share(mustHit, must), precision = share(absent - leaked, absent);
  return { recall, precision, f1: recall + precision ? (2 * recall * precision) / (recall + precision) : 0, codeStrict: share(cs, code), codeLoose: share(cl, code), must, mustHit, absent, absentLeaked: leaked, code, codeStrictHit: cs, codeLooseHit: cl };
}

// ----------------------------------------------------------------------- contestants

export interface Extracted { text: string; ms: number; error?: string }
export type PageIn = PageSpec & { html: string };

export interface Extractor { id: string; label: string; version: string; licence: string; run(pages: readonly PageIn[]): Promise<Record<string, Extracted>> }

const timed = async (f: () => Promise<string> | string): Promise<Extracted> => {
  const t0 = performance.now();
  try { return { text: await f(), ms: performance.now() - t0 }; } catch (err) { return { text: "", ms: performance.now() - t0, error: (err as Error).message.slice(0, 160) }; }
};

export const tailzuExtractor: Extractor = {
  id: "tailzu", label: "Tailzu src/web/extract.ts", version: "in tree", licence: "ours",
  async run(pages) { const o: Record<string, Extracted> = {}; for (const p of pages) o[p.id] = await timed(() => extract(p.html, p.url).text); return o; },
};

/** Text with markdown-ish structure from HTML, for contestants that return HTML. Pure; a DOM is given (linkedom's). */
export function htmlToText(root: any): string {
  const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "footer", "aside", "nav", "blockquote", "figure", "figcaption", "ul", "ol", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "details", "summary", "form", "fieldset", "hr", "address"]);
  const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);
  const out: string[] = [];
  const walk = (n: any): void => {
    if (n.nodeType === 3) { out.push(String(n.nodeValue).replace(/\s+/g, " ")); return; }
    if (n.nodeType !== 1) return;
    const tag = String(n.tagName).toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === "pre") { out.push(`\n\n\`\`\`\n${String(n.textContent).replace(/^\n+|\n+$/g, "")}\n\`\`\`\n\n`); return; }
    if (tag === "br") { out.push("\n"); return; }
    if (/^h[1-6]$/.test(tag)) { out.push(`\n\n${"#".repeat(Number(tag[1]))} `); for (const c of n.childNodes) walk(c); out.push("\n\n"); return; }
    if (tag === "li") { out.push("\n- "); for (const c of n.childNodes) walk(c); return; }
    if (tag === "td" || tag === "th") { out.push(" | "); for (const c of n.childNodes) walk(c); return; }
    if (tag === "code") { out.push("`"); for (const c of n.childNodes) walk(c); out.push("`"); return; }
    const block = BLOCK.has(tag);
    if (block) out.push("\n");
    for (const c of n.childNodes) walk(c);
    if (block) out.push("\n");
  };
  walk(root);
  // Tidy the spaces and blank lines of the prose, but never inside a fenced block: its indentation is the point.
  return out.join("").split(/(```[\s\S]*?```)/).map((part, i) => (i % 2 ? part : part.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+(?=\S)/g, "\n"))).join("").replace(/\n{3,}/g, "\n\n").trim();
}

export const defuddleExtractor: Extractor = {
  id: "defuddle", label: "Defuddle (markdown)", version: "0.19.5", licence: "MIT",
  async run(pages) {
    const { parseHTML } = await import("linkedom");
    const { Defuddle } = await import("defuddle/node");
    const o: Record<string, Extracted> = {};
    for (const p of pages) {
      o[p.id] = await timed(async () => {
        const { document } = parseHTML(p.html) as { document: any };
        const r = await Defuddle(document as never, p.url, { markdown: true, useAsync: false } as never);
        return String((r as { content?: string }).content ?? "");
      });
    }
    return o;
  },
};

export const readabilityExtractor: Extractor = {
  id: "readability", label: "Mozilla Readability + text", version: "0.6.0", licence: "Apache-2.0",
  async run(pages) {
    const { parseHTML } = await import("linkedom");
    const mod = (await import("@mozilla/readability")) as { Readability?: unknown; default?: { Readability?: unknown } };
    const Readability = mod.Readability ?? mod.default?.Readability;
    const o: Record<string, Extracted> = {};
    for (const p of pages) {
      o[p.id] = await timed(() => {
        const { document } = parseHTML(p.html) as { document: any };
        const article = new (Readability as any)(document).parse() as { content?: string; title?: string } | null;
        if (!article?.content) return "";
        const { document: inner } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`) as { document: any };
        return `${article.title ? `# ${article.title}\n\n` : ""}${htmlToText(inner.body)}`;
      });
    }
    return o;
  },
};

export const trafilaturaExtractor: Extractor = {
  id: "trafilatura", label: "Trafilatura (markdown)", version: "2.3.1", licence: "Apache-2.0",
  async run(pages) {
    const py = toolBin("trafilatura");
    if (!py) throw new Error("trafilatura is not installed: npm run e2e:tools -- install trafilatura");
    const r = await run(py, ["-I", path.join(E2E_DIR, "bakeoff", "py", "trafilatura_run.py"), PAGES_DIR, ...pages.map((p) => p.id)], { timeoutMs: 600_000, env: { PATH: "/usr/bin:/bin", HOME: path.join(PAGES_DIR, "..", "tools", ".home") } });
    if (r.code !== 0) throw new Error(`trafilatura failed: ${r.stderr.trim().slice(-300)}`);
    const j = JSON.parse(r.stdout) as Record<string, { text: string; ms: number; error?: string }>;
    return Object.fromEntries(Object.entries(j).map(([id, v]) => [id, { text: v.text, ms: v.ms, ...(v.error ? { error: v.error } : {}) }]));
  },
};

export const EXTRACTORS: readonly Extractor[] = [tailzuExtractor, defuddleExtractor, readabilityExtractor, trafilaturaExtractor];

// ----------------------------------------------------------------------- checking the truth against the pages

/** `absent-in-main` is a warning to read, not a mistake: a site may put its furniture (an "Edit this page" link, a post navigation) inside its <main> element. */
export interface TruthProblem { page: string; kind: "must-not-in-page" | "absent-not-in-page" | "absent-in-main" | "code-not-in-page"; text: string }

/** Every entry of the truth against the page it is about, with a neutral parser (lxml, in the trafilatura venv). Returns the mistakes found. */
export async function checkTruth(truth: TruthFile, ids: readonly string[]): Promise<{ problems: TruthProblem[]; checked: number; skipped?: string }> {
  const py = toolBin("trafilatura");
  if (!py) return { problems: [], checked: 0, skipped: "trafilatura (and its lxml) is not installed, so the truth could not be checked against the pages" };
  const todo = ids.filter((i) => truth.pages[i]);
  const r = await run(py, ["-I", path.join(E2E_DIR, "bakeoff", "py", "visible_text.py"), PAGES_DIR, ...todo], { timeoutMs: 120_000, env: { PATH: "/usr/bin:/bin" } });
  if (r.code !== 0) return { problems: [], checked: 0, skipped: `the page reader failed: ${r.stderr.trim().slice(-200)}` };
  const pages = JSON.parse(r.stdout) as Record<string, { text: string; main: string; mainIsBody: boolean; pres: string[] }>;
  const problems: TruthProblem[] = [];
  for (const id of todo) {
    const t = truth.pages[id]!, p = pages[id]!;
    for (const m of t.must) if (!hasPhrase(p.text, m)) problems.push({ page: id, kind: "must-not-in-page", text: m });
    for (const a of t.absent) {
      if (!hasPhrase(p.text, a)) problems.push({ page: id, kind: "absent-not-in-page", text: a });
      else if (!p.mainIsBody && hasPhrase(p.main, a)) problems.push({ page: id, kind: "absent-in-main", text: a });
    }
    for (const c of t.code) if (!p.pres.some((x) => hasPhrase(x, c) && codeStrict(x, c))) problems.push({ page: id, kind: "code-not-in-page", text: c.split("\n")[0]!.slice(0, 60) });
  }
  return { problems, checked: todo.length };
}

// ----------------------------------------------------------------------- the bake-off

export interface ExtractorResult {
  id: string; label: string; version: string; licence: string;
  withTruth: Totals;
  perPage: PageScore[];
  /** Over all pages that were run. */
  pages: number; meanTokens: number; medianTokens: number; nearlyEmpty: number; errors: number; msTotal: number; error?: string;
}

export interface ExtractionBakeoff {
  at: string;
  pages: number;
  truthPages: number;
  results: ExtractorResult[];
  winner: { id: string; by: string; margin: string } | null;
  ranking: Array<{ id: string; f1: number; codeStrict: number }>;
  truthCheck: { problems: TruthProblem[]; checked: number; skipped?: string };
  corpus: Array<{ id: string; kind: string; bytes: number }>;
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };

export async function runExtractionBakeoff(o: { extractors?: readonly Extractor[]; pages?: readonly PageIn[]; truth?: TruthFile; checkTruthToo?: boolean; log?: (s: string) => void } = {}): Promise<ExtractionBakeoff> {
  const log = o.log ?? (() => undefined);
  const pages = o.pages ?? savedPages();
  if (!pages.length) throw new Error("no saved pages: run `npm run bakeoff -- --fetch-pages` first");
  const truth = o.truth ?? loadTruth();
  const truthIds = pages.map((p) => p.id).filter((i) => truth.pages[i]);
  const results: ExtractorResult[] = [];
  for (const ex of o.extractors ?? EXTRACTORS) {
    log(`extract: ${ex.id} on ${pages.length} pages`);
    let out: Record<string, Extracted> = {};
    let error: string | undefined;
    try { out = await ex.run(pages); } catch (err) { error = (err as Error).message.slice(0, 200); }
    const perPage = truthIds.filter((i) => out[i]).map((i) => scorePage(out[i]!.text, truth.pages[i]!, i));
    const tokens = Object.values(out).map((x) => Math.ceil(x.text.length / 4));
    results.push({
      id: ex.id, label: ex.label, version: ex.version, licence: ex.licence, withTruth: totalsOf(perPage), perPage, pages: Object.keys(out).length,
      meanTokens: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0, medianTokens: median(tokens),
      nearlyEmpty: Object.values(out).filter((x) => x.text.trim().length < 200).length, errors: Object.values(out).filter((x) => x.error).length, msTotal: Math.round(Object.values(out).reduce((n, x) => n + x.ms, 0)),
      ...(error ? { error } : {}),
    });
  }
  const ok = results.filter((r) => !r.error);
  const ranking = [...ok].sort((a, b) => b.withTruth.f1 - a.withTruth.f1 || b.withTruth.codeStrict - a.withTruth.codeStrict).map((r) => ({ id: r.id, f1: r.withTruth.f1, codeStrict: r.withTruth.codeStrict }));
  const best = ranking[0], second = ranking[1];
  const winner = best ? { id: best.id, by: "F1 of recall and precision", margin: second ? `${((best.f1 - second.f1) * 100).toFixed(1)} points over ${second.id}` : "no other contestant ran" } : null;
  const truthCheck = o.checkTruthToo === false ? { problems: [], checked: 0, skipped: "not asked" } : await checkTruth(truth, truthIds);
  return {
    at: new Date().toISOString(), pages: pages.length, truthPages: truthIds.length, results, winner, ranking, truthCheck,
    corpus: pages.map((p) => ({ id: p.id, kind: p.kind, bytes: p.html.length })),
  };
}

export function renderExtraction(r: ExtractionBakeoff): string {
  const pc = (x: number): string => `${(x * 100).toFixed(1)}%`.padStart(6);
  const L = [`PAGE EXTRACTION: ${r.pages} saved pages, hand-written truth on ${r.truthPages}`];
  L.push(`${"extractor".padEnd(13)} ${"recall".padStart(7)} ${"precision".padStart(9)} ${"F1".padStart(6)} ${"code exact".padStart(11)} ${"code text".padStart(10)} ${"tok/page".padStart(9)} ${"empty".padStart(6)} ${"err".padStart(4)} ${"ms".padStart(7)}`);
  for (const x of r.results) L.push(`${x.id.padEnd(13)} ${pc(x.withTruth.recall).padStart(7)} ${pc(x.withTruth.precision).padStart(9)} ${pc(x.withTruth.f1)} ${pc(x.withTruth.codeStrict).padStart(11)} ${pc(x.withTruth.codeLoose).padStart(10)} ${String(x.meanTokens).padStart(9)} ${String(x.nearlyEmpty).padStart(6)} ${String(x.errors).padStart(4)} ${String(x.msTotal).padStart(7)}${x.error ? `  (${x.error})` : ""}`);
  if (r.winner) L.push(`winner: ${r.winner.id}, ${r.winner.margin} (${r.winner.by})`);
  if (r.truthCheck.skipped) L.push(`truth check: ${r.truthCheck.skipped}`);
  else {
    const errors = r.truthCheck.problems.filter((p) => p.kind !== "absent-in-main");
    L.push(`truth check: ${r.truthCheck.checked} pages, ${errors.length} mistake(s), ${r.truthCheck.problems.length - errors.length} warning(s)${r.truthCheck.problems.slice(0, 8).map((p) => `\n   ${p.page}: ${p.kind}: ${p.text.slice(0, 70)}`).join("")}`);
  }
  return L.join("\n");
}

