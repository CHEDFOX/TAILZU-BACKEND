/**
 * TAILZU'S OWN CALENDAR AND TO-DOS, AS TWO APPS EVERY BOT CAN BE GIVEN: "calendar" and "tasks", always on, nothing to connect.
 *
 *   withOwnDays(base, calendar) -> BotConnectors   the connected apps a bot sees (bots/ports.ts), with these two in front
 *
 * A bot given "calendar" or "tasks" (the Plan bot is; a person's own bot can be) gets tools that read and write the person's own days
 * (service.ts): list, add, change, remove, tick. What it adds says it came from that bot ("Plan bot"). The old Google ids a bot may
 * still name ("google-calendar", "google-tasks") mean these now: the Bots app no longer offers Google Calendar or Google Tasks.
 *
 * The person's words are their yes: "add dentist Friday 5 pm" adds it, and the answer says so. Nothing here leaves Tailzu, and
 * someone else's plan or task (a space's) can't be changed or taken out by a bot.
 */
import type { BotConnectors, ConnectorStatus, ConnectorToolInfo } from "../bots/ports.js";
import type { UseOutcome } from "../connectors/tasks.js";
import type { Calendar, CalEvent, CalTask } from "./service.js";
import { clockAt, dayName, dayOf, dayWords, isDayKey, shiftDay } from "./words.js";

export const OWN_APPS = ["calendar", "tasks"] as const;
type OwnApp = (typeof OWN_APPS)[number];
/** Ids that mean one of Tailzu's own two (the old Google ones). */
const ALIAS: Record<string, OwnApp> = { calendar: "calendar", tasks: "tasks", "google-calendar": "calendar", "google-tasks": "tasks" };
export const ownAppOf = (id: string): OwnApp | null => ALIAS[id] ?? null;
const NAME: Record<OwnApp, string> = { calendar: "Calendar", tasks: "Tasks" };
const LINE: Record<OwnApp, string> = { calendar: "Your days in Tailzu: events, with reminders.", tasks: "Your to-do list in Tailzu." };

const s = (description: string) => ({ type: "string", description });
const DAY = s("A day: YYYY-MM-DD (preferred), or words like friday, tomorrow, 30 Oct.");
const TIME = s("A time, like 17:30 or 5 pm. Leave it out for all day.");
const REMIND = { type: "integer", minimum: 0, maximum: 10080, description: "Minutes before to remind them (0 = at the time). Leave out for the usual." };
const REPEAT = { type: "string", enum: ["", "daily", "weekdays", "weekly", "monthly", "yearly"], description: "How it repeats; empty for once." };

function calendarTools(today: string): ConnectorToolInfo[] {
  const now = `Today is ${dayWords(today)} ${today.slice(0, 4)} (${today}) in the person's time.`;
  return [
    { name: "list_events", description: `List what is on the person's calendar in Tailzu between two days. ${now}`, inputSchema: { type: "object", additionalProperties: false, required: ["from"], properties: { from: DAY, to: DAY } } },
    {
      name: "add_event", description: `Add an event to the person's calendar in Tailzu, when they ask for it. ${now} Give a time, or all_day.`,
      inputSchema: {
        type: "object", additionalProperties: false, required: ["title", "date"], properties: {
          title: s("What it is, short: Dentist, Dinner with Mom."), date: DAY, time: TIME, end_time: s("When it ends, like 18:30."),
          minutes: { type: "integer", minimum: 5, maximum: 1440, description: "How long, when no end time." }, all_day: { type: "boolean" },
          place: s("Where, as they said it."), notes: s("Anything else to keep with it."), repeat: REPEAT, remind_minutes: REMIND,
        },
      },
    },
    {
      name: "change_event", description: `Change an event on the person's calendar (its id from list_events): move it, rename it, change the place or the reminder. ${now}`,
      inputSchema: {
        type: "object", additionalProperties: false, required: ["id"], properties: {
          id: s("The event's id from list_events."), title: s("A new title."), date: DAY, time: TIME, end_time: s("When it ends."), minutes: { type: "integer", minimum: 5, maximum: 1440 },
          place: s("Where."), notes: s("Notes."), repeat: REPEAT, remind_minutes: REMIND,
        },
      },
    },
    {
      name: "remove_event", description: "Take an event off the person's calendar (its id from list_events), when they ask. For one day of a repeating event, only_this_day.",
      inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: s("The event's id from list_events."), only_this_day: { type: "boolean" } } },
    },
  ];
}

