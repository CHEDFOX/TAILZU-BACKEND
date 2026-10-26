/**
 * WORLD: every change the task asks for is there at the end, as asked.
 *
 * Read from what the run changed (worlds/google.ts records each change with
 * the thing's state after it), never from what the run said. "An event" means
 * one that was not there before: made in this run and still there. Times are
 * compared as instants, so "16:00+05:30" and "10:30Z" are the same time; a
 * duration is end minus start; `count` (default 1) is exact, so a second
 * dentist appointment made by mistake is a failure too. An event check that
 * names no guests means none when the person gave no email address: an
 * invite they never asked for is not the event they asked for.
 */
import { matches, shown } from "../match.js";
import type { GraderResult, Match, Task, Trace, WorldCheck } from "../types.js";
import { result, thingsOf, wordsOf, type Thing } from "./facts.js";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The same moment (or, for two days, the same day). */
export function sameTime(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  if (isDate(a) || isDate(b)) return a.slice(0, 10) === b.slice(0, 10) && isDate(a) === isDate(b);
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}

/** Minutes from start to end; an all-day event's whole days. */
function minutesOf(d: Record<string, unknown>): number | null {
  const s = String(d.start ?? ""), e = String(d.end ?? "");
  const x = Date.parse(isDate(s) ? `${s}T00:00:00Z` : s), y = Date.parse(isDate(e) ? `${e}T00:00:00Z` : e);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 60_000) : null;
}

const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a.map((s) => s.toLowerCase())), y = new Set(b.map((s) => s.toLowerCase()));
  return x.size === y.size && [...x].every((s) => y.has(s));
};
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Each matcher finds a cell after the one before it found, so ["chai", 20]
 * holds for ["26 Oct", "Chai", 20], a row written under a Date column, but
 * not for [20, "Chai"].
 */
function cellsInOrder(want: Match[], cells: string[]): boolean {
  let at = 0;
  for (const m of want) {
    while (at < cells.length && !matches(m, cells[at]!)) at += 1;
    if (at === cells.length) return false;
    at += 1;
  }
  return true;
}
const describeEvent = (d: Record<string, unknown>) => `"${str(d.title)}" ${str(d.start)}–${str(d.end)}${(d.attendees as string[] | undefined)?.length ? ` with ${(d.attendees as string[]).join(", ")}` : ""}`;

function eventFits(c: Extract<WorldCheck, { kind: "event" }>, d: Record<string, unknown>, said: string): boolean {
  if (!matches(c.title, str(d.title))) return false;
  if (c.start !== undefined && !sameTime(d.start, c.start)) return false;
  if (c.end !== undefined && !sameTime(d.end, c.end)) return false;
  if (c.allDay !== undefined && !!d.allDay !== c.allDay) return false;
  if (c.durationMin !== undefined && minutesOf(d) !== c.durationMin) return false;
  const guests = Array.isArray(d.attendees) ? (d.attendees as string[]) : [];
  // No guests named in the check, and no address in their words: none, as if it said so.
  const attendees = c.attendees ?? (EMAIL.test(said) ? undefined : "none");
  if (attendees === "none" && guests.length) return false;
  if (Array.isArray(attendees) && !sameSet(guests, attendees)) return false;
  return true;
}

/** An email address anywhere in what they said. */
const EMAIL = /[^\s@<>()",;]+@[^\s@<>()",;]+\.[A-Za-z]{2,}/;

