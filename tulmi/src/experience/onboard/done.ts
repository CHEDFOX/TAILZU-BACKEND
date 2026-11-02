/**
 * The Done step.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import { EN } from "./copy.js";
import { type Plan, C1, H, P, OB, ICON, TXT, PUSH, BTN, FINE } from "./kit.js";

export function doneStep(p: Plan): Node {
  return p.step("done", [
    C1(p.spot("tada", 190, "s8.say", "corner", { burst: true })),
    H("s8.h", true),
    P(p.desktop ? "s8.p.d" : "s8.p", { textAlign: "center", paddingHorizontal: 6 }),
    {
      type: "Stack",
      style: {
        flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: OB.white, borderWidth: 1.5, borderColor: OB.ink,
        borderRadius: 16, padding: 12, marginTop: 4,
      },
      children: [ICON("mic", 20, OB.ink), TXT(EN[p.appsOn ? "s8.try" : "s8.try0"], { flex: 1, fontSize: 15, lineHeight: 20, color: OB.ink })],
    },
    PUSH(),
    BTN(EN["s8.cta"], "finish"),
    FINE(p.appsOn ? "s8.fine" : "s8.fine0", true),
  ]);
}
