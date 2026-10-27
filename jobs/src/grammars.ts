/**
 * THE PARSER'S GRAMMARS, AS THE WORKER CARRIES THEM.
 *
 * The project brain reads code with tree-sitter (tulmi/src/code/project/treesitter, docs/code-project-brain.md) and falls back to its regexes for any
 * language it has no grammar for. On the VPS every grammar is a file in node_modules. A Worker has no file system to read them from and may not compile
 * WebAssembly at run time (WebAssembly.compile and instantiate-from-bytes are refused: developers.cloudflare.com/workers/runtime-apis/web-standards/),
 * so a grammar must be BUNDLED: `import x from "...wasm"` makes wrangler upload the file as a module and hand back the compiled WebAssembly.Module.
 *
 * What limits the number of grammars is not the size of the Worker (64 MiB uncompressed on both plans, developers.cloudflare.com/workers/platform/limits/;
 * there is no compressed limit, the gzip figure wrangler prints is for reference: all fourteen grammars are 25 MiB) but the isolate's 128 MB of memory, which
 * the grammars' compiled code shares with the build's text (up to 60 MB). Measured in workerd, loading one language and parsing 300 files of it:
 *
 *     TypeScript (with the engine) +41 MB   Ruby +13   Rust +6   Java +5   PHP +2   TSX +2   Python +1   Go +1   Dart +1   JavaScript, HTML ~0
 *     Kotlin +59 MB (4.1 MB of WebAssembly)   Swift +81 (3.3 MB)   C# +195 (5.3 MB)
 *
 * The three big ones compile to more machine code than an isolate can spare, so they are left out: a Kotlin, Swift or C# file is read by the regexes
 * on the Worker, and by the parser on the VPS. The rule that keeps it so is in tests (the Worker's bundle holds at most GRAMMAR_BUDGET_BYTES of
 * grammars, and none over GRAMMAR_MAX_BYTES). Each grammar is imported when a build asks for it (a dynamic import), so a request that is not a brain build
 * (the cron, a job's advance, /v1/health) pays nothing for them: a module that is never imported is never compiled in the isolate.
 */
import type { GrammarId, GrammarSource, WasmModule } from "../../tulmi/src/code/project/treesitter/host.js";

type Loader = () => Promise<{ default: WasmModule }>;

/** The most WebAssembly (uncompressed) the Worker carries for grammars, in all, and the most for any one. */
export const GRAMMAR_BUDGET_BYTES = 12 * 1024 * 1024;
export const GRAMMAR_MAX_BYTES = 2.5 * 1024 * 1024;

/** The grammars the VPS has and the Worker leaves out, with the memory they were measured to take (see above). */
export const LEFT_OUT: Readonly<Partial<Record<GrammarId, string>>> = {
  kotlin: "4.1 MB of WebAssembly, about 60 MB of memory in the isolate",
  swift: "3.3 MB of WebAssembly, about 80 MB of memory in the isolate",
  c_sharp: "5.3 MB of WebAssembly, about 195 MB of memory in the isolate",
};

/** The grammars carried, in the order they were chosen (most written first). */
export const CARRIED: Readonly<Partial<Record<GrammarId, Loader>>> = {
  typescript: () => import("tree-sitter-wasm/typescript/tree-sitter-typescript.wasm"),
  tsx: () => import("tree-sitter-wasm/tsx/tree-sitter-tsx.wasm"),
  javascript: () => import("tree-sitter-wasm/javascript/tree-sitter-javascript.wasm"),
  python: () => import("tree-sitter-wasm/python/tree-sitter-python.wasm"),
  go: () => import("tree-sitter-wasm/go/tree-sitter-go.wasm"),
  java: () => import("tree-sitter-wasm/java/tree-sitter-java.wasm"),
  rust: () => import("tree-sitter-wasm/rust/tree-sitter-rust.wasm"),
  php: () => import("tree-sitter-wasm/php/tree-sitter-php.wasm"),
  ruby: () => import("tree-sitter-wasm/ruby/tree-sitter-ruby.wasm"),
  html: () => import("tree-sitter-wasm/html/tree-sitter-html.wasm"),
  dart: () => import("tree-sitter-wasm/dart/tree-sitter-dart.wasm"),
};

const ENGINE: Loader = () => import("web-tree-sitter/web-tree-sitter.wasm");

/** The grammars the Worker carries, as the parser host asks for them. */
export function workerGrammars(): GrammarSource {
  return {
    runtime: "worker",
    has: (id) => id in CARRIED,
    core: async () => (await ENGINE()).default,
    grammar: async (id) => {
      const load = CARRIED[id];
      if (!load) throw new Error(`the Worker does not carry the ${id} grammar`);
      return (await load()).default;
    },
  };
}
