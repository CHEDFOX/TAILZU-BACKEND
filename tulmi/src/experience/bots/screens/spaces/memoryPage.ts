/**
 * WHAT A GROUP'S BOTS KNOW (bots.space.memory, params: id): the lines anyone in the group told its bots, in sections, each with who said it.
 * Write one for the group; forget your own (the admin can forget any). Reads and writes GET/POST/DELETE .../spaces/:id/memory
 * (botsBots/spaceMemory.ts). A line from someone's own space gets here only when they share it from there.
 */
import type { ActionRef, ActionSpec, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, C, button, call, col, grow, icon, meta, page, primaryButton, row, seq, text } from "../../kit.js";
import { A, enc, rowPad, rowsCard, section, toast } from "./parts.js";
import { ago } from "./spaceDetail.js";

type FactSection = "about" | "day" | "people" | "places" | "likes" | "money" | "work";
export interface GroupLine { id: string; text: string; section: FactSection; by: string; you: boolean; mine: boolean; at: number; shared: boolean }
export interface GroupMemoryView { space: { id: string; name: string }; admin: boolean; lines: GroupLine[] }

/** The group's sections, in the words a group uses. */
const SECTIONS: Array<[FactSection, string]> = [
  ["people", "People"], ["day", "Routines"], ["likes", "Likes"], ["places", "Places"], ["money", "Money"], ["work", "Work and school"], ["about", "Other things"],
];

function lineRow(ctx: BotsCtx, spaceId: string, l: GroupLine): Node {
  const base = `${A}/spaces/${enc(spaceId)}/memory/${enc(l.id)}`;
  const forget: ActionRef = {
    kind: "condition", if: { eq: ["sure", l.id] },
    then: call("DELETE", base, {}, { ok: seq(toast("Forgotten"), { kind: "refresh" } as ActionSpec), fail: toast("Couldn't forget that. Try again.", true) }),
    else: seq({ kind: "setState", path: "sure", value: l.id } as ActionSpec, toast("Tap Forget again to forget it")),
  } as ActionSpec;
  return row([
    col([
      text(l.text, { size: 15, lineHeight: 20 }),
      meta([l.you ? "You" : l.by, ...(l.shared ? ["from their space"] : []), ago(ctx, l.at)].join(" · ").replace("You · from their space", "You · from your space"), { size: 12, lines: 1 }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(l.mine ? [button("Forget", forget, { kind: "quiet", size: "md" })] : []),
  ], { ...rowPad, alignItems: "center" });
}

export function memoryPage(ctx: BotsCtx, d: GroupMemoryView | undefined): ScreenResponse {
  const spaceId = String(ctx.params.id ?? d?.space.id ?? "");
  const name = d?.space.name ?? "this group";
  const lines = d?.lines ?? [];
  const add = call("POST", `${A}/spaces/${enc(spaceId)}/memory`, { text: "$state.line" }, {
    ok: seq({ kind: "setState", path: "line", value: "" } as ActionSpec, toast(`${name}'s bots know it now`), { kind: "refresh" } as ActionSpec),
    fail: toast("Couldn't keep that. Try again.", true),
  });
  const guarded = { kind: "condition", if: { falsy: "line" }, then: toast("Write it first"), else: add } as ActionSpec;
  const groups = SECTIONS.map(([id, label]) => [label, lines.filter((l) => l.section === id)] as const).filter(([, ls]) => ls.length);
  return page(ctx, {
    back: true, nav: "you", title: `What ${name}'s bots know`, gap: 18, state: { line: "", sure: "" },
    body: [
      row([
        icon("spark", { size: 22 }),
        col([
          text(`What ${name}'s bots know`, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }),
          meta("Things anyone here told the group's bots. Your own space stays yours unless you share a line from it.", { size: 13 }),
        ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ], { gap: 12, alignItems: "flex-start" }),
      ...(groups.length
        ? groups.map(([label, ls]) => section(`${label} · ${ls.length}`, [rowsCard(ls.map((l) => lineRow(ctx, spaceId, l)))]))
        : [meta(`Nothing yet. Tell ${name}'s bots something everyone should know, like who's vegetarian or when groceries come.`, { size: 13 })]),
      section("Add for the group", [
        {
          type: "TextField", id: "line", bind: { value: "line" },
          props: { placeholder: "e.g. Groceries come on Sunday mornings", placeholderColor: C.idle, multiline: true, numberOfLines: 2, background: "transparent", borderWidth: 0, color: C.ink },
          style: { minHeight: 72, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, fontSize: 15, color: C.ink, textAlignVertical: "top" },
        } as Node,
        row([meta("Everyone here sees it.", { size: 12 }), grow(), primaryButton("Add", guarded, { size: "md" })], { gap: 10, alignItems: "center" }),
      ]),
    ],
  });
}
