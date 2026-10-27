/**
 * LocalGitHub: THE GITHUB API THE CODE BOT CALLS, BACKED BY REAL GIT REPOSITORIES ON THIS DISK.
 *
 * `local.fetchFn` is handed to createCode() in place of fetch, exactly as tests/github-fake.ts's FakeGithub is, and answers what api.github.com and
 * codeload.github.com answer for a repo: refs, commits, trees, blobs, the contents API, trees written and commits made, branches, compare, merges,
 * pull requests (draft, comments, ready, squash merge), the tarball of a commit, statuses and check runs. The difference from the fake is what is
 * behind it: every repo is a BARE GIT REPOSITORY, so the objects are git's own (a real project's history and trees, not a flat map), what the bot
 * commits can be checked out and run, and a tree written by the bot is a tree git wrote.
 *
 * What it reuses from the fake, by composition, is everything that is not a repo's git data: the GitHub App's JWT (verified against the App's key),
 * installations and their repo-scoped tokens (with the permissions they were asked for), the collaborator permission endpoint and
 * `GET /repos/{o}/{r}`. A request for a repo's git data is judged against the token the fake minted, with the strictness the real GitHub has:
 *
 *   - a token works on the repos it was minted for, and a write needs contents:write (or pull_requests:write for a pull request);
 *   - a ref update that is not a fast-forward is a 422; a protected branch cannot be moved or deleted;
 *   - a push that changes `.github/workflows/*` is refused (403) unless the token has the Workflows permission;
 *   - git/trees takes a TREE sha, git/commits a tree and parents that exist;
 *   - a repo with no commits answers 409 "Git Repository is empty", and the contents API's first PUT makes its first commit.
 *
 * A repo is made from an existing object store (a clone in the cache: the bare repo BORROWS its objects, git alternates, so seeding costs nothing),
 * from a folder of that history (the repo's root is a subfolder of the project, as the bot sees an app inside a monorepo), from a map of files, or
 * empty. The clock is the live one: everything is real time here, models take real seconds.
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { FakeGithub, appKeys, type AppKeys, type FakeRepo } from "../../tests/github-fake.js";
import { WORK_DIR, git, gitBuf, mkdirp, rmrf, run, uid, type ExecResult } from "../util.js";

const ZERO = "0".repeat(40);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface CallRecord { method: string; path: string; search: string; status: number; ms: number; body?: unknown; token?: string }

export interface RepoSeed {
  fullName: string;
  installationId?: number;
  defaultBranch?: string;
  private?: boolean;
  /** Borrow an existing object store and start the default branch at one of its commits. */
  from?: { objects: string; shallow?: string; commit: string; /** the repo's root is this folder of the commit (a project inside a monorepo) */ subdir?: string; message?: string };
  /** A map of files: a synthetic project. */
  files?: Record<string, string>;
  /** No commits at all. */
  empty?: boolean;
  /** Commit message and author for a seed made from files or a subfolder. */
  message?: string;
}

export interface PullRecord {
  number: number; head: string; base: string; title: string; body: string; draft: boolean; state: "open" | "closed"; merged: boolean; headSha: string;
  reviewDecision: string | null;
  reviewComments: Array<{ user: string; body: string; path: string; line: number; at: string }>;
  issueComments: Array<{ user: string; body: string; at: string }>;
  createdAt: number; closedAt?: number;
}

export interface StatusRecord { sha: string; context: string; state: "pending" | "success" | "failure" | "error"; description: string; at: number }

/** One repo: a bare git directory and the little GitHub keeps beside it. */
export class LocalRepo {
  readonly pulls: PullRecord[] = [];
  readonly statuses: StatusRecord[] = [];
  readonly protection = new Map<string, { checks: boolean }>();
  /** Branch moves the API made, in order: for audits ("never touched main"). */
  readonly refWrites: Array<{ ref: string; from: string | null; to: string | null; at: number }> = [];

  constructor(readonly fake: FakeRepo, readonly dir: string, readonly gh: LocalGitHub) {}

  get fullName(): string { return this.fake.fullName; }
  get defaultBranch(): string { return this.fake.defaultBranch; }
  get id(): number { return this.fake.id; }
  get objectsDir(): string { return path.join(this.dir, "objects"); }
  get shallowFile(): string { return path.join(this.dir, "shallow"); }

  // ---- git plumbing
  g(args: readonly string[], o: { input?: string | Buffer; env?: Record<string, string>; allowFail?: boolean } = {}): Promise<string> {
    return git(this.dir, args, { ...o, env: { GIT_DIR: this.dir, ...(o.env ?? {}) } });
  }
  gb(args: readonly string[], input?: string | Buffer): Promise<Buffer> { return gitBuf(this.dir, args, input === undefined ? {} : { input }); }

