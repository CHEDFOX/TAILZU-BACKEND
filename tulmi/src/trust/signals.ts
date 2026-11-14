/**
 * WHAT ONE REQUEST SAYS ABOUT ITSELF, AND THE LITTLE BIT WE REMEMBER (docs/trust.md §request shape).
 *
 * Three things:
 *   the SHAPE of the request   a script-shaped user agent on an app route, or claims that do not fit each other
 *   the WRITE-ONCE gate        an in-memory table so one (account, network, day) is written once however many requests come
 *   the SESSION's movement     one sign-in seen from a data centre and a home or mobile network inside an hour
 *
 * WHAT IS NEVER READ (docs/trust.md rule 7). From the request: only the address it arrived from (and only as a keyed hash),
 * the user agent, the coarse TLS hints Caddy forwards, the X-App-* headers and, from the bootstrap body, `platform`, `bundle`,
 * `appVersion` and whether `capabilities` is present. Not the permission states, not the keyboard state, not the scheme
 * probes, not the locale, the time zone or the screen's size — and nothing about the PHONE's own network at all. A scan test
 * fails if a file in this folder reads anything else.
 *
 * Nothing here is kept beyond memory except the (account, network, day) row itself, and the TLS hints and user agent are used
 * for the request's own score and never stored.
 */
import { netKey, type NetClass } from "./netKey.js";
import { netClassOf } from "./netClass.js";
import { trustStore, type TrustStore } from "./store.js";
import { TRUST_KEEP_DAYS } from "./defaults.js";

/** Only these request fields may ever be read here (docs/trust.md rule 7; tests/trust-scan.test.ts holds the list). */
export const READABLE_FIELDS = ["ip", "userAgent", "platform", "bundle", "appVersion", "capabilities", "x-app-", "x-tz-tls-"] as const;

/** A user agent that is a script, not a phone. OkHttp claiming iOS is in here too: Android's client, on the wrong platform. */
const SCRIPT_UA = /(python-requests|curl\/|go-http-client|axios\/|node-fetch|libwww|wget|scrapy|httpie|postman)/i;

export interface ShapeInput {
  userAgent?: string | undefined;
  /** What the app says it is, from the bootstrap body or the X-App-Platform header. */
  platform?: string | undefined;
  bundle?: string | undefined;
  appVersion?: string | undefined;
  /** Whether the bootstrap carried a `capabilities` object at all (every real build sends one). */
  hasCapabilities?: boolean | undefined;
  /** True for the routes only our own apps call (the bootstrap, the app's screens, a signed-in app route). */
  appRoute?: boolean | undefined;
  /** The coarse TLS hints the proxy forwarded (tlsHints below). Read for this request's score only, never stored. */
  tls?: TlsHints | undefined;
}

/** The TLS version a connection used, as a number, out of whatever spelling the proxy forwarded ("tls1.3", "TLSv1.2"). */
export function tlsVersionOf(hint: string | undefined): number | null {
  const m = /1\.([0-3])\b/.exec(String(hint ?? ""));
  return m ? 1 + Number(m[1]) / 10 : null;
}

/**
 * The shape's reason codes. Forgeable, every one of them — which is the point: they are only ever read as a MISMATCH between
 * two things the same caller said, never as proof of anything on their own.
 */
export function shapeOf(i: ShapeInput): Array<"script" | "mismatch"> {
  const out: Array<"script" | "mismatch"> = [];
  const ua = (i.userAgent ?? "").trim();
  const platform = (i.platform ?? "").trim().toLowerCase();
  if (i.appRoute !== false && ua && SCRIPT_UA.test(ua)) out.push("script");
  // React Native on iOS sends CFNetwork's own default and no agent of its own; Android sends okhttp. A build that says it is
  // one and sends the other's agent is not that build. (The exact strings are U until N0, so only a crossed pair counts.)
  const looksApple = /cfnetwork|darwin/i.test(ua);
  const looksAndroid = /okhttp|dalvik|android/i.test(ua);
  if (platform === "ios" && looksAndroid && !looksApple) out.push("mismatch");
  if (platform === "android" && looksApple && !looksAndroid) out.push("mismatch");
  // A bootstrap with no capabilities at all, or a platform that is neither of ours: not a build of ours.
  if (i.hasCapabilities === false) out.push("mismatch");
  if (platform && platform !== "ios" && platform !== "android" && platform !== "web") out.push("mismatch");
  // The one thing the proxy's coarse TLS hints can honestly say: a caller claiming to be one of our phone apps over TLS
  // 1.0 or 1.1 is not one. Apple's App Transport Security and Android's own client both refuse anything below TLS 1.2,
  // so our app cannot make such a connection. No hint (no proxy, or a plain HTTP hop) says nothing and scores nothing.
  const tls = tlsVersionOf(i.tls?.version);
  if (tls !== null && tls < 1.2 && (platform === "ios" || platform === "android")) out.push("mismatch");
  return out;
}

/**
 * A request that came through Vercel's proxy on x0bot.com (docs/trust.md rule 5): `x-vercel-forwarded-for` is forgeable on a
 * direct call to the API, so a request carrying it is not collected at all rather than scored on a header anyone can set.
 */
