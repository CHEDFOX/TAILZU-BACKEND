/**
 * Razorpay web subscriptions, driven from the server. Razorpay and the
 * database are both stood in for: Razorpay by a fake fetch answering its REST
 * routes, the database by in-memory tables behind the Supabase client.
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
process.env.RAZORPAY_PLANS = "IN:monthly:plan_InM,IN:annual:plan_InY,world:monthly:plan_WoM,world:annual:plan_WoY,bad:entry,IN:weekly:plan_X";
process.env.REVENUECAT_ENTITLEMENT = "TAILZU AIR";

const USER = "11111111-2222-3333-4444-555555555555";
const OTHER = "66666666-7777-8888-9999-000000000000";

/** Two tables, keyed as the real ones are. */
const db = vi.hoisted(() => ({
  entitlements: new Map<string, Record<string, unknown>>(),        // by user_id
  razorpay_subscriptions: new Map<string, Record<string, unknown>>(), // by subscription_id
  user: "",
}));
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const key = (t: string) => (t === "entitlements" ? "user_id" : "subscription_id");
  const table = (t: "entitlements" | "razorpay_subscriptions") => {
    const rows = db[t];
    const where = (col: string, val: unknown) => [...rows.values()].filter((r) => r[col] === val);
    return {
      select: () => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: async () => ({ data: where(col, val)[0] ?? null, error: null }),
          order: (by: string, o: { ascending: boolean }) => ({
            limit: async (n: number) => ({
              data: where(col, val).sort((a, b) => String(a[by] ?? "").localeCompare(String(b[by] ?? "")) * (o.ascending ? 1 : -1)).slice(0, n),
              error: null,
            }),
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        rows.set(String(row[key(t)]), { created_at: new Date().toISOString(), cancel_at_period_end: false, ...row });
        return { error: null };
      },
      upsert: async (row: Record<string, unknown>) => {
        const k = String(row[key(t)]);
        rows.set(k, { created_at: new Date().toISOString(), ...(rows.get(k) ?? {}), ...row });
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (col: string, val: unknown) => {
          for (const r of where(col, val)) rows.set(String(r[key(t)]), { ...r, ...patch });
          return { error: null };
        },
      }),
    };
  };
  const fake = { from: (t: "entitlements" | "razorpay_subscriptions") => table(t) };
  return {
    ...real,
    supabase: () => fake,
    // The in-app cancel is signed in: whoever the test says is calling.
    resolveUser: async (h: string | undefined) => (h === "Bearer good" ? { id: db.user, token: "t" } : null),
  };
});

/** Razorpay's REST API, as far as this server uses it. */
const rz = vi.hoisted(() => ({
  subs: new Map<string, Record<string, unknown>>(),
  created: [] as Array<Record<string, unknown>>,
  cancelled: [] as string[],
  plans: {
    plan_InM: { id: "plan_InM", period: "monthly", interval: 1, item: { amount: 19900, currency: "INR" } },
    plan_InY: { id: "plan_InY", period: "yearly", interval: 1, item: { amount: 149900, currency: "INR" } },
    plan_WoM: { id: "plan_WoM", period: "monthly", interval: 1, item: { amount: 999, currency: "USD" } },
    plan_WoY: { id: "plan_WoY", period: "yearly", interval: 1, item: { amount: 5999, currency: "USD" } },
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
    const missing = () => json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/plans\/(\w+)$/))) return rz.plans[m[1]!] ? json(200, rz.plans[m[1]!]) : missing();
    if (path === "/subscriptions" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      rz.created.push(body);
      const sub = { id: `sub_New${rz.created.length}`, plan_id: body.plan_id, status: "created", notes: body.notes };
      rz.subs.set(sub.id, sub);
      return json(200, sub);
    }
    if ((m = path.match(/^\/subscriptions\/(\w+)\/cancel$/))) {
      rz.cancelled.push(m[1]!);
      expect(JSON.parse(String(init?.body))).toEqual({ cancel_at_cycle_end: 1 });
      return json(200, rz.subs.get(m[1]!));   // still "active" until the period ends
    }
    if ((m = path.match(/^\/subscriptions\/(\w+)$/))) return rz.subs.has(m[1]!) ? json(200, rz.subs.get(m[1]!)) : missing();
    return json(404, {});
  }) as never;
});
afterAll(() => { globalThis.fetch = realFetch; });

