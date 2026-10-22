/**
 * SIGNING IN TO GOOGLE FOR A CONNECTED APP, AND CALLING GOOGLE AS THE PERSON.
 *
 * Not MCP: Google has no dynamic client registration, so this is the plain
 * OAuth 2.0 web-server flow with our own registered client (the web client of
 * the project the Google sign-in already lives in):
 *
 *   POST /v1/connectors/:id/connect  beginGoogleOAuth()    -> accounts.google.com URL
 *   GET  /v1/connectors/callback     completeGoogleOAuth() <- Google sends them back
 *
 * Authorization code + PKCE (S256), access_type=offline so there is a refresh
 * token, include_granted_scopes=true so connecting Docs after Calendar adds to
 * what was granted instead of replacing it, prompt=consent because a refresh
 * token is only issued when the person is asked. The scopes are the connector's
 * own (catalog.ts) and are asked only here, when they tap Connect on that app:
 * signing in to Tailzu with Google never asks for them.
 *
 * The signed `state` and the callback route are the MCP flow's own (oauth.ts).
 * The PKCE verifier is stored encrypted and deleted the moment the code is
 * used. Tokens are stored encrypted as JSON { access_token, refresh_token,
 * expires_at, scope }, refreshed a minute before they run out, or once on a
 * 401, and never in a log or an error.
 */
import { createHash, randomBytes } from "node:crypto";
import type { ConnectorDef } from "../catalog.js";
import { decrypt, encrypt } from "../crypto.js";
import { ConnectorError, signState, verifyState } from "../oauth.js";
import type { ConnectorStore } from "../store.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Each request to Google gets this long. */
const REQUEST_MS = 15_000;
/** A token this close to running out is refreshed before it is used. */
const SKEW_MS = 60_000;

/** The web OAuth client of the Google sign-in project (GOOGLE_CONNECT_CLIENT_ID / _SECRET). */
export interface GoogleOAuth {
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
}

export interface GoogleDeps {
  store: ConnectorStore;
  redirectUrl: string;
  google: GoogleOAuth | null;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms. */
  expires_at: number;
  /** Space-separated scopes the person actually granted. */
  scope: string;
}

const notSetUp = () => new ConnectorError("not_configured", "Google isn't set up on this server yet.");

const isGoogle = (def: ConnectorDef | undefined): def is ConnectorDef & { scopes: string[] } =>
  !!def && def.kind === "native" && def.provider === "google" && Array.isArray(def.scopes) && def.scopes.length > 0;

const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Step one: the Google sign-in URL for this app's scopes. */
export async function beginGoogleOAuth(d: GoogleDeps, userId: string, def: ConnectorDef, now = Date.now()): Promise<string> {
  if (!isGoogle(def)) throw new ConnectorError("unsupported", `${def.name} can't be connected this way.`);
  if (!d.google) throw notSetUp();
  const verifier = randomBytes(32).toString("base64url");
  // A fresh sign-in: whatever token there was is let go (as the MCP flow does).
  await d.store.upsertConnection(userId, def.id, { tokensEnc: null, verifierEnc: encrypt(verifier) });
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: d.google.clientId,
    redirect_uri: d.redirectUrl,
    response_type: "code",
    scope: def.scopes.join(" "),
    state: await signState(userId, def.id, now),
    code_challenge: challengeOf(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  }).toString();
  return url.toString();
}

/** POST to Google's token endpoint. Returns the parsed JSON, or the status and Google's error code. */
async function tokenRequest(g: GoogleOAuth, form: Record<string, string>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await (g.fetchFn ?? fetch)(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...form, client_id: g.clientId, client_secret: g.clientSecret }).toString(),
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

