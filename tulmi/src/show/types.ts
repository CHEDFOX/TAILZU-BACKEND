/**
 * WHAT A BOT MAY DRAW UNDER ITS WORDS: A FEW BUILDING BLOCKS THAT COMPOSE, NOT A LIST OF WIDGETS. The story is in docs/show.md.
 *
 * No list of components could ever cover what an answer may need (a selector, the one thing that matters, the next steps, a
 * comparison, a chart, a floor plan...). So a bot is given parts that fit together instead, the way a page is made of a few tags:
 *
 *   words      text, callout, list, facts, table, stat, steps, divider
 *   numbers    chart (bars or a line), progress
 *   pictures   draw (circles and paths on a canvas: anything the rest cannot say), image, link
 *   boxes      row, grid, card: they hold any of the others, and each other
 *   asking     choice (one tap sends it, or several and Send), suggest (next questions), form (a few fields and Send)
 *
 * Every block is plain data, checked on the way in (check.ts) and drawn with the Bots kit's own parts (experience/bots/show.ts),
 * so the phone and the window draw it today, with no release. Whatever it is, it is drawn in ONE look: monochrome, minimal dot art
 * (dots.ts), whose dots spring in on real springs (experience/bots/show.ts). Now and then Blip, the app's little bot, stands beside
 * a drawing (`blip`). Nothing here reads the environment, a store or a model.
 */

/** How a box or a callout is coloured: the natural palette's quiet tones, or the bot's own colour. */
export const TONES = ["info", "tip", "warn", "good", "bot"] as const;
export type Tone = (typeof TONES)[number];

export const TEXT_STYLES = ["title", "heading", "body", "label", "meta", "big", "mono"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const LIST_STYLES = ["bullet", "number", "check"] as const;
export type ListStyle = (typeof LIST_STYLES)[number];

export const STEP_STATES = ["done", "now", "next"] as const;
export type StepState = (typeof STEP_STATES)[number];

export const CHART_KINDS = ["bar", "line"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export const FIELD_KINDS = ["text", "number", "choice"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** The paints a drawing may name, besides a hex colour: the kit's greys, the natural palette, and the bot's own colour. */
export const DRAW_COLOURS = ["none", "ink", "grey", "line", "surface", "paper", "bot", "moss", "clay", "ochre", "sea", "pine", "plum", "sand", "stone"] as const;

/** One shape of a drawing, in the drawing's own units: a circle or a path, with its paint. */
export interface DrawShape {
  circle?: [number, number, number];
  d?: string;
  fill?: string;
  stroke?: string;
  width?: number;
}

export interface Option { label: string; note?: string }
export interface Field { label: string; kind: FieldKind; options?: string[]; placeholder?: string }

export type Block =
  | { type: "text"; text: string; style?: TextStyle }
  | { type: "callout"; text: string; title?: string; tone: Tone }
  | { type: "list"; items: string[]; style: ListStyle }
  | { type: "facts"; items: Array<{ label: string; value: string }> }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "stat"; label: string; value: string; note?: string }
  | { type: "progress"; value: number; max: number; label?: string }
  | { type: "steps"; items: Array<{ title: string; note?: string; state?: StepState }> }
  | { type: "chart"; kind: ChartKind; items: Array<{ label: string; value: number }>; unit?: string }
  | { type: "draw"; width: number; height: number; shapes: DrawShape[]; label?: string }
  | { type: "image"; url: string; alt: string }
  | { type: "link"; label: string; url: string }
  | { type: "divider" }
  | { type: "row"; children: Block[] }
  | { type: "grid"; columns: number; children: Block[] }
  | { type: "card"; title?: string; tone?: Tone; children: Block[] }
  /** `key`: where its picks are kept on the screen (check.ts gives it), so the server can turn them back into words (answer.ts). */
  | { type: "choice"; key: string; question?: string; options: Option[]; multi: boolean; send: string }
  | { type: "suggest"; items: string[] }
  | { type: "form"; key: string; title?: string; fields: Field[]; send: string };

export type BlockType = Block["type"];

export const BLOCK_TYPES: readonly BlockType[] = [
  "text", "callout", "list", "facts", "table", "stat", "progress", "steps", "chart", "draw", "image", "link", "divider",
  "row", "grid", "card", "choice", "suggest", "form",
];

/** The blocks that hold others. */
export const BOXES: ReadonlySet<BlockType> = new Set(["row", "grid", "card"]);

/**
 * Blip beside a drawing, now and then, doing what fits it: survey (numbers or a drawing to look at), read (a note to read), think (a
 * choice to make), wave (a plan done, good news).
 */
export const BLIP_ACTS = ["survey", "read", "think", "wave"] as const;
export type BlipAct = (typeof BLIP_ACTS)[number];

/** What a bot drew for one answer, as it is kept with the turn. */
export interface Shown {
  blocks: Block[];
  /** "drawn": the answer's own lists are shown by the blocks (a table, a choice, the steps), so the chat leaves them out of the words. */
  lists?: "drawn";
  /** Blip beside the first drawing, doing this. Absent most of the time. */
  blip?: BlipAct;
}

/** The caps. A block over one is cut to it; one that is wrong is dropped alone and the rest stay. */
export const SHOW_LIMITS = {
  /** Blocks at the top. */
  top: 8,
  /** Blocks in all, nested ones included. */
  total: 48,
  /** How deep boxes may nest. */
  depth: 3,
  /** Characters of one piece of text. */
  text: 600,
  /** Characters of a label, an option, a cell. */
  label: 80,
  /** Items of a list, facts, steps, a chart; options of a choice. */
  items: 12,
  options: 8,
  suggest: 4,
  fields: 6,
  columns: 6,
  rows: 16,
  /** A drawing: its shapes, one path's length, its canvas. */
  shapes: 60,
  path: 1_500,
  canvas: 1_000,
  /** Grid columns. */
  grid: 4,
  /** Links and pictures in one answer. */
  links: 6,
} as const;
