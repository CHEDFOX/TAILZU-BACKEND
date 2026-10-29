/**
 * Bots app · bots area: the endpoints its screens need beyond the existing routes (src/botsBots, screens in experience/bots/screens/bots.ts).
 *
 *   GET    /v1/botsapp/bots/chat/:slug                 -> { turns }                      the chat with a bot, oldest first
 *   POST   /v1/botsapp/bots/chat/:slug { message }     -> { text, turns, opens, approvals, paise }   asks it (Bots.ask) and keeps both turns;
 *                                                      the answer is written down for Activity, as Ask's are (shell/events.ts)
 *   DELETE /v1/botsapp/bots/chat/:slug                 -> { ok }                          start the chat over
 *   GET    /v1/botsapp/bots/draft                      -> { draft }                       Make a bot: the draft in progress, or null
 *   POST   /v1/botsapp/bots/draft { sentence }         -> { draft }                       Bots.draft, kept while it is shaped (nothing is a bot yet)
 *   PUT    /v1/botsapp/bots/draft { name?, colour?, addRule?, dropRule?, files?, web?, connector? }   -> { draft }
 *   POST   /v1/botsapp/bots/draft/try { message }      -> { said, answered }              Bots.test on the draft
 *   POST   /v1/botsapp/bots/draft/approve              -> 201 { bot }                     Bots.approve: the bot is made
 *   DELETE /v1/botsapp/bots/draft                      -> { ok }
 *   POST   /v1/botsapp/bots/rules/:slug { rule }       -> { bot }                         a rule added to your bot;  DELETE .../rules/:slug/:index
 *   GET    /v1/botsapp/bots/store?q=                   -> { readyMade, people }           Find a bot
 *   GET    /v1/botsapp/bots/store/:id                  -> { entry }
 *   POST   /v1/botsapp/bots/store/:id/add              -> 201 { bot }                     a copy of it, yours
 *   GET|PUT|DELETE /v1/botsapp/bots/listing/:slug      -> { listed }                      your bot in the store (and its public card), or not
 *   GET    /v1/botsapp/bots/keys/:slug/usage           -> { usage, ratePerMin, dayCapPaise, endpoint }   what its keys used this month
 *   /v1/botsapp/bots/spaces..., /shares, /items..., /threads..., /invite/:code   spaces, sharing, payment requests and messaging: routes/botsSpaces.ts
 *   GET    /v1/botsapp/bots/plan?tz=&week=             -> { connected, today, tomorrow, days, open, suggestion }   from the person's own
 *                                                      calendar and to-dos (src/calendar; their own routes: /v1/botsapp/calendar..., routes/botsCalendar.ts)
 *   POST   /v1/botsapp/bots/plan/move { eventId, start, said }  -> { done, message } (409 when it could not)
 *   POST   /v1/botsapp/bots/plan/skip { key }          -> { ok }
 *   GET    /v1/botsapp/bots/trip                       -> { trip, facts, bookings };  POST { place, when, who };  PUT/DELETE .../trip/:id
 *   POST   /v1/botsapp/bots/trip/:id/packing { text };  POST .../packing/starter;  PUT .../packing/:i (toggle);  DELETE .../packing/:i
 *   POST   /v1/botsapp/bots/share/suggest { name?, text?, url? }   -> { pick, by, ask, line }   the front door's pick of a bot (Bots.target)
 *   POST   /v1/botsapp/bots/share/compose { what, name?, text?, url? }  -> { message }
 *
 * And it counts what each bot API key used (an onSend hook on POST /v1/bots/:slug/ask with a key), for the keys page.
 * With BOTS off the routes that need it answer 404 bots_off. Everything is the signed-in person's own. Bodies are never logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { BotError, isBotError, type Bots } from "../bots/index.js";
import { bearerKey, looksLikeKey, maskKey, prefixOf } from "../bots/keys.js";
import { getConfig } from "../config.js";
import { defaultGuard } from "../guard/index.js";
import { botsAreaParts, shareAsk, shareLine, shareMessage, type BotsAreaParts } from "../botsBots/index.js";
import { eventStore, type EventStore } from "../shell/events.js";
import type { BotsAreaDeps } from "./botsArea.js";
import { guarded } from "./guarded.js";
import { openAskStream } from "../live/askStream.js";
import { scrub } from "../bots/run.js";
import type { BotEvent } from "../bots/types.js";
import { registerSpacesRoutes } from "./botsSpaces.js";
import { registerBotsTripRoutes } from "./botsTrips.js";
import { registerCalendarRoutes } from "./botsCalendar.js";

export const AREA = "/v1/botsapp/bots";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
const query = (req: FastifyRequest, k: string): string | undefined => {
  const v = (req.query as Record<string, unknown> | undefined)?.[k];
  return typeof v === "string" ? v : undefined;
};

/** How a person is shown to others: "aanya.sharma@…" is "Aanya S.". */
export function shownName(user: Pick<AuthedUser, "email" | "phone">): string {
  const local = user.email?.split("@")[0] ?? "";
  const parts = local.split(/[._\-+0-9]+/).filter(Boolean);
  if (!parts.length) return user.phone ? `…${user.phone.slice(-4)}` : "Someone";
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1).toLowerCase();
  return parts.length > 1 ? `${cap(parts[0]!)} ${parts[1]![0]!.toUpperCase()}.` : cap(parts[0]!);
}

