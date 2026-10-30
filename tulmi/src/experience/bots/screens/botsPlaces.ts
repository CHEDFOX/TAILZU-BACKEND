/**
 * THE PLAN AND TRAVEL BOTS' OUTSIDE DATA, DRAWN: travel times on tomorrow's timeline (PlanBot "Leave by 6:55 pm · 35 min to
 * Koramangala", DPlanBot's "Leave 6:55" block and "Tomorrow, sorted"), a heads-up for rain or heat on an outdoor stop, where the day
 * starts; and on a trip (TravelBot, DTravelBot) the weather on its days, its main places, and its stays side by side ("Stay · 2 options",
 * the window's table, "Trip plan").
 *
 * Builders only: screens/bots.ts calls these from bots.plan and bots.travel. Data is what GET /v1/botsapp/bots/plan (its `travel`) and
 * GET /v1/botsapp/bots/trip/:id/extras answer (routes/botsTrips.ts, src/botsBots/planTravel.ts, tripExtras.ts); a missing part draws
 * nothing, never a made-up number. Colour stays with the bots: Plan Ease's ochre on its leave-by lines, the Travel bot's sea on its pick.
 * Nothing here books or pays: a stay opens its own site, "you book and pay there".
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  botLook, box, button, C, call, card, chip, col, divider, FACE, grid, grow, icon, listCard, listRow, meta, notice, roundButton, row, sectionLabel,
  seq, statusMark, text, when, type BotsCtx,
} from "../kit.js";

const A = "/v1/botsapp/bots";
const MIN = 60_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const enc = encodeURIComponent;

// ===================================================================== what the screens read

export interface PlanLegView { fromId: string; toId: string; to: string; mode: "walk" | "drive"; minutes: number; leaveBy: number; gapMin: number | null; tight: boolean }
export interface CreditView { text: string; url: string }
export interface PlanTravelView {
  on: boolean; pending: boolean; home: string; homeFound: boolean; legs: PlanLegView[];
  headsUp: Array<{ eventId: string; kind: "rain" | "storm" | "heat"; text: string }>; savedWeekMin: number; credits: CreditView[];
}

export interface StayView {
  id: string; name: string; area: string; url: string; host: string; nightPaise: number | null; rating: number | null; ratingOf: 5 | 10 | null;
  reviews: number | null; by: "you" | "chat" | "web"; picked: boolean;
  label: "Your pick" | "Travel bot's pick" | "Closer" | "Better rated" | ""; minutes: number | null; mode: "walk" | "drive" | null;
  totalPaise: number | null; stars: number | null;
}
export type Sky = "clear" | "cloudy" | "rain" | "storm" | "snow";
export interface TripExtrasView {
  dates: { from: string; to: string; nights: number } | null;
  where: string | null;
  weather: { days: Array<{ key: string; hiC: number; loC: number; sky: Sky; rainMm: number }>; line: string; sub: string; pack: string | null; more: string | null } | null;
  weatherNote: string | null;
  spots: Array<{ text: string; found: boolean | null }>;
  main: string | null;
  stays: StayView[];
  finding: boolean;
  searched: "found" | "none" | "limit" | "failed" | null;
  canFind: boolean;
  canMeasure: boolean;
  pending: boolean;
  credits: CreditView[];
}
interface TripLite { id: string; place: string; when: string; packing: Array<{ text: string; done: boolean }>; spots?: string[] }
interface Opened { label: string; url: string; at: number; said: string }

/** The trip screen's own state (forms), to merge into its page state. */
export const TRIP_STATE = { s_open: false, s_name: "", s_url: "", s_area: "", spot: "" };
/** The plan screen's own state. */
export const PLAN_STATE = { home_edit: false, home: "" };

// ===================================================================== small parts

const refresh: ActionSpec = { kind: "refresh" };
const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const ifFilled = (path: string, then: ActionRef, empty: string): ActionSpec => ({ kind: "condition", if: { falsy: path }, then: toast(empty), else: then });
const write = (method: "POST" | "PUT" | "DELETE", path: string, body?: Record<string, unknown>, ok?: string, then?: ActionRef): ActionRef =>
  call(method, path, body, { ok: seq(ok ? toast(ok) : undefined, then, refresh), fail: toast("Couldn't do that. Try again.", true) });
