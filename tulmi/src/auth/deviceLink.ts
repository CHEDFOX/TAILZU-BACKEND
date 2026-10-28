/**
 * SIGN IN ON A COMPUTER WITH THE PHONE (device linking).
 *
 * The window's sign-in shows a QR code and a short code. The phone, already signed in, opens the QR's link (its camera
 * does that) or takes the typed code (You › Link a computer), shows "Sign in on <computer>?" and the person says yes or
 * no. On yes the window gets a session of its own, once.
 *
 *   create()        the window, signed out. A request that lives LINK_TTL_MS, with three random values:
 *                     token   in the QR's link; finds the request for the phone (to show it, approve it or refuse it)
 *                     secret  stays in the window; the only thing that can ask for the answer and take the session
 *                     code    8 letters and digits, typed on the phone instead of scanning; finds the token
 *                   Only their SHA-256 is kept, so the table alone signs nobody in.
 *   view            the phone, signed in: what is asking (the computer's name and system, when), by token or code.
 *   decide          the phone, signed in as a real account with an email: approve or refuse, once, while it is pending.
 *
 * Every value travels in a POST body, never a path or a query, so none of them is in a request log.
 *   poll            the window: token + secret. Waits up to POLL_MAX_MS for an answer. Approved, the request is spent
 *                   in the same step (approved → used, a conditional write), and only the poll that spent it gets the
 *                   session: a second one, or a copy of the token without the secret, gets nothing.
 *
 * THE SESSION is minted as the review pair's is (routes/reviewCode.ts): Supabase's admin API makes a one-time magic link
 * for the account's own address (nothing is sent), and the window gets only its hashed token, which it redeems with its
 * own anon key at /auth/v1/verify. The service key never leaves the server, and the window's session is a new, ordinary
 * one that it refreshes like any other. The used row is the record of the computer: who, which computer, when, from
 * where.
 *
 * Nothing here logs a token, a secret, a code or a hashed token.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabase } from "./supabase.js";

/** How long a request can be approved: long enough to find the phone, short enough that a photo of the screen is stale. */
export const LINK_TTL_MS = 5 * 60_000;
/** After approval, how long the window has to take its session (it is polling, so a second or two is normal). */
export const EXCHANGE_GRACE_MS = 60_000;
/** The longest a poll is held open. */
export const POLL_MAX_MS = 25_000;
/** How often a held poll reads the request again (an approval on another server instance wakes nothing here). */
const RECHECK_MS = 2_000;
/** Requests nobody finished are deleted this long after they ran out; used ones stay, as the record of the computer. */
const KEEP_UNUSED_MS = 24 * 60 * 60_000;

/** The code's letters: no 0/O or 1/I, so it reads aloud and types without doubt. 32 of them: 40 bits in 8. */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;

/** A token or a secret as the server makes them: 32 random bytes, base64url. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type LinkPlatform = "mac" | "windows" | "linux" | "";
export type StoredStatus = "pending" | "approved" | "denied" | "used";
/** What the phone and the window are told: a pending request past its time reads "expired". */
export type LinkStatus = StoredStatus | "expired";

export interface LinkRow {
  id: string;
  tokenHash: string;
  secretHash: string;
  codeHash: string;
  deviceName: string;
  platform: LinkPlatform;
  ip: string | null;
  userAgent: string | null;
  status: StoredStatus;
  /** Who approved (or refused) it. */
  userId: string | null;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  usedAt: number | null;
}

export interface LinkStore {
  insert(row: LinkRow): Promise<void>;
  byToken(tokenHash: string): Promise<LinkRow | null>;
  /** A pending, unexpired request with this code, newest first. */
  byCode(codeHash: string, now: number): Promise<LinkRow | null>;
  /**
   * Moves a request from `from` to `to` only while it is still `from` (a pending one also only while unexpired): the
   * one write that makes approving and taking the session happen once. The row after, or null when it had moved on.
   */
  transition(id: string, from: StoredStatus, to: StoredStatus, patch: Partial<Pick<LinkRow, "userId" | "decidedAt" | "usedAt">>, now: number): Promise<LinkRow | null>;
  /** Deletes requests that ran out unused a day ago. */
  sweep(now: number): Promise<void>;
}

export type Minted = { tokenHash: string; type: string } | { error: "no_email" | "failed" };

