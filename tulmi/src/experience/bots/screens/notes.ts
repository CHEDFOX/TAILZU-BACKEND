/**
 * NOTES: meetings noted on the computer, written up, with what each one left to do (DeskNotes, DeskNote).
 *
 * Its own thing, not a part of Keylessbord: a strip under Home's grid (with its own tiny bot, who listens and scribbles on a
 * little pad), an item in the window's sidebar, and two pages, for the phone and the window alike:
 *
 *   bots.notes   the meetings, newest first; search; the week in numbers (meetings, hours, people met) and the to-dos
 *                still open across every meeting; in the window, Start notes (the note-taker's own toggle).
 *   bots.note    one meeting: the summary, what was decided, the to-dos (ticked off here, and the tick reaches every
 *                device), what was said, and the transcript.
 *
 * The phone records nothing (yet): it shows what the computer noted, through the server (routes/notes.ts). The to-dos and
 * decisions are read once per meeting, when it stops (notes/extract.ts); an older meeting's are read the first time its
 * page opens.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import type { BotTileSpec } from "../../../../../shared/types/sdui.js";
import type { Note, NoteSummary, NoteTodo } from "../../../../../shared/types/api.js";
import {
  botAvatar, botBuddy, box, button, C, call, canBuddy, col, divider, duration, emptyState, FACE, grow, icon, labelled, meta, mono,
  notice, open, page, primaryButton, quietButton, RADIUS, row, secondaryButton, sectionLabel, seq, statusMark, text, title, when, whenEq,
  PALETTE_HEX, SCREENS, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import { shareButton } from "../shareAction.js";
import { clockOf, dayLabel } from "../../../shell/feed.js";
import { notesStats, WEEK_MS, type NotesStats } from "../../../notes/stats.js";

// ===================================================================== the look

/** Notes' colour (STYLE.md: colour belongs to bots; Notes has its own tiny bot) and its icon. */
export const NOTES_LOOK = { color: PALETTE_HEX.plum!, icon: "notes" as const };
export const NOTES_STATS_PATH = "/v1/notes/stats";

/** Where Notes has a strip on Home and a sidebar item: every phone (it shows what the computer noted), a window with the note-taker. */
export const hasNotes = (ctx: BotsCtx): boolean => ctx.client === "phone" || ctx.desk.notes;

/** The line under Notes' name on Home: what it is doing, else what is waiting, else what it is for. */
export function notesLine(ctx: BotsCtx, s: NotesStats | undefined): string {
  if (s?.recording) return "Taking notes now";
  if (s?.organising) return "Writing it up";
  if (s?.openTodos) return `${s.openTodos} ${s.openTodos === 1 ? "to-do" : "to-dos"} open`;
  if (s?.week.meetings) return `${s.week.meetings} ${s.week.meetings === 1 ? "meeting" : "meetings"} this week`;
  return ctx.client === "desktop" ? "Notes from every call" : "Meetings, written up";
}

const busy = (s: NotesStats | undefined): boolean => !!s && (s.recording || s.organising > 0);

/** Home's living Notes strip (the last bot of the grid's world): his pad and pencil, busier while a meeting is being noted. */
export function notesTileSpec(ctx: BotsCtx, s: NotesStats | undefined): BotTileSpec {
  return {
    slug: "notes", name: "Notes", sub: notesLine(ctx, s), color: NOTES_LOOK.color, kind: "notes",
    state: busy(s) ? "working" : "idle", action: open(SCREENS.notes),
  };
}

/** The strip's height under the living grid. */
export const notesStripHeight = (ctx: BotsCtx): number => (ctx.client === "desktop" ? 112 : 100);

