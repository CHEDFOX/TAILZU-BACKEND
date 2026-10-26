/**
 * FINDING A FILE, A SYMBOL OR A STRING: THE WORDS A QUERY IS MADE OF, AND HOW A HIT IS SCORED.
 *
 * "login", "handleLogin", "src/auth/login.ts" and "Sign up" all have to find
 * what they should. Code is not prose: a name is one token to a default text
 * search, so it is broken into the words people think in (handleLogin -> handle,
 * login; user_id -> user, id; src/auth/login.ts -> src, auth, login, ts) on both
 * sides, the stored document (the migration's generated `tsv`, and the memory
 * twin's own tokens) and the query, and a query word matches by PREFIX (log
 * finds login).
 *
 * The database finds the candidates (an AND of the query's words, then an OR if
 * that is empty); this file puts them in order, the same way for the database
 * and the in-memory twin, so tests and production agree:
 *
 *   a symbol named exactly the query            first
 *   a symbol whose name starts with / contains  next
 *   a file whose name is the query              like a symbol
 *   the path, the summary                       after
 *   then how central the file is, as a tie-break
 */
import type { StoredFile, StoredText, SymbolInfo } from "./types.js";

/** The words in a name or a phrase: camelCase and snake_case split, lower case, punctuation gone. */
export function tokenize(s: string): string[] {
  const words = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w.toLowerCase());
  return words;
}

/** The query's words: at least two characters, each once, six at most. */
export function queryWords(q: string): string[] {
  const out: string[] = [];
  for (const w of tokenize(q)) if (w.length >= 2 && !out.includes(w)) out.push(w);
  return out.slice(0, 6);
}

/** A to_tsquery string for the words: each a prefix, joined by & (or |). Empty for no words. */
export function tsQuery(words: readonly string[], op: "&" | "|" = "&"): string {
  return words.map((w) => `${w.replace(/[^\p{L}\p{N}]/gu, "")}:*`).filter((w) => w !== ":*").join(` ${op} `);
}

/** What the generated tsv holds for a file: its path words, its symbol names' words, its summary's. */
export function fileDocument(f: Pick<StoredFile, "path" | "symbols" | "summary">): string[] {
  return [...tokenize(f.path), ...f.symbols.flatMap((s) => (s.kind === "route" ? tokenize(s.path ?? s.name) : tokenize(s.name))), ...tokenize(f.summary)];
}

const matches = (doc: readonly string[], w: string) => doc.some((d) => d.startsWith(w));

/** Whether a file is a candidate: every word (op "and") or any word (op "or") is a prefix of one of its words. */
export function fileMatches(f: Pick<StoredFile, "path" | "symbols" | "summary">, words: readonly string[], op: "and" | "or"): boolean {
  const doc = fileDocument(f);
  return op === "and" ? words.every((w) => matches(doc, w)) : words.some((w) => matches(doc, w));
}

export function textMatches(t: Pick<StoredText, "text">, words: readonly string[], op: "and" | "or"): boolean {
  const doc = tokenize(t.text);
  return op === "and" ? words.every((w) => matches(doc, w)) : words.some((w) => matches(doc, w));
}

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/** How well a file answers a query: higher is better. */
export function scoreFile(f: Pick<StoredFile, "path" | "symbols" | "summary" | "rank">, q: string, words: readonly string[]): number {
  const lq = q.trim().toLowerCase();
  let best = 0;
  for (const s of f.symbols) best = Math.max(best, symbolScore(s, lq, words));
  const name = base(f.path).toLowerCase();
  const pathWords = tokenize(f.path);
  if (name === lq) best = Math.max(best, 90);
  else if (words.length && words.every((w) => tokenize(name).some((n) => n.startsWith(w)))) best = Math.max(best, 55);
  else if (words.length && words.every((w) => pathWords.some((n) => n.startsWith(w)))) best = Math.max(best, 40);
  const sum = tokenize(f.summary);
  const inSummary = words.filter((w) => matches(sum, w)).length;
  return best + inSummary * 5 + f.rank * 4;
}

/** How well one symbol answers a query. */
export function symbolScore(s: SymbolInfo, lq: string, words: readonly string[]): number {
  const name = (s.kind === "route" ? s.path ?? s.name : s.name).toLowerCase();
  const short = name.split(".").pop()!;
  if (name === lq || short === lq) return 100;
  const sw = tokenize(s.kind === "route" ? s.path ?? s.name : s.name);
  if (words.length && words.every((w) => sw.some((n) => n === w))) return 80;
  if (name.startsWith(lq) || short.startsWith(lq)) return 70;
  if (words.length && words.every((w) => sw.some((n) => n.startsWith(w)))) return 60;
  if (name.includes(lq)) return 50;
  return 0;
}
