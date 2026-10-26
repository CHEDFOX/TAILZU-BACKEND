/**
 * THE BENCH'S GOOGLE: Calendar, Tasks, Docs, Drive, Sheets, Forms and
 * Classroom behind one fetch, with state.
 *
 * Grown from fakeGoogle() in tests/connectors-google-apps.test.ts (its call
 * record, its route table, its "no route" 404), with one difference that
 * matters: that fake answers each request with a reply its test wrote, and
 * this one keeps the person's calendar, lists, docs and sheets, so an event
 * created on a yes is there when the next request lists the day, and a grader
 * can ask what changed. It serves exactly the requests the native connectors
 * make (src/connectors/google/*.ts), in the shapes they read, and every one of
 * them goes through the real code: the session, its token refresh, its error
 * words.
 *
 * Every change (POST, PATCH or DELETE that alters something) is written down
 * as a Mutation: which app, what, its state afterwards, and whether it
 * happened during a turn of Ask or while the person's yes to a card was being
 * carried out (`phase`, which the harness moves). A delete is destructive; an
 * event made or moved with guests on it is a send, since Google emails them.
 *
 * Ids are counters (ev1, t1, doc1), so a tool's result, and with it the
 * planner's next message and the cassette key, is the same on every run.
 * Drive only lists files whose ids look like Drive's (twenty characters or
 * more: google/drive.ts), so the counters for sheets and forms are padded.
 *
 * Which app a request is for is read from its token: the harness signs each
 * connected app in with "at-<app>", so a fault for google-sheets fails the
 * sheet's own Drive lookups too, as a real outage would. An app signed out
 * answers 401 to everything and refuses the refresh (invalid_grant), as a
 * revoked grant does. A request no route here serves is answered 404 and
 * recorded in `unknownRoutes`: a gap in this world, never the agent's fault.
 */
import type { Note } from "../../../../shared/types/api.js";
import type { NotesSource } from "../../../src/connectors/google/index.js";
import { atWall, rfc3339 } from "../../../src/connectors/google/time.js";
import type { BenchClock } from "../clock.js";
import { BENCH_TZ, type Fault, type GoogleApp, type Mutation, type SeedEvent, type WorldSeed } from "../types.js";

export interface WorldEvent {
  id: string;
  title: string;
  /** RFC 3339 in the calendar's zone, or YYYY-MM-DD for an all-day event (whose end is the day after it, as Google keeps it). */
  start: string;
  end: string;
  allDay: boolean;
  attendees: string[];
  description?: string;
  location?: string;
}
export interface WorldTaskList { id: string; title: string }
export interface WorldTask { id: string; listId: string; list: string; title: string; due: string | null; notes?: string; done: boolean }
export interface WorldDoc { id: string; title: string; text: string }
export interface WorldSheet { id: string; title: string; rows: Array<Array<string | number>> }
export interface WorldForm {
  id: string;
  title: string;
  description?: string;
  questions: Array<{ id: string; title: string; options: string[] }>;
  published: boolean;
  /** Answers by question title. */
  responses: Array<{ at: string; answers: Record<string, string> }>;
}
export interface WorldCourse {
  id: string;
  name: string;
  work: Array<{ id: string; title: string; description?: string; due?: string; state: string }>;
  announcements: Array<{ text: string; at: string }>;
}
export interface GoogleState {
  zone: string;
  events: WorldEvent[];
  taskLists: WorldTaskList[];
  tasks: WorldTask[];
  docs: WorldDoc[];
  sheets: WorldSheet[];
  forms: WorldForm[];
  courses: WorldCourse[];
}

export type WorldPhase = { kind: "turn"; turn: number } | { kind: "approval"; taskId: string };
export interface WorldCall { method: string; url: string; body: unknown; status: number }

const MIME = {
  sheet: "application/vnd.google-apps.spreadsheet",
  form: "application/vnd.google-apps.form",
  doc: "application/vnd.google-apps.document",
} as const;

/** What a request carries, read once. */
interface Req { method: string; url: URL; path: string; body: any; form: URLSearchParams | null; app: GoogleApp | "token" | null }
type Reply = { status: number; json?: unknown };

/** An event as kept here: instants for ordering, the days themselves when it is all-day. */
interface Ev { id: string; title: string; allDay: boolean; startMs: number; endMs: number; startDate?: string; endDate?: string; attendees: string[]; description?: string; location?: string }

