/**
 * WHAT THE BOTS APP WRITES DOWN FOR ACTIVITY: an answer a bot gave through Ask, and a payment the person says they made.
 *
 *   ask    which bot answered, what was asked (cut to 200 characters), and what the answer cost in paise: through Ask
 *          (/v1/shell/ask, which Xode's page uses too) or on a bot's own page and chat (routes/botsBots.ts), once each
 *   paid   which bot filled the payment in, what it was for, to whom, how much: the person's own word that they pressed pay
 *          in their UPI app (bots.approve). Tailzu never pays, so this is the receipt of what they did, not proof of a transfer.
 *
 * The other rows of the feed are the records their own parts keep (Xode jobs, connected-app tasks, history); these two had
 * no record anywhere, so the shell keeps them: migration 0040 (bots_app_events), with a memory twin for tests and a server with
 * no Supabase. Written with the service key; a person's own token can read their own rows and write none. A row older than
 * KEEP_DAYS is dropped the next time the person writes one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabase } from "../auth/supabase.js";
import type { FeedEvent } from "./feed.js";

export const KEEP_DAYS = 90;
const TITLE_MAX = 200;

export type NewEvent = Omit<FeedEvent, "id" | "at">;

export interface EventStore {
  add(userId: string, e: NewEvent, now: number): Promise<FeedEvent>;
  /** Newest first, since `since`. */
  list(userId: string, since: number, limit?: number): Promise<FeedEvent[]>;
  get(userId: string, id: string): Promise<FeedEvent | null>;
  /** Whether the person has any row at all. */
  any(userId: string): Promise<boolean>;
}

/** A row as it is kept: its words cut, its numbers whole and not below zero. */
export function cleanEvent(e: NewEvent): NewEvent {
  const one = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
  return {
    kind: e.kind, bot: one(e.bot, 64) || "tailzu", title: one(e.title, TITLE_MAX) || (e.kind === "paid" ? "Payment" : "Ask"),
    paise: Math.max(0, Math.round(e.paise || 0)), amountPaise: Math.max(0, Math.round(e.amountPaise || 0)), payee: one(e.payee, 120),
  };
}

export class MemoryEventStore implements EventStore {
  private rows = new Map<string, FeedEvent[]>();
  async add(userId: string, e: NewEvent, now: number) {
    const row: FeedEvent = { id: randomUUID(), ...cleanEvent(e), at: now };
    const kept = (this.rows.get(userId) ?? []).filter((r) => now - r.at < KEEP_DAYS * 86_400_000);
    this.rows.set(userId, [row, ...kept]);
    return row;
  }
  async list(userId: string, since: number, limit = 100) {
    return (this.rows.get(userId) ?? []).filter((r) => r.at >= since).sort((a, b) => b.at - a.at).slice(0, limit);
  }
  async get(userId: string, id: string) {
    return (this.rows.get(userId) ?? []).find((r) => r.id === id) ?? null;
  }
  async any(userId: string) {
    return (this.rows.get(userId)?.length ?? 0) > 0;
  }
}

interface Row { id: string; kind: "ask" | "paid"; bot: string; title: string; paise: number; amount_paise: number | string; payee: string; created_at: string }
const COLUMNS = "id, kind, bot, title, paise, amount_paise, payee, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const of = (r: Row): FeedEvent => ({
  id: r.id, kind: r.kind, bot: r.bot, title: r.title, paise: r.paise, amountPaise: Number(r.amount_paise), payee: r.payee, at: Date.parse(r.created_at),
});

export class SupabaseEventStore implements EventStore {
  constructor(private readonly sb: SupabaseClient) {}
  async add(userId: string, e: NewEvent, now: number) {
    const c = cleanEvent(e);
    const { data, error } = await this.sb.from("bots_app_events").insert({
      user_id: userId, kind: c.kind, bot: c.bot, title: c.title, paise: c.paise, amount_paise: c.amountPaise, payee: c.payee, created_at: new Date(now).toISOString(),
    }).select(COLUMNS).single<Row>();
    if (error || !data) throw new Error(`bots_app_events: add failed: ${error?.message ?? "no row"}`);
    // The old rows go with the next write: nothing else ever reads them.
    void this.sb.from("bots_app_events").delete().eq("user_id", userId).lt("created_at", new Date(now - KEEP_DAYS * 86_400_000).toISOString()).then(() => undefined, () => undefined);
    return of(data);
  }
  async list(userId: string, since: number, limit = 100) {
    const { data, error } = await this.sb.from("bots_app_events").select(COLUMNS).eq("user_id", userId)
      .gte("created_at", new Date(since).toISOString()).order("created_at", { ascending: false }).limit(limit).returns<Row[]>();
    if (error) throw new Error(`bots_app_events: list failed: ${error.message}`);
    return (data ?? []).map(of);
  }
  async get(userId: string, id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.sb.from("bots_app_events").select(COLUMNS).eq("user_id", userId).eq("id", id).maybeSingle<Row>();
    if (error) throw new Error(`bots_app_events: read failed: ${error.message}`);
    return data ? of(data) : null;
  }
  async any(userId: string) {
    const { data, error } = await this.sb.from("bots_app_events").select("id").eq("user_id", userId).limit(1);
    if (error) throw new Error(`bots_app_events: read failed: ${error.message}`);
    return (data ?? []).length > 0;
  }
}

let current: EventStore | null = null;

/** Supabase when the server has it, else memory. */
export function eventStore(): EventStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseEventStore(sb) : new MemoryEventStore();
  }
  return current;
}

export function resetEventStoreForTests(): void { current = null; }
