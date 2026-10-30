/**
 * Bots app · first run: what its screens read beyond the existing routes (screens/firstRun.ts).
 *
 *   GET /v1/bots/first-run/profile     the "Your name" step: the name to start from (the account's own, else the
 *                                      sign-in provider's, else one suggested from the email) and the gender saved
 *   GET /v1/bots/first-run/languages   the Language page's chips (the onboarding's own list) and what is picked
 *   GET /v1/bots/first-run/words       the account's spoken words and audio seconds, all time; with ?w=&s= (a baseline
 *                                      taken when the step opened) also what was said since: First words' numbers
 *   GET /v1/bots/first-run/plans       Plans' cards: the paywall's own plans (phone, RevenueCat) or the pay page's
 *                                      Razorpay prices (window), the free words, and whether the account already pays
 *   GET /v1/bots/first-run/arrival     { due, kind }: Home's welcome is due. "first": the first visit after onboarding
 *                                      (personality.botsArrivalAt unset). "back": a visit after AWAY_DAYS away, or the
 *                                      first on a newer Home (HOME_VERSION); kept (botsBackDue) until the PUT, so a screen
 *                                      that refreshes mid-welcome still has it. Each new visit is recorded (botsHomeSeenAt).
 *   PUT /v1/bots/first-run/arrival     it was: botsArrivalAt is set (once; a second PUT keeps the first time), the welcome
 *                                      back cleared
 *
 * Every write the steps make goes to the routes that already own it: PUT /v1/profile { full_name, gender } (the name
 * and gender card's own write), PUT /v1/personality (languages, the boss bot's name), PUT /v1/profile { onboarded }
 * (the end), and the clients' own purchase actions (iap.*).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { getEntitlement } from "../billing/entitlements.js";
import { fetchPlan, formatPeriod, formatPrice, planFor, razorpayReady, type Market, type Tier } from "../billing/razorpay.js";
import { getConfig } from "../config.js";
import { DAILY_LANGUAGES, freeForAll, PAYWALL_CONFIG } from "../experience/catalog.js";
import { getPersonality, updatePersonality } from "../personality/store.js";
import { getProfile } from "../profile/store.js";
import { TYPING_WORDS_PER_MINUTE } from "../history/store.js";
import { usageSummary } from "../usage/metering.js";
import type { BotsAreaDeps } from "./botsArea.js";

/** One plan as the Plans step draws it. `buy` is absent when it cannot be bought here and now. */
export interface FirstRunPlan {
  id: string;
  label: string;
  price: string;
  per: string;
  /** `per` with "{price}" where the store's monthly price goes (the paywall's periodTemplate). */
  perTemplate?: string;
  note?: string;
  badge?: string;
  /** Free days before the first charge, when the plan's own terms say so ("7 days free, then …"). */
  trialDays?: number;
  default?: boolean;
  /** The plan in one line, the same for every bot: how much more it gives each month (planLine). */
  line?: string;
  /** What the client calls to buy it: the paywall's own (iap.showPaywall / iap.subscribe). */
  buy?: { kind: "iap.showPaywall"; offeringId: string; packageId?: string } | { kind: "iap.subscribe"; productId: string };
}

export interface FirstRunPlans {
  /** Tailzu is free for everyone right now: nothing is sold. */
  freeForAll: boolean;
  /** The account already pays (and where). */
  entitled: boolean;
  store?: string;
  /** The free plan's words a month (FREE_MONTHLY_WORDS). */
  freeWords: number;
  /** What the paid plans add, in the paywall's own words. */
  features: string[];
  plans: FirstRunPlan[];
}

const unauthorized = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Sign in first" });

/** "7 days free, then billed yearly" → 7. */
export function trialDaysOf(note: string | undefined): number | undefined {
  const m = /(\d+)\s*days?\s+free/i.exec(note ?? "");
  return m ? Number(m[1]) : undefined;
}

/**
 * A name to start from, out of an email address: its local part split on dots, underscores, hyphens and digits,
 * every part a word title-cased ("aanya.rao92@gmail.com" → "Aanya Rao"). A "+tag" is dropped, and so is any part that
 * cannot be a name: a lone letter ("a.b@"), or letters with no vowel, which are initials ("rk2001@"). Nothing left
 * is no suggestion (""), never a guess.
 */
export function nameFromEmail(email: string | undefined | null): string {
  const at = typeof email === "string" ? email.lastIndexOf("@") : -1;
  if (at <= 0) return "";
  const local = email!.slice(0, at).split("+")[0]!;
  const words = local.split(/[._\-\d]+/u)
    .map((p) => p.replace(/[^\p{L}]/gu, ""))
    .filter((p) => p.length > 1 && (/[aeiouy]/i.test(p) || /[^a-z]/i.test(p)))
    .map((p) => p.charAt(0).toLocaleUpperCase("en") + p.slice(1).toLocaleLowerCase("en"));
  return words.join(" ").slice(0, 120);
}

