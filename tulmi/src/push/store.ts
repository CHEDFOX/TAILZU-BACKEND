/**
 * What the engine reads and writes, behind one interface so the engine can be
 * tested without a database.
 *
 * push_log (migration 0013) is the engine's memory and its lock: one row per
 * person per reason per period ("streak:2026-09-26"), unique, claimed BEFORE
 * anything is sent. Two engines, or one restarted mid-tick, can never send the
 * same push twice — the second insert fails and that engine moves on. Tokens
 * are never written there, only a hash, so the log can say which token Expo
 * rejected without holding another copy of it.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LogEntry } from "./plan.js";
import type { Moment } from "./timing.js";

export interface Token { platform: "ios" | "android"; token: string; updatedAt: number }

export interface Candidate {
  userId: string;
  tokens: Token[];
  lastSeenAt: number | null;
  createdAt: number | null;
  locale: string | null;
  entitled: boolean;
  tzOffsetMin: number | null;
}

export interface TicketRecord { platform: string; tokenHash: string; ticketId?: string; status: string; error?: string }

export interface PushStore {
  candidates(now: number): Promise<Candidate[]>;
  moments(userId: string, sinceMs: number): Promise<Moment[]>;
  log(userId: string, sinceMs: number): Promise<LogEntry[]>;
  /** The new row's id, or null when this period is already claimed. */
  claim(row: { userId: string; kind: string; periodKey: string; plannedAt: number }): Promise<string | null>;
  settle(id: string, patch: { status: "sent" | "failed"; sentAt: number; tickets: TicketRecord[]; error?: string }): Promise<void>;
  /** Delete the (user, platform) token if it is still the one with this hash. */
  dropToken(userId: string, platform: string, tokenHash: string): Promise<void>;
  pendingReceipts(sentBefore: number): Promise<Array<{ id: string; userId: string; tickets: TicketRecord[] }>>;
  receiptsChecked(id: string): Promise<void>;
  markOpened(userId: string, pushId: string, at: number): Promise<void>;
  recent(sinceMs: number): Promise<Array<{ kind: string; status: string; sentAt: number | null; openedAt: number | null }>>;
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

const ms = (v: unknown): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
const iso = (n: number) => new Date(n).toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ Supabase

export class SupabasePushStore implements PushStore {
  constructor(private readonly sb: SupabaseClient, private readonly warn: (msg: string) => void = console.warn) {}

