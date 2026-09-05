// CALLERS: /v1/transcribe-clean, /v1/refine, /v1/draft, and the /v1/stream WS
// handler should call appendHistoryEntry() on success. Wiring lives in
// server.ts / cleanup routes.
/**
 * Per-user cleanup history: append-only log of what the user asked for and
 * what Tulmi produced. Storage is *opt-in* — appendHistoryEntry no-ops unless
 * the caller passes a personality that has explicitly consented via
 * `learnFromSent === true` or `retainHistory === true`.
 *
 * Reads/writes go through the user's own JWT (RLS-scoped) when available and
 * the service-role client otherwise. Falls back to a plain in-memory store
 * under DEV_SKIP_AUTH so the endpoints still work end-to-end without a DB.
 *
 * Soft-delete: entries are hidden by setting a server-side `deleted_at`
 * timestamp; rows are never physically removed here (a periodic 90-day purge
 * runs out-of-tree — see 0004_history.sql).
 */
import { randomUUID } from "node:crypto";
import { dataClientFor, type AuthedUser } from "../auth/supabase.js";
import { usageEventsSince } from "../usage/metering.js";
import type {
  HistoryEntry,
  LanguageHint,
  Personality,
  TargetAppHint,
} from "../../../shared/types/api.js";

/**
 * Baseline typing throughput assumed when estimating "minutes saved". 40 wpm
 * is a middle-of-the-road adult typing speed; tuned here as a single constant
 * so a product-facing decision (should we assume 30? 60?) is one edit away.
 */
export const TYPING_WORDS_PER_MINUTE = 40;

/** How many history rows a list response returns by default. */
export const DEFAULT_LIMIT = 50;
/** Maximum a caller can request via `?limit=` on the list endpoint. */
export const MAX_LIMIT = 200;

/** A row headed for the DB. Matches the SDUI HistoryEntry contract 1:1. */
export interface HistoryInput {
  kind: HistoryEntry["kind"];
  targetApp?: TargetAppHint;
  language?: LanguageHint;
  input: string;
  output: string;
  durationMs?: number;
  wordsIn?: number;
  wordsOut?: number;
}

/** Filters accepted by listHistory. */
export interface ListOptions {
  /** Newest-N cap for the response. Clamped to [1, MAX_LIMIT]. */
  limit?: number;
  /** ISO-8601 cursor — return rows strictly older than this timestamp. */
  before?: string;
  /**
   * Row-id tie-breaker paired with `before`. When set, paging uses the
   * compound (created_at, id) < (before, beforeId) comparison so rows that
   * share the boundary timestamp aren't dropped. A caller that sends only
   * `before` keeps the older timestamp-only behavior.
   */
  beforeId?: string;
  /** Only return rows whose kind matches. */
  kind?: HistoryEntry["kind"];
}

/** Sum-of-cleanups over a rolling window, plus a per-day sparkline and the
 * deep projections the Stats tab charts (all optional — old clients ignore
 * them, old servers omit them). Day bucketing honors the caller's UTC offset
 * when provided so "today" and "evening" mean the user's day, not Greenwich's. */
export interface StatsForUser {
  window: "week" | "month" | "all";
  requests: number;
  wordsOut: number;
  audioSeconds: number;
  minutesSaved: number;
  sparklinePerDay: number[];
  /** Words written per day, same buckets/order as sparklinePerDay. */
  wordsPerDay?: number[];
  /** Days in the window with at least one session. */
  daysActive?: number;
  /** Consecutive active days ending today (or yesterday, so an unfinished
   * today doesn't read as a broken streak). */
  currentStreak?: number;
  /** Longest run of consecutive active days inside the window. */
  bestStreak?: number;
  /** Words by capture kind — the "how you write" split. */
  kindWords?: { voice: number; typing: number; draft: number };
  /** Sessions by local time-of-day band — the "when you write" split. */
  daypartSessions?: { morning: number; afternoon: number; evening: number; night: number };
  /** Top target apps by words (max 5, remainder as "Other"). */
  topApps?: Array<{ app: string; words: number }>;
  /** The single biggest day in the window. */
  bestDay?: { date: string; words: number };
  /** wordsOut / sessions, rounded. */
  avgWordsPerSession?: number;
  /** Minutes of speech processed (voice rows), rounded to one decimal. */
  speakingMinutes?: number;
}

