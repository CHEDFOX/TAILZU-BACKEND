/**
 * ONE FILE, READ WITH A PARSER: ITS SYMBOLS, ITS ROUTES, ITS IMPORTS, THE NAMES IT REFERS TO, AND THE WORDS A PERSON READS IN IT.
 *
 * `analyse` parses the text once and runs the language's queries on the tree (queries/<language>/*.scm); langs.ts turns what they matched
 * into symbols. It returns null whenever the regex readers should be used instead: the grammar is not loaded (the Worker carries only some,
 * a runtime may refuse them, CODE_TREE_SITTER is off), the file is too big or too long-lined, the parse timed out, or so much of the file is
 * a syntax error that the tree would say less than a regex. A file in a language with no grammar never gets here.
 *
 * The result is remembered for the last few files, so that symbols.ts, graph.ts and texts.ts, which each ask for their own part, share one parse.
 *
 * Environment variables and the entry marks a few languages have are read as the regex path reads them (symbols.ts ENV): they are a line of
 * code each, and a regex finds `process.env.KEY` as well as a tree does.
 */
import type { Node } from "web-tree-sitter";
import type { RawImport } from "../graph.js";
import { blankComments, ENV, JS_LIKE, PY_LIKE, C_LIKE, HASH_LIKE, DART_LIKE, Out, capped, envNames, lineStarts, type BlankOptions } from "../symbolkit.js";
import { REFS_PER_FILE, type SymbolInfo, type TextKind } from "../types.js";
import { treeSitter, type GrammarId } from "./host.js";
import { ADAPTERS, row, type Def, type Match, type Rt } from "./langs.js";
import { combinedSource } from "./queries.js";

/** A string a person may read, as found: the caller cleans it (texts.ts cleanText) and judges it. */
export interface RawText { line: number; raw: string; kind: TextKind; /** Judge it as visible text rather than as an attribute value. */ code: boolean }

export interface TsFacts {
  /** The grammar that read it. */
  grammar: GrammarId;
  symbols: SymbolInfo[];
  imports: RawImport[];
  /** Names referred to, with how often, most telling first. */
  refs: Array<[string, number]>;
  /** Null for a language whose text this does not read (the regex does). */
  texts: RawText[] | null;
}

// ----------------------------------------------------------- which grammar

export interface Pick { id: GrammarId; code: string; lineOffset: number; jsx: boolean }

