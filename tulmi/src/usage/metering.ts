/**
 * Per-user usage metering. Every successful request records audio seconds +
 * word count so we can enforce a free tier later.
 *
 * Writes to the Supabase `usage_events` table (see supabase/migrations). When
 * Supabase is disabled (DEV_SKIP_AUTH local testing) we log instead of writing,
 * so the pipeline still runs end-to-end without a database.
 */
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";
import { isEntitled } from "../billing/entitlements.js";
import { getConfig } from "../config.js";
import { computeAllowance, type Allowance } from "./allowance.js";
import type { UsageRecord, UsageSummary } from "../../../shared/types/api.js";

export interface MeterInput extends UsageRecord {
  user: AuthedUser;
  /** Which surface produced this: "rest" | "stream". */
  source: "rest" | "stream";
}

// ---------------------------------------------------------------------------
// Static-token (desktop) users: their synthetic ids ("static-<hex>") are not
// UUIDs and don't exist in auth.users, so every usage_events write violates the
// FK and every read errors — which left desktop usage unmetered AND, once the
// FREE_MONTHLY_* caps are enabled, made enforceQuota's fail-closed branch 429
// every desktop request forever. Meter them in-process instead: correct within
// a single-container deployment (the only deployment shape), resets on restart
// (acceptable for a hand-minted token set), bounded by monthly pruning.
// ---------------------------------------------------------------------------
interface MemEvent { at: number; audioSeconds: number; words: number }
const memUsage = new Map<string, MemEvent[]>();
const MEM_RETENTION_MS = 35 * 24 * 60 * 60 * 1000; // > 1 month, quota window

function isStaticUser(user: AuthedUser): boolean {
  return user.id.startsWith("static-");
}

function memRecord(user: AuthedUser, audioSeconds: number, words: number): void {
  const now = Date.now();
  const list = (memUsage.get(user.id) ?? []).filter((e) => now - e.at < MEM_RETENTION_MS);
  list.push({ at: now, audioSeconds, words });
  memUsage.set(user.id, list);
}

export async function recordUsage(input: MeterInput): Promise<void> {
  if (isStaticUser(input.user)) {
    memRecord(input.user, input.audioSeconds, input.words);
    return;
  }
  const sb = dataClientFor(input.user);

  if (!sb) {
    // Dev / no-Supabase mode: don't lose the signal, just log it.
    console.info(
      `[usage] user=${input.user.id} audio=${input.audioSeconds.toFixed(
        1,
      )}s words=${input.words} model=${input.model} source=${input.source}`,
    );
    return;
  }

  const { error } = await sb.from("usage_events").insert({
    user_id: input.user.id,
    audio_seconds: input.audioSeconds,
    word_count: input.words,
    model: input.model,
    source: input.source,
  });

  if (error) {
    // Never fail the user's request because metering failed; log loudly.
    console.error(`[usage] failed to record for ${input.user.id}:`, error.message);
  }
}

/** Aggregate a user's usage into this-month + all-time totals (for the stats screen). */
type UsageRow = { audio_seconds?: number | null; word_count?: number | null; created_at?: string };

const USAGE_PAGE = 1000;
/** A ceiling on one read, so one account cannot pull an unbounded table. */
const USAGE_MAX_ROWS = 200_000;

/**
 * EVERY usage row since `sinceIso`, a page at a time.
 *
 * PostgREST answers an unpaged select with at most its max-rows (1,000 on
 * Supabase). usageSummary read the whole table that way, so for anyone past
 * a thousand requests "this month" was summed from whichever thousand came
 * back — and the Stats tab's month said one number while "Words this month",
 * read for the month alone, said another. Ordered by id, which never ties,
 * so no row is read twice or skipped between pages. An error only when the
 * first page cannot be read; a later page failing keeps what was read.
 */
async function readUsageRows(
  sb: NonNullable<ReturnType<typeof dataClientFor>>,
  userId: string,
  sinceIso?: string,
): Promise<{ rows: UsageRow[] } | { error: string }> {
  const rows: UsageRow[] = [];
  for (let from = 0; from < USAGE_MAX_ROWS; from += USAGE_PAGE) {
    let q = sb
      .from("usage_events")
      .select("audio_seconds, word_count, created_at")
      .eq("user_id", userId);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + USAGE_PAGE - 1);
    if (error || !data) {
      if (!rows.length) return { error: error?.message ?? "no data" };
      break;
    }
    rows.push(...(data as UsageRow[]));
    if (data.length < USAGE_PAGE) break;
  }
  return { rows };
}

