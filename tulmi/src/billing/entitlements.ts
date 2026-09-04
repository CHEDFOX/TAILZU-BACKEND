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
  const want = idSet(getConfig().REVENUECAT_ENTITLEMENT);
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      subscriber?: {
        entitlements?: Record<
          string,
          { expires_date?: string | null; store?: string; product_identifier?: string }
        >;
        subscriptions?: Record<string, { is_sandbox?: boolean; store?: string }>;
      };
    };
    const ents = body.subscriber?.entitlements ?? {};
    const subs = body.subscriber?.subscriptions ?? {};
    const allowSandbox = getConfig().REVENUECAT_ALLOW_SANDBOX;
    // Only OUR entitlement counts. A RevenueCat project can carry several
    // products and several entitlements — a second app, a credit pack, a tier
    // that is not this one — and every one of them shows up on this subscriber.
    // Returning the first live entitlement found would hand Tailzu unlimited to
    // anyone who bought anything at all in the project.
    const live: string[] = [];
    for (const [id, e] of Object.entries(ents)) {
      // A null expiry is a lifetime grant, not an expired one.
      if (e.expires_date && Date.parse(e.expires_date) <= Date.now()) continue;
      live.push(id);
      if (!want.has(norm(id))) continue;
      // The webhook path refuses sandbox grants when the flag is off; this one
      // has to agree, or a purchase blocked at the door walks in through the
      // window on the next cache miss. Sandbox lives on the subscription, not
      // the entitlement, so it is looked up by the product that granted it.
      if (!allowSandbox && subs[String(e.product_identifier ?? "")]?.is_sandbox) continue;
      return { entitlement: id, active: true, expiresAt: e.expires_date ?? undefined, store: e.store };
    }
    if (live.length) {
      // The likeliest cause is a misconfigured REVENUECAT_ENTITLEMENT, and it
      // is invisible from the app: the customer is paying and still capped.
      // Name both sides so the fix is a one-line env change.
      console.warn(
        `[entitlements] ${userId} is live on ${live.join(", ")} but none match ${idList(getConfig().REVENUECAT_ENTITLEMENT).join(", ")} — check REVENUECAT_ENTITLEMENT`,
      );
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
 * Which entitlement ids mean "Tailzu paid".
 *
 * Comma-separated, so a project with several paid tiers can name them all
 * ("pro,unlimited") without a code change. Several PRODUCTS mapped to one
 * entitlement — monthly, annual, lifetime — need nothing here; they arrive as
 * the same entitlement id and always did.
 */
function idSet(spec: string): Set<string> {
  return new Set(idList(spec).map(norm));
}

/** The configured ids as written, for display and for the stored row. */
function idList(spec: string): string[] {
  return String(spec ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

/**
 * One shape for comparing two entitlement ids.
 *
 * Real ids are not always tidy tokens — "TAILZU AIR" is a live one — so this
 * has to survive a space, a case difference, and the quotes a .env or a
 * compose env_file can leave attached to a value with a space in it. Both
 * sides of every comparison go through here, so they can never disagree.
 */
function norm(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Every entitlement id an event names, in either of the two shapes RC uses. */
function eventEntitlements(ev: RcEvent): string[] {
  const many = Array.isArray(ev.entitlement_ids) ? ev.entitlement_ids : [];
  const one = ev.entitlement_id ? [ev.entitlement_id] : [];
  const seen = new Set<string>();
  for (const raw of [...many, ...one]) {
    const v = String(raw ?? "").trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

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
  /** "SANDBOX" | "PRODUCTION". A sandbox purchase cost nobody anything. */
  environment?: string | null;
  /** Which RevenueCat app the event came from. Recorded, never enforced. */
  app_id?: string | null;
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

  // IS THIS EVENT EVEN ABOUT US?
  //
  // One RevenueCat project can hold several apps, several products and several
  // entitlements, and the webhook is configured per PROJECT — so every purchase
  // anywhere in it arrives at this URL. Taking any of them as proof of a Tailzu
  // subscription would give unlimited dictation to someone who bought something
  // else entirely.
  const want = idSet(defaultEntitlement);
  const named = eventEntitlements(ev);
  const ours = named.filter((n) => want.has(norm(n)));
  if (named.length > 0 && ours.length === 0) {
    return {
      ok: true,
      reason: `event is for ${named.join(", ")}, not ${idList(defaultEntitlement).join(", ")}`,
      userId,
    };
  }
  if (named.length === 0 && grants) {
    // A grant that names no entitlement cannot be shown to be ours, and the
    // asymmetry is deliberate: a wrong grant is trusted until it expires, while
    // a wrong revoke is repaired on the next read by askRevenueCat. Guess in
    // the direction that heals.
    return { ok: true, reason: `grant ${type} names no entitlement; ignored`, userId };
  }

  // SANDBOX PURCHASES ARE FREE PURCHASES.
  //
  // TestFlight, Xcode and Play's internal track all transact against the
  // stores' sandboxes, where nobody is charged. That is what makes the paid
  // path testable before launch, and what makes it a giveaway after: anyone
  // on a test build could subscribe for nothing. One flag, checked on grants
  // only — a sandbox flag must never be able to KEEP access alive, so revokes
  // are applied whatever the environment says.
  const sandbox = String(ev.environment ?? "").toUpperCase() === "SANDBOX";
  if (sandbox && grants && !getConfig().REVENUECAT_ALLOW_SANDBOX) {
    return { ok: true, reason: "sandbox purchase ignored (REVENUECAT_ALLOW_SANDBOX=false)", userId };
  }
  if (sandbox && grants) {
    // The reminder has to live where it will be seen. A flag that must be
    // remembered at launch is a flag nobody remembers at launch.
    console.warn(
      `[entitlements] SANDBOX grant for ${userId} — free access from a test build. Set REVENUECAT_ALLOW_SANDBOX=false once you are live.`,
    );
  }

  const sb = supabase();
  if (!sb) return { ok: false, reason: "no service client", userId };

  const entitlement = ours[0] ?? idList(defaultEntitlement)[0] ?? "pro";

  const { error } = await sb.from("entitlements").upsert(
    {
      user_id: userId,
      entitlement: String(entitlement),
      active: grants,
      expires_at: ev.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : null,
      store: ev.store ? String(ev.store) : null,
      environment: ev.environment ? String(ev.environment).toUpperCase() : null,
      app_id: ev.app_id ? String(ev.app_id) : null,
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
