/**
 * GOOGLE CLASSROOM, as a native connector, read-only.
 *
 *   my_classes      read   the person's active classes
 *   whats_due       read   work due in the next days, and what is still not
 *                          turned in, with their own state on each
 *   announcements   read   the latest posts in one class or all of them
 *
 * Three read-only scopes, each the smallest for its call:
 * classroom.courses.readonly (courses.list), classroom.coursework.me.readonly
 * (courseWork.list and their own studentSubmissions.list) and
 * classroom.announcements.readonly (announcements.list). Nothing here can
 * turn work in, post or change a grade.
 *
 * Work due is read only in classes they are a student in (studentId=me): a
 * teacher has no submission of their own to report. Classroom gives due
 * dates and times in UTC; they are said in the person's zone (zone.ts).
 */
import type { CallOutcome } from "../client.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import type { GoogleSession } from "./oauth.js";
import { clampInt, count, noSuchTool, ok, oneLine, pickByName, reject, str } from "./plain.js";
import { DAY, clock, dayWord } from "./time.js";
import type { ZoneOf } from "./zone.js";

const API = "https://classroom.googleapis.com/v1/courses";
const ID = "google-classroom";
const APP = "Google Classroom";
const COURSE_ID = /^[A-Za-z0-9_:-]{1,100}$/;
/** At most this many classes are looked through for work and posts: each is a call or two. */
const CLASSES_MAX = 10;
/** Work still not turned in is reported this far back. */
const MISSING_DAYS = 14;
const POSTS_MAX = 6;

interface Course { id: string; name?: string; section?: string; room?: string }
interface Work { id: string; title?: string; dueDate?: { year?: number; month?: number; day?: number }; dueTime?: { hours?: number; minutes?: number }; maxPoints?: number }
interface Submission { courseWorkId?: string; state?: string; late?: boolean; assignedGrade?: number }
interface Post { text?: string; updateTime?: string; creationTime?: string }

