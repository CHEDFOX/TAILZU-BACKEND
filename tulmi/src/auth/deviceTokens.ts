/**
 * XODE IN THE TERMINAL: ITS OWN SIGN-IN (device tokens; docs/xode-cli.md "Sign in").
 *
 * `xode login` starts a sign-in request of kind "cli" (POST /v1/auth/link, auth/deviceLink.ts), the person approves it in the
 * app (bots.link), and the terminal's poll takes a DEVICE TOKEN of its own, once: "xdt_" and 32 random bytes, base64url. From
 * then on it is the terminal's sign-in (Authorization: Bearer xdt_…, read by auth/supabase.ts resolveUser), until it is removed.
 *
 *   issue    on the approved poll: a new token for the person, with the terminal's name and system. Only its SHA-256 is kept,
 *            so the table alone signs nobody in.
 *   user     every request that carries one: the person it signs in, unless it was removed. What a token names is kept in
 *            memory for CACHE_MS, so a terminal's requests do not each read the table; last_used_at is written at most every
 *            TOUCH_MS.
 *   list     the person's terminals, newest first (Settings › Terminal sign-ins, GET /v1/auth/devices).
 *   revoke   one of them, by the person (DELETE /v1/auth/devices/:id) or by the terminal itself (`xode logout`). The row stays,
 *            marked removed, as the record of that terminal.
 *
 * A removed token fails at once on this server instance (its cache entry goes with it). Another instance may still hold it for
 * up to CACHE_MS, and then reads the table again and turns it away.
 *
 * A token is only for Xode: http/deviceScope.ts answers 403 to it on every other route.
 * Nothing here logs a token or its hash.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { supabase, type AuthedUser } from "./supabase.js";

export const DEVICE_TOKEN_PREFIX = "xdt_";
/** A token as the server makes them: the prefix, then 32 random bytes in base64url. */
export const DEVICE_TOKEN_RE = /^xdt_[A-Za-z0-9_-]{43}$/;
/** How long what a token names is kept in memory: also how long a removed one can still work on another instance. */
export const CACHE_MS = 60_000;
/** last_used_at is written no more often than this. */
export const TOUCH_MS = 10 * 60_000;
/** The most tokens kept in memory at once; the oldest goes first. */
const CACHE_MAX = 5_000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A header that carries a device token ("Bearer xdt_…"), whether or not it is a good one. */
export function isDeviceBearer(authorization: unknown): boolean {
  return typeof authorization === "string" && /^\s*Bearer\s+xdt_/i.test(authorization);
}

export type DevicePlatform = "mac" | "windows" | "linux" | "";

