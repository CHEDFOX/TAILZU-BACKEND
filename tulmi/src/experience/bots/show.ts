/**
 * WHAT A BOT DREW UNDER ITS WORDS (src/show), WITH THE KIT'S OWN PARTS: THE SAME ON THE PHONE AND IN THE WINDOW, TODAY.
 *
 *   showNodes(ctx, shown, o) -> Node[]
 *
 * Every block becomes the kit's Stack, Text, SVG, Image, Grid and TextField, so no build needs anything new to draw it (lint.ts holds
 * it to that). A box hands its children the room it has (`room`, in points), so a chart, a drawing or a picture is sized to the box
 * it is in, not to the screen.
 *
 * Only the chat's LATEST turn is live (`o.live`): its choices, suggestions and form can be tapped and sent. An older turn draws the
 * same blocks still: a choice shows what the person picked (the turn after it says), and suggestions and forms, which were for that
 * moment, are left out. Asking blocks send the way the chat bar does (askMoment.ts): a tap sends its own words; several picks or a
 * form send what the screen keeps under `show.<key>` with the turn's id, and the server turns them into words (show/answer.ts).
 */
import type { ActionRef, ActionSpec, Node, SvgShape } from "../../../../shared/types/sdui.js";
import type { Block, DrawShape, Shown, Tone } from "../../show/types.js";
import { done as momentDone, failed, start as momentStart, streamed } from "./askMoment.js";
import {
  bigNumber, box, button, C, call, card, chips, col, divider, FACE, grid, heading, icon, listCard, listRow, meta, meter, mono, PALETTE_HEX,
  picture, row, sectionLabel, seq, shapes, table, text, timeline, type BotsCtx, type TimelineItem,
} from "./kit.js";
import { said } from "./said.js";

export interface ShowOpts {
  /** The chat's bot: where an answer goes. */
  slug: string;
  /** The bot turn the drawing is under (its picks are sent with it). */
  turn: string;
  /** The bot's colour: a chart's bars, a "bot" tone. */
  color: string;
  /** The chat's latest turn: its asking blocks can be used. */
  live: boolean;
  /** What the person said next, for an older turn: which options of a choice they picked. */
  picked?: string;
}

/** The screen's state for a live drawing's picks and fields, sent whole with Send. */
export const SHOW_STATE = "show";

const TONE_HEX: Record<Exclude<Tone, "bot">, string> = { info: PALETTE_HEX.sea!, tip: PALETTE_HEX.moss!, warn: PALETTE_HEX.clay!, good: PALETTE_HEX.pine! };
const toneOf = (t: Tone | undefined, bot: string): string => (!t ? C.line : t === "bot" ? bot : TONE_HEX[t]);

const PAINT: Record<string, string> = {
  none: "none", ink: C.ink, grey: C.meta, line: C.line, surface: C.surface, paper: C.paper,
  ...PALETTE_HEX,
};
const paint = (v: string | undefined, bot: string): string | undefined => (v === undefined ? undefined : v === "bot" ? bot : PAINT[v] ?? v);

const chatPath = (slug: string) => `/v1/botsapp/bots/chat/${encodeURIComponent(slug)}`;

/** Sends `body` to the bot as the chat bar does: the bubble at once, the answer streamed, the chat refreshed. */
function sendToChat(ctx: BotsCtx, slug: string, bubble: string, body: Record<string, unknown>, after: ActionSpec[] = []): ActionRef {
  const go = call("POST", chatPath(slug), body, {
    ok: seq({ kind: "setState", path: "sending", value: false }, ...after, { kind: "refresh" }, ...momentDone()),
    fail: failed({ busy: "sending", then: said("Couldn't send that. Try again.") }),
  });
  return seq(...momentStart({ message: bubble, busy: "sending" }), streamed(ctx, go));
}

/** One tap: these words, as if typed. */
const sayThis = (ctx: BotsCtx, o: ShowOpts, words: string): ActionRef => sendToChat(ctx, o.slug, words, { message: words });

/** Send: what the screen keeps for this drawing, with the turn it answers. */
const sendPicks = (ctx: BotsCtx, o: ShowOpts, bubble: string): ActionRef =>
  sendToChat(ctx, o.slug, bubble, { message: "", picks: { turn: o.turn, values: `$state.${SHOW_STATE}` } }, [{ kind: "clearState", path: SHOW_STATE }]);

