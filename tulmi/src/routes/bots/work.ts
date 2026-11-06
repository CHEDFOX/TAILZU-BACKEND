/**
 * Bots app · Work in space: on each of the four bots' pages, the things people in your spaces let you see and work on
 * (src/botsBots/work.ts, docs/spaces.md; screens in experience/bots/screens/work.ts). Registered by routes/bots/botsBots.ts on Spaces'
 * parts. Every route is the signed-in person's own; who may is checked in src/botsBots/work.ts, never here.
 *
 *   GET    /v1/botsapp/bots/work/:bot                   -> WorkRead   the people whose things you may open, per space (reads no one's bot)
 *   GET    /v1/botsapp/bots/work/:bot/mine?space=&tz=   -> { items }  your own things ("/" in a space's feed picks one); a space's
 *                                                        admin, with its id, also gets each member's who agreed to the line about
 *                                                        the admin, after theirs, their line saying whose ("Mom's · Sat 14 Nov · 7:40 pm")
 *   GET    /v1/botsapp/bots/work/:bot/person?space=&owner=   -> { space, person, items }   one person's things you may see
 *   GET    /v1/botsapp/bots/work/:bot/item?space=&owner=&item=&tz=   -> { item }   one thing (its time in your time zone, tz minutes east)
 *   POST   /v1/botsapp/bots/work/:bot/item { space, owner, item, op: time|note, day?, time?, tz?, text? }  -> { item }
 *
 * :bot is plan, notes, travel or code (404 otherwise). An item's id goes in the query or the body, never the path: a plan's look
 * like e:<id>@2026-11-14, and the other bots' are theirs to shape.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { isBotError } from "../../bots/index.js";
import type { BotsAreaDeps } from "./botsArea.js";
import type { SpaceParts } from "./botsSpaces.js";
import { AREA, shownName } from "./botsBots.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");

export function registerWorkRoutes(app: FastifyInstance, deps: BotsAreaDeps, parts: Pick<SpaceParts, "work">): void {
  const { work } = parts;
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
        req.log.error({ err: (err as Error)?.name }, "work in space: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };
  const q = (req: FastifyRequest): Record<string, unknown> => (req.query as Record<string, unknown> | undefined) ?? {};

  app.get(`${AREA}/work/:bot`, RL, run(async (user, req) => work.read(user.id, param(req, "bot"))));
  app.get(`${AREA}/work/:bot/mine`, RL, run(async (user, req) => work.mine(user.id, param(req, "bot"), { space: str(q(req).space), tz: q(req).tz })));
  app.get(`${AREA}/work/:bot/person`, RL, run(async (user, req) => work.person(user.id, param(req, "bot"), str(q(req).space), str(q(req).owner))));
  app.get(`${AREA}/work/:bot/item`, RL, run(async (user, req) => {
    const o = q(req);
    return { item: await work.item(user.id, param(req, "bot"), str(o.owner), str(o.item), str(o.space), o.tz) };
  }));
  app.post(`${AREA}/work/:bot/item`, tight(40), run(async (user, req) => {
    const b = bodyOf(req.body);
    return { item: await work.act({ id: user.id, name: shownName(user) }, param(req, "bot"), str(b.owner), str(b.item), str(b.space), { op: b.op, day: b.day, time: b.time, tz: b.tz, text: b.text }) };
  }));
}
