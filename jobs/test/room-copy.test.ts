/**
 * THE ROOM'S COPY OF THE CODE AND ITS TOOLS (src/jobRoom.ts): the tarball unpacked into SQLite with the project brain's skip rules, secret
 * files never held, the 50 MB cap, the staged edits laid over reads, read / list / glob / grep, and the copy deleted when the job ends and
 * by an alarm after six idle hours. The room is the real Durable Object; GitHub is a map.
 */
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { roomDeps } from "../src/jobRoom.js";
import { roomOf } from "../src/rooms.js";
import { fakeGithub, github, newJob, SHA40, tarball } from "./live-helpers.js";
import type { Env } from "../src/env.js";

const testEnv = env as unknown as Env;
let restore: Array<() => void> = [];
afterEach(() => { for (const r of restore.splice(0)) r(); roomDeps.maxBytes = undefined; roomDeps.now = () => Date.now(); });

const SECRET_TEXT = ["sk", "live", "not-a-real-value-0123456789"].join("_");
const SRC = [
  "export function slug(s: string): string {",
  "  // TODO: trim the dashes",
  "  return s.toLowerCase().replace(/\\s+/g, \"-\");",
  "}",
  "export const OLD = 1;",
  "",
].join("\n");

const FILES: Record<string, string | Uint8Array> = {
  "README.md": "# app\n\nA small app.\n",
  "src/util.ts": SRC,
  "src/index.ts": 'import { slug } from "./util";\nexport const title = slug("My App");\n',
  "src/util.test.ts": 'import { slug } from "./util";\n// TODO: more cases\n',
  "docs/notes.txt": "Remember the Slug rules.\n",
  "package.json": '{ "name": "app", "scripts": { "test": "vitest run" } }\n',
  "package-lock.json": '{ "lockfileVersion": 3 }\n',
  ".env": `API_KEY=${SECRET_TEXT}\n`,
  ".env.example": "API_KEY=changeme-value\nDEBUG=1\n",
  "config/id_rsa": `${["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" ")}\nabc\n${["-----END", "OPENSSH", "PRIVATE", "KEY-----"].join(" ")}\n`,
  "deploy/server.pem": "pem text\n",
  "credentials.json": `{ "token": "${SECRET_TEXT}" }\n`,
  "node_modules/left-pad/index.js": "module.exports = 1;\n",
  "dist/app.min.js": "var a=1;\n",
  "assets/logo.png": new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]),
  "data/blob.dat": new Uint8Array([0, 1, 2, 3, 4]),
};

async function prepared(n: number, files: Record<string, string | Uint8Array> = FILES, mtime?: Record<string, number>) {
  const jobId = newJob(n);
  const gh = fakeGithub(await tarball(files, mtime ? { mtime } : {}), { redirect: true });
  restore.push(gh.restore);
  const room = roomOf(testEnv, jobId);
  const st = await room.prepare({ jobId, headSha: SHA40, source: github() });
  return { jobId, room, st, gh };
}

