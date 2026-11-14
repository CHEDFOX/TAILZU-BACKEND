/**
 * PLAN, ONE THING AT A TIME: add an event or a to-do to the person's own calendar, change it, tick it, take it out (no board of its own:
 * the kit's form parts, drawn as Spaces' "Plan for someone" draws them; registered with the bots area's screens, bots.ts).
 *
 *   bots.plan.item { kind: "event" | "task", day? }   add: Event or To-do, what, the day (from `day`), a time, how long, where, repeat,
 *                                                       a reminder, notes. "Dentist Fri 5 pm" in What is read for its day and time.
 *   bots.plan.item { kind, id }                        change one, take it out (a series: this day, or every time), tick a to-do.
 *                                                       Someone else's (a space's plan or task): who set it, Done, Can't do it; no changes.
 *
 * Data: GET /v1/botsapp/calendar/events/:id, /tasks/:id (routes/bots/botsCalendar.ts). Writes are calls, then a short toast and back; the Plan
 * hears the change itself (live "calendar", "tasks").
 */
import type { ActionRef, ActionSpec, ArrivalItem, Node } from "../../../../../shared/types/sdui.js";
import {
  back, button, C, call, canArrival, canCalendarAdd, canPersonBot, chips, col, emptyState, FACE, icon, labelled, listRow, messageText, meta,
  notice, open, page, personBot, primaryButton, quietButton, row, SCREENS, secondaryButton, sectionLabel, segmented, seq, switchMark, text,
  when, type BotsCtx,
} from "../kit.js";
import { line as cardLine, permitStep } from "./firstRun/parts.js";
import { ARRIVAL, ARRIVAL_ANDROID, ARRIVAL_BACKGROUND_ANDROID, CAL_ADD } from "./permitWords.js";
import { screen, type BotsScreen } from "../registry.js";
import { followOn, planOn } from "../../../botsBots/planSwitch.js";
import type { ItemFollow } from "../../../botsBots/planFollow.js";
import { captureFoot, duePage, linkedPage } from "./bots/planIn.js";
import { followSection, followState, importanceField } from "./bots/planFollow.js";
import { setState } from "./bots/parts.js";

/**
 * With Plan Ease's reminders on (PLAN_V2_REMINDERS) the form has no Remind and no How long: the defaults decide (15 minutes before an
 * event, 10 am on a to-do's day, an hour long), and "remind me an hour before" said in the box still works.
 */
const defaultsDecide = (): boolean => planOn("reminders");

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
  captureId?: string;
  /** 0094 (docs: perms2 §7): "Remind me when I get there" is on, and the PHONE watches the place itself. */
  arrive?: boolean;
}
/** GET /v1/botsapp/calendar/tasks/:id (CalTask). */
export interface TaskView {
  id: string; title: string; notes: string; list: string; due: string | null; at: number | null; done: boolean; doneAt: number | null; remindMin: number | null;
  from: string | null; source: string; fixed: boolean; spaceId?: string; taskId?: string; spaceName?: string; noteId?: string; todoId?: string;
  /** A bill (step 3) and what a capture added (screens/bots/planIn.ts). */
  kind?: string; amountPaise?: number; payee?: string; payLink?: string; repeat?: string; captureId?: string;
}
/** A work meeting (step 2, GET .../plan/linked/:ref): read only, from the person's work calendar. */
type Meeting = Parameters<typeof linkedPage>[1];
/** What the details add to the item (GET .../plan/details: botsBots/planEase.ts ItemDetails). */
interface Details {
  before: Array<{ id: string; title: string; day: string | null; done: boolean }>;
  moves: Array<{ at: number; day: string; time: string; label: string }>;
  leave?: string;
  note?: { look: Parameters<typeof personBot>[1]; name: string; text: string };
  /** Follow-through (PLAN_V2_FOLLOW): Must not miss, Who, and the open follow's line. */
  follow?: ItemFollow;
  /** The armed arrival set as it would be with this item on, and the place's own name (botsBots/planEase.ts ItemDetails). */
  arrivals?: ArrivalItem[];
  arrivePlace?: string;
}
interface ItemData { event?: EventView; task?: TaskView; meeting?: Meeting; details?: Details }

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

