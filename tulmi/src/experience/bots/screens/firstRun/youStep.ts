/**
 * The first run's youStep screen.
 */

import type { Node, Condition, ActionSpec } from "../../../../../../shared/types/sdui.js";
import { row, labelled, when, icon, C, text, type BotsCtx, call, seq, button, col, meta, sectionLabel } from "../../kit.js";
import {
  GENDERS, setState, type Me, type Figure, back, toast, W, nameField, gateStep, deskBody, signedInAs, deskFig, deskHeading, STEPS,
  deskFoot, phoneStepBody, phoneTop, phoneHeading,
} from "./parts.js";

/** The name and gender card's three choices, as chips: picked is ink with a tick. */
function genderChips(desk: boolean): Node {
  return row(GENDERS.map((g) => {
    const on: Condition = { eq: ["gender", g.value] };
    const c = (then: string, otherwise: string) => ({ ...on, then, else: otherwise });
    return labelled(row([
      when(on, icon("check", { size: 14, color: C.paper, weight: 2 })),
      text(g.label, { size: desk ? 14 : 15, weight: 500, lineHeight: 19, style: { color: c(C.paper, C.ink) } }),
    ], {
      gap: 6, height: desk ? 44 : 48, paddingHorizontal: 18, borderRadius: desk ? 22 : 24, borderWidth: 1, justifyContent: "center",
      borderColor: c(C.ink, C.outline), backgroundColor: c(C.ink, C.paper), flexGrow: desk ? 0 : 1, flexBasis: desk ? "auto" : 0,
    }, setState("gender", g.value)), g.label);
  }), { gap: 8 });
}

/** Where the name in the field came from, said under it: nothing for one the person typed or saved. */
function nameSource(me: Me | undefined): string | null {
  if (!me?.name || me.source === "saved" || !me.source) return null;
  if (me.source === "email") return "Guessed from your email. Change it if it's wrong.";
  const who = me.via === "apple" ? "Apple" : me.via === "google" ? "Google" : "sign-in";
  return `From your ${who} account. Change it if you like.`;
}

/**
 * About you: the person's own name and gender, the name and gender card's question, saved where it saves them.
 * `only`: the whole screen for someone onboarded before the first run asked it (the bootstrap's promptScreenId, in
 * place of the native card): no steps around it, and saving closes it instead of going on to Name.
 */
export function youStep(ctx: BotsCtx, fig: Figure, me: Me | undefined, only = false): Node {
  const desk = ctx.client === "desktop";
  // The name is filled in for everyone (what Apple or Google shared, saved by the app's AuthGateScreen, else a guess from the email:
  // startingName), so signing in with Apple asks no one to type it (App Review 4); it is theirs to change, and needed, with the pick.
  const save: ActionSpec = {
    kind: "condition", if: { all: [{ truthy: "fullName" }, { truthy: "gender" }] },
    // PUT /v1/profile { full_name, gender }: the card's own write, so everything that reads them (the bootstrap's
    // profile.complete, the greeting, the prompt) keeps working, and the card is never asked again.
    then: call("PUT", "/v1/profile", { full_name: "$state.fullName", gender: "$state.gender" }, {
      ok: only
        ? seq({ kind: "haptic", style: "success" } as ActionSpec, { kind: "refresh" } as ActionSpec, back)
        : seq({ kind: "haptic", style: "selection" } as ActionSpec, setState("step", 1)),
      fail: toast(W.saveErr),
    }),
    else: toast(W.youMissing),
  } as ActionSpec;
  const field = nameField("fullName", "Your name", save, desk, { capitalize: true, label: "your name" });
  const source = nameSource(me);
  const cont = button("Continue", save, { size: "lg", wide: !desk });

  if (desk) {
    return gateStep(true, deskBody({
      title: "About you", right: signedInAs(ctx), current: only ? null : 1,
      left: [
        deskFig(fig, "present", 140),
        deskHeading(only ? "About you" : `Step 1 of ${STEPS.length - 1}`, W.youH, W.youP),
      ],
      main: [col([
        col([text("Your name", { size: 13, weight: 500, lineHeight: 17 }), field, ...(source ? [meta(source, { size: 12 })] : [])], { gap: 6 }),
        col([text(W.youGender, { size: 13, weight: 500, lineHeight: 17 }), genderChips(true)], { gap: 8 }),
      ], { padding: 20, gap: 18, borderRadius: 18, borderWidth: 1, borderColor: C.line })],
      foot: deskFoot(null, [cont]),
    }), { props: { stepId: "you" } });
  }
  return gateStep(false, [phoneStepBody([
    only ? phoneTop(1, 1, { back }) : phoneTop(1, 2),
    row([fig("present", 116)], { justifyContent: "center" }),
    phoneHeading(W.youH, W.youP),
    col([sectionLabel("Your name"), field, ...(source ? [meta(source, { size: 12 })] : [])], { gap: 8 }),
    col([sectionLabel(W.youGender), genderChips(false)], { gap: 8 }),
  ], [cont])], { props: { stepId: "you" } });
}
