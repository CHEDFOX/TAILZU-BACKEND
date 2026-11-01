/**
 * The everyday tools' cards (src/everyday, docs/everyday.md):
 *
 *   GET /v1/everyday/finds/:id    { cards }: what the flights, hotels, currency and weather tools found for one answer (its `finds`), for
 *                                 its owner, for a day after. 404 when it is not theirs, or gone.
 *   GET /v1/everyday              { on: { flights, stays, money, weather } }: which are on (the Ask page's live row reads it)
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { EVERYDAY_KINDS, type Everyday } from "../everyday/index.js";

const ID = /^[0-9a-f-]{36}$/i;

export function registerEverydayRoutes(app: FastifyInstance, deps: { rateLimit: { rateLimit: { max: number; timeWindow: number } }; everyday: Everyday | null }): void {
  const RL = { config: deps.rateLimit };
  const unauthorized = { code: "unauthorized", message: "Missing or invalid token" };

  app.get("/v1/everyday", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return reply.code(401).send(unauthorized);
    const e = deps.everyday;
    return reply.send({ on: Object.fromEntries(EVERYDAY_KINDS.map((k) => [k, !!e && e.on(k)])) });
  });

  app.get<{ Params: { id: string } }>("/v1/everyday/finds/:id", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return reply.code(401).send(unauthorized);
    const cards = ID.test(req.params.id) && deps.everyday ? deps.everyday.found(user.id, req.params.id) : null;
    if (!cards) return reply.code(404).send({ code: "not_found", message: "Those results have gone. Ask again." });
    return reply.header("cache-control", "private, max-age=600").send({ cards });
  });
}
