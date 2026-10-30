/**
 * PLAN, ONE THING AT A TIME: add an event or a to-do to the person's own calendar, change it, tick it, take it out (no board of its own:
 * the kit's form parts, drawn as Spaces' "Plan for someone" draws them; registered with the bots area's screens, bots.ts).
 *
 *   bots.plan.item { kind: "event" | "task", day? }   add: Event or To-do, what, the day (from `day`), a time, how long, where, repeat,
 *                                                       a reminder, notes. "Dentist Fri 5 pm" in What is read for its day and time.
 *   bots.plan.item { kind, id }                        change one, take it out (a series: this day, or every time), tick a to-do.
 *                                                       Someone else's (a space's plan or task): who set it, Done, Can't do it; no changes.
 *
 * Data: GET /v1/botsapp/calendar/events/:id, /tasks/:id (routes/botsCalendar.ts). Writes are calls, then a short toast and back; the Plan
 * hears the change itself (live "calendar", "tasks").
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  back, C, call, chips, col, emptyState, FACE, icon, meta, notice, open, page, primaryButton, quietButton, row, SCREENS, secondaryButton, sectionLabel,
  segmented, seq, text, when, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

const CAL = "/v1/botsapp/calendar";
const SPACES = "/v1/botsapp/bots/spaces";
const enc = encodeURIComponent;
const MIN = 60_000, DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** GET /v1/botsapp/calendar/events/:id (src/calendar/service.ts CalEvent). */
export interface EventView {
  id: string; seriesId: string; title: string; notes: string; place: string; where?: string; start: number; end: number; allDay: boolean; day: string;
  repeat: string; remindMin: number | null; from: string | null; source: string; fixed: boolean; spaceId?: string; taskId?: string; spaceName?: string;
}
/** GET /v1/botsapp/calendar/tasks/:id (CalTask). */
export interface TaskView {
  id: string; title: string; notes: string; list: string; due: string | null; at: number | null; done: boolean; doneAt: number | null; remindMin: number | null;
  from: string | null; source: string; fixed: boolean; spaceId?: string; taskId?: string; spaceName?: string; noteId?: string; todoId?: string;
}
interface ItemData { event?: EventView; task?: TaskView }

