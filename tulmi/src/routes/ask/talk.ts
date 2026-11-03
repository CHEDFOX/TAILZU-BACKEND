/**
 * The voice chat (src/talk, docs/talk.md).
 *
 *   POST /v1/talk        { talkId, turn, words, tz?, app?, title?, url?, field?, ours?, page?, grants? }
 *                        -> NDJSON (application/x-ndjson), one TalkEvent a line: route, mood, text…, handoff, done | error
 *   POST /v1/talk/stop   { talkId } -> { stopped }: the turn in flight in that talk ends with done (what was said so far)
 *
 * The signed-in person only. Before the stream starts, a bad request is an ordinary JSON 400/401; after, everything ends as one
 * terminal event and the stream always ends. A dropped connection stops the turn too. A new turn of the same talk stops the one
 * before it (the person spoke again). Counted on the person's front-door day like /v1/ask/decide.
 */
import type { FastifyInstance } from "fastify";
import type { TalkEvent } from "../../../../shared/types/api.js";
import { withoutUrlSecrets } from "../../agent/protocol.js";
import { resolveUser } from "../../auth/supabase.js";
import type { Bots } from "../../bots/index.js";
import type { GatewayDeps } from "../../code/brain/gateway.js";
import type { CallFn } from "../../code/work/model.js";
import type { PersonContext } from "../../context/index.js";
import { defaultGuard } from "../../guard/index.js";
import { TALK_ID, flight, lookPorts, readPage, stopTalk, talkSessions, talkTurn, type LookPorts, type TalkInput, type TalkSessions } from "../../talk/index.js";
import { readDecideBody } from "./askDecide.js";

export interface TalkRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  bots: Bots | null;
  /** The person's context; null when CONTEXT is off. */
  context?: PersonContext | null;
  /** Seams for tests: the model door, the lookups, the talks. */
  call?: CallFn;
  gateway?: GatewayDeps;
  look?: ((userId: string, o: { signal: AbortSignal; maxPaise: number }) => LookPorts | null) | null;
  sessions?: TalkSessions;
}

const URL_MAX = 300;

/** The body, kept to what it may hold. Null when it has no talkId, no turn or no words. */
export function readTalkBody(b: Record<string, unknown>): TalkInput | null {
  const base = readDecideBody(b);
  if (!base) return null;
  const talkId = typeof b.talkId === "string" && TALK_ID.test(b.talkId) ? b.talkId : null;
  const turn = typeof b.turn === "number" && Number.isInteger(b.turn) && b.turn >= 0 ? b.turn : null;
  if (!talkId || turn === null) return null;
  const url = typeof b.url === "string" && b.url.trim() ? withoutUrlSecrets(b.url.trim().slice(0, URL_MAX)).replace(/\s+/g, "") : "";
  const page = readPage(b.page, withoutUrlSecrets);
  const field = base.field && base.field.selection ? { ...base.field, selection: withoutUrlSecrets(base.field.selection) } : base.field;
  return {
    talkId, turn, words: base.words,
    ...(base.tz !== undefined ? { tz: base.tz } : {}),
    ...(base.app ? { app: base.app } : {}), ...(base.title ? { title: base.title } : {}), ...(url ? { url } : {}),
    ...(field !== undefined ? { field } : {}), ...(base.ours ? { ours: true } : {}),
    ...(page ? { page } : {}), ...(base.grants ? { grants: base.grants } : {}),
  };
}

export function registerTalkRoutes(app: FastifyInstance, deps: TalkRouteDeps): void {
  const rl = { config: { rateLimit: { max: Math.min(120, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } };
  const look = deps.look === undefined ? (userId: string, o: { signal: AbortSignal; maxPaise: number }) => lookPorts(userId, o) : deps.look;

  app.post("/v1/talk", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const input = readTalkBody((req.body ?? {}) as Record<string, unknown>);
    if (!input) return reply.code(400).send({ code: "bad_request", message: "talkId, turn and words are needed." });

    const f = flight(user.id, input.talkId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.on("close", () => { if (!res.writableFinished) f.abort(); });
    let ended = false;
    const emit = (e: TalkEvent): void => {
      if (ended) return;
      if (e.t === "done" || e.t === "error") ended = true;
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(e)}\n`);
    };
    const t0 = Date.now();
    try {
      const out = await talkTurn(input, {
        user,
        ...(deps.call ? { call: deps.call } : {}), ...(deps.gateway ? { gateway: deps.gateway } : {}),
        context: deps.context ?? null,
        ...(deps.bots ? { bots: () => deps.bots!.defs(user.id).then((list) => list.map((b) => ({ slug: b.slug, name: b.name, purpose: b.purpose }))) } : {}),
        ...(look ? { look: (o: { signal: AbortSignal; maxPaise: number }) => look(user.id, o) } : {}),
        daily: defaultGuard().daily,
        sessions: deps.sessions ?? talkSessions(),
        signal: f.signal,
        stopped: () => f.stopped,
        log: req.log,
      }, emit);
      // One line a turn, with nothing that was said in it.
      req.log.info({ talk: { kind: out.kind, ending: out.ending, reasons: out.reasons, paise: out.paise, tier: out.tier, ms: Date.now() - t0 } }, "talk turn");
    } catch (err) {
      req.log.error({ err }, "talk turn failed");
      emit({ t: "error", code: "internal", message: "Something went wrong. Try again in a moment." });
    } finally {
      if (!ended) emit({ t: "error", code: "internal", message: "Something went wrong. Try again in a moment." });
      f.end();
      res.end();
    }
  });

  app.post("/v1/talk/stop", rl, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]).catch(() => null);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const talkId = ((req.body ?? {}) as Record<string, unknown>).talkId;
    if (typeof talkId !== "string" || !TALK_ID.test(talkId)) return reply.code(400).send({ code: "bad_request", message: "talkId is needed." });
    return reply.send({ stopped: stopTalk(user.id, talkId) });
  });
}
