/**
 * Bots app · the person's own calendar and to-dos (src/calendar; the Plan bot's pages in experience/bots/screens/bots.ts and planItem.ts).
 * Registered by routes/botsBots.ts. Every route is the signed-in person's own (401 without a session); another person's is "not found".
 *
 *   GET    /v1/botsapp/calendar?from=&to=&tz=          -> { events, tasks, open }   the days' events (a series' starts as their own) and
 *                                                         to-dos, and the open to-dos with no day. At most 93 days.
 *   GET    /v1/botsapp/calendar/events/:id?tz=         -> { event }      ("<id>@<day>": one start of a series)
 *   POST   /v1/botsapp/calendar/events { title, day, time?, endTime? | minutes?, allDay?, place?, notes?, repeat?, until?, remind?, tz }
 *                                                      -> 201 { event }   no time is all day; a title with a time in it ("Dentist 5 pm") is read
 *   PUT    /v1/botsapp/calendar/events/:id { …the same, what changes }   -> { event }
 *   DELETE /v1/botsapp/calendar/events/:id?one=1       -> { ok }   one=1: only that day of a series
 *   GET    /v1/botsapp/calendar/tasks/:id              -> { task }
 *   POST   /v1/botsapp/calendar/tasks { title, notes?, day?, time?, list?, remind?, tz }   -> 201 { task }
 *   PUT    /v1/botsapp/calendar/tasks/:id { done } ticks it (a space's says so in the space; a meeting's ticks the meeting's to-do);
 *                                         { title, notes, day, time, list, remind } changes it   -> { task }
 *   DELETE /v1/botsapp/calendar/tasks/:id              -> { ok }
 *   POST   /v1/botsapp/calendar/quick { words, day?, kind?, tz }   -> 201 { kind, event | task, said }   "Dentist Fri 5 pm"
 *   POST   /v1/botsapp/calendar/cant/:id               -> { ok }   "Can't do it" for a space's plan or task: the space hears it, it comes off
 *   GET    /v1/botsapp/calendar/notes/:noteId          -> { todos: { [todoId]: { id, done } } }   which of a meeting's to-dos are on the list
 *   POST   /v1/botsapp/calendar/notes/:noteId/:todoId { tz }   -> 201 { task }   a meeting's to-do, put on the list ("Add to my tasks"), once
 *   PUT    /v1/botsapp/calendar/notes/:noteId/:todoId { done }  -> { ok, found }   the meeting's tick, on the list too
 *
 * The calendar publishes its own live topics (calendar, tasks, bot:plan). The reminders it sets are sent from here: every minute, the ones
 * due go through the push engine ("plan_reminder", push/defaults.ts), once.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { isBotError } from "../bots/types.js";
import { calendar as sharedCalendar, startReminders, type Calendar } from "../calendar/index.js";
import { getNote } from "../notes/store.js";
import { tickTodo } from "../notes/extract.js";
import { pushEngine } from "../push/index.js";
import type { BotsAreaDeps } from "./botsArea.js";

export const CALENDAR = "/v1/botsapp/calendar";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
const query = (req: FastifyRequest, k: string): string | undefined => {
  const v = (req.query as Record<string, unknown> | undefined)?.[k];
  return typeof v === "string" ? v : undefined;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TODO_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function registerCalendarRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, o: { calendar?: Calendar; reminders?: boolean } = {}): Calendar {
  const cal = o.calendar ?? sharedCalendar();
  const RL = { config: deps.rateLimit };

  if (o.reminders !== false) {
    const stop = startReminders(cal, async (userId, msg) => { try { await pushEngine()?.notify(userId, msg); } catch { /* the reminder is still on their Plan */ } }, app.log);
    app.addHook("onClose", async () => { stop(); });
  }

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    req.log.error({ err: (err as Error)?.name }, "calendar: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };
  /** A route that runs `fn` for the signed-in person, answering what it returns (or its BotError). */
  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) { return fail(req, reply, err); }
    };

  app.get(CALENDAR, RL, run(async (user, req) => cal.list(user.id, { from: query(req, "from") ?? "", to: query(req, "to") ?? query(req, "from") ?? "", tz: query(req, "tz") })));

  // ------------------------------------------------------------------ events
  app.get(`${CALENDAR}/events/:id`, RL, run(async (user, req) => ({ event: await cal.event(user.id, param(req, "id"), query(req, "tz")) })));
  app.post(`${CALENDAR}/events`, RL, run(async (user, req, reply) => { const event = await cal.addEvent(user.id, bodyOf(req.body)); reply.code(201); return { event }; }));
  app.put(`${CALENDAR}/events/:id`, RL, run(async (user, req) => ({ event: await cal.changeEvent(user.id, param(req, "id"), bodyOf(req.body)) })));
  app.delete(`${CALENDAR}/events/:id`, RL, run(async (user, req) => { await cal.removeEvent(user.id, param(req, "id"), { one: query(req, "one") === "1" }); return { ok: true }; }));

  // ------------------------------------------------------------------ to-dos
  app.get(`${CALENDAR}/tasks/:id`, RL, run(async (user, req) => ({ task: await cal.task(user.id, param(req, "id")) })));
  app.post(`${CALENDAR}/tasks`, RL, run(async (user, req, reply) => { const task = await cal.addTask(user.id, bodyOf(req.body)); reply.code(201); return { task }; }));
  app.put(`${CALENDAR}/tasks/:id`, RL, run(async (user, req) => {
    const task = await cal.changeTask(user.id, param(req, "id"), bodyOf(req.body));
    // A meeting's to-do: the meeting's own tick follows (it tells the meeting's page itself).
    if (task.noteId && task.todoId && bodyOf(req.body).done !== undefined) await tickTodo(user, task.noteId, task.todoId, task.done).catch(() => null);
    return { task };
  }));
  app.delete(`${CALENDAR}/tasks/:id`, RL, run(async (user, req) => { await cal.removeTask(user.id, param(req, "id")); return { ok: true }; }));

  // ------------------------------------------------------------------ a line of words, and someone else's
  app.post(`${CALENDAR}/quick`, RL, run(async (user, req, reply) => {
    const b = bodyOf(req.body);
    const r = await cal.quick(user.id, b.words, { day: b.day, tz: b.tz, kind: b.kind });
    reply.code(201);
    return r;
  }));
  app.post(`${CALENDAR}/cant/:id`, RL, run(async (user, req) => { await cal.cantDo(user.id, param(req, "id")); return { ok: true }; }));

  // ------------------------------------------------------------------ a meeting's to-dos
  app.get(`${CALENDAR}/notes/:noteId`, RL, run(async (user, req) => {
    const id = param(req, "noteId");
    return { todos: UUID.test(id) ? await cal.fromNote(user.id, id) : {} };
  }));
  app.post(`${CALENDAR}/notes/:noteId/:todoId`, RL, run(async (user, req, reply) => {
    const noteId = param(req, "noteId"), todoId = param(req, "todoId");
    const note = UUID.test(noteId) && TODO_ID.test(todoId) ? await getNote(user, noteId) : null;
    const todo = note?.todos?.find((t) => t.id === todoId);
    if (!note || !todo) { reply.code(404); return { code: "not_found", message: "That to-do isn't in the meeting any more." }; }
    const task = await cal.addFromNote(user.id, { noteId, todoId, noteTitle: note.title, text: todo.text, ...(todo.when ? { when: todo.when } : {}), done: todo.done, tz: bodyOf(req.body).tz });
    reply.code(201);
    return { task };
  }));
  app.put(`${CALENDAR}/notes/:noteId/:todoId`, RL, run(async (user, req) => {
    const done = bodyOf(req.body).done;
    if (typeof done !== "boolean") { return { ok: false, found: false }; }
    const noteId = param(req, "noteId"), todoId = param(req, "todoId");
    if (!UUID.test(noteId) || !TODO_ID.test(todoId)) return { ok: true, found: false };
    return { ok: true, found: await cal.tickFromNote(user.id, noteId, todoId, done) };
  }));

  return cal;
}