/** A pick's look following state: ink when on. Pressable only when live. */
function pickChip(label: string, on: { path?: string; fixed?: boolean }, onPress?: ActionRef): Node {
  const lit = (then: string, otherwise: string): unknown => (on.path ? { truthy: on.path, then, else: otherwise } : on.fixed ? then : otherwise);
  return row([text(label, { size: 13, lineHeight: 17, style: { color: lit(C.paper, C.ink) } })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, alignSelf: "flex-start",
    borderColor: lit(C.ink, C.outline), backgroundColor: lit(C.ink, C.paper),
  }, onPress);
}

/** A next question to tap: filled grey, so it reads apart from a choice's outlined options. */
function suggestion(label: string, onPress: ActionRef): Node {
  return row([text(label, { size: 13, lineHeight: 17, color: C.grey70 })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, alignSelf: "flex-start", backgroundColor: C.surface,
  }, onPress);
}

/**
 * A text field in the kit's look (the chat's own field, parts.ts), bound to `path`. A number is typed on the ordinary keyboard: the
 * kit's only other one ("code") is the sign-in code's, which offers the last SMS code.
 */
function textField(path: string, placeholder: string): Node {
  const input: Node = {
    type: "TextField", id: path.replace(/\./g, "_"), bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 40,
      color: C.ink, returnKeyType: "done",
    },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 40, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 15, lineHeight: 21,
      color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
  return row([input], { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, backgroundColor: C.paper });
}

/** A run of numbers as bars: the label, the bar against the largest, the value. */
function bars(items: Array<{ label: string; value: number }>, unit: string | undefined, color: string): Node {
  const top = Math.max(...items.map((i) => Math.abs(i.value)), 0) || 1;
  const fmt = (v: number) => `${Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
  return col(items.map((i) => row([
    text(i.label, { size: 12, color: C.meta, lineHeight: 16, lines: 1, style: { width: 72, flexShrink: 0 } }),
    row([box([], { width: `${Math.max(2, (Math.abs(i.value) / top) * 100).toFixed(1)}%`, height: 10, borderRadius: 5, backgroundColor: color })], {
      flexGrow: 1, flexShrink: 1, minWidth: 0, height: 10, borderRadius: 5, backgroundColor: C.surface, alignItems: "stretch",
    }),
    text(fmt(i.value), { size: 12, weight: 600, lineHeight: 16, align: "right", style: { minWidth: 48, flexShrink: 0 } }),
  ], { gap: 10 })), { gap: 8 });
}

/** A line through the values, with a dot at each and the first and last labels under it. */
function line(items: Array<{ label: string; value: number }>, unit: string | undefined, color: string, room: number): Node {
  const W = 300, H = 110, pad = 8;
  const vals = items.map((i) => i.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pts = items.map((i, k) => [pad + (k * (W - 2 * pad)) / (items.length - 1), pad + (1 - (i.value - lo) / span) * (H - 2 * pad)] as const);
  const d = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const list: SvgShape[] = [
    { d: `M${pad} ${H - pad}H${W - pad}`, stroke: C.line, strokeWidth: 1 },
    { d, stroke: color, strokeWidth: 2.2, linecap: "round", linejoin: "round" },
    ...pts.map(([x, y]) => ({ circle: [x, y, 3] as [number, number, number], fill: color })),
  ];
  const w = Math.min(room, 440);
  const fmt = (v: number) => `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
  return col([
    row([meta(`${items[0]!.label} ${fmt(items[0]!.value)}`, { size: 12 }), box([], { flexGrow: 1 }), meta(`${items[items.length - 1]!.label} ${fmt(items[items.length - 1]!.value)}`, { size: 12 })]),
    shapes(list, { viewBox: `0 0 ${W} ${H}`, width: w, height: Math.round((w * H) / W) }),
    row([meta(`low ${fmt(lo)}`, { size: 11 }), box([], { flexGrow: 1 }), meta(`high ${fmt(hi)}`, { size: 11 })]),
  ], { gap: 6, width: w, maxWidth: "100%" });
}