const openUrl = (url: string): ActionSpec => ({ kind: "openUrl", url, handoff: true });

const local = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * MIN);
/** "6:55 pm". */
export function clockAt(ctx: BotsCtx, ms: number): string {
  const d = local(ctx, ms);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const keyDate = (k: string) => new Date(`${k}T00:00:00Z`);
const dayWords = (k: string) => { const d = keyDate(k); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** A field the kit's way (no frame of its own; put it in `inputBox`). */
function field(id: string, path: string, placeholder: string, o: { onSubmit?: ActionRef; keyboard?: "url" | "numeric" } = {}): Node {
  return {
    type: "TextField", id, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: 44, color: C.ink, returnKeyType: o.onSubmit ? "send" : "done", ...(o.keyboard === "url" ? { autoCapitalize: "none", autoCorrect: false } : {}),
    },
    ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
      fontSize: 15, lineHeight: 22, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}
const inputBox = (children: Node[]): Node => row(children, {
  gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 4, minHeight: 48, backgroundColor: C.paper,
});

/** The weather as a line glyph (24 viewBox, the kit's stroke). */
const SKY_PATH: Record<Sky | "heat", string> = {
  clear: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  heat: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  cloudy: "M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.3 4.6 4.6 0 0 0 7 18.5z",
  rain: "M7 15h10.5a3.6 3.6 0 0 0 .4-7.18A5.6 5.6 0 0 0 6.6 6.6 4.2 4.2 0 0 0 7 15zM8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5",
  storm: "M7 14h10.5a3.6 3.6 0 0 0 .4-7.18A5.6 5.6 0 0 0 6.6 5.6 4.2 4.2 0 0 0 7 14zM12.5 15.5l-2 3.5h3l-2 3.5",
  snow: "M7 15h10.5a3.6 3.6 0 0 0 .4-7.18A5.6 5.6 0 0 0 6.6 6.6 4.2 4.2 0 0 0 7 15zM9 19h.01M12 20.5h.01M15 19h.01",
};
export function skyGlyph(kind: Sky | "heat", size = 22, color: string = C.ink): Node {
  return {
    type: "SVG",
    props: { viewBox: "0 0 24 24", d: SKY_PATH[kind], fill: "none", stroke: color, strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", accessibilityLabel: kind === "heat" ? "hot" : kind },
    style: { width: size, height: size, flexShrink: 0 },
  };
}

/** A line of credits for the providers whose data the part shows; a tap opens the map data's licence page. */
function creditLine(credits: CreditView[]): Node | null {
  if (!credits.length) return null;
  return row([text(credits.map((c) => c.text).join(" · "), { size: 11, color: C.idle, lineHeight: 15, style: { flexShrink: 1 } })], { minHeight: 24 }, openUrl(credits[0]!.url));
}

// ===================================================================== Plan Ease

const PLAN = () => botLook("plan").color;

/** "Leave by 6:55 pm · 35 min to Koramangala", "Only 15 min to get there · 35 min to Koramangala". */
export function legWords(ctx: BotsCtx, leg: PlanLegView): string {
  const how = leg.mode === "walk" ? `${leg.minutes} min walk to ${leg.to}` : `${leg.minutes} min to ${leg.to}`;
  if (leg.tight) return leg.gapMin !== null && leg.gapMin > 0 ? `Only ${leg.gapMin} min to get there · ${how}` : `No time to get there · ${how}`;
  return `Leave ${leg.fromId === "home" ? "home " : ""}by ${clockAt(ctx, leg.leaveBy)} · ${how}`;
}

const spacer = (h?: number): Node[] => [box([], { width: 54 }), box([], { width: 1.5, alignSelf: "stretch", backgroundColor: C.track, ...(h ? { height: h } : {}) })];

/** The rows that go just before an event on the timeline: the trip to it. */
export function legRowsTo(ctx: BotsCtx, t: PlanTravelView | undefined, eventId: string): Node[] {
  const leg = t?.legs.find((l) => l.toId === eventId);
  if (!leg) return [];
  return [row([
    ...spacer(26),
    ...(leg.tight ? [statusMark("needs", { size: 8 })] : []),
    text(legWords(ctx, leg), { size: 12, weight: leg.tight ? 600 : 500, color: leg.tight ? C.ink : PLAN(), lineHeight: 16, style: { flexShrink: 1 } }),
  ], { gap: 10, minHeight: 26, alignItems: "center" })];
}

/** The rows that go just after an event: rain or heat there. */
export function headsUpRows(_ctx: BotsCtx, t: PlanTravelView | undefined, eventId: string): Node[] {
  return (t?.headsUp ?? []).filter((h) => h.eventId === eventId).map((h) => row([
    ...spacer(26),
    skyGlyph(h.kind === "heat" ? "heat" : h.kind, 16, C.meta),
    meta(h.text, { size: 12, style: { flexShrink: 1 } }),
  ], { gap: 10, minHeight: 26, alignItems: "center" }));
}

/** Has a trip into this event (the timeline then needs no "Free" row of its own before it). */
export const hasLegTo = (t: PlanTravelView | undefined, eventId: string): boolean => !!t?.legs.some((l) => l.toId === eventId);

/** "40 min saved" for the head line, when moves said yes to saved travel this week. */
export const savedWords = (t: PlanTravelView | undefined): string | null => (t && t.savedWeekMin > 0 ? `${t.savedWeekMin} min saved` : null);

/** For the window's week: a "Leave 6:55" block before each of tomorrow's trips, as a pseudo-event the column lays out with the rest. */
export function leaveBlocks(ctx: BotsCtx, t: PlanTravelView | undefined, events: Array<{ id: string; start: number }>): Array<{ id: string; title: string; start: number; end: number; allDay: false; people: 0; where?: string }> {
  return (t?.legs ?? []).flatMap((l) => {
    const to = events.find((e) => e.id === l.toId);
    if (!to) return [];
    const c = clockAt(ctx, l.leaveBy).replace(/ [ap]m$/, "");
    return [{ id: `leave:${l.toId}`, title: l.tight ? `Tight · ${l.minutes} min` : `Leave ${c}`, start: l.leaveBy, end: to.start, allDay: false as const, people: 0 as const }];
  });
}
/** The style a leave block takes in the week column (Plan Ease's ochre, dashed). */
export const leaveStyle = (): Record<string, unknown> => ({ backgroundColor: C.paper, borderWidth: 1.5, borderColor: PLAN(), borderStyle: "dashed" });
export const isLeave = (id: string): boolean => id.startsWith("leave:");

/** "Tomorrow, sorted" in the window: the trips first. */
export function legListRows(ctx: BotsCtx, t: PlanTravelView | undefined): Node[] {
  return (t?.legs ?? []).map((l) => listRow({
    label: l.tight ? `Tight: ${l.gapMin !== null && l.gapMin > 0 ? `${l.gapMin} min` : "no time"} to get to ${l.to}` : `Leave ${l.fromId === "home" ? "home " : ""}by ${clockAt(ctx, l.leaveBy)}`,
    sub: `${l.minutes} min ${l.mode === "walk" ? "walk" : "by car, about"} to ${l.to}`,
    left: statusMark(l.tight ? "needs" : "done"),
  }));
}

/** Where the day starts: asked once (so the first trip and the minutes saved can count from home), then a quiet line to change it. */
export function homePart(_ctx: BotsCtx, t: PlanTravelView | undefined): Node[] {
  if (!t?.on) return [];
  const save = ifFilled("home", write("PUT", `${A}/plan/home`, { home: "$state.home" }, "Saved", setState("home_edit", false)), "Write where your day starts");
  const form = col([
    inputBox([field("plan-home", "home", "Your area, like HSR Layout", { onSubmit: save }), roundButton("check", save, { size: 36, label: "Save", light: true })]),
  ], { gap: 8 });
  if (!t.home) {
    return [card([
      text("Where does your day start?", { size: 15, weight: 600, lineHeight: 20 }),
      meta("Plan Ease then times the trip to your first stop, and counts the travel a change saves you. Only your area, not your address.", { size: 13 }),
      form,
    ], { dashed: true, gap: 10 })];
  }
  return [col([
    row([
      icon("pin", { size: 16, color: C.meta }),
      meta(t.homeFound ? `Your day starts from ${t.home}` : `Couldn't find ${t.home} on the map`, { size: 12, style: { flexShrink: 1 } }),
      grow(),
      row([text("Change", { size: 12, weight: 500, lineHeight: 16 })], { minHeight: 32, paddingHorizontal: 4, alignItems: "center" }, seq(setState("home", t.home), setState("home_edit", true))),
    ], { gap: 8, alignItems: "center" }),
    when({ truthy: "home_edit" }, row([
      box([inputBox([field("plan-home-edit", "home", "Your area, like HSR Layout", { onSubmit: save }), roundButton("check", save, { size: 36, label: "Save", light: true })])], { flexGrow: 1, flexShrink: 1 }),
      row([text("Forget", { size: 13, weight: 500, lineHeight: 18, color: C.meta })], { minHeight: 44, paddingHorizontal: 6, alignItems: "center" }, write("PUT", `${A}/plan/home`, { home: "" }, "Forgotten", setState("home_edit", false))),
    ], { gap: 8, alignItems: "center" })),
  ], { gap: 6 })];
}

/** Under the timeline: "Working out travel times…" while it is, and the providers' credits. */
export function planFoot(_ctx: BotsCtx, t: PlanTravelView | undefined): Node[] {
  if (!t) return [];
  const credit = creditLine(t.credits);
  return [
    ...(t.pending ? [row([statusMark("working", { color: PLAN(), size: 8 }), meta("Working out travel times…", { size: 12 })], { gap: 8, alignItems: "center" })] : []),
    ...(credit ? [credit] : []),
  ];
}

// ===================================================================== the Travel bot

const SEA = () => botLook("travel").color;
const LABEL_ORDER = ["Your pick", "Travel bot's pick", "Closer", "Better rated", ""];
const STAYING = /hotel|stay|room|booking\.com|airbnb|hostel|resort|homestay|agoda|goibibo|makemytrip|oyo|treebo/i;

/** A stay as the screens draw it: a "Cheaper" label from before the app showed no money is no label. */
const shown = (s: StayView): StayView => ((s.label as string) === "Cheaper" ? { ...s, label: "" } : s);
const sortStays = (s: StayView[]) => [...s].sort((a, b) => LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label) || (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
const ratingWords = (s: StayView) => (s.rating === null ? null : `${s.ratingOf === 10 ? `${s.rating}/10` : s.rating}${s.reviews ? ` · ${plural(s.reviews, "review")}` : ""}`);
const minutesWords = (s: StayView, main: string | null) => (s.minutes === null || !main ? null : `${s.minutes} min ${s.mode === "walk" ? "walk " : ""}to ${main}`);

/** The weather on the trip's days: "Clear days, cool nights", the days' highs; a packing line it calls for. In the window it sits in the trip plan. */
export function weatherPart(_ctx: BotsCtx, trip: TripLite, x: TripExtrasView | undefined, o: { desk?: boolean } = {}): Node[] {
  if (!x) return [];
  if (!x.weather) {
    return x.weatherNote ? [row([skyGlyph("cloudy", 22, C.idle), meta(x.weatherNote, { size: 13, style: { flexShrink: 1 } })], {
      gap: 12, alignItems: "center", padding: o.desk ? 12 : 14, borderRadius: o.desk ? 14 : 18, ...(o.desk ? { backgroundColor: C.surface } : { borderWidth: 1, borderColor: C.line }),
    })] : x.pending && x.dates ? [row([statusMark("working", { color: SEA(), size: 8 }), meta("Getting the weather…", { size: 12 })], { gap: 8, alignItems: "center" })] : [];
  }
  const w = x.weather;
  const worst = w.days.some((d) => d.sky === "storm") ? "storm" : w.days.some((d) => d.sky === "rain") ? "rain" : w.days.some((d) => d.hiC >= 35) ? "heat" : w.days.every((d) => d.sky === "cloudy") ? "cloudy" : "clear";
  const pack = w.pack && !trip.packing.some((p) => p.text.toLowerCase() === w.pack!.toLowerCase())
    ? [chip(`Pack: ${w.pack}`, { onPress: write("POST", `${A}/trip/${enc(trip.id)}/packing`, { text: w.pack }, "Added to packing") })] : [];
  return [col([
    row([
      skyGlyph(worst as Sky | "heat", 26),
      col([text(w.line, { size: 14, weight: 500, lineHeight: 19 }), meta(w.sub, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ], { gap: 12, alignItems: "center" }),
    ...(w.more ? [meta(w.more, { size: 12 })] : []),
    ...(pack.length ? [row(pack, { gap: 8, flexWrap: "wrap" })] : []),
  ], { gap: 10, padding: o.desk ? 12 : 14, borderRadius: o.desk ? 14 : 18, ...(o.desk ? { backgroundColor: C.surface } : { borderWidth: 1, borderColor: C.line }) })];
}

/** The trip's main places: what stays are measured against. */
export function spotsPart(_ctx: BotsCtx, trip: TripLite, x: TripExtrasView | undefined): Node {
  const spots = x?.spots ?? (trip.spots ?? []).map((text) => ({ text, found: null }));
  const add = ifFilled("spot", write("POST", `${A}/trip/${enc(trip.id)}/spots`, { text: "$state.spot" }, undefined, setState("spot", "")), "Write the place first");
  return col([
    row([sectionLabel("Where you'll be"), grow(), meta(spots.length ? "Stays are timed to the first" : "The venue, a friend's place", { size: 12 })]),
    ...(spots.length ? [listCard(spots.map((s, i) => listRow({
      label: s.text,
      ...(s.found === false && x?.canMeasure ? { sub: "Couldn't find this on the map" } : i === 0 && spots.length > 1 ? { sub: "Main place" } : {}),
      left: icon("pin", { size: 18, color: i === 0 ? SEA() : C.meta }),
      right: box([icon("close", { size: 14, color: C.meta })], { width: 36, height: 36, alignItems: "center", justifyContent: "center" }, write("DELETE", `${A}/trip/${enc(trip.id)}/spots/${i}`)),
    })))] : []),
    inputBox([field("trip-spot", "spot", "Add a place: Sakshi's wedding, Koregaon Park", { onSubmit: add }), roundButton("plus", add, { size: 36, label: "Add", light: true })]),
  ], { gap: 10 });
}

function stayLines(s: StayView, x: TripExtrasView): string[] {
  return [ratingWords(s), minutesWords(s, x.main)].filter((l): l is string => !!l);
}

/** Where the price is: on the booking site, never here. */
const pricesOn = (s: StayView) => (s.host ? `Prices on ${s.host}` : "Prices on their site");

function stayCard(trip: TripLite, s: StayView, x: TripExtrasView): Node {
  const top = s.label === "Your pick" || s.label === "Travel bot's pick";
  const from = s.host ? s.host : s.by === "you" ? "Added by you" : "";
  return col([
    row([
      text(s.label || (s.by === "web" ? "Found on the web" : s.by === "chat" ? "From your chat" : "Yours"), { size: 11, weight: 600, color: top ? SEA() : C.meta, lineHeight: 14, style: { flexShrink: 1 } }),
      grow(),
      box([icon("close", { size: 12, color: C.idle })], { width: 28, height: 28, marginTop: -6, marginRight: -6, alignItems: "center", justifyContent: "center" },
        write("DELETE", `${A}/trip/${enc(trip.id)}/stays/${enc(s.id)}`, undefined, "Removed")),
    ], { alignItems: "flex-start" }),
    col([text(s.name, { size: 14, weight: 600, lineHeight: 19, lines: 2 }), ...(s.area ? [meta(s.area, { size: 12, lines: 1 })] : [])], { gap: 1 }),
    ...stayLines(s, x).map((l) => text(l, { size: 12, color: C.grey70, lineHeight: 16 })),
    ...(from ? [text(from, { size: 11, color: C.idle, lineHeight: 14, lines: 1 })] : []),
    grow(),
    row([
      chip(s.picked ? "Picked" : "Pick", { selected: s.picked, onPress: write("PUT", `${A}/trip/${enc(trip.id)}/stays/${enc(s.id)}/pick`, undefined, s.picked ? "Not picked" : "Picked") }),
      ...(s.url ? [chip("See prices", { onPress: openUrl(s.url) })] : []),
    ], { gap: 6, flexWrap: "wrap" }),
  ], { gap: 6, padding: 12, borderRadius: 18, borderWidth: top ? 1.5 : 1, borderColor: top ? SEA() : C.line, flexGrow: 1 });
}

function addStayForm(trip: TripLite): Node {
  const add = ifFilled("s_name", write("POST", `${A}/trip/${enc(trip.id)}/stays`, { name: "$state.s_name", url: "$state.s_url", area: "$state.s_area" }, "Added",
    seq(setState("s_open", false), setState("s_name", ""), setState("s_url", ""), setState("s_area", ""))), "Write the stay's name");
  return when({ truthy: "s_open" }, card([
    text("Add a stay to compare", { size: 15, weight: 600, lineHeight: 20 }),
    inputBox([field("stay-name", "s_name", "Name: Shanti Residency")]),
    inputBox([field("stay-url", "s_url", "Link (optional)", { keyboard: "url" })]),
    inputBox([field("stay-area", "s_area", "Area")]),
    row([button("Add", add, { size: "md" }), button("Cancel", setState("s_open", false), { kind: "quiet", size: "md" })], { gap: 8 }),
  ], { gap: 10 }));
}

/** Stays the Travel bot opened in its chat that aren't compared yet: one tap adds one. */
function fromChat(trip: TripLite, x: TripExtrasView, opened: Opened[]): Node[] {
  const have = new Set(x.stays.map((s) => s.url.replace(/[?#].*$/, "")));
  const fresh = opened.filter((o) => STAYING.test(`${o.label} ${o.url}`) && !have.has(o.url.replace(/[?#].*$/, ""))).slice(0, 3);
  if (!fresh.length) return [];
  return [row(fresh.map((o) => chip(`Compare: ${o.label.split(" · ")[0]!.slice(0, 32)}`, { dashed: true, onPress: write("POST", `${A}/trip/${enc(trip.id)}/stays`, { label: o.label, url: o.url, from: "chat" }, "Added to compare") })), { gap: 8, flexWrap: "wrap" })];
}

function searchLine(x: TripExtrasView, place: string): Node[] {
  if (x.finding) return [row([statusMark("working", { color: SEA(), size: 8 }), meta(`Travel bot is looking for stays in ${place}…`, { size: 12 })], { gap: 8, alignItems: "center" })];
  const words = x.searched === "none" ? "Found nothing to compare on the web. Add one you like." : x.searched === "limit" ? "That's today's searches. Add one by hand." : x.searched === "failed" ? "Couldn't search just now. Try again later." : null;
  return words ? [meta(words, { size: 12 })] : [];
}

/** Stays side by side: two cards a row on the phone (TravelBot), the window's table (DTravelBot). */
export function staysPart(ctx: BotsCtx, trip: TripLite, x: TripExtrasView | undefined, opened: Opened[], o: { desk?: boolean } = {}): Node {
  if (!x) return col([]);
  const stays = sortStays(x.stays.map(shown));
  const find = x.canFind && !x.finding ? write("POST", `${A}/trip/${enc(trip.id)}/stays/find`, undefined, "Looking for stays") : undefined;
  const actions = row([
    ...(find ? [button(stays.length ? "Find more" : `Find stays in ${trip.place}`, find, { kind: stays.length ? "secondary" : "primary", size: "md", icon: "search" })] : []),
    button("Add one", setState("s_open", true), { kind: "secondary", size: "md", icon: "plus" }),
  ], { gap: 8, flexWrap: "wrap" });
  const head = row([sectionLabel(stays.length ? `Stay · ${plural(stays.length, "option")}` : "Stay"), grow(), meta("Prices and booking on their site", { size: 12 })]);
  if (!stays.length) {
    return col([head, card([
      text("Nothing to compare yet", { size: 15, weight: 600, lineHeight: 20 }),
      meta(`Travel bot puts stays side by side: the area, the rating${x.canMeasure ? " and the time to where you'll be" : ""}, with a link to see prices. It never books or pays.`, { size: 13 }),
      actions,
    ], { gap: 10 }), ...fromChat(trip, x, opened), ...searchLine(x, trip.place), addStayForm(trip)], { gap: 8 });
  }
  const body = o.desk ? stayTable(ctx, trip, stays.slice(0, 3), x) : grid(stays.map((s) => stayCard(trip, s, x)), 2, 10);
  const rest = o.desk && stays.length > 3 ? [listCard(stays.slice(3).map((s) => listRow({
    label: s.name, sub: [s.area, ratingWords(s), minutesWords(s, x.main)].filter(Boolean).join(" · "),
    right: row([chip("Pick", { onPress: write("PUT", `${A}/trip/${enc(trip.id)}/stays/${enc(s.id)}/pick`, undefined, "Picked") }), ...(s.url ? [chip("See prices", { onPress: openUrl(s.url) })] : [])], { gap: 6 }),
  })))] : [];
  return col([head, body, ...rest, ...fromChat(trip, x, opened), ...searchLine(x, trip.place), actions, addStayForm(trip)], { gap: 10 });
}

/** The window's comparison: a column of row names, a column a stay (DTravelBot "Stay · 2 options"). */
function stayTable(_ctx: BotsCtx, trip: TripLite, stays: StayView[], x: TripExtrasView): Node {
  const rowsOf: Array<{ name: string; value: (s: StayView) => string; strong?: boolean }> = [
    { name: "Area", value: (s) => s.area || "—" },
    { name: "Rating", value: (s) => ratingWords(s) ?? "—", strong: true },
    ...(x.main && x.canMeasure ? [{ name: `To ${x.main.length > 14 ? "the place" : x.main}`, value: (s: StayView) => (s.minutes !== null ? `${s.minutes} min${s.mode === "walk" ? " walk" : ""}` : "—") }] : []),
    { name: "Where", value: (s) => s.host || (s.by === "you" ? "Added by you" : "—") },
  ];
  const cell = (content: string, o: { strong?: boolean; head?: boolean; color?: string } = {}) => row([text(content, { size: o.head ? 14 : 13, weight: o.head ? 600 : o.strong ? 600 : 400, color: o.color ?? C.ink, lineHeight: 18, lines: 1 })], {
    height: o.head ? 30 : 31, alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.divider,
  });
  const names = col([box([], { height: 13 }), box([], { height: 31 }), ...rowsOf.map((r) => cell(r.name, { color: C.meta }))], { width: 92, flexShrink: 0, paddingTop: 13 });
  const columns = stays.map((s) => {
    const top = s.label === "Your pick" || s.label === "Travel bot's pick";
    return col([
      row([text(s.label || "Option", { size: 11, weight: 600, color: top ? SEA() : C.meta, lineHeight: 13, style: { flexShrink: 1 } }), grow(),
        box([icon("close", { size: 12, color: C.idle })], { width: 24, height: 24, marginTop: -6, marginRight: -6, alignItems: "center", justifyContent: "center" }, write("DELETE", `${A}/trip/${enc(trip.id)}/stays/${enc(s.id)}`, undefined, "Removed"))], { alignItems: "flex-start", height: 13 }),
      cell(s.name, { head: true }),
      ...rowsOf.map((r) => cell(r.value(s), { strong: r.strong })),
      row([
        button(s.picked ? "Picked" : "Pick this", write("PUT", `${A}/trip/${enc(trip.id)}/stays/${enc(s.id)}/pick`, undefined, s.picked ? "Not picked" : "Picked"), { kind: s.picked ? "primary" : "secondary", size: "md", wide: true }),
      ], { paddingTop: 10 }),
      ...(s.url ? [row([text(pricesOn(s), { size: 13, weight: 500, lineHeight: 18, lines: 1 })], { minHeight: 32, justifyContent: "center", alignItems: "center" }, openUrl(s.url))] : []),
    ], { flexGrow: 1, flexBasis: 0, minWidth: 0, borderWidth: top ? 1.5 : 1, borderColor: top ? SEA() : C.line, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 });
  });
  return row([names, ...columns], { gap: 10, alignItems: "stretch" });
}

/** The window's "Trip plan": the days with their weather, where you stay, where you'll be and how far from the stays. */
export function tripPlanPart(ctx: BotsCtx, trip: TripLite, x: TripExtrasView | undefined): Node | null {
  if (!x) return null;
  const days = x.dates ? (() => { const out: string[] = []; for (let t = Date.parse(`${x.dates.from}T00:00:00Z`); t <= Date.parse(`${x.dates.to}T00:00:00Z`) && out.length < 10; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10)); return out; })() : [];
  const stay = x.stays.find((s) => s.label === "Your pick") ?? x.stays.find((s) => s.label === "Travel bot's pick");
  const others = x.stays.filter((s) => s !== stay && s.minutes !== null);
  const kids: Node[] = [sectionLabel("Trip plan")];
  days.forEach((k, i) => {
    const w = x.weather?.days.find((d) => d.key === k);
    if (i > 0) kids.push(divider());
    kids.push(row([
      text(dayWords(k), { size: 14, weight: 700, lineHeight: 19 }),
      meta(i === 0 ? "Go" : i === days.length - 1 ? "Back" : `Day ${i + 1}`, { size: 12 }),
      grow(),
      ...(w ? [skyGlyph(w.hiC >= 35 && w.sky === "clear" ? "heat" : w.sky, 16, C.meta), meta(`${w.hiC}° / ${w.loC}°`, { size: 12 })] : []),
    ], { gap: 8, alignItems: "center" }));
    if (i === 0 && stay) {
      kids.push(row([meta("Stay", { size: 12, style: { width: 62, textAlign: "right" } }), col([text(stay.name, { size: 14, lineHeight: 19 }), meta(stay.picked ? (stay.area || "Your pick") : `${stay.area ? `${stay.area} · ` : ""}Travel bot's pick, if you choose it`, { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" }));
    }
  });
  if (!days.length) kids.push(meta("Add the dates to plan the days and see the weather.", { size: 13 }));
  if (x.spots.length) {
    kids.push(divider());
    trip.spots?.forEach((sp, i) => {
      const [name, ...where] = sp.split(",").map((s) => s.trim());
      const near = i === 0 && stay?.minutes !== null && stay?.minutes !== undefined
        ? [`${stay.minutes} min from ${stay.picked ? "your pick" : "the pick"}`, ...others.slice(0, 1).map((s) => `${s.minutes} from ${s.name}`)].join(", ")
        : null;
      kids.push(row([icon("pin", { size: 16, color: i === 0 ? SEA() : C.meta }), col([text(name ?? sp, { size: 14, lineHeight: 19 }), ...([where.join(", "), near].filter(Boolean).length ? [meta([where.join(", "), near].filter(Boolean).join(" · "), { size: 12 })] : [])], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" }));
    });
  }
  kids.push(...weatherPart(ctx, trip, x, { desk: true }));
  const credit = creditLine(x.credits);
  if (credit) kids.push(credit);
  return col(kids, { gap: 12, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18, minWidth: 0 });
}

/** The phone's credits for what the trip shows. */
export function tripFoot(x: TripExtrasView | undefined): Node[] {
  if (!x) return [];
  const credit = creditLine(x.credits);
  return [
    ...(x.pending && !x.finding ? [row([statusMark("working", { color: SEA(), size: 8 }), meta("Working out the weather and distances…", { size: 12 })], { gap: 8, alignItems: "center" })] : []),
    ...(credit ? [credit] : []),
  ];
}

/** A notice for a trip whose dates couldn't be read (the weather and stay totals need them). */
export function datesHint(trip: TripLite, x: TripExtrasView | undefined): Node[] {
  return x && !x.dates && trip.when ? [notice(`Couldn't read "${trip.when}" as dates. Try "14–16 Nov".`)] : [];
}
