/**
 * The project brain, fetching the code: the tar reader (ustar, pax and GNU long
 * names, the compressed and inflated caps), and the snapshot (what is chosen to
 * be read from the tree, what is skipped and why, what is never kept, the
 * tarball and the blobs, and the tree-only fall-back).
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ConnectorError } from "../src/connectors/oauth.js";
import type { GithubApp, RepoRef } from "../src/code/github.js";
import { gunzipStream, readTar, TarError, type TarEntry } from "../src/code/project/tar.js";
import {
  decodeText, fetchBlobs, fetchContents, fetchTarball, namesOnly, selectFiles, stripTop, treeFromEntries, type Candidate,
} from "../src/code/project/snapshot.js";
import { FILES_MAX, TEXT_MAX_BYTES, TARBALL_MAX_BYTES } from "../src/code/project/types.js";
import { responseOf, tarOf, tgz, type TarSpec } from "./project-fixtures.js";

const all = async (source: AsyncIterable<Uint8Array>, want: (e: { path: string; size: number }) => boolean = () => true, maxExpanded?: number): Promise<TarEntry[]> => {
  const out: TarEntry[] = [];
  for await (const e of readTar(source, { want, maxExpanded })) out.push(e);
  return out;
};
async function* chunks(buf: Buffer, size: number): AsyncGenerator<Uint8Array> { for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size); }
const text = (e: TarEntry | undefined) => e?.data?.toString("utf8");

describe("the tar reader", () => {
  it("reads regular files, directories and symlinks, with data only where it was wanted", async () => {
    const tar = tarOf([
      { path: "top/", type: "5" }, { path: "top/a.txt", data: "hello" }, { path: "top/link", type: "2" }, { path: "top/big.bin", data: "x".repeat(1500) }, { path: "top/empty", data: "" },
    ]);
    const got = await all(chunks(tar, 700), (e) => e.path !== "top/big.bin");
    expect(got.map((e) => [e.path, e.kind, e.size])).toEqual([["top", "dir", 0], ["top/a.txt", "file", 5], ["top/link", "symlink", 0], ["top/big.bin", "file", 1500], ["top/empty", "file", 0]]);
    expect(text(got[1])).toBe("hello");
    expect(got[3]!.data).toBeUndefined();
    expect(got[4]!.data!.length).toBe(0);
  });

  it("gives the same entries however the bytes arrive: whole, in 512s, or one at a time", async () => {
    const tar = tarOf([{ path: "t/one", data: "1".repeat(513) }, { path: "t/two", data: "2".repeat(511) }, { path: "t/three", data: "3" }]);
    const whole = await all(chunks(tar, tar.length));
    for (const size of [1, 7, 512, 513, 1000]) expect((await all(chunks(tar, size))).map((e) => [e.path, text(e)?.length, text(e)?.[0]])).toEqual(whole.map((e) => [e.path, text(e)?.length, text(e)?.[0]]));
    expect(whole.map((e) => text(e)?.length)).toEqual([513, 511, 1]);
  });

  it("joins a ustar prefix to the name, but only where the magic says ustar", async () => {
    const long = `${"deep/".repeat(30)}file.txt`; // 150 characters
    const got = await all(chunks(tarOf([{ path: long, data: "p", prefix: true }]), 4096));
    expect(got[0]!.path).toBe(long);
    expect(text(got[0])).toBe("p");
  });

  it("takes the path from a pax header over the name", async () => {
    const long = `${"a-very-long-directory-name/".repeat(8)}index.ts`;
    expect(long.length).toBeGreaterThan(200);
    const got = await all(chunks(tarOf([{ path: long, data: "pax", pax: true }, { path: "next.txt", data: "after" }]), 4096));
    expect(got.map((e) => e.path)).toEqual([long, "next.txt"]);
    expect(text(got[0])).toBe("pax");
  });

  it("reads a pax path with multi-byte characters, and applies it to the next entry only", async () => {
    const path = "src/हिन्दी/été.txt";
    const got = await all(chunks(tarOf([{ path, data: "x", pax: true }, { path: "plain.txt", data: "y" }]), 100));
    expect(got.map((e) => e.path)).toEqual([path, "plain.txt"]);
  });

  it("reads a GNU long name (an L entry) for the entry after it", async () => {
    const long = `${"component/".repeat(25)}Button.tsx`;
    const got = await all(chunks(tarOf([{ path: long, data: "g", longName: true }, { path: "short.txt", data: "s" }]), 3000));
    expect(got.map((e) => e.path)).toEqual([long, "short.txt"]);
    expect(text(got[0])).toBe("g");
  });

  it("ignores a global pax header (GitHub writes one with the commit) and strips trailing slashes from folders", async () => {
    const got = await all(chunks(tarOf([{ path: "pax_global_header", type: "g", data: "52 comment=0123456789012345678901234567890123456789\n" }, { path: "repo-abc/", type: "5" }]), 600));
    expect(got).toEqual([{ path: "repo-abc", kind: "dir", size: 0 }]);
  });

  it("stops at the end-of-archive blocks and ignores what follows them", async () => {
    const tar = Buffer.concat([tarOf([{ path: "t/a", data: "a" }]), Buffer.from("trailing garbage that is not a header".padEnd(1024, "x"))]);
    expect((await all(chunks(tar, 512))).map((e) => e.path)).toEqual(["t/a"]);
  });

  it("refuses a header whose checksum is wrong", async () => {
    await expect(all(chunks(tarOf([{ path: "t/a", data: "a", badChecksum: true }]), 512))).rejects.toMatchObject({ name: "TarError", code: "bad_tar" });
  });

  it("refuses an archive that ends in the middle of a file, and one that ends in the middle of a header", async () => {
    const tar = tarOf([{ path: "t/a", data: "z".repeat(2000) }]);
    await expect(all(chunks(tar.subarray(0, 900), 512))).rejects.toMatchObject({ code: "truncated" });
    await expect(all(chunks(tar.subarray(0, 300), 512))).rejects.toMatchObject({ code: "truncated" });
  });

  it("refuses a size that no archive could mean", async () => {
    const h = tarOf([{ path: "t/a", data: "a" }]).subarray(0, 512);
    const bad = Buffer.from(h);
    // base-256 size of 2^40 bytes, with the checksum made right again
    bad.fill(0, 124, 136);
    bad[124] = 0x80; bad[130] = 0x01;
    bad.write("        ", 148);
    let sum = 0;
    for (const b of bad) sum += b;
    bad.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
    await expect(all(chunks(Buffer.concat([bad, Buffer.alloc(1024)]), 512))).rejects.toMatchObject({ code: "bad_tar" });
  });

  it("reads a size written in base-256", async () => {
    const tar = tarOf([{ path: "t/a", data: "q".repeat(300) }]);
    const h = Buffer.from(tar.subarray(0, 512));
    h.fill(0, 124, 136);
    h[124] = 0x80; h[134] = 0x01; h[135] = 0x2c; // 300
    h.write("        ", 148);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
    const got = await all(chunks(Buffer.concat([h, tar.subarray(512)]), 512));
    expect(text(got[0])?.length).toBe(300);
  });

  it("stops when more has come out of the gunzip than the cap allows (a bomb)", async () => {
    const bomb = gzipSync(tarOf([{ path: "t/zeros", data: Buffer.alloc(30 * 1024 * 1024) }]));
    expect(bomb.length).toBeLessThan(100_000);
    await expect(all(gunzipStream(responseOf(bomb, 4096).body!, { maxCompressed: 1 << 20 }), () => false, 2 * 1024 * 1024)).rejects.toMatchObject({ code: "expanded_too_large" });
  });
});

describe("gunzipStream", () => {
  it("inflates a gzipped tarball from a web stream or an async iterable", async () => {
    const gz = tgz([{ path: "t/a.txt", data: "one" }, { path: "t/b.txt", data: "two" }]);
    expect((await all(gunzipStream(responseOf(gz, 64).body!, { maxCompressed: 1 << 20 }))).map(text)).toEqual(["one", "two"]);
    expect((await all(gunzipStream(chunks(gz, 100), { maxCompressed: 1 << 20 }))).map(text)).toEqual(["one", "two"]);
  });

  it("stops as the compressed bytes cross the cap, not after the download", async () => {
    // Random bytes do not compress: 300 KB of them is about 300 KB of gzip.
    const gz = tgz([{ path: "t/noise", data: randomBytes(300 * 1024) }]);
    let sent = 0;
    async function* counted(): AsyncGenerator<Uint8Array> { for (let i = 0; i < gz.length; i += 4096) { sent += 4096; yield gz.subarray(i, i + 4096); } }
    await expect(all(gunzipStream(counted(), { maxCompressed: 20_000 }), () => false)).rejects.toMatchObject({ name: "TarError", code: "compressed_too_large" });
    expect(sent).toBeLessThan(gz.length);
  });

  it("reports a stream that is not gzip as an error, not an empty archive", async () => {
    await expect(all(gunzipStream(chunks(Buffer.from("this is not gzip at all, just text"), 10), { maxCompressed: 1000 }))).rejects.toThrow();
  });
});

// ------------------------------------------------------------------ the snapshot

const entry = (path: string, size = 100, sha?: string) => ({ path, type: "blob", size, sha: sha ?? `${path.length.toString(16).padStart(2, "0")}${"a".repeat(38)}` });
const treeOf = (entries: Array<{ path: string; type: string; size?: number; sha: string }>) => treeFromEntries("h".repeat(40), "t".repeat(40), entries, false);

describe("what is read, from the tree alone", () => {
  const sel = (paths: Array<string | [string, number]>, known: Record<string, string> = {}) =>
    selectFiles(treeOf(paths.map((p) => (typeof p === "string" ? entry(p) : entry(p[0], p[1])))), known);

  it("skips vendored and output folders, wherever they are", () => {
    const s = sel([
      "src/a.ts", "node_modules/x/index.js", "vendor/github.com/y.go", "dist/a.js", "build/out.js", "out/page.html", ".next/server.js", "target/debug/x.rs",
      "coverage/lcov.js", "pkg/__pycache__/m.py", ".git/hooks/pre-commit", "packages/ui/node_modules/z.js", "app/build/generated.java",
    ]);
    expect(s.candidates.map((c) => c.path)).toEqual(["src/a.ts"]);
    expect(s.skipped.vendored).toBe(12);
  });

  it("skips minified files, source maps and generated code, but records the lockfiles", () => {
    const s = sel(["a.ts", "bundle.min.js", "style.min.css", "a.js.map", "api.pb.go", "model.g.dart", "x.freezed.dart", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "go.sum", "poetry.lock", "svc/Gemfile.lock"]);
    expect(s.candidates.map((c) => c.path)).toEqual(["a.ts"]);
    expect(s.lockfiles).toEqual(["Cargo.lock", "go.sum", "package-lock.json", "pnpm-lock.yaml", "poetry.lock", "svc/Gemfile.lock", "yarn.lock"]);
    expect(s.skipped.generated).toBe(6);
  });

  it("skips binaries by extension, files over 512 KB, empty files, and what it does not know how to read", () => {
    const s = sel(["a.ts", "logo.png", "font.woff2", "app.zip", "tool.exe", "doc.pdf", "model.onnx", ["huge.ts", 512 * 1024 + 1], ["just-fits.ts", 512 * 1024], ["empty.ts", 0], "notes.xyz", "LICENSE", "data.csv", "bigdata.json", "image.svg"]);
    expect(s.candidates.map((c) => c.path).sort()).toEqual(["a.ts", "just-fits.ts"]);
    expect(s.skipped.binary).toBeGreaterThanOrEqual(6);
    expect(s.skipped.tooBig).toBe(1);
  });

  it("records .env files, keys and certificates by path and never offers them for reading", () => {
    const s = sel([".env", ".env.local", ".env.production", "certs/server.pem", "id_rsa", "deploy/key.p12", "ssl/site.crt", "keystore.jks", ".npmrc", "terraform.tfstate", "config/credentials.json", "a.ts"]);
    expect(s.candidates.map((c) => c.path)).toEqual(["a.ts"]);
    expect(s.secretFiles).toEqual([".env", ".env.local", ".env.production", ".npmrc", "certs/server.pem", "config/credentials.json", "deploy/key.p12", "id_rsa", "keystore.jks", "ssl/site.crt", "terraform.tfstate"]);
  });

  it("reads .env.example (it is documentation) and the manifests, and flags them as core", () => {
    const s = sel([".env.example", ".env.sample", ".env.template", "package.json", "tsconfig.json", "README.md", "CLAUDE.md", "src/a.ts", "packages/a/package.json"]);
    const core = s.candidates.filter((c) => c.core).map((c) => c.path).sort();
    expect(core).toEqual([".env.example", ".env.sample", ".env.template", "CLAUDE.md", "README.md", "package.json", "packages/a/package.json", "tsconfig.json"]);
    expect(s.secretFiles).toEqual([]);
  });

  it("reads translation JSON and manifests but not other JSON", () => {
    const s = sel(["package.json", "locales/en.json", "src/i18n/hi.json", "tsconfig.base.json", "fixtures/data.json", "package-lock.json", "app/strings.arb"]);
    expect(s.candidates.map((c) => c.path).sort()).toEqual(["app/strings.arb", "locales/en.json", "package.json", "src/i18n/hi.json", "tsconfig.base.json"]);
  });

  it("does not fetch a file again that was read and found to be binary at the same sha", () => {
    const e = entry("assets/blob.js", 100, "b".repeat(40));
    const s = selectFiles(treeOf([e, entry("a.ts")]), { "assets/blob.js": "b".repeat(40) });
    expect(s.candidates.map((c) => c.path)).toEqual(["a.ts"]);
    expect(selectFiles(treeOf([{ ...e, sha: "c".repeat(40) }]), { "assets/blob.js": "b".repeat(40) }).candidates).toHaveLength(1);
  });

  it("caps the files at 20,000, the most useful first: core files, then source, then tests, then the rest", () => {
    const entries = [entry("README.md"), entry("package.json")];
    for (let i = 0; i < FILES_MAX + 50; i += 1) entries.push(entry(`docs/page${i}.md`));
    entries.push(entry("src/main.ts"), entry("src/main.test.ts"));
    const s = selectFiles(treeOf(entries));
    expect(s.candidates).toHaveLength(FILES_MAX);
    expect(s.skipped.capped).toBe(54);
    const paths = new Set(s.candidates.map((c) => c.path));
    expect(["README.md", "package.json", "src/main.ts", "src/main.test.ts"].every((p) => paths.has(p))).toBe(true);
  });

  it("caps the text at 60 MB in memory", () => {
    const entries = [entry("package.json"), entry("src/main.ts")];
    for (let i = 0; i < 140; i += 1) entries.push({ ...entry(`src/gen/part${i}.ts`), size: 500 * 1024 });
    const s = selectFiles(treeOf(entries));
    const bytes = s.candidates.reduce((n, c) => n + c.size, 0);
    expect(bytes).toBeLessThanOrEqual(TEXT_MAX_BYTES);
    expect(s.skipped.capped).toBeGreaterThan(0);
    expect(s.candidates[0]!.path).toBe("package.json");
  });

  it("keeps files and folders with their shas, and drops submodules", () => {
    const t = treeOf([{ path: "src", type: "tree", sha: "d".repeat(40) }, entry("src/a.ts", 5, "e".repeat(40)), { path: "vendor/lib", type: "commit", sha: "f".repeat(40) }]);
    expect([...t.files]).toEqual([["src/a.ts", { sha: "e".repeat(40), size: 5 }]]);
    expect([...t.dirs]).toEqual([["", "t".repeat(40)], ["src", "d".repeat(40)]]);
  });
});

describe("what is held of a file", () => {
  it("calls a file binary when a NUL is in its first 8 KB, and only then", () => {
    expect(decodeText(Buffer.from("hello\0world"))).toBeNull();
    expect(decodeText(Buffer.concat([Buffer.from("a".repeat(9000)), Buffer.from([0])]))).toHaveLength(9001);
    expect(decodeText(Buffer.from("plain"))).toBe("plain");
  });

  it("drops a byte-order mark and turns CRLF into LF without changing the line count", () => {
    expect(decodeText(Buffer.from("﻿a\r\nb\r\nc"))).toBe("a\nb\nc");
  });

  it("keeps only the names from an example env file, never a value", () => {
    const out = namesOnly("# comment\nSTRIPE_KEY=sk_live_abc123\nexport DATABASE_URL = postgres://u:p@h/db\n\nPLAIN=\nlower_case=1\n");
    expect(out).toBe("STRIPE_KEY=\nDATABASE_URL=\nPLAIN=\nlower_case=");
    expect(out).not.toMatch(/sk_live|postgres|u:p/);
  });

  it("drops the top folder of a tarball path, and refuses a path that leaves the repo", () => {
    expect(stripTop("owner-repo-abc1234/src/a.ts")).toBe("src/a.ts");
    expect(stripTop("owner-repo-abc1234/")).toBeNull();
    expect(stripTop("owner-repo-abc1234/../etc/passwd")).toBeNull();
    expect(stripTop("owner-repo-abc1234/a/./b")).toBeNull();
    expect(stripTop("/etc/passwd")).toBeNull();
    expect(stripTop("nofolder")).toBeNull();
  });
});

// ---------------------------------------------------------------- getting it

const repo = {} as RepoRef;
const cand = (path: string, sha = "a".repeat(40), core = false): Candidate => ({ path, sha, size: 10, core });

/** A GithubApp that serves one tarball (or throws), and blobs by sha. */
function fakeGithub(o: { tarball?: () => Promise<Response>; blobs?: Record<string, Buffer | Error> }) {
  const blobCalls: string[] = [];
  const github = {
    downloadTarball: o.tarball ?? (async () => { throw new Error("no tarball"); }),
    blobBytes: async (_r: RepoRef, sha: string) => {
      blobCalls.push(sha);
      const b = o.blobs?.[sha];
      if (b instanceof Error) throw b;
      if (!b) throw new ConnectorError("not_found", "gone");
      return b;
    },
  } as unknown as GithubApp;
  return { github, blobCalls };
}