export async function usageSummary(user: AuthedUser, tzOffsetMinutes?: number): Promise<UsageSummary> {
  const empty = () => ({ words: 0, audioSeconds: 0, requests: 0 });
  const out: UsageSummary = { month: empty(), total: empty() };
  // TODAY, IN THE CALLER'S DAY. Only when their clock was given: a "today"
  // bucketed on Greenwich would put an Indian evening into tomorrow.
  const withToday = typeof tzOffsetMinutes === "number" && Number.isFinite(tzOffsetMinutes);
  const tzMs = withToday ? Math.max(-840, Math.min(840, Math.round(tzOffsetMinutes!))) * 60_000 : 0;
  const shifted = new Date(Date.now() + tzMs);
  const todayStartMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - tzMs;
  if (withToday) out.today = empty();
  if (isStaticUser(user)) {
    const now = new Date();
    const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    for (const e of memUsage.get(user.id) ?? []) {
      out.total.words += e.words; out.total.audioSeconds += e.audioSeconds; out.total.requests += 1;
      if (e.at >= monthStartMs) {
        out.month.words += e.words; out.month.audioSeconds += e.audioSeconds; out.month.requests += 1;
      }
      if (out.today && e.at >= todayStartMs) {
        out.today.words += e.words; out.today.audioSeconds += e.audioSeconds; out.today.requests += 1;
      }
    }
    return out;
  }
  const sb = dataClientFor(user);
  if (!sb) return out;

  const read = await readUsageRows(sb, user.id);
  if ("error" in read) return out;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  for (const r of read.rows) {
    const a = r.audio_seconds ?? 0;
    const w = r.word_count ?? 0;
    out.total.words += w; out.total.audioSeconds += a; out.total.requests += 1;
    if ((r.created_at ?? "") >= monthStart) {
      out.month.words += w; out.month.audioSeconds += a; out.month.requests += 1;
    }
    if (out.today && Date.parse(r.created_at ?? "") >= todayStartMs) {
      out.today.words += w; out.today.audioSeconds += a; out.today.requests += 1;
    }
  }
  return out;
}

/**
 * Raw metered events for the Stats tab.
 *
 * Stats used to read ONLY cleanup_history — which is gated behind explicit
 * consent (personality.learnFromSent / retainHistory). A user who never opted
 * in has an empty history table, so every number on the Stats tab read zero
 * forever, which looked like the feature was broken rather than gated.
 *
 * usage_events is written for EVERY request and holds no content — just
 * timestamps, audio seconds and word counts — so it can back the whole tab
 * without needing consent for anything. Only the content-derived breakdowns
 * (which app you wrote in) still require history.
 *
 * `audioSeconds > 0` is the voice/typing discriminator: a metered event with
 * audio behind it was dictation.
 */
export async function usageEventsSince(
  user: AuthedUser,
  sinceIso: string | undefined,
): Promise<Array<{ createdAt: string; audioSeconds: number; words: number }>> {
  if (isStaticUser(user)) {
    const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
    return (memUsage.get(user.id) ?? [])
      .filter((e) => e.at >= sinceMs)
      .map((e) => ({
        createdAt: new Date(e.at).toISOString(),
        audioSeconds: e.audioSeconds,
        words: e.words,
      }));
  }
  const sb = dataClientFor(user);
  if (!sb) return [];
  const read = await readUsageRows(sb, user.id, sinceIso);
  if ("error" in read) {
    console.error(`[usage] stats read failed for ${user.id}:`, read.error);
    return [];
  }
  return read.rows
    .map((r) => ({
      createdAt: r.created_at ?? new Date(0).toISOString(),
      audioSeconds: r.audio_seconds ?? 0,
      words: r.word_count ?? 0,
    }));
}

/**
 * Is this id on the operator exemption list?
 *
 * Exact match after trimming, never a prefix or a pattern: this lifts a
 * billing cap, and every shortcut that makes such a list convenient also makes
 * it possible to exempt more than was meant. An empty or absent list exempts
 * nobody, which is the default.
 */
export function isQuotaExempt(id: string, configured: string | undefined): boolean {
  if (!configured || !id) return false;
  return configured.split(",").some((entry) => entry.trim() === id);
}

/**
 * Pre-flight free-tier check. Returns a human-readable reason string when the
 * user is over the configured monthly ceiling — the caller should refuse the
 * request BEFORE calling any paid upstream. Returns null when the user is
 * inside the limit (or no limit is configured).
 *
 * Cheap enough to call on every request path: one indexed query per user per
 * request, cached at Supabase.
 */
