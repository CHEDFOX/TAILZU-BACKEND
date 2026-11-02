/**
 * What several of the Spaces's screens share.
 */

import type { ActionSpec, ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import type { Perm } from "../../../../botsBots/spacePerms.js";
import {
  type BotsCtx, call, seq, C, FACE, row, col, sectionLabel, box, text, icon, labelled, grow, divider, page, emptyState, SCREENS, meta,
  button,
} from "../../kit.js";

export const A = "/v1/botsapp/bots";
export const enc = encodeURIComponent;
export const MIN = 60_000, DAY = 86_400_000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ===================================================================== what the screens read
export interface Member { userId: string; name: string; you: boolean; maker: boolean; canApprove: boolean; joinedAt: number; perms: Perm[]; role: string | null; roleName: string }
export interface Role { id: string; name: string; perms: Perm[]; preset: boolean }
interface Invite { code: string; link: string; email: string | null; expiresAt: number; roleName: string; perms: Perm[]; byYou: boolean; by: string; mail: "queued" | "sent" | "failed" | null }
interface SpaceBot { slug: string; name: string; colour: string; addedBy: string; byYou: boolean }
export interface Space {
  id: string; name: string; mine: boolean; me: { admin: boolean; perms: Perm[] }; members: Member[]; bots: SpaceBot[];
  invite: { code: string; expiresAt: number } | null; roles: Role[]; waiting?: number;
  invites?: Invite[]; activity?: Array<{ id: string; kind: string; text: string; at: number; by: string }> | null;
}
interface ListLine { id: string; text: string; done: boolean }
export interface Item {
  id: string; kind: string; title: string; spaceId: string | null; threadId: string | null; by: string; byYou: boolean; at: number; updatedAt: number;
  access: "view" | "edit"; canEdit: boolean; canRemove: boolean; summary: string; text: string; url: string; note: string; list: ListLine[];
  place: string; when: string; who: string; bot: string; file: { name: string; mime: string; bytes: number; kind: string; url: string } | null;
}
export interface Payment {
  id: string; amountPaise: number; payee: string; vpa: string; note: string; status: "waiting" | "approved" | "declined" | "paid" | "cancelled"; at: number;
  askedBy: string; byYou: boolean; decidedBy: string; decidedAt: number | null; paidAt: number | null; upi: string | null;
  canDecide: boolean; canCancel: boolean; canMarkPaid: boolean;
}
export interface Task {
  id: string; spaceId: string; spaceName: string; kind: "task" | "plan"; title: string; notes: string; place: string; at: number | null; end: number | null; allDay: boolean;
  setBy: string; byYou: boolean; people: Array<{ userId: string; name: string; you: boolean; status: "todo" | "done" | "cant"; note: string }>;
  mine: { status: "todo" | "done" | "cant"; note: string } | null; done: boolean; canRemove: boolean;
}

// ===================================================================== small helpers
export const refresh: ActionSpec = { kind: "refresh" };
export const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });

export const clearState = (path: string): ActionSpec => ({ kind: "clearState", path });
export const isDesk = (ctx: BotsCtx) => ctx.client === "desktop";

/** A write: the call, then a quiet toast and a refresh; a failure says so in plain words. */
export function write(method: "POST" | "PUT" | "DELETE", path: string, bodyArg?: Record<string, unknown>, o: { ok?: string; fail?: string; then?: ActionRef } = {}): ActionRef {
  return call(method, path, bodyArg, { ok: seq(o.ok ? toast(o.ok) : undefined, o.then ?? refresh), fail: toast(o.fail ?? "Couldn't do that. Try again.", true) });
}
export const ifFilled = (path: string, then: ActionRef, empty = "Type something first"): ActionSpec => ({ kind: "condition", if: { falsy: path }, then: toast(empty), else: then });

export const names = (list: string[]) => (list.length <= 1 ? list[0] ?? "" : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
export const localDate = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * MIN);

export const shortDate = (ctx: BotsCtx, ms: number) => { const d = localDate(ctx, ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

export const canDo = (s: Space, p: Perm) => s.me.perms.includes(p);

/** A text field the kit's way: no frame of its own, Geist, 44 tall. Put it in `inputBox`. */
export function field(id: string, path: string, placeholder: string, o: { onSubmit?: ActionRef; multiline?: boolean; keyboard?: "numeric" | "email-address" } = {}): Node {
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
export function inputBox(children: Node[], o: { radius?: number; pad?: number } = {}): Node {
  return row(children, { gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: o.radius ?? 14, paddingLeft: o.pad ?? 14, paddingRight: 6, paddingVertical: 4, minHeight: 48, backgroundColor: C.paper });
}
export const labelledField = (label: string, f: Node) => col([sectionLabel(label), inputBox([f])], { gap: 8 });

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
export function personDot(name: string, you: boolean, size = 32): Node {
  return box([text(initial(name), { size: 13, weight: 600, color: you ? C.paper : C.grey70, lineHeight: 16 })], {
    width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: you ? C.ink : C.surface, borderWidth: you ? 0 : 1, borderColor: C.outline,
  });
}
export function iconButton(name: Parameters<typeof icon>[0], onPress: ActionRef, label: string, size = 40): Node {
  return labelled(box([icon(name, { size: 18, color: C.grey70 })], { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress), label);
}
const head = (label: string, right?: Node): Node => row([sectionLabel(label), grow(), ...(right ? [right] : [])], { minHeight: 24 });

export const section = (label: string, children: Node[], right?: Node): Node => col([head(label, right), ...children], { gap: 8, minWidth: 0 });
/** A list card from rows that are already rows (with their own padding). */
export const rowsCard = (rows: Node[]): Node => col(rows.flatMap((r, i) => (i ? [divider(), r] : [r])), { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" });
export const rowPad = { paddingVertical: 12, paddingHorizontal: 16, minHeight: 52, gap: 12 };

const KIND_ICON: Record<string, Parameters<typeof icon>[0]> = { list: "check", trip: "pin", plan: "calendar", note: "notes", file: "clip", link: "link", answer: "spark", preview: "code", text: "notes" };

export const kindBadge = (kind: string, size = 36): Node => box([icon(KIND_ICON[kind] ?? "notes", { size: 18, color: C.grey70 })], { width: size, height: size, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 });

export function failed(ctx: BotsCtx, what: string, o: { back?: boolean; nav?: string } = {}) {
  return page(ctx, { back: o.back ?? true, title: what, nav: o.nav ?? "you", body: [emptyState({ pose: "think", title: `Couldn't open ${what.toLowerCase()}`, body: "It may have gone, or the connection dropped. Try again.", action: { label: "Try again", onPress: refresh } })] });
}

export const messagePerson = (userId: string): ActionRef => call("POST", `${A}/threads/direct`, { person: userId }, { assignTo: "dm", ok: { kind: "navigate", screenId: SCREENS.thread, params: { id: "$state.dm.id" } }, fail: toast("You can't message them from here.", true) });

export function inviteRows(ctx: BotsCtx, s: Space, mailReady: boolean): Node[] {
  return (s.invites ?? []).map((i) => {
    const msg = `Join ${s.name} on X0 Bot: ${i.link}`;
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

export interface OneSpace { space: Space; items: Item[]; payments: Payment[]; tasks: Task[]; mailReady: boolean }
