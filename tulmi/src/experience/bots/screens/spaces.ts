/**
 * SPACES WITH FAMILY AND FRIENDS (Spaces / DSpaces, and the boards' look for the rest): the spaces list and one space whole, "What Mom
 * can do", inviting by link or email, the space's roles, one shared thing, asking for a payment, tasks and plans for others, sharing
 * anything to a space or a person, the chats and one chat.
 *
 * Data is the routes in routes/botsSpaces.ts (src/botsBots does every permission check; these screens only leave out what won't work).
 * Every write is a call, then a refresh and a short ink toast. Money is "you press pay": a yes hands over the UPI payment (bots.approve).
 * Screens listen to their live topics ("space:<id>", "spaces", "threads", "thread:<id>"), so they update when someone else changes them.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import { PERM_WORDS, PERMS, type Perm } from "../../../botsBots/spacePerms.js";
import {
  back, botAvatar, botLook, botRoute, box, button, C, call, chip, chips, col, divider, emptyState, FACE, grid, grow, icon, labelled,
  listRow, meta, notice, open, page, picture, primaryButton, quietButton, row, rupees, SCREENS, secondaryButton, sectionLabel, segmented,
  seq, statusMark, switchMark, text, title, toTab, when, type BotsCtx,
} from "../kit.js";
import { canUpload, uploadChip, uploadPick } from "../media.js";
import { screen, type BotsScreen } from "../registry.js";

const A = "/v1/botsapp/bots";
const enc = encodeURIComponent;
const MIN = 60_000, DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ===================================================================== what the screens read

interface Member { userId: string; name: string; you: boolean; maker: boolean; canApprove: boolean; joinedAt: number; perms: Perm[]; role: string | null; roleName: string }
interface Role { id: string; name: string; perms: Perm[]; preset: boolean }
interface Invite { code: string; link: string; email: string | null; expiresAt: number; roleName: string; perms: Perm[]; byYou: boolean; by: string; mail: "queued" | "sent" | "failed" | null }
interface SpaceBot { slug: string; name: string; colour: string; addedBy: string; byYou: boolean }
interface Space {
  id: string; name: string; mine: boolean; me: { admin: boolean; perms: Perm[] }; members: Member[]; bots: SpaceBot[];
  invite: { code: string; expiresAt: number } | null; roles: Role[]; waiting?: number;
  invites?: Invite[]; activity?: Array<{ id: string; kind: string; text: string; at: number; by: string }> | null;
}
interface ListLine { id: string; text: string; done: boolean }
interface Item {
  id: string; kind: string; title: string; spaceId: string | null; threadId: string | null; by: string; byYou: boolean; at: number; updatedAt: number;
  access: "view" | "edit"; canEdit: boolean; canRemove: boolean; summary: string; text: string; url: string; note: string; list: ListLine[];
  place: string; when: string; who: string; bot: string; file: { name: string; mime: string; bytes: number; kind: string; url: string } | null;
}
interface Payment {
  id: string; amountPaise: number; payee: string; vpa: string; note: string; status: "waiting" | "approved" | "declined" | "paid" | "cancelled"; at: number;
  askedBy: string; byYou: boolean; decidedBy: string; decidedAt: number | null; paidAt: number | null; upi: string | null;
  canDecide: boolean; canCancel: boolean; canMarkPaid: boolean;
}
interface Task {
  id: string; spaceId: string; spaceName: string; kind: "task" | "plan"; title: string; notes: string; place: string; at: number | null; end: number | null; allDay: boolean;
  setBy: string; byYou: boolean; people: Array<{ userId: string; name: string; you: boolean; status: "todo" | "done" | "cant"; note: string }>;
  mine: { status: "todo" | "done" | "cant"; note: string } | null; done: boolean; canRemove: boolean;
}
interface Thread {
  id: string; kind: "direct" | "group" | "space"; name: string; spaceId: string | null; spaceName: string; people: Array<{ userId: string; name: string; you: boolean }>;
  last: { text: string; at: number } | null; unread: number; muted: boolean; canPost: boolean; why: string;
}
interface Message {
  id: string; from: { userId: string | null; name: string; you: boolean }; text: string; at: number;
  files: Array<{ id: string; name: string; mime: string; bytes: number; kind: string; url: string }>; item: { id: string; kind: string; title: string } | null;
}
interface Contacts { people: Array<{ userId: string; name: string; spaces: string[] }>; groupSpaces: Array<{ id: string; name: string; people: Array<{ userId: string; name: string }> }> }

// ===================================================================== small helpers

const refresh: ActionSpec = { kind: "refresh" };
const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const clearState = (path: string): ActionSpec => ({ kind: "clearState", path });
const isDesk = (ctx: BotsCtx) => ctx.client === "desktop";
const idParam = (ctx: BotsCtx, k = "id"): string => String(ctx.params[k] ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
/** A state key from an id: letters, digits and _. */
const key = (prefix: string, id: string) => `${prefix}_${id.replace(/[^a-z0-9]/gi, "")}`;

/** A write: the call, then a quiet toast and a refresh; a failure says so in plain words. */
function write(method: "POST" | "PUT" | "DELETE", path: string, bodyArg?: Record<string, unknown>, o: { ok?: string; fail?: string; then?: ActionRef } = {}): ActionRef {
  return call(method, path, bodyArg, { ok: seq(o.ok ? toast(o.ok) : undefined, o.then ?? refresh), fail: toast(o.fail ?? "Couldn't do that. Try again.", true) });
}
const ifFilled = (path: string, then: ActionRef, empty = "Type something first"): ActionSpec => ({ kind: "condition", if: { falsy: path }, then: toast(empty), else: then });

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const names = (list: string[]) => (list.length <= 1 ? list[0] ?? "" : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
const localDate = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * MIN);
const dayKeyOf = (ctx: BotsCtx, ms: number) => localDate(ctx, ms).toISOString().slice(0, 10);
function clockOf(ctx: BotsCtx, ms: number): string {
  const d = localDate(ctx, ms);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}
