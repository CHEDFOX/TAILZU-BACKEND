/**
 * The Keybot's settingsDesk screen.
 */

import type { Node, ActionSpec, Condition } from "../../../../../../shared/types/sdui.js";
import type { KeybotSettingsView } from "../../../../keybot/views.js";
import {
  when, segmented, meta, type BotsCtx, row, col, text, switchMark, chip, box, C, icon, page, grow, divider, quietButton, open, SCREENS,
} from "../../kit.js";
import { write, CLAY, DESK_WIDTH, deskHead, twoCols, deskCard, kbd, couldntLoad } from "../keybotParts.js";
import { laptopKeys, keyList } from "./parts.js";

/** The one key's choices (gap 17): a Mac's three, a PC's two, for a window that has the one key (desktop.oneKey). Picked,
 *  main.js binds it at once (app:setConfig oneKey) and answers with the keys as bound. */
const MAC_KEYS = [{ label: "Fn", value: "fn" }, { label: "Right ⌥", value: "rightOption" }, { label: "Right ⌘", value: "rightCommand" }];
const PC_KEYS = [{ label: "Right Ctrl", value: "rightCtrl" }, { label: "Right Alt", value: "rightAlt" }];
function keyChoice(): Node[] {
  const pick = { kind: "desktop.config", key: "oneKey", value: "$state.desktop.oneKey" } as ActionSpec;
  const has: Condition = { truthy: "desktop.oneKey" };
  return [
    when({ all: [has, { eq: ["desktop.os", "mac"] }] }, segmented(MAC_KEYS, "desktop.oneKey", { onChange: pick })),
    when({ all: [has, { eq: ["desktop.os", "windows"] }] }, segmented(PC_KEYS, "desktop.oneKey", { onChange: pick })),
    when({ all: [has, { falsy: "desktop.oneKeyOn" }] }, meta("This key can't be used on this computer right now, so Keylessbord listens on the key above.", { size: 12 })),
    when({ eq: ["desktop.oneKey", "fn"] }, meta("If Fn opens emoji, set “Press 🌐 key to” to “Do Nothing” in Keyboard settings.", { size: 12 })),
  ];
}

const COMMON_LANGS = [{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "hinglish", label: "Hinglish" }];

export function settingsDesk(ctx: BotsCtx, d: KeybotSettingsView | undefined) {
  const cfg = (key: string): ActionSpec => ({ kind: "desktop.config", key, value: "$toggle" } as ActionSpec);
  const deskToggle = (label: string, key: string, sub: string) => row([
    col([text(label, { size: 14, lineHeight: 19 }), meta(sub, { size: 12 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    switchMark(`desktop.${key}`),
  ], { gap: 14, paddingVertical: 8, minHeight: 44 }, cfg(key));
  const chosen = new Set((d?.languages ?? []).map((l) => l.value));
  const langChips = [...(d?.languages ?? []), ...COMMON_LANGS.filter((l) => !chosen.has(l.value))].map((l) => chip(l.label, {
    selected: chosen.has(l.value),
    onPress: write("POST", "/v1/keybot/language", { value: l.value, on: !chosen.has(l.value) }, undefined, "Couldn't change your languages. Try again."),
  }));
  const pillPreview = col([
    box([], { height: 6, width: "70%", borderRadius: 3, backgroundColor: C.track }),
    row([box([], { height: 6, width: "34%", borderRadius: 3, backgroundColor: C.track }), box([], { width: 1.5, height: 12, backgroundColor: C.ink })], { gap: 2 }),
    row([
      box([icon("mic", { size: 10, color: C.paper })], { width: 16, height: 16, borderRadius: 8, backgroundColor: CLAY, alignItems: "center", justifyContent: "center" }),
      row([4, 8, 5, 10, 6, 3, 7].map((h) => box([], { width: 2, height: h, borderRadius: 1, backgroundColor: CLAY })), { gap: 2 }),
      text("kal 7 baje", { size: 11, lineHeight: 14 }),
    ], { gap: 6, alignSelf: "flex-start", backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 4, paddingLeft: 4, paddingRight: 10 }),
  ], { gap: 6, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 });
  return page(ctx, {
    nav: "keybot", title: "Keyboard", gap: 18, maxWidth: DESK_WIDTH,
    body: [
      deskHead("Keyboard", "How Keylessbord listens and shows up on this computer."),
      twoCols([
        deskCard("Shortcut", [
          row([text("Keylessbord key", { size: 14, lineHeight: 19 }), grow(),
            when({ truthy: "desktop.hold" }, kbd("Fn", "desktop.holdKey")), when({ falsy: "desktop.hold" }, kbd("Ctrl+Space", "desktop.hotkey"))], { gap: 12, minHeight: 32 }),
          // The one key (gap 17): picked here, on a window that has it.
          ...keyChoice(),
          laptopKeys(),
          keyList(),
          divider(),
          when({ truthy: "desktop.oneKey" }, deskToggle("Tap to keep listening", "tap", "Hands free. Tap the key again to stop.")),
          when({ falsy: "desktop.oneKey" }, deskToggle("Tap twice to keep listening", "tap", "Hands free. Tap the key again to stop.")),
          when({ truthy: "desktop.oneKey" }, meta("One key for everything. Keylessbord types it, Ask answers it, “take notes” starts notes, and a task goes to the right bot.", { size: 12 })),
          when({ falsy: "desktop.oneKey" }, row([meta("Change these keys in Settings.", { size: 12 }), grow(),
            quietButton("Open Settings", open(ctx.desk.pages ? "desk_settings" : "settings"), { size: "md" })], { gap: 8 })),
        ]),
        deskCard("Languages", d ? [
          row([...langChips, row([text("+ Add a language", { size: 13, color: C.meta, lineHeight: 17 })], {
            paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline, borderStyle: "dashed",
          }, open(SCREENS.language))], { gap: 6, flexWrap: "wrap", paddingTop: 2, paddingBottom: 4 }),
          meta("Keylessbord hears and writes these, and switches mid-sentence, like you do.", { size: 12 }),
        ] : [couldntLoad("your languages")]),
      ], [
        deskCard("Pill", [
          pillPreview,
          deskToggle("Show the pill", "pill", "By your text cursor while Keylessbord listens"),
          deskToggle("Show the words as I speak", "live", "A line of what it heard, as you say it"),
        ]),
        deskCard("Listening", [
          deskToggle("Write while I pause", "pauseFlush", "Each pause puts in what you said so far"),
          deskToggle("Start with the computer", "autoStart", "Ready when you sign in"),
        ]),
      ], { gap: 14 }),
    ],
  });
}
