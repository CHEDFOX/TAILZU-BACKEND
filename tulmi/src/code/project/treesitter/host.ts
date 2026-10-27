/**
 * THE TREE-SITTER RUNTIME: ONE PARSER ENGINE, ITS GRAMMARS LOADED WHEN A REPO NEEDS THEM, AND NOTHING THAT CAN BREAK A BUILD.
 *
 * The project brain reads symbols, imports, routes and visible text with regular
 * expressions (symbols.ts, graph.ts, texts.ts). They are cheap and they are the
 * fallback everywhere. Where a real parser can be had, this is it: web-tree-sitter
 * (a WebAssembly build of tree-sitter) with one grammar per language, so a decorator,
 * a multi-line signature or a nested class is read as the language reads it.
 *
 *   GrammarSource   where the WebAssembly comes from. It hands back COMPILED modules
 *                   (WebAssembly.Module), never bytes, because a Cloudflare Worker may
 *                   not compile at runtime (WebAssembly.compile and instantiate-from-
 *                   buffer are refused there); a module that was bundled arrives
 *                   already compiled. On the VPS (nodeSource.ts) every grammar is on
 *                   disk and compiled the first time a repo has a file in that language.
 *                   On the Worker (jobs/src/grammars.ts) the source carries the ones
 *                   that fit its size budget and `has()` says no to the rest.
 *   ensure(ids)     loads the engine once and each grammar once, in parallel, and
 *                   answers which are ready. Lazy: a repo with only TypeScript in it
 *                   never loads Kotlin.
 *   parse / query   synchronous once a grammar is ready, so the per-file analysis in
 *                   build.ts stays a plain loop.
 *
 * A grammar that fails to load (a corrupt file, a runtime that refuses it) is marked
 * failed for the life of the process and its language is read by regex, as it is when
 * no source is set, when CODE_TREE_SITTER is off, or when a file is too big or too
 * long-lined to parse in reasonable time. `status()` says which, for the build's log.
 */
import { Language, Parser, Query, type Tree } from "web-tree-sitter";

export const GRAMMARS = [
  "typescript", "tsx", "javascript", "python", "go", "rust", "java", "kotlin", "ruby", "php", "swift", "c_sharp", "dart", "html",
] as const;
export type GrammarId = (typeof GRAMMARS)[number];

export const isGrammarId = (s: string): s is GrammarId => (GRAMMARS as readonly string[]).includes(s);

/** A compiled WebAssembly module (the runtime's own type, which this project's lib setting does not name). */
export type WasmModule = Parameters<typeof Language.loadSync>[0];

