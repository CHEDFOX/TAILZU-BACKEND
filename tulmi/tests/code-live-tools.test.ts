/**
 * The agent's tools with the live session (code/agent/tools.ts): `grep` and `glob`, and `read_file` and `list_dir` answered from the job's copy of the code
 * (a fake room that uses the real search code) when it has one, and from GitHub's API as they always were when it has not.
 */
import { describe, expect, it } from "vitest";
import { Tools, AGENT_TOOLS, AGENT_TOOL_NAMES } from "../src/code/agent/tools.js";
import { initialState } from "../src/code/agent/types.js";
import type { ViewerEvent } from "../src/code/live/protocol.js";
import { FakeRoom, FakeWorkspace, fakeLog } from "./live-fakes.js";
import { FAKE_STRIPE } from "./agent-rig.js";

const REPO: Record<string, string> = {
  "README.md": "# app\nA small app.\n",
  "src/util.ts": 'export function slug(s: string): string {\n  // TODO: trim the dashes\n  return s.toLowerCase();\n}\n',
  "src/index.ts": 'import { slug } from "./util";\nexport const title = slug("My App");\n',
  "src/util.test.ts": 'import { slug } from "./util";\n// TODO: more cases\n',
  "package-lock.json": '{ "lockfileVersion": 3, "slug": true }\n',
  "node_modules/dep/index.js": "module.exports = 'slug';\n",
  "assets/logo.png": "PNG",
};

function rig(o: { room?: FakeRoom | null; repo?: Record<string, string>; runs?: Array<{ tag: string; commands: string[] }> } = {}) {
  const repo = o.repo ?? REPO;
  const ws = new FakeWorkspace(repo);
  const room = o.room === undefined ? new FakeRoom(repo) : o.room;
  const state = initialState("task", 0);
  const events: ViewerEvent[] = [];
  const tools = new Tools({
    userId: "u", projectId: "p", state, ws: ws as never, brain: {} as never, log: fakeLog(), web: { run: async () => ({ ok: false, message: { content: "no" } }) } as never,
    runStep: async (tag, spec) => { o.runs?.push({ tag, commands: spec.commands }); return { status: "done", exitCode: 0, outputTail: "ok", minutes: 1, stepIdx: 0, ms: 1500 }; },
    closedSource: false, now: () => 1000, ...(room ? { files: room } : {}), progress: (e) => { events.push(e); },
  });
  let n = 0;
  const run = (name: string, args: Record<string, unknown> | string = {}) => tools.exec({ id: `call_${(n += 1)}`, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });
  return { tools, ws, room, state, run, events };
}

describe("the tool list", () => {
  it("has grep and glob, and tells the model which to use for what", () => {
    expect(AGENT_TOOL_NAMES).toEqual(expect.arrayContaining(["grep", "glob"]));
    const by = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t.description]));
    expect(by.grep).toMatch(/EXACT/);
    expect(by.grep).toMatch(/ripgrep/);
    expect(by.grep).toMatch(/sees your staged edits/);
    expect(by.glob).toMatch(/by name/);
    expect(by.glob).toMatch(/use grep for what is inside/);
    expect(by.search_code).toMatch(/WHERE a feature lives/);
    expect(by.search_code).toMatch(/for an exact name or string, use grep/);
    expect(by.run).toMatch(/live session/);
    const grep = AGENT_TOOLS.find((t) => t.name === "grep")!;
    expect((grep.parameters as { required: string[] }).required).toEqual(["pattern"]);
    expect(Object.keys((grep.parameters as { properties: object }).properties)).toEqual(["pattern", "path", "glob", "ignoreCase", "context", "filesOnly", "maxResults"]);
  });
});

