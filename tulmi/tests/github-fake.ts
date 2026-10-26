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
 * permission endpoint answers from it. A repo can be empty (no commits: git
 * data answers 409 "Git Repository is empty", the contents API's first PUT
 * makes the first commit), branches merge (a real three-way merge of flat
 * trees, with conflicts), compare says what a branch changes, and pull
 * requests have a life: draft, comments, reviews, close, squash-merge, and
 * GraphQL for taking one out of draft. A second way in, the classic OAuth
 * App: `addOAuthPerson` makes a code that trades for a user token with the
 * scopes it is given (and PKCE, when a challenge is given); that token works
 * on /user (with X-OAuth-Scopes), /user/repos and the repo endpoints as the
 * person, by what `setPermission` says they can do there (an owner is admin of
 * their own repos); `killOAuthToken` is GitHub ending it, `blockOrg` an
 * organisation that has not let the app in, and DELETE /applications/{id}/token
 * revokes, recorded in `revoked`. Every request is recorded in `calls`.
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
  pulls: FakePull[];
}

export interface FakePull {
  number: number; head: string; base: string; title: string; body: string; draft: boolean;
  state: "open" | "closed"; merged: boolean;
  /** What GitHub says about whether it merges: undefined works it out from the branches; null is "not worked out yet". */
  mergeable?: boolean | null;
  /** "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", or null. */
  reviewDecision?: string | null;
  reviewComments: Array<{ user: string; body: string; path: string; line: number; at: string }>;
  issueComments: Array<{ user: string; body: string; at: string }>;
}

export type FakePermission = "admin" | "write" | "read" | "none";

