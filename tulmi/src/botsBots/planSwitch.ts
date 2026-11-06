/**
 * PLAN EASE'S STEP SWITCHES (PLAN_V2_REMINDERS, PLAN_V2_PAGE, PLAN_V2_NOTES ... PLAN_V2_APP in config.ts; docs/plan-ease.md). One place reads them, so
 * a step turned off is off everywhere at once: its pushes, its screens, its jobs.
 *
 *   planOn("reminders")   reminders with buttons, Later, the 10 am to-do reminder, merged pushes, a kind's own channel and expiry
 *   planOn("page")        the simple Plan Ease page, its Home and widget line, Today's "Plan Ease suggests" from the Needs-you queue
 *   planOn("notes")       the evening and morning notes, and the Daily summary folded into the evening one
 *   planOn("links")       the work calendar by its link: the link page, the fetch, its meetings on the days (planLinks.ts)
 *   planOn("capture")     what's shared becomes one card, and bills due with Paid (planCapture.ts, planDue.ts)
 *   planOn("waits")       waiting on someone: check-backs with the follow-up written (planWaits.ts)
 *   planOn("asks")        family asks, repeats and turns in a space, with Spaces on too (planAsks.ts)
 *   planOn("app")         the app release, for binaries that say they can: Time Sensitive pushes, widget steps, desktop notices and
 *                         "add this" (push/engine.ts, routes/bots/botsShell.ts, live/notices.ts, experience/bootstrap/bootstrap.ts)
 *
 * Read on every call (the config is parsed once and cached), so a test can flip one with resetConfigForTests. Without a config (a unit
 * test that set none up) it reads the variable the way config.ts does: unset is on, anything but "true" is off.
 */
import { getConfig } from "../config.js";

export type PlanStep = "reminders" | "page" | "notes" | "links" | "capture" | "waits" | "asks" | "app";

const KEY: Record<PlanStep, "PLAN_V2_REMINDERS" | "PLAN_V2_PAGE" | "PLAN_V2_NOTES" | "PLAN_V2_LINKS" | "PLAN_V2_CAPTURE" | "PLAN_V2_WAITS" | "PLAN_V2_ASKS" | "PLAN_V2_APP"> = {
  reminders: "PLAN_V2_REMINDERS", page: "PLAN_V2_PAGE", notes: "PLAN_V2_NOTES", links: "PLAN_V2_LINKS", capture: "PLAN_V2_CAPTURE",
  waits: "PLAN_V2_WAITS", asks: "PLAN_V2_ASKS", app: "PLAN_V2_APP",
};

export function planOn(step: PlanStep): boolean {
  const key = KEY[step];
  try {
    return getConfig()[key];
  } catch {
    const v = process.env[key];
    return v == null ? true : v.toLowerCase() === "true";
  }
}