describe("read_file and list_dir", () => {
  it("are answered by the copy, without a request to GitHub", async () => {
    const t = rig();
    const read = await t.run("read_file", { path: "src/util.ts" });
    expect(read).toMatchObject({ ok: true, content: "src/util.ts, lines 1-4 of 4." });
    expect(read.data).toBe('1: export function slug(s: string): string {\n2:   // TODO: trim the dashes\n3:   return s.toLowerCase();\n4: }');
    const part = await t.run("read_file", { path: "src/util.ts", from: 2, to: 3 });
    expect(part.content).toBe("src/util.ts, lines 2-3 of 4. Cut at line 3 of 4; ask for the rest with from=4.");
    expect(part.data).toBe("2:   // TODO: trim the dashes\n3:   return s.toLowerCase();");
    const ls = await t.run("list_dir", { path: "src" });
    expect(ls).toMatchObject({ ok: true, content: "src: 3 entries.", data: "index.ts\nutil.test.ts\nutil.ts" });
    expect(t.ws.reads).toEqual([]);
    expect(t.ws.treeCalls).toBe(0);
  });

  it("see the staged edits, and say so", async () => {
    const t = rig();
    await t.run("edit_file", { path: "src/util.ts", old: "s.toLowerCase()", new: "s.toLowerCase().trim()" });
    const read = await t.run("read_file", { path: "src/util.ts" });
    expect(read.content).toMatch(/\(with your staged edits\)$/);
    expect(read.data).toContain("s.toLowerCase().trim()");
    await t.run("write_file", { path: "src/new.ts", content: "export {};\n" });
    expect((await t.run("list_dir", { path: "src" })).data).toBe("index.ts\nnew.ts\nutil.test.ts\nutil.ts");
    await t.run("delete_file", { path: "src/index.ts" });
    expect((await t.run("list_dir", { path: "src" })).data).toBe("new.ts\nutil.test.ts\nutil.ts");
    expect(await t.run("read_file", { path: "src/index.ts" })).toMatchObject({ ok: false, content: "src/index.ts is deleted in your staged edits." });
  });

  it("say what is missing in the words they always did", async () => {
    const t = rig();
    expect(await t.run("read_file", { path: "nope.ts" })).toMatchObject({ ok: false, content: expect.stringMatching(/There is no file nope\.ts on the branch\. Use list_dir, glob or search_code/) });
    expect(await t.run("list_dir", { path: "nowhere" })).toMatchObject({ ok: false, content: expect.stringMatching(/There is nothing in nowhere/) });
    expect(await t.run("read_file", { path: ".env" })).toMatchObject({ ok: false, content: expect.stringMatching(/holds secrets/) });
    expect(await t.run("read_file", { path: "../x" })).toMatchObject({ ok: false });
  });

  it("go to GitHub for a file the copy does not hold (a lockfile), and for everything when there is no copy, the copy is not ready, or it is down", async () => {
    const t = rig();
    const lock = await t.run("read_file", { path: "package-lock.json" });
    expect(lock).toMatchObject({ ok: true });
    expect(t.ws.reads).toEqual(["package-lock.json"]);

    for (const [name, room] of [["no copy", null], ["not ready", Object.assign(new FakeRoom(REPO), { state: { ready: false, remote: false, files: 0, bytes: 0, headSha: "" } })], ["down", Object.assign(new FakeRoom(REPO), { down: true })], ["remote", Object.assign(new FakeRoom(REPO), { state: { ready: false, remote: true, files: 0, bytes: 0, headSha: "" } })]] as const) {
      const g = rig({ room });
      const read = await g.run("read_file", { path: "src/util.ts" });
      expect(read, name).toMatchObject({ ok: true, content: expect.stringMatching(/^src\/util\.ts, lines 1-\d of \d\./) });
      expect(g.ws.reads, name).toEqual(["src/util.ts"]);
      const ls = await g.run("list_dir", { path: "src" });
      expect(ls.data, name).toBe("index.ts\nutil.test.ts\nutil.ts");
      expect(g.ws.treeCalls, name).toBe(1);
    }
  });

  it("withhold a file that looks like it holds a secret, as before", async () => {
    const repo = { ...REPO, "src/conf.ts": `export const key = "${FAKE_STRIPE}";\n` };
    const t = rig({ repo });
    const read = await t.run("read_file", { path: "src/conf.ts" });
    expect(read.content).toMatch(/looks like it holds a secret/);
    expect(read.data).toBeUndefined();
  });

  it("cut a long file at the model's limit and say where to go on", async () => {
    const long = Array.from({ length: 3000 }, (_, i) => `line number ${i + 1} of the file`).join("\n");
    const t = rig({ repo: { "big.txt": long } });
    const read = await t.run("read_file", { path: "big.txt" });
    expect(read.content).toMatch(/Cut at line \d+ of 3000; ask for the rest with from=\d+\./);
    expect(read.data!.length).toBeLessThanOrEqual(12_000);
  });
});

