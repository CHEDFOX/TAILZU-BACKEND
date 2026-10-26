/**
 * CALLING GITHUB AS THE TAILZU APP, AND THE GUARD THAT KEEPS IT ON ITS OWN BRANCHES.
 *
 * The Code bot works in a person's repos through a GitHub App, not through
 * their password or a token of theirs. Who Tailzu is to GitHub, in the order a
 * call needs it:
 *
 *   1. the App's private key signs a JWT (RS256, ten minutes at most), cached
 *      for eight. It proves "this is the Tailzu App" and does nothing else;
 *   2. the JWT is traded for an INSTALLATION TOKEN: a token for one install,
 *      good for an hour, with only the permissions asked for (contents write,
 *      pull requests write, metadata read: no workflows, nothing else). To
 *      list an install's repos the token is unscoped (metadata read only); for
 *      everything else it is scoped to ONE repo id, so a bug cannot reach the
 *      person's other repos. Tokens are cached per (install, repo) until five
 *      minutes before they run out, and live in memory only;
 *   3. the PERSON's own GitHub token exists for one moment, in the callback:
 *      the code GitHub sends back is traded for it, it lists the installs the
 *      person can reach (which is how an install is proved to be theirs), it
 *      says who the person is (id and login), and it is dropped. It is never
 *      stored.
 *
 * AN INSTALL IS NOT ACCESS. GitHub lists an install for anyone who can reach
 * any repo in it, so an organisation member, or someone invited to a single
 * repo on another person's account, sees it too. permissionOf asks GitHub what
 * a login may do in one repo (the collaborator permission endpoint, with the
 * install's own token); projects.ts works only where that is write or admin.
 * Answers are kept ten minutes per (install, repo, login), and a write asks
 * again instead of using what was kept.
 *
 * Every request has fifteen seconds and goes through an injectable `fetchFn`,
 * so tests run against a fake GitHub with no network. Nothing in an error
 * repeats GitHub's own words or a token, a code or a key: a failure is a
 * ConnectorError whose message can be shown to the person (connectors/oauth.ts).
 *
 * THE GUARD. Tailzu never writes to a default branch, or to any branch outside
 * `tailzu/`. assertWorkBranch is the one function that says so, and every
 * write goes through it: making a branch, committing, opening the PR. The
 * paths of a commit are held to the same standard (assertRepoPath): relative,
 * no `..`, and nothing under .github/workflows (the App has no permission to
 * change workflows anyway; this gives a clear error instead of GitHub's).
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { ConnectorError } from "../connectors/oauth.js";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
/** Each request to GitHub gets this long. */
const REQUEST_MS = 15_000;
/** The App JWT is reused this long (it is good for nine minutes). */
const JWT_KEEP_MS = 8 * 60_000;
/** An installation token this close to running out is not reused. */
const TOKEN_SKEW_MS = 5 * 60_000;
/** Repos listed for one install, and the pages that take (100 each). */
export const REPOS_MAX = 300;
/** What GitHub's answer about a login in a repo is kept for. */
const ACCESS_KEEP_MS = 10 * 60_000;
/** Larger than this is not read, and not written. */
export const FILE_MAX_BYTES = 1024 * 1024;
/** Most files one commit may carry. */
export const COMMIT_FILES_MAX = 200;
/** The installs a person's token is asked for: pages of 100. */
const INSTALLS_PAGES_MAX = 10;

/** What the App is, from the environment (GITHUB_APP_*). */
export interface GithubAppConfig {
  /** The numeric App id. Only the JWT's issuer when there is no client id. */
  appId?: string;
  /** github.com/apps/<slug>. */
  slug: string;
  clientId: string;
  clientSecret: string;
  /** Raw PEM, or base64 of the PEM. */
  privateKey: string;
}

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  archived: boolean;
}

/** An install as GitHub lists it for a person. */
export interface GithubInstallation {
  id: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: "all" | "selected";
  /** Epoch ms, or null. */
  suspendedAt: number | null;
}

