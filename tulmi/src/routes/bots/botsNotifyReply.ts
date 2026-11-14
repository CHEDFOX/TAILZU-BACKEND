/**
 * REPLYING TO A BOT FROM ITS NOTIFICATION (src/bots/notifyReply.ts, docs/widgets.md §5).
 *
 *   POST /v1/bots/:slug/notify-reply { text, thread?, key? }  -> { ok: true, state: "sent" | "open" }
 *
 * The phone's Reply button calls it in the background, with the app's own session and no app on screen: the words typed into the
 * notification go into that bot's chat exactly as a message typed in the app would, and the bot's answer comes back as another
 * push with the same Reply button on it.
 *
 * While NOTIFY_REPLY is off the route answers 404 notify_reply_off, before the session, the way Spaces' routes answer while Spaces
 * is off: a build that still asks gets the same plain answer whoever asks. On, but NOTIFY_REPLY_USERS does not name this account:
 * the same 404, once the session says who it is.
 *
 * Nothing of the person's words is ever logged: what they typed into their lock screen is theirs.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { isBotError, type Bots } from "../../bots/index.js";
import type { BotChat } from "../../botsBots/chat.js";
import { NotifyReplies, NotifyReplyError, notifyReplyOn, notifyReplySwitchOn } from "../../bots/notifyReply.js";
import { notifyBot } from "../../push/index.js";
import { defaultGuard, Overloaded } from "../../guard/index.js";
import { planOf } from "../../http/guarded.js";
import { AI_CONSENT_CODE, AI_CONSENT_TEXT, isAiConsentError } from "../../privacy/aiGate.js";
import { eventStore, type EventStore } from "../../shell/events.js";

export interface NotifyReplyRoutesDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** Null while BOTS is off: then the route is a 404 like every other bot route. */
  bots: Bots | null;
  /** The person's chat with a bot (botsBots/chat.ts): the same door the app's chat uses. */
  chat: BotChat | null;
  /** What the person's spaces shared with this bot, as the app's chat reads it (routes/bots/botsBots.ts chatShared). */
  shared?: (userId: string, slug: string) => Promise<Array<{ name: string; kind: string; text: string }>>;
  /** Activity's record of an answer, written once per answer as the app's chat writes it (shell/events.ts). */
  events?: EventStore;
}

const SLUG = /^[a-z0-9-]{1,64}$/;
const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

export function registerNotifyReplyRoutes(app: FastifyInstance, deps: NotifyReplyRoutesDeps): void {
  const { bots, chat } = deps;
  // Tighter than a normal route: a lock-screen box should not be a way to spend a day's model budget in a minute. The service's
  // own per-hour count is the real limit; this only keeps a flood off the door.
  const RL = { config: { rateLimit: { max: Math.min(30, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } };

  const replies = new NotifyReplies({
    find: async (userId, slug) => {
      if (!bots) return null;
      const found = await bots.resolve(userId, slug);
      if (!found) return null;
      // A person's own bot: its words are their own business, so its push says there is something to read, not what — the way
      // every other message push here goes without the words. A built-in (Plan, Travel) says its line.
      return { slug: found.def.slug, name: found.def.name, ...(found.def.ownerId !== null ? { private: true } : {}) };
    },
    // The app's chat door (routes/bots/botsBots.ts POST /chat/:slug): what the spaces shared with the bot, the chat's own send, and
    // the answer written down for Activity with what it cost.
    say: async (userId, slug, text) => {
      const shared = deps.shared ? await deps.shared(userId, slug).catch(() => []) : [];
      const r = await chat!.send(userId, slug, text, undefined, shared);
      await (deps.events ?? eventStore()).add(userId, { kind: "ask", bot: slug, title: text, paise: r.answer.paise, amountPaise: 0, payee: "" }, Date.now())
        .catch(() => undefined);
      return r.answer.text;
    },
    push: (userId, kind, p, key) => notifyBot(userId, kind, p, key),
  });

  app.post("/v1/bots/:slug/notify-reply", RL, async (req: FastifyRequest, reply: FastifyReply) => {
    // Launch dark, before anything else: no switch, no route. The per-person list is read after the session, since it names accounts.
    // The switch alone here: the NOTIFY_REPLY_USERS list names accounts, and a named one must get as far as its session.
    if (!bots || !chat || !notifyReplySwitchOn()) return off(reply);
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    if (!notifyReplyOn(user.id)) return off(reply);
    const slug = String((req.params as { slug?: unknown }).slug ?? "").toLowerCase();
    if (!SLUG.test(slug)) return reply.code(404).send({ code: "not_found", message: "There is no such bot." });
    const b = bodyOf(req.body);
    try {
      // Under a permit, as the app's chat runs under guarded(): no person, and not the server, runs more model turns at once than the
      // limits allow (guard/limiter.ts). A replayed press holds it only for the moment it takes to answer from memory.
      const plan = await planOf(user);
      const r = await defaultGuard().limiter.run(user.id, plan, () => replies.reply(user.id, slug, { text: b.text, key: b.key, thread: b.thread }));
      return reply.send({ ok: true, state: r.state });
    } catch (err) {
      if (err instanceof NotifyReplyError) {
        if (err.status === 429) reply.header("retry-after", "600");
        return reply.code(err.status).send({ code: err.code, message: err.message });
      }
      // The bot's own refusals keep their status, as on the app's chat (its day budget, Xode's own page, an account leaving): a 403 or
      // 409 is not tried again by the phone, which says to finish in the app, and a 429 is tried later (categoriesCore.ts retryable);
      // as a 500 every one of them was retried for a day to the same answer.
      if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
      if (err instanceof Overloaded) {
        reply.header("retry-after", String(err.retryAfterSec));
        return reply.code(429).send({ code: err.code, message: err.message });
      }
      if (isAiConsentError(err)) return reply.code(403).send({ code: AI_CONSENT_CODE, message: AI_CONSENT_TEXT });
      // Never the error's own words, and never the request's: what was typed is the person's.
      req.log.error({ err: (err as Error)?.name }, "notify-reply: failed");
      return reply.code(500).send({ code: "bot_failed", message: "Couldn't do that just now." });
    }
  });
}

/** What the route answers while the switch is off: the same for everyone, so nothing is given away. */
const off = (reply: FastifyReply): FastifyReply =>
  reply.code(404).send({ code: "notify_reply_off", message: "That isn't switched on here." });
