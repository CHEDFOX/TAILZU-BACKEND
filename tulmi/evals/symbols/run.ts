/**
 * SYMBOL READING, REGEX AGAINST TREE-SITTER: PRECISION AND RECALL AGAINST GOLD.   npm run bench:symbols [-- --json out.json]
 *
 * Two grounds:
 *   fixtures   one hand-written file per language (gold.ts), definitions, routes and imports
 *   tulmi/src  every TypeScript file of this app, with the TypeScript compiler API (truth.ts) as the truth: ~700 files that nobody wrote a fixture for
 *
 * Both readers run on the same text: `extractSymbolsRegex` / `extractImportsRegex` (the regex path, always available) and the parser path
 * (`analyse`, tree-sitter), after the grammars are loaded.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { extractImports, extractImportsRegex } from "../../src/code/project/graph.js";
import { extractSymbols, extractSymbolsRegex } from "../../src/code/project/symbols.js";
import { ensureGrammars, analyse, forgetFacts } from "../../src/code/project/treesitter/index.js";
import { SYMBOLS_PER_FILE } from "../../src/code/project/types.js";
import { GOLD } from "./gold.js";
import { add, emptyTally, f1, fromSymbols, pct, precision, recall, scoreDefs, scoreList, type Def, type Tally } from "./score.js";
import { importsOf, truthOf } from "./truth.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "src");

export interface Row { name: string; regex: Tally; treeSitter: Tally }

/** The specifiers of a file, once each: a file that imports a module twice (a type import and a value import) names it once. */
const importSpecs = (xs: ReadonlyArray<{ spec: string; level?: number }>): string[] => [...new Set(xs.map((i) => `${".".repeat(i.level ?? 0)}${i.spec}`))];
const routesOf = (symbols: ReadonlyArray<{ kind: string; method?: string; path?: string }>): string[] => symbols.filter((s) => s.kind === "route").map((s) => `${s.method} ${s.path}`);

export async function fixtureRows(): Promise<{ defs: Row[]; routes: Row; imports: Row }> {
  await ensureGrammars(GOLD.map((g) => ({ path: g.path, lang: g.langName })));
  const defs: Row[] = [];
  const routes: Row = { name: "routes", regex: emptyTally(), treeSitter: emptyTally() };
  const imports: Row = { name: "imports", regex: emptyTally(), treeSitter: emptyTally() };
  for (const g of GOLD) {
    forgetFacts();
    const gold: Def[] = g.defs.map(([name, kind, exported]) => ({ name, kind, exported }));
    const rx = extractSymbolsRegex(g.path, g.langName, g.code);
    const ts = analyse(g.path, g.langName, g.code);
    if (!ts) throw new Error(`no parser result for ${g.path}`);
    defs.push({ name: g.lang, regex: scoreDefs(fromSymbols(rx), gold), treeSitter: scoreDefs(fromSymbols(ts.symbols), gold) });
    if (g.routes) {
      add(routes.regex, scoreList(routesOf(rx), g.routes));
      add(routes.treeSitter, scoreList(routesOf(ts.symbols), g.routes));
    }
    if (g.imports) {
      add(imports.regex, scoreList(importSpecs(extractImportsRegex(g.path, g.langName, g.code)), g.imports));
      add(imports.treeSitter, scoreList(importSpecs(ts.imports), g.imports));
    }
  }
  return { defs, routes, imports };
}

export function tsFiles(dir = SRC): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !n.endsWith(".d.ts")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export interface Corpus { files: number; /** Files left out because they have more definitions than a row keeps. */ capped: number; /** Files the parser declined (too big, too long a line, or mostly syntax error), which the shipped reader reads by regex. */ declined: number; bytes: number; buckets: Record<"exported" | "top" | "all", Row>; imports: Row; lang: Row }

