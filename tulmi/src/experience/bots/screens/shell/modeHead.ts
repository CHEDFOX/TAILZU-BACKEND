/**
 * TALK AND XODE, ONE SWITCH (the owner: "the talk and xode switch should stay throughout to change anytime").
 *
 * Talk and Xode are two sides of one place, so the switch between them is the same row in the same spot on both: the mark, the
 * two pills, and the person's quiet buttons on the right. It used to be drawn on Talk only, and its Xode pill was an ordinary
 * navigate: Xode landed ON TOP of Talk with no switch of its own, and its back arrow went "out of Xode" to the Bots page, so
 * the way back to Talk was a walk through screens the person never meant to visit.
 *
 * Switching SWAPS the two, never stacks them:
 *   - Talk → Xode: Xode as a place of its own (`root`: the window starts it afresh; `replace` for every build before root, so
 *     Xode takes Talk's place instead of going on top of it);
 *   - Xode → Talk: the Talk tab (switchTab), which every build answers with Talk alone on the stack.
 * Back on either is therefore never a way to the other, nor to Bots.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, SCREENS, appMark, grow, open, pillSwitch, roundButton, row, toTab } from "../../kit.js";

export type Mode = "talk" | "code";

/** To Xode, in Talk's place. */
export const toXode: ActionSpec = { kind: "navigate", screenId: SCREENS.code, root: true, replace: true };
/** To Talk, alone on the stack. */
export const toTalk: ActionSpec = toTab("talk");

/** The two pills, `here` the one you are on. */
export function modeSwitch(here: Mode): Node {
  return pillSwitch([
    { label: "Talk", here: here === "talk", onPress: toTalk, label2: here === "talk" ? "Talk, where you are" : "Talk" },
    // Xode keeps its own page: a project, a branch and a job are a place, not a message.
    { label: "Xode", here: here === "code", onPress: toXode, label2: here === "code" ? "Xode, where you are" : "Xode, your code" },
  // A little clear of the mark: against it the track read as one lump with the logo.
  ], { marginLeft: 8 });
}

/**
 * THE HEAD both pages open with: the mark (the way to your people and spaces), the switch, and on the right the quiet buttons —
 * Talk's conversations on Talk only, search and you on both — so the switch stands in exactly the same place on either side.
 */
export function modeHead(ctx: BotsCtx, here: Mode): Node {
  const desk = ctx.client === "desktop";
  const working = ctx.live.bots.filter((b) => b.working).map((b) => b.color);
  const quiet = (glyph: "search" | "person" | "balloons", onPress: ActionRef, label: string) => roundButton(glyph, onPress, { size: desk ? 36 : 34, light: true, label });
  return row([
    appMark(ctx, desk ? 34 : 30, working),
    modeSwitch(here),
    grow(),
    // THE WAY TO THE OTHER CONVERSATIONS (screens/bots/talkThreads.ts): Talk's own.
    ...(here === "talk" ? [quiet("balloons", open(SCREENS.talkThreads), "Your conversations")] : []),
    quiet("search", open(SCREENS.search), "Search everything"),
    quiet("person", open(SCREENS.you), "Profile and settings"),
  ], { gap: 10, alignItems: "center", paddingBottom: desk ? 8 : 10 });
}
