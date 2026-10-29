/**
 * SIGNING IN TO AN APP, FROM THE SERVER, FOR ONE PERSON AT A TIME.
 *
 * The MCP SDK drives the standard flow (discovery, PKCE, code exchange,
 * refresh); this file gives it somewhere to keep its state, tells it who we
 * are, and makes the checks the SDK (1.32.1) leaves out. The browser part is
 * two requests:
 *
 *   POST /v1/connectors/:id/connect   beginOAuth()    -> the vendor's sign-in URL
 *   GET  /v1/connectors/callback      completeOAuth() <- the vendor sends them back
 *
 * WHO WE ARE to the vendor, in the order the MCP spec (2026-07-28) prefers:
 *   1. a client registered with the vendor in advance (CONNECTOR_OAUTH_CLIENTS),
 *      for the apps that offer nothing else (catalog `preRegistered`). It is
 *      never registered over, and never shown to any auth server but its own;
 *   2. Tailzu's published client document (CONNECTOR_CLIENT_METADATA_URL,
 *      "CIMD"), where the auth server takes one AND lets a client with no
 *      secret in ("none"), which is Claude's rule too;
 *   3. dynamic client registration, as before.
 *
 * WHAT IS CHECKED that the SDK skips, before anyone is sent anywhere
 * (saveDiscoveryState runs before the sign-in URL is made):
 *   - the auth server's metadata names the server we found it at: its
 *     `issuer` is exactly that URL (RFC 8414), so one server cannot pass off
 *     another's metadata as its own;
 *   - it does PKCE with S256. An app outside the vetted catalog must; a
 *     catalog app that does not is logged, until each is tried live;
 *   - the sign-in comes back from that same server (RFC 9207). Its issuer, and
 *     whether it promised to send `iss` back, travel in the signed state; the
 *     callback's `iss` must equal it exactly, and be there when promised. The
 *     code is then exchanged with that issuer and no other;
 *   - an app a person added by link does not send them to sign in at one of
 *     the catalog's vendors (catalog.ts vendorSites), from anywhere but that
 *     vendor's own site. Tailzu's client id is the same everywhere, so a
 *     stranger's server naming Notion's sign-in would have the person sign in
 *     to their real Notion and hand the result to the stranger.
 *
 * An app added by link may bring its own OAuth client (an id, maybe a
 * secret). It is treated like a pre-registered one, never registered over,
 * and tied to the auth server its first sign-in finds (`bindCustomIssuer`):
 * after that it is shown to no other.
 * Every request a sign-in makes goes through egress.ts (oauthFetch): public
 * https addresses only, ten seconds and 256 KiB each.
 *
 * The callback arrives with no Tailzu session (it is the vendor's redirect in
 * a browser), so WHO it belongs to is carried in `state`: a JWT signed with a
 * key derived from CONNECTOR_TOKEN_KEY, binding the user and the connector,
 * valid for ten minutes. A callback with a bad, expired or other-connector
 * state does nothing. The PKCE verifier is single-use: it is deleted the moment
 * the code is exchanged, so a replayed callback has nothing to exchange with.
 *
 * What is kept, per (user, connector), is encrypted wherever it is a secret:
 * tokens and the verifier. The registered client's id is not a secret, and a
 * pre-registered client's secret is never stored: it stays in the environment.
 */
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { ConnectorOAuthClient } from "../config.js";
import { CATALOG, siteOf, vendorSites, type ConnectorDef } from "./catalog.js";
import { decrypt, encrypt } from "./crypto.js";
import { EgressRefused, oauthFetch, type FetchLike } from "./egress.js";
import type { ConnectorStore } from "./store.js";

export { STATE_TTL_SEC, ConnectorError, signState, verifyState, type StateIssuer, type VerifiedState } from "./state.js";
import { ConnectorError, signState, verifyState } from "./state.js";

/**
 * RFC 9207: the code came back from the auth server the person was sent to,
 * not from another one that got hold of the state. An `iss` that is there must
 * be that issuer exactly; one that is missing is refused only when the server
 * said it would send it.
 */
export function checkCallbackIssuer(expected: string | undefined, required: boolean, got: unknown): void {
  const iss = typeof got === "string" && got ? got : undefined;
  if (iss === undefined ? required : iss !== expected) {
    throw new ConnectorError("bad_state", "That sign-in didn't come back from the app it started at. Start again from Tailzu.");
  }
}

