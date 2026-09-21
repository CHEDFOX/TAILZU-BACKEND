import { describe, expect, it, vi } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

import type { RcEvent } from "../src/billing/entitlements.js";
import { manageFlags, buildScreen } from "../src/experience/catalog.js";

/**
 * Every assertion here is about the FILTER, which runs before any database
 * call — so no Supabase client is needed and none is created. An event that
 * reaches the write answers "no service client", and that answer is itself the
 * signal that the filter let it through.
 */
const WROTE = "no service client";
const USER = "11111111-2222-3333-4444-555555555555";

/**
 * Config is read once per process and memoised, so a test that changes an env
 * var has to re-import the module behind it. Cheap, and it keeps the sandbox
 * cases in the same file as the ones they are the exception to.
 */
async function apply(ev: RcEvent, want: string, sandbox?: boolean) {
  if (sandbox === undefined) delete process.env.REVENUECAT_ALLOW_SANDBOX;
  else process.env.REVENUECAT_ALLOW_SANDBOX = String(sandbox);
  vi.resetModules();
  const mod = await import("../src/billing/entitlements.js");
  return mod.applyRevenueCatEvent(ev, want);
}

describe("applyRevenueCatEvent — other products in the same project", () => {
  it("ignores a purchase of a different entitlement", async () => {
    // The real shape of the problem: one RevenueCat project, several products,
    // one webhook URL. A credit pack in a sibling app must not buy Tailzu.
    const res = await apply(
      { type: "INITIAL_PURCHASE", app_user_id: USER, entitlement_ids: ["coins"] },
      "pro",
    );
    expect(res.ok).toBe(true);
    expect(res.reason).toContain("not pro");
    expect(res.reason).not.toBe(WROTE);
  });

  it("grants when the event names our entitlement among others", async () => {
    const res = await apply(
      { type: "INITIAL_PURCHASE", app_user_id: USER, entitlement_ids: ["coins", "pro"] },
      "pro",
    );
    expect(res.reason).toBe(WROTE);
  });

  it("accepts any of several configured tiers", async () => {
    const res = await apply(
      { type: "RENEWAL", app_user_id: USER, entitlement_ids: ["unlimited"] },
      "pro,unlimited",
    );
    expect(res.reason).toBe(WROTE);
  });

  it("matches the entitlement id case-insensitively", async () => {
    const res = await apply({ type: "RENEWAL", app_user_id: USER, entitlement_ids: ["Pro"] }, "pro");
    expect(res.reason).toBe(WROTE);
  });

  it("reads the singular entitlement_id field too", async () => {
    const res = await apply({ type: "RENEWAL", app_user_id: USER, entitlement_id: "pro" }, "pro");
    expect(res.reason).toBe(WROTE);
  });

  it("refuses to grant on an event that names no entitlement", async () => {
    // A product attached to no entitlement in RevenueCat grants nothing there;
    // it must grant nothing here. Guessing the default would turn any purchase
    // in the project into a Tailzu subscription.
    const res = await apply({ type: "NON_RENEWING_PURCHASE", app_user_id: USER }, "pro");
    expect(res.ok).toBe(true);
    expect(res.reason).toContain("names no entitlement");
  });

  it("still revokes on an event that names no entitlement", async () => {
    // The other direction of the same uncertainty. A wrong revoke is repaired
    // on the next read by askRevenueCat; a wrong grant is trusted until it
    // expires. So an ambiguous event may end access, never give it.
    const res = await apply({ type: "TRANSFER", app_user_id: USER }, "pro");
    expect(res.reason).toBe(WROTE);
  });

  it("does not let another product's refund revoke ours", async () => {
    const res = await apply(
      { type: "REFUND", app_user_id: USER, entitlement_ids: ["coins"] },
      "pro",
    );
    expect(res.reason).toContain("not pro");
  });

  it("matches an id with a space in it", async () => {
    // The live one is literally "TAILZU AIR". Both Tailzu products hang off it.
    const res = await apply(
      { type: "INITIAL_PURCHASE", app_user_id: USER, entitlement_ids: ["TAILZU AIR"] },
      "TAILZU AIR",
    );
    expect(res.reason).toBe(WROTE);
  });

  it("survives quotes left on the env value", async () => {
    // A value with a space invites quoting in .env, and a compose env_file can
    // hand the quotes through verbatim. Matching must not depend on that.
    const res = await apply(
      { type: "RENEWAL", app_user_id: USER, entitlement_ids: ["TAILZU AIR"] },
      '"TAILZU AIR"',
    );
    expect(res.reason).toBe(WROTE);
  });

  it("still ignores a cancellation before any filtering", async () => {
    const res = await apply(
      { type: "CANCELLATION", app_user_id: USER, entitlement_ids: ["pro"] },
      "pro",
    );
    expect(res.reason).toContain("runs to expiry");
  });
});

