/**
 * Pricing — served as HTML at /pricing (tailzu.space/pricing).
 *
 * Its own page under a link, not a section of the landing page: the landing
 * page sells the product, this one states the terms of buying it. It is also
 * one of the pages a payment provider's reviewers read before approving checkout.
 *
 * Built from the paywall's own plan list and the allowance the server
 * enforces, so the site, the app and the meter cannot quote three different
 * numbers. A price change is a change to PAYWALL_CONFIG, and it lands here.
 * Dressed in the site's own room (shell.ts): the plans sit on the landing
 * page's sun field, as its price section does.
 */
import type { PaywallConfig } from "../../../../shared/types/api.js";
import { siteShell } from "./shell.js";
import { appLd, crumbsLd, pageLd } from "../../seo/facts.js";

/** HTML-escape for text and attribute values. Shared with the pay page. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.max(0, Math.round(v)).toLocaleString("en-US");
/** A plan's price as a number, for ordering plans. Shared with the pay page. */
export const amount = (price: string | undefined) => Number(String(price ?? "").replace(/[^0-9.]/g, "")) || 0;

export const SELLER = "XOOTEQ LAB PRIVATE LIMITED";

/** The plan cards' look, shared with the pay page. */
export const PLAN_CSS = `
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .plan { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 20px; padding: 24px; background: rgba(255,255,255,.26); }
  .plan.lead { background: var(--ink2); color: var(--sun); border-color: var(--ink2); }
  .plan .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .plan h2 { font-family: var(--mono); font-weight: 400; font-size: 13px; letter-spacing: .2em; text-transform: uppercase; margin: 0; }
  .badge { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; border: 1px solid currentColor; border-radius: 999px; padding: 3px 10px; opacity: .8; }
  .price { font-family: var(--serif); font-weight: 400; font-size: 54px; line-height: 1; letter-spacing: -.03em; margin: 22px 0 4px; font-variant-numeric: tabular-nums; }
  .per { margin: 0 0 18px; color: var(--ink2-soft); font-size: 15px; }
  .plan.lead .per { color: rgba(247,207,74,.72); }
  .plan ul { list-style: none; padding: 0; margin: 0 0 4px; }
  .plan li { padding: 9px 0; border-top: 1px solid var(--line); font-size: 15px; }
  .plan.lead li { border-top-color: rgba(247,207,74,.2); }
  .plan .btn { margin-top: auto; background: var(--ink2); color: var(--sun); }
  .plan.lead .btn { background: var(--sun); color: var(--ink2); }
  .plan li + .btn, .plan .per + .btn { margin-top: 18px; }
`;

const CSS = `${PLAN_CSS}
  .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 56px; margin: 64px 0 0; max-width: 880px; }
  @media (max-width: 720px) { .facts { grid-template-columns: 1fr; } }
  .facts h2 { font-family: var(--mono); font-weight: 400; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin: 0 0 8px; }
  .facts p { margin: 0 0 28px; color: var(--grey); text-transform: none; }
  .facts a { text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
  .made { margin: 24px 0 0; color: var(--dim); font-size: 14px; }
`;

