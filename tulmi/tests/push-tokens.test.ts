import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryPushTokens, SupabasePushTokens, registerPushTokenRoutes } from "../src/push/tokens.js";

// One phone, two accounts. A token belongs to the phone, so after A signs out
// and B signs in, A's pushes must not keep arriving on B's lock screen.

async function server(tokens = new MemoryPushTokens()) {
  const app = Fastify();
  registerPushTokenRoutes(app, {
    // "Bearer A" is user A; anything else is nobody.
    resolveUser: async (h) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id && /^[A-Z]$/.test(id) ? { id } : null;
    },
    tokens: () => tokens,
  });
  await app.ready();
  return { app, tokens };
}

const post = (app: Awaited<ReturnType<typeof server>>["app"], url: string, who: string | null, payload: unknown) =>
  app.inject({ method: "POST", url, payload: payload as object, headers: who ? { authorization: `Bearer ${who}` } : {} });

describe("a push token after switching accounts", () => {
  it("belongs to whoever registered it last, and to nobody else", async () => {
    const { app, tokens } = await server();
    expect((await post(app, "/v1/push/register", "A", { token: "ExponentPushToken[phone-1]", platform: "ios" })).statusCode).toBe(200);
    expect(tokens.rows.map((r) => r.userId)).toEqual(["A"]);

    // A signs out without reaching the server (offline, expired session); B
    // signs in on the same phone. A's row with that token must go.
    expect((await post(app, "/v1/push/register", "B", { token: "ExponentPushToken[phone-1]", platform: "ios" })).statusCode).toBe(200);
    expect(tokens.rows).toEqual([{ userId: "B", platform: "ios", token: "ExponentPushToken[phone-1]", appVersion: null }]);
    await app.close();
  });

  it("leaves another account's OTHER phones alone", async () => {
    const { app, tokens } = await server();
    await post(app, "/v1/push/register", "A", { token: "ExponentPushToken[a-android]", platform: "android" });
    await post(app, "/v1/push/register", "A", { token: "ExponentPushToken[shared-ios]", platform: "ios" });
    await post(app, "/v1/push/register", "B", { token: "ExponentPushToken[shared-ios]", platform: "ios" });
    expect(tokens.rows.filter((r) => r.userId === "A").map((r) => r.token)).toEqual(["ExponentPushToken[a-android]"]);
    expect(tokens.rows.filter((r) => r.userId === "B").map((r) => r.token)).toEqual(["ExponentPushToken[shared-ios]"]);
    await app.close();
  });

  it("is given up on sign-out — the caller's own row only", async () => {
    const { app, tokens } = await server();
    await post(app, "/v1/push/register", "A", { token: "ExponentPushToken[a]", platform: "ios" });
    await post(app, "/v1/push/register", "B", { token: "ExponentPushToken[b]", platform: "ios" });
    // B cannot make A's phone go quiet by naming A's token.
    await post(app, "/v1/push/unregister", "B", { token: "ExponentPushToken[a]" });
    expect(tokens.rows.map((r) => r.userId).sort()).toEqual(["A", "B"]);
    // A signing out does.
    expect((await post(app, "/v1/push/unregister", "A", { token: "ExponentPushToken[a]" })).json()).toEqual({ ok: true });
    expect(tokens.rows.map((r) => r.userId)).toEqual(["B"]);
    await app.close();
  });

  it("asks who is calling, and what", async () => {
    const { app } = await server();
    expect((await post(app, "/v1/push/register", null, { token: "ExponentPushToken[x]", platform: "ios" })).statusCode).toBe(401);
    expect((await post(app, "/v1/push/unregister", null, { token: "ExponentPushToken[x]" })).statusCode).toBe(401);
    expect((await post(app, "/v1/push/register", "A", { token: "ExponentPushToken[x]", platform: "web" })).statusCode).toBe(400);
    expect((await post(app, "/v1/push/unregister", "A", {})).statusCode).toBe(400);
    await app.close();
  });

  it("answers ok with no database, and stores nothing", async () => {
    const app = Fastify();
    registerPushTokenRoutes(app, { resolveUser: async () => ({ id: "A" }), tokens: () => null });
    await app.ready();
    expect((await post(app, "/v1/push/register", "A", { token: "ExponentPushToken[x]", platform: "ios" })).json()).toEqual({ ok: true });
    expect((await post(app, "/v1/push/unregister", "A", { token: "ExponentPushToken[x]" })).json()).toEqual({ ok: true });
    await app.close();
  });
});

describe("the Supabase store says the same thing in SQL", () => {
  /** Records each query as table + verb + filters; every call succeeds. */
  function fakeSb() {
    const calls: string[] = [];
    const builder = (table: string) => {
      let q = table;
      const b = {
        delete: () => { q += " delete"; return b; },
        upsert: (row: Record<string, unknown>, o: { onConflict: string }) => {
          calls.push(`${table} upsert ${row.user_id}/${row.platform}/${row.token} on ${o.onConflict}`);
          return Promise.resolve({ error: null });
        },
        eq: (c: string, v: string) => { q += ` ${c}=${v}`; return b; },
        neq: (c: string, v: string) => { q += ` ${c}!=${v}`; return b; },
        then: (res: (v: { error: null }) => void) => { calls.push(q); res({ error: null }); },
      };
      return b;
    };
    return { sb: { from: builder } as unknown as SupabaseClient, calls };
  }

  it("takes the token from every other account before claiming it", async () => {
    const { sb, calls } = fakeSb();
    await new SupabasePushTokens(sb).register({ userId: "B", platform: "ios", token: "T" });
    expect(calls).toEqual([
      "push_tokens delete token=T user_id!=B",
      "push_tokens upsert B/ios/T on user_id,platform",
    ]);
  });

  it("gives up only the caller's own row", async () => {
    const { sb, calls } = fakeSb();
    await new SupabasePushTokens(sb).unregister("A", "T");
    expect(calls).toEqual(["push_tokens delete user_id=A token=T"]);
  });
});