  async revParse(ref: string): Promise<string | null> {
    const out = await this.g(["rev-parse", "--verify", "-q", `${ref}^{commit}`], { allowFail: true });
    const s = out.trim();
    return /^[0-9a-f]{40}$/.test(s) ? s : null;
  }
  /** A branch's head, or null. */
  head(branch: string): Promise<string | null> { return this.revParse(`refs/heads/${branch}`); }
  async hasCommits(): Promise<boolean> {
    const out = await this.g(["for-each-ref", "--count=1", "refs/heads"], { allowFail: true });
    return out.trim().length > 0;
  }
  async branches(): Promise<string[]> {
    const out = await this.g(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { allowFail: true });
    return out.split("\n").map((s) => s.trim()).filter(Boolean).sort();
  }
  /** A commit by branch name, tag, or sha. */
  async resolve(ref: string): Promise<string | null> {
    if (/^[0-9a-f]{40}$/i.test(ref)) return this.revParse(ref.toLowerCase());
    return (await this.head(ref)) ?? (await this.revParse(`refs/tags/${ref}`)) ?? (await this.revParse(ref));
  }
  async treeOf(commit: string): Promise<string> { return (await this.g(["rev-parse", `${commit}^{tree}`])).trim(); }
  async parentsOf(commit: string): Promise<string[]> {
    const out = (await this.g(["rev-list", "--parents", "-n", "1", commit])).trim().split(" ");
    return out.slice(1);
  }
  /** A git command's exit code and output, for the ones that answer with the code (merge-base --is-ancestor, merge-tree). */
  exec(args: readonly string[]): Promise<ExecResult> { return run("git", args, { cwd: this.dir, env: { ...process.env, GIT_DIR: this.dir } }); }
  async isAncestor(a: string, b: string): Promise<boolean> { return (await this.exec(["merge-base", "--is-ancestor", a, b])).code === 0; }
  async mergeBase(a: string, b: string): Promise<string | null> {
    const out = await this.g(["merge-base", a, b], { allowFail: true });
    return out.trim() || null;
  }

  /** Every file at a ref as { path: text }, for tests and the scorer (text files only). */
  async files(ref: string): Promise<Record<string, string>> {
    const c = await this.resolve(ref);
    if (!c) return {};
    const list = (await this.g(["ls-tree", "-r", "-z", "--full-tree", c])).split("\0").filter(Boolean);
    const out: Record<string, string> = {};
    for (const row of list) {
      const m = /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/s.exec(row);
      if (!m || m[2] !== "blob") continue;
      const buf = await this.gb(["cat-file", "blob", m[3]!]);
      if (buf.includes(0)) continue;
      out[m[4]!] = buf.toString("utf8");
    }
    return out;
  }
  async fileAt(ref: string, p: string): Promise<string | null> {
    const c = await this.resolve(ref);
    if (!c) return null;
    const buf = await this.gb(["cat-file", "blob", `${c}:${p}`]).catch(() => null);
    return buf ? buf.toString("utf8") : null;
  }
  /** The files a branch changes against another, with status: A, M, D. */
  async changedFiles(base: string, head: string): Promise<Array<{ status: string; path: string }>> {
    const out = await this.g(["diff", "--name-status", "--no-renames", "-z", `${base}...${head}`], { allowFail: true });
    const parts = out.split("\0");
    const res: Array<{ status: string; path: string }> = [];
    for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) res.push({ status: parts[i]!.charAt(0), path: parts[i + 1]! });
    return res;
  }
  async log(ref: string, n = 100): Promise<Array<{ sha: string; message: string; author: string; email: string; at: number }>> {
    const out = await this.g(["log", `-n${n}`, "--format=%H%x1f%an%x1f%ae%x1f%at%x1f%B%x1e", ref], { allowFail: true });
    return out.split("\x1e").map((s) => s.replace(/^\n+/, "")).filter(Boolean).map((rec) => {
      const [sha, author, email, at, message] = rec.split("\x1f");
      return { sha: sha!, author: author ?? "", email: email ?? "", at: Number(at) * 1000, message: (message ?? "").trimEnd() };
    });
  }

  // ---- writing
  /** A tree made from a base tree and changes: text to write, or null to delete. */
  async writeTree(baseTree: string | null, changes: ReadonlyArray<{ path: string; content: string | null }>): Promise<string> {
    const idx = path.join(this.dir, `index-${uid()}`);
    const env = { GIT_INDEX_FILE: idx };
    try {
      await this.g(["read-tree", baseTree ?? EMPTY_TREE], { env });
      let lines = "";
      for (const c of changes) {
        if (c.content === null) {
          const have = await this.g(["ls-files", "--stage", "--", c.path], { env });
          if (!have.trim()) throw new Error(`GitRPC::BadObjectState: ${c.path} does not exist`);
          lines += `0 ${ZERO}\t${c.path}\n`;
        } else {
          const blob = (await this.g(["hash-object", "-w", "--stdin"], { input: c.content })).trim();
          lines += `100644 ${blob}\t${c.path}\n`;
        }
      }
      if (lines) await this.g(["update-index", "--index-info"], { env, input: lines });
      return (await this.g(["write-tree"], { env })).trim();
    } finally { fs.rmSync(idx, { force: true }); }
  }
  async commitTree(o: { tree: string; parents: string[]; message: string; author?: { name: string; email: string }; at?: number }): Promise<string> {
    const a = o.author ?? { name: "GitHub", email: "noreply@github.com" };
    const when = `${Math.floor((o.at ?? Date.now()) / 1000)} +0000`;
    const env = {
      GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_NAME: "GitHub", GIT_COMMITTER_EMAIL: "noreply@github.com", GIT_COMMITTER_DATE: when,
    };
    const args = ["commit-tree", o.tree, ...o.parents.flatMap((p) => ["-p", p]), "-F", "-"];
    return (await this.g(args, { env, input: o.message })).trim();
  }
  async setRef(branch: string, sha: string, from: string | null): Promise<void> {
    await this.g(["update-ref", `refs/heads/${branch}`, sha]);
    this.refWrites.push({ ref: `refs/heads/${branch}`, from, to: sha, at: Date.now() });
  }
  async deleteRef(branch: string): Promise<boolean> {
    const cur = await this.head(branch);
    if (!cur) return false;
    await this.g(["update-ref", "-d", `refs/heads/${branch}`]);
    this.refWrites.push({ ref: `refs/heads/${branch}`, from: cur, to: null, at: Date.now() });
    return true;
  }
  /** Someone else pushes a commit to a branch (for a test of a branch that moves under the bot). Returns the sha. */
  async push(branch: string, files: Record<string, string | null>, message = "someone else"): Promise<string> {
    const parent = await this.head(branch);
    const tree = await this.writeTree(parent ? await this.treeOf(parent) : null, Object.entries(files).map(([p, c]) => ({ path: p, content: c })));
    const sha = await this.commitTree({ tree, parents: parent ? [parent] : [], message, author: { name: "someone", email: "someone@example.com" } });
    await this.setRef(branch, sha, parent);
    return sha;
  }
  protect(branch: string, o: { checks?: boolean } = {}): void { this.protection.set(branch, { checks: o.checks === true }); }
  setStatus(sha: string, context: string, state: StatusRecord["state"], description = ""): void {
    this.statuses.push({ sha, context, state, description, at: Date.now() });
  }
  /** A pull request by head branch (the newest). */
  pullFor(head: string): PullRecord | undefined { return [...this.pulls].reverse().find((p) => p.head === head); }
}

