/**
 * TASKS AND PLANS FOR OTHERS IN A SPACE: someone who may ("Give tasks to others") gives one or more people a task (title, notes, a due
 * day and time, a place); someone who may ("Plan for others") puts something on their day (a time, a place). Each person it's for says
 * Done, or "Can't do it" with a note. Both land on that person's own calendar and to-dos as "From <name>" (below).
 *
 *   list(user, space)                       the space's tasks and plans (open first), each with what each person said
 *   givenTo(user)                           what's waiting for this person across their spaces ("Given to you")
 *   create(user, space, { kind, title, notes, people, day, time, endTime, place, tz })
 *   answer(user, space, id, { status: "done" | "todo" | "cant", note })   by one of the people it's for, for themselves
 *   remove(user, space, id)                 who set it, or the admin
 *
 * Each change tells the space (live "space:<id>") and the people it's for get a push ("Aanya gave you a task"), and the space's
 * activity says so.
 *
 * ON THEIR OWN DAYS. A task or a plan lands on each person's own calendar and to-dos (src/calendar landSpace), "From <name>", for
 * everyone: their Plan, Today, reminders and bots see it like the rest of their day. Their tick there is their Done here (the calendar
 * answers through answer()); "Can't do it" (here or there) takes it off their days; taken out, or the person gone, it goes too.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { live } from "../live/bus.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import { pickedIds } from "./spacePerms.js";
import type { Spaces } from "./spaces.js";
import { calendar, type Calendar } from "../calendar/index.js";

/** Where a space's task lands for each person it's for (the calendar; tests hand in their own). */
export type SpaceDays = Pick<Calendar, "landSpace" | "unlandSpace">;