export interface DeviceLinkDeps {
  store: LinkStore;
  /** A one-time sign-in for the account (its hashed token), or why not. */
  mint: (userId: string) => Promise<Minted>;
  now?: () => number;
  random?: (bytes: number) => Buffer;
}

export interface Created { token: string; secret: string; code: string; expiresAt: number }
export interface LinkView {
  deviceName: string;
  platform: LinkPlatform;
  status: LinkStatus;
  createdAt: number;
  expiresAt: number;
}
/** How the phone names a request: the token from the QR's link, or the code typed from the window. */
export interface LinkRef { token?: unknown; code?: unknown }
export type PollAnswer =
  | { status: "pending"; expiresAt: number }
  | { status: "expired" | "denied" | "used" | "failed" }
  | { status: "approved"; tokenHash: string; type: string };
export type Decision = { ok: true; deviceName: string } | { ok: false; error: "not_found" | "expired" | "decided" | "no_email" | "not_allowed" };

export const hashOf = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Same hex digest, compared without stopping at the first difference. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length || !a) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** A typed code as the server stores it: capitals, its own letters only ("k7q4 2mxp" and "K7Q4-2MXP" are the same). */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 16);
}
/** "K7Q42MXP" → "K7Q4-2MXP". */
export const showCode = (code: string): string => (code.length === CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/**
 * The computer's name as it said it, made safe to show: no control or direction-changing characters (which could turn
 * "Mac" into something that reads differently), one line, at most 48 characters. Empty becomes the kind of computer.
 */
export function cleanDeviceName(raw: unknown, platform: LinkPlatform): string {
  const name = String(raw ?? "")
    .replace(/[\t\n\r\v\f\u2028\u2029]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f­؜​-‏‪-‮⁠-⁩﻿]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, 48).trim();
  if (name) return name;
  return platform === "mac" ? "a Mac" : platform === "windows" ? "a Windows PC" : platform === "linux" ? "a Linux computer" : "a computer";
}

export const cleanPlatform = (raw: unknown): LinkPlatform =>
  (raw === "mac" || raw === "windows" || raw === "linux" ? raw : "");

const base64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface DeviceLinks {
  create(o: { deviceName?: unknown; platform?: unknown; ip?: string | null; userAgent?: string | null }): Promise<Created>;
  view(ref: LinkRef): Promise<LinkView | null>;
  decide(ref: LinkRef, user: { id: string; email?: string }, yes: boolean): Promise<Decision>;
  poll(token: string, secret: string, waitMs: number): Promise<PollAnswer | null>;
}

