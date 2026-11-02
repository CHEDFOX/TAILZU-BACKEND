/**
 * The first stage, before there is a session: Welcome, Sign in and the code.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import { GOOGLE_PATHS, AUTH_UI } from "../phone/auth.js";
import { EN } from "./copy.js";
import { OB, TXT, plain, STEP, C1, SPOT, H, P, PUSH, BTN, seq, haptic, SET, FINE, setState, nodes, HD, OR, ICON, stageProps } from "./kit.js";
import { onboardTotal } from "./screens.js";

// ---------------------------------------------------------------------------
// Before the session: Welcome, Sign in, Code
// ---------------------------------------------------------------------------

/** The email and phone fields, and the button under each. */
const FIELD = {
  height: 48, radius: 16, background: OB.white, borderColor: OB.ink, textColor: OB.ink,
  placeholderColor: OB.muted, fontSize: 17,
  buttonBackground: OB.ink, buttonTextColor: OB.surf, buttonHeight: 48, buttonRadius: 16,
  countryBackground: OB.surf, countryBorderColor: OB.hair,
} as const;

/** Google's "G" in its four colours, as four SVG nodes laid over one another (as googleLinkButton draws it). */
function googleLogo(size: number): Node {
  return {
    type: "Stack",
    style: { width: size, height: size },
    children: GOOGLE_PATHS.map(([fill, d]) => ({
      type: "SVG",
      props: { viewBox: "0 0 48 48", d, fill },
      style: { position: "absolute", left: 0, top: 0, width: size, height: size },
    })),
  };
}

const googleRow = (): Node => ({
  type: "Stack",
  style: { flexDirection: "row", alignItems: "center", gap: 10 },
  children: [googleLogo(20), TXT(EN["si.google"], { fontSize: 15.5, fontWeight: "600", color: OB.ink })],
});

/** The consent line, as AUTH_UI.legal has it (the same parts, links and fallback), in the paper look. */
function legalLine(): Node {
  const ui = AUTH_UI.legal;
  return {
    type: "Stack",
    style: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginTop: 8 },
    children: ui.parts.map((part) => ({
      type: "Text",
      props: { content: part.text },
      ...(part.url ? { on: { onPress: { kind: "openUrl", url: part.url, external: true } } } : {}),
      style: plain({
        fontSize: 12, lineHeight: 17, color: part.url ? OB.ink : OB.ink2,
        ...(part.url ? { textDecorationLine: "underline" } : {}),
      }),
    })) as Node[],
    // A bundle that cannot lay this out still shows the sentence: consent copy
    // missing is worse than consent copy that does not open.
    fallback: TXT(ui.text, { textAlign: "center", fontSize: 12, lineHeight: 17, color: OB.ink2, marginTop: 8 }),
  };
}

export interface OnboardAuthOpts {
  /** A window (the desktop app). */
  desktop?: boolean;
  /** Leave Google out (an Android bundle that cannot come back from it). */
  googleHidden?: boolean;
  /** With it, Google is a link to Supabase's own sign-in instead (googleLinkButton's bridge). */
  googleLink?: string | null;
  /** Leave Apple out (a window that is not a Mac). */
  appleHidden?: boolean;
  /** The apps steps are part of the flow (onboardAppsOn): the bar's length, and Welcome's words. */
  connectorsOn?: boolean;
}

/**
 * Welcome, Sign in and Code, for the bootstrap's `auth.screen`. All actions are
 * inline: the auth tree has no action table. The sign-in logic is the app's
 * (the pills, Google, Apple and the code entry all run the flow the gate
 * already owns); this decides how it looks and what Blip says.
 *
 * The phase of that flow picks the step while it is running: `verify` and
 * `verifying` show Code whatever the stored step says (phaseStep), and "Change
 * it" walks back to Sign in by returning the flow to `entry`.
 */
