/**
 * FIXTURES FOR THE PROJECT BRAIN'S TESTS: A TAR WRITER, A SMALL MULTI-LANGUAGE REPO WITH REAL GIT HASHES,
 * AND A FAKE GITHUB THAT SERVES IT (TREE, BLOBS, COMMITS, AND THE CODE AS A REAL GZIPPED TARBALL).
 *
 * The repo is a `FixtureRepo`: files in a map, commits that change some of them,
 * and git's own hashing for blobs, trees and commits, so a folder's sha is the
 * same exactly when nothing under it changed (which is what the Merkle diff
 * relies on). `BrainGithub` wraps the existing FakeGithub (tests/github-fake.ts):
 * the App's JWT, installation tokens, repos and permissions are the fake's, and
 * the git data of the repos registered here is served from the fixture, with the
 * same strictness about tokens (a call without a token that is valid for the
 * repo is a 401/404) and about codeload, which must NEVER be sent a token.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { FakeGithub, FakeRepo } from "./github-fake.js";

// ------------------------------------------------------------------ tar writer

export interface TarSpec {
  path: string;
  data?: string | Buffer;
  /** "0" file, "5" directory, "2" symlink, "x" pax, "g" global pax, "L" GNU long name. */
  type?: string;
  /** Write the path as a pax `path` record in front of the entry. */
  pax?: boolean;
  /** Write the path as a GNU long name entry in front of the entry. */
  longName?: boolean;
  /** Split the path across ustar `prefix` and `name`. */
  prefix?: boolean;
  /** Corrupt the header's checksum. */
  badChecksum?: boolean;
}

const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";

