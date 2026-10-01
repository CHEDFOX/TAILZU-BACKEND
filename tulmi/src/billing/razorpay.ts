/**
 * Razorpay — the web's way to pay for Tailzu, and the desktop's only one.
 *
 * RevenueCat carries the phones (App Store, Google Play) and writes the
 * entitlement row from its webhook. It has no Razorpay integration, so for a
 * Razorpay subscription this file is that integration, writing the SAME row:
 * whatever a phone purchase unlocks, a Razorpay one unlocks, on every device.
 *
 * The account a payment belongs to travels in the subscription's own notes
 * (`app_user_id`), set by this server when the subscription is created. A
 * payment can only ever land on the account the pay page was opened for.
 *
 * Three ways a subscription's state arrives, all through one function
 * (applyRazorpaySubscription), so they can never disagree:
 *
 *   the checkout   the browser posts the payment's signature the moment it
 *                  succeeds; checked against the key secret, then the
 *                  subscription is read from Razorpay itself
 *   the webhook    every renewal, failure, pause and cancellation, signed
 *                  with the webhook secret over the raw body
 *   a read         a row that has lapsed is checked against Razorpay before
 *                  it is believed, so a missed webhook cannot end access
 *                  someone has paid for (entitlements.getEntitlement)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { supabase } from "../auth/supabase.js";
import { forgetEntitlement, primaryEntitlement } from "./entitlements.js";

const API = "https://api.razorpay.com/v1";
const SITE = "https://tailzu.space";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KEY_ID = /^rzp_(?:live|test)_[A-Za-z0-9]+$/;
export const PLAN_ID = /^plan_[A-Za-z0-9]+$/;
export const SUB_ID = /^sub_[A-Za-z0-9]+$/;

/** Paid access runs this long past the end of a period, so a renewal that
 *  Razorpay is still retrying does not cut someone off mid-retry. Applied
 *  when the row is READ (entitlements.ts); the row keeps the real end date,
 *  which is the date the app shows as the renewal. */
export const GRACE_MS = 2 * 24 * 3600_000;

export type PlanKey = "monthly" | "annual";

export interface RzPlan {
  id: string;
  period: "daily" | "weekly" | "monthly" | "yearly" | string;
  interval: number;
  item: { name?: string; amount: number; currency: string };
}

export interface RzSubscription {
  id: string;
  plan_id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  /** Razorpay sends an empty array when there are no notes. */
  notes?: Record<string, string> | unknown[];
}

/** Both keys present and well formed. Without them nothing is sold. */
export function razorpayReady(): boolean {
  const c = getConfig();
  return KEY_ID.test(c.RAZORPAY_KEY_ID) && !!c.RAZORPAY_KEY_SECRET;
}

/** Test mode: Razorpay's test keys take test cards and charge nobody. */
export function testMode(): boolean {
  return getConfig().RAZORPAY_KEY_ID.startsWith("rzp_test_");
}

/** The plan ids configured for each paywall plan, malformed ones left out. */
export function ourPlans(): Record<PlanKey, string | null> {
  const c = getConfig();
  const ok = (s: string) => (PLAN_ID.test(s.trim()) ? s.trim() : null);
  return { monthly: ok(c.RAZORPAY_PLAN_MONTHLY), annual: ok(c.RAZORPAY_PLAN_YEARLY) };
}

function isOurPlan(id: string | undefined): boolean {
  const p = ourPlans();
  return !!id && (id === p.monthly || id === p.annual);
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

const planCache = new Map<string, { at: number; plan: RzPlan | null }>();

/**
 * A plan as Razorpay holds it: its price, currency and period. Read from
 * Razorpay rather than written down here, so the pay page can never quote a
 * price the checkout then contradicts. Cached; a failure is cached briefly so
 * a Razorpay outage does not make every page view wait on it.
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

/** How many charges a subscription is set up for. Razorpay needs a number;
 *  this is about ten years, after which it would need renewing. */
function totalCount(plan: RzPlan | null): number {
  const per: Record<string, number> = { daily: 3650, weekly: 520, monthly: 120, yearly: 10 };
  const n = per[String(plan?.period)] ?? 120;
  return Math.max(1, Math.floor(n / Math.max(1, plan?.interval ?? 1)));
}

/** A new subscription for this account, for the checkout to authorise. */
export async function createSubscription(userId: string, planId: string): Promise<RzSubscription> {
  const plan = await fetchPlan(planId);
  return call<RzSubscription>("POST", "/subscriptions", {
    plan_id: planId,
    total_count: totalCount(plan),
    quantity: 1,
    customer_notify: 1,
    notes: { app_user_id: userId },
  });
}

export async function fetchSubscription(id: string): Promise<RzSubscription> {
  return call<RzSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
}

/** Stop renewing. Access runs to the end of the period already paid for. */
export async function cancelSubscription(id: string): Promise<RzSubscription> {
  return call<RzSubscription>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 1 });
}

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The checkout's success: Razorpay signs `payment_id|subscription_id` with
 *  the key secret, so only a real payment on this subscription carries it. */
export function checkoutSignatureOk(paymentId: string, subscriptionId: string, signature: string): boolean {
  const secret = getConfig().RAZORPAY_KEY_SECRET;
  if (!secret || !paymentId || !subscriptionId || !signature) return false;
  return sameHex(hmacHex(secret, `${paymentId}|${subscriptionId}`), signature);
}

/** A webhook: signed with the webhook secret over the body exactly as sent. */
export function webhookSignatureOk(raw: string, signature: string): boolean {
  const secret = getConfig().RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !raw || !signature) return false;
  return sameHex(hmacHex(secret, raw), signature);
}

