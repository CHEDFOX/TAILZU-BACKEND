/**
 * THE AI PERMISSION, ON HOME (App Review 5.1.1(i), 5.1.2(i): say what is sent to AI services, and to whom, and get the person's
 * permission before anything is). The server holds the answer and enforces it (privacy/aiConsent.ts, privacy/aiGate.ts); this is
 * where it is asked.
 *
 * First of Home's asks (shell/home.ts homeNotices), over Home like the microphone card (a BotCard overlay), for as long as the person
 * has not agreed (GET /v1/you/ai-consent). It says what goes (their words and voice, and the photos, files or screen they choose to
 * share), to whom (third-party AI providers; the privacy policy names each, one tap away), why (to answer them and keep Spaces safe),
 * and that nothing goes until they agree.
 *
 *   Agree     PUT /v1/you/ai-consent { agree: true }; the card goes
 *   Not now   the card goes for this visit; nothing is sent, and a bot, dictation or Ask says it needs their OK (AI_CONSENT_TEXT).
 *             The card is back on the next visit. (Not a pre-prompt to a system permission, so "Not now" is right here: the choice
 *             must be free.)
 *
 * Withdrawn in You › Privacy (screens/you: the switch "Send to AI services").
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botCard, box, canMove, canScroll, call, col, C, icon, row, scrollBox, seq, text, when } from "../../kit.js";
import { legalNodes } from "../../legalText.js";
import { CARD_BOT, line, permitStep, setState, toast } from "./parts.js";

export const AI_CONSENT_PATH = "/v1/you/ai-consent";
/** What Home reads: whether they agreed. */
export interface AiConsent { agreed: boolean }

const AGREED = "aiAgreed", LATER = "aiLater", CLOSED = "aiClosed";
/** The microphone card's width (arrivalCard.ts). */
const WIDTH = { phone: 330, desktop: 360 };
const PRIVACY_URL = "https://x0bot.com/privacy#ai";

/** What Home starts with while the card is due. */
export const AI_CONSENT_STATE = { [AGREED]: false, [LATER]: false, [CLOSED]: false } as const;

/** Whether Home asks: a signed-in person who has not agreed. Unknown (the read failed): not asked this time. */
export const aiConsentDue = (c: AiConsent | undefined): boolean => !!c && c.agreed === false;

/** The card, while it is due; nothing otherwise. */
export function aiConsentCard(ctx: BotsCtx, c: AiConsent | undefined): Node[] {
  if (!aiConsentDue(c)) return [];
  const desk = ctx.client === "desktop";
  const agree = call("PUT", AI_CONSENT_PATH, { agree: true }, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, setState(AGREED, true)),
    fail: toast("Couldn't save that. Try again."),
  });
  const policy = row([text("Read our Privacy policy", {
    size: 13, lineHeight: 18, color: C.grey70, style: { textDecorationLine: "underline" },
  })], {}, { kind: "openUrl", url: PRIVACY_URL, external: true });
  // Three promises, each one the privacy policy makes (section 3, "AI services, and your permission").
  const promise = (s: string): Node => row([
    box([icon("check", { size: 12, color: C.paper, weight: 2.2 })], { width: 20, height: 20, borderRadius: 10, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
    text(s, { size: 14, lineHeight: 20, color: C.ink }),
  ], { gap: 10, alignItems: "center" });
  const promises = col([promise("Never sold, never used for ads"), promise("Nothing is sent until you agree"), promise("Turn it off anytime in You › Privacy")], { gap: 10 });
  // A build that draws a box that scrolls in a card gets the whole of the Terms and the Privacy Policy under it, in small type, the
  // way Apple shows its own terms; Agree accepts them with the AI permission. Else the short card, with the policy a tap away.
  const full = canScroll(ctx);
  const smallLink = (label: string, url: string): Node => row([text(label, { size: 12, lineHeight: 16, color: C.grey70, style: { textDecorationLine: "underline" } })], {}, { kind: "openUrl", url, external: true });
  const terms = [
    text("By tapping Agree, you accept the Terms of Service and the Privacy Policy below.", { size: 12, lineHeight: 17, color: C.meta }),
    scrollBox(legalNodes(), {
      maxHeight: desk ? 260 : 200, gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface,
    }),
    row([
      smallLink("Terms", "https://x0bot.com/terms"), smallLink("Privacy", "https://x0bot.com/privacy"),
      smallLink("Providers", "https://x0bot.com/privacy/providers"), smallLink("Support", "https://x0bot.com/support"),
    ], { gap: 14, flexWrap: "wrap" }),
  ];
  const ask = permitStep({
    when: { falsy: AGREED },
    title: full ? "Terms and privacy" : "Your data, your choice",
    lines: [line("X0 Bot works with leading AI partners to answer you. They see only what you choose to share.")],
    extra: full ? [promises, ...terms] : [promises, policy],
    cta: { label: "Agree", onPress: agree },
    quiet: { label: "Not now", onPress: setState(LATER, true) },
  });
  const thanks = when({ truthy: AGREED }, row([text("You're all set.", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], {
    justifyContent: "center", paddingTop: 18, paddingBottom: 26,
  }));
  if (canMove(ctx)) {
    return [botCard([ask, thanks], {
      ...CARD_BOT, stageHeight: full ? 48 : 72, kind: "custom", overlay: true, width: WIDTH[desk ? "desktop" : "phone"], label: full ? "Terms and privacy" : "AI permission",
      doneWhen: { truthy: AGREED }, doneDelayMs: 1200, onComplete: setState(CLOSED, true), closeWhen: { any: [{ truthy: CLOSED }, { truthy: LATER }] },
    })];
  }
  // A build without the living tiles: the same card, plain, gone once answered.
  return [when({ all: [{ falsy: CLOSED }, { falsy: LATER }, { falsy: AGREED }] }, col([ask], {
    width: WIDTH[desk ? "desktop" : "phone"], maxWidth: "100%", alignSelf: "center",
    borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6,
  }))];
}