const rzp = await import("../src/billing/razorpay.js");
const { getEntitlement, applyRevenueCatEvent, forgetEntitlement } = await import("../src/billing/entitlements.js");

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_A", plan_id: "plan_InM", status: "active",
  current_start: now() - 5 * DAY, current_end: now() + 25 * DAY, notes: { user_id: USER }, ...over,
});
const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");
const callerOf = (userId: string) => Object.fromEntries(new URL(rzp.payLink("https://tailzu.space/pay", userId)!).searchParams);
const row = (id = "sub_A") => db.razorpay_subscriptions.get(id)!;
const ent = () => { forgetEntitlement(USER); return getEntitlement({ id: USER } as never); };

beforeEach(() => {
  db.entitlements.clear(); db.razorpay_subscriptions.clear(); db.user = USER;
  rz.subs.clear(); rz.created.length = 0; rz.cancelled.length = 0;
  forgetEntitlement(USER); forgetEntitlement(OTHER);
  rzp.forgetPlans();
});

describe("the plans on sale", () => {
  it("are the configured ones, tagged by market, and nothing malformed", () => {
    expect(rzp.sellablePlans()).toEqual([
      { market: "IN", period: "monthly", id: "plan_InM" },
      { market: "IN", period: "annual", id: "plan_InY" },
      { market: "world", period: "monthly", id: "plan_WoM" },
      { market: "world", period: "annual", id: "plan_WoY" },
    ]);
    expect(rzp.planFor("world", "annual")?.id).toBe("plan_WoY");
  });

  it("read like prices", async () => {
    expect(rzp.formatPrice((await rzp.fetchPlan("plan_InY"))!)).toBe("₹1,499");
    expect(rzp.formatPrice((await rzp.fetchPlan("plan_WoM"))!)).toBe("$9.99");
    expect(rzp.formatPeriod((await rzp.fetchPlan("plan_WoY"))!)).toBe("a year");
  });
});

describe("signatures", () => {
  it("a checkout: HMAC_SHA256(payment_id|subscription_id) with the key secret", () => {
    const good = sign("key-secret", "pay_1|sub_A");
    expect(rzp.checkoutSignatureOk("pay_1", "sub_A", good)).toBe(true);
    expect(rzp.checkoutSignatureOk("pay_1", "sub_B", good)).toBe(false);
    expect(rzp.checkoutSignatureOk("pay_1", "sub_A", "")).toBe(false);
  });

  it("a webhook: HMAC of the exact raw body with the webhook secret", () => {
    const raw = '{"event":"subscription.charged"}';
    expect(rzp.webhookSignatureOk(raw, sign("hook-secret", raw))).toBe(true);
    expect(rzp.webhookSignatureOk(`${raw} `, sign("hook-secret", raw))).toBe(false);
    expect(rzp.webhookSignatureOk(raw, sign("key-secret", raw))).toBe(false);
  });

  it("the pay link names one caller, and only until it expires", () => {
    const c = callerOf(USER);
    expect(rzp.payLinkUser(c.u, c.e, c.t)).toBe(USER);
    expect(rzp.payLinkUser(OTHER, c.e, c.t)).toBeNull();
    expect(rzp.payLinkUser(c.u, String(Number(c.e) + DAY), c.t)).toBeNull();
    const old = Object.fromEntries(new URL(rzp.payLink("https://tailzu.space/pay", USER, Date.now() - 30 * DAY * 1000)!).searchParams);
    expect(rzp.payLinkUser(old.u, old.e, old.t)).toBeNull();
  });
});

describe("what a status entitles", () => {
  const end = (now() + 10 * DAY) * 1000;
  const at = Date.now();
  const w = (status: string, cancel = false) => rzp.entitlementWindow({ status, current_end: end / 1000 }, cancel, at);
  it("active and authenticated: to the period's end plus 24 hours", () => {
    expect(w("active").until).toBe(end + 24 * 3600_000);
    expect(w("authenticated").until).toBe(end + 24 * 3600_000);
  });
  it("pending: a grace while Razorpay retries the renewal", () => {
    expect(w("pending").until!).toBeGreaterThan(end + 24 * 3600_000);
  });
  it("cancelled, or cancelled in the app: to the period's end, no slack", () => {
    expect(w("cancelled").until).toBe(end);
    expect(w("active", true).until).toBe(end);
  });
  it("halted, completed, expired, paused: locked; created: nothing paid", () => {
    for (const s of ["halted", "completed", "expired", "paused", "created"]) expect(w(s).until, s).toBeNull();
  });
});

