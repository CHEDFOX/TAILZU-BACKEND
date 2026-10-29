/**
 * WHAT TAILZU TELLS META, AND HOW.
 *
 * Meta's ads find people like the ones an ad already worked on, so they have
 * to be told when it worked. One dataset (META_PIXEL_ID) hears it three ways:
 *
 *   the site's pixel       PageView, ViewContent and Lead, from the browser
 *                          (/site-events.js, served by Vercel on x0bot.com
 *                          with the id from Vercel's settings; siteEventsScript
 *                          below is this server's copy)
 *   this server            what only the server sees: a desktop
 *                          account made, its first dictation, a subscription
 *                          paid for (Conversions API, sendMetaEvent)
 *   the phone apps         install and open on their own, and the account's
 *                          milestones when the bootstrap hands them over
 *                          (Meta's SDK logs them; see appEventsFor)
 *
 * EACH MILESTONE IS REPORTED ONCE, by whichever of them sees it first. The
 * account remembers which ones went (Personality.adsReported), and only a new
 * account's count: an account made before this shipped, or long ago, has no
 * ad to credit, and reporting its old dictation as a new one would teach the
 * ads the wrong people.
 *
 * WHAT LEAVES. Email and phone go only as SHA-256 hashes, which is how Meta
 * matches an event to the person an ad was shown to; the account id goes
 * hashed too. The visitor's address and browser go as they are, because a
 * website event without them is not matched at all. Never what anyone said
 * or wrote: no event carries a word of it.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";
import type { Personality } from "../../../shared/types/api.js";
import { supabase, type AuthedUser } from "../auth/supabase.js";
import { getConfig } from "../config.js";
import { isSitePage, SITE_ORIGIN } from "../domains.js";
import { updatePersonality } from "../personality/store.js";

// --- The event, as Meta wants it ------------------------------------------------

/** Where it happened, in Meta's words. A desktop account and a paid
 *  subscription are both reached through the site, so they are the site's. */
export type ActionSource = "website" | "system_generated";

export interface MetaUser {
  email?: string;
  phone?: string;
  /** The account id. Lets Meta tie two of one account's events together. */
  userId?: string;
  ip?: string;
  userAgent?: string;
  /** The pixel's own cookies, when the event started in a browser. */
  fbp?: string;
  fbc?: string;
}

export interface MetaEvent {
  name: string;
  /** The same id the pixel used for the same event, so Meta counts it once. */
  id: string;
  /** Unix seconds. Now, when not given. */
  time?: number;
  source: ActionSource;
  url?: string;
  user: MetaUser;
  data?: Record<string, string | number>;
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Meta's normal form for an email: trimmed and lowercase. */
export function normalEmail(v?: string): string | undefined {
  const e = v?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+$/.test(e) ? e : undefined;
}

/** Meta's normal form for a phone: digits only, country code first, no
 *  leading zeros. Supabase keeps them as "919876543210" already. */
export function normalPhone(v?: string): string | undefined {
  const d = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return d.length >= 8 && d.length <= 15 ? d : undefined;
}

/** user_data: what identifies the person, hashed where Meta asks for a hash. */
export function userData(u: MetaUser): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const em = normalEmail(u.email);
  if (em) out.em = [sha(em)];
  const ph = normalPhone(u.phone);
  if (ph) out.ph = [sha(ph)];
  if (u.userId) out.external_id = [sha(u.userId)];
  if (u.ip && isIP(u.ip)) out.client_ip_address = u.ip;
  if (u.userAgent) out.client_user_agent = u.userAgent.slice(0, 512);
  if (u.fbp && FB_COOKIE.test(u.fbp)) out.fbp = u.fbp;
  if (u.fbc && FB_COOKIE.test(u.fbc)) out.fbc = u.fbc;
  return out;
}

/** _fbp and _fbc look like "fb.1.1712345678901.AbCd…". Anything else is not
 *  the pixel's and does not go. */
const FB_COOKIE = /^fb\.\d\.\d{10,16}\.[\w.-]{1,256}$/;

export function eventPayload(ev: MetaEvent, now = Date.now()): Record<string, unknown> {
  return {
    event_name: ev.name,
    event_time: ev.time ?? Math.floor(now / 1000),
    event_id: ev.id,
    action_source: ev.source,
    ...(ev.url ? { event_source_url: ev.url } : {}),
    user_data: userData(ev.user),
    ...(ev.data && Object.keys(ev.data).length ? { custom_data: ev.data } : {}),
  };
}

/** Both halves are needed for the server to report: the dataset, and the
 *  token that lets this server write to it. */