/** How one app signs in. */
export interface ProviderOptions {
  /** The app's name, for the words of a refusal. */
  name?: string;
  /** Tailzu's published client document (CIMD). Used only where the auth server takes it and lets in a client with no secret. */
  cimdUrl?: string;
  /**
   * A client registered with the vendor in advance, or the person's own for an
   * app they added. Never registered over. With no issuer yet (the person's
   * own, before its first sign-in) it is tied to the one discovery finds.
   */
  staticClient?: PresetClient;
  /** Hold the auth server to the letter: an app outside the vetted catalog. */
  strict?: boolean;
  /** An app added by link: where its server is, and the sites it may not send anyone to sign in at. */
  custom?: { serverUrl: string; vendorSites: ReadonlySet<string> };
  /** Finishing a sign-in: the issuer it started at (from the state). Discovery must find that one again. */
  expectIssuer?: string;
  /** Where a catalog app's lapse is logged. */
  warn?: (line: string) => void;
}

/** A client we present as it is: from CONNECTOR_OAUTH_CLIENTS, or the one a person gave for their own app. */
export type PresetClient = Omit<ConnectorOAuthClient, "issuer"> & { issuer?: string };

/**
 * The sign-in host of an app added by link, when it is a catalog vendor's and
 * the app's server is not on that vendor's site. Every address the auth
 * server's metadata names counts: a stranger's issuer with Notion's
 * authorize page would still put the person in front of Notion.
 */
