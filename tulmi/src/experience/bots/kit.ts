/**
 * THE BOTS APP'S KIT: the theme and one helper per design primitive, for the phone and the window alike.
 *
 * The design is bots-design/STYLE.md and the Kit boards (Kit1: foundations and frame, Kit2: input and conversation,
 * Kit3: decisions, work, proof, system states). Every helper returns plain SDUI nodes built from the core types
 * (Stack, Text, Image, Grid, Screen, TextField, SafeArea, SVG) and the kit's four extensions (shared/types/sdui.ts,
 * "The Bots app's kit"), with explicit styles, so the phone (React Native) and the window (desktop/sdui.js) draw the
 * same thing. Nothing here reads data or the clock: a builder hands the kit what to draw (ctx.live, its own data).
 *
 * Read docs/bots-app.md before adding to it. The rules that keep the two clients identical:
 *   - text is set with `text()` (or a helper on it): a named Geist face per weight, fontWeight "normal", margin 0,
 *     an explicit line height. A custom face's weight is its FILE on the phone (phoneLook.ts says why).
 *   - borders are written the React Native way (borderWidth + borderColor); the window draws a width as solid on a
 *     Bots page (look "bots"). A dashed one says borderStyle "dashed".
 *   - a pressable box is a Stack with on.onPress. Never put a pressable inside a pressable: the window runs both.
 *   - images are { url } sources inside a sized box (`picture()`), so neither client guesses a size.
 *   - colour is only for bots (palette.ts). Errors, success and links are ink.
 */
import type { ActionRef, ActionSpec, BotBuddyProps, BotCardProps, BotTileKind, BotTileSpec, Condition, Node, ScreenResponse, ThemeTokens } from "../../../../shared/types/sdui.js";
import { BOT_BUDDY_COMPONENT, BOT_TILES_STRIP, BOTS_MOTION_CAPABILITY, HOME_HEAD_COMPONENTS, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { LIVE_VIEW_COMPONENT, OUTBOX_CAPABILITY, type LiveViewProps } from "../../../../shared/types/sdui.js";
import { blipLoopFor, type BlipPose } from "./art.js";
import { blipSize, blipUrl as blipLoopUrl } from "../blipLoops.js";
import { icon, statusMark, tabGlyph, tailzuMark, type IconName, type Mark, type TabId } from "./glyphs.js";
import type { BotsLive, LiveBot, NeedsItem } from "./live.js";
import { C, botLook, type BotLook } from "./palette.js";
import { botRoute, SCREENS } from "./ids.js";
import { askMoment, failed as momentFailed, SENT_WORDS, start as momentStart, streamed as momentStreamed } from "./askMoment.js";

export { C, PALETTE_HEX, botLook, BUILTIN_SLUGS, type BotLook } from "./palette.js";
export { icon, shapes, statusMark, tabGlyph, tailzuMark, ICONS, type IconName, type Mark, type TabId } from "./glyphs.js";
export { blipUrl, headUrl, BLIP_POSES, type BlipPose } from "./art.js";
export { SCREENS, botRoute } from "./ids.js";
export { percent, whenWords } from "../../you/usage.js";

type Style = Record<string, unknown>;

// ===================================================================== context

/** Which client a screen is built for: the phone app or the desktop window. One screen id serves both. */
export type Client = "phone" | "desktop";

/** What every Bots app builder is given (registry.ts fills it in). */
export interface BotsCtx {
  screenId: string;
  client: Client;
  /** Navigation params (navigate's `params`). Strings, numbers, booleans. */
  params: Record<string, string | number | boolean | undefined>;
  /** What is going on right now (live.ts). The tab bar and the sidebar draw it. */
  live: BotsLive;
  /** The person, when signed in. */
  user: { id: string; name?: string; email?: string } | null;
  /** What the asking build can draw (capabilities.components). */
  can: ReadonlySet<string>;
  /** The window's own pages that exist for it (the desk: Today, Notes, its settings). */
  desk: { pages: boolean; notes: boolean };
  tzOffsetMinutes: number;
}

// ===================================================================== theme

/** The faces, each a weight of Geist, under the names the apps register them by. */
export const FACE = {
  regular: "Tailzu Geist",
  medium: "Tailzu Geist Medium",
  semibold: "Tailzu Geist SemiBold",
  bold: "Tailzu Geist Bold",
  mono: "Tailzu Geist Mono",
  monoMedium: "Tailzu Geist Mono Medium",
} as const;

/** The phone loads these at boot (bootstrap `fonts`, only for the Bots app); the window bundles the same faces. */
export function botsFonts(): Record<string, string> {
  const base = `${process.env.PUBLIC_ORIGIN || "https://api.tailzu.space"}/fonts/`;
  return {
    [FACE.regular]: `${base}geist.ttf?v=1`,
    [FACE.medium]: `${base}geist-medium.ttf?v=1`,
    [FACE.semibold]: `${base}geist-semibold.ttf?v=1`,
    [FACE.bold]: `${base}geist-bold.ttf?v=1`,
    [FACE.mono]: `${base}geist-mono.ttf?v=1`,
    [FACE.monoMedium]: `${base}geist-mono-medium.ttf?v=1`,
  };
}

/** The screen-level theme every Bots page carries: white and ink. The app's own theme stays for its other screens. */
export const BOTS_THEME: Partial<ThemeTokens> = {
  color: {
    bg: C.paper, surface: C.surface, card: C.paper, inputBg: C.paper, text: C.ink, body: C.grey70, muted: C.meta,
    label: C.meta, border: C.line, primary: C.ink, accent: C.ink, danger: C.ink,
    tabBar: C.paper, tabBarBorder: C.divider, toastInfo: C.ink, toastSuccess: C.ink, toastError: C.ink, toastText: C.paper,
  },
};

/** Spacing (Kit1): 4 8 12 16 20 24 32. Radii: chip 10, card 20, input 28, pill = half the height. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const RADIUS = { chip: 10, card: 20, list: 18, input: 28 } as const;

// ===================================================================== text

export type Weight = 400 | 500 | 600 | 700;

export interface TextOpts {
  size?: number;
  weight?: Weight;
  color?: string;
  mono?: boolean;
  lineHeight?: number;
  /** Letter spacing in points. */
  tracking?: number;
  upper?: boolean;
  align?: "left" | "center" | "right";
  /** Clip to this many lines. */
  lines?: number;
  /** Show this state path's value instead of `content` when it has one (Text bind.content). */
  bind?: string;
  style?: Style;
}

function face(weight: Weight, mono: boolean): string {
  if (mono) return weight >= 500 ? FACE.monoMedium : FACE.mono;
  return weight >= 700 ? FACE.bold : weight >= 600 ? FACE.semibold : weight >= 500 ? FACE.medium : FACE.regular;
}

/** Any run of text. Every other text helper is this with a size and a colour. */
export function text(content: string, o: TextOpts = {}): Node {
  const size = o.size ?? 15;
  return {
    type: "Text",
    props: { content, variant: "bots", ...(o.lines ? { numberOfLines: o.lines } : {}) },
    ...(o.bind ? { bind: { content: o.bind } } : {}),
    style: {
      fontFamily: face(o.weight ?? 400, !!o.mono), fontWeight: "normal", fontStyle: "normal",
      fontSize: size, lineHeight: o.lineHeight ?? Math.round(size * (o.mono ? 1.45 : 1.35)), letterSpacing: o.tracking ?? 0,
      color: o.color ?? C.ink, margin: 0, textTransform: o.upper ? "uppercase" : "none",
      ...(o.align ? { textAlign: o.align } : {}), ...(o.style ?? {}),
    },
  };
}