describe("grep", () => {
  it("is answered by the copy, as ripgrep prints, with what it counted in words", async () => {
    const t = rig();
    const g = await t.run("grep", { pattern: "TODO" });
    expect(g).toMatchObject({ ok: true, content: '2 lines match "TODO" in 2 files.' });
    expect(g.data).toBe("src/util.test.ts:2:// TODO: more cases\nsrc/util.ts:2:  // TODO: trim the dashes");
    expect(t.room!.count("grep")).toBe(1);
    expect(t.ws.reads).toEqual([]);
  });

  it("passes the narrowing on: path, glob, ignoreCase, context, filesOnly, maxResults", async () => {
    const t = rig();
    await t.run("grep", { pattern: "todo", path: "src", glob: "*.ts", ignoreCase: true, context: 1, maxResults: 7 });
    expect(t.room!.calls.find((c) => c.op === "grep")!.args).toEqual(["todo", { path: "src", glob: "*.ts", ignoreCase: true, context: 1, maxResults: 7 }]);
    const files = await t.run("grep", { pattern: "slug", filesOnly: true });
    expect(files).toMatchObject({ ok: true, content: '3 files match "slug" in 3 files.', data: "src/index.ts\nsrc/util.test.ts\nsrc/util.ts" });
  });

  it("sees the staged edits", async () => {
    const t = rig();
    await t.run("edit_file", { path: "src/util.ts", old: "// TODO: trim the dashes\n", new: "// done\n" });
    const g = await t.run("grep", { pattern: "TODO" });
    expect(g.data).toBe("src/util.test.ts:2:// TODO: more cases");
    await t.run("write_file", { path: "src/new.ts", content: "// TODO: new\n" });
    expect((await t.run("grep", { pattern: "TODO" })).data).toContain("src/new.ts:1:// TODO: new");
  });

  it("says plainly when nothing matches, and when the search was cut short", async () => {
    const t = rig();
    expect(await t.run("grep", { pattern: "nothing-like-this" })).toMatchObject({ ok: true, content: 'No match for "nothing-like-this".' });
    const lots = rig({ repo: { "a.txt": Array.from({ length: 50 }, (_, i) => `hit ${i}`).join("\n") } });
    const g = await lots.run("grep", { pattern: "hit", maxResults: 5 });
    expect(g.content).toMatch(/PARTIAL: there are more matches than are shown\. Narrow it with path or glob\./);
    expect(g.data!.split("\n")).toHaveLength(5);
  });

  it("tells the model a pattern it must not run is a problem with the pattern", async () => {
    const t = rig();
    const g = await t.run("grep", { pattern: "(a+)+$" });
    expect(g).toMatchObject({ ok: false, content: expect.stringMatching(/Repetition inside a repeated group/) });
    expect(await t.run("grep", { pattern: "(oops" })).toMatchObject({ ok: false, content: expect.stringMatching(/not a regular expression/) });
    expect(await t.run("grep", { pattern: "" })).toMatchObject({ ok: false });
    expect(await t.run("grep", {})).toMatchObject({ ok: false, content: expect.stringMatching(/pattern is needed/) });
  });

  it("withholds a matching line that looks like it holds a secret", async () => {
    const repo = { "src/conf.ts": `export const key = "${FAKE_STRIPE}";\nexport const name = "key";\n` };
    const t = rig({ repo });
    const g = await t.run("grep", { pattern: "key" });
    expect(g.data).toContain("src/conf.ts:2:export const name");
    expect(g.data).toContain("src/conf.ts:1:[line withheld: it looks like it holds a secret]");
    expect(g.data).not.toContain(FAKE_STRIPE);
    expect(g.data).toMatch(/\[1 line withheld/);
  });

  it("does not run in a repo too big for a copy unless a runner can: it says what to do instead", async () => {
    const room = Object.assign(new FakeRoom(REPO), { state: { ready: false, remote: true, files: 0, bytes: 0, headSha: "" } });
    const t = rig({ room });
    const g = await t.run("grep", { pattern: "TODO" });
    expect(g).toMatchObject({ ok: false, content: expect.stringMatching(/too big to search from here.*search_code.*rg/) });
    // with a runner, the room forwards it and the answer is the runner's
    room.remoteGrep = { kind: "ok", out: { ok: true, text: "src/a.ts:1:TODO", matches: 1, files: 1, scanned: 0, partial: false } };
    const ok = await rig({ room }).run("grep", { pattern: "TODO" });
    expect(ok).toMatchObject({ ok: true, data: "src/a.ts:1:TODO" });
  });

  describe("without a copy of the code, from GitHub", () => {
    it("searches the files it can read one by one, honoring the skip rules and the staged edits, and says it is bounded when it is", async () => {
      const t = rig({ room: null });
      const g = await t.run("grep", { pattern: "slug", ignoreCase: true });
      expect(g.data).toBe([
        'src/index.ts:1:import { slug } from "./util";', 'src/index.ts:2:export const title = slug("My App");', 'src/util.test.ts:1:import { slug } from "./util";', "src/util.ts:1:export function slug(s: string): string {",
      ].join("\n"));
      // a lockfile, a vendored folder and an image are not read, and the tree was fetched once
      expect(t.ws.reads.sort()).toEqual(["README.md", "src/index.ts", "src/util.test.ts", "src/util.ts"]);
      expect(t.ws.treeCalls).toBe(1);
      await t.run("edit_file", { path: "src/util.ts", old: "slug(s", new: "slugify(s" });
      expect((await t.run("grep", { pattern: "export function" })).data).toBe("src/util.ts:1:export function slugify(s: string): string {");
    });

    it("looks at no more than 60 files, and says that only some were searched", async () => {
      const many: Record<string, string> = {};
      for (let i = 0; i < 100; i += 1) many[`d/f${String(i).padStart(3, "0")}.ts`] = i === 99 ? "needle\n" : "nothing\n";
      const t = rig({ room: null, repo: many });
      const g = await t.run("grep", { pattern: "needle" });
      expect(t.ws.reads).toHaveLength(60);
      expect(g.content).toMatch(/the search was cut short: only 60 of 100 files were searched, because the code is being read from GitHub one file at a time/);
      const narrow = await rig({ room: null, repo: many }).run("grep", { pattern: "needle", path: "d/f099.ts" });
      expect(narrow.data).toBe("d/f099.ts:1:needle");
    });
  });
});

describe("glob", () => {
  it("is answered by the copy, the most recently changed first, and sees the staged edits", async () => {
    const t = rig();
    const g = await t.run("glob", { pattern: "src/*.ts" });
    expect(g).toMatchObject({ ok: true, content: '3 files match "src/*.ts", most recently changed first.', data: "src/index.ts\nsrc/util.test.ts\nsrc/util.ts" });
    await t.run("write_file", { path: "src/zzz.ts", content: "export {};\n" });
    await t.run("delete_file", { path: "src/index.ts" });
    expect((await t.run("glob", { pattern: "src/*.ts" })).data).toBe("src/zzz.ts\nsrc/util.test.ts\nsrc/util.ts"); // the staged one first
    expect(await t.run("glob", { pattern: "*.nothing" })).toMatchObject({ ok: true, content: 'No file matches "*.nothing".' });
    expect(await t.run("glob", { pattern: "{oops" })).toMatchObject({ ok: false, content: expect.stringMatching(/not a glob/) });
    expect(await t.run("glob", {})).toMatchObject({ ok: false });
    expect(t.ws.treeCalls).toBe(0);
  });

  it("reads GitHub's tree when there is no copy, with the staged edits laid over it", async () => {
    const t = rig({ room: null });
    expect((await t.run("glob", { pattern: "**/*.test.ts" })).data).toBe("src/util.test.ts");
    expect((await t.run("glob", { pattern: "**/*.png" })).data).toBe("assets/logo.png"); // the tree has every file, held or not
    await t.run("write_file", { path: "src/zzz.ts", content: "export {};\n" });
    expect((await t.run("glob", { pattern: "src/*.ts" })).data.split("\n")[0]).toBe("src/zzz.ts");
    expect(t.ws.treeCalls).toBe(1);
  });
});

describe("the staged edits and the copy", () => {
  it("are given to the copy when they change, not before every call", async () => {
    const t = rig();
    await t.run("grep", { pattern: "x" });
    await t.run("grep", { pattern: "y" });
    expect(t.room!.count("setOverlay")).toBe(1); // once: the first need
    await t.run("write_file", { path: "a.ts", content: "a\n" });
    await t.run("grep", { pattern: "x" });
    await t.run("glob", { pattern: "*" });
    expect(t.room!.count("setOverlay")).toBe(2);
    expect(t.room!.overlay).toEqual([{ path: "a.ts", content: "a\n" }]);
  });

  it("are thrown away with the copy when the branch moves, and the copy is asked about again", async () => {
    const t = rig();
    await t.run("grep", { pattern: "x" });
    expect(t.room!.count("status")).toBe(1);
    t.tools.invalidate();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.room!.resets).toBe(1);
    await t.run("grep", { pattern: "x" });
    expect(t.room!.count("status")).toBe(2);
    expect(t.room!.count("setOverlay")).toBe(2);
  });

  it("are not asked about at all for a tool that needs none, or when there is no copy", async () => {
    const t = rig();
    await t.run("note", { text: "a decision" });
    expect(t.room!.calls).toEqual([]);
    const none = rig({ room: null });
    await none.run("grep", { pattern: "slug" });
    expect(none.room).toBeNull();
  });
});

