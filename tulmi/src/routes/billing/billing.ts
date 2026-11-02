/**
 * Paying: the /pay page, Razorpay subscriptions (create, verify, cancel), the store and Razorpay webhooks.
 */

import type { FastifyRequest, FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { reportSubscribe } from "../../ads/meta.js";
import { sameSecret } from "../../auth/secret.js";
import { type AuthedUser, resolveUser } from "../../auth/supabase.js";
import { isEntitled, applyRevenueCatEvent } from "../../billing/entitlements.js";
import {
  payCaller as payLinkCaller, razorpayReady, type Tier, type Market, planFor, type RzPlan, fetchPlan, formatPrice, formatPeriod,
  createSubscription, type RazorpayError, SUB_ID, checkoutSignatureOk, fetchSubscription, ownerOf, syncSubscription, cancelForUser,
  testMode as razorpayTestMode, webhookSignatureOk,
} from "../../billing/razorpay.js";
import type { AppConfig } from "../../config.js";
import { PAYWALL_CONFIG } from "../../experience/phone/paywall.js";
import { POLICY } from "../../experience/policy.js";
import { unauthorized, clip } from "../../http/helpers.js";
import { payCsp, payHtml, type PayOffer } from "./pay.js";

export interface BillingRouteDeps {
  cfg: AppConfig;
}

export function registerBillingRoutes(app: FastifyInstance, deps: BillingRouteDeps): void {
  const { cfg } = deps;
  // Tailzu's pay page (x0bot.com/pay): where the desktop's Subscribe
  // goes. Both markets' plans at Razorpay's prices; the browser picks one.
  app.get("/pay", async (req, reply) => {
    // Nothing is sold while Tailzu is free: the page that would take a
    // payment sends people to the one that says so — unless it is a test link
    // (scripts/paylink.sh), proving the live checkout before launch.
    const q = (req.query ?? {}) as Record<string, string>;
    if (cfg.FREE_FOR_ALL && !payLinkCaller(q)?.test) return reply.redirect("/pricing", 302);
    const nonce = randomBytes(16).toString("base64");
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", payCsp(nonce));
    return payHtml({
      keyId: razorpayReady() ? cfg.RAZORPAY_KEY_ID : "",
      offers: await payOffers(),
      nonce,
      pricing: "https://x0bot.com/pricing",
      terms: POLICY.terms,
      privacy: POLICY.privacy,
    });
  });

  /**
   * The plans the pay page shows, for both markets: Elite and Lite, both monthly, named as the app names them and
   * priced as Razorpay holds them. Lite leads: it is where most people start.
   */
  async function payOffers(): Promise<PayOffer[]> {
    const label = (tier: Tier) => PAYWALL_CONFIG.plans.find((p) => p.id === tier)?.label ?? tier;
    const offers: PayOffer[] = [];
    for (const market of ["IN", "world"] as Market[]) {
      for (const tier of ["elite", "lite"] as Tier[]) {
        const configured = planFor(market, tier);
        if (!configured) continue;
        const plan: RzPlan | null = await fetchPlan(configured.id);
        offers.push(plan
          ? { market, tier, label: label(tier), price: formatPrice(plan), per: formatPeriod(plan), buyable: true,
              ...(tier === "lite" ? { lead: true } : {}) }
          : { market, tier, label: label(tier), price: "—", per: "Not available right now", buyable: false });
      }
    }
    return offers;
  }

  /** Throttled per address: these are reached from a public page. Loose,
   *  because through x0bot.com the address is the site proxy's, which many
   *  buyers share. */
  const PAY_RL = { config: { rateLimit: { max: 30, timeWindow: 60_000 } } };

  /** The caller of a pay-page call: the account its signed link names. */
  function payCaller(b: Record<string, unknown>): string | null {
    return payLinkCaller(b)?.userId ?? null;
  }

  /**
   * A subscription for the caller, made here and never by hand: the plan is
   * one on sale for the market and period asked for, and the account goes in
   * its notes. Refused for an account that already pays — a second
   * subscription on top of a live one bills them twice for the same thing.
   */
  app.post("/v1/pay/razorpay/subscription", PAY_RL, async (req, reply) => {
    if (!razorpayReady()) return reply.code(503).send({ code: "not_configured" });
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const userId = payCaller(b);
    if (!userId) return reply.code(401).send({ code: "link_expired" });
    if (cfg.FREE_FOR_ALL && !payLinkCaller(b)?.test) return reply.code(409).send({ code: "free" });
    const market: Market | null = b.market === "IN" ? "IN" : b.market === "world" ? "world" : null;
    // `plan` names Lite or Elite; a page from before sent `period` ("monthly" was Lite).
    const asked = String(b.plan ?? b.period ?? "");
    const tier: Tier | null = asked === "elite" ? "elite" : asked === "lite" || asked === "monthly" ? "lite" : null;
    const plan = market && tier ? planFor(market, tier) : undefined;
    if (!plan) return reply.code(400).send({ code: "no_such_plan" });
    if (await isEntitled({ id: userId } as AuthedUser).catch(() => false)) {
      return reply.code(409).send({ code: "already_subscribed" });
    }
    try {
      const sub = await createSubscription(userId, plan);
      return reply.send({ subscriptionId: sub.id });
    } catch (err) {
      const e = err as RazorpayError;
      req.log.error({ code: e.code, detail: e.message }, "pay: razorpay refused a subscription");
      return reply.code(502).send({ code: e.code ?? "razorpay", description: e.message });
    }
  });

  /**
   * The checkout's success, from the buyer's browser: unlocks at once.
   *
   * Two checks. Razorpay's signature, HMAC_SHA256(payment_id|subscription_id)
   * with the key secret, says the payment is real; the subscription's own
   * notes, read back from Razorpay, must name the caller, or the payment is
   * someone else's being replayed. Then its current state is saved.
   */
  app.post("/v1/pay/razorpay/verify", PAY_RL, async (req, reply) => {
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const userId = payCaller(b);
    if (!userId) return reply.code(401).send({ ok: false, code: "link_expired" });
    const paymentId = String(b.razorpay_payment_id ?? "");
    const subId = String(b.razorpay_subscription_id ?? "");
    if (!SUB_ID.test(subId) || !checkoutSignatureOk(paymentId, subId, String(b.razorpay_signature ?? ""))) {
      return reply.code(400).send({ ok: false, code: "bad_signature" });
    }
    try {
      const sub = await fetchSubscription(subId);
      if (ownerOf(sub) !== userId) return reply.code(403).send({ ok: false, code: "not_yours" });
      const res = await syncSubscription(sub, "checkout");
      req.log.info({ rz: res }, "[billing] razorpay checkout");
      if (res.ok && res.entitledUntil && res.entitledUntil > Date.now()) void subscribedToMeta(sub, userId, req);
      return reply.code(res.ok ? 200 : 500).send({ ok: res.ok, entitled: !!res.entitledUntil && res.entitledUntil > Date.now() });
    } catch (err) {
      req.log.error({ detail: (err as Error).message }, "pay: razorpay verify failed");
      return reply.code(502).send({ ok: false, code: "razorpay" });
    }
  });

  /**
   * Cancel from inside the app: signed in, for the caller's own subscription.
   * Razorpay is told to stop at the end of the period (cancel_at_cycle_end);
   * access runs to that end.
   */
  app.post("/v1/billing/razorpay/cancel", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    try {
      const res = await cancelForUser(user.id);
      if (!res.ok) return reply.code(404).send({ code: res.code ?? "no_subscription" });
      const until = res.until ? new Date(res.until) : null;
      return reply.send({
        ok: true,
        until: until?.toISOString() ?? null,
        message: until
          ? `Cancelled. Unlimited stays on until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`
          : "Cancelled. Unlimited stays on until the end of the period you paid for.",
      });
    } catch (err) {
      const e = err as RazorpayError;
      req.log.error({ code: e.code, detail: e.message }, "pay: razorpay refused a cancel");
      return reply.code(502).send({ code: e.code ?? "razorpay" });
    }
  });

  // What went wrong in a buyer's checkout, in the checkout's own words. The pay
  // page sends Razorpay's error code here when a payment or the checkout fails,
  // so the cause is one grep away:
  //   docker compose logs --since 1h | grep "pay:"
  // Unauthenticated by necessity (the buyer is on a web page), so it is capped,
  // trimmed to printable text and only ever logged.
  app.post("/v1/pay/report", { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (req, reply) => {
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const code = clip(b.code, 80);
    if (code) req.log.warn({ where: clip(b.where, 20), code, detail: clip(b.detail, 600) }, "pay: checkout failed");
    return reply.code(204).send();
  });

  /**
   * RevenueCat's webhook — the only thing that may grant a subscription.
   *
   * Authenticated by a shared secret RevenueCat sends verbatim as the
   * Authorization header. With no secret configured this refuses everything:
   * an open endpoint that grants entitlements is a free subscription for anyone
   * who finds the URL, so it fails closed.
   *
   * Always answers 200 once authorised, even when an event is unusable.
   * RevenueCat retries non-2xx for hours, and a malformed event will never
   * become valid — retrying it forever buries the real ones.
   *
   * Throttled per address, far above anything RevenueCat sends (a 429 is only
   * retried later), so the secret cannot be guessed at line rate.
   */
  app.post("/v1/billing/revenuecat", { config: { rateLimit: { max: 600, timeWindow: 60_000 } } }, async (req, reply) => {
    const expected = cfg.REVENUECAT_WEBHOOK_SECRET ?? "";
    if (!expected) {
      req.log.error("[billing] webhook hit with no REVENUECAT_WEBHOOK_SECRET set");
      return reply.code(503).send({ code: "not_configured" });
    }
    // Timing-safe, both spellings always compared: RevenueCat sends the value
    // verbatim, and a proxy or a dashboard edit may have put "Bearer " before it.
    const got = String(req.headers["authorization"] ?? "");
    const bare = sameSecret(got, expected);
    const bearer = sameSecret(got, `Bearer ${expected}`);
    if (!bare && !bearer) {
      return reply.code(401).send({ code: "unauthorized" });
    }
    const body = (req.body ?? {}) as { event?: Record<string, unknown> };
    const ev = (body.event ?? {}) as Record<string, unknown>;
    const res = await applyRevenueCatEvent(ev as never, cfg.REVENUECAT_ENTITLEMENT);
    // Logged either way: a webhook that silently does nothing looks exactly like
    // one that worked, and this is how a missing subscription gets diagnosed.
    req.log.info({ rc: res, type: ev.type }, "[billing] revenuecat event");
    return reply.send(res);
  });

  /**
   * A subscription's first payment, to Meta as Subscribe with its price.
   * Not for Razorpay's test keys, unless Meta is in its own test mode too:
   * a test payment is not a subscriber, and would teach the ads one.
   */
  async function subscribedToMeta(sub: { id: string; plan_id?: string }, userId: string, req?: FastifyRequest): Promise<void> {
    if (razorpayTestMode() && !cfg.META_TEST_EVENT_CODE) return;
    const plan = sub.plan_id ? await fetchPlan(sub.plan_id).catch(() => null) : null;
    reportSubscribe({
      subscriptionId: sub.id,
      userId,
      value: plan ? plan.item.amount / 100 : undefined,
      currency: plan?.item.currency,
      req,
    });
  }

  /**
   * Razorpay's webhook: every renewal, failed charge, pause and cancellation.
   *
   * No user auth — Razorpay is the caller — and authenticated instead by
   * HMAC_SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET
   * (X-Razorpay-Signature). With no secret it refuses everything, as the
   * RevenueCat one does: an open endpoint that grants access is a free
   * subscription for anyone who finds it.
   *
   * ONLY A SIGNAL. The event says which subscription changed; what is saved is
   * that subscription as Razorpay reports it now. Webhooks arrive late, twice
   * and out of order, and an old event can then never write an old state.
   *
   * 200 for anything authentic, even with nothing to do. A failed read or
   * write answers 500, so Razorpay sends it again.
   */
  app.post("/v1/billing/razorpay", { config: { rateLimit: { max: 600, timeWindow: 60_000 } } }, async (req, reply) => {
    if (!cfg.RAZORPAY_WEBHOOK_SECRET) {
      req.log.error("[billing] razorpay webhook hit with no RAZORPAY_WEBHOOK_SECRET set");
      return reply.code(503).send({ code: "not_configured" });
    }
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
    if (!webhookSignatureOk(raw, String(req.headers["x-razorpay-signature"] ?? ""))) {
      return reply.code(401).send({ code: "unauthorized" });
    }
    const body = (req.body ?? {}) as {
      event?: string;
      payload?: { subscription?: { entity?: { id?: string } }; payment?: { entity?: { subscription_id?: string } } };
    };
    const event = String(body.event ?? "");
    const subId = String(body.payload?.subscription?.entity?.id ?? body.payload?.payment?.entity?.subscription_id ?? "");
    if (!SUB_ID.test(subId)) return reply.send({ ok: true, reason: `ignored ${event}` });
    try {
      const sub = await fetchSubscription(subId);
      const res = await syncSubscription(sub, event);
      req.log.info({ rz: res, event }, "[billing] razorpay event");
      // Its first charge, when the buyer's browser did not report it already.
      if (res.ok && res.userId && event === "subscription.charged" && sub.paid_count === 1) {
        void subscribedToMeta(sub, res.userId);
      }
      return reply.code(res.ok ? 200 : 500).send(res);
    } catch (err) {
      // Razorpay's own words go back with the 500: "The id provided does not
      // exist" means the keys work, "Authentication failed" means they do not.
      req.log.error({ event, subId, detail: (err as Error).message }, "[billing] razorpay event: could not read the subscription");
      return reply.code(500).send({ ok: false, reason: "could not read the subscription", detail: (err as Error).message.slice(0, 200) });
    }
  });
}
