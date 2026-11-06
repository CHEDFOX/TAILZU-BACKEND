/**
 * Plan Ease's people: waiting on someone (step 4, PLAN_V2_WAITS) and family asks, repeats and turns (step 5, PLAN_V2_ASKS, only with
 * Spaces on). docs/plan-ease-people.md.
 *
 *   GET /v1/botsapp/bots/plan/handoff?item=pt:<id>&go=send|notcame   -> { url }   the link a wait's Send (or a visit's No) opens:
 *                                                                     WhatsApp with the follow-up, or the mail app. Reads only; the
 *                                                                     hand-off screen (bots.plan.send) notes the Send at the act door
 *
 * Everything else rides the foundation's doors: the one box (POST .../plan/box), the buttons (POST /v1/widgets/act: pt: sorted, send,
 * came, notcame; stask: ask, take, in, cant and the Undos), the page and the widget (the Needs-you cards). This file wires the two
 * services at boot: their pushes through the engine, the day's cap from Plan Ease, the app's language for a draft, a space task's
 * Done or "Can't do it" to the asks, and their jobs every minute.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { isBotError } from "../../bots/index.js";
import { isHinglish } from "../../connectors/words.js";
import { pushEngine } from "../../push/index.js";
import { PlanAsks, plugAsks, setPlanAsks, type AskNotify } from "../../botsBots/planAsks.js";
import type { PlanEase } from "../../botsBots/planEase.js";
import { addPlanSource, removePlanSource } from "../../botsBots/planSources.js";
import { planOn } from "../../botsBots/planSwitch.js";
import { spacesOn } from "../../botsBots/spacesSwitch.js";
import { planWaits, plugWaits, type WaitSend } from "../../botsBots/planWaits.js";
import { parseItem } from "../../widgets/items.js";
import type { BotsAreaDeps } from "./botsArea.js";
import type { SpaceParts } from "./botsSpaces.js";

const AREA = "/v1/botsapp/bots";

type Notify = NonNullable<ReturnType<typeof pushEngine>>["notify"];

export function registerPlanPeopleRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { spaces: SpaceParts; ease: PlanEase }): { asks: PlanAsks } {
  const RL = { config: deps.rateLimit };
  const notify = (userId: string, msg: Parameters<Notify>[1]) => pushEngine()?.notify(userId, msg);
  const hinglish = async (userId: string) => isHinglish((await pushEngine()?.candidate(userId, Date.now()))?.locale ?? "");

  // Waiting on: over the person's own calendar table; a check-back counts toward Plan Ease's six a day.
  const waits = planWaits();
  waits.wire({
    send: ((userId, msg) => notify(userId, msg as Parameters<Notify>[1])) as WaitSend,
    spend: (userId, day) => o.ease.policy.spend(userId, day),
    hinglish,
  });
  // Family asks: over the space's tasks; a Done or a "Can't do it" on one, from the person's day or the space, reaches it.
  const asks = new PlanAsks(o.spaces.spaces, {
    notify: ((userId, msg) => notify(userId, msg as Parameters<Notify>[1])) as AskNotify, blocks: o.spaces.threads.blocks,
  });
  setPlanAsks(asks);
  o.spaces.tasks.onAnswer((userId, row, status) => asks.answered(userId, row, status));
  // Both beside the person's days (planSources.ts): the open waits and the family's asks the cards and the evening note read.
  plugWaits();
  plugAsks();
  // Notes the family left on the person's own items (Work in space): the newest is that row's grey line, with its writer's tiny bot.
  addPlanSource({ name: "notes", more: (userId) => (spacesOn() ? o.spaces.work.notesOnMine(userId, "plan") : Promise.resolve(null)) });
  const stopWaits = waits.start(app.log);
  const stopAsks = asks.start(app.log);
  app.addHook("onClose", async () => { stopWaits(); stopAsks(); setPlanAsks(null); removePlanSource("notes"); });

  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) {
        if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "plan ease people: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };

  app.get(`${AREA}/plan/handoff`, RL, run(async (user, req, reply) => {
    if (!planOn("waits")) { reply.code(404); return { code: "plan_v2_off", message: "That isn't switched on here." }; }
    const q = (req.query ?? {}) as Record<string, unknown>;
    const item = parseItem(q.item);
    if (!item || item.kind !== "pt") { reply.code(400); return { code: "bad_request", message: "That can only be opened." }; }
    return { url: await waits.handoff(user.id, item.taskId, q.go === "notcame" ? "notcame" : "send") };
  }));

  return { asks };
}
