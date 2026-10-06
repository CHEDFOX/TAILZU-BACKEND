import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";

// eslint-disable-next-line import/first
import { payCsp, payHtml, type PayOffer } from "../src/routes/pay.js";
import { POLICY } from "../src/experience/catalog.js";

const OFFERS: PayOffer[] = [
  { market: "IN", period: "monthly", label: "Lite", price: "₹199", per: "a month", buyable: true },
  { market: "IN", period: "annual", label: "Elite", price: "₹1,499", per: "a year", badge: "Save 35%", lead: true, buyable: true },
  { market: "world", period: "monthly", label: "Lite", price: "$9.99", per: "a month", buyable: true },
  { market: "world", period: "annual", label: "Elite", price: "$59.99", per: "a year", badge: "Save 50%", lead: true, buyable: true },
];
const LINKS = { pricing: "https://tailzu.space/pricing", terms: POLICY.terms, privacy: POLICY.privacy };
const page = (offers = OFFERS, keyId = "rzp_live_abc123") => payHtml({ keyId, offers, nonce: "n0nce", ...LINKS });

describe("the pay page", () => {
  it("carries both markets at Razorpay's own prices, and opens Razorpay's checkout", () => {
    const html = page();
    expect(html).toContain('data-market="IN" data-period="monthly"');
    expect(html).toContain('data-market="world" data-period="annual"');
    for (const p of ["₹199", "₹1,499", "$9.99", "$59.99", "Save 35%"]) expect(html).toContain(p);
    expect(html).toContain('data-state="loading"');
    expect(html).toContain("https://checkout.razorpay.com/v1/checkout.js");
    expect(html).toContain('"/v1/pay/razorpay/subscription"');
    expect(html).toContain('"/v1/pay/razorpay/verify"');
    // The key id is public; nothing else from the server's config is in it.
    expect(html).toContain('"key":"rzp_live_abc123"');
  });

  it("lets the browser's time zone choose the market: India sees rupees, everyone else dollars", () => {
    const html = page();
    expect(html).toContain('tz === "Asia/Kolkata" || tz === "Asia/Calcutta"');
    expect(html).toContain('#pay[data-market="IN"] .plan[data-market="world"]');
    expect(html).toContain('#pay[data-market="world"] .plan[data-market="IN"]');
  });

  it("names its caller by the signed link, and sends nothing but a market and a period", () => {
    const html = page();
    expect(html).toContain('u: q.get("u")');
    expect(html).toContain("{ market: market, period: b.getAttribute(\"data-period\") }");
    expect(html).not.toContain("plan_");
  });

  it("runs its own script by nonce, under a policy that allows Razorpay and nothing else that runs", () => {
    expect(page()).toContain('<script nonce="n0nce">');
    const csp = payCsp("n0nce");
    expect(csp).toContain("script-src 'nonce-n0nce' https://*.razorpay.com");
    expect(csp).toContain("frame-src https://*.razorpay.com");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("shows a plan whose price could not be read, with no button", () => {
    const html = page([OFFERS[0]!, { ...OFFERS[1]!, price: "—", per: "Not available right now", buyable: false }]);
    expect(html).toContain('data-market="IN" data-period="monthly"');
    expect(html).not.toContain('data-market="IN" data-period="annual"');
  });

  it("with no key, or nothing buyable, it says checkout is not open and offers nothing", () => {
    expect(page(OFFERS, "")).toContain('data-state="off"');
    expect(page(OFFERS, "secret_value")).toContain('data-state="off"');
    expect(page(OFFERS, "secret_value")).not.toContain("secret_value");
    expect(page(OFFERS.map((o) => ({ ...o, buyable: false })))).toContain('data-state="off"');
  });

  it("names the processor, the seller and the refund rule, and carries nothing unfilled", () => {
    const html = page();
    expect(html).toContain("Razorpay");
    expect(html).not.toContain("Paddle");
    expect(html).toContain("XOOTEQ LAB PRIVATE LIMITED");
    expect(html).toMatch(/non-refundable, except where the law requires a refund/);
    expect(html).toContain("Settings, then Cancel subscription");
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it("tells an existing subscriber where to change their plan instead of selling a second one", () => {
    const html = page();
    expect(html).toContain('r.code === "already_subscribed"');
    expect(html).toContain("This account already has Unlimited");
  });
});

describe("when a payment fails", () => {
  const html = page();
  it("listens for Razorpay's failure and shows the buyer a code to quote", () => {
    expect(html).toContain('rzp.on("payment.failed"');
    expect(html).toContain('<p class="note failed">');
    expect(html).toContain("support@tailzu.space with this code: <code></code>");
    expect(html).toContain('#pay[data-state="failed"] .note.failed');
  });

  it("the server takes the report, logs it, and answers nothing", async () => {
    const { buildApp } = await import("../src/server.js");
    const app = await buildApp(); await app.ready();
    try {
      const res = await app.inject({ method: "POST", url: "/v1/pay/report",
        payload: { where: "payment", code: "BAD_REQUEST_ERROR", detail: "x".repeat(5000) } });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      const junk = await app.inject({ method: "POST", url: "/v1/pay/report", payload: "not json", headers: { "content-type": "text/plain" } });
      expect([204, 400, 415]).toContain(junk.statusCode);
    } finally { await app.close(); }
  });
});
