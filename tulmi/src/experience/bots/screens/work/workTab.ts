/**
 * WORK IN SPACE, ON A BOT'S PAGE (Plan Ease, Notes, Travel bot, Xode; docs/bots-app.md "Spaces"): shared work lives in the bots, not in
 * the space. A person in a space gets two tabs under the bot's head: "Your work" (the page as it always was, with the notes people
 * added to their things and who else can see them) and "Work in space" (per space, the people whose things in this bot they may work
 * on: everyone with their OK for the space's admin, else who shared something with them). A tap opens that person's things (bots.work).
 *
 * GET .../work/:bot never reads another person's bot (these pages are fetched at launch): the rows carry people and counts only.
 * A build without the new Spaces (kit canSpaces2), or a person in no space, gets the page as it was. Anyone in a space gets both tabs,
 * with a line where nobody has shared anything yet, and the line saying the space's admin can see their things.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, C, SCREENS, canSpaces2, col, icon, meta, open, row, sectionLabel, segmented, text, when, type PersonLookSpec } from "../../kit.js";
import type { BotsDeps } from "../../live.js";
import { A, isDesk, names, personMark, rowsCard, shareLook, type ShareBot } from "../spaces/parts.js";
import { ago } from "../spaces/spaceDetail.js";

// ===================================================================== what it reads (src/botsBots/work.ts, as the route answers)

/** `bot`: their tiny bot in that space (src/botsBots/personLook.ts). */
export interface WorkPerson { userId: string; name: string; how: "admin" | "shared" | "view"; line: string; bot?: PersonLookSpec }
export interface WorkSpace { spaceId: string; spaceName: string; admin: boolean; people: WorkPerson[] }
export interface WorkRead {
  bot: ShareBot; botName: string; spaces: WorkSpace[];
  /** Admins who can see the viewer's own things in this bot ("Aanya, the space's admin, can see these too."). */
  seenBy: string[];
  notesOnMine: Array<{ itemId: string; title: string; by: string; byBot?: PersonLookSpec; text: string; at: number; spaceId: string }>;
}

/** The bot page's read of Work in space, for a build that draws it; a failed read is the page as it was. */
export async function loadWork(ctx: BotsCtx, deps: Pick<BotsDeps, "api">, bot: ShareBot): Promise<WorkRead | undefined> {
  if (!canSpaces2(ctx)) return undefined;
  return deps.api<WorkRead>("GET", `${A}/work/${bot}`).catch(() => undefined);
}

const shows = (ctx: BotsCtx, work: WorkRead | undefined): work is WorkRead => canSpaces2(ctx) && !!work?.spaces.length;

/** "Your work" then the page's own body, and "Work in space": the two tabs under the page's head (its first node). */
export function withWork(ctx: BotsCtx, work: WorkRead | undefined, body: Node[]): Node[] {
  if (!shows(ctx, work)) return body;
  const gap = isDesk(ctx) ? 28 : 22;
  const [head, ...rest] = body;
  const mineId = ctx.user?.id;
  const notes = work.notesOnMine.length ? [col([
    sectionLabel("Notes from your space"),
    rowsCard(work.notesOnMine.map((n) => row([
      personMark(ctx, { seed: `${n.spaceId}:${n.by}`, bot: n.byBot }, 28),
      col([text(`${n.by}: ${n.text}`, { size: 14, lineHeight: 19, lines: 2 }), meta(`On ${n.title} · ${ago(ctx, n.at)}`, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(mineId ? [icon("chevron", { size: 16, color: C.meta })] : []),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }, mineId ? open(SCREENS.work, { bot: work.bot, space: n.spaceId, owner: mineId, item: n.itemId }) : undefined))),
  ], { gap: 8 })] : [];
  const seen = work.seenBy.length === 1 ? `${work.seenBy[0]}, the space's admin, can see these too.`
    : work.seenBy.length ? `${names(work.seenBy)}, your spaces' admins, can see these too.` : "Only you change these.";
  const noun = shareLook(work.bot).noun;
  const spaces = work.spaces.map((s) => col([
    sectionLabel(s.spaceName),
    meta(s.admin ? "You see these as admin." : "Only what people share with you.", { size: 12 }),
    s.people.length ? rowsCard(s.people.map((p) => row([
      personMark(ctx, { seed: p.userId, bot: p.bot }, 36),
      col([text(p.name, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta(p.line, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      icon("chevron", { size: 16, color: C.meta }),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 60 }, open(SCREENS.work, { bot: work.bot, space: s.spaceId, owner: p.userId }))))
      : meta(s.admin ? `Nothing here yet. The ${noun}s of people in ${s.spaceName} show here.` : `Nothing here yet. When someone in ${s.spaceName} shares a ${noun} with you, it shows here.`, { size: 13 }),
  ], { gap: 8 }));
  return [
    ...(head ? [head] : []),
    segmented([{ label: "Your work", value: "mine" }, { label: "Work in space", value: "space" }], "workTab"),
    when({ eq: ["workTab", "mine"] }, col([...notes, ...rest, meta(seen, { size: 12 })], { gap })),
    when({ eq: ["workTab", "space"] }, col(spaces, { gap })),
  ];
}

/** The ctx a bot page builds with: every page it draws gets the two tabs and their state (kit BotsCtx.wrap). */
export function workCtx(ctx: BotsCtx, work: WorkRead | undefined): BotsCtx {
  if (!shows(ctx, work)) return ctx;
  return { ...ctx, wrap: { body: (b) => withWork(ctx, work, b), state: { workTab: ctx.params.tab === "space" ? "space" : "mine" } } };
}