/** A repo as the calls need it: which install to mint a token under, which repo to scope it to, and where to look. */
export interface RepoRef {
  installationId: number;
  repoId: number;
  /** "owner/name". */
  fullName: string;
  defaultBranch: string;
}

export interface TreeEntry { path: string; type: string; size?: number; sha: string }

/** What a login may do in a repo, as GitHub's collaborator permission endpoint says it ("none" for anything else, and for any failure). */
export type RepoPermission = "admin" | "write" | "read" | "none";

/** One file of a commit: its new text, or `delete` (or null text) to remove it. */
export interface CommitFile { path: string; content?: string | null; delete?: boolean }

// ---------------------------------------------------------------- the guard

export const WORK_BRANCH = /^tailzu\/[a-z0-9][a-z0-9-]{0,48}$/;

/**
 * The one check every write to a branch passes: it is a Tailzu work branch,
 * it is not the repo's default branch, and it has no `..` in it.
 */
export function assertWorkBranch(branch: string, defaultBranch: string): void {
  if (typeof branch !== "string" || !WORK_BRANCH.test(branch) || branch === defaultBranch || branch.includes("..")) {
    throw new ConnectorError("bad_branch", "Tailzu only works on its own branches (tailzu/...), never on the default branch or any other.");
  }
}

/**
 * A path inside a repo, as the tree and a commit name it: relative, no empty,
 * `.` or `..` part, nothing inside .git. A path to WRITE also may not be under
 * .github/workflows. Returns the path as given.
 */
export function assertRepoPath(path: unknown, write = false): string {
  const bad = (why: string) => new ConnectorError("bad_path", `I can't use the path ${typeof path === "string" ? JSON.stringify(path.slice(0, 80)) : "given"}: ${why}.`);
  if (typeof path !== "string" || !path) throw bad("it is empty");
  if (path.length > 500) throw bad("it is too long");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) throw bad("it has characters that can't be in a path");
  if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) throw bad("it has to be relative to the repo");
  const parts = path.split("/");
  if (parts.some((p) => p === "..")) throw bad("it can't go up with ..");
  if (parts.some((p) => p === "" || p === ".")) throw bad("it has an empty part");
  if (parts.some((p) => p.toLowerCase() === ".git")) throw bad("it is inside .git");
  if (write && /^\.github\/workflows(\/|$)/i.test(path)) {
    throw new ConnectorError("bad_path", "Tailzu can't change .github/workflows (GitHub Actions files). Make that change yourself.");
  }
  return path;
}

// ---------------------------------------------------------------- the key

/**
 * The App's private key from GITHUB_APP_PRIVATE_KEY: raw PEM (GitHub's own
 * download is PKCS#1, "BEGIN RSA PRIVATE KEY"), or base64 of the PEM, with
 * `\n` written out as two characters turned back into line breaks, and quotes
 * around it dropped. Throws ConnectorError("not_configured") without saying
 * what was in the value.
 */
export function parsePrivateKey(raw: string): KeyObject {
  const unquote = (s: string) => s.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  const unescape = (s: string) => s.replace(/\\n/g, "\n");
  let pem = unescape(unquote(raw));
  if (!pem.includes("-----BEGIN")) pem = unescape(Buffer.from(pem, "base64").toString("utf8"));
  try {
    return createPrivateKey(pem);
  } catch {
    throw new ConnectorError("not_configured", "GitHub isn't set up on this server (the App's private key can't be read).");
  }
}

// ---------------------------------------------------------------- the client

interface Reply { status: number; json: any }

