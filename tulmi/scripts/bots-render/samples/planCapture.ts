/**
 * Plan Ease's capture card (screens/bots/planIn.ts) for someone who has not said yes to AI, as the server answers it on the sample day
 * (Wednesday 28 October): made by the server's own code (botsBots/planCapture.ts rulesItems and viewOf), so the card drawn is the one
 * the server sends. Nothing asks for AI: a circular's dated lines are the card's things by the rules at once ("rules"), and a photo from
 * the Plan page's + is one to-do with its file ("photo").
 */
import { FIXED_NOW, IST } from "../../../src/experience/bots/fixtures.js";
import { guessLabel, rulesItems, viewOf, type CaptureRow, type CaptureView } from "../../../src/botsBots/planCapture.js";

const A = "/v1/botsapp/bots/plan";
export const RULES_ID = "c0ffee00-0000-4000-8000-00000000c001";
export const PHOTO_ID = "c0ffee00-0000-4000-8000-00000000c002";
/** What was shared: a school circular, pasted. */
export const CIRCULAR_WORDS = "Dear parents,\nPTM on Sat 31 Oct at 9:30 am in the school hall.\nPay the field trip fee ₹300 by Fri 30 Oct.\nDress-up day (fruits) on Mon 2 Nov.\nSports day next month.";

const row = (o: Pick<CaptureRow, "id" | "source" | "label" | "file_id" | "items" | "state">): CaptureRow => ({
  ...o, user_id: "00000000-0000-4000-8000-00000000aaaa", in_hash: o.id, added: {}, paise: 0, seen_ms: FIXED_NOW, told_ms: null,
  created_ms: FIXED_NOW, updated_ms: FIXED_NOW, expires_ms: FIXED_NOW + 7 * 86_400_000,
});

export const CAPTURE_VIEWS: Record<"rules" | "photo", CaptureView> = {
  rules: viewOf(row({ id: RULES_ID, source: "text", label: guessLabel(CIRCULAR_WORDS, ""), file_id: null, items: rulesItems(CIRCULAR_WORDS, FIXED_NOW, IST, []), state: "ready" })),
  photo: viewOf(row({ id: PHOTO_ID, source: "photo", label: guessLabel("", "IMG_2041.jpg"), file_id: "f-photo", items: [], state: "failed" })),
};

/** The card's reads (and the share-in screen's ask, answered with the rules' card). */
export const CAPTURE_API: Record<string, unknown> = {
  [`GET ${A}/capture/${RULES_ID}`]: { capture: CAPTURE_VIEWS.rules },
  [`GET ${A}/capture/${PHOTO_ID}`]: { capture: CAPTURE_VIEWS.photo },
  [`POST ${A}/capture/look`]: { capture: CAPTURE_VIEWS.rules },
};
