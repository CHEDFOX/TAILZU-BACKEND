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
import { builtinBot } from "../../bots/builtin.js";
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
  // A neutral for a built-in that wants one, warmer than stone so the two do not read as the same grey. stone is
  // also the fallback colour below, so nothing that ships may wear it.
  ash: "#6B6762",
};

/** The built-ins, in the order the app lists them. */
export const BUILTIN_SLUGS = ["code", "keybot", "plan", "travel"] as const;

/**
 * THE LINE ICON OF EACH BUILT-IN. Only the icon: a bot's COLOUR is decided in src/bots/builtin.ts and read from
 * there (`builtinColour` below), because this table used to carry its own copy of the four and the two disagreed —
 * builtin.ts said Xode was pine while this said moss — for as long as both existed. One answer now.
 */
const BUILTIN_ICON: Record<string, IconName> = {
  code: "code",
  keybot: "keyboard",
  plan: "calendar",
  travel: "pin",
  // Each listed only where its own service is set up, but its icon costs nothing to know.
  mail: "mail",
  lingo: "book",
  tailzu: "spark",
};

/** A built-in's colour, from its own definition. Null for a slug that is not a built-in. */
function builtinColour(slug: string): string | null {
  const def = builtinBot(slug);
  return def ? (PALETTE_HEX[def.colour] ?? null) : null;
}

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
  // Tailzu itself is not a bot in builtin.ts, so it keeps its own ink.
  if (slug === "tailzu") return { color: C.ink, icon: BUILTIN_ICON.tailzu!, ...(headUrl(slug) ? { head: headUrl(slug)! } : {}) };
  // The icon is looked up FIRST and outside the branch below, because it does not depend on configuration. A bot
  // whose service is not set up is not in builtinBot() at all, and it was that which used to leave the Oracle, the
  // meeting bot and Lingo wearing the generic spark: their icon is known whether or not their service is.
  const icon = BUILTIN_ICON[slug] ?? ownIcon(slug);
  const own = builtinColour(slug);
  if (own) return { color: own, icon, ...(headUrl(slug) ? { head: headUrl(slug)! } : {}) };
  return { color: (colour && PALETTE_HEX[colour]) || PALETTE_HEX.stone!, icon };
}