/** Today and the next six days, and `extra` (the day it is on) when it is not among them. Also "Plan something"'s When chips. */
export function dayOptions(ctx: BotsCtx, extra?: string | null, count = 7): Array<{ label: string; value: string }> {
  const keys = Array.from({ length: count }, (_, i) => keyOf(ctx, ctx.live.now + i * DAY));
  if (extra && !keys.includes(extra)) keys.unshift(extra);
  return keys.map((k) => ({ label: dayName(ctx, k) === keyWords(k) ? `${WEEKDAYS[keyDate(k).getUTCDay()]} ${keyDate(k).getUTCDate()}` : dayName(ctx, k), value: k }));
}
const TIMES = [{ label: "9 am", value: "09:00" }, { label: "12 pm", value: "12:00" }, { label: "4 pm", value: "16:00" }, { label: "6 pm", value: "18:00" }, { label: "8 pm", value: "20:00" }];
const LENGTHS = [{ label: "30 min", value: "30" }, { label: "1 h", value: "60" }, { label: "1.5 h", value: "90" }, { label: "2 h", value: "120" }];
const REPEATS = [{ label: "Once", value: "" }, { label: "Daily", value: "daily" }, { label: "Weekdays", value: "weekdays" }, { label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" }, { label: "Yearly", value: "yearly" }];
const REMINDS = [{ label: "None", value: "" }, { label: "At the time", value: "0" }, { label: "15 min before", value: "15" }, { label: "1 h before", value: "60" }, { label: "A day before", value: "1440" }];

function eventFields(ctx: BotsCtx, o: { extraDay?: string | null; series?: boolean; add?: boolean } = {}): Node[] {
  return [
    labelledField("What", field("ttl", "ttl", "Dentist Fri 5 pm")),
    ...(o.series ? [] : [section("Day", [chips(dayOptions(ctx, o.extraDay), "day")])]),
    section("Time", [chips([{ label: "All day", value: "" }, ...TIMES], "time"), inputBox([field("time", "time", "Or type a time, like 17:30")])]),
    ...(o.add && followOn() ? [importanceField()] : []),
    ...(defaultsDecide() ? [] : [when({ truthy: "time" }, section("How long", [segmented(LENGTHS, "mins")]))]),
    labelledField("Where (if it matters)", field("place", "place", "Indiranagar, Dr. Mehta's clinic…")),
    section("Repeat", [chips(REPEATS, "repeat")]),
    ...(defaultsDecide() ? [] : [section("Remind me", [chips(REMINDS, "remind")])]),
    labelledField("Notes", field("notes", "notes", "Bring the old X-rays", { multiline: true })),
  ];
}

function taskFields(ctx: BotsCtx, o: { extraDay?: string | null; add?: boolean } = {}): Node[] {
  return [
    labelledField("To do", field("ttl", "ttl", "Pay the electricity bill by Fri")),
    section("Due", [chips([{ label: "No day", value: "" }, ...dayOptions(ctx, o.extraDay)], "day")]),
    when({ truthy: "day" }, section("Time", [chips([{ label: "Any time", value: "" }, ...TIMES], "time"), inputBox([field("ttime", "time", "Or type a time, like 17:30")])])),
    ...(o.add && followOn() ? [importanceField()] : []),
    ...(defaultsDecide() ? [] : [when({ truthy: "day" }, section("Remind me", [chips(REMINDS.filter((r) => r.value !== "15"), "tremind")]))]),
    labelledField("Notes", field("notes", "notes", "The account number is on the last bill", { multiline: true })),
  ];
}

const tz = (ctx: BotsCtx) => ctx.tzOffsetMinutes;
const eventBody = (ctx: BotsCtx, o: { day?: boolean; add?: boolean } = {}): Record<string, unknown> => ({
  title: "$state.ttl", ...(o.day === false ? {} : { day: "$state.day" }), time: "$state.time", minutes: "$state.mins", place: "$state.place", notes: "$state.notes",
  repeat: "$state.repeat", ...(defaultsDecide() ? {} : { remind: "$state.remind" }), tz: tz(ctx),
  // How important (follow-through): empty means the rules decide.
  ...(o.add && followOn() ? { importance: "$state.imp" } : {}),
});
const taskBody = (ctx: BotsCtx, o: { add?: boolean } = {}): Record<string, unknown> => ({
  title: "$state.ttl", day: "$state.day", time: "$state.time", notes: "$state.notes", ...(defaultsDecide() ? {} : { remind: "$state.tremind" }), tz: tz(ctx),
  ...(o.add && followOn() ? { importance: "$state.imp" } : {}),
});

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
    then: call("POST", `${CAL}/tasks`, taskBody(ctx, { add: true }), { ok: done("Added to your to-dos"), fail: failed("Couldn't add it. Check the day and the time.") }),
    else: call("POST", `${CAL}/events`, eventBody(ctx, { add: true }), { ok: done("On your calendar"), fail: failed("Couldn't add it. Check the day and the time.") }),
  }, "Say what it is first");
  return shell(ctx, "Add to your Plan", defaultsDecide() ? "Only you see it. Plan Ease reminds you when it's time." : "Only you see it. Plan Ease reminds you when you ask.", [
    segmented([{ label: "Event", value: "event" }, { label: "To-do", value: "task" }], "kind"),
    when({ eq: ["kind", "event"] }, col(eventFields(ctx, { extraDay: day, add: true }), { gap: 18 })),
    when({ eq: ["kind", "task"] }, col(taskFields(ctx, { extraDay: day, add: true }), { gap: 18 })),
  ], [primaryButton("Add", save, { wide: !isDesk(ctx) })], {
    kind, ttl: "", day, time: "", mins: "60", place: "", notes: "", repeat: "", remind: "15", tremind: "", imp: "",
  });
}

