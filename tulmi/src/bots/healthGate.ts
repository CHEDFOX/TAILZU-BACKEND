/**
 * WHO GETS THE HEALTH ROW, AND WHOSE DAYS THE SERVER TAKES (docs: perms §4.2).
 *
 * One function, read by both the screen that draws the switch and the route that stores the days, so a row the server would
 * not draw is also a row the route refuses. Launch dark: both switches are off in config.ts, so a server deployed before the
 * store build draws nothing and stores nothing.
 *
 * The Android list is the stage between the first Health Connect build and Google's own approved list reaching Health Connect,
 * which takes a week or two after the form is approved: Play's review account and our test accounts are on it, so the reviewer
 * can reach the very screen the declaration is for (no dark declarations), and nobody else can.
 *
 * Reads config only. Nothing here touches a store or a model.
 */
import { getConfig } from "../config.js";

const list = (v: unknown): string[] => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/** Is the fitness bot's health row on for this phone and this account? */
export function healthAllowed(platform: "ios" | "android", userId?: string): boolean {
  const c = getConfig();
  const [on, only] = platform === "android"
    ? [c.PERM_HEALTH_ANDROID === true, list(c.PERM_HEALTH_ANDROID_USERS)]
    : [c.PERM_HEALTH_IOS === true, list(c.PERM_HEALTH_IOS_USERS)];
  return allowed(on, only, userId);
}

/**
 * Is "Also count my sleep" on for this phone and this account (docs: perms2 §6)? Its own pair of switches, so sleep can wait
 * for Play's refiled Health Connect form while steps and workouts are already live — and, on either phone, so sleep is turned
 * on after steps rather than with them. Health itself must be on too: the sleep row is a sub-row of that one.
 */
export function sleepAllowed(platform: "ios" | "android", userId?: string): boolean {
  if (!healthAllowed(platform, userId)) return false;
  const c = getConfig();
  const [on, only] = platform === "android"
    ? [c.PERM_HEALTH_SLEEP_ANDROID === true, list(c.PERM_HEALTH_SLEEP_ANDROID_USERS)]
    : [c.PERM_HEALTH_SLEEP_IOS === true, list(c.PERM_HEALTH_SLEEP_IOS_USERS)];
  return allowed(on, only, userId);
}

/**
 * Is "Count my steps" on for this phone (docs: perms2 §5.1)? The shared switch, and on Android its own half too: Android's
 * step counter arrives in a build of its own (TULMI_ANDROID_MOTION), so a server ready for iPhone is not yet ready for it.
 * The same test `experience/bots/kit.ts canMotion` draws the row behind, so a row the server would not draw is a row the
 * route refuses. No account list: neither half has one, because neither waits on a store's review.
 */
export function motionAllowed(platform: "ios" | "android"): boolean {
  const c = getConfig();
  if (c.PERM_MOTION !== true) return false;
  return platform === "android" ? c.PERM_MOTION_ANDROID === true : true;
}

/** A switch and its account list: off is off; a list set means only those accounts; an empty list means the switch alone decides. */
function allowed(on: boolean, only: string[], userId?: string): boolean {
  if (!on) return false;
  return only.length === 0 ? true : !!userId && only.includes(userId);
}
