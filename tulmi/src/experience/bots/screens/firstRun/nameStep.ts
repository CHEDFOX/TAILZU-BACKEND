/**
 * The first run's nameStep screen.
 */

import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { ASSISTANT_NAME } from "../../../assistantName.js";
import {
  call, seq, text, type BotsCtx, row, meta, C, botAvatar, botLook, col, sectionLabel, grow, box, divider, button, primaryButton,
} from "../../kit.js";
import {
  toast, type Figure, nameField, setState, gateStep, deskBody, signedInAs, deskFig, deskHeading, STEPS, W, deskFoot, phoneStepBody,
  phoneTop, phoneHeading,
} from "./parts.js";

/** The end of the first run: onboarded, as the onboarding's Done marks it, and on to Bots. */
function finish(): ActionSpec {
  return call("PUT", "/v1/profile", { onboarded: true }, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, { kind: "switchTab", tabId: "bots" }),
    fail: toast("Couldn't finish setting up. Try again."),
  });
}

/** Text that follows a state path (Text bind.content), with `fallback` until it has a value. */
const bound = (path: string, fallback: string, o: Parameters<typeof text>[1] = {}): Node => text(fallback, { ...o, bind: path });

const NAME_IDEAS = ["Tara", "Mitra", "Chotu", "Jarvis"];

/** What will you call me? The boss bot's name (X0 unless they pick their own); saving it finishes onboarding. */
export function nameStep(ctx: BotsCtx, fig: Figure): Node {
  const desk = ctx.client === "desktop";
  const save = call("PUT", "/v1/personality", { assistantName: "$state.name" }, {
    ok: finish(),
    fail: toast("A name is letters and spaces, up to 24 characters."),
  });
  const fieldBox = nameField("name", ASSISTANT_NAME, save, desk, { label: "name" });
  const ideas = row([
    meta("Or try", { size: desk ? 13 : 12, style: { marginRight: 2 } }),
    ...NAME_IDEAS.map((n) => row([text(n, { size: desk ? 14 : 13, lineHeight: 17 })], {
      paddingVertical: desk ? 0 : 8, height: desk ? 40 : undefined, paddingHorizontal: desk ? 16 : 14, borderRadius: desk ? 20 : 18, borderWidth: 1, borderColor: C.outline,
    }, setState("name", n))),
  ], { gap: 8, flexWrap: "wrap", paddingTop: desk ? 0 : 4 });
  /** A bot reporting to the one in charge, by the name being typed. */
  const says = (slug: string, line: string, who: string): Node => row([
    botAvatar(botLook(slug), 30),
    col([
      bound("name", ASSISTANT_NAME, { size: desk ? 15 : 14, weight: 600, lineHeight: desk ? 22 : 20 }),
      text(line, { size: desk ? 15 : 14, lineHeight: desk ? 22 : 20 }),
      meta(who, { size: 12 }),
    ], { gap: 2, flexShrink: 1, minWidth: 0 }),
  ], { gap: desk ? 12 : 10, alignItems: "flex-start" });

  if (desk) {
    const heads = ctx.live.bots.slice(0, 4);
    return gateStep(true, deskBody({
      title: "What will you call me?", right: signedInAs(ctx), current: 2,
      left: [
        deskFig(fig, "tada", 140),
        deskHeading(`Step 2 of ${STEPS.length - 1}`, W.nameH, W.nameP),
        ...(heads.length ? [row([
          row(heads.map((b) => botAvatar(b, 22)), { gap: 4 }),
          meta(`${heads.length === 1 ? "1 bot" : `${heads.length} bots`} will report to this name`, { size: 13 }),
        ], { gap: 10, maxWidth: 400 })] : []),
      ],
      main: [
        col([
          col([text("Name", { size: 13, weight: 500, lineHeight: 17 }), fieldBox, meta("You can change it any time in Settings.", { size: 12 })], { gap: 6 }),
          ideas,
        ], { padding: 16, gap: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
        col([
          row([sectionLabel("How your bots will say it"), grow(), meta("Updates as you type", { size: 12 })], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 2, gap: 10 }),
          box([says("plan", "the dentist can do Friday 10 am. Should I book it?", "Plan Ease, reporting to the one in charge")], { paddingVertical: 14, paddingHorizontal: 16 }),
          divider(),
          box([says("travel", "the Goa refund is still with the airline. I'll ask again on Friday.", "Travel bot, in Activity")], { paddingVertical: 14, paddingHorizontal: 16 }),
        ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ],
      // A window's stage never steps back, so there is no Back here.
      foot: deskFoot(null, [button("That's my name", save, { size: "lg" })]),
    }), { props: { stepId: "name" } });
  }
  return gateStep(false, [phoneStepBody([
    phoneTop(2, 2, { back: setState("step", 0) }),
    row([fig("tada", 128)], { justifyContent: "center" }),
    phoneHeading(W.nameH, W.nameP),
    col([sectionLabel("Name"), fieldBox, ideas], { gap: 8 }),
    col([sectionLabel("How your bots will say it"), says("plan", "the dentist can do Friday 10 am. Should I book it?", "Plan Ease, reporting to the one in charge")], {
      backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10,
    }),
  ], [primaryButton("That's my name", save, { wide: true })])], { props: { stepId: "name" } });
}
