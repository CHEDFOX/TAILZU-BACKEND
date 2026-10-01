/**
 * Razorpay — the web's way to pay for Tailzu, and the desktop's only one.
 *
 * RevenueCat carries the phones and writes public.entitlements. It has no
 * Razorpay integration, so for Razorpay this file is the integration, with a
 * table of its own (public.razorpay_subscriptions, migration 0015). Neither
 * source can overwrite the other's rows; an account is entitled when either
 * says so (entitlements.getEntitlement).
 *
 * EVERYTHING IS DRIVEN FROM HERE.
 *
 *   plans         created once by scripts/razorpay-plans.mjs, and listed in
 *                 RAZORPAY_PLANS tagged with their market (IN, world)
 *   subscription  created by this server for each purchase, never by hand,
 *                 with the account in its notes (user_id), and recorded at once
 *   checkout      the browser authorises that subscription; /verify checks
 *                 Razorpay's signature and that the subscription is the
 *                 caller's, and unlocks then and there
 *   webhook       authenticated by its signature, and used only as a signal:
 *                 the subscription is read back from Razorpay and its CURRENT
 *                 state saved, so an old or out-of-order event cannot write
 *                 an old state
 *   cancel        in the app, at the end of the period; remembered for good
 *
 * WHAT A STATUS MEANS (entitlementWindow):
 *
 *   active, authenticated   entitled to the period's end + 24 h slack
 *   pending                 a renewal is being retried: entitled through a grace
 *   cancelled               entitled to the end of the period paid for
 *   halted, completed,
 *   expired, paused         locked
 *   created                 nothing paid yet: not entitled
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { supabase } from "../auth/supabase.js";
import { forgetEntitlement, primaryEntitlement, type Entitlement } from "./entitlements.js";

const API = "https://api.razorpay.com/v1";
const SITE = "https://tailzu.space";
const TABLE = "razorpay_subscriptions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KEY_ID = /^rzp_(?:live|test)_[A-Za-z0-9]+$/;
export const PLAN_ID = /^plan_[A-Za-z0-9]+$/;
export const SUB_ID = /^sub_[A-Za-z0-9]+$/;

/** Past the period's end while it renews: the charge and its webhook land
 *  around that moment, and nobody should be locked out in between. */
export const SLACK_MS = 24 * 3600_000;
/** A renewal that failed is retried by Razorpay over several days before it
 *  gives up (halted). Access holds for this long past the period's end. */
export const PENDING_GRACE_MS = 7 * 24 * 3600_000;

export type Market = "IN" | "world";
export type Period = "monthly" | "annual";
export interface SellablePlan { market: Market; period: Period; id: string }

/** Both keys present and well formed. Without them nothing is sold. */
export function razorpayReady(): boolean {
  const c = getConfig();
  return KEY_ID.test(c.RAZORPAY_KEY_ID) && !!c.RAZORPAY_KEY_SECRET;
}

/** Test mode: rzp_test_ keys take test cards and charge nobody. */
export function testMode(): boolean {
  return getConfig().RAZORPAY_KEY_ID.startsWith("rzp_test_");
}

/**
 * The plans on sale, from RAZORPAY_PLANS ("IN:monthly:plan_…,world:annual:…").
 * A malformed entry is left out, so a typo takes one plan off sale rather
 * than selling something nobody meant to.
 */
export function sellablePlans(): SellablePlan[] {
  const out: SellablePlan[] = [];
  for (const part of getConfig().RAZORPAY_PLANS.split(",")) {
    const [m, p, id] = part.trim().split(":").map((x) => x.trim());
    const market = m === "IN" ? "IN" : m?.toLowerCase() === "world" ? "world" : null;
    const period = p === "monthly" ? "monthly" : p === "annual" || p === "yearly" ? "annual" : null;
    if (market && period && id && PLAN_ID.test(id) && !out.some((x) => x.market === market && x.period === period)) {
      out.push({ market, period, id });
    }
  }
  return out;
}

