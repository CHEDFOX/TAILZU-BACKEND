/**
 * DELETE ACCOUNT, WITH SEVEN DAYS TO CHANGE YOUR MIND (the Bots app's Delete account, bots.delete-account; migration 0045).
 *
 * Asking to delete does not delete: it sets a date GRACE_DAYS out (account_deletions), signs the person out everywhere and stops
 * their pings (push tokens go; a sign-in brings them back). Until that date everything is kept as it was, but their bots are stopped
 * (isLeaving, below); signing in shows "Your account will be deleted on 4 Nov" with Keep my account, which takes the date away and
 * starts them again. On the date a sweep does the real delete,
 * the same one DELETE /v1/account always did (server.ts eraseAccount), and the row goes with the account.
 *
 * The sweep is safe with more than one server: a due row is claimed (claimed_at) before it is worked on, and a claim older than
 * CLAIM_STALE_MS is taken again, so a server that died mid-way, or a delete that did not finish, is tried again later. Nothing
 * here is ever logged with a token or a person's words: ids and counts only.
 *
 * Supabase with the service key when the server has one, else memory (tests; a server with no Supabase cannot delete anyone
 * either, so the routes answer 503 and nothing is scheduled).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** How long a person has to change their mind. */
export const GRACE_DAYS = 7;
export const GRACE_MS = GRACE_DAYS * 86_400_000;
/** The route the Bots app's Delete account and Home read and write. */
export const DELETION_PATH = "/v1/account/deletion";

/** A claim older than this is someone else's that never finished: taken again. */
export const CLAIM_STALE_MS = 30 * 60_000;
/** How often the sweep looks, and how many it deletes in one pass. */
export const SWEEP_EVERY_MS = 10 * 60_000;
const SWEEP_FIRST_MS = 60_000;
const SWEEP_BATCH = 20;

export interface Scheduled {
  /** When they asked (ms). */
  requestedAt: number;
  /** When it is deleted for good (ms). */
  deleteAt: number;
}

export interface DeletionStore {
  get(userId: string): Promise<Scheduled | null>;
  /** Sets the date; one already set is kept as it was (asking twice does not move it). */
  schedule(userId: string, now: number, deleteAt: number): Promise<Scheduled>;
  /** Takes the date away. Whether there was one. */
  cancel(userId: string): Promise<boolean>;
  /** Rows due by `now` that nobody is working on (or whose claim went stale), claimed for this caller: their user ids. */
  claimDue(now: number, limit: number, staleMs: number): Promise<string[]>;
  /** A delete that did not finish: noted; the claim stays, so it is tried again once stale. */
  failed(userId: string, why: string): Promise<void>;
}

// -------------------------------------------------------------------- memory

export class MemoryDeletionStore implements DeletionStore {
  private readonly rows = new Map<string, Scheduled & { claimedAt: number | null; lastError: string | null }>();
  async get(userId: string) {
    const r = this.rows.get(userId);
    return r ? { requestedAt: r.requestedAt, deleteAt: r.deleteAt } : null;
  }
  async schedule(userId: string, now: number, deleteAt: number) {
    const had = this.rows.get(userId);
    if (had) return { requestedAt: had.requestedAt, deleteAt: had.deleteAt };
    this.rows.set(userId, { requestedAt: now, deleteAt, claimedAt: null, lastError: null });
    return { requestedAt: now, deleteAt };
  }
  async cancel(userId: string) { return this.rows.delete(userId); }
  async claimDue(now: number, limit: number, staleMs: number) {
    const out: string[] = [];
    for (const [id, r] of [...this.rows].sort((a, b) => a[1].deleteAt - b[1].deleteAt)) {
      if (out.length >= limit) break;
      if (r.deleteAt > now || (r.claimedAt !== null && now - r.claimedAt < staleMs)) continue;
      r.claimedAt = now;
      out.push(id);
    }
    return out;
  }
  async failed(userId: string, why: string) {
    const r = this.rows.get(userId);
    if (r) r.lastError = why.slice(0, 200);
  }
  /** Tests: the account went (the cascade a real delete does). */
  drop(userId: string) { this.rows.delete(userId); }
}

// -------------------------------------------------------------------- supabase

const T = "account_deletions";
interface Row { user_id: string; requested_at: string; delete_at: string }
const of = (r: Row): Scheduled => ({ requestedAt: Date.parse(r.requested_at), deleteAt: Date.parse(r.delete_at) });
const iso = (t: number) => new Date(t).toISOString();
/** No claim, or one gone stale (the value quoted: an ISO time has dots and colons). */
const unclaimed = (staleIso: string) => `claimed_at.is.null,claimed_at.lt."${staleIso}"`;

