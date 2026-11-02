/**
 * The Spaces's spaceDetail screen.
 */

import type { ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, row, text, call, SCREENS, seq, button, open, col, statusMark, meta, icon, C, when, botAvatar, botLook, botRoute, chip,
  notice, box, quietButton, segmented,
} from "../../kit.js";
import {
  localDate, DAY, MONTHS, MIN, shortDate, type Space, type Task, type Item, type Payment, names, type Member, A, toast, enc, write, rowPad,
  kindBadge, iconButton, inputBox, field, personDot, canDo, messagePerson, rowsCard, type OneSpace, ifFilled, clearState, isDesk, section,
  inviteRows,
} from "./parts.js";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A state key from an id: letters, digits and _. */
export const key = (prefix: string, id: string) => `${prefix}_${id.replace(/[^a-z0-9]/gi, "")}`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

export const dayKeyOf = (ctx: BotsCtx, ms: number) => localDate(ctx, ms).toISOString().slice(0, 10);
export function clockOf(ctx: BotsCtx, ms: number): string {
  const d = localDate(ctx, ms);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** "Today", "Tomorrow", "Thu 29 Oct". */
export function dayWords(ctx: BotsCtx, ms: number): string {
  const k = dayKeyOf(ctx, ms);
  if (k === dayKeyOf(ctx, ctx.live.now)) return "Today";
  if (k === dayKeyOf(ctx, ctx.live.now + DAY)) return "Tomorrow";
  if (k === dayKeyOf(ctx, ctx.live.now - DAY)) return "Yesterday";
  const d = localDate(ctx, ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "4 min ago", "9:30 am", "Yesterday", "2 Oct". */
export function ago(ctx: BotsCtx, ms: number): string {
  const m = Math.max(0, Math.round((ctx.live.now - ms) / MIN));
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, ctx.live.now)) return clockOf(ctx, ms);
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, ctx.live.now - DAY)) return "Yesterday";
  return shortDate(ctx, ms);
}
const whenLine = (ctx: BotsCtx, at: number | null, allDay: boolean) => (at === null ? "" : allDay ? dayWords(ctx, at) : `${dayWords(ctx, at)}, ${clockOf(ctx, at)}`);

export const link = (label: string, onPress: ActionRef): Node => row([text(label, { size: 13, weight: 500, lineHeight: 18 })], { minHeight: 32, paddingHorizontal: 4 }, onPress);

// ===================================================================== bots.spaces: the list
export interface SpacesData {
  spaces?: Space[]; you?: string; unread?: number; given?: Task[]; one?: { space: Space; items: Item[]; payments: Payment[]; tasks: Task[]; mailReady: boolean };
  bots?: Array<{ slug: string; name: string; colour: string; builtin: boolean }>;
  /** What the invite in `join` is for (GET .../spaces/join/:code): null when it doesn't work, absent when it couldn't be read. */
  invite?: JoinInvite | null;
}
export interface JoinInvite { name: string; members: number; email: string | null }

export const spaceCount = (s: Space) => `${plural(s.members.length, "person", "people")} · ${plural(s.bots.length, "bot")}`;
export function approversLine(s: Space): string {
  const yes = s.members.filter((m) => m.canApprove).map((m) => (m.you ? "You" : m.name));
  const ask = s.members.filter((m) => !m.canApprove && m.perms.includes("askPay")).map((m) => (m.you ? "you" : m.name));
  return `${names(yes)}${ask.length ? ` · ${names(ask)} can ask` : ""}`;
}
export const youAre = (s: Space) => (s.me.admin ? "You're the admin" : `You're ${s.members.find((m) => m.you)?.roleName ?? "in it"}`);
export const memberName = (m: Member) => (m.you ? `${m.name} (you)` : m.name);

export const openChat = (spaceId: string): ActionRef => call("POST", `${A}/threads/group`, { space: spaceId, people: "all" }, { assignTo: "chat", ok: { kind: "navigate", screenId: SCREENS.thread, params: { id: "$state.chat.id" } }, fail: toast("Couldn't open the chat. Try again.", true) });

