/**
 * The keyboard primer: what to expect before switching to the keyboard.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import type { ScreenContext } from "../screens.js";

/**
 * Cold-start primer — shown the FIRST time the keyboard hands off before
 * the main app has been foregrounded (or after a long absence). We can't
 * record right away because iOS hasn't granted mic yet; instead we prompt
 * the user, then tell them to swipe back and re-tap the keyboard mic.
 *
 * On subsequent handoffs the main app will be warm and go straight to
 * keyboard_record. Same backend-owned design freedom as everything else.
 */
export function keyboardPrimerScreen(ctx: ScreenContext): ScreenResponse {
  const sessionId = String(ctx.params?.session ?? "");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "keyboard_primer",
    title: "",
    // `micAsked`: the iOS prompt has been answered. Nothing beside Continue is drawn until it is — see the Settings
    // button at the foot of the tree.
    state: { handoffSessionId: sessionId, micGranted: false, micAsked: false },
    actions: {
      // `primed`: this whole screen is the explanation — what iOS is about to ask for, why the keyboard needs it,
      // and the three steps that name the system prompt as step 2. Continue is the only thing that fires it, so
      // the phone asks the system at once; its own box here would be a second explanation, between step 1 and the
      // step 2 this screen has just promised. Which is why Continue stands alone until the prompt is answered.
      grantMic: {
        kind: "requestPermission",
        permission: "microphone",
        primed: true,
        onGranted: "granted",
        onDenied: "denied",
      },
      granted: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "micGranted", value: true },
          { kind: "haptic", style: "success" },
        ],
      },
      denied: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "micAsked", value: true },
          {
            kind: "toast",
            tone: "error",
            message: "Allow the microphone in Settings → X0 Bot, then swipe back and tap the keyboard mic again.",
          },
        ],
      },
      openMainSettings: {
        kind: "openSettings",
      },
      dismiss: {
        kind: "sequence",
        actions: [
          { kind: "cancelKeyboardHandoff" },
          { kind: "navigateBack" },
        ],
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 24 },
      children: [
        { type: "Overline", props: { content: "One-time setup" } },
        { type: "Heading", props: { content: "Turn on voice for the keyboard" }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginTop: 6, marginBottom: 12 } },
        { type: "Paragraph", props: { content: "iOS asks this app for the microphone before the keyboard can use it. Tap Continue, then swipe back to your app: the keyboard mic will work from then on." }, style: { marginBottom: 28 } },
        { type: "Card", style: { marginBottom: 22, padding: 16 }, children: [
          { type: "Stack", style: { flexDirection: "row", alignItems: "center", marginBottom: 10 }, children: [
            { type: "Text", props: { content: "1." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Tap Continue below" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
          { type: "Stack", style: { flexDirection: "row", alignItems: "center", marginBottom: 10 }, children: [
            { type: "Text", props: { content: "2." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Answer the iOS microphone prompt" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
          { type: "Stack", style: { flexDirection: "row", alignItems: "center" }, children: [
            { type: "Text", props: { content: "3." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Swipe back to your app and tap the keyboard mic again" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
        ] },
        {
          type: "Button",
          visibleIf: { not: { truthy: "micGranted" } },
          props: { label: "Continue", variant: "primary" },
          on: { onPress: "grantMic" },
        },
        {
          type: "Card",
          visibleIf: { truthy: "micGranted" },
          motion: { appear: "fadeInUp" },
          style: { padding: 16, marginBottom: 12 },
          children: [
            { type: "Heading", props: { content: "You're set" }, style: { fontSize: 18, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
            { type: "Paragraph", props: { content: "Swipe back to your app now and tap the keyboard mic. It'll work from here on out." } },
          ],
        },
        { type: "Spacer", style: { height: 10 } },
        // AFTER THE PROMPT, NEVER BEFORE IT (App Review 5.1.1(iv); `primed` on grantMic above). This is the only
        // explanation iOS's prompt gets, so until the prompt has been answered Continue is the one thing to tap:
        // a second button beside it is a way to put the prompt off. Once it has been answered — and on a first
        // visit iOS has no Microphone row for this app before then — Settings is the only useful thing left.
        {
          type: "Button",
          visibleIf: { all: [{ not: { truthy: "micGranted" } }, { truthy: "micAsked" }] },
          props: { label: "Open X0 Bot Settings", variant: "secondary" },
          on: { onPress: "openMainSettings" },
        },
        { type: "Spacer", style: { height: 8 } },
        // App Review 5.1.1(iv): nothing puts the system's prompt off; once it is answered, Done.
        {
          type: "Button",
          visibleIf: { truthy: "micGranted" },
          props: { label: "Done", variant: "secondary" },
          on: { onPress: "dismiss" },
        },
      ],
    },
    cacheTtlSeconds: 600,
  };
}
