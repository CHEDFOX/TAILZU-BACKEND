/**
 * "PLAN AROUND MY CALENDAR": THE BUSY TIMES' OWN DOOR (botsBots/planBusy.ts; docs: perms2 §2.5).
 *
 *   POST   /v1/botsapp/plan/busy { enable?, tz?, from, to, blocks: [{ s, e, allDay }] }  -> { on: true, kept }
 *   DELETE /v1/botsapp/plan/busy                                                         -> { ok: true, gone }
 *
 * THE PHONE'S `calendar.sync` POSTS HERE AND NOTHING ELSE DOES: the action's `path` is pinned to this one route on the phone,
 * so a screen bug can never send busy times to a route that reaches an AI service. Only the person's own signed-in session —
 * a bot API key is 403 (the key works, this is not for it) and a widget token is not a session anywhere.
 *
 *   `enable: true`  the first call, right after the person answered their phone's own prompt: the switch goes on AND the blocks
 *                   are stored together, so a refused prompt never leaves the switch on with no times behind it.
 *   no `enable`     a later sync. The switch must already be on; a sync for a switch that is off is refused (409), which is
 *                   what the phone sees after Delete my data or on another phone.
 *
 * The DELETE is the switch going off: every block and the flag, in one request, as the card promises.
 *
 * Logged: how many blocks arrived, and nothing of what is in them (there is nothing in them but times).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { looksLikeKey } from "../../bots/keys.js";
import { planBusy, readBusyPost, startBusySweeper } from "../../botsBots/planBusy.js";
import type { PlanPrefs } from "../../botsBots/planPrefs.js";
import { calendarReadLive } from "../../experience/bots/kit.js";
import { getConfig } from "../../config.js";
import { phoneOf } from "./botHealth.js";
import type { BotsAreaDeps } from "./botsArea.js";

export const BUSY_PATH = "/v1/botsapp/plan/busy";

const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

export function registerPlanBusyRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, o: { prefs: PlanPrefs; sweeper?: boolean }): void {
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  // A block is deleted a day after it ends, by the clock and not by anyone opening the app (the card promises it).
  if (o.sweeper !== false) {
    const stop = startBusySweeper({ log: app.log });
    app.addHook("onClose", async () => { stop(); });
  }

  /**
   * Whose session this is. `o.off` lets the request through whatever the switch says: DELETING the blocks has to work after
   * the switch goes off, or a person whose row has just disappeared is left with busy times they cannot delete (the health
   * "off" path does the same).
   */
  const who = async (req: FastifyRequest, reply: FastifyReply, o: { off?: boolean } = {}) => {
    const auth = req.headers["authorization"];
    if (looksLikeKey(auth)) { void reply.code(403).send({ code: "not_for_keys", message: "Only you can switch this on, in the app." }); return null; }
    const user = await resolveUser(auth).catch(() => null);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    // The same switch the row is drawn behind (kit canCalendarRead): a row the server would not draw is a route it refuses.
    if (!o.off && !calendarReadLive()) { void reply.code(403).send({ code: "calendar_off", message: "This isn't switched on yet." }); return null; }
    // AND THE PLATFORM'S OWN HALF. `canCalendarRead` weighs `PERM_CALENDAR_READ_ANDROID` as well, so an Android phone whose
    // half is off has no row — and must have no route either, or its busy times land here and go on to hold calls back
    // (botsBots/planCall.ts beforeRing reads the blocks). The phone always sends X-App-Platform (sdui/client/http.ts).
    if (!o.off && getConfig().PERM_CALENDAR_READ_ANDROID !== true
      && phoneOf(req.headers["x-app-platform"], req.headers["user-agent"]) === "android") {
      void reply.code(403).send({ code: "calendar_off", message: "This isn't switched on yet." });
      return null;
    }
    return user;
  };

  app.post(BUSY_PATH, tight(30), async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const b = bodyOf(req.body);
    if (b.enable !== undefined && typeof b.enable !== "boolean") return reply.code(400).send({ code: "bad_request", message: "enable is true or false." });
    let post;
    try { post = readBusyPost(b); } catch (err) { return reply.code(400).send({ code: "bad_request", message: (err as Error).message }); }
    const enable = b.enable === true;
    const row = await o.prefs.get(user.id).catch(() => null);
    if (!enable && row?.calendar_busy !== true) {
      return reply.code(409).send({ code: "busy_off", message: "Turn this on from the switch in the app." });
    }
    try {
      const kept = await planBusy().replace(user.id, post.from, post.to, post.blocks);
      // Both, or neither: the blocks first, then the switch, and the blocks go again if the switch cannot be written.
      if (enable && row?.calendar_busy !== true) {
        try { await o.prefs.patch(user.id, { calendar_busy: true }); }
        catch (err) { await planBusy().clear(user.id).catch(() => 0); throw err; }
      }
      req.log.info({ blocks: kept }, "plan: busy times stored");
      return reply.header("cache-control", "no-store").send({ on: true, kept });
    } catch (err) {
      req.log.error({ err: (err as Error)?.name }, "plan: busy times failed");
      return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
    }
  });

  app.delete(BUSY_PATH, tight(30), async (req, reply) => {
    const user = await who(req, reply, { off: true });
    if (!user) return reply;
    try {
      const gone = await planBusy().clear(user.id);
      await o.prefs.patch(user.id, { calendar_busy: false }).catch(() => undefined);
      req.log.info({ blocks: gone }, "plan: busy times deleted");
      return reply.header("cache-control", "no-store").send({ ok: true, gone });
    } catch (err) {
      req.log.error({ err: (err as Error)?.name }, "plan: busy times delete failed");
      return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
    }
  });
}
