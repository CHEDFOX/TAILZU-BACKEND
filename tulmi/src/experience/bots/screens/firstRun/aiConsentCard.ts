/**
 * THE AI PERMISSION, ON HOME (App Review 5.1.1(i), 5.1.2(i): say what is sent to AI services, and to whom, and get the person's
 * permission before anything is). The server holds the answer and enforces it (privacy/aiConsent.ts, privacy/aiGate.ts); this is
 * where it is asked.
 *
 * First of Home's asks (shell/home.ts homeNotices), over Home like the microphone card (a BotCard overlay), for as long as the person
 * has not agreed (GET /v1/you/ai-consent). It says what goes (their words and voice, and the photos, files or screen they choose to
 * share), to whom (AI_SERVICES), why (to answer them), and that nothing goes until they agree.
 *
 *   Agree     PUT /v1/you/ai-consent { agree: true }; the card goes
 *   Not now   the card goes for this visit; nothing is sent, and a bot, dictation or Ask says it needs their OK (AI_CONSENT_TEXT).
 *             The card is back on the next visit. (Not a pre-prompt to a system permission, so "Not now" is right here: the choice
 *             must be free.)
 *
 * Withdrawn in You › Privacy (screens/you: the switch "Send to AI services").
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { AI_SERVICES } from "../../../../privacy/aiGate.js";
import { type BotsCtx, botCard, canMove, call, col, C, row, seq, text, when } from "../../kit.js";
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

/** "OpenAI, Anthropic, … and OpenRouter, which …": the services as one sentence. */
function servicesLine(): string {
  const all = [...AI_SERVICES];
  const last = all.pop()!;
  return `It goes to ${all.join(", ")}, and ${last}.`;
}

/** The card, while it is due; nothing otherwise. */
export function aiConsentCard(ctx: BotsCtx, c: AiConsent | undefined): Node[] {
  if (!aiConsentDue(c)) return [];
  const desk = ctx.client === "desktop";
  const agree = call("PUT", AI_CONSENT_PATH, { agree: true }, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, setState(AGREED, true)),
    fail: toast("Couldn't save that. Try again."),
  });
  const policy = row([text("How we handle it: Privacy policy", {
    size: 13, lineHeight: 18, color: C.grey70, style: { textDecorationLine: "underline" },
  })], {}, { kind: "openUrl", url: PRIVACY_URL, external: true });
  const ask = permitStep({
    when: { falsy: AGREED },
    title: "Before your bots answer you",
    lines: [
      line("To answer you, write, transcribe and run your bots, X0 Bot sends what you give it to AI services: your words, your voice, and the photos, files or screen you choose to share."),
      line(servicesLine()),
      line("It's sent only to answer you, and to check what you post in Spaces is safe. Nothing is sent until you agree, and you can change this anytime in You › Privacy."),
    ],
    extra: [policy],
    cta: { label: "Agree", onPress: agree },
    quiet: { label: "Not now", onPress: setState(LATER, true) },
  });
  const thanks = when({ truthy: AGREED }, row([text("You're all set.", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], {
    justifyContent: "center", paddingTop: 18, paddingBottom: 26,
  }));
  if (canMove(ctx)) {
    return [botCard([ask, thanks], {
      ...CARD_BOT, stageHeight: 72, kind: "custom", overlay: true, width: WIDTH[desk ? "desktop" : "phone"], label: "AI permission",
      doneWhen: { truthy: AGREED }, doneDelayMs: 1200, onComplete: setState(CLOSED, true), closeWhen: { any: [{ truthy: CLOSED }, { truthy: LATER }] },
    })];
  }
  // A build without the living tiles: the same card, plain, gone once answered.
  return [when({ all: [{ falsy: CLOSED }, { falsy: LATER }, { falsy: AGREED }] }, col([ask], {
    width: WIDTH[desk ? "desktop" : "phone"], maxWidth: "100%", alignSelf: "center",
    borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6,
  }))];
}