/** A drawing on its own canvas, fitted to the room, never taller than 360. */
function drawing(b: Extract<Block, { type: "draw" }>, color: string, room: number): Node {
  let w = Math.min(room, Math.max(b.width, 160));
  let h = (w * b.height) / b.width;
  if (h > 360) { h = 360; w = (h * b.width) / b.height; }
  const list: SvgShape[] = b.shapes.map((s: DrawShape) => ({
    ...(s.circle ? { circle: s.circle } : { d: s.d! }),
    fill: paint(s.fill, color) ?? "none",
    ...(s.stroke ? { stroke: paint(s.stroke, color)!, strokeWidth: s.width ?? Math.max(b.width, b.height) / 120 } : {}),
    linecap: "round", linejoin: "round",
  }));
  const pic = shapes(list, { viewBox: `0 0 ${b.width} ${b.height}`, width: Math.round(w), height: Math.round(h), ...(b.label ? { label: b.label } : {}) });
  return b.label ? col([pic, meta(b.label, { size: 12 })], { gap: 6, alignSelf: "flex-start" }) : pic;
}

function asking(ctx: BotsCtx, b: Extract<Block, { type: "choice" }>, o: ShowOpts): Node | null {
  const head = b.question ? [text(b.question, { size: 14, weight: 500, lineHeight: 19 })] : [];
  const picked = (label: string): boolean => !!o.picked && (b.multi ? o.picked.split(/,\s*|\n/).includes(label) : o.picked.trim() === label);
  const notes = b.options.some((x) => x.note);
  if (!o.live) {
    return col([...head, row(b.options.map((x) => pickChip(x.label, { fixed: picked(x.label) })), { gap: 8, flexWrap: "wrap" })], { gap: 8 });
  }
  if (b.multi) {
    const path = (i: number) => `${SHOW_STATE}.${b.key}.o${i}`;
    return col([
      ...head,
      row(b.options.map((x, i) => pickChip(x.label, { path: path(i) }, { kind: "toggleState", path: path(i) })), { gap: 8, flexWrap: "wrap" }),
      button(b.send, sendPicks(ctx, o, b.send), { kind: "primary", size: "md" }),
    ], { gap: 10 });
  }
  if (notes) return col([...head, listCard(b.options.map((x) => listRow({ label: x.label, ...(x.note ? { sub: x.note } : {}), onPress: sayThis(ctx, o, x.label) })))], { gap: 8 });
  return col([...head, row(b.options.map((x) => pickChip(x.label, {}, sayThis(ctx, o, x.label))), { gap: 8, flexWrap: "wrap" })], { gap: 8 });
}

function form(ctx: BotsCtx, b: Extract<Block, { type: "form" }>, o: ShowOpts): Node {
  const fields = b.fields.map((f, i) => {
    const path = `${SHOW_STATE}.${b.key}.f${i}`;
    return col([
      text(f.label, { size: 12, weight: 600, color: C.meta, lineHeight: 16 }),
      f.kind === "choice" ? chips((f.options ?? []).map((x) => ({ label: x, value: x })), path) : textField(path, f.placeholder ?? ""),
    ], { gap: 6 });
  });
  return card([
    ...(b.title ? [text(b.title, { size: 15, weight: 600, lineHeight: 20 })] : []),
    ...fields,
    button(b.send, sendPicks(ctx, o, b.send), { kind: "primary", size: "md" }),
  ], { padding: 14, gap: 12 });
}

