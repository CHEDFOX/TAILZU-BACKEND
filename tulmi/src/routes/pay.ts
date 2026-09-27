/**
 * Tailzu's pay page — GET /pay, served as tailzu.space/pay.
 *
 * Where the desktop's Subscribe goes (REVENUECAT_WEB_PAYWALL_URL), because a
 * window has no App Store to buy through. It lists the same plans the app's
 * paywall does, and a choice opens Paddle's checkout over the page with the
 * account id on the transaction as customData.app_user_id, which is how the
 * payment finds its way back to the account.
 *
 *   /pay?app_user_id=<account id>     the desktop's link (it adds the id)
 *   /pay?user=<account id>            the same, as xooteq.com/pay spells it
 *   /pay?_ptxn=txn_…                  a Paddle transaction link: Paddle.js
 *                                     opens that checkout by itself
 *
 * With no account id the prices still show, and the buttons do not: a payment
 * that belongs to nobody unlocks nothing. Dressed in the site's own room
 * (policies/shell.ts), with the plans on its sun field as on /pricing.
 */
import type { PaywallConfig } from "../../../shared/types/api.js";
import { PLAN_CSS, SELLER } from "./policies/pricing.js";
import { siteShell } from "./policies/shell.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amount = (price: string | undefined) => Number(String(price ?? "").replace(/[^0-9.]/g, "")) || 0;

const PRICE_ID = /^pri_[a-z0-9]+$/;
const CLIENT_TOKEN = /^(live|test)_[A-Za-z0-9]+$/;

const CSS = `${PLAN_CSS}
  .note { display: none; margin: 20px 0 0; padding: 16px 20px; border-radius: 16px; background: var(--card); color: var(--white); }
  #pay[data-state="nouser"] .note.nouser, #pay[data-state="done"] .note.done,
  #pay[data-state="error"] .note.error, #pay[data-state="off"] .note.off, #pay[data-state="txn"] .note.txn { display: block; }
  #pay[data-state="nouser"] .plan .btn, #pay[data-state="off"] .plan .btn { display: none; }
  #pay[data-state="done"] .field { opacity: .45; pointer-events: none; }
  .fine { margin: 56px 0 0; max-width: 720px; }
  .fine p { color: var(--dim); font-size: 14px; margin: 0 0 12px; text-transform: none; }
  .fine a { text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
`;

export function payHtml(opts: {
  plans: PaywallConfig["plans"];
  clientToken: string;
  /** Paddle price id per paywall plan id ("annual", "monthly"). */
  priceIds: Record<string, string | undefined>;
  pricing: string;
  terms: string;
  privacy: string;
}): string {
  const token = CLIENT_TOKEN.test(opts.clientToken) ? opts.clientToken : "";
  // Every paid plan shows its price; only one with a valid price id gets a button.
  const offered = (opts.plans ?? [])
    .filter((p) => !p.free && p.price)
    .sort((a, b) => amount(a.price) - amount(b.price))
    .map((p) => {
      const id = opts.priceIds[p.id];
      return { plan: p, priceId: id && PRICE_ID.test(id) ? id : null };
    });
  const ready = !!token && offered.some((x) => x.priceId);

  const cards = offered.map(({ plan, priceId }) => `
    <section class="plan${plan.default ? " lead" : ""}">
      <div class="top"><h2>${esc(plan.label)}</h2>${plan.badge ? `<span class="badge">${esc(plan.badge)}</span>` : ""}</div>
      <p class="price">${esc(plan.price)}</p>
      <p class="per">${esc(plan.period ?? "")}</p>
      ${priceId ? `<button type="button" class="btn" data-price="${esc(priceId)}" disabled>Choose ${esc(plan.label)}</button>` : ""}
    </section>`).join("");

  const config = JSON.stringify({ token }).replace(/</g, "\\u003c");

  return siteShell({
    title: "Subscribe",
    noindex: true,
    css: CSS,
    main: `
<div id="pay" data-state="${ready ? "loading" : "off"}">
<p class="eye">Subscribe</p>
<h1>Choose your plan.</h1>
<p class="lede">Unlimited words on every device you sign in to.</p>

<div class="field"><div class="plans">${cards}
</div></div>

<p class="note nouser">Open this page from Tailzu: Settings, then Subscribe. That is how your payment reaches your account.</p>
<p class="note txn">Opening checkout…</p>
<p class="note done">Paid. Go back to Tailzu; it unlocks in a moment, on every device you sign in to.</p>
<p class="note error">Checkout could not load. Check your connection and reload this page.</p>
<p class="note off">Web checkout is not open yet. Subscribe in the Tailzu app on iPhone or Android.</p>

<div class="fine">
  <p>Prices in US dollars; tax is added at checkout where it applies. Payments are processed by <strong>Paddle.com</strong>, our authorised reseller and Merchant of Record, on behalf of ${SELLER}, which makes Tailzu.</p>
  <p>Plans renew automatically until you cancel. Cancel any time from your Paddle receipt or at <a href="https://paddle.net">paddle.net</a>; you keep access until the end of the period already paid for. Purchases are non-refundable, except where the law requires a refund.</p>
  <p><a href="${esc(opts.pricing)}">Pricing</a> · <a href="${esc(opts.terms)}">Terms</a> · <a href="${esc(opts.privacy)}">Privacy</a> · <a href="https://xooteq.com/refunds">Refunds</a> · <a href="mailto:support@tailzu.space">support@tailzu.space</a></p>
</div>
</div>`,
    script: `
(function () {
  var C = ${config};
  var root = document.getElementById("pay");
  if (root.dataset.state === "off") return;
  var q = new URLSearchParams(location.search);
  var uid = (q.get("app_user_id") || q.get("user") || "").trim();
  var txn = q.get("_ptxn");
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var set = function (s) { root.dataset.state = s; };
  if (!txn && !UUID.test(uid)) { set("nouser"); return; }

  var s = document.createElement("script");
  s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
  s.onerror = function () { set("error"); };
  s.onload = function () {
    try {
      if (C.token.indexOf("test_") === 0) Paddle.Environment.set("sandbox");
      Paddle.Initialize({
        token: C.token,
        eventCallback: function (e) { if (e && e.name === "checkout.completed") set("done"); }
      });
    } catch (e) { set("error"); return; }
    // A transaction link: Paddle.js opens that checkout itself.
    if (txn) { set("txn"); return; }
    set("pick");
    Array.prototype.forEach.call(document.querySelectorAll("button[data-price]"), function (b) {
      b.disabled = false;
      b.addEventListener("click", function () {
        try {
          Paddle.Checkout.open({
            items: [{ priceId: b.getAttribute("data-price"), quantity: 1 }],
            customData: { app_user_id: uid },
            settings: { displayMode: "overlay", theme: "dark", allowLogout: false }
          });
        } catch (e) { set("error"); }
      });
    });
  };
  document.head.appendChild(s);
})();
`,
  });
}