export interface Call { method: string; url: URL; headers: Record<string, string>; body: any; signal: boolean; redirect?: string }

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

  /** The classic OAuth App ("Sign in with GitHub"). */
  readonly oauthClientId = "Ov1.oauthclient";
  readonly oauthClientSecret = "oauth-secret-xyz";
  /** code -> what trading it gives. */
  private oauthGrants = new Map<string, { token: string; login: string; id: number; scopes: string[]; challenge?: string }>();
  /** User tokens that work. */
  oauthTokens = new Map<string, { login: string; id: number; scopes: string[] }>();
  /** Tokens that were revoked through DELETE /applications/{client_id}/token, in order. */
  revoked: string[] = [];
  /** Repos of organisations that have not let the OAuth App in: a 403 about SAML / OAuth App access restrictions. */
  private blocked = new Set<number>();

  constructor(readonly keys: AppKeys, readonly appClientId = "Iv1.testclient", readonly clientSecret = "client-secret-xyz") {}

  // ------------------------------------------------------------- the world

  addInstall(id: number, login: string, o: { type?: string; selection?: "all" | "selected"; suspended?: boolean } = {}) {
    this.installs.set(id, { id, login, type: o.type ?? "User", selection: o.selection ?? "selected", suspendedAt: o.suspended ? new Date(this.clock.t).toISOString() : null });
  }

  /** A repo with a default branch holding `files`. */
  addRepo(installationId: number, fullName: string, o: { id?: number; private?: boolean; defaultBranch?: string; archived?: boolean; files?: Record<string, string>; empty?: boolean } = {}): FakeRepo {
    const repo: FakeRepo = {
      id: o.id ?? 1000 + this.repos.length + 1, fullName, private: o.private ?? true, defaultBranch: o.defaultBranch ?? "main",
      archived: o.archived ?? false, installationId,
    };
    this.repos.push(repo);
    const g: RepoGit = { blobs: new Map(), trees: new Map(), commits: new Map(), refs: new Map(), pulls: [] };
    this.git.set(repo.id, g);
    if (o.empty) return repo;
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

  /**
   * A person who will sign in with GitHub: trading `code` gives `token`, with `scopes`. If `challenge` is given the
   * trade must carry a code_verifier that hashes to it (PKCE, S256).
   */
  addOAuthPerson(code: string, token: string, login: string, o: { scopes?: string[]; challenge?: string; id?: number } = {}) {
    this.oauthGrants.set(code, { token, login, id: o.id ?? 5000 + this.oauthGrants.size + 1, scopes: o.scopes ?? ["repo", "read:user"], challenge: o.challenge });
  }
  /** GitHub ends the token (the person revoked it there): it answers 401 from now on. */
  killOAuthToken(token: string) { this.oauthTokens.delete(token); }
  /** An organisation (a repo of it) has not let the OAuth App in. */
  blockOrg(repo: FakeRepo) { this.blocked.add(repo.id); }
  /** What a person can do in a repo: an owner is admin of their own, else what `setPermission` says. */
  private oauthPerm(repo: FakeRepo, login: string): FakePermission {
    if (repo.fullName.split("/")[0]!.toLowerCase() === login.toLowerCase()) return "admin";
    const said = this.perms.get(`${repo.id}|${login.toLowerCase()}`);
    return said ?? "none";
  }
  /** The message of the commit a branch is at. */
  headMessage(repo: FakeRepo, branch: string): string {
    const g = this.git.get(repo.id)!;
    return g.commits.get(g.refs.get(`heads/${branch}`)!)!.message;
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
  /** The number of commits a repo has. */
  commitCount(repo: FakeRepo): number { return this.git.get(repo.id)!.commits.size; }
  /** Someone else changes a pull request: `patch` is applied to it. */
  editPull(repo: FakeRepo, number: number, patch: Partial<FakePull>) { Object.assign(this.git.get(repo.id)!.pulls.find((x) => x.number === number)!, patch); }
  /** A tool token's permissions, by the token. */
  tokenPermissions(token: string) { return this.tokens.get(token)?.permissions; }
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
  writes(): Call[] {
    return this.calls.filter((c) => c.method !== "GET" && !c.url.pathname.includes("/access_tokens") && c.url.hostname === "api.github.com"
      && !(c.url.pathname === "/graphql" && !/\bmutation\b/.test(String(c.body?.query ?? ""))));
  }
  count(method: string, re: RegExp): number { return this.calls.filter((c) => c.method === method && re.test(c.url.pathname + c.url.search)).length; }

  // ----------------------------------------------------- git, enough of it

  private ancestors(g: RepoGit, from: string): Set<string> {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const s = stack.pop()!;
      if (seen.has(s)) continue;
      seen.add(s);
      stack.push(...(g.commits.get(s)?.parents ?? []));
    }
    return seen;
  }
  /** The nearest commit both are built on, or undefined. */
  private mergeBase(g: RepoGit, a: string, b: string): string | undefined {
    const ofA = this.ancestors(g, a);
    const queue = [b];
    const seen = new Set<string>();
    while (queue.length) {
      const s = queue.shift()!;
      if (seen.has(s)) continue;
      seen.add(s);
      if (ofA.has(s)) return s;
      queue.push(...(g.commits.get(s)?.parents ?? []));
    }
    return undefined;
  }
  private flat(g: RepoGit, commit: string | undefined): Map<string, string> {
    return commit ? new Map(g.trees.get(g.commits.get(commit)!.tree)!) : new Map();
  }
  /** A three-way merge of flat trees: `ours` takes `theirs`' changes. A path both changed differently is a conflict. */
  private threeWay(g: RepoGit, base: string | undefined, ours: string, theirs: string): { tree: Map<string, string>; conflict: boolean } {
    const b = this.flat(g, base), o = this.flat(g, ours), t = this.flat(g, theirs);
    const out = new Map(o);
    let conflict = false;
    for (const path of new Set([...b.keys(), ...o.keys(), ...t.keys()])) {
      const bv = b.get(path), ov = o.get(path), tv = t.get(path);
      if (ov === tv || tv === bv) continue; // nothing of theirs to take
      if (ov === bv) { if (tv === undefined) out.delete(path); else out.set(path, tv); continue; }
      conflict = true;
    }
    return { tree: out, conflict };
  }
  private lines(g: RepoGit, blob: string | undefined): string[] { return blob === undefined ? [] : g.blobs.get(blob)!.split("\n").filter((l) => l !== ""); }
  /** How a branch differs from where it left the default branch: files, with line counts. */
  private diffFiles(g: RepoGit, from: Map<string, string>, to: Map<string, string>) {
    const files: Array<{ filename: string; status: string; additions: number; deletions: number }> = [];
    for (const path of [...new Set([...from.keys(), ...to.keys()])].sort()) {
      const a = from.get(path), b = to.get(path);
      if (a === b) continue;
      const before = this.lines(g, a), after = this.lines(g, b);
      const kept = after.filter((l) => before.includes(l)).length;
      files.push({ filename: path, status: a === undefined ? "added" : b === undefined ? "removed" : "modified", additions: after.length - kept, deletions: before.length - before.filter((l) => after.includes(l)).length });
    }
    return files;
  }
  private addCommit(g: RepoGit, commit: Commit): string {
    const s = this.commitSha(commit);
    g.commits.set(s, commit);
    return s;
  }
  private addTree(g: RepoGit, tree: Map<string, string>): string {
    const t = this.treeSha(tree);
    g.trees.set(t, tree);
    return t;
  }

  private treeSha(t: Map<string, string>) { return sha("tree:" + JSON.stringify([...t].sort())); }
  private commitSha(c: Commit) { this.seq += 1; return sha("commit:" + JSON.stringify(c) + this.seq); }

  // --------------------------------------------------------------- the wire

  fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { method: init?.method ?? "GET", url, headers, body, signal: init?.signal instanceof AbortSignal, redirect: init?.redirect };
    this.calls.push(call);
    if (this.failWith && url.pathname.startsWith(this.failWith.prefix)) return this.reply(this.failWith.status, { message: "boom" });
    try {
      return url.hostname === "github.com" ? await this.oauth(call) : await this.api(call);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  };

  private reply(status: number, json: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json", ...headers } });
  }
  private fail(status: number, message: string, errors?: unknown): never {
    throw this.reply(status, { message, ...(errors ? { errors } : {}) });
  }

  private async oauth(c: Call): Promise<Response> {
    if (c.url.pathname !== "/login/oauth/access_token" || c.method !== "POST") return this.reply(404, {});
    if (c.body?.client_id === this.oauthClientId) {
      if (c.body?.client_secret !== this.oauthClientSecret) return this.reply(200, { error: "incorrect_client_credentials" });
      const grant = this.oauthGrants.get(c.body?.code);
      if (!grant) return this.reply(200, { error: "bad_verification_code" });
      this.oauthGrants.delete(c.body.code);
      if (grant.challenge && createHash("sha256").update(String(c.body?.code_verifier ?? "")).digest("base64url") !== grant.challenge) {
        return this.reply(200, { error: "bad_verification_code" });
      }
      this.oauthTokens.set(grant.token, { login: grant.login, id: grant.id, scopes: grant.scopes });
      return this.reply(200, { access_token: grant.token, scope: grant.scopes.join(","), token_type: "bearer" });
    }
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
    const person = this.oauthTokens.get(this.bearer(c));
    if (person) {
      const repo = this.repos.find((r) => r.fullName === `${m[1]}/${m[2]}`);
      if (repo && this.blocked.has(repo.id)) this.fail(403, "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.");
      const perm = repo ? this.oauthPerm(repo, person.login) : "none";
      if (!repo || perm === "none") this.fail(404, "Not Found");
      const write = perm === "admin" || perm === "write";
      return { repo: repo!, git: this.git.get(repo!.id)!, token: { repositoryIds: null, permissions: write ? { contents: "write", pull_requests: "write", metadata: "read" } : { contents: "read", metadata: "read" } } };
    }
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

    if (c.method === "GET" && p === "/user" && this.oauthTokens.has(this.bearer(c))) {
      const me = this.oauthTokens.get(this.bearer(c))!;
      return this.reply(200, { id: me.id, login: me.login, type: "User" }, { "x-oauth-scopes": me.scopes.join(", ") });
    }
    if (c.method === "GET" && p === "/user/repos") {
      const me = this.oauthTokens.get(this.bearer(c));
      if (!me) return this.reply(401, { message: "Bad credentials" });
      const mine = this.repos.filter((r) => this.oauthPerm(r, me.login) !== "none");
      const per = Number(c.url.searchParams.get("per_page") ?? 30), page = Number(c.url.searchParams.get("page") ?? 1);
      return this.reply(200, mine.slice((page - 1) * per, page * per).map((r) => {
        const perm = this.oauthPerm(r, me.login);
        return {
          id: r.id, name: r.fullName.split("/")[1], full_name: r.fullName, private: r.private, default_branch: r.defaultBranch,
          html_url: `https://github.com/${r.fullName}`, archived: r.archived,
          permissions: { admin: perm === "admin", push: perm === "admin" || perm === "write", pull: true },
        };
      }));
    }
    if (c.method === "DELETE" && (m = p.match(/^\/applications\/([^/]+)\/token$/))) {
      const basic = Buffer.from(`${this.oauthClientId}:${this.oauthClientSecret}`).toString("base64");
      if (m[1] !== this.oauthClientId || c.headers.authorization !== `Basic ${basic}`) return this.reply(401, { message: "Bad credentials" });
      const t = String(c.body?.access_token ?? "");
      if (!this.oauthTokens.delete(t)) return this.reply(404, { message: "Not Found" });
      this.revoked.push(t);
      return new Response(null, { status: 204 });
    }
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

    if (c.method === "POST" && p === "/graphql") return this.graphql(c);
    if (c.method === "GET" && (m = p.match(/^\/repos\/([^/]+)\/([^/]+)$/))) {
      const { repo, token } = this.repoOf(c, m);
      const w = token.permissions.contents === "write";
      return this.reply(200, {
        id: repo.id, full_name: repo.fullName, default_branch: repo.defaultBranch, private: repo.private, archived: repo.archived,
        permissions: { admin: false, push: w, pull: true },
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

    if (git.commits.size === 0 && /^\/git\//.test(rest)) return this.reply(409, { message: "Git Repository is empty." });
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
      git.pulls.push({ number, head, base, title, body, draft: draft === true, state: "open", merged: false, reviewComments: [], issueComments: [] });
      return this.reply(201, { number, html_url: `https://github.com/${repo.fullName}/pull/${number}`, draft: draft === true });
    }
    if (c.method === "GET" && rest === "/pulls") {
      const head = (c.url.searchParams.get("head") ?? "").split(":")[1];
      const open = git.pulls.filter((x) => x.head === head && x.state === "open");
      return this.reply(200, open.map((x) => ({ number: x.number, html_url: `https://github.com/${repo.fullName}/pull/${x.number}`, head: { ref: x.head } })));
    }

    // --- a short-lived download link for the code at a commit: a redirect, not the code
    if (c.method === "GET" && (r = wanted(/^\/tarball\/([0-9a-f]{40})$/))) {
      if (!git.commits.has(r[1]!)) return this.reply(404, { message: "Not Found" });
      return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/${repo.fullName}/legacy.tar.gz/${r[1]}?token=SHORT-LIVED-${this.seq++}` } });
    }

    // --- the first commit of an empty repo, and any later file through the contents API
    if (c.method === "GET" && rest === "/commits") {
      const head = git.refs.get(`heads/${repo.defaultBranch}`);
      if (git.commits.size === 0 || !head) return this.reply(409, { message: "Git Repository is empty." });
      return this.reply(200, [{ sha: head, commit: { message: git.commits.get(head)!.message } }]);
    }
    if (c.method === "PUT" && (r = wanted(/^\/contents\/(.+)$/))) {
      this.mustWrite(token, "contents");
      const path = r[1]!;
      const branch = String(c.body?.branch ?? repo.defaultBranch);
      if (typeof c.body?.message !== "string" || typeof c.body?.content !== "string") return this.reply(422, { message: "Invalid request." });
      const text = Buffer.from(c.body.content, "base64").toString("utf8");
      const blob = sha("blob:" + text);
      git.blobs.set(blob, text);
      const parent = git.refs.get(`heads/${branch}`);
      const tree = this.flat(git, parent);
      if (parent && tree.has(path) && c.body.sha !== tree.get(path)) return this.reply(422, { message: `Invalid request.\n\n"sha" wasn't supplied.` });
      tree.set(path, blob);
      const commit = this.addCommit(git, { tree: this.addTree(git, tree), parents: parent ? [parent] : [], message: c.body.message });
      git.refs.set(`heads/${branch}`, commit);
      return this.reply(201, { content: { path, sha: blob }, commit: { sha: commit } });
    }

    // --- merging the default branch into a branch
    if (c.method === "POST" && rest === "/merges") {
      this.mustWrite(token, "contents");
      const { base, head } = c.body ?? {};
      const baseSha = git.refs.get(`heads/${base}`), headSha = git.refs.get(`heads/${head}`);
      if (!baseSha || !headSha) return this.reply(404, { message: !baseSha ? "Base does not exist" : "Head does not exist" });
      if (this.ancestors(git, baseSha).has(headSha)) return new Response(null, { status: 204 });
      const merged = this.threeWay(git, this.mergeBase(git, baseSha, headSha), baseSha, headSha);
      if (merged.conflict) return this.reply(409, { message: "Merge conflict" });
      const commit = this.addCommit(git, { tree: this.addTree(git, merged.tree), parents: [baseSha, headSha], message: String(c.body?.commit_message ?? `Merge ${head} into ${base}`) });
      git.refs.set(`heads/${base}`, commit);
      return this.reply(201, { sha: commit });
    }

    // --- what a branch changes
    if (c.method === "GET" && (r = wanted(/^\/compare\/(.+)\.\.\.(.+)$/))) {
      const baseSha = git.refs.get(`heads/${r[1]}`), headSha = git.refs.get(`heads/${r[2]}`);
      if (!baseSha || !headSha) return this.reply(404, { message: "Not Found" });
      const ofBase = this.ancestors(git, baseSha), ofHead = this.ancestors(git, headSha);
      const ahead = [...ofHead].filter((x) => !ofBase.has(x)), behind = [...ofBase].filter((x) => !ofHead.has(x));
      const files = this.diffFiles(git, this.flat(git, this.mergeBase(git, baseSha, headSha)), this.flat(git, headSha));
      return this.reply(200, {
        ahead_by: ahead.length, behind_by: behind.length, total_commits: ahead.length,
        commits: ahead.reverse().map((x) => ({ sha: x, commit: { message: git.commits.get(x)!.message } })),
        files: files.slice(0, 300),
      });
    }

    // --- one pull request
    if ((r = wanted(/^\/pulls\/(\d+)$/))) {
      const pr = git.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      if (c.method === "GET") return this.reply(200, this.pullJson(repo, git, pr));
      if (c.method === "PATCH") {
        this.mustWrite(token, "pull_requests");
        if (pr.merged) return this.reply(422, { message: "Validation Failed" });
        if (c.body?.state === "closed") pr.state = "closed";
        return this.reply(200, this.pullJson(repo, git, pr));
      }
    }
    if (c.method === "PUT" && (r = wanted(/^\/pulls\/(\d+)\/merge$/))) {
      this.mustWrite(token, "pull_requests");
      this.mustWrite(token, "contents");
      const pr = git.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      const j = this.pullJson(repo, git, pr);
      if (pr.state !== "open") return this.reply(405, { message: "Pull Request is not open" });
      if (pr.draft) return this.reply(405, { message: "Pull Request is still a draft" });
      if (j.mergeable === false) return this.reply(405, { message: "Pull Request is not mergeable" });
      if (c.body?.sha !== j.head.sha) return this.reply(409, { message: "Head branch was modified. Review and try the merge again." });
      if (c.body?.merge_method !== "squash") return this.reply(405, { message: "Merge method not allowed" });
      const baseSha = git.refs.get(`heads/${pr.base}`)!, headSha = git.refs.get(`heads/${pr.head}`)!;
      const merged = this.threeWay(git, this.mergeBase(git, baseSha, headSha), baseSha, headSha);
      // A squash: one commit on the base with the branch's changes; the branch's own commits are not parents.
      const commit = this.addCommit(git, { tree: this.addTree(git, merged.tree), parents: [baseSha], message: `${pr.title} (#${pr.number})` });
      git.refs.set(`heads/${pr.base}`, commit);
      pr.state = "closed";
      pr.merged = true;
      return this.reply(200, { sha: commit, merged: true, message: "Pull Request successfully merged" });
    }
    if (c.method === "GET" && (r = wanted(/^\/pulls\/(\d+)\/comments$/))) {
      const pr = git.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      return this.reply(200, pr.reviewComments.slice(0, Number(c.url.searchParams.get("per_page") ?? 30)).map((x) => ({
        user: { login: x.user }, body: x.body, path: x.path, line: x.line, created_at: x.at,
      })));
    }
    if (c.method === "GET" && (r = wanted(/^\/issues\/(\d+)\/comments$/))) {
      const pr = git.pulls.find((x) => x.number === Number(r![1]));
      if (!pr) return this.reply(404, { message: "Not Found" });
      return this.reply(200, pr.issueComments.slice(0, Number(c.url.searchParams.get("per_page") ?? 30)).map((x) => ({ user: { login: x.user }, body: x.body, created_at: x.at })));
    }

    // --- deleting a branch
    if (c.method === "DELETE" && (r = wanted(/^\/git\/refs\/(heads\/.+)$/))) {
      this.mustWrite(token, "contents");
      return git.refs.delete(r[1]!) ? new Response(null, { status: 204 }) : this.reply(422, { message: "Reference does not exist" });
    }
    return this.reply(404, { message: "Not Found" });
  };

  /** A pull request as GitHub's REST API shows it. */
  private pullJson(repo: FakeRepo, git: RepoGit, pr: FakePull) {
    const baseSha = git.refs.get(`heads/${pr.base}`), headSha = git.refs.get(`heads/${pr.head}`)!;
    const clash = baseSha ? this.threeWay(git, this.mergeBase(git, baseSha, headSha), baseSha, headSha).conflict : false;
    const mergeable = pr.mergeable !== undefined ? pr.mergeable : !clash;
    const files = baseSha ? this.diffFiles(git, this.flat(git, this.mergeBase(git, baseSha, headSha)), this.flat(git, headSha)) : [];
    return {
      number: pr.number, html_url: `https://github.com/${repo.fullName}/pull/${pr.number}`, title: pr.title,
      state: pr.state, merged: pr.merged, draft: pr.draft, mergeable,
      mergeable_state: pr.draft ? "draft" : mergeable === false ? "dirty" : mergeable === null ? "unknown" : "clean",
      node_id: `PR_${repo.id}_${pr.number}`,
      head: { sha: headSha, ref: pr.head, repo: { id: repo.id } }, base: { ref: pr.base },
      review_comments: pr.reviewComments.length, changed_files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0),
    };
  }

  /** The two GraphQL operations the code uses. */
  private graphql(c: Call): Response {
    const person = this.oauthTokens.get(this.bearer(c));
    const token = person ? undefined : this.tokens.get(this.bearer(c));
    if (!person && (!token || token.expiresAt <= this.clock.t)) return this.reply(401, { message: "Bad credentials" });
    const id = String(c.body?.variables?.id ?? "");
    const m = /^PR_(\d+)_(\d+)$/.exec(id);
    const repo = m && this.repos.find((x) => x.id === Number(m[1]));
    const pr = repo && this.git.get(repo.id)!.pulls.find((x) => x.number === Number(m![2]));
    const reaches = person
      ? !!repo && this.oauthPerm(repo, person.login) !== "none"
      : !!repo && repo.installationId === token!.installationId && !(token!.repositoryIds && !token!.repositoryIds.includes(repo.id));
    if (!repo || !pr || !reaches) {
      return this.reply(200, { data: null, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] });
    }
    const permissions = person ? (["admin", "write"].includes(this.oauthPerm(repo, person.login)) ? { pull_requests: "write" } : {}) : token!.permissions;
    const query = String(c.body?.query ?? "");
    if (/markPullRequestReadyForReview/.test(query)) {
      if (permissions.pull_requests !== "write") return this.reply(200, { data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] });
      if (pr.state !== "open") return this.reply(200, { data: null, errors: [{ message: "Pull request is not open" }] });
      pr.draft = false;
      return this.reply(200, { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
    }
    if (/reviewDecision/.test(query)) return this.reply(200, { data: { node: { reviewDecision: pr.reviewDecision ?? null } } });
    return this.reply(200, { data: null, errors: [{ message: "unknown query" }] });
  }
}
