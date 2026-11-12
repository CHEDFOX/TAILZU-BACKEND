/**
 * FOLLOW-THROUGH'S SCREENS (PLAN_V2_FOLLOW; botsBots/planFollow.ts, docs/plan-ease.md "Follow-through"). Server-drawn, phone and desktop
 * alike, no new capability.
 *
 *   bots.plan.follow          params: follow, button    one followed item: what, when, who has it, what X0 did (the asker only), and its
 *                                                       buttons: Done, Later (then its choices), Can't, I'll do it, Call, Message, Not done
 *                                                       yet; someone on another person's must item is asked once whether that person's
 *                                                       reminders may ring them louder and call them (Allow / Not now)
 *   bots.plan.follow.people   params: kind, id          who does an item: the people on it in order (Does it, If they can't), Move up,
 *                                                       Remove, a number for your own Call button; Add from you and your X0 people, or by
 *                                                       name; someone not in your X0 people: the space invite the Spaces screens use
 *
 * Every answer goes through the act door (POST /v1/widgets/act, pf:<followId>:<n>), as a push's buttons do.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, C, SCREENS, call, chips, col, divider, emptyState, listCard, listRow, meta, notice, open, page, primaryButton, quietButton, row,
  secondaryButton, sectionLabel, seq, statusMark, switchMark, text, when,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { FOLLOW, howWords, type PersonHow, type PersonKey } from "../../../../botsBots/planFollowWords.js";
import type { FollowView, ItemFollow } from "../../../../botsBots/planFollow.js";
import type { PeoplePicker } from "../../../../botsBots/planFollowPeople.js";
import { enc, field, handoffOf, inputBox, isDesk, refresh, setState, toast } from "./parts.js";

const ACT = "/v1/widgets/act";
const followOf = (ctx: BotsCtx): string => String(ctx.params.follow ?? "").replace(/[^0-9a-f-]/gi, "").slice(0, 36);

/** One of the follow's buttons through the act door, then a word and the page again. */
function act(ctx: BotsCtx, v: FollowView, action: string, message: string, then: ActionRef = refresh): ActionRef {
  const item = `pf:${v.id}:${v.n}`;
  return call("POST", ACT, { item, action, key: `${item}:${action}:${ctx.live.now}`.slice(0, 120) }, {
    ok: seq(toast(message), then), fail: toast("Couldn't do that. Try again.", true),
  });
}

const STATE_WORDS: Partial<Record<FollowView["state"], string>> = { missed: "Not done in time", dropped: "Not this time", nobody: "Nobody can do it" };

function roleLine(v: FollowView): string {
  // Done: the done line under the title says who and when ("Mom said done · 9:12 pm"); nothing here may say otherwise.
  if (v.state === "done") return "";
  if (v.you === "holder" && !v.asker.me) return `${v.asker.name} asked X0 to remind you.`;
  if (v.you === "backup") return `${v.holder.name} hasn't said done. You're next on it.`;
  if (v.asker.me && !v.holder.me) return v.state === "nobody" ? "Nobody else can do it." : v.state === "told" ? `${v.holder.name} hasn't said done.` : `${v.holder.name} has it now.`;
  return v.must ? "X0 keeps at it until you say done." : "";
}

/** The one-time question for someone on another person's must item: may that person's reminders ring them louder and call them? */
function askCard(ctx: BotsCtx, v: FollowView): Node[] {
  if (!v.ask) return [];
  return [col([
    text(`Let ${v.ask.asker}'s must-not-miss reminders ring louder and call you?`, { size: 15, weight: 600, lineHeight: 21 }),
    meta("Never between 10 pm and 7 am. You can change this in What pings you.", { size: 13 }),
    row([
      primaryButton("Allow", act(ctx, v, "allow", "Okay"), { size: "md" }),
      secondaryButton("Not now", act(ctx, v, "deny", "Okay"), { size: "md" }),
    ], { gap: 10, flexWrap: "wrap" }),
  ], { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line })];
}

function peopleList(v: FollowView): Node[] {
  if (!v.asker.me || !v.people.length) return [];
  return [listCard(v.people.map((p, i) => listRow({
    label: p.name,
    sub: [i === 0 ? "Does it" : "If they can't", p.how === "gone" ? howWords("gone") : "", p.cant ? "can't this time" : ""].filter(Boolean).join(" · "),
    ...(p.key === v.holder.key && v.state !== "done" ? { value: "Has it" } : {}),
  })), { title: "Who" })];
}

