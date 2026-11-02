/**
 * The Spaces's invitePage screen.
 */

import type { ActionRef } from "../../../../../../shared/types/sdui.js";
import { PERMS, PERM_WORDS } from "../../../../botsBots/spacePerms.js";
import { type BotsCtx, page, emptyState, call, seq, col, text, meta, segmented, when, chips, row, switchMark, primaryButton } from "../../kit.js";
import {
  type OneSpace, failed, canDo, enc, A, clearState, toast, refresh, ifFilled, labelledField, field, section, rowsCard, rowPad, inviteRows,
  isDesk,
} from "./parts.js";

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
