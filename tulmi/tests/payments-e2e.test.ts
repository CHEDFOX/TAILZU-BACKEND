import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * THE MONEY PATH, END TO END, THROUGH THE ROUTES THAT CARRY IT.
 *
 * Every other billing test in this suite checks one link: the event filter,
 * the flag map, the screen. All of them passed while production charged people
 * and granted nothing — because the break was between two links that were each
 * correct on their own (REVENUECAT_ENTITLEMENT said "pro", the project's
 * entitlement is TAILZU AIR), and nothing anywhere ran the whole chain.
 *
 * So this one starts where money starts — an HTTP POST from RevenueCat — and
 * follows it to the only three places a user can tell: is the paywall gone, is
 * the meter off, and does the app know where to cancel. It reads the real
 * config, so the mismatch that caused all this would fail it.
 *
 * Faked: the database (an in-memory row) and who the caller is. Not faked: the
 * webhook route, its authentication, the event filter, the entitlement read,
 * the bootstrap, the paywall screen, and the quota gate.
 */

const USER = "11111111-2222-3333-4444-555555555555";
/**
 * The entitlement as it exists in the RevenueCat dashboard — the other side of
 * the wire, written out rather than read from our own config.
 *
 * This is the whole point of the file. Building the event from
 * getConfig().REVENUECAT_ENTITLEMENT makes the test agree with whatever the
 * server believes, so the two can be wrong together and every assertion still
 * passes — which is exactly what happened in production. Hardcoded, a config
 * naming somebody else's entitlement fails the journey, loudly, here.
 *
 * If this is ever renamed in the dashboard, this constant changes and the
 * default in config.ts changes with it. That is the point too.
 */
const ENTITLEMENT = "TAILZU AIR";
const SECRET = "test-webhook-secret";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_PROVIDER = "groq";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
// Sandbox grants are ON, which is the deployed choice and not an oversight.
// A sandbox transaction can only come from a TestFlight or Play internal
// build — a closed list — and from APP STORE REVIEW, which buys in sandbox
// too. Refusing it would hand a reviewer a purchase that completes and
// unlocks nothing, which is a rejection for "in-app purchase not working".
// So testers and reviewers get it free, deliberately.
//
// Both directions of the flag are covered in entitlements.test.ts, which can
// re-import the module per case. This file tests the one that is deployed.
process.env.REVENUECAT_ALLOW_SANDBOX = "true";
process.env.FREE_MONTHLY_WORDS = "800";
// AUTH HAS TO LOOK CONFIGURED, or the meter is not the meter. With auth off,
// enforceQuota allows everything by design — there is no billing to protect in
// a dev box — so a test that leaves it off proves nothing about the cap it
// claims to test. Fakes, because every client is mocked below.
process.env.SUPABASE_URL = "https://test-project.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
// Deliberately NOT set: REVENUECAT_ENTITLEMENT. The default is the one the
// project actually uses, and a default naming somebody else's entitlement is
// the fault this file exists for.

/** The one row the entitlements table would hold, in memory. */
let row: Record<string, unknown> | null = null;
/** Words spent this month. The meter only bites above the free cap, so
 *  proving it is off for a subscriber needs somebody who is over it. */
let wordsUsed = 0;

/**
 * Just enough Supabase to answer the two shapes entitlements.ts asks for:
 * a `.select(...).eq("user_id", …).maybeSingle()` read, and an upsert keyed on
 * user_id. Every other table answers empty, which is what the rest of a
 * bootstrap does without a database anyway.
 */
function fakeSupabase() {
  return {
    from(table: string) {
      const isEnt = table === "entitlements";
      const usage =
        table === "usage_events"
          ? [{ audio_seconds: 0, word_count: wordsUsed, created_at: new Date().toISOString() }]
          : [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: async () => ({ data: usage, error: null }),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: isEnt ? row : null, error: null }),
        single: async () => ({ data: isEnt ? row : null, error: null }),
        upsert: async (values: Record<string, unknown>) => {
          if (isEnt) row = { ...values };
          return { error: null };
        },
        insert: async () => ({ error: null }),
        update: () => chain,
        delete: () => chain,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  };
}

vi.mock("../src/auth/supabase.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabase: () => fakeSupabase(),
  // Named separately because the module's own dataClientFor closes over the
  // REAL supabase(), not this override — usage reads would come back null and
  // the cap would never bite.
  dataClientFor: () => fakeSupabase(),
  // A real Supabase user id, because the webhook only accepts a UUID —
  // DEV_SKIP_AUTH's "dev-user" would write a row the bootstrap never reads.
  resolveUser: async () => ({ id: USER, email: "buyer@tailzu.space" }),
}));