export function createDeviceLinks(deps: DeviceLinkDeps): DeviceLinks {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? randomBytes;
  const store = deps.store;
  /** Polls held on this instance, by request id: a decision here wakes them at once. */
  const waiting = new Map<string, Set<() => void>>();
  /** Requests with a poll held right now: one at a time each, so copies of a poll cannot pile up held reads. */
  const holding = new Set<string>();

  const wake = (id: string) => { for (const f of waiting.get(id) ?? []) f(); };
  function nap(id: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const set = waiting.get(id) ?? new Set<() => void>();
      waiting.set(id, set);
      const done = () => { clearTimeout(t); set.delete(done); if (!set.size) waiting.delete(id); resolve(); };
      const t = setTimeout(done, Math.max(0, ms));
      set.add(done);
    });
  }

  function newCode(): string {
    const bytes = random(CODE_LENGTH);
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i]! & 31];
    return out;
  }

  const statusOf = (r: LinkRow, at: number): LinkStatus => (r.status === "pending" && r.expiresAt <= at ? "expired" : r.status);
  const viewOf = (r: LinkRow, at: number): LinkView => ({
    deviceName: r.deviceName, platform: r.platform, status: statusOf(r, at), createdAt: r.createdAt, expiresAt: r.expiresAt,
  });

  /** The request a token names (any state), or a typed code (only while pending: a code is short, so it finds nothing else). */
  async function rowOf(ref: LinkRef): Promise<LinkRow | null> {
    if (typeof ref.token === "string" && ref.token) return TOKEN_RE.test(ref.token) ? store.byToken(hashOf(ref.token)) : null;
    const code = normalizeCode(ref.code);
    return code.length === CODE_LENGTH ? store.byCode(hashOf(code), now()) : null;
  }

  return {
    async create(o) {
      const at = now();
      // Cheap housekeeping on the way in; a failure here never stops a sign-in.
      await store.sweep(at).catch(() => {});
      const platform = cleanPlatform(o.platform);
      const token = base64url(random(32));
      const secret = base64url(random(32));
      // A code another pending request already has would find the wrong computer: draw again (1 in 2^40 to need it).
      let code = newCode();
      for (let i = 0; i < 3 && (await store.byCode(hashOf(code), at)); i++) code = newCode();
      const row: LinkRow = {
        id: base64url(random(16)),
        tokenHash: hashOf(token), secretHash: hashOf(secret), codeHash: hashOf(code),
        deviceName: cleanDeviceName(o.deviceName, platform), platform,
        ip: o.ip ? String(o.ip).slice(0, 64) : null, userAgent: o.userAgent ? String(o.userAgent).slice(0, 200) : null,
        status: "pending", userId: null, createdAt: at, expiresAt: at + LINK_TTL_MS, decidedAt: null, usedAt: null,
      };
      await store.insert(row);
      return { token, secret, code, expiresAt: row.expiresAt };
    },

    async view(ref) {
      const r = await rowOf(ref);
      return r ? viewOf(r, now()) : null;
    },

    async decide(ref, user, yes) {
      // A real account: a static bearer is nobody's, and the session the window gets is minted from the address.
      if (!user.id || user.id.startsWith("static-")) return { ok: false, error: "not_allowed" };
      if (yes && !user.email) return { ok: false, error: "no_email" };
      const r = await rowOf(ref);
      if (!r) return { ok: false, error: "not_found" };
      const at = now();
      if (r.status === "pending" && r.expiresAt <= at) return { ok: false, error: "expired" };
      if (r.status !== "pending") return { ok: false, error: "decided" };
      const moved = await store.transition(r.id, "pending", yes ? "approved" : "denied", { userId: user.id, decidedAt: at }, at);
      if (!moved) return { ok: false, error: r.expiresAt <= now() ? "expired" : "decided" };
      wake(r.id);
      return { ok: true, deviceName: r.deviceName };
    },

    async poll(token, secret, waitMs) {
      if (!TOKEN_RE.test(token) || !TOKEN_RE.test(secret)) return null;
      const first = await store.byToken(hashOf(token));
      // The secret is what makes this the window that asked: without it, the same "not found" as a token never made.
      if (!first || !sameHash(hashOf(secret), first.secretHash)) return null;
      let r = first;
      const hold = !holding.has(r.id);
      const deadline = now() + (hold ? Math.min(Math.max(0, waitMs), POLL_MAX_MS) : 0);
      if (hold) holding.add(r.id);
      try {
        while (r.status === "pending" && r.expiresAt > now() && now() < deadline) {
          await nap(r.id, Math.min(RECHECK_MS, deadline - now(), r.expiresAt - now()));
          r = (await store.byToken(r.tokenHash)) ?? r;
        }
      } finally {
        if (hold) holding.delete(r.id);
      }
      const at = now();
      if (r.status === "pending") return r.expiresAt <= at ? { status: "expired" } : { status: "pending", expiresAt: r.expiresAt };
      if (r.status === "denied" || r.status === "used") return { status: r.status };
      // Approved: spend it first, then mint, so two polls racing cannot both come away with a session.
      if (r.expiresAt + EXCHANGE_GRACE_MS <= at || !r.userId) return { status: "expired" };
      const spent = await store.transition(r.id, "approved", "used", { usedAt: at }, at);
      if (!spent || !spent.userId) return { status: "used" };
      const minted = await deps.mint(spent.userId).catch((): Minted => ({ error: "failed" }));
      if ("error" in minted) return { status: "failed" };
      return { status: "approved", tokenHash: minted.tokenHash, type: minted.type };
    },
  };
}

// ===================================================================== stores

/** In memory: tests, and a server with no database (which cannot mint a session either, so the routes are off there). */
export function memoryLinkStore(): LinkStore & { rows: Map<string, LinkRow> } {
  const rows = new Map<string, LinkRow>();
  return {
    rows,
    async insert(row) { rows.set(row.id, { ...row }); },
    async byToken(h) { for (const r of rows.values()) if (r.tokenHash === h) return { ...r }; return null; },
    async byCode(h, at) {
      const hits = [...rows.values()].filter((r) => r.codeHash === h && r.status === "pending" && r.expiresAt > at);
      hits.sort((a, b) => b.createdAt - a.createdAt);
      return hits[0] ? { ...hits[0] } : null;
    },
    async transition(id, from, to, patch, at) {
      const r = rows.get(id);
      if (!r || r.status !== from || (from === "pending" && r.expiresAt <= at)) return null;
      Object.assign(r, patch, { status: to });
      return { ...r };
    },
    async sweep(at) {
      for (const [id, r] of rows) if (r.status !== "used" && r.expiresAt < at - KEEP_UNUSED_MS) rows.delete(id);
    },
  };
}