export type TaskKind = "task" | "plan";
export type TaskState = "todo" | "done" | "cant";
export interface TaskRow {
  [k: string]: unknown; id: string; space_id: string; kind: TaskKind; title: string; notes: string; assignees: string[];
  states: Record<string, { status: TaskState; note: string; at: number }>;
  set_by: string; set_name: string;
  /** When it's due (a task) or starts (a plan); null: no time. */
  at_ms: number | null;
  end_ms: number | null;
  /** Due that day, at no particular time. */
  all_day: boolean;
  place: string; created_ms: number; updated_ms: number;
}
export interface TaskView {
  id: string; spaceId: string; spaceName: string; kind: TaskKind; title: string; notes: string; place: string;
  at: number | null; end: number | null; allDay: boolean;
  setBy: string; byYou: boolean;
  people: Array<{ userId: string; name: string; you: boolean; status: TaskState; note: string }>;
  /** Your own part, when it's for you. */
  mine: { status: TaskState; note: string } | null;
  /** Everyone it's for said done. */
  done: boolean;
  canRemove: boolean;
}
export type TaskNotify = (userId: string, msg: { kind: "space_task" | "space_plan"; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<void>;

export const TASKS_OPEN_MAX = 100;
const MIN = 60_000, DAY = 86_400_000;
const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC ms for a day ("2026-10-29") and a time ("18:30") in the person's offset; null when they don't read. */
export function whenOf(day: unknown, time: unknown, tz: number): { at: number; allDay: boolean } | null {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const base = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  const t = typeof time === "string" ? time.trim() : "";
  if (!t) return { at: base - tz * MIN, allDay: true };
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return { at: base + (Number(m[1]) * 60 + Number(m[2])) * MIN - tz * MIN, allDay: false };
}

/** " · due Thu 29 Oct, 6:30 pm": a push's words for when. */
function dueWords(at: number | null, allDay: boolean, tz: number): string {
  if (at === null) return "";
  const d = new Date(at + tz * MIN);
  const day = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (allDay) return ` · ${day}`;
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return ` · ${day}, ${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

export class SpaceTasks {
  private readonly rows: PagedTable<TaskRow>;
  private readonly publish: (ids: Iterable<string>, topic: string) => void;
  private readonly notify: TaskNotify;
  private readonly days: SpaceDays | null;

  constructor(private readonly spaces: Spaces, private readonly now: () => number = Date.now, o: { rows?: PagedTable<TaskRow>; publish?: (ids: Iterable<string>, topic: string) => void; notify?: TaskNotify; days?: SpaceDays | null } = {}) {
    this.rows = o.rows ?? spaceTable<TaskRow>("space_tasks");
    this.publish = o.publish ?? ((ids, topic) => live.publish(ids, topic));
    this.notify = o.notify ?? (async () => undefined);
    this.days = o.days !== undefined ? o.days : calendar();
    spaces.onMembers(async (e) => {
      if (e.deleted) {
        for (const r of await this.rows.select({ space_id: e.spaceId }, { limit: 500 })) await this.days?.unlandSpace(r.id);
        await this.rows.remove({ space_id: e.spaceId });
      } else if (e.left) {
        // Someone who left has nothing more to do here.
        for (const r of await this.rows.select({ space_id: e.spaceId }, { limit: 500 })) {
          if (!r.assignees.includes(e.left)) continue;
          await this.days?.unlandSpace(r.id, e.left);
          const assignees = r.assignees.filter((x) => x !== e.left);
          if (!assignees.length) await this.rows.remove({ id: r.id });
          else await this.rows.update({ id: r.id }, { assignees, updated_ms: this.now() });
        }
      }
    });
  }

  private view(userId: string, r: TaskRow, names: Map<string, string>, spaceName: string, admin: boolean): TaskView {
    const people = r.assignees.map((id) => ({ userId: id, name: names.get(id) ?? "Someone", you: id === userId, status: r.states?.[id]?.status ?? "todo" as TaskState, note: r.states?.[id]?.note ?? "" }));
    const mine = people.find((p) => p.you);
    return {
      id: r.id, spaceId: r.space_id, spaceName, kind: r.kind, title: r.title, notes: r.notes, place: r.place,
      at: r.at_ms === null || r.at_ms === undefined ? null : Number(r.at_ms), end: r.end_ms === null || r.end_ms === undefined ? null : Number(r.end_ms), allDay: r.all_day === true,
      setBy: r.set_by === userId ? "You" : r.set_name, byYou: r.set_by === userId, people,
      mine: mine ? { status: mine.status, note: mine.note } : null,
      done: people.length > 0 && people.every((p) => p.status === "done"),
      canRemove: r.set_by === userId || admin,
    };
  }

  private async names(spaceId: string): Promise<Map<string, string>> {
    return new Map((await this.spaces.membersOf(spaceId)).map((m) => [m.userId, m.name]));
  }

  /** On (or off) the days of the people it's for, as each of them said: off for "can't do it", ticked for done. */
  private async land(r: TaskRow, spaceName: string, only?: string): Promise<void> {
    if (!this.days) return;
    for (const p of r.assignees) {
      if (only && p !== only) continue;
      const st = r.states?.[p]?.status ?? "todo";
      if (st === "cant") { await this.days.unlandSpace(r.id, p); continue; }
      await this.days.landSpace(p, {
        taskId: r.id, spaceId: r.space_id, spaceName, kind: r.kind, title: r.title, notes: r.notes, place: r.place,
        at: r.at_ms === null || r.at_ms === undefined ? null : Number(r.at_ms), end: r.end_ms === null || r.end_ms === undefined ? null : Number(r.end_ms),
        allDay: r.all_day === true, by: r.set_by, name: r.set_by === p ? "You" : r.set_name, done: st === "done",
      });
    }
  }

  /** The space's tasks and plans: open ones first (soonest first), then the done ones. */
  async list(userId: string, spaceId: string): Promise<TaskView[]> {
    const a = await this.spaces.access(userId, spaceId);
    const names = await this.names(spaceId);
    const rows = await this.rows.before({ space_id: spaceId }, "created_ms", null, TASKS_OPEN_MAX * 2);
    const out = rows.map((r) => this.view(userId, r, names, a.s.name, a.admin));
    const key = (t: TaskView) => (t.at ?? Number.MAX_SAFE_INTEGER);
    return [...out.filter((t) => !t.done).sort((x, y) => key(x) - key(y)), ...out.filter((t) => t.done)];
  }

  /** What's waiting for this person, across their spaces: theirs, not done. */
  async givenTo(userId: string): Promise<TaskView[]> {
    const out: TaskView[] = [];
    for (const s of await this.spaces.mine(userId)) {
      const list = await this.list(userId, s.id).catch(() => []);
      out.push(...list.filter((t) => t.mine && t.mine.status !== "done"));
    }
    return out.sort((x, y) => (x.at ?? Number.MAX_SAFE_INTEGER) - (y.at ?? Number.MAX_SAFE_INTEGER));
  }

  async create(userId: string, spaceId: string, b: Record<string, unknown>): Promise<TaskView> {
    const kind: TaskKind = b.kind === "plan" ? "plan" : "task";
    const a = await this.spaces.need(userId, spaceId, kind === "plan" ? "plan" : "tasks");
    const title = clean(b.title, 120);
    if (!title) throw new BotError("bad_request", kind === "plan" ? "Say what it is, like Pick up Rohan." : "Say what the task is.");
    const names = await this.names(spaceId);
    const picked = pickedIds(b.people);
    if (!picked.length) throw new BotError("bad_request", "Pick who it's for.");
    if (picked.some((p) => !names.has(p))) throw new BotError("not_found", `Everyone it's for has to be in ${a.s.name}.`, 404);
    const tz = Math.max(-720, Math.min(840, Math.round(Number(b.tz)) || 0));
    const when = b.day ? whenOf(b.day, b.time, tz) : null;
    if (b.day && !when) throw new BotError("bad_request", "That day or time doesn't look right.");
    if (kind === "plan" && (!when || when.allDay)) throw new BotError("bad_request", "Give it a day and a time.");
    let end: number | null = null;
    if (kind === "plan" && when) {
      const e = b.endTime ? whenOf(b.day, b.endTime, tz) : null;
      const mins = Math.round(Number(b.minutes));
      end = e && !e.allDay && e.at > when.at ? e.at : when.at + (mins >= 5 && mins <= 24 * 60 ? mins : 60) * MIN;
    }
    if (when && when.at < this.now() - DAY) throw new BotError("bad_request", "That's in the past.");
    const open = (await this.rows.select({ space_id: spaceId }, { limit: TASKS_OPEN_MAX * 3 })).length;
    if (open >= TASKS_OPEN_MAX * 3) throw new BotError("task_limit", `${a.s.name} has a lot of tasks. Take some out first.`, 409);
    const at = this.now();
    const r: TaskRow = {
      id: randomUUID(), space_id: spaceId, kind, title, notes: typeof b.notes === "string" ? b.notes.replace(/\r/g, "").trim().slice(0, 1000) : "",
      assignees: picked, states: Object.fromEntries(picked.map((p) => [p, { status: "todo" as TaskState, note: "", at }])),
      set_by: userId, set_name: a.me.name, at_ms: when?.at ?? null, end_ms: end, all_day: when?.allDay ?? false, place: clean(b.place, 80),
      created_ms: at, updated_ms: at,
    };
    await this.rows.insert(r);
    await this.land(r, a.s.name);
    const forWhom = picked.map((p) => (p === userId ? "themselves" : names.get(p) ?? "someone"));
    await this.spaces.note(spaceId, userId, kind, `${a.me.name} ${kind === "plan" ? "planned" : "gave"} ${title} ${kind === "plan" ? "for" : "to"} ${forWhom.join(", ")}`);
    for (const p of picked) {
      if (p === userId) continue;
      await this.notify(p, {
        kind: kind === "plan" ? "space_plan" : "space_task", key: `${r.id}:${p}`,
        vars: { name: a.me.name, title, due: dueWords(r.at_ms, r.all_day, tz) }, data: { spaceId, taskId: r.id },
      }).catch(() => undefined);
    }
    await this.spaces.changed(spaceId);
    this.publish(picked, "plan");
    return this.view(userId, r, names, a.s.name, a.admin);
  }

  private async one(spaceId: string, id: string): Promise<TaskRow> {
    const [r] = UUID.test(id) ? await this.rows.select({ id, space_id: spaceId }, { limit: 1 }) : [];
    if (!r) throw new BotError("not_found", "That task isn't there any more.", 404);
    return r;
  }

  /** Done, back to do, or "Can't do it" (with a note): by one of the people it's for, for their own part. */
  async answer(userId: string, spaceId: string, id: string, b: Record<string, unknown>): Promise<TaskView> {
    const a = await this.spaces.access(userId, spaceId);
    const r = await this.one(spaceId, id);
    if (!r.assignees.includes(userId)) throw new BotError("not_allowed", "Only who it's for can say how it went.", 403);
    const status: TaskState | null = b.status === "done" || b.status === "cant" || b.status === "todo" ? b.status : null;
    if (!status) throw new BotError("bad_request", "done, todo or cant.");
    const note = status === "cant" ? clean(b.note, 200) : "";
    const states: TaskRow["states"] = { ...(r.states ?? {}), [userId]: { status, note, at: this.now() } };
    await this.rows.update({ id: r.id, space_id: spaceId }, { states, updated_ms: this.now() });
    await this.land({ ...r, states }, a.s.name, userId);
    if (status !== "todo") {
      await this.spaces.note(spaceId, userId, r.kind, status === "done" ? `${a.me.name} did ${r.title}` : `${a.me.name} can't do ${r.title}${note ? `: ${note}` : ""}`);
    }
    await this.spaces.changed(spaceId);
    this.publish([userId], "plan");
    return this.view(userId, { ...r, states }, await this.names(spaceId), a.s.name, a.admin);
  }

  async remove(userId: string, spaceId: string, id: string): Promise<void> {
    const a = await this.spaces.access(userId, spaceId);
    const r = await this.one(spaceId, id);
    if (r.set_by !== userId && !a.admin) throw new BotError("not_allowed", "Only who set it, or the admin, can take it out.", 403);
    await this.rows.remove({ id: r.id, space_id: spaceId });
    await this.days?.unlandSpace(r.id);
    await this.spaces.note(spaceId, userId, r.kind, `${a.me.name} took out ${r.title}`);
    await this.spaces.changed(spaceId);
    this.publish(r.assignees, "plan");
  }
}
