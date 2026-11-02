/**
 * The first run's keyStep screen, on the phone and in the window (keyOnPhone, keyOnDesk).
 */

import type { ActionSpec, ScreenResponse, Condition, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, SCREENS, when, box, icon, C, text, row, col, meta, statusMark, seq, botAvatar, botLook, title, grow, divider,
  primaryButton, type IconName, sectionLabel, button,
} from "../../kit.js";
import {
  type Words, go, fromApp, FROM_APP, CLAY, setState, phoneFrame, W, phoneBackLine, link, leave, deskFrame, deskBlip, deskHeading, deskFoot,
  deskBack,
} from "./parts.js";

/**
 * On to First words, in place of Turn on Keylessbord (so its Done leaves the setup, not back into it), with what has been
 * said so far, so First words can count only what is said there.
 */
const toFirstWords = (ctx: BotsCtx, w: Words | undefined): ActionSpec =>
  go(SCREENS.firstWords, { ...(w ? { w: w.totalWords, s: w.totalSeconds } : {}), ...(fromApp(ctx) ? FROM_APP : {}) }, true);

/** The phone's three steps in Settings, each done, in hand, or still to come, from what the phone itself reports. */
export function keyOnPhone(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  // iPhone's words unless the phone says it is an Android one.
  const android: Condition = { platform: "android" };
  const ios: Condition = { not: android };
  // Full Access read, or, on an iPhone, the keyboard switched on: an iPhone reads Full Access only after the keyboard has
  // run, so waiting for it there would hold Continue back from someone who has done every step (the keyboard itself says
  // so if Full Access is still off).
  const ready: Condition = { any: [{ truthy: "keyboardReady" }, { all: [ios, { truthy: "keyboardEnabled" }] }] };
  const done: Condition[] = [
    { any: [{ truthy: "opened" }, { truthy: "keyboardEnabled" }, ready] },
    { any: [{ truthy: "keyboardEnabled" }, ready] },
    ready,
  ];
  const now = (i: number): Condition => (i === 0 ? { not: done[0]! } : { all: [done[i - 1]!, { not: done[i]! }] });
  const later = (i: number): Condition => ({ not: done[i - 1]! });
  const badge = (i: number): Node[] => [
    when(done[i]!, box([icon("check", { size: 14, weight: 2 })], { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" })),
    when(now(i), box([text(String(i + 1), { size: 13, weight: 700, color: C.paper, lineHeight: 16 })], { width: 26, height: 26, borderRadius: 13, backgroundColor: CLAY, alignItems: "center", justifyContent: "center" })),
    ...(i ? [when(later(i), box([text(String(i + 1), { size: 13, weight: 700, color: C.meta, lineHeight: 16 })], { width: 26, height: 26, borderRadius: 13, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }))] : []),
  ];
  /** A step's words: iPhone's and Android's differ; the one in hand is bold. */
  const words = (i: number, t: { ios: string; android: string }): Node[] => [
    when({ all: [ios, now(i)] }, text(t.ios, { size: 15, weight: 600, lineHeight: 20 })),
    when({ all: [android, now(i)] }, text(t.android, { size: 15, weight: 600, lineHeight: 20 })),
    when({ all: [ios, { not: now(i) }] }, text(t.ios, { size: 15, lineHeight: 20, style: { color: { ...done[i]!, then: C.meta, else: C.ink } } })),
    when({ all: [android, { not: now(i) }] }, text(t.android, { size: 15, lineHeight: 20, style: { color: { ...done[i]!, then: C.meta, else: C.ink } } })),
  ];
  const step = (i: number, t: { ios: string; android: string }, extra: Node[] = []): Node => row([
    box(badge(i), { width: 26, flexShrink: 0 }),
    col([...words(i, t), ...extra], { gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    when(done[i]!, meta("Done", { size: 12 })),
    when(now(i), box([statusMark("working", { color: CLAY })], { height: 20, justifyContent: "center" })),
  ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: "flex-start" });
  const seg = (i: number): Node => box([
    when(done[i]!, box([], { height: 5, backgroundColor: C.ink })),
    when(now(i), box([], { height: 5, backgroundColor: CLAY })),
  ], { flexGrow: 1, flexBasis: 0, height: 5, borderRadius: 3, backgroundColor: C.track, overflow: "hidden" });
  const stepOf = [
    when(now(0), meta("Step 1 of 3", { size: 12 })), when(now(1), meta("Step 2 of 3", { size: 12 })),
    when(now(2), meta("Step 3 of 3", { size: 12 })), when(ready, meta("All done", { size: 12 })),
  ];
  const chipPath = (s: string): Node => box([text(s, { size: 11.5, mono: true, color: C.grey70, lineHeight: 15 })], {
    alignSelf: "flex-start", backgroundColor: C.surface, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8,
  });
  const openIos = seq(setState("opened", true), { kind: "requestPermission", permission: "microphone" } as ActionSpec, { kind: "openUrl", url: "app-settings:", external: true });
  const openAndroid = seq(setState("opened", true), { kind: "openSettings", target: "keyboard" });
  return phoneFrame(ctx, {
    title: W.keyH,
    // Overwritten live by the app: it re-reads the keyboard on a timer and on every return from Settings.
    state: { opened: false, keyboardEnabled: false, keyboardReady: false },
    body: [
      phoneBackLine(link("Not now", leave(ctx), { size: 14, color: C.grey70 }), leave(ctx)),
      row([botAvatar(botLook("keybot"), 52), col([title(W.keyH, { lineHeight: 31 }), meta(W.keyP, { size: 13 })], { gap: 3, flexShrink: 1 })], { gap: 14 }),
      col([
        col([
          row([when(ios, meta("In your iPhone Settings", { size: 12 })), when(android, meta("In your phone's Settings", { size: 12 })), grow(), ...stepOf]),
          row([seg(0), seg(1), seg(2)], { gap: 4 }),
        ], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 6, gap: 8 }),
        step(0, { ios: "Open Settings", android: "Open Settings" }),
        divider(),
        step(1, { ios: "Keyboards, then switch on X0 Bot", android: "Switch on X0 Bot, and tap OK" }, [when(ios, chipPath("Settings › X0 Bot › Keyboards"))]),
        divider(),
        step(2, { ios: "Allow Full Access", android: "Come back here" }, [
          when(ios, meta("Turn the switch on, then come back here", { size: 12 })),
          when(android, meta("Keylessbord takes it from there", { size: 12 })),
        ]),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      when(ios, col([
        text("Why full access?", { size: 14, weight: 600, lineHeight: 19 }),
        row([icon("mic", { size: 16, color: C.grey70 }), text("Keylessbord needs the internet to turn your voice into text. Full Access is what lets a keyboard reach it.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
        row([icon("lock", { size: 16, color: C.grey70 }), text("It only takes your words after you tap its mic key.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
      ], { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10 })),
    ],
    // One button: Continue opens Settings until the phone says Keylessbord is on, then goes on to try it.
    footer: [
      when({ all: [ios, { not: ready }] }, primaryButton("Continue", openIos, { wide: true })),
      when({ all: [android, { not: ready }] }, primaryButton("Continue", openAndroid, { wide: true })),
      when(ready, primaryButton("Continue", toFirstWords(ctx, w), { wide: true })),
      when({ all: [ios, { not: ready }] }, meta("Opens X0 Bot in Settings. Come back here when it's on.", { size: 12, align: "center" })),
      when({ all: [android, { not: ready }] }, meta("Opens your keyboards. Come back here when it's on.", { size: 12, align: "center" })),
      when(ready, meta("Keylessbord is on. Tap its mic key in any app.", { size: 12, align: "center" })),
    ],
  });
}

/** The window: the microphone (the OS asks the first time) and Accessibility, read on this computer by its own card. */
export function keyOnDesk(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  // This computer's answers (Accessibility, Screen Recording) are known only to its own main process; its card
  // ("DeskAskSetup", declared by a window that has it) draws the real state and opens the right page in Settings.
  const askCard = ctx.can.has("DeskAskSetup");
  const keys = ctx.can.has("DeskShell");
  const why = (name: IconName, line: string): Node =>
    row([icon(name, { size: 16, color: C.grey70 }), text(line, { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" });
  const permRow = (name: IconName, h: string, sub: string, right: Node | null): Node => row([
    box([icon(name, { size: 15 })], { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" }),
    col([text(h, { size: 15, weight: 600, lineHeight: 20 }), text(sub, { size: 13, lineHeight: 18, color: C.grey70 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(right ? [right] : []),
  ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: "flex-start" });
  const access: Node = askCard
    ? box([{
        type: "DeskAskSetup",
        props: {
          place: "settings", on: "Allowed", allow: "Open Settings", turnOff: "Turn off", restart: "Restart X0 Bot to finish", restartButton: "Restart",
          rows: [{ key: "read", title: "Accessibility", sub: "So Keylessbord can put the words where your cursor is, in any app." }],
        },
      }], { paddingHorizontal: 4, paddingBottom: 4 })
    : permRow("computer", "Accessibility", "If your Mac asks, allow X0 Bot in Privacy & Security › Accessibility, so Keylessbord can type where your cursor is.", null);
  return deskFrame(ctx, {
    title: W.keyH, current: null,
    right: link("Not now", leave(ctx), { size: 14, color: C.grey70 }),
    left: [
      deskBlip("needs", 140),
      deskHeading("Keylessbord", W.keyH, "Speak instead of type, in every app."),
      col([
        text("Why these two?", { size: 14, weight: 600, lineHeight: 19 }),
        why("mic", "The mic is on only while you hold the key. It never listens otherwise."),
        why("lock", "Keylessbord types only where your cursor is, and only what you said."),
      ], { backgroundColor: C.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 10, maxWidth: 400 }),
    ],
    main: [
      col([
        box([meta("In this computer's settings", { size: 12 })], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 4 }),
        permRow("mic", "Microphone", "So Keylessbord hears you while you hold the key. Your computer asks the first time.", null),
        divider(),
        access,
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      col([
        row([sectionLabel("Key to hold while you speak"), grow(), meta("Change it later in Settings", { size: 12 })], { gap: 10 }),
        keys
          ? row([{ type: "Keys", props: { source: "hotkey" } }, text("Hold it in any app, speak, let go.", { size: 14, lineHeight: 19, color: C.grey70 })], { gap: 12, flexWrap: "wrap" })
          : text("Hold your Keylessbord key in any app, speak, let go.", { size: 14, lineHeight: 19, color: C.grey70 }),
      ], { padding: 16, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    ],
    foot: deskFoot(deskBack(leave(ctx)), [
      meta("Allowed? Carry on and say something.", { size: 12, style: { maxWidth: 200 }, align: "right" }),
      button("Continue", toFirstWords(ctx, w), { size: "lg" }),
    ]),
  });
}