/** Step two: Google sent the person back with a code. Returns who and which. */
export async function completeGoogleOAuth(
  d: GoogleDeps,
  find: (id: string) => ConnectorDef | undefined,
  code: string,
  stateToken: string,
  now = Date.now(),
): Promise<{ userId: string; def: ConnectorDef }> {
  const { userId, connectorId } = await verifyState(stateToken, now);
  const def = find(connectorId);
  if (!isGoogle(def)) throw new ConnectorError("bad_state", "That app isn't available.");
  if (!d.google) throw notSetUp();
  const conn = await d.store.getConnection(userId, def.id);
  // Single use, whatever happens next: a code is not retried against this verifier.
  await d.store.upsertConnection(userId, def.id, { verifierEnc: null });
  if (!conn?.verifierEnc) throw new ConnectorError("bad_state", "That sign-in was already used or never started. Start again from Tailzu.");
  const verifier = decrypt(conn.verifierEnc);

  const r = await tokenRequest(d.google, {
    grant_type: "authorization_code", code, redirect_uri: d.redirectUrl, code_verifier: verifier,
  });
  const access = r.json.access_token, refresh = r.json.refresh_token;
  if (!r.ok || typeof access !== "string") {
    throw new ConnectorError("failed", `${def.name} didn't accept the sign-in. Try connecting again.`);
  }
  const granted = typeof r.json.scope === "string" ? r.json.scope : "";
  // Google lets the person untick scopes on the consent page: without all of
  // them the tools would fail one by one, so say so now. More than this app
  // asks is fine (include_granted_scopes brings back what other apps were
  // given, and Calendar's calendar.readonly from before it stopped asking).
  if (def.scopes.some((s) => !granted.split(/\s+/).includes(s))) {
    throw new ConnectorError("failed", `${def.name} needs every box ticked on Google's page. Try connecting again and leave them all on.`);
  }
  if (typeof refresh !== "string" || !refresh) {
    throw new ConnectorError("failed", `Google didn't give me lasting access to ${def.name}. Try connecting again.`);
  }
  const expiresIn = typeof r.json.expires_in === "number" ? r.json.expires_in : 3600;
  const tokens: GoogleTokens = { access_token: access, refresh_token: refresh, expires_at: now + expiresIn * 1000, scope: granted };
  await d.store.upsertConnection(userId, def.id, { tokensEnc: encrypt(JSON.stringify(tokens)) });
  return { userId, def };
}

/**
 * Disconnect, at Google's end: the refresh token is revoked, which ends the
 * grant (and every access token under it) so the person's Google account
 * shows Tailzu gone. Google keeps ONE grant per person and client across the
 * apps (include_granted_scopes), so this is done only when no other Google
 * app of theirs is still connected: `others` names those, and while one is the
 * token is only forgotten here. Best effort and silent: a Google that cannot
 * be reached must not stop the disconnect, and the token is deleted by the
 * caller either way.
 */
