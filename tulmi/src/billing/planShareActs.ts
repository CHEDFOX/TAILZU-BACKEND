/**
 * THE TWO BUTTONS ON THE ASK'S NOTIFICATION (PLAN_SHARE — off; billing/planShare.ts, docs/plan-share.md §5.1).
 *
 * The push that says "{name} is asking for your plan" carries the category `x0_plan_share` (experience/bots/planShare.ts
 * PLAN_SHARE_CATEGORIES, registered with the phone by experience/appKnobs.ts, named for the kind by push/defaults.ts
 * `push.plan_share_ask.category`) and the one ask it is about, as `psa:<askId>` on its `data.item` (widgets/items.ts). Its
 * two buttons, Share and Not now, post to POST /v1/widgets/act like every other notification's button and arrive here
 * through widgets/act.ts, so the notification does exactly what the card in Activity does.
 *
 * ONE ASK, ONE PERSON, ONCE. The id names one ask and nothing else (a uuid, read back before anything is done with it), and
 * the answer itself is the routes' own (routes/bots/botsPlanShare.ts installs it below), so it keeps every check the card's
 * "Share my plan" keeps: the ask must be this person's and still waiting. Somebody else's, an answered one, a promised one
 * and a withdrawn one are all refused. The apps retry, so a second tap must be harmless: the same tap is replayed from its
 * claim (widgets/act.ts, "ONCE"), and the other button on an answered ask is told it was already answered.
 *
 * SHARE MAY ONLY SHARE. On the card, someone on Free gets "See plans and share": it promises the share and opens the plans
 * screen, the one screen allowed to show a price. A notification's button runs with the app shut and has no screen to open,
 * so promising there would take the ask out of Activity and leave the owner believing they had shared when nobody had been
 * put on anything. It refuses instead, in the route's own words (409 `no_plan`), and the ask stays waiting for the card.
 *
 * Nothing at all while PLAN_SHARE is off: routes/bots/widgets.ts hands act.ts no door, so no button answers.
 */
import { no, ok, type ActResult } from "../widgets/act.js";
import type { QuickItem } from "../widgets/items.js";
import type { WidgetScope } from "../widgets/token.js";

/**
 * The answer itself, as routes/bots/botsPlanShare.ts makes it: the same store, the same checks and the same push the card's
 * PUT uses. It throws a PlanShareError for everything it refuses, which widgets/act.ts turns into that status and those words.
 */
export type PlanShareAnswerFn = (userId: string, askId: string, decision: "share" | "decline") => Promise<{ state: "shared" | "declined" }>;

let answerFn: PlanShareAnswerFn | null = null;

/** Installed at boot by the plan share routes, the way the name lookup and the "you're on it" push are. Null: nothing answers. */
export function installPlanShareAnswer(fn: PlanShareAnswerFn | null): void { answerFn = fn; }

/** The two buttons, and nothing else. Only ever the session: a widget never shows a plan ask, so a widget's token never answers one. */
export function planShareScope(item: QuickItem, action: string): WidgetScope | "session" | null {
  return item.kind === "psa" && (action === "share" || action === "decline") ? "session" : null;
}

export async function planShareAct(userId: string, item: QuickItem, action: string): Promise<ActResult> {
  if (item.kind !== "psa") return no(400, "bad_request", "That can only be opened.");
  if (action !== "share" && action !== "decline") return no(400, "bad_request", "That button doesn't do anything here.");
  if (!answerFn) return no(404, "off", "That isn't there any more.");
  return ok((await answerFn(userId, item.askId, action)).state);
}

/** The door widgets/act.ts is given (routes/bots/widgets.ts actPartsOf), while the switch is on. */
export const PLAN_SHARE_DOOR = { scope: planShareScope, act: planShareAct };
