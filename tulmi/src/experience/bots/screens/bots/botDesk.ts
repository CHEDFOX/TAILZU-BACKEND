/**
 * The Bots area's botDesk screen.
 */

import type { ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, type LiveBot, col, row, sectionLabel, grow, C, open, SCREENS, text, meta, mono, body, chip, box, page, botAvatar, title,
  headerBuddy, quietButton, secondaryButton,
} from "../../kit.js";
import {
  type BotView, type Linked, link, type BotPageData, lookOf, dotLine, plural, chatTurns, askBot, chatBar, ANSWERING, write, A, enc,
} from "./parts.js";

export const liveOf = (ctx: BotsCtx, slug: string): LiveBot | undefined => ctx.live.bots.find((b) => b.slug === slug);

/** "Ready · made by you", "Working · fixing cart", "Needs you". */
export function stateLine(ctx: BotsCtx, bot: { slug: string; builtin: boolean }): string {
  const l = liveOf(ctx, bot.slug);
  const who = bot.builtin ? "X0 Bot's own" : "made by you";
  if (l?.needs) return `Needs you · ${who}`;
  if (l?.working) return `Working · ${l.doing ?? "on it"}`;
  return `Ready · ${who}`;
}

/** What to try first, for a bot with no chat yet. */
export function starters(slug: string, purpose: string): string[] {
  switch (slug) {
    case "plan": return ["Plan my week", "What's on tomorrow?"];
    case "travel": return ["Plan a weekend trip", "Trains to Pune on Saturday"];
    case "keybot": return ["Write a polite reply saying I'll be late", "Make this sound friendlier"];
    default: return ["What can you do?", purpose.length > 34 ? "Help me with what you're for" : purpose];
  }
}

/** "Calendar, Reminders": the apps a bot uses, and its own skills, in a line. */
export function usesLine(bot: BotView, linked: Linked[] | undefined): string {
  const apps = (linked ?? bot.skills.connectors.map((id) => ({ id, name: id, status: "connected" as const }))).map((l) => l.name.replace(/^Google /, ""));
  const own = [...(bot.skills.web ? ["Web"] : []), ...(bot.skills.research ? ["Research"] : []), ...(bot.skills.files ? ["Your files"] : [])];
  const all = [...apps, ...own];
  return all.length ? all.slice(0, 3).join(", ") + (all.length > 3 ? ` +${all.length - 3}` : "") : "Nothing yet";
}

export const apiLine = (slug: string) => `POST /v1/bots/${slug}/ask`;

function asideSection(label: string, action: { label: string; onPress: ActionRef } | null, kids: Node[], last = false): Node {
  return col([
    row([sectionLabel(label), grow(), ...(action ? [link(action.label, action.onPress)] : [])], { minHeight: 32 }),
    ...kids,
  ], { gap: 8, paddingBottom: 18, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: C.divider }) });
}

export function botDesk(ctx: BotsCtx, d: BotPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const turns = d.turns ?? [];
  const facts = d.memory?.facts ?? [];
  const edit = open(SCREENS.edit, { slug: bot.slug });
  const uses: Node[] = [
    ...(d.linked ?? []).map((l) => row([text(l.name, { size: 13, lineHeight: 18 }), grow(), meta(l.status === "connected" ? "connected" : l.status === "not_connected" ? "not connected" : "not here", { size: 13 })])),
    row([text("Search the web", { size: 13, lineHeight: 18 }), grow(), meta(bot.skills.web ? "on" : "off", { size: 13 })]),
    row([text("Your files", { size: 13, lineHeight: 18 }), grow(), meta(bot.skills.files ? "on" : "off", { size: 13 })]),
  ];
  const aside = col([
    asideSection(`Rules · ${bot.principles.length}`, { label: bot.builtin ? "See" : "Edit", onPress: edit }, bot.principles.length ? bot.principles.slice(0, 6).map((p) => dotLine(p)) : [meta("No rules yet. Plain words work.", { size: 13 })]),
    asideSection(`Uses · ${usesLine(bot, d.linked)}`, bot.builtin ? null : { label: "Edit", onPress: edit }, uses),
    asideSection(d.memory ? `Remembers · ${plural(facts.length, "thing")}` : "Remembers", { label: "See", onPress: edit },
      facts.length ? facts.slice(0, 5).map((f) => dotLine(f.text)) : [meta(d.memory ? "Nothing yet. It learns what you tell it about you." : "Couldn't read this just now.", { size: 13 })], bot.builtin),
    ...(bot.builtin ? [] : [asideSection("Use from your own app", { label: "Keys", onPress: open(SCREENS.keys, { slug: bot.slug }) }, [
      col([mono(apiLine(bot.slug), { boxed: false, size: 11.5 }), mono('{"message": "Plan my next week"}', { boxed: false, size: 11.5, color: C.meta })], { backgroundColor: C.surface, borderRadius: 10, padding: 12, gap: 2 }),
      meta("Same rules as here. Your memory stays with you.", { size: 12 }),
    ], true)]),
  ], { width: 300, flexShrink: 0, paddingLeft: 24, borderLeftWidth: 1, borderLeftColor: C.divider, gap: 18 });
  const chat = col([
    col(turns.length
      ? chatTurns(ctx, bot, turns, { days: true })
      : [col([body(bot.purpose, { color: C.grey70 }), row(starters(bot.slug, bot.purpose).map((s) => chip(s, { onPress: askBot(bot.slug, s) })), { gap: 8, flexWrap: "wrap" })], { gap: 12 })],
    { gap: 16, maxWidth: 640, width: "100%" }),
    grow(),
    box([chatBar(ctx, bot.slug, bot.name)], { maxWidth: 640, width: "100%" }),
  ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 20, minHeight: 520 });
  return page(ctx, {
    title: bot.name, nav: bot.slug, maxWidth: 1040,
    body: [
      row([
        botAvatar(look, 48),
        col([title(bot.name, { size: 24, lineHeight: 30 }), meta(stateLine(ctx, bot), { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
        ...headerBuddy(ctx, bot.slug, { color: look.color, lookTo: "down", thinkWhen: ANSWERING }),
        ...(turns.length ? [quietButton("Clear chat", write("DELETE", `${A}/chat/${enc(bot.slug)}`, undefined, { ok: "Chat cleared" }), { size: "md" })] : []),
        secondaryButton(bot.builtin ? "See its rules" : "Edit bot", edit, { size: "md" }),
      ], { gap: 14 }),
      row([chat, aside], { gap: 28, alignItems: "stretch" }),
    ],
  });
}
