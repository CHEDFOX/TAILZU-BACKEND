/**
 * A SPACE'S PEOPLE (bots.space.people, params: id; new builds only, the door at the top of a space's feed): who is in it, each opening
 * their page (Message, Report, Block; Remove for the admin). The space's admin also calls more people in, sees the space's code and
 * makes a new one (the old one stops working), and renames it. Group memory, and at the bottom Leave (a member) or Delete (the admin).
 * Reads GET .../spaces/:id (the code comes only to the admin).
 */

import type { ActionSpec, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, C, SCREENS, button, call, col, icon, listRow, meta, open, page, quietButton, row, sectionLabel, seq, text } from "../../kit.js";
import { said } from "../../said.js";
import { A, enc, failed, field, ifFilled, inputBox, personDot, refresh, rowPad, rowsCard, section, toast, type OneSpace, type Member } from "./parts.js";
import { facesLine, link } from "./spaceDetail.js";

function personRow(spaceId: string, m: Member) {
  return row([
    personDot(m.name, m.you, 32),
    text(m.you ? `${m.name} (you)` : m.name, { size: 15, lineHeight: 20, lines: 1, style: { flexGrow: 1, flexShrink: 1, minWidth: 0 } }),
    ...(m.maker ? [meta("Admin", { size: 12 })] : m.you ? [meta("You", { size: 12 })] : []),
    icon("chevron", { size: 16, color: C.meta }),
  ], rowPad, open(SCREENS.spaceMember, { id: spaceId, member: m.userId }));
}

export function peoplePage(ctx: BotsCtx, d: OneSpace | undefined): ScreenResponse {
  const s = d?.space;
  if (!s) return failed(ctx, "People");
  const sid = enc(s.id);
  const admin = s.me.admin;
  const rename = ifFilled("spaceRename", call("PUT", `${A}/spaces/${sid}`, { name: "$state.spaceRename" }, { ok: seq(toast("Renamed"), refresh), fail: said("Couldn't rename it. Try again.") }), "Type the new name");
  const newCode = call("POST", `${A}/spaces/${sid}/code`, undefined, { ok: seq(toast("New code made. The old one stops working."), refresh), fail: said("Couldn't make a new code. Try again.") });
  // Leaving (or, for the admin, deleting it for everyone) takes a second tap, so a slip never ends a family's space.
  const end = call("DELETE", `${A}/spaces/${sid}`, undefined, {
    ok: seq(toast(admin ? `${s.name} deleted` : `You left ${s.name}`), { kind: "navigate", screenId: SCREENS.spaces, replace: true } as ActionSpec),
    fail: said("Couldn't do that. Try again."),
  });
  const sure: ActionSpec = {
    kind: "condition", if: { truthy: "sure" }, then: end,
    else: seq({ kind: "setState", path: "sure", value: true }, toast(admin ? `Tap again to delete ${s.name} for everyone` : `Tap again to leave ${s.name}`)) as ActionSpec,
  };
  return page(ctx, {
    back: true, title: "People", nav: "you", maxWidth: 720, gap: 22, live: [`space:${s.id}`],
    state: { spaceRename: "", sure: false },
    body: [
      col([text(s.name, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(facesLine(s), { size: 13, lines: 2 })], { gap: 4 }),
      section(`People · ${s.members.length}`, [rowsCard(s.members.map((m) => personRow(s.id, m)))]),
      ...(admin ? [
        button("Call your people", open(SCREENS.spaceInvite, { id: s.id }), { kind: "secondary", size: "md", icon: "plus" }),
        ...(s.code ? [col([
          sectionLabel("The space's code"),
          text(s.code, { size: 17, mono: true, lineHeight: 24 }),
          meta("Anyone with it can ask to join. You let them in.", { size: 12 }),
          row([link("Make a new code", newCode)]),
        ], { gap: 6 })] : []),
        section("Name", [inputBox([field("spaceRename", "spaceRename", s.name, { onSubmit: rename }), button("Save", rename, { kind: "secondary", size: "md" })])]),
      ] : [meta(`${s.members.find((m) => m.maker)?.name ?? "The admin"} made ${s.name}, so they are its admin. They can see your work and messages here.`, { size: 13 })]),
      rowsCard([listRow({ label: "Group memory", sub: "What the group's bots know", left: icon("spark", { size: 18 }), onPress: open(SCREENS.spaceMemory, { id: s.id }) })]),
      quietButton(admin ? `Delete ${s.name}` : `Leave ${s.name}`, sure, { size: "md" }),
    ],
  });
}
