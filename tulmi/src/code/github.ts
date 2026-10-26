/**
 * CALLING GITHUB AS THE TAILZU APP (OR AS THE PERSON), AND SAYING IT IN PLAIN WORDS WHEN GITHUB REFUSES.
 *
 * The Code bot works in a person's repos through a GitHub App, not through
 * their password or a token of theirs. Who Tailzu is to GitHub, in the order a
 * call needs it:
 *
 *   1. the App's private key signs a JWT (RS256, ten minutes at most), cached
 *      for eight. It proves "this is the Tailzu App" and does nothing else;
 *   2. the JWT is traded for an INSTALLATION TOKEN: a token for one install,
 *      good for an hour, with only the permissions asked for (contents write,
 *      pull requests write, metadata read; and workflows write, only for the
 *      one commit that changes a workflow file, and only if the install has
 *      been given that permission; and actions read or write, only for a call
 *      that looks at or cancels a workflow run). To list an install's repos the token is
 *      unscoped (metadata read only); for everything else it is scoped to ONE
 *      repo id, so a bug cannot reach the person's other repos. Tokens are
 *      cached per (install, repo) until five minutes before they run out, and
 *      live in memory only;
 *   3. the PERSON's own GitHub token exists for one moment, in the callback:
 *      the code GitHub sends back is traded for it, it lists the installs the
 *      person can reach (which is how an install is proved to be theirs), it
 *      says who the person is (id and login), and it is dropped. It is never
 *      stored.
 *
 * Which token a call carries is a GitAccess (access.ts): the App's installation
 * token above, or, for a person who signed in with GitHub instead of installing
 * the App, their own token (oauth.ts). The calls below are the same for both;
 * a RepoRef names the access, and none means the App.
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
 * THE RULES ARE NOT HERE. This file is the client: it makes the calls, and
 * checks what can only be checked here (a branch name that is a branch name, a
 * path that stays inside the repo). Whether the bot SHOULD make a call (is it
 * its own branch, does it need the person's yes, is it a force-push) is
 * policy.ts, and projects.ts and pulls.ts ask it before they call anything
 * here. So a method below does what it is told; the only things it refuses are
 * the ones that are never right:
 *
 *   - a path that is absolute, goes up with `..` or sits inside .git
 *     (assertRepoPath; policy.ts calls that action path.escape and "never");
 *   - a branch name git itself would not take (validBranchName);
 *   - moving a branch to a commit that is not a fast-forward unless `force`
 *     is passed, which only a strict approval ever does (updateRef).
 *
 * WHO COMMITS. Every commit made here has the bot as its author (CODE_BOT_NAME
 * and CODE_BOT_EMAIL; access.ts) and, when the person's GitHub id and login are
 * known, a Co-authored-by line for them at the end of its message. The committer
 * is left for GitHub to fill in as the token's own identity. GitHub makes
 * merge commits itself (a sync, a squash-merge) and gives no way to set their
 * author, so those are authored by the token's identity.
 *
 * THE RUNNER'S BRANCH. createShadowBranch makes the throwaway `tailzu-run/`
 * branch a step runs on: one new commit on a parent, a new ref, nothing else
 * moved. latestRun and cancelRun look at and stop the workflow run it started;
 * listDir lists a folder (the person's own workflows). The rules for all of that
 * are policy.ts (runner.shadow) and code/jobs/githubActions.ts.
 *
 * WHEN GITHUB SAYS NO. A refusal because of branch protection or a repository
 * rule (a required check, a required review, "changes must be made through a
 * pull request") is a ConnectorError with the code `protected_branch`, in plain
 * words, whichever call it came from. Tailzu reports it and does not try to get
 * round it.
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { ConnectorError } from "../connectors/oauth.js";
import { AppAccess, DEFAULT_BOT, withCoAuthor, type BotIdentity, type GitAccess, type Person } from "./access.js";
import { SHADOW_PREFIX } from "./shadow.js";

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
/** Files, comments and commits a look at a branch or pull request returns. */
export const DIFF_FILES_MAX = 300;
export const COMMENTS_MAX = 100;
export const COMMENT_CHARS = 2000;
/** Larger than this is not read, and not written. */
export const FILE_MAX_BYTES = 1024 * 1024;
/** Most files one commit may carry. */
export const COMMIT_FILES_MAX = 200;
/** The installs a person's token is asked for: pages of 100. */
const INSTALLS_PAGES_MAX = 10;
/** The most pages of a person's repos looked through for the 300 they can push to. */
const USER_REPOS_PAGES_MAX = 10;

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
  /** Where the token for calls on this repo comes from. None: the GitHub App's. */
  access?: GitAccess;
  /** The App's token for this call also has the Workflows permission (only for a commit that changes a workflow file). Ignored for a person's own token. */
  workflows?: boolean;
  /** The App's token for this call also has the Actions permission, to read a workflow run ("read") or cancel one ("write"). Ignored for a person's own token. */
  actions?: "read" | "write";
}

export interface TreeEntry { path: string; type: string; size?: number; sha: string }

/** What a login may do in a repo, as GitHub's collaborator permission endpoint says it ("none" for anything else, and for any failure). */
export type RepoPermission = "admin" | "write" | "read" | "none";

/** A pull request as Tailzu needs to see it. */
export interface PullInfo {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  /** GitHub works this out lazily: null until it has. */
  mergeable: boolean | null;
  mergeableState: string;
  headSha: string;
  headRef: string;
  /** The repo the branch is in: not this repo's id for a pull request from a fork. */
  headRepoId: number | null;
  baseRef: string;
  /** For GraphQL, which names things by this id. */
  nodeId: string;
  reviewComments: number;
  changedFiles: number;
  additions: number;
  deletions: number;
}

/** What changed on a branch, against the default branch. No file contents, no patches. */
export interface BranchDiff {
  aheadBy: number;
  behindBy: number;
  commits: Array<{ sha: string; message: string }>;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  totals: { files: number; additions: number; deletions: number };
  truncated: boolean;
}

/** A comment on a pull request, as the bot reads it later. The words in `body` are somebody else's: see pullComments. */
export interface PullComment { author: string; body: string; path?: string; line?: number; createdAt: number }

/** A GitHub Actions workflow run, as much of it as Tailzu looks at. */
export interface GithubRun {
  id: number;
  /** "queued", "in_progress" or "completed" (GitHub also has "waiting", "requested", "pending"). */
  status: string;
  /** Once completed: "success", "failure", "cancelled", "timed_out", "startup_failure"... Null before. */
  conclusion: string | null;
  /** The commit it ran. */
  headSha: string;
  event: string;
  /** Epoch ms. */
  createdAt: number;
}

/** One file of a commit: its new text, or `delete` (or null text) to remove it. */
export interface CommitFile { path: string; content?: string | null; delete?: boolean }

/** What a commit can be told besides its files and message. */
export interface CommitOptions {
  /** Who the work is for: credited in the message (access.ts withCoAuthor). */
  person?: Person | null;
  /** The commit the branch must be at: if it is anywhere else the commit is not made ("changed_since_approval"). */
  expectHead?: string;
}

// ---------------------------------------------------------- names and paths

