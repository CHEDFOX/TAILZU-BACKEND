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
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botCard, box, canMove, canScroll, call, col, C, icon, labelled, row, scrollBox, seq, text, when } from "../../kit.js";
import { type LegalPage, legalPage } from "../../legalText.js";
import { CARD_BOT, line, permitStep, setState, toast } from "./parts.js";

export const AI_CONSENT_PATH = "/v1/you/ai-consent";
/** What Home reads: whether they agreed. */
export interface AiConsent { agreed: boolean }

const AGREED = "aiAgreed", LATER = "aiLater", CLOSED = "aiClosed";
/** Which page the scroll box shows: Privacy first (unset is Privacy too, for a screen that does not start the card's state). */
const PAGE = "aiPage";
const TABS: Array<{ page: LegalPage; label: string }> = [{ page: "privacy", label: "Privacy" }, { page: "terms", label: "Terms" }, { page: "support", label: "Support" }];
const onPage = (page: LegalPage): Condition => (page === "privacy"
  ? { all: [{ not: { eq: [PAGE, "terms"] } }, { not: { eq: [PAGE, "support"] } }] } as Condition
  : { eq: [PAGE, page] });
/** The microphone card's width (arrivalCard.ts). */
const WIDTH = { phone: 330, desktop: 360 };
const PRIVACY_URL = "https://x0bot.com/privacy#ai";

/** What Home starts with while the card is due. */
export const AI_CONSENT_STATE = { [AGREED]: false, [LATER]: false, [CLOSED]: false, [PAGE]: "privacy" } as const;

/** Whether Home asks: a signed-in person who has not agreed. Unknown (the read failed): not asked this time. */
export const aiConsentDue = (c: AiConsent | undefined): boolean => !!c && c.agreed === false;

/**
 * The card, while it is due; nothing otherwise. `then` runs after Agree, `later` after Not now (Plan Ease's capture card: read it now,
 * or add it as a plain to-do instead).
 */
export function aiConsentCard(ctx: BotsCtx, c: AiConsent | undefined, o: { then?: ActionRef; later?: ActionRef } = {}): Node[] {
  if (!aiConsentDue(c)) return [];
  const desk = ctx.client === "desktop";
  const agree = call("PUT", AI_CONSENT_PATH, { agree: true }, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, setState(AGREED, true), ...(o.then ? [o.then] : [])),
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
  // A build that draws a box that scrolls in a card gets one line, then three tabs (Privacy, Terms, Support) over a box that scrolls
  // the whole of the one picked, in small type, the way Apple shows its own terms; Agree accepts the Terms and the Privacy Policy with
  // the AI permission. The Privacy Policy is the one shown first: its section 3 is what goes to AI services and to whom. Else the short
  // card, with the policy a tap away.
  const full = canScroll(ctx);
  // A tab: its word, ink and underlined while its page shows, grey otherwise (two of each, one shown, so it reads right even where the
  // card's state was not started).
  const tab = (t: { page: LegalPage; label: string }): Node => {
    const look = (on: boolean): Node => col([
      text(t.label, { size: 14, weight: on ? 600 : 500, lineHeight: 19, color: on ? C.ink : C.meta }),
      box([], { height: 2, borderRadius: 1, backgroundColor: on ? C.ink : "transparent" }),
    ], { gap: 4 });
    return labelled(box([when(onPage(t.page), look(true)), when({ not: onPage(t.page) } as Condition, look(false))], { minHeight: 32, justifyContent: "center" },
      setState(PAGE, t.page)), `${t.label}, show it below`);
  };
  const terms = [
    text("Tap Agree to let X0 Bot work at its full potential.", { size: 13, lineHeight: 18, color: C.meta }),
    col([
      row(TABS.map(tab), { gap: 18 }),
      ...TABS.map((t) => when(onPage(t.page), scrollBox(legalPage(t.page), {
        height: desk ? 320 : 260, gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface,
      }))),
    ], { gap: 8 }),
  ];
  const ask = permitStep({
    when: { falsy: AGREED },
    title: full ? "Terms and privacy" : "Your data, your choice",
    lines: full ? [] : [line("X0 Bot works with leading AI partners to answer you. They see only what you choose to share.")],
    extra: full ? terms : [promises, policy],
    cta: { label: "Agree", onPress: agree },
    quiet: { label: "Not now", onPress: o.later ? seq(setState(LATER, true), o.later) : setState(LATER, true) },
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
