/**
 * The Keyboard step.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import { type ObKey, EN } from "./copy.js";
import { OB, type Plan, TXT, ICON, HD, H, P, PUSH, BTN, seq, BTN2, SET, haptic } from "./kit.js";

/** The little keyboard in a row of Keyboard's steps: three bars, one lit, and the thing to tap or flip on it. */
function miniKeyboard(lit: number, kind: "point" | "toggle"): Node {
  const marker: Node = kind === "point"
    ? { type: "Stack", style: { position: "absolute", right: -3, top: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: OB.neon, borderWidth: 1.5, borderColor: OB.ink } }
    : { type: "Stack", style: { position: "absolute", right: 2, top: -1, width: 9, height: 6, borderRadius: 3, backgroundColor: OB.ink } };
  return {
    type: "Stack",
    style: {
      width: 60, height: 46, borderRadius: 9, backgroundColor: OB.white, borderWidth: 1.5, borderColor: OB.ink,
      paddingVertical: 6, paddingHorizontal: 5, gap: 4, marginLeft: "auto",
    },
    children: [0, 1, 2].map((i): Node => i === lit
      ? { type: "Stack", style: { height: 8, borderRadius: 4, backgroundColor: OB.neonSoft, borderWidth: 1, borderColor: OB.neonLine }, children: [marker] }
      : { type: "Stack", style: { height: 8, borderRadius: 4, backgroundColor: OB.hair } }),
  };
}

export function keyboardStep(p: Plan): Node {
  const row = (n: number, k: ObKey, mini: Node): Node => ({
    type: "Stack",
    style: {
      flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: OB.surf, borderWidth: 1.5, borderColor: OB.hair,
      borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 7,
    },
    children: [
      {
        type: "Stack",
        style: { width: 24, height: 24, borderRadius: 12, backgroundColor: OB.ink, alignItems: "center", justifyContent: "center" },
        children: [TXT(String(n), { fontSize: 13, fontWeight: "700", color: OB.surf })],
      },
      TXT(EN[k], { flex: 1, fontSize: 14, lineHeight: 18, color: OB.ink }),
      mini,
    ],
  });
  // iOS gives an app its own Settings page only after the app has asked for a
  // permission, so the microphone is first asked HERE, as Open Settings is
  // tapped (the reasoning of the old onboardingKeyboard). The box beside the
  // button says why the keyboard needs Full Access.
  //
  // READ BEFORE ASKING, though: a microphone already allowed on the step
  // before this one has nothing left to ask, and the phone draws its own
  // "One permission first" card in front of every ask that is not `primed`
  // BEFORE it looks — so Open Settings put a card in front of a Settings page.
  // The read answers with no prompt and no card.
  //
  // What is left is NOT `primed` (shared/types/sdui.ts): this step explains
  // the keyboard, not the microphone, and a Done sits beside its button. The
  // phone's own card is the one explanation the microphone gets.
  const why: Node = {
    type: "Stack",
    style: { backgroundColor: OB.white, borderWidth: 1.5, borderColor: OB.ink, borderRadius: 16, paddingTop: 11, paddingHorizontal: 14, paddingBottom: 12, marginTop: 6 },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", gap: 7, alignItems: "center" },
        children: [ICON("lock", 17, OB.ink), TXT(EN["s3.wh"], { fontSize: 15, fontWeight: "700", color: OB.ink })],
      },
      TXT(EN["s3.wp"], { fontSize: 14, lineHeight: 19, color: OB.ink2 }),
    ],
  };
  return p.step("keyboard", [
    HD(p.spot("tap", 84, "s3.say")),
    H("s3.h"),
    P("s3.p"),
    row(1, p.ios ? "s3.1" : "s3.1a", miniKeyboard(0, "point")),
    row(2, p.ios ? "s3.2" : "s3.2a", miniKeyboard(1, "point")),
    row(3, p.ios ? "s3.3" : "s3.3a", miniKeyboard(2, "toggle")),
    p.ios ? why : null,
    PUSH(),
    BTN(
      EN["s3.cta"],
      p.ios
        ? {
            kind: "checkPermission", permission: "microphone",
            onGranted: { kind: "openUrl", url: "app-settings:", external: true },
            onDenied: seq({ kind: "requestPermission", permission: "microphone" }, { kind: "openUrl", url: "app-settings:", external: true }),
          }
        : { kind: "openSettings", target: "keyboard" },
    ),
    BTN2(EN["s3.done"], SET(p.I.try!)),
    // The keyboard can be switched on outside the app: the app re-reads the
    // device when it comes back, and the step moves on by itself a beat later.
    {
      type: "Stack",
      style: { height: 0 },
      visibleIf: { truthy: "keyboardReady" },
      on: { onAppear: seq({ kind: "delay", ms: 1100 }, haptic("success"), SET(p.I.try!)) },
    },
  ]);
}
