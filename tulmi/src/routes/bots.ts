/**
 * THE BOTS PLATFORM OVER HTTP (src/bots, docs/bots.md): A PERSON'S OWN BOTS, AND THE ENDPOINT FOR THEIR OWN APPS.
 *
 *   GET    /v1/bots                          -> { bots, palette, limits }     the four Tailzu ships, then yours
 *   POST   /v1/bots { name, purpose, ... }   -> 201 { bot, warnings }         make one directly (the same checks as approve)
 *   POST   /v1/bots/draft { sentence }       -> { draft: { definition, tests, connectors, warnings, ... } }   a draft from one sentence; NOTHING is saved
 *   POST   /v1/bots/approve { definition }   -> 201 { bot, warnings }         the person read the draft, edited it, and approved: the only thing that saves one
 *   POST   /v1/bots/test { definition, message, history?, projectId? }  -> { answer }   the test console: chat with a draft that was never saved
 *   GET    /v1/bots/export                   -> everything you hold here: bots, keys (masked), commands, what your bots remember
 *   GET    /v1/bots/:slug                    -> { bot }  yours (or a built-in);  anyone else: the public card, only if its owner turned it on, else 404
 *   PUT    /v1/bots/:slug { ...changes }     -> { bot, warnings }   (a built-in can't be changed: 403)
 *   DELETE /v1/bots/:slug                    -> { ok }  with its keys, commands and memory
 *   POST   /v1/bots/:slug/ask { message, history?, projectId?, stream? }
 *                                            -> { bot, text, paise, tools, approvals, artifacts, opens, notes }
 *            Authorization: Bearer <bot key>  is the endpoint for your own apps (the key's bot only; rate-limited and budgeted per key; never touches the owner's memory);
 *            Authorization: Bearer <your sign-in>  is you talking to the bot (its memory, your saved /commands). Optionally streamed (NDJSON, or Accept: application/x-ndjson).
 *   POST   /v1/bots/:slug/keys { label? }    -> 201 { key, ... }  the key, shown ONCE;  GET .../keys -> masked;  DELETE .../keys/:id -> revoked
 *   GET    /v1/bots/:slug/commands, POST (and PUT .../:name) { name, template }, DELETE .../commands/:name    saved commands: a template with {{input}}, run as /name
 *   GET    /v1/bots/:slug/memory, DELETE .../memory/:factId, DELETE .../memory     what the bot remembers of you, and forgetting it
 *   GET    /v1/bots/:slug/connectors, PUT .../connectors/:id, DELETE .../connectors/:id    the apps linked to the bot, and whether you have each connected
 *
 * With BOTS off every route answers 404 { code: "bots_off" }, before the session. Everything but the public card and the key endpoint is the signed-in person's
 * own, and another person's bot is a 404, never a 403: it is not said to exist. A model-spending route runs under the overload guards (src/guard).
 * Request bodies are never logged: what a person or an app asks a bot is theirs.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { type Bots, BotError, isBotError, PALETTE, LIMITS, type BotAnswer, type BotEvent } from "../bots/index.js";
import { looksLikeKey } from "../bots/keys.js";
import { defaultGuard, type Guard } from "../guard/index.js";
import { failCode } from "./code.js";
import { guarded, idempotencyHeader, planOf } from "./guarded.js";

export interface BotRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null when BOTS is off. */
  bots: Bots | null;
  guard?: Guard;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === "AbortError";

/** What an app gets back: the bot's answer, and what the key may still spend today. */
export function apiBody(a: BotAnswer, usage?: { leftTodayPaise: number }) {
  return {
    bot: a.bot.slug, text: a.text, paise: a.paise, tools: a.tools, approvals: a.approvals, artifacts: a.artifacts, opens: a.opens, notes: a.notes,
    ...(usage ? { usage: { paise: a.paise, leftTodayPaise: usage.leftTodayPaise } } : {}),
  };
}

