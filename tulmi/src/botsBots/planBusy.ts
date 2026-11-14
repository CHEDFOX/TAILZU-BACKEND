/**
 * THE BUSY TIMES READ FROM THE PHONE'S OWN CALENDARS (migration 0094; docs: perms2 §2).
 *
 *   planBusy().replace(userId, from, to, blocks)   the window's blocks again, whole: the old ones for that window go first
 *   planBusy().inRange(userId, fromMs, toMs)       the blocks that touch a range, soonest first (the Plan's own read)
 *   planBusy().clear(userId)                       every block of one person: the switch going off, Delete my data, the account
 *   planBusy().sweep(now)                          every block whose end went more than a day ago, across everyone
 *
 * WHAT IS IN A BLOCK, AND WHAT NEVER IS. Start, end and all-day. Not a title, a place, a note, who is invited, which calendar
 * it came from, or whether it is work or home: the phone's Swift reads the events and hands JavaScript `{s, e, allDay}` only,
 * so nothing else exists to store. The blocks are used by deterministic server code alone — the day's clash lines and whether a
 * Plan Ease call rings — and `tests/perms2.test.ts` keeps this file off every path that reaches an AI service.
 *
 * Supabase with the service key when the server has one, else memory (tests, and a server with none), as `bots/healthDays.ts`
 * does. The table is RLS-on with no policy, so no client ever reads a row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** One busy stretch, in epoch milliseconds. */
export interface BusyBlock { s: number; e: number; allDay: boolean }

/** The most the phone may send in one sync, and the longest window and block the route takes. */
export const BUSY_LIMITS = { blocks: 300, windowDays: 15, blockDays: 2 } as const;
/** A block is deleted this long after it ends, so a window of 14 days is kept 15 at most. */
export const BUSY_KEEP_MS = 24 * 3600_000;
/** A sync older than this is treated as unknown by the Plan: the person may have changed their calendar since. */
export const BUSY_STALE_MS = 24 * 3600_000;

export interface PlanBusyStore {
  replace(userId: string, fromMs: number, toMs: number, blocks: BusyBlock[], now?: number): Promise<number>;
  /** Blocks that overlap [fromMs, toMs), each with when it was synced. */
  inRange(userId: string, fromMs: number, toMs: number): Promise<Array<BusyBlock & { syncedAt: number }>>;
  clear(userId: string): Promise<number>;
  /** Every block that ended more than BUSY_KEEP_MS ago, across everyone. How many went. */
  sweep(now: number): Promise<number>;
}

// ------------------------------------------------------------------ memory

class MemoryPlanBusy implements PlanBusyStore {
  readonly rows: Array<{ userId: string; s: number; e: number; allDay: boolean; syncedAt: number }> = [];

  async replace(userId: string, fromMs: number, toMs: number, blocks: BusyBlock[], now = Date.now()): Promise<number> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.userId === userId && r.s < toMs && r.e > fromMs) this.rows.splice(i, 1);
    }
    for (const b of blocks) this.rows.push({ userId, s: b.s, e: b.e, allDay: b.allDay, syncedAt: now });
    return blocks.length;
  }

  async inRange(userId: string, fromMs: number, toMs: number) {
    return this.rows.filter((r) => r.userId === userId && r.s < toMs && r.e > fromMs)
      .sort((a, b) => a.s - b.s).map((r) => ({ s: r.s, e: r.e, allDay: r.allDay, syncedAt: r.syncedAt }));
  }

  async clear(userId: string): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i]!.userId === userId) this.rows.splice(i, 1);
    return before - this.rows.length;
  }

  async sweep(now: number): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i]!.e <= now - BUSY_KEEP_MS) this.rows.splice(i, 1);
    return before - this.rows.length;
  }
}

// ------------------------------------------------------------------ Supabase

const T = "plan_busy";
const iso = (ms: number) => new Date(ms).toISOString();

class SupabasePlanBusy implements PlanBusyStore {
  constructor(private readonly sb: SupabaseClient) {}

  async replace(userId: string, fromMs: number, toMs: number, blocks: BusyBlock[], now = Date.now()): Promise<number> {
    // The window's old blocks go first, so a sync that drops an event drops its block too.
    const del = await this.sb.from(T).delete().eq("user_id", userId).lt("starts_at", iso(toMs)).gt("ends_at", iso(fromMs));
    if (del.error) throw new Error(`plan busy: delete: ${del.error.message}`);
    if (!blocks.length) return 0;
    const { error } = await this.sb.from(T).insert(blocks.map((b) => ({
      user_id: userId, starts_at: iso(b.s), ends_at: iso(b.e), all_day: b.allDay, synced_at: iso(now),
    })));
    if (error) throw new Error(`plan busy: write: ${error.message}`);
    return blocks.length;
  }

  async inRange(userId: string, fromMs: number, toMs: number) {
    const { data, error } = await this.sb.from(T).select("starts_at, ends_at, all_day, synced_at")
      .eq("user_id", userId).lt("starts_at", iso(toMs)).gt("ends_at", iso(fromMs)).order("starts_at").limit(BUSY_LIMITS.blocks);
    if (error) throw new Error(`plan busy: read: ${error.message}`);
    return (data ?? []).map((r) => {
      const row = r as { starts_at: string; ends_at: string; all_day?: unknown; synced_at?: string };
      return { s: Date.parse(row.starts_at), e: Date.parse(row.ends_at), allDay: row.all_day === true, syncedAt: Date.parse(row.synced_at ?? "") || 0 };
    });
  }