// ===================================================================== one space, whole
function payRow(ctx: BotsCtx, s: Space, p: Payment): Node {
  const status = p.status === "waiting" ? (p.canDecide ? "Waiting for your yes" : `Waiting for a yes · asked by ${p.askedBy}`)
    : p.status === "approved" ? `${p.decidedBy} said yes · ${p.canMarkPaid ? "you pay in your UPI app" : "to be paid"}`
      : p.status === "paid" ? `Paid by ${p.decidedBy}${p.paidAt ? ` · ${shortDate(ctx, p.paidAt)}` : ""}`
        : p.status === "declined" ? `${p.decidedBy} said no` : "Taken back";
  const mark = p.status === "paid" ? "done" : p.status === "declined" || p.status === "cancelled" ? "failed" : p.canDecide ? "needs" : "waiting";
  const base = `${A}/spaces/${enc(s.id)}/payments/${enc(p.id)}`;
  const approve = call("PUT", base, { decision: "approve" }, {
    assignTo: "decided", ok: seq(toast("Approved. Now pay in your UPI app"), { kind: "navigate", screenId: SCREENS.approve, params: { upi: "$state.decided.payment.upi", bot: "tailzu" } }),
    fail: toast("Couldn't approve it. Someone may have answered.", true),
  });
  const actions: Node[] = [
    ...(p.canDecide ? [button("Approve", approve, { kind: "secondary", size: "md" }), button("Say no", write("PUT", base, { decision: "decline" }, { ok: "Said no" }), { kind: "secondary", size: "md" })] : []),
    ...(p.canMarkPaid && p.upi ? [button("Pay in UPI", open(SCREENS.approve, { upi: p.upi, bot: "tailzu" }), { kind: "secondary", size: "md" }), button("I've paid", write("PUT", base, { paid: true }, { ok: "Marked paid" }), { kind: "secondary", size: "md" })] : []),
    ...(p.canCancel ? [button("Take back", write("DELETE", base, undefined, { ok: "Taken back" }), { kind: "quiet", size: "md" })] : []),
  ];
  return col([
    row([statusMark(mark), col([text(p.note ? `${p.note} · ${p.payee}` : `Pay ${p.payee}`, { size: 15, weight: 500, lineHeight: 20 }), meta(status, { size: 12, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }), meta(shortDate(ctx, p.at), { size: 12 })], { gap: 12, alignItems: "flex-start" }),
    ...(actions.length ? [row(actions, { gap: 8, flexWrap: "wrap", paddingLeft: 20 })] : []),
  ], { ...rowPad, gap: 10 });
}

function itemRow(ctx: BotsCtx, it: Item): Node {
  return row([kindBadge(it.kind), col([text(it.title, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta([it.summary, `${it.by} · ${ago(ctx, it.updatedAt)}`].filter(Boolean).join(" · "), { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(it.access === "edit" ? [meta("Can edit", { size: 12, lines: 1, style: { flexShrink: 0 } })] : []), icon("chevron", { size: 16, color: C.meta })], rowPad, open(SCREENS.spaceItem, { item: it.id }));
}

function taskLine(ctx: BotsCtx, t: Task): string {
  const who = t.people.map((p) => (p.you ? "you" : p.name));
  return [`${t.kind === "plan" ? "For" : "To"} ${names(who)}`, whenLine(ctx, t.at, t.allDay), t.place, `from ${t.setBy}`].filter(Boolean).join(" · ");
}
function taskMark(t: Task) {
  if (t.done) return "done" as const;
  if (t.mine?.status === "cant" || t.people.every((p) => p.status === "cant")) return "failed" as const;
  return t.mine && t.mine.status === "todo" ? "needs" as const : "waiting" as const;
}
/** One task or plan: its line, what each person said, and (yours) Done / Can't do it. */
export function taskRow(ctx: BotsCtx, t: Task, o: { showSpace?: boolean } = {}): Node {
  const base = `${A}/spaces/${enc(t.spaceId)}/tasks/${enc(t.id)}`;
  const noteKey = key("cant", t.id), openKey = key("cantOpen", t.id);
  const said = t.people.filter((p) => p.status !== "todo").map((p) => (p.status === "done" ? `${p.you ? "You" : p.name}: done` : `${p.you ? "You" : p.name} can't${p.note ? `: ${p.note}` : ""}`));
  const mine = t.mine;
  return col([
    row([statusMark(taskMark(t)), col([
      text(t.title, { size: 15, weight: 500, lineHeight: 20 }),
      meta(`${o.showSpace ? `${t.spaceName} · ` : ""}${taskLine(ctx, t)}`, { size: 12, lines: 2 }),
      ...(t.notes ? [text(t.notes, { size: 13, color: C.grey70, lineHeight: 18, lines: 3 })] : []),
      ...(said.length ? [meta(said.join(" · "), { size: 12, lines: 2 })] : []),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(t.canRemove ? [iconButton("close", write("DELETE", base, undefined, { ok: "Taken out" }), "Take it out", 36)] : [])], { gap: 12, alignItems: "flex-start" }),
    ...(mine && mine.status === "todo" ? [
      row([button("Done", write("PUT", base, { status: "done" }, { ok: "Nice, done" }), { kind: "secondary", size: "md", icon: "check" }), button("Can't do it", { kind: "toggleState", path: openKey }, { kind: "secondary", size: "md" })], { gap: 8, paddingLeft: 20, flexWrap: "wrap" }),
      when({ truthy: openKey }, col([inputBox([field(noteKey, noteKey, "Say why, in a few words", { onSubmit: write("PUT", base, { status: "cant", note: `$state.${noteKey}` }, { ok: "Told them" }) }),
        button("Send", write("PUT", base, { status: "cant", note: `$state.${noteKey}` }, { ok: "Told them" }), { kind: "secondary", size: "md" })])], { paddingLeft: 20 })),
    ] : mine && mine.status !== "todo" ? [row([link("Not done yet", write("PUT", base, { status: "todo" }, { ok: "Back on your list" }))], { paddingLeft: 16 })] : []),
  ], { ...rowPad, gap: 10 });
}

function memberRow(s: Space, m: Member): Node {
  const who = row([personDot(m.name, m.you, 32), col([text(memberName(m), { size: 15, lineHeight: 20, lines: 1 }), meta(m.roleName, { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0 }, open(SCREENS.spaceMember, { id: s.id, member: m.userId }));
  return row([who, ...(!m.you && canDo(s, "message") ? [iconButton("send", messagePerson(m.userId), `Message ${m.name}`)] : []), icon("chevron", { size: 16, color: C.meta })], { ...rowPad, paddingRight: 12 });
}

function botsCard(s: Space, mineBots: SpacesData["bots"]): Node {
  const shareable = (mineBots ?? []).filter((b) => !s.bots.some((x) => x.slug === b.slug));
  const rows: Node[] = s.bots.map((b) => row([
    row([botAvatar(botLook(b.slug, b.colour), 30), col([text(b.name, { size: 15, lineHeight: 20 }), meta(`${b.byYou ? "You added it" : `${b.addedBy} added it`}${canDo(s, "bots") ? " · it reads what's shared here" : ""}`, { size: 12, lines: 1 })], { gap: 2, flexShrink: 1, minWidth: 0 })],
      { gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0 }, canDo(s, "bots") ? botRoute(b.slug) : undefined),
    ...(canDo(s, "addBots") ? [iconButton("close", write("DELETE", `${A}/spaces/${enc(s.id)}/bots/${enc(b.slug)}`, undefined, { ok: `${b.name} taken out` }), "Take it out", 36)] : []),
  ], { ...rowPad, paddingRight: 8 }));
  if (canDo(s, "addBots") && shareable.length) {
    rows.push(col([
      text(`Add a bot to ${s.name}`, { size: 14, weight: 600, lineHeight: 19 }),
      row(shareable.slice(0, 6).map((b) => chip(b.name, { onPress: write("POST", `${A}/spaces/${enc(s.id)}/bots`, { slug: b.slug }, { ok: `${b.name} shared` }) })), { gap: 8, flexWrap: "wrap" }),
    ], { gap: 10, paddingVertical: 12, paddingHorizontal: 16 }));
  }
  return rows.length ? rowsCard(rows) : notice("No bots shared here yet.");
}

function activityRows(ctx: BotsCtx, s: Space, max = 8): Node | null {
  if (!s.activity?.length) return null;
  return col(s.activity.slice(0, max).map((a) => row([box([], { width: 6, height: 6, borderRadius: 3, backgroundColor: C.idle, marginTop: 7 }), text(a.text, { size: 13, lineHeight: 19, style: { flexGrow: 1, flexShrink: 1 } }), meta(ago(ctx, a.at), { size: 12 })], { gap: 10, alignItems: "flex-start" })), { gap: 8 });
}

/** "You, Mom and Rohan": who is in the space, you first. */
export const facesLine = (s: Space) => names([...s.members.filter((m) => m.you).map(() => "You"), ...s.members.filter((m) => !m.you).map((m) => m.name)]);

/** The space's tabs: one part of it at a time, so a space never reads as a wall. */
export const SPACE_TABS = [
  { label: "Now", value: "now" }, { label: "Shared", value: "shared" }, { label: "Plans", value: "plans" }, { label: "Money", value: "money" }, { label: "People", value: "people" },
];
const tab = (value: string, children: Node[]): Node => when({ eq: ["tab", value] }, col(children, { gap: 22, minWidth: 0 }));

/**
 * One space, a tab at a time. Now: only what waits on you (three at most, the rest under Plans and Money) and the last few things that
 * happened. Shared, Plans and Money: one each. People: who is in, the bots, waiting invites, the name, leaving. Every action is the one
 * the full page had; only where it sits changed.
 */
export function spaceDetail(ctx: BotsCtx, o: OneSpace, mineBots: SpacesData["bots"]): Node[] {
  const s = o.space;
  const waiting = o.payments.filter((p) => p.canDecide);
  const forMe = o.tasks.filter((t) => t.mine && t.mine.status === "todo");
  const open_ = o.tasks.filter((t) => !t.done && !forMe.includes(t)).slice(0, 6);
  const history = o.payments.filter((p) => !p.canDecide).slice(0, 6);
  const sid = enc(s.id);
  const newList = ifFilled("listName", call("POST", `${A}/spaces/${sid}/lists`, { title: "$state.listName" }, { assignTo: "newList", ok: seq(clearState("listName"), toast("List made"), { kind: "navigate", screenId: SCREENS.spaceItem, params: { item: "$state.newList.item.id" } }), fail: toast("Couldn't make it. Try again.", true) }), "Name the list first");
  const desk = isDesk(ctx);

  const top = col([
    row([
      row(s.members.slice(0, 4).map((m) => box([personDot(m.name, m.you, desk ? 36 : 34)], { marginRight: -8, borderRadius: 20, borderWidth: 2, borderColor: C.paper })), { paddingRight: 8 }),
      col([text(s.name, { size: desk ? 26 : 24, weight: 700, tracking: -0.5, lineHeight: desk ? 32 : 30 }), meta(facesLine(s), { size: 13, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ], { gap: 12, alignItems: "center" }),
    row([
      ...(canDo(s, "invite") ? [button("Invite someone", open(SCREENS.spaceInvite, { id: s.id }), { kind: "secondary", size: "md", icon: "plus" })] : []),
      button("Chat", openChat(s.id), { kind: "secondary", size: "md", icon: "send" }),
    ], { gap: 8, flexWrap: "wrap" }),
  ], { gap: 14 });

  const needs = [...waiting.map((p) => payRow(ctx, s, p)), ...forMe.map((t) => taskRow(ctx, t))];
  const more = needs.length - 3;
  const log = activityRows(ctx, s, 4);
  const now = tab("now", [
    needs.length
      ? section(`Waiting on you · ${needs.length}`, [rowsCard(needs.slice(0, 3)), ...(more > 0 ? [meta(`${plural(more, "more thing")} under Plans and Money.`, { size: 12 })] : [])])
      : row([statusMark("done"), col([text("You're all caught up", { size: 15, weight: 500, lineHeight: 20 }), meta(`Nothing in ${s.name} is waiting on you.`, { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    ...(log ? [section("Lately", [log])] : []),
  ]);

  const shared = tab("shared", [section(`Shared · ${o.items.length}`, [
    ...(o.items.length ? [rowsCard(o.items.slice(0, 8).map((it) => itemRow(ctx, it)))] : [meta("Lists, trips, notes and files you share with your people live here, for everyone to see and add to.", { size: 13 })]),
    ...(canDo(s, "share") ? [inputBox([field("listName", "listName", "Start a list: Groceries, Packing…", { onSubmit: newList }), button("Create", newList, { kind: "secondary", size: "md" })])] : []),
  ])]);

  const plans = tab("plans", [section("Tasks and plans", [
    ...(open_.length ? [rowsCard(open_.map((t) => taskRow(ctx, t)))] : [meta(canDo(s, "tasks") || canDo(s, "plan") ? "Help each other out: hand someone a task, or put something on their day." : "Nothing given out right now.", { size: 13 })]),
    row([
      ...(canDo(s, "tasks") ? [button("Give a task", open(SCREENS.spaceTasks, { id: s.id, new: "task" }), { kind: "secondary", size: "md", icon: "check" })] : []),
      ...(canDo(s, "plan") ? [button("Plan for someone", open(SCREENS.spaceTasks, { id: s.id, new: "plan" }), { kind: "secondary", size: "md", icon: "calendar" })] : []),
    ], { gap: 8, flexWrap: "wrap" }),
  ], link("All", open(SCREENS.spaceTasks, { id: s.id })))]);

  const money = tab("money", [section("Money", [
    col([text("No money moves without a yes", { size: 15, weight: 500, lineHeight: 20 }), meta(`${approversLine(s)}. Whoever pays does it in their own UPI app: ${s.name} never pays by itself.`, { size: 12 })], { gap: 2 }),
    ...(history.length ? [rowsCard(history.map((p) => payRow(ctx, s, p)))] : []),
    ...(canDo(s, "askPay") ? [button("Ask for a payment", open(SCREENS.spacePay, { id: s.id }), { kind: "secondary", size: "md", icon: "rupee" })] : []),
  ])]);

  const rename = ifFilled("spaceRename", write("PUT", `${A}/spaces/${sid}`, { name: "$state.spaceRename" }, { ok: "Renamed" }), "Type the new name");
  const people = tab("people", [
    section(`People · ${s.members.length}`, [rowsCard(s.members.map((m) => memberRow(s, m)))], s.me.admin ? link("Roles", open(SCREENS.spaceRoles, { id: s.id })) : undefined),
    ...(canDo(s, "invite") && s.invites?.length ? [section(`Invites waiting · ${s.invites.length}`, [rowsCard(inviteRows(ctx, s, o.mailReady))])] : []),
    section(`Bots · ${s.bots.length}`, [botsCard(s, mineBots)]),
    ...(canDo(s, "rename") ? [section("Name", [inputBox([field("spaceRename", "spaceRename", s.name, { onSubmit: rename }), button("Rename", rename, { kind: "secondary", size: "md" })])])] : []),
    quietButton(s.me.admin ? `Delete ${s.name}` : `Leave ${s.name}`, call("DELETE", `${A}/spaces/${sid}`, undefined, { ok: seq(toast(s.me.admin ? `${s.name} deleted` : `You left ${s.name}`), { kind: "navigate", screenId: SCREENS.spaces, replace: true }), fail: toast("Couldn't do that. Try again.", true) }), { size: "md" }),
  ]);

  return [top, segmented(SPACE_TABS, "tab"), now, shared, plans, money, people];
}
