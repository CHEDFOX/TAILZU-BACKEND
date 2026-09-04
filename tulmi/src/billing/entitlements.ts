/**
 * Who is paying — the server's own answer, not the app's.
 *
 * The client already asks RevenueCat directly and hides the paywall when it
 * finds an entitlement. That is fine for what the user SEES, and useless for
 * what the server ALLOWS: a client is not evidence. Until now the server had
 * no idea who had paid, which had two consequences, one of them expensive:
 *
 *   - A paying user was still metered against the free monthly cap and was
 *     cut off at 2,500 words. They had paid for unlimited and got the free
 *     tier, which is the worst failure this product can have.
 *   - Nothing stopped a modified client from claiming an entitlement it did
 *     not have.
 *
 * RevenueCat's webhook is the source of truth here. It posts every purchase,
 * renewal, cancellation, expiry, refund and billing issue; we keep the current
 * state per user and everything else reads it.
 */
import type { AuthedUser } from "../auth/supabase.js";
import { getConfig } from "../config.js";
import { supabase } from "../auth/supabase.js";

export type Entitlement = {
  entitlement: string;
  active: boolean;
  expiresAt?: string;
  store?: string;
};

/** Cache, so quota checks on the hot path do not each cost a round trip. */
const cache = new Map<string, { at: number; value: Entitlement | null }>();
const CACHE_MS = 60_000;

/**
 * The user's live entitlement, or null.
 *
 * Read through a short cache because this is consulted on every dictation and
 * every refine. Sixty seconds is the most a just-subscribed user waits for
 * their cap to lift, and the purchase path clears the entry anyway.
 */
export async function getEntitlement(user: AuthedUser): Promise<Entitlement | null> {
  const hit = cache.get(user.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const sb = supabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("entitlements")
    .select("entitlement, active, expires_at, store")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Do NOT cache a failure. A read error must not lock someone out of what
    // they paid for for a minute at a time; the caller decides what an unknown
    // entitlement means, and it retries immediately.
    console.error(`[entitlements] read failed for ${user.id}:`, error.message);
    return null;
  }
  if (!data || !data.active) {
    // No row, or an inactive one. Before believing that, ASK RevenueCat.
    //
    // A webhook can be missed — a delivery fails, the server is mid-restart,
    // an event is dropped — and the cost of believing a missing row is that a
    // paying customer is metered as free with nothing anywhere to notice it.
    // The webhook stays the fast path; this is the one that heals.
    const live = await askRevenueCat(user.id);
    cache.set(user.id, { at: Date.now(), value: live });
    return live;
  }
  // Expiry is belt and braces. `active` should already be false by the time a
  // subscription lapses, but a missed webhook must not grant free months.
  if (data.expires_at && Date.parse(String(data.expires_at)) < Date.now()) {
    cache.set(user.id, { at: Date.now(), value: null });
    return null;
  }
  const value: Entitlement = {
    entitlement: String(data.entitlement),
    active: true,
    expiresAt: data.expires_at ? String(data.expires_at) : undefined,
    store: data.store ? String(data.store) : undefined,
  };
  cache.set(user.id, { at: Date.now(), value });
  return value;
}

/** True when this user should not be metered or shown a paywall. */
export async function isEntitled(user: AuthedUser): Promise<boolean> {
  return (await getEntitlement(user)) !== null;
}

/**
 * Ask RevenueCat about a user, when a REST key is configured.
 *
 * Returns null for "not entitled" AND for "could not tell" — the caller treats
 * both as unentitled, which is the safe direction for a check that gates
 * spending. A thrown request must never grant access, and it must never cost
 * the user their dictation either, so it is bounded by a short timeout.
 */