describe("saving a subscription's state", () => {
  it("entitles the account in its notes, in Razorpay's own table", async () => {
    const res = await rzp.syncSubscription(sub(), "subscription.charged");
    expect(res).toMatchObject({ ok: true, userId: USER });
    expect(row()).toMatchObject({ user_id: USER, plan_id: "plan_InM", market: "IN", status: "active", environment: "TEST", cancel_at_period_end: false });
    expect(db.entitlements.size).toBe(0);   // RevenueCat's table is not touched
    expect(await ent()).toMatchObject({ active: true, store: "razorpay", renews: true });
  });

  it("refuses a plan not on sale, a subscription with no user_id, and one that changed hands", async () => {
    expect((await rzp.syncSubscription(sub({ plan_id: "plan_Other" }), "x")).reason).toContain("not a Tailzu plan");
    expect((await rzp.syncSubscription(sub({ notes: [] }), "x")).ok).toBe(false);
    await rzp.syncSubscription(sub(), "x");
    expect((await rzp.syncSubscription(sub({ notes: { user_id: OTHER } }), "x")).ok).toBe(false);
    expect(row().user_id).toBe(USER);
  });

  it("halted locks at once", async () => {
    await rzp.syncSubscription(sub(), "x");
    await rzp.syncSubscription(sub({ status: "halted" }), "x");
    rz.subs.set("sub_A", sub({ status: "halted" }));
    expect(await ent()).toBeNull();
  });

  it("RevenueCat cannot overwrite it, and it cannot overwrite RevenueCat", async () => {
    await rzp.syncSubscription(sub(), "x");
    await applyRevenueCatEvent({ type: "EXPIRATION", app_user_id: USER, entitlement_ids: ["TAILZU AIR"] }, "TAILZU AIR");
    expect(row().status).toBe("active");
    expect(await ent()).toMatchObject({ store: "razorpay" });

    db.razorpay_subscriptions.clear();
    db.entitlements.set(USER, { user_id: USER, entitlement: "TAILZU AIR", active: true, store: "app_store", expires_at: new Date(Date.now() + 9e8).toISOString() });
    await rzp.syncSubscription(sub({ status: "halted" }), "x");
    expect(db.entitlements.get(USER)!.store).toBe("app_store");
    expect(await ent()).toMatchObject({ store: "app_store" });
  });

  it("a row that ran out is read back from Razorpay before it is believed", async () => {
    await rzp.syncSubscription(sub({ current_end: now() - 3 * DAY }), "x");
    rz.subs.set("sub_A", sub({ current_end: now() + 27 * DAY }));   // renewed; the webhook never came
    expect(await ent()).toMatchObject({ active: true, store: "razorpay" });
    expect(Date.parse(String(row().period_end))).toBe((now() + 27 * DAY) * 1000);
  });
});

