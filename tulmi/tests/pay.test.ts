import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";

// eslint-disable-next-line import/first
import { manageHtml, payHtml, type PayOffer } from "../src/routes/pay.js";
import { POLICY } from "../src/experience/catalog.js";

const OFFERS: PayOffer[] = [
  { key: "monthly", label: "Lite", price: "₹199", per: "a month", buyable: true },
  { key: "annual", label: "Elite", price: "₹1,499", per: "a year", badge: "Save 35%", lead: true, buyable: true },
];
const LINKS = { pricing: "https://tailzu.space/pricing", terms: POLICY.terms, privacy: POLICY.privacy };
const page = (offers = OFFERS, keyId = "rzp_live_abc123") => payHtml({ keyId, offers, ...LINKS });

describe("the pay page", () => {
  it("offers each plan at Razorpay's own price, and opens Razorpay's checkout", () => {
    const html = page();
    expect(html).toContain('data-plan="monthly"');
    expect(html).toContain('data-plan="annual"');
    expect(html).toContain("₹199");
    expect(html).toContain("₹1,499");
    expect(html).toContain("Save 35%");
    expect(html).toContain('data-state="loading"');
    expect(html).toContain("https://checkout.razorpay.com/v1/checkout.js");
    expect(html).toContain('"/v1/pay/razorpay/subscription"');
    expect(html).toContain('"/v1/pay/razorpay/verify"');
    // The key id is public; nothing else from the server's config is in it.
    expect(html).toContain('"key":"rzp_live_abc123"');
  });

  it("shows a plan whose price could not be read, with no button", () => {
    const html = page([OFFERS[0]!, { key: "annual", label: "Elite", price: "—", per: "Not available right now", buyable: false }]);
    expect(html).toContain('data-plan="monthly"');
    expect(html).not.toContain('data-plan="annual"');
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
    expect(html).toContain("Settings, then Manage");
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

describe("the manage page", () => {
  const link = { u: "11111111-2222-3333-4444-555555555555", e: "1", t: "abc" };
  it("lets a renewing subscriber cancel, and says what happens", () => {
    const html = manageHtml({ ...LINKS, state: "renewing", until: "12 Oct 2026", plan: "Elite, yearly", link });
    expect(html).toContain("Renews on 12 Oct 2026");
    expect(html).toContain('id="cancel"');
    expect(html).toContain('"/v1/pay/razorpay/cancel"');
    expect(html).toContain("stays on until the end of the period you paid for");
  });
  it("offers nothing to cancel once it is ending, or when the link is old", () => {
    expect(manageHtml({ ...LINKS, state: "ending", until: "12 Oct 2026" })).not.toContain('id="cancel"');
    expect(manageHtml({ ...LINKS, state: "ending", until: "12 Oct 2026" })).toContain("stays on until 12 Oct 2026");
    expect(manageHtml({ ...LINKS, state: "expired" })).toContain("This link has expired");
    expect(manageHtml({ ...LINKS, state: "expired" })).not.toContain('id="cancel"');
  });
});