export function planFor(market: Market, period: Period): SellablePlan | undefined {
  return sellablePlans().find((p) => p.market === market && p.period === period);
}

function sellable(planId: string | undefined): SellablePlan | undefined {
  return sellablePlans().find((p) => p.id === planId);
}

/** Razorpay's own words when it refuses, so the log names the fix. */
export class RazorpayError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const c = getConfig();
  if (!razorpayReady()) throw new RazorpayError(503, "not_configured", "Razorpay keys are not set");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.RAZORPAY_KEY_ID}:${c.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; description?: string } };
  if (!res.ok) {
    throw new RazorpayError(res.status, String(json.error?.code ?? res.status), String(json.error?.description ?? res.statusText));
  }
  return json as T;
}

// --- Plans --------------------------------------------------------------------

export interface RzPlan {
  id: string;
  period: "daily" | "weekly" | "monthly" | "yearly" | string;
  interval: number;
  item: { name?: string; amount: number; currency: string };
}

const planCache = new Map<string, { at: number; plan: RzPlan | null }>();

/**
 * A plan as Razorpay holds it: price, currency, period. Read from Razorpay
 * rather than written down here, so the page can never quote a price the
 * checkout then contradicts. A failure is cached briefly, so an outage does
 * not make every page view wait on it.
 */
export async function fetchPlan(id: string): Promise<RzPlan | null> {
  const hit = planCache.get(id);
  if (hit && Date.now() - hit.at < (hit.plan ? 10 * 60_000 : 60_000)) return hit.plan;
  let plan: RzPlan | null = null;
  try {
    const p = await call<RzPlan>("GET", `/plans/${encodeURIComponent(id)}`);
    if (p?.item && Number.isFinite(p.item.amount) && p.item.currency) plan = p;
  } catch (err) {
    console.error(`[razorpay] plan ${id} could not be read:`, (err as Error).message);
  }
  planCache.set(id, { at: Date.now(), plan });
  return plan;
}

export function forgetPlans(): void {
  planCache.clear();
}