function history(v: FollowView): Node[] {
  if (!v.asker.me) return [];
  const lines = [...v.steps, ...v.answers].sort((a, b) => a.at - b.at);
  if (!lines.length) return [];
  return [col([sectionLabel("What X0 did"), ...lines.map((l) => meta(l.line, { size: 13, lineHeight: 19 }))], { gap: 6 })];
}

export function followPage(ctx: BotsCtx, v: FollowView | undefined) {
  if (!v) {
    return page(ctx, {
      back: true, nav: "plan", title: "Plan",
      body: [emptyState({ pose: "think", title: "It isn't there any more", body: "It may have been taken out, or the connection dropped.", action: { label: "Back to Plan", onPress: open(SCREENS.plan) } })],
    });
  }
  const b = v.buttons;
  const md = { size: "md" as const };
  const dial: ActionSpec | null = b.call ? ({ kind: "phone", number: b.call.number } as ActionSpec) : null;
  const footer: Node[] = [];
  if (b.done) footer.push(primaryButton("Done", act(ctx, v, "done", "Done"), md));
  if (b.later.length) footer.push(secondaryButton("Later", setState("later", true), md));
  if (b.cant) footer.push(secondaryButton("Can't", act(ctx, v, "cant", "I'll ask the next one"), md));
  if (b.take) footer.push(secondaryButton("I'll do it", act(ctx, v, "take", "It's yours now"), md));
  if (dial && b.call) footer.push(secondaryButton(`Call ${b.call.name}`, dial, md));
  if (b.message) footer.push(quietButton(`Message ${b.message.name}`, open(SCREENS.person, { id: b.message.userId }), md));
  if (b.undone) footer.push(quietButton("Not done yet", act(ctx, v, "undone", "Back on"), md));
  const laterRow = b.later.length ? [when({ truthy: "later" }, col([
    sectionLabel("Remind me"),
    row(b.later.map((l) => secondaryButton(l.label, act(ctx, v, l.action, "I'll remind you then"), md)), { gap: 8, flexWrap: "wrap" }),
  ], { gap: 8 }))] : [];
  const role = roleLine(v);
  const head = col([
    text(v.title, { size: isDesk(ctx) ? 22 : 20, weight: 600, lineHeight: 26 }),
    meta(`${v.when}${v.must ? " · Must not miss" : ""}`, { size: 14 }),
  ], { gap: 4 });
  const body: Node[] = [
    head,
    ...(role ? [text(role, { size: 15, lineHeight: 21 })] : []),
    ...askCard(ctx, v),
    ...(STATE_WORDS[v.state] && !v.done ? [meta(STATE_WORDS[v.state]!, { size: 14 })] : []),
    ...(v.done ? [row([statusMark("done"), meta(v.done.line, { size: 14, lineHeight: 19 })], { gap: 8, alignItems: "center" })] : []),
    ...(v.next ? [meta(v.next.line, { size: 13 })] : []),
    ...laterRow,
    ...peopleList(v),
    ...history(v),
  ];
  // The tell push's Call: dial at once from the asker's own phone, the page underneath (a tap just to look only opens the page).
  const calling = dial && handoffOf(ctx, ["f_call"]) === "go" && ctx.params.button === "f_call";
  return page(ctx, {
    back: true, ...(isDesk(ctx) ? { backTitle: "Plan Ease" } : {}), nav: "plan", title: v.title, maxWidth: 560, gap: 16, state: { later: false },
    body: calling ? [{ ...col(body, { gap: 16 }), on: { onAppear: dial! } }] : body,
    footer: footer.length ? [row(footer, { gap: 10, flexWrap: "wrap" })] : [],
  });
}

// ------------------------------------------------------------------ who does it

const keyId = (k: PersonKey): string => k.slice(2);
const HOW: Record<PersonHow, string> = { app: "", gone: howWords("gone") };

