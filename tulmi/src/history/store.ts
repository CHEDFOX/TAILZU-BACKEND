// CALLERS: /v1/transcribe-clean, /v1/refine, /v1/draft, and the /v1/stream WS
// handler should call appendHistoryEntry() on success. Wiring lives in
// the writing routes (src/routes).
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
import type { HistoryEntry, TargetAppHint, LanguageHint, Personality } from "../../../shared/types/api.js";
import { type AuthedUser, dataClientFor } from "../auth/supabase.js";
import { TOPIC } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { joinWithSpace } from "../pipeline/join.js";

/** How many history rows a list response returns by default. */
const DEFAULT_LIMIT = 50;
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
  /** Register asked for on this request (none/formal/casual/…). */
  tone?: string;
  /** Voice that was active — built-in preset id or a custom one. */
  presetId?: string;
  /**
   * What the field already held, as the request sent it. Never stored: it is
   * only read to tell a stretch that carries on the dictation just written
   * from a new one (see coalesce).
   */
  context?: string;
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

export function memoryRows(userId: string): StoredRow[] {
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
 * How long after a row was last written to a stretch that carries it on still
 * belongs to it. Longer than the coalesce window: a dictation written pause by
 * pause sends its next stretch only once that stretch has been said, which
 * can be a minute or more of talking. The evidence is strong (the field ends
 * with exactly what the row holds), so the window can be generous.
 */
function continueWindowMs(): number {
  const n = Number(process.env.HISTORY_CONTINUE_MS ?? 180_000);
  return Number.isFinite(n) && n >= 0 ? n : 180_000;
}

/** When each row was last appended to, for continueWindowMs. Process-local. */
const touchedAt = new Map<string, number>();
function touch(id: string, at = Date.now()): void {
  touchedAt.set(id, at);
  if (touchedAt.size > 5000) {
    const cutoff = at - continueWindowMs();
    for (const [k, v] of touchedAt) if (v < cutoff) touchedAt.delete(k);
  }
}

/** The last characters of a row's text that a continuing field must end with. */
const SEAM_CHARS = 80;

/**
 * Decide whether `entry` is really a continuation of `prev`, and if so what
 * `prev` should become. Pure, so both storage backends and the tests share
 * exactly one definition of "the same thing".
 *
 *   drop     — an exact repeat (a retried request); keep prev as it is
 *   merge    — a refine of text prev already holds; prev's output becomes the
 *              text the user actually ended up with
 *   continue — the next stretch of the same dictation: the field it was
 *              written into ends with what prev holds. Appended, so one
 *              dictation is one block however many pauses it had.
 *   null     — a new entry
 */
export function coalesce(
  prev: { kind: string; input: string; output: string; createdAt: string; targetApp?: string; touchedAt?: number },
  entry: HistoryInput,
  now = Date.now(),
):
  | { action: "drop" }
  | { action: "merge"; output: string; wordsOut: number }
  | { action: "continue"; input: string; output: string; wordsOut: number }
  | null {
  // ONE DICTATION, ONE BLOCK. The desktop writes a dictation pause by pause,
  // each stretch sent with what the session already wrote as `context`; a
  // phone whose last words land after it has written the rest sends them on
  // their own with the field as `context`. Each was a new card. When the
  // field ends with exactly what the last card holds, in the same app and
  // moments later, this is that dictation going on.
  const field = (entry.context ?? "").trimEnd();
  const held = prev.output.trim();
  const since = now - (prev.touchedAt ?? Date.parse(prev.createdAt));
  const sameApp = !prev.targetApp || !entry.targetApp || prev.targetApp === entry.targetApp;
  if (
    field && held && entry.kind !== "draft" && prev.kind !== "draft" && sameApp &&
    since >= -5000 && since <= continueWindowMs() &&
    field.endsWith(held.slice(-SEAM_CHARS))
  ) {
    const add = entry.output.trim();
    if (!add) return { action: "drop" };
    const output = held + (joinWithSpace(held, add) ? " " : "") + add;
    return {
      action: "continue",
      input: [prev.input.trim(), entry.input.trim()].filter(Boolean).join(" "),
      output,
      wordsOut: countWordsLocal(output),
    };
  }

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
      // version; do the same to the row so it shows what the user has. A
      // replacer, not a string: "$&", "$'" and "$$" in the refined text are
      // what they wrote, not replacement patterns.
      const to = entry.output.trim();
      const output = prev.output.replace(from, () => to);
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
  await withUserLock(user.id, () => appendHistoryEntryLocked(user, entry, audioSeconds));
  // Keylessbord's pages and Activity's words, on the person's other devices (live/writes.ts).
  livePublish(user.id, [TOPIC.keybot, TOPIC.activity]);
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
      const c = coalesce({ ...prev, touchedAt: touchedAt.get(prev.id) }, entry);
      if (c?.action === "drop") return;
      if (c?.action === "merge") {
        prev.output = c.output;
        prev.wordsOut = c.wordsOut;
        return;
      }
      if (c?.action === "continue") {
        prev.input = c.input;
        prev.output = c.output;
        prev.wordsOut = c.wordsOut;
        prev.wordsIn = (prev.wordsIn ?? 0) + (entry.wordsIn ?? 0);
        prev.durationMs = (prev.durationMs ?? 0) + (entry.durationMs ?? 0);
        if (audioSeconds) prev.audioSeconds = (prev.audioSeconds ?? 0) + audioSeconds;
        touch(prev.id);
        return;
      }
    }
    const id = randomUUID();
    touch(id);
    rows.unshift({
      id,
      kind: entry.kind,
      targetApp: entry.targetApp,
      language: entry.language,
      input: entry.input,
      output: entry.output,
      durationMs: entry.durationMs,
      wordsIn: entry.wordsIn,
      wordsOut: entry.wordsOut,
      tone: entry.tone,
      presetId: entry.presetId,
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
    .select("id, kind, input, output, created_at, target_app, words_in, duration_ms")
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
        targetApp: prev.target_app ? String(prev.target_app) : undefined,
        touchedAt: touchedAt.get(String(prev.id)),
      },
      entry,
    );
    if (c?.action === "drop") return;
    if (c?.action === "continue") {
      const { error: upErr } = await sb
        .from("cleanup_history")
        .update({
          input: c.input,
          output: c.output,
          words_out: c.wordsOut,
          words_in: (Number(prev.words_in) || 0) + (entry.wordsIn ?? 0),
          duration_ms: (Number(prev.duration_ms) || 0) + (entry.durationMs ?? 0),
        })
        .eq("id", prev.id)
        .eq("user_id", user.id);
      if (!upErr) { touch(String(prev.id)); return; }
      console.error(`[history] continue failed for ${user.id}, inserting instead:`, upErr.message);
    }
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

  const { data: inserted, error } = await sb.from("cleanup_history").insert({
    user_id: user.id,
    kind: entry.kind,
    target_app: entry.targetApp ?? null,
    language: entry.language ?? null,
    input: entry.input,
    output: entry.output,
    duration_ms: entry.durationMs ?? null,
    words_in: entry.wordsIn ?? null,
    words_out: entry.wordsOut ?? null,
    tone: entry.tone ?? null,
    preset_id: entry.presetId ?? null,
  }).select("id");
  const newId = inserted?.[0]?.id;
  if (newId) touch(String(newId));
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
    .select("id, kind, target_app, language, input, output, duration_ms, words_in, words_out, created_at, tone, preset_id")
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
    tone: (r.tone as string | null) ?? undefined,
    presetId: (r.preset_id as string | null) ?? undefined,
    createdAt: cursorTime(r.created_at),
  };
}

/**
 * A row's timestamp as the list's paging cursor will be handed back.
 *
 * PostgREST writes timestamptz as "…T10:00:00.123456+00:00", and the route
 * validates `before` with z.string().datetime(), which accepts only "Z". So
 * every nextBefore this returned was refused as the next page's cursor. The
 * same instant with "Z" is accepted and keeps its microseconds, which the
 * compound (created_at, id) cursor needs to not skip a row.
 */
function cursorTime(v: unknown): string {
  return typeof v === "string" && v ? v.replace(/\+00(?::?00)?$/, "Z") : new Date(0).toISOString();
}