export interface Call { method: string; url: URL; headers: Record<string, string>; body: any }

export class LocalGitHub {
  readonly keys: AppKeys;
  readonly fake: FakeGithub;
  readonly repos = new Map<string, LocalRepo>();
  readonly calls: CallRecord[] = [];
  /** Requests answered, by kind: for the load test's accounting. */
  inflight = 0;
  maxInflight = 0;
  /** Added latency per request in ms (a slow GitHub), 0 by default. */
  latencyMs = 0;
  /** Every request whose path starts with this answers the status (a GitHub that is down). */
  failWith: { prefix: string; status: number; times?: number } | null = null;
  private readonly root: string;
  private seq = 0;

  constructor(o: { keys?: AppKeys; root?: string } = {}) {
    this.keys = o.keys ?? appKeys();
    this.fake = new FakeGithub(this.keys);
    // The live clock: models take real seconds, and leases, timeouts and tokens are measured against it.
    Object.defineProperty(this.fake.clock, "t", { get: () => Date.now(), set: () => undefined, configurable: true });
    this.root = o.root ?? path.join(WORK_DIR, `gh-${uid(4)}`);
    mkdirp(this.root);
  }

  get appClientId(): string { return this.fake.appClientId; }
  get clientSecret(): string { return this.fake.clientSecret; }
  addInstall(id: number, login: string, o: { type?: string; selection?: "all" | "selected"; permissions?: Record<string, string> } = {}): void { this.fake.addInstall(id, login, o); }

  repo(fullName: string): LocalRepo {
    const r = this.repos.get(fullName);
    if (!r) throw new Error(`LocalGitHub has no repo ${fullName}`);
    return r;
  }

  /** Makes a repo (registered with the fake so installs, tokens and permissions know it) and seeds it. */
  async addRepo(seed: RepoSeed): Promise<LocalRepo> {
    const installationId = seed.installationId ?? 101;
    const fr = this.fake.addRepo(installationId, seed.fullName, { empty: true, ...(seed.private !== undefined ? { private: seed.private } : {}), ...(seed.defaultBranch ? { defaultBranch: seed.defaultBranch } : {}) });
    const dir = path.join(this.root, `${seed.fullName.replace("/", "__")}.git`);
    rmrf(dir);
    mkdirp(dir);
    await git(dir, ["init", "-q", "--bare", "--initial-branch", fr.defaultBranch]);
    await git(dir, ["config", "gc.auto", "0"]);
    await git(dir, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
    const repo = new LocalRepo(fr, dir, this);
    this.repos.set(seed.fullName, repo);
    if (seed.empty) return repo;
    const msg = seed.message ?? "Initial commit";
    if (seed.from) {
      fs.writeFileSync(path.join(dir, "objects", "info", "alternates"), `${seed.from.objects}\n`);
      if (seed.from.shallow && fs.existsSync(seed.from.shallow)) fs.copyFileSync(seed.from.shallow, path.join(dir, "shallow"));
      if (seed.from.subdir) {
        const tree = (await repo.g(["rev-parse", `${seed.from.commit}:${seed.from.subdir}`])).trim();
        const sha = await repo.commitTree({ tree, parents: [], message: seed.from.message ?? msg, author: { name: "e2e", email: "e2e@tailzu.local" } });
        await repo.setRef(fr.defaultBranch, sha, null);
      } else {
        await repo.setRef(fr.defaultBranch, seed.from.commit, null);
      }
    } else if (seed.files) {
      const tree = await repo.writeTree(null, Object.entries(seed.files).map(([p, c]) => ({ path: p, content: c })));
      const sha = await repo.commitTree({ tree, parents: [], message: msg, author: { name: "e2e", email: "e2e@tailzu.local" } });
      await repo.setRef(fr.defaultBranch, sha, null);
    }
    return repo;
  }

  /** Throws away every repo's directory. */
  dispose(): void { rmrf(this.root); }

  // ------------------------------------------------------------------ the wire

  fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    let body: any;
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
    const method = init?.method ?? "GET";
    const call: Call = { method, url, headers, body };
    const t0 = Date.now();
    this.inflight += 1;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    let res: Response;
    try {
      if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
      if (this.failWith && url.pathname.startsWith(this.failWith.prefix) && (this.failWith.times === undefined || this.failWith.times > 0)) {
        if (this.failWith.times !== undefined) this.failWith.times -= 1;
        res = this.reply(this.failWith.status, { message: "boom" });
      } else {
        res = await this.route(call, input, init);
      }
    } catch (e) {
      if (e instanceof Response) res = e;
      else throw e;
    } finally { this.inflight -= 1; }
    this.calls.push({ method, path: url.pathname, search: url.search, status: res.status, ms: Date.now() - t0, ...(body !== undefined && method !== "GET" ? { body: summarize(body) } : {}) });
    return res;
  };

