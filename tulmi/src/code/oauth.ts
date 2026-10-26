/**
 * "SIGN IN WITH GITHUB": THE SECOND WAY TO CONNECT, WITH NO APP INSTALL.
 *
 * The first way (link.ts) is a GitHub App the person installs on chosen repos:
 * its tokens are an hour long and cannot reach anything not installed. This
 * way is a classic GitHub OAuth App. The person signs in once and Tailzu holds
 * THEIR token, which reaches every repo they can: that is far broader than an
 * install, and GitHub offers no way to narrow it to chosen repos. So Tailzu
 * narrows it itself, and everything here exists to make that true:
 *
 *   - it asks for `repo read:user` and nothing more ("workflow" only through
 *     the separate incremental sign-in, which a person starts when they want
 *     the bot to change workflow files). The token GitHub returns is checked:
 *     any scope beyond what was asked and it is revoked on the spot and
 *     nothing is connected;
 *   - the token is stored ENCRYPTED (AES-256-GCM under CONNECTOR_TOKEN_KEY,
 *     connectors/crypto.ts), never logged, never in a reply, and never handed
 *     to the model, a sandbox or a runner (projects.ts runnerAccess gives a
 *     runner a one-time download link instead);
 *   - ALLOW-LIST: the token touches only repos the person added as projects.
 *     tokenFor checks that, from the store, before every use. Listing the
 *     repos to choose from is the one call that is not on a project;
 *   - before every write, projects.ts re-checks that the person still has push
 *     access to the repo (canPush; GitHub's own answer, not kept for writes);
 *   - every commit made with the token is authored by the bot (Blip, by
 *     default) with the person credited in a Co-authored-by trailer
 *     (access.ts), so it shows which were Tailzu's;
 *   - when an App install reaches the same repo, the App is used instead;
 *   - the token is revoked at GitHub (DELETE /applications/{client_id}/token)
 *     when the person disconnects, when their account is deleted, and when it
 *     has been unused for 30 days; a token GitHub says is dead (401) is
 *     dropped and the link marked `needs_signin`;
 *   - CODE_GITHUB_OAUTH is the kill switch: off, no stored token is ever used
 *     (revoking, which only destroys, still works), and revokeAll() ends every
 *     token at once (scripts/revoke-github-oauth.ts).
 *
 * PKCE (S256) goes on the authorize request and the code exchange. GitHub has
 * announced PKCE for OAuth Apps; if a GitHub does not enforce it, the extra
 * parameters are ignored and the signed `state` is what protects the flow, as
 * for the connected apps. The verifier is kept in this server's memory for the
 * ten minutes the state lasts, never in the database or in the address.
 *
 * Nothing here is reached when the person has no link, and the callback has no
 * session: the signed state says whose sign-in it is (connectors/oauth.ts).
 */
