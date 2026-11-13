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
 * THE MOTION IS PHYSICS. A picture goes to the DotArt node (shared/types/sdui.ts 3k) on a build that has it: every dot a point mass on
 * a damped spring, coming in by gravity (a line's dots fall onto it), by springs let go in order (a bar grows from the left, a meter
 * fills), or gathered from scattered places (a drawing), scattered by a touch and brought home again, a drawing trembling a little
 * as if warm. Only the chat's newest answer comes in; an older one is drawn at home. A build without DotArt gets the very same dots,
 * still. Blip, when the drawing asks for him (`shown.blip`), stands beside the first picture: on the newest answer a living bot of
 * the engine's own physics (BotBuddy), in ink; on an older answer, or a build without him alive, his pose's picture.
 *
 * Every node is the kit's Stack, Text, SVG, Image, Grid and TextField, or DotArt and BotBuddy for the builds that say them (lint.ts
 * holds it to that). A box hands its children the room it has (`room`, points), so a picture fits the box it is in.
 *
 * Only the LATEST turn is live (`o.live`): its choices, suggestions and form can be tapped and sent. An older turn draws the same
 * blocks still: a choice shows what the person picked (the turn after it says), and suggestions and forms are left out. Asking blocks
 * send the way the chat bar does (askMoment.ts): a tap sends its own words; several picks or a form send what the screen keeps under
 * `show.<key>` with the turn's id, and the server turns them into words (show/answer.ts).
 */
import type { ActionRef, ActionSpec, DotArtProps, Node, SvgShape } from "../../../../shared/types/sdui.js";
import { DOT_ART_COMPONENT } from "../../../../shared/types/sdui.js";
import { BAR_ROW, barsPic, drawPic, glyphPic, linePic, meterPic, type DotPic, type GlyphKind } from "../../show/dots.js";
import type { Block, BlipAct, Shown } from "../../show/types.js";
import type { BlipPose } from "./art.js";
import { done as momentDone, failed, start as momentStart, streamed } from "./askMoment.js";
import {
  bigNumber, blip, botBuddy, box, button, C, call, canBuddy, card, chips, col, FACE, grid, heading, listCard, listRow, meta, mono,
  picture, row, sectionLabel, seq, shapes, table, text, type BotsCtx,
} from "./kit.js";
import { said } from "./said.js";

export interface ShowOpts {
  /** The chat's bot: where an answer goes. */
  slug: string;
  /** The bot turn the drawing is under (its picks are sent with it; its pictures are kept under it). */
  turn: string;
  /** The chat's latest turn: its asking blocks can be used, and its pictures come in. */
  live: boolean;
  /** What the person said next, for an older turn: which options of a choice they picked. */
  picked?: string;
}

/** The screen's state for a live drawing's picks and fields, sent whole with Send. */
export const SHOW_STATE = "show";

/** How a picture comes in, and how warm it is, by what it is: physics chosen to suit it, never a timed curve. */
export const MOTION = {
  bars: { enter: "grow", heat: 0 },
  line: { enter: "fall", heat: 0 },
  meter: { enter: "grow", heat: 0 },
  draw: { enter: "gather", heat: 0.25 },
} as const satisfies Record<string, { enter: NonNullable<DotArtProps["enter"]>; heat: number }>;

/** A dotted edge: the kit's dotted border (a build without KitExtras may draw a dotted radius dashed or solid). */
const dottedEdge = (color: string = C.dashed, width = 1.5) => ({ borderWidth: width, borderStyle: "dotted", borderColor: color });

// ===================================================================== dots

/** A picture of dots: DotArt where the build has it (physics), else the same dots as an SVG's circles, still. */
function dotsNode(ctx: BotsCtx, pic: DotPic, o: { motion: keyof typeof MOTION; key: string; live: boolean; label?: string }): Node | null {
  if (!pic.d.length) return null;
  if (ctx.can.has(DOT_ART_COMPONENT)) {
    const m = MOTION[o.motion];
    const props: DotArtProps = {
      w: pic.w, h: pic.h, d: pic.d, enter: o.live ? m.enter : "none", ...(o.live && m.heat ? { heat: m.heat } : {}), key: o.key, ...(o.label ? { label: o.label } : {}),
    };
    return { type: DOT_ART_COMPONENT, props: { ...props }, style: { width: pic.w, height: pic.h, flexShrink: 0 } };
  }
  return stillDots(pic, o.label);
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
    dotsNode(ctx, pic, { motion: "bars", key, live: o.live, label: spoken(b) }) ?? box([]),
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
    dotsNode(ctx, linePic(b.items, w), { motion: "line", key, live: o.live, label: spoken(b) }) ?? box([]),
    row([meta(`low ${fmtNum(Math.min(...vals), b.unit)}`, { size: 11 }), box([], { flexGrow: 1 }), meta(`high ${fmtNum(Math.max(...vals), b.unit)}`, { size: 11 })]),
  ], { gap: 6, width: w, maxWidth: "100%" });
}

/** A drawing fitted to the room (never taller than 360), dotted, with its caption under it. */
function drawing(ctx: BotsCtx, b: Extract<Block, { type: "draw" }>, room: number, o: ShowOpts, key: string): Node | null {
  let w = Math.min(room, Math.max(b.width, 160));
  if ((w * b.height) / b.width > 360) w = (360 * b.width) / b.height;
  const pic = dotsNode(ctx, drawPic(b, Math.round(w)), { motion: "draw", key, live: o.live, ...(b.label ? { label: b.label } : {}) });
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
        dotsNode(ctx, meterPic(b.value, b.max, w), { motion: "meter", key, live: o.live, label: `${b.label ? `${b.label} ` : ""}${pct}%` }) ?? box([]),
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
  if (o.live && canBuddy(ctx)) {
    return botBuddy({
      kind: "custom", color: C.ink, life: `show.${o.turn}`, width: BLIP_W[ctx.client], height: desk ? 66 : 56, size: desk ? 34 : 30,
      state: "idle", act, lookTo: "left", label: "Blip",
    });
  }
  return box([blip(POSE[act], desk ? 60 : 52)], { width: BLIP_W[ctx.client], alignItems: "center", flexShrink: 0 });
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
