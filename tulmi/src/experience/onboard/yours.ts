/**
 * The Make me yours step: the permissions that make it the person's own.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import { EN } from "./copy.js";
import { IC, type Style, OB, ICON, TXT, type Plan, bothPerms, FINE, HD, H, P, PUSH, BTN, SET } from "./kit.js";

/** One row of Make me yours: the glyph, what it is for, and a switch. */
function permRow(icon: keyof typeof IC, title: string, why: string, path: string, action: string, extra: Style = {}): Node {
  return {
    type: "Stack",
    style: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: OB.hair, ...extra },
    children: [
      {
        type: "Stack",
        style: { width: 38, height: 38, borderRadius: 11, backgroundColor: OB.card, borderWidth: 1.5, borderColor: OB.hair, alignItems: "center", justifyContent: "center" },
        children: [ICON(icon, 20, OB.ink)],
      },
      {
        type: "Stack",
        style: { flex: 1 },
        children: [
          TXT(title, { fontSize: 15.5, fontWeight: "700", color: OB.ink }),
          TXT(why, { fontSize: 13, lineHeight: 17, color: OB.ink2 }),
        ],
      },
      { type: "Switch", bind: { value: path }, props: { onColor: OB.ink, offColor: OB.ti3 }, on: { onChange: action } },
    ],
  };
}

/**
 * Make me yours (phone only): Notifications and Microphone, with one switch for
 * both. It asks for exactly what a feature uses today (approval pushes open the
 * approval screen; the mic is the mic). Contacts and Calendar are not here:
 * nothing in the product uses either, so asking would be a promise with nothing
 * behind it. A row comes back as a deploy once a feature needs it.
 */
export function yoursStep(p: Plan): Node {
  const both = bothPerms;
  const foot = FINE("s5.foot");
  foot.style = { ...foot.style, marginTop: 8 };
  return p.step("yours", [
    HD(
      { ...p.spot("pointd", 100, "s5.say"), visibleIf: { not: both } },
      { ...p.spot("thumbs", 100, "s5.say"), visibleIf: both },
    ),
    H("s5.h"),
    P("s5.p"),
    {
      type: "Stack",
      style: { backgroundColor: OB.surf, borderWidth: 1.5, borderColor: OB.ink, borderRadius: 20, overflow: "hidden" },
      children: [
        permRow("check", EN["s5.all"], EN["s5.allsub"], "perm.all", "allowBoth", { backgroundColor: OB.neonSoft }),
        permRow("bell", EN.pn, EN["pn.d"], "perm.n", "askPush"),
        permRow("mic", EN.pm, EN["pm.d"], "perm.m", "askMic"),
      ],
    },
    foot,
    PUSH(),
    BTN(EN["ob.cont"], SET(p.next("yours"))),
  ], { on: { onAppear: "checkPerms" } });
}
