/**
 * Bots app · the Plan and Travel bots' outside data: a trip's weather, main places and stays compared, and where Plan Ease's day starts
 * (src/botsBots/tripExtras.ts, trips.ts, planTravel.ts; src/places for the providers). Registered by routes/botsBots.ts with its parts.
 *
 *   GET    /v1/botsapp/bots/trip/:id/extras?tz=        -> { extras }        dates, weather, places, stays compared; from memory at once, the
 *                                                         rest after (the screen is told on "trip:<id>")
 *   POST   /v1/botsapp/bots/trip/:id/spots { text }    -> { trip }          one of the trip's main places;  DELETE .../spots/:i
 *   POST   /v1/botsapp/bots/trip/:id/stays { name?, url?, area?, price?, rating?, label?, from? }  -> 201 { trip }
 *                                                         a stay to compare: typed by the person, or (from: "chat", label) a link the
 *                                                         Travel bot opened
 *   DELETE /v1/botsapp/bots/trip/:id/stays/:stay       -> { trip }
 *   PUT    /v1/botsapp/bots/trip/:id/stays/:stay/pick  -> { trip }          the person's pick (again: not any more)
 *   POST   /v1/botsapp/bots/trip/:id/stays/find        -> 202 { finding }   a web search for stays, in the background
 *   PUT    /v1/botsapp/bots/plan/home { home }         -> { home }          where the day starts, for travel times from home ("" forgets it)
 *
 * Nothing books or pays. Everything is the signed-in person's own; another's trip is "not found". Bodies and places are never logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { isBotError } from "../bots/index.js";
import type { BotsAreaParts } from "../botsBots/index.js";
import type { BotsAreaDeps } from "./botsArea.js";

const AREA = "/v1/botsapp/bots";
type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");

export function registerBotsTripRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, parts: BotsAreaParts): void {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) {
        if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "bots area: trip request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };

  app.get(`${AREA}/trip/:id/extras`, RL, run(async (user, req) => {
    const tz = Number((req.query as Record<string, unknown> | undefined)?.tz ?? 330);
    const trip = await parts.trips.get(user.id, param(req, "id"));
    return { extras: await parts.tripExtras.read(user.id, trip, { tz: Number.isFinite(tz) ? tz : 330 }) };
  }));

  app.post(`${AREA}/trip/:id/spots`, RL, run(async (user, req) => ({ trip: await parts.trips.addSpot(user.id, param(req, "id"), bodyOf(req.body).text) })));
  app.delete(`${AREA}/trip/:id/spots/:i`, RL, run(async (user, req) => ({ trip: await parts.trips.dropSpot(user.id, param(req, "id"), Number(param(req, "i"))) })));

  app.post(`${AREA}/trip/:id/stays`, RL, run(async (user, req, reply) => {
    const b = bodyOf(req.body);
    const trip = await parts.trips.addStay(user.id, param(req, "id"), b, b.from === "chat" ? "chat" : "you");
    reply.code(201);
    return { trip };
  }));
  app.delete(`${AREA}/trip/:id/stays/:stay`, RL, run(async (user, req) => ({ trip: await parts.trips.dropStay(user.id, param(req, "id"), param(req, "stay")) })));
  app.put(`${AREA}/trip/:id/stays/:stay/pick`, RL, run(async (user, req) => ({ trip: await parts.trips.pickStay(user.id, param(req, "id"), param(req, "stay")) })));

  app.post(`${AREA}/trip/:id/stays/find`, tight(10), run(async (user, req, reply) => {
    const trip = await parts.trips.get(user.id, param(req, "id"));
    if (!parts.tripExtras.canFind) {
      reply.code(503);
      return { code: "stays_off", message: "Looking for stays isn't switched on here." };
    }
    if (!parts.tripExtras.find(user.id, trip)) {
      reply.code(409);
      return { code: "finding", message: "Already looking for stays." };
    }
    reply.code(202);
    return { finding: true };
  }));

  app.put(`${AREA}/plan/home`, RL, run(async (user, req) => ({ home: await parts.plan.home(user.id, bodyOf(req.body).home) })));
}
