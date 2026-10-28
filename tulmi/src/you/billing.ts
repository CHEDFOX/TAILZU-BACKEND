/**
 * PLAN AND BILLING, FROM WHAT THE SERVER ALREADY KNOWS: the entitlement (billing/entitlements.ts: RevenueCat's webhook for the phones, Razorpay's
 * subscriptions for the web and the desktop), the Razorpay subscription itself (its plan's price from Razorpay, renewal, cancellation), and its
 * invoices, read from Razorpay (each with Razorpay's own page for it). A plan bought in an app store has its receipts in that store: the screen
 * says so and opens it. Nothing here charges anyone: changing the plan opens Plans, cancelling is the existing cancel route.
 */
import type { AuthedUser } from "../auth/supabase.js";
import { supabase } from "../auth/supabase.js";
import { getEntitlement } from "../billing/entitlements.js";
import { fetchPlan, formatPeriod, formatPrice, razorpayReady, SUB_ID } from "../billing/razorpay.js";
import { getConfig } from "../config.js";

export interface Invoice { id: string; number: string; date: number; amountPaise: number; amount: string; status: string; url: string | null; what: string }

export interface BillingView {
  plan: {
    name: string;
    active: boolean;
    /** razorpay | app_store | play_store | promotional | … */
    store: string | null;
    renews: boolean;
    /** When the paid period ends (and renews, unless cancelled). */
    until: number | null;
    since: number | null;
    price: string | null;
    period: string | null;
    /** How it is paid, in words ("UPI autopay", "Card", "App Store"). */
    paidBy: string | null;
    /** Where a cancel goes: the in-app route (Razorpay), the store's own page, or nowhere (free). */
    cancel: "razorpay" | "store" | null;
    manageUrl: string | null;
  };
  invoices: Invoice[];
}

const STORE_WORDS: Record<string, string> = { app_store: "App Store", mac_app_store: "App Store", play_store: "Google Play", stripe: "Card", promotional: "A gift from Tailzu" };
const STORE_PAGES: Record<string, string> = {
  app_store: "https://apps.apple.com/account/subscriptions", mac_app_store: "https://apps.apple.com/account/subscriptions",
  play_store: "https://play.google.com/store/account/subscriptions",
};
const METHOD_WORDS: Record<string, string> = { upi: "UPI autopay", card: "Card", emandate: "Bank mandate", nach: "Bank mandate" };

const invoiceCache = new Map<string, { at: number; list: Invoice[] }>();
const INVOICES_MS = 10 * 60_000;

const rupees = (paise: number, currency = "INR"): string => {
  const major = paise / 100;
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency", currency, minimumFractionDigits: Number.isInteger(major) ? 0 : 2, maximumFractionDigits: 2,
    }).format(major);
  } catch { return `${currency} ${major}`; }
};

/** Razorpay's own GET, with the same keys the rest of billing uses. */
async function rz<T>(path: string): Promise<T> {
  const c = getConfig();
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${c.RAZORPAY_KEY_ID}:${c.RAZORPAY_KEY_SECRET}`).toString("base64")}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`razorpay ${res.status}`);
  return (await res.json()) as T;
}

interface RzInvoice { id: string; invoice_number?: string | null; amount?: number; amount_paid?: number; currency?: string; status?: string; date?: number; issued_at?: number; paid_at?: number; short_url?: string | null; line_items?: Array<{ name?: string }> }

/** A subscription's invoices, newest first. Empty when Razorpay is not set up or does not answer. */
async function invoicesOf(subscriptionId: string): Promise<Invoice[]> {
  const hit = invoiceCache.get(subscriptionId);
  if (hit && Date.now() - hit.at < INVOICES_MS) return hit.list;
  if (!razorpayReady() || !SUB_ID.test(subscriptionId)) return [];
  const r = await rz<{ items?: RzInvoice[] }>(`/invoices?subscription_id=${encodeURIComponent(subscriptionId)}&count=24`).catch(() => null);
  const list = (r?.items ?? []).filter((i) => i.status === "paid" || i.status === "issued" || i.status === "partially_paid").map((i): Invoice => {
    const paise = Number(i.amount_paid || i.amount || 0);
    return {
      id: i.id, number: i.invoice_number || i.id, date: (i.paid_at || i.date || i.issued_at || 0) * 1000, amountPaise: paise,
      amount: rupees(paise, i.currency || "INR"), status: i.status ?? "", url: i.short_url || null, what: i.line_items?.[0]?.name || "Tailzu Pro",
    };
  }).sort((a, b) => b.date - a.date);
  if (r) invoiceCache.set(subscriptionId, { at: Date.now(), list });
  return list;
}

/** The person's plan and invoices, from the records. */
export async function billingView(user: AuthedUser): Promise<BillingView> {
  const ent = await getEntitlement(user).catch(() => null);
  const sb = supabase();
  const row = sb
    ? ((await sb.from("razorpay_subscriptions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then((r) => r.data as Record<string, unknown> | null, () => null)) ?? null)
    : null;
  const active = !!ent?.active;
  const store = ent?.store ?? (row ? "razorpay" : null);
  const viaRazorpay = store === "razorpay" && !!row;
  let price: string | null = null, period: string | null = null, paidBy: string | null = null;
  if (viaRazorpay && row?.plan_id) {
    const plan = await fetchPlan(String(row.plan_id)).catch(() => null);
    if (plan) { price = formatPrice(plan); period = formatPeriod(plan); }
    const sub = razorpayReady() && SUB_ID.test(String(row.subscription_id ?? ""))
      ? await rz<{ payment_method?: string }>(`/subscriptions/${encodeURIComponent(String(row.subscription_id))}`).catch(() => null) : null;
    paidBy = METHOD_WORDS[String(sub?.payment_method ?? "")] ?? "Razorpay";
  } else if (store) {
    paidBy = STORE_WORDS[store] ?? null;
  }
  const until = ent?.expiresAt ? Date.parse(ent.expiresAt) || null : row?.period_end ? Date.parse(String(row.period_end)) || null : null;
  return {
    plan: {
      name: active ? "Pro" : "Free", active, store, renews: active && ent?.renews !== false, until, since: row?.created_at ? Date.parse(String(row.created_at)) || null : null,
      price, period, paidBy,
      cancel: !active ? null : viaRazorpay ? "razorpay" : STORE_PAGES[store ?? ""] ? "store" : null,
      manageUrl: STORE_PAGES[store ?? ""] ?? null,
    },
    invoices: viaRazorpay ? await invoicesOf(String(row!.subscription_id ?? "")) : [],
  };
}
