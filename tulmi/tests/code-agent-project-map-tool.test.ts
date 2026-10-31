/**
 * THE AGENT'S project_map TOOL (src/code/agent/tools.ts): find the components a request means, open one's card with each function's lines as
 * they are NOW (the staged edits included), and where a new thing of a kind goes.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.CODE_TREE_SITTER = "true"; });

const { Tools } = await import("../src/code/agent/tools.js");
const { initialState } = await import("../src/code/agent/types.js");
const { buildMap, withHashes } = await import("../src/code/project/map.js");
const { extractSymbols } = await import("../src/code/project/symbols.js");
const { ensureGrammars } = await import("../src/code/project/treesitter/index.js");
const { FakeWorkspace, fakeLog } = await import("./live-fakes.js");
type StoredFile = import("../src/code/project/types.js").StoredFile;
type ProjectMap = import("../src/code/project/map.js").ProjectMap;

const UTIL = "export function slug(s: string): string {\n  return s.toLowerCase();\n}\n\nexport function title(s: string): string {\n  return s.toUpperCase();\n}\n";
const REPO: Record<string, string> = {
  "src/util.ts": UTIL,
  "src/index.ts": 'import { slug } from "./util";\nexport const name = slug("My App");\n',
  "src/routes/a.ts": "export function a() {}\n",
  "src/routes/b.ts": "export function b() {}\n",
};

beforeAll(async () => { await ensureGrammars([{ path: "a.ts", lang: "TypeScript" }]); });

function mapOf(repo: Record<string, string>): ProjectMap {
  const rows: StoredFile[] = Object.entries(repo).map(([path, text]) => ({
    path, blobSha: path, lang: "TypeScript", bytes: text.length, symbols: withHashes(text, extractSymbols(path, "TypeScript", text)),
    imports: path === "src/index.ts" ? ["src/util.ts"] : [], rank: 0, hot: 0, todo: 0, tests: path === "src/util.ts" ? ["src/util.test.ts"] : [], summary: path === "src/util.ts" ? "String helpers." : "",
  }));
  return buildMap({ commit: "abc", files: rows, features: [], entries: ["src/index.ts"] });
}

function rig(map: ProjectMap | null) {
  const ws = new FakeWorkspace(REPO);
  const tools = new Tools({
    userId: "u", projectId: "p", state: initialState("task", 0), ws: ws as never, brain: { projectMap: async () => map } as never, log: fakeLog(),
    web: { run: async () => ({ ok: false, message: { content: "no" } }) } as never,
    runStep: async () => ({ status: "done", exitCode: 0, outputTail: "", minutes: 0, stepIdx: 0, ms: 1 }), closedSource: false, now: () => 1000,
  });
  let n = 0;
  const run = (name: string, args: Record<string, unknown>) => tools.exec({ id: `c${(n += 1)}`, name, arguments: JSON.stringify(args) });
  return { run };
}

describe("project_map", () => {
  it("finds the component a name means, with each function's lines", async () => {
    const r = rig(mapOf(REPO));
    const out = await r.run("project_map", { action: "find", query: "slug" });
    expect(out).toMatchObject({ ok: true });
    expect(String(out.data)).toMatch(/^src\/util\.ts - String helpers\. \[slug:1-3, title:5-7\]/);
  });

  it("opens a card whose lines are checked against the file now: moved after an edit above, changed after an edit inside", async () => {
    const r = rig(mapOf(REPO));
    const first = String((await r.run("project_map", { action: "open", path: "src/util.ts" })).data);
    expect(first).toContain("slug (function) lines 1-3\n");
    expect(first).toContain("Used by: src/index.ts");
    expect(first).toContain("Tests: src/util.test.ts");
    await r.run("edit_file", { path: "src/util.ts", old: "export function slug", new: "// Helpers.\n\nexport function slug" });
    const moved = String((await r.run("project_map", { action: "open", path: "src/util.ts" })).data);
    expect(moved).toContain("slug (function) lines 3-5 (moved)");
    expect(moved).toContain("title (function) lines 7-9 (moved)");
    await r.run("edit_file", { path: "src/util.ts", old: "toUpperCase", new: "toLocaleUpperCase" });
    expect(String((await r.run("project_map", { action: "open", path: "src/util.ts" })).data)).toContain("title (function) lines 7-9 (changed since the map)");
  });

  it("says where a new thing of a kind goes, and refuses what is not a component", async () => {
    const r = rig(mapOf(REPO));
    expect(String((await r.run("project_map", { action: "place", query: "routes" })).data)).toMatch(/^function in src\/routes\/ \(like src\/routes\/a\.ts, src\/routes\/b\.ts\)/);
    expect(await r.run("project_map", { action: "open", path: "README.md" })).toMatchObject({ ok: false });
  });

  it("points elsewhere when the project has no map yet", async () => {
    const r = rig(null);
    expect((await r.run("project_map", { action: "find", query: "slug" })).content).toMatch(/no map yet/);
  });
});
