/**
 * WHAT A CHANGE TOOK AWAY (src/code/agent/surface.ts): the exported names and routes of the files a job touched, before
 * against after. What these hold down:
 *   - the surface of a file is what is visible from outside it, and its routes: a local helper is not in it;
 *   - a name that moved to another staged file is a refactor, not a removal; one that simply went is a removal;
 *   - a file the job deleted is read the same way, so its contents moving elsewhere is fine and dropping them is not;
 *   - a task that asks for something to go turns the check off, and a test file is the test lock's business, not this;
 *   - the words the model is given name each thing and its file, and tell it what to do about a rename.
 */
import { describe, expect, it } from "vitest";
import { LOST_SHOWN, REMOVAL_ASKED, lostFeedback, lostSurface, surfaceInput, surfaceOf, watchedPath } from "../src/code/agent/surface.js";

const keys = (path: string, text: string) => surfaceOf(path, text).map((i) => i.key).sort();
const lostKeys = (files: { path: string; before: string | null; after: string | null }[]) => lostSurface(files).map((l) => l.key).sort();

const MODULE = 'export function slug(s: string): string {\n  return helper(s);\n}\n\nfunction helper(s: string) {\n  return s;\n}\n\nexport const TITLE = "x";\n';

describe("the surface of a file", () => {
  it("is what the rest of the project can see, not what the file keeps to itself", () => {
    expect(keys("src/util.ts", MODULE)).toEqual(["name:TITLE", "name:slug"]);
    expect(keys("src/util.ts", MODULE)).not.toContain("name:helper");
  });

  it("holds the routes a file serves, with their verb and path", () => {
    const api = 'app.get("/users/:id", getUser);\napp.post("/users", createUser);\n';
    expect(keys("src/api.ts", api)).toEqual(["route:GET /users/:id", "route:POST /users"]);
  });

  it("is read the same way in the other languages the index knows", () => {
    expect(keys("app/main.py", "def visible():\n    pass\n\ndef _private():\n    pass\n")).toEqual(["name:visible"]);
    expect(keys("pkg/thing.go", "func Exported() {}\nfunc unexported() {}\n")).toEqual(["name:Exported"]);
    expect(keys("src/lib.rs", "pub fn open() {}\nfn shut() {}\n")).toEqual(["name:open"]);
  });

  it("is empty for a file with nothing to show, and for one the check does not watch", () => {
    expect(keys("src/util.ts", "const x = 1;\n")).toEqual([]);
    expect(watchedPath("src/util.ts")).toBe(true);
    expect(watchedPath("src/util.test.ts")).toBe(false);
    expect(watchedPath("README.md")).toBe(false);
    expect(watchedPath("package-lock.json")).toBe(false);
  });
});

