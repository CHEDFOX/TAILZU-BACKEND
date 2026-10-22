/**
 * GOOGLE TASKS, as a native connector: plain fetch to Tasks API v1, with the
 * one `tasks` scope.
 *
 *   list_tasks      read         open tasks, all or due on a day, or overdue
 *   add_task        write        a new task, with a day it is due
 *   complete_task   write        tick one off
 *   delete_task     destructive  remove one
 *
 * Google Tasks keeps the DAY a task is due and never the time ("Only date
 * information is recorded", the API's own words). So "remind me tomorrow at
 * 9" is a task due tomorrow with "At 09:00" in its notes, and the result says
 * so: Tailzu never claims a reminder at 9 it did not set.
 *
 * A task is named by its id (from list_tasks) or by its title. Without a
 * list it is their default list ("@default", My Tasks); a list is named by
 * its title.
 */
import type { CallOutcome } from "../client.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import type { GoogleSession } from "./oauth.js";
import { count, noSuchTool, ok, oneLine, pickByName, reject, str, type Describe } from "./plain.js";
import { atWall, clock, dateOf, dayStart, dayWord, parseWhen } from "./time.js";
import type { ZoneOf } from "./zone.js";

const API = "https://tasks.googleapis.com/tasks/v1";
const ID = "google-tasks";
const APP = "Google Tasks";
const DEFAULT_LIST = "@default";
const LIST_ID = /^(@default|[A-Za-z0-9_-]{1,200})$/;
const TITLE_MAX = 1024;
const NOTES_MAX = 8192;
const SHOW_MAX = 20;

interface GTask { id: string; title?: string; notes?: string; status?: string; due?: string; hidden?: boolean; deleted?: boolean }
interface GList { id: string; title?: string }

const TOOLS: NativeTool[] = [
  {
    name: "list_tasks", risk: "read", verb: "read",
    description: "List the person's open Google Tasks: all of them, or only those due on a day, this week, or overdue. Each comes back with its id.",
    inputSchema: {
      type: "object",
      properties: {
        list: { type: "string", description: "The task list's name. Default: their main list." },
        due: { type: "string", description: "\"today\", \"tomorrow\", a day (\"friday\", \"30 oct\"), \"week\" for the next seven days, or \"overdue\". Default: every open task." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_task", risk: "write", verb: "create",
    description: "Add a task (a to-do or a reminder) to Google Tasks, due on a day if they gave one. Google Tasks keeps the day, not the time; a time they said goes in its notes.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What to do, short (\"Gym\", \"Pay rent\")." },
        due: { type: "string", description: "When, in English words or ISO: \"tomorrow\", \"friday 9am\", \"30 oct\". \"kal 9 baje\" is \"tomorrow 9am\"." },
        notes: { type: "string" },
        list: { type: "string", description: "The task list's name. Default: their main list." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place." },
      },
      required: ["title"],
    },
    annotations: {},
  },
  {
    name: "complete_task", risk: "write", verb: "complete",
    description: "Mark one of the person's Google Tasks as done.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string", description: "Its id from list_tasks, or its title." }, list: { type: "string" } },
      required: ["task"],
    },
    annotations: {},
  },
  {
    name: "delete_task", risk: "destructive", verb: "delete",
    description: "Delete one of the person's Google Tasks.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string", description: "Its id from list_tasks, or its title." }, list: { type: "string" } },
      required: ["task"],
    },
    annotations: { destructiveHint: true },
  },
];

/** A day as Google Tasks stores it: midnight UTC on that date. */
const dueStamp = (date: string) => `${date}T00:00:00.000Z`;
/** The date a stored `due` is for: its UTC date, which is the day itself. */
const dueDate = (due: string | undefined) => (due && /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : null);