  async clear(userId: string): Promise<number> {
    const { error, count } = await this.sb.from(T).delete({ count: "exact" }).eq("user_id", userId);
    if (error) throw new Error(`plan busy: delete: ${error.message}`);
    return count ?? 0;
  }

  async sweep(now: number): Promise<number> {
    const { error, count } = await this.sb.from(T).delete({ count: "exact" }).lte("ends_at", iso(now - BUSY_KEEP_MS));
    if (error) throw new Error(`plan busy: sweep: ${error.message}`);
    return count ?? 0;
  }
}

let made: PlanBusyStore | undefined;

/** The store: Supabase with the service key, else memory. */
export function planBusy(): PlanBusyStore {
  if (!made) {
    const sb = supabase();
    made = sb ? new SupabasePlanBusy(sb) : new MemoryPlanBusy();
  }
  return made;
}

/** Tests: a fresh store. */
export function resetPlanBusyForTests(store?: PlanBusyStore): void { made = store ?? new MemoryPlanBusy(); }

// ------------------------------------------------------------------ what the phone sent, checked

/** The window and the blocks of one sync, as the route reads them. */
export interface BusyPost { from: number; to: number; blocks: BusyBlock[] }

const bad = (m: string): never => { throw new Error(m); };

/**
 * WHAT THE PHONE SENT, CHECKED (docs: perms2 §2.5). Out of bounds is refused, not trimmed: a window or a block outside what the
 * card promised is a bug on the phone, and quietly storing it would be worse than saying so.
 *
 * `now` is only for the window: `from` may not be before yesterday, and the window is 15 days at most, so last year's calendar
 * cannot be slipped in behind a card that said two weeks.
 */
export function readBusyPost(body: unknown, now = Date.now()): BusyPost {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as { from?: unknown; to?: unknown; blocks?: unknown };
  const from = Number(b.from), to = Number(b.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) bad("from and to are the window the phone read, in milliseconds.");
  if (to <= from) bad("to is after from.");
  if (to - from > BUSY_LIMITS.windowDays * 86_400_000) bad(`the window is ${BUSY_LIMITS.windowDays} days at most.`);
  if (from < now - 2 * 86_400_000) bad("the window starts no earlier than yesterday.");
  if (!Array.isArray(b.blocks)) bad("blocks is the list of busy times.");
  const list = b.blocks as unknown[];
  if (list.length > BUSY_LIMITS.blocks) bad(`blocks is ${BUSY_LIMITS.blocks} at most.`);
  const blocks: BusyBlock[] = [];
  for (const raw of list) {
    const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as { s?: unknown; e?: unknown; allDay?: unknown };
    const s = Number(o.s), e = Number(o.e);
    if (!Number.isFinite(s) || !Number.isFinite(e)) bad("each block has s and e, in milliseconds.");
    if (e <= s) bad("each block ends after it starts.");
    if (e - s > BUSY_LIMITS.blockDays * 86_400_000) bad(`a block is ${BUSY_LIMITS.blockDays} days long at most.`);
    if (s < from || e > to) bad("each block is inside the window.");
    blocks.push({ s: Math.round(s), e: Math.round(e), allDay: o.allDay === true });
  }
  return { from: Math.round(from), to: Math.round(to), blocks };
}

// ------------------------------------------------------------------ what the Plan does with them

/** Does `[s, e)` overlap any block? Blocks from a sync older than BUSY_STALE_MS are treated as unknown, so nothing is marked. */
export function busyOverlap(blocks: ReadonlyArray<BusyBlock & { syncedAt: number }>, s: number, e: number, now: number): boolean {
  return blocks.some((b) => now - b.syncedAt <= BUSY_STALE_MS && b.s < e && b.e > s);
}

// ------------------------------------------------------------------ the sweeper

const SWEEP_EVERY_MS = 6 * 3600_000;

/** One pass: every block whose end went more than a day ago, across everyone. */
export async function sweepPlanBusy(now: number, store: PlanBusyStore = planBusy()): Promise<number> {
  return store.sweep(now);
}

/**
 * A pass at once, then one every `everyMs`, never two at the same time. Returns the way to stop. Copies
 * `bots/healthDays.ts startHealthSweeper`: the card promises a block goes a day after it ends, so something keeps that promise
 * whether or not anyone opens the app.
 */
export function startBusySweeper(o: {
  store?: PlanBusyStore;
  everyMs?: number;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
} = {}): () => void {
  let busyNow = false;
  const run = async () => {
    if (busyNow) return;
    busyNow = true;
    try {
      const gone = await sweepPlanBusy((o.now ?? Date.now)(), o.store ?? planBusy());
      if (gone) o.log?.info({ blocks: gone }, "busy times past their day deleted");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.name }, "busy time sweep failed");
    } finally {
      busyNow = false;
    }
  };
  void run();
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  every.unref?.();
  return () => clearInterval(every);
}
