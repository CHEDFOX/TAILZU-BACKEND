/**
 * SPACES WITH FAMILY AND FRIENDS (Spaces / DSpaces, and the boards' look for the rest): the spaces list and one space whole, "What Mom
 * can do", inviting by link or email, the space's roles, one shared thing, asking for a payment, tasks and plans for others, sharing
 * anything to a space or a person, the chats and one chat.
 *
 * Data is the routes in routes/bots/botsSpaces.ts (src/botsBots does every permission check; these screens only leave out what won't work).
 * Every write is a call, then a refresh and a short ink toast. Money is "you press pay": a yes hands over the UPI payment (bots.approve).
 * Screens listen to their live topics ("space:<id>", "spaces", "threads", "thread:<id>"), so they update when someone else changes them.
 */

import type { Node, ActionRef, ActionSpec } from "../../../../../shared/types/sdui.js";
import { PERMS, PERM_WORDS } from "../../../botsBots/spacePerms.js";
import {
  row, text, C, call, seq, col, meta, icon, open, SCREENS, box, statusMark, grow, sectionLabel, button, type BotsCtx, notice, card,
  primaryButton, page, title, emptyState, toTab, back, switchMark, picture, listRow, quietButton, chips, when, segmented,
  labelled, divider,
} from "../kit.js";
import { canUpload, uploadChip, uploadPick } from "../media.js";
import { type BotsScreen, screen } from "../registry.js";
import { invitePage } from "./spaces/invitePage.js";
import { idParam, memberPage } from "./spaces/memberPage.js";
import {
  ifFilled, A, toast, clearState, refresh, rowsCard, rowPad, type Space, personDot, names, inputBox, field, isDesk, type OneSpace, type BotSharing, failed,
  enc, write, type Role, section, type Item, iconButton, kindBadge, shortDate, canDo, labelledField, type Task, DAY, localDate,
  messagePerson,
} from "./spaces/parts.js";
import { iconBox, KIND_WORD, setState, type Targets, sharePage } from "./spaces/sharePage.js";
import { botPage, type BotPageData, type MineView, type SharedView } from "./spaces/botPage.js";
import {
  type SpacesData, plural, spaceCount, spaceDetail, taskRow, WEEKDAYS, dayKeyOf, key, ago, link,
  openChat, dayWords, clockOf, type JoinInvite, facesLine, spaceDetailState,
} from "./spaces/spaceDetail.js";

interface Thread {
  id: string; kind: "direct" | "group" | "space"; name: string; spaceId: string | null; spaceName: string; people: Array<{ userId: string; name: string; you: boolean }>;
  last: { text: string; at: number } | null; unread: number; muted: boolean; canPost: boolean; why: string;
}
interface Message {
  id: string; from: { userId: string | null; name: string; you: boolean }; text: string; at: number;
  files: Array<{ id: string; name: string; mime: string; bytes: number; kind: string; url: string }>; item: { id: string; kind: string; title: string } | null;
}
interface Contacts { people: Array<{ userId: string; name: string; spaces: string[] }>; groupSpaces: Array<{ id: string; name: string; people: Array<{ userId: string; name: string }> }> }

const kb = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** A chip that turns a switch in state on and off (a person picked or not). */
const toggleChip = (label: string, path: string): Node => row([text(label, { size: 13, lineHeight: 17, style: { color: { truthy: path, then: C.paper, else: C.ink } } })], {
  paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: { truthy: path, then: C.ink, else: C.outline }, backgroundColor: { truthy: path, then: C.ink, else: C.paper },
}, { kind: "toggleState", path });

const newSpace = ifFilled("spaceName", call("POST", `${A}/spaces`, { name: "$state.spaceName" }, { assignTo: "made", ok: seq(toast("Space made"), clearState("spaceName"), refresh), fail: toast("Couldn't make it. Try again.", true) }), "Name the space first");
const joinSpace = ifFilled("code", call("POST", `${A}/spaces/join`, { code: "$state.code" }, { assignTo: "joined", ok: seq(toast("You're in"), clearState("code"), refresh), fail: toast("That code doesn't work any more. Ask for a new one.", true) }), "Enter the invite code");

/**
 * Chats and what's given to you, at the top of Spaces only when there is something in them (a new message, a thing to do): an empty
 * door is noise. Both are always in reach from the page's quiet links too.
 */