/** How the person signed in, for the "Your name" step: the provider Supabase names, else what the account has. */
export function signedInVia(user: Pick<AuthedUser, "provider" | "email" | "phone">): "google" | "apple" | "email" | "phone" | "other" {
  const p = (user.provider ?? "").toLowerCase();
  if (p === "google" || p === "apple" || p === "email" || p === "phone") return p;
  if (!p) return user.email ? "email" : user.phone ? "phone" : "other";
  return "other";
}

/**
 * The name the "About you" step starts with, and where it came from: the one already saved; else, signed in with
 * Google or Apple, the provider's full name; by email, one suggested from the address; by phone, nothing.
 */
export function startingName(user: Pick<AuthedUser, "provider" | "providerName" | "email" | "phone">, saved?: string | null): { name: string; source: "saved" | "provider" | "email" | null } {
  if (saved && saved.trim()) return { name: saved.trim(), source: "saved" };
  const via = signedInVia(user);
  if (via !== "phone" && via !== "email" && user.providerName?.trim()) return { name: user.providerName.trim(), source: "provider" };
  // Apple's "Hide my email" address is random letters, not a name.
  if (via === "phone" || /@privaterelay\.appleid\.com$/i.test(user.email ?? "")) return { name: "", source: null };
  const guess = nameFromEmail(user.email);
  return guess ? { name: guess, source: "email" } : { name: "", source: null };
}

/** First words' numbers: what was said since the baseline, and how long typing it would have taken. */
export function spokenSince(now: { words: number; audioSeconds: number }, base: { w?: number; s?: number }) {
  const baseWords = Number.isFinite(base.w) ? Math.max(0, base.w!) : now.words;
  const baseSeconds = Number.isFinite(base.s) ? Math.max(0, base.s!) : now.audioSeconds;
  const words = Math.max(0, now.words - baseWords);
  const seconds = Math.max(0, Math.round((now.audioSeconds - baseSeconds) * 10) / 10);
  const typingSeconds = Math.round((words / TYPING_WORDS_PER_MINUTE) * 60);
  return { words, seconds, typingSeconds, totalWords: now.words, totalSeconds: now.audioSeconds };
}

/**
 * A plan in one line, the same for every bot: how many times the free month it gives, from the allowances the meter
 * enforces (USAGE_*_MONTH_PAISE), so the line can never promise more than the server allows.
 */
export function planLine(tier: string, cfg = getConfig()): string {
  const free = cfg.USAGE_FREE_MONTH_PAISE;
  const month = tier === "elite" ? cfg.USAGE_ELITE_MONTH_PAISE : cfg.USAGE_PAID_MONTH_PAISE;
  const times = free > 0 ? Math.floor(month / free) : 0;
  return times >= 2 ? `${times.toLocaleString("en-IN")}× more every month, for all your bots` : "More every month, for all your bots";
}

/** The window's plans: the pay page's own, at Razorpay's prices, for the market its time zone puts it in. */
async function windowPlans(market: Market): Promise<FirstRunPlan[]> {
  if (!razorpayReady()) return [];
  const out: FirstRunPlan[] = [];
  for (const tier of ["elite", "lite"] as Tier[]) {
    const sellable = planFor(market, tier);
    if (!sellable) continue;
    const plan = await fetchPlan(sellable.id).catch(() => null);
    const cfg = PAYWALL_CONFIG.plans.find((p) => p.id === tier);
    out.push({
      id: tier,
      label: cfg?.label ?? (tier === "elite" ? "Elite" : "Lite"),
      price: plan ? formatPrice(plan) : "—",
      per: plan ? formatPeriod(plan) : "Not available right now",
      line: planLine(tier),
      ...(tier === "lite" ? { default: true } : {}),
      // The window has no store: iap.subscribe opens the pay page, signed for this account.
      ...(plan && cfg?.productId ? { buy: { kind: "iap.subscribe" as const, productId: cfg.productId } } : {}),
    });
  }
  return out;
}

/** The phone's plans: the paywall's, bought through RevenueCat exactly as the paywall buys them. */
function phonePlans(): FirstRunPlan[] {
  return PAYWALL_CONFIG.plans.filter((p) => !p.free).map((p) => ({
    id: p.id,
    label: p.label,
    price: p.price,
    per: p.period ?? "",
    ...(p.periodTemplate ? { perTemplate: p.periodTemplate } : {}),
    ...(p.note ? { note: p.note } : {}),
    ...(p.badge ? { badge: p.badge } : {}),
    ...(trialDaysOf(p.note) ? { trialDays: trialDaysOf(p.note) } : {}),
    ...(p.default ? { default: true } : {}),
    line: planLine(p.id),
    buy: p.offeringId
      ? { kind: "iap.showPaywall" as const, offeringId: p.offeringId, ...(p.packageId ? { packageId: p.packageId } : {}) }
      : { kind: "iap.subscribe" as const, productId: p.productId ?? p.id },
  }));
}

