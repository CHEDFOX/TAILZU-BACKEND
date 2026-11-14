/**
 * "SYNC WITH REMINDERS": THE ONE LIST'S OWN DOOR (calendar/remindersSync.ts; docs: perms2 §3).
 *
 *   POST   /v1/botsapp/plan/reminders/sync { enable?, listId, items[] }   -> { add, update, remove }
 *   POST   /v1/botsapp/plan/reminders/sync { applied: [{ id, ext }] }     -> { ok, linked }   the same pinned path
 *   POST   /v1/botsapp/plan/reminders/applied { applied: [{ id, ext }] }  -> { ok, linked }   the same thing, by its own name
 *   DELETE /v1/botsapp/plan/reminders                                     -> { ok, unlinked }
 *
 * ONE SYNC IS TWO REQUESTS, BOTH TO THE PINNED PATH. The phone reads the X0 Bot list (that list and no other), posts its items
 * here, and gets back what to apply TO THAT LIST: `add` (a to-do of theirs with no item yet), `update` (the to-do changed more
 * recently) and `remove` (its to-do is gone from X0). It applies them and posts back which item each added to-do became, which
 * is how the link is written here. `reminders.sync` pins ONE path (the contract, sdui.ts), so the second request arrives here
 * too and is told apart by its body: `applied` and no `items`. `/applied` stays as its own name. Nothing of any other list is
 * ever sent, asked for or stored.
 *
 * WHAT IS KEPT: the to-dos, exactly as a typed one is, plus `ext_src = 'apple_reminders'` and the item's opaque identifier on
 * the linked rows (migration 0094). The list's own identifier stays on the phone. Notes, URL, location, priority, alarms and
 * subtasks are never read or written.
 *
 * The DELETE is the switch going off: every link goes and both sides keep their items, which is what the row's words promise.
 *
 * Only the person's own signed-in session; a bot API key is 403. Logged: how many items and how many of each op, never a title.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { looksLikeKey } from "../../bots/keys.js";
import type { Calendar } from "../../calendar/index.js";
import { calendarRows, type TaskRow } from "../../calendar/store.js";
import {
  REMINDERS_LIMITS, planReminders, readApplied, readRemItems, type LocalTask, type SyncOps, type SyncWrites,
} from "../../calendar/remindersSync.js";
import { remindersGone, startRemindersGoneSweeper } from "../../calendar/remindersGone.js";
import type { PlanPrefs } from "../../botsBots/planPrefs.js";
import { remindersLive } from "../../experience/bots/kit.js";
import type { BotsAreaDeps } from "./botsArea.js";

export const REMINDERS_PATH = "/v1/botsapp/plan/reminders";

const bodyOf = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

/** A to-do row as the merge reads it. Nothing of a bill, a wait or a space's task goes out: only the person's own plain to-dos. */
const localOf = (r: TaskRow): LocalTask => ({
  id: r.id,
  title: r.title,
  due: r.due_day ?? null,
  at: r.due_ms ?? null,
  done: r.done === true,
  updatedAt: Number(r.updated_ms) || 0,
  extRef: typeof r.ext_ref === "string" && r.ext_ref ? r.ext_ref : null,
  fromReminders: r.ext_src === "apple_reminders",
});

/** Which to-dos may be in the sync at all: the person's own plain to-dos (never a bill, a wait, or one someone else set). */
const syncable = (r: TaskRow): boolean =>
  (r.kind ?? "todo") === "todo" && (r.source?.kind === "me" || typeof r.ext_ref === "string");

