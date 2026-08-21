/**
 * Per-user usage metering. Every successful request records audio seconds +
 * word count so we can enforce a free tier later.
 *
 * Writes to the Supabase `usage_events` table (see supabase/migrations). When
 * Supabase is disabled (DEV_SKIP_AUTH local testing) we log instead of writing,
 * so the pipeline still runs end-to-end without a database.
 */
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";
import { getConfig } from "../config.js";
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

function memSince(user: AuthedUser, sinceMs: number): { audioSeconds: number; words: number } {
  const out = { audioSeconds: 0, words: 0 };
  for (const e of memUsage.get(user.id) ?? []) {
    if (e.at >= sinceMs) {
      out.audioSeconds += e.audioSeconds;
      out.words += e.words;
    }
  }
  return out;
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
export async function usageSummary(user: AuthedUser): Promise<UsageSummary> {
  const empty = () => ({ words: 0, audioSeconds: 0, requests: 0 });
  const out: UsageSummary = { month: empty(), total: empty() };
  if (isStaticUser(user)) {
    const now = new Date();
    const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    for (const e of memUsage.get(user.id) ?? []) {
      out.total.words += e.words; out.total.audioSeconds += e.audioSeconds; out.total.requests += 1;
      if (e.at >= monthStartMs) {
        out.month.words += e.words; out.month.audioSeconds += e.audioSeconds; out.month.requests += 1;
      }
    }
    return out;
  }
  const sb = dataClientFor(user);
  if (!sb) return out;

  const { data, error } = await sb
    .from("usage_events")
    .select("audio_seconds, word_count, created_at")
    .eq("user_id", user.id);
  if (error || !data) return out;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  for (const r of data as Array<{ audio_seconds?: number; word_count?: number; created_at?: string }>) {
    const a = r.audio_seconds ?? 0;
    const w = r.word_count ?? 0;
    out.total.words += w; out.total.audioSeconds += a; out.total.requests += 1;
    if ((r.created_at ?? "") >= monthStart) {
      out.month.words += w; out.month.audioSeconds += a; out.month.requests += 1;
    }
  }
  return out;
}

/**
 * Windowed usage projection for the Privacy audit endpoint. Reads the same
 * usage_events rows and buckets them into fixed windows: 24h / 7d / 30d /
 * all-time. When Supabase is disabled all counts come back as zero (the caller
 * still gets a valid PrivacyAuditResponse shape).
 */
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
  let q = sb
    .from("usage_events")
    .select("audio_seconds, word_count, created_at")
    .eq("user_id", user.id);
  if (sinceIso) q = q.gte("created_at", sinceIso);
  const { data, error } = await q;
  if (error || !data) {
    if (error) console.error(`[usage] stats read failed for ${user.id}:`, error.message);
    return [];
  }
  return (data as Array<{ created_at?: string; audio_seconds?: number | null; word_count?: number | null }>)
    .map((r) => ({
      createdAt: r.created_at ?? new Date(0).toISOString(),
      audioSeconds: r.audio_seconds ?? 0,
      words: r.word_count ?? 0,
    }));
}

export async function usageWindows(
  user: AuthedUser,
): Promise<Array<{ window: string; requests: number; audioSeconds: number; words: number }>> {
  const buckets = [
    { window: "last24h", sinceMs: 24 * 60 * 60 * 1000 },
    { window: "last7d", sinceMs: 7 * 24 * 60 * 60 * 1000 },
    { window: "last30d", sinceMs: 30 * 24 * 60 * 60 * 1000 },
    { window: "allTime", sinceMs: Number.POSITIVE_INFINITY },
  ];
  const empty = () =>
    buckets.map((b) => ({ window: b.window, requests: 0, audioSeconds: 0, words: 0 }));

  const sb = dataClientFor(user);
  if (!sb) return empty();

  const { data, error } = await sb
    .from("usage_events")
    .select("audio_seconds, word_count, created_at")
    .eq("user_id", user.id);
  if (error || !data) return empty();

  const now = Date.now();
  const out = empty();
  for (const r of data as Array<{ audio_seconds?: number; word_count?: number; created_at?: string }>) {
    const ts = r.created_at ? Date.parse(r.created_at) : NaN;
    const age = Number.isFinite(ts) ? now - ts : Number.POSITIVE_INFINITY;
    const a = r.audio_seconds ?? 0;
    const w = r.word_count ?? 0;
    for (let i = 0; i < buckets.length; i++) {
      if (age <= buckets[i]!.sinceMs) {
        out[i]!.audioSeconds += a;
        out[i]!.words += w;
        out[i]!.requests += 1;
      }
    }
  }
  return out;
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
  const cfg = getConfig();
  const capAudio = cfg.FREE_MONTHLY_AUDIO_SECONDS;
  const capWords = cfg.FREE_MONTHLY_WORDS;
  if (capAudio <= 0 && capWords <= 0) return null; // no limit configured

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const used = await usageSince(user, monthStart);
  if (!used) {
    // We couldn't read usage. With auth DISABLED (dev / DEV_SKIP_AUTH) there's
    // no billing to protect → allow. But when auth is CONFIGURED, a null means
    // the read failed or the wrong Supabase key is deployed — failing OPEN here
    // would hand out unlimited paid STT (the reported bypass), so fail CLOSED
    // with a soft retry rather than a permanent lock.
    if (!getConfig().authEnabled) return null;
    return "Couldn't verify your usage right now — please try again in a moment.";
  }

  if (capAudio > 0 && used.audioSeconds >= capAudio) {
    return `Monthly voice cap reached (${Math.round(capAudio / 60)} min). Resets ${monthResetDate()}.`;
  }
  if (capWords > 0 && used.words >= capWords) {
    return `Monthly word cap reached (${capWords}). Resets ${monthResetDate()}.`;
  }
  return null;
}

function monthResetDate(): string {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Sum a user's audio-seconds usage since a given ISO timestamp. This is the
 * read side free-tier enforcement uses (see enforceQuota).
 *
 * Reads via `dataClientFor(user)` — the service client when configured, else
 * the JWT-scoped (RLS) client — so quota reads work on anon-key-only
 * deployments too (a service-only read there returned null → quota fail-open).
 */
export async function usageSince(
  user: AuthedUser,
  sinceIso: string,
): Promise<{ audioSeconds: number; words: number } | null> {
  if (isStaticUser(user)) return memSince(user, Date.parse(sinceIso) || 0);
  const sb = dataClientFor(user);
  if (!sb) return null;

  const { data, error } = await sb
    .from("usage_events")
    .select("audio_seconds, word_count")
    .eq("user_id", user.id)
    .gte("created_at", sinceIso);

  if (error || !data) return null;

  return data.reduce(
    (acc, row) => ({
      audioSeconds: acc.audioSeconds + (row.audio_seconds ?? 0),
      words: acc.words + (row.word_count ?? 0),
    }),
    { audioSeconds: 0, words: 0 },
  );
}
