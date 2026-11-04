/**
 * The first run's language screen.
 */

import type { Node, Condition, ScreenResponse, ActionRef, ActionSpec } from "../../../../../../shared/types/sdui.js";
import {
  row, when, icon, C, text, type BotsCtx, call, seq, botLook, box, botAvatar, col, sectionLabel, grow, meta, divider, button,
  primaryButton,
} from "../../kit.js";
import {
  saved, back, toast, W, deskFrame, signedInAs, deskBlip, deskHeading, deskFoot, deskBack, phoneFrame, phoneBackLine, phoneHeading,
} from "./parts.js";

// ===================================================================== Languages

/** GET /v1/bots/first-run/languages. */
export interface Langs { options: Array<{ value: string; label: string }>; picked: string[]; saved?: boolean }

/** When the list cannot be read: the boards' own, every one a code the onboarding saves. */
const FALLBACK_LANGS: Langs["options"] = [
  ["hinglish", "Hinglish"], ["hi", "Hindi"], ["en", "English"], ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"],
  ["bn", "Bengali"], ["gu", "Gujarati"], ["kn", "Kannada"], ["ml", "Malayalam"], ["pa", "Punjabi"],
].map(([value, label]) => ({ value: value!, label: label! }));

/** A language chip: picked is ink with a tick, the rest outline. Toggles the language in `langs` (never to none). */
function langChip(l: { value: string; label: string }, desk: boolean): Node {
  const on: Condition = { contains: ["langs", l.value] };
  const c = (then: string, otherwise: string) => ({ ...on, then, else: otherwise });
  return row([
    when(on, icon("check", { size: 14, color: C.paper, weight: 2 })),
    text(l.label, { size: desk ? 14 : 13, weight: 500, lineHeight: 17, style: { color: c(C.paper, C.ink) } }),
  ], {
    gap: 6, paddingVertical: desk ? 0 : 9, height: desk ? 40 : undefined, paddingHorizontal: 14, borderRadius: desk ? 20 : 18, borderWidth: 1,
    borderColor: c(C.ink, C.outline), backgroundColor: c(C.ink, C.paper),
  }, { kind: "toggleInArray", path: "langs", value: l.value, min: 1 });
}

export function language(ctx: BotsCtx, data: Langs | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const options = data?.options?.length ? data.options : FALLBACK_LANGS;
  const picked = data?.picked?.length ? data.picked : ["hinglish", "hi", "en"];
  // Reached from You (and Keylessbord's settings): saved, and back to where it was opened from.
  const next = call("PUT", "/v1/personality", { languages: "$state.langs" }, { ok: seq(saved("Saved"), back), fail: toast(W.saveErr) });
  const cont: ActionRef = { kind: "condition", if: { truthy: "langs" }, then: next, else: toast("Pick at least one language.") } as ActionSpec;
  const chips = row(options.map((l) => langChip(l, desk)), { gap: 8, flexWrap: "wrap" });
  const keybot = botLook("keybot");
  const state = { langs: picked };
  const sample = (label: string, line: string, strong: boolean): Node => row([
    box([text(label, { size: 12, weight: strong ? 600 : 400, color: strong ? C.ink : C.meta, lineHeight: 16 })], { width: 96, flexShrink: 0 }),
    text(line, { size: 15, lineHeight: 22, style: { flexShrink: 1, minWidth: 0 } }),
  ], { gap: 14, alignItems: "flex-start", paddingVertical: 11, paddingHorizontal: 16 });

  if (desk) {
    return deskFrame(ctx, {
      title: "Your languages", right: signedInAs(ctx), state,
      left: [
        deskBlip("hello", 150),
        deskHeading("Language", W.langH, W.langP),
        row([botAvatar(keybot, 30), text(W.langMix, { size: 14, lineHeight: 20, color: C.grey70, style: { flexShrink: 1 } })], { gap: 12, maxWidth: 400 }),
      ],
      main: [
        col([row([sectionLabel("Languages"), grow(), meta("Pick all that fit", { size: 12 })], { gap: 10 }), chips], {
          padding: 16, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line,
        }),
        col([
          row([sectionLabel("Live sample"), grow(), meta("One thing, said three ways", { size: 12 })], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 4, gap: 10 }),
          sample("Hinglish", "Aaj 6 baje tak report bhej dena, phir chai pe milte hain.", true), divider(),
          sample("Hindi", "आज 6 बजे तक रिपोर्ट भेज देना, फिर चाय पे मिलते हैं।", false), divider(),
          sample("English", "Send the report by 6 today, then let's meet over chai.", false), divider(),
          box([meta("Said in one breath. Written the way you'd type it, no switching keyboards.", { size: 13, lineHeight: 18 })], { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 14 }),
        ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ],
      foot: deskFoot(deskBack(), [button("Save", cont, { size: "lg" })]),
    });
  }
  return phoneFrame(ctx, {
    title: "Your languages", state, gap: 20,
    body: [
      phoneBackLine(),
      phoneHeading(W.langH, W.langP),
      col([row([sectionLabel("Languages"), grow(), meta("Pick all that fit", { size: 12 })]), chips], { gap: 10 }),
      row([botAvatar(keybot, 30), text(W.langMix, { size: 15, lineHeight: 21, style: { flexShrink: 1 } })], { gap: 12 }),
      col([
        row([sectionLabel("Live sample"), grow(), row([icon("mic", { size: 14, color: C.meta }), meta("Hinglish", { size: 12 })], { gap: 6 })]),
        text("Aaj 6 baje tak report bhej dena, phir chai pe milte hain.", { size: 17, lineHeight: 25 }),
        meta("Said in one breath. Written the way you'd type it, no switching keyboards.", { size: 12, lineHeight: 17 }),
      ], { paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    ],
    footer: [primaryButton("Save", cont, { wide: true })],
  });
}