const shortDate = (ctx: BotsCtx, ms: number) => { const d = localDate(ctx, ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "Today", "Tomorrow", "Thu 29 Oct". */
function dayWords(ctx: BotsCtx, ms: number): string {
  const k = dayKeyOf(ctx, ms);
  if (k === dayKeyOf(ctx, ctx.live.now)) return "Today";
  if (k === dayKeyOf(ctx, ctx.live.now + DAY)) return "Tomorrow";
  if (k === dayKeyOf(ctx, ctx.live.now - DAY)) return "Yesterday";
  const d = localDate(ctx, ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "4 min ago", "9:30 am", "Yesterday", "2 Oct". */
function ago(ctx: BotsCtx, ms: number): string {
  const m = Math.max(0, Math.round((ctx.live.now - ms) / MIN));
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, ctx.live.now)) return clockOf(ctx, ms);
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, ctx.live.now - DAY)) return "Yesterday";
  return shortDate(ctx, ms);
}
const whenLine = (ctx: BotsCtx, at: number | null, allDay: boolean) => (at === null ? "" : allDay ? dayWords(ctx, at) : `${dayWords(ctx, at)}, ${clockOf(ctx, at)}`);
const kb = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const canDo = (s: Space, p: Perm) => s.me.perms.includes(p);

/** A text field the kit's way: no frame of its own, Geist, 44 tall. Put it in `inputBox`. */
function field(id: string, path: string, placeholder: string, o: { onSubmit?: ActionRef; multiline?: boolean; keyboard?: "numeric" | "email-address" } = {}): Node {
  return {
    type: "TextField", id, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: o.multiline ? 72 : 44, color: C.ink, returnKeyType: o.onSubmit ? "send" : "done", ...(o.multiline ? { multiline: true } : {}),
      ...(o.keyboard ? { keyboardType: o.keyboard, autoCapitalize: "none" } : {}),
    },
    ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: o.multiline ? 72 : 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
      fontSize: 15, lineHeight: 22, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}
