/**
 * A fake GitHub, for the Code bot's tests (code-github.test.ts, code-routes.test.ts).
 *
 * `fake.fetchFn` is handed to the code under test in place of fetch, and
 * answers what api.github.com and github.com/login/oauth answer, from memory:
 * installs and the people who can reach them, repos with real git objects
 * (blobs, flat trees, commits, branches), pull requests, installation tokens
 * with the scope they were asked for, and the App's JWT, which it VERIFIES
 * against the App's public key, so a JWT the code signed wrongly fails here.
 *
 * It is strict in the places the real GitHub is, because those are what the
 * code has to get right: a token minted for one repo works on that repo only,
 * a token without contents:write cannot write, a ref update that isn't a
 * fast-forward is a 422, the person's own token works on /user and
 * /user/installations and nowhere else, and git/trees takes a TREE sha (a
 * branch name there is a 404, as a name with a "/" in it is on the real one).
 * What a login may do in a repo is `setPermission`; the collaborator
 * permission endpoint answers from it. Every request is recorded in `calls`.
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { jwtVerify, importSPKI } from "jose";

export interface FakeRepo {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  archived: boolean;
  installationId: number;
}

interface Commit { tree: string; parents: string[]; message: string }
interface RepoGit {
  blobs: Map<string, string>;
  /** Flat trees: path -> blob sha. */
  trees: Map<string, Map<string, string>>;
  commits: Map<string, Commit>;
  /** "heads/main" -> commit sha. */
  refs: Map<string, string>;
  pulls: Array<{ number: number; head: string; base: string; title: string; body: string; draft: boolean; state: "open" }>;
}

export type FakePermission = "admin" | "write" | "read" | "none";

export interface Call { method: string; url: URL; headers: Record<string, string>; body: any; signal: boolean }

const sha = (s: string) => createHash("sha1").update(s).digest("hex");

export interface AppKeys { privateKeyPem: string; publicKeyPem: string }

