/**
 * The live session's pure part (src/code/live): what a copy of the code holds (the project brain's skip rules, applied to a tarball as it streams, with
 * the 50 MB cap), and read / list / glob / grep over text, with the guards against a pattern that would never finish. The room (jobs/src/jobRoom.ts)
 * puts the same code in front of SQLite; its own tests are in jobs/test.
 */
import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  ACTIONS_MONTHLY_MIN_DEFAULT, ACTIONS_NOTIFY_AT, ACTIONS_STOP_AT, FILE_MAX_BYTES, GREP_PATTERN_MAX, SESSION_IDLE_SEC_DEFAULT, SESSION_MAX_MIN_DEFAULT, WORKSPACE_MAX_BYTES,
} from "../src/code/live/limits.js";
import { skipReason, textOf } from "../src/code/live/rules.js";
import {
  byPath, compilePattern, globPaths, globToRegExp, grepFiles, inScope, listDir, patternProblem, readLines, type GrepFile,
} from "../src/code/live/search.js";
import { blobSha, unpackTarball, type HeldWrite } from "../src/code/live/unpack.js";
import { acmeFiles, SECRET_ENV } from "./project-repo.js";
import { responseOf, tarOf, tgz } from "./project-fixtures.js";

const files = (o: Record<string, string>): GrepFile[] => Object.entries(o).map(([path, content]) => ({ path, content })).sort(byPath);

