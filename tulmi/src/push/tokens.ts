/**
 * Which account a phone's push token belongs to.
 *
 *   POST /v1/push/register    { token, platform, appVersion?, caps? } — this phone is mine
 *   POST /v1/push/unregister  { token }                        — not mine any more (sign-out)
 *
 * A TOKEN BELONGS TO A PHONE, NOT TO AN ACCOUNT. Rows are keyed (user,
 * platform), so when A signs out and B signs in on the same phone, B's row is
 * written and A's row — holding the very same token — stays. Every push the
 * engine sends A then lands on B's lock screen. Two rules close that:
 *
 *   - registering a token takes it away from every other account first, so
 *     at any moment one account at most can reach a given phone;
 *   - signing out gives it up, so between A leaving and B arriving (or if
 *     nobody ever signs in again) the phone hears nothing for A.
 *
 * The first is the one that cannot be skipped: a sign-out can happen offline,
 * or by the session expiring, and then the app has no token to send the
 * second with. Both are best-effort for the client — the app never blocks on
 * either — so both answer { ok: true } unless the request itself is wrong.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * What a phone's binary says it can do with a push (the app's device/binaryCore.ts pushCaps), kept with its token: only names the
 * engine reads (push/engine.ts), so a list a newer app sends cannot grow the row. "PushTimeSensitive": the iOS Time Sensitive
 * entitlement is signed in, so a leave-by or a bill due today may break through Focus. "BotCall": the app's JS takes a call
 * (botsBots/planCall.ts): it handles the call's pushes, draws the call screen and clears a stale ring. "BotRingtone": the iPhone has the
 * ringtone in its app group's Library/Sounds, so a ring may name it (a new tone comes with a new file name and a new cap). "PushTapSeen":
 * the app's JS tells two pushes that share one notification id apart (categoriesCore.ts tapSeenKey, by push id), so a push may carry a
 * collapse id (a follow's climb replaces itself in the tray); an older JS remembers a tap by notification id alone and would drop the
 * second push's press, so it never gets one. "LiveUpdate1": an Android binary that can draw the ongoing "Bots at work" notice
 * (TailzuBotsUpdate.kt), so the server may send it the data-only pushes that repost it while the app is shut; without the name
 * nothing of it is ever sent, and Android has no notice, which is what it has today. "NativeLook1": the binary carries the nlook
 * renderer, so a silent nudge may tell it a new looks catalog is out (experience/native/catalog.ts nudgeLooks) instead of making
 * it wait for the next bootstrap; without the name it simply finds out on its own, which is the behaviour with no nudge at all.
 */
export const PUSH_CAPS = ["PushTimeSensitive", "BotCall", "BotRingtone", "PushTapSeen", "LiveUpdate1", "NativeLook1"] as const;
export type PushCap = (typeof PUSH_CAPS)[number];
export const pushCapsOf = (v: unknown): PushCap[] =>
  Array.isArray(v) ? PUSH_CAPS.filter((c) => v.includes(c)) : [];

export interface PushTokenRow { userId: string; platform: "ios" | "android"; token: string; appVersion?: string | null; caps?: unknown }

/** Postgres 42703 / PostgREST PGRST204: the column is not there yet (its migration not run). */
const missingColumn = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /does not exist|could not find|schema cache/i.test(e.message ?? ""));

export interface PushTokenStore {
  /** Record this token for this account, taking it from any other account. */
  register(row: PushTokenRow): Promise<void>;
  /** Forget this token for this account. Another account's row is not touched. */
  unregister(userId: string, token: string): Promise<void>;
}

export class SupabasePushTokens implements PushTokenStore {
  constructor(private readonly sb: SupabaseClient, private readonly warn: (msg: string, err?: unknown) => void = console.warn) {}

  /** Migration 0075 (caps) not run yet: tokens are kept without it, so a deploy before the migration never loses a phone. */
  private capsMissing = false;

