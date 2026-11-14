/**
 * The first run's keybotCard screen.
 */

import type { Condition, Node, ActionSpec } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, seq, SCREENS, when, canMove, botCard, col, C } from "../../kit.js";
import {
  KEYS_MISSING, toast, setState, go, FROM_APP, permitStep, line, CARD_BOT, AX_STATE, OPEN_AX, KEYS_ON, MIC_SETTLED, keyboardLines, gotYou,
  CHEER_MS,
} from "./parts.js";

const SOMETHING_MISSING: Condition = { any: [{ falsy: "micGranted" }, KEYS_MISSING] };

/**
 * KEYBOT'S CARD: the same card in the page, for what is still missing (the microphone, and on a phone the keyboard
 * with Full Access); with everything on, no card at all. The microphone is asked for for real, and once allowed
 * First words opens to try it; refused before, the phone opens the app's page in Settings. A window shows the
 * microphone where it declares DeskMicAsk; its Accessibility stays on its own card (DeskAskSetup), which hides once on.
 */
export function keybotCard(ctx: BotsCtx): Node[] {
  const desk = ctx.client === "desktop";
  const off = desk
    ? toast("The microphone is off for X0 Bot. Turn it on in your computer's Privacy settings.")
    : seq(toast("The microphone is off for X0 Bot. Turn it on in Settings."), { kind: "openSettings", target: "app" } as ActionSpec);
  // `primed`: the only thing that fires this is the Continue of the step below, which says what the microphone is
  // for and has nothing beside it. One explanation, ours, and then the system — not the phone's own box as well.
  const ask = {
    kind: "requestPermission", permission: "microphone", primed: true,
    onGranted: seq(setState("micGranted", true), go(SCREENS.firstWords, FROM_APP)),
    onDenied: seq(setState("micAsked", true), toast("Keylessbord can't hear you yet. Allow the microphone to speak.")),
    onBlocked: seq(setState("micAsked", true), off),
  } as ActionSpec;
  const out: Node[] = [];
  if (desk) {
    if (ctx.can.has("DeskMicAsk")) {
      const steps = [permitStep({
        when: { falsy: "micGranted" }, title: "Let Keylessbord hear you",
        lines: [line("Keylessbord uses the microphone to hear you. Next, your computer asks you; then say something to try it.")],
        cta: { label: "Continue", onPress: ask },
      })];
      out.push(when({ falsy: "micGranted" }, canMove(ctx)
        ? botCard(steps, { ...CARD_BOT, kind: "custom", label: "Let Keylessbord hear you" })
        : col(steps, { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper })));
    }
    if (ctx.can.has("DeskAskSetup")) {
      out.push({
        type: "DeskAskSetup",
        props: {
          place: "home", eyebrow: "Keylessbord", title: "Turn on", titleEm: "Accessibility",
          lede: "So Keylessbord can put your words where your cursor is, in any app.",
          on: "Allowed", allow: "Open Settings", turnOff: "Turn off", restart: "Restart X0 Bot to finish", restartButton: "Restart",
          rows: [{ key: "read", title: "Accessibility", sub: "Lets Keylessbord type what you said into the app you're in." }],
        },
      });
    } else if (ctx.can.has(AX_STATE)) {
      // No Ask card here: the same step as the arrival's, while this computer says Accessibility is off.
      const steps = [permitStep({
        when: { falsy: "axGranted" }, title: "Let Keylessbord type for you",
        lines: [line("Allow Accessibility so Keylessbord can put your words where your cursor is, in any app.")],
        cta: { label: "Open Settings", onPress: OPEN_AX },
      })];
      out.push(when({ falsy: "axGranted" }, canMove(ctx)
        ? botCard(steps, { ...CARD_BOT, kind: "custom", label: "Let Keylessbord type for you" })
        : col(steps, { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper })));
    }
    return out;
  }
  const steps = [
    permitStep({
      // The microphone first; refused, it waits behind the keyboard and comes back once the keyboard is on.
      when: { all: [{ falsy: "micGranted" }, { any: [{ falsy: "micAsked" }, KEYS_ON] }] },
      title: "Let Keylessbord hear you",
      lines: [line("Keylessbord uses the microphone to hear you. Next, your phone asks you; then say something to try it.")],
      cta: { label: "Continue", onPress: ask },
    }),
    permitStep({
      when: { all: [MIC_SETTLED, KEYS_MISSING] },
      title: "Turn on full access",
      lines: keyboardLines(),
      cta: { label: "Open Settings", onPress: { kind: "openSettings", target: "keyboard" } as ActionSpec },
      quiet: { label: "Show me how", onPress: go(SCREENS.keyOn, FROM_APP) },
    }),
  ];
  // Drawn once the app says something is missing; when it is all on, the bot cheers on "X0 got you!" and the card goes.
  if (canMove(ctx)) {
    return [botCard([...steps, gotYou({ not: SOMETHING_MISSING })], {
      ...CARD_BOT, kind: "custom", label: "Set up Keylessbord",
      readyWhen: SOMETHING_MISSING, doneWhen: { not: SOMETHING_MISSING }, closeWhen: { truthy: "keybotSet" },
      doneDelayMs: CHEER_MS, onComplete: setState("keybotSet", true),
    })];
  }
  return [when(SOMETHING_MISSING, col(steps, { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6 }))];
}