describe("what a change took away", () => {
  it("is nothing when the change only adds, or only rewrites a body", () => {
    expect(lostKeys([{ path: "src/util.ts", before: MODULE, after: `${MODULE}export function extra() {}\n` }])).toEqual([]);
    expect(lostKeys([{ path: "src/util.ts", before: MODULE, after: MODULE.replace("return helper(s);", "return helper(s).trim();") }])).toEqual([]);
  });

  it("is nothing when an exported function becomes an exported const of the same name: callers import a name, not a kind", () => {
    const asConst = 'export const slug = (s: string) => s.toLowerCase();\n\nexport const TITLE = "x";\n';
    expect(lostKeys([{ path: "src/util.ts", before: MODULE, after: asConst }])).toEqual([]);
  });

  it("is the exported name a rewrite dropped", () => {
    const without = 'export function slug(s: string): string {\n  return s;\n}\n';
    expect(lostKeys([{ path: "src/util.ts", before: MODULE, after: without }])).toEqual(["name:TITLE"]);
  });

  it("is the route that is no longer served", () => {
    const before = 'app.get("/users/:id", getUser);\napp.post("/users", createUser);\n';
    const after = 'app.get("/users/:id", getUser);\n';
    expect(lostKeys([{ path: "src/api.ts", before, after }])).toEqual(["route:POST /users"]);
  });

  it("is nothing when the name moved to another file the job staged: that is a refactor", () => {
    expect(lostKeys([
      { path: "src/util.ts", before: MODULE, after: 'export function slug(s: string): string {\n  return s;\n}\n' },
      { path: "src/text.ts", before: null, after: 'export const TITLE = "x";\n' },
    ])).toEqual([]);
  });

  it("reads a deleted file too: its contents moving is fine, dropping them is not", () => {
    expect(lostKeys([
      { path: "src/util.ts", before: MODULE, after: null },
      { path: "src/text.ts", before: null, after: MODULE },
    ])).toEqual([]);
    expect(lostKeys([{ path: "src/util.ts", before: MODULE, after: null }])).toEqual(["name:TITLE", "name:slug"]);
  });

  it("says nothing about a file that was not there before, or that it does not watch", () => {
    expect(lostKeys([{ path: "src/new.ts", before: null, after: "export function a() {}\n" }])).toEqual([]);
    expect(lostKeys([{ path: "src/util.test.ts", before: MODULE, after: "" }])).toEqual([]);
  });

  it("names each removal once, with the file it was in", () => {
    const lost = lostSurface([{ path: "src/util.ts", before: MODULE, after: "" }]);
    expect(lost.map((l) => `${l.label} (${l.path})`).sort()).toEqual(["const TITLE (src/util.ts)", "function slug (src/util.ts)"]);
  });
});

describe("the task that asked for it", () => {
  it("is read as asking when it says something should go", () => {
    for (const task of [
      "remove the old slug helper", "delete the unused export", "drop support for v1", "rename slug to toSlug",
      "replace the title constant", "clean up dead code in src/util.ts",
    ]) expect(REMOVAL_ASKED.test(task), task).toBe(true);
  });

  it("is not read as asking for an ordinary change", () => {
    for (const task of [
      "In src/util.ts make slug() trim leading and trailing dashes", "add a title to the header", "fix the off-by-one in the parser",
      "make the pill show how long it has been recording",
    ]) expect(REMOVAL_ASKED.test(task), task).toBe(false);
  });
});

describe("the words the model is given", () => {
  it("name what went, say the task did not ask for it, and offer the rename as the other answer", () => {
    const text = lostFeedback(lostSurface([{ path: "src/util.ts", before: MODULE, after: "" }]))!;
    expect(text).toContain("function slug, which src/util.ts had");
    expect(text).toContain("const TITLE, which src/util.ts had");
    expect(text).toMatch(/no test covers/);
    expect(text).toContain("Nothing in the task asked for that");
    expect(text).toMatch(/grep/);
    expect(text).toMatch(/call done again/);
  });

  it("are nothing at all when nothing went", () => {
    expect(lostFeedback([])).toBeNull();
  });

  it("stop naming them after a dozen and say how many more there are", () => {
    const before = Array.from({ length: LOST_SHOWN + 3 }, (_, i) => `export function f${i}() {}`).join("\n");
    const text = lostFeedback(lostSurface([{ path: "src/many.ts", before, after: "" }]))!;
    expect(text).toContain("(and 3 more)");
    expect(text.match(/^- /gm)).toHaveLength(LOST_SHOWN);
  });
});

describe("reading the staged files", () => {
  it("asks for each watched path's text on the branch, and leaves a file it cannot read out of the comparison", async () => {
    const asked: string[] = [];
    const branch = async (path: string) => {
      asked.push(path);
      if (path === "src/gone.ts") throw new Error("too large");
      return MODULE;
    };
    const files = await surfaceInput([
      { path: "src/util.ts", content: "", action: "edit" },
      { path: "src/util.test.ts", content: "", action: "edit" },
      { path: "src/gone.ts", content: "", action: "edit" },
    ], branch);
    expect(asked.sort()).toEqual(["src/gone.ts", "src/util.ts"]);
    expect(files.find((f) => f.path === "src/gone.ts")!.before).toBeNull();
    expect(lostSurface(files).map((l) => l.path)).toEqual(["src/util.ts", "src/util.ts"]);
  });
});