export interface DeviceRow {
  id: string;
  userId: string;
  tokenHash: string;
  name: string;
  platform: DevicePlatform;
  kind: "cli";
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** A terminal as the person and the terminal see it. */
export interface DeviceView {
  id: string;
  name: string;
  platform: DevicePlatform;
  kind: "cli";
  createdAt: number;
  lastUsedAt: number | null;
}

export interface DeviceTokenStore {
  insert(row: DeviceRow): Promise<void>;
  byHash(tokenHash: string): Promise<DeviceRow | null>;
  byId(id: string): Promise<DeviceRow | null>;
  /** The person's terminals not removed, newest first. */
  listFor(userId: string): Promise<DeviceRow[]>;
  /** Marks it removed, only when it is the person's and not removed yet. True when it was. */
  revoke(userId: string, id: string, at: number): Promise<boolean>;
  touch(id: string, at: number): Promise<void>;
}

/** What the account says about the person, as resolveUser gives it for a session. */
export type Account = Pick<AuthedUser, "email" | "phone" | "createdAt" | "provider" | "providerName">;

export interface DeviceTokenDeps {
  store: DeviceTokenStore;
  /** The account behind a token (its address, its name), or nothing. */
  account?: (userId: string) => Promise<Account>;
  now?: () => number;
  random?: (bytes: number) => Buffer;
}

export interface DeviceTokens {
  issue(o: { userId: string; name: string; platform: DevicePlatform }): Promise<{ token: string; id: string }>;
  /** The person a token signs in (with deviceId set), or null: not one of ours, or removed. */
  user(token: string): Promise<AuthedUser | null>;
  /** One of the person's terminals, not removed. */
  device(userId: string, id: string): Promise<DeviceView | null>;
  list(userId: string): Promise<DeviceView[]>;
  revoke(userId: string, id: string): Promise<boolean>;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length || !a) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
const base64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const viewOf = (r: DeviceRow): DeviceView => ({ id: r.id, name: r.name, platform: r.platform, kind: r.kind, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt });
const cleanPlatform = (raw: unknown): DevicePlatform => (raw === "mac" || raw === "windows" || raw === "linux" ? raw : "");

export function createDeviceTokens(deps: DeviceTokenDeps): DeviceTokens {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? randomBytes;
  const store = deps.store;
  /** By token hash: the row and the account, until `until`. */
  const cache = new Map<string, { row: DeviceRow; account: Account; until: number }>();

  const forget = (id: string) => { for (const [h, e] of cache) if (e.row.id === id) cache.delete(h); };

  return {
    async issue(o) {
      const token = DEVICE_TOKEN_PREFIX + base64url(random(32));
      const row: DeviceRow = {
        id: randomUUID(), userId: o.userId, tokenHash: sha256(token), name: o.name.slice(0, 64), platform: cleanPlatform(o.platform),
        kind: "cli", createdAt: now(), lastUsedAt: null, revokedAt: null,
      };
      await store.insert(row);
      return { token, id: row.id };
    },

    async user(token) {
      if (!DEVICE_TOKEN_RE.test(token)) return null;
      const h = sha256(token);
      const at = now();
      let hit = cache.get(h);
      if (!hit || hit.until <= at) {
        cache.delete(h);
        const row = await store.byHash(h);
        if (!row || !sameHash(h, row.tokenHash) || row.revokedAt != null) return null;
        // The account's address and name, as a session has them; without them the token still signs the person in.
        const account = deps.account ? await deps.account(row.userId).catch((): Account => ({})) : {};
        hit = { row, account, until: at + CACHE_MS };
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(h, hit);
      }
      const row = hit.row;
      if (row.lastUsedAt == null || at - row.lastUsedAt >= TOUCH_MS) {
        row.lastUsedAt = at;
        void store.touch(row.id, at).catch(() => { /* the next use tries again */ });
      }
      return { ...hit.account, id: row.userId, deviceId: row.id };
    },

    async device(userId, id) {
      if (!ID_RE.test(id)) return null;
      const row = await store.byId(id);
      if (!row || row.userId !== userId || row.revokedAt != null) return null;
      // This instance may have used it since the table was last written.
      for (const e of cache.values()) if (e.row.id === id && (e.row.lastUsedAt ?? 0) > (row.lastUsedAt ?? 0)) row.lastUsedAt = e.row.lastUsedAt;
      return viewOf(row);
    },

    async list(userId) {
      return (await store.listFor(userId)).map(viewOf);
    },

    async revoke(userId, id) {
      if (!ID_RE.test(id)) return false;
      const done = await store.revoke(userId, id, now());
      // Gone on this instance at once; elsewhere within CACHE_MS.
      if (done) forget(id);
      return done;
    },
  };
}

// ===================================================================== stores

/** In memory: tests, and a server with no database. */
export function memoryDeviceTokenStore(): DeviceTokenStore & { rows: Map<string, DeviceRow> } {
  const rows = new Map<string, DeviceRow>();
  return {
    rows,
    async insert(row) { rows.set(row.id, { ...row }); },
    async byHash(h) {
      for (const r of rows.values()) if (sameHash(r.tokenHash, h)) return { ...r };
      return null;
    },
    async byId(id) { const r = rows.get(id); return r ? { ...r } : null; },
    async listFor(userId) {
      return [...rows.values()].filter((r) => r.userId === userId && r.revokedAt == null).sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ ...r }));
    },
    async revoke(userId, id, at) {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.revokedAt != null) return false;
      r.revokedAt = at;
      return true;
    },
    async touch(id, at) { const r = rows.get(id); if (r) r.lastUsedAt = at; },
  };
}

