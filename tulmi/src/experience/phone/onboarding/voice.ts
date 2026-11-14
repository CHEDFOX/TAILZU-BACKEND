/**
 * Onboarding, the voice step: the mic permission and the first dictation.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import type { ScreenContext } from "../../screens.js";
import { heroSlot, HERO_PARTICLE } from "../hero.js";
import { allowPill } from "../parts.js";
import { THEME } from "../theme.js";

/**
 * Onboarding is a server-driven, two-step flow (the language pick happens
 * BEFORE it, on the client's native post-auth language screen — see the
 * `needsLanguagePick` bootstrap flag):
 *   onboarding (voice permission) → onboarding_keyboard (enable keyboard) → home
 * The keyboard step saves `onboarded` to the profile, so completion is
 * remembered server-side (not just on the device).
 */

/**
 * Onboarding step 1 — the VOICE PERMISSION screen (screenId stays "onboarding"
 * so routing — pickInitialScreenId, the intro's `done`, cached clients — is
 * untouched).
 *
 * Why mic comes before the keyboard step: iOS only gives an app a per-app
 * Settings page AFTER at least one permission has been requested. The keyboard
 * step's "Open Settings" (app-settings:) needs that page to exist — granting
 * (or even just answering) the mic prompt here is what makes the next screen
 * able to open Settings DIRECTLY.
 *
 * Both outcomes advance to the keyboard step: denial isn't a dead end (the
 * user can still type with the keyboard; voice can be enabled later in
 * Settings → Tailzu). Fully backend-authored — copy/media/flow change OTA.
 */