export function skipCollection(headers: Record<string, unknown>): boolean {
  return headers["x-vercel-forwarded-for"] !== undefined;
}

/** The coarse TLS hints Caddy forwards (deploy only). Used for this request's score, never stored. */
export interface TlsHints { version?: string; cipher?: string; proto?: string }

/** Those hints off one request's headers. Nothing else is ever read from them (docs/trust.md rule 7). */
export function tlsHints(headers: Record<string, unknown>): TlsHints {
  const one = (v: unknown) => (typeof v === "string" && v.length <= 40 ? v : undefined);
  return {
    version: one(headers["x-tz-tls-version"]),
    cipher: one(headers["x-tz-tls-cipher"]),
    proto: one(headers["x-tz-tls-proto"]),
  };
}

// ------------------------------------------------------------------ write once a day

/** The most (account, network, day) pairs remembered. Past it the table is cleared: a repeat write costs one upsert. */
const SEEN_MAX = 50_000;
const seen = new Map<string, number>();

/** Whether this (account, network, day) still needs writing — or, with `everyMs`, whether anything else is due again yet. */
export function needsWriting(id: string, now: number, everyMs = 86_400_000): boolean {
  const had = seen.get(id);
  if (had && now - had < everyMs) return false;
  if (seen.size >= SEEN_MAX) seen.clear();
  seen.set(id, now);
  return true;
}

/** Tests. */
export function forgetSeenForTests(): void { seen.clear(); }

// ------------------------------------------------------------------ a session that moved

/** How long a session's networks are remembered, and how many sessions at once. */
const SESSION_MS = 3600_000;
const SESSION_MAX = 20_000;
const sessions = new Map<string, { at: number; asns: Set<number>; kinds: Set<NetClass> }>();

/**
 * One sign-in, seen from several networks within the hour. A stolen token shows up as one session used from a data centre and
 * from a home or mobile line at the same time, or from four or more operators in an hour. Memory only.
 */
export function sessionMoved(sessionId: string, seenNet: { asn: number | null; netClass: NetClass }, now: number): boolean {
  if (!sessionId) return false;
  let row = sessions.get(sessionId);
  if (!row || now - row.at > SESSION_MS) {
    if (sessions.size >= SESSION_MAX) sessions.clear();
    row = { at: now, asns: new Set(), kinds: new Set() };
    sessions.set(sessionId, row);
  }
  if (seenNet.asn !== null) row.asns.add(seenNet.asn);
  row.kinds.add(seenNet.netClass);
  const mixed = row.kinds.has("hosting") && (row.kinds.has("home") || row.kinds.has("mobile"));
  return mixed || row.asns.size >= 4;
}

/** Tests. */
export function forgetSessionsForTests(): void { sessions.clear(); }

// ------------------------------------------------------------------ the collection

/** A day key as the rows hold it. UTC, like the health days', so the sweeper and the counts measure the same thing. */
export const dayKeyOf = (now: number): string => new Date(now).toISOString().slice(0, 10);
export const dayKeyBefore = (now: number, days: number): string => new Date(now - days * 86_400_000).toISOString().slice(0, 10);

/** How old an account may be and still count as "made here" (docs/trust.md §score). */
export const NEW_ACCOUNT_DAYS = 7;

export interface Collected {
  netClass: NetClass;
  asn: number | null;
  /** NEW accounts on this network key, in the last day and the last week. Zeros on a mobile network's IPv4. */
  accountsOnNet: { day: number; week: number };
  /** Whether a row was written for this (account, network, day). */
  wrote: boolean;
}

/**
 * One request's collection: the row (once a day) and the counts. Fire and forget — the caller never waits for it and never
 * fails a request because of it. Returns null when there is no key (so nothing is collected) or the address is not one.
 */
export async function collect(o: {
  ip: unknown;
  userId: string;
  /** Whether this account was new when it was seen here (under a week old). Only new ones are counted. */
  newAcct?: boolean;
  now?: number;
  store?: TrustStore;
}): Promise<Collected | null> {
  const now = o.now ?? Date.now();
  const key = netKey(o.ip);
  if (!key || !o.userId) return null;
  const store = o.store ?? trustStore();
  const seenNet = netClassOf(o.ip);
  const day = dayKeyOf(now);
  let wrote = false;
  if (needsWriting(`${key.toString("hex")}|${o.userId}|${day}`, now)) {
    await store.seeNet({
      netKey: key, userId: o.userId, day, asn: seenNet.asn, netClass: seenNet.netClass,
      newAcct: o.newAcct === true, at: now,
    });
    wrote = true;
  }
  // Carrier NAT puts thousands of real people behind one IPv4 address, so accounts are never counted per key there.
  const accountsOnNet = seenNet.countable
    ? {
        day: await store.countAccountsOnNet(key, day),
        week: await store.countAccountsOnNet(key, dayKeyBefore(now, 7)),
      }
    : { day: 0, week: 0 };
  return { netClass: seenNet.netClass, asn: seenNet.asn, accountsOnNet, wrote };
}

/** What the sweeper drops: anything older than the 30 days the policy promises. */
export const keepDays = (): number => TRUST_KEEP_DAYS;