interface DbRow {
  id: string; user_id: string; token_hash: string; name: string; platform: string; kind: string;
  created_at: string; last_used_at: string | null; revoked_at: string | null;
}
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null): number | null => (s ? Date.parse(s) : null);
const fromDb = (d: DbRow): DeviceRow => ({
  id: d.id, userId: d.user_id, tokenHash: d.token_hash, name: d.name, platform: cleanPlatform(d.platform), kind: "cli",
  createdAt: ms(d.created_at)!, lastUsedAt: ms(d.last_used_at), revokedAt: ms(d.revoked_at),
});

/**
 * Supabase (migration 0066, public.device_tokens), through the service client only: row-level security is on with no policies,
 * so no person's own session reads or writes the table.
 */
function supabaseDeviceTokenStore(): DeviceTokenStore | null {
  const sb = supabase();
  if (!sb) return null;
  const T = "device_tokens";
  const fail = (what: string, e: { message?: string } | null) => { if (e) throw new Error(`device_tokens ${what}: ${e.message ?? "failed"}`); };
  return {
    async insert(r) {
      const { error } = await sb.from(T).insert({
        id: r.id, user_id: r.userId, token_hash: r.tokenHash, name: r.name, platform: r.platform, kind: r.kind, created_at: iso(r.createdAt),
      });
      fail("insert", error);
    },
    async byHash(h) {
      const { data, error } = await sb.from(T).select("*").eq("token_hash", h).maybeSingle();
      fail("read", error);
      return data ? fromDb(data as DbRow) : null;
    },
    async byId(id) {
      const { data, error } = await sb.from(T).select("*").eq("id", id).maybeSingle();
      fail("read", error);
      return data ? fromDb(data as DbRow) : null;
    },
    async listFor(userId) {
      const { data, error } = await sb.from(T).select("*").eq("user_id", userId).is("revoked_at", null)
        .order("created_at", { ascending: false }).limit(100);
      fail("list", error);
      return ((data ?? []) as DbRow[]).map(fromDb);
    },
    async revoke(userId, id, at) {
      const { data, error } = await sb.from(T).update({ revoked_at: iso(at) }).eq("id", id).eq("user_id", userId).is("revoked_at", null)
        .select("id").maybeSingle();
      fail("revoke", error);
      return !!data;
    },
    async touch(id, at) {
      const { error } = await sb.from(T).update({ last_used_at: iso(at) }).eq("id", id);
      fail("touch", error);
    },
  };
}

/** The account's address and name, through the admin API (the token is not a Supabase session, so nothing else can say). */
async function accountOf(userId: string): Promise<Account> {
  const sb = supabase();
  if (!sb) return {};
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error || !data?.user) return {};
  const u = data.user;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && !!v.trim());
  const provider = typeof u.app_metadata?.provider === "string" ? u.app_metadata.provider : undefined;
  return {
    ...(u.email ? { email: u.email } : {}),
    ...(u.phone ? { phone: u.phone } : {}),
    ...(u.created_at ? { createdAt: u.created_at } : {}),
    ...(provider ? { provider } : {}),
    ...(name ? { providerName: name.trim().slice(0, 120) } : {}),
  };
}

let shared: DeviceTokens | null = null;

/** The server's one service: the table when the server holds the service key, else memory. */
export function deviceTokens(): DeviceTokens {
  if (!shared) {
    const store = supabaseDeviceTokenStore();
    shared = createDeviceTokens(store ? { store, account: accountOf } : { store: memoryDeviceTokenStore() });
  }
  return shared;
}

/** Tests: put a service of their own in its place (null goes back to the server's own). */
export function useDeviceTokens(t: DeviceTokens | null): void {
  shared = t;
}