describe("the copy", () => {
  it("is unpacked with the brain's skip rules, and the token goes only to GitHub's API", async () => {
    const { st, gh } = await prepared(100);
    expect(st).toMatchObject({ state: "ready", ready: true, remote: false, headSha: SHA40 });
    // held: README, three sources, notes, package.json and .env.example (names only)
    expect(st.files).toBe(7);
    expect(gh.seen).toHaveLength(2);
    expect(gh.seen[0]!.url).toMatch(/^https:\/\/api\.github\.com\/repos\/acme\/app\/tarball\/b{40}$/);
    expect(gh.seen[0]!.authorization).toMatch(/^Bearer /);
    expect(gh.seen[1]!.url).toBe("https://codeload.example/signed-link");
    expect(gh.seen[1]!.authorization).toBeNull();
  });

  it("holds no secret file, not even its name, and no secret text", async () => {
    const { room } = await prepared(101);
    await runInDurableObject(room, async (_i, state) => {
      const sql = state.storage.sql;
      const paths = sql.exec("SELECT path FROM files").toArray().map((r) => String(r.path));
      const skipped = sql.exec("SELECT path, reason FROM skipped").toArray().map((r) => `${r.path}:${r.reason}`);
      expect(paths.sort()).toEqual([".env.example", "README.md", "docs/notes.txt", "package.json", "src/index.ts", "src/util.test.ts", "src/util.ts"]);
      for (const secret of [".env", "config/id_rsa", "deploy/server.pem", "credentials.json"]) {
        expect(paths).not.toContain(secret);
        expect(skipped.join("|")).not.toContain(secret);
      }
      const everything = JSON.stringify([...sql.exec("SELECT * FROM files").toArray(), ...sql.exec("SELECT * FROM skipped").toArray()]);
      expect(everything).not.toContain(SECRET_TEXT);
      // the others are listed by name and reason
      expect(skipped).toEqual(expect.arrayContaining(["package-lock.json:lockfile", "node_modules/left-pad/index.js:vendored", "dist/app.min.js:vendored", "assets/logo.png:binary", "data/blob.dat:binary"]));
    });
    expect(await room.read(".env")).toEqual({ kind: "missing", deleted: false });
    expect(await room.glob("**/id_rsa")).toMatchObject({ kind: "ok", out: { paths: [] } });
    const ls = await room.list("");
    expect(ls.kind === "ok" && ls.out.entries).toEqual(expect.not.arrayContaining([".env", "credentials.json", "config/"]));
  });

  it("keeps only the NAMES of the variables in .env.example", async () => {
    const { room } = await prepared(102);
    const r = await room.read(".env.example");
    expect(r.kind === "ok" && r.out.text).toBe("1: API_KEY=\n2: DEBUG=");
  });

  it("is `remote` over the cap: nothing is kept, and the size is the reason", async () => {
    roomDeps.maxBytes = 200;
    const { st, room } = await prepared(103, { "a.txt": "x".repeat(150), "b.txt": "y".repeat(150), "c.txt": "z".repeat(10) });
    expect(st).toMatchObject({ state: "remote", remote: true, ready: false, files: 0 });
    await runInDurableObject(room, async (_i, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM files").one().n).toBe(0);
    });
    // reads and lists are for GitHub; grep and glob are for a runner, and there is none
    expect(await room.read("a.txt")).toEqual({ kind: "unavailable" });
    expect(await room.list("")).toEqual({ kind: "unavailable" });
    expect(await room.grep("x")).toMatchObject({ kind: "unavailable" });
    expect(await room.glob("*.txt")).toMatchObject({ kind: "unavailable" });
  });

  it("holds as much as the cap allows, and 50 MB is the cap", async () => {
    const { WORKSPACE_MAX_BYTES } = await import("../../tulmi/src/code/live/limits.js");
    expect(WORKSPACE_MAX_BYTES).toBe(50 * 1024 * 1024);
    roomDeps.maxBytes = 300;
    const { st } = await prepared(104, { "a.txt": "x".repeat(150), "b.txt": "y".repeat(150) });
    expect(st.state).toBe("ready");
  });

  it("is made once: a second need is answered from what is held", async () => {
    const { jobId, room, gh } = await prepared(105);
    const again = await room.prepare({ jobId, headSha: SHA40, source: github() });
    expect(again.ready).toBe(true);
    expect(gh.seen).toHaveLength(2);
  });

  it("says what went wrong without the token when GitHub will not give it", async () => {
    const jobId = newJob(106);
    const gh = fakeGithub(new Uint8Array(), { status: 404 });
    restore.push(gh.restore);
    const st = await roomOf(testEnv, jobId).prepare({ jobId, headSha: SHA40, source: github("fake-read-token-should-not-leak") });
    expect(st).toMatchObject({ state: "error", ready: false });
    expect(JSON.stringify(st)).not.toContain("should-not-leak");
    expect(st.error).toMatch(/could not be made/);
  });
});