/** Home's version: one above what someone last saw, and their next visit is welcomed back. */
export const HOME_VERSION = 2;
/** Days away after which a visit is welcomed back. */
const AWAY_DAYS = 14;
/** One visit: Home opened again within this counts as the same one. */
const VISIT_MS = 30 * 60_000;

export function registerBotsFirstRunRoutes(app: FastifyInstance, deps: BotsAreaDeps): void {
  const rl = { config: deps.rateLimit };

  app.get("/v1/bots/first-run/arrival", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    let p = await getPersonality(user).catch(() => null);
    // Unknown (the store failed): not due. A card that never comes is better than one that keeps coming back.
    if (!p) return reply.send({ due: false });
    const now = Date.now(), seen = Date.parse(p.botsHomeSeenAt ?? "") || 0;
    if (now - seen > VISIT_MS) {
      // A new visit: after a long time away, or the first on a newer Home, it is welcomed back (once onboarded).
      const back = !!p.botsArrivalAt && ((p.botsHomeVersion ?? 0) < HOME_VERSION || (seen > 0 && now - seen > AWAY_DAYS * 86_400_000));
      p = await updatePersonality(user, (c) => ({ ...c, botsHomeSeenAt: new Date(now).toISOString(), botsHomeVersion: HOME_VERSION, ...(back ? { botsBackDue: true } : {}) }))
        .catch(() => p);
    }
    if (!p!.botsArrivalAt) return reply.send({ due: true, kind: "first" });
    return reply.send(p!.botsBackDue ? { due: true, kind: "back" } : { due: false });
  });

  app.put("/v1/bots/first-run/arrival", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    try {
      await updatePersonality(user, (p) => ({ ...p, botsArrivalAt: p.botsArrivalAt ?? new Date().toISOString(), botsBackDue: false }));
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Couldn't save that" });
    }
  });

  app.get("/v1/bots/first-run/profile", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const profile = await getProfile(user).catch(() => null);
    const gender = profile?.gender === "male" || profile?.gender === "female" || profile?.gender === "other" ? profile.gender : null;
    return reply.send({
      ...startingName(user, profile?.fullName),
      via: signedInVia(user),
      gender,
      // Both answers are what the name and gender card asks for: with both, the step has nothing to ask.
      saved: !!(profile?.fullName?.trim() && gender),
      // Onboarded before the first run asked it: the screen is then only About you (the bootstrap's promptScreenId).
      onboarded: profile?.onboarded === true,
    });
  });

  app.get("/v1/bots/first-run/languages", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const personality = await getPersonality(user).catch(() => null);
    const saved = (personality?.languages ?? []).map(String).filter(Boolean);
    // The onboarding's chips (India's languages and English), Hinglish, Hindi and English first.
    const first = ["hinglish", "hi", "en"];
    const shown = DAILY_LANGUAGES.filter((l) => l.india || l.value === "en")
      .sort((a, b) => (first.indexOf(a.value) + 1 || 99) - (first.indexOf(b.value) + 1 || 99));
    return reply.send({
      options: shown.map((l) => ({ value: l.value, label: l.label })),
      picked: saved.length ? saved : ["hinglish", "hi", "en"],
      saved: saved.length > 0,
    });
  });

  app.get("/v1/bots/first-run/words", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
    const usage = await usageSummary(user).catch(() => null);
    if (!usage) return reply.code(503).send({ code: "unavailable", message: "Couldn't read your words" });
    return reply.send(spokenSince(usage.total, { w: num(q.w), s: num(q.s) }));
  });

  app.get("/v1/bots/first-run/plans", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const desktop = q.client === "desktop";
    const ent = await getEntitlement(user).catch(() => null);
    const body: FirstRunPlans = {
      freeForAll: freeForAll(),
      entitled: !!ent,
      ...(ent?.store ? { store: ent.store } : {}),
      freeWords: Math.max(0, getConfig().FREE_MONTHLY_WORDS),
      features: (PAYWALL_CONFIG.features ?? []).filter((f) => !/cancel/i.test(f)).slice(0, 2),
      plans: freeForAll() ? [] : desktop ? await windowPlans(q.market === "world" ? "world" : "IN") : phonePlans(),
    };
    return reply.send(body);
  });
}
