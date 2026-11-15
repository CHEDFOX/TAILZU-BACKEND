/**
 * SHARING YOUR PLAN, ON THE SCREENS (the plan-share spec §5.1, §5.2, §5.4; the data and the switch are in
 * experience/bots/planShare.ts).
 *
 *   sharingSection()   Plan and billing's new section: who is on your plan, each with Stop sharing behind the two-tap
 *                      confirm this repo already uses, and "Share with someone".
 *   onSomeonesPlan()   what Plan and billing leads with instead when you are on someone else's: whose, since when, the
 *                      month's bar, how much of it everyone has used and how much is yours, and the honest line.
 *   leaveButton()      "Leave Rahul's plan", two taps.
 *   askSomeoneButton() the refused screen's new way out, above "Get more with a plan" (ASK_ABOVE_BUY).
 *   planShareScreens   bots.plan.share: the people you share a space with, ticked. Two readings of one screen — picking
 *                      who to share with, and (params.ask) picking who to ask.
 *
 * NO MONEY ON ANY OF IT. "See plans and share" and "Get more with a plan" open bots.plans, the one screen allowed to
 * show a price; nothing here names an amount, and nothing says anything of another person's money (spec §8).
 *
 * One screen id serves the phone and the window, as everything else here does: the pieces below are the same nodes on
 * both, laid out by page()'s own client split.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, C, back, box, button, call, card, col, divider, emptyState, icon, listCard, listRow, meta, meter,
  open, page, primaryButton, quietButton, row, SCREENS, sectionLabel, seq, text, title, when,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { personMark } from "../spaces/parts.js";
import {
  ASK_ABOVE_BUY, ASK_PATH, ASK_SOMEONE_LABEL, LEAVE_PLAN_PATH, ONE_POT_LINE, PLAN_SHARE_API, SAME_MONTH_LINE,
  SPACES_ONLY_LINE, loadShare, stopSharingPath, usedThisMonth, type PlanShareOn, type PlanShareView,
} from "../../planShare.js";
import { local, oops, refresh, toast } from "./parts.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];
/** "3 November": the date a share started, written out, as the spec asks. */
const longDay = (ctx: BotsCtx, t: number): string => { const d = local(ctx, t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

const pct = (n: number): string => `${Math.max(0, Math.min(100, Math.round(n)))}%`;

// ===================================================================== bots.billing: sharing your plan

/**
 * Stop sharing with one person: two taps, the way Cancel plan and the rest of this repo ask twice before something
 * cannot be undone (you/notifyDesk.ts when2). The row itself is not pressable, so this button is the only thing on it
 * that presses.
 */
function stopSharing(name: string, memberId: string, path: string): Node {
  const sure: ActionSpec = {
    kind: "condition", if: { truthy: path },
    then: call("DELETE", stopSharingPath(memberId), undefined, {
      ok: seq(toast(`${name} is off your plan`), { kind: "setState", path, value: false }, refresh),
      fail: oops("stop sharing"),
    }),
    else: seq({ kind: "setState", path, value: true }, toast("Tap Stop sharing again to stop")),
  };
  return quietButton("Stop sharing", sure, { size: "md" });
}

/** The state Plan and billing needs for the two-tap confirms: one per person on the plan. */
export const sharingState = (share: PlanShareView | undefined): Record<string, unknown> => ({
  leaveSure: false,
  ...Object.fromEntries((share?.members ?? []).map((_m, i) => [`stop_${i}`, false])),
});

/**
 * "Sharing your plan": a row per person (their own little bot, their name, how much of this month they have used), then
 * "Share with someone", then the quiet line that says exactly what sharing is.
 *
 * Nothing at all while the switch is off, while the person has no plan of their own, or while they are on someone
 * else's — that last one is the card above instead.
 */
export function sharingSection(ctx: BotsCtx, share: PlanShareView | undefined): Node[] {
  if (!share || !share.canShare || share.on) return [];
  const rows: Node[] = [
    ...share.members.map((m, i) => listRow({
      left: personMark(ctx, { seed: m.userId }, 28),
      label: m.name,
      sub: usedThisMonth(m.usedPct),
      right: stopSharing(m.name, m.userId, `stop_${i}`),
      chevron: false,
    })),
    listRow({ left: icon("plus", { size: 18 }), label: "Share with someone", onPress: open(SCREENS.planShare) }),
  ];
  return [col([sectionLabel("Sharing your plan"), listCard(rows), meta(SAME_MONTH_LINE, { size: 12, lines: 2 })], { gap: 8 })];
}

// ===================================================================== bots.billing: you are on someone else's

/**
 * What the screen leads with when the person is on someone else's plan: whose plan it is, since when, the month as one
 * bar — there is one pot — what everyone on it has used and what of that is theirs, and the honest line underneath.
 */
export function onSomeonesPlan(ctx: BotsCtx, share: PlanShareView | undefined): Node[] {
  const on: PlanShareOn | undefined = share?.on;
  if (!on) return [];
  return [
    col([
      card([
        row([
          personMark(ctx, { seed: on.ownerId }, 40),
          col([
            text(`You are on ${on.name}'s ${on.planName}`, { size: 17, weight: 600, lineHeight: 23, lines: 2 }),
            meta(`Since ${longDay(ctx, on.since)}`, { size: 12 }),
          ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ], { gap: 12 }),
        divider(),
        col([
          text("This month", { size: 14, weight: 600, lineHeight: 19 }),
          meter(Math.max(0, Math.min(1, on.monthUsedPct / 100)), 1),
          meta(`${pct(on.monthUsedPct)} used by everyone on it. You used ${pct(on.myUsedPct)}.`, { size: 12, lines: 2 }),
        ], { gap: 8 }),
      ], { padding: 18, gap: 14 }),
      meta(ONE_POT_LINE, { size: 12, lines: 2 }),
    ], { gap: 8 }),
  ];
}

/** "Leave Rahul's plan": two taps, like Cancel plan. */
export function leaveButton(ctx: BotsCtx, share: PlanShareView | undefined, o: { wide?: boolean } = {}): Node[] {
  const on = share?.on;
  if (!on) return [];
  const sure: ActionSpec = {
    kind: "condition", if: { truthy: "leaveSure" },
    then: call("DELETE", LEAVE_PLAN_PATH, undefined, {
      ok: seq(toast(`You left ${on.name}'s plan`), { kind: "setState", path: "leaveSure", value: false }, refresh),
      fail: oops("leave the plan"),
    }),
    else: seq({ kind: "setState", path: "leaveSure", value: true }, toast(`Tap Leave ${on.name}'s plan again to leave`)),
  };
  const wide = o.wide ?? ctx.client !== "desktop";
  return [quietButton(`Leave ${on.name}'s plan`, sure, { wide, size: ctx.client === "desktop" ? "md" : "lg" })];
}

// ===================================================================== bots.usage: the refused screen's other way out

/**
 * Can this person ask someone? They have no plan of their own, they are not already on someone's, nobody is waiting on
 * an ask of theirs, and at least one person they share a space with has a plan. That last one is a yes/no about someone
 * else and is used for nothing but deciding whether to draw this button (spec §8).
 */
export const canAskForPlan = (share: PlanShareView | undefined): boolean =>
  !!share && !share.canShare && !share.on && !share.asked && share.people.some((p) => p.hasPlan);

/** "Ask someone to share theirs". It opens the list of people who have one; it never shows money. */
export const askSomeoneButton = (kind: "primary" | "secondary", o: { wide?: boolean; size?: "md" | "lg" } = {}): Node =>
  button(ASK_SOMEONE_LABEL, open(SCREENS.planShare, { ask: "1" }), { kind, wide: o.wide ?? true, ...(o.size ? { size: o.size } : {}) });

/**
 * THE WAYS OUT OF A REFUSAL (bots.usage), in the order ASK_ABOVE_BUY sets. Asking first, as the spec asks: flipping that
 * one constant in planShare.ts puts buying first on the phone and in the window at once, and nothing else changes.
 *
 * One primary per screen (STYLE.md), so whichever comes first is the primary and the other is the outline beside it.
 */
export function waysOut(o: { upgrade: boolean; ask: boolean; wide?: boolean; size?: "md" | "lg" }): Node[] {
  if (!o.ask) return o.upgrade ? [button("Get more with a plan", open(SCREENS.plans), { kind: "primary", wide: o.wide ?? true, ...(o.size ? { size: o.size } : {}) })] : [];
  const askFirst = ASK_ABOVE_BUY;
  const ask = askSomeoneButton(askFirst ? "primary" : "secondary", o);
  const buy = o.upgrade ? [button("Get more with a plan", open(SCREENS.plans), { kind: askFirst ? "secondary" : "primary", wide: o.wide ?? true, ...(o.size ? { size: o.size } : {}) })] : [];
  return askFirst ? [ask, ...buy] : [...buy, ask];
}

// ===================================================================== bots.plan.share

/** A tick, the circle the report screen uses: filled ink with a white check when it is on, an outline when it is not. */
function tick(on: Condition): Node {
  const c = (then: unknown, otherwise: unknown) => ({ ...on, then, else: otherwise });
  return box([when(on, icon("check", { size: 14, color: C.paper }))], {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0,
    borderWidth: c(0, 1.5), borderColor: C.outline, backgroundColor: c(C.ink, C.paper),
  });
}

interface SharePick { userId: string; name: string }

/** The body both readings share: the people, each a row that ticks, and the line that says who may be on the list. */
function pickList(ctx: BotsCtx, people: SharePick[], o: { many: boolean; empty: Node }): Node[] {
  if (!people.length) return [o.empty];
  const rows = people.map((p) => {
    const on: Condition = o.many ? { contains: ["picked", p.userId] } : { eq: ["picked", p.userId] };
    return listRow({
      left: personMark(ctx, { seed: p.userId }, 32),
      label: p.name,
      right: tick(on),
      chevron: false,
      onPress: o.many ? { kind: "toggleInArray", path: "picked", value: p.userId } : { kind: "setState", path: "picked", value: p.userId },
    });
  });
  return [listCard(rows), meta(SPACES_ONLY_LINE, { size: 12, lines: 2 })];
}

/** Share with the people ticked: one call, then back to Plan and billing with a word about what happened. */
const shareAction = (): ActionRef => ({
  kind: "condition", if: { truthy: "picked" },
  then: call("POST", PLAN_SHARE_API, { memberIds: "$state.picked" }, {
    ok: seq(toast("They're on your plan"), back()),
    fail: oops("share your plan"),
  }),
  else: toast("Pick who to share with first"),
});

/** Ask one person for theirs. They are told only that you asked; nothing of yours goes with it. */
const askAction = (): ActionRef => ({
  kind: "condition", if: { truthy: "picked" },
  then: call("POST", ASK_PATH, { ownerId: "$state.picked" }, {
    ok: seq(toast("Asked. You'll hear when they answer."), back()),
    fail: oops("ask them"),
  }),
  else: toast("Pick who to ask first"),
});

function sharePage(ctx: BotsCtx, share: PlanShareView | undefined) {
  const asking = String(ctx.params.ask ?? "") === "1";
  const desk = ctx.client === "desktop";
  const heading = asking ? "Ask for a plan" : "Share with someone";
  if (!share) {
    return page(ctx, {
      back: true, nav: "you", title: heading, ...(desk ? { backTitle: "Plan and billing", maxWidth: 640 } : {}),
      body: [title(heading), emptyState({ pose: "think", title: "Couldn't open this", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })],
    });
  }
  // Who may be picked. Sharing: the people you share a space with who are not on a plan already, so nothing you can
  // tap can be refused. Asking: the people who have one. Either way, only people you already share a space with.
  const people: SharePick[] = asking
    ? share.people.filter((p) => p.hasPlan).map((p) => ({ userId: p.userId, name: p.name }))
    : share.people.filter((p) => !p.hasPlan && !p.onMyPlan).map((p) => ({ userId: p.userId, name: p.name }));
  const empty = emptyState({
    pose: "hello",
    title: asking ? "Nobody to ask yet" : "Nobody to share with yet",
    body: asking ? "You can ask someone you share a space with." : "You can share your plan with people you share a space with.",
  });
  return page(ctx, {
    back: true, nav: "you", title: heading, gap: 18,
    ...(desk ? { backTitle: "Plan and billing", maxWidth: 640 } : {}),
    state: { picked: asking ? "" : [] },
    body: [
      col([
        title(heading),
        meta(asking ? "They choose. You're not told anything about their plan." : SAME_MONTH_LINE, { size: 13, lines: 2 }),
      ], { gap: 4 }),
      ...pickList(ctx, people, { many: !asking, empty }),
    ],
    // The window's one primary is a pill at its own width, as every other page of the window draws it; the phone's is wide.
    ...(people.length ? { footer: [primaryButton(asking ? "Ask them" : "Share my plan", asking ? askAction() : shareAction(), { wide: !desk, ...(desk ? { size: "md" as const } : {}) })] } : {}),
  });
}

export const planShareScreens: BotsScreen[] = [
  screen<PlanShareView | undefined>({
    id: SCREENS.planShare,
    load: (ctx, deps) => loadShare(deps, ctx.user?.id),
    build: (ctx, d) => sharePage(ctx, d),
  }),
];
