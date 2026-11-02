/**
 * SIGN IN WITH APPLE, ENDED WHEN THE ACCOUNT IS: APPLE'S TOKEN, KEPT TO BE REVOKED.
 *
 * Apple asks every app with Sign in with Apple to end it at Apple when the person deletes their account (App Review 5.1.1(v)): its REST
 * API's /auth/revoke, with a token of that person's. Apple gives that token only to whoever trades the one-time code the phone was handed
 * at sign-in (good for five minutes, once) at /auth/token, so:
 *
 *   POST /v1/auth/apple/code { code }   the app, just after an Apple sign-in (AuthGateScreen): traded at Apple, and the refresh token
 *                                        kept, encrypted (connectors/crypto.ts), in apple_sign_in (migration 0061)
 *   forAccountDelete(userId)            the account's delete (server.ts eraseAccount, both ways in): the token revoked at Apple, which
 *                                        also makes the next sign-in with that Apple ID a first one, Apple's name and all. Never throws.
 *
 * Both speak to Apple as the app, with a client secret made for the call: an ES256 JWT signed with the Sign in with Apple key (the .p8
 * from the Apple Developer account, Keys). Off, both no-ops, until APPLE_SIWA_KEY_ID and APPLE_SIWA_PRIVATE_KEY are set. Someone who
 * signed in before the app sent the code has no token here, and nothing to revoke.
 */
import { importPKCS8, SignJWT } from "jose";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "../config.js";
import { decrypt, encrypt } from "../connectors/crypto.js";

const APPLE = "https://appleid.apple.com";
/** How long a client secret lives: made for one call, so minutes are plenty (Apple allows six months). */
const SECRET_SECONDS = 300;

export interface AppleSiwaConfig { teamId: string; keyId: string; clientId: string; privateKey: string }

/** The key and who the app is, or null while the key is not set. The key may be the .p8 file's text, or that text in base64 (one line). */
export function appleSiwaConfig(env: Pick<ReturnType<typeof getConfig>, "APPLE_SIWA_KEY_ID" | "APPLE_SIWA_PRIVATE_KEY" | "APPLE_SIWA_TEAM_ID" | "APPLE_SIWA_CLIENT_ID"> = getConfig()): AppleSiwaConfig | null {
  const keyId = env.APPLE_SIWA_KEY_ID?.trim();
  const raw = env.APPLE_SIWA_PRIVATE_KEY?.trim();
  if (!keyId || !raw) return null;
  const pem = raw.includes("BEGIN PRIVATE KEY") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
  if (!pem.includes("BEGIN PRIVATE KEY")) return null;
  return { teamId: env.APPLE_SIWA_TEAM_ID.trim(), keyId, clientId: env.APPLE_SIWA_CLIENT_ID.trim(), privateKey: pem };
}

/** The client secret Apple's token and revoke calls take: ES256, the key's id in the header, the team as issuer, the app as subject. */
export async function clientSecret(c: AppleSiwaConfig, now = Date.now()): Promise<string> {
  const key = await importPKCS8(c.privateKey, "ES256");
  const iat = Math.floor(now / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: c.keyId })
    .setIssuer(c.teamId).setSubject(c.clientId).setAudience(APPLE)
    .setIssuedAt(iat).setExpirationTime(iat + SECRET_SECONDS)
    .sign(key);
}

/** Where the token is kept: one row a person, the token encrypted. */
export interface AppleTokenStore {
  get(userId: string): Promise<string | null>;
  set(userId: string, tokenEnc: string): Promise<void>;
  drop(userId: string): Promise<void>;
}

function supabaseAppleTokens(sb: SupabaseClient): AppleTokenStore {
  return {
    async get(userId) {
      const { data, error } = await sb.from("apple_sign_in").select("refresh_enc").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { refresh_enc?: string } | null)?.refresh_enc ?? null;
    },
    async set(userId, tokenEnc) {
      const { error } = await sb.from("apple_sign_in").upsert({ user_id: userId, refresh_enc: tokenEnc, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    async drop(userId) {
      const { error } = await sb.from("apple_sign_in").delete().eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
  };
}

export interface AppleSignInDeps {
  config: AppleSiwaConfig;
  store: AppleTokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Encrypts and opens the token (connectors/crypto.ts under CONNECTOR_TOKEN_KEY unless a test gives its own). */
  seal?: { encrypt: (s: string) => string; decrypt: (s: string) => string };
}

export class AppleSignIn {
  private readonly fetch: typeof fetch;
  private readonly seal: NonNullable<AppleSignInDeps["seal"]>;

  constructor(private readonly o: AppleSignInDeps) {
    this.fetch = o.fetch ?? fetch;
    this.seal = o.seal ?? { encrypt: (s) => encrypt(s), decrypt: (s) => decrypt(s) };
  }

  /** Trade the phone's one-time code for the refresh token, and keep it. False when Apple would not trade it (used, expired, another app's). */
  async keepCode(userId: string, code: string): Promise<boolean> {
    const res = await this.call("/auth/token", { code, grant_type: "authorization_code" });
    if (!res.ok) return false;
    const refresh = ((await res.json().catch(() => null)) as { refresh_token?: unknown } | null)?.refresh_token;
    if (typeof refresh !== "string" || !refresh) return false;
    await this.o.store.set(userId, this.seal.encrypt(refresh));
    return true;
  }

  /** The account is being deleted: the Apple sign-in ended at Apple, whatever happens. True when there was nothing to end, or it ended. Never throws. */
  async forAccountDelete(userId: string): Promise<boolean> {
    try {
      const kept = await this.o.store.get(userId);
      if (!kept) return true;
      const res = await this.call("/auth/revoke", { token: this.seal.decrypt(kept), token_type_hint: "refresh_token" });
      if (res.ok) await this.o.store.drop(userId).catch(() => undefined);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async call(path: string, form: Record<string, string>): Promise<Response> {
    const c = this.o.config;
    const body = new URLSearchParams({ client_id: c.clientId, client_secret: await clientSecret(c, this.o.now?.()), ...form });
    return this.fetch(`${APPLE}${path}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000),
    });
  }
}

/** The server's one, or null while the key is not set or there is no database to keep tokens in. */
export function createAppleSignIn(sb: SupabaseClient | null): AppleSignIn | null {
  const config = appleSiwaConfig();
  return config && sb ? new AppleSignIn({ config, store: supabaseAppleTokens(sb) }) : null;
}