/** `history` from a body: up to ten turns, each a role and some text. */
export function readHistory(v: unknown): { ok: true; history: Array<{ role: "user" | "assistant"; content: string }> } | { ok: false; message: string } {
  if (v === undefined) return { ok: true, history: [] };
  if (!Array.isArray(v) || v.length > LIMITS.history.turns) return { ok: false, message: `history is the last ${LIMITS.history.turns} turns at most.` };
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const t of v) {
    const o = t as { role?: unknown; content?: unknown } | null;
    if (!o || typeof o !== "object" || (o.role !== "user" && o.role !== "assistant") || typeof o.content !== "string" || o.content.length > LIMITS.history.chars) {
      return { ok: false, message: `A turn is { role: "user" | "assistant", content } of ${LIMITS.history.chars} characters at most.` };
    }
    out.push({ role: o.role, content: o.content });
  }
  return { ok: true, history: out };
}

export function registerBotRoutes(app: FastifyInstance, deps: BotRoutesDeps): void {
  const bots = deps.bots;
  const RL = { config: deps.rateLimit };
  /** The app's per-route limit, tightened for the routes that spend money. */
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const guard = (): Guard => deps.guard ?? bots?.guard ?? defaultGuard();

  const off = (reply: FastifyReply) => reply.code(404).send({ code: "bots_off", message: "Bots are not switched on." });
  const noSession = (reply: FastifyReply) => reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) {
      const retry = err.detail?.retryAfterSec;
      if (typeof retry === "number") reply.header("retry-after", String(retry));
      const { retryAfterSec: _r, ...detail } = err.detail ?? {};
      void _r;
      return reply.code(err.status).send({ code: err.code, message: err.message, ...detail });
    }
    try {
      return failCode(reply, err);
    } catch {
      // Never the error's own words: a model's or a store's message is not for the caller. And never the request's.
      req.log.error({ err: (err as Error)?.name }, "bots: request failed");
      return reply.code(500).send({ code: "bot_failed", message: "Couldn't do that just now." });
    }
  };

  /** The service, then the session. Null once the answer has been sent. */
  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ b: Bots; user: AuthedUser } | null> => {
    if (!bots) { off(reply); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { noSession(reply); return null; }
    return { b: bots, user };
  };

  const slugOf = (req: FastifyRequest): string => String((req.params as { slug?: unknown }).slug ?? "").toLowerCase();

  // ------------------------------------------------------------------ the list, the maker

  app.get("/v1/bots", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      return reply.send({
        bots: await s.b.list(s.user.id), palette: PALETTE,
        limits: { bots: s.b.limits.botsMax, rules: LIMITS.rules, rule: LIMITS.rule, requestPaise: s.b.limits.requestMax, dailyPaise: s.b.limits.dailyMax, knowledge: LIMITS.knowledge, connectors: LIMITS.connectors },
      });
    } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/bots", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.code(201).send(await s.b.create(s.user.id, req.body)); } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/bots/draft", tight(20), async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const sentence = bodyOf(req.body).sentence;
    if (typeof sentence !== "string") return reply.code(400).send({ code: "bad_request", message: "sentence is what the bot is for, in a sentence." });
    try {
      return await guarded(guard(), req, reply, s.user, "ask", async (stop) => ({ status: 200, body: { draft: await s.b.draft(s.user.id, sentence, stop), saved: false } }));
    } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/bots/approve", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.code(201).send(await s.b.approve(s.user.id, req.body)); } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/bots/test", tight(30), async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const history = readHistory(b.history);
    if (!history.ok) return reply.code(400).send({ code: "bad_request", message: history.message });
    if (b.projectId !== undefined && (typeof b.projectId !== "string" || !UUID.test(b.projectId))) return reply.code(400).send({ code: "bad_request", message: "projectId is a project's id." });
    try {
      return await guarded(guard(), req, reply, s.user, "ask", async (stop) => ({
        status: 200,
        body: { answer: await s.b.test(s.user.id, b.definition, { message: b.message as string, history: history.history, signal: stop, ...(typeof b.projectId === "string" ? { projectId: b.projectId } : {}) }), saved: false },
      }), { replayUnkeyed: false });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/bots/export", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.header("cache-control", "no-store").send(await s.b.exportAll(s.user.id)); } catch (err) { return fail(req, reply, err); }
  });

  // ------------------------------------------------------------------ one bot

  app.get("/v1/bots/:slug", RL, async (req, reply) => {
    if (!bots) return off(reply);
    const auth = req.headers["authorization"];
    try {
      // A signed-in person sees their own bot whole; anyone else, and anyone with no session, gets the card of a bot whose owner turned it on.
      if (auth && !looksLikeKey(auth)) {
        const user = await resolveUser(auth);
        if (!user) return noSession(reply);
        const mine = await bots.resolve(user.id, slugOf(req));
        if (mine) return reply.send({ bot: await bots.get(user.id, slugOf(req)) });
      }
      const card = await bots.card(slugOf(req));
      if (!card) return reply.code(404).send({ code: "not_found", message: "There is no such bot." });
      return reply.send({ card });
    } catch (err) { return fail(req, reply, err); }
  });

  const change = async (req: FastifyRequest, reply: FastifyReply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send(await s.b.update(s.user.id, slugOf(req), req.body)); } catch (err) { return fail(req, reply, err); }
  };
  app.put("/v1/bots/:slug", RL, change);
  app.patch("/v1/bots/:slug", RL, change);

  app.delete("/v1/bots/:slug", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { await s.b.remove(s.user.id, slugOf(req)); return reply.send({ ok: true }); } catch (err) { return fail(req, reply, err); }
  });

  // ------------------------------------------------------------------ asking

  app.post("/v1/bots/:slug/ask", tight(60), async (req, reply) => {
    if (!bots) return off(reply);
    const b = bodyOf(req.body);
    const history = readHistory(b.history);
    if (!history.ok) return reply.code(400).send({ code: "bad_request", message: history.message });
    if (typeof b.message !== "string" || !b.message.trim()) return reply.code(400).send({ code: "bad_request", message: "message is what the person said." });
    if (b.message.length > LIMITS.message) return reply.code(413).send({ code: "too_large", message: `A message may be ${LIMITS.message} characters at most.` });
    if (b.projectId !== undefined && (typeof b.projectId !== "string" || !UUID.test(b.projectId))) return reply.code(400).send({ code: "bad_request", message: "projectId is a project's id." });
    if (b.stream !== undefined && typeof b.stream !== "boolean") return reply.code(400).send({ code: "bad_request", message: "stream is true or false." });
    const streaming = b.stream === true || String(req.headers["accept"] ?? "").includes("application/x-ndjson");
    const slug = slugOf(req);
    const auth = req.headers["authorization"];
    const byKey = looksLikeKey(auth);

    // Who the guards count this against: the signed-in person, or the owner of the bot the key is for.
    let user: AuthedUser | null = null;
    if (byKey) {
      const owner = await bots.ownerOfKey(auth).catch(() => null);
      if (!owner) return reply.code(401).send({ code: "invalid_key", message: "That key doesn't work. Make a new one in the bot's settings." });
      user = { id: owner };
    } else {
      user = await resolveUser(auth);
      if (!user) return noSession(reply);
    }

    const gone = new AbortController();
    reply.raw.once("close", () => { if (!reply.raw.writableFinished) gone.abort(); });
    const res = reply.raw;
    let started = false;
    let sawResult = false;
    const write = (ev: Body): void => {
      if (!started) {
        started = true;
        reply.hijack();
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      }
      if (ev.t === "result") sawResult = true;
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(ev)}\n`);
    };

    const work = async (emit: (ev: unknown) => void, stop: AbortSignal): Promise<{ body: Body }> => {
      const input = {
        message: b.message as string, history: history.history, signal: stop, ...(typeof b.projectId === "string" ? { projectId: b.projectId } : {}),
        ...(streaming ? { emit: (e: BotEvent) => { if (e.t !== "result") emit(e); } } : {}),
      };
      if (byKey) {
        const r = await bots.askWithKey(auth, slug, input);
        return { body: apiBody(r.answer, { leftTodayPaise: r.leftTodayPaise }) };
      }
      return { body: apiBody(await bots.ask(user!.id, slug, input)) };
    };

    try {
      const out = await guard().run<{ body: Body }>({
        userId: user.id, plan: await planOf(user), route: `POST /v1/bots/${slug}/ask`, lane: "ask", header: idempotencyHeader(req), signal: gone.signal,
        body: { message: b.message, history: b.history ?? null, projectId: b.projectId ?? null, stream: streaming, key: byKey },
        ...(streaming ? { onEvent: (ev: unknown) => write(ev as Body) } : {}),
      }, (emit, stop) => work(emit, stop));
      if (!streaming) {
        if (out.replay) reply.header("idempotent-replayed", "true");
        return reply.send(out.result.body);
      }
      if (!sawResult) write({ t: "result", result: out.result.body });
      res.end();
      return reply;
    } catch (err) {
      if (isAbort(err) && gone.signal.aborted) { if (started) res.end(); return reply; }
      if (!started) return fail(req, reply, err);
      const known = err instanceof BotError;
      write({ t: "error", code: known ? err.code : "bot_failed", message: known ? err.message : "Couldn't do that just now." });
      res.end();
      return reply;
    }
  });

  // ------------------------------------------------------------------ keys

  app.post("/v1/bots/:slug/keys", tight(20), async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try {
      const made = await s.b.createKey(s.user.id, slugOf(req), bodyOf(req.body).label);
      reply.header("cache-control", "no-store");
      return reply.code(201).send({ key: made.key, ...made.view, note: "This is the only time the key is shown. Keep it somewhere safe; if it's lost, revoke it and make another." });
    } catch (err) { return fail(req, reply, err); }
  });

  app.get("/v1/bots/:slug/keys", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.header("cache-control", "no-store").send({ keys: await s.b.listKeys(s.user.id, slugOf(req)) }); } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/bots/:slug/keys/:keyId", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { await s.b.revokeKey(s.user.id, slugOf(req), String((req.params as { keyId?: unknown }).keyId ?? "")); return reply.send({ ok: true }); } catch (err) { return fail(req, reply, err); }
  });

  // ------------------------------------------------------------------ commands

  app.get("/v1/bots/:slug/commands", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send({ commands: await s.b.listCommands(s.user.id, slugOf(req)) }); } catch (err) { return fail(req, reply, err); }
  });

  app.post("/v1/bots/:slug/commands", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.code(201).send({ command: await s.b.putCommand(s.user.id, slugOf(req), req.body) }); } catch (err) { return fail(req, reply, err); }
  });

  app.put("/v1/bots/:slug/commands/:name", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send({ command: await s.b.putCommand(s.user.id, slugOf(req), { ...bodyOf(req.body), name: (req.params as { name?: unknown }).name }) }); } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/bots/:slug/commands/:name", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { await s.b.removeCommand(s.user.id, slugOf(req), String((req.params as { name?: unknown }).name ?? "")); return reply.send({ ok: true }); } catch (err) { return fail(req, reply, err); }
  });

  // ------------------------------------------------------------------ memory

  app.get("/v1/bots/:slug/memory", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.header("cache-control", "no-store").send(await s.b.memory(s.user.id, slugOf(req))); } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/bots/:slug/memory/:factId", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send({ ok: true, ...(await s.b.forget(s.user.id, slugOf(req), String((req.params as { factId?: unknown }).factId ?? ""))) }); } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/bots/:slug/memory", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send({ ok: true, ...(await s.b.forget(s.user.id, slugOf(req))) }); } catch (err) { return fail(req, reply, err); }
  });

  // ------------------------------------------------------------------ the apps linked to a bot

  app.get("/v1/bots/:slug/connectors", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send({ connectors: await s.b.connectors(s.user.id, slugOf(req)) }); } catch (err) { return fail(req, reply, err); }
  });

  app.put("/v1/bots/:slug/connectors/:id", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send(await s.b.link(s.user.id, slugOf(req), String((req.params as { id?: unknown }).id ?? ""))); } catch (err) { return fail(req, reply, err); }
  });

  app.delete("/v1/bots/:slug/connectors/:id", RL, async (req, reply) => {
    const s = await begin(req, reply);
    if (!s) return reply;
    try { return reply.send(await s.b.unlink(s.user.id, slugOf(req), String((req.params as { id?: unknown }).id ?? ""))); } catch (err) { return fail(req, reply, err); }
  });
}
