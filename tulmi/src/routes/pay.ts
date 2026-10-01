/**
 * Tailzu's pay page — GET /pay, served as tailzu.space/pay.
 *
 * Where the desktop's Subscribe goes (REVENUECAT_WEB_PAYWALL_URL), because a
 * window has no App Store to buy through. It lists the plans with the prices
 * Razorpay holds for them, and a choice asks this server for a subscription
 * carrying the account id, then opens Razorpay's checkout to authorise it.
 *
 *   /pay?app_user_id=<account id>     the desktop's link (it adds the id)
 *   /pay?user=<account id>            the same, as xooteq.com/pay spells it
 *
 * With no account id the prices still show, and the buttons do not: a payment
 * that belongs to nobody unlocks nothing. Dressed in the site's own room
 * (policies/shell.ts), with the plans on its sun field as on /pricing.
 *
 * Also here: GET /pay/manage, where a Razorpay subscriber stops renewing.
 */
import { PLAN_CSS, SELLER, esc } from "./policies/pricing.js";
import { siteShell } from "./policies/shell.js";

/** One plan as the page shows it. `buyable` is false when its price could
 *  not be read from Razorpay: the card stays, the button does not. */
export interface PayOffer {
  key: "monthly" | "annual";
  label: string;
  price: string;
  per: string;
  badge?: string;
  lead?: boolean;
  buyable: boolean;
}

const KEY_ID = /^rzp_(?:live|test)_[A-Za-z0-9]+$/;

const CSS = `${PLAN_CSS}
  .note { display: none; margin: 20px 0 0; padding: 16px 20px; border-radius: 16px; background: var(--card); color: var(--white); }
  #pay[data-state="nouser"] .note.nouser, #pay[data-state="done"] .note.done,
  #pay[data-state="error"] .note.error, #pay[data-state="off"] .note.off, #pay[data-state="opening"] .note.opening,
  #pay[data-state="failed"] .note.failed, #pay[data-state="subscribed"] .note.subscribed { display: block; }
  .note code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; opacity: .8; text-transform: none; }
  #pay[data-state="nouser"] .plan .btn, #pay[data-state="off"] .plan .btn, #pay[data-state="subscribed"] .plan .btn { display: none; }
  #pay[data-state="done"] .field, #pay[data-state="opening"] .field { opacity: .45; pointer-events: none; }
  .fine { margin: 56px 0 0; max-width: 720px; }
  .fine p { color: var(--dim); font-size: 14px; margin: 0 0 12px; text-transform: none; }
  .fine a { text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
`;

function fine(opts: { pricing: string; terms: string; privacy: string }): string {
  return `
<div class="fine">
  <p>Prices are shown in the currency you are charged in. Payments are processed by <strong>Razorpay</strong> for ${SELLER}, which makes Tailzu.</p>
  <p>Plans renew automatically until you cancel. Cancel any time in Tailzu: Settings, then Manage. You keep access until the end of the period already paid for. Purchases are non-refundable, except where the law requires a refund.</p>
  <p><a href="${esc(opts.pricing)}">Pricing</a> · <a href="${esc(opts.terms)}">Terms</a> · <a href="${esc(opts.privacy)}">Privacy</a> · <a href="https://xooteq.com/refunds">Refunds</a> · <a href="mailto:support@tailzu.space">support@tailzu.space</a></p>
</div>`;
}

/**
 * The script both pages share for telling the server why a checkout failed.
 * Razorpay's modal says only that a payment failed; its error carries the
 * reason, and that goes to the buyer (to quote to support) and to the log.
 */
const REPORT_JS = `
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
  var post = function (path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  };`;

