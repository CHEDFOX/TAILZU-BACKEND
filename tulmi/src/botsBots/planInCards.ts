/**
 * THE NEEDS-YOU CARDS OF WHAT COMES IN (docs/plan-ease.md "Needs-you cards"; design A1, A5, A9): the work calendar's two, and a capture
 * left on the share screen. Each is one question with at most two buttons, and leaving it alone is an answer:
 *
 *   link         "Show your work calendar here too?"   [Link it] [No thanks]   once, after the 3rd day they open Plan Ease with no
 *                                                                              link; left alone it is never asked again
 *   linkStopped  "Your work calendar stopped updating"  [Link again]          after 6 hours stopped; left alone 7 days, it is taken off
 *   capture      "4 things from the school circular. Add them?"  [Add all] [Look]   once in the evening note, gone after 7 days
 *
 * The two link cards open the link page, so they stay on the page (never the widget or a note). Pure: what they read is in
 * NeedsCtx.more (planSources.ts: "links" from planLinks.ts, "captures" from planCapture.ts) and NeedsCtx.skipped.
 */
import type { NeedsCard, NeedsCtx, NeedsType } from "./planNeeds.js";

const MIN = 60_000, DAY = 24 * 60 * MIN;
/** Screen ids (experience/bots/ids.ts): kept as words here so this stays free of the screens. */
export const LINK_SCREEN = "bots.plan.link";
export const CAPTURE_SCREEN = "bots.plan.capture";

/** "No thanks" to the offer, kept for ever; the days Plan Ease was opened with no link (the offer comes on the third). */
export const LINK_NO = "link:offer:no";
export const LINK_SEEN = "link:seen:";
/** How many days of opening Plan Ease before the offer. */
export const OFFER_AFTER_DAYS = 3;

/** What the work calendar's source says (planLinks.ts LinkStatus). */
interface LinksMore { links: number; stopped: { id: string; since: number; name: string } | null }
/** A capture card waiting (planCapture.ts CaptureBrief). */
export interface CaptureBrief { id: string; label: string; n: number; sure: number; summary: string; until: number; button: string }

const startOfDay = (key: string, tz: number) => Date.parse(`${key}T00:00:00Z`) - tz * MIN;
const dayOf = (ms: number, tz: number) => new Date(ms + tz * MIN).toISOString().slice(0, 10);

/** The day the offer is for: the third day they opened Plan Ease with no link. */
function offerDay(ctx: NeedsCtx): string | null {
  const days = [...ctx.skipped.keys()].filter((k) => k.startsWith(LINK_SEEN)).map((k) => k.slice(LINK_SEEN.length)).sort();
  return days.length >= OFFER_AFTER_DAYS ? days[OFFER_AFTER_DAYS - 1]! : null;
}

const LINK: NeedsType = {
  type: "link", step: 2, tie: 4,
  find(ctx) {
    const m = ctx.more?.links as LinksMore | undefined;
    if (!m || m.links > 0 || ctx.skipped.has(LINK_NO)) return [];
    const day = offerDay(ctx);
    // Shown on that day only: left alone, it is never asked again (they can still say "link my work calendar" in the box).
    if (!day || day !== ctx.today) return [];
    return [{
      type: "link", key: `link:offer:${day}`, until: startOfDay(ctx.today, ctx.tz) + DAY - MIN, inApp: true,
      question: "Show your work calendar here too?", reason: "Google, Outlook or iPhone. It takes a minute.",
      item: "pl:offer",
      buttons: [
        { id: "link", label: "Link it", primary: true, open: { screen: LINK_SCREEN } },
        { id: "no", label: "No thanks", done: "OK. Say “link my work calendar” any time.", undo: "unno" },
      ],
    }];
  },
};

const LINK_STOPPED: NeedsType = {
  type: "linkStopped", step: 2, tie: 4,
  find(ctx) {
    const s = (ctx.more?.links as LinksMore | undefined)?.stopped;
    if (!s) return [];
    return [{
      type: "linkStopped", key: `linkStopped:${s.id}:${s.since}`, until: s.since + 7 * DAY, inApp: true,
      question: "Your work calendar stopped updating", reason: "Link it again to keep your day right.",
      item: `pl:${s.id}`, buttons: [{ id: "again", label: "Link again", primary: true, open: { screen: LINK_SCREEN, params: { again: s.id } } }],
    }];
  },
};

const CAPTURE: NeedsType = {
  type: "capture", step: 3, tie: 3,
  find(ctx) {
    const list = (ctx.more?.captures as CaptureBrief[] | undefined) ?? [];
    return list.filter((c) => c.n > 0 && c.until > ctx.now).map((c): NeedsCard => ({
      type: "capture", key: `capture:${c.id}:1`, until: c.until, category: "x0_capture",
      question: `${c.n === 1 ? "1 thing" : `${c.n} things`} from the ${c.label}. Add ${c.n === 1 ? "it" : "them"}?`, reason: c.summary,
      item: `pc:${c.id}`,
      buttons: [
        { id: "addall", label: c.button, primary: true, done: `Added ${c.sure === 1 ? "1 thing" : `${c.sure} things`}`, undo: "undo" },
        { id: "look", label: "Look", open: { screen: CAPTURE_SCREEN, params: { id: c.id } } },
      ],
    }));
  },
};

/** Steps 2 and 3's cards (planNeeds.ts LATER_TYPES). */
export const PLAN_IN_NEEDS: readonly NeedsType[] = [CAPTURE, LINK, LINK_STOPPED];

/** Today's day key at `now` (the link source marks the days Plan Ease was opened). */
export const todayKey = (now: number, tz: number): string => dayOf(now, tz);