function userOf(sub: RzSubscription): string | null {
  const notes = sub.notes && !Array.isArray(sub.notes) ? sub.notes : {};
  const id = String((notes as Record<string, string>).app_user_id ?? "").trim();
  return UUID.test(id) ? id : null;
}

/** Statuses that mean paid up (or being retried), and those that end it.
 *  "created" and "authenticated" are neither: nothing has been charged yet. */
const LIVE = new Set(["active", "pending"]);
const ENDED = new Set(["halted", "cancelled", "completed", "expired", "paused"]);

export type Applied = { ok: boolean; reason: string; userId?: string; active?: boolean; expiresAt?: string | null };

/**
 * Make the entitlement row say what this subscription says.
 *
 * Only the account in the subscription's notes, and only for our plans: one
 * Razorpay account can sell other things, and none of them is Tailzu.
 */
export async function applyRazorpaySubscription(sub: RzSubscription, event: string): Promise<Applied> {
  const userId = userOf(sub);
  if (!userId) return { ok: false, reason: `subscription ${sub.id} carries no account id` };
  if (!isOurPlan(sub.plan_id)) return { ok: true, reason: `plan ${sub.plan_id} is not a Tailzu plan`, userId };
  const status = String(sub.status ?? "");
  const live = LIVE.has(status);
  const ended = ENDED.has(status);
  if (!live && !ended) return { ok: true, reason: `status ${status || "unknown"}: nothing charged yet`, userId };

  const sb = supabase();
  if (!sb) return { ok: false, reason: "no service client", userId };
  const { data: before, error: readErr } = await sb.from("entitlements").select("*").eq("user_id", userId).maybeSingle();
  if (readErr) return { ok: false, reason: readErr.message, userId };
  const beforeExpiry = before?.expires_at ? Date.parse(String(before.expires_at)) : NaN;
  const beforeStore = String(before?.store ?? "").toLowerCase();
  const beforeLive = before?.active === true
    && (!before?.expires_at || beforeExpiry + (beforeStore === "razorpay" ? GRACE_MS : 0) > Date.now());
  const beforeSub = String(before?.subscription_id ?? "");

  const periodEnd = sub.current_end ? sub.current_end * 1000 : NaN;
  let active: boolean;
  let expires: number | null;
  if (live) {
    active = true;
    expires = Number.isFinite(periodEnd) ? periodEnd : null;
    // Webhooks are not promised in order. A charge for last month arriving
    // after this month's must not pull the end date back.
    if (beforeSub === sub.id && beforeLive && expires != null && beforeExpiry > expires) expires = beforeExpiry;
  } else {
    // An END about some other subscription is not news about this account's
    // access: an old one's cancellation landing after a new one started, or
    // Razorpay ending while the App Store is the one paying.
    if (beforeLive && (beforeStore !== "razorpay" || (beforeSub && beforeSub !== sub.id))) {
      return { ok: true, reason: `${status} for ${sub.id} ignored: access comes from ${beforeStore === "razorpay" ? beforeSub : beforeStore}`, userId };
    }
    // Cancelled or completed keeps what was paid for; halted and paused end now.
    const paidUp = (status === "cancelled" || status === "completed") && periodEnd > Date.now();
    active = paidUp;
    expires = paidUp ? periodEnd : Number.isFinite(periodEnd) ? Math.min(periodEnd, Date.now()) : Date.now();
  }

  if (active && beforeLive && beforeStore && beforeStore !== "razorpay") {
    console.error(
      `[entitlements] DOUBLE BILLING: ${userId} just paid on razorpay while ${beforeStore} is still live. ` +
      `Two stores are charging one account for one entitlement, and only the user can cancel ${beforeStore}.`,
    );
  }

  const row = {
    user_id: userId,
    entitlement: primaryEntitlement(),
    active,
    expires_at: expires != null ? new Date(expires).toISOString() : null,
    store: "razorpay",
    environment: testMode() ? "SANDBOX" : "PRODUCTION",
    app_id: null,
    subscription_id: sub.id,
    last_event: event.slice(0, 60),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("entitlements").upsert(row, { onConflict: "user_id" });
  if (error) return { ok: false, reason: error.message, userId };
  forgetEntitlement(userId);
  if (active && testMode()) {
    console.warn(`[entitlements] TEST-MODE Razorpay grant for ${userId} — set live keys before launch.`);
  }
  return { ok: true, reason: `${event}: ${status}`, userId, active, expiresAt: row.expires_at };
}

/**
 * A link that lets this account manage its Razorpay subscription in a
 * browser, where it is not signed in. Signed with the key secret and good for
 * a week; rebuilt on every bootstrap, so the one in the app is always fresh.
 * All it can do is show the plan and stop it renewing.
 */
export function manageLink(userId: string, now = Date.now()): string | undefined {
  const secret = getConfig().RAZORPAY_KEY_SECRET;
  if (!secret || !UUID.test(userId)) return undefined;
  // Whole days, so the link (and every screen carrying it) is the same all day.
  const day = 86_400;
  const exp = (Math.floor(now / 1000 / day) + 8) * day;
  return `${SITE}/pay/manage?u=${userId}&e=${exp}&t=${manageToken(userId, exp)}`;
}

function manageToken(userId: string, exp: number): string {
  return hmacHex(String(getConfig().RAZORPAY_KEY_SECRET), `manage:${userId}:${exp}`).slice(0, 32);
}

/** The account a manage link was made for, when the link is genuine and
 *  current; otherwise null. */
export function manageLinkUser(u: unknown, e: unknown, t: unknown): string | null {
  const userId = String(u ?? "");
  const exp = Number(e);
  if (!getConfig().RAZORPAY_KEY_SECRET || !UUID.test(userId) || !Number.isFinite(exp)) return null;
  if (exp * 1000 < Date.now()) return null;
  return sameHex(manageToken(userId, exp), String(t ?? "")) ? userId : null;
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
