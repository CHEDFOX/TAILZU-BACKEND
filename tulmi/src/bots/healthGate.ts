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
  if (!on) return false;
  return only.length === 0 ? true : !!userId && only.includes(userId);
}
