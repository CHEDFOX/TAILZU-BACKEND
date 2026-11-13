/**
 * A FITNESS BOT'S DAYS, OVER HTTP (src/bots/healthService.ts; docs: perms §4.5).
 *
 *   POST /v1/bots/:slug/health/days { enable?, platform?, tz, days[] }  -> { on: true, kept }
 *   GET  /v1/bots/:slug/health/moves                                    -> { moves }   the counts the Moves line draws
 *
 * These two live here, away from `routes/bots/bots.ts`, for the same reason `bots/healthService.ts` lives away from
 * `bots/service.ts`: that file hosts `POST /v1/bots/:slug/ask`, which sends a turn to an AI service, and nothing in it may
 * be able to reach a step count. `tests/health-never.test.ts` names it on its NEVER list, and this file on the short list of
 * those that may.
 *
 * The 31-day sweeper is started here too: the days are kept by the clock, not by anyone opening the app.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { type Bots, isBotError } from "../../bots/index.js";
import { healthAllowed } from "../../bots/healthGate.js";
import { startHealthSweeper } from "../../bots/healthDays.js";
import { attachHealth } from "../../bots/healthService.js";
import { looksLikeKey } from "../../bots/keys.js";

export interface BotHealthRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when BOTS is off. */
  bots: Bots | null;
}

const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

/**
 * Which phone is asking: what the body says, else what the agent says, as `routes/ask/assistant.ts` and
 * `routes/app/nativeLooks.ts` both read it. It decides which switch is weighed, so an Android phone is never let in
 * through the iPhone's (docs: perms §4.2).
 */
export const phoneOf = (said: unknown, userAgent: unknown): "ios" | "android" =>
  (said === "ios" || said === "android" ? said : /okhttp|dalvik|android/i.test(String(userAgent ?? "")) ? "android" : "ios");

export function registerBotHealthRoutes(app: FastifyInstance, deps: BotHealthRoutesDeps): void {
  const bots = deps.bots;
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const health = bots ? attachHealth(bots) : null;

  // The 31 days a fitness bot's page counts are kept by the clock, not by anyone opening the app (docs: perms §4.5).
  const stopHealthSweep = startHealthSweeper({ log: app.log });
  app.addHook("onClose", async () => { stopHealthSweep(); });

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "bots_off", message: "Bots are not switched on." });
  const noSession = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  const slugOf = (req: FastifyRequest): string => String((req.params as { slug?: unknown }).slug ?? "").toLowerCase();

  /** Never the error's own words, and never a value: a health route's log says how many days, nothing of what is in them. */
  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    req.log.error({ err: (err as Error)?.name }, "bots: health request failed");
    return reply.code(500).send({ code: "bot_failed", message: "Couldn't do that just now." });
  };

  /**
   * The phone's `health.sync` posts here, and NOTHING ELSE does: this is the only route that stores a health number and the
   * only thing in the whole server that can turn `skills.health` on.
   *
   *   the owner's own signed-in session only — a bot API key is 403, not 401: the key works, this is not for it
   *   a bot they made — a built-in is 403, someone else's is 404 (it is not said to exist)
   *   a fitness bot — a bot whose name and purpose say nothing about fitness cannot be enabled (403)
   *   the switch for this phone and account — PERM_HEALTH_IOS / PERM_HEALTH_ANDROID and their lists (403)
   *
   * The body's `tz` is the phone's offset; the days are already in its own local days, so nothing here reads it. Logged:
   * how many days arrived, never a step count, a workout or a day.
   */
  app.post("/v1/bots/:slug/health/days", tight(30), async (req, reply) => {
    if (!bots || !health) return off(reply);
    const auth = req.headers["authorization"];
    if (looksLikeKey(auth)) return reply.code(403).send({ code: "not_for_keys", message: "Only you can switch this on, in the app." });
    const user = await resolveUser(auth);
    if (!user) return noSession(reply);
    const b = bodyOf(req.body);
    if (b.enable !== undefined && typeof b.enable !== "boolean") return reply.code(400).send({ code: "bad_request", message: "enable is true or false." });
    if (b.platform !== undefined && b.platform !== "ios" && b.platform !== "android") return reply.code(400).send({ code: "bad_request", message: 'platform is "ios" or "android".' });
    const platform = phoneOf(b.platform, req.headers["user-agent"]);
    if (!healthAllowed(platform, user.id)) return reply.code(403).send({ code: "health_off", message: "This isn't switched on yet." });
    try {
      const r = await health.sync(user.id, slugOf(req), b, { enable: b.enable === true });
      req.log.info({ bot: slugOf(req), days: r.kept }, "bots: health days stored");
      return reply.send(r);
    } catch (err) { return fail(req, reply, err); }
  });

  /**
   * The counts for the Moves line (docs: perms §4.3): the owner's own signed-in session, their own bot, and only while its
   * switch is on. Never through a bot API key, never on the public card, and never a raw day: how many workouts, when the
   * last one was and how long, the steps, and when the numbers came in.
   */
  app.get("/v1/bots/:slug/health/moves", RL, async (req, reply) => {
    if (!bots || !health) return off(reply);
    const auth = req.headers["authorization"];
    if (looksLikeKey(auth)) return reply.code(403).send({ code: "not_for_keys", message: "This is only for you, in the app." });
    const user = await resolveUser(auth);
    if (!user) return noSession(reply);
    try {
      const mine = await bots.resolve(user.id, slugOf(req));
      if (!mine?.stored?.skills.health) return reply.header("cache-control", "no-store").send({ moves: null });
      return reply.header("cache-control", "no-store").send({ moves: await health.moves(user.id, mine.stored.id) });
    } catch (err) { return fail(req, reply, err); }
  });
}
