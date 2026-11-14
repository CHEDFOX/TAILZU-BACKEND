/**
 * Onboarding, the keyboard step: adding the keyboard on each platform.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { getMediaRegistryFn } from "../../mediaRegistry.js";
import { screenHero } from "../hero.js";
import { allowPill } from "../parts.js";

/** The keyboard film's shape (tools/media renders it at 1080 × 1400). */
const KB_FILM_ASPECT = 1080 / 1400;

/** Step 2 — enable the Tailzu keyboard, then finish (marks onboarded). */
export function onboardingKeyboard(): ScreenResponse {
  // Which devices have the keyboard film (tools/media: the website's hero).
  const kbReg = getMediaRegistryFn?.() ?? {};
  const kbFilm = { ios: !!kbReg["hero.onboarding_keyboard.card"]?.url, android: !!kbReg["hero.onboarding_keyboard.card.android"]?.url };
  // Golden body pair: 14/23 (14 × φ ≈ 22.65) — see the voice screen's scale note.
  const step = (n: string, body: string): Node => ({
    type: "Stack", style: { direction: "row", gap: 10, alignItems: "flex-start" }, children: [
      // Fixed-width number column so all five step bodies left-align.
      { type: "Text", props: { content: n }, style: { color: "$color.muted", fontSize: 10.5, fontWeight: "700", width: 12, lineHeight: 16 } },
      { type: "Paragraph", props: { content: body }, style: { marginBottom: 0, flex: 1, fontSize: 11.5, lineHeight: 16 } },
    ],
  });
  // The line that used to sit under the headline, now the box's own first
  // line. It belongs here: it is not a second thought after the title, it is
  // what the list under it is for.
  const stepsTitle: Node = {
    type: "Paragraph",
    props: { content: "A moment in Settings, and X0 Bot writes with you in every app." },
    style: { fontSize: 12.5, lineHeight: 18, color: "$color.text", marginBottom: 11 },
  };
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding_keyboard",
    title: "",
    // Full-bleed like the voice step: without this the tab bar + back chevron
    // render, and a user who taps Home escapes onboarding WITHOUT the
    // finish/skip PUT — profile.onboarded stays false and every next launch
    // routes back into onboarding (the "voice screen forever" loop).
    hideChrome: true,
    state: { keyboardReady: false, keyboardEnabled: false },
    actions: {
      // No staged flash any more. It existed because the old Button's own
      // amber decay was racing iOS — the next action handed the screen to
      // Settings before the colour read. The pill is a Stack with an onPress,
      // which is a Pressable, and its dim-on-press lands the instant the
      // finger does: immediate feedback, and nothing between the tap and the
      // door opening.
      // MOVE ON BY ITSELF once the keyboard is actually enabled.
      //
      // The app polls the keyboard's status every 1.5s and on every return to
      // foreground, so keyboardReady flips true moments after the user finishes
      // in Settings and comes back. This fires on that flip (see the watcher
      // node at the foot of the screen) and finishes onboarding for them —
      // there is nothing left to ask, and asking them to tap a button that
      // says the thing they just did is a step for its own sake.
      //
      // The beat before it is the point: land back in the app, see the screen
      // acknowledge the change, and then move. Passing instantly would look
      // like a dropped frame rather than a result.
      autoFinish: {
        kind: "sequence",
        actions: [{ kind: "delay", ms: 1100 }, "finish"],
      },
      // Prefer openUrl("app-settings:") over openSettings — same underlying
      // iOS mechanism but a different Linking code path. Critically, this
      // action only reliably opens iOS Settings AFTER at least one permission
      // has been requested — before that, iOS has no per-app Settings surface
      // and the URL resolves silently. The VOICE PERMISSION screen right
      // before this one fires that prompt, so Settings opens DIRECTLY here.
      // The ask behind the read is an idempotent belt-and-suspenders for the
      // "Not now" path (already-decided permissions return instantly with no
      // prompt). The READ is in front of it because the phone draws its own
      // "One permission first" card before every ask that is not `primed`,
      // without looking at the permission first — so on the ordinary path,
      // where the step before this one has already settled the microphone,
      // that card stood in front of a Settings page and asked nothing.
      // Not `primed` (shared/types/sdui.ts): this screen is about the
      // keyboard, and on the one path where the ask really does draw a prompt,
      // the phone's own card is all the explanation it has.
      openSettings: {
        kind: "sequence",
        actions: [
          {
            kind: "checkPermission",
            permission: "microphone",
            onGranted: { kind: "openUrl", url: "app-settings:", external: true },
            onDenied: {
              kind: "sequence",
              actions: [
                { kind: "requestPermission", permission: "microphone" },
                { kind: "openUrl", url: "app-settings:", external: true },
              ],
            },
          },
          { kind: "toast", tone: "info", message: "In Settings: General → Keyboard → Keyboards → Add New → X0 Bot" },
        ],
      },
      // Android lands the user ON the keyboard list. `openSettings` with
      // target "keyboard" fires INPUT_METHOD_SETTINGS, so none of the walk
      // above applies — and app-settings: is an iOS URL scheme that does
      // nothing here, which is why this cannot share the action.
      openKeyboardSettings: {
        kind: "sequence",
        actions: [
          { kind: "openSettings", target: "keyboard" },
          { kind: "toast", tone: "info", message: "Turn on X0 Bot, then come back." },
        ],
      },
      // Split the finish flow so `switchTab` only runs after the PUT succeeds.
      // Previously the write was fire-and-forget: any network blip / 401 / 5xx
      // was swallowed and the user still visually "completed" onboarding,
      // producing the "home tab + onboarding content" loop on next launch.
      finish: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "finishOk",
        onError: "finishErr",
      },
      finishOk: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          // Land on You: profileGate.screenIds = ["personality"], so the
          // name/gender card is the immediate next step. Landing on Home
          // silently deferred it until the user happened to open You.
          { kind: "switchTab", tabId: "personality" },
        ],
      },
      finishErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't finish setup. Check your connection and try again.",
      },
      // Escape hatch — user can skip onboarding even if `keyboardReady` never
      // flips true (e.g. the iOS keyboard extension isn't installed on this
      // build, or Full Access can't be detected). Same server confirmation as
      // finish, so the flag actually persists.
      skip: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "finishOk",
        onError: "finishErr",
      },
    },
    // A ROOT, NOT A TEMPLATE — because of the backdrop.
    //
    // "scroll" composes exactly one node, a Screen, so a template leaves
    // nowhere to put a layer BEHIND the content: anything added to blocks is
    // inside the ScrollView, where an absolute child anchors to the content
    // box and scrolls away with it. A backdrop has to be the Screen's sibling
    // to stay still and to fill the window, and that needs a root.
    //
    // The Screen is transparent so the art shows through, and the Stack under
    // both stays black — that is what is seen before the media loads, and if
    // nothing has been uploaded to the key it is all that is ever seen. Safe
    // to ship ahead of the art.
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: "#000000" },
      children: [
        // Upload to `onboarding_keyboard.bg` and it appears; upload nothing and
        // screenHero returns no nodes at all. Video or still, either works.
        ...screenHero("onboarding_keyboard.bg", { behind: true }),
        {
          type: "Screen",
          // The footer below carries the pill; the column needs no tab-bar
          // clearance under its last card.
          props: { paddingBottom: 24 },
          style: { backgroundColor: "transparent" },
          children: [
      // hideChrome = full-bleed: this spacer IS the top safe area (the card
      // used to start under the status-bar clock). Golden ladder throughout —
      // 13/21/34/55 spacing, 34/42 heading, 12.5/18 box title, 11.5/16 steps.
      { type: "Spacer", style: { height: 66 } },
      // 34/42, the display size off the same golden ladder the voice step uses.
      // With the supporting line moved into the box below, the headline is the
      // only thing at the top of the screen and should read like it.
      // The film carries the screen's title ("It's a keyboard.", corrected
      // to keyless), so this heading shows only where no film has been
      // uploaded for the device.
      ...(kbFilm.ios && kbFilm.android ? [] : [{
        type: "Heading", props: { content: "Bring it everywhere." },
        ...(kbFilm.ios ? { visibleIf: { platform: "android" } } : kbFilm.android ? { visibleIf: { platform: "ios" } } : {}),
        style: { fontSize: 34, lineHeight: 42, color: "$color.text", marginBottom: 24 },
      } as Node]),
      // The keyboard's own picture, between the headline and the walk, per
      // device like the walk itself: `hero.onboarding_keyboard.card` on iOS,
      // `hero.onboarding_keyboard.card.android` on Android (each shows its
      // own system tray giving way to Tailzu's). A 4:3 card the width of
      // the column; nothing at all until something is uploaded. Phones only:
      // a window never reaches this screen (pickInitialScreenId).
      ...screenHero("onboarding_keyboard.card", { width: "100%", aspectRatio: KB_FILM_ASPECT, radius: 0, marginBottom: 24, onlyOn: "ios" }),
      ...screenHero("onboarding_keyboard.card.android", { width: "100%", aspectRatio: KB_FILM_ASPECT, radius: 0, marginBottom: 24, onlyOn: "android" }),
      // The walk through Settings, shown rather than described — and one
      // recording per platform, because the two walks share no screen. An iOS
      // recording shown to an Android user is worse than no recording: it
      // teaches them a path that does not exist on their phone.
      //
      // Gated on the device, like the written steps below. Upload a video or
      // a GIF to either key; upload nothing and that platform simply shows
      // the words, so this is safe to ship before the art exists.
      //
      // Portrait, because a recording of a phone screen IS portrait: 9:16 at
      // 200pt wide, centred. Forcing that into a landscape banner would crop
      // it to a sliver of itself. The screen scrolls, so the height is
      // affordable and the steps still sit under it.
      // The older per-device art only where there is no film for the device:
      // the film and a second picture above the same steps was two pictures
      // and a gap.
      ...(kbFilm.ios ? [] : screenHero("onboarding_keyboard.ios", { height: 356, width: 200, radius: 18, onlyOn: "ios" })),
      // Android: the uploaded hero if one exists, otherwise the drawn one —
      // see androidKeyboardArt(). Either way the slot is never empty on a
      // platform whose step is the harder of the two to follow.
      ...(kbFilm.android ? [] : getMediaRegistryFn?.()?.["hero.onboarding_keyboard.android"]?.url
        ? screenHero("onboarding_keyboard.android", { height: 356, width: 200, radius: 18, onlyOn: "android" })
        : [{ ...androidKeyboardArt(), visibleIf: { platform: "android" } } as Node,
           { type: "Spacer", style: { height: 22 } } as Node]),
      // The steps card, per platform. The two systems share nothing here:
      // "General", "Add New Keyboard" and "Allow Full Access" do not exist on
      // Android, and Android's own path is shorter because the button below
      // deep-links straight to its keyboard settings.
      //
      // Both lists ship and the device picks — the renderer's `platform`
      // condition is evaluated on the phone, so this needs no server-side
      // detection and cannot get it wrong.
      //
      // iOS. Apple does NOT allow deep-linking into Settings > Keyboards, so
      // the button lands on Tailzu's own Settings page (which exists because
      // the voice step just fired the mic prompt) and the user walks the rest.
      // Every step is spelled out because none of them can be skipped for them.
      {
        type: "Card",
        visibleIf: { platform: "ios" },
        // A pale-ink border. The steps ARE the screen — the button only opens a
        // door — so the card is what the eye should land on, and a hairline
        // says that without a fill loud enough to fight the headline. Not
        // amber: amber is for what is live.
        style: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(243,226,198,0.7)" },
        children: [
          stepsTitle,
          step("1", "Open Settings, then tap General."),
          { type: "Spacer", style: { height: 10 } },
          step("2", "Tap Keyboard → Keyboards → Add New Keyboard."),
          { type: "Spacer", style: { height: 10 } },
          step("3", "Choose X0 Bot from the list."),
          { type: "Spacer", style: { height: 10 } },
          step("4", "Tap X0 Bot again and turn on “Allow Full Access”."),
          { type: "Spacer", style: { height: 10 } },
          step("5", "Return to X0 Bot — the globe key switches keyboards."),
        ],
      },
      // Android. The button fires INPUT_METHOD_SETTINGS, which opens the
      // keyboard list directly — so the walk through Settings that iOS needs
      // is replaced by one tap, and the steps start from where the user
      // lands. Step 3 is the notice Android shows about keyboards reading what
      // you type; it looks alarming and it is what stops people, so it is
      // named rather than left as a surprise. There is no Full Access on
      // Android, and no step for it.
      {
        type: "Card",
        visibleIf: { platform: "android" },
        style: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(243,226,198,0.7)" },
        children: [
          stepsTitle,
          step("1", "Tap the button below — it opens your keyboard list."),
          { type: "Spacer", style: { height: 10 } },
          step("2", "Turn on X0 Bot."),
          { type: "Spacer", style: { height: 10 } },
          step("3", "Android warns that a keyboard can read what you type. Accept it — that is how every keyboard works."),
          { type: "Spacer", style: { height: 10 } },
          step("4", "Come back, then tap the globe key to switch to X0 Bot."),
        ],
      },
      // THE WATCHER. Draws nothing; exists to notice.
      //
      // visibleIf + onAppear means "run this when the condition becomes true",
      // so this fires the moment the signal flips — which is the moment the app
      // comes back from Settings with the keyboard turned on.
      //
      // keyboardEnabled, NOT keyboardReady. Full Access is readable only from
      // inside the keyboard extension, and ADDING A KEYBOARD DOES NOT RUN IT —
      // so keyboardReady stays false until the user happens to type with it
      // somewhere, and a screen waiting on that waits forever. `enabled` comes
      // from the system's own list of keyboards and turns true as soon as
      // Tailzu is switched on, which is when this step has nothing left to ask.
      //
      // A Stack, not a Spacer: Spacer reads height 0 as "no height given" and
      // takes flex: 1, which pushes the rest of the screen apart.
      { type: "Stack", style: { height: 0 },
        visibleIf: { truthy: "keyboardEnabled" },
        on: { onAppear: "autoFinish" } },
          ],
        },
        // THE PILL SITS AT THE BOTTOM, whatever the phone's height: a footer
        // beside the scrolling column, not the last thing in it, so the way
        // on is always in reach and the column takes the room above it.
        {
          type: "Stack",
          style: { paddingHorizontal: 28, paddingTop: 21, paddingBottom: 48 },
          children: [
          // Two buttons, one per platform, because they go to different places and
          // a label should say where. iOS lands on Tailzu's own Settings page and
          // the user walks from there — "Go to Settings" is the honest promise.
          // Android lands directly on the keyboard list, so it can promise that.
          // iOS lands on Tailzu's own Settings page and the user walks from there;
          // Android lands directly on the keyboard list. Same control, different
          // promise, because a label should say where it goes.
          {
            ...allowPill("Allow access", "openSettings", "skip"),
            visibleIf: { all: [{ not: { truthy: "keyboardEnabled" } }, { platform: "ios" }] },
          },
          {
            ...allowPill("Allow access", "openKeyboardSettings", "skip"),
            visibleIf: { all: [{ not: { truthy: "keyboardEnabled" } }, { platform: "android" }] },
          },
          // Already done. No ✕ — there is nothing left to decline.
          {
            ...allowPill("Start using X0 Bot", "finish"),
            visibleIf: { truthy: "keyboardEnabled" },
          },
          ],
        },
      ],
    },
    cacheTtlSeconds: 600,
  };
}

