/**
 * The Try it step.
 */

import type { Node, Condition } from "../../../../shared/types/sdui.js";
import { type ObKey, EN } from "./copy.js";
import { type Plan, TXT, OB, HD, H, P, LAB, IF, FROM, toast, ICON, FINE, PUSH, BTN, SET } from "./kit.js";

export function tryStep(p: Plan): Node {
  const idle: Condition = { eq: ["mic", "idle"] };
  const caption = (k: ObKey, show: Condition): Node =>
    ({ ...TXT(EN[k], { fontSize: 14.5, fontWeight: "600", color: OB.ink2, textAlign: "center" }), visibleIf: show });
  const untried: Condition = { falsy: "tried" };
  const tried: Condition = { truthy: "tried" };
  return p.step("try", [
    HD(
      { ...p.spot("present", 96, "s4.say"), visibleIf: { all: [idle, untried] } },
      { ...p.spot("listen", 96, "s4.say1"), visibleIf: { in: ["mic", ["recording", "busy"]] } },
      { ...p.spot("tada", 96, "s4.say2", "side", { burst: true }), visibleIf: { all: [idle, tried] } },
    ),
    H("s4.h"),
    P("s4.p"),
    p.desktop
      ? {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
          children: [
            TXT(EN["s4.keys.d"], { fontSize: 14, color: OB.ink2 }),
            { type: "Keys", props: { source: "hotkey", cls: "d-keys-small" } },
          ],
        }
      : null,
    {
      type: "Stack",
      style: { gap: 8, marginVertical: 4 },
      children: [
        {
          type: "Stack",
          style: { borderRadius: 16, padding: 11, borderWidth: 1.5, borderColor: OB.hair, backgroundColor: OB.surf },
          children: [LAB("s4.you"), TXT(EN["s4.ex"], { fontSize: 16, fontStyle: "italic", color: OB.ink2 })],
        },
        {
          type: "Stack",
          style: {
            borderRadius: 16, padding: 11, minHeight: 70, borderWidth: 1.5, borderColor: OB.ink,
            backgroundColor: IF(tried, OB.neonSoft, OB.white),
          },
          children: [
            LAB("s4.me"),
            { ...TXT("• • •", { fontSize: 18, letterSpacing: 3.6, color: OB.ti2 }), visibleIf: untried },
            { ...FROM("tried", { fontSize: 17, lineHeight: 22, fontWeight: "600", color: OB.ink }), visibleIf: tried },
          ],
        },
      ],
    },
    {
      type: "Stack",
      style: { alignItems: "center", gap: 8, marginTop: 6 },
      children: [
        {
          type: "Stack",
          style: {
            width: 96, height: 96, borderRadius: 48, borderWidth: 2, alignItems: "center", justifyContent: "center",
            borderColor: IF({ eq: ["mic", "recording"] }, OB.neon, "transparent"),
          },
          children: [{
            type: "VoiceButton",
            bind: { value: "tried", state: "mic" },
            // Hold to speak, release to stop; the glyph is ours, drawn in place of a label.
            props: { hold: true, size: 88, radius: 44, background: OB.ink, recordingBackground: OB.ink, label: "", stopLabel: "", transcribingLabel: "" },
            style: { width: 88, height: 88, paddingVertical: 0, alignItems: "center", justifyContent: "center" },
            on: { onError: toast(EN["s4.err"], "error") },
            children: [ICON("mic", 38, OB.surf)],
          }],
        },
        caption("s4.hold", { all: [idle, untried] }),
        caption("s4.live", { eq: ["mic", "recording"] }),
        caption("s4.busy", { eq: ["mic", "busy"] }),
        caption("s4.again", { all: [idle, tried] }),
      ],
    },
    { ...FINE("s4.ok", true), visibleIf: tried },
    PUSH(),
    BTN(EN["ob.cont"], SET(p.next("try"))),
  ]);
}
