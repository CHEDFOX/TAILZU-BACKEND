/**
 * FOLLOW-THROUGH'S REAL PHONE CALL: THE PERSON'S OWN NUMBER (CHANNEL_PHONE_CALLS; botsBots/followPhone.ts, docs/follow-channels.md).
 * Server-drawn, phone and desktop alike, no new capability. Opened from What pings you's "X0 may call my phone if I miss something
 * important" (its "Set up your number" / "Your number for calls" / "Turn calls back on" row).
 *
 *   bots.plan.phone   their switch; their number: type it (none), call X0 once from it and type the 4-digit code shown here (pending:
 *                     that call proves this account only), confirmed, with Change and Remove (verified), or stopped by pressing 9 on a
 *                     call, with Turn calls back on (stopped); when calls never come
 *
 * The number is proved by the person calling X0, never by X0 calling them: X0 never calls a number nobody said yes from.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, C, SCREENS, call, col, emptyState, listCard, listRow, meta, notice, open, page, primaryButton, quietButton, row,
  secondaryButton, sectionLabel, seq, switchMark, text, when,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { PHONE, type PhoneView } from "../../../../botsBots/followPhone.js";
import { field, inputBox, isDesk, refresh, setState, toast } from "./parts.js";

const md = { size: "md" as const };

/** Their switch, saved as What pings you saves it. */
const switchSave: ActionRef = seq({ kind: "toggleState", path: "on" } as ActionSpec, {
  kind: "condition", if: { truthy: "on" },
  then: call("PUT", "/v1/you/settings", { notify: { phoneCall: true } }, { ok: seq(toast("X0 may call your phone"), refresh), fail: toast("Couldn't save that. Try again.", true) }),
  else: call("PUT", "/v1/you/settings", { notify: { phoneCall: false } }, { ok: seq(toast("No phone calls"), refresh), fail: toast("Couldn't save that. Try again.", true) }),
} as ActionSpec);

const put = (body: Record<string, unknown>, ok: string, fail: string): ActionRef => call("PUT", PHONE, body, {
  ok: seq(toast(ok), setState("num", ""), setState("change", false), refresh), fail: toast(fail, true),
});
const remove: ActionRef = call("DELETE", PHONE, {}, { ok: seq(toast("Number taken away"), setState("change", false), refresh), fail: toast("Couldn't do that. Try again.", true) });

/** Type their own mobile number, then Save (it waits for its proving call). */
function numberForm(): Node {
  const numberField = field("phone-num", "num", "Your mobile number, like 98765 43210");
  return col([
    sectionLabel("Your number"),
    inputBox([{ ...numberField, props: { ...numberField.props, maxLength: 20 } }]),
    row([primaryButton("Save", {
      kind: "condition", if: { falsy: "num" }, then: toast("Type your number first"),
      else: put({ phone: "$state.num" }, "Now call X0 once from it", "Use your own mobile number, starting +91."),
    } as ActionSpec, md)], { gap: 8 }),
    meta("Only your own phone. You'll call X0 once from it to show it's yours.", { size: 12 }),
  ], { gap: 8 });
}

function stateBlock(ctx: BotsCtx, v: PhoneView): Node[] {
  switch (v.state) {
    case "none": return [numberForm()];
    case "pending": {
      const to = v.callTo;
      return [
        col([
          text(to ? `Now call ${to.display} once from ${v.display}.` : `Now call X0 once from ${v.display}.`, { size: 16, weight: 600, lineHeight: 22 }),
          ...(v.code ? [text(`When X0 answers, type ${v.code}`, { size: 20, weight: 700, lineHeight: 26 })] : []),
          meta(v.code ? "That sets up calls for this account only. The code works for 30 minutes." : "Add your number again to get a code.", { size: 13, lineHeight: 18 }),
          row([
            ...(to && !isDesk(ctx) ? [primaryButton("Call X0", { kind: "phone", number: to.number } as ActionSpec, md)] : []),
            secondaryButton("I've called", refresh, md),
            quietButton("Use another number", remove, md),
          ], { gap: 8, flexWrap: "wrap" }),
          ...(isDesk(ctx) ? [meta("Call from your phone, not this computer.", { size: 12 })] : []),
        ], { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
      ];
    }
    case "verified": return [
      listCard([listRow({ label: v.display, sub: "Confirmed. X0 calls only this number." })], { title: "Your number" }),
      row([quietButton("Change number", setState("change", true), md), quietButton("Remove number", remove, md)], { gap: 8, flexWrap: "wrap" }),
      when({ truthy: "change" }, numberForm()),
    ];
    case "stopped": return [
      notice(`You pressed 9 on a call, so X0 stopped calling ${v.display || "your phone"}.`),
      row([
        primaryButton("Turn calls back on", put({ again: true }, "Now call X0 once to confirm", "Couldn't do that. Try again."), md),
        quietButton("Remove number", remove, md),
      ], { gap: 8, flexWrap: "wrap" }),
      meta("You'll call X0 once more from that phone to confirm.", { size: 12 }),
    ];
  }
}

export function phonePage(ctx: BotsCtx, v: PhoneView | undefined) {
  const shell = { back: true, ...(isDesk(ctx) ? { backTitle: "What pings you" } : {}), nav: "settings", title: "Calls to your phone", maxWidth: 560, gap: 18 };
  if (!v) {
    return page(ctx, { ...shell, body: [emptyState({ pose: "think", title: "Couldn't load this", body: "Check the connection and try again.", action: { label: "Try again", onPress: refresh } })] });
  }
  const head = col([
    text("Calls to your phone", { size: 22, weight: 700, lineHeight: 28 }),
    meta("If you miss something important, X0 can call your phone. Press 1 for done, 2 for later, 3 if you can't, or 9 to stop the calls.", { size: 13, lineHeight: 18 }),
  ], { gap: 4 });
  if (!v.ready) {
    return page(ctx, { ...shell, body: [head, emptyState({ pose: "think", title: "Not here yet", body: "Phone calls aren't switched on yet. Notifications and X0 calls in the app still work.", action: { label: "Back to What pings you", onPress: open(SCREENS.notify) } })] });
  }
  return page(ctx, {
    ...shell, state: { on: v.on, num: "", change: false },
    body: [
      head,
      listCard([listRow({
        label: "X0 may call my phone if I miss something important",
        sub: v.state === "verified" ? "Only for must-not-miss reminders" : v.state === "pending" ? "Confirm your number too" : v.state === "stopped" ? "Turn calls back on below too" : "Add and confirm your number too",
        right: switchMark("on"), chevron: false, onPress: switchSave,
      })]),
      ...stateBlock(ctx, v),
      col([
        meta(v.quiet, { size: 12, lineHeight: 17 }),
        meta("A few calls a day at most, and they count toward your louder pings.", { size: 12, lineHeight: 17 }),
      ], { gap: 4 }),
    ],
  });
}

export const followPhoneScreens: BotsScreen[] = [
  screen<PhoneView | undefined>({
    id: SCREENS.planPhone,
    load: async (_ctx, deps) => deps.api<PhoneView>("GET", PHONE).catch(() => undefined),
    build: phonePage,
  }),
];
