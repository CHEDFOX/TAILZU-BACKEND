/**
 * XODE IN THE TERMINAL: THE TERMINAL'S OWN SIGN-INS, AND THE PERSON'S LIST OF THEM (auth/deviceTokens.ts; docs/xode-cli.md).
 *
 * The terminal, signed in with its device token (Bearer xdt_…):
 *   GET    /v1/auth/device           → { id, name, platform, createdAt, lastUsedAt, user: { id, email?, name? } }  who it is signed in as
 *                                       (user.id: so the terminal's chat is the same thread as the app's, botsCodeWork/parts.ts)
 *                                      (`xode status`). 403 not_device with any other sign-in
 *   POST   /v1/auth/device/revoke    → { ok: true }  removes the token it was sent with (`xode logout`)
 *
 * The person, with any ordinary session (a device token is turned away from these by http/deviceScope.ts):
 *   GET    /v1/auth/devices          → { devices: [{ id, name, platform, kind: "cli", createdAt, lastUsedAt }] }  not removed, newest first
 *   DELETE /v1/auth/devices/:id      → { ok: true }  removes one of theirs; 404 not_found for anyone else's, or one already removed
 *
 * Times are epoch ms; lastUsedAt is null until the token is first used, and moves at most every ten minutes. A removed token
 * stops working at once on this server instance, and within a minute on the others (auth/deviceTokens.ts CACHE_MS).
 * Rate-limited per address or person, like the link routes.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { deviceTokens, type DeviceTokens } from "../../auth/deviceTokens.js";
import { getProfile } from "../../profile/store.js";

type Limit = { max: number; timeWindow: number };
export interface DeviceRouteOpts {
  /** The service; absent, the server's own. */
  tokens?: DeviceTokens;
  /** Who is asking (tests); absent, the app's own resolveUser. */
  resolve?: (authorization: string | undefined) => Promise<AuthedUser | null>;
  /** The person's own name, as they gave it (tests); absent, their profile's. */
  nameOf?: (user: AuthedUser) => Promise<string | undefined>;
  /** Off in tests that do not register the limiter. */
  limits?: boolean;
}

const LIMITS: Record<"read" | "revoke", Limit> = {
  // `xode status` and the Settings page: a person's few terminals, read now and then.
  read: { max: 60, timeWindow: 60_000 },
  revoke: { max: 20, timeWindow: 10 * 60_000 },
};

const profileName = async (user: AuthedUser): Promise<string | undefined> =>
  (await getProfile(user).catch(() => null))?.fullName?.trim() || undefined;

export function registerDeviceRoutes(app: FastifyInstance, opts: DeviceRouteOpts = {}): void {
  const tokens = () => opts.tokens ?? deviceTokens();
  const resolve = opts.resolve ?? resolveUser;
  const nameOf = opts.nameOf ?? profileName;
  const limit = (l: Limit) => (opts.limits === false ? {} : { config: { rateLimit: l } });
  const noStore = (reply: FastifyReply) => reply.header("Cache-Control", "no-store");
  const person = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolve(req.headers["authorization"]);
    if (!user) { await reply.code(401).send({ code: "unauthorized", message: "Sign in first" }); return null; }
    return user;
  };
  const terminal = async (req: FastifyRequest, reply: FastifyReply): Promise<(AuthedUser & { deviceId: string }) | null> => {
    const user = await person(req, reply);
    if (!user) return null;
    if (!user.deviceId) { await reply.code(403).send({ code: "not_device", message: "This is for Xode in the terminal." }); return null; }
    return user as AuthedUser & { deviceId: string };
  };

  app.get("/v1/auth/device", limit(LIMITS.read), async (req, reply) => {
    const user = await terminal(req, reply);
    if (!user) return reply;
    const d = await tokens().device(user.id, user.deviceId);
    noStore(reply);
    // Removed a moment ago on another instance: the same as signed out.
    if (!d) return reply.code(401).send({ code: "unauthorized", message: "Sign in first" });
    const name = (await nameOf(user)) ?? user.providerName;
    return {
      id: d.id, name: d.name, platform: d.platform, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt,
      user: { id: user.id, ...(user.email ? { email: user.email } : {}), ...(name ? { name } : {}) },
    };
  });

  app.post("/v1/auth/device/revoke", limit(LIMITS.revoke), async (req, reply) => {
    const user = await terminal(req, reply);
    if (!user) return reply;
    await tokens().revoke(user.id, user.deviceId);
    noStore(reply);
    // Already removed (on another instance, a moment ago) reads the same: the terminal is signed out either way.
    return { ok: true };
  });

  app.get("/v1/auth/devices", limit(LIMITS.read), async (req, reply) => {
    const user = await person(req, reply);
    if (!user) return reply;
    noStore(reply);
    return { devices: await tokens().list(user.id) };
  });

  app.delete<{ Params: { id: string } }>("/v1/auth/devices/:id", limit(LIMITS.revoke), async (req, reply) => {
    const user = await person(req, reply);
    if (!user) return reply;
    noStore(reply);
    if (!(await tokens().revoke(user.id, String(req.params.id ?? "")))) return reply.code(404).send({ code: "not_found" });
    return { ok: true };
  });
}
