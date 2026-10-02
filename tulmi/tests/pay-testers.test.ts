/**
 * Proving the live checkout while Tailzu is free: only accounts named in
 * PAY_TESTERS can open the pay page or start a subscription; everyone else is
 * still sent to /pricing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.FREE_FOR_ALL = "true";
process.env.RAZORPAY_KEY_ID = "rzp_live_abc123";
process.env.RAZORPAY_KEY_SECRET = "key-secret";
process.env.RAZORPAY_PLANS = "IN:monthly:plan_InM,IN:annual:plan_InY";

const TESTER = "11111111-2222-3333-4444-555555555555";
const OTHER = "66666666-7777-8888-9999-000000000000";
process.env.PAY_TESTERS = ` ${TESTER.toUpperCase()} ,not-an-id`;

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const none = { data: null, error: null };
  const q = {
    eq: () => ({ maybeSingle: async () => none, order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  };
  const fake = { from: () => ({ select: () => q, insert: async () => ({ error: null }), upsert: async () => ({ error: null }) }) };
  return { ...real, supabase: () => fake };
});

const realFetch = globalThis.fetch;
const created: string[] = [];
beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (!u.startsWith("https://api.razorpay.com/v1/")) return realFetch(url as never, init as never);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("/plans/")) return ok({ id: u.split("/").pop(), period: "monthly", interval: 1, item: { amount: 19900, currency: "INR" } });
    if (u.endsWith("/subscriptions") && init?.method === "POST") {
      created.push(JSON.parse(String(init.body)).notes.user_id);
      return ok({ id: "sub_T1", status: "created" });
    }
    return new Response("{}", { status: 404 });
  }) as never;
});
afterAll(() => { globalThis.fetch = realFetch; });

const { payLink, payTester } = await import("../src/billing/razorpay.js");
const caller = (id: string) => Object.fromEntries(new URL(payLink("https://tailzu.space/pay", id)!).searchParams);
const qs = (id: string) => new URL(payLink("https://tailzu.space/pay", id)!).search;

describe("buying while Tailzu is free", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/server.js");
    app = await buildApp(); await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("knows its testers by exact id, and nobody else", () => {
    expect(payTester(TESTER)).toBe(true);
    expect(payTester(OTHER)).toBe(false);
    expect(payTester("not-an-id")).toBe(false);
    expect(payTester(undefined)).toBe(false);
  });

  it("opens the pay page for a tester's signed link, and sends everyone else to /pricing", async () => {
    expect((await app.inject({ method: "GET", url: `/pay${qs(TESTER)}` })).statusCode).toBe(200);
    for (const url of ["/pay", `/pay${qs(OTHER)}`, `/pay?u=${TESTER}&e=9999999999&t=forged`]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(302);
      expect(r.headers.location).toBe("/pricing");
    }
  });

  it("lets a tester start a subscription, and refuses everyone else", async () => {
    const other = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { ...caller(OTHER), market: "IN", period: "monthly" } });
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe("free");
    const mine = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { ...caller(TESTER), market: "IN", period: "monthly" } });
    expect(mine.statusCode).toBe(200);
    expect(created).toEqual([TESTER]);
  });
});
