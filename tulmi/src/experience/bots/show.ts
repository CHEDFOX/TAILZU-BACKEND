/**
 * WHAT A BOT DREW UNDER ITS WORDS (src/show), IN ONE LOOK: MONOCHROME, MINIMAL DOT ART, WITH DOTS THAT OBEY PHYSICS.
 *
 *   showNodes(ctx, shown, o) -> Node[]
 *
 * Whatever a bot draws, it is drawn the same way: ink on paper, greys for what matters less, no colour, and dots wherever there is a
 * picture. A chart's bars are rows of dots, a line is dotted, a meter is a row of dots, a model's drawing is dotted along its
 * outlines and filled with dots (show/dots.ts); steps are beads on a dotted thread, bullets and the marks of a pick are dots, a
 * callout wears a small dotted mark and a dotted edge, a box a dotted edge.
 *
 * THE MOTION IS SPRINGS, WITH NOTHING NEW IN THE APPS. A picture is its dots cut into pieces, stacked on one canvas, each piece a
 * Rise (the node the sign-in and Home come in with): on the phone a real damped spring with the stiffness, damping and mass the
 * server gives it, its own delay, its own travel; the window plays the same delay and travel eased in CSS. How a picture comes in
 * suits it (SPRING): a bar and a meter in short runs left to right, growing from small; a line segment by segment, dropping in from
 * above; a drawing shape by shape, gathering from its middle. Only an answer that has just come in (`fresh`) comes in; any other is
 * drawn at home. On the newest answer a tap on a picture brings its dots in again on their springs (`taps.<key>` swaps two faces of
 * it, so a tap mounts a new one). A build without BotsMotion gets the same dots, still. Blip, when the drawing asks for him
 * (`shown.blip`), stands beside the first picture: on the newest answer a living bot of the engine's own physics (BotBuddy), in
 * ink; on an older answer, or a build without him alive, his pose's picture.
 *
 * Every node is the kit's Stack, Text, SVG, Image, Grid, TextField and Rise, or BotBuddy for the builds that say it (lint.ts holds it
 * to that), so no app needs anything new (docs/renderer.md section 2). Every Rise and BotBuddy carries a `fallback` (the same dots
 * still, his pose), so a client that lacks one or has it switched off (`sdui.off`) still draws the picture. A chat screen hands its
 * turns one dot budget (`budget`, newest answer first) and a picture is thinned to what is left, so a long chat stays inside the
 * screen limits (512 KB). A box hands its children the room it has (`room`, points), so a picture fits its box.
 *
 * Only the LATEST turn is live (`o.live`): its choices, suggestions and form can be tapped and sent. An older turn draws the same
 * blocks still: a choice shows what the person picked (the turn after it says), and suggestions and forms are left out. Asking blocks
 * send the way the chat bar does (askMoment.ts): a tap sends its own words; several picks or a form send what the screen keeps under
 * `show.<key>` with the turn's id, and the server turns them into words (show/answer.ts).
 */
import type { ActionRef, ActionSpec, Condition, Node, SvgShape } from "../../../../shared/types/sdui.js";
import { BAR_ROW, barsPic, drawPic, glyphPic, linePic, meterPic, thinPic, type DotPic, type GlyphKind } from "../../show/dots.js";
import type { Block, BlipAct, Shown } from "../../show/types.js";
import type { BlipPose } from "./art.js";
import { done as momentDone, failed, start as momentStart, streamed } from "./askMoment.js";
import {
  bigNumber, blip, botBuddy, box, button, C, call, canBuddy, canMove, card, chips, col, FACE, grid, heading, labelled, listCard, listRow,
  meta, mono, picture, row, sectionLabel, seq, shapes, table, text, when, type BotsCtx,
} from "./kit.js";
import { said } from "./said.js";

export interface ShowOpts {
  /** The chat's bot: where an answer goes. */
  slug: string;
  /** The bot turn the drawing is under (its picks are sent with it; its pictures are kept under it). */
  turn: string;
  /** The chat's latest turn: its asking blocks can be used, and Blip is alive beside it. */
  live: boolean;
  /** The answer has just come in: its pictures spring in. Any other is drawn at home. */
  fresh?: boolean;
  /** What is left of the screen's dot budget, shared by every turn of a chat (each copy of a dot counts); none: no limit. */
  budget?: { left: number };
  /** What the person said next, for an older turn: which options of a choice they picked. */
  picked?: string;
}

/** The screen's state for a live drawing's picks and fields, sent whole with Send. */
export const SHOW_STATE = "show";

