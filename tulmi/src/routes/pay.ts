/**
 * Tailzu's pay page — GET /pay, served as pay.tailzu.space.
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
 * that belongs to nobody unlocks nothing.
 */
import type { PaywallConfig } from "../../../shared/types/api.js";
import { SELLER } from "./policies/pricing.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PRICE_ID = /^pri_[a-z0-9]+$/;
const CLIENT_TOKEN = /^(live|test)_[A-Za-z0-9]+$/;

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
    .map((p) => {
      const id = opts.priceIds[p.id];
      return { plan: p, priceId: id && PRICE_ID.test(id) ? id : null };
    });
  const ready = !!token && offered.some((x) => x.priceId);

  const cards = offered.map(({ plan, priceId }) => `
    <section class="plan${plan.default ? " lead" : ""}">
      <div class="head"><h2>${esc(plan.label)}</h2>${plan.badge ? `<span class="badge">${esc(plan.badge)}</span>` : ""}</div>
      <p class="price">${esc(plan.price)}</p>
      <p class="period">${esc(plan.period ?? "")}</p>
      ${priceId ? `<button type="button" data-price="${esc(priceId)}" disabled>Choose ${esc(plan.label)}</button>` : ""}
    </section>`).join("");

  const config = JSON.stringify({ token }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Subscribe — Tailzu</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<style>
  :root { --bg: #ffffff; --ink: #16171a; --muted: #62656d; --line: #e4e5e8; --card: #fafafb; --btn: #16171a; --btn-ink: #ffffff; --link: #2656c9; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0e0f11; --ink: #eceef1; --muted: #9a9ea6; --line: #26282d; --card: #15171a; --btn: #eceef1; --btn-ink: #0e0f11; --link: #8fb0ff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 20px 64px; }
  .brand { font-weight: 700; letter-spacing: 0.02em; margin: 0 0 32px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; text-wrap: balance; }
  .lede { color: var(--muted); margin: 0 0 28px; }
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
  .plan { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 22px; display: flex; flex-direction: column; }
  .plan.lead { border-color: var(--ink); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .plan h2 { font-size: 18px; margin: 0; }
  .badge { font-size: 12px; font-weight: 600; letter-spacing: 0.03em; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; color: var(--muted); }
  .price { font-size: 32px; font-weight: 700; margin: 14px 0 0; font-variant-numeric: tabular-nums; }
  .period { color: var(--muted); margin: 0 0 20px; }
  button { margin-top: auto; font: inherit; font-weight: 600; min-height: 46px; border-radius: 10px; border: 0; background: var(--btn); color: var(--btn-ink); cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  button:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  .note { margin: 24px 0 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; display: none; }
  body[data-state="nouser"] .note.nouser, body[data-state="done"] .note.done,
  body[data-state="error"] .note.error, body[data-state="off"] .note.off, body[data-state="txn"] .note.txn { display: block; }
  body[data-state="nouser"] button, body[data-state="off"] button { display: none; }
  body[data-state="done"] .plans { opacity: 0.4; pointer-events: none; }
  .fine { color: var(--muted); font-size: 14px; margin-top: 36px; border-top: 1px solid var(--line); padding-top: 20px; }
  .fine p { margin: 0 0 10px; }
  a { color: var(--link); }
</style>
</head>
<body data-state="${ready ? "loading" : "off"}">
<main>
  <p class="brand">TAILZU</p>
  <h1>Choose Your Plan</h1>
  <p class="lede">Unlimited words on every device you sign in to. Prices in US dollars; tax is added at checkout where it applies.</p>

  <div class="plans">${cards}
  </div>

  <p class="note nouser">Open this page from Tailzu: Settings, then Subscribe. That is how your payment reaches your account.</p>
  <p class="note txn">Opening checkout…</p>
  <p class="note done"><strong>Paid.</strong> Go back to Tailzu. It unlocks in a moment, on every device you sign in to.</p>
  <p class="note error">Checkout could not load. Check your connection and reload this page.</p>
  <p class="note off">Web checkout is not open yet. Subscribe in the Tailzu app on iPhone or Android.</p>

  <div class="fine">
    <p>Payments are processed by <strong>Paddle.com</strong>, our authorised reseller and Merchant of Record, on behalf of ${SELLER}, which makes Tailzu.</p>
    <p>Plans renew automatically until you cancel. Cancel any time from your Paddle receipt or at <a href="https://paddle.net">paddle.net</a>; you keep access until the end of the period already paid for. Purchases are non-refundable, except where the law requires a refund.</p>
    <p><a href="${esc(opts.pricing)}">Pricing</a> · <a href="${esc(opts.terms)}">Terms</a> · <a href="${esc(opts.privacy)}">Privacy</a> · <a href="https://xooteq.com/refunds">Refunds</a> · <a href="mailto:support@tailzu.space">support@tailzu.space</a></p>
  </div>
</main>
<script>
(function () {
  var C = ${config};
  var body = document.body;
  if (body.dataset.state === "off") return;
  var q = new URLSearchParams(location.search);
  var uid = (q.get("app_user_id") || q.get("user") || "").trim();
  var txn = q.get("_ptxn");
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var set = function (s) { body.dataset.state = s; };
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
    var dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
    Array.prototype.forEach.call(document.querySelectorAll("button[data-price]"), function (b) {
      b.disabled = false;
      b.addEventListener("click", function () {
        try {
          Paddle.Checkout.open({
            items: [{ priceId: b.getAttribute("data-price"), quantity: 1 }],
            customData: { app_user_id: uid },
            settings: { displayMode: "overlay", theme: dark ? "dark" : "light", allowLogout: false }
          });
        } catch (e) { set("error"); }
      });
    });
  };
  document.head.appendChild(s);
})();
</script>
</body>
</html>`;
}
