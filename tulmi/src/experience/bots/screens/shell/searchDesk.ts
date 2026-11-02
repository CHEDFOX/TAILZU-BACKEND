/**
 * The Bots app shell's searchDesk screen.
 */

import type { ActionSpec, Node, Condition } from "../../../../../../shared/types/sdui.js";
import type { SearchKind, SearchHit, SearchResult } from "../../../../shell/search.js";
import {
  open, type BotsCtx, box, icon, C, SCREENS, row, when, labelled, seq, col, meta, grow, text, whenEq, sectionLabel, primaryButton, page,
  title, emptyState, secondaryButton,
} from "../../kit.js";
import { avatarOf, field, colorOf, nameOf, kbd, dotChip, couldNot } from "./parts.js";

export const KIND_WORDS: Record<SearchKind, string> = { projects: "Projects", chats: "Chats", notes: "Notes", files: "Files", bots: "Bots" };
const KIND_ICON: Record<SearchKind, "code" | "notes" | "folder" | "spark"> = { projects: "code", chats: "spark", notes: "notes", files: "folder", bots: "spark" };

/** Where a result goes; a file opens Ask with it attached. */
export const openHit = (h: SearchHit): ActionSpec => open(h.open.screenId, h.kind === "files" && h.attachment ? { ...(h.open.params ?? {}), attachment: h.attachment } : h.open.params);