export function payHtml(opts: {
  keyId: string;
  offers: PayOffer[];
  pricing: string;
  terms: string;
  privacy: string;
}): string {
  const key = KEY_ID.test(opts.keyId) ? opts.keyId : "";
  const ready = !!key && opts.offers.some((o) => o.buyable);

  const cards = opts.offers.map((o) => `
    <section class="plan${o.lead ? " lead" : ""}">
      <div class="top"><h2>${esc(o.label)}</h2>${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ""}</div>
      <p class="price">${esc(o.price)}</p>
      <p class="per">${esc(o.per)}</p>
      ${o.buyable ? `<button type="button" class="btn" data-plan="${o.key}" data-label="${esc(o.label)}" disabled>Choose ${esc(o.label)}</button>` : ""}
    </section>`).join("");

  const config = JSON.stringify({ key }).replace(/</g, "\\u003c");

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
<p class="note opening">Opening checkout…</p>
<p class="note done">Paid. Go back to Tailzu; it unlocks in a moment, on every device you sign in to.</p>
<p class="note subscribed">This account already has Unlimited. To change or cancel it, open Tailzu: Settings, then Manage.</p>
<p class="note error">Checkout could not load. Check your connection and reload this page.</p>
<p class="note failed">The payment did not go through. Try again, or write to support@tailzu.space with this code: <code></code></p>
<p class="note off">Web checkout is not open yet. Subscribe in the Tailzu app on iPhone or Android.</p>
${fine(opts)}
</div>`,
    script: `
(function () {
  var C = ${config};
  var root = document.getElementById("pay");
  if (root.dataset.state === "off") return;
  var q = new URLSearchParams(location.search);
  var uid = (q.get("app_user_id") || q.get("user") || "").trim();
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var set = function (s) { root.dataset.state = s; };
  if (!UUID.test(uid)) { set("nouser"); return; }
${REPORT_JS}
  var fail = function (where, err) {
    var code = report(where, err);
    var c = root.querySelector(".note.failed code"); if (c) c.textContent = code;
    set("failed");
  };

  var s = document.createElement("script");
  s.src = "https://checkout.razorpay.com/v1/checkout.js";
  s.onerror = function () { set("error"); };
  s.onload = function () {
    set("pick");
    Array.prototype.forEach.call(document.querySelectorAll("button[data-plan]"), function (b) {
      b.disabled = false;
      b.addEventListener("click", function () {
        set("opening");
        // The subscription is made by the server, with the account id in it:
        // nothing this page sends can point a payment anywhere else.
        post("/v1/pay/razorpay/subscription", { user: uid, plan: b.getAttribute("data-plan") }).then(function (r) {
          if (r.code === "already_subscribed") { set("subscribed"); return; }
          if (!r.subscriptionId) { fail("create", r); return; }
          try {
            var rzp = new Razorpay({
              key: C.key,
              subscription_id: r.subscriptionId,
              name: "Tailzu",
              description: b.getAttribute("data-label") || "Tailzu",
              notes: { app_user_id: uid },
              theme: { color: "#F7CF4A" },
              modal: { ondismiss: function () { if (root.dataset.state === "opening") set("pick"); } },
              handler: function (p) {
                post("/v1/pay/razorpay/verify", p).then(function (v) {
                  // Paid either way once Razorpay calls this; the webhook
                  // writes it too. A failed check is reported, not shown.
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

/**
 * GET /pay/manage — a Razorpay subscriber's plan, and the one thing a page
 * outside the app can safely do with it: stop it renewing. Reached from the
 * app's Manage row, by a link signed for this account (razorpay.manageLink).
 */
export function manageHtml(opts: {
  /** Null when the link was not genuine or has expired. */
  state: "expired" | "none" | "renewing" | "ending";
  /** "12 Oct 2026": when access ends, or renews. */
  until?: string;
  plan?: string;
  link?: { u: string; e: string; t: string };
  pricing: string;
  terms: string;
  privacy: string;
}): string {
  const body: Record<typeof opts.state, string> = {
    expired: `<p class="lede">This link has expired. Open Tailzu: Settings, then Manage, for a new one.</p>`,
    none: `<p class="lede">There is no Razorpay subscription on this account. A subscription bought in the App Store or Google Play is changed there.</p>`,
    renewing: `<p class="lede">${esc(opts.plan ?? "Unlimited")}. Renews on ${esc(opts.until ?? "")}.</p>
<p><button type="button" class="btn" id="cancel">Cancel subscription</button></p>
<p class="note failed">Could not cancel. Try again, or write to support@tailzu.space with this code: <code></code></p>`,
    ending: `<p class="lede">${esc(opts.plan ?? "Unlimited")}. Cancelled: it will not renew, and stays on until ${esc(opts.until ?? "the end of the period")}.</p>`,
  };
  const config = JSON.stringify(opts.link ?? {}).replace(/</g, "\\u003c");
  return siteShell({
    title: "Your plan",
    noindex: true,
    css: `${CSS}
  #manage[data-state="failed"] .note.failed { display: block; }
  #manage .btn { margin-top: 8px; }`,
    main: `
<div id="manage" data-state="${opts.state}">
<p class="eye">Your plan</p>
<h1>${opts.state === "ending" ? "Cancelled." : opts.state === "renewing" ? "Unlimited." : "Your plan."}</h1>
${body[opts.state]}
${fine(opts)}
</div>`,
    script: opts.state !== "renewing" ? "" : `
(function () {
  var L = ${config};
  var root = document.getElementById("manage");
${REPORT_JS}
  var b = document.getElementById("cancel");
  b.addEventListener("click", function () {
    if (!confirm("Cancel your Tailzu subscription? It stays on until the end of the period you paid for.")) return;
    b.disabled = true;
    post("/v1/pay/razorpay/cancel", L).then(function (r) {
      if (r.ok) { location.reload(); return; }
      var c = root.querySelector(".note.failed code"); if (c) c.textContent = report("cancel", r);
      root.dataset.state = "failed"; b.disabled = false;
    }, function (e) {
      var c = root.querySelector(".note.failed code"); if (c) c.textContent = report("cancel", e);
      root.dataset.state = "failed"; b.disabled = false;
    });
  });
})();
`,
  });
}