/**
 * How each kind of picture springs in: how its dots are cut into pieces (`by`), how far a piece travels (`fromY`, points; below 0 it
 * drops in from above) and from what size it grows (`scaleFrom`, about the picture's middle), the spring (stiffness, damping, mass:
 * lower damping overshoots more), and how long after the piece before it it is let go (`stepMs`; `rowMs` more for each bar).
 */
export const SPRING = {
  bars: { by: "runs", run: 5, fromY: 10, scaleFrom: 0.35, stiffness: 220, damping: 11, mass: 0.7, stepMs: 32, rowMs: 70 },
  meter: { by: "runs", run: 4, fromY: 8, scaleFrom: 0.45, stiffness: 220, damping: 12, mass: 0.7, stepMs: 30, rowMs: 0 },
  line: { by: "groups", run: 0, fromY: -40, scaleFrom: 1, stiffness: 170, damping: 9, mass: 0.8, stepMs: 70, rowMs: 0 },
  draw: { by: "groups", run: 0, fromY: 0, scaleFrom: 0.55, stiffness: 140, damping: 9, mass: 0.9, stepMs: 80, rowMs: 0 },
} as const;
export type SpringKind = keyof typeof SPRING;

/** The most pieces a picture is cut into (each a Rise), and the most dots a picture may have to answer a tap (it is sent once more). */
const MAX_PIECES = 12;
const TAP_DOTS = 400;
/** A picture thinned below this many dots is not worth drawing: its words (labels, values, caption) stand alone. */
const MIN_DOTS = 24;

/** A dotted edge: the kit's dotted border (a build without KitExtras may draw a dotted radius dashed or solid). */
const dottedEdge = (color: string = C.dashed, width = 1.5) => ({ borderWidth: width, borderStyle: "dotted", borderColor: color });

// ===================================================================== dots

/** A picture's dots cut into pieces in the order they come in: runs along each row (bars, a meter) or its groups (a line, a drawing). */
export function piecesOf(pic: DotPic, kind: SpringKind): Array<{ pic: DotPic; delayMs: number }> {
  const sp = SPRING[kind];
  const n = pic.d.length / 5;
  const keyed = new Map<string, { idx: number[]; delayMs: number; order: number }>();
  const byGroup = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const g = pic.d[i * 5 + 4]!;
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(i);
  }
  const groups = [...byGroup.keys()].sort((a, b) => a - b);
  groups.forEach((g, gi) => {
    const idx = byGroup.get(g)!;
    if (sp.by === "runs") {
      const sorted = [...idx].sort((a, b) => pic.d[a * 5]! - pic.d[b * 5]!);
      for (let k = 0; k < sorted.length; k += sp.run) {
        const r = k / sp.run;
        keyed.set(`${g}:${r}`, { idx: sorted.slice(k, k + sp.run), delayMs: gi * sp.rowMs + r * sp.stepMs, order: keyed.size });
      }
    } else {
      keyed.set(String(g), { idx, delayMs: gi * sp.stepMs, order: keyed.size });
    }
  });
  // Too many pieces: neighbours share one (the earlier one's delay), so a picture is never more than MAX_PIECES springs.
  const list = [...keyed.values()].sort((a, b) => a.delayMs - b.delayMs || a.order - b.order);
  const per = Math.ceil(list.length / MAX_PIECES);
  const out: Array<{ pic: DotPic; delayMs: number }> = [];
  for (let k = 0; k < list.length; k += per) {
    const part = list.slice(k, k + per);
    const d: number[] = [];
    for (const p of part) for (const i of p.idx) d.push(...pic.d.slice(i * 5, i * 5 + 5));
    out.push({ pic: { w: pic.w, h: pic.h, d }, delayMs: Math.round(part[0]!.delayMs) });
  }
  return out;
}

/**
 * The picture springing in: its pieces stacked on one canvas, each a Rise with its own delay and the spring that suits the picture.
 * `fallback`: each Rise also carries its dots still, for a client that lacks Rise or has it switched off (docs/renderer.md section 4).
 */
function springIn(pic: DotPic, kind: SpringKind, fallback: boolean): Node {
  const sp = SPRING[kind];
  const at = { position: "absolute", left: 0, top: 0, width: pic.w, height: pic.h };
  return box(piecesOf(pic, kind).map((p) => {
    const still = stillDots(p.pic)!;
    return {
      type: "Rise",
      props: { delayMs: p.delayMs, fromY: sp.fromY, scaleFrom: sp.scaleFrom, stiffness: sp.stiffness, damping: sp.damping, mass: sp.mass },
      style: at,
      children: [still],
      ...(fallback ? { fallback: { ...still, style: { ...(still.style ?? {}), ...at } } } : {}),
    };
  }), { width: pic.w, height: pic.h, position: "relative", flexShrink: 0 });
}