function taskTools(today: string): ConnectorToolInfo[] {
  const now = `Today is ${dayWords(today)} ${today.slice(0, 4)} (${today}) in the person's time.`;
  return [
    { name: "list_tasks", description: `List the person's to-dos in Tailzu: the open ones, and those due between two days. ${now}`, inputSchema: { type: "object", additionalProperties: false, properties: { from: DAY, to: DAY, include_done: { type: "boolean" } } } },
    {
      name: "add_task", description: `Add a to-do to the person's list in Tailzu, when they ask for it. ${now}`,
      inputSchema: {
        type: "object", additionalProperties: false, required: ["title"], properties: {
          title: s("The to-do, short: Pay the electricity bill."), notes: s("Anything else to keep with it."), date: DAY, time: s("A time it's due, like 18:00."),
          list: s("Which list, if they have one in mind: Home, Work."), remind_minutes: REMIND,
        },
      },
    },
    {
      name: "change_task", description: `Change one of the person's to-dos (its id from list_tasks). ${now}`,
      inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: s("The to-do's id from list_tasks."), title: s("New words."), notes: s("Notes."), date: DAY, time: s("Due time."), list: s("List."), remind_minutes: REMIND } },
    },
    { name: "tick_task", description: "Tick a to-do done (or back to do), when the person says so.", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: s("The to-do's id from list_tasks."), done: { type: "boolean" } } } },
    { name: "remove_task", description: "Take a to-do off the person's list, when they ask.", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: s("The to-do's id from list_tasks.") } } },
  ];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function eventLine(e: CalEvent, tz: number, today: string): string {
  const when = e.allDay ? `${dayName(e.day, today)}, all day` : `${dayName(e.day, today)}, ${clockAt(e.start, tz)}–${clockAt(e.end, tz)}`;
  const bits = [e.place, e.repeat ? `repeats ${e.repeat}` : "", e.from ? `from ${e.from}` : "", e.fixed ? "theirs to change" : ""].filter(Boolean);
  return `- ${when}: ${e.title}${bits.length ? ` (${bits.join("; ")})` : ""} (id: ${e.id})`;
}
function taskLine(t: CalTask, tz: number, today: string): string {
  const due = t.due ? `due ${dayName(t.due, today)}${t.at !== null ? ` ${clockAt(t.at, tz)}` : ""}` : "no day";
  const bits = [due, t.list ? `list ${t.list}` : "", t.from ? `from ${t.from}` : "", t.done ? "done" : ""].filter(Boolean);
  return `- ${t.title} (${bits.join("; ")}) (id: ${t.id})`;
}

/** A bot's arguments as the calendar's body. */
function eventBody(a: Record<string, unknown>, tz: number): Record<string, unknown> {
  return {
    tz, ...(a.title !== undefined ? { title: a.title } : {}), ...(a.date !== undefined ? { day: a.date } : {}),
    ...(a.all_day === true ? { time: "" } : a.time !== undefined ? { time: a.time } : {}), ...(a.all_day === false ? { allDay: false } : {}),
    ...(a.end_time !== undefined ? { endTime: a.end_time } : {}), ...(a.minutes !== undefined ? { minutes: a.minutes } : {}),
    ...(a.place !== undefined ? { place: a.place } : {}), ...(a.notes !== undefined ? { notes: a.notes } : {}), ...(a.repeat !== undefined ? { repeat: a.repeat } : {}),
    ...(a.remind_minutes !== undefined ? { remind: a.remind_minutes } : {}),
  };
}
function taskBody(a: Record<string, unknown>, tz: number): Record<string, unknown> {
  return {
    tz, ...(a.title !== undefined ? { title: a.title } : {}), ...(a.notes !== undefined ? { notes: a.notes } : {}), ...(a.date !== undefined ? { day: a.date } : {}),
    ...(a.time !== undefined ? { time: a.time } : a.date !== undefined ? { time: "" } : {}), ...(a.list !== undefined ? { list: a.list } : {}),
    ...(a.remind_minutes !== undefined ? { remind: a.remind_minutes } : {}),
  };
}