/** Page title: 26/700, tracking -0.5 (the window's Home uses 32). */
export const title = (content: string, o: TextOpts = {}): Node =>
  text(content, { size: 26, weight: 700, tracking: -0.5, lineHeight: 32, ...o });

/** A smaller heading: a card's or a block's name (20/600). */
export const heading = (content: string, o: TextOpts = {}): Node =>
  text(content, { size: 20, weight: 600, tracking: -0.3, lineHeight: 26, ...o });

/** Section label: 11/600, upper case, tracking .4, meta grey. */
export const sectionLabel = (content: string, o: TextOpts = {}): Node =>
  text(content, { size: 11, weight: 600, tracking: 0.4, upper: true, color: C.meta, lineHeight: 15, ...o });

/** Body: 15, ink. */
export const body = (content: string, o: TextOpts = {}): Node => text(content, { size: 15, lineHeight: 21, ...o });

/** Meta: 12-13, grey. */
export const meta = (content: string, o: TextOpts = {}): Node =>
  text(content, { size: 12, color: C.meta, lineHeight: 16, ...o });

/** Big number: 34/700 ("64%", "Shipped."). */
export const bigNumber = (content: string, o: TextOpts = {}): Node =>
  text(content, { size: 34, weight: 700, tracking: -0.8, lineHeight: 40, ...o });

