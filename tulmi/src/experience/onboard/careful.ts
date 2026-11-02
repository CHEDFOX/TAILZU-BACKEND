/**
 * The How careful step: how connected apps ask before they act.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import { type ObKey, EN } from "./copy.js";
import { TXT, OB, IC, ICON, type Plan, HD, H, P, FINE, PUSH, BTN, SET } from "./kit.js";

/** How the three flow pills read: the second one lit, a "›" between. */
function flow(line: string): Node {
  const parts = line.split("|");
  const out: Node[] = [];
  parts.forEach((part, i) => {
    if (i) out.push(TXT("›", { fontSize: 12, color: OB.ti1 }));
    out.push({
      type: "Stack",
      style: {
        paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: i === 1 ? OB.neonSoft : OB.card,
        borderWidth: 1, borderColor: i === 1 ? OB.neonLine : OB.hair,
      },
      children: [TXT(part, { fontSize: 12, fontWeight: "600", color: OB.ink })],
    });
  });
  return { type: "Stack", style: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }, children: out };
}

/** One of the three rules, as a card. The cards explain; they are not pressable. */
function careCard(icon: keyof typeof IC, h: ObKey, body: ObKey, f: ObKey, strong: boolean): Node {
  return {
    type: "Stack",
    style: {
      flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, marginBottom: 10, backgroundColor: strong ? OB.white : OB.surf,
      borderWidth: 1.5, borderColor: strong ? OB.ink : OB.hair,
    },
    children: [
      {
        type: "Stack",
        style: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: OB.ink, alignItems: "center", justifyContent: "center" },
        children: [ICON(icon, 13, OB.ink)],
      },
      {
        type: "Stack",
        style: { flex: 1 },
        children: [
          TXT(EN[h], { fontSize: 17, fontWeight: "700", color: OB.ink }),
          TXT(EN[body], { fontSize: 14, lineHeight: 19, color: OB.ink2, marginTop: 3, marginBottom: 8 }),
          flow(EN[f]),
        ],
      },
    ],
  };
}

export function carefulStep(p: Plan): Node {
  return p.step("careful", [
    HD(p.spot("think", 100, "s7.say")),
    H("s7.h"),
    P("s7.p"),
    careCard("eye", "c1.h", "c1.p", "c1.f", false),
    careCard("check", "c2.h", "c2.p", "c2.f", true),
    careCard("lock", "c3.h", "c3.p", "c3.f", false),
    FINE("s7.foot"),
    PUSH(),
    BTN(EN["s7.cta"], SET(p.I.done!)),
  ]);
}