// ------------------------------------------------------------------ someone else's

function fromLine(x: { from: string | null; source: string; spaceName?: string }): string {
  if (!x.from) return "";
  if (x.source === "space") return x.from === "You" ? `You set this in ${x.spaceName ?? "your space"}` : `From ${x.from}${x.spaceName ? ` · in ${x.spaceName}` : ""}`;
  if (x.source === "note") return `From your meeting “${x.from}”`;
  if (x.source === "capture") return `From the ${x.from}`;
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
  remove.push(...captureFoot(ctx, e.captureId, e.from));
  const sub = [series ? `${REPEAT_WORDS[e.repeat] ?? "Repeats"} · changes apply every time` : whenLine, fromLine(e)].filter(Boolean).join(" · ");
  const lenMin = e.allDay ? 60 : Math.round((e.end - e.start) / MIN);
  return shell(ctx, e.title, sub, [...eventFields(ctx, { extraDay: e.day, series }), row(remove, { gap: 8, flexWrap: "wrap" })], [primaryButton("Save", save, { wide: !isDesk(ctx) })], {
    ttl: e.title, day: e.day, time: e.allDay ? "" : hhmm(ctx, e.start), mins: String(lenMin), place: e.place, notes: e.notes, repeat: e.repeat,
    remind: e.remindMin === null ? "" : String(e.remindMin),
  });
}

// ------------------------------------------------------------------ change a to-do