/** Code and ids: Geist Mono 12 on the surface grey. */
export function mono(content: string, o: TextOpts & { boxed?: boolean } = {}): Node {
  const t = text(content, { size: 12, mono: true, color: C.ink, lineHeight: 17, ...o });
  if (o.boxed === false) return t;
  return box([t], { background: C.surface, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" });
}

// ===================================================================== layout

/** A column. */
export function col(children: Node[], style: Style = {}, onPress?: ActionRef): Node {
  return { type: "Stack", style: { flexDirection: "column", ...style }, children, ...(onPress ? { on: { onPress } } : {}) };
}

/** A row, centred on the cross axis unless told otherwise. */
export function row(children: Node[], style: Style = {}, onPress?: ActionRef): Node {
  return { type: "Stack", style: { flexDirection: "row", alignItems: "center", ...style }, children, ...(onPress ? { on: { onPress } } : {}) };
}

/** Any box (a column) with a style. */
export const box = (children: Node[], style: Style = {}, onPress?: ActionRef): Node => col(children, style, onPress);

/** What a screen reader says for a pressable box whose content is a picture (an icon button, a tile). */
export const labelled = (n: Node, label: string): Node => ({ ...n, props: { ...(n.props ?? {}), accessibilityLabel: label } });

/** Takes the room that is left (pushes what follows to the end). */
export const grow = (): Node => ({ type: "Stack", style: { flexGrow: 1, flexShrink: 1 } });

/** Fixed space. */
export const gap = (h: number): Node => ({ type: "Stack", style: { height: h, flexShrink: 0 } });

/** A hairline: #ededed between rows, #e6e6e6 for a card's edge. */
export const divider = (o: { color?: string; inset?: number; vertical?: boolean } = {}): Node => ({
  type: "Stack",
  style: o.vertical
    ? { width: 1, alignSelf: "stretch", backgroundColor: o.color ?? C.divider, flexShrink: 0 }
    : { height: 1, backgroundColor: o.color ?? C.divider, flexShrink: 0, ...(o.inset ? { marginLeft: o.inset } : {}) },
});

/** A grid of equal columns (2 on the phone's bot tiles, 4 in the window's). */
export function grid(children: Node[], columns: number, gapPx = 12): Node {
  return { type: "Grid", props: { columns, gap: gapPx }, children };
}

/** Wrap a node so it only shows when `cond` holds (state or flags). */
export const when = (cond: Condition, n: Node): Node => ({ ...n, visibleIf: cond });

/** A state-following style value: `{ eq: [path, value], then, else }`. */
export const whenEq = (path: string, value: unknown, then: unknown, otherwise: unknown): Record<string, unknown> =>
  ({ eq: [path, value], then, else: otherwise });

// ===================================================================== pictures

/** An image in a box of a known size. `url` is a full address (art.ts names Blip's). */
export function picture(url: string, w: number, h: number, o: { radius?: number; background?: string; fit?: "cover" | "contain"; label?: string } = {}): Node {
  return box([{
    type: "Image",
    props: { source: { url }, contentFit: o.fit ?? "contain", radius: 0, ...(o.label ? { accessibilityLabel: o.label } : {}) },
    style: { width: "100%", height: "100%", borderRadius: 0 },
  }], {
    width: w, height: h, flexShrink: 0, overflow: "hidden",
    ...(o.radius ? { borderRadius: o.radius } : {}), ...(o.background ? { backgroundColor: o.background } : {}),
  });
}

/**
 * Blip's whole body, for the big moments (STYLE.md: 140-200 tall, no circle), moving: the pose's loop (art.blipLoopFor),
 * as tall as asked and as wide as that loop's own proportions.
 */
export function blip(pose: BlipPose, height = 160): Node {
  const loop = blipLoopFor(pose, height);
  const { w, h } = blipSize(loop);
  return picture(blipLoopUrl(loop), Math.round((height * w) / h), height, { label: "Blip" });
}

// ===================================================================== bots

/**
 * A bot's avatar: its Blip head on the surface grey, or (a person's own bot) a circle in its colour with a white
 * line icon. STYLE.md: 30 in rows; 24 in chips; 40-56 on a bot's own page.
 */
export function botAvatar(bot: Pick<BotLook, "color" | "icon" | "head">, size = 30): Node {
  if (bot.head) return picture(bot.head, size, size, { radius: size / 2, background: C.surface, label: "" });
  return box([icon(bot.icon, { size: Math.round(size * 0.55), color: C.paper, weight: 1.9 })], {
    width: size, height: size, borderRadius: size / 2, backgroundColor: bot.color, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

/** A bot as a chip: its head and its name in a pill (Kit1, Bot identity). */
export function botChip(bot: Pick<LiveBot, "name" | "color" | "icon" | "head">, onPress?: ActionRef): Node {
  return row([botAvatar(bot, 24), text(bot.name, { size: 13, weight: 500 })], {
    gap: 8, paddingVertical: 4, paddingLeft: 4, paddingRight: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignSelf: "flex-start",
  }, onPress);
}

/** The line under a bot's name: what it is doing, in its colour, or its own line in grey; "Needs you" in ink. */
export function botLine(bot: LiveBot, idle: string): Node {
  if (bot.working) return text(`Working · ${bot.doing ?? "on it"}`, { size: 12, weight: 500, color: bot.color, lines: 1 });
  if (bot.needs) return text(`Needs you · ${bot.needs === 1 ? "1 question" : `${bot.needs} things`}`, { size: 12, weight: 600, color: C.ink, lines: 1 });
  return meta(idle, { lines: 2 });
}

/**
 * A bot tile (Home's grid, Kit1): its icon in its colour, its status mark, its name and its line.
 * `height` 132 on the phone, 150 in the window.
 */
export function botTile(bot: LiveBot, o: { idle: string; onPress?: ActionRef; height?: number; padding?: number }): Node {
  const mark = bot.working ? statusMark("working", { color: bot.color, size: 10 })
    : bot.needs ? statusMark("needs", { size: 10 }) : null;
  return col([
    row([icon(bot.icon, { size: 26, color: bot.color, weight: 1.8 }), grow(), ...(mark ? [mark] : [])], { alignItems: "flex-start" }),
    col([text(bot.name, { size: 16, weight: 600, lineHeight: 21 }), botLine(bot, o.idle)], { gap: 3 }),
  ], {
    height: o.height ?? 132, padding: o.padding ?? 16, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line,
    justifyContent: "space-between", backgroundColor: C.paper,
  }, o.onPress);
}

// ---------------------------------------------------------------- the living tiles (capability BotsMotion)

/** A build that draws BotTiles and BotCard (shared/types/sdui.ts, "The living bot tiles"). */
export const canMove = (ctx: BotsCtx): boolean => ctx.can.has(BOTS_MOTION_CAPABILITY);

/** The words under a bot's name (botLine's, as plain text). */
export function botLineText(bot: LiveBot, idle: string): string {
  if (bot.working) return `Working · ${bot.doing ?? "on it"}`;
  if (bot.needs) return `Needs you · ${bot.needs === 1 ? "1 question" : `${bot.needs} things`}`;
  return idle;
}

/** The built-ins have their own play (Code juggles 0s and 1s, Keybot hops keys…); anyone's own bot plays with a ball. */
export function botKind(slug: string): BotTileKind {
  return slug === "code" || slug === "keybot" || slug === "plan" || slug === "travel" || slug === "notes" ? slug : "custom";
}

/** One living tile for a bot: its name, its line, its colour, its play, its state, where a tap goes. */
export function botTileSpec(bot: LiveBot, o: { idle: string; onPress?: ActionRef }): BotTileSpec {
  return {
    slug: bot.slug, name: bot.name, sub: botLineText(bot, o.idle), color: bot.color, kind: botKind(bot.slug),
    state: bot.working ? "working" : bot.needs ? "needs" : "idle", ...(o.onPress ? { action: o.onPress } : {}),
  };
}

/** The Make a bot tile: a bot putting himself together from loose dots. */
export function makeTileSpec(onPress?: ActionRef): BotTileSpec {
  return { slug: "make", name: "Make a bot", sub: "Say what it should do", color: C.ink, kind: "make", state: "idle", ...(onPress ? { action: onPress } : {}) };
}

/**
 * Home's grid as living tiles (BotTiles): a tiny Blip per tile, playing on a faint fabric; a tap makes every other bot
 * look at it before the tile opens. Only for a build that can draw it (canMove); others get botTile / makeBotTile.
 * `strip`: one more tile as a full-width row under the grid, in the same world (only for canStrip).
 */
export function botTiles(tiles: BotTileSpec[], o: { columns: number; height: number; padding: number; gap: number; strip?: BotTileSpec; stripHeight?: number }): Node {
  return {
    type: "BotTiles",
    props: {
      tiles, columns: o.columns, height: o.height, padding: o.padding, gap: o.gap, faces: { regular: FACE.regular, medium: FACE.medium, semibold: FACE.semibold },
      ...(o.strip ? { strip: o.strip, stripHeight: o.stripHeight ?? 104 } : {}),
    },
  };
}

/** A build that draws a strip under the living grid (BotTilesProps.strip). */
export const canStrip = (ctx: BotsCtx): boolean => canMove(ctx) && ctx.can.has(BOT_TILES_STRIP);

/**
 * A card with the tiny bot playing across its top (BotCard) and its steps below: each step a node with its own
 * visibleIf. `onComplete` runs when `doneWhen` holds, after the bot's small happy moment.
 */
export function botCard(steps: Node[], o: BotCardProps & { onComplete?: ActionRef }): Node {
  const { onComplete, ...props } = o;
  return { type: "BotCard", props: { ...props }, ...(onComplete ? { on: { onComplete } } : {}), children: steps };
}

/** A build that draws a bot's own tiny bot on its pages (BotBuddy, with BotsMotion). */
export const canBuddy = (ctx: BotsCtx): boolean => canMove(ctx) && ctx.can.has(BOT_BUDDY_COMPONENT);

/** A bot's own tiny bot on a stage of his own (BotBuddy): only for a build that draws it (canBuddy). */
export function botBuddy(o: BotBuddyProps): Node {
  return { type: "BotBuddy", props: { ...o } };
}

/**
 * The bot's own tiny bot for its page's header, where the build draws it (else nothing: the header as before): its
 * colour and play, as busy as the bot is, facing the person when it needs them. `lookTo`: where the page's ask field
 * is; `thinkWhen`: the state that holds while an answer is on its way. Small: the header's height.
 */
export function headerBuddy(ctx: BotsCtx, slug: string, o: { color?: string; lookTo?: BotBuddyProps["lookTo"]; thinkWhen?: Condition; width?: number } = {}): Node[] {
  if (!canBuddy(ctx)) return [];
  const desk = ctx.client === "desktop";
  const bot = ctx.live.bots.find((b) => b.slug === slug);
  return [botBuddy({
    kind: botKind(slug), color: o.color ?? bot?.color ?? botLook(slug).color, life: `page.${slug}`, width: o.width ?? (desk ? 150 : 76), height: desk ? 56 : 44, size: desk ? 34 : 28,
    state: bot?.working ? "working" : bot?.needs ? "needs" : "idle",
    ...(o.lookTo ? { lookTo: o.lookTo } : {}), ...(o.thinkWhen ? { thinkWhen: o.thinkWhen } : {}),
  })];
}

/** A build that draws Home's header alive (WriteOn, LiveMark, HeadBar, with BotsMotion). */
export const canHead = (ctx: BotsCtx): boolean => canMove(ctx) && HOME_HEAD_COMPONENTS.every((c) => ctx.can.has(c));

/** A bold line that writes itself in, with Keybot's caret (WriteOn); once per app open and `once`. */
export function writeOn(content: string, o: { size: number; lineHeight: number; tracking?: number; once: string; color?: string }): Node {
  return {
    type: "WriteOn",
    props: { content, size: o.size, lineHeight: o.lineHeight, ...(o.tracking ? { tracking: o.tracking } : {}), color: o.color ?? C.ink, fontFamily: FACE.bold, caretColor: botLook("keybot").color, once: o.once },
  };
}

/** The Tailzu mark, alive (LiveMark): a ring dot lit in each working bot's colour; a tap runs `onPress`. */
export function liveMark(size: number, lit: string[], onPress?: ActionRef): Node {
  return { type: "LiveMark", props: { size, lit: lit.slice(0, 8), label: "Tailzu. Ask anything" }, ...(onPress ? { on: { onPress } } : {}) };
}

/** A compact bar over the top of the page that comes in once the page has scrolled past `at` (page()'s `pinned`). */
export function headBar(children: Node[], at: number): Node {
  return { type: "HeadBar", props: { at }, children };
}

/** The dashed "Make a bot" tile. */
export function makeBotTile(o: { onPress?: ActionRef; height?: number; padding?: number } = {}): Node {
  return col([
    icon("plus", { size: 26, color: C.ink, weight: 1.8 }),
    col([text("Make a bot", { size: 16, weight: 600, lineHeight: 21 }), meta("Say what it should do")], { gap: 3 }),
  ], {
    height: o.height ?? 132, padding: o.padding ?? 16, borderRadius: RADIUS.card, borderWidth: 1.5, borderColor: C.dashed, borderStyle: "dashed",
    justifyContent: "space-between",
  }, o.onPress);
}

// ===================================================================== cards and lists

export interface CardOpts {
  padding?: number;
  gap?: number;
  radius?: number;
  onPress?: ActionRef;
  /** A dashed edge (an empty state, a "make one" card). */
  dashed?: boolean;
  /** A selected card's border, in the bot's colour. */
  selected?: string;
  direction?: "row" | "column";
  style?: Style;
}

/** A card: 1px #e6e6e6, radius 18-20, padding 14-16. */
export function card(children: Node[], o: CardOpts = {}): Node {
  return {
    type: "Stack",
    style: {
      flexDirection: o.direction ?? "column", padding: o.padding ?? 16, gap: o.gap ?? 12, borderRadius: o.radius ?? RADIUS.card,
      borderWidth: o.dashed ? 1.5 : o.selected ? 1.5 : 1, borderColor: o.selected ?? (o.dashed ? C.dashed : C.line),
      ...(o.dashed ? { borderStyle: "dashed" } : {}), backgroundColor: C.paper, ...(o.style ?? {}),
    },
    children,
    ...(o.onPress ? { on: { onPress: o.onPress } } : {}),
  };
}

export interface RowOpts {
  label: string;
  /** Grey, on the right. */
  value?: string;
  /** A second line under the label. */
  sub?: string;
  /** Before the label: an avatar, an icon, a status mark. */
  left?: Node;
  /** After the value: a switch, a mark, a button. */
  right?: Node;
  chevron?: boolean;
  onPress?: ActionRef;
  /** Bold label (a row that is a heading). */
  strong?: boolean;
}

/** One row of a list card: label left, value right in grey, padding 14 16. */
export function listRow(o: RowOpts): Node {
  return row([
    ...(o.left ? [o.left] : []),
    col([
      text(o.label, { size: 15, weight: o.strong ? 600 : 400, lineHeight: 20 }),
      ...(o.sub ? [meta(o.sub, { size: 12 })] : []),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
    ...(o.value ? [text(o.value, { size: 14, color: C.meta, align: "right", style: { flexShrink: 0 } })] : []),
    ...(o.right ? [o.right] : []),
    ...(o.chevron ?? !!o.onPress ? [icon("chevron", { size: 16, color: C.meta })] : []),
  ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, minHeight: 48 }, o.onPress);
}

/** A list card: rows in one card with #ededed dividers between them. */
export function listCard(rows: Node[], o: { title?: string } = {}): Node {
  const kids: Node[] = [];
  rows.forEach((r, i) => { if (i) kids.push(divider()); kids.push(r); });
  const cardNode: Node = { type: "Stack", style: { flexDirection: "column", borderRadius: RADIUS.list, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper }, children: kids };
  return o.title ? col([sectionLabel(o.title), cardNode], { gap: 8 }) : cardNode;
}

// ===================================================================== controls

export type ButtonKind = "primary" | "secondary" | "quiet" | "disabled";

export interface ButtonOpts {
  kind?: ButtonKind;
  /** lg: 54 tall (the one primary of a screen). md: 44 (a card's choices). */
  size?: "lg" | "md";
  icon?: IconName;
  /** Stretch to the row (a screen's bottom button). */
  wide?: boolean;
  label?: string;
}

/** A pill button. One primary per screen (STYLE.md). */
export function button(labelText: string, onPress: ActionRef | undefined, o: ButtonOpts = {}): Node {
  const kind = o.kind ?? "primary";
  const lg = (o.size ?? "lg") === "lg";
  const h = lg ? 54 : 44;
  const fg = kind === "primary" ? C.paper : kind === "quiet" ? C.meta : kind === "disabled" ? C.idle : C.ink;
  return row([
    ...(o.icon ? [icon(o.icon, { size: lg ? 20 : 18, color: fg })] : []),
    text(labelText, { size: lg ? 16 : 14, weight: lg ? 600 : 500, color: fg, lineHeight: lg ? 20 : 18 }),
  ], {
    height: h, borderRadius: h / 2, paddingHorizontal: kind === "quiet" ? 12 : lg ? 26 : 16, gap: 8, justifyContent: "center", flexShrink: 0,
    backgroundColor: kind === "primary" ? C.ink : kind === "disabled" ? C.line : kind === "quiet" ? "transparent" : C.paper,
    ...(kind === "secondary" ? { borderWidth: 1, borderColor: C.outline } : {}),
    ...(o.wide ? { alignSelf: "stretch" } : { alignSelf: "flex-start" }),
  }, kind === "disabled" ? undefined : onPress);
}

export const primaryButton = (l: string, onPress: ActionRef | undefined, o: Omit<ButtonOpts, "kind"> = {}): Node => button(l, onPress, { ...o, kind: "primary" });
export const secondaryButton = (l: string, onPress: ActionRef | undefined, o: Omit<ButtonOpts, "kind"> = {}): Node => button(l, onPress, { ...o, kind: "secondary" });
export const quietButton = (l: string, onPress: ActionRef | undefined, o: Omit<ButtonOpts, "kind"> = {}): Node => button(l, onPress, { ...o, kind: "quiet" });

/** A round ink button with a white icon (the mic, send). */
export function roundButton(name: IconName, onPress: ActionRef | undefined, o: { size?: number; label?: string; light?: boolean } = {}): Node {
  const s = o.size ?? 48;
  const b = box([icon(name, { size: 20, color: o.light ? C.ink : C.paper })], {
    width: s, height: s, borderRadius: s / 2, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: o.light ? C.paper : C.ink, ...(o.light ? { borderWidth: 1, borderColor: C.line } : {}),
  }, onPress);
  return o.label ? labelled(b, o.label) : b;
}

/** A chip: radius 18, padding 8 14, 13px. Selected: black fill, white text. */
export function chip(labelText: string, o: { selected?: boolean; onPress?: ActionRef; dashed?: boolean } = {}): Node {
  return row([text(labelText, { size: 13, weight: o.selected ? 500 : 400, color: o.selected ? C.paper : C.ink, lineHeight: 17 })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, alignSelf: "flex-start",
    borderColor: o.selected ? C.ink : C.outline, backgroundColor: o.selected ? C.ink : C.paper,
    ...(o.dashed ? { borderStyle: "dashed" } : {}),
  }, o.onPress);
}

/** Chips that choose one value into a state path (selected follows the state on both clients). */
export function chips(options: Array<{ label: string; value: string }>, path: string, o: { onChange?: ActionRef } = {}): Node {
  return row(options.map((opt) => row([
    text(opt.label, { size: 13, lineHeight: 17, style: { color: whenEq(path, opt.value, C.paper, C.ink) } }),
  ], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq(path, opt.value, C.ink, C.outline), backgroundColor: whenEq(path, opt.value, C.ink, C.paper),
  }, seq({ kind: "setState", path, value: opt.value }, o.onChange))), { gap: 8, flexWrap: "wrap" });
}

/** A segmented control: #f5f5f5 track radius 12, the selected segment white radius 10. Writes the value into `path`. */
export function segmented(options: Array<{ label: string; value: string }>, path: string, o: { onChange?: ActionRef } = {}): Node {
  return row(options.map((opt) => box([
    text(opt.label, { size: 13, weight: 500, lineHeight: 17, align: "center" }),
  ], {
    flexGrow: 1, flexBasis: 0, alignItems: "center", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10,
    backgroundColor: whenEq(path, opt.value, C.paper, "transparent"),
  }, seq({ kind: "setState", path, value: opt.value }, o.onChange))), { padding: 3, borderRadius: 12, backgroundColor: C.surface, gap: 2 });
}

/** A switch's look (40 x 24, ink when on, #e0e0e0 when off), following a state path. Not pressable itself. */
export function switchMark(path: string): Node {
  const on: Condition = { truthy: path };
  return row([box([], { width: 18, height: 18, borderRadius: 9, backgroundColor: C.paper })], {
    width: 40, height: 24, borderRadius: 12, padding: 3, flexShrink: 0,
    backgroundColor: { ...on, then: C.ink, else: C.track }, justifyContent: { ...on, then: "flex-end", else: "flex-start" },
  });
}

/** A row with a switch: the whole row toggles `path`, then runs `onChange` (save it). */
export function switchRow(labelText: string, path: string, o: { sub?: string; onChange?: ActionRef; left?: Node } = {}): Node {
  return listRow({ label: labelText, sub: o.sub, left: o.left, right: switchMark(path), chevron: false, onPress: seq({ kind: "toggleState", path }, o.onChange) });
}

/**
 * A stepper (Kit1: "Reviewers  −  2  +"). The server knows the value, so each side runs its own action (save the
 * value one step down or up, then refresh); nothing is counted on the device.
 */
export function stepper(value: string, onMinus: ActionRef | undefined, onPlus: ActionRef | undefined): Node {
  const side = (name: IconName, a: ActionRef | undefined, label: string) => box([icon(name, { size: 16, color: a ? C.ink : C.idle, label })], {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center",
  }, a);
  return row([side("minus", onMinus, "Less"), text(value, { size: 15, weight: 600, align: "center", style: { minWidth: 44 } }), side("plus", onPlus, "More")], { gap: 10 });
}

/** A back bar: a 44 x 44 chevron (pulled 10 left), an optional title, and something on the right. */
export function backBar(o: { title?: string; onBack?: ActionRef; right?: Node } = {}): Node {
  return row([
    labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, o.onBack ?? { kind: "navigateBack" }), "Back"),
    ...(o.title ? [text(o.title, { size: 17, weight: 600, lineHeight: 22, lines: 1, style: { flexShrink: 1 } })] : []),
    grow(),
    ...(o.right ? [o.right] : []),
  ], { minHeight: 44, gap: 4 });
}

// ===================================================================== work

/** A meter: a #e0e0e0 track with one fill (ink), or a bot's segments; a label and a value over it. */
export function meter(value: number, max: number, o: { label?: string; valueText?: string; color?: string; height?: number; segments?: Array<{ value: number; color: string }> } = {}): Node {
  const h = o.height ?? 6;
  const pct = (v: number) => `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0)).toFixed(1)}%`;
  const fills = o.segments ?? [{ value, color: o.color ?? C.ink }];
  const track = row(fills.map((s) => box([], { width: pct(s.value), height: h, backgroundColor: s.color })), {
    height: h, borderRadius: h / 2, backgroundColor: C.track, overflow: "hidden", alignItems: "stretch",
  });
  if (!o.label && !o.valueText) return track;
  return col([
    row([meta(o.label ?? "", { size: 12 }), grow(), text(o.valueText ?? "", { size: 12, weight: 600 })]),
    track,
  ], { gap: 6 });
}

/** The stages of a job (Kit3: Understand · Plan · Build · Check · Ship): done in ink, the current one in the bot's colour. */
export function stages(names: string[], current: number, color: string): Node {
  return row(names.map((n, i) => col([
    box([], { height: 3, borderRadius: 2, backgroundColor: i < current ? C.ink : i === current ? color : C.track }),
    text(n, { size: 11, weight: i === current ? 600 : 400, color: i < current ? C.ink : i === current ? color : C.idle, lineHeight: 14 }),
  ], { flexGrow: 1, flexBasis: 0, gap: 6 })), { gap: 6, alignItems: "flex-start" });
}

export interface TimelineItem {
  mark: Mark;
  /** The bot's colour, for a working bead. */
  color?: string;
  title: string;
  meta?: string;
  /** Right side: a time, an amount, a button. */
  right?: Node;
  /** Before the title: a bot's avatar. */
  left?: Node;
  onPress?: ActionRef;
}

/** A bead timeline: each row's bead is its status mark on one thread (Activity). */
export function timeline(items: TimelineItem[]): Node {
  return col(items.map((it, i) => row([
    col([
      box([statusMark(it.mark, { color: it.color })], { height: 20, justifyContent: "center" }),
      ...(i < items.length - 1 ? [box([], { width: 1.5, flexGrow: 1, backgroundColor: C.line, marginTop: 2 })] : []),
    ], { width: 12, alignItems: "center", alignSelf: "stretch" }),
    ...(it.left ? [it.left] : []),
    col([
      text(it.title, { size: 15, lineHeight: 20 }),
      ...(it.meta ? [meta(it.meta)] : []),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 3, paddingBottom: i < items.length - 1 ? 16 : 0 }),
    ...(it.right ? [it.right] : []),
  ], { gap: 12, alignItems: "flex-start" }, it.onPress)));
}

/** A small outline info chip (Kit3: "This computer · free", "In line · 3rd · about 40 s"). */
export const infoChip = (content: string): Node =>
  row([text(content, { size: 12, lineHeight: 16 })], { paddingVertical: 6, paddingHorizontal: 11, borderRadius: 14, borderWidth: 1, borderColor: C.line, alignSelf: "flex-start" });

/** A table (the window's): column heads in label type, rows with #ededed rules. `flex` sizes a column. */
export function table(columns: Array<{ label: string; flex?: number; align?: "left" | "right" }>, rows: Array<Array<string | Node>>, o: { onRow?: (i: number) => ActionRef | undefined } = {}): Node {
  const cell = (c: string | Node, j: number, head = false): Node => box([
    typeof c === "string" ? (head ? sectionLabel(c) : text(c, { size: 14, lineHeight: 19, align: columns[j]?.align, color: j ? C.grey70 : C.ink })) : c,
  ], { flexGrow: columns[j]?.flex ?? 1, flexBasis: 0, minWidth: 0, alignItems: columns[j]?.align === "right" ? "flex-end" : "flex-start" });
  return col([
    row(columns.map((c, j) => cell(c.label, j, true)), { paddingVertical: 10, paddingHorizontal: 16, gap: 16 }),
    ...rows.flatMap((r, i) => [divider(), row(r.map((c, j) => cell(c, j)), { paddingVertical: 13, paddingHorizontal: 16, gap: 16 }, o.onRow?.(i))]),
  ], { borderRadius: RADIUS.list, borderWidth: 1, borderColor: C.line, overflow: "hidden" });
}

// ===================================================================== moments

/** An empty state (Kit3): Blip in a pose, a title, a line, and the one thing to do. Dashed, as "nothing here yet". */
export function emptyState(o: { pose?: BlipPose; title: string; body?: string; action?: { label: string; onPress: ActionRef } }): Node {
  return card([
    blip(o.pose ?? "hello", 120),
    text(o.title, { size: 16, weight: 600, align: "center" }),
    ...(o.body ? [text(o.body, { size: 13, color: C.meta, align: "center", lineHeight: 18 })] : []),
    ...(o.action ? [button(o.action.label, o.action.onPress, { size: "md" })] : []),
  ], { dashed: true, gap: 10, padding: 24, style: { alignItems: "center" } });
}

/** A one-line notice (Kit3 toasts): ink with a check for a quiet win, outline for a state. */
export function notice(content: string, o: { ink?: boolean; mark?: IconName } = {}): Node {
  const fg = o.ink ? C.paper : C.ink;
  return row([
    ...(o.mark ? [icon(o.mark, { size: 16, color: fg })] : []),
    text(content, { size: 13, color: fg, lineHeight: 18, style: { flexShrink: 1 } }),
  ], {
    gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, alignSelf: "flex-start",
    ...(o.ink ? { backgroundColor: C.ink } : { borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }),
  });
}

// ===================================================================== decisions

/** "NEEDS YOU · CODE BOT": the ink dot and the label. */
export function needsLabel(botName: string): Node {
  return row([statusMark("needs", { size: 10 }), text(`Needs you · ${botName}`, { size: 12, weight: 600, tracking: 0.4, upper: true, lineHeight: 16 })], { gap: 8 });
}

/** The choices of a decision, as md buttons (primary, secondary, quiet). */
export function choiceRow(item: NeedsItem): Node {
  return row(item.choices.map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 8, flexWrap: "wrap" });
}

/**
 * A decision card (Kit3, Main): the bot, the question, its choices; one tap. `layout: "row"` puts the choices
 * beside the question (the window).
 */
export function needsCard(item: NeedsItem, o: { layout?: "column" | "row" } = {}): Node {
  const words = col([
    needsLabel(item.botName),
    text(item.question, { size: o.layout === "row" ? 17 : 16, weight: 500, lineHeight: 22 }),
    ...(item.detail ? [meta(item.detail, { size: 13, lines: 2 })] : []),
  ], { gap: o.layout === "row" ? 8 : 12, flexGrow: 1, flexShrink: 1, minWidth: 0 });
  if (o.layout === "row") {
    return card([words, choiceRow(item)], { direction: "row", padding: 20, gap: 20, style: { alignItems: "center", flexWrap: "wrap" } });
  }
  return card([words, choiceRow(item)], { gap: 12 });
}

// ===================================================================== the ask bar

/**
 * What the ask bar sends: the front door (POST /v1/ask, "Ask any bot"), then the answer opens on the Ask screen. Offline, in a build
 * that keeps an outbox, the ask is kept there instead and goes out once the connection is back (`keptOffline`).
 */
export function askAction(client: Client, path = "ask", ctx?: BotsCtx): ActionSpec {
  // Given the screen's ctx: the moment an ask is out (askMoment.ts): the words up as a bubble at once, the box cleared, the answer
  // written in as it comes.
  if (ctx) return askMomentAction(ctx, path);
  return {
    kind: "sequence", actions: [
      { kind: "condition", if: { falsy: path }, then: { kind: "toast", message: "Type what you need first" }, else: keptOffline(client, { message: `$state.${path}`, clear: path }, {
        kind: "sequence", actions: [
          { kind: "setState", path: "asking", value: true },
          {
            kind: "callEndpoint", method: "POST", path: "/v1/ask",
            body: { message: `$state.${path}`, device: client, mode: "text", bot: "any" },
            assignTo: "asked",
            onSuccess: { kind: "sequence", actions: [
              { kind: "setState", path: "asking", value: false },
              { kind: "navigate", screenId: SCREENS.ask, params: { message: `$state.${path}`, answer: "$state.asked.result.text", id: "$state.asked.id" } },
              { kind: "clearState", path },
            ] },
            onError: { kind: "sequence", actions: [
              { kind: "setState", path: "asking", value: false },
              { kind: "toast", message: "Couldn't reach your bots. Try again.", tone: "error" },
            ] },
          },
        ],
      }) },
    ],
  };
}

/** askAction, the moment's way (askMoment.ts): the same call and answer, the words up as a bubble first, the answer streamed. */
function askMomentAction(ctx: BotsCtx, path: string): ActionSpec {
  return {
    kind: "condition", if: { falsy: path }, then: { kind: "toast", message: "Type what you need first" }, else: keptOffline(ctx.client, { message: `$state.${path}`, clear: path }, {
      kind: "sequence", actions: [
        ...momentStart({ message: `$state.${path}`, from: path, busy: "asking" }),
        momentStreamed(ctx, {
          kind: "callEndpoint", method: "POST", path: "/v1/ask",
          body: { message: SENT_WORDS, device: ctx.client, mode: "text", bot: "any" },
          assignTo: "asked",
          onSuccess: { kind: "sequence", actions: [
            { kind: "setState", path: "asking", value: false },
            { kind: "navigate", screenId: SCREENS.ask, params: { message: SENT_WORDS, answer: "$state.asked.result.text", id: "$state.asked.id" } },
          ] },
          onError: momentFailed({ busy: "asking", from: path, then: { kind: "toast", message: "Couldn't reach your bots. Try again.", tone: "error" } }),
        }),
      ],
    }),
  };
}

/**
 * Offline, as a build that keeps an outbox says (`online` is false in every screen's state; any other build never says so). Read when
 * the person sends, so an ask is either kept or sent, never both.
 */
export const OFFLINE: Condition = { eq: ["online", false] };

/** What an ask bar says when it kept an ask. */
export const KEPT_OFFLINE = "Kept. It will send when you're back.";

/**
 * AN ASK BAR, OFFLINE: what was typed goes into the outbox (keepAsk, as the Offline screen's field does: POST /v1/shell/ask, once, in
 * order, when the connection is back), the field (`clear`) is emptied, and a short line says so. Online, `send` runs as it always did.
 * `who` is the line's bot ("Code bot · asked 9:38"), `bot` the slug it goes to.
 */
export function keptOffline(client: Client, o: { message: string; bot?: string; who?: string; clear?: string }, send: ActionRef): ActionSpec {
  const keep: ActionSpec = {
    kind: "sequence", actions: [
      keepAsk(client, { message: o.message, bot: o.bot ?? "any", label: o.message, sub: `${o.who ?? "Any bot"} · asked {time}` }),
      ...(o.clear ? [{ kind: "clearState", path: o.clear } as ActionSpec] : []),
      { kind: "toast", message: KEPT_OFFLINE },
    ],
  };
  return { kind: "condition", if: OFFLINE, then: keep, else: send };
}

/**
 * The ask bar (Kit2): "Ask any bot…" with the mic, or send once something is typed. Enter / return sends. The
 * phone's mic opens the Ask screen listening; the window's starts dictation (hold Fn and speak).
 */
export function askBar(client: Client, o: { placeholder?: string; path?: string; ctx?: BotsCtx } = {}): Node {
  const path = o.path ?? "ask";
  const send = askAction(client, path, o.ctx);
  const mic: ActionRef = client === "desktop" ? { kind: "dictate" } : { kind: "navigate", screenId: SCREENS.ask, params: { voice: true } };
  return col([
    row([
      {
        type: "TextField", id: "ask", bind: { value: path },
        props: {
          placeholder: o.placeholder ?? (client === "desktop" ? "Ask any bot…  or hold Fn and speak" : "Ask any bot…"),
          placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 44,
          returnKeyType: "send", color: C.ink,
        },
        on: { onSubmit: send },
        style: {
          flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0,
          fontFamily: FACE.regular, fontSize: 16, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
        },
      },
      when({ truthy: path }, roundButton("send", send, { label: "Send" })),
      when({ falsy: path }, roundButton("mic", mic, { label: "Speak" })),
    ], { gap: 10, borderRadius: client === "desktop" ? 30 : RADIUS.input, borderWidth: 1, borderColor: C.line, paddingVertical: 6, paddingRight: 6, paddingLeft: client === "desktop" ? 22 : 18, backgroundColor: C.paper }),
    o.ctx
      ? askMoment(o.ctx, { slug: "tailzu", color: C.ink, kind: "custom", busy: "asking", line: "Asking your bots…", bubble: "surface" })
      : when({ truthy: "asking" }, row([statusMark("working", { color: C.ink }), meta("Asking your bots…", { size: 13 })], { gap: 8, paddingLeft: 18 })),
  ], { gap: 8 });
}

// ===================================================================== navigation

export const open = (screenId: string, params?: Record<string, unknown>): ActionSpec =>
  ({ kind: "navigate", screenId, ...(params ? { params } : {}) });
export const back = (): ActionSpec => ({ kind: "navigateBack" });
export const toTab = (tab: TabId): ActionSpec => ({ kind: "switchTab", tabId: tab });
export const call = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: Record<string, unknown>, then?: { ok?: ActionRef; fail?: ActionRef; assignTo?: string }): ActionSpec => ({
  kind: "callEndpoint", method, path, ...(body ? { body } : {}), ...(then?.assignTo ? { assignTo: then.assignTo } : {}),
  ...(then?.ok ? { onSuccess: then.ok } : {}), ...(then?.fail ? { onError: then.fail } : {}),
});
/** One action after another; absent ones are skipped. */
export function seq(...actions: Array<ActionRef | undefined>): ActionRef {
  const list = actions.filter((a): a is ActionRef => !!a);
  return list.length === 1 ? list[0]! : { kind: "sequence", actions: list };
}

// ===================================================================== frames

const TABS: Array<{ id: TabId; title: string }> = [
  { id: "bots", title: "Bots" }, { id: "activity", title: "Activity" }, { id: "you", title: "You" },
];

/** The phone's tab bar: three living icons with their words, live state from ctx.live. Last child of a top-level page. */
export function tabBar(active: TabId, live: BotsLive): Node {
  return {
    type: "SafeArea",
    props: { edges: ["bottom"], inset: "max" },
    style: {
      flexGrow: 0, flexShrink: 0, flexDirection: "row", borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 6, paddingBottom: 16,
      backgroundColor: C.paper,
    },
    children: TABS.map((t) => col([
      tabGlyph(t.id, t.id === active, live.tab, 26),
      text(t.title, { size: 11, weight: t.id === active ? 600 : 400, color: t.id === active ? C.ink : C.meta, lineHeight: 14 }),
    ], { flexGrow: 1, flexBasis: 0, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 48 }, t.id === active ? undefined : toTab(t.id))),
  };
}

const NAV_ITEM: Style = { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: 12 };

function navItem(labelText: string, glyph: Node, active: boolean, onPress: ActionRef | undefined, h: number, right?: Node): Node {
  return row([
    box([glyph], { width: 22, height: 22, alignItems: "center", justifyContent: "center" }),
    text(labelText, { size: 14, weight: active ? 600 : 400, lineHeight: 18, color: C.ink, style: { flexShrink: 1 } }),
    ...(right ? [box([right], { marginLeft: "auto", flexShrink: 0 })] : []),
  ], { ...NAV_ITEM, minHeight: h, ...(active ? { backgroundColor: C.surface } : {}) }, active ? undefined : onPress);
}

/** The window's sidebar: the mark, the three tabs as living icons, your bots (live), Make a bot, the desk's pages, settings. */
export function sidebar(ctx: BotsCtx, active?: string): Node {
  const live = ctx.live;
  const plain = (name: IconName, on: boolean) => icon(name, { size: 20, color: on ? C.ink : C.meta });
  const botItems = live.bots.slice().sort((a, b) => ORDER(a) - ORDER(b)).map((b) => {
    const dot = statusMark("working", { color: b.color, still: !b.working });
    const right = b.needs ? statusMark("needs")
      : b.working ? text("working", { size: 12, weight: 500, color: b.color }) : undefined;
    return navItem(b.name, dot, active === b.slug, botRoute(b.slug), 38, right);
  });
  const settingsId = ctx.desk.pages ? "desk_settings" : "settings";
  return col([
    row([tailzuMark(28), text("Tailzu", { size: 17, weight: 700, tracking: -0.3 })], { gap: 10, paddingHorizontal: 8, paddingBottom: 16 }),
    ...TABS.map((t) => navItem(t.title, tabGlyph(t.id, active === t.id, live.tab, 22), active === t.id, toTab(t.id), 44)),
    sectionLabel("Your bots", { style: { paddingTop: 16, paddingBottom: 6, paddingHorizontal: 10 } }),
    ...botItems,
    navItem("Make a bot", icon("plus", { size: 18, color: C.meta }), active === "make", open(SCREENS.make), 38),
    box([], { height: 1, backgroundColor: C.divider, marginVertical: 8, marginHorizontal: 10 }),
    ...(ctx.desk.pages ? [navItem("Today", plain("today", active === "today"), active === "today", open(SCREENS.today), 40)] : []),
    ...(ctx.desk.notes ? [navItem("Notes", plain("notes", active === "notes"), active === "notes", open(SCREENS.notes), 40)] : []),
    grow(),
    navItem("This computer helps", plain("computer", active === "computer"), active === "computer", open(SCREENS.computer), 40, meta("On")),
    navItem("Settings", plain("settings", active === "settings"), active === "settings", open(settingsId), 40),
  ], {
    width: 240, flexShrink: 0, height: "100%", borderRightWidth: 1, borderRightColor: C.divider, paddingTop: 22, paddingHorizontal: 14, paddingBottom: 18, gap: 2,
    backgroundColor: C.paper,
  });
}
/** The sidebar lists the bots in their own order (not needs-first, so they do not jump about). */
const ORDER = (b: LiveBot): number => {
  const i = ["code", "keybot", "plan", "travel"].indexOf(b.slug);
  return b.builtin && i >= 0 ? i : 10;
};

export interface PageOpts {
  /** A top-level page: the phone shows the tab bar with this tab lit; the window lights it in the sidebar. */
  tab?: TabId;
  /** The window's lit sidebar item when the page is not a tab: a bot's slug, "make", "today", "notes", "computer", "settings". */
  nav?: string;
  /** The screen's title (the window's title bar, the screen reader). Not drawn: draw a `title()` in the body. */
  title?: string;
  /** A back bar on top. true: navigateBack. */
  back?: boolean | ActionRef;
  /** The back bar's title. */
  backTitle?: string;
  backRight?: Node;
  body: Node[];
  /** Pinned under the content: the ask bar, a screen's one primary button. */
  footer?: Node[];
  state?: Record<string, unknown>;
  actions?: Record<string, ActionSpec>;
  /** Between the body's blocks (22 on the phone, 28 in the window by default). */
  gap?: number;
  /** The window's main column at most this wide (880). */
  maxWidth?: number;
  /** Over the top of the page, outside its scroll (a HeadBar): before the phone's Screen, before the window's column. */
  pinned?: Node[];
  /** Live topics this screen listens to (src/live/bus.ts): when one changes, the open screen reloads itself. */
  live?: string[];
}

/** A page for whichever client is asking: phonePage or deskPage. Most screens need only this. */
export function page(ctx: BotsCtx, o: PageOpts): ScreenResponse {
  return ctx.client === "desktop" ? deskPage(ctx, o) : phonePage(ctx, o);
}

function response(ctx: BotsCtx, o: PageOpts, root: Node): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION, screenId: ctx.screenId, ...(o.title ? { title: o.title } : {}),
    hideChrome: true, look: "bots", theme: BOTS_THEME, cacheTtlSeconds: 0,
    state: { ask: "", asking: false, ...(o.state ?? {}) }, ...(o.actions ? { actions: o.actions } : {}), root,
    ...(o.live?.length ? { liveTopics: o.live } : {}),
  };
}

