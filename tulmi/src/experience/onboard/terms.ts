/**
 * THE TERMS AND PRIVACY STEP (the window only).
 *
 * Nothing a person gives X0 Bot reaches an AI service until they have said yes
 * (privacy/aiConsent.ts holds the answer, privacy/aiGate.ts enforces it). On a
 * phone that yes is asked for on Home, over the bots, by a card of its own
 * (screens/firstRun/aiConsentCard.ts). A window never sees that card: it
 * finishes the onboarding and lands on the desk, where no card asks — so the
 * person met no terms at all, and the first thing they tried (dictation, a
 * bot, Ask) was refused by the gate with a line pointing at a switch they had
 * never been shown.
 *
 * So the window asks here, as a step of the same stage Blip is already walking
 * through, with the same two answers as the phone's card and the same route:
 *
 *   Agree and continue   PUT /v1/you/ai-consent { agree: true }, then the next step
 *   Not now              PUT /v1/you/ai-consent { agree: false, later: true }: the
 *                        answer is kept, nothing is granted, and the flow skips Try
 *                        it — there is nothing to try while nothing may be sent —
 *                        and says where to turn it on when they are ready.
 *
 * "Not now" stays a real answer, with nothing lost by choosing it (App Review
 * 5.1.1(i): the choice must be free; it is not a pre-prompt to a system
 * permission). Someone who already agreed on another device is not asked
 * again: the step says so and has one button.
 */

import type { ActionSpec, Node } from "../../../../shared/types/sdui.js";
import { AI_CONSENT_PATH } from "../../privacy/aiConsent.js";
import { POLICY } from "../policy.js";
import { EN, type ObKey } from "./copy.js";
import { type Plan, BTN, BTN2, FINE, H, HD, ICON, OB, P, PUSH, SET, TXT, haptic, seq, setState, toast } from "./kit.js";

/** One of the three promises, each one the privacy policy makes (section 3). */
function promise(k: ObKey): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", gap: 10, alignItems: "center" },
    children: [
      {
        type: "Stack",
        style: { width: 22, height: 22, borderRadius: 11, backgroundColor: OB.ink, alignItems: "center", justifyContent: "center" },
        children: [ICON("check", 12, OB.surf)],
      },
      TXT(EN[k], { flex: 1, fontSize: 14.5, lineHeight: 20, color: OB.ink }),
    ],
  };
}

/** A page of ours, opened in the person's browser. */
function readLink(k: ObKey, url: string): Node {
  return {
    type: "Stack",
    on: { onPress: { kind: "openUrl", url, external: true } as ActionSpec },
    props: { pressOpacity: 0.7 },
    style: { paddingVertical: 6 },
    children: [TXT(EN[k], { fontSize: 13.5, lineHeight: 18, color: OB.ink2, textDecorationLine: "underline" })],
  };
}

export function termsStep(p: Plan): Node {
  // Agree: the yes is saved, and only then does the step move. Written inline,
  // like the other steps' buttons, so the step carries its own way forward.
  const agree: ActionSpec = {
    kind: "callEndpoint", method: "PUT", path: AI_CONSENT_PATH, body: { agree: true },
    onSuccess: seq(setState("agreed", true), haptic("success"), SET(p.next("terms"))),
    onError: toast(EN["tp.err"], "error"),
  };
  // Not now: the answer is kept, nothing is granted, and the flow skips Try it
  // (there is nothing to try while nothing may be sent). A failed save only
  // means they are asked again next time, so this moves on either way.
  const later = seq(
    { kind: "callEndpoint", method: "PUT", path: AI_CONSENT_PATH, body: { agree: false, later: true } } as ActionSpec,
    toast(EN["tp.off"]),
    SET(p.next("try")),
  );

  // Already agreed (on a phone, or in this window before): the same words,
  // nothing to ask, one button on.
  const asked = p.agreed === true;
  return p.step("terms", [
    HD(p.spot("present", 100, "tp.say")),
    H("tp.h"),
    P("tp.p"),
    {
      type: "Stack",
      style: {
        gap: 10, padding: 14, borderRadius: 20, backgroundColor: OB.surf, borderWidth: 1.5, borderColor: OB.ink,
      },
      children: [promise("tp.1"), promise("tp.2"), promise("tp.3")],
    },
    {
      type: "Stack",
      style: { flexDirection: "row", gap: 16, marginTop: 4 },
      children: [readLink("tp.read", POLICY.privacy), readLink("tp.terms", POLICY.terms)],
    },
    PUSH(),
    ...(asked
      ? [FINE("tp.yes"), BTN(EN["ob.cont"], SET(p.next("terms")))]
      : [BTN(EN["tp.cta"], agree), BTN2(EN["tp.not"], later)]),
  ]);
}