export class SupabaseDeletionStore implements DeletionStore {
  constructor(private readonly sb: SupabaseClient) {}
  async get(userId: string) {
    const { data, error } = await this.sb.from(T).select("user_id, requested_at, delete_at").eq("user_id", userId).maybeSingle<Row>();
    if (error) throw new Error(`${T}: read failed: ${error.message}`);
    return data ? of(data) : null;
  }
  async schedule(userId: string, now: number, deleteAt: number) {
    // Insert only when there is none: a second ask keeps the first date.
    const { error } = await this.sb.from(T).upsert({ user_id: userId, requested_at: iso(now), delete_at: iso(deleteAt) }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw new Error(`${T}: write failed: ${error.message}`);
    const got = await this.get(userId);
    if (!got) throw new Error(`${T}: write failed: no row`);
    return got;
  }
  async cancel(userId: string) {
    const { data, error } = await this.sb.from(T).delete().eq("user_id", userId).select("user_id");
    if (error) throw new Error(`${T}: delete failed: ${error.message}`);
    return (data ?? []).length > 0;
  }
  async claimDue(now: number, limit: number, staleMs: number) {
    const nowIso = iso(now), staleIso = iso(now - staleMs);
    const { data, error } = await this.sb.from(T).select("user_id").lte("delete_at", nowIso).or(unclaimed(staleIso))
      .order("delete_at", { ascending: true }).limit(limit).returns<Array<{ user_id: string }>>();
    if (error) throw new Error(`${T}: read failed: ${error.message}`);
    const out: string[] = [];
    for (const r of data ?? []) {
      // The same condition again on the write: of two servers, only one gets the row back.
      const { data: got, error: e } = await this.sb.from(T).update({ claimed_at: nowIso }).eq("user_id", r.user_id).or(unclaimed(staleIso)).select("user_id");
      if (!e && (got ?? []).length) out.push(r.user_id);
    }
    return out;
  }
  async failed(userId: string, why: string) {
    await this.sb.from(T).update({ last_error: why.slice(0, 200) }).eq("user_id", userId);
  }
}

let current: DeletionStore | null = null;

/** Supabase when the server has it, else memory. */
export function deletionStore(): DeletionStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseDeletionStore(sb) : new MemoryDeletionStore();
  }
  return current;
}

export function resetDeletionStoreForTests(): void { current = null; }

// -------------------------------------------------------------------- while the date stands, the bots stop

/**
 * Whether a person asked to delete their account and the date still stands. Their bots stop right away (the DeleteAcct board): a
 * Code bot job or a bot's answer does not start (bots/service.ts, code/jobs/router.ts createJob, routes/front.ts), their bots' API
 * keys do not work, and the jobs that were running are stopped (routes/accountDeletion.ts). Keep my account takes the date away,
 * and everything works again.
 *
 * Every bot run asks, so the answer is kept for LEAVING_TTL_MS; asking and Keep my account on this server forget it at once
 * (`forgetLeaving`). A read that fails is "no": a store that is down must not stop everyone's bots.
 */
export const LEAVING_TTL_MS = 15_000;
const LEAVING_KEEP = 10_000;
const leavingSeen = new WeakMap<DeletionStore, Map<string, { leaving: boolean; at: number }>>();

export async function isLeaving(userId: string, o: { store?: DeletionStore; now?: number } = {}): Promise<boolean> {
  if (!userId) return false;
  const store = o.store ?? deletionStore();
  const now = o.now ?? Date.now();
  let seen = leavingSeen.get(store);
  if (!seen) { seen = new Map(); leavingSeen.set(store, seen); }
  const had = seen.get(userId);
  if (had && now - had.at < LEAVING_TTL_MS) return had.leaving;
  const leaving = await store.get(userId).then((s) => s !== null, () => false);
  if (seen.size >= LEAVING_KEEP) seen.clear();
  seen.set(userId, { leaving, at: now });
  return leaving;
}

/** The date was set or taken away on this server: the next check reads it again. */
export function forgetLeaving(userId: string, store?: DeletionStore): void {
  leavingSeen.get(store ?? deletionStore())?.delete(userId);
}

/** What the person is told when something of theirs does not start while the date stands. */
export const LEAVING_MESSAGE = "Your bots are stopped while your account waits to be deleted. Keep your account to start them again.";
/** The same, where others may read it (a job's reason, which PR care can write on a pull request): nothing about the account. */
export const STOPPED_MESSAGE = "Your bots are stopped for now.";

// -------------------------------------------------------------------- the sweep

/** The real delete (server.ts eraseAccount): true only when the account itself is gone. */
export type Erase = (userId: string) => Promise<boolean>;

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/**
 * One pass: every due row, one at a time. A row is looked at once more just before the delete, so a person who pressed Keep my
 * account while this pass was starting is not deleted. Returns how many accounts went and how many did not finish.
 */
export async function sweepDeletions(o: { store: DeletionStore; erase: Erase; now: number; log?: Log; limit?: number }): Promise<{ deleted: number; failed: number }> {
  const ids = await o.store.claimDue(o.now, o.limit ?? SWEEP_BATCH, CLAIM_STALE_MS);
  let deleted = 0, failed = 0;
  for (const id of ids) {
    const still = await o.store.get(id).catch(() => null);
    if (!still || still.deleteAt > o.now) continue;
    let ok = false;
    try { ok = await o.erase(id); } catch (err) { o.log?.warn({ error: (err as Error)?.name }, "account deletion: erase threw"); }
    if (ok) { deleted++; continue; }
    failed++;
    await o.store.failed(id, "the account was not deleted").catch(() => undefined);
  }
  if (deleted || failed) o.log?.info({ deleted, failed }, "account deletion sweep");
  return { deleted, failed };
}

/** The sweep: a pass a minute after start, then every SWEEP_EVERY_MS, never two at once, never in a request's way. Returns the stop. */
export function startDeletionSweep(o: { store: DeletionStore; erase: Erase; everyMs?: number; firstMs?: number; now?: () => number; log?: Log }): () => void {
  const now = o.now ?? Date.now;
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      await sweepDeletions({ store: o.store, erase: o.erase, now: now(), ...(o.log ? { log: o.log } : {}) });
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.message }, "account deletion sweep failed");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(pass, o.firstMs ?? SWEEP_FIRST_MS);
  const every = setInterval(pass, o.everyMs ?? SWEEP_EVERY_MS);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