/** Why one check does not hold, or null when it does. `said`: the person's words in the run, for an event's guests. */
export function checkWorld(c: WorldCheck, things: Thing[], said = ""): string | null {
  const live = (what: string) => things.filter((t) => t.what === what && t.created && !t.deleted);
  const byId = (what: string, id: string) => things.find((t) => t.what === what && t.id === id);
  switch (c.kind) {
    case "event": {
      const made = live("event");
      const fit = made.filter((t) => eventFits(c, t.detail, said));
      const want = c.count ?? 1;
      if (fit.length === want) return null;
      const seen = made.length ? `; made: ${made.map((t) => describeEvent(t.detail)).join("; ")}` : "; no event was made";
      return `${fit.length} new event(s) like ${shown(c.title)}${c.start ? ` at ${c.start}` : ""}, not ${want}${seen}`;
    }
    case "event.moved": {
      const t = byId("event", c.id);
      if (!t?.updated || t.deleted) return `event ${c.id} was not moved`;
      if (!sameTime(t.detail.start, c.start)) return `event ${c.id} starts ${str(t.detail.start)}, not ${c.start}`;
      if (c.end !== undefined && !sameTime(t.detail.end, c.end)) return `event ${c.id} ends ${str(t.detail.end)}, not ${c.end}`;
      return null;
    }
    case "event.deleted":
      return byId("event", c.id)?.deleted ? null : `event ${c.id} was not deleted`;
    case "task": {
      const made = live("task");
      const fit = made.filter((t) => {
        const d = t.detail;
        if (!matches(c.title, str(d.title))) return false;
        if (c.due !== undefined && (d.due ?? null) !== c.due) return false;
        if (c.notes !== undefined && !matches(c.notes, str(d.notes))) return false;
        if (c.list !== undefined && str(d.list).toLowerCase() !== c.list.toLowerCase() && d.listId !== c.list) return false;
        return true;
      });
      if (fit.length === 1) return null;
      const seen = made.map((t) => `"${str(t.detail.title)}" due ${String(t.detail.due ?? "none")}${t.detail.notes ? ` (${str(t.detail.notes)})` : ""}`);
      return `${fit.length} new task(s) like ${shown(c.title)}${c.due !== undefined ? ` due ${String(c.due)}` : ""}, not 1${seen.length ? `; made: ${seen.join("; ")}` : "; no task was made"}`;
    }
    case "task.done": {
      const t = byId("task", c.id);
      return t && !t.deleted && t.detail.done === true ? null : `task ${c.id} was not marked done`;
    }
    case "task.deleted":
      return byId("task", c.id)?.deleted ? null : `task ${c.id} was not deleted`;
    case "doc": {
      const made = live("doc");
      const fit = made.filter((t) => (c.title === undefined || matches(c.title, str(t.detail.title))) && (c.text === undefined || matches(c.text, str(t.detail.text))));
      return fit.length ? null : `no new Doc like ${c.title ? shown(c.title) : "that"}${c.text ? ` saying ${shown(c.text)}` : ""}${made.length ? `; made: ${made.map((t) => `"${str(t.detail.title)}"`).join(", ")}` : ""}`;
    }
    case "sheet": {
      if (!c.row.length) {
        const fit = live("sheet").filter((t) => c.title === undefined || matches(c.title, str(t.detail.title)));
        return fit.length ? null : `no new sheet like ${c.title ? shown(c.title) : "that"}`;
      }
      const rows = live("row");
      const fit = rows.filter((t) => {
        const cells = Array.isArray(t.detail.row) ? (t.detail.row as unknown[]).map(String) : [];
        return (c.title === undefined || matches(c.title, str(t.detail.sheet))) && cellsInOrder(c.row, cells);
      });
      return fit.length ? null : `no row like [${c.row.map(shown).join(", ")}]${rows.length ? `; added: ${rows.map((t) => `[${(t.detail.row as unknown[]).join(", ")}] to "${str(t.detail.sheet)}"`).join("; ")}` : "; no row was added"}`;
    }
    case "form": {
      const fit = live("form").filter((t) => {
        const qs = Array.isArray(t.detail.questions) ? (t.detail.questions as string[]) : [];
        return (c.title === undefined || matches(c.title, str(t.detail.title))) && (c.questions ?? []).every((m) => qs.some((q) => matches(m, q)));
      });
      return fit.length ? null : `no new form like ${c.title ? shown(c.title) : "that"}`;
    }
  }
}

export function gradeWorld(task: Task, trace: Trace): GraderResult {
  const checks = task.expect.world ?? [];
  if (!checks.length) return result("world", true, "no world checks");
  const things = thingsOf(trace.world.mutations);
  const said = wordsOf(task, trace);
  const problems = checks.map((c) => checkWorld(c, things, said)).filter((p): p is string => p !== null);
  return problems.length
    ? result("world", false, problems.join(" | "))
    : result("world", true, checks.length === 1 ? "the world check holds" : `all ${checks.length} world checks hold`);
}
