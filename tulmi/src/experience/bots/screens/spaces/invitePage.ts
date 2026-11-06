/**
 * INVITING SOMEONE (bots.space.invite, params: id), the space's admin only: an email gets an invite and the space's code; the code
 * itself, to send any way you like. Anyone with the code can ask to join, and the admin lets them in. A code never expires (the admin
 * can make a new one on the People page), so no date is printed for it.
 */

import { type BotsCtx, page, emptyState, call, seq, col, text, meta, row, primaryButton, button, C } from "../../kit.js";
import { said } from "../../said.js";
import { type OneSpace, failed, enc, A, clearState, toast, refresh, ifFilled, field, section, rowsCard, inviteRows, isDesk, inputBox } from "./parts.js";

// ===================================================================== bots.space.invite
export function invitePage(ctx: BotsCtx, d: OneSpace | undefined) {
  const s = d?.space;
  if (!s) return failed(ctx, "Invite");
  if (!s.me.admin) {
    const admin = s.members.find((m) => m.maker);
    return page(ctx, { back: true, title: "Invite", nav: "you", body: [emptyState({ pose: "think", title: "Only the space's admin can invite people", body: admin ? `Ask ${admin.name} to invite them, or to send them the space's code.` : undefined })] });
  }
  const send = ifFilled("email", call("POST", `${A}/spaces/${enc(s.id)}/invite`, { email: "$state.email" }, {
    assignTo: "made", ok: seq(clearState("email"), toast("Invite sent"), refresh), fail: said("Couldn't send it. Check the email, or try again."),
  }), "Type their email");
  const code = s.code ?? "";
  const words = `Join ${s.name} on X0 Bot: open Spaces and type the code ${code}`;
  const shareCode = isDesk(ctx) ? { kind: "copyText" as const, text: code, message: "Code copied" } : { kind: "share" as const, text: words, title: `Join ${s.name}` };
  return page(ctx, {
    back: true, title: `Invite to ${s.name}`, nav: "you", maxWidth: 720, live: [`space:${s.id}`],
    state: { email: "" },
    body: [
      col([text(`Bring someone into ${s.name}`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta("They get an email with an invite and the space's code.", { size: 13 })], { gap: 4 }),
      section("Their email", [
        inputBox([field("email", "email", "name@example.com", { keyboard: "email-address", onSubmit: send })]),
        meta("The email tells them that you, the space's admin, can see and share their work and messages there.", { size: 12 }),
      ]),
      ...(code ? [section("The space's code", [
        row([text(code, { size: 17, mono: true, lineHeight: 24, style: { flexGrow: 1 } }), button(isDesk(ctx) ? "Copy" : "Share", shareCode, { kind: "secondary", size: "md" })], { gap: 10 }),
        meta("Anyone with it can ask to join. You let them in.", { size: 12 }),
      ])] : []),
      ...(s.invites?.length ? [section(`Invites waiting · ${s.invites.length}`, [rowsCard(inviteRows(ctx, s, d!.mailReady))])] : []),
    ],
    footer: [
      primaryButton("Send the invite", send, { wide: !isDesk(ctx) }),
      ...(d!.mailReady ? [] : [meta("Email isn't switched on yet: the invite waits to go out. Send them the code meanwhile.", { size: 12, align: "center", color: C.meta })]),
    ],
  });
}
