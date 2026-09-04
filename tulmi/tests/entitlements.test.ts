import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { applyRevenueCatEvent } from "../src/billing/entitlements.js";

/**
 * These all assert the FILTER, which runs before any database call — so no
 * Supabase client is needed and none is created. An event that reaches the
 * write would answer "no service client" here, which is itself the signal that
 * the filter let it through.
 */
const WROTE = "no service client";

describe("applyRevenueCatEvent — other products in the same project", () => {
  const user = "11111111-2222-3333-4444-555555555555";

  it("ignores a purchase of a different entitlement", async () => {
    // The real shape of the problem: one RevenueCat project, several products,
    // one webhook URL. A credit pack in a sibling app must not buy Tailzu.
    const res = await applyRevenueCatEvent(
      { type: "INITIAL_PURCHASE", app_user_id: user, entitlement_ids: ["coins"] },
      "pro",
    );
    expect(res.ok).toBe(true);
    expect(res.reason).toContain("not pro");
    expect(res.reason).not.toBe(WROTE);
  });

  it("grants when the event names our entitlement among others", async () => {
    const res = await applyRevenueCatEvent(
      { type: "INITIAL_PURCHASE", app_user_id: user, entitlement_ids: ["coins", "pro"] },
      "pro",
    );
    expect(res.reason).toBe(WROTE);
  });

  it("accepts any of several configured tiers", async () => {
    const res = await applyRevenueCatEvent(
      { type: "RENEWAL", app_user_id: user, entitlement_ids: ["unlimited"] },
      "pro,unlimited",
    );
    expect(res.reason).toBe(WROTE);
  });

  it("matches the entitlement id case-insensitively", async () => {
    const res = await applyRevenueCatEvent(
      { type: "RENEWAL", app_user_id: user, entitlement_ids: ["Pro"] },
      "pro",
    );
    expect(res.reason).toBe(WROTE);
  });

  it("reads the singular entitlement_id field too", async () => {
    const res = await applyRevenueCatEvent(
      { type: "RENEWAL", app_user_id: user, entitlement_id: "pro" },
      "pro",
    );
    expect(res.reason).toBe(WROTE);
  });

  it("refuses to grant on an event that names no entitlement", async () => {
    // A product attached to no entitlement in RevenueCat grants nothing there;
    // it must grant nothing here. Guessing the default would turn any purchase
    // in the project into a Tailzu subscription.
    const res = await applyRevenueCatEvent(
      { type: "NON_RENEWING_PURCHASE", app_user_id: user },
      "pro",
    );
    expect(res.ok).toBe(true);
    expect(res.reason).toContain("names no entitlement");
  });

  it("still revokes on an event that names no entitlement", async () => {
    // The other direction of the same uncertainty. A wrong revoke is repaired
    // on the next read by askRevenueCat; a wrong grant is trusted until it
    // expires. So an ambiguous event is allowed to end access, never to give it.
    const res = await applyRevenueCatEvent({ type: "TRANSFER", app_user_id: user }, "pro");
    expect(res.reason).toBe(WROTE);
  });

  it("does not let another product's refund revoke ours", async () => {
    const res = await applyRevenueCatEvent(
      { type: "REFUND", app_user_id: user, entitlement_ids: ["coins"] },
      "pro",
    );
    expect(res.reason).toContain("not pro");
  });

  it("still ignores a cancellation before any filtering", async () => {
    const res = await applyRevenueCatEvent(
      { type: "CANCELLATION", app_user_id: user, entitlement_ids: ["pro"] },
      "pro",
    );
    expect(res.reason).toContain("runs to expiry");
  });
});