export function followPeoplePage(ctx: BotsCtx, d: PeoplePicker | undefined) {
  const kind = ctx.params.kind === "task" ? "task" : ctx.params.kind === "event" ? "event" : "";
  const id = String(ctx.params.id ?? "");
  if (!d || !kind || !id || !d.item?.allowed) {
    return page(ctx, {
      back: true, nav: "plan", title: "Who does it",
      body: [emptyState({ pose: "think", title: "Nothing to set here", body: "Open one of your own items to say who does it.", action: { label: "Back to Plan", onPress: open(SCREENS.plan) } })],
    });
  }
  const item: ItemFollow = d.item;
  const onIt = item.people.map((p) => keyId(p.key));
  /** PUT the item's people as given (ids, or a name to match), then the answer's words (a name not in your X0 people says so). */
  const save = (people: Array<string | { name: string }>, ok: string): ActionRef => call("PUT", `${FOLLOW}/item`, { kind, id, people: people.map((p) => (typeof p === "string" ? { id: p } : p)) }, {
    assignTo: "res",
    ok: seq({ kind: "condition", if: { truthy: "res.message" }, then: toast("$state.res.message"), else: toast(ok) } as ActionSpec, setState("addName", ""), refresh),
    fail: toast("Couldn't save that. Try again.", true),
  });
  const md = { size: "md" as const };
  const rows: Node[] = (item.people.length ? item.people : [{ key: `u:me` as PersonKey, name: "You", me: true, how: "app" as PersonHow }]).map((p, i) => {
    const pid = keyId(p.key);
    const has = d.people.find((x) => x.key === p.key);
    const buttons: Node[] = item.people.length ? [
      ...(i > 0 ? [quietButton("Move up", save([...onIt.slice(0, i - 1), pid, onIt[i - 1]!, ...onIt.slice(i + 1)], "Moved up"), md)] : []),
      quietButton("Remove", save(onIt.filter((x) => x !== pid), "Taken off"), md),
      ...(d.numbers && !p.me && p.how === "app" ? [quietButton(has?.number ? "Number saved" : "Add number", setState("numFor", pid), md)] : []),
    ] : [];
    return col([
      listRow({ label: p.name, sub: [i === 0 ? "Does it" : "If they can't", HOW[p.how]].filter(Boolean).join(" · ") }),
      ...(buttons.length ? [row(buttons, { gap: 4, flexWrap: "wrap", paddingHorizontal: 8, paddingBottom: 8 })] : []),
      ...(d.numbers && !p.me ? [when({ eq: ["numFor", pid] }, col([
        meta("Only for your Call button. X0 never calls or messages it.", { size: 12 }),
        inputBox([field(`num-${pid}`, "num", "Their number")]),
        row([
          secondaryButton("Save", call("PUT", `${FOLLOW}/number`, { member: pid, phone: "$state.num" }, { ok: seq(toast("Saved"), setState("numFor", ""), refresh), fail: toast("That number doesn't look right.", true) }), md),
          ...(has?.number ? [quietButton("Remove number", call("PUT", `${FOLLOW}/number`, { member: pid, phone: "" }, { ok: seq(toast("Taken away"), setState("numFor", ""), refresh), fail: toast("Couldn't do that. Try again.", true) }), md)] : []),
        ], { gap: 8, flexWrap: "wrap" }),
      ], { gap: 8, paddingHorizontal: 16, paddingBottom: 12 }))] : []),
    ], { gap: 0 });
  });
  const addable = d.people.filter((p) => !onIt.includes(keyId(p.key)) && !(p.me && !item.people.length));
  const invite: ActionSpec | null = d.invite ? open(d.invite.screen, d.invite.params ?? {}) : null;
  const addRows: Node[] = addable.map((p) => listRow({
    label: p.name, sub: p.me ? "Yourself" : "Has X0",
    right: secondaryButton("Add", save([...onIt, keyId(p.key)], `Added ${p.name}`), md), chevron: false,
  }));
  const byName = d.spaces ? [col([
    sectionLabel("Someone by name"),
    inputBox([field("addName", "addName", "Their name, as in your X0 people")]),
    row([secondaryButton("Add", { kind: "condition", if: { falsy: "addName" }, then: toast("Say their name first"), else: save([...onIt, { name: "$state.addName" }], "Added") } as ActionSpec, md)], { gap: 8 }),
  ], { gap: 8 })] : [];
  return page(ctx, {
    back: true, ...(isDesk(ctx) ? { backTitle: "Plan Ease" } : {}), nav: "plan", title: "Who does it", maxWidth: 560, gap: 18, state: { numFor: "", num: "", addName: "" },
    body: [
      col([text("Who does it", { size: 22, weight: 700, lineHeight: 28 }), meta("X0 reminds them first. If they can't, the next one.", { size: 13 })], { gap: 4 }),
      col([sectionLabel("On it"), col(rows.flatMap((r, i) => (i ? [divider(), r] : [r])), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 }),
      ...(addRows.length ? [listCard(addRows, { title: "Add" })] : []),
      ...byName,
      notice(d.spaces
        ? "Only people in your X0 people can be on it: someone with X0 you share a space with. Everyone on it gets X0's reminders on their phone."
        : "Only you for now. People you share a space with on X0 can be added once Spaces is on."),
      ...(invite ? [secondaryButton("Invite someone to a space", invite, md)] : []),
    ],
  });
}

export const planFollowScreens: BotsScreen[] = [
  screen<FollowView | undefined>({
    id: SCREENS.planFollow,
    load: async (ctx, deps) => {
      const id = followOf(ctx);
      return id ? deps.api<FollowView>("GET", `${FOLLOW}/${enc(id)}`).catch(() => undefined) : undefined;
    },
    build: followPage,
  }),
  screen<PeoplePicker | undefined>({
    id: SCREENS.planFollowPeople,
    load: async (ctx, deps) => {
      const kind = ctx.params.kind === "task" ? "task" : ctx.params.kind === "event" ? "event" : "";
      const id = String(ctx.params.id ?? "");
      return kind && id ? deps.api<PeoplePicker>("GET", `${FOLLOW}/people?kind=${kind}&id=${enc(id)}`).catch(() => undefined) : undefined;
    },
    build: followPeoplePage,
  }),
];

/** Opens one follow's page. */
export const followAction = (id: string): ActionSpec => open(SCREENS.planFollow, { follow: id });

// ------------------------------------------------------------------ the item page's part

const WHY_WORDS: Record<string, string> = {
  medicine: "Marked by X0: medicine", pickup: "Marked by X0: a pickup", bill_today: "Marked by X0: due today", flight: "Marked by X0: travel",
};

/**
 * The item page's follow part (screens/planItem.ts details, planIn.ts duePage): Must not miss (a switch, with why X0 marked it), Who
 * ("You", or "Mom, then Dad"), and the open follow's line. Nothing for a wait, someone else's item, or with PLAN_V2_FOLLOW off (the
 * server sends no `follow` then). The page's state "must" starts from `f.must` (followState).
 */
export function followSection(kind: "event" | "task", id: string, f: ItemFollow | undefined): Node[] {
  if (!f?.allowed) return [];
  const put = (importance: "must" | "normal", message: string): ActionRef => call("PUT", `${FOLLOW}/item`, { kind, id, importance }, {
    ok: seq(toast(message), refresh), fail: toast("Couldn't save that. Try again.", true),
  });
  const toggle: ActionRef = seq({ kind: "toggleState", path: "must" } as ActionSpec, {
    kind: "condition", if: { truthy: "must" }, then: put("must", "Marked must not miss"), else: put("normal", "Back to normal"),
  } as ActionSpec);
  const who = f.people.length ? f.people.map((p) => (p.how === "gone" ? `${p.name} (not in your X0 people)` : p.name)).join(", then ") : "You";
  return [listCard([
    listRow({ label: "Must not miss", sub: f.why ? WHY_WORDS[f.why] ?? "" : "Louder until someone says done", right: switchMark("must"), chevron: false, onPress: toggle }),
    listRow({ label: `Who: ${who}`, onPress: open(SCREENS.planFollowPeople, { kind, id }) }),
    ...(f.open ? [listRow({ label: f.open.line, onPress: open(SCREENS.planFollow, { follow: f.open.id }) })] : []),
  ])];
}

/** The item page's state for its follow part. */
export const followState = (f: ItemFollow | undefined): Record<string, unknown> => (f?.allowed ? { must: f.must } : {});

/** The add form's Must not miss (empty: the rules decide), only while follow-through is on. */
export function importanceField(): Node {
  return col([
    sectionLabel("Must not miss"),
    chips([{ label: "Normal", value: "normal" }, { label: "Must not miss", value: "must" }], "imp"),
    meta("X0 marks medicine, pickups, bills due today and flights by itself.", { size: 12 }),
  ], { gap: 8 });
}