/**
 * Whether this user's cleanups are kept.
 *
 * The per-user switches still win when SET — someone who explicitly turned
 * retention off stays off. What changed is the DEFAULT for everyone who has
 * never expressed a preference: the toggle that used to set it was removed
 * from Settings by owner decision, which left the flag unreachable, permanently
 * false, and History permanently empty with no way for anyone to change that.
 *
 * A History screen that can never fill is worse than one that is on: it looks
 * broken, and the user cannot tell it is a setting.
 *
 * NOTE this stores the user's transcripts and cleaned text server-side by
 * default. HISTORY_DEFAULT_ON=false restores opt-in, with no code change.
 */
const HISTORY_DEFAULT_ON =
  (process.env.HISTORY_DEFAULT_ON ?? "true").toLowerCase() !== "false";

export function hasConsentedToHistory(personality: Personality | undefined): boolean {
  if (personality?.retainHistory === false) return false;
  if (personality?.learnFromSent === true || personality?.retainHistory === true) return true;
  return HISTORY_DEFAULT_ON;
}

// ---------------------------------------------------------------------------
// In-memory fallback — used when Supabase is disabled (DEV_SKIP_AUTH).
// ---------------------------------------------------------------------------

interface StoredRow extends HistoryEntry {
  deletedAt?: string;
  audioSeconds?: number;
}

const memory = new Map<string, StoredRow[]>();

