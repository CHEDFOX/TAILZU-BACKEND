/**
 * Razorpay: the desktop's way to pay, written to the same entitlement row a
 * phone purchase writes. Razorpay and the database are both stood in for:
 * Razorpay by a fake fetch that answers its REST routes, the database by an
 * in-memory entitlements table behind the Supabase client.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.RAZORPAY_KEY_ID = "rzp_test_abc123";
process.env.RAZORPAY_KEY_SECRET = "key-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "hook-secret";
process.env.RAZORPAY_PLAN_MONTHLY = "plan_Month1";
process.env.RAZORPAY_PLAN_YEARLY = "plan_Year1";
process.env.REVENUECAT_ENTITLEMENT = "TAILZU AIR";

const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  accounts: new Set<string>(),
}));
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const table = {
    select: () => ({
      eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: db.rows.get(id) ?? null, error: null }) }),
    }),
    upsert: async (row: Record<string, unknown>) => {
      db.rows.set(String(row.user_id), { ...(db.rows.get(String(row.user_id)) ?? {}), ...row });
      return { error: null };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: async (_c: string, id: string) => {
        if (db.rows.has(id)) db.rows.set(id, { ...db.rows.get(id)!, ...patch });
        return { error: null };
      },
    }),
  };
  const fake = {
    from: () => table,
    auth: { admin: { getUserById: async (id: string) => (db.accounts.has(id)
      ? { data: { user: { id } }, error: null }
      : { data: { user: null }, error: { message: "User not found" } }) } },
  };
  return { ...real, supabase: () => fake };
});

/** Razorpay's REST API, as far as this server uses it. */
const rz = vi.hoisted(() => ({
  subs: new Map<string, Record<string, unknown>>(),
  created: [] as Array<Record<string, unknown>>,
  cancelled: [] as string[],
  plans: {
    plan_Month1: { id: "plan_Month1", period: "monthly", interval: 1, item: { name: "Lite", amount: 19900, currency: "INR" } },
    plan_Year1: { id: "plan_Year1", period: "yearly", interval: 1, item: { name: "Elite", amount: 149900, currency: "INR" } },
  } as Record<string, unknown>,
}));
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const u = String(url);
    if (!u.startsWith("https://api.razorpay.com/v1/")) return realFetch(url as never, init as never);
    expect(init?.headers?.Authorization).toBe(`Basic ${Buffer.from("rzp_test_abc123:key-secret").toString("base64")}`);
    const path = u.slice("https://api.razorpay.com/v1".length);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/plans\/(\w+)$/))) return rz.plans[m[1]!] ? json(200, rz.plans[m[1]!]) : json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
    if (path === "/subscriptions" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      rz.created.push(body);
      const sub = { id: `sub_New${rz.created.length}`, plan_id: body.plan_id, status: "created", notes: body.notes };
      rz.subs.set(sub.id, sub);
      return json(200, sub);
    }
    if ((m = path.match(/^\/subscriptions\/(\w+)\/cancel$/))) {
      rz.cancelled.push(m[1]!);
      return json(200, { ...rz.subs.get(m[1]!), status: "active" });
    }
    if ((m = path.match(/^\/subscriptions\/(\w+)$/))) return rz.subs.has(m[1]!) ? json(200, rz.subs.get(m[1]!)) : json(400, { error: { code: "BAD_REQUEST_ERROR", description: "no such id" } });
    return json(404, {});
  }) as never;
});
afterAll(() => { globalThis.fetch = realFetch; });

const rzp = await import("../src/billing/razorpay.js");
const { getEntitlement, applyRevenueCatEvent, forgetEntitlement } = await import("../src/billing/entitlements.js");

const USER = "11111111-2222-3333-4444-555555555555";
const OTHER = "66666666-7777-8888-9999-000000000000";
const day = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_A", plan_id: "plan_Month1", status: "active",
  current_start: now() - 5 * day, current_end: now() + 25 * day, notes: { app_user_id: USER }, ...over,
});
const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

beforeEach(() => {
  db.rows.clear(); db.accounts.clear(); db.accounts.add(USER);
  rz.subs.clear(); rz.created.length = 0; rz.cancelled.length = 0;
  forgetEntitlement(USER);
  rzp.forgetPlans();
});