export function onboardingVoice(ctx?: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding",
    title: "",
    // Full-bleed: no header/back/tabs — this is the gate.
    hideChrome: true,
    // Both are overwritten live by the app, which re-reads the device on a
    // timer and on every return to the foreground. Declared with the
    // conservative answer so a store that has not been filled in yet routes
    // the long way round rather than skipping a step.
    state: { micGranted: false, keyboardReady: false },
    actions: {
      // ALREADY ALLOWED? DO NOT ASK AGAIN, AND DO NOT SIT THERE.
      //
      // Fired by the watcher at the foot of this screen, which is gated on
      // micGranted — so this runs when the permission is granted, whenever
      // that happens: already true when the screen opens, or turned on in
      // Settings and discovered the moment the app comes back.
      //
      // IT CANNOT BE DONE ON THE SCREEN APPEARING. The permission is changed
      // in Settings, which means the app was in the background when it
      // changed, and returning from the background is not a mount — the screen
      // that checked once on the way in never checks again, and sits there
      // asking for something it already has. That was the bug.
      //
      // The beat is deliberate. Passing instantly would flash this screen for
      // a frame and read as a glitch; a second and a half reads as the screen
      // noticing.
      autoPass: {
        kind: "sequence",
        actions: [
          { kind: "delay", ms: 1500 },
          // checkPermission, NOT requestPermission. Requesting is how you find
          // out, and on an undetermined permission the finding out IS the
          // prompt — which would fire the dialog on arrival, before this screen
          // had said a word. This reads the answer and never asks.
          { kind: "checkPermission", permission: "microphone", onGranted: "goKeyboard" },
        ],
      },

      // CTA — fire the system mic prompt. Either answer moves forward; the
      // permission REQUEST itself (not the grant) is what creates the per-app
      // Settings page the next screen deep-links to.
      //
      // `primed` (shared/types/sdui.ts): this screen IS the card — it names
      // the microphone, says what it is for, and says the phone asks next —
      // and its one pill is the only thing that fires the ask. The ✕ that used
      // to sit beside that pill is gone, because a way to put the prompt off
      // is the one shape 5.1.1(iv) forbids in front of it; the way out is not
      // tapping, and a refusal moves on by itself (deniedNext).
      allowMic: {
        kind: "requestPermission",
        permission: "microphone",
        primed: true,
        onGranted: "goKeyboard",
        onDenied: "deniedNext",
        // ALREADY ANSWERED MEANS THE DIALOG IS NEVER COMING.
        //
        // iOS shows it once per install. After Don't Allow, or after the
        // switch is turned off in Settings later, this request returns denied
        // instantly and draws nothing — so the Allow button did visibly
        // nothing and read as broken rather than as a decision already made.
        //
        // Settings is the only place that answer can change, so that is where
        // this goes. The watcher at the foot of this screen is already looking
        // for the permission to appear, so coming back with it granted moves
        // the user on by itself.
        onBlocked: "micBlocked",
      },
      micBlocked: {
        kind: "sequence",
        actions: [
          { kind: "toast", tone: "info", message: "Turn on Microphone for X0 Bot, then come back." },
          { kind: "openSettings", target: "app" },
        ],
      },
      // Forward from here means the NEXT thing still missing — not always the
      // keyboard step. Someone whose keyboard is already set up (a second
      // account on the same phone, mic denied but everything else in place)
      // would otherwise land on a walkthrough for something already done and
      // watch it dismiss itself.
      goKeyboard: {
        kind: "condition",
        if: { truthy: "keyboardReady" },
        then: "finishOnboarding",
        // replace, not push: onboarding is a sequence, and an edge swipe must
        // not walk back into a permission screen that has been answered.
        else: { kind: "navigate", screenId: "onboarding_keyboard", replace: true },
      },
      // Same finish the keyboard step performs, for the case where that step
      // is skipped. Errors land the user in the app anyway: the flag is worth
      // one retry next launch, not a dead end on a screen with nothing to do.
      finishOnboarding: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "landInApp",
        onError: "landInApp",
      },
      landInApp: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "switchTab", tabId: "personality" },
        ],
      },
      deniedNext: {
        kind: "sequence",
        actions: [
          { kind: "toast", tone: "info", message: "You can allow the microphone anytime in Settings → X0 Bot." },
          { kind: "navigate", screenId: "onboarding_keyboard", replace: true },
        ],
      },
    },
    root: {
      type: "Stack",
      // hideChrome = truly full-bleed, so the top/bottom padding IS the safe
      // area: 76 clears the status bar on notch phones, 48 clears the home
      // indicator (28/28 put the title under the clock and clipped "Not now").
      style: {
        flex: 1,
        direction: "column",
        alignItems: "center",
        backgroundColor: "#000000",
        paddingHorizontal: 28,
        paddingTop: 76,
        paddingBottom: 48,
      },
      // GOLDEN SCALE (φ ≈ 1.618, via the Fibonacci ladder 8·13·21·34·55):
      // type pairs size×φ≈lineHeight — 34/42 display (display tracks tighter),
      // 21/34 pitch, 14/23 body, 13/21 sub, 11 kicker; spacing steps come from
      // the same ladder (13, 21, 34, 55). One ratio everywhere is what makes
      // the screen read composed instead of arbitrary.
      children: [
        // TWO HEADINGS, ONE SENTENCE. A Text paints one colour, so the last
        // word cannot take its own tone (warm pale ink, not amber — nothing is
        // live here yet) while the rest stays white — the sentence has to be
        // split to be two-toned. Both halves are Headings rather than
        // Texts so the serif family and tracking come from the same place they
        // always did, and only the colour differs.
        //
        // Row wraps, so a narrow screen breaks between the two halves — a clean
        // break after "It's" — instead of clipping. flexWrap needs a width to
        // wrap within, hence 100%.
        {
          type: "Stack",
          style: {
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "flex-end",
            width: "100%",
          },
          children: [
            {
              type: "Heading",
              props: { content: "Say it. It's " },
              style: { fontSize: 34, lineHeight: 42, color: "$color.text", marginBottom: 0 },
            },
            {
              type: "Heading",
              props: { content: "written." },
              style: { fontSize: 34, lineHeight: 42, color: "#F3E2C6", marginBottom: 0 },
            },
          ],
        },
        // The vertical middle. Swappable: upload onboarding.hero, or set
        // HERO_ONBOARDING to an SDUI node, and this becomes that instead.
        {
          type: "Stack",
          style: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
          children: [heroSlot({
            id: "onboarding",
            mediaKeys: ["onboarding.hero"],
            formFactor: ctx?.formFactor,
            // The screen a first launch's splash waits on: see videoByKey.
            videoByKey: true,
            style: { width: HERO_PARTICLE, height: HERO_PARTICLE, borderRadius: HERO_PARTICLE / 2 },
            builtIn: {
              // The mark comes apart in vacuum, holds, and springs back
              // together. This screen is asking for the microphone, so the
              // most honest illustration is the motion the microphone makes.
              type: "ParticleMark",
              props: {
                count: 160,
                dotRadius: 1.5,
                color: THEME.color.primary,
                speed: 1,
                circular: true,
                holdMark: true,
              },
              // Older bundles have no ParticleMark and would leave the middle
              // of the screen empty.
              fallback: {
                type: "Paragraph",
                props: { content: "Talk like you talk. It comes out clean, and still sounds like you." },
                style: { textAlign: "center", fontSize: 21, lineHeight: 34, fontWeight: "300", color: "$color.text", maxWidth: 300 },
              },
            },
          })],
        },
        {
          type: "Paragraph",
          props: { content: "X0 Bot uses the microphone so you can talk in every app you type in. Next, your phone asks you." },
          style: { textAlign: "center", fontSize: 13, lineHeight: 21, marginBottom: 21 },
        },
        // ONE CONTROL, ONE ANSWER (App Review 5.1.1(iv); `primed` on allowMic).
        // The dark pill is the whole width of the thing and there is nothing
        // beside it: this screen is the one explanation the system's prompt
        // gets, so a ✕ here would be a way to put that prompt off. Saying no
        // is the prompt's own job, and it moves the step on.
        allowPill("Continue", "allowMic"),
        // THE WATCHER. Draws nothing; exists to notice.
        //
        // visibleIf + onAppear means "run this when the condition becomes
        // true", and micGranted is re-read on every return to the foreground —
        // so this fires whether the permission was already there when the
        // screen opened or was granted in Settings a minute later.
        { type: "Stack", style: { height: 0 },
          visibleIf: { truthy: "micGranted" },
          on: { onAppear: "autoPass" } },
      ],
    },
    cacheTtlSeconds: 600,
  };
}