interface DbRow {
  id: string; token_hash: string; secret_hash: string; code_hash: string; device_name: string; platform: string;
  ip: string | null; user_agent: string | null; status: StoredStatus; user_id: string | null;
  created_at: string; expires_at: string; decided_at: string | null; used_at: string | null;
}
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null): number | null => (s ? Date.parse(s) : null);
const fromDb = (d: DbRow): LinkRow => ({
  id: d.id, tokenHash: d.token_hash, secretHash: d.secret_hash, codeHash: d.code_hash, deviceName: d.device_name,
  platform: cleanPlatform(d.platform), ip: d.ip, userAgent: d.user_agent, status: d.status, userId: d.user_id,
  createdAt: ms(d.created_at)!, expiresAt: ms(d.expires_at)!, decidedAt: ms(d.decided_at), usedAt: ms(d.used_at),
});

/**
 * Supabase (migration 0049, public.device_links), through the service client only: the rows are written before there
 * is an account, and no person reads them directly (row-level security is on with no policies).
 */
export function supabaseLinkStore(): LinkStore | null {
  const sb = supabase();
  if (!sb) return null;
  const T = "device_links";
  const fail = (what: string, e: { message?: string } | null) => { if (e) throw new Error(`device_links ${what}: ${e.message ?? "failed"}`); };
  return {
    async insert(r) {
      const { error } = await sb.from(T).insert({
        id: r.id, token_hash: r.tokenHash, secret_hash: r.secretHash, code_hash: r.codeHash, device_name: r.deviceName,
        platform: r.platform, ip: r.ip, user_agent: r.userAgent, status: r.status, user_id: r.userId,
        created_at: iso(r.createdAt), expires_at: iso(r.expiresAt),
      });
      fail("insert", error);
    },
    async byToken(h) {
      const { data, error } = await sb.from(T).select("*").eq("token_hash", h).maybeSingle();
      fail("read", error);
      return data ? fromDb(data as DbRow) : null;
    },
    async byCode(h, at) {
      const { data, error } = await sb.from(T).select("*").eq("code_hash", h).eq("status", "pending").gt("expires_at", iso(at))
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      fail("read", error);
      return data ? fromDb(data as DbRow) : null;
    },
    async transition(id, from, to, patch, at) {
      let q = sb.from(T).update({
        status: to,
        ...(patch.userId !== undefined ? { user_id: patch.userId } : {}),
        ...(patch.decidedAt != null ? { decided_at: iso(patch.decidedAt) } : {}),
        ...(patch.usedAt != null ? { used_at: iso(patch.usedAt) } : {}),
      }).eq("id", id).eq("status", from);
      if (from === "pending") q = q.gt("expires_at", iso(at));
      const { data, error } = await q.select("*").maybeSingle();
      fail("update", error);
      return data ? fromDb(data as DbRow) : null;
    },
    async sweep(at) {
      const { error } = await sb.from(T).delete().neq("status", "used").lt("expires_at", iso(at - KEEP_UNUSED_MS));
      fail("sweep", error);
    },
  };
}

/**
 * A one-time sign-in for the account: Supabase's admin API makes a magic link for its address without sending it, and
 * only the link's hashed token comes back (the window redeems it at /auth/v1/verify with its own anon key). An account
 * with no address (a number-only sign-in) cannot be linked this way.
 */
export async function mintSignIn(userId: string): Promise<Minted> {
  const sb = supabase();
  if (!sb) return { error: "failed" };
  const { data: got, error: readErr } = await sb.auth.admin.getUserById(userId);
  if (readErr || !got?.user) return { error: "failed" };
  const email = got.user.email;
  if (!email) return { error: "no_email" };
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { error: "failed" };
  return { tokenHash, type: "magiclink" };
}

/** The real service: on whenever the server holds the service key (it can mint then), else null and the routes say so. */
export function defaultDeviceLinks(): DeviceLinks | null {
  const store = supabaseLinkStore();
  return store ? createDeviceLinks({ store, mint: mintSignIn }) : null;
}