const json = (status: number, body: unknown): Reply => ({ status, json: body });
const empty = (): Reply => ({ status: 204 });
const googleError = (status: number, message: string, statusWord: string, reason?: string): Reply =>
  json(status, { error: { code: status, message, status: statusWord, ...(reason ? { errors: [{ reason, message }] } : {}) } });
const notFound = (what: string) => googleError(404, `${what} not found`, "NOT_FOUND");
const DAY_MS = 86_400_000;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Drive-like ids: "sheet1_" padded to 24 characters, so google/drive.ts takes them. */
const driveId = (kind: string, n: number) => `${kind}${n}_`.padEnd(24, "x");

export class GoogleWorld {
  readonly calls: WorldCall[] = [];
  readonly mutations: Mutation[] = [];
  readonly unknownRoutes: string[] = [];
  phase: WorldPhase = { kind: "turn", turn: 0 };
  readonly fetch: typeof fetch;
  readonly notes: NotesSource;

  private readonly zone: string;
  private evs: Ev[] = [];
  private lists: WorldTaskList[] = [];
  private tasksKept: WorldTask[] = [];
  private docsKept: WorldDoc[] = [];
  private sheetsKept: WorldSheet[] = [];
  private formsKept: WorldForm[] = [];
  private courses: WorldCourse[] = [];
  /** Drive's modifiedTime, as an order: the file touched last lists first. */
  private touched = new Map<string, number>();
  private touches = 0;
  private counters = { ev: 0, t: 0, doc: 0, sheet: 0, form: 0, q: 0, tok: 0 };
  private readonly faults: Array<Fault & { left: number }>;
  private readonly signedOut: Set<string>;

  constructor(private readonly seed: WorldSeed, private readonly clock: BenchClock) {
    const g = seed.google ?? {};
    this.zone = g.calendarZone ?? BENCH_TZ;
    this.faults = (seed.faults ?? []).map((f) => ({ ...f, left: f.times ?? Infinity }));
    this.signedOut = new Set((seed.connected ?? []).filter((c) => c.signedOut).map((c) => c.app));

    for (const e of g.events ?? []) this.evs.push(this.seedEvent(e.id ?? `ev${++this.counters.ev}`, e));
    for (const e of this.evs) this.counters.ev = Math.max(this.counters.ev, numberIn(e.id, "ev"));

    const lists = g.taskLists?.length ? g.taskLists : [{ title: "My Tasks" }];
    lists.forEach((l, i) => {
      const id = l.id ?? `list${i + 1}`;
      this.lists.push({ id, title: l.title });
      for (const t of l.tasks ?? []) {
        this.tasksKept.push({
          id: t.id ?? `t${++this.counters.t}`, listId: id, list: l.title, title: t.title,
          due: t.due ?? null, ...(t.notes ? { notes: t.notes } : {}), done: !!t.done,
        });
      }
    });
    for (const t of this.tasksKept) this.counters.t = Math.max(this.counters.t, numberIn(t.id, "t"));

    for (const d of g.docs ?? []) this.docsKept.push({ id: d.id ?? `doc${++this.counters.doc}`, title: d.title, text: d.text ?? "" });
    for (const s of g.sheets ?? []) this.sheetsKept.push({ id: s.id ?? driveId("sheet", ++this.counters.sheet), title: s.title, rows: structuredClone(s.rows ?? []) });
    for (const f of g.forms ?? []) {
      const questions = (f.questions ?? []).map((title) => ({ id: `q${++this.counters.q}`, title, options: [] as string[] }));
      const n = f.responses?.length ?? 0;
      this.formsKept.push({
        id: f.id ?? driveId("form", ++this.counters.form), title: f.title, questions, published: true,
        // Answered in the hours before now, the last one an hour ago.
        responses: (f.responses ?? []).map((answers, i) => ({ at: new Date(clock.now() - (n - i) * 3_600_000).toISOString(), answers: { ...answers } })),
      });
    }
    for (const id of [...this.docsKept, ...this.sheetsKept, ...this.formsKept].map((x) => x.id)) this.touch(id);
    (g.courses ?? []).forEach((c, i) => {
      this.courses.push({
        id: c.id ?? `c${i + 1}`, name: c.name,
        work: (c.work ?? []).map((w, j) => ({ id: w.id ?? `w${i + 1}_${j + 1}`, title: w.title, ...(w.description ? { description: w.description } : {}), ...(w.due ? { due: w.due } : {}), state: w.state ?? "NEW" })),
        announcements: (c.announcements ?? []).map((a) => ({ ...a })),
      });
    });

    this.fetch = ((input: string | URL | Request, init?: RequestInit) => this.handle(input, init)) as typeof fetch;
    this.notes = { find: async (_userId, id) => this.note(id) };
  }