function header(name: string, size: number, type: string, o: { prefix?: string; bad?: boolean; magic?: string } = {}): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write(octal(0o644, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  // size: 11 octal digits and a NUL, or base-256 for a size that does not fit
  if (size < 8 ** 11) h.write(octal(size, 12), 124);
  else { h[124] = 0x80; let n = size; for (let i = 135; i > 124; i -= 1) { h[i] = n % 256; n = Math.floor(n / 256); } }
  h.write(octal(0, 12), 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write(o.magic ?? "ustar\0", 257, "latin1");
  h.write("00", 263, "latin1");
  if (o.prefix) h.write(o.prefix.slice(0, 155), 345, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(o.bad ? sum + 1 : sum, 7).slice(0, 6) + "\0 ", 148, "latin1");
  return h;
}

const pad = (b: Buffer) => (b.length % 512 === 0 ? b : Buffer.concat([b, Buffer.alloc(512 - (b.length % 512))]));

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`);
}

export function tarOf(specs: readonly TarSpec[]): Buffer {
  const parts: Buffer[] = [];
  for (const s of specs) {
    const data = s.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(s.data) ? s.data : Buffer.from(s.data);
    const type = s.type ?? "0";
    if (type === "g" || type === "x" || type === "L") {
      parts.push(header(s.path, data.length, type), pad(data));
      continue;
    }
    let name = s.path;
    let prefix: string | undefined;
    if (s.pax) {
      const rec = paxRecord("path", s.path);
      parts.push(header("PaxHeader/entry", rec.length, "x"), pad(rec));
      name = s.path.slice(0, 99);
    } else if (s.longName) {
      const ln = Buffer.from(`${s.path}\0`);
      parts.push(header("././@LongLink", ln.length, "L", { magic: "ustar " }), pad(ln));
      name = s.path.slice(0, 99);
    } else if (s.prefix) {
      const cut = s.path.lastIndexOf("/", 100 + (s.path.length > 100 ? 0 : 0));
      const at = s.path.length > 100 ? s.path.indexOf("/", s.path.length - 99) : cut;
      prefix = s.path.slice(0, at);
      name = s.path.slice(at + 1);
    }
    parts.push(header(name, type === "0" ? data.length : 0, type, { prefix, bad: s.badChecksum }), type === "0" ? pad(data) : Buffer.alloc(0));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export const tgz = (specs: readonly TarSpec[]): Buffer => gzipSync(tarOf(specs));

/** A `Response` carrying bytes in a web stream, in chunks of `chunk` bytes. */
export function responseOf(bytes: Buffer, chunk = 4096, init: ResponseInit = {}): Response {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (at >= bytes.length) { ctrl.close(); return; }
      ctrl.enqueue(new Uint8Array(bytes.subarray(at, at + chunk)));
      at += chunk;
    },
  });
  return new Response(body, { status: 200, ...init });
}

// ----------------------------------------------------------------- git hashing

const sha1 = (...parts: Array<string | Buffer>) => { const h = createHash("sha1"); for (const p of parts) h.update(p); return h.digest("hex"); };
export const blobSha = (content: string | Buffer): string => { const b = Buffer.isBuffer(content) ? content : Buffer.from(content); return sha1(`blob ${b.length}\0`, b); };

interface Node { name: string; isDir: boolean; sha: string; size: number }

/** Git's tree object: entries sorted by name (a folder as if its name ended in "/"), each "mode name\0<20 bytes>". */
function treeObjectSha(nodes: Node[]): string {
  const sorted = [...nodes].sort((a, b) => {
    const x = Buffer.from(a.isDir ? `${a.name}/` : a.name), y = Buffer.from(b.isDir ? `${b.name}/` : b.name);
    return Buffer.compare(x, y);
  });
  const body = Buffer.concat(sorted.flatMap((n) => [Buffer.from(`${n.isDir ? "40000" : "100644"} ${n.name}\0`), Buffer.from(n.sha, "hex")]));
  return sha1(`tree ${body.length}\0`, body);
}

export interface TreeEntryOut { path: string; mode: string; type: "blob" | "tree"; sha: string; size?: number }

export interface FixtureCommit { sha: string; parent: string | null; message: string; at: number; files: string[]; tree: string }

export class FixtureRepo {
  files = new Map<string, string | Buffer>();
  commits: FixtureCommit[] = [];
  private seq = 0;
  /** The first commit is made at this time, and each next one an hour later. */
  constructor(files: Record<string, string | Buffer> = {}, private readonly start = Date.UTC(2026, 8, 1)) {
    if (Object.keys(files).length) this.commit(files, "Initial commit");
  }

  get head(): FixtureCommit { return this.commits[this.commits.length - 1]!; }

  /** Applies changes (a path to its new text, or null to delete it) as one commit. */
  commit(changes: Record<string, string | Buffer | null>, message: string): string {
    const touched: string[] = [];
    for (const [p, v] of Object.entries(changes)) {
      if (v === null) { if (this.files.delete(p)) touched.push(p); } else { this.files.set(p, v); touched.push(p); }
    }
    this.seq += 1;
    const { tree } = this.build();
    const sha = sha1(`commit ${tree} ${this.head?.sha ?? ""} ${message} ${this.seq}`);
    this.commits.push({ sha, parent: this.head?.sha ?? null, message, at: this.start + this.commits.length * 3_600_000, files: touched, tree });
    return sha;
  }

  /** Every file and folder with git's sha, and the root tree's. */
  build(): { tree: string; entries: TreeEntryOut[] } {
    interface Dir { files: Map<string, string | Buffer>; dirs: Map<string, Dir> }
    const root: Dir = { files: new Map(), dirs: new Map() };
    for (const [path, content] of this.files) {
      const parts = path.split("/");
      let d = root;
      for (const seg of parts.slice(0, -1)) { if (!d.dirs.has(seg)) d.dirs.set(seg, { files: new Map(), dirs: new Map() }); d = d.dirs.get(seg)!; }
      d.files.set(parts[parts.length - 1]!, content);
    }
    const entries: TreeEntryOut[] = [];
    const walk = (d: Dir, prefix: string): string => {
      const nodes: Node[] = [];
      for (const [name, content] of d.files) {
        const size = Buffer.byteLength(content);
        const sha = blobSha(content);
        nodes.push({ name, isDir: false, sha, size });
        entries.push({ path: prefix + name, mode: "100644", type: "blob", sha, size });
      }
      for (const [name, sub] of d.dirs) {
        const sha = walk(sub, `${prefix}${name}/`);
        nodes.push({ name, isDir: true, sha, size: 0 });
        entries.push({ path: prefix + name, mode: "040000", type: "tree", sha });
      }
      return treeObjectSha(nodes);
    };
    const tree = walk(root, "");
    return { tree, entries };
  }

  /** The sha of a path (file or folder) now. */
  shaOf(path: string): string | undefined { return this.build().entries.find((e) => e.path === path)?.sha; }

  /** The repo as a tarball: one top folder, `owner-name-<sha7>/`, as GitHub makes it. */
  tarball(owner: string, name: string, extra: TarSpec[] = []): Buffer {
    const top = `${owner}-${name}-${this.head.sha.slice(0, 7)}`;
    const specs: TarSpec[] = [{ path: "pax_global_header", type: "g", data: Buffer.from(`52 comment=${this.head.sha}\n`) }, { path: `${top}/`, type: "5" }];
    for (const [p, c] of [...this.files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) specs.push({ path: `${top}/${p}`, data: c, ...(`${top}/${p}`.length > 100 ? { pax: true } : {}) });
    return gzipSync(tarOf([...specs, ...extra]));
  }
}

// ---------------------------------------------------------------- a fake GitHub

export interface Served {
  repo: FixtureRepo;
  /** The repo as the base fake knows it (installation and ids). */
  fake: FakeRepo;
}

/**
 * The FakeGithub, plus the git data of fixture repos. `fetchFn` is what the code
 * under test is given. Counts what was asked, so a test can say "this build made
 * one tarball request and no blob requests".
 */
export class BrainGithub {
  served = new Map<string, Served>();
  calls: Array<{ method: string; path: string; search: string; host: string; auth: boolean }> = [];
  /** The tarball answers this status instead (a repo GitHub won't hand over). */
  tarballStatus: number | null = null;
  /** The tarball is declared this big (content-length), without sending it. */
  tarballDeclaredBytes: number | null = null;
  /** Rate limit remaining reported by /commits/{sha}: starts here and goes down by `rateStep` a call. */
  rateRemaining = 5000;
  rateStep = 1;
  /** Branches the repo lists. */
  branches: string[] = ["main"];
  /** The tarball waits for this before it answers (a build held mid-way, to see what happens around it). */
  gate: Promise<void> | null = null;
  /** Requests whose path matches answer this instead (a GitHub having a bad minute). */
  fail: Array<{ re: RegExp; status: number; message: string }> = [];
  /** Commit detail requests in flight now and at most at once. */
  commitInflight = 0;
  commitMaxInflight = 0;

  constructor(readonly fake: FakeGithub) {}

  serve(fakeRepo: FakeRepo, repo: FixtureRepo): void { this.served.set(fakeRepo.fullName, { repo, fake: fakeRepo }); }
  count(re: RegExp): number { return this.calls.filter((c) => re.test(c.path)).length; }
  reset(): void { this.calls = []; }

  private json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }

  fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    this.calls.push({ method, path: url.pathname, search: url.search, host: url.hostname, auth: !!headers.authorization });

    const bad = this.fail.find((f) => f.re.test(url.pathname));
    if (bad) return this.json(bad.status, { message: bad.message });

    // codeload: the tarball itself. It takes no token, and a request that carries one is the bug.
    const cl = /^\/([^/]+)\/([^/]+)\/legacy\.tar\.gz\/([0-9a-f]{40})$/.exec(url.pathname);
    if (url.hostname === "codeload.github.com" && cl) {
      if (headers.authorization) return this.json(400, { message: "a token was sent to codeload" });
      const s = this.served.get(`${cl[1]}/${cl[2]}`);
      if (!s) return this.json(404, { message: "Not Found" });
      if (this.gate) await this.gate;
      if (this.tarballStatus !== null) return this.json(this.tarballStatus, { message: "no" });
      const bytes = s.repo.tarball(cl[1]!, cl[2]!);
      return responseOf(bytes, 2048, { headers: this.tarballDeclaredBytes !== null ? { "content-length": String(this.tarballDeclaredBytes) } : {} });
    }

    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    const s = m ? this.served.get(`${m[1]}/${m[2]}`) : undefined;
    if (url.hostname !== "api.github.com" || !m || !s) return this.fake.fetchFn(input, init);
    const rest = m[3] ?? "";
    // The fake's token rules: a token minted for this repo only.
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? "")?.[1];
    const token = bearer ? this.fake.tokens.get(bearer) : undefined;
    if (!token || token.expiresAt <= this.fake.clock.t) return this.json(401, { message: "Bad credentials" });
    if (!token.repositoryIds?.includes(s.fake.id)) return this.json(404, { message: "Not Found" });
    const repo = s.repo;
    let r: RegExpExecArray | null;
    // A repo with no commits: git data and the history say so (409), as GitHub does.
    if (!repo.commits.length && (/^\/git\//.test(rest) || rest === "/commits")) return this.json(409, { message: "Git Repository is empty." });

    if ((r = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      return decodeURIComponent(r[1]!) === s.fake.defaultBranch ? this.json(200, { ref: `refs/heads/${r[1]}`, object: { sha: repo.head.sha, type: "commit" } }) : this.json(404, { message: "Not Found" });
    }
    if ((r = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest))) {
      const c = repo.commits.find((x) => x.sha === r![1]);
      return c ? this.json(200, { sha: c.sha, tree: { sha: c.tree } }) : this.json(404, { message: "Not Found" });
    }
    if ((r = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest))) {
      const b = repo.build();
      return r[1] === b.tree ? this.json(200, { sha: b.tree, truncated: false, tree: b.entries }) : this.json(404, { message: "Not Found" });
    }
    if ((r = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest))) {
      for (const content of repo.files.values()) {
        if (blobSha(content) === r[1]) {
          const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
          return this.json(200, { sha: r[1], size: buf.length, encoding: "base64", content: buf.toString("base64") });
        }
      }
      return this.json(404, { message: "Not Found" });
    }
    if ((r = /^\/tarball\/([0-9a-f]{40})$/.exec(rest))) {
      if (this.tarballStatus === 404) return this.json(404, { message: "Not Found" });
      return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/${m[1]}/${m[2]}/legacy.tar.gz/${r[1]}` } });
    }
    if (rest === "/commits" && method === "GET") {
      const per = Number(url.searchParams.get("per_page") ?? 30);
      const list = [...repo.commits].reverse().slice(0, per).map((c) => ({ sha: c.sha, commit: { message: c.message, author: { date: new Date(c.at).toISOString() } } }));
      return this.json(200, list);
    }
    if ((r = /^\/commits\/([0-9a-f]{40})$/.exec(rest))) {
      const c = repo.commits.find((x) => x.sha === r![1]);
      if (!c) return this.json(404, { message: "Not Found" });
      this.commitInflight += 1;
      this.commitMaxInflight = Math.max(this.commitMaxInflight, this.commitInflight);
      try {
        await new Promise((res) => setTimeout(res, 2));
        this.rateRemaining -= this.rateStep;
        return this.json(200, { sha: c.sha, files: c.files.map((f) => ({ filename: f })) }, { "x-ratelimit-remaining": String(this.rateRemaining) });
      } finally { this.commitInflight -= 1; }
    }
    if (rest === "/branches") return this.json(200, this.branches.map((name) => ({ name })));
    // One file's text, for a read through the workspace (the work core's audit and locate read lockfiles and excerpts this way).
    if (method === "GET" && (r = /^\/contents\/(.+)$/.exec(rest))) {
      const path = decodeURIComponent(r[1]!);
      const content = repo.files.get(path);
      if (content === undefined) return this.json(404, { message: "Not Found" });
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      return this.json(200, { type: "file", path, name: path.split("/").pop(), sha: blobSha(content), size: buf.length, encoding: "base64", content: buf.toString("base64") });
    }
    return this.json(404, { message: "Not Found" });
  };
}
