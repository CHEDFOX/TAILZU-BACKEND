/**
 * ONE PERSON IN A SPACE (bots.space.member, params: id, member): who they are there, Message, and (the space's admin) Remove; Report or
 * block anyone else. There are no roles: everyone in a space can do the same things, and its admin (the person who made it) a few more.
 */

import {
  type BotsCtx, row, col, text, meta, seq, quietButton, call, back, page, notice, secondaryButton, open, SCREENS,
} from "../../kit.js";
import { type OneSpace, failed, canDo, A, enc, toast, personMark, shortDate, messagePerson } from "./parts.js";

export const idParam = (ctx: BotsCtx, k = "id"): string => String(ctx.params[k] ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);

// ===================================================================== bots.space.member
export function memberPage(ctx: BotsCtx, d: OneSpace | undefined) {
  const s = d?.space;
  const m = s?.members.find((x) => x.userId === idParam(ctx, "member"));
  if (!s || !m) return failed(ctx, "This person");
  const what = m.maker
    ? (m.you ? `You made ${s.name}, so you are its admin. You can see everyone's work there, let people in and remove them.` : `${m.name} made ${s.name}, so they are its admin.`)
    : `${m.you ? "You" : m.name} can share, message, give tasks and plans, and ask for money here, like everyone in ${s.name}.`;
  const base = `${A}/spaces/${enc(s.id)}/members/${enc(m.userId)}`;
  // Only the admin removes people, and nobody removes the admin.
  const remove = s.me.admin && !m.maker && !m.you
    ? quietButton(`Remove ${m.name} from ${s.name}`, call("DELETE", base, undefined, { ok: seq(toast(`${m.name} removed`), back()), fail: toast("Couldn't remove them. Try again.", true) }), { size: "md" }) : null;
  return page(ctx, {
    back: true, title: m.you ? "You" : m.name, nav: "you", maxWidth: 720, live: [`space:${s.id}`],
    body: [
      row([personMark(ctx, { seed: m.userId, bot: m.bot }, 48), col([text(m.you ? "You" : m.name, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`${s.name} · ${m.maker ? "Admin" : "Member"}${m.maker ? "" : ` · joined ${shortDate(ctx, m.joinedAt)}`}`, { size: 13 })], { gap: 2, flexShrink: 1 })], { gap: 14 }),
      notice(what),
      ...(!m.you && canDo(s, "message") ? [secondaryButton(`Message ${m.name}`, messagePerson(m.userId), { size: "md", icon: "send" })] : []),
      ...(remove ? [remove] : []),
      ...(!m.you ? [quietButton(`Report or block ${m.name}`, open(SCREENS.person, { id: m.userId }), { size: "md", icon: "shield" })] : []),
    ],
  });
}
