/**
 * What several of the Keybot's screens share.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { box, icon, C, text, row, col, when, grow } from "../../kit.js";
import { CLAY, kbd } from "../keybotParts.js";

/** The phone's mic key is tapped (on, then off); the computer's key is held. */
export const speakVerb = (desk: boolean): string => (desk ? "Hold" : "Tap");

/** A Mac's bottom row and a PC's, [label, width]; the one key's place in each by its id (desktop.oneKey, main.js oneKey.js). */
const MAC_ROW: Array<[string, number]> = [["fn", 1], ["control", 1.05], ["option", 1], ["command", 1.3], ["", 4.4], ["command", 1.3], ["option", 1]];
const PC_ROW: Array<[string, number]> = [["ctrl", 1.2], ["win", 1], ["alt", 1.1], ["", 4.6], ["alt", 1.1], ["ctrl", 1.2]];
const KEY_AT: Array<{ id: string; row: Array<[string, number]>; at: number }> = [
  { id: "rightCommand", row: MAC_ROW, at: 5 }, { id: "rightOption", row: MAC_ROW, at: 6 },
  { id: "rightCtrl", row: PC_ROW, at: 5 }, { id: "rightAlt", row: PC_ROW, at: 4 },
];

/** The laptop's bottom row, the Keylessbord key in clay where the chosen key is, named as this computer has it bound. A window
 *  from before the one key (no desktop.oneKey), or Fn: the Mac's row with Fn in clay. */
export function laptopKeys(): Node {
  const k = (f: number, label: string, clay: boolean): Node => box([
    ...(clay ? [icon("mic", { size: 13, color: C.paper })] : []),
    text(label, { size: clay ? 10.5 : 10, weight: clay ? 600 : 400, color: clay ? C.paper : C.meta, lineHeight: 13, ...(clay ? { bind: "desktop.holdKey" } : {}) }),
  ], { flexGrow: f, flexBasis: 0, height: 42, borderRadius: 7, backgroundColor: clay ? CLAY : C.paper, alignItems: "center", justifyContent: "center", gap: 2, minWidth: 0 });
  const keys = (r: Array<[string, number]>, at: number): Node =>
    row(r.map(([label, f], i) => k(f, label, i === at)), { gap: 5, padding: 9, borderRadius: 14, backgroundColor: C.surface });
  return col([
    ...KEY_AT.map((x) => when({ eq: ["desktop.oneKey", x.id] }, keys(x.row, x.at))),
    when({ not: { in: ["desktop.oneKey", KEY_AT.map((x) => x.id)] } }, keys(MAC_ROW, 0)),
  ], { gap: 0 });
}

/** This computer's key, as main.js has it bound (desktop state): one line. The one key is held (desktop.hold, its name in
 *  desktop.holdKey); a window from before it names the chord it presses. */
export function keyList(): Node {
  const line = (label: string, key: string, bind: string) => row([text(label, { size: 13, lineHeight: 18 }), grow(), kbd(key, bind)], { gap: 10, paddingVertical: 6 });
  return col([
    when({ truthy: "desktop.hold" }, line("Hold to talk, tap to keep listening", "Fn", "desktop.holdKey")),
    when({ falsy: "desktop.hold" }, line("Press to talk", "Ctrl+Space", "desktop.hotkey")),
  ], { gap: 0 });
}
