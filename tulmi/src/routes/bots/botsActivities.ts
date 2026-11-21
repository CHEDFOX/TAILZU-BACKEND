/**
 * Bots app · ACTIVITIES: what the work turned into (docs/talk-door.md; the screen is experience/bots/screens/bots/activities.ts).
 *
 *   GET /v1/botsapp/activities?tz=   -> { schedules, now, done }
 *
 * IT READS, IT DOES NOT DECIDE. Every rule is `botsBots/activities.ts` — pure, tested on its own, no model and no
 * clock of its own. This route's whole job is fetching the four things that rule needs and handing them over:
 *
 *   the feed        GET /v1/shell/activity, the SAME read the ledger uses, so a row cleared there is gone here too
 *   Talk's threads  its sessions and their turns — where `by` (which bot answered) and `did` (what was set going)
 *                   live, which is what lets one activity have more than one bot on it
 *   the routines    src/routines, which are the schedules
 *   the looks       each bot's name and colour
 *
 * Nothing is stored. An activity is derived on every read, so there is no second copy of the truth to fall behind the
 * first — and no migration to run before any of this works.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { isBotError } from "../../bots/index.js";
import { activitiesFrom, type RoutineLite } from "../../botsBots/activities.js";
import type { BotChat } from "../../botsBots/chat.js";
import type { ChatTurn } from "../../botsBots/chat.js";
import type { Sessions } from "../../botsBots/sessions.js";
import { botLook } from "../../experience/bots/palette.js";
import type { FeedRow } from "../../shell/feed.js";
import { TALK_SLUG } from "./botsTalk.js";
import type { BotsAreaDeps } from "./botsArea.js";

/**
 * How many of Talk's threads are walked for their turns. Each is one more read, and an activity older than the last
 * few dozen conversations is history — the ledger has it, and `done` here is only the recent tail anyway.
 */
const THREADS = 24;
/** The most turns read from one thread: enough to hold everything it set going, not its whole conversation. */
const TURNS = 60;

export interface ActivitiesParts {
  chat: BotChat | null;
  sessions: Sessions;
}

export function registerActivitiesRoutes(app: FastifyInstance, deps: BotsAreaDeps, parts: ActivitiesParts): void {
  const RL = { config: deps.rateLimit };

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    req.log.error({ err: (err as Error)?.name }, "activities: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };

  app.get("/v1/botsapp/activities", RL, async (req, reply) => {
    if (!deps.bots || !parts.chat) return reply.code(404).send({ code: "bots_off", message: "Bots are not switched on." });
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const chat = parts.chat;
    const tzRaw = Number((req.query as { tz?: unknown } | undefined)?.tz);
    const tz = Number.isFinite(tzRaw) ? Math.trunc(tzRaw) : 0;

    try {
      // The feed, through the route the ledger itself uses: one read, one set of rules about what is cleared.
      const feed = app.inject({
        method: "GET", url: `/v1/shell/activity?tz=${tz}`,
        headers: { authorization: String(req.headers["authorization"] ?? "") },
      }).then((r) => {
        if (r.statusCode < 200 || r.statusCode >= 300) return [] as FeedRow[];
        const j = JSON.parse(r.body) as { rows?: FeedRow[] };
        return Array.isArray(j.rows) ? j.rows : [];
      }).catch(() => [] as FeedRow[]);

      const threads = parts.sessions.list(user.id, TALK_SLUG, THREADS).catch(() => []);
      // The person's own bots, for each head's name and colour.
      const mine = deps.bots.list(user.id).then((l) => l.map((b) => ({ slug: b.slug, name: b.name, colour: b.colour }))).catch(() => []);
      // The schedules. Absent while routines are off, and then there simply are none.
      // No cast: RoutineView satisfies RoutineLite structurally, so a change to either side fails here rather than
      // quietly drawing a schedule with no bot on it.
      const routines: Promise<RoutineLite[]> = deps.routines
        ? deps.routines.list(user.id).catch(() => [])
        : Promise.resolve([]);

      const [rows, sessions, bots, schedules] = await Promise.all([feed, threads, mine, routines]);

      // Each thread's turns: where `by` and `did` are. Read together, and a thread that fails to read is simply not
      // one of the activities rather than the end of the page.
      const turns = new Map<string, readonly ChatTurn[]>();
      await Promise.all(sessions.map(async (s) => {
        const t = await chat.ofSession(user.id, s.id, TURNS).catch(() => []);
        turns.set(s.id, t);
      }));

      const names = new Map(bots.map((b) => [b.slug, b]));
      const look = (slug: string): { name: string; color: string } => {
        const b = names.get(slug);
        return { name: b?.name ?? (slug === "tailzu" ? "X0" : slug), color: botLook(slug, b?.colour).color };
      };

      return reply.send(activitiesFrom({ sessions, turns, rows, routines: schedules, look }));
    } catch (err) { return fail(req, reply, err); }
  });
}