describe("the numbers", () => {
  it("are the ones the settings and the spec name", () => {
    expect(SESSION_IDLE_SEC_DEFAULT).toBe(120);
    expect(SESSION_MAX_MIN_DEFAULT).toBe(20);
    expect(ACTIONS_MONTHLY_MIN_DEFAULT).toBe(2000);
    expect(ACTIONS_NOTIFY_AT).toBe(0.8);
    expect(ACTIONS_STOP_AT).toBe(0.95);
    expect(WORKSPACE_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(FILE_MAX_BYTES).toBe(512 * 1024);
    expect(GREP_PATTERN_MAX).toBe(300);
  });
});

describe("what a copy holds", () => {
  it("applies the brain's skip rules to a path and a size", () => {
    expect(skipReason("src/a.ts", 100)).toBeNull();
    expect(skipReason("README.md", 100)).toBeNull();
    expect(skipReason("docs/notes.txt", 100)).toBeNull(); // unlike the analysis, a person greps a .txt too
    expect(skipReason("fixtures/data.json", 100)).toBeNull();
    expect(skipReason(".env", 10)).toBe("secret");
    expect(skipReason("deploy/server.pem", 10)).toBe("secret");
    expect(skipReason("a/b/id_rsa", 10)).toBe("secret");
    expect(skipReason("credentials.json", 10)).toBe("secret");
    expect(skipReason(".env.example", 10)).toBeNull();
    expect(skipReason("node_modules/x/index.js", 10)).toBe("vendored");
    expect(skipReason("web/dist/app.js", 10)).toBe("vendored");
    expect(skipReason("package-lock.json", 10)).toBe("lockfile");
    expect(skipReason("a.min.js", 10)).toBe("generated");
    expect(skipReason("logo.png", 10)).toBe("binary");
    expect(skipReason("big.txt", FILE_MAX_BYTES + 1)).toBe("too_big");
    expect(skipReason("empty.txt", 0)).toBe("empty");
  });

  it("reads bytes as text without changing a line ending, drops a byte-order mark, and refuses what has a NUL", () => {
    expect(textOf("a.ts", Buffer.from("a\r\nb\r\n"))).toBe("a\r\nb\r\n");
    expect(textOf("a.ts", Buffer.from("﻿hello"))).toBe("hello");
    expect(textOf("a.bin", Buffer.from([104, 105, 0, 1]))).toBeNull();
    expect(textOf(".env.example", Buffer.from("A=1\nB=secret-value\n# note\n"))).toBe("A=\nB=");
  });
});

describe("unpacking a tarball", () => {
  const acme = () => Object.entries(acmeFiles()).map(([path, data]) => ({ path: `acme-shop-abc1234/${path}`, data }));
  async function unpack(specs: Array<{ path: string; data?: string | Buffer }>, o: Parameters<typeof unpackTarball>[2] = {}) {
    const held: HeldWrite[] = [];
    const skipped: Array<[string, number, string]> = [];
    const res = responseOf(tgz([{ path: "acme-shop-abc1234/", type: "5" }, ...specs]), 1000);
    const out = await unpackTarball(res.body!, { file: (f) => held.push(f), skipped: (p, n, why) => skipped.push([p, n, why]) }, o);
    return { out, held, skipped };
  }

  it("holds the sources, lists what it left out, and never holds or names a secret", async () => {
    const { out, held, skipped } = await unpack(acme());
    expect(out.remote).toBe(false);
    const paths = held.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["src/lib/util.ts", "README.md", "package.json", "src/app/page.tsx", "api/main.py"]));
    for (const secret of [".env", "certs/server.pem"]) {
      expect(paths).not.toContain(secret);
      expect(skipped.map((s) => s[0])).not.toContain(secret);
    }
    expect(JSON.stringify(held)).not.toContain(SECRET_ENV.split("\n")[0]);
    expect(skipped).toEqual(expect.arrayContaining([
      ["pnpm-lock.yaml", expect.any(Number), "lockfile"], ["node_modules/lodash/index.js", expect.any(Number), "vendored"], ["dist/bundle.js", expect.any(Number), "vendored"],
      ["assets/logo.png", expect.any(Number), "binary"], ["src/lib/vendor.min.js", expect.any(Number), "generated"], ["src/generated/huge.ts", expect.any(Number), "too_big"],
    ]));
    // a NUL after the start of the file makes it binary; the example env file is its names only
    expect(skipped).toEqual(expect.arrayContaining([["src/lib/weird.js", expect.any(Number), "binary"]]));
    expect(held.find((f) => f.path === ".env.example")!.content).toBe("STRIPE_KEY=\nDATABASE_URL=\nNEXT_PUBLIC_API=");
    expect(out.files).toBe(held.length);
    expect(out.bytes).toBe(held.reduce((n, f) => n + f.size, 0));
  });

  it("gives each file its git blob id and the archive's time", async () => {
    const { held } = await unpack([{ path: "acme-shop-abc1234/a.txt", data: "hello\n" }]);
    expect(held[0]!.sha).toBe(createHash("sha1").update("blob 6\0hello\n").digest("hex"));
    expect(blobSha(Buffer.from("hello\n"))).toBe(held[0]!.sha);
    expect(held[0]!.mtime).toBe(0); // the writer gave none
  });

  it("is `remote` over the cap, stops reading, and holds nothing for the caller to keep", async () => {
    const big = Array.from({ length: 6 }, (_, i) => ({ path: `acme-shop-abc1234/f${i}.txt`, data: "x".repeat(400) }));
    const { out } = await unpack(big, { maxBytes: 1000 });
    expect(out).toMatchObject({ remote: true, files: 2 });
    expect(out.note).toMatch(/over 0 MB of text|MB of text/);
    // the real cap is 50 MB; a hundred small files are under it
    const small = Array.from({ length: 100 }, (_, i) => ({ path: `acme-shop-abc1234/s${i}.txt`, data: `line ${i}\n` }));
    expect((await unpack(small)).out).toMatchObject({ remote: false, files: 100 });
  });

  it("is `remote` for too many files, and for a tarball that is too big or inflates too far", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ path: `acme-shop-abc1234/m${i}.txt`, data: "x" }));
    expect((await unpack(many, { maxFiles: 5 })).out).toMatchObject({ remote: true, files: 5 });
    expect((await unpack(many, { maxCompressed: 100 })).out.remote).toBe(true);
    expect((await unpack([{ path: "acme-shop-abc1234/z.txt", data: "0".repeat(200_000) }], { maxExpanded: 50_000 })).out.remote).toBe(true);
  });

  it("throws what it does not understand: a file that is not a tarball", async () => {
    const res = responseOf(gzipSync(Buffer.from("this is not a tar archive at all".repeat(40))));
    await expect(unpackTarball(res.body!, { file: () => undefined, skipped: () => undefined })).rejects.toBeTruthy();
  });

  it("drops a path that tries to leave the repo, and a file with no folder above it", async () => {
    const { held } = await unpack([{ path: "acme-shop-abc1234/../evil.txt", data: "x" }, { path: "loose.txt", data: "x" }, { path: "acme-shop-abc1234/ok.txt", data: "ok" }]);
    expect(held.map((f) => f.path)).toEqual(["ok.txt"]);
    void tarOf;
  });
});