describe("applyRevenueCatEvent — sandbox", () => {
  const buy = (type: string): RcEvent => ({
    type,
    app_user_id: USER,
    entitlement_ids: ["TAILZU AIR"],
    environment: "SANDBOX",
  });

  it("lets a sandbox purchase through while testing", async () => {
    const res = await apply(buy("INITIAL_PURCHASE"), "TAILZU AIR", true);
    expect(res.reason).toBe(WROTE);
  });

  it("allows sandbox by default, so the paid path is testable out of the box", async () => {
    const res = await apply(buy("INITIAL_PURCHASE"), "TAILZU AIR");
    expect(res.reason).toBe(WROTE);
  });

  it("refuses a sandbox purchase once live", async () => {
    // TestFlight and Play's internal track transact against a sandbox where
    // nobody is charged. After launch that is a free subscription for anyone
    // who can install a test build.
    const res = await apply(buy("INITIAL_PURCHASE"), "TAILZU AIR", false);
    expect(res.reason).toContain("sandbox purchase ignored");
  });

  it("still revokes a sandbox subscription when sandbox is off", async () => {
    // The flag decides who gets in, never who stays. A sandbox grant made
    // before launch must still be endable after it.
    const res = await apply(buy("EXPIRATION"), "TAILZU AIR", false);
    expect(res.reason).toBe(WROTE);
  });

  it("never blocks a production purchase", async () => {
    const res = await apply(
      {
        type: "INITIAL_PURCHASE",
        app_user_id: USER,
        entitlement_ids: ["TAILZU AIR"],
        environment: "PRODUCTION",
      },
      "TAILZU AIR",
      false,
    );
    expect(res.reason).toBe(WROTE);
  });
});

/**
 * THE WEB PATH, proven without spending anything.
 *
 * The desktop buys through a RevenueCat web purchase link, and whichever
 * billing engine sits behind it — RevenueCat's own, Stripe, or Paddle — the
 * event arrives at the same webhook in the same shape. These are the cases
 * that decide whether a real payment reaches a real account.
 */
