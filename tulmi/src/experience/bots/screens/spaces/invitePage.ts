/**
 * The Spaces's invitePage screen.
 */

import type { ActionRef } from "../../../../../../shared/types/sdui.js";
import { PERMS, PERM_WORDS, type Perm } from "../../../../botsBots/spacePerms.js";
import { type BotsCtx, page, emptyState, call, seq, col, text, meta, segmented, when, chips, row, switchMark, primaryButton, C } from "../../kit.js";
import {
  type OneSpace, failed, canDo, enc, A, clearState, toast, refresh, ifFilled, field, section, rowsCard, rowPad, inviteRows,
  isDesk,
} from "./parts.js";

/** What each built-in role means, in a line a person reads at a glance (spacePerms.ts PRESETS: exactly these permissions). */
const ROLE_LINES: Record<string, string> = {
  family: "Trusted with nearly everything: shares, gives tasks, plans, asks for money and invites others.",
  kid: "Adds to lists, uses the bots, asks for money and chats. Can't approve or invite.",
  guest: "Sees what's shared, uses the bots and chats. Changes nothing.",
};
/** A space's own role in one line: what it can do, the first few things and how many more. */
function roleLine(r: { id: string; perms: readonly Perm[] }): string {
  if (ROLE_LINES[r.id]) return ROLE_LINES[r.id]!;
  if (!r.perms.length) return "Sees what's shared. Nothing more.";
  const w = r.perms.map((p) => PERM_WORDS[p].label.toLowerCase());
  return `Can ${w.slice(0, 3).join(", ")}${w.length > 3 ? ` and ${w.length - 3} more` : ""}.`;
}

// ===================================================================== bots.space.invite
export function invitePage(ctx: BotsCtx, d: OneSpace | undefined) {
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
    state: { how: "link", email: "", invitesOpen: false, role: roles.find((r) => r.id === "family")?.id ?? roles[0]?.id ?? "custom", ...Object.fromEntries(grantable.map((p) => [`i_${p}`, false])) },
    body: [
      col([text(`Bring someone into ${s.name}`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta("You decide how much they can do. You can change it any time.", { size: 13 })], { gap: 4 }),
      section("Who are they to you?", [
        chips([...roles.map((r) => ({ label: r.name, value: r.id })), { label: "Choose exactly", value: "custom" }], "role"),
        ...roles.map((r) => when({ eq: ["role", r.id] }, meta(roleLine(r), { size: 13, lineHeight: 18 }))),
        when({ eq: ["role", "custom"] }, col([
          rowsCard(grantable.map((p) => row([col([text(PERM_WORDS[p].label, { size: 15, lineHeight: 20 }), meta(PERM_WORDS[p].sub, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1 }), switchMark(`i_${p}`)], rowPad, { kind: "toggleState", path: `i_${p}` }))),
          meta("You can only give what you can do yourself.", { size: 12 }),
        ], { gap: 8 })),
      ]),
      section("How do you want to send it?", [
        segmented([{ label: "A link", value: "link" }, { label: "Their email", value: "email" }], "how"),
        when({ neq: ["how", "email"] }, meta("Anyone with the link can join for the next 7 days. Send it on WhatsApp.", { size: 12 })),
        when({ eq: ["how", "email"] }, col([field("email", "email", "name@example.com", { keyboard: "email-address" }), meta("Only this email can accept it.", { size: 12 })], { gap: 6 })),
      ]),
      ...(s.invites?.length ? [col([
        row([text(`${s.invites.length === 1 ? "1 invite is" : `${s.invites.length} invites are`} waiting to be accepted`, { size: 14, lineHeight: 19, style: { flexGrow: 1, flexShrink: 1 } }), text("See", { size: 13, color: C.meta, lineHeight: 18 })], { gap: 10, paddingVertical: 6 }, { kind: "toggleState", path: "invitesOpen" }),
        when({ truthy: "invitesOpen" }, rowsCard(inviteRows(ctx, s, d!.mailReady))),
      ], { gap: 8 })] : []),
    ],
    footer: [
      when({ eq: ["how", "email"] }, primaryButton("Send the invite", go, { wide: !isDesk(ctx) })),
      when({ neq: ["how", "email"] }, primaryButton("Create the invite link", go, { wide: !isDesk(ctx) })),
      ...(d!.mailReady ? [] : [when({ eq: ["how", "email"] }, meta("Email isn't switched on yet: the invite waits to go out, and you can send its link yourself.", { size: 12, align: "center" }))]),
    ],
  });
}
