/**
 * THE PARSER, IN WORKERD: THE GRAMMARS THE WORKER CARRIES (src/grammars.ts), LOADED AS BUNDLED MODULES, AND A BRAIN BUILD THAT READS WITH THEM.
 *
 * A Worker cannot compile WebAssembly from bytes, so every grammar here is a module the bundler uploaded; the engine has to start without a file to
 * read (nodejs_compat makes `process` say it is Node). These run the real engine and the real grammars in the Workers runtime:
 *   - the eleven carried grammars load and read the same fixtures the VPS is measured on (tulmi/evals/symbols/gold.ts)
 *   - the three that are left out (Kotlin, Swift, C#) are absent, and their files fall back to the regexes
 *   - a build of the Acme Shop repo with them: symbols that carry an end line and the references the repo map ranks by
 */
import { describe, expect, it } from "vitest";

process.env.RUNTIME = "worker";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.CONNECTOR_TOKEN_KEY = btoa("0123456789abcdef0123456789abcdef");

const { analyse, ensureGrammars, forgetFacts, setGrammarSource, treeSitter } = await import("../../tulmi/src/code/project/treesitter/index.js");
const { extractSymbols } = await import("../../tulmi/src/code/project/symbols.js");
const { GOLD } = await import("../../tulmi/evals/symbols/gold.js");
const { fromSymbols, recall, precision, scoreDefs } = await import("../../tulmi/evals/symbols/score.js");
const { CARRIED, LEFT_OUT, workerGrammars } = await import("../src/grammars.js");
const { projectRig } = await import("../../tulmi/tests/project-rig.js");

const CARRIED_LANGS = GOLD.filter((g) => g.lang in CARRIED);

// The first test pays to start the engine and compile eleven modules in a runtime that is sharing the machine: generous, not tight.
const SLOW = 60_000;

describe("the grammars in the Worker", () => {
  it("carries eleven grammars and leaves out the three that do not fit an isolate", () => {
    const src = workerGrammars();
    expect(Object.keys(CARRIED).sort()).toEqual(["dart", "go", "html", "java", "javascript", "php", "python", "ruby", "rust", "tsx", "typescript"]);
    for (const id of Object.keys(LEFT_OUT)) expect(src.has(id as never)).toBe(false);
    expect(src.runtime).toBe("worker");
  });

  it("starts the engine with no file to read, and loads every carried grammar from its bundled module", async () => {
    setGrammarSource(workerGrammars());
    const ready = await ensureGrammars([...CARRIED_LANGS.map((g) => ({ path: g.path, lang: g.langName })), { path: "a.js", lang: "JavaScript" }, { path: "a.html", lang: "HTML" }]);
    const status = treeSitter.status();
    expect(status.engineError).toBeUndefined();
    expect(status.failed).toEqual({});
    expect(status.engine).toBe(true);
    expect(ready.sort()).toEqual(Object.keys(CARRIED).sort());
  }, SLOW);

  it("reads each carried language's fixture as well as the VPS does: every definition found, an end line on each", async () => {
    setGrammarSource(workerGrammars());
    await ensureGrammars(CARRIED_LANGS.map((g) => ({ path: g.path, lang: g.langName })));
    for (const g of CARRIED_LANGS) {
      forgetFacts();
      const facts = analyse(g.path, g.langName, g.code);
      expect(facts, g.lang).not.toBeNull();
      const t = scoreDefs(fromSymbols(facts!.symbols), g.defs.map(([name, kind, exported]) => ({ name, kind, exported })));
      expect(recall(t), `${g.lang} recall`).toBeGreaterThanOrEqual(0.9);
      expect(precision(t), `${g.lang} precision`).toBeGreaterThanOrEqual(0.9);
      expect(facts!.symbols.filter((s) => s.kind !== "env" && s.kind !== "entry" && s.kind !== "route").every((s) => typeof s.endLine === "number"), g.lang).toBe(true);
    }
  }, SLOW);

  it("reads JSX text and HTML text with the parser too", async () => {
    setGrammarSource(workerGrammars());
    await ensureGrammars([{ path: "a.tsx", lang: "TypeScript" }, { path: "a.html", lang: "HTML" }]);
    forgetFacts();
    const jsx = analyse("a.tsx", "TypeScript", 'export const A = () => <button title="Close it">Sign up</button>;\n');
    expect(jsx!.texts!.map((t) => `${t.kind}:${t.raw}`)).toEqual(expect.arrayContaining(["attr:Close it", "jsx:Sign up"]));
    const html = analyse("a.html", "HTML", '<h1>Welcome</h1><input placeholder="Your email">');
    expect(html!.texts!.map((t) => t.raw)).toEqual(expect.arrayContaining(["Welcome", "Your email"]));
  }, SLOW);

  it("leaves Kotlin, Swift and C# to the regexes: no parse, and the regex reader still finds the symbols", async () => {
    setGrammarSource(workerGrammars());
    const ready = await ensureGrammars([{ path: "A.kt", lang: "Kotlin" }, { path: "A.swift", lang: "Swift" }, { path: "A.cs", lang: "C#" }]);
    expect(ready).toEqual([]);
    expect(treeSitter.status().absent.sort()).toEqual(["c_sharp", "kotlin", "swift"]);
    expect(analyse("A.kt", "Kotlin", "class User\nfun top() {}\n")).toBeNull();
    const kt = extractSymbols("A.kt", "Kotlin", "class User\nfun top() {}\n");
    expect(kt.map((s) => s.name)).toEqual(expect.arrayContaining(["User", "top"]));
    expect(kt.some((s) => s.endLine)).toBe(false);
  }, SLOW);
});

describe("a brain build in the Worker, with the parser", () => {
  it("builds Acme Shop with the bundled grammars: TypeScript, Python, Go and Dart read by the parser, the references kept", async () => {
    setGrammarSource(workerGrammars());
    const r = await projectRig();
    const view = await r.brain.buildHere("alice", r.projectId, { mode: "full" });
    expect(view.status).toBe("ready");
    const logged = r.logs.find((l) => l.m === "code project brain: parser grammars");
    expect(logged).toBeDefined();
    expect((logged!.o as { grammars: string[] }).grammars).toEqual(expect.arrayContaining(["typescript", "tsx", "python", "go", "dart"]));
    const handle = await r.brain.open("alice", r.projectId);
    const api = await handle.file("src/lib/api.ts");
    expect(api!.symbols.find((s) => s.name === "fetchUsers")).toMatchObject({ kind: "function", exported: true, line: 5 });
    expect(api!.symbols.find((s) => s.name === "fetchUsers")!.endLine).toBeGreaterThanOrEqual(5);
    expect(api!.refs).toBeDefined();
    const hits = await handle.repoMap({ identifiers: ["fetchUsers"], paths: [] });
    expect(hits.length).toBeGreaterThan(0);
  }, SLOW);
});
