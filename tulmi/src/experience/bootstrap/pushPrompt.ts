/**
 * When the app asks for notification permission, sent in the bootstrap.
 */

// --- Bootstrap --------------------------------------------------------------

/**
 * Should this launch open with a prompt on top of the first screen, and which?
 *
 * A question the user has not answered is worth asking again — but not at the
 * door, and not every time. The rules, in order:
 *
 *   - Never before they have used the app a few times. A prompt on launch two
 *     is onboarding wearing a different hat, which is what we just removed.
 *   - Then periodically, not on every launch, so dismissing it buys real quiet
 *     rather than one screen.
 *   - And it stops for good after a while. Someone who has declined a dozen
 *     times has answered.
 *
 * It resolves itself: the moment the user picks a language the condition is
 * false and the prompt never returns. Every number here is a constant in one
 * place, so the cadence is editable without touching the logic.
 */
const PROMPT_FIRST_LAUNCH = 3;    // not before the 3rd open
const PROMPT_EVERY = 4;           // then every 4th
const PROMPT_GIVE_UP_AFTER = 40;  // and never after the 40th
/** How long to let the user get on with things before the card appears. */
export const PROMPT_AFTER_MS = 9000;

/**
 * WHEN THE APP ASKS FOR NOTIFICATIONS. Without this nothing ever asks, no
 * phone registers a token, and no push reaches anyone. The first time Stats
 * shows on an install, a few seconds in: Stats is where a returning person
 * lands, so it is never the first thing a new one sees. A new key asks once
 * more on installs that were asked before.
 */
export const PUSH_ASK = { screen: "stats", afterMs: 4000, key: "v1" };

export function arrivalPrompt(
  opts: { launchCount?: number; languagesSet?: boolean; isReviewer?: boolean },
): string | null {
  // Never in front of a reviewer. A card that appears after nine seconds is a
  // card that appears in the middle of their evaluation.
  if (opts.isReviewer) return null;
  if (opts.languagesSet) return null;
  const n = Number(opts.launchCount ?? 0);
  if (!Number.isFinite(n) || n < PROMPT_FIRST_LAUNCH || n > PROMPT_GIVE_UP_AFTER) return null;
  return (n - PROMPT_FIRST_LAUNCH) % PROMPT_EVERY === 0 ? "languages" : null;
}