function node(ctx: BotsCtx, b: Block, o: ShowOpts, room: number): Node | null {
  switch (b.type) {
    case "text":
      switch (b.style) {
        case "title": return heading(b.text);
        case "heading": return text(b.text, { size: 16, weight: 600, lineHeight: 21 });
        case "label": return sectionLabel(b.text);
        case "meta": return meta(b.text, { size: 13, lineHeight: 18 });
        case "big": return bigNumber(b.text, { size: 30, lineHeight: 36 });
        case "mono": return mono(b.text);
        default: return text(b.text, { size: 14, lineHeight: 20 });
      }
    case "callout": {
      const hue = toneOf(b.tone, o.color);
      return col([
        ...(b.title ? [text(b.title, { size: 13, weight: 600, color: hue, lineHeight: 18 })] : []),
        ...(b.text ? [text(b.text, { size: 14, lineHeight: 20 })] : []),
      ], { gap: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: hue, backgroundColor: C.paper });
    }
    case "list":
      return col(b.items.map((item, i) => row([
        b.style === "check" ? box([icon("check", { size: 14, color: o.color })], { width: 18, height: 20, justifyContent: "center" })
          : text(b.style === "number" ? `${i + 1}.` : "•", { size: 14, color: C.meta, lineHeight: 20, style: { width: 18, flexShrink: 0 } }),
        text(item, { size: 14, lineHeight: 20, style: { flexShrink: 1 } }),
      ], { gap: 6, alignItems: "flex-start" })), { gap: 6 });
    case "facts": return listCard(b.items.map((f) => listRow({ label: f.label, value: f.value, chevron: false })));
    case "table":
      if (ctx.client === "desktop" || b.columns.length <= 3) return table(b.columns.map((c, j) => ({ label: c, ...(j ? {} : { flex: 1.4 }) })), b.rows);
      // Too many columns for a phone: a card a row, the first cell its name, the rest under it.
      return listCard(b.rows.map((r) => listRow({ label: r[0] || "—", sub: r.slice(1).map((c, j) => (c ? `${b.columns[j + 1]}: ${c}` : "")).filter(Boolean).join(" · "), chevron: false })));
    case "stat":
      return col([
        meta(b.label, { size: 12 }),
        text(b.value, { size: 24, weight: 700, tracking: -0.4, lineHeight: 30 }),
        ...(b.note ? [meta(b.note, { size: 12 })] : []),
      ], { gap: 2, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, flexGrow: 1, flexBasis: 0, minWidth: 96 });
    case "progress": {
      const pct = Math.round((b.value / b.max) * 100);
      return meter(b.value, b.max, { label: b.label ?? "", valueText: `${pct}%`, color: o.color });
    }
    case "steps":
      return timeline(b.items.map((s): TimelineItem => ({
        mark: s.state === "done" ? "done" : s.state === "now" ? "working" : "waiting", color: o.color, title: s.title, ...(s.note ? { meta: s.note } : {}),
      })));
    case "chart": return b.kind === "line" ? line(b.items, b.unit, o.color, room) : bars(b.items, b.unit, o.color);
    case "draw": return drawing(b, o.color, room);
    case "image": {
      const w = Math.min(room, 440);
      return picture(b.url, Math.round(w), Math.round(w * 0.6), { radius: 12, fit: "cover", label: b.alt, background: C.surface });
    }
    case "link": return button(b.label, { kind: "openUrl", url: b.url, external: true }, { kind: "secondary", size: "md", icon: "link" });
    case "divider": return divider();
    case "row": {
      const each = Math.max(96, (room - 10 * (b.children.length - 1)) / b.children.length);
      const kids = b.children.map((c) => node(ctx, c, o, each)).filter((n): n is Node => !!n);
      return kids.length ? row(kids.map((k) => box([k], { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 96 })), { gap: 10, alignItems: "stretch", flexWrap: "wrap" }) : null;
    }
    case "grid": {
      const each = (room - 10 * (b.columns - 1)) / b.columns;
      const kids = b.children.map((c) => node(ctx, c, o, each)).filter((n): n is Node => !!n);
      return kids.length ? grid(kids, b.columns, 10) : null;
    }
    case "card": {
      const kids = b.children.map((c) => node(ctx, c, o, room - 28)).filter((n): n is Node => !!n);
      if (!kids.length) return null;
      return card([...(b.title ? [text(b.title, { size: 15, weight: 600, lineHeight: 20 })] : []), ...kids], {
        padding: 14, gap: 10, radius: 16, ...(b.tone ? { style: { borderLeftWidth: 3, borderLeftColor: toneOf(b.tone, o.color) } } : {}),
      });
    }
    case "choice": return asking(ctx, b, o);
    case "suggest":
      return o.live ? row(b.items.map((s) => suggestion(s, sayThis(ctx, o, s))), { gap: 8, flexWrap: "wrap" }) : null;
    case "form": return o.live ? form(ctx, b, o) : null;
    default: return null;
  }
}

/** The room a bot's answer has: the phone's column, the window's answer beside the bot's avatar. */
const roomOf = (ctx: BotsCtx): number => (ctx.client === "desktop" ? 560 : 320);

/** What a bot drew, as the kit's nodes, for under its words. */
export function showNodes(ctx: BotsCtx, shown: Shown, o: ShowOpts): Node[] {
  const room = roomOf(ctx);
  return shown.blocks.map((b) => node(ctx, b, o, room)).filter((n): n is Node => !!n);
}