describe("a run", () => {
  it("says how long a command took to the second, when it was quick", async () => {
    const runs: Array<{ tag: string; commands: string[] }> = [];
    const t = rig({ runs });
    const r = await t.run("run", { cmd: "npm test\nnpm run lint", why: "check" });
    expect(r.content).toBe("Exit code 0 (it passed), 1.5 seconds. The end of what it printed:");
    expect(runs).toEqual([{ tag: "call_1", commands: ["npm test", "npm run lint"] }]);
  });

  it("is one run however many times its call is picked up again (a command still out, a session being waited for)", async () => {
    const t = rig();
    t.state.run = { stepIdx: 3, commands: ["npm test"], tag: "call_1" };
    await t.run("run", { cmd: "npm test", why: "again" });
    expect(t.state.work.runs).toBe(0);
    t.state.run = undefined;
    await t.run("run", { cmd: "npm test", why: "new" });
    expect(t.state.work.runs).toBe(1);
    // and a run already counted does not hit the ceiling on its own second look
    t.state.work.runs = 10;
    t.state.run = { stepIdx: 3, commands: ["npm test"], tag: "call_3" };
    expect(await t.run("run", { cmd: "npm test", why: "resumed" })).toMatchObject({ ok: true });
    t.state.run = undefined;
    expect(await t.run("run", { cmd: "npm test", why: "eleventh" })).toMatchObject({ ok: false, content: expect.stringMatching(/10 runs are used already/) });
  });
});

describe("progress for the app's live view", () => {
  it("is a tool call and a short result, for every call", async () => {
    const t = rig();
    await t.run("grep", { pattern: "TODO" });
    await t.run("read_file", { path: "nope.ts" });
    expect(t.events.map((e) => e.t)).toEqual(["tool", "result", "tool", "result"]);
    expect(t.events[0]).toMatchObject({ t: "tool", id: "call_1", name: "grep" });
    expect(t.events[1]).toMatchObject({ t: "result", id: "call_1", ok: true, brief: '2 lines match "TODO" in 2 files.' });
    expect(t.events[3]).toMatchObject({ t: "result", ok: false });
  });

  it("never gets in a tool's way", async () => {
    const ws = new FakeWorkspace(REPO);
    const tools = new Tools({
      userId: "u", projectId: "p", state: initialState("t", 0), ws: ws as never, brain: {} as never, log: fakeLog(), web: {} as never,
      runStep: async () => ({ status: "cancelled", reason: "x" }), closedSource: false, now: () => 1, progress: () => { throw new Error("the view is down"); },
    });
    expect(await tools.exec({ id: "c", name: "note", arguments: '{"text":"fine"}' })).toMatchObject({ ok: true });
  });
});
