/**
 * The Spaces's sharePage screen.
 */

import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  icon, box, C, type BotsCtx, call, seq, back, row, col, text, meta, page, emptyState, open, SCREENS, segmented, primaryButton,
} from "../../kit.js";
import { toast, A, rowPad, clearState, kindBadge, refresh, section, rowsCard, names, personDot, labelledField, field, isDesk } from "./parts.js";

export const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });

export const KIND_WORD: Record<string, string> = { list: "List", trip: "Trip", plan: "Plan", note: "Note", file: "File", link: "Link", answer: "Answer", preview: "Preview", text: "Note" };

export const iconBox = (name: Parameters<typeof icon>[0]) => box([icon(name, { size: 18 })], { width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 });

// ===================================================================== bots.share: share to a space or person
export interface Targets { spaces: Array<{ id: string; name: string; canShare: boolean }>; people: Array<{ userId: string; name: string; spaces: string[] }> }

export function sharePage(ctx: BotsCtx, t: Targets | undefined) {
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