describe("read", () => {
  const text = "one\ntwo\nthree\nfour\nfive\n";

  it("numbers lines, from an offset, for a limit", () => {
    expect(readLines(text)).toEqual({ text: "1: one\n2: two\n3: three\n4: four\n5: five", from: 1, to: 5, total: 5, truncated: false });
    expect(readLines(text, 2, 2)).toEqual({ text: "2: two\n3: three", from: 2, to: 3, total: 5, truncated: true });
    expect(readLines(text, 5, 10)).toMatchObject({ from: 5, to: 5, truncated: false });
    expect(readLines(text, 9)).toEqual({ text: "", from: 0, to: 0, total: 5, truncated: false });
    expect(readLines("")).toEqual({ text: "", from: 0, to: 0, total: 0, truncated: false });
    expect(readLines("no newline at the end")).toMatchObject({ total: 1, to: 1 });
  });

  it("cuts a long line, a long file and a silly limit", () => {
    const r = readLines(`${"x".repeat(5000)}\nshort\n`);
    expect(r.text.split("\n")[0]!.length).toBeLessThan(2010);
    const many = readLines(Array.from({ length: 9000 }, (_, i) => `l${i}`).join("\n"), 1, 1_000_000);
    expect(many.to).toBeLessThanOrEqual(5000);
    expect(many.truncated).toBe(true);
    expect(readLines(text, -4, 0)).toMatchObject({ from: 1, to: 1 });
    expect(readLines(text, Number.NaN, Number.NaN)).toMatchObject({ from: 1, to: 5 });
  });
});

describe("glob", () => {
  const paths = ["README.md", "src/a.ts", "src/b.tsx", "src/lib/c.ts", "src/lib/deep/d.ts", "test/a.test.ts", "docs/x.md", ".github/ci.yml", "a+b.ts"];
  const hits = (p: string) => { const g = globPaths(paths, p); return g.ok ? g.paths : g; };

  it("matches a name at any depth, or a path from the root", () => {
    expect(hits("*.md")).toEqual(["README.md", "docs/x.md"]);
    expect(hits("src/*.ts")).toEqual(["src/a.ts"]);
    expect(hits("src/**/*.ts")).toEqual(["src/a.ts", "src/lib/c.ts", "src/lib/deep/d.ts"]);
    expect(hits("**/*.test.ts")).toEqual(["test/a.test.ts"]);
    expect(hits("src/**")).toEqual(["src/a.ts", "src/b.tsx", "src/lib/c.ts", "src/lib/deep/d.ts"]);
    expect(hits("**/d.ts")).toEqual(["src/lib/deep/d.ts"]);
    expect(hits("/README.md")).toEqual(["README.md"]);
    expect(hits("./src/a.ts")).toEqual(["src/a.ts"]);
  });

  it("takes ?, classes and braces, and reads a dot or a plus as itself", () => {
    expect(hits("src/?.ts")).toEqual(["src/a.ts"]);
    expect(hits("src/[ab].ts*")).toEqual(["src/a.ts", "src/b.tsx"]);
    expect(hits("src/[!a].ts*")).toEqual(["src/b.tsx"]);
    expect(hits("*.{md,yml}")).toEqual([".github/ci.yml", "README.md", "docs/x.md"]);
    expect(hits("a+b.ts")).toEqual(["a+b.ts"]);
    expect(hits("a.b")).toEqual([]);
  });

  it("refuses what is not a glob", () => {
    for (const bad of ["", "   ", "src/{a,b", "src/[ab", "x".repeat(300)]) expect(globToRegExp(bad), bad).toBeNull();
    expect(globPaths(paths, "src/{a")).toMatchObject({ ok: false });
  });

  it("puts the most recently changed first, then by name, and caps what it returns", () => {
    const recent = new Map([["src/b.tsx", 300], ["src/a.ts", 100], ["src/lib/c.ts", 200]]);
    const g = globPaths(paths, "src/**/*.ts*", recent);
    expect(g.ok && g.paths).toEqual(["src/b.tsx", "src/lib/c.ts", "src/a.ts", "src/lib/deep/d.ts"]);
    const many = Array.from({ length: 700 }, (_, i) => `f${i}.ts`);
    expect(globPaths(many, "*.ts")).toMatchObject({ ok: true, total: 700, partial: true });
    const capped = globPaths(many, "*.ts");
    expect(capped.ok && capped.paths).toHaveLength(500);
  });
});

describe("list", () => {
  const paths = ["README.md", "src/a.ts", "src/lib/c.ts", "src/lib/d.ts", "docs/x.md", "z.txt"];

  it("shows folders first and then files, one level", () => {
    expect(listDir(paths, "")).toEqual({ entries: ["docs/", "src/", "README.md", "z.txt"], total: 4, partial: false });
    expect(listDir(paths, "src")).toMatchObject({ entries: ["lib/", "a.ts"] });
    expect(listDir(paths, "src/")).toMatchObject({ entries: ["lib/", "a.ts"] });
    expect(listDir(paths, "./src/lib")).toMatchObject({ entries: ["c.ts", "d.ts"] });
    expect(listDir(paths, ".")).toMatchObject({ total: 4 });
    expect(listDir(paths, "nope")).toBeNull();
    expect(listDir(paths, "sr")).toBeNull();
  });
});