const backNode = (o: PageOpts): Node[] =>
  o.back ? [backBar({ title: o.backTitle, onBack: o.back === true ? undefined : o.back, right: o.backRight })] : [];

/**
 * The phone's page (390 wide in the boards): white, 20 at the sides, safe-area aware, the body scrolls, the footer
 * and the tab bar stay put. A top-level page (`tab`) ends with the tab bar.
 */
export function phonePage(ctx: BotsCtx, o: PageOpts): ScreenResponse {
  const root: Node = {
    type: "SafeArea",
    props: { edges: ["top"], barStyle: "dark-content" },
    style: { flex: 1, flexDirection: "column", backgroundColor: C.paper },
    children: [
      ...(o.pinned ?? []),
      {
        type: "Screen",
        props: { paddingBottom: 24 },
        style: { backgroundColor: C.paper, paddingHorizontal: 20, paddingTop: o.back ? 8 : 16, gap: o.gap ?? 22 },
        children: [...backNode(o), ...o.body],
      },
      ...(o.footer?.length ? [col(o.footer, { paddingHorizontal: 20, paddingTop: 8, paddingBottom: o.tab ? 22 : 16, gap: 12, backgroundColor: C.paper })] : []),
      ...(o.tab ? [tabBar(o.tab, ctx.live)] : []),
    ],
  };
  return response(ctx, o, root);
}

