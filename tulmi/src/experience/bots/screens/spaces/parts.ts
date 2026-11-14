/**
 * What several of the Spaces's screens share.
 */

import type { ActionSpec, ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import { lookOf, seen } from "../../../../botsBots/personLook.js";
import type { Perm } from "../../../../botsBots/spacePerms.js";
import {
  type BotsCtx, call, seq, C, FACE, row, col, sectionLabel, box, text, icon, labelled, grow, divider, page, emptyState, SCREENS, meta,
  button, PALETTE_HEX, personBot, canPersonBot, type PersonLookSpec,
} from "../../kit.js";

export const A = "/v1/botsapp/bots";
export const enc = encodeURIComponent;
export const MIN = 60_000, DAY = 86_400_000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ===================================================================== what the screens read
// Roles are gone: the server still sends a member's perms, role and roleName (fixed: "Admin" for the space's maker, "Member" for
// everyone else) and `roles: []`, so older builds keep reading them. These screens go by `maker` and `me.admin`.
/** `bot`: their tiny bot in this space (src/botsBots/personLook.ts). */
export interface Member { userId: string; name: string; you: boolean; maker: boolean; canApprove: boolean; joinedAt: number; perms: Perm[]; role: string | null; roleName: string; bot?: PersonLookSpec }
export interface Role { id: string; name: string; perms: Perm[]; preset: boolean }
interface Invite { code: string; link: string; email: string | null; expiresAt: number; roleName?: string; perms?: Perm[]; byYou: boolean; by: string; mail: "queued" | "sent" | "failed" | null }
interface SpaceBot { slug: string; name: string; colour: string; addedBy: string; byYou: boolean }
export interface Space {
  id: string; name: string; mine: boolean; me: { admin: boolean; perms: Perm[] }; members: Member[]; bots: SpaceBot[];
  invite: { code: string; expiresAt: number } | null; roles: Role[]; waiting?: number;
  invites?: Invite[]; activity?: Array<{ id: string; kind: string; text: string; at: number; by: string }> | null;
  /** The space's own code, shown "7KQ-29D" (GET /spaces/:id, its admin only). */
  code?: string | null;
  /** The invite mail as the person invited will read it (its admin only), for the preview before Send. */
  mailPreview?: MailPreview;
  /** GET /spaces?full=1: open email invites (its admin only), the space chat's last line for everyone, and the person's unread. */
  invited?: number;
  last?: { from: string; text: string; at: number } | null;
  unread?: number;
}
/** src/botsBots/inviteMail.ts: the sender as the recipient sees it, the subject, and the body. */
export interface MailPreview { sender: string; subject: string; text: string }
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

/** TextField's extras (sdui TextFieldExtras, KitExtras): only the new trees pass them. */
export interface FieldExtras { kind?: "text" | "email" | "code"; autoFocus?: boolean; maxLength?: number }

/** A text field the kit's way: no frame of its own, Geist, 44 tall. Put it in `inputBox`. */
export function field(id: string, path: string, placeholder: string, o: { onSubmit?: ActionRef; multiline?: boolean; keyboard?: "numeric" | "email-address"; extras?: FieldExtras } = {}): Node {
  const x = o.extras;
  return {
    type: "TextField", id, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: o.multiline ? 72 : 44, color: C.ink, returnKeyType: o.onSubmit ? "send" : "done", ...(o.multiline ? { multiline: true } : {}),
      ...(o.keyboard ? { keyboardType: o.keyboard, autoCapitalize: "none" } : {}),
      ...(x?.kind ? { keyboard: x.kind } : {}), ...(x?.autoFocus ? { autoFocus: true } : {}), ...(x?.maxLength ? { maxLength: x.maxLength } : {}),
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

/**
 * A person, as their own tiny bot (kit personBot), never their initials: the look the server gave them (`bot`), else the one their
 * id (`seed`) always has, the viewer being their own X0 bot. A build without PersonBot gets a plain circle in their colour.
 */
export function personMark(ctx: BotsCtx, who: { seed: string; bot?: PersonLookSpec | null }, size = 32, o: { label?: string; ring?: string } = {}): Node {
  return personBot(ctx, who.bot ?? seen(lookOf(who.seed), ctx.user?.id), { size, ...o });
}

/**
 * A space's faces in a list: up to three of its people's tiny bots side by side, a little over each other (the others first, then
 * the viewer), and "+N" for the rest. `ground`: what they stand on (a circle without PersonBot keeps an edge of it).
 *
 * A tiny bot fills well under half his box's width (he stands in its middle, with room for a shrug), so the boxes go much further
 * over each other than circles do (FACES_OVER) for the bots themselves to touch.
 */
const FACES_OVER = { bot: 0.55, circle: 0.22 } as const;
const facesOver = (ctx: BotsCtx, size: number): number => Math.round(size * (canPersonBot(ctx) ? FACES_OVER.bot : FACES_OVER.circle));
/** How wide a list's faces are at most (all `max` of them and "+N"): a list sets them in this, so the names line up down it. */
export const facesWidth = (ctx: BotsCtx, size = 28, max = 3): number => size + (max - 1) * (size - facesOver(ctx, size)) + 20;
export function facesRow(ctx: BotsCtx, members: Member[], o: { size?: number; max?: number; ground?: string } = {}): Node {
  const size = o.size ?? 28, max = o.max ?? 3;
  const shown = [...members.filter((m) => !m.you), ...members.filter((m) => m.you)].slice(0, max);
  const more = members.length - shown.length;
  const over = facesOver(ctx, size);
  return row([
    ...shown.map((m, i) => box([personMark(ctx, { seed: m.userId, bot: m.bot }, size, { ring: o.ground ?? C.paper })], i ? { marginLeft: -over } : {})),
    ...(more > 0 ? [text(`+${more}`, { size: 12, weight: 600, lineHeight: 16, color: C.meta, style: { paddingLeft: 4 } })] : []),
  ], { alignItems: "center", flexShrink: 0 });
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
      row([col([text(i.email ?? "Link", { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta(mail, { size: 12, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ...(i.byYou || s.me.admin ? [iconButton("close", write("DELETE", `${A}/spaces/${enc(s.id)}/invites/${enc(i.code)}`, undefined, { ok: "Invite taken back" }), "Take it back", 36)] : [])], { gap: 10 }),
      row([
        button(isDesk(ctx) ? "Copy link" : "Share link", isDesk(ctx) ? { kind: "copyText", text: i.link, message: "Link copied" } : { kind: "share", text: msg, title: `Join ${s.name}` }, { kind: "secondary", size: "md", icon: "link" }),
        meta(`Code ${i.code}`, { size: 12 }),
      ], { gap: 10, flexWrap: "wrap" }),
    ], { ...rowPad, gap: 10 });
  });
}

/** Who shares what from their own bots in the space (GET .../spaces/:id/sharing), when it could be read. */
export interface BotSharing { bot: string; sharing: Array<{ userId: string; name: string; you: boolean; mode: "all" | "some" | "none" }> }
export interface OneSpace { space: Space; items: Item[]; payments: Payment[]; tasks: Task[]; mailReady: boolean; sharing?: BotSharing[] }

/** The sub-bots a group can have, by the bot each comes from. */
export const SUB_BOTS: Record<string, { name: string; what: string }> = {
  plan: { name: "Plan", what: "plans and to-dos" },
  notes: { name: "Notes", what: "notes" },
  travel: { name: "Travel", what: "trips" },
  code: { name: "Xode", what: "projects" },
};

/** The four bots whose things a person shares in a space with "/" (botsBots SHARE_BOTS), as the new screens show them. */
export const SHARE_BOTS = ["plan", "notes", "travel", "code"] as const;
export type ShareBot = (typeof SHARE_BOTS)[number];
const SHARE_LOOK: Record<ShareBot, { name: string; noun: string; color: string }> = {
  plan: { name: "Plan Ease", noun: "plan", color: PALETTE_HEX.ochre! },
  notes: { name: "Notes", noun: "note", color: PALETTE_HEX.plum! },
  travel: { name: "Travel bot", noun: "trip", color: PALETTE_HEX.sea! },
  code: { name: "Xode", noun: "project", color: PALETTE_HEX.moss! },
};
export const isShareBot = (x: unknown): x is ShareBot => typeof x === "string" && (SHARE_BOTS as readonly string[]).includes(x);
/** A shareable bot's name, its colour (as Home draws it) and what one of its things is called. */
export const shareLook = (bot: ShareBot) => SHARE_LOOK[bot];

/** A file's size as people read it. */
export const kb = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The bot's own name for this person ("Plan Ease"), else the sub-bot's. */
export const subBotName = (ctx: { live: { bots: Array<{ slug: string; name: string }> } }, bot: string): string => ctx.live.bots.find((b) => b.slug === bot)?.name ?? SUB_BOTS[bot]?.name ?? bot;


// ===================================================================== the invite mail, before it is sent

/** The state the preview's "See the whole email" needs, to merge into a screen's own. */
export const PREVIEW_STATE = { mailOpen: false };

/**
 * WHAT THE INVITE WILL LOOK LIKE TO THEM, before the person taps Send (App Review 5.1.2(v): "a clear description of how the
 * message will appear to the recipient before sending it (for example, What will the message say? Who will appear to be the
 * sender?)"). The sender and the subject are always out; the body is one tap away, so the box stays small.
 *
 * Every word comes from `inviteMail()`, the same function that writes the mail, so what is shown is what goes.
 */
export function mailPreview(p: MailPreview | undefined): Node[] {
  if (!p) return [];
  const toggle: ActionSpec = { kind: "toggleState", path: "mailOpen" };
  return [col([
    row([meta("From", { size: 12, style: { width: 54, flexShrink: 0 } }), meta(p.sender, { size: 12, style: { flexShrink: 1 } })], { gap: 6 }),
    row([meta("Subject", { size: 12, style: { width: 54, flexShrink: 0 } }), meta(p.subject, { size: 12, style: { flexShrink: 1 } })], { gap: 6 }),
    row([text("See the whole email", { size: 13, weight: 500, lineHeight: 18 }), icon("chevron", { size: 14, color: C.meta })],
      { gap: 4, minHeight: 36, alignItems: "center" }, toggle),
    { ...box([text(p.text, { size: 12, lineHeight: 18, color: C.grey70 })], {
      padding: 12, borderRadius: 14, backgroundColor: C.surface,
    }), visibleIf: { truthy: "mailOpen" } },
  ], { gap: 2 })];
}
