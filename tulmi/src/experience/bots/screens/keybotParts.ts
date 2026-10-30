/**
 * KEYBOT'S SMALL PARTS, shared by its page files (screens/keybot.ts, keybotStats.ts, keybotYou.ts): the heads, a field,
 * the writes, and the charts the numbers are drawn with.
 *
 * The charts follow the kit's look and the dataviz rules: one series is one colour (Keylessbord's clay, its own accent),
 * the one bar a chart is about is clay and the rest a quiet grey; bars at most 24 wide, 4 rounded at the data end and
 * square at the baseline, 2 apart; values and labels in ink and grey, never in the data's colour; a few labels, not
 * one on every bar; and every chart has its numbers as rows somewhere on the same page (the table view).
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  back, botAvatar, botLook, box, button, C, call, card, col, grow, icon, meta, quietButton, row, sectionLabel, seq, shapes,
  statusMark, switchMark, text, title, type BotsCtx,
} from "../kit.js";
import type { BotsDeps } from "../live.js";

export const KEYBOT = botLook("keybot");
export const CLAY = KEYBOT.color;
export const DESK_WIDTH = 1000;
export const n = (v: number) => Math.round(v).toLocaleString("en-IN");
export const plural = (v: number, one: string, many: string) => `${n(v)} ${Math.round(v) === 1 ? one : many}`;
/** Minutes as read: "40 sec", "12 min", "2 h 10 min". */
export function span(min: number): string {
  if (!(min > 0)) return "0 min";
  if (min < 1) return `${Math.max(1, Math.round(min * 60))} sec`;
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export const pct = (v: number, of: number) => (of > 0 ? Math.round((v / of) * 100) : 0);

// ===================================================================== glyphs

/** Line glyphs the kit does not carry. */
export const GLYPHS = {
  chats: "M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
  mail: "M4.5 6h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM3.5 7l8.5 6 8.5-6",
  work: "M4 8.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM9 8.5V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M3 13.5h18",
  app: "M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5zM8.5 9h7M8.5 12.5h7M8.5 16h4",
  copy: "M9 8.5h9.5a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1zM5 15.5V5a1 1 0 0 1 1-1h9",
  forget: "M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5",
} as const;
export type Glyph = keyof typeof GLYPHS;

export function glyph(name: Glyph, o: { size?: number; color?: string; label?: string } = {}): Node {
  return shapes([{ d: GLYPHS[name], stroke: o.color ?? C.ink, strokeWidth: 1.9, linecap: "round", linejoin: "round" }], { size: o.size ?? 18, ...(o.label ? { label: o.label } : {}) });
}

/** An app's little square: its kind's glyph on the surface grey (white when it is the one picked). */
export function appSquare(kind: Glyph, size = 32, light?: unknown): Node {
  return box([glyph(kind, { size: Math.round(size * 0.55) })], {
    width: size, height: size, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: light ?? C.surface,
  });
}

/** A key on a keyboard drawing ("Fn", "Esc"); `bind` shows a state value (the window's own keys) in its place. */
export function kbd(label: string, bind?: string): Node {
  return row([text(label, { size: 12, weight: 500, lineHeight: 16, ...(bind ? { bind } : {}) })], {
    height: 26, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1, borderColor: C.outline, backgroundColor: C.paper, flexShrink: 0,
  });
}

// ===================================================================== heads

/** The phone page's head: back, the title, Keylessbord's face. */
export function phoneHead(heading: string, o: { onBack?: ActionRef; backLabel?: string } = {}): Node {
  return row([
    box([icon("back", { size: 24, label: o.backLabel ?? "Back to Keylessbord" })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, o.onBack ?? back()),
    text(heading, { size: 24, weight: 700, tracking: -0.5, lineHeight: 30, lines: 1, style: { flexShrink: 1 } }),
    grow(),
    botAvatar(KEYBOT, 30),
  ], { gap: 8, minHeight: 44 });
}

/** The window page's head: "‹ Keylessbord" back, the title and its line, what the page does on the right. */
export function deskHead(heading: string, sub: string, right: Node[] = [], o: { onBack?: ActionRef; backTo?: string } = {}): Node {
  return col([
    row([icon("back", { size: 14, color: C.grey70 }), botAvatar(KEYBOT, 20), text(o.backTo ?? "Keylessbord", { size: 13, color: C.grey70, lineHeight: 18 })],
      { gap: 6, paddingVertical: 2, paddingRight: 8, alignSelf: "flex-start", borderRadius: 8 }, o.onBack ?? back()),
    row([
      col([title(heading, { size: 26 }), text(sub, { size: 14, color: C.grey70, lineHeight: 19 })], { gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(right.length ? [row(right, { gap: 10 })] : []),
    ], { gap: 16, alignItems: "flex-end", flexWrap: "wrap" }),
  ], { gap: 6 });
}

/** A section's label with a quiet way on at its right ("Tone per app ›"). */
export function sectionHead(label: string, more?: { label: string; onPress: ActionRef }): Node {
  return row([
    sectionLabel(label, { style: { flexShrink: 1 } }),
    grow(),
    ...(more ? [row([text(more.label, { size: 13, lineHeight: 17 }), icon("chevron", { size: 14 })], { gap: 2, minHeight: 32 }, more.onPress)] : []),
  ], { gap: 8, minHeight: 20 });
}

// ===================================================================== fields and rows

/** A text field in the kit's look (the ask bar's): a pill with a line. */
export function field(path: string, placeholder: string, o: { onSubmit?: ActionRef; lead?: Node; height?: number; returnKey?: string; label?: string; multiline?: boolean } = {}): Node {
  const h = o.height ?? 44;
  return row([
    ...(o.lead ? [o.lead] : []),
    {
      type: "TextField", id: path.replace(/\W/g, "_"), bind: { value: path },
      props: {
        placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
        minHeight: h - 2, returnKeyType: o.returnKey ?? "done", color: C.ink, ...(o.label ? { accessibilityLabel: o.label } : {}),
        ...(o.multiline ? { multiline: true } : {}),
      },
      ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
      style: {
        flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: h - 2, paddingHorizontal: 0, paddingVertical: o.multiline ? 10 : 0,
        fontFamily: "Tailzu Geist", fontSize: 15, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
      },
    },
  ], o.multiline
    ? { gap: 10, minHeight: h, borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, backgroundColor: C.paper, alignItems: "flex-start" }
    : { gap: 10, height: h, borderRadius: h / 2, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, backgroundColor: C.paper });
}

/** A search field: Enter opens the page again for what was typed. */
export function searchField(screenId: string, placeholder: string): Node {
  return field("q", placeholder, {
    lead: icon("search", { size: 18, color: C.meta }), returnKey: "search", label: placeholder,
    onSubmit: { kind: "navigate", screenId, params: { q: "$state.q" }, replace: true },
  });
}

/** "Results for “x”", and the way back to all of it. */
export function searchLine(screenId: string, q: string): Node {
  return row([meta(`Results for “${q}”`, { size: 13, style: { flexShrink: 1 } }), grow(),
    quietButton("Show all", { kind: "navigate", screenId, replace: true }, { size: "md" })], { gap: 8 });
}

/** A row with a switch that follows a state path and saves through `onChange`. */
export function toggleRow(label: string, path: string, onChange: ActionRef, sub?: string): Node {
  return row([
    col([text(label, { size: 14, lineHeight: 19 }), ...(sub ? [meta(sub, { size: 12 })] : [])], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    switchMark(path),
  ], { gap: 12, paddingVertical: 10, minHeight: 44 }, seq({ kind: "toggleState", path }, onChange));
}

/** A settings card in the window: a label and its rows. */
export function deskCard(label: string, children: Node[], o: { gap?: number; padding?: number } = {}): Node {
  return card([sectionLabel(label), ...children], { gap: o.gap ?? 8, padding: o.padding ?? 16, radius: 18 });
}

/** Two columns side by side in the window: `left` fixed or weighted, `right` takes the rest. */
export function twoCols(left: Node[], right: Node[], o: { left?: number; leftWeight?: number; rightWeight?: number; gap?: number } = {}): Node {
  return row([
    col(left, { gap: 16, ...(o.left ? { width: o.left, flexShrink: 0 } : { flexGrow: o.leftWeight ?? 1, flexBasis: 0, minWidth: 0 }) }),
    col(right, { gap: 16, flexGrow: o.rightWeight ?? 1, flexBasis: 0, minWidth: 0 }),
  ], { gap: o.gap ?? 20, alignItems: "flex-start" });
}

/** The page could not be read: say so, and offer to try again. */
export function couldntLoad(what: string): Node {
  return card([
    row([statusMark("failed", { size: 10 }), text(`Couldn't load ${what}.`, { size: 15, weight: 500 })], { gap: 10 }),
    meta("Check your connection, then try again.", { size: 13 }),
    button("Try again", { kind: "refresh" }, { kind: "secondary", size: "md" }),
  ], { gap: 10 });
}

/** A label and its value, one line (a detail's rows: the numbers behind each chart). */
export function statRow(label: string, value: string, o: { onPress?: ActionRef; strong?: boolean } = {}): Node {
  return row([
    text(label, { size: 14, color: C.grey70, lineHeight: 19, style: { flexShrink: 1, minWidth: 0 } }),
    grow(),
    text(value, { size: 14, weight: o.strong ? 600 : 500, lineHeight: 19, align: "right", style: { flexShrink: 1, minWidth: 0, maxWidth: "65%" } }),
    ...(o.onPress ? [icon("chevron", { size: 14, color: C.meta })] : []),
  ], { gap: 10, paddingVertical: 9, minHeight: 38 }, o.onPress);
}

/** Rows in a card with hairlines between them. */
export function rowsCard(rows: Node[], o: { label?: string } = {}): Node {
  const kids: Node[] = [];
  rows.forEach((r, i) => { if (i) kids.push(box([], { height: 1, backgroundColor: C.divider })); kids.push(r); });
  return card([...(o.label ? [sectionLabel(o.label)] : []), col(kids)], { gap: 6, radius: 18, padding: 16, style: { paddingVertical: 12 } });
}

export const toast = (message: string): ActionSpec => ({ kind: "toast", message });
export const oops = (what = "Couldn't save that. Try again."): ActionSpec => ({ kind: "toast", message: what, tone: "error" });
/** A write: the call, a refresh (the window refetches by itself after a write too), and a quiet word. */
export const write = (method: "POST" | "PUT" | "DELETE", path: string, body: Record<string, unknown> | undefined, done?: string, fail?: string): ActionSpec =>
  call(method, path, body, { ok: seq(...(done ? [toast(done)] : []), { kind: "refresh" }), fail: oops(fail) });
/** A save that changes nothing on the page but the control itself (which already follows its state). */
export const save = (method: "POST" | "PUT", path: string, body: Record<string, unknown>, fail?: string): ActionSpec =>
  call(method, path, body, { fail: oops(fail) });

// ===================================================================== reads

/** A GET of the keybot area's, with the person's clock on it. */
export const load = <T>(path: string) => (ctx: BotsCtx, deps: Pick<BotsDeps, "api">): Promise<T> => {
  const tz = `tz=${ctx.tzOffsetMinutes}`;
  return deps.api<T>("GET", path.includes("?") ? `${path}&${tz}` : `${path}?${tz}`);
};
/** One builder per client. */
export const both = <D, R>(phone: (c: BotsCtx, d: D | undefined) => R, desk: (c: BotsCtx, d: D | undefined) => R) =>
  (ctx: BotsCtx, d: D | undefined): R => (ctx.client === "desktop" ? desk(ctx, d) : phone(ctx, d));

// ===================================================================== time

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The person's own clock (ctx.tzOffsetMinutes): "9:42 pm". */
export function clock(ctx: BotsCtx, ms: number): string {
  const d = new Date(ms + ctx.tzOffsetMinutes * 60_000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
export const dayKey = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
/** "Today", "Yesterday", "Mon 26 Oct". */
export function dayLabel(ctx: BotsCtx, ms: number): string {
  if (!Number.isFinite(ms)) return "Earlier";
  const k = dayKey(ctx, ms), today = dayKey(ctx, ctx.live.now);
  if (k === today) return "Today";
  if (k === dayKey(ctx, ctx.live.now - 86_400_000)) return "Yesterday";
  const d = new Date(ms + ctx.tzOffsetMinutes * 60_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "14:32" as the person reads it: "2:32 pm". */
export function hhmm(at: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!m) return at;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}
/** "2026-10-14" as "14 Oct". */
export function isoDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : day;
}

// ===================================================================== charts

/** A figure: its label, the number, its unit; a clay dot when it is running now (the day streak). Opens what is behind it. */
export function figure(label: string, value: string, o: { unit?: string; live?: boolean; onPress?: ActionRef; sub?: string } = {}): Node {
  return col([
    row([meta(label, { size: 12, lines: 1, style: { flexShrink: 1 } }), ...(o.live ? [statusMark("working", { color: CLAY, size: 8 })] : [])], { gap: 6 }),
    row([
      text(value, value.length > 7 ? { size: 18, weight: 700, tracking: -0.3, lineHeight: 24 } : { size: 24, weight: 700, tracking: -0.5, lineHeight: 30 }),
      ...(o.unit ? [text(o.unit, { size: 13, color: C.meta, lineHeight: 18 })] : []),
    ], { gap: 5, alignItems: "flex-end", flexWrap: "wrap" }),
    ...(o.sub ? [meta(o.sub, { size: 12, lines: 2 })] : []),
  ], { gap: 4, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, flexGrow: 1, flexBasis: 0, minWidth: 0 }, o.onPress);
}

/** Figures in rows of `per` (the last row filled out so every tile is the same width). */
export function figures(tiles: Node[], per: number): Node {
  const rows: Node[] = [];
  for (let i = 0; i < tiles.length; i += per) {
    const part = tiles.slice(i, i + per);
    while (part.length < per) part.push(box([], { flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 14, borderWidth: 1, borderColor: "transparent" }));
    rows.push(row(part, { gap: 10, alignItems: "stretch" }));
  }
  return col(rows, { gap: 10 });
}

export interface BarRow { label: string; value: number; text: string; sub?: string; onPress?: ActionRef; lead?: Node }

/**
 * Ranked horizontal bars: a clay bar each against the largest, the value in ink beside it. One series, one colour; a
 * row may open what it is about. With `labelWidth`, a lane per row (the label, the bar, the value on one line: "Said",
 * "Typed"); without, the label and the value on a line and the bar under them, so a long name and its line read whole.
 * `max` sets what a full bar means (the largest row by default).
 */
export function hbars(rows: BarRow[], o: { labelWidth?: number; max?: number; empty?: string } = {}): Node {
  if (!rows.length) return meta(o.empty ?? "Nothing yet.", { size: 13 });
  const max = Math.max(1, o.max ?? 0, ...rows.map((r) => r.value));
  const bar = (r: BarRow, style: Record<string, unknown>) => row([box([], { width: `${Math.max(2, Math.round((r.value / max) * 100))}%`, height: 6, borderRadius: 3, backgroundColor: CLAY })],
    { height: 6, borderRadius: 3, backgroundColor: C.surface, ...style });
  const value = (r: BarRow) => text(r.text, { size: 13, weight: 500, lineHeight: 17, align: "right", style: { flexShrink: 0 } });
  const chevron = (r: BarRow) => (r.onPress ? [icon("chevron", { size: 14, color: C.meta })] : []);
  if (o.labelWidth) {
    return col(rows.map((r) => row([
      ...(r.lead ? [r.lead] : []),
      col([text(r.label, { size: 14, lineHeight: 18, lines: 1 }), ...(r.sub ? [meta(r.sub, { size: 12, lines: 1 })] : [])], { gap: 1, width: o.labelWidth, flexShrink: 0 }),
      bar(r, { flexGrow: 1, flexBasis: 0, minWidth: 40 }),
      box([value(r)], { minWidth: 48, alignItems: "flex-end", flexShrink: 0 }),
      ...chevron(r),
    ], { gap: 12, minHeight: 40, paddingVertical: 4 }, r.onPress)), { gap: 2 });
  }
  return col(rows.map((r) => row([
    ...(r.lead ? [r.lead] : []),
    col([
      row([text(r.label, { size: 14, lineHeight: 18, lines: 1, style: { flexShrink: 1, minWidth: 0 } }), grow(), value(r)], { gap: 8 }),
      ...(r.sub ? [meta(r.sub, { size: 12, lines: 1 })] : []),
      bar(r, { alignSelf: "stretch", marginTop: 4 }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...chevron(r),
  ], { gap: 12, minHeight: 44, paddingVertical: 6 }, r.onPress)), { gap: 2 });
}

/**
 * Columns, one per value, from one baseline: grey, and clay for the ones the chart is about (`mark`: today, the peak).
 * At most 24 wide, rounded at the top, 2 apart when dense. `tops` labels a few columns (the marked and the largest by
 * default; "all" for a short series); `ticks` are the axis's words under it (a few, spread, or one per column).
 */
export function columns(values: number[], o: {
  height?: number; mark?: number[]; tops?: "auto" | "all" | "none"; format?: (v: number) => string;
  ticks?: string[]; perColumnTicks?: boolean; ahead?: number[];
} = {}): Node {
  const h = o.height ?? 80;
  const max = Math.max(1, ...values);
  const marked = new Set(o.mark ?? []);
  const ahead = new Set(o.ahead ?? []);
  const fmt = o.format ?? n;
  const dense = values.length > 12;
  const peak = values.indexOf(Math.max(...values));
  // A column too thin for its number carries none: the page says the numbers that matter in words, and lists them.
  const tops = dense ? "none" : o.tops ?? "auto";
  const labelled = (i: number) => tops === "all" ? values[i]! > 0 : tops === "none" ? false : (marked.has(i) || i === peak) && values[i]! > 0;
  const cols = values.map((v, i) => col([
    ...(tops === "none" ? [] : [text(labelled(i) ? fmt(v) : " ", { size: 11, weight: marked.has(i) ? 600 : 400, color: marked.has(i) ? C.ink : C.meta, lineHeight: 14, align: "center", lines: 1 })]),
    box([box([], ahead.has(i)
      ? { width: "100%", height: 2, backgroundColor: C.divider }
      : {
        width: "100%", height: v > 0 ? Math.max(3, Math.round((v / max) * h)) : 2,
        borderTopLeftRadius: v > 0 ? Math.min(4, dense ? 2 : 4) : 0, borderTopRightRadius: v > 0 ? Math.min(4, dense ? 2 : 4) : 0,
        backgroundColor: v <= 0 ? C.divider : marked.has(i) ? CLAY : C.idle,
      })], { height: h, width: "100%", maxWidth: 24, justifyContent: "flex-end" }),
    ...(o.perColumnTicks ? [text(o.ticks?.[i] ?? "", { size: 11, weight: marked.has(i) ? 600 : 400, color: marked.has(i) ? C.ink : C.meta, lineHeight: 14, align: "center", lines: 1 })] : []),
  ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 4, alignItems: "center", overflow: "visible" }));
  return col([
    row(cols, { gap: dense ? 2 : 8, alignItems: "flex-end" }),
    ...(!o.perColumnTicks && o.ticks?.length ? [row(o.ticks.map((t, i) => text(t, {
      size: 11, color: C.meta, lineHeight: 14, align: i === 0 ? "left" : i === o.ticks!.length - 1 ? "right" : "center",
      style: { flexGrow: 1, flexBasis: 0, minWidth: 0 },
    })), { gap: 4, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 5 })] : []),
  ], { gap: 4 });
}

/** The three axis words for a run of days: the first, the middle, the last. */
export function dayTicks(days: Array<{ short: string; today?: boolean }>): string[] {
  if (days.length < 3) return days.map((d) => (d.today ? "Today" : d.short));
  return [days[0]!.short, days[Math.floor((days.length - 1) / 2)]!.short, days[days.length - 1]!.today ? "Today" : days[days.length - 1]!.short];
}
export const HOUR_TICKS = ["12 am", "6 am", "12 pm", "6 pm", "11 pm"];
/** An hour of the day as read: "7 am", "12 pm". */
export const hourName = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`;
/** The largest value's place (the first, on a tie); -1 when every value is nothing. */
export const peakOf = (v: number[]) => (v.some((x) => x > 0) ? v.indexOf(Math.max(...v)) : -1);

/** Clay, lighter: how much was said that day, in three steps (one hue, light to dark), and none. */
const TINTS = ["#ead5ce", "#d0a393", CLAY];

/**
 * The days as a calendar, Monday first: each day its date, filled by how much was written on it (three steps of clay),
 * today ringed in ink, the days either side of the window faint. A day opens its own page.
 */
export function calendar(days: Array<{ i: number; date: number; weekday: number; words: number; today: boolean }>, onDay: (i: number) => ActionRef, o: { cell?: number } = {}): Node {
  const h = o.cell ?? 40;
  const max = Math.max(1, ...days.map((d) => d.words));
  const level = (w: number) => (w <= 0 ? -1 : w > max * 0.66 ? 2 : w > max * 0.33 ? 1 : 0);
  const cell = (d: (typeof days)[number]): Node => {
    const lv = level(d.words);
    return box([text(String(d.date), { size: 12, weight: d.today ? 600 : 400, lineHeight: 16, align: "center", color: lv === 2 ? C.paper : lv >= 0 ? C.ink : C.meta })], {
      flexGrow: 1, flexBasis: 0, minWidth: 0, height: h, borderRadius: 10, alignItems: "center", justifyContent: "center",
      backgroundColor: lv >= 0 ? TINTS[lv]! : C.surface,
      ...(d.today ? { borderWidth: 2, borderColor: C.ink } : {}),
    }, onDay(d.i));
  };
  const blank = (): Node => box([], { flexGrow: 1, flexBasis: 0, minWidth: 0, height: h });
  const lead = days.length ? days[0]!.weekday : 0;
  const slots: Node[] = [...Array.from({ length: lead }, blank), ...days.map(cell)];
  while (slots.length % 7) slots.push(blank());
  const weeks: Node[] = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(row(slots.slice(i, i + 7), { gap: 6 }));
  return col([
    row(["M", "T", "W", "T", "F", "S", "S"].map((d) => text(d, { size: 11, weight: 600, color: C.meta, lineHeight: 14, align: "center", style: { flexGrow: 1, flexBasis: 0, minWidth: 0 } })), { gap: 6 }),
    ...weeks,
    row([
      meta("Fewer words", { size: 11 }),
      ...TINTS.map((t) => box([], { width: 14, height: 14, borderRadius: 4, backgroundColor: t })),
      meta("More", { size: 11 }),
      grow(),
      box([], { width: 14, height: 14, borderRadius: 4, borderWidth: 2, borderColor: C.ink }),
      meta("Today", { size: 11 }),
    ], { gap: 6, paddingTop: 4 }),
  ], { gap: 6 });
}

/** "‹ Earlier" and "Later ›" between pages of one kind (days), each replacing this page. */
export function pager(prev: ActionRef | undefined, next: ActionRef | undefined, labels = ["Earlier", "Later"]): Node {
  const side = (label: string, a: ActionRef | undefined, left: boolean) => row([
    ...(left ? [icon("back", { size: 14, color: a ? C.ink : C.idle })] : []),
    text(label, { size: 13, color: a ? C.ink : C.idle, lineHeight: 17 }),
    ...(!left ? [icon("chevron", { size: 14, color: a ? C.ink : C.idle })] : []),
  ], { gap: 4, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line }, a);
  return row([side(labels[0]!, prev, true), grow(), side(labels[1]!, next, false)], { gap: 8 });
}

