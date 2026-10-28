/**
 * AN ASK TYPED OFFLINE GOES OUT ONCE (routes/botsShell.ts POST /v1/shell/ask, docs/bots-app.md "Offline").
 *
 * The apps keep the asks a person types while offline in an outbox on the device, each with a client id made when it was typed, and send
 * them in order when the connection is back. A send can reach the server and its answer still be lost (the connection drops again), so the
 * same ask can arrive twice, minutes apart, from a retry. This is what makes the second one the first one's answer, never a second ask:
 *
 *   claim    the first send of a client id takes it ("new") and runs the ask. A send that finds it taken is told what happened: "sent" (with
 *            the answer it got, so the app shows the same thing) or "sending" (another send of it is out right now: the app waits and asks
 *            again). A claim older than STALE_MS that never finished (the server stopped mid-way) can be taken again.
 *   done     the ask was answered: the answer is kept with the id, for the retries.
 *   release  the ask was refused or failed: the id is let go, so trying again does try again.
 *
 * Kept for KEEP_DAYS, then dropped the next time the person sends one. Migration 0047 (bots_app_sent_asks), with a memory twin for tests and
 * a server with no Supabase (a restart then forgets, which only the in-process guard covers). Written with the service key; no token reads it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

export const KEEP_DAYS = 30;
/** A claim that has not finished in this long is taken to be abandoned (an ask answers well within it). */
export const STALE_MS = 10 * 60_000;
/** A client id: what the apps make when the ask is typed (a UUID, or any 8 to 64 letters, digits, `-` and `_`). */
export const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** The answer kept for a retry, at most. A bigger one keeps only its `shell` part. */
const REPLY_MAX = 32 * 1024;

export type Claim = { state: "new" } | { state: "sending" } | { state: "sent"; reply: unknown };

export interface SentAskStore {
  claim(userId: string, clientId: string, now: number, typedAt?: number): Promise<Claim>;
  done(userId: string, clientId: string, reply: unknown, now: number): Promise<void>;
  release(userId: string, clientId: string): Promise<void>;
}

/** What is kept of an answer: all of it while it is small, else the part the apps draw. */
export function keptReply(reply: unknown): unknown {
  try {
    if (JSON.stringify(reply).length <= REPLY_MAX) return reply;
  } catch { /* not JSON: keep the part below */ }
  const shell = (reply as { shell?: unknown } | null)?.shell;
  return shell && typeof shell === "object" ? { shell } : {};
}

interface Row { state: "sending" | "sent"; claimedAt: number; reply: unknown }

export class MemorySentAskStore implements SentAskStore {
  private rows = new Map<string, Row>();
  private key = (u: string, c: string) => `${u}\u0000${c}`;
  async claim(userId: string, clientId: string, now: number) {
    const k = this.key(userId, clientId);
    const r = this.rows.get(k);
    if (r?.state === "sent") return { state: "sent" as const, reply: r.reply };
    if (r && now - r.claimedAt < STALE_MS) return { state: "sending" as const };
    this.rows.set(k, { state: "sending", claimedAt: now, reply: null });
    return { state: "new" as const };
  }
  async done(userId: string, clientId: string, reply: unknown, now: number) {
    this.rows.set(this.key(userId, clientId), { state: "sent", claimedAt: now, reply: keptReply(reply) });
    for (const [k, r] of this.rows) if (k.startsWith(`${userId}\u0000`) && now - r.claimedAt > KEEP_DAYS * 86_400_000) this.rows.delete(k);
  }
  async release(userId: string, clientId: string) {
    const k = this.key(userId, clientId);
    if (this.rows.get(k)?.state === "sending") this.rows.delete(k);
  }
}

const TABLE = "bots_app_sent_asks";
interface DbRow { state: "sending" | "sent"; claimed_at: string; reply: unknown }

export class SupabaseSentAskStore implements SentAskStore {
  constructor(private readonly sb: SupabaseClient) {}

  claim(userId: string, clientId: string, now: number, typedAt?: number): Promise<Claim> {
    return this.take(userId, clientId, now, typedAt, true);
  }

  private async take(userId: string, clientId: string, now: number, typedAt: number | undefined, again: boolean): Promise<Claim> {
    const at = new Date(now).toISOString();
    const { error } = await this.sb.from(TABLE).insert({
      user_id: userId, client_id: clientId, state: "sending", claimed_at: at, ...(typedAt ? { typed_at: new Date(typedAt).toISOString() } : {}),
    });
    if (!error) return { state: "new" };
    if (error.code !== "23505") throw new Error(`${TABLE}: claim failed: ${error.message}`);
    // Someone has it: the answer it got, or a send still out (or one that stopped and can be taken again).
    const { data, error: readError } = await this.sb.from(TABLE).select("state, claimed_at, reply").eq("user_id", userId).eq("client_id", clientId).maybeSingle<DbRow>();
    if (readError) throw new Error(`${TABLE}: read failed: ${readError.message}`);
    if (!data) return again ? this.take(userId, clientId, now, typedAt, false) : { state: "sending" };   // let go between the two: take it
    if (data.state === "sent") return { state: "sent", reply: data.reply };
    if (now - Date.parse(data.claimed_at) < STALE_MS) return { state: "sending" };
    // Abandoned: taken again only by whoever moves its time first, so two retries at once do not both run it.
    const { data: took, error: takeError } = await this.sb.from(TABLE).update({ claimed_at: at })
      .eq("user_id", userId).eq("client_id", clientId).eq("state", "sending").eq("claimed_at", data.claimed_at).select("client_id");
    if (takeError) throw new Error(`${TABLE}: claim failed: ${takeError.message}`);
    return (took ?? []).length ? { state: "new" } : { state: "sending" };
  }

  async done(userId: string, clientId: string, reply: unknown, now: number) {
    const { error } = await this.sb.from(TABLE).update({ state: "sent", reply: keptReply(reply), claimed_at: new Date(now).toISOString() })
      .eq("user_id", userId).eq("client_id", clientId);
    if (error) throw new Error(`${TABLE}: done failed: ${error.message}`);
    void this.sb.from(TABLE).delete().eq("user_id", userId).lt("claimed_at", new Date(now - KEEP_DAYS * 86_400_000).toISOString()).then(() => undefined, () => undefined);
  }

  async release(userId: string, clientId: string) {
    const { error } = await this.sb.from(TABLE).delete().eq("user_id", userId).eq("client_id", clientId).eq("state", "sending");
    if (error) throw new Error(`${TABLE}: release failed: ${error.message}`);
  }
}

let current: SentAskStore | null = null;

/** Supabase when the server has it, else memory. */
export function sentAskStore(): SentAskStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseSentAskStore(sb) : new MemorySentAskStore();
  }
  return current;
}

export function resetSentAskStoreForTests(): void { current = null; }