describe("signatures", () => {
  it("a checkout is genuine only with Razorpay's signature over payment|subscription", () => {
    const good = sign("key-secret", "pay_1|sub_A");
    expect(rzp.checkoutSignatureOk("pay_1", "sub_A", good)).toBe(true);
    expect(rzp.checkoutSignatureOk("pay_1", "sub_B", good)).toBe(false);
    expect(rzp.checkoutSignatureOk("pay_1", "sub_A", "0".repeat(64))).toBe(false);
    expect(rzp.checkoutSignatureOk("pay_1", "sub_A", "")).toBe(false);
  });

  it("a webhook is genuine only with the webhook secret over the exact body", () => {
    const raw = '{"event":"subscription.charged"}';
    expect(rzp.webhookSignatureOk(raw, sign("hook-secret", raw))).toBe(true);
    expect(rzp.webhookSignatureOk(raw + " ", sign("hook-secret", raw))).toBe(false);
    expect(rzp.webhookSignatureOk(raw, sign("key-secret", raw))).toBe(false);
  });

  it("a manage link opens one account's plan, and only until it expires", () => {
    const link = new URL(rzp.manageLink(USER)!);
    expect(link.origin + link.pathname).toBe("https://tailzu.space/pay/manage");
    const [u, e, t] = ["u", "e", "t"].map((k) => link.searchParams.get(k));
    expect(rzp.manageLinkUser(u, e, t)).toBe(USER);
    expect(rzp.manageLinkUser(OTHER, e, t)).toBeNull();
    expect(rzp.manageLinkUser(u, String(Number(e) + day), t)).toBeNull();
    const old = new URL(rzp.manageLink(USER, Date.now() - 30 * day * 1000)!);
    expect(rzp.manageLinkUser(old.searchParams.get("u"), old.searchParams.get("e"), old.searchParams.get("t"))).toBeNull();
  });
});

describe("prices, as Razorpay holds them", () => {
  it("reads like a price", async () => {
    expect(rzp.formatPrice((await rzp.fetchPlan("plan_Month1"))!)).toBe("₹199");
    expect(rzp.formatPrice((await rzp.fetchPlan("plan_Year1"))!)).toBe("₹1,499");
    expect(rzp.formatPeriod((await rzp.fetchPlan("plan_Year1"))!)).toBe("a year");
    expect(rzp.formatPrice({ id: "p", period: "monthly", interval: 1, item: { amount: 999, currency: "USD" } })).toBe("$9.99");
    expect(await rzp.fetchPlan("plan_Missing")).toBeNull();
  });
});

describe("a subscription's state becomes the entitlement row", () => {
  it("an active subscription grants, to the account in its notes, until its period ends", async () => {
    const res = await rzp.applyRazorpaySubscription(sub(), "subscription.charged");
    expect(res).toMatchObject({ ok: true, userId: USER, active: true });
    const row = db.rows.get(USER)!;
    expect(row).toMatchObject({ active: true, store: "razorpay", subscription_id: "sub_A", entitlement: "TAILZU AIR", environment: "SANDBOX" });
    expect(Date.parse(String(row.expires_at))).toBe(sub().current_end * 1000);
    const ent = await getEntitlement({ id: USER } as never);
    expect(ent).toMatchObject({ active: true, store: "razorpay" });
    expect(ent!.manageUrl).toMatch(/^https:\/\/tailzu\.space\/pay\/manage\?u=/);
  });

  it("is not about Tailzu when the plan is not ours, and is about nobody with no account id", async () => {
    expect((await rzp.applyRazorpaySubscription(sub({ plan_id: "plan_Other" }), "subscription.charged")).reason).toContain("not a Tailzu plan");
    expect((await rzp.applyRazorpaySubscription(sub({ notes: [] }), "subscription.charged")).ok).toBe(false);
    expect(db.rows.size).toBe(0);
  });

  it("grants nothing before anything is charged", async () => {
    await rzp.applyRazorpaySubscription(sub({ status: "authenticated" }), "subscription.authenticated");
    expect(db.rows.size).toBe(0);
  });

  it("cancelled keeps what was paid for; halted ends it now", async () => {
    await rzp.applyRazorpaySubscription(sub(), "subscription.charged");
    await rzp.applyRazorpaySubscription(sub({ status: "cancelled" }), "subscription.cancelled");
    expect(db.rows.get(USER)!.active).toBe(true);
    await rzp.applyRazorpaySubscription(sub({ status: "halted" }), "subscription.halted");
    expect(db.rows.get(USER)!.active).toBe(false);
  });

  it("a late charge for an earlier period does not pull the end date back", async () => {
    await rzp.applyRazorpaySubscription(sub({ current_end: now() + 60 * day }), "subscription.charged");
    await rzp.applyRazorpaySubscription(sub({ current_end: now() + 25 * day }), "subscription.charged");
    expect(Date.parse(String(db.rows.get(USER)!.expires_at))).toBe((now() + 60 * day) * 1000);
  });

  it("an old subscription ending does not end the new one, nor one from the App Store", async () => {
    await rzp.applyRazorpaySubscription(sub({ id: "sub_New" }), "subscription.charged");
    const old = await rzp.applyRazorpaySubscription(sub({ id: "sub_Old", status: "halted" }), "subscription.halted");
    expect(old.reason).toContain("ignored");
    expect(db.rows.get(USER)!.active).toBe(true);

    db.rows.set(USER, { user_id: USER, active: true, store: "app_store", expires_at: new Date(Date.now() + 9e8).toISOString() });
    await rzp.applyRazorpaySubscription(sub({ status: "halted" }), "subscription.halted");
    expect(db.rows.get(USER)!.store).toBe("app_store");
  });

  it("RevenueCat's expiry for another store does not switch off a live Razorpay subscription", async () => {
    await rzp.applyRazorpaySubscription(sub(), "subscription.charged");
    const res = await applyRevenueCatEvent({ type: "EXPIRATION", app_user_id: USER, entitlement_ids: ["TAILZU AIR"], store: "APP_STORE" }, "TAILZU AIR");
    expect(res.reason).toContain("live Razorpay subscription");
    expect(db.rows.get(USER)!.active).toBe(true);
  });

  it("a lapsed row is asked about before it is believed: a missed renewal does not end access", async () => {
    db.rows.set(USER, { user_id: USER, entitlement: "TAILZU AIR", active: true, store: "razorpay", subscription_id: "sub_A",
      expires_at: new Date(Date.now() - 5 * day * 1000).toISOString() });
    rz.subs.set("sub_A", sub({ current_end: now() + 20 * day }));
    const ent = await getEntitlement({ id: USER } as never);
    expect(ent).toMatchObject({ active: true, store: "razorpay" });
    expect(Date.parse(String(db.rows.get(USER)!.expires_at))).toBe((now() + 20 * day) * 1000);
  });

  it("a renewal still being retried keeps access through the grace", async () => {
    db.rows.set(USER, { user_id: USER, entitlement: "TAILZU AIR", active: true, store: "razorpay", subscription_id: "sub_A",
      expires_at: new Date(Date.now() - 3600_000).toISOString() });
    expect(await getEntitlement({ id: USER } as never)).not.toBeNull();
  });
});

