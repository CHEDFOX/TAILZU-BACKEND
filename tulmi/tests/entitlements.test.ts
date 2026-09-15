import { describe, expect, it, vi } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

import type { RcEvent } from "../src/billing/entitlements.js";

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
