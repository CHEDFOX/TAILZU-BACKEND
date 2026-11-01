/**
 * Routines (src/routines, docs/routines.md): a bot does something on a schedule, without being asked each time.
 *
 *   GET    /v1/routines                        { routines: [...], max, choices }: the person's routines (on first, soonest first) and the bots
 *                                              that can take one
 *   POST   /v1/routines/draft { message, tz, bot? }
 *                                              what the words ask for, as a card: { draft } (schedule, task, when, next, the bot picked, the
 *                                              choices, a token for Save), or 422 not_a_routine. Nothing is kept
 *   POST   /v1/routines { token, bot? } | { task, schedule, tz, bot }
 *                                              saved and on: 201 { routine }
 *   PATCH  /v1/routines/:id { status?, task?, schedule?, tz?, bot? }
 *                                              pause ("paused"), resume ("on"), or change it: { routine }
 *   DELETE /v1/routines/:id                    gone: 204
 *   POST   /v1/routines/:id/run                once now, its schedule unchanged: { routine } (429 too_soon within a minute of its last run)
 *
 * Every route is the signed-in person's own (401 without a session); another person's routine is 404. Off (no bots platform, or
 * ROUTINES=false): 404 routines_off.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { tzOf } from "../calendar/words.js";
import { RoutineError, type Routines } from "../routines/index.js";

export interface RoutineRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  routines: Routines | null;
}

const MESSAGE_MAX = 2000;
const ID = /^[0-9a-f-]{36}$/i;

export function registerRoutineRoutes(app: FastifyInstance, deps: RoutineRoutesDeps): void {
  const RL = { config: deps.rateLimit };
  const routines = deps.routines;

  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; r: Routines } | null> => {
    if (!routines) { void reply.code(404).send({ code: "routines_off", message: "Routines are off." }); return null; }
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return { user, r: routines };
  };
  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof RoutineError) return reply.code(err.status).send({ code: err.code, message: err.message });
    const status = (err as { status?: unknown })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "bad_request", message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ code: "routines_failed", message: "Couldn't do that. Try again." });
  };
  const idOf = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!ID.test(id)) { void reply.code(404).send({ code: "not_found", message: "There is no such routine." }); return null; }
    return id;
  };

  app.get("/v1/routines", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    try {
      const [list, choices] = await Promise.all([w.r.list(w.user.id), w.r.choices(w.user.id)]);
      return reply.header("cache-control", "no-store").send({ routines: list, max: w.r.limit, choices });
    } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/routines/draft", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    const b = (req.body ?? {}) as { message?: unknown; tz?: unknown; bot?: unknown };
    const message = typeof b.message === "string" ? b.message.trim().slice(0, MESSAGE_MAX) : "";
    if (!message) return reply.code(400).send({ code: "bad_request", message: "message is what the person said." });
    try {
      const draft = await w.r.draft(w.user.id, message, tzOf(b.tz), typeof b.bot === "string" ? b.bot : undefined);
      if (!draft) return reply.code(422).send({ code: "not_a_routine", message: "Say how often, like “every morning at 8” or “every Friday”." });
      return reply.send({ draft });
    } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/routines", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    try {
      const routine = await w.r.create(w.user.id, (req.body ?? {}) as Record<string, unknown>);
      return reply.code(201).send({ routine });
    } catch (err) { return fail(req, reply, err); }
  });

  app.patch("/v1/routines/:id", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    const id = idOf(req, reply);
    if (!id) return reply;
    try {
      return reply.send({ routine: await w.r.update(w.user.id, id, (req.body ?? {}) as Record<string, unknown>) });
    } catch (err) { return fail(req, reply, err); }
  });

  // The apps' screens send POST: a pause or resume through the kit's call() (PATCH is not one of its verbs).
  app.post("/v1/routines/:id/status", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    const id = idOf(req, reply);
    if (!id) return reply;
    try {
      return reply.send({ routine: await w.r.update(w.user.id, id, { status: (req.body as { status?: unknown } | null)?.status }) });
    } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/routines/:id", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    const id = idOf(req, reply);
    if (!id) return reply;
    try {
      await w.r.remove(w.user.id, id);
      return reply.code(204).send();
    } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/routines/:id/run", RL, async (req, reply) => {
    const w = await who(req, reply);
    if (!w) return reply;
    const id = idOf(req, reply);
    if (!id) return reply;
    try {
      return reply.send({ routine: await w.r.runNow(w.user.id, id) });
    } catch (err) { return fail(req, reply, err); }
  });
}
