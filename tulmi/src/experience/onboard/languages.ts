/**
 * The Languages step.
 */

import type { Node, Condition, ActionSpec } from "../../../../shared/types/sdui.js";
import { DAILY_LANGUAGES } from "../phone/languages.js";
import { moreLanguages, fillSlots, EN, shownChip } from "./copy.js";
import { seq, haptic, IF, OB, ICON, FROM, type Plan, TXT, HD, H, P, FINE, PUSH, BTN, SET, when } from "./kit.js";

function languageChip(l: (typeof DAILY_LANGUAGES)[number]): Node {
  const picked: Condition = { contains: ["langs", l.value] };
  const save = (): ActionSpec => ({ kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" } });
  return {
    type: "Stack",
    props: { pressOpacity: 0.7 },
    on: { onPress: seq(haptic("selection"), { kind: "toggleInArray", path: "langs", value: l.value }, save()) },
    style: {
      height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1.5, flexDirection: "row", alignItems: "center", gap: 6,
      borderColor: IF(picked, OB.ink, OB.hair),
      backgroundColor: IF(picked, OB.neonSoft, OB.surf),
    },
    children: [
      { ...ICON("check", 15, OB.ink), visibleIf: picked },
      // A language's name is a proper noun: drawn from state, so it is never translated.
      FROM(`ln.${l.value}`, { fontSize: 14.5, fontWeight: "600", color: OB.ink }),
    ],
  };
}

export function languagesStep(p: Plan): Node {
  const rest = moreLanguages();
  const more: Node = {
    type: "Stack",
    props: { pressOpacity: 0.7 },
    on: { onPress: { kind: "navigate", screenId: "languages" } },
    style: {
      height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1.5, borderStyle: "dashed", borderColor: OB.ti1,
      backgroundColor: OB.surf, flexDirection: "row", alignItems: "center", gap: 6,
    },
    children: [TXT(fillSlots(EN["s2.more"], { n: rest }), { fontSize: 14.5, fontWeight: "600", color: OB.ink })],
  };
  return p.step("languages", [
    HD(p.spot("listen", 104, "s2.say")),
    H("s2.h"),
    P("s2.p"),
    {
      type: "Stack",
      style: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
      children: [...DAILY_LANGUAGES.filter(shownChip).map(languageChip), more],
    },
    FINE("s2.hint"),
    PUSH(),
    // Saved on Continue too, so a default nobody touched is still recorded.
    // Then the screen is asked for again: it is written in the first language
    // chosen here (onboardLanguage), which the server did not know until now.
    // The step moves first, and the stage remembers the furthest step it has
    // shown, so the new copy of the screen opens where the person already is.
    BTN(EN["ob.cont"], seq(
      { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { languages: "$state.langs" } },
      p.desktop
        ? SET(p.I.try!)
        : when({ truthy: "keyboardReady" }, SET(p.I.try!), SET(p.I.keyboard!)),
      { kind: "refresh" },
    )),
  ]);
}