/** The grammar for a file, and the part of it to parse (a Vue file's script). Null when no grammar does this language. */
export function pickGrammar(path: string, lang: string, text: string): Pick | null {
  switch (lang) {
    case "TypeScript": return { id: /\.tsx$/i.test(path) ? "tsx" : "typescript", code: text, lineOffset: 0, jsx: /\.tsx$/i.test(path) };
    case "JavaScript": return { id: "javascript", code: text, lineOffset: 0, jsx: /\.jsx$/i.test(path) || /<\/[A-Za-z]|\/>/.test(text) };
    case "Vue": case "Svelte": case "Astro": {
      const script = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(text);
      if (!script) return null;
      const lang2 = /<script[^>]*\blang=["'](?:ts|tsx)["']/i.test(text) ? "typescript" : "javascript";
      return { id: lang2, code: script[1]!, lineOffset: text.slice(0, script.index).split("\n").length - 1, jsx: false };
    }
    case "Python": return { id: "python", code: text, lineOffset: 0, jsx: false };
    case "Go": return { id: "go", code: text, lineOffset: 0, jsx: false };
    case "Rust": return { id: "rust", code: text, lineOffset: 0, jsx: false };
    case "Java": return { id: "java", code: text, lineOffset: 0, jsx: false };
    case "Kotlin": return { id: "kotlin", code: text, lineOffset: 0, jsx: false };
    case "Ruby": return { id: "ruby", code: text, lineOffset: 0, jsx: false };
    case "PHP": return { id: "php", code: text, lineOffset: 0, jsx: false };
    case "Swift": return { id: "swift", code: text, lineOffset: 0, jsx: false };
    case "C#": return { id: "c_sharp", code: text, lineOffset: 0, jsx: false };
    case "Dart": return { id: "dart", code: text, lineOffset: 0, jsx: false };
    case "HTML": return { id: "html", code: text, lineOffset: 0, jsx: false };
    default: return null;
  }
}

/** The grammars a set of files needs, for `ensure`. */
export function grammarsFor(files: Iterable<{ path: string; lang: string }>): GrammarId[] {
  const ids = new Set<GrammarId>();
  for (const f of files) {
    const g = pickGrammar(f.path, f.lang, f.lang === "Vue" || f.lang === "Svelte" || f.lang === "Astro" ? "<script></script>" : "");
    if (g) ids.add(g.id);
    // A Vue file's script may be TypeScript.
    if (f.lang === "Vue" || f.lang === "Svelte" || f.lang === "Astro") ids.add("typescript");
  }
  return [...ids];
}

// -------------------------------------------------------------------- run

/** The capture that names what a match IS (the statement, the call, the annotation); the rest are its parts (@name, @verb, @path...). */
const ROOT_CAPTURE = /^(?:route|import|export|cjs|definition|reference)(?:\.|$)/;

/** What the queries found in a file, told apart by what they were looking for. */
interface Found { tags: Match[]; imports: Match[]; routes: Match[]; text: Match[] }

/** Runs the grammar's one combined query over the tree and sorts its matches. */
function findAll(id: GrammarId, root: Node): Found | null {
  const src = combinedSource(id);
  if (!src) return null;
  const q = treeSitter.query(id, "all", src);
  if (!q) return null;
  const found: Found = { tags: [], imports: [], routes: [], text: [] };
  for (const m of q.matches(root)) {
    const caps: Record<string, Node> = {};
    let tag = "";
    for (const c of m.captures) {
      caps[c.name] = c.node;
      if (!tag && ROOT_CAPTURE.test(c.name)) tag = c.name;
    }
    const match: Match = { caps, tag };
    if (tag.startsWith("definition.") || tag.startsWith("reference.") || tag === "export" || tag === "cjs.root") found.tags.push(match);
    else if (tag.startsWith("import")) found.imports.push(match);
    else if (tag.startsWith("route")) found.routes.push(match);
    else found.text.push(match);
  }
  return found;
}

/** Names too common to say anything about a file (the language's own library, test words): kept out of the references. */
const COMMON = new Set([
  "console", "log", "error", "warn", "info", "debug", "push", "pop", "map", "filter", "reduce", "forEach", "join", "split", "slice", "splice", "includes", "indexOf", "toString",
  "then", "catch", "finally", "get", "set", "has", "add", "delete", "keys", "values", "entries", "test", "expect", "describe", "it", "beforeEach", "afterEach", "String", "Number",
  "Boolean", "Array", "Object", "Promise", "Error", "Map", "Set", "Date", "JSON", "Math", "Buffer", "RegExp", "require", "resolve", "reject", "length", "print", "len", "range",
  "str", "int", "float", "list", "dict", "super", "self", "this", "new", "format", "append", "extend", "open", "close", "read", "write", "init", "main", "run", "call", "apply",
  "string", "bool", "byte", "rune", "error", "int64", "int32", "uint", "uint8", "uint64", "float64", "float32", "String", "Int", "Bool", "Double", "Void", "Any", "Result", "Option", "Vec", "Box", "Some", "None", "Ok", "Err", "println", "fmt", "make", "panic", "Println", "Sprintf", "Errorf",
]);

/** Distinctive names (camelCase, PascalCase, snake_case, long) come before plain ones, then the more often used. */
function rankRefs(counts: Map<string, number>): Array<[string, number]> {
  const distinctive = (n: string): boolean => n.length >= 8 || /[a-z][A-Z]/.test(n) || /^[A-Z][a-z]+[A-Z]/.test(n) || (n.includes("_") && n.length >= 6);
  return [...counts.entries()]
    .sort((a, b) => Number(distinctive(b[0])) - Number(distinctive(a[0])) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, REFS_PER_FILE);
}

const ENV_FAMILY: Partial<Record<GrammarId, { patterns: readonly RegExp[]; blank: BlankOptions }>> = {
  typescript: { patterns: ENV.js, blank: JS_LIKE }, tsx: { patterns: ENV.js, blank: JS_LIKE }, javascript: { patterns: ENV.js, blank: JS_LIKE },
  python: { patterns: ENV.py, blank: PY_LIKE }, go: { patterns: ENV.go, blank: C_LIKE }, rust: { patterns: ENV.rust, blank: C_LIKE },
  java: { patterns: ENV.java, blank: C_LIKE }, kotlin: { patterns: ENV.java, blank: C_LIKE }, dart: { patterns: ENV.dart, blank: DART_LIKE },
  ruby: { patterns: ENV.ruby, blank: HASH_LIKE }, php: { patterns: ENV.php, blank: { ...C_LIKE, hash: true, apostrophe: "string" } },
  swift: { patterns: ENV.swift, blank: { ...C_LIKE, apostrophe: "string" } }, c_sharp: { patterns: ENV.csharp, blank: C_LIKE },
};

function textsOf(id: GrammarId, matches: Match[], lineOffset: number): RawText[] | null {
  if (id !== "tsx" && id !== "javascript" && id !== "html") return null;
  const out: RawText[] = [];
  const kind: TextKind = id === "html" ? "html" : "jsx";
  for (const m of matches) {
    const t = m.caps["text"];
    const lit = m.caps["literal"];
    const attr = m.caps["attr.value"];
    if (t) {
      const raw = t.text;
      const lead = raw.length - raw.trimStart().length;
      out.push({ line: row(t) + (raw.slice(0, lead).match(/\n/g)?.length ?? 0) + lineOffset, raw, kind, code: true });
    } else if (lit) {
      // {"literal"} as a child; one inside an attribute is read as that attribute's value.
      if (lit.parent?.parent?.parent?.type === "jsx_attribute") continue;
      out.push({ line: row(lit) + lineOffset, raw: lit.text, kind: "jsx", code: true });
    } else if (attr) {
      out.push({ line: row(attr) + lineOffset, raw: attr.text, kind: "attr", code: false });
    }
  }
  return out;
}

/** How much of the text is syntax error. */
function errorShare(root: Node, length: number): number {
  if (!root.hasError || !length) return 0;
  let bad = 0;
  for (const e of root.descendantsOfType("ERROR")) bad += e.endIndex - e.startIndex;
  return bad / length;
}

const ERROR_SHARE_MAX = 0.25;

function run(path: string, lang: string, text: string): TsFacts | null {
  const pick = pickGrammar(path, lang, text);
  if (!pick || !treeSitter.isReady(pick.id)) return null;
  const adapter = ADAPTERS[pick.id];
  if (!adapter) return null;
  const tree = treeSitter.parse(pick.id, pick.code);
  if (!tree) return null;
  try {
    const root = tree.rootNode;
    if (errorShare(root, pick.code.length) > ERROR_SHARE_MAX) return null;
    const rt: Rt = { id: pick.id, lang, path, text: pick.code, root, jsx: pick.jsx };
    const out = new Out();

    const found = findAll(pick.id, root);
    if (!found) return null;

    // definitions and references
    const tagMatches = found.tags;
    const defs: Def[] = [];
    const nameAt = new Set<number>();
    const counts = new Map<string, number>();
    const refCaps: Node[] = [];
    for (const m of tagMatches) {
      const name = m.caps["name"];
      const defKey = Object.keys(m.caps).find((k) => k.startsWith("definition."));
      const refKey = Object.keys(m.caps).find((k) => k.startsWith("reference."));
      if (defKey && name) {
        defs.push({ kind: defKey.slice("definition.".length), node: m.caps[defKey]!, name, caps: m.caps });
        nameAt.add(name.startIndex);
      } else if (refKey && name) refCaps.push(name);
    }
    adapter.defs(rt, defs, out, tagMatches);
    for (const n of refCaps) {
      if (nameAt.has(n.startIndex)) continue;
      const t = n.text;
      if (t.length < 3 || COMMON.has(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }

    // routes
    if (adapter.routes && found.routes.length) adapter.routes(rt, found.routes, out);
    // environment variables
    const env = ENV_FAMILY[pick.id];
    if (env) {
      const code = blankComments(pick.code, env.blank);
      envNames(code, env.patterns as RegExp[], out, lineStarts(code));
    }

    // imports
    const imports: RawImport[] = [];
    if (adapter.imports) {
      const seen = new Set<string>();
      for (const i of adapter.imports(rt, found.imports)) {
        const key = `${i.level ?? 0}|${i.spec}|${(i.names ?? []).join(",")}`;
        if (!i.spec && !(i.level ?? 0)) continue;
        if (!seen.has(key) && imports.length < 400) { seen.add(key); imports.push(i); }
      }
    }

    const symbols = capped(out.items).map((s) => (pick.lineOffset ? { ...s, line: s.line + pick.lineOffset, ...(s.endLine ? { endLine: s.endLine + pick.lineOffset } : {}) } : s));
    return { grammar: pick.id, symbols, imports, refs: rankRefs(counts), texts: textsOf(pick.id, found.text, pick.lineOffset) };
  } catch {
    return null;
  } finally {
    tree.delete();
  }
}

// ----------------------------------------------------------------- the door

const memo = new Map<string, { text: string; facts: TsFacts | null }>();
const MEMO_MAX = 3;

/** The facts of a file read with a parser, or null for "use the regex". The last few files are remembered. */
export function analyse(path: string, lang: string, text: string): TsFacts | null {
  const key = `${path}\u0000${lang}`;
  const hit = memo.get(key);
  if (hit && hit.text === text) return hit.facts;
  const facts = run(path, lang, text);
  memo.delete(key);
  memo.set(key, { text, facts });
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
  return facts;
}

/** Forgets the remembered files (tests that change what is loaded). */
export function forgetFacts(): void { memo.clear(); }