describe("read", () => {
  it("answers numbered lines, from an offset, for a limit, and says when there is more", async () => {
    const { room } = await prepared(110);
    const r = await room.read("src/util.ts");
    expect(r).toMatchObject({ kind: "ok", staged: false, out: { from: 1, to: 5, total: 5, truncated: false } });
    expect(r.kind === "ok" && r.out.text.split("\n")[1]).toBe("2:   // TODO: trim the dashes");
    const part = await room.read("src/util.ts", { offset: 2, limit: 2 });
    expect(part.kind === "ok" && part.out).toMatchObject({ from: 2, to: 3, total: 5, truncated: true, text: "2:   // TODO: trim the dashes\n3:   return s.toLowerCase().replace(/\\s+/g, \"-\");" });
    const past = await room.read("src/util.ts", { offset: 99 });
    expect(past.kind === "ok" && past.out).toMatchObject({ from: 0, to: 0, total: 5, text: "" });
  });

  it("caps a long line and a long file", async () => {
    const long = `${"x".repeat(5000)}\n${Array.from({ length: 6000 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
    const { room } = await prepared(111, { "big.txt": long });
    const r = await room.read("big.txt");
    expect(r.kind === "ok" && r.out.text.split("\n")[0]!.length).toBeLessThan(2010);
    expect(r.kind === "ok" && r.out.truncated).toBe(true);
    expect(r.kind === "ok" && r.out.to).toBeLessThanOrEqual(5000);
  });

  it("says a file that is in the repo but not held is skipped, and one that is not there is missing", async () => {
    const { room } = await prepared(112);
    expect(await room.read("package-lock.json")).toEqual({ kind: "skipped", reason: "lockfile" });
    expect(await room.read("nope/x.ts")).toEqual({ kind: "missing", deleted: false });
  });
});

describe("the staged edits are laid over every read", () => {
  it("shows an edited file, a new file and a deleted file, in read, list, glob and grep", async () => {
    const { room } = await prepared(120);
    await room.setOverlay([
      { path: "src/util.ts", content: "export function slug() { return 'NEW'; }\n" },
      { path: "src/added.ts", content: "export const ADDED = 'unique-marker';\n" },
      { path: "src/index.ts", content: null },
    ]);
    const read = await room.read("src/util.ts");
    expect(read).toMatchObject({ kind: "ok", staged: true });
    expect(read.kind === "ok" && read.out.text).toContain("'NEW'");
    expect(await room.read("src/index.ts")).toEqual({ kind: "missing", deleted: true });
    expect((await room.read("src/added.ts")).kind).toBe("ok");

    const ls = await room.list("src");
    expect(ls.kind === "ok" && ls.out.entries).toEqual(["added.ts", "util.test.ts", "util.ts"]);
    const gl = await room.glob("src/*.ts");
    expect(gl.kind === "ok" && gl.out.paths).toEqual(expect.arrayContaining(["src/added.ts", "src/util.ts"]));
    expect(gl.kind === "ok" && gl.out.paths).not.toContain("src/index.ts");

    const g = await room.grep("unique-marker");
    expect(g.kind === "ok" && g.out.text).toBe("src/added.ts:1:export const ADDED = 'unique-marker';");
    // the old text of an edited file is gone, the deleted file is not searched
    expect((await room.grep("TODO: trim")).kind === "ok" && (await room.grep("TODO: trim") as { out: { matches: number } }).out.matches).toBe(0);
    expect((await room.grep("My App")).kind === "ok" && (await room.grep("My App") as { out: { matches: number } }).out.matches).toBe(0);
  });

  it("goes back to the branch when the edits are taken away", async () => {
    const { room } = await prepared(121);
    await room.setOverlay([{ path: "src/util.ts", content: "changed\n" }]);
    await room.setOverlay([]);
    const r = await room.read("src/util.ts");
    expect(r).toMatchObject({ kind: "ok", staged: false });
  });
});

describe("grep", () => {
  it("answers ripgrep's `path:line:text`, in path order", async () => {
    const { room } = await prepared(130);
    const g = await room.grep("TODO");
    expect(g).toMatchObject({ kind: "ok", out: { matches: 2, files: 2, partial: false } });
    expect(g.kind === "ok" && g.out.text).toBe("src/util.test.ts:2:// TODO: more cases\nsrc/util.ts:2:  // TODO: trim the dashes");
  });

  it("takes context lines, with `-` for them and `--` between groups", async () => {
    const { room } = await prepared(131, { "a.txt": ["one", "two", "HIT one", "four", "five", "six", "seven", "HIT two", "nine"].join("\n") });
    const g = await room.grep("HIT", { context: 1 });
    expect(g.kind === "ok" && g.out.text).toBe(["a.txt-2-two", "a.txt:3:HIT one", "a.txt-4-four", "--", "a.txt-7-seven", "a.txt:8:HIT two", "a.txt-9-nine"].join("\n"));
    expect(g.kind === "ok" && g.out.matches).toBe(2);
  });

  it("narrows by folder or file (path) and by glob", async () => {
    const { room } = await prepared(132);
    expect((await room.grep("slug", { path: "src/index.ts" })).kind === "ok" && ((await room.grep("slug", { path: "src/index.ts" })) as { out: { files: number } }).out.files).toBe(1);
    const inSrc = await room.grep("slug", { path: "src" });
    expect(inSrc.kind === "ok" && inSrc.out.text.split("\n").every((l) => l.startsWith("src/"))).toBe(true);
    const tests = await room.grep("slug", { glob: "*.test.ts" });
    expect(tests.kind === "ok" && tests.out.text).toBe('src/util.test.ts:1:import { slug } from "./util";');
    const docs = await room.grep("slug", { path: "docs", glob: "*.txt", ignoreCase: true });
    expect(docs.kind === "ok" && docs.out.text).toBe("docs/notes.txt:1:Remember the Slug rules.");
  });

  it("is case sensitive unless told otherwise", async () => {
    const { room } = await prepared(133);
    expect((await room.grep("slug rules")).kind === "ok" && ((await room.grep("slug rules")) as { out: { matches: number } }).out.matches).toBe(0);
    const g = await room.grep("slug rules", { ignoreCase: true });
    expect(g.kind === "ok" && g.out.matches).toBe(1);
    const inline = await room.grep("(?i)SLUG RULES");
    expect(inline.kind === "ok" && inline.out.matches).toBe(1);
  });

  it("with filesOnly gives the paths and nothing else", async () => {
    const { room } = await prepared(134);
    const g = await room.grep("slug", { filesOnly: true });
    expect(g.kind === "ok" && g.out.text).toBe("src/index.ts\nsrc/util.test.ts\nsrc/util.ts");
    expect(g.kind === "ok" && g.out.matches).toBe(3);
  });

  it("stops at maxResults and says it is partial", async () => {
    const { room } = await prepared(135, { "a.txt": Array.from({ length: 50 }, (_, i) => `hit ${i}`).join("\n") });
    const g = await room.grep("hit", { maxResults: 5 });
    expect(g).toMatchObject({ kind: "ok", out: { matches: 5, partial: true, why: "results" } });
    expect(g.kind === "ok" && g.out.text.split("\n")).toHaveLength(5);
    const exact = await room.grep("hit", { maxResults: 50 });
    expect(exact).toMatchObject({ kind: "ok", out: { matches: 50, partial: false } });
  });

  it("refuses a pattern that could run for ever, one that is too long, and one that is not a pattern", async () => {
    const { room } = await prepared(136);
    for (const p of ["(a+)+$", "(a*)*b", "(.*a){12}", "(a|aa)+c", "(x)\\1", "a".repeat(301)]) {
      const g = await room.grep(p);
      expect(g.kind, p.slice(0, 20)).toBe("error");
    }
    expect(await room.grep("(unclosed")).toMatchObject({ kind: "error", error: expect.stringMatching(/not a regular expression/) });
    // ordinary patterns, including alternation and bounded repeats, are fine
    for (const p of ["slug|OLD", "\\bexport\\b", "[A-Z]{3,5}", "(foo|bar)+"]) expect((await room.grep(p)).kind, p).toBe("ok");
  });

  it("is cut by its work budget with `partial: true`, and says why", async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i} of a long file`).join("\n");
    const { room } = await prepared(137, { "a.txt": lines, "b.txt": lines, "c.txt": `${lines}\nneedle` });
    const g = await room.grep("needle", {}, { totalChars: 15_000 });
    expect(g).toMatchObject({ kind: "ok", out: { partial: true, why: "work", matches: 0 } });
    const whole = await room.grep("needle");
    expect(whole).toMatchObject({ kind: "ok", out: { partial: false, matches: 1 } });
  });
});

