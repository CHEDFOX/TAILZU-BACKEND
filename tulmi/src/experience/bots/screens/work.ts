/**
 * WORK IN SPACE: SOMEONE'S THINGS, AND ONE OF THEM (bots.work, params: bot, space, owner, item?; docs/bots-app.md "Spaces").
 *
 * Opened from a bot page's "Work in space" tab (screens/work/workTab.ts) or a card shared in a space's feed ("Open in Plan Ease").
 * Without `item`: one person's things in that bot that this person may work on (GET .../work/:bot/person). With it: the thing, its
 * time and place (a plan's event), the notes people added, and the two things anyone allowed may do: Change time (a plan's event,
 * when it isn't an old read-only share or a share to everyone) and Add a note. The owner sees every change, and who the thing is shared
 * with, each with Stop sharing (src/botsBots/work.ts says who may).
 *
 * Only the new Spaces' feed and tabs link here; it is plain kit, so any build draws it.
 */

import type { ActionSpec, Node, ScreenResponse } from "../../../../../shared/types/sdui.js";
import { type BotsCtx, C, button, call, card, col, divider, emptyState, listRow, meta, page, primaryButton, row, sectionLabel, seq, text, when } from "../kit.js";
import { type BotsScreen, screen } from "../registry.js";
import { said } from "../said.js";
import { A, enc, failed, field, inputBox, isShareBot, personDot, refresh, rowsCard, shareLook, toast, type ShareBot } from "./spaces/parts.js";
import { ago } from "./spaces/spaceDetail.js";
import { SCREENS } from "../ids.js";
import type { WorkPerson } from "./work/workTab.js";

// ===================================================================== what it reads (src/botsBots/work.ts, as the routes answer)

interface OwnItem { id: string; title: string; line: string; at: number | null }
interface PersonView { space: { id: string; name: string }; person: WorkPerson; items: OwnItem[] }
interface WorkItem {
  bot: ShareBot; botName: string; id: string; title: string; line: string; at: number | null;
  owner: { userId: string; name: string; you: boolean }; space: { id: string; name: string };
  how: "own" | "admin" | "shared" | "view";
  detail: { when?: string; place?: string; notes?: string; day?: string; time?: string };
  notes: Array<{ id: string; by: string; you: boolean; text: string; at: number }>;
  can: { time: boolean; note: boolean };
  /** Its owner only: who it is shared with, in which space ("Everyone" for a share to everyone). */
  shared?: Array<{ grantId: string; spaceId: string; spaceName: string; to: string }>;
}
interface WorkData { person?: PersonView; item?: WorkItem }

/** An id from the params: anything printable, kept short (item ids are the bot's own: "e:<uuid>@2026-11-14"). */
const param = (ctx: BotsCtx, k: string): string => String(ctx.params[k] ?? "").replace(/[^\x21-\x7e]/g, "").slice(0, 200);
const botParam = (ctx: BotsCtx): ShareBot | null => { const b = param(ctx, "bot"); return isShareBot(b) ? b : null; };

// ===================================================================== one person's things

function personPage(ctx: BotsCtx, bot: ShareBot, v: PersonView): ScreenResponse {
  const look = shareLook(bot);
  const p = v.person;
  const how = p.how === "admin" ? "You see these as admin." : p.how === "shared" ? "Shared with you" : "What they share with the space";
  const foot = p.how === "admin" ? `You see ${p.name}'s ${look.noun}s as admin. ${p.name} sees what you change.`
    : p.how === "shared" ? `${p.name} shared ${v.items.length === 1 ? "this" : "these"} with you. ${p.name} sees what you change.`
      : `${p.name} shares these with the space. You can add a note.`;
  return page(ctx, {
    back: true, title: p.name, nav: bot, maxWidth: 760, gap: 18, live: [`space:${v.space.id}`],
    body: [
      row([personDot(p.name, false, 48), col([text(p.name, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }), meta(`${v.space.name} · ${how}`, { size: 13 })], { gap: 2, flexShrink: 1 })], { gap: 14 }),
      v.items.length
        ? col([sectionLabel(`${look.name} · ${p.line}`), rowsCard(v.items.map((i) => listRow({ label: i.title, sub: i.line || undefined, onPress: { kind: "navigate", screenId: SCREENS.work, params: { bot, space: v.space.id, owner: p.userId, item: i.id } } })))], { gap: 8 })
        : emptyState({ pose: "think", title: "Nothing here right now", body: `When ${p.name} shares something from ${look.name}, it shows here.` }),
      meta(foot, { size: 12 }),
    ],
  });
}

// ===================================================================== one thing