export function registerPlanRemindersRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, o: { calendar: Calendar; prefs: PlanPrefs; now?: () => number }): void {
  const now = o.now ?? Date.now;
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });

  // A deletion mark whose sync never came back is not kept for ever (calendar/remindersGone.ts).
  const stopGoneSweep = startRemindersGoneSweeper({ log: app.log });
  app.addHook("onClose", async () => { stopGoneSweep(); });

  /**
   * Whose session this is. `o.off` lets the request through whatever the switch says: turning the row OFF, and unlinking what
   * it linked, has to work after the switch goes off, or a person whose row has just disappeared is left with links they
   * cannot drop (the health "off" path does the same).
   */
  const who = async (req: FastifyRequest, reply: FastifyReply, o: { off?: boolean } = {}) => {
    const auth = req.headers["authorization"];
    if (looksLikeKey(auth)) { void reply.code(403).send({ code: "not_for_keys", message: "Only you can switch this on, in the app." }); return null; }
    const user = await resolveUser(auth).catch(() => null);
    if (!user) { void reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" }); return null; }
    if (!o.off && !remindersLive()) { void reply.code(403).send({ code: "reminders_off", message: "This isn't switched on yet." }); return null; }
    return user;
  };

  /** Every to-do the merge needs: the linked ones, done or not, and the open ones that could go out. */
  const mine = async (userId: string): Promise<LocalTask[]> => {
    const t = calendarRows().tasks;
    const [linked, open] = await Promise.all([
      t.linked(userId, REMINDERS_LIMITS.items).catch(() => [] as TaskRow[]),
      t.open(userId, REMINDERS_LIMITS.items),
    ]);
    const seen = new Set<string>();
    const out: LocalTask[] = [];
    for (const r of [...linked, ...open]) {
      if (seen.has(r.id) || !syncable(r)) continue;
      seen.add(r.id);
      out.push(localOf(r));
    }
    return out;
  };

  /**
   * THE DUE DATE, IN THE PERSON'S OWN ZONE. The phone sends an item's due date in UTC ("…T12:00:00.000Z" for 5:30 pm IST),
   * and the calendar reads a `day` + `time` pair in the person's zone (service.ts `due`: startOfDay(day, tz) + time). So
   * taking the day and the clock straight off the UTC string filed every timed to-do at the UTC time read as local — 5:30 pm
   * became noon, an item due 1:30 am landed on the day before, and the next sync wrote that wrong time back into Reminders.
   */
  const localDue = (iso: string | null | undefined, hasTime: boolean | undefined, tz: number): { day: string; time: string } => {
    if (!iso) return { day: "", time: "" };
    if (!hasTime) return { day: iso.slice(0, 10), time: "" };
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return { day: iso.slice(0, 10), time: "" };
    const local = new Date(at + tz * 60_000).toISOString();
    return { day: local.slice(0, 10), time: local.slice(11, 16) };
  };

  /** What the merge said to write here, written. Each failure is logged by its name and the rest still goes. */
  const apply = async (userId: string, w: SyncWrites, req: FastifyRequest): Promise<void> => {
    // The zone the day and the time are worked out in is the zone they are handed back in, so the instant survives the trip.
    const tz = o.calendar.tzFor(userId);
    for (const c of w.change) {
      const { day, time } = localDue(c.dueIso, c.dueHasTime, tz);
      await o.calendar.changeTask(userId, c.id, {
        ...(c.title !== undefined ? { title: c.title } : {}),
        day, ...(time ? { time } : { time: "" }), tz,
        ...(c.done !== undefined ? { done: c.done } : {}),
      }).catch((err: unknown) => { req.log.warn({ err: (err as Error)?.name }, "reminders: change failed"); });
    }
    for (const m of w.make) {
      const { day, time } = localDue(m.dueIso, m.dueHasTime, tz);
      const made = await o.calendar.addTask(userId, { title: m.title, day, ...(time ? { time } : {}), tz }, { kind: "me" }, null, {
        ext_src: "apple_reminders", ext_ref: m.ext,
      }).catch((err: unknown) => { req.log.warn({ err: (err as Error)?.name }, "reminders: add failed"); return null; });
      // An item already done when it arrived: the to-do is made, then ticked, so the Plan shows what the list shows.
      if (made && m.done) await o.calendar.changeTask(userId, made.id, { done: true }).catch(() => null);
    }
    for (const id of w.remove) {
      await o.calendar.removeTask(userId, id).catch((err: unknown) => { req.log.warn({ err: (err as Error)?.name }, "reminders: remove failed"); });
    }
    // An item that is already one of this person's to-dos and only lost its link (the lost-{applied} case): the link alone
    // is written, exactly as the second request would have written it, and nothing is made.
    for (const l of w.link) {
      await calendarRows().tasks.update({ id: l.id, user_id: userId }, { ext_ref: l.ext })
        .catch((err: unknown) => { req.log.warn({ err: (err as Error)?.name }, "reminders: link failed"); });
    }
    if (w.unlink.length) await unlink(userId, w.unlink);
    // The deletion marks that have been acted on: the item has gone from the list, so the memory of its to-do can go too.
    if (w.forget.length) await remindersGone().forget(userId, w.forget).catch(() => 0);
  };

  /** The second request: which item each added to-do became. Written from `/sync` and from `/applied` alike. */
  const link = async (userId: string, applied: Array<{ id: string; ext: string }>, req: FastifyRequest): Promise<number> => {
    const tasks = calendarRows().tasks;
    let linked = 0;
    for (const a of applied) {
      // The to-do must be the person's own, and the link is the only thing written: `ext_src` stays empty, because this to-do
      // was made in X0 and only copied out — which is what decides whether deleting the item deletes the to-do (§3.2).
      const ok = await tasks.update({ id: a.id, user_id: userId }, { ext_ref: a.ext }).then(() => true, () => false);
      if (ok) linked += 1;
    }
    req.log.info({ linked }, "plan: reminders links written");
    return linked;
  };

  /** The link alone goes; the to-do stays exactly as it is. */
  const unlink = async (userId: string, ids: string[]): Promise<void> => {
    const tasks = calendarRows().tasks;
    for (const id of ids) await tasks.update({ id, user_id: userId }, { ext_src: null, ext_ref: null }).catch(() => undefined);
  };

  app.post(`${REMINDERS_PATH}/sync`, tight(30), async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    const b = bodyOf(req.body);
    // THE SECOND REQUEST OF THE SAME SYNC, on the same pinned path: `applied` and no `items`. Without this it answered 400,
    // no link was ever written, and every sync added each open to-do to the list again and copied each item back as a new
    // to-do — both sides growing a copy every fifteen minutes.
    if (Array.isArray(b.applied) && b.items === undefined) {
      let applied;
      try { applied = readApplied(b); } catch (err) { return reply.code(400).send({ code: "bad_request", message: (err as Error).message }); }
      return reply.header("cache-control", "no-store").send({ ok: true, linked: await link(user.id, applied, req) });
    }
    if (b.enable !== undefined && typeof b.enable !== "boolean") return reply.code(400).send({ code: "bad_request", message: "enable is true or false." });
    let read;
    try { read = readRemItems(b); } catch (err) { return reply.code(400).send({ code: "bad_request", message: (err as Error).message }); }
    const enable = b.enable === true;
    const row = await o.prefs.get(user.id).catch(() => null);
    if (!enable && row?.reminders_on !== true) {
      return reply.code(409).send({ code: "reminders_off", message: "Turn this on from the switch in the app." });
    }
    try {
      // The to-dos deleted here whose item is still in the list: without this the item is read as a new to-do and copied
      // straight back in (calendar/remindersGone.ts).
      const gone = await remindersGone().list(user.id).catch(() => [] as string[]);
      const plan = planReminders(read.items, await mine(user.id), now(), gone);
      await apply(user.id, plan.writes, req);
      if (enable && row?.reminders_on !== true) await o.prefs.patch(user.id, { reminders_on: true });
      const ops: SyncOps = plan.ops;
      req.log.info({ items: read.items.length, add: ops.add.length, update: ops.update.length, remove: ops.remove.length }, "plan: reminders synced");
      return reply.header("cache-control", "no-store").send(ops);
    } catch (err) {
      req.log.error({ err: (err as Error)?.name }, "plan: reminders sync failed");
      return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
    }
  });

  app.post(`${REMINDERS_PATH}/applied`, tight(30), async (req, reply) => {
    const user = await who(req, reply);
    if (!user) return reply;
    let applied;
    try { applied = readApplied(req.body); } catch (err) { return reply.code(400).send({ code: "bad_request", message: (err as Error).message }); }
    return reply.header("cache-control", "no-store").send({ ok: true, linked: await link(user.id, applied, req) });
  });

  app.delete(REMINDERS_PATH, tight(30), async (req, reply) => {
    const user = await who(req, reply, { off: true });
    if (!user) return reply;
    try {
      const rows = await calendarRows().tasks.linked(user.id, REMINDERS_LIMITS.items).catch(() => [] as TaskRow[]);
      await unlink(user.id, rows.map((r) => r.id));
      await remindersGone().clear(user.id).catch(() => 0);
      await o.prefs.patch(user.id, { reminders_on: false }).catch(() => undefined);
      req.log.info({ unlinked: rows.length }, "plan: reminders switched off");
      return reply.header("cache-control", "no-store").send({ ok: true, unlinked: rows.length });
    } catch (err) {
      req.log.error({ err: (err as Error)?.name }, "plan: reminders off failed");
      return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
    }
  });
}
