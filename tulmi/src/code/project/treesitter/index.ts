/**
 * THE TREE-SITTER PATH OF THE PROJECT BRAIN, AS THE REST OF THE BRAIN SEES IT.
 *
 *   ensureGrammars(files)   before a build reads its files: loads the engine and the grammars those files need (lazily, once; the ones this
 *                           runtime does not carry are simply absent). Never throws, never fails a build.
 *   analyse(path, lang, text)  one file's symbols, imports, references and visible text, or null for "read it by regex"
 *   setGrammarSource(source)   the Cloudflare Worker hands its bundled grammars here
 *   treeSitter.status()        what is loaded, what failed, what is absent
 *
 * symbols.ts, graph.ts and texts.ts each call `analyse` first and fall back to their regexes on null, so the regex path is unchanged and is
 * always what runs when this one cannot.
 */
import { grammarsFor } from "./extract.js";
import { treeSitter, type GrammarSource } from "./host.js";

export { analyse, forgetFacts, grammarsFor, pickGrammar, type RawText, type TsFacts } from "./extract.js";
export { GRAMMARS, treeSitter, type GrammarId, type GrammarSource, type HostStatus } from "./host.js";

export function setGrammarSource(source: GrammarSource | null): void { treeSitter.setSource(source); }

/** Loads the grammars a set of files needs. Resolves to the languages that are ready (their grammar ids). */
export async function ensureGrammars(files: Iterable<{ path: string; lang: string }>): Promise<string[]> {
  try {
    return [...(await treeSitter.ensure(grammarsFor(files)))];
  } catch {
    return [];
  }
}
