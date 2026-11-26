/**
 * SRIBBU: the mail bot, the meeting bot and Notes as ONE bot (slug "mail"). One card, one sidebar entry, one page, and its
 * page is three parts under its name, a tap apart:
 *
 *   Inbox      the business's mail (mailPage.ts), where its mail service is set up
 *   Meetings   joining a call, what it is in now, what is coming and what was (meetPage.ts), where the meeting bot is set up
 *   Notes      every meeting written up, its to-dos and decisions (notes.ts), on every phone and on a computer that takes notes
 *
 * It is bots.bot { slug: "mail", part }. The meeting bot's own page and Notes' own screens still open (an old link, a
 * notice), each with Sribbu's name; nothing lists them on their own any more.
 */
import type { Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, chip, row, SCREENS } from "../../kit.js";
import { mailOn, meetOn, MAIL_SLUG } from "../../../../bots/builtin.js";
import { hasNotes } from "../notes.js";

export type SribbuPart = "inbox" | "meetings" | "notes";
const LABEL: Record<SribbuPart, string> = { inbox: "Inbox", meetings: "Meetings", notes: "Notes" };

/** The parts this person's Sribbu has: the inbox unless only meetings are set up, meetings where they are, notes where they are. */
export function sribbuParts(ctx: BotsCtx): SribbuPart[] {
  const parts: SribbuPart[] = [];
  if (mailOn() || !meetOn()) parts.push("inbox");
  if (meetOn()) parts.push("meetings");
  if (hasNotes(ctx)) parts.push("notes");
  return parts;
}

/** The part open now: the one asked for when this person has it, else the first. */
export function sribbuPart(ctx: BotsCtx): SribbuPart {
  const parts = sribbuParts(ctx);
  const asked = String(ctx.params.part ?? "") as SribbuPart;
  return parts.includes(asked) ? asked : parts[0] ?? "inbox";
}

/** Where a part opens: Sribbu's page on that part, in place. */
export const sribbuAt = (part: SribbuPart, params: Record<string, string> = {}) =>
  ({ kind: "navigate" as const, screenId: SCREENS.bot, params: { slug: MAIL_SLUG, part, ...params }, replace: true });

/** The parts as chips under the head; nothing when there is only one. */
export function sribbuTabs(ctx: BotsCtx, on: SribbuPart): Node[] {
  const parts = sribbuParts(ctx);
  if (parts.length < 2) return [];
  return [row(parts.map((p) => chip(LABEL[p], { selected: p === on, ...(p === on ? {} : { onPress: sribbuAt(p) }) })), { gap: 8, flexWrap: "wrap" })];
}