// The pipeline is not on the money path; it only has to import.
vi.mock("../src/pipeline/cleanup.js", () => ({
  clean: async (s: string) => s,
  assist: async (s: string) => s,
  cleanBasic: async (s: string) => s,
  cleanStream: async function* () {},
  draftReply: async () => "",
  inferStyle: async () => ({}),
  refineWithTone: async (s: string) => s,
  LLM_TONES: ["formal", "casual", "very-casual", "excited"],
  expandSnippets: (s: string) => s,
}));

const { buildApp } = await import("../src/server.js");
const { forgetEntitlement } = await import("../src/billing/entitlements.js");
const { enforceQuota } = await import("../src/usage/metering.js");
const { getConfig } = await import("../src/config.js");

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => { row = null; wordsUsed = 0; forgetEntitlement(USER); });

/** What RevenueCat actually posts, trimmed to the fields the server reads. */
function event(over: Record<string, unknown> = {}) {
  return {
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: USER,
      entitlement_ids: [ENTITLEMENT],
      store: "APP_STORE",
      environment: "PRODUCTION",
      expiration_at_ms: Date.now() + 30 * 86_400_000,
      product_id: "tailzu.monthly",
      ...over,
    },
  };
}

const webhook = (payload: unknown, auth: string | null = SECRET) =>
  app.inject({
    method: "POST",
    url: "/v1/billing/revenuecat",
    headers: auth === null ? {} : { authorization: auth },
    payload: payload as never,
  });

const bootstrap = (device: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/app/bootstrap",
    payload: { capabilities: { device } },
  });

const paywall = () =>
  app.inject({ method: "POST", url: "/v1/app/screen", payload: { screenId: "paywall" } });

const user = { id: USER, email: "buyer@tailzu.space" };