/** A labelled line of the thing's card: TIME, PLACE, NOTES (each only when the server sent it). */
const detailRow = (label: string, value: string, right?: Node): Node => row([
  col([sectionLabel(label), text(value, { size: 15, lineHeight: 21 })], { gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  ...(right ? [right] : []),
], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 });

function itemPage(ctx: BotsCtx, it: WorkItem): ScreenResponse {
  const look = shareLook(it.bot);
  const owner = it.owner.name;
  const target = { space: it.space.id, owner: it.owner.userId, item: it.id };
  const post = `${A}/work/${it.bot}/item`;
  const saveTime = call("POST", post, { ...target, op: "time", day: "$state.day", time: "$state.time", tz: ctx.tzOffsetMinutes }, {
    ok: seq(toast(it.how === "own" ? "Saved" : `Saved. ${owner} sees the change.`), refresh), fail: said("Couldn't change it. Try again."),
  });
  const addNote: ActionSpec = {
    kind: "condition", if: { falsy: "note" }, then: toast("Write the note first"),
    else: call("POST", post, { ...target, op: "note", text: "$state.note" }, { ok: seq(toast("Note added"), refresh), fail: said("Couldn't add the note. Try again.") }),
  };
  const lines: Node[] = [
    ...(it.detail.when ? [detailRow("Time", it.detail.when, it.can.time ? button("Change time", { kind: "setState", path: "changing", value: true }, { kind: "secondary", size: "md" }) : undefined)] : []),
    ...(it.detail.place ? [detailRow("Place", it.detail.place)] : []),
    ...(it.detail.notes ? [detailRow("Notes", it.detail.notes)] : []),
  ];
  const foot = it.how === "own" ? "Only you change these."
    : it.how === "admin" ? `You see ${owner}'s ${look.noun}s as admin. ${owner} sees what you change.`
      : it.how === "shared" ? `${owner} shared this with you. ${owner} sees what you change.`
        : `${owner} shares this with the space. You can add a note.`;
  // Its owner: who has it, from "/" in a space's feed, and the way to take it back (the card leaves the feed with it).
  const shared = it.how === "own" ? it.shared ?? [] : [];
  const sharedRows = shared.map((g) => row([
    col([text(g.to === "Everyone" ? `Everyone in ${g.spaceName}` : g.to, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta(g.to === "Everyone" ? "They can look and add notes" : g.spaceName, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    button("Stop sharing", call("DELETE", `${A}/spaces/${enc(g.spaceId)}/grants/${enc(g.grantId)}`, undefined, {
      ok: seq(toast("Stopped sharing"), refresh), fail: said("Couldn't stop sharing it. Try again."),
    }), { kind: "secondary", size: "md" }),
  ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }));
  return page(ctx, {
    back: true, title: it.title, nav: it.bot, maxWidth: 760, gap: 18, live: [...(it.space.id ? [`space:${it.space.id}`] : []), ...shared.map((g) => `space:${g.spaceId}`)],
    state: { changing: false, day: it.detail.day ?? "", time: it.detail.time ?? "", note: "" },
    body: [
      col([
        text(it.title, { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }),
        meta([`${it.owner.you ? "Your" : `${owner}'s`} ${look.noun}`, look.name, it.space.name].filter(Boolean).join(" · "), { size: 13 }),
        ...(it.line && !it.detail.when ? [meta(it.line, { size: 13 })] : []),
      ], { gap: 4 }),
      ...(lines.length ? [col(lines.flatMap((l, i) => (i ? [divider(), l] : [l])), { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" })] : []),
      ...(it.can.time ? [when({ truthy: "changing" }, card([
        text("Change time", { size: 15, weight: 600, lineHeight: 20 }),
        row([
          col([sectionLabel("Day"), inputBox([field("day", "day", "2026-11-14")])], { gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
          col([sectionLabel("Time"), inputBox([field("time", "time", "19:30")])], { gap: 6, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        ], { gap: 10 }),
        row([primaryButton("Save", saveTime, { size: "md" }), button("Cancel", { kind: "setState", path: "changing", value: false }, { kind: "quiet", size: "md" })], { gap: 8 }),
      ], { gap: 12 }))] : []),
      ...(sharedRows.length ? [col([sectionLabel("Shared with"), rowsCard(sharedRows)], { gap: 8 })] : []),
      col([
        sectionLabel("Notes"),
        ...(it.notes.length
          ? [rowsCard(it.notes.map((n) => row([personDot(n.by, n.you, 28), col([text(n.text, { size: 14, lineHeight: 20 }), meta(`${n.you ? "You" : n.by} · ${ago(ctx, n.at)}`, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 })], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: "flex-start" })))]
          : [meta("No notes yet.", { size: 13 })]),
      ], { gap: 8 }),
      ...(it.can.note ? [col([
        inputBox([field("note", "note", it.how === "own" ? "Add a note" : `Add a note for ${owner}`, { multiline: true })], { radius: 18 }),
        row([primaryButton("Save", addNote, { size: "md" })], { justifyContent: "flex-end" }),
      ], { gap: 8 })] : []),
      meta(foot, { size: 12 }),
    ],
  });
}

// ===================================================================== bots.work

export const workScreens: BotsScreen[] = [
  screen<WorkData>({
    id: SCREENS.work,
    load: async (ctx, deps) => {
      const bot = botParam(ctx);
      if (!bot) return {};
      // Ids in the query, never the path: a plan's id is "e:<uuid>@2026-11-14", and other bots' ids are theirs to shape.
      const q = `space=${enc(param(ctx, "space"))}&owner=${enc(param(ctx, "owner"))}`;
      const item = param(ctx, "item");
      // Its time is said in the viewer's own day (tz, minutes east).
      if (item) return { item: await deps.api<{ item: WorkItem }>("GET", `${A}/work/${bot}/item?${q}&item=${enc(item)}&tz=${ctx.tzOffsetMinutes}`).then((r) => r.item) };
      return { person: await deps.api<PersonView>("GET", `${A}/work/${bot}/person?${q}`) };
    },
    build: (ctx, d) => {
      const bot = botParam(ctx);
      if (!bot) return failed(ctx, "This");
      if (param(ctx, "item")) return d?.item ? itemPage(ctx, d.item) : failed(ctx, "This");
      return d?.person ? personPage(ctx, bot, d.person) : failed(ctx, "Their work");
    },
  }),
];