describe("the routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/server.js");
    app = await buildApp(); await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("the pay page carries both markets at Razorpay's prices, under a policy that allows Razorpay", async () => {
    const r = await app.inject({ method: "GET", url: "/pay" });
    expect(r.statusCode).toBe(200);
    for (const p of ["₹199", "₹1,499", "$9.99", "$59.99"]) expect(r.body).toContain(p);
    expect(r.body).toContain('data-market="IN" data-period="annual"');
    expect(r.body).toContain('tz === "Asia/Kolkata"');
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).toContain("https://*.razorpay.com");
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(r.body).toContain(`<script nonce="${nonce}">`);
    expect(r.body).not.toContain("key-secret");
  });

  it("makes the subscription itself, for the signed caller, from a plan on sale", async () => {
    const c = callerOf(USER);
    const r = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { ...c, market: "world", period: "annual" } });
    expect(r.statusCode).toBe(200);
    expect(rz.created[0]).toMatchObject({ plan_id: "plan_WoY", notes: { user_id: USER }, total_count: 10 });
    expect(row(r.json().subscriptionId)).toMatchObject({ user_id: USER, status: "created", market: "world" });

    expect((await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { u: USER, e: c.e, t: "forged", market: "IN", period: "monthly" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { ...c, market: "IN", period: "weekly" } })).statusCode).toBe(400);

    await rzp.syncSubscription(sub(), "x");
    const again = await app.inject({ method: "POST", url: "/v1/pay/razorpay/subscription", payload: { ...c, market: "IN", period: "monthly" } });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_subscribed");
  });

  it("verify unlocks at once, only with Razorpay's signature, and only for the caller's own subscription", async () => {
    rz.subs.set("sub_A", sub());
    const proof = { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_A", razorpay_signature: sign("key-secret", "pay_1|sub_A") };
    expect((await app.inject({ method: "POST", url: "/v1/pay/razorpay/verify", payload: { ...callerOf(USER), ...proof, razorpay_signature: "f".repeat(64) } })).statusCode).toBe(400);
    const theirs = await app.inject({ method: "POST", url: "/v1/pay/razorpay/verify", payload: { ...callerOf(OTHER), ...proof } });
    expect(theirs.statusCode).toBe(403);
    expect(db.razorpay_subscriptions.size).toBe(0);
    const ok = await app.inject({ method: "POST", url: "/v1/pay/razorpay/verify", payload: { ...callerOf(USER), ...proof } });
    expect(ok.json()).toEqual({ ok: true, entitled: true });
    expect(await ent()).toMatchObject({ store: "razorpay" });
  });

  it("the webhook needs no user, checks the raw body's signature, and saves what Razorpay says now", async () => {
    rz.subs.set("sub_A", sub({ status: "halted" }));   // what Razorpay says NOW
    const stale = JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: sub() } } });
    const forged = await app.inject({ method: "POST", url: "/v1/billing/razorpay", payload: stale,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign("wrong", stale) } });
    expect(forged.statusCode).toBe(401);
    const real = await app.inject({ method: "POST", url: "/v1/billing/razorpay", payload: stale,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign("hook-secret", stale) } });
    expect(real.statusCode).toBe(200);
    // The event said "charged"; Razorpay said "halted". Razorpay wins.
    expect(row().status).toBe("halted");
    expect(row().entitled_until).toBeNull();

    const unknown = JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_Nope" } } } });
    const r = await app.inject({ method: "POST", url: "/v1/billing/razorpay", payload: unknown,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign("hook-secret", unknown) } });
    expect(r.statusCode).toBe(500);   // Razorpay retries
    expect(r.json().detail).toContain("does not exist");
  });

  it("cancel in the app: at the period's end, access kept, and a later 'active' does not bring renewal back", async () => {
    rz.subs.set("sub_A", sub({ plan_id: "plan_InY" }));
    await rzp.syncSubscription(rz.subs.get("sub_A") as never, "x");
    expect((await app.inject({ method: "POST", url: "/v1/billing/razorpay/cancel" })).statusCode).toBe(401);

    const c = await app.inject({ method: "POST", url: "/v1/billing/razorpay/cancel", headers: { authorization: "Bearer good" } });
    expect(c.statusCode).toBe(200);
    expect(c.json().ok).toBe(true);
    expect(c.json().message).toMatch(/^Cancelled\. Unlimited stays on until /);
    expect(rz.cancelled).toEqual(["sub_A"]);
    expect(row().cancel_at_period_end).toBe(true);
    expect(await ent()).toMatchObject({ active: true, renews: false });

    // Razorpay still says "active" until the period ends, and says so in a webhook.
    const hook = JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_A" } } } });
    await app.inject({ method: "POST", url: "/v1/billing/razorpay", payload: hook,
      headers: { "content-type": "application/json", "x-razorpay-signature": sign("hook-secret", hook) } });
    expect(row().cancel_at_period_end).toBe(true);
    expect(Date.parse(String(row().entitled_until))).toBe(Number(sub().current_end) * 1000);
    expect(await ent()).toMatchObject({ renews: false });

    // Cancelling twice is not a second call to Razorpay.
    await app.inject({ method: "POST", url: "/v1/billing/razorpay/cancel", headers: { authorization: "Bearer good" } });
    expect(rz.cancelled).toEqual(["sub_A"]);
  });

  it("the cancel screen says what happens, and the bootstrap hands the desktop a signed pay link", async () => {
    const { buildScreen, buildBootstrap } = await import("../src/experience/catalog.js");
    const until = new Date(Date.now() + 20 * DAY * 1000).toISOString();
    const live = JSON.stringify(buildScreen("cancel_subscription", { personality: {}, language: "en", entitlement: { store: "razorpay", expiresAt: until, renews: true } } as never));
    expect(live).toContain("/v1/billing/razorpay/cancel");
    expect(live).toContain("You Will Not Be Charged Again");
    const ending = JSON.stringify(buildScreen("cancel_subscription", { personality: {}, language: "en", entitlement: { store: "razorpay", expiresAt: until, renews: false } } as never));
    expect(ending).toContain("Already Cancelled");
    expect(ending).not.toContain("/v1/billing/razorpay/cancel");
    const store = JSON.stringify(buildScreen("cancel_subscription", { personality: {}, language: "en", entitlement: { store: "app_store" } } as never));
    expect(store).toContain("Nothing To Cancel Here");

    const b = buildBootstrap({ entitled: true, billingStore: "razorpay", billingRenews: false, formFactor: "desktop",
      payUrl: rzp.payLink("https://tailzu.space/pay", USER) } as never) as { flags: Record<string, unknown> };
    expect(b.flags["billing.manage.razorpay"]).toBe(true);
    expect(b.flags["billing.ending"]).toBe(true);
  });
});