export async function enforceQuota(user: AuthedUser): Promise<string | null> {
  // Free for everyone (FREE_FOR_ALL): nothing to check, and no read to pay for.
  if (getConfig().FREE_FOR_ALL) return null;
  // Paying users are not metered. This check did not exist, so a subscriber
  // was counted against the free monthly cap like everyone else and cut off
  // at 2,500 words — they had paid for unlimited and got the free tier, which
  // is the worst failure this product can have.
  //
  // The answer comes from the entitlements table, written only by RevenueCat's
  // webhook. The CLIENT also knows its entitlement and hides the paywall
  // accordingly, but a client is not evidence and cannot be the thing that
  // lifts a server-side cap.
  if (await isEntitled(user)) return null;

  const cfg = getConfig();
  // Operator tokens, listed one id at a time. See QUOTA_EXEMPT_USER_IDS —
  // this exists because a static bearer token resolves to a `static-<hash>`
  // user, which cannot hold an entitlements row (that table's foreign key
  // points at auth.users), so the quality harness had no way to run a full
  // pass without spending a real monthly allowance.
  if (isQuotaExempt(user.id, cfg.QUOTA_EXEMPT_USER_IDS)) return null;
  const capAudio = cfg.FREE_MONTHLY_AUDIO_SECONDS;
  const capWords = cfg.FREE_MONTHLY_WORDS;
  if (capAudio <= 0 && capWords <= 0) return null; // no limit configured

  const moments = await usageMomentsSince(user, monthStartIso());
  if (!moments) {
    // We couldn't read usage. With auth DISABLED (dev / DEV_SKIP_AUTH) there's
    // no billing to protect → allow. But when auth is CONFIGURED, a null means
    // the read failed or the wrong Supabase key is deployed — failing OPEN here
    // would hand out unlimited paid STT (the reported bypass), so fail CLOSED
    // with a soft retry rather than a permanent lock.
    if (!cfg.authEnabled) return null;
    return "Couldn't verify your usage right now — please try again in a moment.";
  }
  const used = moments.reduce(
    (acc, m) => ({ audioSeconds: acc.audioSeconds + m.audioSeconds, words: acc.words + m.words }),
    { audioSeconds: 0, words: 0 },
  );

  if (capAudio > 0 && used.audioSeconds >= capAudio) {
    return `Monthly voice cap reached (${Math.round(capAudio / 60)} min). Resets ${monthResetDate()}.`;
  }
  if (capWords > 0) {
    // The ceiling is the plan's words PLUS what this month's use has earned.
    // Enforcing capWords here instead would stop a user at 2,500 while the app
    // was showing them 4,100 — the earned words have to be real where it
    // counts, or the mechanic is a lie told by the stats screen.
    // SAME SEED as allowanceFor. Without the user id here the roll differs
    // from the one the stats screen drew, and the cap the server enforces
    // stops matching the number the app showed — the exact drift the derived
    // design exists to make impossible.
    const allowance = computeAllowance(moments, Date.now(), user.id);
    if (used.words >= allowance.total) {
      // Name the number, the reset date, and the way out. A cap message that
      // only says "no" reads as a fault; this one is the upgrade prompt.
      const earnedNote = allowance.earned > 0
        ? ` (${capWords.toLocaleString()} free + ${allowance.earned.toLocaleString()} earned)`
        : "";
      return `You've used your ${allowance.total.toLocaleString()} words this month${earnedNote}. ` +
        `Upgrade for unlimited, or wait until ${monthResetDate()}.`;
    }
  }
  return null;
}

function monthResetDate(): string {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

/**
 * A user's metered rows since a given ISO timestamp — the read side of
 * free-tier enforcement (enforceQuota) and of the allowance.
 *
 * Unaggregated, because earned words are a function of WHEN dictations
 * happened, not just how many words they produced. This is the one read;
 * enforceQuota sums it and the allowance walks it, which is what keeps the
 * number enforced and the number displayed from ever disagreeing.
 *
 * Reads via `dataClientFor(user)` — the service client when configured, else
 * the JWT-scoped (RLS) client — so quota reads work on anon-key-only
 * deployments too (a service-only read there returned null → quota fail-open).
 */
export async function usageMomentsSince(
  user: AuthedUser,
  sinceIso: string,
): Promise<Array<{ at: number; audioSeconds: number; words: number }> | null> {
  const sinceMs = Date.parse(sinceIso) || 0;
  if (isStaticUser(user)) {
    return (memUsage.get(user.id) ?? [])
      .filter((e) => e.at >= sinceMs)
      .map((e) => ({ at: e.at, audioSeconds: e.audioSeconds, words: e.words }));
  }
  const sb = dataClientFor(user);
  if (!sb) return null;

  const read = await readUsageRows(sb, user.id, sinceIso);
  if ("error" in read) return null;

  return read.rows.map((row) => ({
    at: Date.parse(String(row.created_at)) || 0,
    audioSeconds: row.audio_seconds ?? 0,
    words: row.word_count ?? 0,
  }));
}

/** The start of the current monthly window, in UTC. */
export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * This user's word allowance right now: the plan's words plus what they have
 * earned, against what they have spent. Null when usage could not be read, or
 * when the user is entitled and no allowance applies.
 */
export async function allowanceFor(user: AuthedUser): Promise<Allowance | null> {
  const moments = await usageMomentsSince(user, monthStartIso());
  if (!moments) return null;
  // The user's id seeds the day's roll, so two people active on the same day
  // get different numbers and each person's own day never changes.
  return computeAllowance(moments, Date.now(), user.id);
}