/** Home's still Notes strip, under the grid, for a build that cannot draw the living one: its mark, its name and line. */
export function notesStrip(ctx: BotsCtx, s: NotesStats | undefined): Node {
  const working = busy(s);
  const line = notesLine(ctx, s);
  return labelled(row([
    botAvatar({ color: NOTES_LOOK.color, icon: NOTES_LOOK.icon }, ctx.client === "desktop" ? 44 : 40),
    col([
      text("Notes", { size: 16, weight: 600, lineHeight: 21 }),
      text(line, { size: 13, lineHeight: 17, lines: 1, ...(working ? { weight: 500, color: NOTES_LOOK.color } : { color: C.meta }) }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(working ? [statusMark("working", { color: NOTES_LOOK.color, size: 10 })] : []),
    icon("chevron", { size: 16, color: C.meta }),
  ], {
    gap: 14, minHeight: ctx.client === "desktop" ? 84 : 76, paddingHorizontal: ctx.client === "desktop" ? 18 : 16, paddingVertical: 12,
    borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
  }, open(SCREENS.notes)), `Notes. ${line}`);
}

// ===================================================================== small parts

const minutesOf = (s: number) => Math.max(1, Math.round(s / 60));
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const firstName = (ctx: BotsCtx): string => (ctx.user?.name ?? "").trim().split(/\s+/)[0] ?? "";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A speaker's name: the one the notes could give, else the label. */
function speakerName(n: Pick<Note, "people">, label?: string): string {
  if (!label) return "Someone";
  if (label === "You") return "You";
  return n.people.find((p) => p.label === label)?.name ?? label;
}

/** Someone's initials in a circle (a meeting's speakers). */
function initials(name: string, i: number, size = 24): Node {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const look = [
    { bg: C.ink, fg: C.paper, border: undefined }, { bg: C.track, fg: C.ink, border: undefined },
    { bg: C.paper, fg: C.ink, border: C.ink }, { bg: C.grey70, fg: C.paper, border: undefined },
  ][i % 4]!;
  return box([text(letters, { size: size <= 24 ? 11 : 12, weight: 600, color: look.fg, lineHeight: 14, align: "center" })], {
    width: size, height: size, borderRadius: size / 2, backgroundColor: look.bg, alignItems: "center", justifyContent: "center", flexShrink: 0,
    ...(look.border ? { borderWidth: 1.5, borderColor: look.border } : {}),
  });
}

/** The page's grey error line, with the way to try again. */
function couldNot(what: string): Node {
  return row([
    icon("close", { size: 16, color: C.meta }),
    text(`Couldn't load ${what}.`, { size: 13, color: C.grey70, lineHeight: 18, style: { flexShrink: 1 } }),
    grow(),
    quietButton("Try again", { kind: "refresh" }, { size: "md" }),
  ], { gap: 8, paddingVertical: 4, paddingLeft: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line });
}

/** The search field, the ask bar's look. */
function searchField(path: string, placeholder: string, onSubmit: ActionRef): Node {
  return {
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: 44, color: C.ink, returnKeyType: "search",
    },
    on: { onSubmit },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
      fontSize: 14, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}

/** Notes' own tiny bot in a page's header, where the build draws one: scribbling, busier while a meeting is noted. */
function headerBot(ctx: BotsCtx, working: boolean): Node[] {
  if (!canBuddy(ctx)) return [];
  const desk = ctx.client === "desktop";
  return [botBuddy({
    kind: "notes", color: NOTES_LOOK.color, life: "page.notes", width: desk ? 150 : 76, height: desk ? 56 : 44, size: desk ? 34 : 28,
    state: working ? "working" : "idle",
  })];
}

/** One figure of the week: the number, and what it counts. */
function figure(value: string, label: string): Node {
  return col([
    text(value, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }),
    meta(label, { size: 12, lines: 1 }),
  ], { gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0, paddingVertical: 12, paddingHorizontal: 14 });
}

/** The week in numbers and the open to-dos: four figures in a card (two by two on the phone). */
function figures(ctx: BotsCtx, s: NotesStats): Node {
  const hours = s.week.seconds >= 60 ? duration(s.week.seconds / 60) : "0 min";
  const cells = [
    figure(String(s.week.meetings), s.week.meetings === 1 ? "Meeting this week" : "Meetings this week"),
    figure(hours, "In meetings"),
    figure(String(s.week.people), s.week.people === 1 ? "Person met" : "People met"),
    figure(String(s.openTodos), s.openTodos === 1 ? "To-do open" : "To-dos open"),
  ];
  const frame = { borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper };
  if (ctx.client === "desktop") {
    const kids: Node[] = [];
    cells.forEach((c, i) => { if (i) kids.push(divider({ vertical: true })); kids.push(c); });
    return row(kids, { ...frame, alignItems: "stretch" });
  }
  return col([
    row([cells[0]!, divider({ vertical: true }), cells[1]!], { alignItems: "stretch" }),
    divider(),
    row([cells[2]!, divider({ vertical: true }), cells[3]!], { alignItems: "stretch" }),
  ], frame);
}

// ===================================================================== the meetings

interface NotesData { notes: NoteSummary[] }

function notesLoad(_ctx: BotsCtx, deps: { api<T>(m: "GET", p: string): Promise<T> }) {
  return deps.api<NotesData>("GET", "/v1/notes?limit=100");
}

/** What a meeting left: "4 to-dos, 3 decisions", "2 to-dos open". Empty before it was looked at, or when it left nothing. */
function leftLine(n: NoteSummary): string {
  const bits: string[] = [];
  if (n.todos) bits.push(n.openTodos ? `${plural(n.openTodos, "to-do")} open` : `${plural(n.todos, "to-do")} done`);
  if (n.decisions) bits.push(plural(n.decisions, "decision"));
  return bits.join(", ");
}

function notesPage(ctx: BotsCtx, d: NotesData | undefined) {
  const tz = ctx.tzOffsetMinutes;
  const desk = ctx.client === "desktop";
  const q = String(ctx.params.q ?? "").trim().toLowerCase();
  const onlyOpen = ctx.params.f === "todos";
  const every = d?.notes ?? [];
  const s = notesStats(every, ctx.live.now);
  const all = every
    .filter((n) => !q || `${n.title} ${n.summary} ${n.people.map((p) => p.name ?? "").join(" ")}`.toLowerCase().includes(q))
    .filter((n) => !onlyOpen || (n.openTodos ?? 0) > 0);
  const weekStart = ctx.live.now - WEEK_MS;
  const color = NOTES_LOOK.color;
  const status = (n: NoteSummary): Node => n.status === "recording" ? text("Recording now", { size: 13, weight: 500, color, lineHeight: 17 })
    : n.status === "organising" ? text("Writing it up", { size: 13, lineHeight: 17 })
      : n.status === "failed" ? text("Couldn't write it up", { size: 13, lineHeight: 17 })
        : n.openTodos ? text(`${plural(n.openTodos, "to-do")} open`, { size: 13, weight: 600, lineHeight: 17 }) : text("Summary ready", { size: 13, lineHeight: 17 });
  const mark = (n: NoteSummary): Node => n.status === "recording" ? statusMark("working", { color })
    : n.status === "organising" ? statusMark("waiting") : n.status === "failed" ? statusMark("failed")
      : n.openTodos ? statusMark("needs") : statusMark("done");
  const people = (n: NoteSummary): Node => row([
    row(n.people.slice(0, 3).map((p, i) => initials(p.name ?? p.label, i)), { gap: 3 }),
    text(n.people.length ? plural(n.people.length, "speaker") : "—", { size: 13, color: C.grey70, lineHeight: 17 }),
  ], { gap: 8 });
  const line = (n: NoteSummary): Node => {
    const at = Date.parse(n.startedAt);
    const day = dayLabel(at, ctx.live.now, tz);
    const when = n.status === "recording" ? `Started ${clockOf(at, tz)}` : day === "Today" ? clockOf(at, tz) : `${day} · ${clockOf(at, tz)}`;
    const left = leftLine(n);
    const sub = [when, left || (n.summary ? n.summary.split(/(?<=[.!?])\s/)[0]!.slice(0, 70) : "")].filter(Boolean).join(" · ");
    const len = n.status === "recording" ? `${minutesOf(n.durationSeconds)} min so far` : `${minutesOf(n.durationSeconds)} min`;
    const name = text(n.title || (n.status === "recording" ? "Taking notes…" : "Untitled meeting"), { size: 14, weight: 600, lineHeight: 19, lines: 1 });
    if (!desk) {
      return row([mark(n), col([name, meta(`${sub} · ${len}`, { lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 })],
        { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }, open(SCREENS.note, { id: n.id }));
    }
    return row([
      box([mark(n)], { width: 16 }),
      col([name, meta(sub, { lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }),
      box([text(len, { size: 13, color: C.grey70, lineHeight: 17 })], { width: 110 }),
      box([people(n)], { width: 170 }),
      box([status(n)], { width: 130, alignItems: "flex-end" }),
    ], { gap: 14, paddingVertical: 12, paddingHorizontal: 16 }, open(SCREENS.note, { id: n.id }));
  };
  const groups: Array<{ label: string; notes: NoteSummary[] }> = [];
  for (const n of all) {
    const at = Date.parse(n.startedAt);
    const label = dayLabel(at, ctx.live.now, tz) === "Today" ? "Today" : at >= weekStart ? "This week" : "Earlier";
    const g = groups.find((x) => x.label === label);
    if (g) g.notes.push(n); else groups.push({ label, notes: [n] });
  }
  const tableOf = (ns: NoteSummary[]) => {
    const kids: Node[] = [];
    ns.forEach((n, i) => { if (i) kids.push(divider()); kids.push(line(n)); });
    return col(kids, { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" });
  };
  const header = desk ? row([
    box([], { width: 16 }), box([sectionLabel("Meeting")], { flexGrow: 1, flexBasis: 0 }), box([sectionLabel("Length")], { width: 110 }),
    box([sectionLabel("Speakers")], { width: 170 }), box([sectionLabel("Status")], { width: 130, alignItems: "flex-end" }),
  ], { gap: 14, paddingHorizontal: 16 }) : null;
  const to = (params: Record<string, string>): ActionSpec => ({ kind: "navigate", screenId: SCREENS.notes, params, replace: true } as ActionSpec);
  const keep = (p: Record<string, string>) => ({ ...(q ? { q } : {}), ...(onlyOpen ? { f: "todos" } : {}), ...p });
  const search = row([
    icon("search", { size: 18, color: C.meta }),
    searchField("nq", desk ? "Search meetings, people or something someone said…" : "Search meetings or people", to({ q: "$state.nq", ...(onlyOpen ? { f: "todos" } : {}) })),
    ...(q ? [labelled(box([icon("close", { size: 16 })], { width: 36, height: 36, alignItems: "center", justifyContent: "center" }, to(onlyOpen ? { f: "todos" } : {})), "Clear search")] : []),
  ], { gap: 10, height: 46, borderRadius: 23, borderWidth: 1, borderColor: C.line, paddingLeft: 16, paddingRight: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 });
  const chip = (label: string, on: boolean, go: ActionSpec): Node => row([text(label, { size: 13, weight: on ? 500 : 400, color: on ? C.paper : C.ink, lineHeight: 17 })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: on ? C.ink : C.line, backgroundColor: on ? C.ink : C.paper, flexShrink: 0,
  }, on ? undefined : go);
  const chips = row([
    chip("All", !onlyOpen, to(keep({ f: "" }))),
    chip(s.openTodos ? `Open to-dos · ${s.openTodos}` : "Open to-dos", onlyOpen, to(keep({ f: "todos" }))),
  ], { gap: 8 });
  const weekLine = `This week · ${plural(s.week.meetings, "meeting")}${s.week.seconds >= 60 ? ` · ${duration(s.week.seconds / 60)}` : ""}`;
  const start = s.recording
    ? button("Stop notes", { kind: "notes.toggle" }, { kind: "secondary", icon: "stop" })
    : button("Start notes", { kind: "notes.toggle" }, { kind: "primary", icon: "mic" });
  const empty = emptyState({
    pose: q || onlyOpen ? "think" : "listen",
    title: q ? `No meetings about “${q}”` : onlyOpen ? "No to-dos open" : "No meetings yet",
    body: q ? "Try another word or a name." : onlyOpen ? "Every to-do from your meetings is ticked off."
      : desk ? "Press Start notes when a call starts. X0 Bot writes it up, with the to-dos, when you stop."
        : "Take notes from X0 Bot on your computer. Each meeting, its to-dos and decisions show up here.",
    ...(desk && !q && !onlyOpen ? { action: { label: "Start notes", onPress: { kind: "notes.toggle" } as ActionSpec } } : {}),
  });
  return page(ctx, {
    ...(desk ? { nav: "notes" } : { back: true }), title: "Notes", gap: 18, maxWidth: 1000, state: { nq: q }, live: ["notes"],
    body: [
      row([
        col([title("Notes"), meta(weekLine, { size: 13 })], { gap: 4, flexShrink: 1, flexGrow: 1, minWidth: 0 }),
        ...headerBot(ctx, s.recording || s.organising > 0),
        ...(desk ? [start] : []),
      ], { gap: 16, alignItems: "flex-end" }),
      ...(d && every.length ? [figures(ctx, s)] : []),
      desk ? row([search, chips], { gap: 12 }) : col([search, chips], { gap: 10 }),
      ...(!d ? [couldNot("your meetings")]
        : !all.length ? [empty]
          : groups.map((g, i) => col([sectionLabel(g.label), ...(i === 0 && header ? [header] : []), tableOf(g.notes)], { gap: 8 }))),
      ...(d && all.length ? [meta("Tell everyone on a call that you're taking notes.")] : []),
    ],
  });
}

// ===================================================================== one meeting

/** `inTasks`: the to-dos already on the person's own list (GET /v1/botsapp/calendar/notes/:id), by to-do id. */
interface NoteData { note: Note; finding: boolean; inTasks?: Record<string, { id: string; done: boolean }> }

async function noteLoad(ctx: BotsCtx, deps: { api<T>(m: "GET" | "POST", p: string, body?: unknown): Promise<T> }): Promise<NoteData> {
  const id = encodeURIComponent(String(ctx.params.id ?? ""));
  const r = await deps.api<{ note: Note; finding?: boolean }>("GET", `/v1/notes/${id}`);
  let finding = r.finding === true;
  // A finished meeting whose to-dos were never read (an older one, or a read that failed): read them now, once.
  if (!finding && r.note.status !== "recording" && !r.note.found?.ok && r.note.transcript.some((t) => t.text.trim())) {
    finding = (await deps.api<{ finding: boolean }>("POST", `/v1/notes/${id}/find`).catch(() => ({ finding: false }))).finding;
  }
  const inTasks = r.note.todos?.length ? await deps.api<{ todos: NoteData["inTasks"] }>("GET", `${CAL_NOTES}/${id}`).then((x) => x.todos).catch(() => undefined) : undefined;
  return { note: r.note, finding, ...(inTasks ? { inTasks } : {}) };
}

/** A to-do's tick: the state path its row reads, so a tap shows at once. */
const tickPath = (t: NoteTodo) => `td_${t.id.replace(/[^A-Za-z0-9_]/g, "")}`;
/** The person's own to-dos made from a meeting's (routes/botsCalendar.ts). */
const CAL_NOTES = "/v1/botsapp/calendar/notes";

/** "Add to my tasks": the to-do on the person's own list (once); "In your tasks" when it is. Beside the row, never inside it. */
function toMyTasks(ctx: BotsCtx, n: Note, t: NoteTodo, inTasks: NoteData["inTasks"]): Node {
  const desk = ctx.client === "desktop";
  if (inTasks?.[t.id]) return row([icon("check", { size: 14, color: C.meta }), meta("In your tasks", { size: 12, lines: 1 })], { gap: 4, flexShrink: 0, paddingRight: 14 });
  const add = call("POST", `${CAL_NOTES}/${encodeURIComponent(n.id)}/${encodeURIComponent(t.id)}`, { tz: ctx.tzOffsetMinutes }, {
    ok: seq({ kind: "toast", message: "Added to your to-dos" }, { kind: "refresh" }), fail: { kind: "toast", message: "Couldn't add it. Try again.", tone: "error" },
  });
  return labelled(row([icon("plus", { size: 14 }), text(desk ? "Add to my tasks" : "My tasks", { size: 12.5, weight: 500, lineHeight: 16, lines: 1 })], {
    gap: 4, flexShrink: 0, minHeight: 34, paddingHorizontal: 10, marginRight: 10, borderRadius: 17, borderWidth: 1, borderColor: C.outline,
  }, add), "Add to my tasks");
}

function todoRows(ctx: BotsCtx, n: Note, inTasks?: NoteData["inTasks"]): Node {
  const desk = ctx.client === "desktop", tz = ctx.tzOffsetMinutes;
  const labels = [...new Set([...n.people.map((p) => p.label), ...n.transcript.map((t) => t.speaker ?? "")].filter(Boolean))];
  const kids: Node[] = [];
  (n.todos ?? []).forEach((t, i) => {
    const path = tickPath(t);
    const whoShown = t.who ? (labels.includes(t.who) ? speakerName(n, t.who) : t.who) : "";
    const doneWhen = t.doneAt ? (dayLabel(Date.parse(t.doneAt), ctx.live.now, tz) === "Today" ? `Done at ${clockOf(Date.parse(t.doneAt), tz)}` : `Done ${dayLabel(Date.parse(t.doneAt), ctx.live.now, tz)}`) : "Done";
    const dueLine = t.when ? t.when.charAt(0).toUpperCase() + t.when.slice(1) : "";
    const tick = box([
      when({ truthy: path }, box([icon("check", { size: 13, color: C.paper, weight: 2.4 })], { width: 22, height: 22, borderRadius: 11, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" })),
      when({ falsy: path }, box([], { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.outline })),
    ], { width: 22, height: 22, flexShrink: 0 });
    const words = text(t.text, { size: 14, lineHeight: 19, style: { color: whenEq(path, true, C.meta, C.ink) } });
    const subPhone = [whoShown, t.done ? doneWhen : dueLine].filter(Boolean).join(" · ");
    const press = seq(
      { kind: "toggleState", path },
      call("POST", `/v1/notes/${encodeURIComponent(n.id)}/todos/${encodeURIComponent(t.id)}`, { done: `$state.${path}` }, {
        // On the person's own list too: that one is ticked with it.
        ...(inTasks?.[t.id] ? { ok: call("PUT", `${CAL_NOTES}/${encodeURIComponent(n.id)}/${encodeURIComponent(t.id)}`, { done: `$state.${path}` }) } : {}),
        fail: seq({ kind: "toggleState", path }, { kind: "toast", message: "Couldn't save that. Try again.", tone: "error" }),
      }),
    );
    if (i) kids.push(divider());
    kids.push(row([labelled(row([
      tick,
      col([words, ...(!desk && subPhone ? [meta(subPhone, { lines: 1 })] : [])], { gap: 2, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }),
      ...(desk ? [row([
        ...(whoShown ? [initials(whoShown === "You" ? ctx.user?.name ?? "You" : whoShown, Math.max(0, labels.indexOf(t.who ?? "")), 28)] : []),
        col([
          text(whoShown || "Nobody yet", { size: 13, weight: whoShown ? 600 : 400, color: whoShown ? C.ink : C.meta, lineHeight: 17, lines: 1 }),
          ...(t.done ? [meta(doneWhen, { lines: 1 })] : dueLine ? [meta(dueLine, { lines: 1 })] : []),
        ], { gap: 1, flexShrink: 1, minWidth: 0 }),
      ], { gap: 8, width: 190, flexShrink: 0 })] : []),
    ], { gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 10, minHeight: 52, flexGrow: 1, flexShrink: 1, minWidth: 0 }, press), t.done ? `${t.text}. Done. Tap to open it again.` : `${t.text}. Tap when it's done.`),
      toMyTasks(ctx, n, t, inTasks)], { alignItems: "center" }));
  });
  return col(kids, { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper });
}

function notePage(ctx: BotsCtx, d: NoteData | undefined) {
  const desk = ctx.client === "desktop";
  const backTo = row([icon("back", { size: 22, color: C.grey70 }), text("Notes", { size: 14, color: C.grey70, lineHeight: 18 })], { gap: 2, minHeight: 44, alignSelf: "flex-start" }, open(SCREENS.notes));
  const n = d?.note;
  if (!n) {
    return page(ctx, { ...(desk ? { nav: "notes" } : { back: true }), title: "Notes", body: [...(desk ? [backTo] : []), emptyState({ pose: "think", title: "Couldn't open this meeting", body: "It may have been deleted.", action: { label: "All meetings", onPress: open(SCREENS.notes) } })] });
  }
  const tz = ctx.tzOffsetMinutes;
  const at = Date.parse(n.startedAt);
  const speakers = n.people.length;
  const metaLine = [`${dayLabel(at, ctx.live.now, tz)}, ${clockOf(at, tz)}`, `${minutesOf(n.durationSeconds)} min`, ...(speakers ? [plural(speakers, "speaker")] : []), "recorded on your computer"].join(" · ");
  const labels = [...new Set([...n.people.map((p) => p.label), ...n.transcript.map((t) => t.speaker ?? "")].filter(Boolean))];
  const who = (label?: string) => Math.max(0, labels.indexOf(label ?? ""));
  const todos = n.todos ?? [];
  const decisions = n.decisions ?? [];
  const open_ = todos.filter((t) => !t.done).length;
  const whoOf = (t: NoteTodo) => (t.who ? (labels.includes(t.who) ? speakerName(n, t.who) : t.who) : "");
  const copy = [
    n.title, "", n.summary,
    ...(decisions.length ? ["", "Decisions:", ...decisions.map((x) => `- ${x}`)] : []),
    ...(todos.length ? ["", "To-dos:", ...todos.map((t) => `- [${t.done ? "x" : " "}] ${t.text}${[whoOf(t), t.when].filter(Boolean).length ? ` (${[whoOf(t), t.when].filter(Boolean).join(", ")})` : ""}`)] : []),
    ...(n.highlights.length ? ["", ...n.highlights.map((h) => `${speakerName(n, h.speaker)}: ${h.text}`)] : []),
  ].join("\n").trim();
  const status = n.status === "recording" ? [notice("Still recording. The notes and to-dos are written when you stop.", { mark: "mic" })]
    : n.status === "organising" ? [notice("Writing it up. This takes a minute.")]
      : n.status === "failed" ? [notice("Couldn't write this one up. The transcript is kept.")] : [];
  const lines = n.transcript.slice(0, 80);
  const transcript = col([
    row([sectionLabel("Transcript"), grow(), meta(plural(n.transcript.length, "line"))], { gap: 8, paddingHorizontal: 2 }),
    ...(lines.length ? lines.map((t) => {
      const i = who(t.speaker);
      const name = speakerName(n, t.speaker);
      return row([
        initials(name === "You" ? ctx.user?.name ?? name : name, i, 26),
        col([row([text(name === "You" && ctx.user?.name ? `${firstName(ctx)} (you)` : name, { size: 13, weight: 600, lineHeight: 17 }), meta(mmss(t.at), { size: 11.5 })], { gap: 8 }), text(t.text, { size: 14, lineHeight: 20 })], { gap: 3, flexShrink: 1 }),
      ], {
        gap: 10, alignItems: "flex-start", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
        ...(i % 2 === 0 ? { backgroundColor: C.surface } : { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line }),
      });
    }) : [meta("Nothing was heard.")]),
    ...(n.transcript.length > lines.length ? [meta(`And ${n.transcript.length - lines.length} more lines`)] : []),
  ], { gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line });
  // What the meeting left: its decisions, numbered, and its to-dos, ticked off here.
  const finished = n.status !== "recording";
  const finding = d.finding && !n.found?.ok;
  const left: Node[] = !finished ? [] : finding && !todos.length && !decisions.length
    ? [row([statusMark("working", { color: NOTES_LOOK.color }), meta("Finding the to-dos and decisions…", { size: 13 })], { gap: 8 })]
    : [
      ...(decisions.length ? [col([
        sectionLabel(`Decisions · ${decisions.length}`),
        ...decisions.map((x, i) => row([mono(String(i + 1).padStart(2, "0"), { boxed: false, size: 12, color: C.meta }), text(x, { size: 14, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 12, alignItems: "flex-start" })),
      ], { gap: 10 })] : []),
      ...(todos.length ? [col([
        row([sectionLabel(`To-dos · ${todos.length}`), grow(), meta(open_ ? `${open_} open` : "All done", { size: 12 })], { gap: 8 }),
        todoRows(ctx, n, d.inTasks),
      ], { gap: 10 })] : []),
      ...(n.found?.ok && !todos.length && !decisions.length ? [meta("No to-dos or decisions in this one.", { size: 13 })] : []),
    ];
  const said = n.highlights.length ? [col([
    sectionLabel(`What was said · ${n.highlights.length}`),
    ...n.highlights.map((h, i) => row([meta(String(i + 1).padStart(2, "0"), { size: 12 }), col([text(h.text, { size: 14, lineHeight: 20 }), meta(speakerName(n, h.speaker))], { gap: 2, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" })),
  ], { gap: 10 })] : [];
  const leftCol = col([
    ...status,
    col([sectionLabel("Summary"), text(n.summary || "No summary yet.", { size: 15, lineHeight: 23 })], { gap: 8 }),
    ...left,
    ...said,
  ], { gap: 20, ...(desk ? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 } : {}) });
  const ask = open(SCREENS.ask, { message: `About my meeting “${n.title}”: ` });
  const actions = [secondaryButton("Copy notes", desk ? { kind: "copyText", text: copy, message: "Notes copied" } : { kind: "copyToClipboard", text: copy, toastMessage: "Notes copied" }, { size: desk ? "lg" : "md" }), shareButton({ kind: "note", ref: n.id, title: n.title, text: copy }, { size: desk ? "lg" : "md" }), primaryButton("Ask a bot about it", ask, { size: desk ? "lg" : "md" })];
  const state = Object.fromEntries(todos.map((t) => [tickPath(t), t.done]));
  return page(ctx, {
    ...(desk ? { nav: "notes" } : { back: true, backTitle: "Notes" }), title: n.title || "Notes", gap: desk ? 14 : 18, maxWidth: 1100, state,
    live: [`note:${n.id}`],
    body: [
      ...(desk ? [backTo] : []),
      row([
        col([title(n.title || "Untitled meeting"), meta(metaLine, { size: 13 })], { gap: 6, flexShrink: 1, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        ...(desk ? [row(actions, { gap: 10 })] : []),
      ], { gap: 16, alignItems: "flex-end" }),
      ...(desk ? [row([leftCol, box([transcript], { flexGrow: 0.92, flexShrink: 1, flexBasis: 0, minWidth: 0 })], { gap: 28, alignItems: "flex-start" })] : [leftCol, row(actions, { gap: 10, flexWrap: "wrap" }), transcript]),
    ],
  });
}

// ===================================================================== the list

export const notesScreens: BotsScreen[] = [
  screen<NotesData>({ id: SCREENS.notes, load: notesLoad, build: notesPage }),
  screen<NoteData>({ id: SCREENS.note, load: noteLoad, build: notePage }),
];