export function googleTasks(o: { session: GoogleSession; zone: ZoneOf; now?: () => number }): NativeConnector {
  const now = () => (o.now ?? Date.now)();
  const get = <T>(userId: string, url: string, notFound?: string) => o.session.json<T>(userId, ID, APP, url, { notFound });

  /** "Today", "Tomorrow", "Friday", "Fri 30 Oct", for a stored date. */
  const dayOf = (date: string, tz: string) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return dayWord(atWall(y, m, d, 12, 0, tz), tz, now());
  };

  /** The list they named, as { id, title }; their main list when they named none. */
  async function listFor(userId: string, args: Args): Promise<{ id: string; title: string | null }> {
    const named = str(args.list, 200);
    if (!named) return { id: DEFAULT_LIST, title: null };
    const res = await get<{ items?: GList[] }>(userId, `${API}/users/@me/lists?maxResults=100`);
    const lists = (res.items ?? []).filter((l) => LIST_ID.test(l.id));
    const hit = pickByName(lists, named, (l) => l.id, (l) => l.title ?? "", "list");
    if (!hit) {
      const names = lists.slice(0, 5).map((l) => `"${oneLine(l.title, 40)}"`).join(", ");
      throw reject(`I couldn't find a task list called "${oneLine(named, 40)}".${names ? ` Your lists: ${names}.` : ""}`);
    }
    return { id: hit.id, title: hit.title ?? null };
  }
  /** "your list" for their main one, "Work" by name for any other. */
  const listName = (l: { title: string | null }) => (l.title ? `"${oneLine(l.title, 40)}"` : "your list");
  const inList = (l: { title: string | null }) => `${l.title ? "in" : "on"} ${listName(l)}`;

  async function tasksIn(userId: string, listId: string, withDone: boolean): Promise<GTask[]> {
    const q = new URLSearchParams({ maxResults: "100", showCompleted: String(withDone), showHidden: String(withDone) });
    const res = await get<{ items?: GTask[] }>(userId, `${API}/lists/${listId}/tasks?${q}`, "I couldn't find that task list.");
    return (res.items ?? []).filter((t) => !t.deleted && typeof t.id === "string");
  }

  /** The task they meant, by id or title, open ones first. */
  async function taskFor(userId: string, args: Args): Promise<{ list: { id: string; title: string | null }; task: GTask }> {
    const wanted = str(args.task, 300);
    if (!wanted) throw reject("Which task? Tell me its name.");
    const list = await listFor(userId, args);
    const all = await tasksIn(userId, list.id, true);
    const open = all.filter((t) => t.status !== "completed");
    const task = pickByName(open, wanted, (t) => t.id, (t) => t.title ?? "", "task")
      ?? pickByName(all, wanted, (t) => t.id, (t) => t.title ?? "", "task");
    if (!task) throw reject(`I couldn't find a task called "${oneLine(wanted, 40)}" ${inList(list)}.`);
    return { list, task };
  }

  /** The `due` they said: the date it lands on, and the time of day when they gave one. */
  function dueOf(v: unknown, tz: string): { date: string; time: string | null } | null {
    if (v === undefined || v === null || v === "") return null;
    const w = parseWhen(v, tz, now());
    if (!w) throw reject(`I couldn't read "${String(v).slice(0, 40)}" as a day. Try something like "tomorrow" or "friday".`);
    return { date: dateOf(w.ms, tz), time: w.dateOnly ? null : clock(w.ms, tz) };
  }

  /** Which days `due` asks for, as [first, last] dates; "overdue" is everything before today. */
  function dueRange(v: unknown, tz: string): { from: string | null; to: string; label: string } | null {
    const s = str(v, 60)?.toLowerCase();
    if (!s || s === "all" || s === "any") return null;
    const today = dateOf(now(), tz);
    if (s === "overdue" || s === "late") {
      return { from: null, to: dateOf(dayStart(now(), tz, -1), tz), label: "overdue" };
    }
    if (/^(this )?week$|^next 7 days$/.test(s)) {
      return { from: today, to: dateOf(dayStart(now(), tz, 6), tz), label: "due this week" };
    }
    const d = dueOf(s, tz)!;
    const word = dayOf(d.date, tz);
    return { from: d.date, to: d.date, label: `due ${/^(Today|Tomorrow|Yesterday)$/.test(word) ? word.toLowerCase() : `on ${word}`}` };
  }

  /** "- Gym, due Tomorrow (id: t1)" / "- Pay rent, overdue since Mon 19 Oct". */
  function taskLine(t: GTask, tz: string): string {
    const date = dueDate(t.due);
    const today = dateOf(now(), tz);
    const when = !date ? "" : date < today ? `, overdue since ${dayOf(date, tz)}` : `, due ${dayOf(date, tz)}`;
    const notes = t.notes?.trim() ? ` — ${oneLine(t.notes, 60)}` : "";
    return `- ${oneLine(t.title)}${when}${notes} (id: ${t.id})`;
  }

  async function listTasks(userId: string, args: Args): Promise<CallOutcome> {
    const tz = await o.zone(userId, args);
    const range = dueRange(args.due, tz);
    const list = await listFor(userId, args);
    const open = (await tasksIn(userId, list.id, false)).filter((t) => t.status !== "completed" && t.title?.trim());
    const shown = open.filter((t) => {
      if (!range) return true;
      const d = dueDate(t.due);
      return !!d && (range.from === null || d >= range.from) && d <= range.to;
    });
    // Soonest first; those with no day last, in the list's own order.
    shown.sort((a, b) => (dueDate(a.due) ?? "9999").localeCompare(dueDate(b.due) ?? "9999"));
    const label = range ? ` ${range.label}` : "";
    if (!shown.length) return ok(`Nothing${label || " to do"} ${inList(list)}.`);
    const more = shown.length > SHOW_MAX ? `\n…and ${shown.length - SHOW_MAX} more.` : "";
    return ok(`${count(shown.length, "task")}${label} ${inList(list)}:\n${shown.slice(0, SHOW_MAX).map((t) => taskLine(t, tz)).join("\n")}${more}`);
  }

  /** What add_task will write: the title, the day, and the notes with any time in them. */
  async function draft(userId: string, args: Args) {
    const title = str(args.title, TITLE_MAX);
    if (!title) throw reject("What's the task?");
    const tz = await o.zone(userId, args);
    const due = dueOf(args.due, tz);
    const notes = [due?.time ? `At ${due.time}` : "", str(args.notes, NOTES_MAX) ?? ""].filter(Boolean).join("\n").slice(0, NOTES_MAX);
    return { title, tz, due, notes };
  }
  const dueWords = (d: { date: string; time: string | null } | null, tz: string) =>
    d ? `, for ${dayOf(d.date, tz)}${d.time ? `. Google Tasks keeps only the day, so ${d.time} is in its notes` : ""}` : "";

  async function addTask(userId: string, args: Args): Promise<CallOutcome> {
    const { title, tz, due, notes } = await draft(userId, args);
    const list = await listFor(userId, args);
    const made = await o.session.json<GTask>(userId, ID, APP, `${API}/lists/${list.id}/tasks`, {
      method: "POST", notFound: "I couldn't find that task list.",
      body: { title, ...(notes ? { notes } : {}), ...(due ? { due: dueStamp(due.date) } : {}) },
    });
    return ok(`Added "${oneLine(title)}" to ${listName(list)}${dueWords(due, tz)}. (id: ${made.id})`);
  }

  const taskUrl = (listId: string, taskId: string) => `${API}/lists/${listId}/tasks/${encodeURIComponent(taskId)}`;

  async function completeTask(userId: string, args: Args): Promise<CallOutcome> {
    const { list, task } = await taskFor(userId, args);
    if (task.status === "completed") return ok(`"${oneLine(task.title)}" was already done.`);
    await o.session.json(userId, ID, APP, taskUrl(list.id, task.id), { method: "PATCH", body: { status: "completed" }, notFound: "I couldn't find that task." });
    return ok(`Marked "${oneLine(task.title)}" done.`);
  }

  async function deleteTask(userId: string, args: Args): Promise<CallOutcome> {
    const { list, task } = await taskFor(userId, args);
    await o.session.json(userId, ID, APP, taskUrl(list.id, task.id), { method: "DELETE", notFound: "I couldn't find that task." });
    return ok(`Deleted the task "${oneLine(task.title)}" from ${listName(list)}.`);
  }

  /** The confirm card: the task, the day, the list. */
  const describe: Describe = async (userId, tool, args) => {
    if (tool === "add_task") {
      const { title, tz, due } = await draft(userId, args);
      const list = await listFor(userId, args);
      return `Add the task "${oneLine(title)}" to ${APP}${list.title ? ` (list "${oneLine(list.title, 40)}")` : ""}${due ? `, for ${dayOf(due.date, tz)}${due.time ? ` (${due.time} in its notes)` : ""}` : ""}`;
    }
    if (tool === "complete_task") return `Mark "${oneLine((await taskFor(userId, args)).task.title)}" done in ${APP}`;
    if (tool === "delete_task") return `Delete the task "${oneLine((await taskFor(userId, args)).task.title)}" from ${APP}`;
    return undefined;
  };

  return {
    tools: () => TOOLS,
    preview: describe,

    async call(userId, tool, args): Promise<CallOutcome> {
      switch (tool) {
        case "list_tasks": return listTasks(userId, args);
        case "add_task": return addTask(userId, args);
        case "complete_task": return completeTask(userId, args);
        case "delete_task": return deleteTask(userId, args);
        default: throw noSuchTool(APP, tool);
      }
    },
  };
}