describe("glob", () => {
  it("finds by name at any depth or from the root, with braces and classes", async () => {
    const { room } = await prepared(140);
    const paths = async (p: string) => { const g = await room.glob(p); return g.kind === "ok" ? g.out.paths : g; };
    expect(await paths("*.md")).toEqual(["README.md"]);
    expect(await paths("src/**/*.ts")).toEqual(["src/index.ts", "src/util.test.ts", "src/util.ts"]);
    expect(await paths("**/*.test.ts")).toEqual(["src/util.test.ts"]);
    expect(await paths("{README,package}.{md,json}")).toEqual(["README.md", "package.json"]);
    expect(await paths("src/util?ts")).toEqual(["src/util.ts"]);
    expect(await paths("docs/*")).toEqual(["docs/notes.txt"]);
    // files that are listed but not held can be found by name too
    expect(await paths("**/*.png")).toEqual(["assets/logo.png"]);
    expect(await room.glob("")).toMatchObject({ kind: "error" });
    expect(await room.glob("src/{a,b")).toMatchObject({ kind: "error" });
  });

  it("puts the most recently changed first when it is known, and staged edits before all", async () => {
    const { room } = await prepared(141, { "a.ts": "a", "b.ts": "b", "c.ts": "c" }, { "a.ts": 1_700_000_100, "b.ts": 1_700_000_300, "c.ts": 1_700_000_200 });
    const g = await room.glob("*.ts");
    expect(g.kind === "ok" && g.out.paths).toEqual(["b.ts", "c.ts", "a.ts"]);
    await room.setOverlay([{ path: "a.ts", content: "new" }]);
    const g2 = await room.glob("*.ts");
    expect(g2.kind === "ok" && g2.out.paths).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});

describe("list", () => {
  it("shows folders first, then files, and says a folder that is not there is empty", async () => {
    const { room } = await prepared(150);
    const root = await room.list("");
    expect(root.kind === "ok" && root.out.entries).toEqual(["assets/", "data/", "dist/", "docs/", "node_modules/", "src/", ".env.example", "README.md", "package-lock.json", "package.json"]);
    expect(await room.list("nope")).toEqual({ kind: "empty" });
    const src = await room.list("src/");
    expect(src.kind === "ok" && src.out.entries).toEqual(["index.ts", "util.test.ts", "util.ts"]);
  });
});

describe("the copy is not kept", () => {
  it("is deleted, with its alarm, when the job ends", async () => {
    const { room } = await prepared(160);
    await room.setOverlay([{ path: "x.ts", content: "staged" }]);
    await room.message("hello", newJob(160));
    await room.endJob();
    expect(await room.status()).toMatchObject({ state: "empty", ready: false, files: 0 });
    await runInDurableObject(room, async (_i, state) => {
      for (const t of ["files", "skipped", "overlay", "execs", "inbox", "events"]) {
        expect(state.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${t}`).one().n, t).toBe(0);
      }
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("is deleted by an alarm after six idle hours, and not before", async () => {
    const { room } = await prepared(161);
    await runInDurableObject(room, async (_i, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    // five hours on: the alarm finds a copy that is not stale yet and goes back to sleep
    roomDeps.now = () => Date.now() + 5 * 3600_000;
    expect(await runDurableObjectAlarm(room)).toBe(true);
    expect((await room.status()).ready).toBe(true);
    // seven hours on: gone
    roomDeps.now = () => Date.now() + 7 * 3600_000;
    expect(await runDurableObjectAlarm(room)).toBe(true);
    expect(await room.status()).toMatchObject({ state: "empty", files: 0 });
    await runInDurableObject(room, async (_i, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM files").one().n).toBe(0);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("is made again after it is thrown away because the branch moved", async () => {
    const { jobId, room, gh } = await prepared(162);
    await room.invalidate();
    expect((await room.status()).ready).toBe(false);
    const again = await room.prepare({ jobId, headSha: "c".repeat(40), source: github() });
    expect(again).toMatchObject({ ready: true, headSha: "c".repeat(40) });
    expect(gh.seen.length).toBe(4);
  });
});