/** "₹199", "$9.99": a plan's price as a buyer reads it. */
export function formatPrice(plan: RzPlan): string {
  const major = plan.item.amount / 100;
  try {
    return new Intl.NumberFormat(plan.item.currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency: plan.item.currency,
      minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${plan.item.currency} ${major}`;
  }
}

/** "a month", "a year", "every 3 months". */
export function formatPeriod(plan: RzPlan): string {
  const unit: Record<string, string> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
  const u = unit[plan.period] ?? plan.period;
  return plan.interval > 1 ? `every ${plan.interval} ${u}s` : `a ${u}`;
}

// --- Subscriptions ------------------------------------------------------------

export interface RzSubscription {
  id: string;
  plan_id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  ended_at?: number | null;
  /** Razorpay sends an empty array when there are no notes. */
  notes?: Record<string, string> | unknown[];
}

/** The account a subscription was created for, from its notes. */
export function ownerOf(sub: RzSubscription): string | null {
  const notes = sub.notes && !Array.isArray(sub.notes) ? (sub.notes as Record<string, string>) : {};
  const id = String(notes.user_id ?? "").trim();
  return UUID.test(id) ? id : null;
}

/** How many charges a subscription is set up for. Razorpay needs a number;
 *  this is about ten years. */
function totalCount(plan: RzPlan | null): number {
  const per: Record<string, number> = { daily: 3650, weekly: 520, monthly: 120, yearly: 10 };
  const n = per[String(plan?.period)] ?? 120;
  return Math.max(1, Math.floor(n / Math.max(1, plan?.interval ?? 1)));
}

/**
 * A new subscription for this account, for the checkout to authorise.
 * Recorded the moment it exists, so the account it belongs to is known here
 * as well as in Razorpay's notes.
 */
export async function createSubscription(userId: string, plan: SellablePlan): Promise<RzSubscription> {
  const sub = await call<RzSubscription>("POST", "/subscriptions", {
    plan_id: plan.id,
    total_count: totalCount(await fetchPlan(plan.id)),
    quantity: 1,
    customer_notify: 1,
    notes: { user_id: userId },
  });
  const sb = supabase();
  if (sb) {
    const { error } = await sb.from(TABLE).insert({
      subscription_id: sub.id,
      user_id: userId,
      plan_id: plan.id,
      market: plan.market,
      status: String(sub.status ?? "created"),
      environment: testMode() ? "TEST" : "LIVE",
    });
    if (error) console.error(`[razorpay] could not record ${sub.id}:`, error.message);
  }
  return sub;
}

export async function fetchSubscription(id: string): Promise<RzSubscription> {
  return call<RzSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
}

// --- Signatures ---------------------------------------------------------------

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The checkout's success: HMAC_SHA256(payment_id|subscription_id, key secret). */
export function checkoutSignatureOk(paymentId: string, subscriptionId: string, signature: string): boolean {
  const secret = getConfig().RAZORPAY_KEY_SECRET;
  if (!secret || !paymentId || !subscriptionId || !signature) return false;
  return sameHex(hmacHex(secret, `${paymentId}|${subscriptionId}`), signature);
}

/** A webhook: HMAC_SHA256 of the raw body with the webhook secret. */
export function webhookSignatureOk(raw: string, signature: string): boolean {
  const secret = getConfig().RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !raw || !signature) return false;
  return sameHex(hmacHex(secret, raw), signature);
}

// --- What a subscription entitles ---------------------------------------------

/**
 * How long a subscription in this state entitles its owner, as of `now`.
 * `until` null means not entitled. `periodEnd` is the date the app shows.
 */
export function entitlementWindow(
  sub: Pick<RzSubscription, "status" | "current_end" | "charge_at" | "ended_at">,
  cancelAtPeriodEnd: boolean,
  now = Date.now(),
): { until: number | null; periodEnd: number | null } {
  const status = String(sub.status ?? "");
  const end = sub.current_end ? sub.current_end * 1000 : null;
  const periodEnd = end ?? (sub.charge_at ? sub.charge_at * 1000 : null);
  switch (status) {
    case "active":
    case "authenticated": {
      if (cancelAtPeriodEnd) return { until: periodEnd, periodEnd };
      // Authenticated before its first charge has no period yet: a day's
      // slack from now, and the next read asks Razorpay again.
      return { until: (periodEnd ?? now) + SLACK_MS, periodEnd };
    }
    case "pending":
      return { until: cancelAtPeriodEnd ? periodEnd : (periodEnd ?? now) + PENDING_GRACE_MS, periodEnd };
    case "cancelled":
      return { until: periodEnd ?? (sub.ended_at ? sub.ended_at * 1000 : null), periodEnd };
    default:
      // halted, completed, expired, paused: locked. created: nothing paid.
      return { until: null, periodEnd };
  }
}

export type Synced = { ok: boolean; reason: string; userId?: string; entitledUntil?: number | null };

/**
 * Save a subscription's current state, as Razorpay reported it just now.
 *
 * Only for a plan on sale here, and only for the account in its notes. When
 * the row exists already, the account must match it as well: a subscription
 * never changes hands.
 *
 * `cancel_at_period_end` only ever turns on. Razorpay keeps a subscription
 * "active" until the end of a cancelled period, and an "active" read after
 * the cancel must not make the app think it renews again.
 */
export async function syncSubscription(sub: RzSubscription, source: string): Promise<Synced> {
  const userId = ownerOf(sub);
  if (!userId) return { ok: false, reason: `subscription ${sub.id} carries no user_id` };
  const plan = sellable(sub.plan_id);
  if (!plan) return { ok: true, reason: `plan ${sub.plan_id} is not a Tailzu plan`, userId };
  const sb = supabase();
  if (!sb) return { ok: false, reason: "no service client", userId };

  const { data: before, error: readErr } = await sb.from(TABLE).select("*").eq("subscription_id", sub.id).maybeSingle();
  if (readErr) return { ok: false, reason: readErr.message, userId };
  if (before && String(before.user_id) !== userId) {
    return { ok: false, reason: `subscription ${sub.id} belongs to ${before.user_id}, notes say ${userId}`, userId };
  }
  const cancelAtPeriodEnd = before?.cancel_at_period_end === true;
  const { until, periodEnd } = entitlementWindow(sub, cancelAtPeriodEnd);
  const { error } = await sb.from(TABLE).upsert({
    subscription_id: sub.id,
    user_id: userId,
    plan_id: plan.id,
    market: plan.market,
    status: String(sub.status ?? "unknown"),
    period_end: periodEnd != null ? new Date(periodEnd).toISOString() : null,
    entitled_until: until != null ? new Date(until).toISOString() : null,
    cancel_at_period_end: cancelAtPeriodEnd,
    environment: testMode() ? "TEST" : "LIVE",
    updated_at: new Date().toISOString(),
  }, { onConflict: "subscription_id" });
  if (error) return { ok: false, reason: error.message, userId };
  forgetEntitlement(userId);
  if (until != null && until > Date.now()) {
    await warnIfDoubleBilled(userId);
    if (testMode()) console.warn(`[entitlements] TEST-MODE Razorpay access for ${userId} — switch to live keys before launch.`);
  }
  return { ok: true, reason: `${source}: ${sub.status}`, userId, entitledUntil: until };
}

/** Two stores charging one account: only the person can stop the other one,
 *  so it is named loudly where a support question will be answered from. */
async function warnIfDoubleBilled(userId: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  const { data } = await sb.from("entitlements").select("*").eq("user_id", userId).maybeSingle();
  const live = data?.active === true && (!data?.expires_at || Date.parse(String(data.expires_at)) > Date.now());
  if (live) {
    console.error(
      `[entitlements] DOUBLE BILLING: ${userId} pays on razorpay while ${data?.store ?? "another store"} is still live. ` +
      "Only the user can cancel the other one.",
    );
  }
}

/** Mark a subscription cancelled at its period's end, once Razorpay agreed. */
async function markCancelled(subscriptionId: string, periodEnd: number | null): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  await sb.from(TABLE).update({
    cancel_at_period_end: true,
    entitled_until: periodEnd != null ? new Date(periodEnd).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("subscription_id", subscriptionId);
}

/** This account's most recent Razorpay subscriptions, newest first. */
async function rowsFor(userId: string): Promise<Array<Record<string, unknown>>> {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb.from(TABLE).select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(5);
  if (error) {
    // Most likely: migration 0015 not run. Nobody is entitled by Razorpay
    // then, and RevenueCat's answer still stands.
    console.error(`[razorpay] subscriptions unreadable for ${userId}:`, error.message);
    return [];
  }
  return (data as Array<Record<string, unknown>> | null) ?? [];
}

const untilOf = (r: Record<string, unknown>) => (r.entitled_until ? Date.parse(String(r.entitled_until)) : NaN);

/** The row that entitles the account now (the one that runs longest), or null. */
function liveOf(rows: Array<Record<string, unknown>>, now = Date.now()): Record<string, unknown> | null {
  return rows.filter((r) => untilOf(r) > now).sort((a, b) => untilOf(b) - untilOf(a))[0] ?? null;
}

/**
 * Worth asking Razorpay about: a subscription that should still be renewing
 * but has run out here (its renewal's webhook went missing), or one created
 * in the last two hours whose checkout may have succeeded while both the
 * page's /verify and the webhook failed. An abandoned checkout older than
 * that is not asked about again.
 */
function worthAsking(r: Record<string, unknown>, now = Date.now()): boolean {
  const status = String(r.status ?? "");
  if (r.cancel_at_period_end === true) return false;
  if (["active", "authenticated", "pending"].includes(status)) return true;
  const born = r.created_at ? Date.parse(String(r.created_at)) : NaN;
  return status === "created" && now - born < 2 * 3600_000;
}

/**
 * The account's Razorpay entitlement, or null.
 *
 * Nothing live here is not yet an answer: the newest subscription worth
 * asking about is read back from Razorpay first, so a missed webhook cannot
 * end access someone has paid for.
 */
export async function razorpayEntitlement(userId: string): Promise<Entitlement | null> {
  if (!UUID.test(userId)) return null;
  let rows = await rowsFor(userId);
  let live = liveOf(rows);
  if (!live && razorpayReady()) {
    const ask = rows.find((r) => worthAsking(r));
    if (ask && SUB_ID.test(String(ask.subscription_id ?? ""))) {
      const res = await fetchSubscription(String(ask.subscription_id)).then((x) => syncSubscription(x, "read")).catch(() => null);
      if (res?.entitledUntil && res.entitledUntil > Date.now()) {
        rows = await rowsFor(userId);
        live = liveOf(rows);
      }
    }
  }
  if (!live) return null;
  return {
    entitlement: primaryEntitlement(),
    active: true,
    expiresAt: live.period_end ? String(live.period_end) : undefined,
    store: "razorpay",
    renews: live.cancel_at_period_end !== true && String(live.status) !== "cancelled",
  };
}

/**
 * Cancel this account's Razorpay subscription at the end of its period.
 * Access is kept to that end; the subscription is marked so nothing later
 * makes it look as if it renews.
 */
export async function cancelForUser(userId: string): Promise<{ ok: boolean; code?: string; until?: number | null }> {
  const live = liveOf(await rowsFor(userId));
  if (!live || !SUB_ID.test(String(live.subscription_id ?? ""))) return { ok: false, code: "no_subscription" };
  const known = live.period_end ? Date.parse(String(live.period_end)) : null;
  if (live.cancel_at_period_end === true || String(live.status) === "cancelled") return { ok: true, until: known };
  const id = String(live.subscription_id);
  const after = await call<RzSubscription>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 1 });
  const end = after.current_end ? after.current_end * 1000 : known;
  await markCancelled(id, end);
  forgetEntitlement(userId);
  return { ok: true, until: end };
}

// --- The pay page's caller ----------------------------------------------------

/**
 * The link the desktop opens to pay: tailzu.space/pay, signed for one account
 * with the key secret and good for about a week. It is what lets the page's
 * calls name their caller — a bare account id in a URL could be anyone's.
 * Rebuilt on every bootstrap, in whole days so it stays the same all day.
 */
export function payLink(base: string, userId: string, now = Date.now()): string | undefined {
  const secret = getConfig().RAZORPAY_KEY_SECRET;
  if (!secret || !UUID.test(userId)) return undefined;
  const day = 86_400;
  const exp = (Math.floor(now / 1000 / day) + 8) * day;
  const url = new URL(base.startsWith("http") ? base : `${SITE}/pay`);
  url.searchParams.set("u", userId);
  url.searchParams.set("e", String(exp));
  url.searchParams.set("t", payToken(userId, exp));
  return url.toString();
}

function payToken(userId: string, exp: number): string {
  return hmacHex(String(getConfig().RAZORPAY_KEY_SECRET), `pay:${userId}:${exp}`).slice(0, 32);
}

/** The account a pay link was signed for, when it is genuine and current. */
export function payLinkUser(u: unknown, e: unknown, t: unknown, now = Date.now()): string | null {
  const userId = String(u ?? "");
  const exp = Number(e);
  if (!getConfig().RAZORPAY_KEY_SECRET || !UUID.test(userId) || !Number.isFinite(exp)) return null;
  if (exp * 1000 < now) return null;
  return sameHex(payToken(userId, exp), String(t ?? "")) ? userId : null;
}
