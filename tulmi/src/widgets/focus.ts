/**
 * WHETHER A FOCUS IS ON, AND WHAT WAITS WHILE IT IS (docs: perms2 §4). Two doors send the same two words here:
 *
 *   POST /v1/widgets/focus   the iPhone's X0 Bot Focus Filter, with the WIDGETS' own token (scope "focus.set"): iOS runs the
 *                            filter's `perform()` when that Focus starts and when it ends, outside any screen and with no
 *                            session at hand, exactly as a widget's button runs (widgets/token.ts).
 *   POST /v1/botsapp/plan/focus   the app's `focus.sync` on Plan Ease page appear, with the session: it catches up a post the
 *                            filter could not make, and it is how Android (Do Not Disturb, no permission) says anything at all.
 *
 * WHAT IS KEPT: `{ on, hold, source, until }` on the person's one Plan Ease row, overwritten at each change (migration 0094).
 * Never WHICH Focus, never its mode, never an app or a person it allows: iOS does not offer that and we would not keep it. The
 * state is held 12 hours at most (`until`), because a Focus that ended while the phone was away must not hold calls for ever.
 *
 * Pure but for the one patch: nothing here reads a model, and the state is read only by deterministic call code.
 */
import type { PlanPrefs, FocusState } from "../botsBots/planPrefs.js";

/** A state said now is believed for this long; past it, it reads as off (perms2 §4.4). */
export const FOCUS_HOLD_MS = 12 * 3600_000;

/**
 * What a post says. `hold` is ABSENT when the post carries no choice, and that is not the same as "calls".
 *
 * THE END OF A FOCUS ARRIVES WITH NO VALUES. The Focus Filter's parameter has no default and is optional, because iOS runs
 * `perform()` with the DEFAULT values when a Focus's values stop being relevant — which is how the end of a Focus reaches
 * us (WWDC22 session 10121). So an end post is `{ on: false }` with nothing else, and reading that as "they chose calls"
 * would overwrite a person who had picked "calls and other pings" every time their Focus ended.
 */
export interface FocusPost {
  on: boolean;
  hold?: "calls" | "callsAndPings";
  source: "filter" | "dnd";
  /**
   * WHEN THE FILTER ITSELF SAW THIS, in milliseconds. The 12 hours below run from that moment and not from the post, because
   * the app reposts the same state on every Plan Ease page appear: without it each repost pushed the limit forward, so a
   * Focus whose end was never seen could hold calls for the filter's last word plus up to 24 hours, not the 12 both sides
   * promise. Absent (an older app, or Do Not Disturb, which is read at the moment it is posted) means "now".
   */
  at?: number;
}

/**
 * One post, checked. Anything but these three words is refused rather than guessed at: the filter and the app both send the
 * same shape, and a body that is neither is a bug we would rather see than store.
 */
export function readFocusPost(body: unknown, now = Date.now()): FocusPost | { error: string } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as { on?: unknown; hold?: unknown; source?: unknown; at?: unknown };
  if (typeof b.on !== "boolean") return { error: "on is true or false." };
  if (b.hold !== undefined && b.hold !== "calls" && b.hold !== "callsAndPings") return { error: 'hold is "calls" or "callsAndPings".' };
  if (b.source !== undefined && b.source !== "filter" && b.source !== "dnd") return { error: 'source is "filter" or "dnd".' };
  if (b.at !== undefined && (typeof b.at !== "number" || !Number.isFinite(b.at))) return { error: "at is a number of milliseconds." };
  // A moment in the future would push the hold out past the 12 hours, so it is simply read as "now". A moment in the past is
  // taken as it is: that is the whole point of sending it.
  const at = typeof b.at === "number" && Number.isFinite(b.at) ? Math.min(b.at, now) : undefined;
  return {
    on: b.on,
    // No hold in the body is no choice, and it stays absent rather than becoming "calls".
    ...(b.hold === "calls" || b.hold === "callsAndPings" ? { hold: b.hold } : {}),
    source: b.source === "dnd" ? "dnd" : "filter",
    ...(at !== undefined ? { at } : {}),
  };
}

/**
 * The state as it goes on the row: 12 hours from now, and nothing of which Focus it was.
 *
 * `was` is what the row already said, and the hold is taken from it whenever this post carries no choice of its own — which
 * is every end-of-Focus post, and every Android Do Not Disturb post. A hold on a post that says `on: false` is meaningless
 * either way: nothing is held while no Focus is on, so it is ignored there and the person's own choice is what survives.
 */
export const focusStateOf = (p: FocusPost, now: number, was?: FocusState | null): FocusState => ({
  on: p.on,
  hold: (p.on ? p.hold : undefined) ?? was?.hold ?? "calls",
  source: p.source,
  // THE 12 HOURS RUN FROM WHEN THE FILTER SAW IT, not from this post. The app reposts the same state on every Plan Ease page
  // appear, so counting from the post pushed the limit forward each time and a missed "ended" could hold calls for about 24
  // hours. With no `at` (an older app, or Do Not Disturb, which is read as it is posted) this is `now`, exactly as before.
  until: Math.min(p.at ?? now, now) + FOCUS_HOLD_MS,
});

/**
 * Writes it, and says whether what waited should be let through now: a Focus that has just ENDED is the moment the one notice
 * about what waited goes (botsBots/planCallCheck.ts), and the only moment it does.
 */
export async function setFocus(prefs: PlanPrefs, userId: string, p: FocusPost, now: number): Promise<{ on: boolean; ended: boolean }> {
  const had = await prefs.get(userId).catch(() => null);
  const was = had?.focus && had.focus.on && had.focus.until > now;
  await prefs.patch(userId, { focus: focusStateOf(p, now, had?.focus) });
  return { on: p.on, ended: !!was && !p.on };
}
