/**
 * LOCAL user-JWT verification — no network round-trip.
 *
 * `resolveUser` (supabase.ts) verifies tokens by calling Supabase's /auth/v1/user
 * endpoint, which is authoritative (it also catches server-side revocation) but
 * costs a network hop. That's fine on a route handler, but far too expensive for
 * the rate-limiter's keyGenerator, which runs on EVERY request BEFORE the handler
 * — verifying there would let an attacker amplify load against the auth API.
 *
 * So for the *rate-limit key only* we verify the JWT's signature LOCALLY and read
 * the `sub` (user id). Local verification is cheap and, crucially, safe as a
 * limiter key: a forged/expired/wrong-alg token fails verification and we fall
 * back to per-IP keying — an attacker can't mint fresh per-user buckets with
 * random tokens the way raw-token keying allowed.
 *
 * Two key sources, tried in order:
 *   1. HS256 shared secret (SUPABASE_JWT_SECRET) — Supabase's default signing.
 *   2. Asymmetric keys via the project JWKS endpoint — for projects that have
 *      migrated to ES256/RS256 signing keys (no shared secret to configure).
 * When neither can verify, `localUserId` returns null and the caller keys by IP.
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { getConfig } from "../config.js";

let hsSecret: Uint8Array | null | undefined; // undefined = not yet resolved
let jwks: JWTVerifyGetKey | null | undefined;

function symmetricKey(): Uint8Array | null {
  if (hsSecret === undefined) {
    const s = getConfig().SUPABASE_JWT_SECRET;
    hsSecret = s ? new TextEncoder().encode(s) : null;
  }
  return hsSecret;
}

function jwksKey(): JWTVerifyGetKey | null {
  if (jwks === undefined) {
    const url = getConfig().SUPABASE_URL;
    jwks = url
      ? createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", url))
      : null;
  }
  return jwks;
}

/**
 * Verify `authorization` locally and return the user id (`sub`), or null if the
 * token is missing/invalid/expired or no key source is configured. Never throws.
 */
export async function localUserId(authorization: string | undefined): Promise<string | null> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  // HS256 first (the common Supabase case, fully local — no network ever).
  const secret = symmetricKey();
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      if (typeof payload.sub === "string" && payload.sub) return payload.sub;
    } catch {
      /* fall through to JWKS, then to null */
    }
  }

  // Asymmetric keys via JWKS (cached by jose; network only on key rotation).
  const keys = jwksKey();
  if (keys) {
    try {
      const { payload } = await jwtVerify(token, keys, { algorithms: ["ES256", "RS256"] });
      if (typeof payload.sub === "string" && payload.sub) return payload.sub;
    } catch {
      /* invalid / unfetchable → null */
    }
  }

  return null;
}

/** Test/hot-reload aid: drop the cached key material so config changes re-read. */
export function _resetJwtKeyCache(): void {
  hsSecret = undefined;
  jwks = undefined;
}
