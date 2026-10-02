/**
 * Tailzu's pay page — GET /pay, served as tailzu.space/pay.
 *
 * Where the desktop's Subscribe goes, because a window has no App Store to
 * buy through. The desktop opens it by a link the server signed for the
 * account (razorpay.payLink: ?u=…&e=…&t=…), and every call the page makes
 * carries that signature back, which is how the server knows who is paying.
 *
 * Both markets' plans are on the page; the browser's time zone picks one:
 * Asia/Kolkata (or its old name, Asia/Calcutta) sees the IN plans, in rupees,
 * everyone else the world plans. A choice asks the server for a subscription,
 * and Razorpay's checkout opens to authorise it. Nothing on the page decides
 * a price or a plan id; it names a market and a period, and the server maps
 * those to plans it has on sale.
 *
 * Served with a Content-Security-Policy that allows Razorpay (*.razorpay.com)
 * and the page's own script by nonce, and nothing else that runs.
 */
import { PLAN_CSS, SELLER, esc } from "./policies/pricing.js";
import { siteShell } from "./policies/shell.js";

/** One plan as the page shows it. `buyable` is false when its price could
 *  not be read from Razorpay: the card stays, the button does not. */
export interface PayOffer {
  market: "IN" | "world";
  period: "monthly" | "annual";
  label: string;
  price: string;
  per: string;
  badge?: string;
  lead?: boolean;
  buyable: boolean;
}

const KEY_ID = /^rzp_(?:live|test)_[A-Za-z0-9]+$/;

/** The policy the pay page is served with. Razorpay's checkout loads from
 *  checkout.razorpay.com and frames api.razorpay.com; the wildcard covers
 *  those and the assets they pull. */
export function payCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' https://*.razorpay.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    "img-src 'self' data: https://tailzu.space https://*.razorpay.com",
    "connect-src 'self' https://*.razorpay.com",
    "frame-src https://*.razorpay.com",
    "form-action 'self' https://*.razorpay.com",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const CSS = `${PLAN_CSS}
  .note { display: none; margin: 20px 0 0; padding: 16px 20px; border-radius: 16px; background: var(--card); color: var(--white); }
  #pay[data-state="nouser"] .note.nouser, #pay[data-state="done"] .note.done,
  #pay[data-state="error"] .note.error, #pay[data-state="off"] .note.off, #pay[data-state="opening"] .note.opening,
  #pay[data-state="failed"] .note.failed, #pay[data-state="subscribed"] .note.subscribed { display: block; }
  .note code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; opacity: .8; text-transform: none; }
  #pay[data-state="nouser"] .plan .btn, #pay[data-state="off"] .plan .btn, #pay[data-state="subscribed"] .plan .btn { display: none; }
  #pay[data-state="done"] .field, #pay[data-state="opening"] .field { opacity: .45; pointer-events: none; }
  #pay[data-market="IN"] .plan[data-market="world"], #pay[data-market="world"] .plan[data-market="IN"] { display: none; }
  .fine { margin: 56px 0 0; max-width: 720px; }
  .fine p { color: var(--dim); font-size: 14px; margin: 0 0 12px; text-transform: none; }
  .fine a { text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
`;