describe("a pattern that would never finish", () => {
  const bad = ["(a+)+$", "(a*)*b", "(a+)*", "(.*a){12}", "((a+)b)+", "(a|aa)+c", "(a|a?)+", "(x|)+", "(x)\\1", "(?<n>x)\\k<n>", "a".repeat(GREP_PATTERN_MAX + 1), "", "a*b*c*d*e*f*g*"];
  const fine = ["slug|OLD", "\\bexport\\b", "[A-Z]{3,5}", "(foo|bar)+", "(ab)+c", "\\d+\\.\\d+", "TODO\\(", "^\\s*import .* from", "[(a+)+]", "a{2,3}", "x?", "(?:get|set)[A-Z]\\w*", "(a|b)*c"];

  it("is refused before it is run, with a reason", () => {
    for (const p of bad) expect(patternProblem(p), p).toEqual(expect.any(String));
    expect(patternProblem("(a+)+$")).toMatch(/inside a repeated group/);
    expect(patternProblem("a".repeat(301))).toMatch(/over 300/);
    expect(patternProblem("(x)\\1")).toMatch(/back-reference/);
  });

  it("lets an ordinary pattern through, alternation and bounded repeats included", () => {
    for (const p of fine) expect(patternProblem(p), p).toBeNull();
  });

  it("is compiled with ripgrep's `(?i)`, and a pattern JavaScript cannot read is said so", () => {
    const c = compilePattern("(?i)hello");
    expect(c.ok && c.re.test("HELLO")).toBe(true);
    expect(compilePattern("hello", true).ok).toBe(true);
    const nope = compilePattern("(unclosed");
    expect(nope).toMatchObject({ ok: false, error: expect.stringMatching(/not a regular expression/) });
  });
});