describe("the routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/server.js");
    app = await buildApp(); await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("the pay page shows Razorpay's prices and the saving between them", async () => {
    const r = await app.inject({ method: "GET", url: "/pay" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("₹199");
    expect(r.body).toContain("₹1,499");
    expect(r.body).toContain("Save 35%");
    expect(r.body).toContain('"key":"rzp_test_abc123"');
    expect(r.body).not.toContain("key-secret");
  });

  it("makes a subscription carrying the account id, for an account that exists and does not already pay", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { user: USER, plan: "annual" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().subscriptionId).toMatch(/^sub_/);
    expect(rz.created[0]).toMatchObject({ plan_id: "plan_Year1", notes: { app_user_id: USER }, total_count: 10 });

    expect((await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { user: OTHER, plan: "annual" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { user: USER, plan: "lifetime" } })).statusCode).toBe(400);

    await rzp.applyRazorpaySubscription(sub(), "subscription.charged");
    const again = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { user: USER, plan: "monthly" } });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_subscribed");
  });

  it("a checkout's success unlocks at once, and only with Razorpay's signature", async () => {
    rz.subs.set("sub_A", sub());
    const bad = await app.inject({ method: "POST", url: "/v1/pay/razorpay/verify",
      payload: { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_A", razorpay_signature: "f".repeat(64) } });
    expect(bad.statusCode).toBe(400);
    expect(db.rows.size).toBe(0);
    const ok = await app.inject({ method: "POST", url: "/v1/pay/razorpay/verify",
      payload: { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_A", razorpay_signature: sign("key-secret", "pay_1|sub_A") } });
    expect(ok.json()).toEqual({ ok: true, active: true });
    expect(db.rows.get(USER)!.active).toBe(true);
  });

  it("the webhook checks the signature over the raw body, then writes the row", async () => {
    const payload = JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: sub() } } });
    const forged = await app.inject({ method: "POST", url: "/v1/billing/razorpay", payload,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign("wrong", payload) } });
    expect(forged.statusCode).toBe(401);
    expect(db.rows.size).toBe(0);
    const real = await app.inject({ method: "POST", url: "/v1/billing/razorpay", payload,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign("hook-secret", payload) } });
    expect(real.statusCode).toBe(200);
    expect(db.rows.get(USER)).toMatchObject({ active: true, store: "razorpay", last_event: "subscription.charged" });
    const other = JSON.stringify({ event: "payment.captured", payload: {} });
    const ignored = await app.inject({ method: "POST", url: "/v1/billing/razorpay", payload: other,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign("hook-secret", other) } });
    expect(ignored.statusCode).toBe(200);
  });

  it("the manage link shows the plan and cancels at the end of the period", async () => {
    rz.subs.set("sub_A", sub({ plan_id: "plan_Year1" }));
    await rzp.applyRazorpaySubscription(rz.subs.get("sub_A") as never, "subscription.charged");
    const link = new URL(rzp.manageLink(USER)!);
    const page = await app.inject({ method: "GET", url: `/pay/manage${link.search}` });
    expect(page.body).toContain("Elite, yearly");
    expect(page.body).toContain('id="cancel"');

    const q = Object.fromEntries(link.searchParams);
    expect((await app.inject({ method: "POST", url: "/v1/pay/razorpay/cancel", payload: { ...q, t: "nope" } })).statusCode).toBe(401);
    const c = await app.inject({ method: "POST", url: "/v1/pay/razorpay/cancel", payload: q });
    expect(c.json()).toEqual({ ok: true });
    expect(rz.cancelled).toEqual(["sub_A"]);
    // Still paid up, and the page now says it will not renew.
    expect(db.rows.get(USER)!.active).toBe(true);
    expect((await app.inject({ method: "GET", url: `/pay/manage${link.search}` })).body).toContain("will not renew");

    expect((await app.inject({ method: "GET", url: "/pay/manage?u=x&e=1&t=y" })).body).toContain("This link has expired");
  });
});