export function payHtml(opts: {
  keyId: string;
  offers: PayOffer[];
  /** A fresh value per response, for the script's CSP nonce. */
  nonce: string;
  pricing: string;
  terms: string;
  privacy: string;
}): string {
  const key = KEY_ID.test(opts.keyId) ? opts.keyId : "";
  const ready = !!key && opts.offers.some((o) => o.buyable);

  const cards = opts.offers.map((o) => `
    <section class="plan${o.lead ? " lead" : ""}" data-market="${o.market}">
      <div class="top"><h2>${esc(o.label)}</h2>${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ""}</div>
      <p class="price">${esc(o.price)}</p>
      <p class="per">${esc(o.per)}</p>
      ${o.buyable ? `<button type="button" class="btn" data-market="${o.market}" data-period="${o.period}" data-label="${esc(o.label)}" disabled>Choose ${esc(o.label)}</button>` : ""}
    </section>`).join("");

  const config = JSON.stringify({ key }).replace(/</g, "\\u003c");

  return siteShell({
    title: "Subscribe",
    noindex: true,
    css: CSS,
    nonce: opts.nonce,
    main: `
<div id="pay" data-state="${ready ? "loading" : "off"}" data-market="world">
<p class="eye">Subscribe</p>
<h1>Choose your plan.</h1>
<p class="lede">Unlimited words on every device you sign in to.</p>

<div class="field"><div class="plans">${cards}
</div></div>

<p class="note nouser">Open this page from Tailzu: Settings, then Subscribe. That is how your payment reaches your account.</p>
<p class="note opening">Opening checkout…</p>
<p class="note done">Paid. Go back to Tailzu; it unlocks in a moment, on every device you sign in to.</p>
<p class="note subscribed">This account already has Unlimited. To cancel it, open Tailzu: Settings, then Cancel subscription.</p>
<p class="note error">Checkout could not load. Check your connection and reload this page.</p>
<p class="note failed">The payment did not go through. Try again, or write to support@tailzu.space with this code: <code></code></p>
<p class="note off">Web checkout is not open yet. Subscribe in the Tailzu app on iPhone or Android.</p>

<div class="fine">
  <p>Prices are shown in the currency you are charged in. Payments are processed by <strong>Razorpay</strong> for ${SELLER}, which makes Tailzu.</p>
  <p>Plans renew automatically until you cancel. Cancel any time in Tailzu: Settings, then Cancel subscription. You keep access until the end of the period already paid for. Purchases are non-refundable, except where the law requires a refund.</p>
  <p><a href="${esc(opts.pricing)}">Pricing</a> · <a href="${esc(opts.terms)}">Terms</a> · <a href="${esc(opts.privacy)}">Privacy</a> · <a href="https://xooteq.com/refunds">Refunds</a> · <a href="mailto:support@tailzu.space">support@tailzu.space</a></p>
</div>
</div>`,
    script: `
(function () {
  var C = ${config};
  var root = document.getElementById("pay");
  var set = function (s) { root.dataset.state = s; };

  // WHICH PRICES: India's time zone sees rupees, everyone else dollars.
  var tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (x) {}
  var market = (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") ? "IN" : "world";
  root.dataset.market = market;
  if (root.dataset.state === "off") return;
  if (!document.querySelector('button[data-market="' + market + '"]')) { set("off"); return; }

  // WHO IS PAYING: the link the server signed for this account.
  var q = new URLSearchParams(location.search);
  var caller = { u: q.get("u") || "", e: q.get("e") || "", t: q.get("t") || "", x: q.get("x") || "" };
  if (!caller.u || !caller.e || !caller.t) { set("nouser"); return; }

  var report = function (where, err) {
    var e = (err && (err.error || err)) || {};
    var code = String(e.code || e.reason || e.name || where).slice(0, 80);
    var detail = String(e.description || e.message || e.detail || "");
    if (!detail) { try { detail = JSON.stringify(err); } catch (x) {} }
    detail = String(detail || "").slice(0, 600);
    try {
      var body = JSON.stringify({ where: where, code: code, detail: detail });
      if (!(navigator.sendBeacon && navigator.sendBeacon("/v1/pay/report", new Blob([body], { type: "application/json" }))))
        fetch("/v1/pay/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
    } catch (x) {}
    return code + (detail ? " · " + detail.slice(0, 200) : "");
  };
  var fail = function (where, err) {
    var code = report(where, err);
    var c = root.querySelector(".note.failed code"); if (c) c.textContent = code;
    set("failed");
  };
  var post = function (path, body) {
    var all = { u: caller.u, e: caller.e, t: caller.t, x: caller.x };
    for (var k in body) all[k] = body[k];
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(all) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  };

  var s = document.createElement("script");
  s.src = "https://checkout.razorpay.com/v1/checkout.js";
  s.onerror = function () { set("error"); };
  s.onload = function () {
    set("pick");
    Array.prototype.forEach.call(document.querySelectorAll('button[data-market="' + market + '"]'), function (b) {
      b.disabled = false;
      b.addEventListener("click", function () {
        set("opening");
        // The server makes the subscription, for the signed caller, from a
        // plan it has on sale: this page only names a market and a period.
        post("/v1/pay/razorpay/subscription", { market: market, period: b.getAttribute("data-period") }).then(function (r) {
          if (r.code === "already_subscribed") { set("subscribed"); return; }
          if (r.code === "link_expired") { set("nouser"); return; }
          if (!r.subscriptionId) { fail("create", r); return; }
          try {
            var rzp = new Razorpay({
              key: C.key,
              subscription_id: r.subscriptionId,
              name: "Tailzu",
              description: b.getAttribute("data-label") || "Tailzu",
              theme: { color: "#F7CF4A" },
              modal: { ondismiss: function () { if (root.dataset.state === "opening") set("pick"); } },
              handler: function (p) {
                post("/v1/pay/razorpay/verify", p).then(function (v) {
                  // Paid either way once Razorpay calls this; the webhook
                  // records it too. A failed check is reported, not shown.
                  if (!v.ok) report("verify", v);
                  set("done");
                }, function (e) { report("verify", e); set("done"); });
              }
            });
            rzp.on("payment.failed", function (resp) { fail("payment", resp); });
            rzp.open();
          } catch (e) { fail("open", e); }
        }, function (e) { fail("create", e); });
      });
    });
  };
  document.head.appendChild(s);
})();
`,
  });
}