/**
 * The window's page (1280 x 800 in the boards, fluid): the sidebar on the left, the main column scrolls, the footer
 * stays at its foot. The column is at most 880 wide.
 */
export function deskPage(ctx: BotsCtx, o: PageOpts): ScreenResponse {
  const main = col([
    col([
      ...backNode(o),
      ...o.body,
      ...(o.footer?.length ? [grow(), ...o.footer] : []),
    ], { maxWidth: o.maxWidth ?? 880, width: "100%", flexGrow: 1, gap: o.gap ?? 28 }),
  ], { flexGrow: 1, flexShrink: 1, minWidth: 0, height: "100%", overflowY: "auto", paddingTop: 40, paddingHorizontal: 48, paddingBottom: 32 });
  // Pinned (a HeadBar): just before the column that scrolls, in a frame of their own, so they stay over its top.
  const column = o.pinned?.length ? col([...o.pinned, main], { flexGrow: 1, flexShrink: 1, minWidth: 0, height: "100%", position: "relative" }) : main;
  const root = row([sidebar(ctx, o.tab ?? o.nav), column], { height: "100%", minHeight: 600, alignItems: "stretch", backgroundColor: C.paper });
  return response(ctx, o, root);
}

/** The page for a screen id that is not built yet: says so, and offers the way back. */
export function comingSoon(ctx: BotsCtx): ScreenResponse {
  return page(ctx, {
    back: true, title: "On its way",
    body: [emptyState({ pose: "think", title: "This part is on its way", body: "It's being built. Everything else works as before." })],
  });
}