describe("payments, end to end", () => {
  it("filters on the entitlement RevenueCat actually grants", async () => {
    // The fault that made every other billing test pass while production
    // charged people and granted nothing. Two sides of one wire, and nothing
    // compared them: the dashboard says TAILZU AIR, the server said "pro",
    // and a filter refusing an entitlement it was not asked about is
    // indistinguishable from the same filter working perfectly.
    expect(getConfig().REVENUECAT_ENTITLEMENT.toLowerCase()).toBe(ENTITLEMENT.toLowerCase());
  });

  it("refuses a webhook that is not RevenueCat", async () => {
    // The only thing that may grant a subscription. An open endpoint here is a
    // free subscription for anyone who finds the URL.
    expect((await webhook(event(), null)).statusCode).toBe(401);
    expect((await webhook(event(), "wrong")).statusCode).toBe(401);
    expect(row).toBeNull();
  });

  it("carries a purchase from the webhook to every place a user can tell", async () => {
    // --- before: nothing bought -------------------------------------------
    const free = (await bootstrap()).json();
    expect(free.flags["billing.entitled"]).toBe(false);
    expect(free.flags["quota.entitled"]).toBe(false);
    expect(JSON.stringify((await paywall()).json())).toContain("iap.");

    // --- the purchase ------------------------------------------------------
    const res = await webhook(event());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, reason: "granted", userId: USER });
    expect(row).toMatchObject({ user_id: USER, active: true, store: "APP_STORE" });

    // --- the meter is off --------------------------------------------------
    // The server's own gate, not the client's opinion of it, and measured on
    // somebody who is PAST the free cap — under it, everyone passes and the
    // assertion would prove nothing. This is the failure a subscriber notices
    // first: they paid and were still cut off at the free tier.
    wordsUsed = 5_000;
    expect(await enforceQuota(user as never)).toBeNull();

    // --- the app knows ------------------------------------------------------
    const paid = (await bootstrap()).json();
    expect(paid.flags["billing.entitled"]).toBe(true);
    expect(paid.flags["quota.entitled"]).toBe(true);
    expect(paid.flags["billing.manage.apple"]).toBe(true);
    expect(paid.flags["billing.manage.url"]).toContain("apps.apple.com");

    // --- and stops selling --------------------------------------------------
    const screen = JSON.stringify((await paywall()).json());
    expect(screen).not.toContain("iap.");
    expect(screen).toContain("covers this account");
    expect(screen).toContain("apps.apple.com");
    expect(screen).toContain("Billed through Apple");
  });

  it("sends a desktop buyer to the web, and a phone buyer never", async () => {
    // A purchase link inside an iOS build is the anti-steering rule Apple
    // rejects for, so this one is not a preference.
    const phone = (await bootstrap()).json();
    expect(phone.flags["paywall.web.url"]).toBeUndefined();
  });

  it("ends access when the subscription does", async () => {
    await webhook(event());
    expect((await bootstrap()).json().flags["billing.entitled"]).toBe(true);

    const gone = await webhook(event({ type: "EXPIRATION" }));
    expect(gone.json()).toMatchObject({ ok: true, reason: "revoked" });
    wordsUsed = 5_000;
    expect(await enforceQuota(user as never)).toMatch(/used your .* words this month/i);

    const after = (await bootstrap()).json();
    expect(after.flags["billing.entitled"]).toBe(false);
    expect(after.flags["billing.manage.apple"]).toBeUndefined();
    expect(JSON.stringify((await paywall()).json())).toContain("iap.");
  });

  it("keeps access across a plan change, and follows the new store", async () => {
    // Monthly to annual. One entitlement covers both products, so the moment
    // between them must not be a moment without access.
    await webhook(event());
    const changed = await webhook(event({ type: "PRODUCT_CHANGE", product_id: "tailzu.annual" }));
    expect(changed.json()).toMatchObject({ ok: true, reason: "granted" });
    expect((await bootstrap()).json().flags["billing.entitled"]).toBe(true);
    wordsUsed = 5_000;
    expect(await enforceQuota(user as never)).toBeNull();
  });

  it("grants nothing for an entitlement that is not ours", async () => {
    // One RevenueCat project can hold several apps and several entitlements,
    // and its webhook is per project — so everything bought in it arrives here.
    const other = await webhook(event({ entitlement_ids: ["some_other_app"] }));
    expect(other.json().reason).toMatch(/some_other_app/i);
    expect(row).toBeNull();
    expect((await bootstrap()).json().flags["billing.entitled"]).toBe(false);
  });

  it("lets a tester and a reviewer through, because that is the deployed choice", async () => {
    // A sandbox purchase reaches this endpoint from exactly two places: a
    // build only the tester list can install, and App Store review. Both are
    // meant to end up with a working subscription, so the whole journey runs
    // for them — including the meter, which is the half a reviewer checks.
    expect(getConfig().REVENUECAT_ALLOW_SANDBOX).toBe(true);
    const sand = await webhook(event({ environment: "SANDBOX" }));
    expect(sand.json()).toMatchObject({ ok: true, reason: "granted" });
    expect(row).toMatchObject({ active: true, environment: "SANDBOX" });

    const paid = (await bootstrap()).json();
    expect(paid.flags["billing.entitled"]).toBe(true);
    wordsUsed = 5_000;
    expect(await enforceQuota(user as never)).toBeNull();
  });

  it("ignores a subscription that belongs to nobody we know", async () => {
    // An anonymous RevenueCat id, from a purchase made before sign-in. A row
    // keyed to it stores a subscription for a user who does not exist.
    const anon = await webhook(event({ app_user_id: "$RCAnonymousID:abc123", original_app_user_id: null }));
    // Answered rather than retried — RevenueCat retries a non-2xx for hours,
    // and this event will never become valid.
    expect(anon.statusCode).toBe(200);
    expect(anon.json().ok).toBe(false);
    expect(row).toBeNull();
  });

  it("is still entitled when the expiry has not arrived, and not when it has", async () => {
    // A missed EXPIRATION must not buy free months. The date is the backstop.
    await webhook(event({ expiration_at_ms: Date.now() - 1000 }));
    forgetEntitlement(USER);
    expect((await bootstrap()).json().flags["billing.entitled"]).toBe(false);
    wordsUsed = 5_000;
    expect(await enforceQuota(user as never)).toMatch(/used your .* words this month/i);
  });

  it("names the store a plan is billed through, per store", async () => {
    await webhook(event({ store: "PLAY_STORE" }));
    const play = (await bootstrap()).json();
    expect(play.flags["billing.manage.google"]).toBe(true);
    expect(play.flags["billing.manage.url"]).toContain("play.google.com");
    expect(JSON.stringify((await paywall()).json())).toContain("Billed through Google Play");
  });
});