  private reply(status: number, json: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json", ...headers } });
  }
  private fail(status: number, message: string, errors?: unknown): never {
    throw this.reply(status, { message, ...(errors ? { errors } : {}) });
  }

  private async route(c: Call, input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Promise<Response> {
    if (c.url.hostname === "codeload.github.com") return this.codeload(c);
    if (c.method === "POST" && c.url.pathname === "/graphql") return this.graphql(c);
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)$/.exec(c.url.pathname);
    if (m && !/^\/collaborators\//.test(m[3]!)) return this.repoApi(c, m[1]!, m[2]!, decodeURIComponent(m[3]!).replace(/%2F/gi, "/"));
    return this.fake.fetchFn(input, init);
  }

  /** The token on a call, judged for this repo; returns the repo and what the token may do. */
  private auth(c: Call, owner: string, name: string): { repo: LocalRepo; perms: Record<string, string> } {
    const bearer = /^Bearer (.+)$/.exec(c.headers.authorization ?? "")?.[1];
    if (!bearer) this.fail(401, "Requires authentication");
    const token = this.fake.tokens.get(bearer!);
    if (!token || token.expiresAt <= Date.now()) this.fail(401, "Bad credentials");
    const repo = this.repos.get(`${owner}/${name}`);
    if (!repo || repo.fake.installationId !== token!.installationId) this.fail(404, "Not Found");
    if (token!.repositoryIds === null || !token!.repositoryIds.includes(repo!.id)) this.fail(404, "Not Found");
    return { repo: repo!, perms: token!.permissions };
  }
  private mustWrite(perms: Record<string, string>, what: "contents" | "pull_requests"): void {
    if (perms[what] !== "write") this.fail(403, "Resource not accessible by integration");
  }

  private async refToCommit(repo: LocalRepo, ref: string): Promise<string | null> { return repo.resolve(ref); }

  private async repoApi(c: Call, owner: string, name: string, rest: string): Promise<Response> {
    const { repo, perms } = this.auth(c, owner, name);
    const q = c.url.searchParams;
    let r: RegExpMatchArray | null;
    const empty = !(await repo.hasCommits());

    // A repo with no commits: the git data answers 409, and the contents API's first PUT makes the first commit.
    if (empty && (/^\/(git\/|commits|compare\/|branches|tarball)/.test(rest))) {
      if (rest === "/commits" || rest === "/branches") return this.reply(rest === "/branches" ? 200 : 409, rest === "/branches" ? [] : { message: "Git Repository is empty." });
      return this.reply(409, { message: "Git Repository is empty." });
    }

    // --- refs
    if (c.method === "GET" && (r = rest.match(/^\/git\/ref\/((?:heads|tags)\/.+)$/))) {
      const sha = await repo.revParse(`refs/${r[1]}`);
      return sha ? this.reply(200, { ref: `refs/${r[1]}`, object: { sha, type: "commit" } }) : this.reply(404, { message: "Not Found" });
    }
    if (c.method === "POST" && rest === "/git/refs") {
      this.mustWrite(perms, "contents");
      const refName = String(c.body?.ref ?? "");
      const sha = String(c.body?.sha ?? "");
      if (!/^refs\/heads\/.+/.test(refName) || !(await repo.g(["cat-file", "-e", sha], { allowFail: true }).then(() => true, () => false))) return this.reply(422, { message: "Object does not exist" });
      const branch = refName.slice("refs/heads/".length);
      if (await repo.head(branch)) return this.reply(422, { message: "Reference already exists" });
      const touched = await this.workflowFilesIntroduced(repo, sha);
      if (touched.length && perms.workflows !== "write") return this.reply(403, { message: `refusing to allow a GitHub App to create or update workflow \`${touched[0]}\` without \`workflows\` permission` });
      await repo.setRef(branch, sha, null);
      return this.reply(201, { ref: refName, object: { sha } });
    }
    if (c.method === "PATCH" && (r = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
      this.mustWrite(perms, "contents");
      const branch = r[1]!;
      const cur = await repo.head(branch);
      if (!cur) return this.reply(404, { message: "Reference does not exist" });
      const target = String(c.body?.sha ?? "");
      if (!/^[0-9a-f]{40}$/.test(target) || !(await repo.revParse(target))) return this.reply(422, { message: "Object does not exist" });
      if (repo.protection.has(branch)) return this.reply(422, { message: "Cannot update this protected ref." });
      const touched = (await repo.changedFiles(cur, target).catch(() => [])).filter((f) => /^\.github\/workflows\//i.test(f.path));
      if (touched.length && perms.workflows !== "write") return this.reply(403, { message: `refusing to allow a GitHub App to create or update workflow \`${touched[0]!.path}\` without \`workflows\` permission` });
      if (c.body?.force !== true && !(await repo.isAncestor(cur, target))) return this.reply(422, { message: "Update is not a fast forward" });
      await repo.setRef(branch, target, cur);
      return this.reply(200, { ref: `refs/heads/${branch}`, object: { sha: target } });
    }
    if (c.method === "DELETE" && (r = rest.match(/^\/git\/refs\/heads\/(.+)$/))) {
      this.mustWrite(perms, "contents");
      if (repo.protection.has(r[1]!)) return this.reply(422, { message: "Cannot delete this protected ref." });
      return (await repo.deleteRef(r[1]!)) ? new Response(null, { status: 204 }) : this.reply(422, { message: "Reference does not exist" });
    }

    // --- commits, trees, blobs
    if (c.method === "GET" && (r = rest.match(/^\/git\/commits\/([0-9a-f]{4,40})$/))) {
      const sha = await repo.revParse(r[1]!);
      if (!sha) return this.reply(404, { message: "Not Found" });
      return this.reply(200, await this.commitJson(repo, sha));
    }
    if (c.method === "GET" && (r = rest.match(/^\/git\/trees\/([0-9a-f]{40})$/))) {
      const type = (await repo.g(["cat-file", "-t", r[1]!], { allowFail: true })).trim();
      if (type !== "tree") return this.reply(404, { message: "Not Found" });
      const recursive = q.get("recursive") !== null && q.get("recursive") !== "0";
      const out = await repo.g(["ls-tree", ...(recursive ? ["-r", "-t"] : []), "-l", "-z", r[1]!]);
      const tree = out.split("\0").filter(Boolean).flatMap((row) => {
        const m = /^(\d+) (\w+) ([0-9a-f]{40})\s+(-|\d+)\t(.+)$/s.exec(row);
        if (!m) return [];
        return [{ path: m[5]!, mode: m[1]!, type: m[2]!, sha: m[3]!, ...(m[2] === "blob" ? { size: Number(m[4]) } : {}) }];
      });
      return this.reply(200, { sha: r[1], tree, truncated: false });
    }
    if (c.method === "GET" && (r = rest.match(/^\/git\/blobs\/([0-9a-f]{40})$/))) {
      const buf = await repo.gb(["cat-file", "blob", r[1]!]).catch(() => null);
      if (!buf) return this.reply(404, { message: "Not Found" });
      return this.reply(200, { sha: r[1], size: buf.length, encoding: "base64", content: buf.toString("base64") });
    }
    if (c.method === "POST" && rest === "/git/trees") {
      this.mustWrite(perms, "contents");
      const base = String(c.body?.base_tree ?? "");
      if (base && (await repo.g(["cat-file", "-t", base], { allowFail: true })).trim() !== "tree") return this.reply(422, { message: "base tree does not exist" });
      const entries = (c.body?.tree ?? []) as Array<Record<string, any>>;
      for (const e of entries) if (e.mode !== "100644" || e.type !== "blob") return this.reply(422, { message: "bad entry" });
      try {
        const sha = await repo.writeTree(base || null, entries.map((e) => ({ path: String(e.path), content: e.sha === null ? null : String(e.content ?? "") })));
        return this.reply(201, { sha });
      } catch (err) {
        return this.reply(422, { message: (err as Error).message.replace(/^git .*?: /, "").slice(0, 200) });
      }
    }
    if (c.method === "POST" && rest === "/git/commits") {
      this.mustWrite(perms, "contents");
      const { tree, parents, message, author } = c.body ?? {};
      const treeOk = typeof tree === "string" && (await repo.g(["cat-file", "-t", tree], { allowFail: true })).trim() === "tree";
      const parentsOk = Array.isArray(parents) && (await Promise.all(parents.map((p: string) => repo.revParse(p)))).every(Boolean);
      if (!treeOk || !parentsOk) return this.reply(422, { message: "bad commit" });
      const sha = await repo.commitTree({ tree, parents, message: String(message ?? ""), ...(author?.name && author?.email ? { author } : {}) });
      return this.reply(201, { sha });
    }

    // --- the contents API
    if (c.method === "GET" && (r = rest.match(/^\/contents\/(.+)$/))) {
      const ref = q.get("ref") ?? repo.defaultBranch;
      const commit = await this.refToCommit(repo, ref);
      if (!commit) return this.reply(404, { message: "No commit found for the ref" });
      const p = r[1]!.replace(/\/+$/, "");
      const type = (await repo.g(["cat-file", "-t", `${commit}:${p}`], { allowFail: true })).trim();
      if (type === "blob") {
        const buf = await repo.gb(["cat-file", "blob", `${commit}:${p}`]);
        const sha = (await repo.g(["rev-parse", `${commit}:${p}`])).trim();
        return this.reply(200, { type: "file", name: p.split("/").pop(), path: p, size: buf.length, encoding: "base64", content: (buf.toString("base64").match(/.{1,60}/g) ?? []).join("\n"), sha });
      }
      if (type === "tree") {
        const out = await repo.g(["ls-tree", "-l", "-z", `${commit}:${p}`]);
        const list = out.split("\0").filter(Boolean).flatMap((row) => {
          const m = /^(\d+) (\w+) ([0-9a-f]{40})\s+(-|\d+)\t(.+)$/s.exec(row);
          return m ? [{ type: m[2] === "tree" ? "dir" : "file", name: m[5]!, path: p ? `${p}/${m[5]}` : m[5]!, sha: m[3]!, size: m[4] === "-" ? 0 : Number(m[4]) }] : [];
        });
        return this.reply(200, list);
      }
      return this.reply(404, { message: "Not Found" });
    }
    if (c.method === "PUT" && (r = rest.match(/^\/contents\/(.+)$/))) {
      this.mustWrite(perms, "contents");
      const p = r[1]!;
      const branch = String(c.body?.branch ?? repo.defaultBranch);
      if (typeof c.body?.message !== "string" || typeof c.body?.content !== "string") return this.reply(422, { message: "Invalid request." });
      const text = Buffer.from(c.body.content, "base64").toString("utf8");
      const parent = await repo.head(branch);
      const baseTree = parent ? await repo.treeOf(parent) : null;
      if (parent) {
        const cur = (await repo.g(["rev-parse", `${parent}:${p}`], { allowFail: true })).trim();
        if (/^[0-9a-f]{40}$/.test(cur) && c.body.sha !== cur) return this.reply(422, { message: `Invalid request.\n\n"sha" wasn't supplied.` });
      }
      const tree = await repo.writeTree(baseTree, [{ path: p, content: text }]);
      const commit = await repo.commitTree({ tree, parents: parent ? [parent] : [], message: c.body.message, ...(c.body.author?.name ? { author: c.body.author } : {}) });
      await repo.setRef(branch, commit, parent);
      return this.reply(201, { content: { path: p, sha: (await repo.g(["rev-parse", `${commit}:${p}`])).trim() }, commit: { sha: commit } });
    }

    // --- history
    if (c.method === "GET" && rest === "/commits") {
      const sha = q.get("sha") ?? repo.defaultBranch;
      const ref = (await repo.resolve(sha)) ?? repo.defaultBranch;
      const n = Math.min(100, Math.max(1, Number(q.get("per_page") ?? 30)));
      const rows = await repo.log(ref, n);
      return this.reply(200, rows.map((x) => ({ sha: x.sha, commit: { message: x.message, author: { name: x.author, email: x.email, date: new Date(x.at).toISOString() }, committer: { date: new Date(x.at).toISOString() } } })));
    }
    if (c.method === "GET" && (r = rest.match(/^\/commits\/([0-9a-f]{40})$/))) {
      const sha = await repo.revParse(r[1]!);
      if (!sha) return this.reply(404, { message: "Not Found" });
      const parent = (await repo.parentsOf(sha))[0];
      const files = parent ? await repo.g(["diff", "--numstat", "--no-renames", parent, sha]) : await repo.g(["show", "--numstat", "--format=", sha]);
      const list = files.split("\n").filter(Boolean).map((l) => { const [a, d, ...f] = l.split("\t"); return { filename: f.join("\t"), additions: Number(a) || 0, deletions: Number(d) || 0, status: "modified" }; });
      return this.reply(200, { ...(await this.commitJson(repo, sha)), files: list.slice(0, 300) }, { "x-ratelimit-remaining": "4900" });
    }
    if (c.method === "GET" && (r = rest.match(/^\/commits\/([0-9a-f]{40})\/status$/))) {
      const mine = repo.statuses.filter((s) => s.sha === r![1]);
      const latest = new Map<string, StatusRecord>();
      for (const s of mine) latest.set(s.context, s);
      const list = [...latest.values()];
      const state = list.some((s) => s.state === "failure" || s.state === "error") ? "failure" : list.some((s) => s.state === "pending") ? "pending" : list.length ? "success" : "pending";
      return this.reply(200, { state, sha: r[1], total_count: list.length, statuses: list.map((s) => ({ context: s.context, state: s.state, description: s.description, target_url: null, created_at: new Date(s.at).toISOString() })) });
    }
    if (c.method === "GET" && rest.match(/^\/commits\/[0-9a-f]{40}\/check-runs$/)) return this.reply(200, { total_count: 0, check_runs: [] });
    if (c.method === "GET" && rest === "/deployments") return this.reply(200, []);
    if (c.method === "GET" && rest === "/branches") {
      const n = Math.min(100, Math.max(1, Number(q.get("per_page") ?? 30)));
      const names = await repo.branches();
      return this.reply(200, names.slice(0, n).map((b) => ({ name: b, protected: repo.protection.has(b) })));
    }
    if (c.method === "GET" && (r = rest.match(/^\/compare\/(.+)\.\.\.(.+)$/))) {
      const base = await repo.head(decodeURIComponent(r[1]!));
      const head = await repo.head(decodeURIComponent(r[2]!));
      if (!base || !head) return this.reply(404, { message: "Not Found" });
      return this.reply(200, await this.compareJson(repo, base, head));
    }

    // --- the code at a commit, as a tarball
    if (c.method === "GET" && (r = rest.match(/^\/tarball\/([0-9a-f]{40})$/))) {
      if (!(await repo.revParse(r[1]!))) return this.reply(404, { message: "Not Found" });
      return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/${repo.fullName}/legacy.tar.gz/${r[1]}?token=SHORT-LIVED-${this.seq++}` } });
    }

    // --- merging the default branch into a branch
    if (c.method === "POST" && rest === "/merges") {
      this.mustWrite(perms, "contents");
      const base = await repo.head(String(c.body?.base ?? ""));
      const head = await repo.head(String(c.body?.head ?? ""));
      if (!base || !head) return this.reply(404, { message: !base ? "Base does not exist" : "Head does not exist" });
      if (await repo.isAncestor(head, base)) return new Response(null, { status: 204 });
      const merged = await this.mergeTree(repo, base, head);
      if (!merged.ok) return this.reply(409, { message: "Merge conflict" });
      const commit = await repo.commitTree({ tree: merged.tree, parents: [base, head], message: String(c.body?.commit_message ?? `Merge ${c.body?.head} into ${c.body?.base}`) });
      await repo.setRef(String(c.body.base), commit, base);
      return this.reply(201, { sha: commit });
    }

    // --- pull requests
    if (c.method === "POST" && rest === "/pulls") {
      this.mustWrite(perms, "pull_requests");
      const { title, head, base, body, draft } = c.body ?? {};
      const headSha = await repo.head(String(head));
      const baseSha = await repo.head(String(base));
      if (!headSha || !baseSha) return this.reply(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", field: "head", code: "invalid" }] });
      if (repo.pulls.some((x) => x.head === head && x.state === "open")) {
        return this.reply(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: `A pull request already exists for ${owner}:${head}.` }] });
      }
      if (headSha === baseSha) return this.reply(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: `No commits between ${base} and ${head}` }] });
      const number = repo.pulls.length + 1;
      repo.pulls.push({ number, head, base, title, body: String(body ?? ""), draft: draft === true, state: "open", merged: false, headSha, reviewDecision: null, reviewComments: [], issueComments: [], createdAt: Date.now() });
      return this.reply(201, { number, html_url: `https://github.com/${repo.fullName}/pull/${number}`, draft: draft === true });
    }
    if (c.method === "GET" && rest === "/pulls") {
      const head = (q.get("head") ?? "").split(":")[1];
      const open = repo.pulls.filter((x) => x.head === head && x.state === "open");
      return this.reply(200, open.map((x) => ({ number: x.number, html_url: `https://github.com/${repo.fullName}/pull/${x.number}`, head: { ref: x.head } })));
    }
    if ((r = rest.match(/^\/pulls\/(\d+)$/))) {
      const pr = repo.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      if (c.method === "GET") return this.reply(200, await this.pullJson(repo, pr));
      if (c.method === "PATCH") {
        this.mustWrite(perms, "pull_requests");
        if (pr.merged) return this.reply(422, { message: "Validation Failed" });
        if (c.body?.state === "closed") { pr.state = "closed"; pr.closedAt = Date.now(); }
        if (typeof c.body?.title === "string") pr.title = c.body.title;
        if (typeof c.body?.body === "string") pr.body = c.body.body;
        return this.reply(200, await this.pullJson(repo, pr));
      }
    }
    if (c.method === "PUT" && (r = rest.match(/^\/pulls\/(\d+)\/merge$/))) {
      this.mustWrite(perms, "pull_requests");
      this.mustWrite(perms, "contents");
      const pr = repo.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      const j = await this.pullJson(repo, pr);
      if (pr.state !== "open") return this.reply(405, { message: "Pull Request is not open" });
      if (pr.draft) return this.reply(405, { message: "Pull Request is still a draft" });
      if (j.mergeable === false) return this.reply(405, { message: "Pull Request is not mergeable" });
      if (c.body?.sha !== j.head.sha) return this.reply(409, { message: "Head branch was modified. Review and try the merge again." });
      if (c.body?.merge_method !== "squash") return this.reply(405, { message: "Merge method not allowed" });
      if (repo.protection.get(pr.base)?.checks) return this.reply(405, { message: 'Required status check "ci" is expected.' });
      const baseSha = (await repo.head(pr.base))!;
      const headSha = (await repo.head(pr.head)) ?? pr.headSha;
      const merged = await this.mergeTree(repo, baseSha, headSha);
      const commit = await repo.commitTree({ tree: merged.tree, parents: [baseSha], message: `${pr.title} (#${pr.number})` });
      await repo.setRef(pr.base, commit, baseSha);
      pr.state = "closed";
      pr.merged = true;
      pr.closedAt = Date.now();
      return this.reply(200, { sha: commit, merged: true, message: "Pull Request successfully merged" });
    }
    if (c.method === "GET" && (r = rest.match(/^\/pulls\/(\d+)\/comments$/))) {
      const pr = repo.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      return this.reply(200, pr.reviewComments.slice(0, Number(q.get("per_page") ?? 30)).map((x) => ({ user: { login: x.user }, body: x.body, path: x.path, line: x.line, created_at: x.at })));
    }
    if (c.method === "GET" && (r = rest.match(/^\/issues\/(\d+)\/comments$/))) {
      const pr = repo.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      return this.reply(200, pr.issueComments.slice(0, Number(q.get("per_page") ?? 30)).map((x) => ({ user: { login: x.user }, body: x.body, created_at: x.at })));
    }

    // --- Actions: nothing runs on GitHub here
    if (c.method === "GET" && rest === "/actions/runs") return this.reply(200, { total_count: 0, workflow_runs: [] });
    if (c.method === "POST" && /^\/actions\/runs\/\d+\/cancel$/.test(rest)) return this.reply(404, { message: "Not Found" });
    return this.reply(404, { message: "Not Found" });
  }

  // ---------------------------------------------------------------- helpers

  private async commitJson(repo: LocalRepo, sha: string) {
    const parents = await repo.parentsOf(sha);
    const info = (await repo.log(sha, 1))[0];
    return {
      sha, tree: { sha: await repo.treeOf(sha) }, parents: parents.map((p) => ({ sha: p })),
      message: info?.message ?? "", author: { name: info?.author ?? "", email: info?.email ?? "", date: new Date(info?.at ?? 0).toISOString() },
      commit: { message: info?.message ?? "", author: { name: info?.author ?? "", email: info?.email ?? "", date: new Date(info?.at ?? 0).toISOString() } },
    };
  }

  private async compareJson(repo: LocalRepo, base: string, head: string) {
    const counts = (await repo.g(["rev-list", "--left-right", "--count", `${base}...${head}`])).trim().split(/\s+/).map(Number);
    const behind = counts[0] ?? 0;
    const ahead = counts[1] ?? 0;
    const mb = (await repo.mergeBase(base, head)) ?? base;
    const stat = await repo.g(["diff", "--numstat", "--no-renames", mb, head], { allowFail: true });
    const status = await repo.changedFiles(base, head);
    const sMap = new Map(status.map((s) => [s.path, s.status]));
    const files = stat.split("\n").filter(Boolean).map((l) => {
      const [a, d, ...f] = l.split("\t");
      const filename = f.join("\t");
      const st = sMap.get(filename);
      return { filename, status: st === "A" ? "added" : st === "D" ? "removed" : "modified", additions: Number(a) || 0, deletions: Number(d) || 0 };
    });
    const commits = (await repo.log(`${base}..${head}`, 250)).reverse().map((x) => ({ sha: x.sha, commit: { message: x.message } }));
    return { ahead_by: ahead, behind_by: behind, total_commits: ahead, commits, files: files.slice(0, 300) };
  }

  private async mergeTree(repo: LocalRepo, a: string, b: string): Promise<{ ok: true; tree: string } | { ok: false; tree: string }> {
    const r = await repo.exec(["merge-tree", "--write-tree", a, b]);
    const first = r.stdout.split("\n")[0]?.trim() ?? "";
    // Exit status 1 means conflicts; the first line is still a tree.
    return { ok: r.code === 0 && /^[0-9a-f]{40}$/.test(first), tree: /^[0-9a-f]{40}$/.test(first) ? first : EMPTY_TREE };
  }

  private async pullJson(repo: LocalRepo, pr: PullRecord) {
    const baseSha = await repo.head(pr.base);
    const headSha = (await repo.head(pr.head)) ?? pr.headSha;
    const clash = baseSha && !pr.merged ? !(await this.mergeTree(repo, baseSha, headSha)).ok : false;
    const mergeable = !clash;
    const files = baseSha ? (await this.compareJson(repo, baseSha, headSha)).files : [];
    return {
      number: pr.number, html_url: `https://github.com/${repo.fullName}/pull/${pr.number}`, title: pr.title, body: pr.body,
      state: pr.state, merged: pr.merged, draft: pr.draft, mergeable,
      mergeable_state: pr.draft ? "draft" : mergeable === false ? "dirty" : "clean",
      node_id: `PR_${repo.id}_${pr.number}`,
      head: { sha: headSha, ref: pr.head, repo: { id: repo.id } }, base: { ref: pr.base },
      review_comments: pr.reviewComments.length, changed_files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0),
    };
  }

  /** Workflow files changed by commits reachable from `target` that no existing branch reaches (what a push would introduce). */
  private async workflowFilesIntroduced(repo: LocalRepo, target: string): Promise<string[]> {
    const branches = await repo.branches();
    const exclude = branches.flatMap((b) => ["--not", `refs/heads/${b}`]);
    const out = await repo.g(["log", "--name-only", "--format=", target, ...exclude], { allowFail: true });
    return [...new Set(out.split("\n").map((s) => s.trim()).filter((p) => /^\.github\/workflows\//i.test(p)))];
  }

  private async codeload(c: Call): Promise<Response> {
    const m = /^\/([^/]+)\/([^/]+)\/legacy\.tar\.gz\/([0-9a-f]{40})$/.exec(c.url.pathname);
    const repo = m && this.repos.get(`${m[1]}/${m[2]}`);
    if (!repo || !m) return new Response("not found", { status: 404 });
    const sha = m[3]!;
    const tar = await repo.gb(["archive", "--format=tar", `--prefix=${m[1]}-${m[2]}-${sha.slice(0, 7)}/`, sha]).catch(() => null);
    if (!tar) return new Response("not found", { status: 404 });
    return new Response(gzipSync(tar), { status: 200, headers: { "content-type": "application/x-gzip" } });
  }

  /** The two GraphQL operations the code uses. */
  private async graphql(c: Call): Promise<Response> {
    const bearer = /^Bearer (.+)$/.exec(c.headers.authorization ?? "")?.[1] ?? "";
    const token = this.fake.tokens.get(bearer);
    if (!token || token.expiresAt <= Date.now()) return this.reply(401, { message: "Bad credentials" });
    const id = String(c.body?.variables?.id ?? "");
    const m = /^PR_(\d+)_(\d+)$/.exec(id);
    const repo = m && [...this.repos.values()].find((x) => x.id === Number(m[1]));
    const pr = repo && repo.pulls.find((x) => x.number === Number(m![2]));
    const reaches = !!repo && repo.fake.installationId === token.installationId && !!token.repositoryIds?.includes(repo.id);
    if (!repo || !pr || !reaches) return this.reply(200, { data: null, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] });
    const query = String(c.body?.query ?? "");
    if (/markPullRequestReadyForReview/.test(query)) {
      if (token.permissions.pull_requests !== "write") return this.reply(200, { data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] });
      if (pr.state !== "open") return this.reply(200, { data: null, errors: [{ message: "Pull request is not open" }] });
      pr.draft = false;
      return this.reply(200, { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
    }
    if (/reviewDecision/.test(query)) return this.reply(200, { data: { node: { reviewDecision: pr.reviewDecision } } });
    return this.reply(200, { data: null, errors: [{ message: "unknown query" }] });
  }

  // ----------------------------------------------------------- audit helpers

  /** Writes (anything but GET) the code made through the API, excluding token minting. */
  writes(): CallRecord[] { return this.calls.filter((c) => c.method !== "GET" && !c.path.includes("/access_tokens") && !(c.path === "/graphql" && !JSON.stringify(c.body ?? "").includes("mutation"))); }
  count(method: string, re: RegExp): number { return this.calls.filter((c) => c.method === method && re.test(c.path)).length; }
}

/** A request body as it is kept in the call log: long text cut, nothing else changed. */
function summarize(body: unknown): unknown {
  const cut = (v: unknown, depth = 0): unknown => {
    if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 200)}…(${v.length} chars)` : v;
    if (Array.isArray(v)) return depth > 3 ? "[…]" : v.slice(0, 20).map((x) => cut(x, depth + 1));
    if (v && typeof v === "object") return depth > 3 ? "{…}" : Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, cut(x, depth + 1)]));
    return v;
  };
  return cut(body);
}