/** The names the bot gives its own branches: `tailzu/<slug>-<4 hex>`. Whether a branch is the bot's is a record (store.ts), not this. */
export const WORK_BRANCH = /^tailzu\/[a-z0-9][a-z0-9-]{0,48}$/;

/** Whether a name is one the bot would give a branch of its own. */
export function isWorkBranchName(branch: string, defaultBranch: string): boolean {
  return typeof branch === "string" && WORK_BRANCH.test(branch) && branch !== defaultBranch && !branch.includes("..");
}

/** git's own rules for a ref name, enough to keep it one path in a URL. */
export function validBranchName(branch: unknown): branch is string {
  // eslint-disable-next-line no-control-regex
  return typeof branch === "string" && /^[^\s~^:?*[\\\u0000-\u001f\u007f]{1,255}$/.test(branch) && !branch.includes("..") && !branch.includes("@{")
    && !branch.startsWith("/") && !branch.endsWith("/") && !branch.endsWith(".lock") && !branch.includes("//");
}

/**
 * A path inside a repo, as the tree and a commit name it: relative, no empty,
 * `.` or `..` part, nothing inside .git. These are the paths policy.ts calls
 * "never" (path.escape): nothing can allow them. Returns the path as given.
 *
 * Writing under .github/workflows is NOT refused here: it is a question for
 * policy.ts (workflow.write: it asks, and the token must be allowed to).
 */
export function assertRepoPath(path: unknown): string {
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

interface Reply { status: number; json: any; headers: Headers }

/**
 * One request to GitHub, fifteen seconds at most. `auth` is the whole
 * Authorization header ("" for none). A GitHub that can't be reached or is too
 * slow is a ConnectorError, never the raw error; `manual` hands back a
 * redirect instead of following it.
 */
export async function githubFetch(
  fetchFn: typeof fetch | undefined, method: string, url: string, auth: string, body?: unknown, o: { manual?: boolean } = {},
): Promise<Reply> {
  let res: Response;
  try {
    res = await (fetchFn ?? fetch)(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "tailzu",
        ...(auth ? { Authorization: auth } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(o.manual ? { redirect: "manual" as const } : {}),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
  } catch {
    throw new ConnectorError("failed", "GitHub didn't answer. Try again in a moment.");
  }
  const text = await res.text().catch(() => "");
  let json: any = {};
  if (text) { try { json = JSON.parse(text); } catch { json = {}; } }
  return { status: res.status, json, headers: res.headers };
}

/** What GitHub says when an organisation has not let this OAuth App in, or wants the person to sign in through its SSO. */
const ORG_BLOCKED = /saml|oauth app access restrictions|third-party application/i;
export const orgBlocked = () => new ConnectorError(
  "org_blocked",
  "This organisation hasn't let Tailzu in. An owner can approve Tailzu under the organisation's third-party access settings (or, if it uses SSO, you can authorise Tailzu's sign-in for it on GitHub), or you can install the Tailzu GitHub App on the organisation instead.",
);

/**
 * What GitHub says when a branch is protected or a repository rule stands in
 * the way: a protected ref, a required status check, a required review, "changes
 * must be made through a pull request", a rule violation. It comes as a 403, a
 * 405 (the merge) or a 422 (a ref update), depending on the call.
 */
const PROTECTED = /protected (?:branch|ref)|branch protection|rule violation|repository rule|required status check|status checks? (?:is|are) (?:expected|required)|approving review|review is required|reviews? required|must be made through a pull request|require[sd]? a pull request|GH00[6-9]|GH013/i;
/** What GitHub says when a token isn't allowed to change a workflow file. */
const WORKFLOW_REFUSED = /refusing to allow .{0,60}workflow|without `?workflows?`? (?:scope|permission)/i;

/** Everything GitHub said in a failed response, as one string to look in (never to repeat). */
function saidIn(json: any): string {
  const errs = Array.isArray(json?.errors) ? json.errors.map((e: any) => (typeof e === "string" ? e : String(e?.message ?? ""))) : [];
  return [String(json?.message ?? ""), ...errs].join(" ");
}

/** Whether a failed response is GitHub's branch protection (or a rule) saying no. */
export function isProtectionRefusal(status: number, json: any): boolean {
  return (status === 403 || status === 405 || status === 422) && PROTECTED.test(saidIn(json));
}

/** A failed GitHub response as a ConnectorError in plain words. GitHub's own text is not repeated. */
export function githubError(status: number, json: any, what: string): ConnectorError {
  const said = String(json?.message ?? "");
  if (status === 403 && ORG_BLOCKED.test(said)) return orgBlocked();
  if (WORKFLOW_REFUSED.test(saidIn(json))) {
    return new ConnectorError("needs_workflow_scope", `GitHub wouldn't let Tailzu change a workflow file in ${what}: this connection isn't allowed to. Sign in with GitHub again and allow it, or give the Tailzu GitHub App the Workflows permission.`);
  }
  if (isProtectionRefusal(status, json)) {
    return new ConnectorError("protected_branch", `GitHub's branch protection (or a rule on the repo) wouldn't allow that on ${what}. Tailzu doesn't try to get round it: make the change through a pull request, or change the rule on GitHub yourself.`);
  }
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
  if (!validBranchName(branch)) throw new ConnectorError("bad_branch", "That isn't a branch name I can use.");
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

const changedSinceApproval = () => new ConnectorError("changed_since_approval", "The branch changed after you looked at it. Nothing was done; look at it again.");

/**
 * Whether a pull request is one Tailzu may merge: it is from this branch, in
 * this repo (not a fork), going into the default branch; open, not merged, not
 * a draft, and not known to have conflicts. (Whether it may be merged at all is
 * the person's yes: policy.ts pr.merge.)
 */
export function assertMergeable(pull: PullInfo, repo: RepoRef, branch: string): void {
  if (!validBranchName(branch) || pull.headRef !== branch || pull.headRepoId !== repo.repoId || pull.baseRef !== repo.defaultBranch) {
    throw new ConnectorError("bad_branch", "That isn't a pull request from this branch into the default branch.");
  }
  if (pull.state === "merged") throw new ConnectorError("pr_merged", "That pull request is already merged.");
  if (pull.state === "closed") throw new ConnectorError("pr_not_open", "That pull request is closed.");
  if (pull.draft) throw new ConnectorError("pr_draft", "That pull request is still a draft. Take it out of draft first.");
  if (pull.mergeable === false) throw new ConnectorError("not_mergeable", "GitHub says this pull request has conflicts or can't be merged yet.");
}

/**
 * The files of a commit as the tree API takes them, checked: at least one, at
 * most 200, each path inside the repo and only once, each with text (1 MB at
 * most) or a deletion. Throws a ConnectorError (bad_request, bad_path,
 * too_large) before anything is asked of GitHub.
 */
export function commitTreeEntries(files: CommitFile[]): Array<Record<string, unknown>> {
  if (!Array.isArray(files) || !files.length) throw new ConnectorError("bad_request", "There is nothing to commit.");
  if (files.length > COMMIT_FILES_MAX) throw new ConnectorError("bad_request", `A commit can have at most ${COMMIT_FILES_MAX} files.`);
  const seen = new Set<string>();
  return files.map((f) => {
    const path = assertRepoPath(f?.path);
    if (seen.has(path)) throw new ConnectorError("bad_path", `${path} is in this commit twice.`);
    seen.add(path);
    if (f.delete === true || f.content === null) return { path, mode: "100644", type: "blob", sha: null };
    if (typeof f.content !== "string") throw new ConnectorError("bad_request", `${path} has no text to write.`);
    if (Buffer.byteLength(f.content, "utf8") > FILE_MAX_BYTES) throw new ConnectorError("too_large", `${path} is over 1 MB, which is more than I write.`);
    return { path, mode: "100644", type: "blob", content: f.content };
  });
}

export class GithubApp {
  private readonly key: KeyObject | null;
  private jwt: { token: string; until: number } | null = null;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly access = new Map<string, { permission: RepoPermission; until: number }>();
  private readonly minting = new Map<string, Promise<string>>();

  /** The App's own access: its installation tokens. The default for any call that names none. */
  private readonly appAccess: GitAccess = new AppAccess(
    (installationId, repoId, workflows, actions) => this.installationToken(installationId, repoId, workflows, actions),
    (installationId) => this.installationScopes(installationId),
  );
  /** Who the author of every commit is. */
  readonly bot: BotIdentity;

  /**
   * `c` is the GitHub App, or null for a server that offers only "Sign in with
   * GitHub": the calls that need the App then say "not_configured". Throws
   * ConnectorError("not_configured") when the App's key can't be read.
   */
  constructor(private readonly c: GithubAppConfig | null, private readonly o: { fetchFn?: typeof fetch; now?: () => number; bot?: BotIdentity } = {}) {
    this.key = c ? parsePrivateKey(c.privateKey) : null;
    this.bot = o.bot ?? { ...DEFAULT_BOT };
  }

  /** The App's settings, or "not_configured" when this server has none. */
  private app(): GithubAppConfig {
    if (!this.c) throw new ConnectorError("not_configured", "GitHub isn't set up on this server (the App isn't configured).");
    return this.c;
  }
  get hasApp(): boolean { return this.c !== null; }
  get slug(): string { return this.app().slug; }
  private now(): number { return (this.o.now ?? Date.now)(); }

  /** One request with a bearer token (githubFetch). */
  private send(method: string, url: string, bearer: string, body?: unknown, o: { manual?: boolean } = {}): Promise<Reply> {
    return githubFetch(this.o.fetchFn, method, url, `Bearer ${bearer}`, body, o);
  }

  /**
   * One request on a repo, with the token its access gives (the access says no
   * before any token is used, if it must). A 401 tells the access its token is
   * dead; a 403 from an organisation that hasn't let the sign-in in is
   * "org_blocked", in plain words, whatever the call.
   */
  private async rsend(repo: RepoRef, method: string, url: string, body?: unknown, o: { manual?: boolean } = {}): Promise<Reply> {
    const access = repo.access ?? this.appAccess;
    const r = await this.send(method, url, await access.token(repo), body, o);
    if (r.status === 401 && access.rejected) {
      await access.rejected();
      throw new ConnectorError("needs_signin", "GitHub no longer accepts your sign-in. Sign in with GitHub again.");
    }
    if (r.status === 403 && ORG_BLOCKED.test(String(r.json?.message ?? ""))) throw orgBlocked();
    return r;
  }

  // -------------------------------------------------------------- who we are

  /** The App JWT: RS256, issued a minute back for clock drift, good for nine minutes, reused for eight. */
  async appJwt(): Promise<string> {
    const now = this.now();
    if (this.jwt && this.jwt.until > now) return this.jwt.token;
    const secs = Math.floor(now / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.app().clientId || this.app().appId || "")
      .setIssuedAt(secs - 60).setExpirationTime(secs + 540)
      .sign(this.key!);
    this.jwt = { token, until: now + JWT_KEEP_MS };
    return token;
  }

  /**
   * A token for one install. With a repo id it is scoped to that one repo and
   * may write contents and pull requests; without, it can only read metadata
   * (to list the install's repos). `workflows` also asks for the Workflows
   * permission, for the one commit that changes a workflow file: GitHub turns
   * that down (422) if the install was not given it. Cached until five
   * minutes before it ends.
   */
  async installationToken(installationId: number, repoId?: number, workflows = false, actions?: "read" | "write"): Promise<string> {
    const key = `${installationId}|${repoId ?? "*"}${workflows && repoId !== undefined ? "|wf" : ""}${actions && repoId !== undefined ? `|a${actions}` : ""}`;
    const hit = this.tokens.get(key);
    if (hit && hit.expiresAt - TOKEN_SKEW_MS > this.now()) return hit.token;
    const running = this.minting.get(key);
    if (running) return running;
    const p = (async () => {
      const r = await this.send("POST", `${GITHUB_API}/app/installations/${installationId}/access_tokens`, await this.appJwt(),
        repoId === undefined
          ? { permissions: { metadata: "read" } }
          : {
            repository_ids: [repoId],
            permissions: { contents: "write", pull_requests: "write", metadata: "read", ...(workflows ? { workflows: "write" } : {}), ...(actions ? { actions } : {}) },
          });
      if (r.status < 200 || r.status >= 300 || typeof r.json?.token !== "string") throw githubError(r.status, r.json, "that installation");
      const expiresAt = Date.parse(String(r.json.expires_at));
      this.tokens.set(key, { token: r.json.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : this.now() + 55 * 60_000 });
      return r.json.token as string;
    })().finally(() => this.minting.delete(key));
    this.minting.set(key, p);
    return p;
  }

  /**
   * What the install was given on GitHub, as the plain words policy.ts looks
   * for: the names of the permissions it can write, with "workflow" when it has
   * Workflows: write. Asked with the App's own key; only the commit that
   * changes a workflow file needs it.
   */
  async installationScopes(installationId: number): Promise<string[]> {
    const perms = await this.installationPermissions(installationId);
    const out = Object.entries(perms).filter(([, level]) => level === "write" || level === "admin").map(([name]) => name);
    return out.includes("workflows") ? [...out.filter((n) => n !== "workflows"), "workflow"] : out;
  }

  /**
   * Everything the install was given on GitHub, as GitHub says it: permission
   * name to level ("read", "write", "admin"). The runner provider needs two
   * the scopes above don't show: Actions (to read a workflow run, or cancel
   * one) and Workflows (to commit its workflow file).
   */
  async installationPermissions(installationId: number): Promise<Record<string, string>> {
    const r = await this.send("GET", `${GITHUB_API}/app/installations/${installationId}`, await this.appJwt());
    if (r.status !== 200) throw githubError(r.status, r.json, "that installation");
    const perms: Record<string, unknown> = r.json?.permissions && typeof r.json.permissions === "object" ? r.json.permissions : {};
    return Object.fromEntries(Object.entries(perms).filter((e): e is [string, string] => typeof e[1] === "string"));
  }

  /** What the token a call on this repo would carry may do on GitHub (access.ts): has "workflow" when it may change workflow files. */
  scopesOf(repo: RepoRef): Promise<string[]> {
    return (repo.access ?? this.appAccess).scopes(repo);
  }

  // ---------------------------------------------------------- the person

  /** The code GitHub sent the person back with, traded for their token. Used once by the caller and dropped. */
  async exchangeUserCode(code: string): Promise<string> {
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "tailzu" },
        body: JSON.stringify({ client_id: this.app().clientId, client_secret: this.app().clientSecret, code }),
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
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/git/ref/heads/${encodePath(refName(branch))}`);
    if (r.status !== 200 || typeof r.json?.object?.sha !== "string") throw githubError(r.status, r.json, `the branch ${branch}`);
    return r.json.object.sha;
  }

  /**
   * The commit a ref names: a branch, a tag (an annotated one is followed to
   * its commit), or a full 40-character commit id. `refs/heads/x` and
   * `refs/tags/x` are taken as what they say; a bare name is a branch first,
   * then a tag. "not_found" when it is none of them.
   */
  async resolveRef(repo: RepoRef, ref: string): Promise<string> {
    if (!validBranchName(ref)) throw new ConnectorError("bad_branch", "That isn't a branch, tag or commit name I can use.");
    const base = this.path(repo);
    if (/^[0-9a-f]{40}$/i.test(ref)) {
      const c = await this.rsend(repo, "GET", `${base}/git/commits/${ref.toLowerCase()}`);
      if (c.status !== 200 || typeof c.json?.sha !== "string") throw githubError(c.status, c.json, `the commit ${ref.slice(0, 7)}`);
      return c.json.sha;
    }
    const explicit = /^refs\/(heads|tags)\/(.+)$/.exec(ref);
    const kinds = explicit ? [explicit[1]!] : ["heads", "tags"];
    const name = explicit ? explicit[2]! : ref;
    for (const kind of kinds) {
      const r = await this.rsend(repo, "GET", `${base}/git/ref/${kind}/${encodePath(name)}`);
      if (r.status === 404) continue;
      if (r.status !== 200 || typeof r.json?.object?.sha !== "string") throw githubError(r.status, r.json, `${ref}`);
      let obj = r.json.object as { sha: string; type?: string };
      // An annotated tag points at a tag object, which points at the commit.
      for (let hop = 0; obj.type === "tag" && hop < 3; hop += 1) {
        const t = await this.rsend(repo, "GET", `${base}/git/tags/${obj.sha}`);
        if (t.status !== 200 || typeof t.json?.object?.sha !== "string") throw githubError(t.status, t.json, `the tag ${name}`);
        obj = t.json.object;
      }
      return obj.sha;
    }
    throw new ConnectorError("not_found", `I couldn't find ${ref} on GitHub.`);
  }

  /**
   * A new branch, at the head of `from` (a branch, tag or commit; the default
   * branch when none is given). Returns the commit it starts at. Fails with
   * "branch_exists" if the name is taken.
   */
  async createBranch(repo: RepoRef, branch: string, from?: string): Promise<string> {
    refName(branch);
    let baseSha: string;
    try {
      baseSha = from === undefined ? await this.branchHead(repo, repo.defaultBranch) : await this.resolveRef(repo, from);
    } catch (err) {
      // A repo with no commits has nothing to start from (GitHub says 404 or 409).
      if (err instanceof ConnectorError && (err.code === "not_found" || err.code === "conflict") && await this.repoIsEmpty(repo).catch(() => false)) {
        throw new ConnectorError("repo_empty", "This repo is empty, so there is nothing to branch from. Add a first file to it first (start it with a README), then try again.");
      }
      throw err;
    }
    const r = await this.rsend(repo, "POST", `${this.path(repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha });
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
    const { entries, truncated } = await this.snapshotTree(repo, branch);
    return { entries, truncated };
  }

  /**
   * `tree`, with the two ids a fingerprint of the branch is made of: the commit
   * the branch is at and that commit's root tree. Every entry carries its own
   * sha (a file's blob, a folder's tree), so a folder whose sha is the same as
   * last time holds exactly what it held (the project brain's Merkle diff,
   * code/project/merkle.ts). Three calls: the branch, its commit, its tree.
   */
  async snapshotTree(repo: RepoRef, branch: string): Promise<{ headSha: string; treeSha: string; entries: TreeEntry[]; truncated: boolean }> {
    const base = this.path(repo);
    const head = await this.branchHead(repo, branch);
    const commit = await this.rsend(repo, "GET", `${base}/git/commits/${head}`);
    if (commit.status !== 200 || typeof commit.json?.tree?.sha !== "string") throw githubError(commit.status, commit.json, `the branch ${branch}`);
    const treeSha: string = commit.json.tree.sha;
    const r = await this.rsend(repo, "GET", `${base}/git/trees/${treeSha}?recursive=1`);
    if (r.status !== 200 || !Array.isArray(r.json?.tree)) throw githubError(r.status, r.json, `the branch ${branch}`);
    const entries: TreeEntry[] = (r.json.tree as any[])
      .filter((e) => e && typeof e.path === "string" && typeof e.type === "string" && typeof e.sha === "string")
      .map((e) => ({ path: e.path, type: e.type, ...(Number.isFinite(e.size) ? { size: Number(e.size) } : {}), sha: e.sha }));
    return { headSha: head, treeSha, entries, truncated: r.json.truncated === true };
  }

  /** One file's text on the branch. Refuses a folder, a file over 1 MB, and a file that isn't text. */
  async readFile(repo: RepoRef, branch: string, path: string): Promise<{ path: string; size: number; text: string }> {
    assertRepoPath(path);
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(refName(branch))}`);
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
   * One commit on a branch, any number of files in it. The branch moves only
   * forward: if someone else pushed in the meantime GitHub refuses and this
   * throws "branch_moved", so nothing is overwritten. The commit's author is
   * the bot, and its message ends with a Co-authored-by line for the person
   * when they are known (access.ts); the committer is whoever the token is.
   * `expectHead` is the commit the branch must be at: anywhere else, nothing is
   * written ("changed_since_approval").
   */
  async commit(repo: RepoRef, branch: string, files: CommitFile[], message: string, o: CommitOptions = {}): Promise<{ sha: string; parentSha: string }> {
    refName(branch);
    const tree = commitTreeEntries(files);
    const text = typeof message === "string" ? message.trim().slice(0, 5000) : "";
    if (!text) throw new ConnectorError("bad_request", "A commit needs a message.");
    const msg = withCoAuthor(text, o.person);

    const base = this.path(repo);
    const parentSha = await this.branchHead(repo, branch);
    if (o.expectHead !== undefined && o.expectHead !== parentSha) throw changedSinceApproval();
    const parent = await this.rsend(repo, "GET", `${base}/git/commits/${parentSha}`);
    if (parent.status !== 200 || typeof parent.json?.tree?.sha !== "string") throw githubError(parent.status, parent.json, "the branch");
    const made = await this.rsend(repo, "POST", `${base}/git/trees`, { base_tree: parent.json.tree.sha, tree });
    if (made.status !== 201 || typeof made.json?.sha !== "string") throw githubError(made.status, made.json, "those files");
    const commit = await this.rsend(repo, "POST", `${base}/git/commits`, {
      message: msg, tree: made.json.sha, parents: [parentSha], author: { name: this.bot.name, email: this.bot.email },
    });
    if (commit.status !== 201 || typeof commit.json?.sha !== "string") throw githubError(commit.status, commit.json, "the commit");
    try {
      await this.updateRef(repo, branch, commit.json.sha, { force: false });
    } catch (err) {
      // Not a fast-forward: the branch got a commit since we read it.
      if (err instanceof ConnectorError && err.code === "not_fast_forward") {
        throw new ConnectorError("branch_moved", "The branch changed while I was committing. Nothing was overwritten; read it again and retry.");
      }
      throw err;
    }
    return { sha: commit.json.sha, parentSha };
  }

  /**
   * Moves a branch to a commit. Without `force` that has to be a fast-forward
   * (the commit is built on the branch's head): if it isn't, nothing moves and
   * this says "not_fast_forward". `force: true` moves it anyway, which can
   * throw commits away: only a strict approval (policy.ts push.force) ever
   * gets it passed. A branch GitHub protects is "protected_branch", not
   * something to try again another way.
   */
  async updateRef(repo: RepoRef, branch: string, sha: string, o: { force?: boolean } = {}): Promise<void> {
    refName(branch);
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) throw new ConnectorError("bad_request", "That isn't a commit.");
    const force = o.force === true;
    const r = await this.rsend(repo, "PATCH", `${this.path(repo)}/git/refs/heads/${encodePath(branch)}`, { sha, force });
    if (r.status === 422 && !force && !isProtectionRefusal(r.status, r.json) && /fast.?forward/i.test(saidIn(r.json))) {
      throw new ConnectorError("not_fast_forward", "That isn't a fast-forward of the branch, so nothing moved.");
    }
    if (r.status !== 200) throw githubError(r.status, r.json, "the branch");
  }

  /** A draft pull request from a branch into the default branch. When one is open already, that one. */
  async openDraftPr(repo: RepoRef, branch: string, title: string, body: string): Promise<{ number: number; url: string; existing: boolean }> {
    refName(branch);
    if (branch === repo.defaultBranch) throw new ConnectorError("bad_branch", "A pull request has to come from a different branch than the one it goes into.");
    const t = typeof title === "string" ? title.trim().slice(0, 256) : "";
    if (!t) throw new ConnectorError("bad_request", "A pull request needs a title.");
    const text = typeof body === "string" ? body.slice(0, 60_000) : "";
    const base = this.path(repo);
    const r = await this.rsend(repo, "POST", `${base}/pulls`, { title: t, head: branch, base: repo.defaultBranch, body: text, draft: true });
    if (r.status === 201 && Number.isSafeInteger(r.json?.number) && typeof r.json?.html_url === "string") {
      return { number: r.json.number, url: r.json.html_url, existing: false };
    }
    if (r.status === 422 && /already exists/i.test(JSON.stringify(r.json ?? {}))) {
      const pr = await this.findOpenPull(repo, branch);
      if (pr) return { number: pr.number, url: pr.url, existing: true };
      throw githubError(422, {}, "the pull request");
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

  /** The open pull request whose head is this branch of this repo, or null. */
  async findOpenPull(repo: RepoRef, branch: string): Promise<{ number: number; url: string } | null> {
    refName(branch);
    const owner = repo.fullName.split("/")[0]!;
    const found = await this.rsend(repo, "GET", `${this.path(repo)}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`);
    if (found.status !== 200 || !Array.isArray(found.json)) throw githubError(found.status, found.json, "the pull request");
    const pr = found.json.find((p: any) => Number.isSafeInteger(p?.number) && typeof p?.html_url === "string");
    return pr ? { number: pr.number, url: pr.html_url } : null;
  }

  // ------------------------------------------------------- a repo's first commit

  /** True when the repo has no commits at all (GitHub answers its commit list with 409 "Git Repository is empty"). */
  async repoIsEmpty(repo: RepoRef): Promise<boolean> {
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/commits?per_page=1`);
    if (r.status === 409 && /empty/i.test(String(r.json?.message ?? ""))) return true;
    if (r.status === 200 && Array.isArray(r.json)) return r.json.length === 0;
    throw githubError(r.status, r.json, "the repo's history");
  }

  /**
   * A repo with no commits can't have a branch to work on, so this writes one
   * README.md, with the project's title, as its first commit (the contents API
   * creates the default branch). It is written by the bot, with the person
   * credited. The repo is checked for being empty FIRST, and refused with
   * "repo_not_empty" if it isn't: this can't overwrite or add to anything that
   * is there. (Whether to do it is the person's yes: policy.ts repo.init.)
   */
  async initEmptyRepo(repo: RepoRef, title: string, o: { person?: Person | null } = {}): Promise<{ sha: string }> {
    if (!(await this.repoIsEmpty(repo))) {
      throw new ConnectorError("repo_not_empty", "This repo already has commits, so Tailzu won't add a first file to its default branch.");
    }
    const heading = title.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 100) || repo.fullName.split("/")[1]!;
    const r = await this.rsend(repo, "PUT", `${this.path(repo)}/contents/README.md`, {
      message: withCoAuthor("Add README", o.person), content: Buffer.from(`# ${heading}\n`, "utf8").toString("base64"),
      author: { name: this.bot.name, email: this.bot.email },
    });
    // Someone made the first commit while we were looking: the same refusal.
    if (r.status === 422 || (r.status === 409 && !/empty/i.test(String(r.json?.message ?? "")))) {
      throw new ConnectorError("repo_not_empty", "This repo already has commits, so Tailzu won't add a first file to its default branch.");
    }
    if ((r.status !== 201 && r.status !== 200) || typeof r.json?.commit?.sha !== "string") throw githubError(r.status, r.json, "the first file");
    return { sha: r.json.commit.sha };
  }

  // --------------------------------------------------------- keeping current

  /**
   * Merges the default branch INTO the branch (never the other way). Not
   * resolved and not forced: a conflict is "conflict", and nothing changes.
   */
  async mergeDefaultInto(repo: RepoRef, branch: string): Promise<{ status: "merged" | "up_to_date"; sha?: string }> {
    refName(branch);
    if (branch === repo.defaultBranch) throw new ConnectorError("bad_branch", "The default branch is what the others are brought up to; there is nothing to bring it up to.");
    const r = await this.rsend(repo, "POST", `${this.path(repo)}/merges`, {
      base: branch, head: repo.defaultBranch, commit_message: `Merge ${repo.defaultBranch} into ${branch}`,
    });
    if (r.status === 201) return { status: "merged", ...(typeof r.json?.sha === "string" ? { sha: r.json.sha } : {}) };
    if (r.status === 204) return { status: "up_to_date" };
    if (r.status === 409) {
      throw new ConnectorError("conflict", `${repo.defaultBranch} has changes that clash with this branch's. Tailzu doesn't resolve conflicts: resolve it on GitHub, or start a new branch.`);
    }
    throw githubError(r.status, r.json, `the branch ${branch}`);
  }

  /** What the branch changes against the default branch: counts, names and one line per commit. Never contents. */
  async compare(repo: RepoRef, branch: string): Promise<BranchDiff> {
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/compare/${encodePath(refName(repo.defaultBranch))}...${encodePath(refName(branch))}`);
    if (r.status !== 200) throw githubError(r.status, r.json, `the branch ${branch}`);
    const j = r.json ?? {};
    const all: any[] = Array.isArray(j.files) ? j.files : [];
    const files = all.slice(0, DIFF_FILES_MAX).filter((f) => f && typeof f.filename === "string").map((f) => ({
      path: f.filename as string, status: String(f.status ?? "modified"),
      additions: Number.isFinite(f.additions) ? Number(f.additions) : 0, deletions: Number.isFinite(f.deletions) ? Number(f.deletions) : 0,
    }));
    const commits = (Array.isArray(j.commits) ? j.commits : []).filter((c: any) => c && typeof c.sha === "string").map((c: any) => ({
      sha: c.sha as string, message: String(c.commit?.message ?? "").split("\n")[0]!.slice(0, 200),
    }));
    return {
      aheadBy: Number(j.ahead_by) || 0, behindBy: Number(j.behind_by) || 0, commits, files,
      totals: { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) },
      // GitHub shows at most 300 files and doesn't say how many there are past that.
      truncated: all.length >= DIFF_FILES_MAX,
    };
  }

  // ------------------------------------------------------- pull requests

  /** One pull request, as GitHub has it now. */
  async getPull(repo: RepoRef, number: number): Promise<PullInfo> {
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/pulls/${number}`);
    const j = r.json;
    if (r.status !== 200 || !Number.isSafeInteger(j?.number) || typeof j?.head?.sha !== "string") throw githubError(r.status, j, "that pull request");
    return {
      number: j.number, url: String(j.html_url ?? ""), title: String(j.title ?? ""),
      state: j.merged === true ? "merged" : j.state === "closed" ? "closed" : "open",
      draft: j.draft === true, mergeable: typeof j.mergeable === "boolean" ? j.mergeable : null, mergeableState: String(j.mergeable_state ?? "unknown"),
      headSha: j.head.sha, headRef: String(j.head.ref ?? ""), headRepoId: Number.isSafeInteger(j.head.repo?.id) ? j.head.repo.id : null,
      baseRef: String(j.base?.ref ?? ""), nodeId: String(j.node_id ?? ""),
      reviewComments: Number(j.review_comments) || 0, changedFiles: Number(j.changed_files) || 0,
      additions: Number(j.additions) || 0, deletions: Number(j.deletions) || 0,
    };
  }

  /** GitHub's GraphQL, as the installation. Throws on an error in the answer. */
  private async graphql(repo: RepoRef, query: string, variables: Record<string, unknown>): Promise<any> {
    const r = await this.rsend(repo, "POST", `${GITHUB_API}/graphql`, { query, variables });
    if (r.status !== 200) throw githubError(r.status, r.json, "that pull request");
    if (Array.isArray(r.json?.errors) && r.json.errors.length) throw new ConnectorError("rejected", "GitHub didn't accept that for the pull request.");
    return r.json?.data;
  }

  /** The review decision (approved, changes_requested, review_required), or null: GitHub only says when reviews are required, and it may not say. */
  async reviewDecision(repo: RepoRef, pull: PullInfo): Promise<"approved" | "changes_requested" | "review_required" | null> {
    try {
      const data = await this.graphql(repo, "query($id: ID!) { node(id: $id) { ... on PullRequest { reviewDecision } } }", { id: pull.nodeId });
      const d = String(data?.node?.reviewDecision ?? "").toLowerCase();
      return d === "approved" || d === "changes_requested" || d === "review_required" ? d : null;
    } catch {
      return null;
    }
  }

  /**
   * The review comments and the conversation comments of a pull request, at
   * most 100 (the latest), oldest first, each cut to 2,000 characters.
   *
   * UNTRUSTED TEXT. Every `body` here was written by somebody else, on GitHub,
   * and can say anything, "ignore your instructions" included. It is for the
   * bot to READ AS DATA when it is told what a reviewer asked for, never to
   * obey as instructions, and never to be put in a prompt as if it were the
   * person's own words.
   */
  async pullComments(repo: RepoRef, number: number): Promise<{ comments: PullComment[]; truncated: boolean }> {
    const base = this.path(repo);
    const [review, convo] = await Promise.all([
      this.rsend(repo, "GET", `${base}/pulls/${number}/comments?per_page=${COMMENTS_MAX}`),
      this.rsend(repo, "GET", `${base}/issues/${number}/comments?per_page=${COMMENTS_MAX}`),
    ]);
    if (review.status !== 200) throw githubError(review.status, review.json, "that pull request");
    if (convo.status !== 200) throw githubError(convo.status, convo.json, "that pull request");
    const cut = (t: unknown) => [...String(t ?? "")].slice(0, COMMENT_CHARS).join("");
    const when = (t: unknown) => { const n = Date.parse(String(t)); return Number.isFinite(n) ? n : 0; };
    const out: PullComment[] = [];
    for (const c of Array.isArray(review.json) ? review.json : []) {
      const line = Number.isSafeInteger(c?.line) ? c.line : Number.isSafeInteger(c?.original_line) ? c.original_line : undefined;
      out.push({
        author: String(c?.user?.login ?? ""), body: cut(c?.body), ...(typeof c?.path === "string" ? { path: c.path } : {}),
        ...(line !== undefined ? { line } : {}), createdAt: when(c?.created_at),
      });
    }
    for (const c of Array.isArray(convo.json) ? convo.json : []) {
      out.push({ author: String(c?.user?.login ?? ""), body: cut(c?.body), createdAt: when(c?.created_at) });
    }
    out.sort((a, b) => a.createdAt - b.createdAt);
    return { comments: out.slice(-COMMENTS_MAX), truncated: out.length > COMMENTS_MAX };
  }

  /** Takes a pull request out of draft. REST can't (the pulls endpoint has no `draft` to change), so this is GraphQL's markPullRequestReadyForReview. */
  async markReady(repo: RepoRef, pull: PullInfo): Promise<void> {
    const data = await this.graphql(
      repo, "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }", { id: pull.nodeId },
    );
    if (data?.markPullRequestReadyForReview?.pullRequest?.isDraft !== false) {
      throw new ConnectorError("rejected", "GitHub didn't take the pull request out of draft.");
    }
  }

  /** Closes a pull request without merging it. */
  async closePull(repo: RepoRef, number: number): Promise<void> {
    const r = await this.rsend(repo, "PATCH", `${this.path(repo)}/pulls/${number}`, { state: "closed" });
    if (r.status !== 200) throw githubError(r.status, r.json, "that pull request");
  }

  /**
   * Squash-merges a branch's pull request. Only after a person approved this
   * head commit (policy.ts pr.merge, approvals.ts), and only if it is still the
   * head: the merge is given the sha, and GitHub refuses if the branch moved,
   * as does this ("changed_since_approval"). The pull request must be from this
   * branch, in this repo, into the default branch, open and not a draft. If
   * GitHub holds the merge back for a required check or review, that is
   * "protected_branch" (the squash commit is authored by the token's identity:
   * GitHub gives no way to say otherwise).
   */
  async mergePull(repo: RepoRef, branch: string, number: number, sha: string): Promise<{ sha: string }> {
    refName(branch);
    const pull = await this.getPull(repo, number);
    assertMergeable(pull, repo, branch);
    if (pull.headSha !== sha) throw changedSinceApproval();
    const r = await this.rsend(repo, "PUT", `${this.path(repo)}/pulls/${number}/merge`, { merge_method: "squash", sha });
    if (r.status === 409) throw changedSinceApproval();
    if (r.status === 405 && !isProtectionRefusal(r.status, r.json)) {
      throw new ConnectorError("not_mergeable", "GitHub says this pull request can't be merged right now.");
    }
    if (r.status !== 200 || r.json?.merged !== true) throw githubError(r.status, r.json, "that pull request");
    return { sha: String(r.json.sha ?? "") };
  }

  /** Deletes a branch from GitHub. Already gone is fine. Returns whether it was there. (Whether to is policy.ts: branch.delete, and branch.delete_default for the default branch.) */
  async deleteBranch(repo: RepoRef, branch: string): Promise<boolean> {
    refName(branch);
    const r = await this.rsend(repo, "DELETE", `${this.path(repo)}/git/refs/heads/${encodePath(branch)}`);
    if (r.status === 204) return true;
    // A protected branch is GitHub saying no, not a branch that is already gone.
    if (!isProtectionRefusal(r.status, r.json) && (r.status === 404 || r.status === 422)) return false;
    throw githubError(r.status, r.json, `the branch ${branch}`);
  }

  // ------------------------------------------- the runner's branch, and GitHub Actions

  /**
   * The runner's throwaway branch (code/jobs/githubActions.ts): a NEW ref
   * `tailzu-run/...` at ONE new commit made on top of `parentSha`, holding
   * `files` on top of the parent's tree. Nothing else is touched: no existing
   * ref is moved, so the work branch the parent came from stays exactly as it
   * was. The commit's author is the bot, and its committer whoever the token
   * is. Refuses a name outside `tailzu-run/` (it is never right to use this
   * for anything else), and a name that is taken ("branch_exists"). The
   * policy has already said yes (policy.ts runner.shadow); the repo should be
   * `{ ...repo, workflows: true }`, since the files include a workflow.
   */
  async createShadowBranch(
    repo: RepoRef, branch: string, parentSha: string, files: Array<{ path: string; content: string }>, message: string,
  ): Promise<{ sha: string }> {
    refName(branch);
    if (!branch.startsWith(SHADOW_PREFIX)) throw new ConnectorError("bad_branch", "That isn't a branch name the runner uses.");
    if (!/^[0-9a-f]{40}$/.test(parentSha)) throw new ConnectorError("bad_request", "That isn't a commit.");
    const tree = commitTreeEntries(files);
    const base = this.path(repo);
    const parent = await this.rsend(repo, "GET", `${base}/git/commits/${parentSha}`);
    if (parent.status !== 200 || typeof parent.json?.tree?.sha !== "string") throw githubError(parent.status, parent.json, "the commit to run on");
    const made = await this.rsend(repo, "POST", `${base}/git/trees`, { base_tree: parent.json.tree.sha, tree });
    if (made.status !== 201 || typeof made.json?.sha !== "string") throw githubError(made.status, made.json, "those files");
    const commit = await this.rsend(repo, "POST", `${base}/git/commits`, {
      message, tree: made.json.sha, parents: [parentSha], author: { name: this.bot.name, email: this.bot.email },
    });
    if (commit.status !== 201 || typeof commit.json?.sha !== "string") throw githubError(commit.status, commit.json, "the commit");
    const ref = await this.rsend(repo, "POST", `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.json.sha });
    if (ref.status === 422 && /already exists/i.test(String(ref.json?.message ?? ""))) {
      throw new ConnectorError("branch_exists", "That branch name is taken.");
    }
    if (ref.status !== 201) throw githubError(ref.status, ref.json, "the new branch");
    return { sha: commit.json.sha };
  }

  /** The files and folders directly in a folder of the repo at a ref (the contents API); an empty list when there is no such folder. */
  async listDir(repo: RepoRef, dir: string, ref: string): Promise<Array<{ name: string; path: string; type: string }>> {
    assertRepoPath(dir);
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/contents/${encodePath(dir)}?ref=${encodeURIComponent(refName(ref))}`);
    if (r.status === 404) return [];
    if (r.status !== 200) throw githubError(r.status, r.json, dir);
    if (!Array.isArray(r.json)) return [];
    return r.json
      .filter((e: any) => e && typeof e.name === "string" && typeof e.path === "string")
      .map((e: any) => ({ name: e.name as string, path: e.path as string, type: String(e.type ?? "file") }));
  }

  /**
   * The newest workflow run on a branch, or null when there is none:
   * `GET /repos/{o}/{r}/actions/runs?branch=<branch>&per_page=1`. Needs Actions:
   * read on the token (the App) or the repo scope (a person's).
   */
  async latestRun(repo: RepoRef, branch: string): Promise<GithubRun | null> {
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/actions/runs?branch=${encodeURIComponent(refName(branch))}&per_page=1`);
    if (r.status !== 200) throw githubError(r.status, r.json, "the workflow runs");
    const row = Array.isArray(r.json?.workflow_runs) ? r.json.workflow_runs[0] : undefined;
    if (!row || !Number.isSafeInteger(row.id)) return null;
    const created = Date.parse(String(row.created_at));
    return {
      id: row.id, status: String(row.status ?? ""), conclusion: typeof row.conclusion === "string" ? row.conclusion : null,
      headSha: String(row.head_sha ?? ""), event: String(row.event ?? ""), createdAt: Number.isFinite(created) ? created : 0,
    };
  }

  /** Cancels a workflow run. Needs Actions: write (the App) or the repo scope (a person's). A run that is over already is fine. */
  async cancelRun(repo: RepoRef, runId: number): Promise<void> {
    if (!Number.isSafeInteger(runId) || runId <= 0) throw new ConnectorError("bad_request", "That isn't a run.");
    const r = await this.rsend(repo, "POST", `${this.path(repo)}/actions/runs/${runId}/cancel`);
    if (r.status === 202 || r.status === 409) return;
    throw githubError(r.status, r.json, "the workflow run");
  }

  // ------------------------------------------- the person's own sign-in token

  /**
   * Who the token's owner is, and the scopes GitHub says the token has (its
   * X-OAuth-Scopes header: "repo, read:user"). For the sign-in callback, to
   * check the token is no broader than what was asked.
   */
  async oauthProfile(token: string): Promise<{ id: number; login: string; scopes: string[] }> {
    const r = await this.send("GET", `${GITHUB_API}/user`, token);
    if (r.status !== 200) throw githubError(r.status, r.json, "your GitHub account");
    if (!Number.isSafeInteger(r.json?.id) || typeof r.json?.login !== "string" || !r.json.login) {
      throw new ConnectorError("failed", "GitHub ran into a problem. Try again in a moment.");
    }
    const scopes = String(r.headers.get("x-oauth-scopes") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    return { id: r.json.id, login: r.json.login, scopes };
  }

  /**
   * The repos a sign-in token can PUSH to, archived ones left out, at most
   * REPOS_MAX (`truncated` when there are more). Only a repo whose
   * permissions.push is true is listed: a repo the person can merely read is
   * not one Tailzu can work in.
   */
  async listUserRepos(token: string, onRejected?: () => Promise<void>): Promise<{ repos: GithubRepo[]; truncated: boolean }> {
    const repos: GithubRepo[] = [];
    let truncated = false;
    for (let page = 1; page <= USER_REPOS_PAGES_MAX; page += 1) {
      const r = await this.send("GET", `${GITHUB_API}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100${page > 1 ? `&page=${page}` : ""}`, token);
      if (r.status === 401 && onRejected) {
        await onRejected();
        throw new ConnectorError("needs_signin", "GitHub no longer accepts your sign-in. Sign in with GitHub again.");
      }
      if (r.status !== 200 || !Array.isArray(r.json)) throw githubError(r.status, r.json, "your repos");
      for (const row of r.json) {
        const repo = asRepo(row);
        if (repo && !repo.archived && row.permissions?.push === true) repos.push(repo);
      }
      if (r.json.length < 100) break;
      if (repos.length >= REPOS_MAX || page === USER_REPOS_PAGES_MAX) { truncated = true; break; }
    }
    if (repos.length > REPOS_MAX) { repos.length = REPOS_MAX; truncated = true; }
    return { repos, truncated };
  }

  /**
   * Whether the token's owner can push to the repo, as the repo itself says it
   * (GET /repos/{o}/{r}, permissions.push). "no" for a repo that isn't there
   * for them; "unknown" for a GitHub having a bad minute. A dead sign-in or a
   * blocked organisation says so instead (they throw).
   */
  async canPushTo(repo: RepoRef): Promise<"yes" | "no" | "unknown"> {
    const r = await this.rsend(repo, "GET", this.path(repo));
    if (r.status === 200) return r.json?.permissions?.push === true ? "yes" : "no";
    return r.status === 404 ? "no" : "unknown";
  }

  /**
   * A short-lived download address for the repo's code at a commit: GitHub
   * answers the tarball request with a redirect to a signed link, and that
   * link is what is returned. The redirect is NOT followed here: following it
   * would be a request this server makes for the runner, and the token would
   * have been in the one before it. Whoever has the link needs no token.
   */
  async tarballUrl(repo: RepoRef, sha: string): Promise<string> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new ConnectorError("bad_request", "That isn't a commit.");
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/tarball/${sha}`, undefined, { manual: true });
    const where = r.headers.get("location");
    if (r.status !== 302 || !where || !/^https:\/\//.test(where)) throw githubError(r.status === 302 ? 502 : r.status, r.json, "the code");
    return where;
  }

  // --------------------------------------------- reading a repo, for the project brain

  /**
   * One file's bytes by its blob sha (`GET /git/blobs/{sha}`). Bytes, not text:
   * what counts as a binary file is the caller's to decide.
   */
  async blobBytes(repo: RepoRef, sha: string): Promise<Buffer> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new ConnectorError("bad_request", "That isn't a file id.");
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/git/blobs/${sha}`);
    if (r.status !== 200 || typeof r.json?.content !== "string" || r.json.encoding !== "base64") throw githubError(r.status, r.json, "that file");
    return Buffer.from(r.json.content, "base64");
  }

  /**
   * The whole repo at a commit as ONE gzipped tarball, for the caller to
   * stream (the response is not read here). GitHub answers the tarball request
   * with a redirect to a signed link on codeload; the redirect is followed by
   * hand so the token goes only to api.github.com and never to codeload (the
   * link needs none). `timeoutMs` is the whole download, five minutes unless
   * told otherwise. A refusal at codeload is a ConnectorError like any other.
   */
  async downloadTarball(repo: RepoRef, sha: string, o: { timeoutMs?: number } = {}): Promise<Response> {
    const where = await this.tarballUrl(repo, sha);
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(where, { method: "GET", headers: { "User-Agent": "tailzu", Accept: "application/x-gzip" }, signal: AbortSignal.timeout(o.timeoutMs ?? 300_000) });
    } catch {
      throw new ConnectorError("failed", "GitHub didn't answer. Try again in a moment.");
    }
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw githubError(res.status === 200 ? 502 : res.status, {}, "the code");
    }
    return res;
  }

  /** The newest commits on a branch, newest first: sha, first line of the message, when. `perPage` is GitHub's, 100 at most. */
  async recentCommits(repo: RepoRef, branch: string, perPage = 100): Promise<Array<{ sha: string; message: string; at: number }>> {
    const n = Math.min(Math.max(Math.trunc(perPage) || 1, 1), 100);
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/commits?sha=${encodeURIComponent(refName(branch))}&per_page=${n}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw githubError(r.status, r.json, "the branch's history");
    return r.json
      .filter((c: any) => c && typeof c.sha === "string")
      .map((c: any) => {
        const at = Date.parse(String(c.commit?.author?.date ?? c.commit?.committer?.date ?? ""));
        return { sha: c.sha as string, message: String(c.commit?.message ?? "").split("\n")[0]!.slice(0, 200), at: Number.isFinite(at) ? at : 0 };
      });
  }

  /**
   * The files one commit touched (names only, 300 at most: GitHub's own limit),
   * and how many requests GitHub says are left in this token's hour
   * (X-RateLimit-Remaining), or null when it doesn't say.
   */
  async commitFiles(repo: RepoRef, sha: string): Promise<{ files: string[]; truncated: boolean; rateRemaining: number | null }> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new ConnectorError("bad_request", "That isn't a commit.");
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/commits/${sha}`);
    if (r.status !== 200) throw githubError(r.status, r.json, "that commit");
    const left = Number(r.headers.get("x-ratelimit-remaining"));
    const all: any[] = Array.isArray(r.json?.files) ? r.json.files : [];
    return {
      files: all.filter((f) => f && typeof f.filename === "string").map((f) => f.filename as string),
      truncated: all.length >= DIFF_FILES_MAX,
      rateRemaining: r.headers.get("x-ratelimit-remaining") !== null && Number.isFinite(left) ? left : null,
    };
  }

  /** The names of the repo's branches, `perPage` of them at most (100): the first page is enough to see how they are named. */
  async branchNames(repo: RepoRef, perPage = 100): Promise<string[]> {
    const n = Math.min(Math.max(Math.trunc(perPage) || 1, 1), 100);
    const r = await this.rsend(repo, "GET", `${this.path(repo)}/branches?per_page=${n}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw githubError(r.status, r.json, "the repo's branches");
    return r.json.filter((b: any) => typeof b?.name === "string").map((b: any) => b.name as string);
  }

  // ------------------------------------------------------- for runners, later

  /**
   * A token for something that runs code on a work branch (a sandbox cloning
   * it): for this ONE repo, with contents:read to look or contents:write to
   * push, and nothing else (no pull requests, no metadata beyond what every
   * token has). It is made for the caller and given to the caller: never
   * kept here, not even in the cache the other calls use, and never logged.
   * GitHub can't narrow a token to a branch, so the rule that a runner pushes
   * only its work branch is the runner's to keep, with branch protection behind it.
   */
  async runnerToken(repo: RepoRef, mode: "read" | "push"): Promise<{ token: string; expiresAt: number }> {
    const r = await this.send("POST", `${GITHUB_API}/app/installations/${repo.installationId}/access_tokens`, await this.appJwt(), {
      repository_ids: [repo.repoId], permissions: { contents: mode === "read" ? "read" : "write" },
    });
    if (r.status < 200 || r.status >= 300 || typeof r.json?.token !== "string") throw githubError(r.status, r.json, "that installation");
    const expiresAt = Date.parse(String(r.json.expires_at));
    return { token: r.json.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : this.now() + 55 * 60_000 };
  }
}