/**
 * ANDROID'S KEYBOARD LIST, DRAWN RATHER THAN RECORDED.
 *
 * iOS ships a screen recording of the walk through Settings. Android has no
 * equivalent uploaded, and the node is gated per platform — so that step has
 * been showing Android users the written steps and an empty space where the
 * art is.
 *
 * A recording is also the wrong artefact here. Android's settings differ by
 * manufacturer and by version, so a capture from one phone teaches a screen
 * half the users do not have, and it goes stale the first time Samsung moves
 * something. What does not go stale is the SHAPE of the moment: a list of
 * keyboards, and one switch to turn on.
 *
 * So it is drawn from nodes. No upload, no build, nothing to re-record — and
 * an uploaded hero still wins if one ever appears, because the caller checks
 * the registry first.
 */
function androidKeyboardArt(): Node {
  const panel = "#141418";
  const rowBg = "rgba(255,255,255,0.04)";
  const ink = "rgba(255,255,255,0.92)";
  const dim = "rgba(255,255,255,0.45)";

  /** One keyboard in the list, and the switch beside it. */
  const row = (name: string, on: boolean, lit = false): Node => ({
    type: "Stack",
    style: {
      flexDirection: "row", alignItems: "center", gap: 10,
      // The row to turn on, lit in pale ink rather than amber: nothing in a
      // settings list is live.
      backgroundColor: lit ? "rgba(243,226,198,0.12)" : rowBg,
      borderRadius: 10, paddingHorizontal: 11, paddingVertical: 11,
      ...(lit ? { borderWidth: 1, borderColor: "rgba(243,226,198,0.45)" } : {}),
    },
    children: [
      { type: "Stack", style: {
        width: 22, height: 22, borderRadius: 6,
        backgroundColor: lit ? "#F3E2C6" : "rgba(255,255,255,0.10)" } },
      { type: "Text", props: { content: name },
        style: { flex: 1, fontSize: 12, fontWeight: lit ? "700" : "500",
                 color: lit ? "#FFFFFF" : dim } },
      // The switch. Two nodes: the track, and the knob parked at the end the
      // state puts it.
      { type: "Stack", style: {
          width: 34, height: 20, borderRadius: 10, padding: 2,
          justifyContent: "center",
          alignItems: on ? "flex-end" : "flex-start",
          // Lit: pale ink, kept under full strength so the white knob reads.
          backgroundColor: on ? (lit ? "rgba(243,226,198,0.62)" : "rgba(255,255,255,0.28)")
                              : "rgba(255,255,255,0.12)" },
        children: [{ type: "Stack", style: {
          width: 16, height: 16, borderRadius: 8, backgroundColor: "#FFFFFF" } }] },
    ],
  });

  return {
    type: "Stack",
    style: {
      width: 200, height: 356, borderRadius: 18, overflow: "hidden",
      alignSelf: "center", backgroundColor: panel,
      borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
      paddingHorizontal: 14, paddingTop: 16, paddingBottom: 16,
    },
    children: [
      // The panel's own header, so it reads as a settings screen rather than
      // as one of our cards.
      { type: "Text", props: { content: "Manage keyboards" },
        style: { fontSize: 13, fontWeight: "700", color: ink, marginBottom: 3 } },
      { type: "Text", props: { content: "On-screen keyboard" },
        style: { fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase",
                 color: "rgba(255,255,255,0.32)", marginBottom: 14 } },
      { type: "Stack", style: { gap: 8 }, children: [
        row("Gboard", true),
        row("Samsung Keyboard", false),
        // The one that matters arrives last and from below, so the eye lands
        // on the switch rather than on the list.
        { type: "Rise", props: { delayMs: 420, fromY: 26 }, children: [row("X0 Bot", true, true)] },
      ] },
      { type: "Stack", style: { flex: 1 } },
      // What Android says next, named rather than left as a surprise — it is
      // the notice that stops people, and it is step 3 in the words below.
      { type: "Stack",
        style: { borderRadius: 10, padding: 11,
                 backgroundColor: "rgba(255,255,255,0.05)" },
        children: [
          { type: "Text", props: { content: "Attention" },
            style: { fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase",
                     color: "rgba(255,255,255,0.4)", marginBottom: 5 } },
          { type: "Text", props: { content: "This keyboard may collect all the text you type. Use it?" },
            style: { fontSize: 10.5, lineHeight: 15, color: dim } },
        ] },
    ],
  };
}