describe("the tarball", () => {
  const files = tgz([
    { path: "o-r-abc1234/", type: "5" }, { path: "o-r-abc1234/src/a.ts", data: "export const a = 1;\n" }, { path: "o-r-abc1234/src/skip.ts", data: "not wanted" },
    { path: "o-r-abc1234/.env.example", data: "KEY=secret-value\nOTHER=v2\n" }, { path: "o-r-abc1234/.env", data: "SECRET=hunter2" }, { path: "o-r-abc1234/img.js", data: "a\0b" },
    { path: "o-r-abc1234/../escape.ts", data: "evil" }, { path: "o-r-abc1234/crlf.ts", data: "x\r\ny" },
  ]);

  it("keeps only the wanted files, without the top folder, and nothing it was not asked for", async () => {
    const { github } = fakeGithub({ tarball: async () => responseOf(files, 1000) });
    const wanted = [cand("src/a.ts"), cand(".env.example", "b".repeat(40), true), cand("img.js", "c".repeat(40)), cand("crlf.ts"), cand("escape.ts")];
    const got = await fetchTarball(github, repo, "s".repeat(40), wanted);
    expect(got.via).toBe("tarball");
    expect([...got.texts.keys()].sort()).toEqual([".env.example", "crlf.ts", "src/a.ts"]);
    expect(got.texts.get("src/a.ts")).toBe("export const a = 1;\n");
    expect(got.texts.get("crlf.ts")).toBe("x\ny");
    expect(got.texts.get(".env.example")).toBe("KEY=\nOTHER=");
    expect([...got.texts.values()].join("\n")).not.toMatch(/secret-value|hunter2|evil/);
    expect([...got.binary]).toEqual([["img.js", "c".repeat(40)]]);
  });

  it("is one request: the tarball, and no blobs", async () => {
    const { github, blobCalls } = fakeGithub({ tarball: async () => responseOf(files) });
    const got = await fetchContents(github, repo, "s".repeat(40), [cand("src/a.ts")], { tarball: true });
    expect(got.via).toBe("tarball");
    expect(blobCalls).toEqual([]);
  });

  it("falls back to the tree and the core files when the download is declared over 300 MB", async () => {
    const { github, blobCalls } = fakeGithub({
      tarball: async () => responseOf(files, 1000, { headers: { "content-length": String(TARBALL_MAX_BYTES + 1) } }),
      blobs: { [`${"d".repeat(40)}`]: Buffer.from('{"name":"x"}') },
    });
    const got = await fetchContents(github, repo, "s".repeat(40), [cand("src/a.ts"), cand("package.json", "d".repeat(40), true)], { tarball: true });
    expect(got.via).toBe("tree_only");
    expect(got.note).toMatch(/too big/);
    expect([...got.texts.keys()]).toEqual(["package.json"]);
    expect(blobCalls).toEqual(["d".repeat(40)]);
  });

  it("falls back the same way when the download is not an archive, or GitHub will not hand it over", async () => {
    const small = cand("package.json", "e".repeat(40), true);
    const blobs = { ["e".repeat(40)]: Buffer.from("{}") };
    for (const tarball of [
      async () => responseOf(Buffer.from("this is not a gzip stream"), 8),
      async () => { throw new ConnectorError("not_found", "no"); },
      async () => { throw new ConnectorError("failed", "no"); },
    ]) {
      const { github } = fakeGithub({ tarball, blobs });
      const got = await fetchContents(github, repo, "s".repeat(40), [cand("src/a.ts"), small], { tarball: true });
      expect(got.via).toBe("tree_only");
      expect([...got.texts.keys()]).toEqual(["package.json"]);
    }
  });

  it("does not hide a GitHub that turned the app away as 'tree only'", async () => {
    const { github } = fakeGithub({ tarball: async () => { throw new ConnectorError("github_auth", "no"); } });
    await expect(fetchContents(github, repo, "s".repeat(40), [cand("src/a.ts")], { tarball: true })).rejects.toMatchObject({ code: "github_auth" });
  });

  it("reads nothing when nothing is wanted", async () => {
    const { github } = fakeGithub({});
    expect((await fetchContents(github, repo, "s".repeat(40), [], { tarball: true })).texts.size).toBe(0);
  });
});