export function onboardAuthTree(opts: OnboardAuthOpts = {}): Record<string, unknown> {
  const desktop = opts.desktop === true;
  const appsOn = opts.connectorsOn === true;

  const welcome = STEP("welcome", [
    C1(SPOT("wave", 196, "s1.say", "corner")),
    H("s1.h", true),
    P(appsOn ? "s1.p" : "s1.p0", { textAlign: "center", paddingHorizontal: 6 }),
    PUSH(),
    BTN(EN["s1.cta"], seq(haptic("selection"), SET(1))),
    FINE("s1.fine", true),
  ]);

  const google: Node | null = opts.googleLink
    // The bridge for a bundle that cannot come back from Google: the same
    // two-step press googleLinkButton makes (note the tap, then open the link).
    ? {
        type: "Stack",
        on: { onPress: seq(setState("googleStarted", true), { kind: "openUrl", url: opts.googleLink, external: true }) },
        props: { pressOpacity: 0.7, accessibilityLabel: EN["si.google"] },
        style: {
          width: "100%", height: 48, borderRadius: 16, borderWidth: 1.5, borderColor: OB.ink, backgroundColor: OB.surf,
          flexDirection: "row", alignItems: "center", justifyContent: "center",
        },
        children: [googleRow()],
      }
    : opts.googleHidden
      ? null
      : {
          type: "GoogleSignIn",
          props: { size: 48, radius: 16, background: OB.surf, borderWidth: 1.5, borderColor: OB.ink, label: EN["si.google"] },
          style: { width: "100%" },
          children: [googleRow()],
        };
  // Apple's own control. It hides itself on Android.
  const apple: Node | null = opts.appleHidden
    ? null
    : {
        type: "AppleSignIn",
        props: { size: 48, radius: 16, buttonType: "CONTINUE", buttonStyle: "WHITE_OUTLINE", label: EN["si.apple"] },
        style: { width: "100%" },
      };
  const social = nodes([google, apple]);

  const signin = STEP("signin", [
    HD(SPOT("key", 110, "si.say")),
    H("si.h"),
    P(desktop ? "si.p.d" : "si.p"),
    {
      type: "Stack",
      style: { gap: 8, marginTop: 4 },
      children: nodes([
        ...social,
        // An "or" with nothing above it would hang from the top of the form.
        social.length ? OR() : null,
        { type: "SwipePill", props: { method: "email", variant: "field", placeholder: EN["si.em"], submitLabel: EN["si.email"], ...FIELD } },
        // The phone field is the backend's switch (AUTH_ENABLE_PHONE), as ever.
        {
          type: "Stack",
          visibleIf: { flag: "auth.enablePhone" },
          style: { gap: 8 },
          children: [
            OR(),
            {
              type: "SwipePill",
              props: {
                method: "phone", variant: "field", placeholder: EN["si.ph"], submitLabel: EN["si.phone"],
                presetCountry: "IN", dial: "+91", ...FIELD,
              },
            },
          ],
        },
        {
          type: "Stack",
          style: { flexDirection: "row", gap: 7, marginTop: 2 },
          children: [ICON("lock", 16, OB.ink2), TXT(EN["si.trust"], { flex: 1, fontSize: 13.5, lineHeight: 19, color: OB.ink2 })],
        },
        legalLine(),
      ]),
    },
  ]);

  // The code is verified the moment it is complete, so there is no Continue
  // to wait on. Blip waits while it comes and nods once it is in.
  const code = STEP("code", [
    HD(
      { type: "AuthPhase", props: { phases: ["verify"] }, children: [SPOT("wait", 110, "cd.say")] },
      { type: "AuthPhase", props: { phases: ["verifying"] }, children: [SPOT("nod", 110, "cd.say2")] },
    ),
    H("cd.h"),
    {
      type: "CodeEntry",
      props: {
        variant: "boxes",
        sentTo: EN["cd.p"], waitLabel: EN[desktop ? "cd.wait.d" : "cd.wait"], okLabel: EN["cd.ok"], failLabel: EN["cd.fail"],
        resendLabel: EN["cd.resend"], wrongLabel: EN["cd.wrong"], wrongEmailLabel: EN["cd.wrongE"], changeLabel: EN["cd.change"],
        boxHeight: 60, boxRadius: 14, boxGap: 8, boxBackground: OB.surf, boxBorderColor: OB.hair,
        boxFilledBackground: OB.white, boxFilledBorderColor: OB.ink, boxActiveRing: OB.neonSoft,
        digitColor: OB.ink, digitFont: OB.grotesk, digitSize: 28, textColor: OB.ink2, linkColor: OB.ink,
      },
    },
  ]);

  return {
    type: "OnboardStage",
    bind: { step: "step" },
    props: { ...stageProps("onboard.auth", 0, onboardTotal(desktop, appsOn)), phaseStep: { verify: 2, verifying: 2 } },
    children: [welcome, signin, code],
  };
}
