/**
 * Supabase client + auth helpers (server-side, uses the SERVICE ROLE key).
 *
 * The SERVICE ROLE key bypasses row-level security and must NEVER be shipped to
 * a client. The Android app authenticates the user with the ANON key, gets a
 * JWT, and sends it to us; we verify it here to resolve the user id.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "../config.js";
import { digest, sameSecret } from "./secret.js";
import { DEVICE_TOKEN_PREFIX, deviceTokens } from "./deviceTokens.js";

let client: SupabaseClient | null = null;
let verifier: SupabaseClient | null = null;

/**
 * HOW LONG A VERIFIED JWT IS TRUSTED WITHOUT ASKING SUPABASE AGAIN. The same minute, for the same reason, as a device
 * token's (auth/deviceTokens.ts CACHE_MS): "so a terminal's requests do not each read the table".
 *
 * A SCREEN IS NOT ONE REQUEST. Every Bots screen builds by calling the app's own routes in-process on the person's
 * behalf (experience/bots/deps.ts: fastify inject, carrying their `authorization`), so opening one costs 1 + N
 * verifications — around eleven on Home. Each was a network round-trip to Supabase before the screen could start
 * being built, which is most of what "navigation feels slow" was.
 *
 * Only SUCCESSES are kept, and never past the token's own `exp`. A failure is never cached, so a token that becomes
 * valid works on the next try rather than after a minute.
 *
 * THE COST, said plainly: a token revoked elsewhere keeps working on this instance for up to a minute — exactly the
 * window the device tokens already accept, and the JWT's own expiry is still honoured to the second.
 */
export const VERIFY_CACHE_MS = 60_000;
/** Bounded so a flood of distinct tokens cannot grow it without limit; oldest out first. */
const VERIFY_CACHE_MAX = 1_000;
const verified = new Map<string, { user: AuthedUser; until: number }>();