/**
 * No money on any screen: what Tailzu costs, a price, an amount. Use is shown the way the usage meter shows it (src/you/usage.ts):
 * `usageMeter`, `percent` ("64%") and `whenWords` ("Thu 9 am").
 */

/** A usage meter: "This stretch · 64% used", its bar, and when it resets. `used` is a fraction (0.64); never an amount. */
export function usageMeter(label: string, used: number, o: { resets?: string; color?: string; height?: number } = {}): Node {
  const part = Math.max(0, Math.min(1, used));
  return col([
    row([text(label, { size: 14, weight: 600 }), grow(), text(`${Math.round(part * 100)}% used`, { size: 14, color: C.grey70 })]),
    meter(part, 1, { color: o.color ?? C.ink, height: o.height ?? 6 }),
    ...(o.resets ? [meta(o.resets, { size: 12 })] : []),
  ], { gap: 8 });
}

/** Minutes as a person reads them: "45 min", "2 h", "1 h 20 min". */
export function duration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r >= 10 ? `${h} h ${r} min` : `${h} h`;
}

// ===================================================================== a live page, and the outbox (shared/types/sdui.ts 3e)

/** A build that draws LiveView: a running page or artifact, in a sandbox of its own. */
export const canLive = (ctx: BotsCtx): boolean => ctx.can.has(LIVE_VIEW_COMPONENT);