export function vendorSignIn(serverUrl: string, addresses: Array<string | undefined>, vendors: ReadonlySet<string>): string | undefined {
  let own: string;
  try { own = siteOf(new URL(serverUrl).hostname); } catch { return undefined; }
  for (const a of addresses) {
    if (!a) continue;
    let host: string;
    try { host = new URL(a).hostname; } catch { continue; }
    const site = siteOf(host);
    if (vendors.has(site) && site !== own) return host;
  }
  return undefined;
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
  /** What discovery found in this sign-in: who the auth server is and what it supports. */
  private found: { issuer: string; issRequired: boolean; noSecret: boolean } | null = null;
  /** The preset client, once tied to its auth server. */
  private client: PresetClient | undefined;
  /**
   * Left undefined for a client registered in advance: with nowhere to save a
   * new client the SDK never registers one over it, and if the auth server
   * ever changes it throws instead of showing our client to the new one.
   */
  saveClientInformation?: (info: OAuthClientInformationMixed) => Promise<void>;

  constructor(
    private readonly store: ConnectorStore,
    private readonly userId: string,
    private readonly connectorId: string,
    private readonly redirect: string,
    private readonly interactive = false,
    private readonly o: ProviderOptions = {},
  ) {
    this.client = o.staticClient ? { ...o.staticClient } : undefined;
    if (!o.staticClient) {
      this.saveClientInformation = async (info) => { await this.store.upsertConnection(this.userId, this.connectorId, { clientInfo: info }); };
    }
  }

  get redirectUrl(): string { return this.redirect; }

  /** Read by the SDK after discovery, and only when no client is kept yet. */
  get clientMetadataUrl(): string | undefined {
    return this.o.cimdUrl && !this.o.staticClient && this.found?.noSecret ? this.o.cimdUrl : undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    const meta = {
      client_name: "Tailzu",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      // A server-side web client (OIDC registration; the spec asks a client that
      // registers itself to say). The SDK's type does not list it, and sends it as given.
      application_type: "web",
    };
    return meta as OAuthClientMetadata;
  }

  state(): Promise<string> {
    const as = this.found ? { issuer: this.found.issuer, required: this.found.issRequired } : undefined;
    return signState(this.userId, this.connectorId, undefined, undefined, as);
  }

  /**
   * The auth server, as discovery found it. Runs before the sign-in URL is
   * made (and before any code is exchanged), so a refusal here sends nobody
   * anywhere.
   */
  saveDiscoveryState(s: OAuthDiscoveryState): void | Promise<void> {
    const m = s.authorizationServerMetadata;
    const server = s.authorizationServerUrl;
    const issuer = m?.issuer ?? server;
    const name = this.o.name ?? "That app";
    if (this.o.custom) {
      const at = vendorSignIn(this.o.custom.serverUrl, [server, issuer, m?.authorization_endpoint, m?.token_endpoint, m?.registration_endpoint], this.o.custom.vendorSites);
      if (at) throw new ConnectorError("vendor_sign_in", `${name} wants you to sign in at ${at}, which belongs to another app, so I stopped.`);
    }
    // RFC 8414: the document names the server it was asked for, exactly. The one
    // slack: with no resource metadata the SDK made the server's URL up itself,
    // from the origin, with a "/" that no issuer carries.
    if (m && m.issuer !== server && !(!s.resourceMetadata && `${m.issuer}/` === server)) {
      throw new ConnectorError("unsupported", `${name}'s sign-in server didn't identify itself properly, so I stopped.`);
    }
    if (this.o.expectIssuer !== undefined && issuer !== this.o.expectIssuer) {
      throw new ConnectorError("bad_state", "That sign-in didn't come back from the app it started at. Start again from Tailzu.");
    }
    if (!m?.code_challenge_methods_supported?.includes("S256")) {
      if (this.o.strict) throw new ConnectorError("unsupported", `${name}'s sign-in doesn't offer the protection Tailzu needs (PKCE with S256), so I stopped.`);
      (this.o.warn ?? ((l: string) => console.warn(l)))(`[connectors] ${this.connectorId}: the auth server ${server} does not list S256 PKCE; going ahead, as it is a catalog app.`);
    }
    this.found = {
      issuer,
      issRequired: (m as { authorization_response_iss_parameter_supported?: unknown } | undefined)?.authorization_response_iss_parameter_supported === true,
      noSecret: !!m?.token_endpoint_auth_methods_supported?.includes("none"),
    };
    // A person's own client with no auth server yet: this one, from now on. The
    // SDK reads the client after this, so it is presented already tied.
    if (this.o.custom && this.client && !this.client.issuer) return this.bind(server);
  }

  private async bind(server: string): Promise<void> {
    const bound = await this.store.bindCustomIssuer(this.userId, this.connectorId, server);
    this.client = { ...this.client!, issuer: bound ?? server };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.client) return { ...this.client };
    const c = await this.store.getConnection(this.userId, this.connectorId);
    return (c?.clientInfo as OAuthClientInformationMixed | null) ?? undefined;
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

/** Who Tailzu is to the vendors: from CONNECTOR_CLIENT_METADATA_URL and CONNECTOR_OAUTH_CLIENTS. */
export interface SignInConfig {
  /** Our published client document; "" or unset turns it off. */
  clientMetadataUrl?: string;
  /** Clients registered in advance, by connector id. */
  clients?: Record<string, ConnectorOAuthClient>;
}

export interface OAuthDeps extends SignInConfig {
  store: ConnectorStore;
  redirectUrl: string;
  /** Where the sign-in is allowed to go. Default: oauthFetch (egress.ts). */
  fetchFn?: FetchLike;
}

/**
 * Our client document's URL, when it is one the SDK will use: https, with a
 * path. The SDK throws on any other, which would fail every sign-in at an auth
 * server that takes client documents; so a bad one is simply not offered.
 */
function documentUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { const u = new URL(url); return u.protocol === "https:" && u.pathname !== "/" ? url : undefined; } catch { return undefined; }
}

/**
 * How this app signs in: its pre-registered client if we have one, our
 * published identity where its server takes it. Leniency is only for the apps
 * we vetted by hand, at the address we vetted; everything else is strict.
 */
export function providerOptions(cfg: SignInConfig, def: ConnectorDef): ProviderOptions {
  const base = { name: def.name, cimdUrl: documentUrl(cfg.clientMetadataUrl), strict: !CATALOG.some((c) => c.id === def.id && c.url === def.url) };
  if (!def.custom) return { ...base, staticClient: cfg.clients?.[def.id] };
  const own = def.custom.client;
  return {
    ...base,
    strict: true,
    ...(own ? {
      staticClient: {
        client_id: own.id,
        ...(own.secretEnc ? { client_secret: decrypt(own.secretEnc) } : {}),
        ...(own.issuer ? { issuer: own.issuer } : {}),
      },
    } : {}),
    custom: { serverUrl: def.url, vendorSites: vendorSites(Object.values(cfg.clients ?? {}).map((c) => c.issuer)) },
  };
}