async function askRevenueCat(userId: string): Promise<Entitlement | null> {
  const key = getConfig().REVENUECAT_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      subscriber?: { entitlements?: Record<string, { expires_date?: string | null; store?: string }> };
    };
    const ents = body.subscriber?.entitlements ?? {};
    for (const [id, e] of Object.entries(ents)) {
      // A null expiry is a lifetime grant, not an expired one.
      const live = !e.expires_date || Date.parse(e.expires_date) > Date.now();
      if (live) {
        return { entitlement: id, active: true, expiresAt: e.expires_date ?? undefined, store: e.store };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function forgetEntitlement(userId: string): void {
  cache.delete(userId);
}

/**
 * Event types that GRANT access, and those that end it.
 *
 * Listed explicitly rather than inferred: an unknown event type must not be
 * able to silently revoke a paying customer, and treating "anything not in the
 * grant list" as a revoke would do exactly that the first time RevenueCat adds
 * an event name.
 */
const GRANTS = new Set([
  "INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION",
  "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT",
]);
const REVOKES = new Set(["EXPIRATION", "REFUND", "SUBSCRIPTION_PAUSED", "TRANSFER"]);

/**
 * Which of the ids on an event is OUR user.
 *
 * RevenueCat identifies a device before it knows who is using it, so the same
 * person can carry an anonymous id ($RCAnonymousID:…) alongside the id the app
 * later logged them in with. An event can arrive naming either, and writing an
 * entitlement row keyed by an anonymous id stores a subscription for nobody —
 * silently, with a 200 and a cheerful log line.
 *
 * Our ids are Supabase UUIDs, so the right one is recognisable on sight.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickUserId(ev: RcEvent): string | null {
  const candidates = [
    ev.app_user_id,
    ev.original_app_user_id,
    ...(Array.isArray(ev.aliases) ? ev.aliases : []),
  ];
  for (const c of candidates) {
    const v = String(c ?? "").trim();
    if (UUID.test(v)) return v;
  }
  return null;
}

export type RcEvent = {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  store?: string | null;
};

/**
 * Apply one RevenueCat event.
 *
 * Returns what happened so the route can log it — a webhook that silently does
 * nothing is indistinguishable from one that worked, and this is the path a
 * missing subscription gets debugged through.
 */
export async function applyRevenueCatEvent(
  ev: RcEvent,
  defaultEntitlement: string,
): Promise<{ ok: boolean; reason: string; userId?: string }> {
  const type = String(ev.type ?? "").toUpperCase();
  const userId = pickUserId(ev);
  if (!userId) {
    // Named explicitly, because this is the failure that looks like success:
    // the webhook answers 200, the log says "granted", and the subscription
    // is attached to an id no account will ever match.
    return {
      ok: false,
      reason: `no Supabase user id on the event (saw: ${[ev.app_user_id, ev.original_app_user_id].filter(Boolean).join(", ") || "nothing"})`,
    };
  }

  // CANCELLATION is not a revoke: the user keeps what they paid for until the
  // period ends, and RevenueCat sends EXPIRATION when it actually lapses.
  // Treating it as a revoke takes access away from someone still paid up.
  if (type === "CANCELLATION") return { ok: true, reason: "cancellation noted, access runs to expiry", userId };

  const grants = GRANTS.has(type);
  const revokes = REVOKES.has(type);
  if (!grants && !revokes) return { ok: true, reason: `ignored event ${type}`, userId };

  const sb = supabase();
  if (!sb) return { ok: false, reason: "no service client", userId };

  const entitlement =
    (Array.isArray(ev.entitlement_ids) && ev.entitlement_ids[0]) ||
    ev.entitlement_id ||
    defaultEntitlement;

  const { error } = await sb.from("entitlements").upsert(
    {
      user_id: userId,
      entitlement: String(entitlement),
      active: grants,
      expires_at: ev.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : null,
      store: ev.store ? String(ev.store) : null,
      last_event: type,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, reason: error.message, userId };

  // The cache is what quota reads. Leaving it would keep a new subscriber
  // capped, or an expired one unlimited, for up to a minute.
  forgetEntitlement(userId);
  return { ok: true, reason: grants ? "granted" : "revoked", userId };
}
