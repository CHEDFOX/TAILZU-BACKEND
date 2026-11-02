/**
 * The Spaces's memberPage screen.
 */

import { PERMS, PERM_WORDS, type Perm } from "../../../../botsBots/spacePerms.js";
import {
  type BotsCtx, row, col, text, meta, switchMark, C, seq, quietButton, call, back, page, notice, chip, secondaryButton, open, SCREENS, when, icon,
} from "../../kit.js";
import { type OneSpace, failed, canDo, A, enc, write, rowPad, toast, personDot, shortDate, section, rowsCard, messagePerson } from "./parts.js";

export const idParam = (ctx: BotsCtx, k = "id"): string => String(ctx.params[k] ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);

/** "Can share things, use the shared bots and message people here." What a person can do, in one sentence. */
function canSay(perms: readonly Perm[]): string {
  if (!perms.length) return "Can see what's shared here. Nothing more.";
  const w = perms.map((p) => PERM_WORDS[p].label.charAt(0).toLowerCase() + PERM_WORDS[p].label.slice(1));
  return `Can ${w.length === 1 ? w[0] : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`}.`;
}

// ===================================================================== bots.space.member: what <name> can do
export function memberPage(ctx: BotsCtx, d: OneSpace | undefined) {
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
    state: { ...Object.fromEntries(PERMS.map((p) => [`p_${p}`, m.perms.includes(p)])), fineOpen: false },
    body: [
      row([personDot(m.name, m.you, 48), col([text(m.you ? "What you can do" : `What ${m.name} can do`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`${s.name} · ${m.roleName}${m.maker ? "" : ` · joined ${shortDate(ctx, m.joinedAt)}`}`, { size: 13 })], { gap: 2, flexShrink: 1 })], { gap: 14 }),
      ...(why ? [notice(why, { mark: "lock" })] : []),
      ...(can ? [section(`${m.name} is`, [row(roles.map((r) => chip(r.name, { selected: roleOf === r.id, onPress: write("PUT", base, { role: r.id }, { ok: `${m.name} is ${r.name} now` }) })), { gap: 8, flexWrap: "wrap" })])] : []),
      text(canSay(m.perms), { size: 15, lineHeight: 21 }),
      row([text(m.you || !can ? "See every detail" : `Fine-tune what ${m.name} can do`, { size: 14, weight: 500, lineHeight: 19, style: { flexGrow: 1, flexShrink: 1 } }), icon("chevron", { size: 16, color: C.meta })], { gap: 10, paddingVertical: 8 }, { kind: "toggleState", path: "fineOpen" }),
      when({ truthy: "fineOpen" }, col([rowsCard(rows), ...(can ? [meta("You can only give what you can do yourself.", { size: 12 })] : [])], { gap: 8 })),
      ...(!m.you && canDo(s, "message") ? [secondaryButton(`Message ${m.name}`, messagePerson(m.userId), { size: "md", icon: "send" })] : []),
      ...(remove ? [remove] : []),
      ...(!m.you ? [quietButton(`Report or block ${m.name}`, open(SCREENS.person, { id: m.userId }), { size: "md", icon: "shield" })] : []),
    ],
  });
}