import { createHash, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "../connectors/crypto.js";
import { ConnectorError, signState, verifyState } from "../connectors/oauth.js";
import { OAuthAccess, type OAuthTokens } from "./access.js";
import { GITHUB_API, GITHUB_TOKEN_URL, githubFetch, type GithubApp, type GithubRepo, type RepoRef } from "./github.js";
import type { CodeOAuthLink, CodeStore } from "./store.js";

export const OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
/** What goes where a connected app's id goes in the signed state: the plain sign-in, and the one that also asks for `workflow`. */
export const OAUTH_STATE_ID = "code-github-oauth";
export const OAUTH_STATE_ID_WORKFLOW = "code-github-oauth-workflow";
/** Everything Tailzu ever asks for, by default. */
export const OAUTH_SCOPES: readonly string[] = ["repo", "read:user"];
/** Asked for only by the incremental sign-in, for changing `.github/workflows/*` (policy.ts: workflow.write asks first, and needs this). */
export const OAUTH_SCOPES_WORKFLOW: readonly string[] = [...OAUTH_SCOPES, "workflow"];
/** What a scope on that list brings with it: GitHub may name these instead of, or as well as, the parent. */
const IMPLIED: Record<string, readonly string[]> = {
  repo: ["repo:status", "repo_deployment", "public_repo", "repo:invite", "security_events"],
};
/** A token unused this long is revoked. */
export const IDLE_REVOKE_MS = 30 * 24 * 60 * 60_000;
/** The last-used time is written at most this often per person. */
const TOUCH_EVERY_MS = 60 * 60_000;
/** A sign-in not finished in this time is forgotten (the state lasts as long). */
const PENDING_MS = 10 * 60_000;
/** How long GitHub's answer about push access is kept, for a read. */
const PUSH_KEEP_MS = 10 * 60_000;
/** How often the expiry sweep runs, and how many links one pass revokes. */
export const SWEEP_EVERY_MS = 6 * 60 * 60_000;
const SWEEP_BATCH = 100;

export interface GithubOAuthConfig { clientId: string; clientSecret: string }

export interface OAuthOptions {
  config: GithubOAuthConfig;
  store: CodeStore;
  /** The GitHub client the calls go through. */
  github: GithubApp;
  /** CODE_GITHUB_OAUTH. False: no stored token is used. */
  enabled: boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** The scopes a sign-in may come back with: what it asked for, and what those bring with them. */
function allowedScopes(asked: readonly string[]): Set<string> {
  return new Set(asked.flatMap((s) => [s, ...(IMPLIED[s] ?? [])]));
}

const scopeList = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export class GithubOAuth implements OAuthTokens {
  private readonly pending = new Map<string, { verifier: string; userId: string; expiresAt: number }>();
  private readonly touched = new Map<string, number>();
  private readonly pushes = new Map<string, { yes: boolean; until: number }>();

  constructor(private readonly o: OAuthOptions) {}

  /** CODE_GITHUB_OAUTH. */
  get enabled(): boolean { return this.o.enabled; }
  private now(): number { return (this.o.now ?? Date.now)(); }

  /** The access the git calls carry for this person's projects. */
  access(userId: string): OAuthAccess { return new OAuthAccess(this, userId); }

  // ------------------------------------------------------------- signing in

  /** Step one: the GitHub page to sign in at. `workflow` is the incremental sign-in that also asks for the `workflow` scope. */
  async begin(userId: string, o: { workflow?: boolean } = {}, now = this.now()): Promise<{ authorizeUrl: string }> {
    if (!this.o.enabled) throw offError();
    const state = await signState(userId, o.workflow ? OAUTH_STATE_ID_WORKFLOW : OAUTH_STATE_ID, now);
    const verifier = randomBytes(32).toString("base64url");
    for (const [k, v] of this.pending) if (v.expiresAt <= now) this.pending.delete(k);
    this.pending.set(hash(state), { verifier, userId, expiresAt: now + PENDING_MS });
    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.o.config.clientId, scope: (o.workflow ? OAUTH_SCOPES_WORKFLOW : OAUTH_SCOPES).join(" "), state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    }).toString();
    return { authorizeUrl: url.toString() };
  }

  /** The incremental sign-in that adds `workflow`, for later: the same, asking for one scope more. */
  beginWorkflow(userId: string, now = this.now()): Promise<{ authorizeUrl: string }> { return this.begin(userId, { workflow: true }, now); }

  /**
   * Step two: GitHub sent the person back with a code. The code is traded for
   * a token, the token is checked to be no broader than what was asked
   * (revoked and refused if it is), and it is stored encrypted. Returns who.
   */
  async complete(code: string, stateToken: string, now = this.now()): Promise<{ userId: string; login: string }> {
    if (!this.o.enabled) throw offError();
    const st = await verifyState(stateToken, now);
    if (st.connectorId !== OAUTH_STATE_ID && st.connectorId !== OAUTH_STATE_ID_WORKFLOW) {
      throw new ConnectorError("bad_state", "That sign-in link has expired or isn't valid. Start again from Tailzu.");
    }
    const key = hash(stateToken);
    const pend = this.pending.get(key);
    // Single use, whatever happens next.
    this.pending.delete(key);
    if (!pend || pend.userId !== st.userId || pend.expiresAt <= now) {
      throw new ConnectorError("bad_state", "That sign-in was already used or never started. Start again from Tailzu.");
    }
    const token = await this.exchange(code, pend.verifier);
    try {
      const me = await this.o.github.oauthProfile(token.accessToken);
      // GitHub can hand back what an earlier sign-in granted on top of what this one asked. Our own
      // `workflow` (from the incremental sign-in) and `user:email` are tolerated so a person is never
      // locked out by them; anything else (delete_repo, admin:*, gist, user, ...) is still refused.
      const asked = allowedScopes([...OAUTH_SCOPES_WORKFLOW, "user:email"]);
      const given = [...new Set([...me.scopes, ...scopeList(token.scope)])];
      if (given.some((s) => !asked.has(s))) {
        await this.revokeToken(token.accessToken);
        throw new ConnectorError("scope_too_broad", "GitHub gave Tailzu more access than it asked for, so I revoked it and connected nothing. Remove Tailzu's authorisation in your GitHub settings and sign in again.");
      }
      if (!given.includes("repo")) {
        await this.revokeToken(token.accessToken);
        throw new ConnectorError("scope_missing", "GitHub didn't give Tailzu access to your repos, so I connected nothing. Try signing in again.");
      }
      const before = await this.o.store.getOAuthLink(st.userId);
      await this.o.store.saveOAuthLink(st.userId, {
        githubUserId: me.id, githubLogin: me.login, tokenEnc: encrypt(token.accessToken), scope: me.scopes.join(", "),
      });
      // The token this one replaces is no longer wanted.
      if (before?.tokenEnc) await this.revokeStored(before.tokenEnc);
      this.touched.delete(st.userId);
      return { userId: st.userId, login: me.login };
    } catch (err) {
      // Nothing stored, so nothing may be left alive at GitHub either.
      if (!(err instanceof ConnectorError && (err.code === "scope_too_broad" || err.code === "scope_missing"))) await this.revokeToken(token.accessToken);
      throw err;
    }
  }

  /** The code traded for a token (with the PKCE verifier). GitHub answers 200 with { error } for a code that is wrong or used up. */
  private async exchange(code: string, verifier: string): Promise<{ accessToken: string; scope: string }> {
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "tailzu" },
        body: JSON.stringify({ client_id: this.o.config.clientId, client_secret: this.o.config.clientSecret, code, code_verifier: verifier }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ConnectorError("failed", "GitHub didn't answer. Try again in a moment.");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json.access_token !== "string" || !json.access_token) {
      throw new ConnectorError("bad_state", "GitHub didn't accept that sign-in. Start again from Tailzu.");
    }
    return { accessToken: json.access_token, scope: typeof json.scope === "string" ? json.scope : "" };
  }

  // ---------------------------------------------------------- using the token

  /**
   * The person's token for a call on a repo, after Tailzu's own limits: the
   * switch is on, the link is alive, and THE REPO IS ONE THEY ADDED AS A
   * PROJECT through this sign-in. The token is decrypted here and goes to the
   * caller, who puts it in one request header.
   */
  async tokenFor(userId: string, repo: { repoId: number }): Promise<string> {
    const link = await this.liveLink(userId);
    const project = await this.o.store.findProjectByRepo(userId, repo.repoId);
    if (!project || project.linkKind !== "oauth") {
      throw new ConnectorError("not_allowed", "Tailzu only works in repos you added as projects. That one isn't.");
    }
    return this.open(userId, link);
  }

  /** The token for listing the repos to choose from, the one use that is not on a project. */
  private async listToken(userId: string): Promise<string> {
    return this.open(userId, await this.liveLink(userId));
  }

  private async liveLink(userId: string): Promise<CodeOAuthLink> {
    if (!this.o.enabled) throw offError();
    const link = await this.o.store.getOAuthLink(userId);
    if (!link || !link.tokenEnc || link.status !== "active") throw signinError();
    return link;
  }

  private async open(userId: string, link: CodeOAuthLink): Promise<string> {
    let token: string;
    try { token = decrypt(link.tokenEnc!); } catch { throw signinError(); }
    const now = this.now();
    if (now - (this.touched.get(userId) ?? 0) >= TOUCH_EVERY_MS) {
      this.touched.set(userId, now);
      await this.o.store.touchOAuthLink(userId, now);
    }
    return token;
  }

  /** GitHub said 401: the token is dead. It is dropped and the person has to sign in again. */
  async markRejected(userId: string): Promise<void> {
    await this.o.store.setOAuthStatus(userId, "needs_signin", { dropToken: true });
    this.touched.delete(userId);
  }

  /** Whether the person's token has a scope. */
  async hasScope(userId: string, scope: string): Promise<boolean> {
    return (await this.scopesOf(userId)).includes(scope);
  }

  /** The scopes the person's token has, as GitHub said them when they signed in (none for a link that is not alive). */
  async scopesOf(userId: string): Promise<string[]> {
    const link = await this.o.store.getOAuthLink(userId);
    return link && link.status === "active" ? scopeList(link.scope) : [];
  }

  /** Where the person's sign-in stands: "off" (the switch), "none", "needs_signin", or "active". */
  async state(userId: string): Promise<"off" | "none" | "needs_signin" | "active"> {
    if (!this.o.enabled) return "off";
    const link = await this.o.store.getOAuthLink(userId);
    return !link ? "none" : link.status === "active" && link.tokenEnc ? "active" : "needs_signin";
  }

  /** The repos the person can push to (archived left out; at most 300). */
  async listRepos(userId: string): Promise<{ repos: GithubRepo[]; truncated: boolean }> {
    return this.o.github.listUserRepos(await this.listToken(userId), () => this.markRejected(userId));
  }

  /**
   * Whether the person can still push to the repo, from the repo itself. A
   * write passes `fresh`, and GitHub is asked again; a read goes by what was
   * kept ten minutes. A failure that says nothing is "no", and is not kept.
   */
  async canPush(userId: string, repo: RepoRef, fresh = false): Promise<boolean> {
    const key = `${userId}|${repo.repoId}`;
    const hit = this.pushes.get(key);
    if (!fresh && hit && hit.until > this.now()) return hit.yes;
    const said = await this.o.github.canPushTo({ ...repo, access: this.access(userId) });
    if (said === "unknown") { this.pushes.delete(key); return false; }
    if (this.pushes.size > 10_000) for (const [k, v] of this.pushes) if (v.until <= this.now()) this.pushes.delete(k);
    this.pushes.set(key, { yes: said === "yes", until: this.now() + PUSH_KEEP_MS });
    return said === "yes";
  }

  // ---------------------------------------------------------------- revoking

  /** Ends a token at GitHub. True when it is gone (or never was); false when GitHub could not be reached or refused. */
  async revokeToken(token: string): Promise<boolean> {
    try {
      const { clientId, clientSecret } = this.o.config;
      const r = await githubFetch(
        this.o.fetchFn, "DELETE", `${GITHUB_API}/applications/${encodeURIComponent(clientId)}/token`,
        `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, { access_token: token },
      );
      // 204 is revoked; 404 and 422 say GitHub does not know the token: it is as good as gone.
      return r.status === 204 || r.status === 404 || r.status === 422;
    } catch {
      return false;
    }
  }

  private async revokeStored(tokenEnc: string): Promise<boolean> {
    let token: string;
    try { token = decrypt(tokenEnc); } catch { return true; } // unreadable: nothing here can use it either
    return this.revokeToken(token);
  }

  /**
   * The person disconnects: the token is revoked at GitHub, then the link and
   * the projects that went through it are forgotten. If GitHub can't be
   * reached the token is NOT dropped (it could never be revoked then): the
   * link is made unusable and the person is told to try again.
   */
  async disconnect(userId: string): Promise<{ revoked: boolean }> {
    const link = await this.o.store.getOAuthLink(userId);
    if (!link) return { revoked: false };
    if (link.tokenEnc && !(await this.revokeStored(link.tokenEnc))) {
      await this.o.store.setOAuthStatus(userId, "needs_signin");
      throw new ConnectorError("failed", "I couldn't reach GitHub to revoke Tailzu's access, so nothing was disconnected. Try again in a moment.");
    }
    await this.o.store.deleteOAuthLink(userId);
    this.touched.delete(userId);
    return { revoked: !!link.tokenEnc };
  }

  /** The account is being deleted: revoke what can be revoked, whatever happens. The rows go with the account. Never throws. */
  async forAccountDelete(userId: string): Promise<boolean> {
    try {
      const link = await this.o.store.getOAuthLink(userId);
      return !link?.tokenEnc || (await this.revokeStored(link.tokenEnc));
    } catch {
      return false;
    }
  }

  /** One pass of the expiry: every token unused for 30 days is revoked and dropped. Returns how many. */
  async expireUnused(): Promise<number> {
    const idle = await this.o.store.listOAuthLinksIdleBefore(this.now() - IDLE_REVOKE_MS, SWEEP_BATCH);
    let n = 0;
    for (const link of idle) {
      if (link.tokenEnc && !(await this.revokeStored(link.tokenEnc))) continue; // tried again next pass
      await this.o.store.setOAuthStatus(link.userId, "needs_signin", { dropToken: true });
      n += 1;
    }
    return n;
  }

  /** The emergency: every stored token revoked and dropped. A token GitHub would not revoke is kept for another try and counted as failed. */
  async revokeAll(): Promise<{ revoked: number; failed: number }> {
    let revoked = 0, failed = 0;
    let after: string | null = null;
    for (;;) {
      const batch: CodeOAuthLink[] = await this.o.store.listOAuthLinksWithToken(after, SWEEP_BATCH);
      if (!batch.length) break;
      for (const link of batch) {
        if (link.tokenEnc && !(await this.revokeStored(link.tokenEnc))) { failed += 1; continue; }
        await this.o.store.setOAuthStatus(link.userId, "needs_signin", { dropToken: true });
        revoked += 1;
      }
      after = batch[batch.length - 1]!.userId;
    }
    return { revoked, failed };
  }
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const offError = () => new ConnectorError("oauth_off", "Sign in with GitHub isn't switched on.");
const signinError = () => new ConnectorError("needs_signin", "Sign in with GitHub to continue.");

/**
 * The expiry sweep: a pass at once, then one every few hours, never two at the
 * same time. Tokens unused for 30 days are revoked. Returns the stop.
 */
export function startOAuthSweeper(o: {
  oauth: GithubOAuth;
  everyMs?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const links = await o.oauth.expireUnused();
      if (links) o.log?.info({ links }, "unused GitHub sign-ins revoked");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.message }, "GitHub sign-in expiry failed");
    } finally {
      running = false;
    }
  };
  // The first pass waits a minute, so a server that is only starting and stopping never reaches out.
  const first = setTimeout(run, 60_000);
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
