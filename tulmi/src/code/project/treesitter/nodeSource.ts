/**
 * WHERE THE GRAMMARS ARE ON THE VPS: node_modules/tree-sitter-wasm (every grammar, pinned) AND node_modules/web-tree-sitter (the engine).
 *
 * Found by walking up from this file to the nearest node_modules that has them, so it works the same from src/ (tsx, vitest) and from
 * dist/ (the compiled server). Each file is read and compiled the first time a repo has a file in that language (WebAssembly.compile is
 * asynchronous: a large grammar such as C# compiles off the event loop), and the compiled module is kept.
 *
 * Only Node uses this file. The Cloudflare Worker bundles its own (jobs/src/grammars.ts) and never reaches it.
 */
import { existsSync, promises } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wasmApi, type GrammarId, type GrammarSource, type WasmModule } from "./host.js";

function findPackage(name: string, file: string): string | null {
  let dir: string;
  try { dir = dirname(fileURLToPath(import.meta.url)); } catch { return null; }
  for (let i = 0; i < 12; i += 1) {
    const p = join(dir, "node_modules", name, file);
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** The file name tree-sitter-wasm uses for a grammar: out/<id>/tree-sitter-<id>.wasm. */
export const grammarFile = (id: GrammarId): string => `out/${id}/tree-sitter-${id}.wasm`;

export function nodeSource(): GrammarSource {
  const compiled = new Map<string, Promise<WasmModule>>();
  /** Whether a grammar's file is installed: looked for once (the search walks up the directories), not on every build. */
  const present = new Map<GrammarId, boolean>();
  const load = (key: string, path: string | null): Promise<WasmModule> => {
    let p = compiled.get(key);
    if (!p) {
      if (!path) return Promise.reject(new Error(`${key} is not installed`));
      p = promises.readFile(path).then((bytes) => wasmApi().compile(bytes));
      p.catch(() => compiled.delete(key));
      compiled.set(key, p);
    }
    return p;
  };
  return {
    has: (id) => {
      let ok = present.get(id);
      if (ok === undefined) { ok = findPackage("tree-sitter-wasm", grammarFile(id)) !== null; present.set(id, ok); }
      return ok;
    },
    core: () => load("core", findPackage("web-tree-sitter", "web-tree-sitter.wasm")),
    grammar: (id) => load(id, findPackage("tree-sitter-wasm", grammarFile(id))),
  };
}
