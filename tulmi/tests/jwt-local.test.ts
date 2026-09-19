import { describe, expect, it, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";

/**
 * localUserId() verifies a user JWT LOCALLY (no network) so the rate limiter can
 * key on the verified user id. The security property under test: only a token
 * that verifies against the configured secret yields an id; anything else
 * (forged, expired, wrong-alg, missing) returns null so the caller keys by IP —
 * an attacker can't mint fresh per-user buckets with random tokens.
 */
const SECRET = "test-jwt-secret-value-at-least-32-bytes-long";
const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
}

async function freshVerifier(env: Record<string, string> = {}) {
  vi.resetModules();
  resetEnv();
  // Baseline valid env so getConfig() passes validation (same priming pattern
  // as the other store tests). DEV_SKIP_AUTH keeps it self-contained; the
  // verifier only reads SUPABASE_URL + SUPABASE_JWT_SECRET.
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.STT_PROVIDER = "openai";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  Object.assign(process.env, env);
  const mod = await import("../src/auth/jwt.js");
  return mod.localUserId;
}

function sign(secret: string, claims: Record<string, unknown>, expSecondsFromNow = 3600) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(new TextEncoder().encode(secret));
}

describe("localUserId — local JWT verification for rate-limit keying", () => {
  beforeEach(() => resetEnv());

  it("returns the sub for a validly-signed, unexpired token", async () => {
    const localUserId = await freshVerifier({ SUPABASE_JWT_SECRET: SECRET });
    const token = await sign(SECRET, { sub: "user-123", aud: "authenticated" });
    expect(await localUserId(`Bearer ${token}`)).toBe("user-123");
  });

  it("returns null for a token signed with the WRONG secret (forged)", async () => {
    const localUserId = await freshVerifier({ SUPABASE_JWT_SECRET: SECRET });
    const token = await sign("some-other-attacker-secret-value-32bytes!!", { sub: "attacker" });
    expect(await localUserId(`Bearer ${token}`)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const localUserId = await freshVerifier({ SUPABASE_JWT_SECRET: SECRET });
    const token = await sign(SECRET, { sub: "user-123" }, -60); // expired 60s ago
    expect(await localUserId(`Bearer ${token}`)).toBeNull();
  });

  it("returns null when no secret is configured (degrades to per-IP keying)", async () => {
    const localUserId = await freshVerifier(); // no SUPABASE_JWT_SECRET
    const token = await sign(SECRET, { sub: "user-123" });
    expect(await localUserId(`Bearer ${token}`)).toBeNull();
  });

  it("returns null for missing / empty / malformed authorization", async () => {
    const localUserId = await freshVerifier({ SUPABASE_JWT_SECRET: SECRET });
    expect(await localUserId(undefined)).toBeNull();
    expect(await localUserId("")).toBeNull();
    expect(await localUserId("Bearer ")).toBeNull();
    expect(await localUserId("Bearer not.a.jwt")).toBeNull();
  });

  it("returns null for a valid signature but no sub claim", async () => {
    const localUserId = await freshVerifier({ SUPABASE_JWT_SECRET: SECRET });
    const token = await sign(SECRET, { aud: "authenticated" }); // no sub
    expect(await localUserId(`Bearer ${token}`)).toBeNull();
  });
});