  async candidates(now: number): Promise<Candidate[]> {
    const byUser = new Map<string, Candidate>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb
        .from("push_tokens")
        .select("user_id, platform, token, updated_at")
        .order("user_id")
        .range(from, from + 999);
      if (error) { this.warn(`[push] push_tokens read failed: ${error.message}`); break; }
      for (const r of (data ?? []) as Array<{ user_id: string; platform: string; token: string; updated_at: string }>) {
        if (r.platform !== "ios" && r.platform !== "android") continue;
        if (typeof r.token !== "string" || !r.token) continue;
        const c = byUser.get(r.user_id) ?? {
          userId: r.user_id, tokens: [], lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: null,
        };
        c.tokens.push({ platform: r.platform, token: r.token, updatedAt: ms(r.updated_at) ?? 0 });
        byUser.set(r.user_id, c);
      }
      if (!data || data.length < 1000) break;
    }
    const ids = [...byUser.keys()];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [profiles, ents, pers] = await Promise.all([
        this.sb.from("profiles").select("user_id, last_seen_at, created_at, language").in("user_id", chunk),
        this.sb.from("entitlements").select("user_id, active, expires_at").in("user_id", chunk),
        this.sb.from("personalities").select("user_id, tz:data->stylePortrait->tzOffsetMinutes").in("user_id", chunk),
      ]);
      if (profiles.error) this.warn(`[push] profiles read failed: ${profiles.error.message}`);
      for (const p of (profiles.data ?? []) as Array<{ user_id: string; last_seen_at?: string | null; created_at?: string | null; language?: string | null }>) {
        const c = byUser.get(p.user_id);
        if (!c) continue;
        c.lastSeenAt = ms(p.last_seen_at);
        c.createdAt = ms(p.created_at);
        c.locale = typeof p.language === "string" && p.language !== "auto" ? p.language : null;
      }
      for (const e of (ents.data ?? []) as Array<{ user_id: string; active?: boolean; expires_at?: string | null }>) {
        const c = byUser.get(e.user_id);
        if (!c) continue;
        const exp = ms(e.expires_at);
        c.entitled = e.active === true && (exp === null || exp > now);
      }
      for (const p of (pers.data ?? []) as Array<{ user_id: string; tz?: unknown }>) {
        const c = byUser.get(p.user_id);
        const tz = typeof p.tz === "number" ? p.tz : typeof p.tz === "string" ? Number(p.tz) : NaN;
        if (c && Number.isFinite(tz) && Math.abs(tz) <= 14 * 60) c.tzOffsetMin = Math.round(tz);
      }
    }
    return [...byUser.values()];
  }

  async moments(userId: string, sinceMs: number): Promise<Moment[]> {
    const { data, error } = await this.sb
      .from("usage_events")
      .select("created_at, word_count")
      .eq("user_id", userId)
      .gte("created_at", iso(sinceMs))
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) { this.warn(`[push] usage read failed: ${error.message}`); return []; }
    return ((data ?? []) as Array<{ created_at: string; word_count?: number | null }>)
      .map((r) => ({ at: ms(r.created_at) ?? 0, words: r.word_count ?? 0 }))
      .filter((m) => m.at > 0);
  }

  async log(userId: string, sinceMs: number): Promise<LogEntry[]> {
    const { data, error } = await this.sb
      .from("push_log")
      .select("id, kind, period_key, status, sent_at, opened_at")
      .eq("user_id", userId)
      .gte("created_at", iso(sinceMs))
      .order("created_at", { ascending: false })
      .limit(200);
    // Thrown, not warned: without the log the caps cannot be checked, so the
    // engine sends nothing and says so once (see PushEngine.tick).
    if (error) throw new Error(`push_log read failed: ${error.message}`);
    return ((data ?? []) as Array<{ id: string; kind: string; period_key: string; status: string; sent_at: string | null; opened_at: string | null }>)
      .map((r) => ({ id: r.id, kind: r.kind, periodKey: r.period_key, status: r.status, sentAt: ms(r.sent_at), openedAt: ms(r.opened_at) }));
  }

  async claim(row: { userId: string; kind: string; periodKey: string; plannedAt: number }): Promise<string | null> {
    const { data, error } = await this.sb
      .from("push_log")
      .insert({ user_id: row.userId, kind: row.kind, period_key: row.periodKey, planned_at: iso(row.plannedAt), status: "claimed" })
      .select("id")
      .single();
    if (error) {
      if (error.code !== "23505") this.warn(`[push] claim failed: ${error.message}`);
      return null;
    }
    return (data as { id: string }).id;
  }

  async settle(id: string, patch: { status: "sent" | "failed"; sentAt: number; tickets: TicketRecord[]; error?: string }): Promise<void> {
    const { error } = await this.sb.from("push_log").update({
      status: patch.status,
      sent_at: patch.status === "sent" ? iso(patch.sentAt) : null,
      tickets: patch.tickets,
      error: patch.error ?? null,
    }).eq("id", id);
    if (error) this.warn(`[push] settle failed: ${error.message}`);
  }

  async dropToken(userId: string, platform: string, hash: string): Promise<void> {
    const { data } = await this.sb.from("push_tokens").select("token").eq("user_id", userId).eq("platform", platform).maybeSingle();
    const token = (data as { token?: string } | null)?.token;
    if (!token || tokenHash(token) !== hash) return;
    const { error } = await this.sb.from("push_tokens").delete().eq("user_id", userId).eq("platform", platform).eq("token", token);
    if (error) this.warn(`[push] token drop failed: ${error.message}`);
  }

  async pendingReceipts(sentBefore: number): Promise<Array<{ id: string; userId: string; tickets: TicketRecord[] }>> {
    const { data, error } = await this.sb
      .from("push_log")
      .select("id, user_id, tickets")
      .eq("status", "sent")
      .eq("receipts_checked", false)
      .lt("sent_at", iso(sentBefore))
      .limit(300);
    if (error) return [];
    return ((data ?? []) as Array<{ id: string; user_id: string; tickets: unknown }>)
      .map((r) => ({ id: r.id, userId: r.user_id, tickets: Array.isArray(r.tickets) ? (r.tickets as TicketRecord[]) : [] }));
  }

  async receiptsChecked(id: string): Promise<void> {
    await this.sb.from("push_log").update({ receipts_checked: true }).eq("id", id);
  }

  async markOpened(userId: string, pushId: string, at: number): Promise<void> {
    if (!UUID.test(pushId)) return;
    await this.sb.from("push_log").update({ opened_at: iso(at) }).eq("id", pushId).eq("user_id", userId).is("opened_at", null);
  }

  async recent(sinceMs: number): Promise<Array<{ kind: string; status: string; sentAt: number | null; openedAt: number | null }>> {
    const { data, error } = await this.sb
      .from("push_log")
      .select("kind, status, sent_at, opened_at")
      .gte("created_at", iso(sinceMs))
      .limit(10000);
    if (error) return [];
    return ((data ?? []) as Array<{ kind: string; status: string; sent_at: string | null; opened_at: string | null }>)
      .map((r) => ({ kind: r.kind, status: r.status, sentAt: ms(r.sent_at), openedAt: ms(r.opened_at) }));
  }
}