/** A fresh RSA key pair, the private half in GitHub's own format (PKCS#1). */
export function appKeys(): AppKeys {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

export class FakeGithub {
  clock = { t: Date.UTC(2026, 9, 26, 12, 0, 0) };
  /** Installs by id. */
  installs = new Map<number, { id: number; login: string; type: string; selection: "all" | "selected"; suspendedAt: string | null }>();
  repos: FakeRepo[] = [];
  private git = new Map<number, RepoGit>();
  /** code -> the person's token, one use. */
  codes = new Map<string, string>();
  /** The person's token -> installs they can reach. */
  people = new Map<string, number[]>();
  /** The person's token -> who they are on GitHub. */
  profiles = new Map<string, { id: number; login: string }>();
  private perms = new Map<string, FakePermission | null>();
  /** Collaborator-permission questions, in flight now and at most at once. */
  permissionInflight = 0;
  permissionMaxInflight = 0;
  /** How long each permission answer takes (a real wait, so questions can overlap). */
  permissionDelayMs = 0;
  /** Installation tokens handed out, by token. */
  tokens = new Map<string, { installationId: number; repositoryIds: number[] | null; permissions: Record<string, string>; expiresAt: number }>();
  calls: Call[] = [];
  private seq = 0;
  /** Runs just before a ref update is judged: a place to let someone else push first. */
  beforeRefUpdate: ((repo: FakeRepo, branch: string) => void) | null = null;
  /** The next N POSTs to /git/refs answer "Reference already exists". */
  refCollisions = 0;
  /** Every request to this host path-prefix answers this status (e.g. 500). */
  failWith: { prefix: string; status: number } | null = null;

  constructor(readonly keys: AppKeys, readonly appClientId = "Iv1.testclient", readonly clientSecret = "client-secret-xyz") {}

  // ------------------------------------------------------------- the world

  addInstall(id: number, login: string, o: { type?: string; selection?: "all" | "selected"; suspended?: boolean } = {}) {
    this.installs.set(id, { id, login, type: o.type ?? "User", selection: o.selection ?? "selected", suspendedAt: o.suspended ? new Date(this.clock.t).toISOString() : null });
  }

  /** A repo with a default branch holding `files`. */
  addRepo(installationId: number, fullName: string, o: { id?: number; private?: boolean; defaultBranch?: string; archived?: boolean; files?: Record<string, string> } = {}): FakeRepo {
    const repo: FakeRepo = {
      id: o.id ?? 1000 + this.repos.length + 1, fullName, private: o.private ?? true, defaultBranch: o.defaultBranch ?? "main",
      archived: o.archived ?? false, installationId,
    };
    this.repos.push(repo);
    const g: RepoGit = { blobs: new Map(), trees: new Map(), commits: new Map(), refs: new Map(), pulls: [] };
    this.git.set(repo.id, g);
    const tree = new Map<string, string>();
    for (const [path, text] of Object.entries(o.files ?? { "README.md": "# hello\n" })) {
      const b = sha("blob:" + text);
      g.blobs.set(b, text);
      tree.set(path, b);
    }
    const t = this.treeSha(tree);
    g.trees.set(t, tree);
    const c = this.commitSha({ tree: t, parents: [], message: "init" });
    g.commits.set(c, { tree: t, parents: [], message: "init" });
    g.refs.set(`heads/${repo.defaultBranch}`, c);
    return repo;
  }

  /**
   * Lets a person (by the token their code will be traded for) reach installs.
   * Their GitHub login is `login`, or the token without its "gho_".
   */
  addPerson(code: string, token: string, installIds: number[], login = token.replace(/^gho_/, "")) {
    this.codes.set(code, token);
    this.people.set(token, installIds);
    this.profiles.set(token, { id: 9000 + this.profiles.size + 1, login });
  }

  /** What `login` may do in a repo. `null`: GitHub has never heard of them there (404). Without a call: "none". */
  setPermission(repo: FakeRepo, login: string, permission: FakePermission | null) {
    this.perms.set(`${repo.id}|${login.toLowerCase()}`, permission);
  }
  permissionCalls(): Call[] { return this.calls.filter((c) => /\/collaborators\/[^/]+\/permission$/.test(c.url.pathname)); }
  /** The tree sha a branch's head commit has. */
  treeOf(repo: FakeRepo, branch: string): string {
    const g = this.git.get(repo.id)!;
    return g.commits.get(g.refs.get(`heads/${branch}`)!)!.tree;
  }

  head(repo: FakeRepo, branch: string): string | undefined { return this.git.get(repo.id)!.refs.get(`heads/${branch}`); }
  branches(repo: FakeRepo): string[] { return [...this.git.get(repo.id)!.refs.keys()].map((r) => r.slice(6)); }
  pulls(repo: FakeRepo) { return this.git.get(repo.id)!.pulls; }
  /** The files on a branch as {path: text}. */
  files(repo: FakeRepo, branch: string): Record<string, string> {
    const g = this.git.get(repo.id)!;
    const c = g.commits.get(g.refs.get(`heads/${branch}`)!)!;
    return Object.fromEntries([...g.trees.get(c.tree)!].map(([p, b]) => [p, g.blobs.get(b)!]));
  }
  /** Someone else pushes a commit to the branch. Returns its sha. */
  push(repo: FakeRepo, branch: string, files: Record<string, string>, message = "someone else"): string {
    const g = this.git.get(repo.id)!;
    const parent = g.refs.get(`heads/${branch}`)!;
    const tree = new Map(g.trees.get(g.commits.get(parent)!.tree)!);
    for (const [p, text] of Object.entries(files)) { const b = sha("blob:" + text); g.blobs.set(b, text); tree.set(p, b); }
    const t = this.treeSha(tree);
    g.trees.set(t, tree);
    const commit: Commit = { tree: t, parents: [parent], message };
    const c = this.commitSha(commit);
    g.commits.set(c, commit);
    g.refs.set(`heads/${branch}`, c);
    return c;
  }
  /** Writes (anything but GET) the code made to a repo's git data. */
  writes(): Call[] { return this.calls.filter((c) => c.method !== "GET" && !c.url.pathname.includes("/access_tokens") && c.url.hostname === "api.github.com"); }
  count(method: string, re: RegExp): number { return this.calls.filter((c) => c.method === method && re.test(c.url.pathname + c.url.search)).length; }

  private treeSha(t: Map<string, string>) { return sha("tree:" + JSON.stringify([...t].sort())); }
  private commitSha(c: Commit) { this.seq += 1; return sha("commit:" + JSON.stringify(c) + this.seq); }

  // --------------------------------------------------------------- the wire

  fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { method: init?.method ?? "GET", url, headers, body, signal: init?.signal instanceof AbortSignal };
    this.calls.push(call);
    if (this.failWith && url.pathname.startsWith(this.failWith.prefix)) return this.reply(this.failWith.status, { message: "boom" });
    try {
      return url.hostname === "github.com" ? await this.oauth(call) : await this.api(call);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  };

  private reply(status: number, json: unknown): Response {
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }
  private fail(status: number, message: string, errors?: unknown): never {
    throw this.reply(status, { message, ...(errors ? { errors } : {}) });
  }

  private async oauth(c: Call): Promise<Response> {
    if (c.url.pathname !== "/login/oauth/access_token" || c.method !== "POST") return this.reply(404, {});
    if (c.body?.client_id !== this.appClientId || c.body?.client_secret !== this.clientSecret) return this.reply(200, { error: "incorrect_client_credentials" });
    const token = this.codes.get(c.body?.code);
    if (!token) return this.reply(200, { error: "bad_verification_code" });
    this.codes.delete(c.body.code);
    return this.reply(200, { access_token: token, token_type: "bearer" });
  }

  private bearer(c: Call): string {
    const m = /^Bearer (.+)$/.exec(c.headers.authorization ?? "");
    if (!m) this.fail(401, "Requires authentication");
    return m![1]!;
  }

  /** The App JWT, verified against the App's public key the way GitHub does. */
  private async asApp(c: Call): Promise<void> {
    try {
      const { payload } = await jwtVerify(this.bearer(c), await importSPKI(this.keys.publicKeyPem, "RS256"), {
        algorithms: ["RS256"], issuer: this.appClientId, currentDate: new Date(this.clock.t),
      });
      // GitHub refuses a JWT good for more than ten minutes.
      if (!payload.exp || !payload.iat || payload.exp - payload.iat > 600) this.fail(401, "'Expiration time' too far in the future");
    } catch (e) {
      if (e instanceof Response) throw e;
      this.fail(401, "A JSON web token could not be decoded");
    }
  }

  private repoOf(c: Call, m: RegExpMatchArray): { repo: FakeRepo; git: RepoGit; token: { repositoryIds: number[] | null; permissions: Record<string, string> } } {
    const token = this.tokens.get(this.bearer(c));
    if (!token || token.expiresAt <= this.clock.t) this.fail(401, "Bad credentials");
    const repo = this.repos.find((r) => r.fullName === `${m[1]}/${m[2]}`);
    if (!repo || repo.installationId !== token!.installationId) this.fail(404, "Not Found");
    // A token minted for one repo cannot touch another; one with no repo list is metadata only.
    if (token!.repositoryIds === null || !token!.repositoryIds.includes(repo!.id)) this.fail(404, "Not Found");
    return { repo: repo!, git: this.git.get(repo!.id)!, token: token! };
  }

  /** The collaborator permission endpoint: any token for the repo's install, scoped to the repo or not. */
  private async permission(c: Call, m: RegExpMatchArray, login: string): Promise<Response> {
    const token = this.tokens.get(this.bearer(c));
    if (!token || token.expiresAt <= this.clock.t) return this.reply(401, { message: "Bad credentials" });
    const repo = this.repos.find((r) => r.fullName === `${m[1]}/${m[2]}`);
    if (!repo || repo.installationId !== token.installationId || (token.repositoryIds && !token.repositoryIds.includes(repo.id))) {
      return this.reply(404, { message: "Not Found" });
    }
    this.permissionInflight += 1;
    this.permissionMaxInflight = Math.max(this.permissionMaxInflight, this.permissionInflight);
    try {
      if (this.permissionDelayMs) await new Promise((r) => setTimeout(r, this.permissionDelayMs));
    } finally {
      this.permissionInflight -= 1;
    }
    const said = this.perms.get(`${repo.id}|${login.toLowerCase()}`);
    if (said === null) return this.reply(404, { message: "Not Found" });
    return this.reply(200, { permission: said ?? "none", role_name: said ?? "none", user: { login } });
  }

  private mustWrite(token: { permissions: Record<string, string> }, what: "contents" | "pull_requests") {
    if (token.permissions[what] !== "write") this.fail(403, "Resource not accessible by integration");
  }

  private resolveTree(git: RepoGit, ref: string): Map<string, string> | undefined {
    const direct = git.trees.get(ref);
    if (direct) return direct;
    const commit = git.commits.get(git.refs.get(`heads/${ref}`) ?? ref);
    return commit ? git.trees.get(commit.tree) : undefined;
  }

  private async api(c: Call): Promise<Response> {
    const p = c.url.pathname;
    let m: RegExpMatchArray | null;

    if (c.method === "GET" && p === "/user") {
      const me = this.profiles.get(this.bearer(c));
      return me ? this.reply(200, { id: me.id, login: me.login, type: "User" }) : this.reply(401, { message: "Bad credentials" });
    }

    if (c.method === "GET" && p === "/user/installations") {
      const mine = this.people.get(this.bearer(c));
      if (!mine) return this.reply(401, { message: "Bad credentials" });
      const per = Number(c.url.searchParams.get("per_page") ?? 30), page = Number(c.url.searchParams.get("page") ?? 1);
      const all = mine.map((id) => this.installs.get(id)).filter((i): i is NonNullable<typeof i> => !!i);
      return this.reply(200, {
        total_count: all.length,
        installations: all.slice((page - 1) * per, page * per).map((i) => ({
          id: i.id, account: { login: i.login, type: i.type }, repository_selection: i.selection, suspended_at: i.suspendedAt,
        })),
      });
    }

    if ((m = p.match(/^\/app\/installations\/(\d+)$/)) && c.method === "GET") {
      await this.asApp(c);
      const i = this.installs.get(Number(m[1]));
      if (!i) return this.reply(404, { message: "Not Found" });
      return this.reply(200, { id: i.id, account: { login: i.login, type: i.type }, repository_selection: i.selection, suspended_at: i.suspendedAt });
    }

    if ((m = p.match(/^\/app\/installations\/(\d+)\/access_tokens$/)) && c.method === "POST") {
      await this.asApp(c);
      const id = Number(m[1]);
      if (!this.installs.has(id)) return this.reply(404, { message: "Not Found" });
      if (this.installs.get(id)!.suspendedAt) return this.reply(403, { message: "This installation has been suspended" });
      const ids: number[] | undefined = c.body?.repository_ids;
      const mine = this.repos.filter((r) => r.installationId === id).map((r) => r.id);
      if (ids && ids.some((r) => !mine.includes(r))) return this.reply(422, { message: "There is at least one repository that does not exist or is not accessible to the parent installation." });
      this.seq += 1;
      const token = `ghs_fake${this.seq}`;
      const expiresAt = this.clock.t + 60 * 60_000;
      this.tokens.set(token, { installationId: id, repositoryIds: ids ?? null, permissions: c.body?.permissions ?? {}, expiresAt });
      return this.reply(201, { token, expires_at: new Date(expiresAt).toISOString() });
    }

    if (c.method === "GET" && p === "/installation/repositories") {
      const token = this.tokens.get(this.bearer(c));
      if (!token || token.expiresAt <= this.clock.t) return this.reply(401, { message: "Bad credentials" });
      const all = this.repos.filter((r) => r.installationId === token.installationId);
      const per = Number(c.url.searchParams.get("per_page") ?? 30), page = Number(c.url.searchParams.get("page") ?? 1);
      return this.reply(200, {
        total_count: all.length,
        repositories: all.slice((page - 1) * per, page * per).map((r) => ({
          id: r.id, name: r.fullName.split("/")[1], full_name: r.fullName, private: r.private, default_branch: r.defaultBranch,
          html_url: `https://github.com/${r.fullName}`, archived: r.archived,
        })),
      });
    }

    // Everything below is one repo's git data.
    if (!(m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)$/))) return this.reply(404, { message: "Not Found" });
    const rest = decodeURIComponent(m[3]!).replace(/%2F/gi, "/");
    let collab: RegExpMatchArray | null;
    if (c.method === "GET" && (collab = rest.match(/^\/collaborators\/([^/]+)\/permission$/))) return this.permission(c, m, decodeURIComponent(collab[1]!));
    const { repo, git, token } = this.repoOf(c, m);
    const wanted = (re: RegExp) => rest.match(re);
    let r: RegExpMatchArray | null;

    if (c.method === "GET" && (r = wanted(/^\/git\/ref\/(heads\/.+)$/))) {
      const s = git.refs.get(r[1]!);
      return s ? this.reply(200, { ref: `refs/${r[1]}`, object: { sha: s, type: "commit" } }) : this.reply(404, { message: "Not Found" });
    }
    if (c.method === "POST" && rest === "/git/refs") {
      this.mustWrite(token, "contents");
      const name = String(c.body?.ref ?? "");
      if (this.refCollisions > 0) { this.refCollisions -= 1; return this.reply(422, { message: "Reference already exists" }); }
      if (!/^refs\/heads\/.+/.test(name) || !git.commits.has(c.body?.sha)) return this.reply(422, { message: "Object does not exist" });
      if (git.refs.has(name.slice(5))) return this.reply(422, { message: "Reference already exists" });
      git.refs.set(name.slice(5), c.body.sha);
      return this.reply(201, { ref: name, object: { sha: c.body.sha } });
    }
    if (c.method === "GET" && (r = wanted(/^\/git\/trees\/(.+)$/))) {
      // A tree sha, and nothing else: not a branch, not a commit.
      const tree = git.trees.get(r[1]!);
      if (!tree) return this.reply(404, { message: "Not Found" });
      return this.reply(200, {
        sha: "x", truncated: false,
        tree: [...tree].map(([path, b]) => ({ path, mode: "100644", type: "blob", size: Buffer.byteLength(git.blobs.get(b)!), sha: b })),
      });
    }
    if (c.method === "GET" && (r = wanted(/^\/contents\/(.+)$/))) {
      const ref = c.url.searchParams.get("ref") ?? repo.defaultBranch;
      const tree = this.resolveTree(git, ref);
      if (!tree) return this.reply(404, { message: "No commit found for the ref" });
      const path = r[1]!;
      const b = tree.get(path);
      if (b) {
        const text = git.blobs.get(b)!;
        return this.reply(200, { type: "file", path, size: Buffer.byteLength(text), encoding: "base64", content: Buffer.from(text).toString("base64"), sha: b });
      }
      const dir = [...tree.keys()].filter((k) => k.startsWith(path + "/"));
      return dir.length ? this.reply(200, dir.map((k) => ({ type: "file", path: k, name: k.split("/").pop() }))) : this.reply(404, { message: "Not Found" });
    }
    if (c.method === "GET" && (r = wanted(/^\/git\/commits\/([0-9a-f]+)$/))) {
      const commit = git.commits.get(r[1]!);
      return commit ? this.reply(200, { sha: r[1], tree: { sha: commit.tree }, parents: commit.parents.map((s) => ({ sha: s })) }) : this.reply(404, { message: "Not Found" });
    }
    if (c.method === "POST" && rest === "/git/trees") {
      this.mustWrite(token, "contents");
      const base = git.trees.get(c.body?.base_tree);
      if (!base) return this.reply(422, { message: "base tree does not exist" });
      const tree = new Map(base);
      for (const e of c.body.tree as Array<Record<string, any>>) {
        if (e.mode !== "100644" || e.type !== "blob") return this.reply(422, { message: "bad entry" });
        if (e.sha === null) {
          if (!tree.delete(e.path)) return this.reply(422, { message: `GitRPC::BadObjectState: ${e.path} does not exist` });
        } else {
          const b = sha("blob:" + e.content);
          git.blobs.set(b, e.content);
          tree.set(e.path, b);
        }
      }
      const t = this.treeSha(tree);
      git.trees.set(t, tree);
      return this.reply(201, { sha: t });
    }
    if (c.method === "POST" && rest === "/git/commits") {
      this.mustWrite(token, "contents");
      const { tree, parents, message } = c.body ?? {};
      if (!git.trees.has(tree) || !Array.isArray(parents) || parents.some((s: string) => !git.commits.has(s))) return this.reply(422, { message: "bad commit" });
      const commit: Commit = { tree, parents, message };
      const s = this.commitSha(commit);
      git.commits.set(s, commit);
      return this.reply(201, { sha: s });
    }
    if (c.method === "PATCH" && (r = wanted(/^\/git\/refs\/(heads\/.+)$/))) {
      this.mustWrite(token, "contents");
      this.beforeRefUpdate?.(repo, r[1]!.slice(6));
      const cur = git.refs.get(r[1]!);
      if (!cur) return this.reply(404, { message: "Reference does not exist" });
      const target: string = c.body?.sha;
      if (!git.commits.has(target)) return this.reply(422, { message: "Object does not exist" });
      // A fast-forward: the current head is an ancestor of the new commit.
      const seen = new Set<string>();
      const walk = (s: string): boolean => s === cur || (!seen.has(s) && (seen.add(s), (git.commits.get(s)?.parents ?? []).some(walk)));
      if (c.body?.force !== true && !walk(target)) return this.reply(422, { message: "Update is not a fast forward" });
      git.refs.set(r[1]!, target);
      return this.reply(200, { ref: `refs/${r[1]}`, object: { sha: target } });
    }
    if (c.method === "POST" && rest === "/pulls") {
      this.mustWrite(token, "pull_requests");
      const { title, head, base, body, draft } = c.body ?? {};
      if (!git.refs.has(`heads/${head}`) || !git.refs.has(`heads/${base}`)) return this.reply(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", field: "head", code: "invalid" }] });
      if (git.pulls.some((x) => x.head === head && x.state === "open")) {
        return this.reply(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: `A pull request already exists for ${repo.fullName.split("/")[0]}:${head}.` }] });
      }
      if (git.refs.get(`heads/${head}`) === git.refs.get(`heads/${base}`)) {
        return this.reply(422, { message: "Validation Failed", errors: [{ resource: "PullRequest", code: "custom", message: `No commits between ${base} and ${head}` }] });
      }
      const number = git.pulls.length + 1;
      git.pulls.push({ number, head, base, title, body, draft: draft === true, state: "open" });
      return this.reply(201, { number, html_url: `https://github.com/${repo.fullName}/pull/${number}`, draft: draft === true });
    }
    if (c.method === "GET" && rest === "/pulls") {
      const head = (c.url.searchParams.get("head") ?? "").split(":")[1];
      const open = git.pulls.filter((x) => x.head === head && x.state === "open");
      return this.reply(200, open.map((x) => ({ number: x.number, html_url: `https://github.com/${repo.fullName}/pull/${x.number}`, head: { ref: x.head } })));
    }
    return this.reply(404, { message: "Not Found" });
  };
}
