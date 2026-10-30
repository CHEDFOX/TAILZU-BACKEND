/**
 * THE BOTS APP'S COLOURS AND EACH BOT'S LOOK.
 *
 * STYLE.md: the app is white and ink with greys; colour belongs ONLY to bots, natural tones, and may appear on a
 * bot's avatar, its working dot, its own accent, its selected card border and its progress segment. Never for an
 * error, a success, a link or a warning.
 *
 * The design gives the four built-ins their colours by bot (Code moss, Keylessbord clay, Plan ochre, Travel sea). The
 * bots platform's own definitions (src/bots/builtin.ts) name different palette entries for them; the app follows
 * the design, so a built-in's colour here is by SLUG and a person's own bot's is its palette name.
 */
import { headUrl } from "./art.js";
import type { IconName } from "./glyphs.js";

/** Ink, greys and lines. */
export const C = {
  paper: "#ffffff",
  ink: "#0a0a0a",
  /** Secondary text. */
  grey70: "#3d3d3d",
  /** Meta text, section labels, idle tab labels. */
  meta: "#5c5c5c",
  /** Idle icons. */
  idle: "#8a8a8a",
  /** Card borders. */
  line: "#e6e6e6",
  /** Dividers. */
  divider: "#ededed",
  /** Outline buttons. */
  outline: "#d4d4d4",
  /** The dashed "make one" card and an empty dot. */
  dashed: "#c9c9c9",
  /** Fills: the code background, a segmented track, an avatar's ground. */
  surface: "#f5f5f5",
  /** A meter's track, a switch that is off. */
  track: "#e0e0e0",
} as const;

/** The natural palette, by the bots platform's names (src/bots/types.ts PALETTE). */
export const PALETTE_HEX: Record<string, string> = {
  moss: "#4F7A3A", clay: "#A9573A", ochre: "#8F6A1F", sea: "#3E6E8E",
  pine: "#2F5D50", plum: "#6E4A6B", sand: "#7A6440", stone: "#5F6B6E",
};

/** The built-ins, in the order the app lists them. */
export const BUILTIN_SLUGS = ["code", "keybot", "plan", "travel"] as const;

const BUILTIN: Record<string, { color: string; icon: IconName }> = {
  code: { color: PALETTE_HEX.moss!, icon: "code" },
  keybot: { color: PALETTE_HEX.clay!, icon: "keyboard" },
  plan: { color: PALETTE_HEX.ochre!, icon: "calendar" },
  travel: { color: PALETTE_HEX.sea!, icon: "pin" },
  tailzu: { color: C.ink, icon: "spark" },
};

/** How a bot looks: its colour, its line icon, and its head (a built-in's) or none (a person's own). */
export interface BotLook {
  color: string;
  icon: IconName;
  head?: string;
}

/** A person's own bot's icon, by what it is called. */
function ownIcon(slug: string): IconName {
  return /gym|fit|workout|run/.test(slug) ? "dumbbell"
    : /study|learn|exam|read/.test(slug) ? "book"
    : /money|spend|budget|tax/.test(slug) ? "rupee"
    : /recipe|cook|food|meal/.test(slug) ? "pot"
    : /shop|buy/.test(slug) ? "bag"
    : "spark";
}

export function botLook(slug: string, colour?: string): BotLook {
  const b = BUILTIN[slug];
  if (b) return { ...b, ...(headUrl(slug) ? { head: headUrl(slug)! } : {}) };
  return { color: (colour && PALETTE_HEX[colour]) || PALETTE_HEX.stone!, icon: ownIcon(slug) };
}
