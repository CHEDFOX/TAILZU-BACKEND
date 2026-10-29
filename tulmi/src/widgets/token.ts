/**
 * THE WIDGET'S OWN TOKEN: what lets a Home Screen widget answer without the person's session.
 *
 * A widget's button runs outside the app (iOS: an App Intent in the widget extension; Android: a broadcast in the app's process
 * with no session at hand), and a session token must never sit where a widget can read it. So the app asks for this one
 * (POST /v1/widgets/token, with its session) and keeps it in the shared keychain (iOS) or its private SharedPreferences (Android);
 * the widget sends it to POST /v1/widgets/act in an `X-Widget-Token` header, and nowhere else.
 *
 *   narrow       it is not a session: no other route reads that header, and it is not a JWT, so resolveUser refuses it everywhere.
 *                POST /v1/widgets/act takes it only for SCOPES: answering the person's own needs-you questions (a bot's question,
 *                a connected app's yes) and ticking their own tasks. A reply, or anything else, needs the session.
 *   short-lived  `widgets.token.ttlMin` (a day); the app asks again once half of that has gone, on launch and coming to the front.
 *   revocable    one per phone (a new one for the same device replaces the last), at most `widgets.token.maxPerUser` (the oldest
 *                goes); DELETE /v1/widgets/token takes the phone's (sign-out does) or all of them; deleting the account takes them all.
 *   kept hashed  the server keeps the SHA-256 of it, never the token. Compared by that hash.
 *
 * Migration 0058 (widget_tokens), with a memory twin for tests and a server with no Supabase (a restart then forgets every token:
 * the widgets answer "Open X0 Bot to finish" until the app next opens and asks again).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** What a widget token may do. */
export const WIDGET_SCOPES = ["needs.answer", "task.done"] as const;
export type WidgetScope = (typeof WIDGET_SCOPES)[number];

/** The shape of a token: our prefix and 43 base64url characters (32 random bytes). */
export const TOKEN_RE = /^xwt_[A-Za-z0-9_-]{43}$/;
/** A phone's install id, as the app makes it. */
export const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const hashToken = (t: string): string => createHash("sha256").update(t).digest("hex");
export const newToken = (): string => `xwt_${randomBytes(32).toString("base64url")}`;

export interface TokenRow { id: string; userId: string; device: string; hash: string; scopes: WidgetScope[]; createdAt: number; expiresAt: number; revokedAt: number | null; lastUsedAt: number | null }

export interface WidgetTokenStore {
  insert(row: TokenRow): Promise<void>;
  byHash(hash: string): Promise<TokenRow | null>;
  /** The person's tokens still standing (not revoked), newest first. */
  live(userId: string, now: number): Promise<TokenRow[]>;
  revoke(userId: string, ids: string[] | "all", now: number): Promise<number>;
  touch(id: string, now: number): Promise<void>;
}

export class MemoryWidgetTokenStore implements WidgetTokenStore {
  readonly rows: TokenRow[] = [];
  async insert(row: TokenRow) { this.rows.push({ ...row }); }
  async byHash(hash: string) { const r = this.rows.find((x) => x.hash === hash); return r ? { ...r } : null; }
  async live(userId: string, now: number) {
    return this.rows.filter((r) => r.userId === userId && r.revokedAt === null && r.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ ...r }));
  }
  async revoke(userId: string, ids: string[] | "all", now: number) {
    let n = 0;
    for (const r of this.rows) {
      if (r.userId !== userId || r.revokedAt !== null || r.expiresAt <= now || (ids !== "all" && !ids.includes(r.id))) continue;
      r.revokedAt = now; n += 1;
    }
    return n;
  }
  async touch(id: string, now: number) { const r = this.rows.find((x) => x.id === id); if (r) r.lastUsedAt = now; }
}

const TABLE = "widget_tokens";
interface DbRow { id: string; user_id: string; device: string; token_hash: string; scopes: string[]; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null }
const ms = (s: string | null): number | null => (s ? Date.parse(s) : null);
const iso = (n: number) => new Date(n).toISOString();
const fromDb = (r: DbRow): TokenRow => ({
  id: r.id, userId: r.user_id, device: r.device, hash: r.token_hash,
  scopes: (r.scopes ?? []).filter((s): s is WidgetScope => (WIDGET_SCOPES as readonly string[]).includes(s)),
  createdAt: Date.parse(r.created_at), expiresAt: Date.parse(r.expires_at), revokedAt: ms(r.revoked_at), lastUsedAt: ms(r.last_used_at),
});