export function metaReady(): boolean {
  const c = getConfig();
  return !!(c.META_PIXEL_ID && c.META_CAPI_TOKEN);
}

/** The request body for a batch, token included (in the body, never the URL,
 *  so it cannot end up in a log line). */
export function requestBody(events: MetaEvent[], now = Date.now()): Record<string, unknown> {
  const c = getConfig();
  return {
    data: events.map((e) => eventPayload(e, now)),
    ...(c.META_TEST_EVENT_CODE ? { test_event_code: c.META_TEST_EVENT_CODE } : {}),
    access_token: c.META_CAPI_TOKEN,
  };
}

export async function postEvents(events: MetaEvent[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const c = getConfig();
  const res = await fetchImpl(`https://graph.facebook.com/${c.META_GRAPH_VERSION}/${c.META_PIXEL_ID}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody(events)),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }
}

/**
 * Report it and move on. Never awaited by a request and never thrown: an ad
 * platform that is slow or down must cost nobody a dictation, a launch or a
 * payment. A failure is one log line.
 */
export function sendMetaEvent(ev: MetaEvent): void {
  if (!metaReady()) return;
  void postEvents([ev]).catch((err) => {
    console.warn(`[meta] ${ev.name} not sent: ${(err as Error).message}`);
  });
}

// --- Who is asking --------------------------------------------------------------

/** The visitor's address. Through x0bot.com every request comes from
 *  Vercel, which names the visitor; straight to the API, the connection's
 *  own (trustProxy). */
export function visitorIp(req: FastifyRequest): string | undefined {
  const v = req.headers["x-vercel-forwarded-for"];
  const first = (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
  if (first && isIP(first)) return first;
  return isIP(req.ip) ? req.ip : undefined;
}

export function userAgentOf(req: FastifyRequest): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua ? ua : undefined;
}

/** A cookie off the request, when the browser sent one. */
export function cookieOf(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (typeof raw !== "string") return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** The desktop app is Electron, and its requests say so. */
export const isDesktopAgent = (ua?: string) => /\bElectron\//.test(ua ?? "");

// --- The account's milestones --------------------------------------------------

export type Milestone = "registration" | "keyboard" | "firstDictation";

/** A sign-up is reported only while it is new: the first launch after it is
 *  minutes away, and anything older is an account from before this shipped. */
export const REGISTRATION_WINDOW_MS = 48 * 3600_000;
/** The rest only for an account under a week old: past that there is no ad
 *  click left to credit them to. */
export const FRESH_WINDOW_MS = 7 * 24 * 3600_000;

/** What this account has reached and not yet reported. Pure. */
export function dueMilestones(o: {
  createdAt?: string;
  reported?: Personality["adsReported"];
  /** The phone says its keyboard is switched on. */
  keyboardOn?: boolean;
  wordsEver?: number;
  desktop: boolean;
  now?: number;
}): Milestone[] {
  const made = o.createdAt ? Date.parse(o.createdAt) : NaN;
  if (!Number.isFinite(made)) return [];
  const age = (o.now ?? Date.now()) - made;
  if (age < 0 || age > FRESH_WINDOW_MS) return [];
  const done = o.reported ?? {};
  const due: Milestone[] = [];
  if (!done.registration && age <= REGISTRATION_WINDOW_MS) due.push("registration");
  // A desktop has no keyboard to switch on: the app is ready when it is.
  if (!o.desktop && o.keyboardOn && !done.keyboard) due.push("keyboard");
  if ((o.wordsEver ?? 0) > 0 && !done.firstDictation) due.push("firstDictation");
  return due;
}

/** The names on the site's side (pixel and Conversions API). FirstDictation
 *  is Tailzu's own; Events Manager makes it a custom conversion to optimise
 *  for. */
export const WEB_EVENTS: Record<Milestone, string> = {
  registration: "CompleteRegistration",
  keyboard: "KeyboardOn",
  firstDictation: "FirstDictation",
};

/** What the phone app logs through Meta's SDK. Standard events where Meta
 *  has one (a finished setup is a "tutorial" in Meta's words), so app
 *  campaigns can optimise for them without configuration. */
export interface AppEvent {
  name: string;
  params?: Record<string, string | number>;
}
export const APP_EVENTS: Record<Milestone, AppEvent> = {
  registration: { name: "fb_mobile_complete_registration" },
  keyboard: { name: "fb_mobile_tutorial_completion", params: { fb_content_id: "keyboard", fb_success: 1 } },
  firstDictation: { name: "FirstDictation" },
};

/** Mark them reported. Before they go, so two launches at once cannot both
 *  send them; a failed write means a repeat next launch, never a lost one. */
async function markReported(user: AuthedUser, due: Milestone[], now: number): Promise<void> {
  const at = new Date(now).toISOString();
  await updatePersonality(user, (existing) => {
    const reported = { ...(existing.adsReported ?? {}) };
    for (const m of due) reported[m] = reported[m] ?? at;
    return { ...existing, adsReported: reported };
  });
}

/**
 * A launch (or a dictation) for this account: report what is due.
 *
 * A desktop reports from here, through the Conversions API, as the site's
 * events — the desktop app is downloaded from the site, and that is the ad it
 * came from. A phone gets them back to log through Meta's SDK, which is what
 * ties them to the install and the ad behind it; the server cannot.
 *
 * Nothing at all while Meta is not set up: no write, and nothing handed out.
 */
export async function reportMilestones(o: {
  req: FastifyRequest;
  user: AuthedUser;
  personality: Personality | null | undefined;
  desktop: boolean;
  keyboardOn?: boolean;
  wordsEver?: number;
  now?: number;
}): Promise<AppEvent[]> {
  const c = getConfig();
  if (!c.META_PIXEL_ID) return [];
  if (o.desktop && !metaReady()) return [];
  const now = o.now ?? Date.now();
  const due = dueMilestones({
    createdAt: o.user.createdAt,
    reported: o.personality?.adsReported,
    keyboardOn: o.keyboardOn,
    wordsEver: o.wordsEver,
    desktop: o.desktop,
    now,
  });
  if (!due.length) return [];
  try {
    await markReported(o.user, due, now);
  } catch (err) {
    console.warn(`[meta] could not mark ${due.join(", ")} for ${o.user.id}: ${(err as Error).message}`);
    return [];
  }
  if (!o.desktop) return due.map((m) => APP_EVENTS[m]);
  for (const m of due) {
    sendMetaEvent({
      name: WEB_EVENTS[m],
      // One per account and milestone, so a repeat is counted once.
      id: `${m}:${o.user.id}`,
      source: "website",
      url: "https://x0bot.com/download",
      user: {
        email: o.user.email,
        phone: o.user.phone,
        userId: o.user.id,
        ip: visitorIp(o.req),
        userAgent: userAgentOf(o.req),
      },
    });
  }
  return [];
}

// --- A subscription paid for ----------------------------------------------------

/** Subscriptions already reported by this process. The buyer's browser
 *  (/v1/pay/razorpay/verify) and Razorpay's webhook both say a first payment
 *  went through, in either order, seconds apart: the first one reports. */
const reportedSubscriptions = new Set<string>();

/** The account's email and phone, for matching. Needs the service key; an
 *  account it cannot read is matched on its id and the browser alone. */
async function accountContact(userId: string): Promise<{ email?: string; phone?: string }> {
  const sb = supabase();
  if (!sb) return {};
  const { data } = await sb.auth.admin.getUserById(userId);
  return { email: data.user?.email ?? undefined, phone: data.user?.phone ?? undefined };
}

/**
 * A new subscription's first payment: Subscribe, with what it cost. Once per
 * subscription; renewals are not new subscribers. From the buyer's browser
 * when that is what reports it (its address and the pixel's cookies make the
 * best match), from Razorpay's webhook otherwise.
 */
export function reportSubscribe(o: {
  subscriptionId: string;
  userId: string;
  /** In the currency's main unit (rupees, dollars). */
  value?: number;
  currency?: string;
  req?: FastifyRequest;
}): void {
  if (!metaReady() || reportedSubscriptions.has(o.subscriptionId)) return;
  reportedSubscriptions.add(o.subscriptionId);
  const browser = o.req
    ? {
        ip: visitorIp(o.req),
        userAgent: userAgentOf(o.req),
        fbp: cookieOf(o.req, "_fbp"),
        fbc: cookieOf(o.req, "_fbc"),
      }
    : {};
  void accountContact(o.userId)
    .catch(() => ({}))
    .then((who) => sendMetaEvent({
      name: "Subscribe",
      id: `subscribe:${o.subscriptionId}`,
      source: "website",
      url: "https://x0bot.com/pay",
      user: { ...who, ...browser, userId: o.userId },
      data: o.value && o.currency ? { value: o.value, currency: o.currency.toUpperCase() } : {},
    }));
}

// --- From the site --------------------------------------------------------------

/** The browser events this server will copy to the Conversions API. Only
 *  the ones that mean someone is getting the app; a page view is the pixel's
 *  alone. */
export const SITE_EVENTS = new Set(["Lead"]);
/** Where the download went: a store, an installer. */
const SITE_KINDS = new Set(["mac", "windows", "linux", "iphone", "android"]);
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The server's copy of a browser event (POST /v1/site/event). Same name and
 * id as the pixel's, so Meta counts one; it is here for the visitors whose
 * browser blocks the pixel, and because the server's copy is the one Meta
 * matches best. Returns false for anything that is not one of ours.
 */
export function siteEvent(req: FastifyRequest, body: unknown): boolean {
  if (!metaReady()) return false;
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = String(b.name ?? "");
  const id = String(b.id ?? "");
  const kind = String(b.kind ?? "");
  if (!SITE_EVENTS.has(name) || !EVENT_ID.test(id) || !SITE_KINDS.has(kind)) return false;
  const page = String(b.url ?? "");
  const url = isSitePage(page) ? page.slice(0, 300) : `${SITE_ORIGIN}/`;
  sendMetaEvent({
    name,
    id,
    source: "website",
    url,
    user: {
      ip: visitorIp(req),
      userAgent: userAgentOf(req),
      // The page sends what the pixel set, in case the cookies did not come
      // through the site's proxy.
      fbp: cookieOf(req, "_fbp") ?? (typeof b.fbp === "string" ? b.fbp : undefined),
      fbc: cookieOf(req, "_fbc") ?? (typeof b.fbc === "string" ? b.fbc : undefined),
    },
    data: { content_name: kind },
  });
  return true;
}

/**
 * The pixel, as a page loads it (/site-events.js). On x0bot.com, every page,
 * this server's included, gets it from Vercel instead (tailzu-web,
 * api/_meta.js), with the dataset id from Vercel's settings; this copy serves
 * api.x0bot.com and must stay the same script: change one, change both.
 * Empty when there is no dataset: the pages carry the tag either way.
 *
 * HELD BACK, with no banner to ask: for a visitor whose browser says not to
 * track (Global Privacy Control, Do Not Track), and — META_SKIP_EUROPE — for
 * one whose clock is in Europe, where a pixel needs consent first.
 */
export function siteEventsScript(): string {
  const c = getConfig();
  if (!c.META_PIXEL_ID) return "/* Meta is not set up. */\n";
  return `/* Tailzu → Meta: the page view, and who goes on to get the app. */
(function () {
  "use strict";
  var ID = ${JSON.stringify(c.META_PIXEL_ID)};
  var SKIP_EUROPE = ${c.META_SKIP_EUROPE ? "true" : "false"};
  var nav = window.navigator || {};
  if (nav.globalPrivacyControl === true || nav.doNotTrack === "1" || window.doNotTrack === "1") return;
  var tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  if (SKIP_EUROPE && /^(Europe\\/|Atlantic\\/(Azores|Canary|Faroe|Madeira|Reykjavik)$)/.test(tz)) return;

  // Meta's loader, as Meta publishes it.
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  window.fbq("init", ID);
  window.fbq("track", "PageView");
  var page = location.pathname.replace(/\\/+$/, "") || "/";
  if (page === "/download" || page === "/pricing") window.fbq("track", "ViewContent", { content_name: page.slice(1) });

  /** What a link gets: an installer, or a store. Nothing else is a lead. */
  function kindOf(href) {
    if (/\\/downloads\\/Tailzu\\.dmg$/.test(href)) return "mac";
    if (/\\/downloads\\/Tailzu-Setup\\.exe$/.test(href)) return "windows";
    if (/\\/downloads\\/Tailzu\\.AppImage$/.test(href)) return "linux";
    if (/^https:\\/\\/(apps|itunes)\\.apple\\.com\\//.test(href)) return "iphone";
    if (/^https:\\/\\/play\\.google\\.com\\//.test(href)) return "android";
    if (/^https:\\/\\/[^/]*(microsoft|windows)\\.com\\//.test(href)) return "windows";
    return "";
  }
  function cookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a) return;
    var kind = kindOf(a.href);
    if (!kind) return;
    var id = newId();
    window.fbq("track", "Lead", { content_name: kind }, { eventID: id });
    var body = JSON.stringify({ name: "Lead", id: id, kind: kind, url: location.href, fbp: cookie("_fbp"), fbc: cookie("_fbc") });
    try {
      if (nav.sendBeacon) nav.sendBeacon("/v1/site/event", new Blob([body], { type: "application/json" }));
      else fetch("/v1/site/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
    } catch (e) {}
  }, true);
})();
`;
}

/** The hosts a page needs to allow for the pixel, by CSP directive. */
export const META_CSP = {
  script: "https://connect.facebook.net",
  img: "https://www.facebook.com",
  connect: "https://www.facebook.com https://connect.facebook.net",
} as const;