/** The one corner of the WebAssembly API used here, reached through globalThis so that no lib has to declare it. */
export interface WasmApi {
  compile(bytes: Uint8Array): Promise<WasmModule>;
  instantiate(module: WasmModule, imports: unknown): Promise<unknown>;
}
export const wasmApi = (): WasmApi => (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;

export interface GrammarSource {
  /**
   * "worker" for a Cloudflare Worker. With nodejs_compat a Worker has a `process` that says it is Node, and the engine (emscripten's loader) then goes looking for
   * the file it was started from, which a bundle does not have. The host tells it, for the moment it starts, that it is not in Node (see maskNode).
   */
  runtime?: "worker";
  /** Whether this runtime carries the grammar at all (answered without loading anything). */
  has(id: GrammarId): boolean;
  /** web-tree-sitter's own WebAssembly, compiled. */
  core(): Promise<WasmModule>;
  /** A grammar's WebAssembly, compiled. */
  grammar(id: GrammarId): Promise<WasmModule>;
}

/** A file longer than this is read by regex: parsing it would cost more than the answer is worth. */
export const PARSE_MAX_CHARS = 600_000;
/** A line longer than this (minified code, a data blob) makes a file not worth parsing. */
export const PARSE_MAX_LINE = 4_000;
/** The most a single parse may take. */
export const PARSE_MAX_MS = 3_000;

export interface HostStatus {
  /** The engine started. */
  engine: boolean;
  ready: GrammarId[];
  /** Grammars that failed to load, with the reason (an Error's name and message, never a path). */
  failed: Record<string, string>;
  /** Grammars this runtime does not carry. */
  absent: GrammarId[];
  /** Why the engine did not start, when it did not (an Error's name and message, never a path). */
  engineError?: string;
}

/**
 * Makes `process` look like a browser renderer's for as long as it takes to call Parser.init(): emscripten's loader decides at its first line whether it is in
 * Node (`process.versions.node` and `process.type != "renderer"`) and, in Node, reads import.meta.url, which a Worker bundle does not have. Returns the undo.
 */
function maskNode(): () => void {
  const proc = (globalThis as unknown as { process?: Record<string, unknown> }).process;
  if (!proc) return () => undefined;
  const had = Object.getOwnPropertyDescriptor(proc, "type");
  try { Object.defineProperty(proc, "type", { value: "renderer", configurable: true, writable: true }); } catch { return () => undefined; }
  return () => { try { if (had) Object.defineProperty(proc, "type", had); else delete proc.type; } catch { /* left as it is */ } };
}

class Host {
  private source: GrammarSource | null = null;
  private sourceTried = false;
  private engine: Promise<boolean> | null = null;
  private engineOk = false;
  private languages = new Map<GrammarId, Language>();
  private loading = new Map<GrammarId, Promise<void>>();
  private parsers = new Map<GrammarId, Parser>();
  private queries = new Map<string, Query | null>();
  private failed = new Map<GrammarId, string>();
  private absent = new Set<GrammarId>();
  private off = false;
  private engineError = "";

  /** Where the WebAssembly comes from (the Worker sets its bundled modules here; Node finds its own). Starts the host afresh. */
  setSource(source: GrammarSource | null): void {
    this.reset();
    this.source = source;
    this.sourceTried = source !== null;
  }

  /** Switches the parser off (CODE_TREE_SITTER=false): nothing is loaded and every language is read by regex. */
  disable(off: boolean): void { this.off = off; }

  /** Forgets everything loaded. The engine is a process-wide singleton in web-tree-sitter, so it is not started a second time: only the grammars, parsers and queries go. */
  reset(): void {
    for (const p of this.parsers.values()) { try { p.delete(); } catch { /* already gone */ } }
    for (const q of this.queries.values()) { try { q?.delete(); } catch { /* already gone */ } }
    this.parsers.clear();
    this.queries.clear();
    this.languages.clear();
    this.loading.clear();
    this.failed.clear();
    this.absent.clear();
  }

  private async resolveSource(): Promise<GrammarSource | null> {
    if (this.source || this.sourceTried) return this.source;
    this.sourceTried = true;
    try {
      // The Worker never gets here: it sets its source before it builds. Anywhere else the files are on disk.
      const mod = await import("./nodeSource.js");
      this.source = mod.nodeSource();
    } catch {
      this.source = null;
    }
    return this.source;
  }

  private startEngine(source: GrammarSource): Promise<boolean> {
    this.engine ??= (async () => {
      try {
        const core = await source.core();
        const unmask = source.runtime === "worker" ? maskNode() : () => undefined;
        let started: Promise<void>;
        try {
          // The loader looks at `process` in the first lines of this call, before anything is awaited: that is all the mask has to last.
          started = Parser.init({
            // The engine's own WebAssembly is handed over compiled: nothing is fetched or compiled here.
            instantiateWasm(imports: unknown, receive: (instance: unknown, module: WasmModule) => void) {
              wasmApi().instantiate(core, imports).then((instance) => receive(instance, core), () => receive(undefined, core));
              return {};
            },
          });
        } finally {
          unmask();
        }
        await started;
        this.engineOk = true;
        return true;
      } catch (err) {
        this.engineError = `${(err as Error)?.name ?? "Error"}: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
        this.engine = null;
        return false;
      }
    })();
    return this.engine;
  }

  /** Loads the engine and these grammars (those this runtime carries). Returns the ids that are ready. Never throws. */
  async ensure(ids: readonly GrammarId[]): Promise<Set<GrammarId>> {
    const ready = new Set<GrammarId>();
    if (this.off) return ready;
    const wanted = [...new Set(ids)];
    const source = await this.resolveSource();
    if (!source) return ready;
    const todo = wanted.filter((id) => {
      if (this.languages.has(id)) { ready.add(id); return false; }
      if (this.failed.has(id)) return false;
      if (!source.has(id)) { this.absent.add(id); return false; }
      return true;
    });
    if (!todo.length) return ready;
    if (!(await this.startEngine(source))) {
      for (const id of todo) this.failed.set(id, "the parser engine did not start");
      return ready;
    }
    await Promise.all(todo.map((id) => {
      let p = this.loading.get(id);
      if (!p) {
        p = (async () => {
          try {
            const mod = await source.grammar(id);
            this.languages.set(id, Language.loadSync(mod));
          } catch (err) {
            this.failed.set(id, `${(err as Error)?.name ?? "Error"}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
          }
        })().finally(() => this.loading.delete(id));
        this.loading.set(id, p);
      }
      return p;
    }));
    for (const id of todo) if (this.languages.has(id)) ready.add(id);
    return ready;
  }

  isReady(id: GrammarId): boolean { return !this.off && this.engineOk && this.languages.has(id); }

  /** Whether a text is fit to parse. */
  static fits(text: string): boolean {
    if (text.length > PARSE_MAX_CHARS) return false;
    // A long line is found without splitting the text: the longest run between newlines.
    let run = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) run = 0;
      else if (++run > PARSE_MAX_LINE) return false;
    }
    return true;
  }

  /** Parses a text. The caller deletes the tree. Null when the grammar is not ready, the text does not fit, or the parse ran out of time. */
  parse(id: GrammarId, text: string): Tree | null {
    if (!this.isReady(id) || !Host.fits(text)) return null;
    let parser = this.parsers.get(id);
    if (!parser) {
      parser = new Parser();
      parser.setLanguage(this.languages.get(id)!);
      this.parsers.set(id, parser);
    }
    const t0 = performance.now();
    try {
      return parser.parse(text, null, { progressCallback: () => performance.now() - t0 > PARSE_MAX_MS ? (true as unknown as void) : undefined });
    } catch {
      parser.reset();
      return null;
    } finally {
      parser.reset();
    }
  }

  /** A compiled query for a grammar, kept. Null when the query does not compile against this grammar (a bug in the query, not a reason to stop). */
  query(id: GrammarId, name: string, source: string): Query | null {
    const key = `${id}\u0000${name}`;
    if (this.queries.has(key)) return this.queries.get(key) ?? null;
    let q: Query | null = null;
    try {
      q = new Query(this.languages.get(id)!, source);
    } catch (err) {
      this.failed.set(id, `query ${name}: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    }
    this.queries.set(key, q);
    return q;
  }

  status(): HostStatus {
    return {
      engine: this.engineOk, ready: [...this.languages.keys()], failed: Object.fromEntries(this.failed), absent: [...this.absent],
      ...(this.engineError ? { engineError: this.engineError } : {}),
    };
  }
}

const host = new Host();

export const treeSitter = {
  setSource: (s: GrammarSource | null) => host.setSource(s),
  disable: (off: boolean) => host.disable(off),
  reset: () => host.reset(),
  ensure: (ids: readonly GrammarId[]) => host.ensure(ids),
  isReady: (id: GrammarId) => host.isReady(id),
  parse: (id: GrammarId, text: string) => host.parse(id, text),
  query: (id: GrammarId, name: string, source: string) => host.query(id, name, source),
  status: () => host.status(),
};
