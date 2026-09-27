/**
 * Pricing — served as HTML at /pricing (tailzu.space/pricing).
 *
 * Its own page under a link, not a section of the landing page: the landing
 * page sells the product, this one states the terms of buying it. It is also
 * one of the pages Paddle's reviewers read before approving checkout.
 *
 * Built from the paywall's own plan list and the allowance the server
 * enforces, so the site, the app and the meter cannot quote three different
 * numbers. A price change is a change to PAYWALL_CONFIG, and it lands here.
 */
import type { PaywallConfig } from "../../../../shared/types/api.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-US");

export const SELLER = "XOOTEQ LAB PRIVATE LIMITED";

export function pricingHtml(opts: {
  plans: PaywallConfig["plans"];
  freeWords: number;
  earnMaxWords: number;
  terms: string;
  privacy: string;
}): string {
  const paid = (opts.plans ?? []).filter((p) => !p.free && p.price);
  const card = (name: string, price: string, period: string, lines: string[]) => `
  <section class="plan">
    <h2>${esc(name)}</h2>
    <p class="price">${esc(price)}${period ? ` <span>${esc(period)}</span>` : ""}</p>
    <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  </section>`;
  const free = card("Free", "$0", "", [
    `${n(opts.freeWords)} words a month.`,
    ...(opts.earnMaxWords > 0 ? [`Up to ${n(opts.earnMaxWords)} more, earned by writing on consecutive days.`] : []),
    "Every voice, every language, every app.",
  ]);
  const paidCards = paid.map((p) => {
    const monthly = /month/i.test(p.period ?? "") && !/year/i.test(p.period ?? "");
    return card(p.label ?? "", p.price ?? "", monthly ? "a month" : "a year", [
      "Unlimited words.",
      ...(monthly ? ["Billed monthly. Cancel any time."] : [
        `${(p.period ?? "").replace(/,?\s*billed yearly/i, "").trim()}, billed once a year.`,
        "In the app, the first 7 days are free.",
      ]),
    ]);
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pricing — Tailzu</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Tailzu is free to start. Lite and Elite remove the monthly word limit.">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 28px; margin-bottom: 6px; }
  .lede { color: #555; margin-bottom: 28px; }
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .plan { border: 1px solid #e5e5e5; border-radius: 12px; padding: 20px; }
  .plan h2 { font-size: 18px; margin: 0 0 6px; }
  .price { font-size: 26px; font-weight: 700; margin: 0 0 12px; }
  .price span { font-size: 14px; font-weight: 400; color: #6b6b6b; }
  ul { padding-left: 20px; margin: 0; }
  li { margin-bottom: 6px; }
  h3 { font-size: 16px; margin-top: 32px; }
  a { color: #2563eb; }
  hr { border: 0; border-top: 1px solid #e5e5e5; margin: 32px 0; }
  .small { color: #6b6b6b; font-size: 14px; }
</style>
</head>
<body>

<h1>Pricing</h1>
<p class="lede">Tailzu is free to start. A paid plan removes the monthly word limit.</p>

<div class="plans">${free}${paidCards.join("")}
</div>

<h3>Currency and tax</h3>
<p>Prices are in US dollars. Tax is added at checkout where it applies. In the app, the App Store or Google Play shows the price in your currency.</p>

<h3>How you pay</h3>
<p>In the app, through the Apple App Store or Google Play. On the web, at checkout on xooteq.com: web orders are sold by <strong>Paddle.com</strong>, our authorised reseller and Merchant of Record, on behalf of ${SELLER}, which makes Tailzu.</p>

<h3>Renewal and cancelling</h3>
<p>Plans renew automatically at the end of each period until you cancel. Cancel an app purchase in your App Store or Google Play subscriptions, and a web purchase from your Paddle receipt or at <a href="https://paddle.net">paddle.net</a>. You keep access until the end of the period already paid for.</p>

<h3>Refunds</h3>
<p>Purchases are non-refundable, except where the law requires a refund. Web purchases: see the <a href="https://xooteq.com/refunds">Refund Policy</a>. App purchases are refunded, if at all, by Apple or Google under their own policies.</p>

<hr>
<p class="small"><a href="${esc(opts.terms)}">Terms</a> · <a href="${esc(opts.privacy)}">Privacy</a> · <a href="https://xooteq.com/refunds">Refunds</a> · <a href="mailto:support@tailzu.space">support@tailzu.space</a></p>
<p class="small">Tailzu is made by ${SELLER}.</p>

</body>
</html>`;
}