function memoryRows(userId: string): StoredRow[] {
  let rows = memory.get(userId);
  if (!rows) {
    rows = [];
    memory.set(userId, rows);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * How long after a row lands a follow-up request is still "the same thing".
 *
 * Two clients multiply one action into several rows, and both are timing
 * rather than intent:
 *
 *   - A one-shot upload that times out client-side after the server has
 *     already transcribed and written it is retried, so the same utterance is
 *     written again. Same kind, same input, seconds apart.
 *   - After a dictation stops, the keyboard refines what landed — but the
 *     stream sends one `final` per segment, and each one that arrives after
 *     the stop re-arms the refine. One dictation becomes one voice row plus a
 *     typing row per late segment, each refining a fragment of the text the
 *     voice row already holds.
 *
 * Within this window, the first is dropped and the second is folded into the
 * row it refines. Env-tunable; 0 disables coalescing entirely.
 */
function coalesceWindowMs(): number {
  const n = Number(process.env.HISTORY_COALESCE_MS ?? 25_000);
  return Number.isFinite(n) && n >= 0 ? n : 25_000;
}

/**
 * Decide whether `entry` is really a continuation of `prev`, and if so what
 * `prev` should become. Pure, so both storage backends and the tests share
 * exactly one definition of "the same thing".
 *
 *   drop   — an exact repeat (a retried request); keep prev as it is
 *   merge  — a refine of text prev already holds; prev's output becomes the
 *            text the user actually ended up with
 *   null   — a new entry
 */
export function coalesce(
  prev: { kind: string; input: string; output: string; createdAt: string },
  entry: HistoryInput,
  now = Date.now(),
): { action: "drop" } | { action: "merge"; output: string; wordsOut: number } | null {
  const window = coalesceWindowMs();
  if (window <= 0) return null;
  const age = now - Date.parse(prev.createdAt);
  // A small negative age is clock skew between this process and the database
  // that stamped the row, not a row from the future. Requiring age >= 0 let
  // a few milliseconds of skew switch coalescing off entirely, silently.
  if (!(age >= -5000 && age <= window)) return null;

  if (prev.kind === entry.kind && prev.input === entry.input) return { action: "drop" };

  if (entry.kind === "typing") {
    const from = entry.input.trim();
    if (from.length > 0 && prev.output.includes(from)) {
      // The keyboard replaced exactly this text at the cursor with the refined
      // version; do the same to the row so it shows what the user has.
      const output = prev.output.replace(from, entry.output.trim());
      return { action: "merge", output, wordsOut: countWordsLocal(output) };
    }
  }
  return null;
}

function countWordsLocal(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Insert one history row — or fold it into the previous one, see coalesce().
 * This is a no-op when:
 *  - Supabase is disabled AND we have no in-memory fallback (never — the map
 *    is always available), OR
 *  - the passed `personality` doesn't have history consent set.
 *
 * The caller MUST pass its already-loaded personality — this function does
 * NOT re-fetch it, so per-request handlers stay one DB round-trip lean.
 */
/**
 * Serialize appends per user.
 *
 * Coalescing reads the previous row and then writes. That is only correct if
 * the two happen without another append in between — and they do not: a single
 * dictation fires several refines within a second of each other, so all of
 * them read the same "previous row" before any has inserted, none sees the
 * others, and every one is written. One utterance, four cards.
 *
 * A read-then-write cannot fix concurrent writers by being cleverer about the
 * read. They have to take turns.
 *
 * Per user, so one person's burst never delays anyone else, and the entry is
 * released in a finally so a thrown append cannot wedge the queue.
 */
const appendLocks = new Map<string, Promise<void>>();

async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = appendLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  appendLocks.set(userId, prev.then(() => gate));
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    // Drop the entry once this was the last waiter, so the map does not grow
    // with every user the process has ever served.
    if (appendLocks.get(userId) === gate) appendLocks.delete(userId);
  }
}

export async function appendHistoryEntry(
  user: AuthedUser,
  personality: Personality | undefined,
  entry: HistoryInput,
  /** Optional: audio seconds for stats aggregation on the "voice" kind. */
  audioSeconds?: number,
): Promise<void> {
  if (!hasConsentedToHistory(personality)) return;
  return withUserLock(user.id, () => appendHistoryEntryLocked(user, entry, audioSeconds));
}

async function appendHistoryEntryLocked(
  user: AuthedUser,
  entry: HistoryInput,
  audioSeconds?: number,
): Promise<void> {
  const sb = dataClientFor(user);
  if (!sb) {
    const rows = memoryRows(user.id);
    const prev = rows.find((r) => !r.deletedAt);
    if (prev) {
      const c = coalesce(prev, entry);
      if (c?.action === "drop") return;
      if (c?.action === "merge") {
        prev.output = c.output;
        prev.wordsOut = c.wordsOut;
        return;
      }
    }
    rows.unshift({
      id: randomUUID(),
      kind: entry.kind,
      targetApp: entry.targetApp,
      language: entry.language,
      input: entry.input,
      output: entry.output,
      durationMs: entry.durationMs,
      wordsIn: entry.wordsIn,
      wordsOut: entry.wordsOut,
      createdAt: new Date().toISOString(),
      audioSeconds,
    });
    return;
  }

  // One extra read per write, so a retried upload or a per-segment refine
  // does not become its own row. Any failure here falls through to a plain
  // insert — a duplicate is the lesser harm.
  const { data: last } = await sb
    .from("cleanup_history")
    .select("id, kind, input, output, created_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  const prev = last?.[0];
  if (prev) {
    const c = coalesce(
      {
        kind: String(prev.kind),
        input: String(prev.input ?? ""),
        output: String(prev.output ?? ""),
        createdAt: String(prev.created_at),
      },
      entry,
    );
    if (c?.action === "drop") return;
    if (c?.action === "merge") {
      const { error: upErr } = await sb
        .from("cleanup_history")
        .update({ output: c.output, words_out: c.wordsOut })
        .eq("id", prev.id)
        .eq("user_id", user.id);
      if (!upErr) return;
      console.error(`[history] merge failed for ${user.id}, inserting instead:`, upErr.message);
    }
  }

  const { error } = await sb.from("cleanup_history").insert({
    user_id: user.id,
    kind: entry.kind,
    target_app: entry.targetApp ?? null,
    language: entry.language ?? null,
    input: entry.input,
    output: entry.output,
    duration_ms: entry.durationMs ?? null,
    words_in: entry.wordsIn ?? null,
    words_out: entry.wordsOut ?? null,
  });
  if (error) {
    // Never fail the user's request because history logging failed.
    console.error(`[history] failed to append for ${user.id}:`, error.message);
  }
}

/**
 * List a user's most recent history entries, newest-first. Rows are ordered by
 * (created_at desc, id desc) and paged with a compound (created_at, id) cursor
 * so entries that share a boundary timestamp aren't silently skipped between
 * pages. The cursor is returned as `nextBefore` (created_at) + `nextBeforeId`
 * (id); callers echo both back as `?before=` + `?beforeId=`.
 */
export async function listHistory(
  user: AuthedUser,
  opts: ListOptions = {},
): Promise<{ entries: HistoryEntry[]; nextBefore?: string; nextBeforeId?: string }> {
  const limit = clampLimit(opts.limit);

  const sb = dataClientFor(user);
  if (!sb) {
    const all = memoryRows(user.id).filter(
      (r) =>
        !r.deletedAt &&
        (!opts.kind || r.kind === opts.kind) &&
        beforeCursorOk(r.createdAt, r.id, opts.before, opts.beforeId),
    );
    // Stable (createdAt desc, id desc) total order so the compound cursor pages
    // deterministically even when two rows share a timestamp.
    all.sort((a, b) =>
      a.createdAt === b.createdAt
        ? b.id.localeCompare(a.id)
        : a.createdAt < b.createdAt
          ? 1
          : -1,
    );
    const hasMore = all.length > limit;
    const page = all.slice(0, limit);
    const last = page[page.length - 1];
    return {
      entries: page.map(stripAudio),
      nextBefore: hasMore ? last?.createdAt : undefined,
      nextBeforeId: hasMore ? last?.id : undefined,
    };
  }

  let q = sb
    .from("cleanup_history")
    .select("id, kind, target_app, language, input, output, duration_ms, words_in, words_out, created_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // tie-breaker: same-timestamp rows page deterministically
    .limit(limit + 1); // ask for one extra so we know whether there's a next page

  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.before) {
    if (opts.beforeId) {
      // Compound (created_at, id) < (before, beforeId): rows strictly older by
      // timestamp, OR equal-timestamp rows with a smaller id. Stops the silent
      // drop of rows that share the boundary created_at.
      q = q.or(
        `created_at.lt.${opts.before},and(created_at.eq.${opts.before},id.lt.${opts.beforeId})`,
      );
    } else {
      // Legacy callers that only echo the created_at cursor keep the prior
      // timestamp-only paging.
      q = q.lt("created_at", opts.before);
    }
  }

  const { data, error } = await q;
  if (error) {
    console.error(`[history] list failed for ${user.id}:`, error.message);
    return { entries: [] };
  }

  const rows = (data ?? []).map(rowToEntry);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    entries: page,
    nextBefore: hasMore ? last?.createdAt : undefined,
    nextBeforeId: hasMore ? last?.id : undefined,
  };
}

/**
 * Soft-delete an entry. Returns true when a row was updated, false when the
 * id isn't found (or belongs to someone else — RLS makes that indistinguishable
 * and that's intentional).
 */
export async function deleteHistoryEntry(
  user: AuthedUser,
  id: string,
): Promise<boolean> {
  const sb = dataClientFor(user);
  if (!sb) {
    const rows = memoryRows(user.id);
    const target = rows.find((r) => r.id === id && !r.deletedAt);
    if (!target) return false;
    target.deletedAt = new Date().toISOString();
    return true;
  }

  const { data, error } = await sb
    .from("cleanup_history")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.error(`[history] delete failed for ${user.id}:`, error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Aggregate the user's history + usage over a rolling window. Reads
 * cleanup_history rather than usage_events so we only reflect entries the
 * user has consented to keep — this screen is about *their* history, not the
 * meter behind it.
 */
export async function statsForUser(
  user: AuthedUser,
  window: "week" | "month" | "all",
  tzOffsetMinutes = 0,
): Promise<StatsForUser> {
  const sinceMs = windowSinceMs(window);
  const sinceIso = sinceMs != null ? new Date(Date.now() - sinceMs).toISOString() : undefined;
  const days = windowDayCount(window);

  const sb = dataClientFor(user);
  let rows = sb
    ? await fetchStatRowsSupabase(sb, user.id, sinceIso)
    : fetchStatRowsMemory(user.id, sinceIso);

  // FALLBACK: cleanup_history only holds rows for users who explicitly opted
  // into retention (personality.learnFromSent / retainHistory), so for
  // everyone else it is empty BY DESIGN — and the Stats tab read zeros
  // forever, which looks broken rather than gated. usage_events is written
  // for every request and holds no content, so it can back the whole tab.
  // `audioSeconds > 0` is the voice/typing discriminator; targetApp is the
  // one thing it can't provide, so the "where you write" breakdown stays
  // history-only.
  if (!rows.length) {
    const events = await usageEventsSince(user, sinceIso);
    rows = events.map((e) => ({
      createdAt: e.createdAt,
      wordsOut: e.words,
      audioSeconds: e.audioSeconds,
      kind: e.audioSeconds > 0 ? "voice" : "typing",
    }));
  }

  // All day/hour bucketing runs in the CALLER'S local time: shift every
  // timestamp by their UTC offset, then bucket on UTC fields of the shifted
  // value. Clamp the offset to the real-world range so a bogus client value
  // can't fling buckets days away.
  const tz = Math.max(-14 * 60, Math.min(14 * 60, Math.round(tzOffsetMinutes || 0))) * 60_000;
  const localMidnight = (ms: number) => utcMidnightMs(ms + tz);

  let requests = 0;
  let wordsOut = 0;
  let audioSeconds = 0;
  const spark = new Array<number>(days).fill(0);
  const wordsPerDay = new Array<number>(days).fill(0);
  const kindWords = { voice: 0, typing: 0, draft: 0 };
  const daypartSessions = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const appWords = new Map<string, number>();
  const todayMidnight = localMidnight(Date.now());

  for (const r of rows) {
    requests += 1;
    const words = r.wordsOut ?? 0;
    wordsOut += words;
    audioSeconds += r.audioSeconds ?? 0;
    if (r.kind === "voice") kindWords.voice += words;
    else if (r.kind === "draft") kindWords.draft += words;
    else kindWords.typing += words;
    if (r.targetApp) appWords.set(r.targetApp, (appWords.get(r.targetApp) ?? 0) + words);

    const created = Date.parse(r.createdAt);
    if (!Number.isFinite(created)) continue;
    const dayOffset = Math.floor((todayMidnight - localMidnight(created)) / MS_PER_DAY);
    // Newest bucket is the last element in the array.
    const idx = days - 1 - dayOffset;
    if (idx >= 0 && idx < days) {
      spark[idx]! += 1;
      wordsPerDay[idx]! += words;
    }
    const hour = new Date(created + tz).getUTCHours();
    if (hour >= 5 && hour < 12) daypartSessions.morning += 1;
    else if (hour >= 12 && hour < 17) daypartSessions.afternoon += 1;
    else if (hour >= 17 && hour < 22) daypartSessions.evening += 1;
    else daypartSessions.night += 1;
  }

  // Streaks over the day buckets. The current streak may start at today OR
  // yesterday — a day that isn't over yet must not read as a broken streak.
  let daysActive = 0;
  let bestStreak = 0;
  let run = 0;
  for (let i = 0; i < days; i++) {
    if (spark[i]! > 0) { daysActive += 1; run += 1; bestStreak = Math.max(bestStreak, run); }
    else run = 0;
  }
  let currentStreak = 0;
  for (let i = days - 1 - (spark[days - 1]! > 0 ? 0 : 1); i >= 0 && spark[i]! > 0; i--) {
    currentStreak += 1;
  }

  // Best single day, dated in the caller's local calendar.
  let bestDay: StatsForUser["bestDay"];
  let bestIdx = -1;
  for (let i = 0; i < days; i++) {
    if (wordsPerDay[i]! > (bestIdx >= 0 ? wordsPerDay[bestIdx]! : 0)) bestIdx = i;
  }
  if (bestIdx >= 0 && wordsPerDay[bestIdx]! > 0) {
    const d = new Date(todayMidnight - (days - 1 - bestIdx) * MS_PER_DAY);
    bestDay = {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      words: wordsPerDay[bestIdx]!,
    };
  }

  // Top apps by words — five named slices; the tail folds into "Other".
  const ranked = [...appWords.entries()].sort((a, b) => b[1] - a[1]);
  const topApps = ranked.slice(0, 5).map(([app, words]) => ({ app, words }));
  const tail = ranked.slice(5).reduce((s, [, w]) => s + w, 0);
  if (tail > 0) topApps.push({ app: "Other", words: tail });

  return {
    window,
    requests,
    wordsOut,
    audioSeconds,
    minutesSaved: minutesSavedFor(wordsOut),
    sparklinePerDay: spark,
    wordsPerDay,
    daysActive,
    currentStreak,
    bestStreak,
    kindWords,
    daypartSessions,
    topApps: topApps.length ? topApps : undefined,
    bestDay,
    avgWordsPerSession: requests > 0 ? Math.round(wordsOut / requests) : 0,
    speakingMinutes: Math.round((audioSeconds / 60) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC midnight of the calendar day containing `ms`. */
function utcMidnightMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function minutesSavedFor(wordsOut: number): number {
  if (wordsOut <= 0) return 0;
  // Rounded to the nearest tenth so the number looks precise but doesn't
  // pretend to be more accurate than the WPM heuristic behind it.
  return Math.round((wordsOut / TYPING_WORDS_PER_MINUTE) * 10) / 10;
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

/**
 * Compound (created_at, id) < (before, beforeId) cursor comparison used by the
 * in-memory path. A row is "older than" the cursor when its timestamp is
 * smaller, or it shares the timestamp but has a smaller id. With no cursor,
 * every row qualifies. `beforeId` may be absent (legacy timestamp-only cursor).
 */
function beforeCursorOk(
  createdAt: string,
  id: string,
  before: string | undefined,
  beforeId: string | undefined,
): boolean {
  if (!before) return true;
  if (createdAt < before) return true;
  if (beforeId != null && createdAt === before && id < beforeId) return true;
  return false;
}

function stripAudio(r: StoredRow): HistoryEntry {
  const { audioSeconds: _audioSeconds, deletedAt: _deletedAt, ...rest } = r;
  return rest;
}

function windowSinceMs(window: "week" | "month" | "all"): number | null {
  if (window === "week") return 7 * MS_PER_DAY;
  if (window === "month") return 30 * MS_PER_DAY;
  return null;
}

function windowDayCount(window: "week" | "month" | "all"): number {
  if (window === "week") return 7;
  if (window === "month") return 30;
  // For "all" we still cap the sparkline at 30 days so the array shape stays
  // renderable; the totals still cover everything.
  return 30;
}

interface StatRow {
  createdAt: string;
  wordsOut?: number;
  audioSeconds?: number;
  kind?: string;
  targetApp?: string;
}

async function fetchStatRowsSupabase(
  sb: NonNullable<ReturnType<typeof dataClientFor>>,
  userId: string,
  sinceIso: string | undefined,
): Promise<StatRow[]> {
  let q = sb
    .from("cleanup_history")
    .select("created_at, words_out, duration_ms, kind, target_app")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (sinceIso) q = q.gte("created_at", sinceIso);

  const { data, error } = await q;
  if (error || !data) {
    if (error) console.error(`[history] stats failed for ${userId}:`, error.message);
    return [];
  }
  return (data as Array<{
    created_at?: string;
    words_out?: number | null;
    duration_ms?: number | null;
    kind?: string;
    target_app?: string | null;
  }>).map((r) => ({
    createdAt: r.created_at ?? new Date(0).toISOString(),
    wordsOut: r.words_out ?? 0,
    // We don't have per-row audio seconds in the DB; approximate voice rows
    // by their duration_ms (best-effort — this feeds a UI number, not billing).
    audioSeconds: r.kind === "voice" && r.duration_ms ? r.duration_ms / 1000 : 0,
    kind: r.kind,
    targetApp: r.target_app ?? undefined,
  }));
}

function fetchStatRowsMemory(userId: string, sinceIso: string | undefined): StatRow[] {
  const rows = memoryRows(userId).filter((r) => !r.deletedAt);
  return rows
    .filter((r) => !sinceIso || r.createdAt >= sinceIso)
    .map((r) => ({
      createdAt: r.createdAt,
      wordsOut: r.wordsOut ?? 0,
      audioSeconds: r.audioSeconds ?? 0,
      kind: r.kind,
      targetApp: r.targetApp,
    }));
}

function rowToEntry(r: Record<string, unknown>): HistoryEntry {
  return {
    id: String(r.id),
    kind: r.kind as HistoryEntry["kind"],
    targetApp: (r.target_app as TargetAppHint | null) ?? undefined,
    language: (r.language as LanguageHint | null) ?? undefined,
    input: (r.input as string) ?? "",
    output: (r.output as string) ?? "",
    durationMs: (r.duration_ms as number | null) ?? undefined,
    wordsIn: (r.words_in as number | null) ?? undefined,
    wordsOut: (r.words_out as number | null) ?? undefined,
    createdAt: (r.created_at as string) ?? new Date(0).toISOString(),
  };
}