export function hitIcon(ctx: BotsCtx, h: SearchHit, size: number): Node {
  if (h.kind === "bots" && h.bot) return avatarOf(ctx, h.bot, size);
  return box([icon(KIND_ICON[h.kind], { size: Math.round(size * 0.5), color: C.ink })], {
    width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

export function searchField(big: boolean): Node {
  const go = { kind: "navigate" as const, screenId: SCREENS.search, params: { q: "$state.q" }, replace: true };
  return row([
    ...(big ? [] : [icon("search", { size: 18, color: C.meta })]),
    field("q", "Search everything", { size: big ? 18 : 16, onSubmit: go }),
    when({ truthy: "q" }, labelled(box([icon("close", { size: big ? 16 : 18, color: C.ink })], {
      width: big ? 40 : 44, height: big ? 40 : 44, borderRadius: big ? 20 : 22, alignItems: "center", justifyContent: "center", ...(big ? { backgroundColor: C.surface } : {}),
    }, seq({ kind: "clearState", path: "q" }, { kind: "navigate", screenId: SCREENS.search, replace: true })), "Clear search")),
  ], big
    ? { gap: 12, height: 56, borderWidth: 1.5, borderColor: C.ink, borderRadius: 28, paddingLeft: 20, paddingRight: 8 }
    : { gap: 8, height: 46, borderRadius: 23, backgroundColor: C.surface, paddingLeft: 14, paddingRight: 1, flexGrow: 1, flexShrink: 1 });
}

export function hitWords(h: SearchHit): { line: string; sub: string } {
  if (h.kind === "chats") return { line: `“${h.title}”`, sub: h.sub ?? "" };
  if (h.kind === "bots") return { line: h.title, sub: h.sub ?? "" };
  return { line: h.title, sub: h.snippet ?? h.sub ?? "" };
}

export function searchDesk(ctx: BotsCtx, data: SearchResult | undefined) {
  const q = String(ctx.params.q ?? "").trim();
  // The board's three columns: chats; projects and bots; notes and files.
  const kinds: SearchKind[] = ["chats", "projects", "bots", "notes", "files"];
  const all = data ? kinds.flatMap((k) => data.groups[k]) : [];
  const first = all[0];
  const filterOn = (k: SearchKind): Condition => ({ in: ["filter", ["all", k]] });
  const tile = (h: SearchHit): Node => {
    const w = hitWords(h);
    return col([
      row([hitIcon(ctx, h, h.kind === "chats" && h.bot ? 24 : 28), ...(h.kind === "chats" ? [meta(h.sub ?? "", { lines: 1, style: { flexShrink: 1 } })] : []), grow(), ...(h.bot && h.kind !== "bots" && h.kind !== "chats" ? [avatarOf(ctx, h.bot, 22)] : [])], { gap: 8 }),
      text(w.line, { size: 14, weight: h.kind === "bots" || h.kind === "files" ? 600 : 400, lineHeight: 19, lines: 3 }),
      ...(h.kind !== "chats" && w.sub ? [meta(w.sub, { lines: 2 })] : []),
    ], {
      gap: 6, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 14, backgroundColor: C.paper,
      borderWidth: whenEq("sel", h.id, 1.5, 1), borderColor: whenEq("sel", h.id, h.bot ? colorOf(ctx, h.bot) : C.ink, C.line),
    }, { kind: "setState", path: "sel", value: h.id });
  };
  const group = (k: SearchKind): Node => when(filterOn(k), col([sectionLabel(`${KIND_WORDS[k]} · ${data!.groups[k].length}`), ...data!.groups[k].map(tile)], { gap: 8 }));
  const present = kinds.filter((k) => data?.groups[k].length);
  const columns: SearchKind[][] = [["chats"], ["projects", "bots"], ["notes", "files"]].map((c) => c.filter((k) => present.includes(k as SearchKind)) as SearchKind[]).filter((c) => c.length);
  const preview = (h: SearchHit): Node => when({ eq: ["sel", h.id] }, col([
    row([sectionLabel("Preview"), grow(), meta(`${KIND_WORDS[h.kind].replace(/s$/, "")} · ${all.indexOf(h) + 1} of ${all.length}`)]),
    row([hitIcon(ctx, h, 34), col([text(h.bot ? nameOf(ctx, h.bot) : h.title, { size: 15, weight: 600, lineHeight: 20, lines: 1 }), meta(h.preview?.at ?? h.sub ?? "", { lines: 1 })], { gap: 2, flexShrink: 1 })], { gap: 10 }),
    col([
      ...(h.preview?.lines ?? []).map((l) => l.who === "you"
        ? row([box([text(l.text, { size: 14, lineHeight: 19, lines: 4 })], { backgroundColor: C.surface, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13, maxWidth: "88%" })], { justifyContent: "flex-end" })
        : row([...(h.bot ? [avatarOf(ctx, h.bot, 22)] : []), text(l.text, { size: 14, lineHeight: 19, lines: 5, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" })),
      ...(!(h.preview?.lines ?? []).length ? [text(h.preview?.body || h.sub || h.title, { size: 14, lineHeight: 20, color: C.grey70, lines: 8 })] : []),
    ], { gap: 10 }),
    row([primaryButton(h.kind === "chats" ? "Open chat" : h.kind === "files" ? "Ask about it" : "Open", openHit(h), { size: "md" }), row([kbd("↵"), meta("to open", { size: 12 })], { gap: 6 })], { gap: 12 }),
  ], { gap: 14, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: C.line }));

  return page(ctx, {
    title: "Search everything", gap: 18, maxWidth: 1100, state: { q, filter: "all", ...(first ? { sel: first.id } : {}) },
    body: [
      title("Search everything"),
      col([
        searchField(true),
        ...(data?.total ? [row([
          dotChip(`All · ${data.total}`, "filter", "all"),
          ...present.map((k) => dotChip(`${KIND_WORDS[k]} · ${data.groups[k].length}`, "filter", k)),
          meta("results in projects, chats, notes, files and bots", { size: 12 }),
        ], { gap: 8, flexWrap: "wrap" })] : []),
      ], { gap: 12 }),
      ...(!q ? [emptyState({ pose: "listen", title: "Search everything", body: "Your projects, chats, notes, files and bots, in one place. Type, then press Enter." })]
        : !data ? [couldNot("results")]
          : !data.total ? [emptyState({ pose: "think", title: `Nothing for “${q}”`, body: "Try fewer words, or ask your bots.", action: { label: `Ask your bots about “${q}”`, onPress: open(SCREENS.ask, { message: q }) } })]
            : [row([
              col([
                row(columns.map((ks) => col(ks.map(group), { gap: 18, flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 16, alignItems: "flex-start" }),
                secondaryButton(`Ask your bots about “${q}”`, open(SCREENS.ask, { message: q }), { size: "md" }),
              ], { gap: 18, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }),
              col(all.map(preview), { width: 330, flexShrink: 0 }),
            ], { gap: 24, alignItems: "flex-start" })]),
    ],
  });
}