  // ------------------------------------------------------------- reading it

  /** Everything, copied: what a grader may look at after the run. */
  snapshot(): GoogleState {
    return structuredClone({
      zone: this.zone, events: this.events(), taskLists: this.lists, tasks: this.tasksKept, docs: this.docsKept,
      sheets: this.sheetsKept, forms: this.formsKept, courses: this.courses,
    });
  }
  events(): WorldEvent[] { return this.evs.slice().sort(byStart).map((e) => this.eventView(e)); }
  tasks(list?: string): WorldTask[] {
    return structuredClone(this.tasksKept.filter((t) => !list || t.listId === list || t.list.toLowerCase() === list.toLowerCase()));
  }
  docs(): WorldDoc[] { return structuredClone(this.docsKept); }
  sheets(): WorldSheet[] { return structuredClone(this.sheetsKept); }
  forms(): WorldForm[] { return structuredClone(this.formsKept); }

  // ------------------------------------------------------------- the fetch

  private async handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : null;
    const isForm = (headers.get("content-type") ?? "").includes("x-www-form-urlencoded");
    let body: unknown = null;
    if (raw && !isForm) { try { body = JSON.parse(raw); } catch { body = raw; } }
    const form = raw && isForm ? new URLSearchParams(raw) : null;
    const app = url.hostname === "oauth2.googleapis.com" ? "token" : appOfToken(headers.get("authorization"));
    const req: Req = { method, url, path: url.pathname, body, form, app };