const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
const isDesk = (ctx: BotsCtx) => ctx.client === "desktop";
const local = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * MIN);
const keyOf = (ctx: BotsCtx, ms: number) => local(ctx, ms).toISOString().slice(0, 10);
const keyDate = (k: string) => new Date(`${k}T00:00:00Z`);
const keyWords = (k: string) => { const d = keyDate(k); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const isKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
function clockOf(ctx: BotsCtx, ms: number): string {
  const d = local(ctx, ms), h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}
const hhmm = (ctx: BotsCtx, ms: number) => { const d = local(ctx, ms); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
function dayName(ctx: BotsCtx, key: string): string {
  const today = keyOf(ctx, ctx.live.now);
  if (key === today) return "Today";
  if (key === keyOf(ctx, ctx.live.now + DAY)) return "Tomorrow";
  return keyWords(key);
}
const lengthWords = (ms: number) => { const m = Math.round(ms / MIN); return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`; };
const REPEAT_WORDS: Record<string, string> = { daily: "Every day", weekdays: "Every weekday", weekly: "Every week", monthly: "Every month", yearly: "Every year" };

// ------------------------------------------------------------------ the form's parts

/** A text field the kit's way: no frame of its own, Geist, 44 tall. Put it in `inputBox`. */
function field(id: string, path: string, placeholder: string, o: { multiline?: boolean } = {}): Node {
  return {
    type: "TextField", id, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: o.multiline ? 72 : 44, color: C.ink, returnKeyType: "done", ...(o.multiline ? { multiline: true } : {}),
    },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: o.multiline ? 72 : 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
      fontSize: 15, lineHeight: 22, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}
const inputBox = (children: Node[]): Node => row(children, { gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingLeft: 14, paddingRight: 6, paddingVertical: 4, minHeight: 48, backgroundColor: C.paper });
const labelledField = (label: string, f: Node): Node => col([sectionLabel(label), inputBox([f])], { gap: 8 });
const section = (label: string, kids: Node[]): Node => col([sectionLabel(label), ...kids], { gap: 8 });

/** Today and the next six days, and `extra` (the day it is on) when it is not among them. */
function dayOptions(ctx: BotsCtx, extra?: string | null): Array<{ label: string; value: string }> {
  const keys = Array.from({ length: 7 }, (_, i) => keyOf(ctx, ctx.live.now + i * DAY));
  if (extra && !keys.includes(extra)) keys.unshift(extra);
  return keys.map((k) => ({ label: dayName(ctx, k) === keyWords(k) ? `${WEEKDAYS[keyDate(k).getUTCDay()]} ${keyDate(k).getUTCDate()}` : dayName(ctx, k), value: k }));
}
const TIMES = [{ label: "9 am", value: "09:00" }, { label: "12 pm", value: "12:00" }, { label: "4 pm", value: "16:00" }, { label: "6 pm", value: "18:00" }, { label: "8 pm", value: "20:00" }];
const LENGTHS = [{ label: "30 min", value: "30" }, { label: "1 h", value: "60" }, { label: "1.5 h", value: "90" }, { label: "2 h", value: "120" }];
const REPEATS = [{ label: "Once", value: "" }, { label: "Daily", value: "daily" }, { label: "Weekdays", value: "weekdays" }, { label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" }, { label: "Yearly", value: "yearly" }];
const REMINDS = [{ label: "None", value: "" }, { label: "At the time", value: "0" }, { label: "15 min before", value: "15" }, { label: "1 h before", value: "60" }, { label: "A day before", value: "1440" }];

function eventFields(ctx: BotsCtx, o: { extraDay?: string | null; series?: boolean } = {}): Node[] {
  return [
    labelledField("What", field("ttl", "ttl", "Dentist Fri 5 pm")),
    ...(o.series ? [] : [section("Day", [chips(dayOptions(ctx, o.extraDay), "day")])]),
    section("Time", [chips([{ label: "All day", value: "" }, ...TIMES], "time"), inputBox([field("time", "time", "Or type a time, like 17:30")])]),
    when({ truthy: "time" }, section("How long", [segmented(LENGTHS, "mins")])),
    labelledField("Where (if it matters)", field("place", "place", "Indiranagar, Dr. Mehta's clinic…")),
    section("Repeat", [chips(REPEATS, "repeat")]),
    section("Remind me", [chips(REMINDS, "remind")]),
    labelledField("Notes", field("notes", "notes", "Bring the old X-rays", { multiline: true })),
  ];
}

function taskFields(ctx: BotsCtx, o: { extraDay?: string | null } = {}): Node[] {
  return [
    labelledField("To do", field("ttl", "ttl", "Pay the electricity bill by Fri")),
    section("Due", [chips([{ label: "No day", value: "" }, ...dayOptions(ctx, o.extraDay)], "day")]),
    when({ truthy: "day" }, section("Time", [chips([{ label: "Any time", value: "" }, ...TIMES], "time"), inputBox([field("ttime", "time", "Or type a time, like 17:30")])])),
    when({ truthy: "day" }, section("Remind me", [chips(REMINDS.filter((r) => r.value !== "15"), "tremind")])),
    labelledField("Notes", field("notes", "notes", "The account number is on the last bill", { multiline: true })),
  ];
}

const tz = (ctx: BotsCtx) => ctx.tzOffsetMinutes;
const eventBody = (ctx: BotsCtx, o: { day?: boolean } = {}): Record<string, unknown> => ({
  title: "$state.ttl", ...(o.day === false ? {} : { day: "$state.day" }), time: "$state.time", minutes: "$state.mins", place: "$state.place", notes: "$state.notes",
  repeat: "$state.repeat", remind: "$state.remind", tz: tz(ctx),
});
const taskBody = (ctx: BotsCtx): Record<string, unknown> => ({ title: "$state.ttl", day: "$state.day", time: "$state.time", notes: "$state.notes", remind: "$state.tremind", tz: tz(ctx) });

/** Only when the field at `path` has something in it. */
const ifFilled = (path: string, then: ActionRef, empty: string): ActionSpec => ({ kind: "condition", if: { falsy: path }, then: toast(empty), else: then });
const done = (message: string): ActionRef => seq(toast(message), back());
const failed = (message = "Couldn't save that. Try again."): ActionRef => toast(message, true);

function shell(ctx: BotsCtx, heading: string, sub: string, body: Node[], footer: Node[], state: Record<string, unknown>) {
  return page(ctx, {
    back: true, ...(isDesk(ctx) ? { backTitle: "Plan Ease" } : {}), nav: "plan", title: heading, maxWidth: 640, gap: 18, state,
    body: [col([text(heading, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), ...(sub ? [meta(sub, { size: 13 })] : [])], { gap: 4 }), ...body],
    footer,
  });
}

// ------------------------------------------------------------------ add

function addPage(ctx: BotsCtx) {
  const kind = ctx.params.kind === "task" ? "task" : "event";
  const day = isKey(ctx.params.day) ? ctx.params.day : keyOf(ctx, ctx.live.now);
  const save = ifFilled("ttl", {
    kind: "condition", if: { eq: ["kind", "task"] },
    then: call("POST", `${CAL}/tasks`, taskBody(ctx), { ok: done("Added to your to-dos"), fail: failed("Couldn't add it. Check the day and the time.") }),
    else: call("POST", `${CAL}/events`, eventBody(ctx), { ok: done("On your calendar"), fail: failed("Couldn't add it. Check the day and the time.") }),
  }, "Say what it is first");
  return shell(ctx, "Add to your Plan", "Only you see it. Plan Ease plans around it, and reminds you when you ask.", [
    segmented([{ label: "Event", value: "event" }, { label: "To-do", value: "task" }], "kind"),
    when({ eq: ["kind", "event"] }, col(eventFields(ctx, { extraDay: day }), { gap: 18 })),
    when({ eq: ["kind", "task"] }, col(taskFields(ctx, { extraDay: day }), { gap: 18 })),
  ], [primaryButton("Add", save, { wide: !isDesk(ctx) })], {
    kind, ttl: "", day, time: "", mins: "60", place: "", notes: "", repeat: "", remind: "15", tremind: "",
  });
}

// ------------------------------------------------------------------ someone else's

function fromLine(x: { from: string | null; source: string; spaceName?: string }): string {
  if (!x.from) return "";
  if (x.source === "space") return x.from === "You" ? `You set this in ${x.spaceName ?? "your space"}` : `From ${x.from}${x.spaceName ? ` · in ${x.spaceName}` : ""}`;
  if (x.source === "note") return `From your meeting “${x.from}”`;
  return `Added by ${x.from}`;
}

/** A space's plan or task for this person: what it is, and their answer (it's theirs to change). */
function theirsPage(ctx: BotsCtx, it: { kind: "event" | "task"; title: string; lines: string[]; spaceId: string; taskId: string; id: string; from: string | null; source: string; spaceName?: string; done?: boolean }) {
  const answer = (status: "done" | "todo") => call("PUT", `${SPACES}/${enc(it.spaceId)}/tasks/${enc(it.taskId)}`, { status }, { ok: done(status === "done" ? "Done. They'll see it" : "Back on your list"), fail: failed("Couldn't send that. Try again.") });
  const cant = call("POST", `${CAL}/cant/${enc(it.id)}`, undefined, { ok: done("They'll see you can't"), fail: failed("Couldn't send that. Try again.") });
  return shell(ctx, it.title, fromLine(it), [
    col(it.lines.filter(Boolean).map((l) => text(l, { size: 15, lineHeight: 21 })), { gap: 6, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    notice(`${it.from ?? "They"} set this, so only they can change it. Say how it went.`),
  ], [row([
    it.done ? secondaryButton("Not done yet", answer("todo"), { size: "md" }) : primaryButton("Done", answer("done"), { size: "md" }),
    secondaryButton("Can't do it", cant, { size: "md" }),
  ], { gap: 10, flexWrap: "wrap" })], {});
}

// ------------------------------------------------------------------ change an event

function eventPage(ctx: BotsCtx, e: EventView) {
  const whenLine = e.allDay ? `${dayName(ctx, e.day)}, all day` : `${dayName(ctx, e.day)}, ${clockOf(ctx, e.start)} to ${clockOf(ctx, e.end)} · ${lengthWords(e.end - e.start)}`;
  if (e.fixed && e.spaceId && e.taskId) {
    return theirsPage(ctx, { kind: "event", title: e.title, lines: [whenLine, e.place, e.notes], spaceId: e.spaceId, taskId: e.taskId, id: e.id, from: e.from, source: e.source, spaceName: e.spaceName });
  }
  const series = !!e.repeat;
  const base = `${CAL}/events/${enc(e.id)}`;
  const save = ifFilled("ttl", call("PUT", base, eventBody(ctx, { day: !series }), { ok: done("Saved"), fail: failed() }), "Say what it is first");
  const remove = series
    ? [quietButton("Take out this day", call("DELETE", `${base}?one=1`, undefined, { ok: done("Taken out of that day"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" }),
      quietButton("Take out every time", call("DELETE", base, undefined, { ok: done("Taken out"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" })]
    : [quietButton("Take it out", call("DELETE", base, undefined, { ok: done("Taken out"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" })];
  const sub = [series ? `${REPEAT_WORDS[e.repeat] ?? "Repeats"} · changes apply every time` : whenLine, fromLine(e)].filter(Boolean).join(" · ");
  const lenMin = e.allDay ? 60 : Math.round((e.end - e.start) / MIN);
  return shell(ctx, e.title, sub, [...eventFields(ctx, { extraDay: e.day, series }), row(remove, { gap: 8, flexWrap: "wrap" })], [primaryButton("Save", save, { wide: !isDesk(ctx) })], {
    ttl: e.title, day: e.day, time: e.allDay ? "" : hhmm(ctx, e.start), mins: String(lenMin), place: e.place, notes: e.notes, repeat: e.repeat,
    remind: e.remindMin === null ? "" : String(e.remindMin),
  });
}

// ------------------------------------------------------------------ change a to-do

function taskPage(ctx: BotsCtx, t: TaskView) {
  const dueLine = t.due ? `Due ${dayName(ctx, t.due)}${t.at !== null ? `, ${clockOf(ctx, t.at)}` : ""}` : "No day";
  const base = `${CAL}/tasks/${enc(t.id)}`;
  if (t.fixed && t.spaceId && t.taskId) {
    return theirsPage(ctx, { kind: "task", title: t.title, lines: [dueLine, t.notes], spaceId: t.spaceId, taskId: t.taskId, id: t.id, from: t.from, source: t.source, spaceName: t.spaceName, done: t.done });
  }
  const save = ifFilled("ttl", call("PUT", base, taskBody(ctx), { ok: done("Saved"), fail: failed() }), "Say what the to-do is first");
  const tick = call("PUT", base, { done: !t.done, tz: tz(ctx) }, { ok: done(t.done ? "Back on your list" : "Done"), fail: failed("Couldn't tick it. Try again.") });
  return shell(ctx, t.done ? `${t.title} · done` : t.title, [dueLine, fromLine(t)].filter(Boolean).join(" · "), [
    secondaryButton(t.done ? "Not done yet" : "Mark done", tick, { size: "md", icon: "check" }),
    ...taskFields(ctx, { extraDay: t.due }),
    row([quietButton("Take it out", call("DELETE", base, undefined, { ok: done("Taken out"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" })], { gap: 8 }),
  ], [primaryButton("Save", save, { wide: !isDesk(ctx) })], {
    ttl: t.title, day: t.due ?? "", time: t.at !== null ? hhmm(ctx, t.at) : "", notes: t.notes, tremind: t.remindMin === null ? "" : String(t.remindMin),
  });
}

function itemPage(ctx: BotsCtx, d: ItemData | undefined) {
  const id = String(ctx.params.id ?? "");
  if (!id) return addPage(ctx);
  if (d?.event) return eventPage(ctx, d.event);
  if (d?.task) return taskPage(ctx, d.task);
  return page(ctx, {
    back: true, nav: "plan", title: "Plan",
    body: [emptyState({ pose: "think", title: "It isn't there any more", body: "It may have been taken out, or the connection dropped.", action: { label: "Back to Plan", onPress: open(SCREENS.plan) } })],
  });
}

export const planItemScreens: BotsScreen[] = [
  screen<ItemData>({
    id: SCREENS.planItem,
    load: async (ctx, deps) => {
      const id = String(ctx.params.id ?? "");
      if (!id) return {};
      if (ctx.params.kind === "task") return { task: (await deps.api<{ task: TaskView }>("GET", `${CAL}/tasks/${enc(id)}`)).task };
      return { event: (await deps.api<{ event: EventView }>("GET", `${CAL}/events/${enc(id)}?tz=${ctx.tzOffsetMinutes}`)).event };
    },
    build: itemPage,
  }),
];

/** Plan's "Add" (the day it starts on). */
export const addAction = (day?: string, kind: "event" | "task" = "event"): ActionSpec => open(SCREENS.planItem, { kind, ...(day ? { day } : {}) });
/** One event or to-do of the person's own calendar. */
export const itemAction = (kind: "event" | "task", id: string): ActionSpec => open(SCREENS.planItem, { kind, id });
/** A to-do's tick on a list (Plan's day, its open to-dos): the call, then the toast and a refresh. */
export const tickAction = (id: string, isDone: boolean): ActionRef => call("PUT", `${CAL}/tasks/${enc(id)}`, { done: !isDone }, {
  ok: seq(toast(isDone ? "Back on your list" : "Done"), { kind: "refresh" }), fail: toast("Couldn't tick it. Try again.", true),
});
/** The round tick a to-do row starts with: a 22 ring (filled when done) in a 40 tap area, pressable on its own (never inside another). */
export function tickBox(isDone: boolean, onPress: ActionRef, label: string): Node {
  const ring = row([isDone ? icon("check", { size: 13, color: C.paper, weight: 2.4 }) : row([], {})], {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center",
    ...(isDone ? { backgroundColor: C.ink } : { borderWidth: 1.5, borderColor: C.outline }),
  });
  const hit = row([ring], { width: 40, height: 40, marginLeft: -9, marginVertical: -9, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress);
  return { ...hit, props: { ...(hit.props ?? {}), accessibilityLabel: label } };
}
export { fromLine as itemFromLine };