  async register(row: PushTokenRow): Promise<void> {
    // Taken from the others FIRST: if the upsert below then fails, the phone
    // reaches nobody until the next launch retries, which is the safe way to
    // be wrong. Service role, so RLS (own rows only) does not hide them.
    const drop = await this.sb.from("push_tokens").delete().eq("token", row.token).neq("user_id", row.userId);
    if (drop.error) this.warn("push_tokens: could not take the token from other accounts", drop.error);
    // (user, platform) is the key, so a phone that gets a new token overwrites
    // its own old one rather than adding a second.
    const base: Record<string, unknown> = {
      user_id: row.userId,
      platform: row.platform,
      token: row.token,
      app_version: row.appVersion ?? null,
      updated_at: new Date().toISOString(),
    };
    const upsert = (withCaps: boolean) => this.sb.from("push_tokens").upsert(
      withCaps ? { ...base, caps: pushCapsOf(row.caps) } : base,
      { onConflict: "user_id,platform" },
    );
    let { error } = await upsert(!this.capsMissing);
    if (error && !this.capsMissing && missingColumn(error)) {
      this.capsMissing = true;
      this.warn("push_tokens.caps missing — run migration 0075. Keeping tokens without it until then.");
      ({ error } = await upsert(false));
    }
    if (error) this.warn("push_tokens upsert failed", error);
  }

  async unregister(userId: string, token: string): Promise<void> {
    const { error } = await this.sb.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
    if (error) this.warn("push_tokens delete failed", error);
  }
}

/** For tests: the same two rules over an array. */
export class MemoryPushTokens implements PushTokenStore {
  rows: Array<{ userId: string; platform: string; token: string; appVersion: string | null; caps: PushCap[] }> = [];

  async register(row: PushTokenRow): Promise<void> {
    this.rows = this.rows.filter((r) => r.token !== row.token || r.userId === row.userId);
    this.rows = this.rows.filter((r) => !(r.userId === row.userId && r.platform === row.platform));
    this.rows.push({ userId: row.userId, platform: row.platform, token: row.token, appVersion: row.appVersion ?? null, caps: pushCapsOf(row.caps) });
  }

  async unregister(userId: string, token: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.token === token));
  }
}

const registerSchema = z.object({
  token: z.string().min(4).max(256),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(40).optional(),
  // What the binary can do with a push (PUSH_CAPS): read with pushCapsOf, so a name this server doesn't know, or a list it can't
  // read, is dropped and the token is still kept.
  caps: z.unknown().optional(),
});
const unregisterSchema = z.object({ token: z.string().min(4).max(256) });

export function registerPushTokenRoutes(app: FastifyInstance, opts: {
  /** Who is asking, from the Authorization header; null when nobody is. */
  resolveUser: (authorization: string | undefined) => Promise<{ id: string } | null>;
  /** Null when there is no database: the routes still answer, and store nothing. */
  tokens: () => PushTokenStore | null;
  rateLimit?: Record<string, unknown>;
}): void {
  const cfg = opts.rateLimit ? { config: opts.rateLimit } : {};
  const unauthorized = (reply: FastifyReply) =>
    reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });

  // Sent on every launch and on every sign-in inside a launch.
  app.post("/v1/push/register", cfg, async (req, reply) => {
    const user = await opts.resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid body" });
    }
    try {
      await opts.tokens()?.register({ userId: user.id, ...parsed.data });
    } catch (err) {
      // Silent success — the client retries on the next launch.
      req.log.warn({ err }, "push_tokens exception");
    }
    return reply.send({ ok: true });
  });

  // Sent by the app just BEFORE it signs out, while it still has a session to
  // prove whose row this is. Only the caller's own row goes: a token alone
  // proves nothing about which account may give it up.
  app.post("/v1/push/unregister", cfg, async (req, reply) => {
    const user = await opts.resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const parsed = unregisterSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid body" });
    }
    try {
      await opts.tokens()?.unregister(user.id, parsed.data.token);
    } catch (err) {
      req.log.warn({ err }, "push_tokens exception");
    }
    return reply.send({ ok: true });
  });
}
