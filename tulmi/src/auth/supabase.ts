/**
 * Supabase client + auth helpers (server-side, uses the SERVICE ROLE key).
 *
 * The SERVICE ROLE key bypasses row-level security and must NEVER be shipped to
 * a client. The Android app authenticates the user with the ANON key, gets a
 * JWT, and sends it to us; we verify it here to resolve the user id.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";

let client: SupabaseClient | null = null;
let verifier: SupabaseClient | null = null;

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
  /** The raw Supabase JWT, used to build a RLS-scoped data client. */
  token?: string;
}

/**
 * A Supabase client scoped to ONE user via their JWT. Queries run as that user,
 * so Row-Level Security applies (auth.uid() = user_id). This is what lets the
 * backend persist data with just the public anon key — no service-role secret.
 */
export function userClient(token: string | undefined): SupabaseClient | null {
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
 * - Otherwise verifies the Supabase JWT and returns the real user.
 *
 * Returns null when the token is missing/invalid (caller should reject).
 */
export async function resolveUser(
  authorization: string | undefined,
): Promise<AuthedUser | null> {
  const cfg = getConfig();

  if (cfg.DEV_SKIP_AUTH) {
    return { id: "dev-user", email: "dev@flow.local" };
  }

  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
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

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? undefined, token };
}

/**
 * Match a presented bearer against the STATIC_BEARER_TOKENS list (comma-
 * separated secrets). Comparison is over SHA-256 digests via timingSafeEqual —
 * constant-time and length-independent. Tokens shorter than 16 chars are
 * ignored so a lazy "test" entry can't become an auth bypass. Returns the
 * synthetic user or null. AuthedUser.token is left unset on purpose: it's not a
 * Supabase JWT, so RLS-scoped clients can't use it — data helpers fall back to
 * the service-role client or memory.
 */
function matchStaticToken(
  presented: string,
  configured: string | undefined,
): AuthedUser | null {
  if (!configured) return null;
  const presentedHash = createHash("sha256").update(presented).digest();
  for (const raw of configured.split(",")) {
    const secret = raw.trim();
    if (secret.length < 16) continue;
    const secretHash = createHash("sha256").update(secret).digest();
    if (timingSafeEqual(presentedHash, secretHash)) {
      const idTag = secretHash.toString("hex").slice(0, 12);
      return { id: `static-${idTag}`, email: undefined };
    }
  }
  return null;
}