function topRows(d: SpacesData): Node | null {
  const given = (d.given ?? []).length;
  const rows: Node[] = [
    ...(d.unread ? [row([iconBox("send"), col([text(`${plural(d.unread, "new message")}`, { size: 15, weight: 500, lineHeight: 20 }), meta("Your people wrote to you", { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      countDot(d.unread), icon("chevron", { size: 16, color: C.meta })], rowPad, open(SCREENS.chats))] : []),
    ...(given ? [row([iconBox("check"), col([text(`${plural(given, "thing")} for you`, { size: 15, weight: 500, lineHeight: 20 }), meta("Someone's counting on you", { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      countDot(given), icon("chevron", { size: 16, color: C.meta })], rowPad, open(SCREENS.spaceTasks))] : []),
  ];
  return rows.length ? rowsCard(rows) : null;
}
/** The two places that are always there, said quietly under the list. */
const quietLinks = (): Node => row([link("Chats", open(SCREENS.chats)), meta("·", { size: 13 }), link("Given to you", open(SCREENS.spaceTasks))], { gap: 6, justifyContent: "center" });

const countDot = (n: number) => box([text(n > 99 ? "99+" : String(n), { size: 11, weight: 600, color: C.paper, lineHeight: 14 })], { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 });

/** A space in the list: its faces, its name, and one line: what waits for you there, or who is in it. */
function spaceRow(s: Space): Node {
  const line = s.waiting ? `${plural(s.waiting, "payment")} ${s.waiting === 1 ? "needs" : "need"} your yes` : facesLine(s);
  return row([
    row(s.members.slice(0, 3).map((m) => box([personDot(m.name, m.you, 30)], { marginRight: -8, borderRadius: 17, borderWidth: 2, borderColor: C.paper })), { paddingRight: 8, width: 82 }),
    col([text(s.name, { size: 16, weight: 600, lineHeight: 21, lines: 1 }), row([...(s.waiting ? [statusMark("needs")] : []), meta(line, { size: 12, lines: 1 })], { gap: 6, alignItems: "center" })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    icon("chevron", { size: 16, color: C.meta }),
  ], { ...rowPad, gap: 10, alignItems: "center" }, open(SCREENS.spaces, { id: s.id }));
}

/** Joining with a code, folded behind one quiet line until it's wanted (a link opens Spaces with its code already in: joinCard). */
const joinBox = (): Node => col([
  when({ falsy: "codeOpen" }, row([link("Got an invite code? Join with it", { kind: "toggleState", path: "codeOpen" })], { justifyContent: "center" })),
  when({ truthy: "codeOpen" }, col([sectionLabel("Join with a code"), inputBox([field("code", "code", "The code you were sent", { onSubmit: joinSpace }), button("Join", joinSpace, { kind: "secondary", size: "md" })])], { gap: 8 })),
], { gap: 8 });

/** Starting a space: one button, then its name and Create. */
const startSpace = (desk: boolean): Node[] => [
  when({ falsy: "newOpen" }, primaryButton("Start a space", { kind: "toggleState", path: "newOpen" }, { wide: !desk, size: desk ? "md" : "lg" })),
  when({ truthy: "newOpen" }, col([inputBox([field("spaceName", "spaceName", "Name it: Home, Family, Goa trip…", { onSubmit: newSpace }), button("Create", newSpace, { kind: "secondary", size: "md" })])], { gap: 8 })),
];

// An invite's link (https://app.x0bot.com/s/bots.spaces?join=CODE, botsBots/spaces.ts inviteLinkOf) opens Spaces with its code: what
// it is for and Join, at the top. The code is in Join with a code too, as the way that always works.

/** The code an invite's link carried. */
const joinParam = (ctx: BotsCtx): string => String(ctx.params.join ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

/** In, then that space. */
const joinFromLink = (code: string): ActionRef => call("POST", `${A}/spaces/join`, { code }, {
  assignTo: "joined",
  ok: seq(toast("You're in"), { kind: "navigate", screenId: SCREENS.spaces, params: { id: "$state.joined.id" }, replace: true } as ActionSpec),
  fail: toast("That invite doesn't work any more. Ask for a new one.", true),
});

function joinCard(ctx: BotsCtx, d: SpacesData): Node[] {
  const code = joinParam(ctx);
  if (!code) return [];
  const inv = d.invite;
  if (inv === null) return [notice("This invite doesn't work any more. Ask for a new one.")];
  const name = inv?.name ?? "the space";
  const already = inv ? (inv.members === 1 ? "1 person is already in. Join them." : `${plural(inv.members, "person", "people")} are already in. Join them.`) : `Invite code ${code}`;
  return [card([
    col([
      text(inv ? `You're invited to ${inv.name}` : "You're invited to a space", { size: 19, weight: 700, lineHeight: 24 }),
      meta(already, { size: 13 }),
    ], { gap: 4 }),
    primaryButton(inv ? `Join ${name}` : "Join", joinFromLink(code), { wide: !isDesk(ctx), size: "md" }),
  ], { gap: 14, padding: 18 })];
}

function spacesPhone(ctx: BotsCtx, d: SpacesData) {
  const list = d.spaces ?? [];
  return page(ctx, {
    back: true, title: "Spaces", nav: "you", state: { spaceName: "", code: joinParam(ctx), newOpen: false, codeOpen: false }, live: ["spaces", "threads", ...list.map((s) => `space:${s.id}`)],
    // Pull-a-bot at both ends: what is new is a space or something given to you (none named when the spaces couldn't be read).
    pullBot: { top: true, bottom: true, ...(d.spaces ? { items: [...list.map((s) => `space:${s.id}`), ...(d.given ?? []).map((t) => `task:${t.id}`)] } : {}) },
    body: [
      col([title("Spaces"), meta("Your people, in one place.", { size: 14 })], { gap: 4 }),
      ...joinCard(ctx, d),
      ...(!d.spaces ? [emptyState({ pose: "think", title: "Couldn't load your spaces", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [
          ...[topRows(d)].filter((n): n is Node => !!n),
          ...(list.length
            ? [rowsCard(list.map((s) => spaceRow(s))), quietLinks()]
            : [emptyState({ pose: "hello", title: "Bring your people in", body: "A space for home, family or friends: shared lists and plans, money decided together, and everyone in the loop." })]),
        ]),
      joinBox(),
    ],
    footer: startSpace(false),
  });
}

function spaceLive(o: OneSpace | undefined, list: Space[]): string[] {
  return ["spaces", "threads", ...(o ? [`space:${o.space.id}`] : list.map((s) => `space:${s.id}`))];
}

function spaceOnePhone(ctx: BotsCtx, o: OneSpace, d: SpacesData) {
  // Pull-a-bot at both ends: what is new is something shared, a payment asked for, a task, or a line of the space's activity.
  const items = [
    ...o.items.map((x) => `item:${x.id}`), ...o.payments.map((p) => `pay:${p.id}`), ...o.tasks.map((t) => `task:${t.id}`),
    ...(o.space.activity ?? []).map((a) => `act:${a.id}`),
  ];
  return page(ctx, { back: true, title: o.space.name, nav: "you", state: spaceDetailState(ctx), live: spaceLive(o, []), body: spaceDetail(ctx, o, d.bots), gap: 22, pullBot: { top: true, bottom: true, items } });
}

function spacesDesk(ctx: BotsCtx, d: SpacesData) {
  const list = d.spaces ?? [];
  const sel = d.one;
  const nav = col([
    ...[topRows(d)].filter((n): n is Node => !!n),
    sectionLabel(`Your spaces · ${list.length}`),
    ...list.map((s) => col([
      row([col([text(s.name, { size: 16, weight: 600, lineHeight: 21 }), meta(spaceCount(s), { size: 12 })], { gap: 2, flexGrow: 1 }),
        row(s.members.slice(0, 4).map((m) => box([personDot(m.name, m.you, 28)], { marginRight: -6, borderRadius: 16, borderWidth: 2, borderColor: s.id === sel?.space.id ? C.surface : C.paper })), { paddingRight: 6 })], { gap: 8 }),
      ...(s.waiting ? [row([statusMark("needs"), text(`${plural(s.waiting, "payment")} ${s.waiting === 1 ? "needs" : "need"} your yes`, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8 })] : []),
    ], { gap: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: s.id === sel?.space.id ? C.surface : C.line, ...(s.id === sel?.space.id ? { backgroundColor: C.surface } : {}) }, open(SCREENS.spaces, { id: s.id }))),
    meta("What happens in a space stays in that space.", { size: 12, lineHeight: 17 }),
    quietLinks(),
    col([joinBox()], { paddingTop: 8 }),
  ], { width: 300, flexShrink: 0, gap: 10 });
  return page(ctx, {
    title: "Spaces", nav: "you", maxWidth: 1180, state: { spaceName: "", code: joinParam(ctx), ...spaceDetailState(ctx), newOpen: false, codeOpen: false }, live: spaceLive(sel, list),
    body: [
      row([
        col([row([text("You", { size: 13, color: C.grey70, lineHeight: 18 })], { minHeight: 32 }, toTab("you")), title("Spaces", { size: 26 }), meta("Your people, in one place.", { size: 14 })], { gap: 4, flexGrow: 1 }),
        box(startSpace(true), { width: 320, alignItems: "flex-end" }),
      ], { gap: 12, alignItems: "flex-end" }),
      ...joinCard(ctx, d),
      ...(!d.spaces ? [emptyState({ pose: "think", title: "Couldn't load your spaces", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [row([nav, col(sel ? spaceDetail(ctx, sel, d.bots) : [emptyState({ pose: "hello", title: list.length ? "Couldn't open that space" : "Bring your people in", body: list.length ? "Pick one on the left." : "Start a space for home, family or friends, then invite them by link or email." })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 24 })], { gap: 28, alignItems: "flex-start" })]),
    ],
  });
}

// ===================================================================== bots.space.roles
function rolesPage(ctx: BotsCtx, d: OneSpace | undefined) {
  const s = d?.space;
  if (!s) return failed(ctx, "Roles");
  const editing = s.roles.find((r) => !r.preset && r.id === idParam(ctx, "role"));
  const sid = enc(s.id);
  const permsBody = Object.fromEntries(PERMS.map((p) => [p, `$state.r_${p}`]));
  const save = ifFilled("roleName", editing
    ? write("PUT", `${A}/spaces/${sid}/roles/${enc(editing.id)}`, { name: "$state.roleName", perms: permsBody }, { ok: "Role saved", then: back() })
    : write("POST", `${A}/spaces/${sid}/roles`, { name: "$state.roleName", perms: permsBody }, { ok: "Role made", then: seq(clearState("roleName"), refresh) }), "Name the role first");
  const roleRow = (r: Role) => row([
    col([text(r.name, { size: 15, weight: 500, lineHeight: 20 }), meta(r.perms.length ? r.perms.map((p) => PERM_WORDS[p].label).join(" · ") : "Look at what's shared, nothing more", { size: 12, lines: 2 }),
      meta(`${plural(s.members.filter((m) => m.role === r.id).length, "person", "people")}${r.preset ? " · X0 Bot's" : ""}`, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(!r.preset && s.me.admin ? [icon("chevron", { size: 16, color: C.meta })] : []),
  ], rowPad, !r.preset && s.me.admin ? open(SCREENS.spaceRoles, { id: s.id, role: r.id }) : undefined);
  return page(ctx, {
    back: true, title: editing ? editing.name : "Roles", nav: "you", maxWidth: 720, live: [`space:${s.id}`],
    state: { roleName: editing?.name ?? "", ...Object.fromEntries(PERMS.map((p) => [`r_${p}`, editing ? editing.perms.includes(p) : false])) },
    body: [
      col([text(editing ? `Change ${editing.name}` : `Roles in ${s.name}`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(editing ? "Everyone with this role changes with it." : "Family, Kid and Guest are X0 Bot's. Make your own for anyone else.", { size: 13 })], { gap: 4 }),
      ...(!editing ? [rowsCard(s.roles.map(roleRow))] : []),
      ...(s.me.admin ? [section(editing ? "Name and what it can do" : "A new role", [
        inputBox([field("roleName", "roleName", "Name: Grandparent, Cook, Driver…")]),
        rowsCard(PERMS.map((p) => row([col([text(PERM_WORDS[p].label, { size: 15, lineHeight: 20 }), meta(PERM_WORDS[p].sub, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }), switchMark(`r_${p}`)], rowPad, { kind: "toggleState", path: `r_${p}` }))),
        row([button(editing ? "Save" : "Make the role", save, { kind: "primary", size: "md" }),
          ...(editing ? [button("Delete it", write("DELETE", `${A}/spaces/${sid}/roles/${enc(editing.id)}`, undefined, { ok: "Role deleted", then: back() }), { kind: "quiet", size: "md" })] : [])], { gap: 8 }),
        ...(editing ? [meta("Deleting it keeps what it gave people, just for them.", { size: 12 })] : []),
      ])] : [notice("Only the admin can make roles.", { mark: "lock" })]),
    ],
  });
}

// ===================================================================== bots.space.item

function itemPage(ctx: BotsCtx, it: Item | undefined) {
  if (!it) return failed(ctx, "This");
  const base = `${A}/items/${enc(it.id)}`;
  const add = ifFilled("line", write("PUT", base, { op: "add", text: "$state.line" }, { then: seq(clearState("line"), refresh) }), "Type what to add");
  const where = it.spaceId ? `Shared in a space by ${it.by}` : `Shared with you by ${it.by}`;
  const list = it.list.length || it.kind === "list" ? rowsCard([
    ...it.list.map((l) => row([
      row([box([...(l.done ? [icon("check", { size: 14, color: C.paper })] : [])], { width: 22, height: 22, borderRadius: 6, borderWidth: l.done ? 0 : 1.5, borderColor: C.outline, backgroundColor: l.done ? C.ink : C.paper, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
        text(l.text, { size: 15, lineHeight: 20, color: l.done ? C.meta : C.ink, style: { flexShrink: 1, ...(l.done ? { textDecorationLine: "line-through" } : {}) } })], { gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0 },
      it.canEdit ? write("PUT", base, { op: "toggle", line: l.id }) : undefined),
      ...(it.canEdit ? [iconButton("close", write("PUT", base, { op: "drop", line: l.id }), "Take it off", 36)] : []),
    ], { ...rowPad, paddingRight: 8 })),
    ...(it.canEdit ? [row([field("line", "line", "Add to the list", { onSubmit: add }), button("Add", add, { kind: "secondary", size: "md" })], { gap: 8, paddingLeft: 16, paddingRight: 8, paddingVertical: 6 })] : []),
    ...(!it.list.length && !it.canEdit ? [row([meta("Nothing on it yet.", { size: 13 })], rowPad)] : []),
  ]) : null;
  const img = it.file && it.file.mime.startsWith("image/") ? picture(it.file.url, isDesk(ctx) ? 480 : 350, isDesk(ctx) ? 320 : 240, { radius: 16, fit: "cover", background: C.surface, label: it.file.name }) : null;
  return page(ctx, {
    back: true, title: it.title, nav: "you", maxWidth: 720, state: { line: "" }, live: [`item:${it.id}`, ...(it.spaceId ? [`space:${it.spaceId}`] : [])],
    body: [
      row([kindBadge(it.kind, 44), col([text(it.title, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`${KIND_WORD[it.kind] ?? "Shared"} · ${where} · ${shortDate(ctx, it.at)}`, { size: 13 })], { gap: 2, flexShrink: 1 })], { gap: 14 }),
      ...(it.note ? [notice(`${it.by}: ${it.note}`)] : []),
      ...(it.place ? [rowsCard([listRow({ label: "Where", value: it.place }), ...(it.when ? [listRow({ label: "When", value: it.when })] : []), ...(it.who ? [listRow({ label: "Who", value: it.who })] : [])])] : []),
      ...(list ? [section(it.kind === "trip" ? "Packing" : it.canEdit ? `${it.summary} · anyone who may edit can change it` : it.summary, [list])] : []),
      ...(it.text ? [col([text(it.text, { size: 15, lineHeight: 22 })], { padding: 16, borderRadius: 18, backgroundColor: C.surface })] : []),
      ...(img ? [img] : []),
      ...(it.file ? [row([icon("clip", { size: 16 }), text(`${it.file.name} · ${kb(it.file.bytes)}`, { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(), button("Open", { kind: "openUrl", url: it.file.url, external: true }, { kind: "secondary", size: "md" })], { gap: 10 })] : []),
      ...(it.url ? [button(it.kind === "preview" ? "Open the preview" : "Open the link", { kind: "openUrl", url: it.url, external: true }, { kind: "secondary", size: "md", icon: "link" })] : []),
      ...(it.access === "view" && !it.canEdit ? [meta("Shared to look at.", { size: 12 })] : []),
      ...(it.canRemove ? [quietButton("Take it out", call("DELETE", base, undefined, { ok: seq(toast("Taken out"), back()), fail: toast("Couldn't do that. Try again.", true) }), { size: "md" })] : []),
      // Something someone else shared can be reported (App Review 1.2).
      ...(!it.byYou ? [quietButton("Report it", open(SCREENS.report, { kind: "item", id: it.id }), { size: "md", icon: "shield" })] : []),
    ],
  });
}

// ===================================================================== bots.space.pay

function payPage(ctx: BotsCtx, d: OneSpace | undefined) {
  const s = d?.space;
  if (!s) return failed(ctx, "Payment");
  if (!canDo(s, "askPay")) return page(ctx, { back: true, title: "Ask for a payment", nav: "you", body: [emptyState({ pose: "think", title: `You can't ask for payments in ${s.name}`, body: "Ask the admin to let you." })] });
  const ask = { kind: "condition", if: { falsy: "note" }, then: toast("Say what it's for"), else: ifFilled("to", call("POST", `${A}/spaces/${enc(s.id)}/payments`, { to: "$state.to", name: "$state.payee", note: "$state.note" }, {
    ok: seq(toast("Asked. Someone who approves will see it"), back()), fail: toast("Couldn't ask. Check the UPI ID.", true),
  }), "Type the UPI ID to pay") } as ActionSpec;
  const approvers = s.members.filter((m) => m.canApprove && !m.you).map((m) => m.name);
  return page(ctx, {
    back: true, title: "Ask for a payment", nav: "you", maxWidth: 640, state: { to: "", payee: "", note: "" },
    body: [
      col([text("Ask for a payment", { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`${approvers.length ? names(approvers) : "Someone who approves"} sees it in ${s.name}. If they say yes, their UPI app opens on the payee and they type the amount there.`, { size: 13 })], { gap: 4 }),
      labelledField("What for", field("note", "note", "This week's groceries")),
      labelledField("Pay to (UPI ID)", field("to", "to", "freshbasket@okaxis", { keyboard: "email-address" })),
      labelledField("Their name", field("payee", "payee", "Fresh Basket")),
      row([icon("lock", { size: 16, color: C.grey70 }), meta("X0 Bot never pays by itself. You press pay in your UPI app.", { size: 12 })], { gap: 8 }),
    ],
    footer: [primaryButton("Ask", ask, { wide: !isDesk(ctx) })],
  });
}

// ===================================================================== bots.space.tasks

interface TasksData { given?: Task[]; one?: OneSpace }

function tasksPage(ctx: BotsCtx, d: TasksData | undefined) {
  const s = d?.one?.space;
  const isNew = String(ctx.params.new ?? "");
  if (s && (isNew === "task" || isNew === "plan")) return newTaskPage(ctx, s, isNew);
  if (s) {
    const all = d!.one!.tasks;
    const mine = all.filter((t) => t.mine && t.mine.status === "todo");
    const rest = all.filter((t) => !mine.includes(t));
    return page(ctx, {
      back: true, title: `Tasks in ${s.name}`, nav: "you", maxWidth: 760, live: [`space:${s.id}`],
      body: [
        col([text(`Tasks in ${s.name}`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta("Tasks have a due time; plans go on someone's day and show on their Plan.", { size: 13 })], { gap: 4 }),
        row([
          ...(canDo(s, "tasks") ? [button("Give a task", open(SCREENS.spaceTasks, { id: s.id, new: "task" }), { kind: "secondary", size: "md", icon: "check" })] : []),
          ...(canDo(s, "plan") ? [button("Plan for someone", open(SCREENS.spaceTasks, { id: s.id, new: "plan" }), { kind: "secondary", size: "md", icon: "calendar" })] : []),
        ], { gap: 8, flexWrap: "wrap" }),
        ...(mine.length ? [section("Given to you", [rowsCard(mine.map((t) => taskRow(ctx, t)))])] : []),
        section("Everyone's", [rest.length ? rowsCard(rest.map((t) => taskRow(ctx, t))) : meta("Nothing here yet.", { size: 13 })]),
      ],
    });
  }
  const given = d?.given;
  return page(ctx, {
    back: true, title: "Given to you", nav: "you", maxWidth: 760, live: ["spaces", "plan"],
    body: [
      col([title("Given to you"), meta("Tasks and plans people in your spaces gave you. Plans also show on your Plan.", { size: 13 })], { gap: 4 }),
      ...(!given ? [emptyState({ pose: "think", title: "Couldn't load them", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : given.length ? [rowsCard(given.map((t) => taskRow(ctx, t, { showSpace: true })))]
          : [emptyState({ pose: "done", title: "Nothing to do", body: "When someone gives you a task or plans your day, it shows here." })]),
    ],
  });
}

function newTaskPage(ctx: BotsCtx, s: Space, kind: "task" | "plan") {
  const plan = kind === "plan";
  const days = Array.from({ length: 7 }, (_, i) => ctx.live.now + i * DAY);
  const dayOpts = days.map((ms, i) => ({ label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : (() => { const d = localDate(ctx, ms); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`; })(), value: dayKeyOf(ctx, ms) }));
  const times = [{ label: "9 am", value: "09:00" }, { label: "12 pm", value: "12:00" }, { label: "4 pm", value: "16:00" }, { label: "6 pm", value: "18:00" }, { label: "8 pm", value: "20:00" }];
  const people = s.members;
  const who = Object.fromEntries(people.map((m) => [m.userId, `$state.${key("w", m.userId)}`]));
  const body = { kind, title: "$state.ttl", notes: "$state.notes", people: who, day: "$state.day", time: "$state.time", minutes: "$state.mins", place: "$state.place", tz: ctx.tzOffsetMinutes };
  const save = ifFilled("ttl", call("POST", `${A}/spaces/${enc(s.id)}/tasks`, body, {
    ok: seq(toast(plan ? "On their day now" : "Task given"), back()), fail: toast(plan ? "Couldn't plan it. Pick who, a day and a time." : "Couldn't give it. Pick who it's for.", true),
  }), plan ? "Say what it is first" : "Say what the task is first");
  return page(ctx, {
    back: true, title: plan ? "Plan for someone" : "Give a task", nav: "you", maxWidth: 640,
    state: { ttl: "", notes: "", place: "", day: plan ? dayKeyOf(ctx, ctx.live.now + DAY) : "", time: plan ? "18:00" : "", mins: "60", ...Object.fromEntries(people.map((m) => [key("w", m.userId), false])) },
    body: [
      col([text(plan ? "Plan for someone" : "Give a task", { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(plan ? `It goes on their day and shows on their Plan as from you. They can say they can't.` : `They get a ping, and say Done or Can't do it.`, { size: 13 })], { gap: 4 }),
      labelledField(plan ? "What" : "Task", field("ttl", "ttl", plan ? "Pick up Rohan from school" : "Pick up the cake")),
      section("For", [row(people.map((m) => toggleChip(m.you ? "Me" : m.name, key("w", m.userId))), { gap: 8, flexWrap: "wrap" })]),
      section(plan ? "Day" : "Due", [chips([...(plan ? [] : [{ label: "No day", value: "" }]), ...dayOpts], "day")]),
      when({ truthy: "day" }, section("Time", [
        chips([...(plan ? [] : [{ label: "Any time", value: "" }]), ...times], "time"),
        inputBox([field("time", "time", "Or type a time, like 17:30")]),
      ])),
      ...(plan ? [section("How long", [segmented([{ label: "30 min", value: "30" }, { label: "1 h", value: "60" }, { label: "2 h", value: "120" }, { label: "3 h", value: "180" }], "mins")])] : []),
      labelledField("Where (if it matters)", field("place", "place", "Koramangala, School gate…")),
      ...(plan ? [] : [labelledField("Notes", field("notes", "notes", "The one with less sugar", { multiline: true }))]),
    ],
    footer: [primaryButton(plan ? "Put it on their day" : "Give the task", save, { wide: !isDesk(ctx) })],
  });
}

// ===================================================================== bots.chats and bots.thread
interface ChatsData { threads?: Thread[]; unread?: number; contacts?: Contacts; open?: ThreadRead }
interface ThreadRead { thread: Thread; messages: Message[]; more: boolean; before: number | null }

function threadAvatar(t: Thread, size = 40): Node {
  if (t.kind === "direct") return personDot(t.name, false, size);
  return box([icon(t.kind === "space" ? "folder" : "person", { size: Math.round(size * 0.45), color: C.grey70 })], { width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 });
}

function threadRow(ctx: BotsCtx, t: Thread, selected = false): Node {
  const sub = t.last?.text || (t.kind === "space" ? `Everyone in ${t.spaceName}` : t.kind === "group" ? `${names(t.people.filter((p) => !p.you).map((p) => p.name))} · ${t.spaceName}` : "Say hello");
  return row([
    threadAvatar(t),
    col([row([text(t.name, { size: 15, weight: t.unread ? 600 : 500, lineHeight: 20, lines: 1, style: { flexShrink: 1 } }), ...(t.muted ? [meta("Muted", { size: 11 })] : [])], { gap: 6 }),
      meta(sub, { size: 13, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    col([meta(t.last ? ago(ctx, t.last.at) : "", { size: 12, lines: 1 }), ...(t.unread && !t.muted ? [countDot(t.unread)] : [])], { gap: 4, alignItems: "flex-end", flexShrink: 0 }),
  ], { ...rowPad, ...(selected ? { backgroundColor: C.surface } : {}) }, open(isDesk(ctx) ? SCREENS.chats : SCREENS.thread, { id: t.id }));
}

function newChatPart(c: Contacts | undefined): Node[] {
  if (!c) return [];
  const people = c.people;
  const groups = c.groupSpaces;
  const groupOf = (g: Contacts["groupSpaces"][number]) => {
    const pick = Object.fromEntries(g.people.map((p) => [p.userId, `$state.${key("g", `${g.id}${p.userId}`)}`]));
    const make = call("POST", `${A}/threads/group`, { space: g.id, name: `$state.${key("gn", g.id)}`, people: pick }, { assignTo: "group", ok: { kind: "navigate", screenId: SCREENS.thread, params: { id: "$state.group.id" } }, fail: toast("Pick at least one person.", true) });
    return col([
      row([text(g.name, { size: 15, weight: 500, lineHeight: 20 }), grow(), link("Whole space", openChat(g.id))], { gap: 8 }),
      row(g.people.map((p) => toggleChip(p.name, key("g", `${g.id}${p.userId}`))), { gap: 8, flexWrap: "wrap" }),
      inputBox([field(key("gn", g.id), key("gn", g.id), "Name the group (if you like)"), button("Start", make, { kind: "secondary", size: "md" })]),
    ], { ...rowPad, gap: 10 });
  };
  return [
    ...(people.length ? [section("Message someone", [rowsCard(people.map((p) => row([personDot(p.name, false), col([text(p.name, { size: 15, lineHeight: 20 }), meta(`In ${names(p.spaces)}`, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }), icon("send", { size: 16, color: C.meta })], rowPad, messagePerson(p.userId))))])] : []),
    ...(groups.length ? [section("Start a group", [rowsCard(groups.map(groupOf))])] : []),
  ];
}

function chatsPhone(ctx: BotsCtx, d: ChatsData) {
  const list = d.threads;
  const making = String(ctx.params.new ?? "") === "chat";
  if (making) {
    return page(ctx, { back: true, title: "New chat", nav: "you", body: [col([title("New chat"), meta("With people in your spaces, one to one or as a group.", { size: 13 })], { gap: 4 }), ...(d.contacts && (d.contacts.people.length || d.contacts.groupSpaces.length) ? newChatPart(d.contacts) : [emptyState({ pose: "hello", title: "No one to message yet", body: "Invite people to a space first. You can message anyone in a space you share, if the space lets you." })])] });
  }
  return page(ctx, {
    back: true, title: "Chats", nav: "you", live: ["threads", "spaces"],
    body: [
      row([col([title("Chats"), meta(d.unread ? `${plural(d.unread, "new message")}` : "With people in your spaces", { size: 13 })], { gap: 4, flexGrow: 1 }), button("New", open(SCREENS.chats, { new: "chat" }), { kind: "secondary", size: "md", icon: "plus" })], { gap: 12 }),
      ...(!list ? [emptyState({ pose: "think", title: "Couldn't load your chats", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : list.length ? [rowsCard(list.map((t) => threadRow(ctx, t)))]
          : [emptyState({ pose: "hello", title: "No chats yet", body: "Message someone in a space you share, or start a group." })]),
      row([link("Blocked people", open(SCREENS.blocked))], { justifyContent: "center" }),
    ],
  });
}

const dayRule = (label: string): Node => row([box([], { height: 1, flexGrow: 1, backgroundColor: C.divider }), meta(label, { size: 12 }), box([], { height: 1, flexGrow: 1, backgroundColor: C.divider })], { gap: 10 });

function messageNodes(ctx: BotsCtx, r: ThreadRead): Node[] {
  const desk = isDesk(ctx);
  const out: Node[] = [];
  let lastDay = "", lastFrom = "";
  for (const m of r.messages) {
    const day = dayKeyOf(ctx, m.at);
    if (day !== lastDay) { out.push(dayRule(dayWords(ctx, m.at))); lastDay = day; lastFrom = ""; }
    const mine = m.from.you;
    const parts: Node[] = [];
    // A name in a group opens that person's page (bots.person: Message, Report, Block).
    if (!mine && r.thread.kind !== "direct" && lastFrom !== (m.from.userId ?? "")) {
      parts.push(m.from.userId ? row([meta(m.from.name, { size: 12 })], { minHeight: 20 }, open(SCREENS.person, { id: m.from.userId })) : meta(m.from.name, { size: 12 }));
    }
    for (const f of m.files) {
      parts.push(f.mime.startsWith("image/")
        ? box([picture(f.url, desk ? 280 : 220, desk ? 200 : 160, { radius: 14, fit: "cover", background: C.surface, label: f.name })], {}, { kind: "openUrl", url: f.url, external: true })
        : row([icon("clip", { size: 16 }), text(f.name, { size: 14, lineHeight: 19, lines: 1, style: { flexShrink: 1 } }), meta(kb(f.bytes), { size: 12 })], { gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, maxWidth: 280 }, { kind: "openUrl", url: f.url, external: true }));
    }
    if (m.item) parts.push(row([kindBadge(m.item.kind, 32), col([text(m.item.title, { size: 14, weight: 500, lineHeight: 19, lines: 2 }), meta(`${KIND_WORD[m.item.kind] ?? "Shared"} · open`, { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, maxWidth: 300 }, open(SCREENS.spaceItem, { item: m.item.id })));
    if (m.text) {
      parts.push(box([text(m.text, { size: 15, lineHeight: 21, color: mine && !desk ? C.paper : C.ink })], {
        backgroundColor: mine ? (desk ? C.surface : C.ink) : desk ? C.paper : C.surface, ...(desk && !mine ? { borderWidth: 1, borderColor: C.line } : {}),
        paddingVertical: 10, paddingHorizontal: 14, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: mine ? 18 : 6, borderBottomRightRadius: mine ? 6 : 18,
      }));
    }
    // Someone else's message can be reported, right under it (App Review 1.2).
    parts.push(mine ? meta(clockOf(ctx, m.at), { size: 11 }) : row([
      meta(clockOf(ctx, m.at), { size: 11 }),
      labelled(row([meta("Report", { size: 11 })], { minHeight: 20, paddingHorizontal: 4 }, open(SCREENS.report, { kind: "message", id: m.id, thread: r.thread.id })), `Report this message from ${m.from.name}`),
    ], { gap: 6 }));
    out.push(row([col(parts, { gap: 4, maxWidth: desk ? "78%" : "82%", alignItems: mine ? "flex-end" : "flex-start" })], { justifyContent: mine ? "flex-end" : "flex-start" }));
    lastFrom = m.from.userId ?? "";
  }
  return out;
}

function composer(ctx: BotsCtx, t: Thread): Node {
  if (!t.canPost) return notice(t.why || "You can't write here.", { mark: "lock" });
  const send = { kind: "condition", if: { all: [{ falsy: "say" }, { falsy: "sent.name" }] }, then: toast("Type something first"),
    else: seq(setState("sending", true), call("POST", `${A}/threads/${enc(t.id)}/messages`, { text: "$state.say", files: "$state.files" }, {
      ok: seq(setState("sending", false), clearState("say"), clearState("files"), clearState("sent"), refresh),
      fail: seq(setState("sending", false), toast("Couldn't send that. Try again.", true)),
    })) } as ActionSpec;
  return col([
    ...(canUpload(ctx) ? [uploadChip("files")] : []),
    row([
      ...(canUpload(ctx) ? [iconButton("clip", uploadPick(isDesk(ctx) ? "file" : "photo", "files"), "Send a photo or file", 44)] : []),
      box([inputBox([field("say", "say", `Message ${t.name}`, { onSubmit: send }), labelled(box([icon("send", { size: 20, color: C.paper })], { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0, backgroundColor: C.ink }, send), "Send")], { radius: 28, pad: 18 })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ], { gap: 6, alignItems: "center" }),
  ], { gap: 8 });
}

function threadHead(ctx: BotsCtx, t: Thread): Node {
  const tid = enc(t.id);
  const people = t.kind === "direct" ? (t.spaceName || "One to one") : `${names(t.people.map((p) => (p.you ? "you" : p.name)))}${t.spaceName ? ` · ${t.spaceName}` : ""}`;
  // One to one: the other person's page, where they can be reported or blocked.
  const other = t.kind === "direct" ? t.people.find((p) => !p.you) : undefined;
  return row([
    ...(isDesk(ctx) ? [] : [labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back")]),
    threadAvatar(t, 36),
    col([text(t.name, { size: 17, weight: 600, lineHeight: 22, lines: 1 }), meta(people, { size: 12, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    link(t.muted ? "Unmute" : "Mute", write("PUT", `${A}/threads/${tid}`, { muted: !t.muted }, { ok: t.muted ? "Unmuted" : "Muted" })),
    ...(other ? [iconButton("more", open(SCREENS.person, { id: other.userId }), `Report or block ${other.name}`, 40)] : []),
    ...(t.kind === "group" ? [link("Leave", call("DELETE", `${A}/threads/${tid}`, undefined, { ok: seq(toast("You left the group"), { kind: "navigate", screenId: SCREENS.chats, replace: true }), fail: toast("Couldn't leave. Try again.", true) }))] : []),
  ], { gap: 8 });
}

function threadBody(ctx: BotsCtx, r: ThreadRead): Node[] {
  const params = ctx.params;
  const older = r.more && r.before ? [row([link("Older messages", open(SCREENS.thread, { id: r.thread.id, before: r.before }))], { justifyContent: "center" })] : [];
  const paged = Number(params.before) > 0;
  return [
    ...older,
    ...(r.messages.length ? messageNodes(ctx, r) : [emptyState({ pose: "hello", title: r.thread.kind === "space" ? `Everyone in ${r.thread.spaceName} sees this chat` : "Say hello", body: "Messages, photos and things you share show here." })]),
    ...(paged ? [row([link("Back to the newest", { kind: "navigate", screenId: SCREENS.thread, params: { id: r.thread.id }, replace: true })], { justifyContent: "center" })] : []),
  ];
}

function threadPhone(ctx: BotsCtx, r: ThreadRead | undefined) {
  if (!r) return failed(ctx, "This chat", { nav: "you" });
  return page(ctx, {
    title: r.thread.name, nav: "you", state: { say: "", files: [], sending: false }, live: [`thread:${r.thread.id}`], gap: 14,
    body: [threadHead(ctx, r.thread), ...threadBody(ctx, r)],
    footer: Number(ctx.params.before) > 0 ? [] : [composer(ctx, r.thread)],
  });
}

function chatsDesk(ctx: BotsCtx, d: ChatsData) {
  const list = d.threads ?? [];
  const r = d.open;
  const making = String(ctx.params.new ?? "") === "chat";
  const left = col([
    row([title("Chats", { size: 24 }), grow(), button("New", open(SCREENS.chats, { new: "chat" }), { kind: "secondary", size: "md", icon: "plus" })], { gap: 8 }),
    ...(!d.threads ? [emptyState({ pose: "think", title: "Couldn't load your chats", action: { label: "Try again", onPress: refresh } })]
      : list.length ? [rowsCard(list.map((t) => threadRow(ctx, t, t.id === r?.thread.id)))] : [meta("No chats yet. Message someone in a space you share.", { size: 13 })]),
  ], { width: 320, flexShrink: 0, gap: 14 });
  const right = making ? col([text("New chat", { size: 20, weight: 600, lineHeight: 26 }), ...newChatPart(d.contacts)], { gap: 18, flexGrow: 1, flexShrink: 1, minWidth: 0 })
    : r ? col([threadHead(ctx, r.thread), divider(), ...threadBody(ctx, r), ...(Number(ctx.params.before) > 0 ? [] : [composer(ctx, r.thread)])], { gap: 14, flexGrow: 1, flexShrink: 1, minWidth: 0 })
      : col([emptyState({ pose: "hello", title: "Pick a chat", body: "Or start one with New." })], { flexGrow: 1 });
  return page(ctx, {
    title: "Chats", nav: "you", maxWidth: 1180, state: { say: "", files: [], sending: false }, live: ["threads", ...(r ? [`thread:${r.thread.id}`] : [])],
    body: [row([left, right], { gap: 28, alignItems: "flex-start" })],
  });
}

// ===================================================================== the screens

type Api = Parameters<NonNullable<BotsScreen["load"]>>[1];
/** One space whole, and who shares what from their own bots there (for its sub-bots). */
const oneSpace = async (deps: Api, id: string): Promise<OneSpace | undefined> => {
  const [one, sharing] = await Promise.all([
    deps.api<OneSpace>("GET", `${A}/spaces/${enc(id)}`).catch(() => undefined),
    deps.api<{ bots: BotSharing[] }>("GET", `${A}/spaces/${enc(id)}/sharing`).then((r) => r.bots, () => undefined),
  ]);
  return one ? { ...one, ...(sharing ? { sharing } : {}) } : undefined;
};

export const spacesScreens: BotsScreen[] = [
  screen<SpacesData>({
    id: SCREENS.spaces,
    load: async (ctx, deps) => {
      const id = idParam(ctx), join = joinParam(ctx);
      const [sp, bots, given, one, invite] = await Promise.all([
        deps.api<{ spaces: Space[]; you: string; unread: number }>("GET", `${A}/spaces`).catch(() => undefined),
        deps.api<{ bots: SpacesData["bots"] }>("GET", "/v1/bots").then((r) => r.bots).catch(() => undefined),
        deps.api<{ tasks: Task[] }>("GET", `${A}/tasks/given`).then((r) => r.tasks).catch(() => undefined),
        id ? oneSpace(deps, id) : Promise.resolve(undefined),
        // An invite's link: what it is for.
        join ? deps.api<{ invite: JoinInvite | null }>("GET", `${A}/spaces/join/${enc(join)}`).then((r) => r.invite ?? null, () => undefined) : Promise.resolve(undefined),
      ]);
      // The window always shows one: the asked one, else the first.
      const first = !one && ctx.client === "desktop" && sp?.spaces[0] ? await oneSpace(deps, sp.spaces[0].id) : undefined;
      return { spaces: sp?.spaces, you: sp?.you, unread: sp?.unread, bots, given, one: one ?? first, ...(join ? { invite } : {}) };
    },
    build: (ctx, d) => (isDesk(ctx) ? spacesDesk(ctx, d ?? {}) : d?.one && idParam(ctx) ? spaceOnePhone(ctx, d.one, d) : idParam(ctx) && d?.spaces ? failed(ctx, "This space") : spacesPhone(ctx, d ?? {})),
  }),
  screen<BotPageData>({
    id: SCREENS.spaceBot,
    load: async (ctx, deps) => {
      const base = `${A}/spaces/${enc(idParam(ctx))}/bots/${enc(String(ctx.params.bot ?? ""))}`;
      const [shared, mine] = await Promise.all([
        deps.api<SharedView>("GET", `${base}/shared`).catch(() => undefined),
        deps.api<MineView>("GET", `${base}/mine`).catch(() => undefined),
      ]);
      return { shared, mine };
    },
    build: botPage,
  }),
  screen<OneSpace>({ id: SCREENS.spaceMember, load: (ctx, deps) => deps.api<OneSpace>("GET", `${A}/spaces/${enc(idParam(ctx))}`), build: memberPage }),
  screen<OneSpace>({ id: SCREENS.spaceInvite, load: (ctx, deps) => deps.api<OneSpace>("GET", `${A}/spaces/${enc(idParam(ctx))}`), build: invitePage }),
  screen<OneSpace>({ id: SCREENS.spaceRoles, load: (ctx, deps) => deps.api<OneSpace>("GET", `${A}/spaces/${enc(idParam(ctx))}`), build: rolesPage }),
  screen<OneSpace>({ id: SCREENS.spacePay, load: (ctx, deps) => deps.api<OneSpace>("GET", `${A}/spaces/${enc(idParam(ctx))}`), build: payPage }),
  screen<Item>({ id: SCREENS.spaceItem, load: (ctx, deps) => deps.api<{ item: Item }>("GET", `${A}/items/${enc(idParam(ctx, "item"))}`).then((r) => r.item), build: itemPage }),
  screen<TasksData>({
    id: SCREENS.spaceTasks,
    load: async (ctx, deps) => {
      const id = idParam(ctx);
      if (id) return { one: await oneSpace(deps, id) };
      return { given: await deps.api<{ tasks: Task[] }>("GET", `${A}/tasks/given`).then((r) => r.tasks).catch(() => undefined) };
    },
    build: (ctx, d) => (idParam(ctx) && !d?.one ? failed(ctx, "Tasks") : tasksPage(ctx, d)),
  }),
  screen<Targets>({ id: SCREENS.share, load: (_ctx, deps) => deps.api<Targets>("GET", `${A}/share/targets`), build: sharePage }),
  screen<ChatsData>({
    id: SCREENS.chats,
    load: async (ctx, deps) => {
      const id = idParam(ctx);
      const [t, contacts] = await Promise.all([
        deps.api<{ threads: Thread[]; unread: number }>("GET", `${A}/threads`).catch(() => undefined),
        String(ctx.params.new ?? "") === "chat" ? deps.api<Contacts>("GET", `${A}/threads/contacts`).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const pick = id || (ctx.client === "desktop" && !ctx.params.new ? t?.threads[0]?.id : "");
      const openOne = pick ? await deps.api<ThreadRead>("GET", `${A}/threads/${enc(pick)}`).catch(() => undefined) : undefined;
      return { threads: t?.threads, unread: t?.unread, contacts, open: openOne };
    },
    build: (ctx, d) => (isDesk(ctx) ? chatsDesk(ctx, d ?? {}) : chatsPhone(ctx, d ?? {})),
  }),
  screen<ChatsData>({
    id: SCREENS.thread,
    load: async (ctx, deps) => {
      const id = idParam(ctx);
      const before = Number(ctx.params.before) || 0;
      const [openOne, t] = await Promise.all([
        deps.api<ThreadRead>("GET", `${A}/threads/${enc(id)}${before ? `?before=${before}` : ""}`).catch(() => undefined),
        ctx.client === "desktop" ? deps.api<{ threads: Thread[]; unread: number }>("GET", `${A}/threads`).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      return { open: openOne, threads: t?.threads, unread: t?.unread };
    },
    build: (ctx, d) => (isDesk(ctx) ? chatsDesk(ctx, d ?? {}) : threadPhone(ctx, d?.open)),
  }),
];
