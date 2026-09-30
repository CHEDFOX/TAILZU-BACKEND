import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { pricingHtml } from "../src/routes/policies/pricing.js";
import { PAYWALL_CONFIG, POLICY } from "../src/experience/catalog.js";
import { TERMS_HTML } from "../src/routes/policies/terms.js";

describe("the pricing page", () => {
  const html = pricingHtml({
    plans: PAYWALL_CONFIG.plans, freeWords: 800, earnMaxWords: 1700,
    terms: POLICY.terms, privacy: POLICY.privacy,
  });

  it("quotes the paywall's own plans, so the site and the app cannot disagree", () => {
    for (const p of PAYWALL_CONFIG.plans.filter((x) => !x.free && x.price)) {
      expect(html).toContain(p.price);
      expect(html).toContain(`<h2>${p.label}</h2>`);
    }
    expect(html).toContain("800 words a month");
  });

  it("says who sells it, how, and what happens about refunds", () => {
    expect(html).toContain("Paddle.com");
    expect(html).toContain("Merchant of Record");
    expect(html).toContain("XOOTEQ LAB PRIVATE LIMITED");
    expect(html).toMatch(/non-refundable, except where the law requires a refund/);
    expect(html).toContain("https://xooteq.com/refunds");
  });

  it("carries nothing unfilled", () => {
    expect(html).not.toMatch(/undefined|null|NaN|\{\w+\}/);
  });
});

describe("the terms", () => {
  it("show no operator notes or placeholders to the public", () => {
    expect(TERMS_HTML).not.toMatch(/NOTE FOR OPERATOR|\[Add |placeholder/i);
  });
  it("name the company, the web seller and the refund rule", () => {
    expect(TERMS_HTML).toContain("XOOTEQ LAB PRIVATE LIMITED");
    expect(TERMS_HTML).toContain("Paddle.com");
    expect(TERMS_HTML).toContain("tailzu.space/pricing");
    expect(TERMS_HTML).toMatch(/non-refundable, except where the law requires a refund/);
  });
});