    const fault = this.faultFor(req);
    if (fault === "network") {
      this.calls.push({ method, url: url.toString(), body: form ? Object.fromEntries(form) : body, status: 0 });
      throw new TypeError("fetch failed");
    }
    const reply = fault ?? this.route(req, headers.get("authorization"));
    this.calls.push({ method, url: url.toString(), body: form ? Object.fromEntries(form) : body, status: reply.status });
    return reply.json === undefined
      ? new Response(null, { status: reply.status })
      : new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "content-type": "application/json" } });
  }

  /** A fault the seed injects for this request, if one still has times left. */
  private faultFor(req: Req): Reply | "network" | null {
    const f = this.faults.find((x) => x.left > 0 && x.app === req.app && (!x.method || x.method === req.method));
    if (!f) return null;
    f.left -= 1;
    if (f.status === "network") return "network";
    if (req.app === "token") return json(f.status, { error: f.status === 401 ? "invalid_grant" : "server_error" });
    const words: Record<number, [string, string?]> = {
      401: ["UNAUTHENTICATED"], 403: ["PERMISSION_DENIED", "forbidden"], 404: ["NOT_FOUND"],
      429: ["RESOURCE_EXHAUSTED", "rateLimitExceeded"], 500: ["INTERNAL", "backendError"], 503: ["UNAVAILABLE", "backendError"],
    };
    const [statusWord, reason] = words[f.status] ?? ["UNKNOWN"];
    return googleError(f.status, "the bench injected this failure", statusWord, reason);
  }

  private route(req: Req, authorization: string | null): Reply {
    const { method, path, url } = req;
    const host = url.hostname;
    if (host === "oauth2.googleapis.com") {
      if (method === "POST" && path === "/token") return this.token(req);
      if (method === "POST" && path === "/revoke") return json(200, {});
      return this.unknown(req);
    }
    // Every API call is signed in, and a signed-out app's token is no good.
    if (!req.app || this.signedOut.has(req.app) || !authorization) {
      return googleError(401, "Request had invalid authentication credentials.", "UNAUTHENTICATED");
    }
    let m: RegExpExecArray | null;
    if (host === "www.googleapis.com") {
      if (path === "/calendar/v3/calendars/primary/events") {
        if (method === "GET") return this.listEvents(url);
        if (method === "POST") return this.createEvent(req.body);
      }
      if ((m = /^\/calendar\/v3\/calendars\/primary\/events\/([^/]+)$/.exec(path))) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") return this.getEvent(id);
        if (method === "PATCH") return this.patchEvent(id, req.body);
        if (method === "DELETE") return this.deleteEvent(id);
      }
      if (path === "/drive/v3/files" && method === "GET") return this.driveList(url);
      if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)) && method === "GET") return this.driveGet(decodeURIComponent(m[1]!));
    }
    if (host === "tasks.googleapis.com") {
      if (path === "/tasks/v1/users/@me/lists" && method === "GET") return json(200, { kind: "tasks#taskLists", items: this.lists.map((l) => ({ id: l.id, title: l.title })) });
      if ((m = /^\/tasks\/v1\/lists\/([^/]+)\/tasks$/.exec(path))) {
        const list = this.listOf(decodeURIComponent(m[1]!));
        if (!list) return notFound("Task list");
        if (method === "GET") return this.listTasks(list, url);
        if (method === "POST") return this.addTask(list, req.body);
      }
      if ((m = /^\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)$/.exec(path))) {
        const list = this.listOf(decodeURIComponent(m[1]!));
        const task = list && this.tasksKept.find((t) => t.id === decodeURIComponent(m![2]!) && t.listId === list.id);
        if (!task) return notFound("Task");
        if (method === "PATCH") return this.patchTask(task, req.body);
        if (method === "DELETE") return this.deleteTask(task);
      }
    }
    if (host === "docs.googleapis.com") {
      if (path === "/v1/documents" && method === "POST") return this.createDoc(req.body);
      if ((m = /^\/v1\/documents\/([^/:]+):batchUpdate$/.exec(path)) && method === "POST") return this.updateDoc(decodeURIComponent(m[1]!), req.body);
    }
    if (host === "sheets.googleapis.com") {
      if (path === "/v4/spreadsheets" && method === "POST") return this.createSheet(req.body);
      if ((m = /^\/v4\/spreadsheets\/([^/]+)\/values\/([^/]+)$/.exec(path))) {
        const sheet = this.sheetsKept.find((s) => s.id === decodeURIComponent(m![1]!));
        if (!sheet) return notFound("Spreadsheet");
        const range = decodeURIComponent(m[2]!);
        if (method === "POST" && range.endsWith(":append")) return this.appendRows(sheet, req.body);
        if (method === "GET") return json(200, { range, majorDimension: "ROWS", values: sheet.rows.slice(0, 200).map((r) => r.slice(0, 26).map((c) => String(c))) });
      }
    }
    if (host === "forms.googleapis.com") {
      if (path === "/v1/forms" && method === "POST") return this.createForm(req.body);
      if ((m = /^\/v1\/forms\/([^/:]+)(?::(batchUpdate|setPublishSettings))?(\/responses)?$/.exec(path))) {
        const form = this.formsKept.find((f) => f.id === decodeURIComponent(m![1]!));
        if (!form) return notFound("Form");
        if (method === "POST" && m[2] === "batchUpdate") return this.updateForm(form, req.body);
        if (method === "POST" && m[2] === "setPublishSettings") return this.publishForm(form);
        if (method === "GET" && m[3]) return this.formResponses(form);
        if (method === "GET" && !m[2]) return this.formShape(form);
      }
    }
    if (host === "classroom.googleapis.com" && method === "GET") {
      if (path === "/v1/courses") return json(200, { courses: this.courses.map((c) => ({ id: c.id, name: c.name, courseState: "ACTIVE" })) });
      if ((m = /^\/v1\/courses\/([^/]+)\/(courseWork|courseWork\/-\/studentSubmissions|announcements)$/.exec(path))) {
        const course = this.courses.find((c) => c.id === decodeURIComponent(m![1]!));
        if (!course) return notFound("Course");
        if (m[2] === "courseWork") return json(200, { courseWork: course.work.map((w) => this.workView(w)) });
        if (m[2] === "announcements") {
          const posts = course.announcements.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
          return json(200, { announcements: posts.map((a, i) => ({ id: `${course.id}_a${i + 1}`, text: a.text, state: "PUBLISHED", creationTime: iso(a.at), updateTime: iso(a.at) })) });
        }
        return json(200, { studentSubmissions: course.work.map((w) => this.submissionView(w)) });
      }
    }
    return this.unknown(req);
  }

  private unknown(req: Req): Reply {
    this.unknownRoutes.push(`${req.method} ${req.url.hostname}${req.path}`);
    return googleError(404, "The bench's Google has no route for this request.", "NOT_FOUND");
  }

  /** A refresh: a new access token, or invalid_grant for an app whose sign-in has lapsed. */
  private token(req: Req): Reply {
    const refresh = req.form?.get("refresh_token") ?? "";
    const app = /^rt-(google-[a-z]+)$/.exec(refresh)?.[1];
    if (req.form?.get("grant_type") !== "refresh_token" || !app || this.signedOut.has(app)) {
      return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    }
    return json(200, { access_token: `at-${app}~${++this.counters.tok}`, expires_in: 3600, token_type: "Bearer" });
  }

  private change(app: GoogleApp, op: Mutation["op"], what: string, id: string, detail: Record<string, unknown>, risk?: Mutation["risk"]): void {
    this.mutations.push({
      app, op, what, id, during: this.phase.kind,
      risk: risk ?? (op === "delete" ? "destructive" : "write"), detail: structuredClone(detail),
    });
  }

  private touch(id: string): void { this.touched.set(id, ++this.touches); }

  // ------------------------------------------------------------- Calendar

  private seedEvent(id: string, e: SeedEvent): Ev {
    const base = { id, title: e.title, attendees: [...(e.attendees ?? [])], ...(e.description ? { description: e.description } : {}), ...(e.location ? { location: e.location } : {}) };
    if (e.allDay || isDate(e.start)) {
      const startDate = e.start.slice(0, 10);
      const endDate = e.end && isDate(e.end) ? e.end : nextDay(startDate);
      return { ...base, allDay: true, startDate, endDate, startMs: this.midnight(startDate), endMs: this.midnight(endDate) };
    }
    const startMs = Date.parse(e.start);
    return { ...base, allDay: false, startMs, endMs: e.end ? Date.parse(e.end) : startMs + 30 * 60_000 };
  }

  private midnight(date: string): number {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return atWall(y, m, d, 0, 0, this.zone);
  }

  private eventView(e: Ev): WorldEvent {
    return {
      id: e.id, title: e.title,
      start: e.allDay ? e.startDate! : rfc3339(e.startMs, this.zone),
      end: e.allDay ? e.endDate! : rfc3339(e.endMs, this.zone),
      allDay: e.allDay, attendees: [...e.attendees],
      ...(e.description ? { description: e.description } : {}), ...(e.location ? { location: e.location } : {}),
    };
  }

  /** An event as Calendar API v3 sends it, its times in `tz`. */
  private eventJson(e: Ev, tz = this.zone) {
    return {
      kind: "calendar#event", id: e.id, status: "confirmed", summary: e.title,
      ...(e.description ? { description: e.description } : {}), ...(e.location ? { location: e.location } : {}),
      start: e.allDay ? { date: e.startDate } : { dateTime: rfc3339(e.startMs, tz), timeZone: tz },
      end: e.allDay ? { date: e.endDate } : { dateTime: rfc3339(e.endMs, tz), timeZone: tz },
      ...(e.attendees.length ? { attendees: e.attendees.map((email) => ({ email, responseStatus: "needsAction" })) } : {}),
    };
  }

  private listEvents(url: URL): Reply {
    const q = url.searchParams;
    // The zone read (zone.ts): one value, no events.
    if (q.get("fields") === "timeZone") return json(200, { timeZone: this.zone });
    const tz = q.get("timeZone") || this.zone;
    const from = q.get("timeMin") ? Date.parse(q.get("timeMin")!) : -Infinity;
    const to = q.get("timeMax") ? Date.parse(q.get("timeMax")!) : Infinity;
    const all = this.evs.filter((e) => e.endMs > from && e.startMs < to).sort(byStart);
    const max = Math.max(1, Math.min(2500, Number(q.get("maxResults") ?? 250) || 250));
    const at = Number(q.get("pageToken") ?? 0) || 0;
    const page = all.slice(at, at + max);
    return json(200, {
      kind: "calendar#events", timeZone: this.zone, items: page.map((e) => this.eventJson(e, tz)),
      ...(at + max < all.length ? { nextPageToken: String(at + max) } : {}),
    });
  }

  private getEvent(id: string): Reply {
    const e = this.evs.find((x) => x.id === id);
    return e ? json(200, this.eventJson(e)) : notFound("Event");
  }

  /** start/end as Calendar writes them: { dateTime, timeZone } or { date }. */
  private timeIn(t: { dateTime?: string; date?: string } | undefined): { ms: number; date?: string } | null {
    if (t?.date && isDate(t.date)) return { ms: this.midnight(t.date), date: t.date };
    const ms = t?.dateTime ? Date.parse(t.dateTime) : NaN;
    return Number.isFinite(ms) ? { ms } : null;
  }

  private createEvent(body: any): Reply {
    const start = this.timeIn(body?.start), end = this.timeIn(body?.end);
    if (!start || !end || typeof body?.summary !== "string") return googleError(400, "Missing start, end or summary.", "INVALID_ARGUMENT", "required");
    const e: Ev = {
      id: `ev${++this.counters.ev}`, title: body.summary, allDay: !!start.date, startMs: start.ms, endMs: end.ms,
      ...(start.date ? { startDate: start.date, endDate: end.date ?? nextDay(start.date) } : {}),
      attendees: Array.isArray(body.attendees) ? body.attendees.map((a: { email?: string }) => String(a?.email ?? "")).filter(Boolean) : [],
      ...(typeof body.description === "string" ? { description: body.description } : {}),
    };
    this.evs.push(e);
    this.change("google-calendar", "create", "event", e.id, { ...this.eventView(e) }, e.attendees.length ? "send" : "write");
    return json(200, this.eventJson(e));
  }

  private patchEvent(id: string, body: any): Reply {
    const e = this.evs.find((x) => x.id === id);
    if (!e) return notFound("Event");
    const start = body?.start ? this.timeIn(body.start) : null, end = body?.end ? this.timeIn(body.end) : null;
    if ((body?.start && !start) || (body?.end && !end)) return googleError(400, "Bad start or end.", "INVALID_ARGUMENT", "invalid");
    if (start) {
      e.startMs = start.ms;
      e.allDay = !!start.date;
      if (start.date) e.startDate = start.date; else delete e.startDate;
    }
    if (end) {
      e.endMs = end.ms;
      if (end.date) e.endDate = end.date; else delete e.endDate;
    }
    if (typeof body?.summary === "string") e.title = body.summary;
    this.change("google-calendar", "update", "event", e.id, { ...this.eventView(e) }, e.attendees.length ? "send" : "write");
    return json(200, this.eventJson(e));
  }

  private deleteEvent(id: string): Reply {
    const e = this.evs.find((x) => x.id === id);
    if (!e) return googleError(410, "Resource has been deleted", "GONE", "deleted");
    this.evs = this.evs.filter((x) => x !== e);
    this.change("google-calendar", "delete", "event", e.id, { ...this.eventView(e) });
    return empty();
  }

  // ------------------------------------------------------------- Tasks

  /** A list by its id; "@default" is the first, their main list. */
  private listOf(id: string): WorldTaskList | undefined {
    return id === "@default" ? this.lists[0] : this.lists.find((l) => l.id === id);
  }

  private taskJson(t: WorldTask) {
    return {
      kind: "tasks#task", id: t.id, title: t.title, status: t.done ? "completed" : "needsAction",
      ...(t.notes ? { notes: t.notes } : {}), ...(t.due ? { due: `${t.due}T00:00:00.000Z` } : {}),
    };
  }

  private listTasks(list: WorldTaskList, url: URL): Reply {
    const withDone = url.searchParams.get("showCompleted") !== "false";
    const items = this.tasksKept.filter((t) => t.listId === list.id && (withDone || !t.done));
    return json(200, { kind: "tasks#tasks", items: items.map((t) => this.taskJson(t)) });
  }

  private addTask(list: WorldTaskList, body: any): Reply {
    if (typeof body?.title !== "string") return googleError(400, "A task needs a title.", "INVALID_ARGUMENT", "required");
    const due = typeof body.due === "string" && /^\d{4}-\d{2}-\d{2}/.test(body.due) ? body.due.slice(0, 10) : null;
    const t: WorldTask = { id: `t${++this.counters.t}`, listId: list.id, list: list.title, title: body.title, due, ...(typeof body.notes === "string" && body.notes ? { notes: body.notes } : {}), done: false };
    this.tasksKept.push(t);
    this.change("google-tasks", "create", "task", t.id, { ...t });
    return json(200, this.taskJson(t));
  }

  private patchTask(t: WorldTask, body: any): Reply {
    if (body?.status === "completed") t.done = true;
    if (body?.status === "needsAction") t.done = false;
    if (typeof body?.title === "string") t.title = body.title;
    if (typeof body?.notes === "string") t.notes = body.notes;
    if (typeof body?.due === "string") t.due = body.due.slice(0, 10);
    this.change("google-tasks", "update", "task", t.id, { ...t });
    return json(200, this.taskJson(t));
  }

  private deleteTask(t: WorldTask): Reply {
    this.tasksKept = this.tasksKept.filter((x) => x !== t);
    this.change("google-tasks", "delete", "task", t.id, { ...t });
    return empty();
  }

  // ------------------------------------------------------------- Docs and Drive

  private createDoc(body: any): Reply {
    const title = typeof body?.title === "string" ? body.title : "Untitled document";
    const d: WorldDoc = { id: `doc${++this.counters.doc}`, title, text: "" };
    this.docsKept.push(d);
    this.touch(d.id);
    this.change("google-docs", "create", "doc", d.id, { ...d });
    return json(200, { documentId: d.id, title });
  }

  /** insertText at an index (1 is the start of the body); anything else is answered and left alone. */
  private updateDoc(id: string, body: any): Reply {
    const d = this.docsKept.find((x) => x.id === id);
    if (!d) return notFound("Document");
    for (const r of Array.isArray(body?.requests) ? body.requests : []) {
      const ins = r?.insertText;
      if (ins && typeof ins.text === "string") {
        const at = Math.max(0, Math.min(d.text.length, Number(ins.location?.index ?? 1) - 1));
        d.text = d.text.slice(0, at) + ins.text + d.text.slice(at);
      }
    }
    this.touch(d.id);
    this.change("google-docs", "update", "doc", d.id, { ...d });
    return json(200, { documentId: d.id, replies: [] });
  }

  private driveFiles(): Array<{ id: string; name: string; mimeType: string }> {
    return [
      ...this.sheetsKept.map((s) => ({ id: s.id, name: s.title, mimeType: MIME.sheet })),
      ...this.formsKept.map((f) => ({ id: f.id, name: f.title, mimeType: MIME.form })),
      ...this.docsKept.map((d) => ({ id: d.id, name: d.title, mimeType: MIME.doc })),
    ];
  }

  private driveList(url: URL): Reply {
    const mime = /mimeType='([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
    const size = Math.max(1, Math.min(1000, Number(url.searchParams.get("pageSize") ?? 100) || 100));
    const files = this.driveFiles().filter((f) => !mime || f.mimeType === mime)
      .sort((a, b) => (this.touched.get(b.id) ?? 0) - (this.touched.get(a.id) ?? 0)).slice(0, size);
    return json(200, { files: files.map((f) => ({ id: f.id, name: f.name })) });
  }

  private driveGet(id: string): Reply {
    const f = this.driveFiles().find((x) => x.id === id);
    return f ? json(200, { id: f.id, name: f.name, mimeType: f.mimeType, trashed: false }) : notFound("File");
  }

  // ------------------------------------------------------------- Sheets

  private createSheet(body: any): Reply {
    const title = typeof body?.properties?.title === "string" ? body.properties.title : "Untitled spreadsheet";
    const s: WorldSheet = { id: driveId("sheet", ++this.counters.sheet), title, rows: [] };
    this.sheetsKept.push(s);
    this.touch(s.id);
    this.change("google-sheets", "create", "sheet", s.id, { title, rows: [] });
    return json(200, { spreadsheetId: s.id, properties: { title } });
  }

  private appendRows(s: WorldSheet, body: any): Reply {
    const rows: unknown[] = Array.isArray(body?.values) ? body.values : [];
    const first = s.rows.length + 1;
    for (const raw of rows) {
      const row = (Array.isArray(raw) ? raw : [raw]).map((c) => (typeof c === "number" ? c : String(c ?? "")));
      s.rows.push(row);
      this.change("google-sheets", "create", "row", `${s.id}#${s.rows.length}`, { sheet: s.title, sheetId: s.id, row });
    }
    this.touch(s.id);
    return json(200, { spreadsheetId: s.id, updates: { updatedRange: `Sheet1!A${first}:Z${s.rows.length}`, updatedRows: rows.length } });
  }

  // ------------------------------------------------------------- Forms

  private formView(f: WorldForm) {
    return { title: f.title, questions: f.questions.map((q) => q.title), published: f.published };
  }

  private createForm(body: any): Reply {
    const title = typeof body?.info?.title === "string" ? body.info.title : "Untitled form";
    const f: WorldForm = { id: driveId("form", ++this.counters.form), title, questions: [], published: false, responses: [] };
    this.formsKept.push(f);
    this.touch(f.id);
    this.change("google-forms", "create", "form", f.id, this.formView(f));
    return json(200, { formId: f.id, info: { title, documentTitle: title }, responderUri: `https://docs.google.com/forms/d/e/${f.id}/viewform` });
  }

  private updateForm(f: WorldForm, body: any): Reply {
    for (const r of Array.isArray(body?.requests) ? body.requests : []) {
      if (typeof r?.updateFormInfo?.info?.description === "string") f.description = r.updateFormInfo.info.description;
      const item = r?.createItem?.item;
      if (item && typeof item.title === "string") {
        const options = (item.questionItem?.question?.choiceQuestion?.options ?? []).map((o: { value?: string }) => String(o?.value ?? ""));
        const at = Math.max(0, Math.min(f.questions.length, Number(r.createItem.location?.index ?? f.questions.length)));
        f.questions.splice(at, 0, { id: `q${++this.counters.q}`, title: item.title, options });
      }
    }
    this.touch(f.id);
    this.change("google-forms", "update", "form", f.id, this.formView(f));
    return json(200, { replies: [] });
  }

  private publishForm(f: WorldForm): Reply {
    f.published = true;
    this.change("google-forms", "update", "form", f.id, this.formView(f));
    return json(200, { publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } } });
  }

  private formShape(f: WorldForm): Reply {
    return json(200, {
      formId: f.id, info: { title: f.title, ...(f.description ? { description: f.description } : {}) },
      items: f.questions.map((q) => ({
        itemId: `i_${q.id}`, title: q.title,
        questionItem: { question: { questionId: q.id, ...(q.options.length ? { choiceQuestion: { type: "RADIO", options: q.options.map((value) => ({ value })) } } : { textQuestion: {} }) } },
      })),
    });
  }

  private formResponses(f: WorldForm): Reply {
    return json(200, {
      responses: f.responses.map((r, i) => ({
        responseId: `r${i + 1}`, createTime: r.at, lastSubmittedTime: r.at,
        answers: Object.fromEntries(f.questions.filter((q) => r.answers[q.title] !== undefined)
          .map((q) => [q.id, { questionId: q.id, textAnswers: { answers: [{ value: r.answers[q.title] }] } }])),
      })),
    });
  }

  // ------------------------------------------------------------- Classroom

  /** When work is due, as Classroom keeps it: a date and time in UTC. A day alone is 23:59 that day in their zone. */
  private dueOf(due: string | undefined): number | null {
    if (!due) return null;
    if (isDate(due)) {
      const [y, m, d] = due.split("-").map(Number) as [number, number, number];
      return atWall(y, m, d, 23, 59, this.zone);
    }
    const ms = Date.parse(due);
    return Number.isFinite(ms) ? ms : null;
  }

  private workView(w: WorldCourse["work"][number]) {
    const due = this.dueOf(w.due);
    const d = due === null ? null : new Date(due);
    return {
      id: w.id, title: w.title, workType: "ASSIGNMENT", state: "PUBLISHED", ...(w.description ? { description: w.description } : {}),
      ...(d ? { dueDate: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, dueTime: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() } } : {}),
    };
  }

  private submissionView(w: WorldCourse["work"][number]) {
    const due = this.dueOf(w.due);
    const done = w.state === "TURNED_IN" || w.state === "RETURNED";
    return { courseWorkId: w.id, userId: "me", state: w.state, late: !done && due !== null && due < this.clock.now() };
  }

  // ------------------------------------------------------------- Tailzu's notes

  /** One of the seeded notes, by id, or the newest; as src/notes/store keeps a note. */
  private async note(id?: string): Promise<Note | null> {
    const all = this.seed.notes ?? [];
    const n = id ? all.find((x) => x.id === id) : all.at(-1);
    if (!n) return null;
    return {
      id: n.id, status: "ready", startedAt: n.at, durationSeconds: 0, words: n.text.split(/\s+/).filter(Boolean).length,
      title: n.title, summary: n.text, highlights: [], people: [], transcript: [], organised: true,
    };
  }
}

/** The app a request's token was issued for: the harness signs each one in as "at-<app>". */
function appOfToken(authorization: string | null): GoogleApp | null {
  const m = /^Bearer at-(google-(?:calendar|tasks|docs|sheets|forms|classroom))(?:~\d+)?$/.exec(authorization ?? "");
  return (m?.[1] as GoogleApp | undefined) ?? null;
}

const byStart = (a: Ev, b: Ev) => a.startMs - b.startMs || a.id.localeCompare(b.id);
const numberIn = (id: string, prefix: string) => (new RegExp(`^${prefix}(\\d+)$`).exec(id) ? Number(id.slice(prefix.length)) : 0);
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
/** A seeded time as Classroom writes one: UTC, with Z. */
const iso = (at: string) => { const ms = Date.parse(at); return Number.isFinite(ms) ? new Date(ms).toISOString() : at; };