// ------------------------------------------------------------------ memory

/** For tests, and for a server with no database: nothing is ever sent. */
export class MemoryPushStore implements PushStore {
  candidatesList: Candidate[] = [];
  momentsByUser = new Map<string, Moment[]>();
  rows: Array<{ id: string; userId: string; kind: string; periodKey: string; plannedAt: number; status: string; sentAt: number | null; openedAt: number | null; tickets: TicketRecord[]; receiptsChecked: boolean; createdAt: number }> = [];
  dropped: Array<{ userId: string; platform: string }> = [];
  private seq = 0;

  async candidates(): Promise<Candidate[]> { return this.candidatesList; }
  async moments(userId: string, sinceMs: number): Promise<Moment[]> {
    return (this.momentsByUser.get(userId) ?? []).filter((m) => m.at >= sinceMs);
  }
  async log(userId: string, sinceMs: number): Promise<LogEntry[]> {
    return this.rows.filter((r) => r.userId === userId && r.createdAt >= sinceMs)
      .map((r) => ({ id: r.id, kind: r.kind, periodKey: r.periodKey, status: r.status, sentAt: r.sentAt, openedAt: r.openedAt }));
  }
  async claim(row: { userId: string; kind: string; periodKey: string; plannedAt: number }): Promise<string | null> {
    if (this.rows.some((r) => r.userId === row.userId && r.periodKey === row.periodKey)) return null;
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
    this.rows.push({ id, ...row, status: "claimed", sentAt: null, openedAt: null, tickets: [], receiptsChecked: false, createdAt: row.plannedAt });
    return id;
  }
  async settle(id: string, patch: { status: "sent" | "failed"; sentAt: number; tickets: TicketRecord[] }): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, { status: patch.status, sentAt: patch.status === "sent" ? patch.sentAt : null, tickets: patch.tickets });
  }
  async dropToken(userId: string, platform: string, hash: string): Promise<void> {
    const c = this.candidatesList.find((x) => x.userId === userId);
    if (!c) return;
    const before = c.tokens.length;
    c.tokens = c.tokens.filter((t) => !(t.platform === platform && tokenHash(t.token) === hash));
    if (c.tokens.length < before) this.dropped.push({ userId, platform });
  }
  async pendingReceipts(sentBefore: number) {
    return this.rows.filter((r) => r.status === "sent" && !r.receiptsChecked && (r.sentAt ?? Infinity) < sentBefore)
      .map((r) => ({ id: r.id, userId: r.userId, tickets: r.tickets }));
  }
  async receiptsChecked(id: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) r.receiptsChecked = true;
  }
  async markOpened(userId: string, pushId: string, at: number): Promise<void> {
    const r = this.rows.find((x) => x.id === pushId && x.userId === userId);
    if (r && r.openedAt === null) r.openedAt = at;
  }
  async recent(sinceMs: number) {
    return this.rows.filter((r) => r.createdAt >= sinceMs).map((r) => ({ kind: r.kind, status: r.status, sentAt: r.sentAt, openedAt: r.openedAt }));
  }
}