const TOOLS: NativeTool[] = [
  {
    name: "my_classes", risk: "read", verb: "read",
    description: "List the person's active Google Classroom classes.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "whats_due", risk: "read", verb: "read",
    description: "What classwork (assignments, homework, questions) is due in the person's Google Classroom classes in the next days, and anything still not turned in, with whether they turned each in.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days ahead (default 7, at most 30)." },
        class: { type: "string", description: "Only this class, by its name." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "announcements", risk: "read", verb: "read",
    description: "The latest announcements (posts) in the person's Google Classroom classes, or in one class.",
    inputSchema: {
      type: "object",
      properties: {
        class: { type: "string", description: "The class's name. Default: all their classes." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place." },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

/** When work is due, as epoch ms; Classroom gives the date and time in UTC. Null when it has no due date. */
function dueAt(w: Work): number | null {
  const d = w.dueDate;
  if (!d?.year || !d.month || !d.day) return null;
  return Date.UTC(d.year, d.month - 1, d.day, w.dueTime?.hours ?? 0, w.dueTime?.minutes ?? 0);
}

/** Their own state on a piece of work, in plain words. */
function stateWords(s: Submission | undefined, overdue: boolean, maxPoints?: number): string {
  if (s?.state === "TURNED_IN") return s.late ? "turned in late" : "turned in";
  if (s?.state === "RETURNED") {
    return typeof s.assignedGrade === "number" ? `returned, ${s.assignedGrade}${maxPoints ? `/${maxPoints}` : ""}` : "returned";
  }
  return overdue || s?.late ? "missing" : "not turned in";
}

const className = (c: Course) => oneLine([c.name, c.section].filter(Boolean).join(", "), 60, "(a class)");

export function googleClassroom(o: { session: GoogleSession; zone: ZoneOf; now?: () => number }): NativeConnector {
  const now = () => (o.now ?? Date.now)();
  const get = <T>(userId: string, url: string) => o.session.json<T>(userId, ID, APP, url, { notFound: "I couldn't find that class." });
  const at = (ms: number, tz: string) => `${dayWord(ms, tz, now())} ${clock(ms, tz)}`;

  async function courses(userId: string, asStudent: boolean): Promise<Course[]> {
    const q = new URLSearchParams({ courseStates: "ACTIVE", pageSize: "30", ...(asStudent ? { studentId: "me" } : {}) });
    const res = await get<{ courses?: Course[] }>(userId, `${API}?${q}`);
    return (res.courses ?? []).filter((c) => typeof c.id === "string" && COURSE_ID.test(c.id));
  }

  /** The classes to look in: the one they named, or all of them (the first ten). */
  async function pick(userId: string, args: Args, asStudent: boolean): Promise<Course[]> {
    const all = await courses(userId, asStudent);
    const named = str(args.class, 100);
    if (!named) return all.slice(0, CLASSES_MAX);
    const hit = pickByName(all, named, (c) => c.id, (c) => `${c.name ?? ""} ${c.section ?? ""}`.trim(), "class");
    if (!hit) {
      const names = all.slice(0, 5).map((c) => `"${className(c)}"`).join(", ");
      throw reject(`I couldn't find a class called "${oneLine(named, 40)}"${asStudent ? " that you're a student in" : ""}.${names ? ` Your classes: ${names}.` : ""}`);
    }
    return [hit];
  }

  async function myClasses(userId: string): Promise<CallOutcome> {
    const all = await courses(userId, false);
    if (!all.length) return ok("You're not in any active Google Classroom classes.");
    return ok(`You're in ${count(all.length, "class", "classes")}:\n${all.map((c) => `- ${className(c)}${c.room ? ` (room ${oneLine(c.room, 20)})` : ""}`).join("\n")}`);
  }

  async function whatsDue(userId: string, args: Args): Promise<CallOutcome> {
    const days = clampInt(args.days, 1, 30, 7);
    const [list, tz] = await Promise.all([pick(userId, args, true), o.zone(userId, args)]);
    if (!list.length) return ok("You're not a student in any active Google Classroom class, so nothing is due.");
    const from = now() - MISSING_DAYS * DAY, to = now() + days * DAY;
    const perClass = await Promise.all(list.map(async (c) => {
      const id = encodeURIComponent(c.id);
      const [work, subs] = await Promise.all([
        get<{ courseWork?: Work[] }>(userId, `${API}/${id}/courseWork?${new URLSearchParams({ orderBy: "dueDate desc", pageSize: "60" })}`),
        get<{ studentSubmissions?: Submission[] }>(userId, `${API}/${id}/courseWork/-/studentSubmissions?${new URLSearchParams({ userId: "me", pageSize: "100" })}`),
      ]);
      const mine = new Map((subs.studentSubmissions ?? []).map((s) => [s.courseWorkId, s]));
      return (work.courseWork ?? []).flatMap((w) => {
        const due = dueAt(w);
        if (due === null || due < from || due > to) return [];
        const s = mine.get(w.id);
        const done = s?.state === "TURNED_IN" || s?.state === "RETURNED";
        // Past its due date it is worth saying only while it is still not turned in.
        if (due < now() && done) return [];
        return [{ due, line: `${className(c)}: ${oneLine(w.title)}, due ${at(due, tz)}, ${stateWords(s, due < now(), w.maxPoints)}` }];
      });
    }));
    const items = perClass.flat().sort((a, b) => a.due - b.due);
    const span = days === 1 ? "in the next day" : `in the next ${days} days`;
    if (!items.length) return ok(`Nothing due ${span}, and nothing missing.`);
    return ok(`${count(items.length, "piece of work", "pieces of work")} due ${span} or still missing:\n${items.map((i) => `- ${i.line}`).join("\n")}`);
  }

  async function announcements(userId: string, args: Args): Promise<CallOutcome> {
    const [list, tz] = await Promise.all([pick(userId, args, false), o.zone(userId, args)]);
    if (!list.length) return ok("You're not in any active Google Classroom classes.");
    const q = new URLSearchParams({ orderBy: "updateTime desc", pageSize: String(POSTS_MAX) });
    const per = await Promise.all(list.map(async (c) => {
      const res = await get<{ announcements?: Post[] }>(userId, `${API}/${encodeURIComponent(c.id)}/announcements?${q}`);
      return (res.announcements ?? []).map((p) => ({ c, p, t: Date.parse(p.updateTime ?? p.creationTime ?? "") || 0 }));
    }));
    const posts = per.flat().filter((x) => x.p.text?.trim()).sort((a, b) => b.t - a.t).slice(0, POSTS_MAX);
    const where = list.length === 1 ? ` in ${className(list[0]!)}` : "";
    if (!posts.length) return ok(`No announcements${where} yet.`);
    const lines = posts.map(({ c, p, t }) => `- ${list.length > 1 ? `${className(c)}, ` : ""}${t ? at(t, tz) : "earlier"}: ${oneLine(p.text, 200)}`);
    return ok(`The latest ${count(posts.length, "announcement")}${where}:\n${lines.join("\n")}`);
  }

  return {
    tools: () => TOOLS,
    async call(userId, tool, args): Promise<CallOutcome> {
      switch (tool) {
        case "my_classes": return myClasses(userId);
        case "whats_due": return whatsDue(userId, args);
        case "announcements": return announcements(userId, args);
        default: throw noSuchTool(APP, tool);
      }
    },
  };
}
