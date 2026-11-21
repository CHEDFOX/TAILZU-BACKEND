/**
 * A VERIFIED JWT IS TRUSTED FOR A MINUTE, NOT ASKED FOR AGAIN (auth/supabase.ts).
 *
 * A Bots screen is not one request. It builds by calling the app's own routes in-process on the person's behalf
 * (experience/bots/deps.ts, fastify inject, carrying their `authorization`), so opening one costs 1 + N verifications —
 * about eleven on Home. Every one of those was a network round-trip to Supabase BEFORE the screen could start being
 * built. That is most of what "the navigation feels slow" was, and it got worse the richer a screen got.
 *
 * The same minute, for the same reason, as a device token's (auth/deviceTokens.ts CACHE_MS).
 *
 * What is held down here is the part that could go wrong: that a failure is never cached, that a cached answer never
 * outlives the token's own `exp`, and that two different tokens never see each other's user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
});

/** How many times the verifier was asked, and what it answers next. */
const calls: string[] = [];
let answer: (token: string) => { data: { user: unknown }; error: unknown } = () => ({ data: { user: null }, error: new Error("no") });

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        calls.push(token);
        return answer(token);
      },
    },
  }),
}));

const { resolveUser, forgetVerifiedTokens, VERIFY_CACHE_MS } = await import("../src/auth/supabase.js");

/** A JWT whose payload says it expires `secs` from now. Only the middle part is ever read. */
function jwt(id: string, secs: number): string {
  const body = Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + secs })).toString("base64url");
  return `header.${body}.signature`;
}
const userFor = (id: string) => ({ data: { user: { id, email: `${id}@x.test`, user_metadata: {}, app_metadata: {} } }, error: null });

describe("verifying a user's token", () => {
  beforeEach(() => { calls.length = 0; forgetVerifiedTokens(); vi.useRealTimers(); });
  afterEach(() => { vi.useRealTimers(); forgetVerifiedTokens(); });

  it("asks Supabase once, then answers the same token from memory — which is the 1 + N a screen costs", async () => {
    const t = jwt("u1", 3600);
    answer = () => userFor("u1");
    const first = await resolveUser(`Bearer ${t}`);
    expect(first?.id).toBe("u1");
    // Ten more, as a screen's own reads would be.
    for (let i = 0; i < 10; i++) expect((await resolveUser(`Bearer ${t}`))?.id).toBe("u1");
    expect(calls).toHaveLength(1);
  });

  it("never lets one token's answer stand in for another's", async () => {
    answer = (tok) => userFor(tok.includes(Buffer.from('{"sub":"u1"').toString("base64url").slice(0, 8)) ? "u1" : "u2");
    const a = jwt("u1", 3600);
    const b = jwt("u2", 3600);
    answer = () => userFor("u1");
    expect((await resolveUser(`Bearer ${a}`))?.id).toBe("u1");
    answer = () => userFor("u2");
    expect((await resolveUser(`Bearer ${b}`))?.id).toBe("u2");
    expect((await resolveUser(`Bearer ${a}`))?.id).toBe("u1");
    expect(calls).toHaveLength(2);
  });

  it("does not cache a refusal, so a token that becomes good works at once and not in a minute", async () => {
    const t = jwt("u1", 3600);
    answer = () => ({ data: { user: null }, error: new Error("bad") });
    expect(await resolveUser(`Bearer ${t}`)).toBeNull();
    expect(await resolveUser(`Bearer ${t}`)).toBeNull();
    expect(calls).toHaveLength(2);
    answer = () => userFor("u1");
    expect((await resolveUser(`Bearer ${t}`))?.id).toBe("u1");
    expect(calls).toHaveLength(3);
  });

  it("asks again once the minute is up", async () => {
    const t = jwt("u1", 3600);
    answer = () => userFor("u1");
    await resolveUser(`Bearer ${t}`);
    expect(calls).toHaveLength(1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + VERIFY_CACHE_MS + 1);
    await resolveUser(`Bearer ${t}`);
    expect(calls).toHaveLength(2);
  });

  it("never trusts a cached answer past the token's own expiry, however short", async () => {
    // Ten seconds of life left: the minute must not extend it.
    const t = jwt("u1", 10);
    answer = () => userFor("u1");
    await resolveUser(`Bearer ${t}`);
    expect(calls).toHaveLength(1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11_000);
    await resolveUser(`Bearer ${t}`);
    expect(calls).toHaveLength(2);
  });
});
