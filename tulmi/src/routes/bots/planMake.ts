/**
 * "PLAN SOMETHING": ITS ROUTES (PLAN_V2_MAKE; botsBots/planMakeService.ts, planMake.ts; docs/plan-ease.md "Plan something").
 *
 *   GET  /v1/botsapp/bots/plan/make?tz=           MakeSetup: today, the people to pick (You first), follow-through on, the AI's state
 *   POST /v1/botsapp/bots/plan/make/draft         { words, tz, d?, list?, at?, day?, keep? } -> MakeDraftReply   (20 a minute)
 *   POST /v1/botsapp/bots/plan/make/check         { list, d?, at?, tz, day0?, fix?: { item, id }, drop? } -> MakeCheckReply   (60)
 *   POST /v1/botsapp/bots/plan/make               { key, list, tz } -> MadeView   Done (20)
 *   POST /v1/botsapp/bots/plan/make/undo          { key, n } -> { ok, removed }   (20)
 *
 * Off (PLAN_V2_MAKE or PLAN_V2_PAGE): 404 make_off. Every answer is no-store. The words are only ever in a POST body (never a URL), and
 * no log line carries words, titles, names, ids of others or places: a fix_first 400 (its words can name a contact) is answered, never
 * logged; anything else unexpected is logged by its error's name only.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { isBotError } from "../../bots/index.js";
import type { PlanEase } from "../../botsBots/planEase.js";
import { planCapture } from "../../botsBots/planCapture.js";
import { planFollows } from "../../botsBots/planFollow.js";
import { MAKE } from "../../botsBots/planMake.js";
import { PlanMake, setPlanMake } from "../../botsBots/planMakeService.js";
import { followOn, makeOn } from "../../botsBots/planSwitch.js";
import type { BotsAreaDeps } from "./botsArea.js";

const OFF = { code: "make_off", message: "That isn't switched on here." };

export function registerPlanMakeRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, o: { ease: PlanEase; make?: PlanMake }): PlanMake {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  // Over this Plan Ease, follow-through's people (wired just before, routes/bots/planFollows.ts) and capture's reader and budget.
  const make = o.make ?? new PlanMake({
    ease: () => o.ease, calendar: () => o.ease.calendar, people: () => (followOn() ? planFollows().people : null), capture: planCapture,
  });
  setPlanMake(make);
  app.addHook("onClose", async () => { setPlanMake(null); });

  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]).catch(() => null);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      void reply.header("cache-control", "no-store");
      if (!makeOn()) return reply.code(404).send(OFF);
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) {
        if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "plan make: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };
  const tzQ = (req: FastifyRequest) => (req.query as Record<string, unknown> | undefined)?.tz;

  app.get(MAKE, RL, run(async (user, req) => make.setup(user.id, tzQ(req))));
  app.post(`${MAKE}/draft`, tight(20), run(async (user, req) => make.draft(user.id, req.body, { log: req.log })));
  app.post(`${MAKE}/check`, tight(60), run(async (user, req) => make.check(user.id, req.body)));
  app.post(MAKE, tight(20), run(async (user, req) => make.done(user.id, req.body, { log: req.log })));
  app.post(`${MAKE}/undo`, tight(20), run(async (user, req) => make.undo(user.id, req.body, { log: req.log })));
  return make;
}
