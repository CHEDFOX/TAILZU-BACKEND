/**
 * THE ONBOARDING'S IDENTITY, CARRIED INTO THE APP AS TOUCHES.
 *
 * The app stays black and amber; this is not a repaint. Three small things from
 * the new onboarding (onboard.ts) travel, and nowhere else:
 *
 *   1. The heading face, for the big page titles. The onboarding's headings are
 *      Bricolage Grotesque at 800 (FONTS: "Tailzu Grotesk"). It is registered
 *      for every build already (catalog FONTS), and a build that fails to load
 *      it draws the system face, so a phone is never worse off.
 *   2. Neon (#39FF14), only for "done / connected / on". Never for a button,
 *      a link, a heading or a decoration.
 *   3. Blip's small loops (the /blip/ pictures, served the way the typefaces
 *      are), few and small: the greeting on the home page, an empty state with
 *      one warm line, a working state, a success, an error. One a screen, never
 *      in a list or a row, never on Settings. An Image node draws them in
 *      every build.
 *
 * This module imports nothing that imports the catalog, so desk.ts (which must
 * not import the catalog) can use it as the phone's screens do.
 */
import type { Node } from "../../../shared/types/sdui.js";
import { blipSize, blipUrl } from "./blipLoops.js";
import type { BlipLoop } from "./blipLoops.js";

/** The onboarding's neon (onboard.ts OB.neon): a state, never a style. */
export const NEON = "#39FF14";

/** The heading face the onboarding uses (onboard.ts OB.headingFont, catalog FONTS). */
export const HEADING_FACE = "Tailzu Grotesk";

/**
 * A small neon dot for a state that is done, connected or on. It carries a
 * thin dark ring so it reads on the desk's white sheet as well as on black.
 */
export function neonDot(size = 8): Node {
  return {
    type: "Stack",
    style: {
      width: size, height: size, borderRadius: size / 2, flexShrink: 0,
      backgroundColor: NEON, borderWidth: 1, borderColor: "rgba(21,19,17,0.5)",
    },
  };
}

/** One of Blip's loops at its true size times `scale`, as the Image node every build draws. */
export function blipPicture(loop: BlipLoop, scale = 1): Node {
  const { w, h } = blipSize(loop);
  return {
    type: "Image",
    props: { source: { url: blipUrl(loop) }, contentFit: "contain" },
    // A radius of 0: an Image rounds itself by default, and he is not a tile.
    style: { width: Math.round(w * scale), height: Math.round(h * scale), borderRadius: 0 },
  };
}

/**
 * Blip in a box of exactly his own width, for beside a line of words. An Image
 * centres itself with auto margins, which in a row would push him away from
 * the line next to him; in a box his own size there is nothing to centre in.
 */
export function blipBox(loop: BlipLoop, scale = 1): Node {
  const pic = blipPicture(loop, scale);
  return { type: "Stack", style: { width: (pic.style as { width: number }).width, flexShrink: 0 }, children: [pic] };
}

/** The part of the day it is for the person: morning, afternoon, evening or night. */
export type DayPart = "morning" | "afternoon" | "evening" | "night";

/**
 * The part of the day in the PERSON'S time zone: `tzOffsetMinutes` is the
 * caller's UTC offset the clients send on every screen fetch (ScreenContext).
 * Absent, the server's own clock in UTC is all there is to go by. Five to
 * eleven is morning, noon to four afternoon, five to eight evening, and the
 * rest (nine at night to four in the morning) is night.
 */
export function dayPart(tzOffsetMinutes?: number, nowMs: number = Date.now()): DayPart {
  const offset = Math.max(-840, Math.min(840, Math.round(Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes! : 0)));
  const hour = new Date(nowMs + offset * 60_000).getUTCHours();
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "night";
}