/**
 * A picture of dots, as the build can: springing in when its answer has just come in, and on the newest answer answering a tap by
 * springing its dots in again (two faces swapped by `taps.<key>`, so a tap mounts the other one); still on a build without
 * BotsMotion. It takes what it can of the screen's dot budget, every copy of a dot counted, and is thinned to fit.
 */
function dotsNode(ctx: BotsCtx, pic0: DotPic, o: { kind: SpringKind; key: string; fresh: boolean; live: boolean; budget?: { left: number }; label?: string }): Node | null {
  const n0 = pic0.d.length / 5;
  if (!n0) return null;
  const moves = canMove(ctx);
  const tappable = moves && o.live && n0 <= TAP_DOTS;
  // Copies of every dot this picture sends: the first face (with its fallback when it springs), and the tap's face.
  const copies = (moves && o.fresh ? 2 : 1) + (tappable ? 1 : 0);
  const fits = o.budget ? Math.floor(o.budget.left / copies) : n0;
  if (fits < Math.min(MIN_DOTS, n0)) return null;
  const pic = thinPic(pic0, fits);
  if (o.budget) o.budget.left -= (pic.d.length / 5) * copies;
  if (!moves) return stillDots(pic, o.label);
  const first = o.fresh ? springIn(pic, o.kind, true) : stillDots(pic)!;
  if (!tappable) return o.label ? labelled(first, o.label) : first;
  const path = `taps.${o.key.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const face = (c: Condition, n: Node): Node => when(c, n);
  const node = box([
    face({ falsy: path }, first),
    face({ truthy: path }, springIn(pic, o.kind, false)),
  ], { width: pic.w, height: pic.h, flexShrink: 0 }, { kind: "toggleState", path });
  return o.label ? labelled(node, o.label) : node;
}

/** The same dots, still: one SVG of circles (a long picture thinned to 700, which an older build draws one by one). */
function stillDots(pic: DotPic, label?: string): Node | null {
  const n = pic.d.length / 5;
  if (!n) return null;
  const every = Math.max(1, Math.ceil(n / 700));
  const list: SvgShape[] = [];
  for (let i = 0; i < n; i += every) {
    const o = i * 5;
    list.push({ circle: [pic.d[o]!, pic.d[o + 1]!, pic.d[o + 2]!], fill: C.ink, ...(pic.d[o + 3]! < 1 ? { opacity: pic.d[o + 3]! } : {}) });
  }
  return shapes(list, { viewBox: `0 0 ${pic.w} ${pic.h}`, width: pic.w, height: pic.h, ...(label ? { label } : {}) });
}

/** A dot made of a box: a bead, a bullet, a pick's mark. `ring`: hollow (`fill` may follow state). */
const dot = (size: number, o: { ring?: boolean; color?: string; fill?: unknown } = {}): Node => box([], {
  width: size, height: size, borderRadius: size / 2, flexShrink: 0,
  ...(o.ring ? { borderWidth: 1.5, borderColor: o.color ?? C.ink, backgroundColor: o.fill ?? "transparent" } : { backgroundColor: o.color ?? C.ink }),
});

/** A thread of tiny dots that stretches with its row (steps). */
const thread = (): Node => col(Array.from({ length: 5 }, () => dot(2, { color: C.idle })), {
  flexGrow: 1, minHeight: 12, alignItems: "center", justifyContent: "space-around", paddingVertical: 2,
});

// ===================================================================== sending

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

// ===================================================================== parts

/** A pick: its dot mark (a ring, filled when picked) and its label in an outlined pill. Pressable only when live. */
function pickChip(label: string, on: { path?: string; fixed?: boolean }, onPress?: ActionRef): Node {
  const lit = (then: unknown, otherwise: unknown): unknown => (on.path ? { truthy: on.path, then, else: otherwise } : on.fixed ? then : otherwise);
  return row([
    dot(9, { ring: true, fill: lit(C.ink, "transparent") }),
    text(label, { size: 13, lineHeight: 17 }),
  ], {
    gap: 8, paddingVertical: 8, paddingLeft: 11, paddingRight: 14, borderRadius: 18, borderWidth: 1, alignSelf: "flex-start",
    borderColor: lit(C.ink, C.outline), backgroundColor: C.paper,
  }, onPress);
}

/** A next question to tap: a grey pill with a small dot, so it reads apart from a choice's outlined options. */
function suggestion(label: string, onPress: ActionRef): Node {
  return row([dot(4, { color: C.idle }), text(label, { size: 13, lineHeight: 17, color: C.grey70 })], {
    gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, alignSelf: "flex-start", backgroundColor: C.surface,
  }, onPress);
}

/** A text field in the kit's look (the chat's own field, parts.ts), bound to `path`. A number is typed on the ordinary keyboard. */
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

const fmtNum = (v: number, unit?: string) =>
  `${Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
const spoken = (b: Extract<Block, { type: "chart" }>) => b.items.map((i) => `${i.label} ${fmtNum(i.value, b.unit)}`).join(", ");

/** Bars of dots: the labels, the dots, the values, row by row. */
function bars(ctx: BotsCtx, b: Extract<Block, { type: "chart" }>, room: number, o: ShowOpts, key: string): Node {
  const label = 72, value = 52, gapW = 10;
  const pic = barsPic(b.items, Math.max(80, Math.min(room, 520) - label - value - gapW * 2));
  const cell = (s: string, right = false, strong = false) =>
    text(s, { size: 12, weight: strong ? 600 : 400, color: strong ? C.ink : C.meta, lineHeight: BAR_ROW, lines: 1, ...(right ? { align: "right" as const } : {}), style: { height: BAR_ROW } });
  return row([
    col(b.items.map((i) => cell(i.label)), { width: label, flexShrink: 0 }),
    dotsNode(ctx, pic, { kind: "bars", key, fresh: !!o.fresh, live: o.live, ...(o.budget ? { budget: o.budget } : {}), label: spoken(b) }) ?? box([]),
    col(b.items.map((i) => cell(fmtNum(i.value, b.unit), true, true)), { width: value, flexShrink: 0, alignItems: "flex-end" }),
  ], { gap: gapW, alignItems: "flex-start" });
}

/** A dotted line through the values, its first and last above it, its low and high below. */
function line(ctx: BotsCtx, b: Extract<Block, { type: "chart" }>, room: number, o: ShowOpts, key: string): Node {
  const w = Math.min(room, 440);
  const vals = b.items.map((i) => i.value);
  const first = b.items[0]!, last = b.items[b.items.length - 1]!;
  return col([
    row([meta(`${first.label} ${fmtNum(first.value, b.unit)}`, { size: 12 }), box([], { flexGrow: 1 }), meta(`${last.label} ${fmtNum(last.value, b.unit)}`, { size: 12 })]),
    dotsNode(ctx, linePic(b.items, w), { kind: "line", key, fresh: !!o.fresh, live: o.live, ...(o.budget ? { budget: o.budget } : {}), label: spoken(b) }) ?? box([]),
    row([meta(`low ${fmtNum(Math.min(...vals), b.unit)}`, { size: 11 }), box([], { flexGrow: 1 }), meta(`high ${fmtNum(Math.max(...vals), b.unit)}`, { size: 11 })]),
  ], { gap: 6, width: w, maxWidth: "100%" });
}

/** A drawing fitted to the room (never taller than 360), dotted, with its caption under it. */
function drawing(ctx: BotsCtx, b: Extract<Block, { type: "draw" }>, room: number, o: ShowOpts, key: string): Node | null {
  let w = Math.min(room, Math.max(b.width, 160));
  if ((w * b.height) / b.width > 360) w = (360 * b.width) / b.height;
  const pic = dotsNode(ctx, drawPic(b, Math.round(w)), { kind: "draw", key, fresh: !!o.fresh, live: o.live, ...(o.budget ? { budget: o.budget } : {}), ...(b.label ? { label: b.label } : {}) });
  if (!pic) return null;
  return b.label ? col([pic, meta(b.label, { size: 12 })], { gap: 6, alignSelf: "flex-start" }) : pic;
}

/** A callout: a dotted edge (ink for a warning), its dotted mark and title, its words. */
function callout(b: Extract<Block, { type: "callout" }>): Node {
  const kind: GlyphKind = b.tone === "bot" ? "info" : b.tone;
  const mark = stillDots(glyphPic(kind, 14));
  return col([
    row([...(mark ? [mark] : []), ...(b.title ? [text(b.title, { size: 13, weight: 600, lineHeight: 18, style: { flexShrink: 1 } })] : [])], { gap: 8 }),
    ...(b.text ? [text(b.text, { size: 14, lineHeight: 20 })] : []),
  ], { gap: 6, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, ...dottedEdge(b.tone === "warn" ? C.ink : C.dashed), backgroundColor: C.paper });
}

/** Steps: a bead each (done inked, now a ring round a dot, next a faint ring) on a dotted thread. */
function steps(b: Extract<Block, { type: "steps" }>): Node {
  return col(b.items.map((s, i) => {
    const bead = s.state === "done" ? dot(9)
      : s.state === "now" ? box([dot(4)], { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" })
      : dot(9, { ring: true, color: C.idle });
    return row([
      col([box([bead], { height: 20, justifyContent: "center", alignItems: "center" }), ...(i < b.items.length - 1 ? [thread()] : [])], { width: 14, alignItems: "center", alignSelf: "stretch" }),
      col([
        text(s.title, { size: 15, lineHeight: 20, color: s.state === "next" ? C.grey70 : C.ink }),
        ...(s.note ? [meta(s.note)] : []),
      ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 3, paddingBottom: i < b.items.length - 1 ? 14 : 0 }),
    ], { gap: 12, alignItems: "flex-start" });
  }));
}

function asking(ctx: BotsCtx, b: Extract<Block, { type: "choice" }>, o: ShowOpts): Node | null {
  const head = b.question ? [text(b.question, { size: 14, weight: 500, lineHeight: 19 })] : [];
  const picked = (label: string): boolean => !!o.picked && (b.multi ? o.picked.split(/,\s*|\n/).includes(label) : o.picked.trim() === label);
  const notes = b.options.some((x) => x.note);
  if (!o.live) return col([...head, row(b.options.map((x) => pickChip(x.label, { fixed: picked(x.label) })), { gap: 8, flexWrap: "wrap" })], { gap: 8 });
  if (b.multi) {
    const path = (i: number) => `${SHOW_STATE}.${b.key}.o${i}`;
    return col([
      ...head,
      row(b.options.map((x, i) => pickChip(x.label, { path: path(i) }, { kind: "toggleState", path: path(i) })), { gap: 8, flexWrap: "wrap" }),
      button(b.send, sendPicks(ctx, o, b.send), { kind: "primary", size: "md" }),
    ], { gap: 10 });
  }
  if (notes) {
    return col([...head, listCard(b.options.map((x) => listRow({ label: x.label, ...(x.note ? { sub: x.note } : {}), left: dot(9, { ring: true }), onPress: sayThis(ctx, o, x.label) })))], { gap: 8 });
  }
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
  ], { padding: 14, gap: 12, style: dottedEdge() });
}

function node(ctx: BotsCtx, b: Block, o: ShowOpts, room: number, key: string): Node | null {
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
    case "callout": return callout(b);
    case "list":
      return col(b.items.map((item, i) => row([
        box([b.style === "number" ? text(`${i + 1}.`, { size: 13, color: C.meta, lineHeight: 20 }) : b.style === "check" ? dot(9, { ring: true }) : dot(5)], {
          width: 18, height: 20, justifyContent: "center", alignItems: b.style === "number" ? "flex-start" : "center", flexShrink: 0,
        }),
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
      // Sized by what holds it (a row shares its width out): a stat of its own sets no flex of its own, so a column never squashes it.
      ], { gap: 2, padding: 14, borderRadius: 14, ...dottedEdge(), alignSelf: "stretch" });
    case "progress": {
      const w = Math.min(room, 440);
      const pct = Math.round((b.value / b.max) * 100);
      return col([
        row([meta(b.label ?? "", { size: 12 }), box([], { flexGrow: 1 }), text(`${pct}%`, { size: 12, weight: 600, lineHeight: 16 })]),
        dotsNode(ctx, meterPic(b.value, b.max, w), { kind: "meter", key, fresh: !!o.fresh, live: o.live, ...(o.budget ? { budget: o.budget } : {}), label: `${b.label ? `${b.label} ` : ""}${pct}%` }) ?? box([]),
      ], { gap: 6, width: w, maxWidth: "100%" });
    }
    case "steps": return steps(b);
    case "chart": return b.kind === "line" ? line(ctx, b, room, o, key) : bars(ctx, b, room, o, key);
    case "draw": return drawing(ctx, b, room, o, key);
    case "image": {
      const w = Math.min(room, 440);
      return picture(b.url, Math.round(w), Math.round(w * 0.6), { radius: 12, fit: "cover", label: b.alt, background: C.surface });
    }
    case "link": return button(b.label, { kind: "openUrl", url: b.url, external: true }, { kind: "secondary", size: "md", icon: "link" });
    case "divider": {
      const w = Math.min(room, 440), n = Math.floor(w / 7);
      return stillDots({ w, h: 4, d: Array.from({ length: n }, (_v, i) => [3 + i * 7, 2, 1, 0.36, 0]).flat() });
    }
    case "row": {
      const each = Math.max(96, (room - 10 * (b.children.length - 1)) / b.children.length);
      const kids = b.children.map((c, i) => node(ctx, c, o, each, `${key}.${i}`)).filter((n): n is Node => !!n);
      return kids.length ? row(kids.map((k) => box([k], { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 96 })), { gap: 10, alignItems: "stretch", flexWrap: "wrap" }) : null;
    }
    case "grid": {
      const each = (room - 10 * (b.columns - 1)) / b.columns;
      const kids = b.children.map((c, i) => node(ctx, c, o, each, `${key}.${i}`)).filter((n): n is Node => !!n);
      return kids.length ? grid(kids, b.columns, 10) : null;
    }
    case "card": {
      const kids = b.children.map((c, i) => node(ctx, c, o, room - 28, `${key}.${i}`)).filter((n): n is Node => !!n);
      if (!kids.length) return null;
      return card([...(b.title ? [text(b.title, { size: 15, weight: 600, lineHeight: 20 })] : []), ...kids], {
        padding: 14, gap: 10, radius: 16, style: dottedEdge(b.tone === "warn" ? C.ink : C.dashed),
      });
    }
    case "choice": return asking(ctx, b, o);
    case "suggest": return o.live ? row(b.items.map((s) => suggestion(s, sayThis(ctx, o, s))), { gap: 8, flexWrap: "wrap" }) : null;
    case "form": return o.live ? form(ctx, b, o) : null;
    default: return null;
  }
}

// ===================================================================== Blip

/** His pose's picture, for a build that cannot have him alive, and for an older answer. */
const POSE: Record<BlipAct, BlipPose> = { survey: "hello", read: "listen", think: "think", wave: "done" };
const BLIP_W = { phone: 60, desktop: 84 } as const;

/** Blip beside a drawing: alive (the engine's own physics, in ink) on the newest answer where the build has him, else his pose. */
function blipNode(ctx: BotsCtx, act: BlipAct, o: ShowOpts): Node {
  const desk = ctx.client === "desktop";
  const pose = box([blip(POSE[act], desk ? 60 : 52)], { width: BLIP_W[ctx.client], alignItems: "center", flexShrink: 0 });
  if (o.live && canBuddy(ctx)) {
    // His pose's picture as the fallback, for a client that has BotBuddy switched off.
    return { ...botBuddy({
      kind: "custom", color: C.ink, life: `show.${o.turn}`, width: BLIP_W[ctx.client], height: desk ? 66 : 56, size: desk ? 34 : 30,
      state: "idle", act, lookTo: "left", label: "Blip",
    }), fallback: pose };
  }
  return pose;
}

/** The blocks Blip may stand beside: the pictures, and what asks something of the person. */
const BESIDE = new Set<Block["type"]>(["chart", "draw", "steps", "progress", "callout", "choice", "form", "stat", "row", "grid", "card"]);

/** The room a bot's answer has: the phone's column, the window's answer beside the bot's avatar. */
const roomOf = (ctx: BotsCtx): number => (ctx.client === "desktop" ? 560 : 320);

/** What a bot drew, as the kit's nodes, for under its words. */
export function showNodes(ctx: BotsCtx, shown: Shown, o: ShowOpts): Node[] {
  const room = roomOf(ctx);
  const at = shown.blip ? shown.blocks.findIndex((b) => BESIDE.has(b.type)) : -1;
  const out: Node[] = [];
  shown.blocks.forEach((b, i) => {
    if (i !== at) {
      const n = node(ctx, b, o, room, `${o.turn}.${i}`);
      if (n) out.push(n);
      return;
    }
    const n = node(ctx, b, o, room - BLIP_W[ctx.client] - 8, `${o.turn}.${i}`);
    if (!n) return;
    // He stands right beside the picture (not at the far edge of a wide answer), on its baseline.
    out.push(row([box([n], { flexShrink: 1, minWidth: 0 }), blipNode(ctx, shown.blip!, o)], { gap: 8, alignItems: "flex-end" }));
  });
  return out;
}