/** The API's own address, for the keys page and invite links. */
export function apiOrigin(): string {
  try { return new URL(getConfig().CONNECTOR_REDIRECT_URL).origin; } catch { return "https://api.tailzu.space"; }
}

/**
 * Returns `sharedFor`: what the person's spaces shared with a bot (shared.ts forBot), for "Ask any bot" on POST /v1/ask (routes/front.ts),
 * so a bot shared into a space reads it there as it does in its chat.
 */
export function registerBotsBotsRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { parts?: BotsAreaParts; events?: EventStore } = {}): { sharedFor: (userId: string, slug: string) => Promise<Array<{ name: string; kind: string; text: string }>> } {
  const parts = o.parts ?? botsAreaParts({ bots: deps.bots, connectors: deps.connectors });
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const guard = () => deps.bots?.guard ?? defaultGuard();
  // Spaces: members, invites, sharing, payment requests, messaging. A bot shared into a space reads its shared things when a member asks it.
  const spacesArea = registerSpacesRoutes(app, deps, { spaces: parts.spaces, trips: parts.trips });
  registerBotsTripRoutes(app, deps, parts); // a trip's weather, places and stays; the Plan bot's home (routes/botsTrips.ts)
  registerCalendarRoutes(app, deps); // the person's own calendar and to-dos, and their reminders (routes/botsCalendar.ts)

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) {
      const { retryAfterSec: _r, ...detail } = err.detail ?? {};
      void _r;
      return reply.code(err.status).send({ code: err.code, message: err.message, ...detail });
    }
    req.log.error({ err: (err as Error)?.name }, "bots area: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };

  const who = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    return user;
  };
  const withBots = async (req: FastifyRequest, reply: FastifyReply): Promise<{ user: AuthedUser; bots: Bots } | null> => {
    if (!deps.bots) { reply.code(404).send({ code: "bots_off", message: "Bots are not switched on." }); return null; }
    const user = await who(req, reply);
    return user ? { user, bots: deps.bots } : null;
  };
  /** A route that runs `fn` for the signed-in person, answering what it returns (or its BotError). */
  const run = (needsBots: boolean, fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = needsBots ? (await withBots(req, reply))?.user : await who(req, reply);
      if (!user) return reply;
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) { return fail(req, reply, err); }
    };

  // ------------------------------------------------------------------ chat

  app.get(`${AREA}/chat/:slug`, RL, run(true, async (user, req) => {
    const limit = Number(query(req, "limit") ?? 30);
    return { turns: await parts.chat!.recent(user.id, param(req, "slug").toLowerCase(), Number.isFinite(limit) ? limit : 30) };
  }));

  app.post(`${AREA}/chat/:slug`, tight(60), async (req, reply) => {
    const s = await withBots(req, reply);
    if (!s) return reply;
    // An app that listens gets the words as they are written and what the bot is doing, and can stop it (live/askStream.ts).
    const words = openAskStream(s.user.id, bodyOf(req.body).streamId, { guard: (t) => scrub(t).cleaned });
    const live = words ? {
      onText: (piece: string) => words.text(piece), onReset: () => words.reset(),
      emit: (e: BotEvent) => { if (e.t === "status") words.step(e.stage); else if (e.t === "text") words.whole(e.text); },
    } : {};
    try {
      const out = await guarded(guard(), req, reply, s.user, "ask", async (stop) => {
        const slug = param(req, "slug").toLowerCase(), message = bodyOf(req.body).message;
        const shared = await spacesArea.items.forBot(s.user.id, slug).catch(() => []);
        const r = await parts.chat!.send(s.user.id, slug, message, stop, shared, live);
        // Activity: written down as an answer through Ask is (shell/events.ts), once per answer: a repeat is replayed, not run again.
        await (o.events ?? eventStore()).add(s.user.id, { kind: "ask", bot: slug, title: String(message), paise: r.answer.paise, amountPaise: 0, payee: "" }, Date.now())
          .catch((err) => req.log.warn({ error: (err as Error)?.message }, "bots area: answer not written down"));
        return { status: 200, body: { text: r.answer.text, turns: r.turns, opens: r.answer.opens, approvals: r.answer.approvals, paise: r.answer.paise } };
      }, { replayUnkeyed: false, ...(words ? { signal: words.signal } : {}) });
      if (words?.stopped && !reply.sent) { const said = words.said; words.end(); return reply.code(409).send({ code: "stopped", message: "Stopped.", text: said }); }
      words?.end();
      return out;
    } catch (err) {
      if (words?.stopped && !reply.sent) { const said = words.said; words.end(); return reply.code(409).send({ code: "stopped", message: "Stopped.", text: said }); }
      words?.end();
      return fail(req, reply, err);
    }
  });

  app.delete(`${AREA}/chat/:slug`, RL, run(true, async (user, req) => ({ ok: true, cleared: await parts.chat!.clear(user.id, param(req, "slug")) })));

  // ------------------------------------------------------------------ make a bot

  app.get(`${AREA}/draft`, RL, run(true, async (user) => ({ draft: await parts.maker!.get(user.id) })));

  app.post(`${AREA}/draft`, tight(20), async (req, reply) => {
    const s = await withBots(req, reply);
    if (!s) return reply;
    try {
      return await guarded(guard(), req, reply, s.user, "ask", async (stop) => ({ status: 200, body: { draft: await parts.maker!.make(s.user.id, bodyOf(req.body).sentence, stop) } }));
    } catch (err) { return fail(req, reply, err); }
  });

  app.put(`${AREA}/draft`, RL, run(true, async (user, req) => ({ draft: await parts.maker!.change(user.id, bodyOf(req.body)) })));

  app.post(`${AREA}/draft/try`, tight(30), async (req, reply) => {
    const s = await withBots(req, reply);
    if (!s) return reply;
    try {
      return await guarded(guard(), req, reply, s.user, "ask", async (stop) => ({ status: 200, body: await parts.maker!.tryIt(s.user.id, bodyOf(req.body).message, stop) }), { replayUnkeyed: false });
    } catch (err) { return fail(req, reply, err); }
  });

  app.post(`${AREA}/draft/approve`, RL, run(true, async (user, _req, reply) => { reply.code(201); return parts.maker!.approve(user.id); }));
  app.delete(`${AREA}/draft`, RL, run(true, async (user) => { await parts.maker!.discard(user.id); return { ok: true }; }));

  // ------------------------------------------------------------------ a bot's rules

  app.post(`${AREA}/rules/:slug`, RL, run(true, async (user, req) => {
    const bot = await deps.bots!.get(user.id, param(req, "slug").toLowerCase());
    const rule = bodyOf(req.body).rule;
    if (typeof rule !== "string" || !rule.trim()) throw new BotError("bad_request", "Write the rule first.");
    const text = rule.replace(/\s+/g, " ").trim();
    if (bot.principles.includes(text)) return { bot };
    return deps.bots!.update(user.id, bot.slug, { principles: [...bot.principles, text] });
  }));

  app.delete(`${AREA}/rules/:slug/:index`, RL, run(true, async (user, req) => {
    const bot = await deps.bots!.get(user.id, param(req, "slug").toLowerCase());
    const i = Number(param(req, "index"));
    if (!Number.isInteger(i) || i < 0 || i >= bot.principles.length) throw new BotError("not_found", "That rule isn't there any more.", 404);
    return deps.bots!.update(user.id, bot.slug, { principles: bot.principles.filter((_, j) => j !== i) });
  }));

  // ------------------------------------------------------------------ find a bot

  app.get(`${AREA}/store`, RL, run(true, async (user, req) => parts.shop!.browse(user.id, query(req, "q")?.slice(0, 60))));

  app.get(`${AREA}/store/:id`, RL, run(true, async (user, req) => {
    const entry = await parts.shop!.entry(user.id, param(req, "id"));
    if (!entry) throw new BotError("not_found", "That bot isn't in the store any more.", 404);
    return { entry };
  }));

  app.post(`${AREA}/store/:id/add`, tight(20), run(true, async (user, req, reply) => { const r = await parts.shop!.add(user.id, param(req, "id")); reply.code(201); return r; }));

  app.get(`${AREA}/listing/:slug`, RL, run(true, async (user, req) => ({ listed: await parts.shop!.listed(user.id, param(req, "slug").toLowerCase()) })));
  app.put(`${AREA}/listing/:slug`, RL, run(true, async (user, req) => parts.shop!.list(user.id, param(req, "slug").toLowerCase(), shownName(user))));
  app.delete(`${AREA}/listing/:slug`, RL, run(true, async (user, req) => parts.shop!.unlist(user.id, param(req, "slug").toLowerCase())));

  // ------------------------------------------------------------------ keys: what they used

  app.get(`${AREA}/keys/:slug/usage`, RL, run(true, async (user, req) => {
    const slug = param(req, "slug").toLowerCase();
    await deps.bots!.listKeys(user.id, slug); // yours, or a 404 / 403
    const tz = Number(query(req, "tz"));
    return {
      usage: await parts.usage.month(user.id, slug, Number.isFinite(tz) ? tz : undefined),
      ratePerMin: deps.bots!.limits.keyRatePerMin, dayCapPaise: deps.bots!.limits.keyDailyPaise, endpoint: `${apiOrigin()}/v1/bots/${slug}/ask`,
    };
  }));

  // A key's answered request is counted after it went out. Streams (hijacked) are not seen here.
  // A callback hook on purpose: an async onSend on every route delays reply.sent, and handlers that call reply.send()
  // without returning it would then be sent twice (ERR_HTTP_HEADERS_SENT).
  app.addHook("onSend", (req, reply, payload, done) => {
    try {
      if (req.method !== "POST" || reply.statusCode !== 200 || req.routeOptions?.url !== "/v1/bots/:slug/ask" || !deps.bots) return done(null, payload);
      const auth = req.headers["authorization"];
      if (!looksLikeKey(auth)) return done(null, payload);
      const key = bearerKey(auth);
      if (!key) return done(null, payload);
      const slug = String((req.params as { slug?: unknown }).slug ?? "").toLowerCase();
      const paise = typeof payload === "string" ? Number((JSON.parse(payload) as { paise?: unknown }).paise) || 0 : 0;
      const b = deps.bots;
      void (async () => {
        const bot = await b.store.getBySlug(slug).catch(() => null);
        if (bot?.ownerId) await parts.usage.record(bot.ownerId, slug, maskKey(prefixOf(key)), paise);
      })().catch(() => undefined);
    } catch { /* counting never breaks an answer */ }
    done(null, payload);
  });

  // ------------------------------------------------------------------ spaces: family and friends (routes/botsSpaces.ts)

  // ------------------------------------------------------------------ the plan bot's days

  app.get(`${AREA}/plan`, RL, run(false, async (user, req) => {
    const tz = Number(query(req, "tz") ?? 330);
    const week = Number(query(req, "week") ?? 0);
    return parts.plan.read(user.id, { tz: Number.isFinite(tz) ? tz : 330, week: Number.isFinite(week) ? week : 0 });
  }));

  app.post(`${AREA}/plan/move`, tight(20), run(false, async (user, req, reply) => {
    const b = bodyOf(req.body);
    const r = await parts.plan.move(user.id, b.eventId, b.start, b.said);
    if (!r.done) reply.code(409);
    return r.done ? r : { code: "not_moved", message: r.message };
  }));

  app.post(`${AREA}/plan/skip`, RL, run(false, async (user, req) => { await parts.plan.skip(user.id, bodyOf(req.body).key); return { ok: true }; }));

  // ------------------------------------------------------------------ the travel bot's trip

  app.get(`${AREA}/trip`, RL, run(false, async (user) => {
    const [trip, facts, bookings] = await Promise.all([
      parts.trips.current(user.id),
      deps.bots ? deps.bots.memory(user.id, "travel").then((m) => m.facts.map((f) => ({ id: f.id, text: f.text }))).catch(() => []) : Promise.resolve([]),
      parts.chat ? parts.chat.opens(user.id, "travel").catch(() => []) : Promise.resolve([]),
    ]);
    return { trip, facts, bookings };
  }));
  app.post(`${AREA}/trip`, RL, run(false, async (user, req, reply) => { const trip = await parts.trips.create(user.id, bodyOf(req.body)); reply.code(201); return { trip }; }));
  app.put(`${AREA}/trip/:id`, RL, run(false, async (user, req) => ({ trip: await parts.trips.change(user.id, param(req, "id"), bodyOf(req.body)) })));
  app.delete(`${AREA}/trip/:id`, RL, run(false, async (user, req) => { await parts.trips.remove(user.id, param(req, "id")); return { ok: true }; }));
  app.post(`${AREA}/trip/:id/packing`, RL, run(false, async (user, req) => ({ trip: await parts.trips.pack(user.id, param(req, "id"), bodyOf(req.body).text) })));
  app.post(`${AREA}/trip/:id/packing/starter`, RL, run(false, async (user, req) => ({ trip: await parts.trips.starter(user.id, param(req, "id")) })));
  app.put(`${AREA}/trip/:id/packing/:i`, RL, run(false, async (user, req) => ({ trip: await parts.trips.toggle(user.id, param(req, "id"), Number(param(req, "i"))) })));
  app.delete(`${AREA}/trip/:id/packing/:i`, RL, run(false, async (user, req) => ({ trip: await parts.trips.unpack(user.id, param(req, "id"), Number(param(req, "i"))) })));

  // ------------------------------------------------------------------ share in

  app.post(`${AREA}/share/suggest`, tight(30), async (req, reply) => {
    const s = await withBots(req, reply);
    if (!s) return reply;
    const b = bodyOf(req.body);
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const shared = { name: str(b.name, 200), text: str(b.text, 2000), url: str(b.url, 2000) };
    const kind: "file" | "link" | "text" = shared.url ? "link" : shared.text ? "text" : "file";
    const said = shareMessage("", shared);
    try {
      return await guarded(guard(), req, reply, s.user, "ask", async (stop) => {
        const t = await s.bots.target(s.user.id, "any", said, { attachments: [], recent: [], mode: "text" }, stop);
        const pick = t.bot ?? null;
        return {
          status: 200,
          body: {
            pick: pick?.slug ?? null, by: t.by, reasons: t.reasons.slice(0, 3),
            ask: shareAsk(pick?.slug ?? "", kind), line: pick ? shareLine(pick.slug, pick.name) : "Your bots read it and the best one answers.",
          },
        };
      });
    } catch (err) { return fail(req, reply, err); }
  });

  app.post(`${AREA}/share/compose`, RL, run(false, async (_user, req) => {
    const b = bodyOf(req.body);
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    return { message: shareMessage(str(b.what, 600), { name: str(b.name, 200), text: str(b.text, 6000), url: str(b.url, 2000) }) };
  }));

  return { sharedFor: (userId, slug) => spacesArea.items.forBot(userId, slug.toLowerCase()) };
}