/** The second of a JWT's three parts, as milliseconds, or 0 when it cannot be read. Already verified by Supabase. */
function expiryOf(token: string): number {
  const part = token.split(".")[1];
  if (!part) return 0;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof json.exp === "number" && Number.isFinite(json.exp) ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Forget every verified token. For tests, and for a sign-out that must bite on this instance at once. */
export function forgetVerifiedTokens(): void {
  verified.clear();
}

/** Returns the service-role Supabase client, or null if metering is disabled. */
export function supabase(): SupabaseClient | null {
  const cfg = getConfig();
  if (!cfg.supabaseEnabled) return null;
  if (!client) {
    client = createClient(cfg.SUPABASE_URL!, cfg.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/**
 * A client used only to VERIFY user JWTs (calls /auth/v1/user with the token).
 * Prefers the service key when present, else uses the public anon key — both can
 * resolve a user from a token, so auth works without the secret service key.
 */
function verifyClient(): SupabaseClient | null {
  const cfg = getConfig();
  if (!cfg.authEnabled) return null;
  if (!verifier) {
    const key = cfg.SUPABASE_SERVICE_KEY ?? cfg.SUPABASE_ANON_KEY!;
    verifier = createClient(cfg.SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return verifier;
}

export interface AuthedUser {
  id: string;
  email?: string;
  /** The email was confirmed (Supabase's email_confirmed_at is set): an email code, Google and Apple sign-ins confirm it. An
   *  invitation to a space waits only for a confirmed address (botsBots/spaceJoin.ts), so an account that merely typed someone's
   *  address can't take what was meant for them. Unset (false) for a static token and DEV_SKIP_AUTH. */
  emailConfirmed?: boolean;
  /**
   * E.164 phone, for accounts created through SMS sign-in. Exactly one of
   * `email` / `phone` is set for a single-method account, so neither can be
   * treated as the identity — that is always `id`. This is only ever a label.
   */
  phone?: string;
  /** The raw Supabase JWT, used to build a RLS-scoped data client. */
  token?: string;
  /** When the account was made (ISO), as Supabase has it. Absent for a
   *  static token, which is no one's sign-up. */
  createdAt?: string;
  /** How the account signs in, as Supabase has it (app_metadata.provider):
   *  "email", "phone", "google", "apple". Absent for a static token. */
  provider?: string;
  /** The full name the sign-in provider gave (user_metadata.full_name, or
   *  .name): Google's, and Apple's on the first sign-in. Only a suggestion. */
  providerName?: string;
  /** Signed in with a terminal's own token (Xode in the terminal, auth/deviceTokens.ts): which terminal. Such a request
   *  only reaches Xode's routes (http/deviceScope.ts). */
  deviceId?: string;
}

/**
 * A Supabase client scoped to ONE user via their JWT. Queries run as that user,
 * so Row-Level Security applies (auth.uid() = user_id). This is what lets the
 * backend persist data with just the public anon key — no service-role secret.
 */
function userClient(token: string | undefined): SupabaseClient | null {
  const cfg = getConfig();
  if (!cfg.authEnabled || !token) return null;
  const key = cfg.SUPABASE_ANON_KEY ?? cfg.SUPABASE_SERVICE_KEY!;
  return createClient(cfg.SUPABASE_URL!, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The best data client for a user: the service-role admin client when it's
 * configured (bypasses RLS), else a JWT-scoped client (honours RLS). Returns
 * null only when neither is available (DEV_SKIP_AUTH → callers use memory).
 */
export function dataClientFor(user: AuthedUser): SupabaseClient | null {
  return supabase() ?? userClient(user.token);
}

/**
 * Resolve the user from an Authorization header value.
 *
 * - In DEV_SKIP_AUTH mode, returns a stable dev user so the pipeline runs with
 *   only Groq + OpenRouter keys.
 * - A terminal's device token (xdt_…) is read from the server's own table.
 * - Otherwise verifies the Supabase JWT and returns the real user.
 *
 * Returns null when the token is missing/invalid (caller should reject).
 */
export async function resolveUser(
  authorization: string | undefined,
): Promise<AuthedUser | null> {
  const cfg = getConfig();
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();

  // A terminal's own sign-in (Xode in the terminal, auth/deviceTokens.ts). Its prefix says what it is, so it is checked here,
  // before the Supabase round-trip, as the static tokens are: against the hash the server keeps, timing-safe, cached a minute.
  // Before DEV_SKIP_AUTH too, so a removed one is turned away on a dev server as well.
  if (token?.startsWith(DEVICE_TOKEN_PREFIX)) return deviceTokens().user(token);

  if (cfg.DEV_SKIP_AUTH) {
    return { id: "dev-user", email: "dev@flow.local" };
  }

  if (!token) return null;

  // Static bearer tokens (desktop app). Checked BEFORE the Supabase round-trip:
  // these are long random secrets from STATIC_BEARER_TOKENS, not JWTs, so they
  // never expire on the client. Each token maps to a stable synthetic user id
  // derived from its hash — per-token identity for metering/personality without
  // a Supabase account. Compare timing-safe so the list can't be probed.
  const staticUser = matchStaticToken(token, cfg.STATIC_BEARER_TOKENS);
  if (staticUser) return staticUser;

  const sb = verifyClient();
  if (!sb) return null;

  // digest() hands back a Buffer, which is identity-keyed in a Map: the hex of it is the key.
  const key = digest(token).toString("hex");
  const now = Date.now();
  const hit = verified.get(key);
  if (hit && hit.until > now) return hit.user;
  if (hit) verified.delete(key);

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;

  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && !!v.trim());
  const provider = typeof data.user.app_metadata?.provider === "string" ? data.user.app_metadata.provider : undefined;
  const user: AuthedUser = {
    id: data.user.id,
    email: data.user.email ?? undefined,
    emailConfirmed: !!data.user.email_confirmed_at,
    phone: data.user.phone ?? undefined,
    token,
    createdAt: data.user.created_at ?? undefined,
    ...(provider ? { provider } : {}),
    ...(metaName ? { providerName: metaName.trim().slice(0, 120) } : {}),
  };
  // Never past the token's own expiry, so a cached answer can never outlive the JWT it came from.
  const exp = expiryOf(token);
  const until = exp > 0 ? Math.min(now + VERIFY_CACHE_MS, exp) : now + VERIFY_CACHE_MS;
  if (until > now) {
    if (verified.size >= VERIFY_CACHE_MAX) {
      const oldest = verified.keys().next();
      if (!oldest.done) verified.delete(oldest.value);
    }
    verified.set(key, { user, until });
  }
  return user;
}

/**
 * Match a presented bearer against the STATIC_BEARER_TOKENS list (comma-
 * separated secrets), timing-safe (auth/secret.ts). Tokens shorter than 16
 * chars are ignored so a lazy "test" entry can't become an auth bypass. Returns
 * the synthetic user or null. AuthedUser.token is left unset on purpose: it's
 * not a Supabase JWT, so RLS-scoped clients can't use it — data helpers fall
 * back to the service-role client or memory.
 */
function matchStaticToken(
  presented: string,
  configured: string | undefined,
): AuthedUser | null {
  for (const raw of configured?.split(",") ?? []) {
    const secret = raw.trim();
    if (secret.length >= 16 && sameSecret(presented, secret)) {
      return { id: `static-${digest(secret).toString("hex").slice(0, 12)}` };
    }
  }
  return null;
}
