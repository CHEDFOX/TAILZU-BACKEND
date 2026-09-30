/**
 * Which account a phone's push token belongs to.
 *
 *   POST /v1/push/register    { token, platform, appVersion? } — this phone is mine
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

export interface PushTokenStore {
  /** Record this token for this account, taking it from any other account. */
  register(row: { userId: string; platform: "ios" | "android"; token: string; appVersion?: string | null }): Promise<void>;
  /** Forget this token for this account. Another account's row is not touched. */
  unregister(userId: string, token: string): Promise<void>;
}

export class SupabasePushTokens implements PushTokenStore {
  constructor(private readonly sb: SupabaseClient, private readonly warn: (msg: string, err?: unknown) => void = console.warn) {}

  async register(row: { userId: string; platform: "ios" | "android"; token: string; appVersion?: string | null }): Promise<void> {
    // Taken from the others FIRST: if the upsert below then fails, the phone
    // reaches nobody until the next launch retries, which is the safe way to
    // be wrong. Service role, so RLS (own rows only) does not hide them.
    const drop = await this.sb.from("push_tokens").delete().eq("token", row.token).neq("user_id", row.userId);
    if (drop.error) this.warn("push_tokens: could not take the token from other accounts", drop.error);
    // (user, platform) is the key, so a phone that gets a new token overwrites
    // its own old one rather than adding a second.
    const { error } = await this.sb.from("push_tokens").upsert(
      {
        user_id: row.userId,
        platform: row.platform,
        token: row.token,
        app_version: row.appVersion ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform" },
    );
    if (error) this.warn("push_tokens upsert failed", error);
  }

  async unregister(userId: string, token: string): Promise<void> {
    const { error } = await this.sb.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
    if (error) this.warn("push_tokens delete failed", error);
  }
}

/** For tests: the same two rules over an array. */
export class MemoryPushTokens implements PushTokenStore {
  rows: Array<{ userId: string; platform: string; token: string; appVersion: string | null }> = [];

  async register(row: { userId: string; platform: "ios" | "android"; token: string; appVersion?: string | null }): Promise<void> {
    this.rows = this.rows.filter((r) => r.token !== row.token || r.userId === row.userId);
    this.rows = this.rows.filter((r) => !(r.userId === row.userId && r.platform === row.platform));
    this.rows.push({ userId: row.userId, platform: row.platform, token: row.token, appVersion: row.appVersion ?? null });
  }

  async unregister(userId: string, token: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.token === token));
  }
}

const registerSchema = z.object({
  token: z.string().min(4).max(256),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(40).optional(),
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
