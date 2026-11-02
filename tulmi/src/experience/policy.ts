/**
 * Links and allowances every surface shares: the legal pages and the free plan.
 */

import { getConfig } from "../config.js";

/**
 * Optional hero art for a screen — the ONE uniform media slot every major
 * screen carries.
 *
 * Upload to `hero.<screenId>` and the screen opens with that art in a rounded
 * banner; upload nothing and the node does not exist, so an undressed screen
 * looks deliberate instead of reserving an empty hole. The check happens HERE,
 * server-side, which is what makes absence free.
 *
 *   POST /v1/media/upload?key=hero.voices      → tones list gets a header
 *   POST /v1/media/upload?key=hero.stats       → stats screen gets one
 *   DELETE the key → the banner is gone next fetch
 *
 * A GIF animates (expo-image plays it natively); a still just sits. Same
 * resilient pattern as the intro: plain Image node, resolved url, clipped by a
 * plain view.
 */
/**
 * How a media node is told to fill the box its parent already drew.
 *
 * NOT `{ width: "100%", height: "100%" }`, which is what every one of these
 * used to be and what quietly broke every full-bleed image in the app. The
 * client's Image node applies its own defaults UNDERNEATH whatever style
 * arrives — `aspectRatio: 1.6` and `borderRadius: 10` — and a style that sets
 * only width and height overrides neither. Yoga then holds a width and an
 * aspect ratio, which is enough to derive a height, so the height was ignored
 * and the media rendered as a rounded 1.6 landscape strip: the opening media,
 * the flow clip, every hero, all cropped through their own middle.
 *
 * Four insets leave Yoga nothing to derive — both dimensions come from the
 * parent, so the aspect ratio has no job — and the explicit radius buries the
 * other default. It is the one shape that survives a client this file cannot
 * rebuild.
 */
/**
 * The two pages every surface has to be able to reach.
 *
 * Written seven times across this file before this existed, which is seven
 * chances for one of them to be the old one. They are also the pages Paddle
 * checks before it will sell on your behalf, so a stale copy is not cosmetic.
 */
export const POLICY = {
  privacy: "https://x0bot.com/privacy",
  terms: "https://x0bot.com/terms",
} as const;

/**
 * Free words per month — THE SAME NUMBER THE SERVER ENFORCES.
 *
 * This claimed to be that already, and was not. It re-read the env with its own
 * default of 2500 while config.ts defaults to 800, so with the variable unset —
 * which is how it actually runs — the app promised 2,500 words and the meter cut
 * users off at 800. Two readers, two sources, and the drift was the value
 * itself.
 *
 * Read through getConfig() now. It is the one place the env is parsed, and both
 * the allowance and the meter read it, so a number shown here cannot disagree
 * with the number charged there. A function, not a module constant: config is
 * resolved at boot, and a const evaluated at import time would freeze whatever
 * the env looked like before that.
 */
export function freeMonthlyWords(): number {
  return Math.max(0, getConfig().FREE_MONTHLY_WORDS);
}

/** Tailzu is free for everyone right now (FREE_FOR_ALL): no limit, and
 *  nothing anywhere that sells. Exported for the desk and the routes. */
export function freeForAll(): boolean {
  return getConfig().FREE_FOR_ALL === true;
}
