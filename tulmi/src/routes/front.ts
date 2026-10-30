/**
 * THE FRONT DOOR OVER HTTP (src/front, docs/front-door.md).
 *
 *   POST /v1/ask { message, projectId?, threadId?, attachments?, device, mode, visuals?, recent?, visual?, stream? }
 *                          -> { id, decision, result }, or with `stream: true` (or Accept: application/x-ndjson) a stream of events, one JSON
 *                             per line: decision, status, text, artifact, and last a result (or an error). `id` is the decision's row in the log:
 *                             what POST /v1/ask/feedback names. `visual: "table"` (and so on) takes a one-tap offer a result made. `threadId` is the id the app
 *                             makes for a conversation about a project's code: its short rolling summary is what a follow-up leans on, and "ok, change it" starts a
 *                             job that is handed the place the conversation found (docs/code-chat.md). With `bot` ("Ask any bot", or one chosen), a
 *                             bot shared into a space the person is in also reads what that space shared, as data (`sharedFor`), as its chat does.
 *                             403 account_leaving while the person's account waits to be deleted: their bots are stopped (you/deletion.ts).
 *                          With `streamId` (16 to 64 letters, digits, - or _: the app makes it), the words and what it is doing also go to the person
 *                          over the live channel as they come (live/askStream.ts, shared/types/sdui.ts 3f), and POST /v1/ask/stop { id: streamId } stops it:
 *                          the ask then answers 409 `stopped` with the words written so far (`text`). The answer is kept exactly as without it.
 *   POST /v1/ask/stop { id } -> { stopped }  stop the person's own ask that is out with that stream id (nothing else is touched)
 *   POST /v1/ask/feedback { id, outcome }
 *                          -> { ok: true }  what the person did with an answer: visual_closed, visual_kept, thumbs_up, thumbs_down
 *   GET  /v1/admin/guard   -> the overload guards at a glance: the limiter, the idempotency store, coalescing, and every breaker's state
 *                             (x-admin-secret, like the other admin routes)
 *
 * The desktop's old POST /v1/ask { question, screenContent } stays exactly as it was. server.ts hands a body to this door only when it
 * has a `message` and no `question`. Off unless FRONT_DOOR is true: those bodies are then answered 404 front_door_off.
 *
 * A request is guarded (routes/guarded.ts, src/guard): one run per key, so a double tap joins the run that is out; a permit, so one person
 * and the whole server run only so many at once; 429 with Retry-After and the place in the queue when there is no room. A person who
 * hangs up stops the run, and the model calls it was making, when nobody else is waiting on it.
 *
 * The bytes of an attachment come in the body (`data`, base64) the first time; after that its ref alone is enough, because what was read is
 * kept by its SHA-256. The route's body limit is FRONT_BODY_LIMIT, because a 4 MB picture is about 5.5 MB of base64.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { requireAdmin } from "../control/index.js";
import type { Bots } from "../bots/index.js";
import { frontEnvelope, tagOf, type BotTag } from "../bots/envelope.js";
import { isBotError, type BotAnswer } from "../bots/types.js";
import { defaultGuard, type Guard } from "../guard/index.js";
import {
  DEVICES, MODES, PERSON_OUTCOMES, VISUAL_KINDS, VISUAL_PREFS, FrontError, refFromBody,
  type AttachmentRef, type Decision, type Device, type Front, type FrontCtx, type FrontEvent, type FrontResult, type Mode, type Outcome, type Turn, type VisualKind, type VisualPref,
} from "../front/index.js";
import { failCode } from "./code.js";
import { threadStore, type ThreadStore } from "../code/chat/threads.js";
import { idempotencyHeader, planOf } from "./guarded.js";
import { isLeaving, LEAVING_MESSAGE } from "../you/deletion.js";
import type { Attached } from "../bots/prompt.js";
import { scrub } from "../bots/run.js";
import { openAskStream, stopAsk, type AskStream } from "../live/askStream.js";

/** What the route accepts: room for a picture's base64. */
export const FRONT_BODY_LIMIT = 8 * 1024 * 1024;
export const MESSAGE_MAX = 8_000;
const ATTACHMENTS_IN = 8;
const TURN_CHARS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FrontRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null while FRONT_DOOR is off. */
  front: Front | null;
  /** The guard the admin route reports on; the front door's own, or the process's. */
  guard?: Guard;
  /** The monthly allowance, as the server counts it: a sentence when it is spent, else null. */
  quota?: (user: AuthedUser) => Promise<string | null>;
  /** Written down after an answer (zero words: the model's words are not the person's), with what the front door's own calls cost (a bot's
   *  answer is written down by the bots platform itself): the usage meter counts it (src/you/limits.ts). */
  used?: (user: AuthedUser, paise: number) => Promise<void>;
  /** The bots platform (src/bots), for `bot` in the body ("Ask any bot"). Null or absent while BOTS is off: a body with `bot` is then 404 bots_off. */
  bots?: Bots | null;
  /** The project chats' threads (code/chat/threads.ts); the process's own when absent. */
  threads?: ThreadStore;
  /**
   * What the person's spaces shared with a bot (botsBots/shared.ts forBot), for a bot shared into a space they are in: the bot reads it as
   * data, never as instructions, as it does in its chat (routes/botsBots.ts). Absent: nothing is added.
   */
  sharedFor?: (userId: string, slug: string) => Promise<Attached[]>;
  /** Whether a person's bots are stopped (their account waits to be deleted: you/deletion.ts isLeaving, the default): nothing is asked. */
  stopped?: (userId: string) => Promise<boolean>;
}