export class SupabaseWidgetTokenStore implements WidgetTokenStore {
  constructor(private readonly sb: SupabaseClient) {}
  async insert(row: TokenRow) {
    const { error } = await this.sb.from(TABLE).insert({
      id: row.id, user_id: row.userId, device: row.device, token_hash: row.hash, scopes: row.scopes,
      created_at: iso(row.createdAt), expires_at: iso(row.expiresAt),
    });
    if (error) throw new Error(`${TABLE}: insert failed: ${error.message}`);
  }
  async byHash(hash: string) {
    const { data, error } = await this.sb.from(TABLE).select("*").eq("token_hash", hash).maybeSingle<DbRow>();
    if (error) throw new Error(`${TABLE}: read failed: ${error.message}`);
    return data ? fromDb(data) : null;
  }
  async live(userId: string, now: number) {
    const { data, error } = await this.sb.from(TABLE).select("*").eq("user_id", userId).is("revoked_at", null).gt("expires_at", iso(now))
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(`${TABLE}: read failed: ${error.message}`);
    return ((data ?? []) as DbRow[]).map(fromDb);
  }
  async revoke(userId: string, ids: string[] | "all", now: number) {
    let q = this.sb.from(TABLE).update({ revoked_at: iso(now) }).eq("user_id", userId).is("revoked_at", null).gt("expires_at", iso(now));
    if (ids !== "all") {
      if (!ids.length) return 0;
      q = q.in("id", ids);
    }
    const { data, error } = await q.select("id");
    if (error) throw new Error(`${TABLE}: revoke failed: ${error.message}`);
    // Spent and revoked tokens older than a month go, while we are here.
    void this.sb.from(TABLE).delete().eq("user_id", userId).lt("expires_at", iso(now - 30 * 86_400_000)).then(() => undefined, () => undefined);
    return (data ?? []).length;
  }
  async touch(id: string, now: number) {
    await this.sb.from(TABLE).update({ last_used_at: iso(now) }).eq("id", id).then(() => undefined, () => undefined);
  }
}

export interface Issued { token: string; expiresAt: number; scopes: WidgetScope[] }
export type Verified = { userId: string; tokenId: string; scopes: WidgetScope[] };

export class WidgetTokens {
  constructor(private readonly store: WidgetTokenStore, private readonly now: () => number = Date.now) {}

  /**
   * A new token for one phone, replacing that phone's last one, and the oldest past `maxPerUser`. Only the hash is kept; the token
   * is in this answer and nowhere else.
   */
  async issue(userId: string, device: string, o: { ttlMs: number; maxPerUser: number }): Promise<Issued> {
    const now = this.now();
    const token = newToken();
    const row: TokenRow = {
      id: randomUUID(), userId, device, hash: hashToken(token), scopes: [...WIDGET_SCOPES],
      createdAt: now, expiresAt: now + Math.max(60_000, o.ttlMs), revokedAt: null, lastUsedAt: null,
    };
    const standing = await this.store.live(userId, now);
    const sameDevice = standing.filter((r) => r.device === device).map((r) => r.id);
    const others = standing.filter((r) => r.device !== device);
    const over = others.slice(Math.max(0, Math.max(1, o.maxPerUser) - 1)).map((r) => r.id);
    await this.store.insert(row);
    if (sameDevice.length || over.length) await this.store.revoke(userId, [...sameDevice, ...over], now);
    return { token, expiresAt: row.expiresAt, scopes: row.scopes };
  }

  /** Whose token this is, if it is one of ours, standing and not run out. Null for anything else. */
  async verify(token: unknown): Promise<Verified | null> {
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
    const row = await this.store.byHash(hashToken(token));
    const now = this.now();
    if (!row || row.revokedAt !== null || row.expiresAt <= now) return null;
    void this.store.touch(row.id, now).catch(() => undefined);
    return { userId: row.userId, tokenId: row.id, scopes: row.scopes };
  }

  /** One phone's tokens, or every token the person has. How many went. */
  async revoke(userId: string, device?: string): Promise<number> {
    const now = this.now();
    if (!device) return this.store.revoke(userId, "all", now);
    const ids = (await this.store.live(userId, now)).filter((r) => r.device === device).map((r) => r.id);
    return ids.length ? this.store.revoke(userId, ids, now) : 0;
  }
}

let current: WidgetTokenStore | null = null;

/** Supabase when the server has it, else memory. */
export function widgetTokenStore(): WidgetTokenStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseWidgetTokenStore(sb) : new MemoryWidgetTokenStore();
  }
  return current;
}

export function resetWidgetTokenStoreForTests(): void { current = null; }