function inputBox(children: Node[], o: { radius?: number; pad?: number } = {}): Node {
  return row(children, { gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: o.radius ?? 14, paddingLeft: o.pad ?? 14, paddingRight: 6, paddingVertical: 4, minHeight: 48, backgroundColor: C.paper });
}
const labelledField = (label: string, f: Node) => col([sectionLabel(label), inputBox([f])], { gap: 8 });
/** A chip that turns a switch in state on and off (a person picked or not). */
const toggleChip = (label: string, path: string): Node => row([text(label, { size: 13, lineHeight: 17, style: { color: { truthy: path, then: C.paper, else: C.ink } } })], {
  paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: { truthy: path, then: C.ink, else: C.outline }, backgroundColor: { truthy: path, then: C.ink, else: C.paper },
}, { kind: "toggleState", path });

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
function personDot(name: string, you: boolean, size = 32): Node {
  return box([text(initial(name), { size: 13, weight: 600, color: you ? C.paper : C.grey70, lineHeight: 16 })], {
    width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: you ? C.ink : C.surface, borderWidth: you ? 0 : 1, borderColor: C.outline,
  });
}
function iconButton(name: Parameters<typeof icon>[0], onPress: ActionRef, label: string, size = 40): Node {
  return labelled(box([icon(name, { size: 18, color: C.grey70 })], { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress), label);
}
const head = (label: string, right?: Node): Node => row([sectionLabel(label), grow(), ...(right ? [right] : [])], { minHeight: 24 });
const link = (label: string, onPress: ActionRef): Node => row([text(label, { size: 13, weight: 500, lineHeight: 18 })], { minHeight: 32, paddingHorizontal: 4 }, onPress);
const section = (label: string, children: Node[], right?: Node): Node => col([head(label, right), ...children], { gap: 8, minWidth: 0 });
/** A list card from rows that are already rows (with their own padding). */
const rowsCard = (rows: Node[]): Node => col(rows.flatMap((r, i) => (i ? [divider(), r] : [r])), { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" });
const rowPad = { paddingVertical: 12, paddingHorizontal: 16, minHeight: 52, gap: 12 };

const KIND_ICON: Record<string, Parameters<typeof icon>[0]> = { list: "check", trip: "pin", plan: "calendar", note: "notes", file: "clip", link: "link", answer: "spark", preview: "code", text: "notes" };
const KIND_WORD: Record<string, string> = { list: "List", trip: "Trip", plan: "Plan", note: "Note", file: "File", link: "Link", answer: "Answer", preview: "Preview", text: "Note" };
const kindBadge = (kind: string, size = 36): Node => box([icon(KIND_ICON[kind] ?? "notes", { size: 18, color: C.grey70 })], { width: size, height: size, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 });

function failed(ctx: BotsCtx, what: string, o: { back?: boolean; nav?: string } = {}) {
  return page(ctx, { back: o.back ?? true, title: what, nav: o.nav ?? "you", body: [emptyState({ pose: "think", title: `Couldn't open ${what.toLowerCase()}`, body: "It may have gone, or the connection dropped. Try again.", action: { label: "Try again", onPress: refresh } })] });
}

// ===================================================================== bots.spaces: the list

interface SpacesData { spaces?: Space[]; you?: string; unread?: number; given?: Task[]; one?: { space: Space; items: Item[]; payments: Payment[]; tasks: Task[]; mailReady: boolean }; bots?: Array<{ slug: string; name: string; colour: string; builtin: boolean }> }

const spaceCount = (s: Space) => `${plural(s.members.length, "person", "people")} · ${plural(s.bots.length, "bot")}`;
function approversLine(s: Space): string {
  const yes = s.members.filter((m) => m.canApprove).map((m) => (m.you ? "You" : m.name));
  const ask = s.members.filter((m) => !m.canApprove && m.perms.includes("askPay")).map((m) => (m.you ? "you" : m.name));
  return `${names(yes)}${ask.length ? ` · ${names(ask)} can ask` : ""}`;
}
const youAre = (s: Space) => (s.me.admin ? "You're the admin" : `You're ${s.members.find((m) => m.you)?.roleName ?? "in it"}`);
const memberName = (m: Member) => (m.you ? `${m.name} (you)` : m.name);

const newSpace = ifFilled("spaceName", call("POST", `${A}/spaces`, { name: "$state.spaceName" }, { assignTo: "made", ok: seq(toast("Space made"), clearState("spaceName"), refresh), fail: toast("Couldn't make it. Try again.", true) }), "Name the space first");
const joinSpace = ifFilled("code", call("POST", `${A}/spaces/join`, { code: "$state.code" }, { assignTo: "joined", ok: seq(toast("You're in"), clearState("code"), refresh), fail: toast("That code doesn't work, or it's for another email.", true) }), "Enter the invite code");
const openChat = (spaceId: string): ActionRef => call("POST", `${A}/threads/group`, { space: spaceId, people: "all" }, { assignTo: "chat", ok: { kind: "navigate", screenId: SCREENS.thread, params: { id: "$state.chat.id" } }, fail: toast("Couldn't open the chat. Try again.", true) });
const messagePerson = (userId: string): ActionRef => call("POST", `${A}/threads/direct`, { person: userId }, { assignTo: "dm", ok: { kind: "navigate", screenId: SCREENS.thread, params: { id: "$state.dm.id" } }, fail: toast("You can't message them from here.", true) });

/** Chats and what's given to you: the two ways in at the top of Spaces. */
function topRows(d: SpacesData): Node {
  const given = (d.given ?? []).length;
  return rowsCard([
    row([iconBox("send"), col([text("Chats", { size: 15, weight: 500, lineHeight: 20 }), meta(d.unread ? `${plural(d.unread, "new message")}` : "Message people in your spaces", { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      ...(d.unread ? [countDot(d.unread)] : []), icon("chevron", { size: 16, color: C.meta })], rowPad, open(SCREENS.chats)),
    row([iconBox("check"), col([text("Given to you", { size: 15, weight: 500, lineHeight: 20 }), meta(given ? `${plural(given, "thing")} to do` : "Tasks and plans people give you show here", { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      ...(given ? [countDot(given)] : []), icon("chevron", { size: 16, color: C.meta })], rowPad, open(SCREENS.spaceTasks)),
  ]);
}
const iconBox = (name: Parameters<typeof icon>[0]) => box([icon(name, { size: 18 })], { width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 });
const countDot = (n: number) => box([text(n > 99 ? "99+" : String(n), { size: 11, weight: 600, color: C.paper, lineHeight: 14 })], { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 });

function spaceSummary(s: Space): Node {
  const rs = { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.divider };
  return col([
    row([col([text(s.name, { size: 17, weight: 600, lineHeight: 22 }), meta(`${spaceCount(s)} · ${youAre(s)}`, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }), icon("chevron", { size: 16, color: C.meta })], { ...rs, gap: 10 }, open(SCREENS.spaces, { id: s.id })),
    row([row(s.members.slice(0, 5).map((m) => box([personDot(m.name, m.you)], { marginRight: -8, borderRadius: 18, borderWidth: 2, borderColor: C.paper })), { paddingRight: 8 }), text(names(s.members.map(memberName)), { size: 14, lineHeight: 19, lines: 2, style: { flexShrink: 1 } })], { ...rs, gap: 12 }),
    row([col([text("Who can approve payments", { size: 14, lineHeight: 19 }), meta(approversLine(s), { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 })], { ...rs, gap: 10, borderBottomWidth: s.waiting ? 1 : 0 }),
    ...(s.waiting ? [row([statusMark("needs"), text(`${plural(s.waiting, "payment")} ${s.waiting === 1 ? "waits" : "wait"} for your yes`, { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(), text("Review", { size: 13, color: C.meta, lineHeight: 18 })], { ...rs, gap: 10, borderBottomWidth: 0 }, open(SCREENS.spaces, { id: s.id }))] : []),
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" });
}

const joinBox = (): Node => col([sectionLabel("Join with a code"), inputBox([field("code", "code", "Invite code", { onSubmit: joinSpace }), button("Join", joinSpace, { kind: "secondary", size: "md" })])], { gap: 8 });

function spacesPhone(ctx: BotsCtx, d: SpacesData) {
  const list = d.spaces ?? [];
  return page(ctx, {
    back: true, title: "Spaces", nav: "you", state: { spaceName: "", code: "" }, live: ["spaces", "threads", ...list.map((s) => `space:${s.id}`)],
    body: [
      col([title("Spaces"), meta("Family and friends: share bots, lists and plans, give tasks, ask for payments, and chat.", { size: 13 })], { gap: 4 }),
      ...(!d.spaces ? [emptyState({ pose: "think", title: "Couldn't load your spaces", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [topRows(d), ...(list.length ? list.map((s) => spaceSummary(s)) : [emptyState({ pose: "hello", title: "No spaces yet", body: "Make one for home or your friends, then invite people by link or email." })])]),
      joinBox(),
      inputBox([field("spaceName", "spaceName", "Name a new space: Home, Studio…", { onSubmit: newSpace })]),
    ],
    footer: [secondaryButton("New space", newSpace, { wide: true })],
  });
}

// ===================================================================== one space, whole

function payRow(ctx: BotsCtx, s: Space, p: Payment): Node {
  const amount = rupees(p.amountPaise);
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
    row([statusMark(mark), col([text(`${amount} to ${p.payee}`, { size: 15, weight: 500, lineHeight: 20 }), meta([p.note, status].filter(Boolean).join(" · "), { size: 12, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }), meta(shortDate(ctx, p.at), { size: 12 })], { gap: 12, alignItems: "flex-start" }),
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
function taskRow(ctx: BotsCtx, t: Task, o: { showSpace?: boolean } = {}): Node {
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

function inviteRows(ctx: BotsCtx, s: Space, mailReady: boolean): Node[] {
  return (s.invites ?? []).map((i) => {
    const msg = `Join ${s.name} on Tailzu: ${i.link}`;
    const mail = !i.email ? `Anyone with the link · good till ${shortDate(ctx, i.expiresAt)}`
      : i.mail === "sent" ? "Email sent" : i.mail === "failed" ? "The email didn't go. Send the link yourself."
        : mailReady ? "Email on its way" : "Email waits to go out (email isn't switched on yet). Send the link yourself meanwhile.";
    return col([
      row([col([text(i.email ?? `Link · ${i.roleName}`, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta(`${i.email ? `${i.roleName} · ` : ""}${mail}`, { size: 12, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ...(i.byYou || s.me.admin ? [iconButton("close", write("DELETE", `${A}/spaces/${enc(s.id)}/invites/${enc(i.code)}`, undefined, { ok: "Invite taken back" }), "Take it back", 36)] : [])], { gap: 10 }),
      row([
        button(isDesk(ctx) ? "Copy link" : "Share link", isDesk(ctx) ? { kind: "copyText", text: i.link, message: "Link copied" } : { kind: "share", text: msg, title: `Join ${s.name}` }, { kind: "secondary", size: "md", icon: "link" }),
        meta(`Code ${i.code}`, { size: 12 }),
      ], { gap: 10, flexWrap: "wrap" }),
    ], { ...rowPad, gap: 10 });
  });
}

function activityRows(ctx: BotsCtx, s: Space, max = 8): Node | null {
  if (!s.activity?.length) return null;
  return col(s.activity.slice(0, max).map((a) => row([box([], { width: 6, height: 6, borderRadius: 3, backgroundColor: C.idle, marginTop: 7 }), text(a.text, { size: 13, lineHeight: 19, style: { flexGrow: 1, flexShrink: 1 } }), meta(ago(ctx, a.at), { size: 12 })], { gap: 10, alignItems: "flex-start" })), { gap: 8 });
}

interface OneSpace { space: Space; items: Item[]; payments: Payment[]; tasks: Task[]; mailReady: boolean }

function spaceDetail(ctx: BotsCtx, o: OneSpace, mineBots: SpacesData["bots"]): Node[] {
  const s = o.space;
  const waiting = o.payments.filter((p) => p.canDecide);
  const forMe = o.tasks.filter((t) => t.mine && t.mine.status === "todo");
  const open_ = o.tasks.filter((t) => !t.done && !forMe.includes(t)).slice(0, 6);
  const history = o.payments.filter((p) => !p.canDecide).slice(0, 6);
  const sid = enc(s.id);
  const newList = ifFilled("listName", call("POST", `${A}/spaces/${sid}/lists`, { title: "$state.listName" }, { assignTo: "newList", ok: seq(clearState("listName"), toast("List made"), { kind: "navigate", screenId: SCREENS.spaceItem, params: { item: "$state.newList.item.id" } }), fail: toast("Couldn't make it. Try again.", true) }), "Name the list first");
  const desk = isDesk(ctx);

  const top = row([
    col([text(s.name, { size: desk ? 26 : 22, weight: 700, tracking: -0.5, lineHeight: desk ? 32 : 28 }), meta(`${spaceCount(s)} · ${youAre(s)}`, { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
    button("Chat", openChat(s.id), { kind: "secondary", size: "md", icon: "send" }),
    ...(canDo(s, "invite") ? [button("Invite", open(SCREENS.spaceInvite, { id: s.id }), { kind: "secondary", size: "md", icon: "plus" })] : []),
  ], { gap: 8, flexWrap: "wrap" });

  const needs = [
    ...waiting.map((p) => payRow(ctx, s, p)),
    ...forMe.map((t) => taskRow(ctx, t)),
  ];

  const shared = section(`Shared · ${o.items.length}`, [
    ...(o.items.length ? [rowsCard(o.items.slice(0, 8).map((it) => itemRow(ctx, it)))] : [meta("Lists, trips, notes, files and links people share land here. Share from any page with Share.", { size: 13 })]),
    ...(canDo(s, "share") ? [inputBox([field("listName", "listName", "New list: Groceries, Packing…", { onSubmit: newList }), button("Make", newList, { kind: "secondary", size: "md" })])] : []),
  ]);

  const tasks = section("Tasks and plans", [
    ...(open_.length ? [rowsCard(open_.map((t) => taskRow(ctx, t)))] : [meta(canDo(s, "tasks") || canDo(s, "plan") ? "Give someone a task, or put something on their day." : "Nothing given out right now.", { size: 13 })]),
    row([
      ...(canDo(s, "tasks") ? [button("Give a task", open(SCREENS.spaceTasks, { id: s.id, new: "task" }), { kind: "secondary", size: "md", icon: "check" })] : []),
      ...(canDo(s, "plan") ? [button("Plan for someone", open(SCREENS.spaceTasks, { id: s.id, new: "plan" }), { kind: "secondary", size: "md", icon: "calendar" })] : []),
    ], { gap: 8, flexWrap: "wrap" }),
  ], link("All", open(SCREENS.spaceTasks, { id: s.id })));

  const pays = section("Payments", [
    row([col([text("Who can approve payments", { size: 14, lineHeight: 19 }), meta(`${approversLine(s)}. ${s.name} never pays by itself: you press pay in your UPI app.`, { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 10 }),
    ...(history.length ? [rowsCard(history.map((p) => payRow(ctx, s, p)))] : []),
    ...(canDo(s, "askPay") ? [button("Ask for a payment", open(SCREENS.spacePay, { id: s.id }), { kind: "secondary", size: "md", icon: "rupee" })] : []),
  ]);

  const members = section(`People · ${s.members.length}`, [rowsCard(s.members.map((m) => memberRow(s, m)))], s.me.admin ? link("Roles", open(SCREENS.spaceRoles, { id: s.id })) : undefined);
  const bots = section(`Bots · ${s.bots.length}`, [botsCard(s, mineBots)]);
  const log = activityRows(ctx, s);
  const rename = ifFilled("spaceRename", write("PUT", `${A}/spaces/${sid}`, { name: "$state.spaceRename" }, { ok: "Renamed" }), "Type the new name");

  return [
    top,
    ...(needs.length ? [section("Needs you", [rowsCard(needs)])] : []),
    ...(desk ? [grid([col([shared, tasks], { gap: 22, minWidth: 0 }), col([members, bots], { gap: 22, minWidth: 0 })], 2, 24)] : [shared, tasks, members, bots]),
    pays,
    ...(canDo(s, "invite") && s.invites?.length ? [section("Open invites", [rowsCard(inviteRows(ctx, s, o.mailReady))])] : []),
    ...(log ? [section("Activity", [log])] : []),
    ...(canDo(s, "rename") ? [section("Name", [inputBox([field("spaceRename", "spaceRename", s.name, { onSubmit: rename }), button("Rename", rename, { kind: "secondary", size: "md" })])])] : []),
    quietButton(s.me.admin ? `Delete ${s.name}` : `Leave ${s.name}`, call("DELETE", `${A}/spaces/${sid}`, undefined, { ok: seq(toast(s.me.admin ? `${s.name} deleted` : `You left ${s.name}`), { kind: "navigate", screenId: SCREENS.spaces, replace: true }), fail: toast("Couldn't do that. Try again.", true) }), { size: "md" }),
  ];
}

function spaceLive(o: OneSpace | undefined, list: Space[]): string[] {
  return ["spaces", "threads", ...(o ? [`space:${o.space.id}`] : list.map((s) => `space:${s.id}`))];
}

function spaceOnePhone(ctx: BotsCtx, o: OneSpace, d: SpacesData) {
  return page(ctx, { back: true, title: o.space.name, nav: "you", state: { listName: "", spaceRename: "" }, live: spaceLive(o, []), body: spaceDetail(ctx, o, d.bots), gap: 24 });
}

function spacesDesk(ctx: BotsCtx, d: SpacesData) {
  const list = d.spaces ?? [];
  const sel = d.one;
  const nav = col([
    topRows(d),
    sectionLabel(`Your spaces · ${list.length}`),
    ...list.map((s) => col([
      row([col([text(s.name, { size: 16, weight: 600, lineHeight: 21 }), meta(spaceCount(s), { size: 12 })], { gap: 2, flexGrow: 1 }),
        row(s.members.slice(0, 4).map((m) => box([personDot(m.name, m.you, 28)], { marginRight: -6, borderRadius: 16, borderWidth: 2, borderColor: s.id === sel?.space.id ? C.surface : C.paper })), { paddingRight: 6 })], { gap: 8 }),
      ...(s.waiting ? [row([statusMark("needs"), text(`${plural(s.waiting, "payment")} ${s.waiting === 1 ? "waits" : "wait"} for you`, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8 })] : []),
    ], { gap: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: s.id === sel?.space.id ? C.surface : C.line, ...(s.id === sel?.space.id ? { backgroundColor: C.surface } : {}) }, open(SCREENS.spaces, { id: s.id }))),
    meta("Each space keeps its own bots, things and money rules. What happens in one stays there.", { size: 12, lineHeight: 17 }),
    col([joinBox()], { paddingTop: 8 }),
  ], { width: 300, flexShrink: 0, gap: 10 });
  return page(ctx, {
    title: "Spaces", nav: "you", maxWidth: 1180, state: { spaceName: "", code: "", listName: "", spaceRename: "" }, live: spaceLive(sel, list),
    body: [
      row([
        col([row([text("You", { size: 13, color: C.grey70, lineHeight: 18 })], { minHeight: 32 }, toTab("you")), title("Spaces", { size: 26 }), meta("Family and friends: share, give tasks, ask for payments, and chat.", { size: 14 })], { gap: 4, flexGrow: 1 }),
        box([inputBox([field("spaceName", "spaceName", "Name: Home, Studio…", { onSubmit: newSpace })], { radius: 22 })], { width: 220 }),
        button("New space", newSpace, { kind: "secondary", size: "md" }),
      ], { gap: 12, alignItems: "flex-end" }),
      ...(!d.spaces ? [emptyState({ pose: "think", title: "Couldn't load your spaces", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [row([nav, col(sel ? spaceDetail(ctx, sel, d.bots) : [emptyState({ pose: "hello", title: list.length ? "Couldn't open that space" : "No spaces yet", body: list.length ? "Pick one on the left." : "Name one above and press New space. Then invite people by link or email." })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 24 })], { gap: 28, alignItems: "flex-start" })]),
    ],
  });
}

// ===================================================================== bots.space.member: what <name> can do

function memberPage(ctx: BotsCtx, d: OneSpace | undefined) {
  const s = d?.space;
  const m = s?.members.find((x) => x.userId === idParam(ctx, "member"));
  if (!s || !m) return failed(ctx, "This person");
  const mine = s.me.perms;
  const coversThem = m.perms.every((p) => mine.includes(p));
  const can = canDo(s, "manage") && !m.maker && !m.you && coversThem;
  const why = m.maker && m.you ? "You made this space, so you can do everything." : m.maker ? `${m.name} made ${s.name}, so they can do everything. That can't change.`
    : m.you ? (s.me.admin ? "You made this space, so you can do everything." : "Only someone who can change what others can do may change this. Ask the admin.")
      : !canDo(s, "manage") ? "Only someone who can change what others can do may change this."
        : !coversThem ? `${m.name} can do things you can't, so only someone who can may change them.` : "";
  const base = `${A}/spaces/${enc(s.id)}/members/${enc(m.userId)}`;
  const permsBody = Object.fromEntries(PERMS.map((p) => [p, `$state.p_${p}`]));
  const save = write("PUT", base, { perms: permsBody }, { ok: "Saved", fail: "Couldn't save that. Try again." });
  const roles = s.roles.filter((r) => r.perms.every((p) => mine.includes(p)));
  const roleOf = m.maker ? "admin" : m.role;
  const rows = PERMS.map((p) => {
    const has = m.perms.includes(p);
    const mayToggle = can && mine.includes(p);
    return row([
      col([text(PERM_WORDS[p].label, { size: 15, lineHeight: 20 }), meta(mayToggle || !can ? PERM_WORDS[p].sub : "You can't give this yourself", { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      can ? switchMark(`p_${p}`) : text(has ? "Yes" : "No", { size: 14, color: has ? C.ink : C.meta, lineHeight: 19 }),
    ], { ...rowPad, ...(mayToggle ? {} : can ? { opacity: 0.5 } : {}) }, mayToggle ? seq({ kind: "toggleState", path: `p_${p}` }, save) : undefined);
  });
  const remove = canDo(s, "remove") && !m.maker && !m.you && coversThem
    ? quietButton(`Remove ${m.name} from ${s.name}`, call("DELETE", base, undefined, { ok: seq(toast(`${m.name} removed`), back()), fail: toast("Couldn't remove them. Try again.", true) }), { size: "md" }) : null;
  return page(ctx, {
    back: true, title: m.you ? "What you can do" : `What ${m.name} can do`, nav: "you", maxWidth: 720, live: [`space:${s.id}`],
    state: Object.fromEntries(PERMS.map((p) => [`p_${p}`, m.perms.includes(p)])),
    body: [
      row([personDot(m.name, m.you, 48), col([text(m.you ? "What you can do" : `What ${m.name} can do`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`${s.name} · ${m.roleName}${m.maker ? "" : ` · joined ${shortDate(ctx, m.joinedAt)}`}`, { size: 13 })], { gap: 2, flexShrink: 1 })], { gap: 14 }),
      ...(why ? [notice(why, { mark: "lock" })] : []),
      ...(can ? [section("Make them", [row(roles.map((r) => chip(r.name, { selected: roleOf === r.id, onPress: write("PUT", base, { role: r.id }, { ok: `${m.name} is ${r.name} now` }) })), { gap: 8, flexWrap: "wrap" }),
        meta("Or pick one by one below. You can only give what you can do yourself.", { size: 12 })])] : []),
      rowsCard(rows),
      ...(!m.you && canDo(s, "message") ? [secondaryButton(`Message ${m.name}`, messagePerson(m.userId), { size: "md", icon: "send" })] : []),
      ...(remove ? [remove] : []),
    ],
  });
}

// ===================================================================== bots.space.invite

function invitePage(ctx: BotsCtx, d: OneSpace | undefined) {
  const s = d?.space;
  if (!s) return failed(ctx, "Invite");
  if (!canDo(s, "invite")) return page(ctx, { back: true, title: "Invite", nav: "you", body: [emptyState({ pose: "think", title: `You can't invite people to ${s.name}`, body: "Ask the admin to let you." })] });
  const mine = s.me.perms;
  const roles = s.roles.filter((r) => r.perms.every((p) => mine.includes(p)));
  const grantable = PERMS.filter((p) => mine.includes(p));
  const sid = enc(s.id);
  const custom = Object.fromEntries(grantable.map((p) => [p, `$state.i_${p}`]));
  const made = (body: Record<string, unknown>) => call("POST", `${A}/spaces/${sid}/invite`, body, {
    assignTo: "made", ok: seq(clearState("email"), toast("Invite made"), refresh), fail: toast("Couldn't make it. Check the email, or try again.", true),
  });
  const withRole = (email: unknown): ActionRef => ({ kind: "condition", if: { eq: ["role", "custom"] }, then: made({ email, perms: custom }), else: made({ email, role: "$state.role" }) });
  const go: ActionRef = { kind: "condition", if: { eq: ["how", "email"] }, then: ifFilled("email", withRole("$state.email"), "Type their email"), else: withRole("") };
  return page(ctx, {
    back: true, title: `Invite to ${s.name}`, nav: "you", maxWidth: 720, live: [`space:${s.id}`],
    state: { how: "link", email: "", role: roles.find((r) => r.id === "family")?.id ?? roles[0]?.id ?? "custom", ...Object.fromEntries(grantable.map((p) => [`i_${p}`, false])) },
    body: [
      col([text(`Invite to ${s.name}`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta("By a link anyone can use for seven days, or by email: then only that email can accept.", { size: 13 })], { gap: 4 }),
      segmented([{ label: "Link", value: "link" }, { label: "Email", value: "email" }], "how"),
      when({ eq: ["how", "email"] }, labelledField("Their email", field("email", "email", "name@example.com", { keyboard: "email-address" }))),
      section("They can", [
        chips([...roles.map((r) => ({ label: r.name, value: r.id })), { label: "Pick one by one", value: "custom" }], "role"),
        ...roles.map((r) => when({ eq: ["role", r.id] }, meta(r.perms.length ? r.perms.map((p) => PERM_WORDS[p].label).join(" · ") : "Look at what's shared, nothing more", { size: 12, lineHeight: 17 }))),
        when({ eq: ["role", "custom"] }, rowsCard(grantable.map((p) => row([col([text(PERM_WORDS[p].label, { size: 15, lineHeight: 20 }), meta(PERM_WORDS[p].sub, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }), switchMark(`i_${p}`)], rowPad, { kind: "toggleState", path: `i_${p}` })))),
        meta("You can only give what you can do yourself.", { size: 12 }),
      ]),
      ...(s.invites?.length ? [section("Open invites", [rowsCard(inviteRows(ctx, s, d!.mailReady))])] : []),
    ],
    footer: [
      when({ eq: ["how", "email"] }, primaryButton("Send the invite", go, { wide: !isDesk(ctx) })),
      when({ neq: ["how", "email"] }, primaryButton("Make a link", go, { wide: !isDesk(ctx) })),
      ...(d!.mailReady ? [] : [when({ eq: ["how", "email"] }, meta("Email isn't switched on yet: the invite waits to go out, and you can send its link yourself.", { size: 12, align: "center" }))]),
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
      meta(`${plural(s.members.filter((m) => m.role === r.id).length, "person", "people")}${r.preset ? " · Tailzu's" : ""}`, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(!r.preset && s.me.admin ? [icon("chevron", { size: 16, color: C.meta })] : []),
  ], rowPad, !r.preset && s.me.admin ? open(SCREENS.spaceRoles, { id: s.id, role: r.id }) : undefined);
  return page(ctx, {
    back: true, title: editing ? editing.name : "Roles", nav: "you", maxWidth: 720, live: [`space:${s.id}`],
    state: { roleName: editing?.name ?? "", ...Object.fromEntries(PERMS.map((p) => [`r_${p}`, editing ? editing.perms.includes(p) : false])) },
    body: [
      col([text(editing ? `Change ${editing.name}` : `Roles in ${s.name}`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(editing ? "Everyone with this role changes with it." : "Family, Kid and Guest are Tailzu's. Make your own for anyone else.", { size: 13 })], { gap: 4 }),
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
    ],
  });
}

// ===================================================================== bots.space.pay

function payPage(ctx: BotsCtx, d: OneSpace | undefined) {
  const s = d?.space;
  if (!s) return failed(ctx, "Payment");
  if (!canDo(s, "askPay")) return page(ctx, { back: true, title: "Ask for a payment", nav: "you", body: [emptyState({ pose: "think", title: `You can't ask for payments in ${s.name}`, body: "Ask the admin to let you." })] });
  const ask = { kind: "condition", if: { falsy: "amount" }, then: toast("How much?"), else: ifFilled("to", call("POST", `${A}/spaces/${enc(s.id)}/payments`, { amount: "$state.amount", to: "$state.to", name: "$state.payee", note: "$state.note" }, {
    ok: seq(toast("Asked. Someone who approves will see it"), back()), fail: toast("Couldn't ask. Check the amount and the UPI ID.", true),
  }), "Type the UPI ID to pay") } as ActionSpec;
  const approvers = s.members.filter((m) => m.canApprove && !m.you).map((m) => m.name);
  return page(ctx, {
    back: true, title: "Ask for a payment", nav: "you", maxWidth: 640, state: { amount: "", to: "", payee: "", note: "" },
    body: [
      col([text("Ask for a payment", { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`${approvers.length ? names(approvers) : "Someone who approves"} sees it in ${s.name}. If they say yes, they pay in their own UPI app.`, { size: 13 })], { gap: 4 }),
      labelledField("How much (₹)", field("amount", "amount", "1,240", { keyboard: "numeric" })),
      labelledField("Pay to (UPI ID)", field("to", "to", "freshbasket@okaxis", { keyboard: "email-address" })),
      labelledField("Their name", field("payee", "payee", "Fresh Basket")),
      labelledField("What for", field("note", "note", "This week's groceries")),
      row([icon("lock", { size: 16, color: C.grey70 }), meta("Tailzu never pays by itself. You press pay in your UPI app.", { size: 12 })], { gap: 8 }),
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

// ===================================================================== bots.share: share to a space or person

interface Targets { spaces: Array<{ id: string; name: string; canShare: boolean }>; people: Array<{ userId: string; name: string; spaces: string[] }> }

function sharePage(ctx: BotsCtx, t: Targets | undefined) {
  const p = ctx.params;
  const kind = String(p.kind ?? "text");
  const itemTitle = String(p.title ?? "").slice(0, 120) || (KIND_WORD[kind] ?? "This");
  const editable = kind === "list" || kind === "trip";
  const items = typeof p.items === "string" && p.items ? p.items.split("\n") : [];
  const preview = String(p.text ?? "").replace(/\s+/g, " ").slice(0, 160) || String(p.url ?? "") || (items.length ? items.slice(0, 4).join(", ") : "");
  const body: Record<string, unknown> = {
    kind, title: itemTitle, note: "$state.note", access: editable ? "$state.access" : "view", to: { space: "$state.toSpace", person: "$state.toPerson" },
    ...(p.ref ? { ref: String(p.ref) } : {}), ...(p.text ? { text: String(p.text) } : {}), ...(p.url ? { url: String(p.url) } : {}),
    ...(items.length ? { items } : {}), ...(p.bot ? { bot: String(p.bot) } : {}),
  };
  const go: ActionSpec = {
    kind: "condition", if: { all: [{ falsy: "toSpace" }, { falsy: "toPerson" }] }, then: toast("Pick a space or a person"),
    else: call("POST", `${A}/shares`, body, { ok: seq(toast("Shared"), back()), fail: toast("Couldn't share it. You may not be allowed to there.", true) }),
  };
  const choice = (label: string, sub: string, path: "toSpace" | "toPerson", value: string, left: Node, ok = true): Node => row([
    left, col([text(label, { size: 15, lineHeight: 20 }), meta(sub, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(ok ? [box([box([], { width: 10, height: 10, borderRadius: 5, backgroundColor: { eq: [path, value], then: C.ink, else: "transparent" } })], { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: { eq: [path, value], then: C.ink, else: C.outline }, alignItems: "center", justifyContent: "center" })] : []),
  ], { ...rowPad, ...(ok ? {} : { opacity: 0.5 }) }, ok ? seq(setState(path, value), clearState(path === "toSpace" ? "toPerson" : "toSpace")) : undefined);
  const spaces = t?.spaces ?? [];
  const people = t?.people ?? [];
  return page(ctx, {
    back: true, title: "Share", nav: "you", maxWidth: 640, state: { note: "", toSpace: "", toPerson: "", access: editable ? "edit" : "view" },
    body: [
      col([text("Share", { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta("With a space you're in, or with one person.", { size: 13 })], { gap: 4 }),
      row([kindBadge(kind, 44), col([text(itemTitle, { size: 16, weight: 600, lineHeight: 21, lines: 2 }), ...(preview ? [meta(preview, { size: 12, lines: 2 })] : [])], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.surface }),
      ...(!t ? [emptyState({ pose: "think", title: "Couldn't load your spaces", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : !spaces.length && !people.length ? [emptyState({ pose: "hello", title: "No spaces yet", body: "Make a space for home or friends first. Then you can share anything there.", action: { label: "Spaces", onPress: open(SCREENS.spaces) } })]
          : [
            ...(spaces.length ? [section("To a space", [rowsCard(spaces.map((s) => choice(s.name, s.canShare ? "Everyone in it can see it" : "You can't share things here", "toSpace", s.id, iconBox("folder"), s.canShare)))])] : []),
            ...(people.length ? [section("To a person", [rowsCard(people.map((m) => choice(m.name, `In ${names(m.spaces)} · goes to your chat`, "toPerson", m.userId, personDot(m.name, false))))])] : []),
            ...(editable ? [section("They can", [segmented([{ label: "Change it", value: "edit" }, { label: "Only look", value: "view" }], "access")])] : []),
            labelledField("Say something (if you like)", field("note", "note", "For Sunday's lunch")),
            meta(kind === "file" || kind === "trip" ? "They see a copy of it now, kept with the space or your chat." : "They see a copy of it as it is now.", { size: 12 }),
          ]),
    ],
    footer: t && (spaces.length || people.length) ? [primaryButton("Share", go, { wide: !isDesk(ctx) })] : [],
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
    if (!mine && r.thread.kind !== "direct" && lastFrom !== (m.from.userId ?? "")) parts.push(meta(m.from.name, { size: 12 }));
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
    parts.push(meta(clockOf(ctx, m.at), { size: 11 }));
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
  return row([
    ...(isDesk(ctx) ? [] : [labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back")]),
    threadAvatar(t, 36),
    col([text(t.name, { size: 17, weight: 600, lineHeight: 22, lines: 1 }), meta(people, { size: 12, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    link(t.muted ? "Unmute" : "Mute", write("PUT", `${A}/threads/${tid}`, { muted: !t.muted }, { ok: t.muted ? "Unmuted" : "Muted" })),
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
const oneSpace = (deps: Api, id: string) => deps.api<OneSpace>("GET", `${A}/spaces/${enc(id)}`).catch(() => undefined);

export const spacesScreens: BotsScreen[] = [
  screen<SpacesData>({
    id: SCREENS.spaces,
    load: async (ctx, deps) => {
      const id = idParam(ctx);
      const [sp, bots, given, one] = await Promise.all([
        deps.api<{ spaces: Space[]; you: string; unread: number }>("GET", `${A}/spaces`).catch(() => undefined),
        deps.api<{ bots: SpacesData["bots"] }>("GET", "/v1/bots").then((r) => r.bots).catch(() => undefined),
        deps.api<{ tasks: Task[] }>("GET", `${A}/tasks/given`).then((r) => r.tasks).catch(() => undefined),
        id ? oneSpace(deps, id) : Promise.resolve(undefined),
      ]);
      // The window always shows one: the asked one, else the first.
      const first = !one && ctx.client === "desktop" && sp?.spaces[0] ? await oneSpace(deps, sp.spaces[0].id) : undefined;
      return { spaces: sp?.spaces, you: sp?.you, unread: sp?.unread, bots, given, one: one ?? first };
    },
    build: (ctx, d) => (isDesk(ctx) ? spacesDesk(ctx, d ?? {}) : d?.one && idParam(ctx) ? spaceOnePhone(ctx, d.one, d) : idParam(ctx) && d?.spaces ? failed(ctx, "This space") : spacesPhone(ctx, d ?? {})),
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
