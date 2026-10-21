/**
 * SIGNING IN TO AN APP, FROM THE SERVER, FOR ONE PERSON AT A TIME.
 *
 * The MCP SDK drives the standard flow (discovery, dynamic client
 * registration, PKCE, code exchange, refresh); this file gives it somewhere
 * to keep its state. The browser part is two requests:
 *
 *   POST /v1/connectors/:id/connect   beginOAuth()    -> the vendor's sign-in URL
 *   GET  /v1/connectors/callback      completeOAuth() <- the vendor sends them back
 *
 * The callback arrives with no Tailzu session (it is the vendor's redirect in
 * a browser), so WHO it belongs to is carried in `state`: a JWT signed with a
 * key derived from CONNECTOR_TOKEN_KEY, binding the user and the connector,
 * valid for ten minutes. A callback with a bad, expired or other-connector
 * state does nothing. The PKCE verifier is single-use: it is deleted the moment
 * the code is exchanged, so a replayed callback has nothing to exchange with.
 *
 * What is kept, per (user, connector), is encrypted wherever it is a secret:
 * tokens and the verifier. The registered client's id is not a secret.
 */
import { randomUUID } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { jwtVerify, SignJWT } from "jose";
import type { ConnectorDef } from "./catalog.js";
import { decrypt, encrypt, stateKey } from "./crypto.js";
import type { ConnectorStore } from "./store.js";

export const STATE_TTL_SEC = 10 * 60;
const ISSUER = "tailzu-connectors";
const AUDIENCE = "connector-oauth";

/** A failure with a plain-words message and a code the app can switch on. */
export class ConnectorError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function signState(userId: string, connectorId: string, now = Date.now(), key = stateKey()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ uid: userId, cid: connectorId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setJti(randomUUID())
    .setIssuedAt(iat).setExpirationTime(iat + STATE_TTL_SEC)
    .sign(key);
}

export async function verifyState(token: string, now = Date.now(), key = stateKey()): Promise<{ userId: string; connectorId: string }> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"], currentDate: new Date(now),
    });
    if (typeof payload.uid !== "string" || typeof payload.cid !== "string") throw new Error("shape");
    return { userId: payload.uid, connectorId: payload.cid };
  } catch {
    throw new ConnectorError("bad_state", "That sign-in link has expired or isn't valid. Start again from Tailzu.");
  }
}

/**
 * The SDK's OAuthClientProvider, backed by the store. `interactive` is true
 * only while a person is mid sign-in; a provider used for ordinary calls can
 * refresh a token on its own, but if that fails it must not try to send
 * anyone to a browser: it reports that they need to sign in again.
 */
export class UserOAuthProvider implements OAuthClientProvider {
  /** The vendor's sign-in URL, captured instead of opened. */
  authUrl: URL | null = null;

  constructor(
    private readonly store: ConnectorStore,
    private readonly userId: string,
    private readonly connectorId: string,
    private readonly redirect: string,
    private readonly interactive = false,
  ) {}

  get redirectUrl(): string { return this.redirect; }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Tailzu",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): Promise<string> { return signState(this.userId, this.connectorId); }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const c = await this.store.getConnection(this.userId, this.connectorId);
    return (c?.clientInfo as OAuthClientInformationMixed | null) ?? undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.store.upsertConnection(this.userId, this.connectorId, { clientInfo: info });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const c = await this.store.getConnection(this.userId, this.connectorId);
    if (!c?.tokensEnc) return undefined;
    try { return JSON.parse(decrypt(c.tokensEnc)) as OAuthTokens; } catch { return undefined; }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.upsertConnection(this.userId, this.connectorId, { tokensEnc: encrypt(JSON.stringify(tokens)) });
  }

  redirectToAuthorization(url: URL): void {
    if (!this.interactive) throw new ConnectorError("needs_reconnect", "This app needs you to sign in again.");
    this.authUrl = url;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.store.upsertConnection(this.userId, this.connectorId, { verifierEnc: encrypt(verifier) });
  }

  async codeVerifier(): Promise<string> {
    const c = await this.store.getConnection(this.userId, this.connectorId);
    if (!c?.verifierEnc) throw new ConnectorError("bad_state", "That sign-in was already used or never started. Start again from Tailzu.");
    return decrypt(c.verifierEnc);
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const patch: Record<string, null> = {};
    if (scope === "all" || scope === "tokens") patch.tokensEnc = null;
    if (scope === "all" || scope === "client") patch.clientInfo = null;
    if (scope === "all" || scope === "verifier") patch.verifierEnc = null;
    if (Object.keys(patch).length) await this.store.upsertConnection(this.userId, this.connectorId, patch);
  }
}

export interface OAuthDeps {
  store: ConnectorStore;
  redirectUrl: string;
  /** Where the sign-in is allowed to go; tests point it at a local server. */
  fetchFn?: typeof fetch;
}

/** Step one: the URL on the vendor's side where the person signs in. */
export async function beginOAuth(d: OAuthDeps, userId: string, def: ConnectorDef): Promise<string> {
  const provider = new UserOAuthProvider(d.store, userId, def.id, d.redirectUrl, true);
  // A fresh sign-in, not a quiet refresh: whatever token there was is let go,
  // but the registered client is kept so the vendor is not asked to register again.
  await provider.invalidateCredentials("tokens");
  await provider.invalidateCredentials("verifier");
  const result = await auth(provider, { serverUrl: def.url, fetchFn: d.fetchFn });
  if (result !== "REDIRECT" || !provider.authUrl) {
    throw new ConnectorError("unsupported", `${def.name} didn't offer a sign-in page. It may not support connecting this way yet.`);
  }
  return provider.authUrl.toString();
}

/** Step two: the vendor sent the person back with a code. Returns who and which. */
export async function completeOAuth(
  d: OAuthDeps,
  find: (id: string) => ConnectorDef | undefined,
  code: string,
  stateToken: string,
): Promise<{ userId: string; def: ConnectorDef }> {
  const { userId, connectorId } = await verifyState(stateToken);
  const def = find(connectorId);
  if (!def || def.auth !== "oauth") throw new ConnectorError("bad_state", "That app isn't available.");
  const provider = new UserOAuthProvider(d.store, userId, def.id, d.redirectUrl, false);
  let result: Awaited<ReturnType<typeof auth>>;
  try {
    result = await auth(provider, { serverUrl: def.url, authorizationCode: code, fetchFn: d.fetchFn });
  } finally {
    // Single use, whatever happened: a code is not retried against this verifier.
    await d.store.upsertConnection(userId, def.id, { verifierEnc: null });
  }
  if (result !== "AUTHORIZED") throw new ConnectorError("failed", `${def.name} didn't accept the sign-in. Try connecting again.`);
  return { userId, def };
}
