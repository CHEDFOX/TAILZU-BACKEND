/**
 * THE TO-DOS DELETED HERE THAT THE X0 BOT LIST STILL HOLDS (migration 0094; docs: perms2 §3.2).
 *
 *   remindersGone().mark(userId, extRef)    a linked to-do was deleted in X0: its item is to go at the next sync
 *   remindersGone().list(userId)            the items waiting to go, for the merge
 *   remindersGone().forget(userId, refs)    they have gone (or their item has): the marks go
 *   remindersGone().clear(userId)           the switch going off, Delete my data, the account
 *
 * WHY THIS EXISTS. "A to-do deleted in X0 removes its item" needs a memory of the deletion: once the row is gone there is
 * nothing left to say the item ever had one, and the merge would read the item as a new to-do and copy it straight back in.
 * The first design asked the PHONE to remember which items it had made (`RemItem.mine`), which the phone never sends, so
 * the memory is kept here instead, where the deletion happens.
 *
 * WHAT IS IN A MARK. The person's id and the item's own opaque identifier, and nothing else: no title, no due date, no list.
 * A mark is dropped the moment the item is gone from the list, and the sweeper drops any left over after a week, for a
 * person who switched the row off between the deletion and the next sync.
 *
 * Supabase with the service key when the server has one, else memory (tests, and a server with none), as `planBusy.ts` does.
 * The table is RLS-on with no policy, so no client ever reads a row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** A mark left over this long is dropped: the row was switched off, or the phone never came back. */
export const GONE_KEEP_MS = 7 * 24 * 3600_000;
/** The most marks one person's merge reads, the same number as the sync's own items. */
export const GONE_MAX = 300;

export interface RemindersGoneStore {
  mark(userId: string, extRef: string, now?: number): Promise<void>;
  list(userId: string): Promise<string[]>;
  forget(userId: string, refs: readonly string[]): Promise<number>;
  clear(userId: string): Promise<number>;
  /** Every mark older than GONE_KEEP_MS, across everyone. How many went. */
  sweep(now: number): Promise<number>;
}

// ------------------------------------------------------------------ memory

class MemoryRemindersGone implements RemindersGoneStore {
  readonly rows: Array<{ userId: string; ref: string; at: number }> = [];

  async mark(userId: string, extRef: string, now = Date.now()): Promise<void> {
    if (!extRef) return;
    const had = this.rows.find((r) => r.userId === userId && r.ref === extRef);
    if (had) { had.at = now; return; }
    this.rows.push({ userId, ref: extRef, at: now });
  }

  async list(userId: string): Promise<string[]> {
    return this.rows.filter((r) => r.userId === userId).slice(0, GONE_MAX).map((r) => r.ref);
  }

  async forget(userId: string, refs: readonly string[]): Promise<number> {
    const drop = new Set(refs);
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.userId === userId && drop.has(r.ref)) this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }

  async clear(userId: string): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i]!.userId === userId) this.rows.splice(i, 1);
    return before - this.rows.length;
  }

  async sweep(now: number): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i]!.at <= now - GONE_KEEP_MS) this.rows.splice(i, 1);
    return before - this.rows.length;
  }
}

// ------------------------------------------------------------------ Supabase

const T = "reminders_gone";
const iso = (ms: number) => new Date(ms).toISOString();

class SupabaseRemindersGone implements RemindersGoneStore {
  constructor(private readonly sb: SupabaseClient) {}

  async mark(userId: string, extRef: string, now = Date.now()): Promise<void> {
    if (!extRef) return;
    const { error } = await this.sb.from(T).upsert({ user_id: userId, ext_ref: extRef, at: iso(now) }, { onConflict: "user_id,ext_ref" });
    if (error) throw new Error(`reminders gone: write: ${error.message}`);
  }

  async list(userId: string): Promise<string[]> {
    const { data, error } = await this.sb.from(T).select("ext_ref").eq("user_id", userId).limit(GONE_MAX);
    if (error) throw new Error(`reminders gone: read: ${error.message}`);
    return (data ?? []).map((r) => String((r as { ext_ref: unknown }).ext_ref ?? "")).filter(Boolean);
  }

  async forget(userId: string, refs: readonly string[]): Promise<number> {
    if (!refs.length) return 0;
    const { error, count } = await this.sb.from(T).delete({ count: "exact" }).eq("user_id", userId).in("ext_ref", [...refs]);
    if (error) throw new Error(`reminders gone: delete: ${error.message}`);
    return count ?? 0;
  }

  async clear(userId: string): Promise<number> {
    const { error, count } = await this.sb.from(T).delete({ count: "exact" }).eq("user_id", userId);
    if (error) throw new Error(`reminders gone: delete: ${error.message}`);
    return count ?? 0;
  }

  async sweep(now: number): Promise<number> {
    const { error, count } = await this.sb.from(T).delete({ count: "exact" }).lte("at", iso(now - GONE_KEEP_MS));
    if (error) throw new Error(`reminders gone: sweep: ${error.message}`);
    return count ?? 0;
  }
}

let made: RemindersGoneStore | undefined;

/** The store: Supabase with the service key, else memory. */
export function remindersGone(): RemindersGoneStore {
  if (!made) {
    const sb = supabase();
    made = sb ? new SupabaseRemindersGone(sb) : new MemoryRemindersGone();
  }
  return made;
}

/** Tests: a fresh store. */
export function resetRemindersGoneForTests(store?: RemindersGoneStore): void { made = store ?? new MemoryRemindersGone(); }

// ------------------------------------------------------------------ the sweeper

const SWEEP_EVERY_MS = 6 * 3600_000;

/** One pass: every mark older than a week, across everyone. */
export async function sweepRemindersGone(now: number, store: RemindersGoneStore = remindersGone()): Promise<number> {
  return store.sweep(now);
}

/**
 * A pass at once, then one every `everyMs`, never two at the same time. Returns the way to stop. Copies
 * `botsBots/planBusy.ts startBusySweeper`: a mark whose sync never came back (the row was switched off between the deletion
 * and the next sync) is not kept for ever.
 */
export function startRemindersGoneSweeper(o: {
  store?: RemindersGoneStore;
  everyMs?: number;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
} = {}): () => void {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const gone = await sweepRemindersGone((o.now ?? Date.now)(), o.store ?? remindersGone());
      if (gone) o.log?.info({ marks: gone }, "reminders: deletion marks past their week dropped");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.name }, "reminders: deletion mark sweep failed");
    } finally {
      busy = false;
    }
  };
  void run();
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  every.unref?.();
  return () => clearInterval(every);
}