describe("grep", () => {
  const code = files({
    "src/a.ts": "import x from 'x';\n// TODO: first\nconst a = 1;\n// TODO: second\nconst b = 2;\n",
    "src/b.ts": "// nothing\nconst Slug = 3;\n",
    "docs/c.md": "# TODO list\nslug rules\n",
    "z.txt": "todo lower\n",
  });

  it("is ripgrep's `path:line:text`, in path order", () => {
    const g = grepFiles(code, "TODO");
    expect(g).toMatchObject({ ok: true, matches: 3, files: 2, scanned: 4, partial: false });
    expect(g.ok && g.text).toBe("docs/c.md:1:# TODO list\nsrc/a.ts:2:// TODO: first\nsrc/a.ts:4:// TODO: second");
  });

  it("takes context, `-` for the lines around and `--` between groups that do not touch", () => {
    const g = grepFiles(files({ "a.txt": ["1", "2", "HIT", "4", "5", "6", "7", "HIT", "9"].join("\n"), "b.txt": "HIT\n" }), "HIT", { context: 1 });
    expect(g.ok && g.text).toBe(["a.txt-2-2", "a.txt:3:HIT", "a.txt-4-4", "--", "a.txt-7-7", "a.txt:8:HIT", "a.txt-9-9", "--", "b.txt:1:HIT"].join("\n"));
    // touching groups are one
    const joined = grepFiles(files({ "a.txt": ["HIT", "x", "HIT"].join("\n") }), "HIT", { context: 1 });
    expect(joined.ok && joined.text).toBe("a.txt:1:HIT\na.txt-2-x\na.txt:3:HIT");
    // and no `--` without context
    expect(grepFiles(code, "TODO").ok && (grepFiles(code, "TODO") as { text: string }).text).not.toContain("--");
  });

  it("narrows by path (a file or a folder) and by glob, and the two together", () => {
    expect((grepFiles(code, "TODO", { path: "src/a.ts" }) as { files: number }).files).toBe(1);
    expect((grepFiles(code, "TODO", { path: "docs" }) as { text: string }).text).toBe("docs/c.md:1:# TODO list");
    expect((grepFiles(code, "TODO", { path: "src/" }) as { matches: number }).matches).toBe(2);
    expect((grepFiles(code, "TODO", { glob: "*.md" }) as { text: string }).text).toBe("docs/c.md:1:# TODO list");
    expect((grepFiles(code, "slug", { ignoreCase: true, path: "src", glob: "*.ts" }) as { text: string }).text).toBe("src/b.ts:2:const Slug = 3;");
    expect(grepFiles(code, "TODO", { glob: "{oops" })).toMatchObject({ ok: false });
    expect(inScope("src/a.ts", "src")).toBe(true);
    expect(inScope("srcs/a.ts", "src")).toBe(false);
    expect(inScope("src/a.ts", "./src/")).toBe(true);
  });

  it("is case sensitive unless told otherwise", () => {
    expect((grepFiles(code, "todo") as { matches: number }).matches).toBe(1);
    expect((grepFiles(code, "todo", { ignoreCase: true }) as { matches: number }).matches).toBe(4);
  });

  it("with filesOnly is the paths and nothing else", () => {
    const g = grepFiles(code, "TODO", { filesOnly: true });
    expect(g).toMatchObject({ ok: true, text: "docs/c.md\nsrc/a.ts", matches: 2, files: 2 });
  });

  it("stops at maxResults, says it is partial and why, and says nothing is missing when it is exact", () => {
    const lots = files({ "a.txt": Array.from({ length: 30 }, (_, i) => `hit ${i}`).join("\n"), "b.txt": "hit b\n" });
    const g = grepFiles(lots, "hit", { maxResults: 5 });
    expect(g).toMatchObject({ ok: true, matches: 5, partial: true, why: "results" });
    expect(g.ok && g.text.split("\n")).toHaveLength(5);
    expect(grepFiles(lots, "hit", { maxResults: 31 })).toMatchObject({ matches: 31, partial: false });
    expect(grepFiles(lots, "hit", { maxResults: 30 })).toMatchObject({ matches: 30, partial: true }); // b.txt has one more
    expect(grepFiles(lots, "hit", { maxResults: 99_999 })).toMatchObject({ matches: 31 });
    expect(grepFiles(lots, "hit", { filesOnly: true, maxResults: 1 })).toMatchObject({ matches: 1, partial: true });
  });

  it("is cut by the TIME budget with `partial: true`, per file and in all", () => {
    let t = 0;
    const slow = files({ a: "line\n", b: "needle\n", c: "needle\n" });
    // every look at the clock costs 60 ms and the whole search is allowed 100: it is cut after the first file
    const g = grepFiles(slow, "needle", {}, { now: () => (t += 60), totalMs: 100, fileMs: 1_000_000 });
    expect(g).toMatchObject({ ok: true, partial: true, why: "time" });
    expect(g.ok && g.matches).toBeLessThan(2);
    // a file that takes longer than its own budget is given up on, and the next file is still searched
    let u = 0;
    const perFile = grepFiles(files({ a: Array.from({ length: 600 }, () => "line").join("\n"), b: "needle\n" }), "needle", {}, { now: () => (u += 40), fileMs: 100, totalMs: 1_000_000 });
    expect(perFile).toMatchObject({ partial: true, why: "time", matches: 1 });
  });

  it("is cut by the WORK budget (characters tested), which needs no clock, with `partial: true`", () => {
    const g = grepFiles(files({ a: "x".repeat(900), b: "needle" }), "needle", {}, { totalChars: 500 });
    expect(g).toMatchObject({ ok: true, partial: true, why: "work", matches: 0 });
    const perFile = grepFiles(files({ a: `${"line\n".repeat(400)}`, b: "needle\n" }), "needle", {}, { fileChars: 300 });
    expect(perFile).toMatchObject({ partial: true, why: "work", matches: 1 });
    expect(grepFiles(code, "TODO", {}, { totalChars: 10_000_000 })).toMatchObject({ partial: false });
  });

  it("matches only the start of a very long line, and cuts what it shows", () => {
    const long = `needle ${"y".repeat(5000)} tail`;
    const g = grepFiles(files({ a: `${long}\nok needle\n` }), "needle");
    expect(g.ok && g.text.split("\n")[0]!.length).toBeLessThan(320);
    expect(grepFiles(files({ a: `${"y".repeat(5000)} needle\n` }), "needle")).toMatchObject({ matches: 0 });
  });

  it("refuses a pattern that is not safe, and says why", () => {
    for (const p of ["(a+)+$", "x".repeat(400), "(oops"]) expect(grepFiles(code, p)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("reads its files lazily: a search that is cut short never asks for the rest", () => {
    let asked = 0;
    function* gen(): Generator<GrepFile> {
      for (let i = 0; i < 100; i += 1) { asked += 1; yield { path: `f${String(i).padStart(3, "0")}.txt`, content: "hit\n" }; }
    }
    const g = grepFiles(gen(), "hit", { maxResults: 3 });
    expect(g).toMatchObject({ matches: 3, partial: true });
    expect(asked).toBeLessThan(10);
  });
});
