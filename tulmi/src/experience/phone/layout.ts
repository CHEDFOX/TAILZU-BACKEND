/**
 * Layout rules the phone screens share: wide windows, readable columns, full-bleed fills.
 */

import type { ScreenContext } from "../screens.js";

export const FILL_STYLE = {
  position: "absolute" as const,
  top: 0, left: 0, right: 0, bottom: 0,
  borderRadius: 0,
};

/**
 * IS THIS A WINDOW RATHER THAN A PHONE?
 *
 * Asked of the viewport, not of the platform. A desktop window, a tablet held
 * landscape and a phone in a car dock are the same question — there is more
 * width here than a single column needs — and the answer should not depend on
 * which binary is asking. The desktop app has been sending its window size all
 * along; it simply declared itself as iOS, which was true about what it can
 * draw and silent about how much room it has.
 *
 * 720 because that is roughly where a 390pt column stops being the shape of
 * the screen and starts being a strip down the middle of one.
 */
const WIDE_AT = 720;

/**
 * A DESKTOP DRAWING THE DESK'S OWN PAGES (experience/desk.ts).
 *
 * Its tabs are desk_today … desk_train, so a phone tab named as the way out of
 * a screen — "personality", "stats" — lands a window on the phone's You or
 * Stats. Screens that both can reach name their exit through this.
 */
export function onDesk(ctx: ScreenContext): boolean {
  return ctx.formFactor === "desktop" && !!ctx.can?.has("DeskShell");
}

function isWide(ctx: ScreenContext): boolean {
  return (ctx.viewport?.width ?? 0) >= WIDE_AT;
}

/**
 * A column that stops growing.
 *
 * Text does not get more readable past about sixty characters, so a window
 * twice as wide as a phone should not be a line twice as long — it should be
 * the same line with air either side. Everything that is a LIST on this app
 * (settings, voices, words, languages) stays a column and is centred; only the
 * things that are genuinely two things side by side get to use the width.
 */
export function readable(ctx: ScreenContext, max = 560): Record<string, unknown> {
  return isWide(ctx) ? { maxWidth: max, width: "100%", alignSelf: "center" } : {};
}