/** A failed GitHub response as a ConnectorError in plain words. GitHub's own text is not repeated. */
export function githubError(status: number, json: any, what: string): ConnectorError {
  const said = String(json?.message ?? "");
  if (status === 401) return new ConnectorError("github_auth", "GitHub turned down Tailzu's access. Try again; if it keeps happening, reconnect GitHub.");
  if (status === 404) return new ConnectorError("not_found", `I couldn't find ${what} on GitHub.`);
  if (status === 429 || (status === 403 && /rate limit|abuse|secondary/i.test(said))) {
    return new ConnectorError("busy", "GitHub is busy right now. Try again in a minute.");
  }
  if (status === 403) return new ConnectorError("forbidden", `GitHub wouldn't let Tailzu do that to ${what}. The App may not have access to it any more.`);
  if (status === 409) return new ConnectorError("conflict", `GitHub can't do that to ${what} right now (it may be empty, or changing).`);
  if (status === 422) return new ConnectorError("rejected", `GitHub didn't accept that for ${what}.`);
  return new ConnectorError("failed", "GitHub ran into a problem. Try again in a moment.");
}

const refName = (branch: string): string => {
  // git's own rules for a ref name, enough to keep it one path in a URL.
  // eslint-disable-next-line no-control-regex
  if (typeof branch !== "string" || !/^[^\s~^:?*[\\\u0000-\u001f\u007f]{1,255}$/.test(branch) || branch.includes("..") || branch.includes("@{") || branch.startsWith("/") || branch.endsWith("/")) {
    throw new ConnectorError("bad_branch", "That isn't a branch name I can use.");
  }
  return branch;
};
const encodePath = (p: string): string => p.split("/").map(encodeURIComponent).join("/");

const asRepo = (r: any): GithubRepo | null =>
  r && Number.isSafeInteger(r.id) && typeof r.full_name === "string" && typeof r.default_branch === "string"
    ? {
        id: r.id, name: String(r.name ?? r.full_name.split("/")[1] ?? ""), fullName: r.full_name, private: r.private === true,
        defaultBranch: r.default_branch, htmlUrl: typeof r.html_url === "string" ? r.html_url : `https://github.com/${r.full_name}`,
        archived: r.archived === true,
      }
    : null;

const asInstallation = (i: any): GithubInstallation | null =>
  i && Number.isSafeInteger(i.id) && typeof i.account?.login === "string"
    ? {
        id: i.id, accountLogin: i.account.login, accountType: typeof i.account.type === "string" ? i.account.type : "User",
        repositorySelection: i.repository_selection === "selected" ? "selected" : "all",
        suspendedAt: typeof i.suspended_at === "string" && Number.isFinite(Date.parse(i.suspended_at)) ? Date.parse(i.suspended_at) : null,
      }
    : null;

export class GithubApp {
  private readonly key: KeyObject;
  private jwt: { token: string; until: number } | null = null;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly access = new Map<string, { permission: RepoPermission; until: number }>();
  private readonly minting = new Map<string, Promise<string>>();

  /** Throws ConnectorError("not_configured") when the key can't be read. */
  constructor(private readonly c: GithubAppConfig, private readonly o: { fetchFn?: typeof fetch; now?: () => number } = {}) {
    this.key = parsePrivateKey(c.privateKey);
  }

  get slug(): string { return this.c.slug; }
  private now(): number { return (this.o.now ?? Date.now)(); }

  /** One request. A GitHub that can't be reached or is too slow is a ConnectorError, never the raw error. */
  private async send(method: string, url: string, bearer: string, body?: unknown): Promise<Reply> {
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(url, {
        method,
        headers: {
          Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "tailzu",
          Authorization: `Bearer ${bearer}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_MS),
      });
    } catch {
      throw new ConnectorError("failed", "GitHub didn't answer. Try again in a moment.");
    }
    const text = await res.text().catch(() => "");
    let json: any = {};
    if (text) { try { json = JSON.parse(text); } catch { json = {}; } }
    return { status: res.status, json };
  }

  // -------------------------------------------------------------- who we are

  /** The App JWT: RS256, issued a minute back for clock drift, good for nine minutes, reused for eight. */
  async appJwt(): Promise<string> {
    const now = this.now();
    if (this.jwt && this.jwt.until > now) return this.jwt.token;
    const secs = Math.floor(now / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.c.clientId || this.c.appId || "")
      .setIssuedAt(secs - 60).setExpirationTime(secs + 540)
      .sign(this.key);
    this.jwt = { token, until: now + JWT_KEEP_MS };
    return token;
  }

  /**
   * A token for one install. With a repo id it is scoped to that one repo and
   * may write contents and pull requests; without, it can only read metadata
   * (to list the install's repos). Cached until five minutes before it ends.
   */
  async installationToken(installationId: number, repoId?: number): Promise<string> {
    const key = `${installationId}|${repoId ?? "*"}`;
    const hit = this.tokens.get(key);
    if (hit && hit.expiresAt - TOKEN_SKEW_MS > this.now()) return hit.token;
    const running = this.minting.get(key);
    if (running) return running;
    const p = (async () => {
      const r = await this.send("POST", `${GITHUB_API}/app/installations/${installationId}/access_tokens`, await this.appJwt(),
        repoId === undefined
          ? { permissions: { metadata: "read" } }
          : { repository_ids: [repoId], permissions: { contents: "write", pull_requests: "write", metadata: "read" } });
      if (r.status < 200 || r.status >= 300 || typeof r.json?.token !== "string") throw githubError(r.status, r.json, "that installation");
      const expiresAt = Date.parse(String(r.json.expires_at));
      this.tokens.set(key, { token: r.json.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : this.now() + 55 * 60_000 });
      return r.json.token as string;
    })().finally(() => this.minting.delete(key));
    this.minting.set(key, p);
    return p;
  }

  // ---------------------------------------------------------- the person

  /** The code GitHub sent the person back with, traded for their token. Used once by the caller and dropped. */
  async exchangeUserCode(code: string): Promise<string> {
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "tailzu" },
        body: JSON.stringify({ client_id: this.c.clientId, client_secret: this.c.clientSecret, code }),
        signal: AbortSignal.timeout(REQUEST_MS),
      });
    } catch {
      throw new ConnectorError("failed", "GitHub didn't answer. Try again in a moment.");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // GitHub answers 200 with { error } for a code that is used up or wrong.
    if (!res.ok || typeof json.access_token !== "string" || !json.access_token) {
      throw new ConnectorError("bad_state", "GitHub didn't accept that sign-in. Start again from Tailzu.");
    }
    return json.access_token;
  }

  /** The installs this person's GitHub account can reach. Their token is used here and nowhere else. */
  async userInstallations(userToken: string): Promise<GithubInstallation[]> {
    const out: GithubInstallation[] = [];
    for (let page = 1; page <= INSTALLS_PAGES_MAX; page += 1) {
      const r = await this.send("GET", `${GITHUB_API}/user/installations?per_page=100${page > 1 ? `&page=${page}` : ""}`, userToken);
      if (r.status !== 200) throw githubError(r.status, r.json, "your installations");
      const rows: unknown[] = Array.isArray(r.json?.installations) ? r.json.installations : [];
      for (const row of rows) { const i = asInstallation(row); if (i) out.push(i); }
      if (rows.length < 100) break;
    }
    return out;
  }

  /** Who the person is on GitHub (the id and login that never leave the link). Used with the same one-moment token. */
  async userProfile(userToken: string): Promise<{ id: number; login: string }> {
    const r = await this.send("GET", `${GITHUB_API}/user`, userToken);
    if (r.status !== 200) throw githubError(r.status, r.json, "your GitHub account");
    if (!Number.isSafeInteger(r.json?.id) || typeof r.json?.login !== "string" || !r.json.login) {
      throw new ConnectorError("failed", "GitHub ran into a problem. Try again in a moment.");
    }
    return { id: r.json.id, login: r.json.login };
  }

  /** One install as GitHub has it now (the App's own view), or null when it is gone. */
  async getInstallation(installationId: number): Promise<GithubInstallation | null> {
    const r = await this.send("GET", `${GITHUB_API}/app/installations/${installationId}`, await this.appJwt());
    if (r.status === 404) return null;
    if (r.status !== 200) throw githubError(r.status, r.json, "that installation");
    return asInstallation(r.json);
  }

  // --------------------------------------------------------------- repos

  /** The repos an install can see, up to REPOS_MAX; `truncated` when there are more. */
  async listRepos(installationId: number): Promise<{ repos: GithubRepo[]; truncated: boolean }> {
    const token = await this.installationToken(installationId);
    const repos: GithubRepo[] = [];
    let total: number | null = null;
    let full = false;
    for (let page = 1; page <= REPOS_MAX / 100; page += 1) {
      const r = await this.send("GET", `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`, token);
      if (r.status !== 200) throw githubError(r.status, r.json, "that installation's repos");
      const rows: unknown[] = Array.isArray(r.json?.repositories) ? r.json.repositories : [];
      if (Number.isFinite(r.json?.total_count)) total = Number(r.json.total_count);
      for (const row of rows) { const repo = asRepo(row); if (repo) repos.push(repo); }
      full = rows.length === 100;
      if (!full || (total !== null && page * 100 >= total)) break;
    }
    // Past the cap if GitHub counts more than we took; with no count, if the last page was full.
    return { repos, truncated: total !== null ? total > REPOS_MAX : full };
  }

  // ------------------------------------------------------------- the repo

  private path(repo: Pick<RepoRef, "fullName">): string {
    const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo.fullName);
    if (!m) throw new ConnectorError("bad_request", "That repo's name isn't one I can use.");
    return `${GITHUB_API}/repos/${m[1]}/${m[2]}`;
  }
  private token(repo: RepoRef): Promise<string> { return this.installationToken(repo.installationId, repo.repoId); }

  /**
   * What `login` may do in a repo. Asked with the install's own token (one
   * token per install, metadata read, however many repos are asked about) and
   * kept ten minutes; `fresh` asks again and replaces what was kept, which is
   * what a write does, so access taken away is felt at once. A 404 is an
   * answer ("none"); any other failure is "none" too, but is not kept, so a
   * GitHub having a bad minute does not hide a repo for ten.
   */
  async permissionOf(repo: Pick<RepoRef, "installationId" | "repoId" | "fullName">, login: string, fresh = false): Promise<RepoPermission> {
    const key = `${repo.installationId}|${repo.repoId}|${login.toLowerCase()}`;
    const hit = this.access.get(key);
    if (!fresh && hit && hit.until > this.now()) return hit.permission;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) return "none";
    let permission: RepoPermission = "none";
    let answered = false;
    try {
      const r = await this.send("GET", `${this.path(repo)}/collaborators/${encodeURIComponent(login)}/permission`, await this.installationToken(repo.installationId));
      if (r.status === 200) {
        const said = String(r.json?.permission ?? "");
        permission = said === "admin" || said === "write" || said === "read" ? said : "none";
        answered = true;
      } else if (r.status === 404) {
        answered = true;
      }
    } catch {
      // Any failure is "none".
    }
    if (answered) {
      if (this.access.size > 10_000) for (const [k, v] of this.access) if (v.until <= this.now()) this.access.delete(k);
      this.access.set(key, { permission, until: this.now() + ACCESS_KEEP_MS });
    } else {
      this.access.delete(key);
    }
    return permission;
  }

  /** The commit a branch points at. */
  async branchHead(repo: RepoRef, branch: string): Promise<string> {
    const r = await this.send("GET", `${this.path(repo)}/git/ref/heads/${encodePath(refName(branch))}`, await this.token(repo));
    if (r.status !== 200 || typeof r.json?.object?.sha !== "string") throw githubError(r.status, r.json, `the branch ${branch}`);
    return r.json.object.sha;
  }

  /** A new branch at the default branch's head. Returns that head. Fails with "branch_exists" if the name is taken. */
  async createBranch(repo: RepoRef, branch: string): Promise<string> {
    assertWorkBranch(branch, repo.defaultBranch);
    const baseSha = await this.branchHead(repo, repo.defaultBranch);
    const r = await this.send("POST", `${this.path(repo)}/git/refs`, await this.token(repo), { ref: `refs/heads/${branch}`, sha: baseSha });
    if (r.status === 422 && /already exists/i.test(String(r.json?.message ?? ""))) {
      throw new ConnectorError("branch_exists", "That branch name is taken.");
    }
    if (r.status !== 201) throw githubError(r.status, r.json, "the new branch");
    return baseSha;
  }

  /**
   * Every file and folder on the branch. The branch name is never put in the
   * trees URL (a name with a "/" in it is not one path part there): the
   * branch is resolved to its commit, the commit to its tree, and the tree
   * is read by its own sha.
   */
  async tree(repo: RepoRef, branch: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const base = this.path(repo);
    const token = await this.token(repo);
    const head = await this.branchHead(repo, branch);
    const commit = await this.send("GET", `${base}/git/commits/${head}`, token);
    if (commit.status !== 200 || typeof commit.json?.tree?.sha !== "string") throw githubError(commit.status, commit.json, `the branch ${branch}`);
    const r = await this.send("GET", `${base}/git/trees/${commit.json.tree.sha}?recursive=1`, token);
    if (r.status !== 200 || !Array.isArray(r.json?.tree)) throw githubError(r.status, r.json, `the branch ${branch}`);
    const entries: TreeEntry[] = (r.json.tree as any[])
      .filter((e) => e && typeof e.path === "string" && typeof e.type === "string" && typeof e.sha === "string")
      .map((e) => ({ path: e.path, type: e.type, ...(Number.isFinite(e.size) ? { size: Number(e.size) } : {}), sha: e.sha }));
    return { entries, truncated: r.json.truncated === true };
  }

  /** One file's text on the branch. Refuses a folder, a file over 1 MB, and a file that isn't text. */
  async readFile(repo: RepoRef, branch: string, path: string): Promise<{ path: string; size: number; text: string }> {
    assertRepoPath(path);
    const r = await this.send("GET", `${this.path(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(refName(branch))}`, await this.token(repo));
    if (r.status !== 200) throw githubError(r.status, r.json, path);
    const f = r.json;
    if (Array.isArray(f) || !f || typeof f !== "object" || (f.type && f.type !== "file")) {
      throw new ConnectorError("not_a_file", `${path} isn't a file I can read.`);
    }
    const size = Number(f.size);
    if (!Number.isFinite(size) || size > FILE_MAX_BYTES) {
      throw new ConnectorError("too_large", `${path} is over 1 MB, which is more than I read.`);
    }
    if (f.encoding !== "base64" || typeof f.content !== "string") throw new ConnectorError("not_a_file", `${path} isn't a file I can read.`);
    const bytes = Buffer.from(f.content, "base64");
    if (bytes.length > FILE_MAX_BYTES) throw new ConnectorError("too_large", `${path} is over 1 MB, which is more than I read.`);
    if (bytes.includes(0)) throw new ConnectorError("binary_file", `${path} isn't text, so I can't read it.`);
    return { path, size: bytes.length, text: bytes.toString("utf8") };
  }

  /**
   * One commit on a work branch, any number of files in it. The branch moves
   * only forward (force: false): if someone else pushed in the meantime GitHub
   * refuses and this throws "branch_moved", so nothing is overwritten.
   */
  async commit(repo: RepoRef, branch: string, files: CommitFile[], message: string): Promise<{ sha: string; parentSha: string }> {
    assertWorkBranch(branch, repo.defaultBranch);
    const tree = this.treeEntries(files);
    const msg = typeof message === "string" ? message.trim().slice(0, 5000) : "";
    if (!msg) throw new ConnectorError("bad_request", "A commit needs a message.");

    const base = this.path(repo);
    const token = await this.token(repo);
    const parentSha = await this.branchHead(repo, branch);
    const parent = await this.send("GET", `${base}/git/commits/${parentSha}`, token);
    if (parent.status !== 200 || typeof parent.json?.tree?.sha !== "string") throw githubError(parent.status, parent.json, "the branch");
    const made = await this.send("POST", `${base}/git/trees`, token, { base_tree: parent.json.tree.sha, tree });
    if (made.status !== 201 || typeof made.json?.sha !== "string") throw githubError(made.status, made.json, "those files");
    const commit = await this.send("POST", `${base}/git/commits`, token, { message: msg, tree: made.json.sha, parents: [parentSha] });
    if (commit.status !== 201 || typeof commit.json?.sha !== "string") throw githubError(commit.status, commit.json, "the commit");
    const moved = await this.send("PATCH", `${base}/git/refs/heads/${encodePath(branch)}`, token, { sha: commit.json.sha, force: false });
    // Not a fast-forward: the branch got a commit since we read it.
    if (moved.status === 422) throw new ConnectorError("branch_moved", "The branch changed while I was committing. Nothing was overwritten; read it again and retry.");
    if (moved.status !== 200) throw githubError(moved.status, moved.json, "the branch");
    return { sha: commit.json.sha, parentSha };
  }

  /** The files of a commit as the tree API takes them, checked. */
  private treeEntries(files: CommitFile[]): Array<Record<string, unknown>> {
    if (!Array.isArray(files) || !files.length) throw new ConnectorError("bad_request", "There is nothing to commit.");
    if (files.length > COMMIT_FILES_MAX) throw new ConnectorError("bad_request", `A commit can have at most ${COMMIT_FILES_MAX} files.`);
    const seen = new Set<string>();
    return files.map((f) => {
      const path = assertRepoPath(f?.path, true);
      if (seen.has(path)) throw new ConnectorError("bad_path", `${path} is in this commit twice.`);
      seen.add(path);
      if (f.delete === true || f.content === null) return { path, mode: "100644", type: "blob", sha: null };
      if (typeof f.content !== "string") throw new ConnectorError("bad_request", `${path} has no text to write.`);
      if (Buffer.byteLength(f.content, "utf8") > FILE_MAX_BYTES) throw new ConnectorError("too_large", `${path} is over 1 MB, which is more than I write.`);
      return { path, mode: "100644", type: "blob", content: f.content };
    });
  }

  /** A draft pull request from a work branch into the default branch. When one is open already, that one. */
  async openDraftPr(repo: RepoRef, branch: string, title: string, body: string): Promise<{ number: number; url: string; existing: boolean }> {
    assertWorkBranch(branch, repo.defaultBranch);
    const t = typeof title === "string" ? title.trim().slice(0, 256) : "";
    if (!t) throw new ConnectorError("bad_request", "A pull request needs a title.");
    const text = typeof body === "string" ? body.slice(0, 60_000) : "";
    const base = this.path(repo);
    const token = await this.token(repo);
    const r = await this.send("POST", `${base}/pulls`, token, { title: t, head: branch, base: repo.defaultBranch, body: text, draft: true });
    if (r.status === 201 && Number.isSafeInteger(r.json?.number) && typeof r.json?.html_url === "string") {
      return { number: r.json.number, url: r.json.html_url, existing: false };
    }
    if (r.status === 422 && /already exists/i.test(JSON.stringify(r.json ?? {}))) {
      const owner = repo.fullName.split("/")[0]!;
      const found = await this.send("GET", `${base}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`, token);
      const pr = found.status === 200 && Array.isArray(found.json) ? found.json.find((p: any) => Number.isSafeInteger(p?.number) && typeof p?.html_url === "string") : null;
      if (pr) return { number: pr.number, url: pr.html_url, existing: true };
      throw githubError(found.status === 200 ? 422 : found.status, found.json, "the pull request");
    }
    if (r.status === 422 && /no commits between/i.test(JSON.stringify(r.json ?? {}))) {
      throw new ConnectorError("nothing_to_review", "There is nothing to open a pull request for yet: commit something to the branch first.");
    }
    // Private repos on GitHub's free plans can't have drafts.
    if (r.status === 422 && /draft pull requests are not supported/i.test(JSON.stringify(r.json ?? {}))) {
      throw new ConnectorError("no_drafts", "This repo's GitHub plan doesn't allow draft pull requests, so I didn't open one.");
    }
    throw githubError(r.status, r.json, "the pull request");
  }
}