describe("blob by blob", () => {
  it("fetches each file by its sha, finds binaries, and skips a file that is gone", async () => {
    const { github, blobCalls } = fakeGithub({ blobs: { ["1".repeat(40)]: Buffer.from("one\r\n"), ["2".repeat(40)]: Buffer.from("a\0b"), ["4".repeat(40)]: Buffer.from("KEY=v") } });
    const got = await fetchBlobs(github, repo, [cand("a.ts", "1".repeat(40)), cand("b.js", "2".repeat(40)), cand("gone.ts", "3".repeat(40)), cand(".env.example", "4".repeat(40), true)]);
    expect(got.via).toBe("blobs");
    expect(got.texts.get("a.ts")).toBe("one\n");
    expect(got.texts.get(".env.example")).toBe("KEY=");
    expect([...got.binary]).toEqual([["b.js", "2".repeat(40)]]);
    expect(blobCalls.sort()).toEqual(["1", "2", "3", "4"].map((c) => c.repeat(40)));
  });

  it("fetches at most six at a time", async () => {
    let inflight = 0, most = 0;
    const github = {
      blobBytes: async () => { inflight += 1; most = Math.max(most, inflight); await new Promise((r) => setTimeout(r, 3)); inflight -= 1; return Buffer.from("x"); },
    } as unknown as GithubApp;
    await fetchBlobs(github, repo, Array.from({ length: 30 }, (_, i) => cand(`f${i}.ts`)));
    expect(most).toBeLessThanOrEqual(6);
    expect(most).toBeGreaterThan(1);
  });

  it("lets a failure of GitHub itself through", async () => {
    const { github } = fakeGithub({ blobs: { ["1".repeat(40)]: new ConnectorError("busy", "slow down") } });
    await expect(fetchBlobs(github, repo, [cand("a.ts", "1".repeat(40))])).rejects.toMatchObject({ code: "busy" });
  });
});

describe("TarError", () => {
  it("says what kind of thing was wrong and nothing else", () => {
    const e = new TarError("bad_tar");
    expect(e.message).toBe("tar: bad_tar");
    expect(e).toBeInstanceOf(Error);
  });
});

export type { TarSpec };