/** One tool call on the person's own days: the words the bot reads back. */
export async function runOwnTool(cal: Calendar, userId: string, app: OwnApp, tool: string, args: Record<string, unknown>, botName: string): Promise<UseOutcome> {
  const tz = cal.tzFor(userId);
  const today = dayOf(Date.now(), tz);
  const by = { kind: "bot" as const, name: botName.replace(/\s+bot\s+bot$/i, " bot").replace(/\s+/g, " ").trim().slice(0, 40) || "A bot" };
  const day = (v: unknown, fallback: string): string => { const t = str(v); return t && isDayKey(t) ? t : fallback; };
  try {
    if (app === "calendar") {
      switch (tool) {
        case "list_events": {
          const from = day(args.from, today);
          const to = day(args.to, shiftDay(from, 6));
          const r = await cal.list(userId, { from, to: to < from ? from : to, tz });
          return { kind: "result", text: r.events.length ? r.events.map((e) => eventLine(e, tz, today)).join("\n") : `Nothing on the calendar from ${dayWords(from)} to ${dayWords(to)}.` };
        }
        case "add_event": {
          const e = await cal.addEvent(userId, eventBody(args, tz), by);
          return { kind: "result", text: `Added to their calendar: ${eventLine(e, tz, today).slice(2)}. Tell them it's on their Plan.` };
        }
        case "change_event": {
          const e = await cal.changeEvent(userId, args.id, eventBody(args, tz));
          return { kind: "result", text: `Changed: ${eventLine(e, tz, today).slice(2)}.` };
        }
        case "remove_event": {
          await cal.removeEvent(userId, args.id, { one: args.only_this_day === true });
          return { kind: "result", text: args.only_this_day === true ? "Taken off that day." : "Taken off their calendar." };
        }
        default: return { kind: "stopped", message: `There is no ${tool} in Calendar.` };
      }
    }
    switch (tool) {
      case "list_tasks": {
        const from = day(args.from, today), to = day(args.to, shiftDay(from, 13));
        const r = await cal.list(userId, { from, to: to < from ? from : to, tz });
        const open = await cal.openTasks(userId);
        const seen = new Set<string>();
        const all = [...open, ...r.tasks.filter((t) => args.include_done === true || !t.done)].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
        return { kind: "result", text: all.length ? all.slice(0, 60).map((t) => taskLine(t, tz, today)).join("\n") : "No to-dos." };
      }
      case "add_task": {
        const t = await cal.addTask(userId, taskBody(args, tz), by);
        return { kind: "result", text: `Added to their to-dos: ${taskLine(t, tz, today).slice(2)}.` };
      }
      case "change_task": {
        const t = await cal.changeTask(userId, args.id, taskBody(args, tz));
        return { kind: "result", text: `Changed: ${taskLine(t, tz, today).slice(2)}.` };
      }
      case "tick_task": {
        const t = await cal.tickTask(userId, args.id, args.done !== false);
        return { kind: "result", text: t.done ? `Ticked off: ${t.title}.` : `Back on the list: ${t.title}.` };
      }
      case "remove_task": {
        await cal.removeTask(userId, args.id);
        return { kind: "result", text: "Taken off their list." };
      }
      default: return { kind: "stopped", message: `There is no ${tool} in Tasks.` };
    }
  } catch (err) {
    const message = (err as Error)?.message || "That didn't work.";
    return { kind: "invalid", problems: message, message };
  }
}

/** The connected apps a bot sees, with Tailzu's own calendar and to-dos in front (and the Google ones they replace left out). */
export function withOwnDays(base: BotConnectors | null, cal: Calendar): BotConnectors {
  return {
    async catalog(userId) {
      const rest = base ? await base.catalog(userId).catch(() => []) : [];
      return [...OWN_APPS.map((id) => ({ id, name: NAME[id], oneLine: LINE[id], connected: true })), ...rest.filter((a) => !ownAppOf(a.id))];
    },
    async status(userId, ids) {
      const rest = ids.filter((id) => !ownAppOf(id));
      const theirs = rest.length ? (base ? await base.status(userId, rest) : rest.map((id) => ({ id, name: id, status: "unavailable" as ConnectorStatus }))) : [];
      // "calendar" and an old "google-calendar" are one app: it is offered once.
      const seen = new Set<string>();
      return ids.flatMap((id) => {
        const o = ownAppOf(id);
        const key = o ?? id;
        if (seen.has(key)) return [];
        seen.add(key);
        return [o ? { id, name: NAME[o], status: "connected" as ConnectorStatus } : theirs.find((t) => t.id === id) ?? { id, name: id, status: "unavailable" as ConnectorStatus }];
      });
    },
    async tools(userId, id) {
      const o = ownAppOf(id);
      if (!o) return base ? base.tools(userId, id) : [];
      const today = dayOf(Date.now(), cal.tzFor(userId));
      return o === "calendar" ? calendarTools(today) : taskTools(today);
    },
    async use(userId, runId, said, line, opts) {
      const o = ownAppOf(line.connector);
      if (o) return runOwnTool(cal, userId, o, line.tool, line.args, said);
      if (!base) return { kind: "stopped", message: "Connected apps aren't on here." };
      return base.use(userId, runId, said, line, opts);
    },
    settle: (userId, runId, ending) => (base ? base.settle(userId, runId, ending) : Promise.resolve()),
  };
}