function taskPage(ctx: BotsCtx, t: TaskView, x?: Details) {
  const dueLine = t.due ? `Due ${dayName(ctx, t.due)}${t.at !== null ? `, ${clockOf(ctx, t.at)}` : ""}` : "No day";
  const base = `${CAL}/tasks/${enc(t.id)}`;
  if (t.fixed && t.spaceId && t.taskId) {
    return theirsPage(ctx, { kind: "task", title: t.title, lines: [dueLine, t.notes], spaceId: t.spaceId, taskId: t.taskId, id: t.id, from: t.from, source: t.source, spaceName: t.spaceName, done: t.done });
  }
  if (t.kind === "due") return duePage(ctx, { ...t, ...(t.repeat ? { repeat: t.repeat } : {}) }, x?.follow);
  const save = ifFilled("ttl", call("PUT", base, taskBody(ctx), { ok: done("Saved"), fail: failed() }), "Say what the to-do is first");
  const tick = call("PUT", base, { done: !t.done, tz: tz(ctx) }, { ok: done(t.done ? "Back on your list" : "Done"), fail: failed("Couldn't tick it. Try again.") });
  // Waiting on someone (step 4, botsBots/planWaits.ts): Send opens WhatsApp with the follow-up written, Sorted closes it.
  const marks = t.kind === "wait" && !t.done && planOn("waits") ? [row([
    primaryButton("Send", open(SCREENS.planSend, { item: `pt:${t.id}`, go: "send", from: "page" }), { size: "md" }),
    secondaryButton("Sorted", call("POST", "/v1/widgets/act", { item: `pt:${t.id}`, action: "sorted" }, { ok: done("Sorted"), fail: failed("Couldn't do that. Try again.") }), { size: "md", icon: "check" }),
  ], { gap: 8, flexWrap: "wrap" })] : [secondaryButton(t.done ? "Not done yet" : "Mark done", tick, { size: "md", icon: "check" })];
  return shell(ctx, t.done ? `${t.title} · done` : t.title, [dueLine, fromLine(t)].filter(Boolean).join(" · "), [
    ...marks,
    ...taskFields(ctx, { extraDay: t.due }),
    row([quietButton("Take it out", call("DELETE", base, undefined, { ok: done("Taken out"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" })], { gap: 8 }),
    ...captureFoot(ctx, t.captureId, t.from),
  ], [primaryButton("Save", save, { wide: !isDesk(ctx) })], {
    ttl: t.title, day: t.due ?? "", time: t.at !== null ? hhmm(ctx, t.at) : "", notes: t.notes, tremind: t.remindMin === null ? "" : String(t.remindMin),
  });
}

// ------------------------------------------------------------------ the details (the new Plan, design A3)

/** The details sheet is the new Plan's (PLAN_V2_PAGE, a build that draws PersonBot); an older build keeps the form, and `edit` opens it. */
const detailsOn = (ctx: BotsCtx): boolean => planOn("page") && canPersonBot(ctx) && ctx.params.edit !== "1";
const NO_DETAILS: Details = { before: [], moves: [] };
const ACT_PATH = "/v1/widgets/act";
/** One of Plan Ease's buttons through the act door, then a word and back. */
const actThen = (ctx: BotsCtx, item: string, action: string, message: string): ActionSpec =>
  call("POST", ACT_PATH, { item, action, key: `${item}:${action}:${ctx.live.now}`.slice(0, 120) }, { ok: done(message), fail: failed("Couldn't do that. Try again.") }) as ActionSpec;
/** The form, to change one thing: what tapping a line of the details opens. */
const editOf = (kind: "event" | "task", id: string): ActionSpec => open(SCREENS.planItem, { kind, id, edit: "1" });

/** A line of the details: 15/21 ink, tappable when it can be changed. */
function line(words: string, onPress?: ActionRef, o: { grey?: boolean } = {}): Node {
  const t = text(words, { size: 15, lineHeight: 21, ...(o.grey ? { color: C.meta } : {}) });
  return onPress ? labelled(row([t], { minHeight: 32, alignItems: "center" }, onPress), `${words}. Tap to change it.`) : t;
}

/** "Buy fruit costume · by Wed", each with its tick. */
function beforeLines(ctx: BotsCtx, before: Details["before"]): Node[] {
  if (!before.length) return [];
  return [col([
    sectionLabel("Before"),
    ...before.map((b) => row([
      tickBox(b.done, actThen(ctx, `pt:${b.id}`, b.done ? "undone" : "done", b.done ? "Back on your list" : "Done"), b.done ? `${b.title}. Done.` : `${b.title}. Tap when it's done.`),
      text(`${b.title}${b.day ? ` · by ${dayName(ctx, b.day) === "Today" || dayName(ctx, b.day) === "Tomorrow" ? dayName(ctx, b.day).toLowerCase() : WEEKDAYS[keyDate(b.day).getUTCDay()]}` : ""}`,
        { size: 15, lineHeight: 21, color: b.done ? C.meta : C.ink, style: { flexShrink: 1 } }),
    ], { gap: 12, alignItems: "center", minHeight: 40 })),
  ], { gap: 2 })];
}

/** Someone's note on it: their tiny bot and their words (Bricolage), in a faint message container. */
function noteLine(ctx: BotsCtx, n: Details["note"]): Node[] {
  if (!n) return [];
  return [row([personBot(ctx, n.look, { size: 22, label: n.name }), box1([messageText(ctx, `${n.name}: ${n.text}`, { lines: 3 })])], { gap: 10, alignItems: "flex-start" })];
}
const box1 = (kids: Node[]): Node => col(kids, { flexGrow: 1, flexShrink: 1, minWidth: 0, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 });

/** Where it came from: the only place the source shows. */
function sourceLine(x: { from: string | null; source: string; spaceName?: string }): string {
  if (x.source === "link") return "From your work calendar";
  return fromLine(x) || "Added by you";
}

// ------------------------------------- the phone's own calendar, and arriving (docs: perms2 §2.2, §7.2)

/** What the arrival switch and its card need, merged into the item page's own state. */
export const ITEM_PHONE_STATE = {
  arriveCard: false, arriveOn: false, arriveBlocked: false, arriveCoarse: false, locGranted: false,
  // ANDROID'S SECOND STEP (8.9.1): the card that explains the background use before the phone's location page, and the one
  // quiet line shown if they come back without it. Both stay false on an iPhone, where neither is ever drawn.
  arriveBackCard: false, arriveBackStill: false,
};

/**
 * "ADD TO MY CALENDAR": the phone's OWN event editor, opened already filled in. No permission, no card, and nothing of the
 * person's calendar is ever read — the editor runs outside the app on iOS 17+, and on Android it is the calendar app's own
 * screen. X0 Bot is told only the outcome's name.
 */
function addToCalendar(ctx: BotsCtx, e: EventView): Node[] {
  if (!canCalendarAdd(ctx)) return [];
  const notes = [e.notes, CAL_ADD.madeWith].filter(Boolean).join("\n\n");
  const editor: ActionSpec = {
    kind: "calendar.editor",
    title: e.title,
    startsAtIso: new Date(e.start).toISOString(),
    endsAtIso: new Date(e.end).toISOString(),
    ...(e.allDay ? { allDay: true } : {}),
    notes,
    onSaved: toast(CAL_ADD.saved),
    onUnavailable: toast(CAL_ADD.unavailable),
    onError: toast(CAL_ADD.error, true),
  } as unknown as ActionSpec;
  return [quietButton(CAL_ADD.button, editor, { size: "md", icon: "calendar" })];
}

/**
 * "REMIND ME WHEN I GET THERE" (docs: perms2 §7). The PHONE'S OWN system watches the place and shows the reminder; this server
 * is never told where the person is, or that they arrived, so all it keeps is the switch.
 *
 * Drawn only on a store build's phone that declares Arrival1 while PERM_ARRIVAL is on, and only for an item whose place this
 * server has already geocoded (`x.arrivals`). Switching it on with location not yet granted opens one card — Continue and
 * nothing else — and Continue is the only thing that asks. `onArmed` is what writes the switch: the server is told the phone
 * is watching, never that it has arrived.
 */
function arrivalRows(ctx: BotsCtx, e: EventView, x: Details): Node[] {
  if (!canArrival(ctx) || !x.arrivals?.length) return [];
  // THE WORDS DIFFER ON ANDROID, AND ONE STATE IS NEW. On the iPhone the SYSTEM watches the region and the app is never
  // woken, so "never in the background" is true there. On Android the geofence is delivered TO THE APP, which is background
  // location under Play's Location Permissions policy: the card has to say so, in Play's own words, BEFORE anything is
  // asked. `canArrival` has already weighed the capability, PERM_ARRIVAL and the Android switch and its list, so the ROW
  // needs no platform test — only the words and the extra step do.
  const android = ctx.platform === "android";
  const W = android ? ARRIVAL_ANDROID : ARRIVAL;
  const on = e.arrive === true;
  const base = `${CAL}/events/${enc(e.id)}`;
  // `arrive` ALONE. With `tz` in the body the event's wall-clock time is re-anchored in the phone's current offset
  // (calendar/service.ts changeEvent), so toggling this switch while travelling moved the event. Without it the row keeps
  // its own `tz_min` and the time cannot change.
  const write = (arrive: boolean): ActionRef => call("PUT", base, { arrive }, {
    ok: seq(toast(arrive ? ARRIVAL.armed.replace("{place}", x.arrivePlace ?? e.place) : "Off"), { kind: "refresh" }),
    fail: toast("Couldn't save that. Try again.", true),
  });
  const sync = (ask: boolean): ActionSpec => ({
    kind: "arrival.sync", items: x.arrivals, ...(ask ? { ask: true } : {}),
    onArmed: seq(setState("arriveCard", false), setState("arriveBackCard", false), write(true)),
    onApproximate: seq(setState("arriveCard", false), setState("arriveCoarse", true)),
    // ANDROID'S SECOND STEP, AND NOT A REFUSAL: precise location is held, "Allow all the time" is not. From Android 11 the
    // system shows no prompt for it, so the only way on is the phone's own location page — and Play wants the app to say
    // why first. Our card, then the request, which opens that page and answers when they come back. Never a bare Settings
    // button with no reason, and never a second system prompt, which the system would refuse.
    onBackground: seq(setState("arriveCard", false), setState("arriveBackCard", true)),
    onDenied: seq(setState("arriveCard", false), setState("arriveBackCard", false), toast(W.denied)),
    onBlocked: seq(setState("arriveCard", false), setState("arriveBackCard", false), setState("arriveBlocked", true)),
    onError: seq(setState("arriveCard", false), setState("arriveBackCard", false), toast("Couldn't set that up just now. Try again.", true)),
  } as unknown as ActionSpec);
  // "Allow all the time", as a REQUEST and not a bare openSettings: on API 30+ the system opens the app's own location page
  // and answers when they come back, so the switch can go on by itself if they allowed it. A refusal leaves it off and says
  // so once; there is no second card and no nagging.
  //
  // `primed`: the hand-off card below is Play's prominent disclosure, and its one button is the only way here. It
  // says "Open Settings" rather than Continue because that is where Android takes them, but it is the same shape —
  // one explanation of this exact permission, one thing to tap — so the phone's own box would be a second one.
  const askBackground: ActionSpec = {
    kind: "requestPermission", permission: "backgroundLocation", primed: true,
    onGranted: seq(setState("arriveBackCard", false), sync(false)),
    onDenied: seq(setState("arriveBackCard", false), setState("arriveBackStill", true)),
  } as unknown as ActionSpec;
  // Granted already: the phone is given the set straight away, with nothing asked. Not yet: the card, whose Continue asks.
  const turnOn: ActionRef = { kind: "condition", if: { truthy: "locGranted" }, then: sync(false), else: setState("arriveCard", true) } as ActionSpec;
  const change: ActionRef = on ? seq({ kind: "toggleState", path: "arriveOn" } as ActionSpec, write(false)) : turnOn;
  const settings = (words: string): Node => col([
    meta(words, { size: 12 }),
    button(ARRIVAL.openSettings, { kind: "openSettings", target: "app" } as ActionSpec, { kind: "secondary", size: "md" }),
  ], { gap: 6 });
  return [
    listRow({
      label: W.row, sub: on ? ARRIVAL.armed.replace("{place}", x.arrivePlace ?? e.place) : W.rowSub,
      chevron: false, right: switchMark("arriveOn"), onPress: change,
    }),
    permitStep({ when: { truthy: "arriveCard" }, title: W.title, lines: W.lines.map((l) => cardLine(l)), cta: { label: W.cta, onPress: sync(true) } }),
    // ANDROID ONLY: the hand-off card, and the one line left behind if they come back without it.
    ...(android ? [
      permitStep({
        when: { truthy: "arriveBackCard" }, title: ARRIVAL_BACKGROUND_ANDROID.title,
        lines: ARRIVAL_BACKGROUND_ANDROID.lines.map((l) => cardLine(l)),
        cta: { label: ARRIVAL_BACKGROUND_ANDROID.cta, onPress: askBackground },
      }),
      when({ truthy: "arriveBackStill" }, meta(ARRIVAL_BACKGROUND_ANDROID.still, { size: 12 })),
    ] : []),
    // Approximate Location only: the system will watch nothing useful, so the switch stays off and the line says why.
    when({ truthy: "arriveCoarse" }, settings(ARRIVAL.approximate)),
    when({ truthy: "arriveBlocked" }, settings(W.blocked)),
    // Never prompts: it only reads the answer already on record, so the card can be skipped for a phone that said yes.
    //
    // THE PERMISSION THAT ACTUALLY ARMS, WHICH IS NOT THE SAME ONE ON ANDROID. The phone's "location" check there is
    // PermissionsAndroid.check(COARSE) (device/locate.ts), which is true for anyone who ever tapped "Use my location" — so
    // the switch ran the sync with no ask, `arrivalGrants` found FINE missing and answered "denied", and the person got a
    // toast instead of the card, for ever. "backgroundLocation" is true only when FINE and background are both held
    // (device/arrival.ts arrivalBackgroundGranted), which is exactly when the sync can arm with nothing asked.
    {
      ...col([], { height: 0 }),
      on: { onAppear: { kind: "checkPermission", permission: android ? "backgroundLocation" : "location", assignTo: "locGranted" } as ActionSpec },
    },
  ];
}

function detailsShell(ctx: BotsCtx, title: string, lines: Node[], extra: Node[], buttons: Node[], state: Record<string, unknown> = {}) {
  return page(ctx, {
    back: true, ...(isDesk(ctx) ? { backTitle: "Plan Ease" } : {}), nav: "plan", title, maxWidth: 560, gap: 18, state,
    body: [
      text(title, { size: 20, weight: 600, lineHeight: 26 }),
      col(lines, { gap: 6, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
      ...extra,
    ],
    footer: [row(buttons, { gap: 10, flexWrap: "wrap" })],
  });
}

/** An event of the person's own: When, Where (with the leave-by), Before, From, Notes; [Move] [Take it out]. */
function eventDetails(ctx: BotsCtx, e: EventView, x: Details) {
  const series = !!e.repeat;
  const whenWords = e.allDay ? `${keyWords(e.day)}, all day` : `${keyWords(e.day)} · ${clockOf(ctx, e.start)} to ${clockOf(ctx, e.end)}`;
  const edit = editOf("event", e.id);
  const place = [e.place || e.where || "", x.leave ?? ""].filter(Boolean).join(" · ");
  const base = `${CAL}/events/${enc(e.id)}`;
  const takeOut = series
    ? [quietButton("Take out this day", call("DELETE", `${base}?one=1`, undefined, { ok: done("Taken out of that day"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" })]
    : [quietButton("Take it out", call("DELETE", base, undefined, { ok: done("Taken out"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" })];
  // Move: the times we picked, then "Another time" (the form). Only the person's own movable thing; a booked one is changed by its line.
  const moveTo = (m: Details["moves"][number]) => call("PUT", base, { day: m.day, time: m.time, tz: tz(ctx) }, { ok: done(`Moved to ${m.label}`), fail: failed("Couldn't move it. Try again.") });
  const moving = x.moves.length ? [when({ truthy: "moving" }, col([
    sectionLabel("Move to"),
    row([...x.moves.slice(0, 3).map((m) => secondaryButton(m.label, moveTo(m), { size: "md" })), quietButton("Another time", edit, { size: "md" })], { gap: 8, flexWrap: "wrap" }),
  ], { gap: 8 }))] : [];
  const buttons = [
    ...(x.moves.length ? [primaryButton("Move", setState("moving", true), { size: "md" })] : []),
    ...takeOut,
  ];
  return detailsShell(ctx, e.title, [
    line(series ? `${whenWords} · ${(REPEAT_WORDS[e.repeat] ?? "Repeats").toLowerCase()}` : whenWords, edit),
    ...(place ? [line(place, edit)] : []),
    line(sourceLine(e), undefined, { grey: true }),
    ...(e.notes ? [line(e.notes, edit, { grey: true })] : []),
  ], [
    ...followSection("event", e.id, x.follow), ...beforeLines(ctx, x.before), ...noteLine(ctx, x.note), ...moving,
    // The phone's own things: its event editor (no permission), and the arrival reminder its own system watches.
    ...arrivalRows(ctx, e, x),
    ...(addToCalendar(ctx, e).length ? [row(addToCalendar(ctx, e), { gap: 8, flexWrap: "wrap" })] : []),
    ...captureFoot(ctx, e.captureId, e.from),
  ], buttons, { moving: false, ...followState(x.follow), ...ITEM_PHONE_STATE, arriveOn: e.arrive === true });
}

/** A to-do of the person's own: [Done] [Later] [Take it out]. A wait: "Waiting on Rahul", [Send] [Sorted] [Take it out]. */
function taskDetails(ctx: BotsCtx, t: TaskView & { who?: string }, x: Details) {
  const edit = editOf("task", t.id);
  const item = `pt:${t.id}`;
  const dueWords = t.due ? `${keyWords(t.due)}${t.at !== null ? ` · ${clockOf(ctx, t.at)}` : ""}` : "No day yet";
  const takeOut = quietButton("Take it out", call("DELETE", `${CAL}/tasks/${enc(t.id)}`, undefined, { ok: done("Taken out"), fail: failed("Couldn't take it out. Try again.") }), { size: "md" });
  const wait = t.kind === "wait" && planOn("waits");
  const buttons = t.done
    ? [secondaryButton("Not done yet", actThen(ctx, item, "undone", "Back on your list"), { size: "md" }), takeOut]
    : wait
      ? [
        primaryButton("Send", open(SCREENS.planSend, { item, go: "send", from: "page" }), { size: "md" }),
        secondaryButton("Sorted", actThen(ctx, item, "sorted", "Sorted"), { size: "md" }),
        takeOut,
      ]
      : [
        primaryButton("Done", actThen(ctx, item, "done", "Done"), { size: "md" }),
        ...(t.due ? [secondaryButton("Later", actThen(ctx, item, "later", "I'll remind you later"), { size: "md" })] : []),
        takeOut,
      ];
  const who = wait ? t.who || t.notes.replace(/^Waiting on\s+/i, "").replace(/\.$/, "") : "";
  const ownNotes = t.notes && !(wait && /^Waiting on /i.test(t.notes)) ? t.notes : "";
  return detailsShell(ctx, t.done ? `${t.title} · done` : t.title, [
    ...(wait && who ? [line(`Waiting on ${who}`)] : []),
    line(wait && t.due ? `By ${keyWords(t.due)}` : dueWords, edit),
    line(sourceLine(t), undefined, { grey: true }),
    ...(ownNotes ? [line(ownNotes, edit, { grey: true })] : []),
  ], [...(wait ? [] : followSection("task", t.id, x.follow)), ...noteLine(ctx, x.note), ...captureFoot(ctx, t.captureId, t.from)], buttons, wait ? {} : followState(x.follow));
}

function itemPage(ctx: BotsCtx, d: ItemData | undefined) {
  const id = String(ctx.params.id ?? "");
  if (!id) return addPage(ctx);
  if (d?.meeting) return linkedPage(ctx, d.meeting);
  // The new Plan's details (a build that draws the new page): up to 6 lines and 3 buttons; tapping a line opens the form to change it.
  if (detailsOn(ctx) && d?.event && !(d.event.fixed && d.event.spaceId)) return eventDetails(ctx, d.event, d.details ?? NO_DETAILS);
  if (detailsOn(ctx) && d?.task && d.task.kind !== "due" && !(d.task.fixed && d.task.spaceId)) return taskDetails(ctx, d.task, d.details ?? NO_DETAILS);
  if (d?.event) return eventPage(ctx, d.event);
  if (d?.task) return taskPage(ctx, d.task, d.details);
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
      // A meeting from the person's work calendar (step 2): its own read, never the calendar's.
      if (/^wk-/.test(id)) return { meeting: (await deps.api<{ meeting: Meeting }>("GET", `/v1/botsapp/bots/plan/linked/${enc(id)}?tz=${ctx.tzOffsetMinutes}`)).meeting };
      const kind = ctx.params.kind === "task" ? "task" : "event";
      // The details' extras (its before steps, the leave-by, a note on it, Move's times), read beside the item; without them it still opens.
      const details = detailsOn(ctx)
        ? deps.api<Details>("GET", `/v1/botsapp/bots/plan/details?kind=${kind}&id=${enc(id)}&tz=${ctx.tzOffsetMinutes}`).catch(() => undefined)
        : Promise.resolve(undefined);
      if (kind === "task") {
        const [t, x] = await Promise.all([deps.api<{ task: TaskView }>("GET", `${CAL}/tasks/${enc(id)}`), details]);
        return { task: t.task, ...(x ? { details: x } : {}) };
      }
      const [e, x] = await Promise.all([deps.api<{ event: EventView }>("GET", `${CAL}/events/${enc(id)}?tz=${ctx.tzOffsetMinutes}`), details]);
      return { event: e.event, ...(x ? { details: x } : {}) };
    },
    build: itemPage,
  }),
];

/**
 * The old add form (bots.plan.item with no id, as before): "Plan something" (screens/bots/planMake.ts) draws it for a build that can't
 * keep its drafts (no PersonBot, a window without KitExtras, a phone without ActionParams) or with PLAN_V2_MAKE or PLAN_V2_PAGE off.
 * It reads `day` and `kind` as it always did.
 */
export const planAddForm = addPage;

/**
 * Plan's "Add" (the day it starts on; "task" for "Add a to-do"): "Plan something" (bots.plan.make), which draws the old form where it
 * must. Every Add opens it: the old week page, Today, Tasks.
 */
export const addAction = (day?: string, kind?: "event" | "task"): ActionSpec =>
  open(SCREENS.planMake, { ...(day ? { day } : {}), ...(kind === "task" ? { kind } : {}) });
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
