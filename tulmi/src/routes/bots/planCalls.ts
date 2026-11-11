/**
 * "X0 is calling": the call's doors (botsBots/planCall.ts; docs/plan-ease.md "Calls"). The ringing notification's Answer and a tap open
 * the call screen (bots.plan.call), which reads and answers here; its Not now calls decline in the background.
 *
 *   GET    /v1/botsapp/bots/plan/calls/:id             -> CallView                                    the call screen's read
 *   POST   /v1/botsapp/bots/plan/calls/:id/answer { talk? }  -> { state, opening?, voice?, answeredAt?, fresh? }   ringing (or missed, inside
 *                                                       the grace) becomes answered; `talk` counts only with the person's AI permission
 *   POST   /v1/botsapp/bots/plan/calls/:id/decline     -> { ok, state }   Not now: always 200 for a signed-in person, even for a call
 *                                                       that is over or unknown (the notification's button would say it failed)
 *   POST   /v1/botsapp/bots/plan/calls/:id/end         -> { ok, state }   End call (idempotent)
 *   POST   /v1/botsapp/bots/plan/calls/:id/back        -> 201 { call }    Call back: the person's own call about the same thing
 *   POST   /v1/botsapp/bots/plan/calls/:id/say { words, streamId? }  -> { text, spoken, voice, ended, turn }   one turn by voice, answered
 *                                                       by the Plan Ease chat (its consent gate, its guard, its budget)
 *   GET    /v1/botsapp/bots/plan/calls/:id/voice/:n    -> audio           turn n read aloud (0 the opening), in the person's voice
 *
 * A call is only ever its owner's: every read matches the person too, and someone else's id is unknown. An id that is not a uuid never
 * reaches the database (the column is a uuid: it would fail the query). Bodies are never logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { isBotError } from "../../bots/index.js";
import { scrub } from "../../bots/run.js";
import type { BotEvent } from "../../bots/types.js";
import type { BotChat } from "../../botsBots/chat.js";
import { CALLS, MAX_TURNS, planCalls } from "../../botsBots/planCall.js";
import { callContext, endsCall, spokenOf } from "../../botsBots/planCallWords.js";
import { getConfig } from "../../config.js";
import type { Guard } from "../../guard/index.js";
import { guarded } from "../../http/guarded.js";
import { openAskStream } from "../../live/askStream.js";
import { AI_CONSENT_CODE, AI_CONSENT_TEXT, aiAllowedFor } from "../../privacy/aiGate.js";
import { setCallHook } from "../../push/engine.js";
import { enforceQuota } from "../../usage/metering.js";
import { speakFor } from "../writing/speak.js";
import type { BotsAreaDeps } from "./botsArea.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
/** The call's id when it is a uuid; null otherwise (treated as no such call). */
const idOf = (req: FastifyRequest): string | null => { const id = param(req, "id"); return UUID.test(id) ? id.toLowerCase() : null; };

const NO_CALL = { code: "not_found", message: "That call isn't there any more." };
/** What the bot says when the call closes without asking the chat (the person said they're done, or the turns ran out). */
const BYE = "Okay. Talk soon.";
const ENOUGH = "I'll leave it there. It's all on your Plan.";