export async function revokeGoogleAccess(d: GoogleDeps, userId: string, def: ConnectorDef, others: string[]): Promise<boolean> {
  try {
    if (!isGoogle(def) || !d.google) return false;
    for (const id of others) if ((await d.store.getConnection(userId, id))?.tokensEnc) return false;
    const c = await d.store.getConnection(userId, def.id);
    if (!c?.tokensEnc) return false;
    const t = JSON.parse(decrypt(c.tokensEnc)) as GoogleTokens;
    const res = await (d.google.fetchFn ?? fetch)("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: t.refresh_token }).toString(),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Calls to Google's REST APIs as one person: the stored token on every
 * request, refreshed before it expires and once more if Google says 401, and
 * every failure turned into a ConnectorError whose message can be said aloud.
 */
export class GoogleSession {
  private readonly inflight = new Map<string, Promise<GoogleTokens>>();

  constructor(private readonly o: { store: ConnectorStore; google: GoogleOAuth | null; now?: () => number }) {}

  private now(): number { return (this.o.now ?? Date.now)(); }
  private get fetchFn(): typeof fetch { return this.o.google?.fetchFn ?? fetch; }

  private async load(userId: string, connectorId: string): Promise<GoogleTokens> {
    const c = await this.o.store.getConnection(userId, connectorId);
    if (!c?.tokensEnc) throw new ConnectorError("not_connected", "That app isn't connected.");
    try { return JSON.parse(decrypt(c.tokensEnc)) as GoogleTokens; } catch { throw new ConnectorError("needs_reconnect", "Sign in again."); }
  }

  /** A new access token. Two calls at once share one refresh; if someone already refreshed, theirs is used. */
  private refresh(userId: string, connectorId: string, stale: string): Promise<GoogleTokens> {
    const key = `${userId}|${connectorId}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      const cur = await this.load(userId, connectorId);
      if (cur.access_token !== stale && cur.expires_at - SKEW_MS > this.now()) return cur;
      if (!this.o.google) throw notSetUp();
      const r = await tokenRequest(this.o.google, { grant_type: "refresh_token", refresh_token: cur.refresh_token });
      if (!r.ok || typeof r.json.access_token !== "string") {
        // invalid_grant: revoked, expired for good, or the password changed. Only a new sign-in helps.
        if (r.status === 400 || r.status === 401) throw new ConnectorError("needs_reconnect", "Sign in again.");
        throw new ConnectorError("failed", "Google ran into a problem.");
      }
      const next: GoogleTokens = {
        access_token: r.json.access_token,
        // Google normally sends no new refresh token; the old one stays good.
        refresh_token: typeof r.json.refresh_token === "string" && r.json.refresh_token ? r.json.refresh_token : cur.refresh_token,
        expires_at: this.now() + (typeof r.json.expires_in === "number" ? r.json.expires_in : 3600) * 1000,
        scope: typeof r.json.scope === "string" ? r.json.scope : cur.scope,
      };
      await this.o.store.upsertConnection(userId, connectorId, { tokensEnc: encrypt(JSON.stringify(next)) });
      return next;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /**
   * One request to Google. Returns the parsed JSON body ({} for an empty one).
   * `notFound` is what a 404 or 410 means here ("I couldn't find that event.").
   */
  async json<T = Record<string, any>>(
    userId: string, connectorId: string, app: string, url: string,
    init: { method?: string; body?: unknown; notFound?: string } = {},
  ): Promise<T> {
    let tokens = await this.load(userId, connectorId);
    if (tokens.expires_at - SKEW_MS <= this.now()) tokens = await this.refresh(userId, connectorId, tokens.access_token);
    const send = (token: string) => this.fetchFn(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`, accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    let res = await send(tokens.access_token);
    // Google says the token is no good (revoked, or expired early): a new one, and one more try.
    if (res.status === 401) {
      tokens = await this.refresh(userId, connectorId, tokens.access_token);
      res = await send(tokens.access_token);
    }
    const text = await res.text().catch(() => "");
    let body: any = {};
    if (text) { try { body = JSON.parse(text); } catch { body = {}; } }
    if (res.ok) return body as T;
    throw apiError(res.status, body, app, init.notFound);
  }
}

/** A failed Google response as a ConnectorError in plain words. Google's own text is not repeated. */
export function apiError(status: number, body: any, app: string, notFound?: string): ConnectorError {
  const reason = String(body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "");
  if (status === 401) return new ConnectorError("needs_reconnect", `${app} needs you to sign in again.`);
  if (status === 404 || status === 410) return new ConnectorError("rejected", notFound ?? `I couldn't find that in ${app}.`);
  // The project's allowance for the day is spent: a minute will not help.
  if (/quotaExceeded|dailyLimitExceeded/.test(reason)) {
    return new ConnectorError("failed", `${app} has done all it can for today. Try again tomorrow.`);
  }
  if (status === 429 || /rateLimit|quota|RESOURCE_EXHAUSTED/i.test(reason)) {
    return new ConnectorError("failed", `${app} is busy right now. Try again in a minute.`);
  }
  if (status === 403) {
    // The API itself switched off in our Google project: ours to fix, not a reason to sign in again.
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + String(body?.error?.message ?? ""))) {
      return new ConnectorError("failed", `${app} ran into a problem.`);
    }
    return /scope|insufficient|PERMISSION_DENIED/i.test(reason + String(body?.error?.message ?? ""))
      ? new ConnectorError("needs_reconnect", `${app} needs you to sign in again.`)
      : new ConnectorError("rejected", `${app} wouldn't let me do that.`);
  }
  if (status === 400 || status === 409 || status === 412) return new ConnectorError("rejected", `${app} didn't accept that.`);
  return new ConnectorError("failed", `${app} ran into a problem.`);
}
