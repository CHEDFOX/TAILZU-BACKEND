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
    cache.set(user.id, { at: Date.now(), value: null });
    return null;
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

export type RcEvent = {
  type?: string;
  app_user_id?: string;
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
  const userId = String(ev.app_user_id ?? "").trim();
  if (!userId) return { ok: false, reason: "no app_user_id" };

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