/**
 * A running page (LiveView): from `url`, or the `html` the server wrote (run as `origin`). Its loading and error states are the app's
 * own, in these words. What the page says goes to `messagePath`, then `onResult` runs; `sendPath` names the state the page is told
 * whenever it changes (its window.tzLive). Give it a height, or let it grow in a box that has one.
 */
export function liveView(p: LiveViewProps, o: { sendPath?: string; onResult?: ActionRef; onError?: ActionRef; style?: Style } = {}): Node {
  return {
    type: "LiveView",
    props: { loadingText: "Loading…", errorText: "Couldn't show this page.", retryText: "Try again", fontFamily: FACE.regular, ...p },
    style: { backgroundColor: C.paper, overflow: "hidden", ...(p.height ? { height: p.height } : {}), ...o.style },
    ...(o.sendPath ? { bind: { send: o.sendPath } } : {}),
    ...(o.onResult || o.onError ? { on: { ...(o.onResult ? { onResult: o.onResult } : {}), ...(o.onError ? { onError: o.onError } : {}) } } : {}),
  };
}

/** A build that keeps an outbox: asks typed offline wait on the device and go out once, in order, when the connection is back. */
export const hasOutbox = (ctx: BotsCtx): boolean => ctx.can.has(OUTBOX_CAPABILITY);

/** Keep an ask in the outbox: POST /v1/shell/ask, once (now, if online). `sub` is its line under it; "{time}" is when it was typed. */
export function keepAsk(client: Client, o: { message: string; bot?: string; label?: string; sub: string }): ActionSpec {
  return {
    kind: "outbox", op: "add", path: "/v1/shell/ask", body: { message: o.message, bot: o.bot ?? "any", device: client, mode: "text" },
    label: o.label ?? o.message, sub: o.sub,
  };
}

export type { BotsLive, LiveBot, NeedsItem };
