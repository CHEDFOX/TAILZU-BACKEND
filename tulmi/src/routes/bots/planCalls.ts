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
 *                                                       by the Plan Ease chat (its consent gate, its guard; a call is never held to a budget)
 *   GET    /v1/botsapp/bots/plan/calls/:id/voice/:n    -> audio           turn n read aloud (0 the opening), in the person's voice
 *
 * THE REALTIME CALL (botsBots/planCallLive.ts), only for a build that declares it can:
 *   POST   /v1/botsapp/bots/plan/calls/:id/live { sdp, resume? }  -> { sdp, maxSec }   the SDP exchange; the server holds the session
 *   POST   /v1/botsapp/bots/plan/calls/:id/live/ready  -> { ok }   the phone is connected: the bot speaks the opening
 *   POST   /v1/botsapp/bots/plan/calls/:id/live/stop   -> { ok }   the app went to the background, or a cellular call came in
 *
 * A call is only ever its owner's: every read matches the person too, and someone else's id is unknown. An id that is not a uuid never
 * reaches the database (the column is a uuid: it would fail the query). Bodies, SDP and transcripts are never logged.
 *
 * MONEY RIDES ON THE REALTIME SWITCH. Where the live call is switched on for this person (`realtimeFor`), no door asks about cost: a
 * call is never refused, shortened or stopped for it — not the plan quota, not the spend gate, not Plan Ease's day budget — and what
 * it cost is recorded on the call's row for the owner to read instead. Everywhere else, which is every build today, the turn call is
 * held to all three exactly as it always has been. The AI permission is asked on every door, whichever way that falls.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { isBotError } from "../../bots/index.js";
import { scrub } from "../../bots/run.js";
import type { BotEvent } from "../../bots/types.js";
import type { BotChat } from "../../botsBots/chat.js";
import { CALLS, MAX_TURNS, planCalls, realtimeFor } from "../../botsBots/planCall.js";
import { planCallLive } from "../../botsBots/planCallLive.js";
import { GOODBYE_LEAD_SEC, LIVE_MAX } from "../../botsBots/planCallLiveWords.js";
import { setCallRinger, onAiConsentOff } from "../../botsBots/planCallSeam.js";
import { endsCall, spokenOf, turnCallTurns } from "../../botsBots/planCallWords.js";
import { getConfig } from "../../config.js";
import { takeCostUsd } from "../../usage/cost.js";
import type { Guard } from "../../guard/index.js";
import { guarded } from "../../http/guarded.js";
import { openAskStream } from "../../live/askStream.js";
import { AI_CONSENT_CODE, AI_CONSENT_TEXT, aiAllowedFor } from "../../privacy/aiGate.js";
import { setCallHook } from "../../push/engine.js";
import { SDP_MAX } from "../../realtime/openaiCalls.js";
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

