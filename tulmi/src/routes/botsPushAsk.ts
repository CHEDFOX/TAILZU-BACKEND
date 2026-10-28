/**
 * Bots app · the "turn on notifications" ask (screens/pushAsk.ts): today's app asked the first time Stats showed (the bootstrap's
 * push.ask); the Bots app asks on a phone's Home the first time a bot is working or needs the person, which is when a ping is worth
 * having. Once answered, allowed or "Not now", it never comes back (What pings you still says when notifications are off).
 *
 *   GET /v1/bots/push-ask                      { due }: not answered yet (personality.botsPushAskAt unset)
 *   PUT /v1/bots/push-ask { answer }           answered: "granted" or "dismissed" (once; a second PUT keeps the first)
 *
 * The phone decides the rest itself: the card shows only while the phone says notifications are not allowed (checkPermission).
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { getPersonality, updatePersonality } from "../personality/store.js";
import type { BotsAreaDeps } from "./botsArea.js";

export const PUSH_ASK_ROUTE = "/v1/bots/push-ask";

export function registerBotsPushAskRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">): void {
  const rl = { config: deps.rateLimit };
  const unauthorized = { code: "unauthorized", message: "Missing or invalid token" };

  app.get(PUSH_ASK_ROUTE, rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return reply.code(401).send(unauthorized);
    const personality = await getPersonality(user).catch(() => null);
    // Unknown (the store failed): not due. An ask that never comes is better than one that keeps coming back.
    return reply.header("cache-control", "no-store").send({ due: !!personality && !personality.botsPushAskAt });
  });

  app.put(PUSH_ASK_ROUTE, rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return reply.code(401).send(unauthorized);
    const said = (req.body as { answer?: unknown } | null)?.answer;
    const answer = said === "granted" ? "granted" : "dismissed";
    try {
      await updatePersonality(user, (p) => (p.botsPushAskAt ? p : { ...p, botsPushAskAt: new Date().toISOString(), botsPushAnswer: answer }));
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error({ error: (err as Error)?.message }, "push ask: not saved");
      return reply.code(500).send({ code: "internal", message: "Couldn't save that" });
    }
  });
}
