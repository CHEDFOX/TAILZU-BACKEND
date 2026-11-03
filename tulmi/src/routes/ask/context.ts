/**
 * The person's context (src/context, docs/context.md): what X0 keeps about them, for the app to show, and forgetting it.
 *
 *   GET    /v1/context?tz=330          { kept: { people, turns, summary, updatedAt }, you, open, results, text, trimmed }: what is kept,
 *                                      and the block a model is shown now, built from it
 *   DELETE /v1/context                 everything kept, forgotten, the voice chat's talks too (src/talk): 204
 *   DELETE /v1/context/people/:name    one person forgotten: 204, or 404 when they were not kept
 *   DELETE /v1/context/turns           the asks and their summary forgotten, and the voice chat's talks (the people stay): 204
 *
 * Every route is the signed-in person's own (401 without a session). Off (CONTEXT=false): 404 context_off. What the bots were told is
 * not here: it has its own routes (Settings › Privacy, routes/bots/botsYou.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { tzOf } from "../../calendar/words.js";
import type { PersonContext } from "../../context/index.js";
import { talkSessions } from "../../talk/session.js";

export interface ContextRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  context: PersonContext | null;
}

const NAME_MAX = 80;

export function registerContextRoutes(app: FastifyInstance, deps: ContextRoutesDeps): void {
  const RL = { config: deps.rateLimit };
  const context = deps.context;

  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; c: PersonContext } | null> => {
    if (!context) { void reply.code(404).send({ code: "context_off", message: "Context is off." }); return null; }
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return { user, c: context };
  };
  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    req.log.error(err);
    return reply.code(500).send({ code: "context_failed", message: "Couldn't do that. Try again." });
  };

  app.get("/v1/context", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    try {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const [kept, built] = await Promise.all([
        w.c.kept(w.user.id),
        w.c.for(w.user, q.tz !== undefined ? { tz: tzOf(q.tz) } : {}),
      ]);
      return reply.header("cache-control", "no-store").send({
        kept, you: built.parts.you, open: built.parts.open, results: built.parts.results, text: built.text, trimmed: built.trimmed,
      });
    } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/context", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    try { await w.c.forgetAll(w.user.id); talkSessions().forget(w.user.id); return reply.code(204).send(); } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/context/people/:name", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    const name = String((req.params as { name?: string }).name ?? "").trim().slice(0, NAME_MAX);
    if (!name) return reply.code(404).send({ code: "not_found", message: "There is no such person." });
    try {
      if (!(await w.c.forgetPerson(w.user.id, name))) return reply.code(404).send({ code: "not_found", message: "There is no such person." });
      return reply.code(204).send();
    } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/context/turns", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    try { await w.c.forgetTurns(w.user.id); talkSessions().forget(w.user.id); return reply.code(204).send(); } catch (err) { return fail(req, reply, err); }
  });
}