/** A refusal from egress.ts, in the app's name. Anything else goes on as it was. */
function inWords(err: unknown, def: ConnectorDef): unknown {
  return err instanceof EgressRefused
    ? new ConnectorError("blocked_address", err.reason === "too_large" ? `${def.name}'s sign-in sent back more than it should.` : `${def.name}'s sign-in is at an address Tailzu won't connect to.`)
    : err;
}

/**
 * Was this kept client made for another of our addresses? A registration lists
 * the redirects it was made with; a client document's id is the https URL it
 * was read from. Either, from before CONNECTOR_REDIRECT_URL or
 * CONNECTOR_CLIENT_METADATA_URL moved (tailzu.space to x0bot.com), would send
 * the person back to the old callback, or be refused by the app. Only a new
 * sign-in asks: a refresh needs no redirect, and keeps working on the old one.
 */
export function madeForAnotherAddress(info: OAuthClientInformationMixed | undefined, redirect: string, cimdUrl: string | undefined): boolean {
  if (!info) return false;
  const uris = (info as { redirect_uris?: unknown }).redirect_uris;
  if (Array.isArray(uris)) return uris.length > 0 && !uris.includes(redirect);
  return /^https:\/\//i.test(info.client_id) && info.client_id !== cimdUrl;
}

/** Step one: the URL on the vendor's side where the person signs in. */
export async function beginOAuth(d: OAuthDeps, userId: string, def: ConnectorDef): Promise<string> {
  // A vendor that registers no client itself: without ours there is no page to send anyone to.
  if (def.preRegistered && !d.clients?.[def.id]) {
    throw new ConnectorError("not_configured", `${def.name} can't be connected yet: Tailzu's sign-in for it isn't set up.`);
  }
  const opts = providerOptions(d, def);
  const provider = new UserOAuthProvider(d.store, userId, def.id, d.redirectUrl, true, opts);
  // A fresh sign-in, not a quiet refresh: whatever token there was is let go,
  // but the registered client is kept so the vendor is not asked to register again —
  // unless it was made for another of our addresses (before the move to x0bot.com),
  // whose callback this sign-in will not come back to.
  await provider.invalidateCredentials("tokens");
  await provider.invalidateCredentials("verifier");
  if (!opts.staticClient && madeForAnotherAddress(await provider.clientInformation(), d.redirectUrl, opts.cimdUrl)) {
    await provider.invalidateCredentials("client");
  }
  const result = await auth(provider, { serverUrl: def.url, fetchFn: d.fetchFn ?? oauthFetch }).catch((err) => { throw inWords(err, def); });
  if (result !== "REDIRECT" || !provider.authUrl) {
    throw new ConnectorError("unsupported", `${def.name} didn't offer a sign-in page. It may not support connecting this way yet.`);
  }
  return provider.authUrl.toString();
}

/** Step two: the vendor sent the person back with a code (and, from a server that does RFC 9207, `iss`). Returns who and which. */
export async function completeOAuth(
  d: OAuthDeps,
  /** The app the state names, for the person it names (their own apps included). */
  find: (id: string, userId: string) => ConnectorDef | undefined | Promise<ConnectorDef | undefined>,
  code: string,
  stateToken: string,
  iss?: unknown,
): Promise<{ userId: string; def: ConnectorDef }> {
  const st = await verifyState(stateToken);
  const { userId } = st;
  const def = await find(st.connectorId, userId);
  if (!def || def.auth !== "oauth") throw new ConnectorError("bad_state", "That app isn't available.");
  checkCallbackIssuer(st.issuer, st.issRequired === true, iss);
  const provider = new UserOAuthProvider(d.store, userId, def.id, d.redirectUrl, false, { ...providerOptions(d, def), expectIssuer: st.issuer });
  let result: Awaited<ReturnType<typeof auth>>;
  try {
    result = await auth(provider, { serverUrl: def.url, authorizationCode: code, fetchFn: d.fetchFn ?? oauthFetch }).catch((err) => { throw inWords(err, def); });
  } finally {
    // Single use, whatever happened: a code is not retried against this verifier.
    await d.store.upsertConnection(userId, def.id, { verifierEnc: null });
  }
  if (result !== "AUTHORIZED") throw new ConnectorError("failed", `${def.name} didn't accept the sign-in. Try connecting again.`);
  return { userId, def };
}