export interface AskInput {
  message: string;
  /** "any" (the front door picks the best of the person's bots), or a bot's slug: docs/bots.md. Absent: the front door as it always was. */
  bot?: string;
  ctx: Omit<FrontCtx, "userId" | "plan">;
  data: Map<string, Buffer>;
  stream: boolean;
}

export type AskRead = { ok: true; input: AskInput } | { ok: false; status: number; code: string; message: string };

const bad = (message: string, status = 400): AskRead => ({ ok: false, status, code: "bad_request", message });
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** The body of POST /v1/ask, checked: the message, what the person and the device are, what is attached. */
export function readAsk(body: unknown): AskRead {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("The body is a JSON object.");
  const b = body as Record<string, unknown>;
  if (typeof b.message !== "string" || !b.message.trim()) return bad("message is what the person said.");
  if (b.message.length > MESSAGE_MAX) return bad(`A message may be ${MESSAGE_MAX} characters at most.`, 413);
  if (!oneOf(DEVICES, b.device)) return bad(`device is one of ${DEVICES.join(", ")}.`);
  if (!oneOf(MODES, b.mode)) return bad(`mode is one of ${MODES.join(", ")}.`);
  if (b.visuals !== undefined && !oneOf(VISUAL_PREFS, b.visuals)) return bad(`visuals is one of ${VISUAL_PREFS.join(", ")}.`);
  if (b.visual !== undefined && !oneOf(VISUAL_KINDS, b.visual)) return bad(`visual is one of ${VISUAL_KINDS.join(", ")}.`);
  if (b.projectId !== undefined && (typeof b.projectId !== "string" || !UUID.test(b.projectId))) return bad("projectId is a project's id.");
  if (b.threadId !== undefined && (typeof b.threadId !== "string" || !UUID.test(b.threadId))) return bad("threadId is an id the app makes for a conversation about a project's code (a uuid).");
  if (b.stream !== undefined && typeof b.stream !== "boolean") return bad("stream is true or false.");
  if (b.bot !== undefined && (typeof b.bot !== "string" || b.bot.length > 40 || !/^(?:any|auto|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(b.bot))) return bad('bot is "any" or a bot\'s slug.');
  if (b.streamId !== undefined && (typeof b.streamId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(b.streamId))) return bad("streamId is 16 to 64 letters, digits, - or _.");

  const attachments: AttachmentRef[] = [];
  const data = new Map<string, Buffer>();
  if (b.attachments !== undefined) {
    if (!Array.isArray(b.attachments) || b.attachments.length > ATTACHMENTS_IN) return bad(`attachments is a list of ${ATTACHMENTS_IN} files at most.`);
    for (const a of b.attachments) {
      const got = refFromBody(a);
      if (!got.ok) return bad(got.why);
      if (attachments.some((x) => x.id === got.input.ref.id)) return bad("Each attachment has its own id.");
      attachments.push(got.input.ref);
      if (got.input.data) data.set(got.input.ref.id, got.input.data);
    }
  }

  const recent: Turn[] = [];
  if (b.recent !== undefined) {
    if (!Array.isArray(b.recent) || b.recent.length > 3) return bad("recent is the last three turns at most.");
    for (const t of b.recent) {
      const o = t as { said?: unknown; did?: unknown } | null;
      if (!o || typeof o !== "object" || typeof o.said !== "string" || o.said.length > TURN_CHARS) return bad(`A turn's said is up to ${TURN_CHARS} characters.`);
      if (o.did !== undefined && (typeof o.did !== "string" || o.did.length > TURN_CHARS)) return bad(`A turn's did is up to ${TURN_CHARS} characters.`);
      recent.push({ said: o.said, ...(o.did ? { did: o.did } : {}) });
    }
  }

  return {
    ok: true,
    input: {
      message: b.message, data, stream: b.stream === true, ...(typeof b.bot === "string" ? { bot: b.bot } : {}),
      ctx: {
        device: b.device as Device, mode: b.mode as Mode, visuals: (b.visuals as VisualPref | undefined) ?? "auto", recent, attachments,
        ...(typeof b.projectId === "string" ? { projectId: b.projectId } : {}), ...(typeof b.threadId === "string" ? { threadId: b.threadId } : {}),
        ...(b.visual !== undefined ? { takeOffer: b.visual as VisualKind } : {}),
      },
    },
  };
}

/** What a finished ask is: the row's id, the decision, the result; and when a bot answered or was picked, which one and all it did. */
interface Asked { id: string | null; decision: Decision; result: FrontResult; bot?: BotTag; answer?: BotAnswer }

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === "AbortError";

export interface FrontRoutes {
  /** True for a body this door answers: a `message` and no `question` (the desktop's old ask). */
  owns(body: unknown): boolean;
  /** Answers POST /v1/ask for a signed-in person. */
  ask(req: FastifyRequest, reply: FastifyReply, user: AuthedUser): Promise<FastifyReply>;
}

export function registerFrontRoutes(app: FastifyInstance, deps: FrontRoutesDeps): FrontRoutes {
  const RL = { config: deps.rateLimit };
  const { front } = deps;

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof FrontError) return reply.code(err.status).send({ code: err.code, message: err.message });
    if (isBotError(err)) {
      if (typeof err.detail?.retryAfterSec === "number") reply.header("retry-after", String(err.detail.retryAfterSec));
      return reply.code(err.status).send({ code: err.code, message: err.message });
    }
    try {
      return failCode(reply, err);
    } catch {
      req.log.error(err);
      return reply.code(500).send({ code: "ask_failed", message: "Couldn't answer that" });
    }
  };

  const ask: FrontRoutes["ask"] = async (req, reply, user) => {
    const botMode = typeof (req.body as { bot?: unknown } | null)?.bot === "string";
    // "Ask any bot" needs the bots platform; with it off, a body that names a bot is 404 before anything else. A chosen bot does not need the front door.
    if (botMode && !deps.bots) return reply.code(404).send({ code: "bots_off", message: "Bots are not switched on." });
    if (!front && !botMode) return reply.code(404).send({ code: "front_door_off", message: "The smart entry point is not switched on." });
    const read = readAsk(req.body);
    if (!read.ok) return reply.code(read.status).send({ code: read.code, message: read.message });
    const { input } = read;
    const bots = input.bot !== undefined ? deps.bots ?? null : null;

    // Their account waits to be deleted: their bots are stopped until they keep it.
    if (await (deps.stopped ?? isLeaving)(user.id)) return reply.code(403).send({ code: "account_leaving", message: LEAVING_MESSAGE });

    const quota = await deps.quota?.(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    const ctx: FrontCtx = { userId: user.id, plan: await planOf(user), ...input.ctx };
    // The Xode chat sends no turns: the thread it names says what was asked last, so "??" or "why?" goes on from that question.
    if (ctx.projectId && ctx.threadId && !ctx.recent.length) {
      const kept = await (deps.threads ?? threadStore()).get(user.id, ctx.projectId, ctx.threadId).catch(() => null);
      if (kept?.lastQuestion) ctx.recent.push({ said: kept.lastQuestion, did: "code_question" });
    }
    const streaming = input.stream || String(req.headers["accept"] ?? "").includes("application/x-ndjson");
    const gone = new AbortController();
    reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
    // The words as they come, to the person who asked, when the app gave this ask a stream id; and the way to stop it.
    const words: AskStream | null = openAskStream(user.id, (req.body as { streamId?: unknown } | null)?.streamId, { guard: (t) => scrub(t).cleaned });
    if (words) words.signal.addEventListener("abort", () => gone.abort(), { once: true });
    /** The front door's events, to the live stream too: its words in pieces, its stages as a short line. */
    const toWords = (ev: { t: string; text?: unknown; stage?: unknown }): void => {
      if (!words) return;
      if (ev.t === "text" && typeof ev.text === "string") words.text(ev.text);
      else if (ev.t === "reset") words.reset();
      else if (ev.t === "status" && typeof ev.stage === "string") words.step(ev.stage);
    };

    // The stream starts at its first event, so a request turned away (429) or refused before anything was said is still an ordinary JSON answer.
    const res = reply.raw;
    let started = false;
    let sawResult = false;
    const write = (ev: FrontEvent | { t: "bot"; bot: BotTag }): void => {
      if (!started) {
        started = true;
        reply.hijack();
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      }
      if (ev.t === "result") sawResult = true;
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(ev)}\n`);
    };

    /** What the front door's own calls cost this message (a bot's answer is written down by the bots platform). */
    let own = 0;
    try {
      const out = await (front?.guard ?? deps.guard ?? defaultGuard()).run<Asked>({
        userId: user.id, plan: ctx.plan, route: "POST /v1/ask", lane: "ask", header: idempotencyHeader(req), signal: gone.signal,
        // The key is the person's request, whichever way the client wrote it: the stream flag is part of it, since a stream and a reply are two answers.
        body: req.body,
        ...(streaming ? { onEvent: (ev: unknown) => write(ev as FrontEvent) } : {}),
      }, async (emitOut, stop) => {
        own = 0;
        const emit = (ev: unknown): void => { toWords(ev as { t: string }); emitOut(ev); };
        // "Ask any bot", or a bot the person chose: the front door picks, or is told. Xode and "none of them" go down the front door's own roads, unchanged.
        if (bots) {
          const target = await bots.target(user.id, input.bot!, input.message, { ...(ctx.projectId ? { projectId: ctx.projectId } : {}), attachments: ctx.attachments, recent: ctx.recent, mode: ctx.mode }, stop);
          if (target.kind === "bot") {
            const daily = front?.guard.daily;
            // The front door's own spend on this person today: the picker's small model and the reading of a file are its own, like its replies are.
            if (daily && daily.leftPaise(user.id) <= 0) throw new FrontError("daily_limit", "You've used what X0 Bot may spend on your messages today. It starts again tomorrow.", 429);
            emit({ t: "bot", bot: tagOf(target.bot, target.by) });
            // Files attached to the message are read the front door's way, once, for a bot that can read files; a bot that can't is told so (its note), and nothing is read.
            let read: Awaited<ReturnType<Front["readFiles"]>> | null = null;
            if (front && ctx.attachments.length && target.bot.skills.files) {
              emit({ t: "status", stage: "reading" });
              read = await front.readFiles(user.id, ctx.attachments, input.data, target.message, { maxPaise: Math.max(1, Math.min(60, Math.floor(target.bot.budgets.perRequestPaise / 2))), signal: stop });
            }
            // A bot shared into a space the person is in reads what the space shared, as its chat does: data, never instructions (bots/prompt.ts).
            const shared = deps.sharedFor ? await deps.sharedFor(user.id, target.bot.slug).catch(() => []) : [];
            const attached: Attached[] = [...(read?.files ?? []).map((f) => ({ name: f.name, kind: f.kind, text: f.text })), ...shared];
            const answer = await bots.ask(user.id, target.bot.id, {
              message: target.message, signal: stop, pickedBy: target.by, ctx: { attachments: ctx.attachments, recent: ctx.recent, mode: ctx.mode },
              ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
              // A bot's answer streams through onText; its whole text (the event) goes to the stream only when nothing of it did.
              emit: (e) => { if (e.t === "result") return; if (e.t === "text") words?.whole(e.text); else toWords(e); emitOut(e); },
              ...(words ? { onText: (piece: string) => words.text(piece), onReset: () => words.reset() } : {}),
              ...(attached.length ? { attached } : {}), ...(read?.paise ? { extraPaise: read.paise } : {}),
            });
            if (read?.notes.length) answer.notes.push(...read.notes.map((n) => n.note ?? "").filter(Boolean));
            daily?.add(user.id, target.paise + answer.paise);
            own = target.paise;
            const env = frontEnvelope({ ...answer, paise: answer.paise + target.paise }, target.bot, { by: target.by, confidence: target.confidence, reasons: target.reasons });
            return { id: null, decision: env.decision, result: { ...env.result, ...(read?.files.length ? { files: read.notes } : {}) }, bot: env.bot, answer: env.answer };
          }
          if (!front) throw new FrontError("front_door_off", "The smart entry point is not switched on.", 404);
          const tag = target.bot ? tagOf(target.bot, target.by === "none" ? "rules" : target.by) : null;
          if (tag) emit({ t: "bot", bot: tag });
          // The front door's own events, as they were; the one that ends the stream says which bot it was.
          const r = await front.ask(target.message, ctx, { signal: stop, emit: (ev) => emit(tag && ev.t === "result" ? { ...ev, bot: tag } : ev), attachmentData: input.data });
          own = target.paise + (r.result?.paise ?? 0);
          return { id: r.id, decision: r.decision, result: r.result, ...(tag ? { bot: tag } : {}) };
        }
        const r = await front!.ask(input.message, ctx, { signal: stop, emit: (ev) => emit(ev), attachmentData: input.data });
        own = r.result?.paise ?? 0;
        return { id: r.id, decision: r.decision, result: r.result };
      });
      // A replayed answer was counted the first time.
      void deps.used?.(user, out.replay ? 0 : own)?.catch(() => undefined);
      words?.end();
      if (!streaming) {
        if (out.replay) reply.header("idempotent-replayed", "true");
        return reply.send({ id: out.result.id, decision: out.result.decision, result: out.result.result, ...(out.result.bot ? { bot: out.result.bot } : {}), ...(out.result.answer ? { answer: out.result.answer } : {}) });
      }
      // A late joiner may have missed events the store did not keep: the answer itself is never missed.
      if (!sawResult) write({ t: "result", decisionId: out.result.id, decision: out.result.decision, result: out.result.result, ...(out.result.bot ? { bot: out.result.bot } : {}), ...(out.result.answer ? { answer: out.result.answer } : {}) } as FrontEvent);
      res.end();
      return reply;
    } catch (err) {
      // Stopped by the person (POST /v1/ask/stop): what was written stays theirs to see.
      if (words?.stopped && (isAbort(err) || gone.signal.aborted)) {
        const said = words.said;
        words.end();
        if (started) { write({ t: "error", code: "stopped", message: "Stopped." }); res.end(); return reply; }
        return reply.code(409).send({ code: "stopped", message: "Stopped.", text: said });
      }
      words?.end();
      if (isAbort(err) && gone.signal.aborted) { if (started) res.end(); return reply; }
      if (!started) return fail(req, reply, err);
      req.log.error(err);
      const known = err instanceof FrontError;
      write({ t: "error", code: known ? err.code : "ask_failed", message: known ? err.message : "Couldn't answer that" });
      res.end();
      return reply;
    }
  };

  app.post("/v1/ask/stop", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const id = (req.body && typeof req.body === "object" ? (req.body as { id?: unknown }).id : undefined);
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return reply.code(400).send({ code: "bad_request", message: "id is the ask's stream id." });
    return reply.send({ stopped: stopAsk(user.id, id) });
  });

  app.post("/v1/ask/feedback", RL, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    if (!front) return reply.code(404).send({ code: "front_door_off", message: "The smart entry point is not switched on." });
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as { id?: unknown; outcome?: unknown };
    if (typeof b.id !== "string" || !UUID.test(b.id)) return reply.code(400).send({ code: "bad_request", message: "id is the id an answer came with." });
    if (!oneOf(PERSON_OUTCOMES, b.outcome)) return reply.code(400).send({ code: "bad_request", message: `outcome is one of ${PERSON_OUTCOMES.join(", ")}.` });
    try {
      if (!(await front.feedback(user.id, b.id, b.outcome as Outcome))) return reply.code(404).send({ code: "not_found", message: "There is no such answer." });
      return reply.send({ ok: true });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/admin/guard", RL, async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    return reply.send({ frontDoor: !!front, ...(deps.guard ?? front?.guard ?? defaultGuard()).health() });
  });

  return {
    owns: (body) => !!body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string" && (body as { question?: unknown }).question === undefined,
    ask,
  };
}
