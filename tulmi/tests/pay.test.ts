import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { payHtml } from "../src/routes/pay.js";
import { PAYWALL_CONFIG, POLICY } from "../src/experience/catalog.js";

const page = (priceIds: Record<string, string | undefined>, clientToken = "live_abc123") => payHtml({
  plans: PAYWALL_CONFIG.plans, clientToken, priceIds,
  pricing: "https://tailzu.space/pricing", terms: POLICY.terms, privacy: POLICY.privacy,
});

describe("the pay page", () => {
  it("offers each plan that has a price id, at the paywall's own price", () => {
    const html = page({ annual: "pri_01elite", monthly: "pri_01lite" });
    expect(html).toContain('data-price="pri_01elite"');
    expect(html).toContain('data-price="pri_01lite"');
    for (const p of PAYWALL_CONFIG.plans.filter((x) => !x.free && x.price)) expect(html).toContain(p.price);
    expect(html).toContain('data-state="loading"');
    expect(html).toContain("customData: { app_user_id: uid }");
  });

  it("shows prices but no button for a plan without a valid price id", () => {
    const html = page({ annual: "pri_01elite", monthly: "oops" });
    expect(html).toContain('data-price="pri_01elite"');
    expect(html).not.toContain("oops");
    expect(html).toContain("$9.99");
  });

  it("with no price ids or no token, it says checkout is not open and offers nothing", () => {
    expect(page({})).toContain('data-state="off"');
    expect(page({ annual: "pri_01elite" }, "apikey_secret")).toContain('data-state="off"');
    expect(page({ annual: "pri_01elite" }, "apikey_secret")).not.toContain("apikey_secret");
  });

  it("names the seller and the refund rule, and carries nothing unfilled", () => {
    const html = page({ annual: "pri_01elite", monthly: "pri_01lite" });
    expect(html).toContain("Paddle.com");
    expect(html).toContain("XOOTEQ LAB PRIVATE LIMITED");
    expect(html).toMatch(/non-refundable, except where the law requires a refund/);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});