export function registerPlanCallRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, o: { chat: BotChat | null; guard: Guard }): void {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const calls = planCalls();

  // The engine asks the call before a leave-by or a bill due today goes; the chat keeps how a call began; the voice reads it aloud.
  calls.wire({ chat: o.chat, speak: (user, text) => speakFor(user, text, getConfig()), log: app.log });
  setCallHook(calls.hook);
  const stop = calls.start(app.log);
  app.addHook("onClose", async () => { stop(); setCallHook(null); });

  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return user;
  };
  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) {
      const { retryAfterSec: _r, ...detail } = err.detail ?? {};
      void _r;
      return reply.code(err.status).send({ code: err.code, message: err.message, ...detail });
    }
    req.log.error({ err: (err as Error)?.name }, "calls: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };
  /** A route for one of the person's calls: 401 without a session, 404 for an id that isn't a uuid. */
  const run = (fn: (user: AuthedUser, id: string, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>, badId: (reply: FastifyReply) => unknown = (reply) => { reply.code(404); return NO_CALL; }) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await who(req, reply);
      if (!user) return reply;
      const id = idOf(req);
      try {
        const out = id ? await fn(user, id, req, reply) : badId(reply);
        return reply.sent ? reply : reply.header("cache-control", "no-store").send(out);
      } catch (err) { return fail(req, reply, err); }
    };

  app.get(`${CALLS}/:id`, RL, run(async (user, id, _req, reply) => (await calls.view(user.id, id)) ?? (reply.code(404), NO_CALL)));

  app.post(`${CALLS}/:id/answer`, RL, run(async (user, id, req, reply) => (await calls.answer(user, id, bodyOf(req.body).talk)) ?? (reply.code(404), NO_CALL)));

  // Not now runs in the background from the notification, which says "Couldn't do that from here" on anything but a 2xx: so every answer
  // to a signed-in person is 200, a call that is over or unknown included. A failure is still 200: the ring then simply runs out.
  app.post(`${CALLS}/:id/decline`, RL, run(async (user, id, req) => {
    try { return await calls.decline(user.id, id); } catch (err) { req.log.warn({ err: (err as Error)?.name }, "calls: decline failed"); return { ok: true, state: "gone" }; }
  }, () => ({ ok: true, state: "gone" })));

  app.post(`${CALLS}/:id/end`, RL, run(async (user, id, _req, reply) => (await calls.end(user.id, id)) ?? (reply.code(404), NO_CALL)));

  app.post(`${CALLS}/:id/back`, tight(10), run(async (user, id, _req, reply) => {
    const r = await calls.back(user.id, id);
    if (r === "off") { reply.code(404); return { code: "calls_off", message: "Calls aren't switched on here." }; }
    if (!r) { reply.code(404); return NO_CALL; }
    reply.code(201);
    return r;
  }));

  // One turn by voice: the person's words to the Plan Ease chat, with the call's facts beside them, and its reply as it is said aloud.
  app.post(`${CALLS}/:id/say`, tight(30), async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const id = idOf(req);
    let row;
    try { row = id ? await calls.get(user.id, id) : null; } catch (err) { return fail(req, reply, err); }
    if (!id || !row) return reply.code(404).send(NO_CALL);
    if (row.state !== "answered") return reply.code(409).send({ code: "call_over", message: "The call has ended." });
    if (!(await aiAllowedFor(user.id))) return reply.code(403).send({ code: AI_CONSENT_CODE, message: AI_CONSENT_TEXT });
    if (!o.chat) return reply.code(404).send({ code: "bots_off", message: "Bots are not switched on." });
    const body = bodyOf(req.body);
    const words = typeof body.words === "string" ? body.words.trim() : "";
    if (!words || words.length > 1000) return reply.code(400).send({ code: "bad_request", message: "Say something first." });
    const chat = o.chat;
    const path = (n: number) => `${CALLS}/${id}/voice/${n}`;

    // The person is done, or the turns ran out: a goodbye, no model call, and the call is over.
    const closing = row.turns.length >= MAX_TURNS ? ENOUGH : endsCall(words) ? BYE : null;
    if (closing) {
      try {
        const n = await calls.said(user.id, id, closing);
        calls.prepare(user, id, n, closing);
        await calls.end(user.id, id, "done");
        return reply.send({ text: closing, spoken: closing, voice: path(n), ended: true, turn: n });
      } catch (err) { return fail(req, reply, err); }
    }

    // As the Plan Ease chat's own route does (routes/bots/botsBots.ts): the words streamed to a screen that listens, under the guard.
    // No Activity "ask" row: a call's turns are the call's.
    const stream = openAskStream(user.id, body.streamId, { guard: (t) => scrub(t).cleaned });
    const live = stream ? {
      onText: (piece: string) => stream.text(piece), onReset: () => stream.reset(),
      emit: (e: BotEvent) => { if (e.t === "status") stream.step(e.stage); else if (e.t === "text") stream.whole(e.text); },
    } : {};
    const seed = row.seed, opening = row.opening, tz = row.tz_min;
    const stopped = () => { const said = stream!.said; stream!.end(); return reply.code(409).send({ code: "stopped", message: "Stopped.", text: said }); };
    try {
      const out = await guarded(o.guard, req, reply, user, "ask", async (halt) => {
        const r = await chat.send(user.id, "plan", words, halt, [{ name: "This call", kind: "call", text: callContext(seed, opening, tz) }], live);
        const spoken = spokenOf(r.answer.text);
        const n = await calls.said(user.id, id, spoken);
        calls.prepare(user, id, n, spoken);
        return { status: 200, body: { text: r.answer.text, spoken, voice: path(n), ended: false, turn: n } };
      }, { replayUnkeyed: false, ...(stream ? { signal: stream.signal } : {}) });
      if (stream?.stopped && !reply.sent) return stopped();
      stream?.end();
      return out;
    } catch (err) {
      if (stream?.stopped && !reply.sent) return stopped();
      stream?.end();
      return fail(req, reply, err);
    }
  });

  // Turn n read aloud (0: the opening), in the person's own voice and speed, under their quota; made ahead at answer and say time.
  app.get(`${CALLS}/:id/voice/:n`, RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const id = idOf(req);
    const n = Number(param(req, "n"));
    if (!id || !Number.isInteger(n) || n < 0 || n > 99) return reply.code(404).send(NO_CALL);
    if (!(await aiAllowedFor(user.id))) return reply.code(403).send({ code: AI_CONSENT_CODE, message: AI_CONSENT_TEXT });
    try {
      const quota = await enforceQuota(user);
      if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
      const out = await calls.voice(user, id, n);
      if (!out) return reply.code(404).send(NO_CALL);
      if ("status" in out) {
        return out.status === 429
          ? reply.code(429).send({ code: "quota_exceeded", message: out.message })
          : reply.code(500).send({ code: "tts_failed", message: "Couldn't read that aloud." });
      }
      return reply.header("content-type", out.contentType).header("cache-control", "no-store").send(out.audio);
    } catch (err) { return fail(req, reply, err); }
  });
}
