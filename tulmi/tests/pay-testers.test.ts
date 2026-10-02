/**
 * Proving the live checkout while Tailzu is free: only a TEST link, which
 * scripts/paylink.sh makes on the server, opens the pay page or starts a
 * subscription. An ordinary link, a forged one, or none at all is still sent
 * to /pricing.
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

const ME = "11111111-2222-3333-4444-555555555555";

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const none = { data: null, error: null };
  const q = {
    eq: () => ({ maybeSingle: async () => none, order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  };
  const fake = {
    from: () => ({ select: () => q, insert: async () => ({ error: null }), upsert: async () => ({ error: null }) }),
    auth: { admin: { listUsers: async () => ({ data: { users: [{ id: ME, email: "Me@Example.com" }, { id: "x", email: "other@example.com" }] }, error: null }) } },
  };
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

const { accountIdFor, payCaller, payLink } = await import("../src/billing/razorpay.js");
const link = (test: boolean) => new URL(payLink("https://tailzu.space/pay", ME, Date.now(), test)!);
const fields = (test: boolean) => Object.fromEntries(link(test).searchParams);

describe("a test link", () => {
  it("is found from an email, and is signed apart from an ordinary link", async () => {
    expect(await accountIdFor(" me@example.COM ")).toBe(ME);
    expect(await accountIdFor("nobody@example.com")).toBeNull();
    expect(payCaller(fields(true))).toEqual({ userId: ME, test: true });
    expect(payCaller(fields(false))).toEqual({ userId: ME, test: false });
    // An ordinary link with x=1 added is not a test link: the signature differs.
    expect(payCaller({ ...fields(false), x: "1" })).toBeNull();
  });

  it("lasts a day", () => {
    expect(Number(fields(true).e) - Date.now() / 1000).toBeLessThanOrEqual(86_400);
    expect(payCaller(fields(true), Date.now() + 2 * 86_400_000)).toBeNull();
  });
});

describe("buying while Tailzu is free", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/server.js");
    app = await buildApp(); await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("opens the pay page for a test link, and sends everything else to /pricing", async () => {
    const r = await app.inject({ method: "GET", url: `/pay${link(true).search}` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('x: q.get("x")');
    for (const url of ["/pay", `/pay${link(false).search}`, `/pay?u=${ME}&e=9999999999&x=1&t=forged`]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(302);
      expect(res.headers.location).toBe("/pricing");
    }
  });

  it("starts a subscription only from a test link", async () => {
    const plain = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { ...fields(false), market: "IN", period: "monthly" } });
    expect(plain.statusCode).toBe(409);
    expect(plain.json().code).toBe("free");
    const test = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { ...fields(true), market: "IN", period: "monthly" } });
    expect(test.statusCode).toBe(200);
    expect(created).toEqual([ME]);
  });
});