/** The TypeScript files of tulmi/src against the compiler's own reading. */
export async function corpusRows(files = tsFiles()): Promise<Corpus> {
  const texts = files.map((f) => ({ path: relative(SRC, f), text: readFileSync(f, "utf8") }));
  await ensureGrammars(texts.map((t) => ({ path: t.path, lang: "TypeScript" })));
  const pick = {
    exported: (d: Def) => d.exported && d.kind !== "method",
    top: (d: Def) => d.kind !== "method",
    all: () => true,
  } as const;
  const buckets = { exported: { name: "exported top-level", regex: emptyTally(), treeSitter: emptyTally() }, top: { name: "all top-level", regex: emptyTally(), treeSitter: emptyTally() }, all: { name: "top-level and methods", regex: emptyTally(), treeSitter: emptyTally() } };
  const imports: Row = { name: "imports", regex: emptyTally(), treeSitter: emptyTally() };
  const lang: Row = { name: "all", regex: emptyTally(), treeSitter: emptyTally() };
  let bytes = 0, declined = 0, capped = 0;
  for (const t of texts) {
    forgetFacts();
    bytes += t.text.length;
    const truth = truthOf(t.path, t.text);
    // A file with more definitions than a row keeps (SYMBOLS_PER_FILE) is cut by the cap, whichever reader reads it: it says nothing about the readers.
    if (truth.length > SYMBOLS_PER_FILE) { capped += 1; continue; }
    const rx = fromSymbols(extractSymbolsRegex(t.path, "TypeScript", t.text));
    // The parser column is the reader as it ships: tree-sitter where it takes the file, the regex where it declines.
    if (!analyse(t.path, "TypeScript", t.text)) declined += 1;
    const tsd = fromSymbols(extractSymbols(t.path, "TypeScript", t.text));
    for (const [k, f] of Object.entries(pick) as Array<[keyof typeof pick, (d: Def) => boolean]>) {
      add(buckets[k].regex, scoreDefs(rx.filter(f), truth.filter(f)));
      add(buckets[k].treeSitter, scoreDefs(tsd.filter(f), truth.filter(f)));
    }
    const gi = [...new Set(importsOf(t.path, t.text))];
    add(imports.regex, scoreList(importSpecs(extractImportsRegex(t.path, "TypeScript", t.text)), gi));
    add(imports.treeSitter, scoreList(importSpecs(extractImports(t.path, "TypeScript", t.text)), gi));
  }
  return { files: texts.length - capped, declined, capped, bytes, buckets, imports, lang };
}

const line = (label: string, t: Tally): string =>
  `${label.padEnd(24)} P ${pct(precision(t)).padStart(6)}  R ${pct(recall(t)).padStart(6)}  F1 ${pct(f1(t)).padStart(6)}   tp ${String(t.tp).padStart(5)} fp ${String(t.fp).padStart(4)} fn ${String(t.fn).padStart(4)}`
  + (t.flagN ? `   exported-flag ${pct(t.flagOk / t.flagN)}` : "") + (t.lineN ? `   line ${pct(t.lineOk / t.lineN)}` : "") + (t.endN ? `   endLine ${pct(t.endOk / t.endN)}` : "");

const DETAILS = process.argv.includes("--details");

export function print(title: string, rows: Row[]): void {
  console.log(`\n${title}`);
  for (const r of rows) {
    console.log(line(`${r.name} regex`, r.regex));
    console.log(line(`${r.name} tree-sitter`, r.treeSitter));
    if (DETAILS) for (const [who, t] of [["regex", r.regex], ["tree-sitter", r.treeSitter]] as const) {
      if (t.extra?.length) console.log(`    ${who} extra: ${t.extra.slice(0, 12).join(", ")}`);
      if (t.missed?.length) console.log(`    ${who} missed: ${t.missed.slice(0, 12).join(", ")}`);
      if (t.flagged?.length) console.log(`    ${who} flag: ${t.flagged.slice(0, 8).join(", ")}`);
    }
  }
}

async function main(): Promise<void> {
  const fx = await fixtureRows();
  const total: Row = { name: "all 11 languages", regex: emptyTally(), treeSitter: emptyTally() };
  for (const r of fx.defs) { add(total.regex, r.regex); add(total.treeSitter, r.treeSitter); }
  print("FIXTURES, definitions per language", [...fx.defs, total]);
  print("FIXTURES, routes and imports", [fx.routes, fx.imports]);
  const c = await corpusRows();
  console.log(`\ntulmi/src: ${c.files} TypeScript files (${c.capped} left out: more definitions than one row keeps), ${(c.bytes / 1e6).toFixed(1)} MB (${c.declined} read by regex because the parser declined them), truth = the TypeScript compiler API`);
  print("tulmi/src, definitions", [c.buckets.exported, c.buckets.top, c.buckets.all]);
  print("tulmi/src, imports", [c.imports]);
  const out = process.argv.indexOf("--json");
  if (out > 0 && process.argv[out + 1]) writeFileSync(process.argv[out + 1]!, JSON.stringify({ fixtures: fx, corpus: c }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