export function registerPlanCallRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit" | "bots">, o: { chat: BotChat | null; guard: Guard }): void {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const calls = planCalls();
  const live = planCallLive();
  live.wire({ bots: () => deps.bots, chat: () => o.chat, log: app.log });

  // The engine asks the call before a leave-by or a bill due today goes; the chat keeps how a call began; the voice reads it aloud;
  // the live manager holds a realtime call's session. The voice is free of the usage meter only where the live call is switched on
  // for this person; every other build's call voice is read under their quota and written down, as it always has been.
  calls.wire({ chat: o.chat, speak: (user, text) => speakFor(user, text, getConfig(), { call: realtimeFor(user.id) }), live, log: app.log });
  setCallHook(calls.hook);
  // The call judge's ring, and the hang-up when a person takes their AI permission back (botsBots/planCallSeam.ts).
  setCallRinger(calls);
  const offConsent = onAiConsentOff((userId) => live.stopFor(userId));
  const stop = calls.start(app.log);
  app.addHook("onClose", async () => { stop(); setCallHook(null); setCallRinger(null); offConsent(); });

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

  app.post(`${CALLS}/:id/answer`, RL, run(async (user, id, req, reply) => {
    const b = bodyOf(req.body);
    return (await calls.answer(user, id, b.talk, b.rt)) ?? (reply.code(404), NO_CALL);
  }));

  // Not now runs in the background from the notification, which says "Couldn't do that from here" on anything but a 2xx: so every answer
  // to a signed-in person is 200, a call that is over or unknown included. A failure is still 200: the ring then simply runs out.
  app.post(`${CALLS}/:id/decline`, RL, run(async (user, id, req) => {
    try { return await calls.decline(user.id, id); } catch (err) { req.log.warn({ err: (err as Error)?.name }, "calls: decline failed"); return { ok: true, state: "gone" }; }
  }, () => ({ ok: true, state: "gone" })));

  app.post(`${CALLS}/:id/end`, RL, run(async (user, id, _req, reply) => (await calls.end(user.id, id)) ?? (reply.code(404), NO_CALL)));

  app.post(`${CALLS}/:id/back`, tight(10), run(async (user, id, _req, reply) => {
    const r = await calls.back(user.id, id);
    if (r === "off") { reply.code(404); return { code: "calls_off", message: "Calls aren't switched on here." }; }
    // The one limit a Call back has (BACK_MAX a day): the button cannot be pressed into an endless string of fresh calls.
    if (r === "limit") { reply.code(429); return { code: "back_day_max", message: "That's enough calls for today. Try again tomorrow." }; }
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
    // Whether this person's calls are free of money at all: the live call's own switch. Off — every build today — and the turn is
    // held to Plan Ease's day budget and the spend gate, as it was before the live call existed.
    const free = realtimeFor(user.id);
    // The phone is typing or speaking a turn, so the live part is over for it (its own timer ran out, or the media broke) even if this
    // process still holds the session. Close it first: it writes its own total over the row, which would erase what this turn adds,
    // and its idle and length timers would otherwise end a call the person is still on.
    if (live.isLive(id)) await live.fellBack(user.id, id).catch(() => undefined);

    // The person is done, or the turns ran out: a goodbye, no model call, and the call is over.
    // Only a TURN call's turns count here: nine realtime replies before a fallback must not close the call at the first typed turn.
    const closing = turnCallTurns(row.turns) >= MAX_TURNS ? ENOUGH : endsCall(words) ? BYE : null;
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
    const streamed = stream ? {
      onText: (piece: string) => stream.text(piece), onReset: () => stream.reset(),
      emit: (e: BotEvent) => { if (e.t === "status") stream.step(e.stage); else if (e.t === "text") stream.whole(e.text); },
    } : {};
    // The call's facts, with the call judge's one-line reason when it said to call about this item.
    const facts = await calls.facts(user.id, row).catch(() => "");
    const stopped = () => { const said = stream!.said; stream!.end(); return reply.code(409).send({ code: "stopped", message: "Stopped.", text: said }); };
    try {
      const out = await guarded(o.guard, req, reply, user, "ask", async (halt) => {
        // `call: free`: where the live call is on, no day budget and no spend gate, so a call is never cut off mid-sentence for
        // money, and what the turn cost goes on the call's own row instead (below). Off, the chat is asked exactly as a chat turn is.
        const r = await chat.send(user.id, "plan", words, halt, [{ name: "This call", kind: "call", text: facts }], streamed, { call: free });
        const spoken = spokenOf(r.answer.text);
        const n = await calls.said(user.id, id, spoken);
        calls.prepare(user, id, n, spoken);
        // What the turn cost: the answer's own paise, as dollars (the gateway bills there, not on the request's tally), plus
        // anything else this request put on the tally. A record for the owner, never a cap — and only where nothing else counted it:
        // a metered turn's dollars belong to its usage row, and taking the tally here would empty it before that row is written.
        if (free) {
          const spent = r.answer.paise / 100 / getConfig().CODE_USD_INR + takeCostUsd();
          if (spent > 0) await calls.bumpCost(user.id, id, spent).catch(() => undefined);
        }
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

  // ------------------------------------------------------------------ the realtime call

  /**
   * The SDP exchange. These checks run in order, and the first that fails answers; NOTHING reaches OpenAI before the last one passes.
   * None of them looks at money: a call is never refused for cost (the owner's answer). The phone treats any non-200 as "fall back to
   * the turn call", so a refusal here is never an error the person sees.
   */
  app.post(`${CALLS}/:id/live`, tight(6), run(async (user, id, req, reply) => {
    const row = await calls.get(user.id, id);
    if (!row) { reply.code(404); return NO_CALL; }
    if (row.state !== "answered") { reply.code(409); return { code: "call_over", message: "The call has ended." }; }
    // The switch, the key, Calls, the allow-list. Nothing here about money.
    if (!realtimeFor(user.id)) { reply.code(404); return { code: "rt_off", message: "Live calls aren't switched on here." }; }
    // A call that fell back stays a turn call and never flaps back to live.
    if (row.rt_state === "fell_back") { reply.code(409); return { code: "rt_fell_back", message: "This call carries on as it is." }; }
    if (!(await aiAllowedFor(user.id))) { reply.code(403); return { code: AI_CONSENT_CODE, message: AI_CONSENT_TEXT }; }
    if (!deps.bots) { reply.code(404); return { code: "bots_off", message: "Bots are not switched on." }; }
    // Live here, or half-way through starting: `start` claims its slot again before its own first await, so two requests that arrive
    // together can never both reach OpenAI (one of them would leave a session no timer and no End call could reach).
    if (live.busy(user.id, id)) { reply.code(409); return { code: "rt_live", message: "A live call is already on." }; }
    // The live time of this call is used up: it carries on turn by turn. Technical safety, not a money cap.
    if (row.rt_sec >= getConfig().PLAN_CALL_RT_MAX_SEC - GOODBYE_LEAD_SEC) { reply.code(409); return { code: "rt_max_len", message: "This call carries on as it is." }; }
    // The capacity of this process. The Guard's limiter is not used: a permit held for a whole call would block the person's other
    // AI work and starve the shared slots.
    if (live.count() >= LIVE_MAX) { reply.code(503); return { code: "rt_busy", message: "Try again in a moment." }; }
    const body = bodyOf(req.body);
    const sdp = typeof body.sdp === "string" ? body.sdp : "";
    if (!sdp.trim() || sdp.length > SDP_MAX) { reply.code(400); return { code: "bad_request", message: "That offer isn't one." }; }
    const out = await live.start(user, id, sdp, { resume: body.resume === true });
    if ("status" in out) { reply.code(out.status); return { code: out.code, message: out.message }; }
    return out;
  }));

  // The phone is connected: the bot speaks the opening. Idempotent, so a retry never makes two openings.
  app.post(`${CALLS}/:id/live/ready`, tight(10), run(async (user, id) => live.ready(user, id)));

  // The app went to the background, or an audio interruption came in: the live part ends and the call stays answered, so "Tap to talk"
  // can resume it (the 5-minute sweep still applies).
  app.post(`${CALLS}/:id/live/stop`, RL, run(async (user, id) => { await live.park(user.id, id); return { ok: true }; }, () => ({ ok: true })));

  // Turn n read aloud (0: the opening), in the person's own voice and speed; made ahead at answer and say time. Where the live call
  // is switched on for this person the read asks no quota, so a person whose meter is used up still hears the call; everywhere else
  // it is read under their quota and written down, as it always has been.
  app.get(`${CALLS}/:id/voice/:n`, RL, async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const id = idOf(req);
    const n = Number(param(req, "n"));
    if (!id || !Number.isInteger(n) || n < 0 || n > 99) return reply.code(404).send(NO_CALL);
    if (!(await aiAllowedFor(user.id))) return reply.code(403).send({ code: AI_CONSENT_CODE, message: AI_CONSENT_TEXT });
    // The screen only asks for a read when it is a turn call (the opening after a fallback, or a turn's reply), so a live part this
    // process still holds is over: it closes first, and its own cost total lands before this read's does.
    if (live.isLive(id)) await live.fellBack(user.id, id).catch(() => undefined);
    try {
      if (!realtimeFor(user.id)) {
        const quota = await enforceQuota(user);
        if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
      }
      const out = await calls.voice(user, id, n);
      if (!out) return reply.code(404).send(NO_CALL);
      // Where the live call is on there is no 429 to answer: speakFor asked no quota, and what the read cost went on the call's row.
      if ("status" in out) {
        return out.status === 429
          ? reply.code(429).send({ code: "quota_exceeded", message: out.message })
          : reply.code(500).send({ code: "tts_failed", message: "Couldn't read that aloud." });
      }
      return reply.header("content-type", out.contentType).header("cache-control", "no-store").send(out.audio);
    } catch (err) { return fail(req, reply, err); }
  });
}