describe("applyRevenueCatEvent — buying from the desktop", () => {
  const web = (over: Partial<RcEvent> = {}): RcEvent => ({
    type: "INITIAL_PURCHASE",
    app_user_id: USER,
    entitlement_ids: ["TAILZU AIR"],
    environment: "PRODUCTION",
    store: "paddle",
    ...over,
  });

  it("grants on a Paddle purchase, exactly as on a phone", async () => {
    const res = await apply(web(), "TAILZU AIR", false);
    expect(res.reason).toBe(WROTE);
    expect(res.userId).toBe(USER);
  });

  it("does not care which store it came from", async () => {
    // `store` is recorded as a label and never branched on, which is the whole
    // reason swapping Stripe for Paddle cost no code. If this ever fails, one
    // provider has been wired into a decision.
    for (const store of ["paddle", "stripe", "rc_billing", "app_store", null]) {
      const res = await apply(web({ store }), "TAILZU AIR", false);
      expect(res.reason, String(store)).toBe(WROTE);
    }
  });

  /**
   * THE FAILURE THAT LOOKS LIKE SUCCESS.
   *
   * If the link carries no app user id, or the Paddle config is left on
   * "autogenerated user IDs", RevenueCat attributes the purchase to an
   * anonymous customer. The checkout completes, the card is charged, the
   * webhook answers 200 — and there is no account to grant anything to.
   *
   * It has to be refused loudly rather than written somewhere harmless,
   * because a row under an id no account will ever match is indistinguishable
   * from a working subscription until someone complains.
   */
  it("refuses an anonymous purchase, and says why", async () => {
    const res = await apply(
      web({ app_user_id: "$RCAnonymousID:8b6e4f2a9c114d7e", original_app_user_id: undefined }),
      "TAILZU AIR",
      false,
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("no Supabase user id");
    // The id it DID see is named, because that string is what tells you
    // whether the link was missing the slot or the dashboard was misconfigured.
    expect(res.reason).toContain("$RCAnonymousID");
  });

  it("finds the user id when it arrives as an alias", async () => {
    // A web purchase made before sign-in and later linked leaves the real id
    // in `aliases` rather than `app_user_id`.
    const res = await apply(
      web({ app_user_id: "$RCAnonymousID:8b6e4f2a9c114d7e", aliases: [USER] }),
      "TAILZU AIR",
      false,
    );
    expect(res.reason).toBe(WROTE);
    expect(res.userId).toBe(USER);
  });

  it("ends web access on expiry like any other", async () => {
    const res = await apply(web({ type: "EXPIRATION" }), "TAILZU AIR", false);
    expect(res.reason).toBe(WROTE);
  });

  it("does not revoke on cancellation — they paid to the end of the period", async () => {
    const res = await apply(web({ type: "CANCELLATION" }), "TAILZU AIR", false);
    expect(res.ok).toBe(true);
    expect(res.reason).toContain("access runs to expiry");
  });
});

describe("where a subscription is managed", () => {
  // WHERE YOU BOUGHT IT DECIDES WHERE YOU CAN CHANGE IT, and one account is
  // reachable from a phone and a window at once. Apple lets nothing but Apple
  // cancel an App Store subscription; Paddle cannot be reached from iOS
  // Settings. A client that knows only "paid" can say nothing true about how
  // to stop paying — and can offer a second subscription on another store to
  // somebody who already has one, which bills them twice for one entitlement.
  it("groups the stores by who can actually change the subscription", () => {
    expect(manageFlags("app_store")).toMatchObject({ "billing.manage.apple": true });
    expect(manageFlags("mac_app_store")).toMatchObject({ "billing.manage.apple": true });
    expect(manageFlags("play_store")).toMatchObject({ "billing.manage.google": true });
    // The three web engines are one destination: Paddle is what this project
    // uses today, and swapping it is a dashboard change, not a release.
    expect(manageFlags("paddle")).toMatchObject({ "billing.manage.web": true });
    expect(manageFlags("stripe")).toMatchObject({ "billing.manage.web": true });
    expect(manageFlags("rc_billing")).toMatchObject({ "billing.manage.web": true });
  });

  it("carries the address, so a client never has to give directions", () => {
    // A subscriber who taps Upgrade wants to upgrade. Answering with the route
    // to a settings screen asks them to do the finding, which is the part that
    // turns a wrong tap into a support email.
    expect(manageFlags("app_store")["billing.manage.url"]).toContain("apps.apple.com");
    expect(manageFlags("play_store")["billing.manage.url"]).toContain("play.google.com");
    expect(manageFlags("paddle")["billing.manage.url"]).toContain("support@tailzu.space");
    expect(manageFlags("promotional")["billing.manage.url"]).toBeUndefined();
  });

  it("says nothing for a store it cannot send anyone to", () => {
    // A promotional grant, or a billing engine added after this build. Silence
    // beats a row that opens a settings page with nothing of theirs on it.
    expect(manageFlags("promotional")).toEqual({});
    expect(manageFlags("amazon")).toEqual({});
    expect(manageFlags(undefined)).toEqual({});
    expect(manageFlags("")).toEqual({});
  });

  it("reads the store however RevenueCat happens to case it", () => {
    expect(manageFlags("APP_STORE")).toMatchObject({ "billing.manage.apple": true });
    expect(manageFlags(" Play_Store ")).toMatchObject({ "billing.manage.google": true });
  });

  it("puts exactly one manage row in Settings, and only for a subscriber", () => {
    // The row and its flag are written in two places; this is the one test
    // that reads them together. A row gated on a flag nothing ever sets is
    // indistinguishable from the bug it was added to fix.
    const screen = buildScreen("settings", { personality: {}, language: "en" } as never) as never as {
      root: { children: { visibleIf?: unknown; props?: { label?: string } }[] };
    };
    const manage = screen.root.children.filter((c) =>
      JSON.stringify(c.visibleIf ?? "").includes("billing.manage."),
    );
    expect(manage.length).toBe(3);
    for (const r of manage) {
      expect(JSON.stringify(r.visibleIf)).toContain('"billing.entitled"');
    }
    // Every flag a row waits for is one manageFlags() can actually produce.
    const waited = manage.map((r) => JSON.stringify(r.visibleIf).match(/billing\.manage\.\w+/)![0]);
    const produced = ["app_store", "play_store", "paddle"]
      .flatMap((s) => Object.keys(manageFlags(s)))
      .filter((k) => k !== "billing.manage.url");
    expect([...waited].sort()).toEqual([...produced].sort());
  });
});