export function pricingHtml(opts: {
  /** Tailzu is free for everyone right now: the page says so and sells nothing. */
  free?: boolean;
  plans: PaywallConfig["plans"];
  freeWords: number;
  earnMaxWords: number;
  terms: string;
  privacy: string;
}): string {
  if (opts.free) return freePricingHtml(opts);
  const paid = (opts.plans ?? []).filter((p) => !p.free && p.price)
    .sort((a, b) => amount(a.price) - amount(b.price));
  const card = (name: string, price: string, per: string, lines: string[], lead = false, badge = "") => `
    <section class="plan${lead ? " lead" : ""}">
      <div class="top"><h2>${esc(name)}</h2>${badge ? `<span class="badge">${esc(badge)}</span>` : ""}</div>
      <p class="price">${esc(price)}</p>
      <p class="per">${esc(per)}</p>
      <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    </section>`;
  const free = card("Free", "$0", "Free to start", [
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
    ], p.default === true, p.badge ?? "");
  });

  // The search title names the numbers, so a result answers "how much" before
  // anyone clicks. Built from the same plans the cards are.
  const priced = paid.map((p) => {
    const monthly = /month/i.test(p.period ?? "") && !/year/i.test(p.period ?? "");
    return `${p.label ?? ""} ${p.price ?? ""}/${monthly ? "mo" : "yr"}`;
  });
  const description = `Tailzu is free to start with ${n(opts.freeWords)} words a month. ` +
    paid.map((p) => {
      const monthly = /month/i.test(p.period ?? "") && !/year/i.test(p.period ?? "");
      return `${p.label} is ${p.price} a ${monthly ? "month" : "year"}`;
    }).join("; ") + ". Both remove the word limit.";
  return siteShell({
    title: "Pricing",
    headTitle: `Tailzu Pricing — Free, ${priced.join(", ")}`,
    path: "/pricing",
    description,
    ld: [
      pageLd("/pricing", "Tailzu pricing", description),
      crumbsLd([["Tailzu", "/"], ["Pricing", "/pricing"]]),
      appLd(),
    ],
    css: CSS,
    main: `
<p class="eye">Pricing</p>
<h1>Free to start. Unlimited when you want it.</h1>
<p class="lede">Every voice, every language, every app on every plan. A paid plan removes the monthly word limit.</p>

<div class="field"><div class="plans">${free}${paidCards.join("")}
</div></div>

<div class="facts">
  <section>
    <h2>Currency and tax</h2>
    <p>App prices are in US dollars; the App Store or Google Play shows the price in your currency. On the web, <a href="https://tailzu.space/pay">tailzu.space/pay</a> shows the price in the currency you are charged in.</p>
  </section>
  <section>
    <h2>How you pay</h2>
    <p>In the app, through the Apple App Store or Google Play. On the web, at <a href="https://tailzu.space/pay">tailzu.space/pay</a>: payments are processed by <strong>Razorpay</strong> for ${SELLER}, which makes Tailzu.</p>
  </section>
  <section>
    <h2>Renewal and cancelling</h2>
    <p>Plans renew automatically at the end of each period until you cancel. Cancel an app purchase in your App Store or Google Play subscriptions, and a web purchase in Tailzu: Settings, then Cancel subscription. You keep access until the end of the period already paid for.</p>
  </section>
  <section>
    <h2>Refunds</h2>
    <p>Purchases are non-refundable, except where the law requires a refund. Web purchases: see the <a href="https://xooteq.com/refunds">Refund Policy</a>. App purchases are refunded, if at all, by Apple or Google under their own policies.</p>
  </section>
</div>

<p class="made"><a href="${esc(opts.terms)}">Terms</a> · <a href="${esc(opts.privacy)}">Privacy</a> · <a href="https://xooteq.com/refunds">Refunds</a> · <a href="mailto:support@tailzu.space">support@tailzu.space</a></p>
<p class="made">Tailzu is made by ${SELLER}.</p>`,
  });
}

/**
 * The pricing page while Tailzu is free: one card, no plans, nothing to buy.
 * Someone who subscribed before is told how to stop paying.
 */
function freePricingHtml(opts: { terms: string; privacy: string }): string {
  const description = "Tailzu is free: every word, every language, every app, on iPhone, Android, Windows and Mac. There is no plan to pick and nothing to pay.";
  return siteShell({
    title: "Pricing",
    headTitle: "Tailzu Pricing — Free",
    path: "/pricing",
    description,
    ld: [
      pageLd("/pricing", "Tailzu pricing", description),
      crumbsLd([["Tailzu", "/"], ["Pricing", "/pricing"]]),
      appLd(),
    ],
    css: CSS,
    main: `
<p class="eye">Pricing</p>
<h1>Free. Every word.</h1>
<p class="lede">Every voice, every language, every app, on your phone and your computer. There is no plan to pick and nothing to pay.</p>

<div class="field"><div class="plans">
    <section class="plan lead">
      <div class="top"><h2>Tailzu</h2></div>
      <p class="price">$0</p>
      <p class="per">No word limit</p>
      <ul><li>Every voice, every language, every app.</li><li>iPhone, Android, Windows and Mac.</li><li>Meeting notes on the computer.</li></ul>
      <a class="btn" href="/download">Get Tailzu</a>
    </section>
</div></div>

<div class="facts">
  <section>
    <h2>Subscribed before?</h2>
    <p>You no longer need to pay. Cancel an app subscription in your App Store or Google Play subscriptions, and a web one from your Paddle receipt or at <a href="https://paddle.net">paddle.net</a>.</p>
  </section>
</div>

<p class="made"><a href="${esc(opts.terms)}">Terms</a> · <a href="${esc(opts.privacy)}">Privacy</a> · <a href="mailto:support@tailzu.space">support@tailzu.space</a></p>
<p class="made">Tailzu is made by ${SELLER}.</p>`,
  });
}
