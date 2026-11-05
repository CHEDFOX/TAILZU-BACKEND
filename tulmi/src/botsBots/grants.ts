/**
 * ONE THING SHARED FROM A BOT IN A SPACE ("/" in the feed, spaceFeed.ts): one of the sharer's own plans, notes, trips or Xode projects,
 * given to one person there or to everyone in the space. It lets them open it and work on it from their own bot's "Work in space"
 * (work.ts); a card for it sits in the feed (threads.ts item kind "grant"). Kept in space_grants (migration 0068).
 *
 *   give(space, owner, bot, item, to)   a grant (the same thing to the same person twice is one grant)
 *   setMessage / dropForMessage         its card in the feed; moderation taking the card out takes the access with it (safety.ts)
 *   revoke(actor, space, grant)         Stop sharing: its sharer, or the space's admin, takes it back (spaceFeed.ts takes its card out)
 *   holds(viewer, space, owner, bot, item)   how a grant reaches the viewer: to them ("one"), to everyone ("everyone"), or not at all
 *   ofItem(owner, bot, item)            who one thing is shared with, for its owner's page ("Shared with Rohan in Home")
 *   forViewer(viewer, bot)              who gave the viewer what in that bot, across their spaces
 *
 * Someone who leaves a space takes what they gave there with them, and loses what they were given; a space that goes takes all of it.
 * A share to everyone reaches whoever is in the space now, later joiners too (they read the same feed), so it lets them look and add a
 * note but never change the owner's calendar: only a share to one named person does that (work.ts).
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import type { Blocks } from "./blocks.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import type { OwnItem, ShareBot } from "./spaceShares.js";
import type { Spaces } from "./spaces.js";

export interface GrantRow {
  [k: string]: unknown;
  id: string; space_id: string; owner_id: string; bot: ShareBot; item_id: string; title: string; line: string;
  /** The one person it is for; null: everyone in the space. */
  to_id: string | null;
  /** Its card in the space's feed. */
  message_id: string | null;
  created_ms: number;
}

/** What a space's grants hold: at most this many a bot, read at once. */
const GRANTS_READ = 500;

/** How a grant reaches someone: given to them by name, or to everyone in the space. */
export type GrantReach = "one" | "everyone";

export class Grants {
  private readonly rows: PagedTable<GrantRow>;

  constructor(
    private readonly spaces: Spaces,
    readonly blocks: Blocks,
    private readonly now: () => number = Date.now,
    rows?: PagedTable<GrantRow>,
  ) {
    this.rows = rows ?? spaceTable<GrantRow>("space_grants");
    spaces.onMembers(async (e) => {
      if (e.deleted) await this.rows.remove({ space_id: e.spaceId });
      else if (e.left) {
        await this.rows.remove({ space_id: e.spaceId, owner_id: e.left });
        await this.rows.remove({ space_id: e.spaceId, to_id: e.left });
      }
    });
  }

  /** The grants of a space in one bot (a filter in code: the memory twin and PostgREST match on equal columns only). */
  async inSpace(spaceId: string, bot: ShareBot): Promise<GrantRow[]> {
    return this.rows.select({ space_id: spaceId, bot }, { order: "created_ms", limit: GRANTS_READ });
  }

  /** The same thing to the same person (or everyone) again is the grant already there, its title and line brought up to date. */
  async give(spaceId: string, owner: { id: string; name: string }, bot: ShareBot, item: OwnItem, toId: string | null): Promise<{ id: string }> {
    const same = (await this.inSpace(spaceId, bot)).find((g) => g.owner_id === owner.id && g.item_id === item.id && (g.to_id ?? null) === toId);
    const title = item.title.replace(/\s+/g, " ").trim().slice(0, 120) || "A thing";
    const line = item.line.replace(/\s+/g, " ").trim().slice(0, 120);
    if (same) {
      await this.rows.update({ id: same.id }, { title, line });
      return { id: same.id };
    }
    const id = randomUUID();
    await this.rows.insert({ id, space_id: spaceId, owner_id: owner.id, bot, item_id: item.id.slice(0, 200), title, line, to_id: toId, message_id: null, created_ms: this.now() });
    return { id };
  }

  async setMessage(grantId: string, messageId: string): Promise<void> {
    await this.rows.update({ id: grantId }, { message_id: messageId });
  }

  /**
   * Stop sharing: the one who shared it, or the space's admin, takes it back. Anyone else in the space is refused; someone not in it,
   * or a grant that isn't there, is the same 404. Returns the grant taken back, so its card can come out of the feed with it.
   */
  async revoke(actorId: string, spaceId: string, grantId: string): Promise<GrantRow> {
    const a = await this.spaces.access(actorId, spaceId);
    const [g] = grantId ? await this.rows.select({ id: grantId }, { limit: 1 }) : [];
    if (!g || g.space_id !== spaceId) throw new BotError("not_found", "That isn't shared any more.", 404);
    if (g.owner_id !== actorId && !a.admin) throw new BotError("not_allowed", "Only the one who shared it, or the space's admin, can stop sharing it.", 403);
    await this.rows.remove({ id: g.id });
    return g;
  }

  /** Who one thing of the owner's is shared with, in every space: its owner's page lists them, each with Stop sharing. */
  async ofItem(ownerId: string, bot: ShareBot, itemId: string): Promise<GrantRow[]> {
    return this.rows.select({ owner_id: ownerId, bot, item_id: itemId }, { order: "created_ms", limit: 60 });
  }

  /** The card was taken out (a report acted on): its grant goes too, so the access goes with the card. */
  async dropForMessage(messageId: string, grantId?: string): Promise<void> {
    if (messageId) await this.rows.remove({ message_id: messageId });
    if (grantId) await this.rows.remove({ id: grantId });
  }

  /** A moved plan event has a new id (one start of a series moved alone): its grants follow it. */
  async moved(ownerId: string, bot: ShareBot, from: string, to: string): Promise<void> {
    if (from !== to) await this.rows.update({ owner_id: ownerId, bot, item_id: from }, { item_id: to.slice(0, 200) });
  }

  /** Both are in the (named) space now, and neither has a block with the other. */
  private async together(spaceId: string, a: string, b: string): Promise<boolean> {
    const s = await this.spaces.spaceRow(spaceId);
    if (!s || (s.draft_ms !== null && s.draft_ms !== undefined)) return false;
    const ids = await this.spaces.memberIds(spaceId);
    return ids.includes(a) && ids.includes(b) && !(await this.blocks.between(a, b));
  }

  /** How a grant of this exact item reaches the viewer: to them by name ("one", which wins), to everyone in the space, or not (null). */
  async holds(viewerId: string, spaceId: string, ownerId: string, bot: ShareBot, itemId: string): Promise<GrantReach | null> {
    if (!viewerId || viewerId === ownerId || !(await this.together(spaceId, viewerId, ownerId))) return null;
    const theirs = (await this.inSpace(spaceId, bot)).filter((g) => g.owner_id === ownerId && g.item_id === itemId);
    if (theirs.some((g) => g.to_id === viewerId)) return "one";
    return theirs.some((g) => !g.to_id) ? "everyone" : null;
  }

  /** The grants that reach the viewer in one space and bot, by owner (still in the space, no block). */
  async reaching(viewerId: string, spaceId: string, bot: ShareBot, memberIds: string[], hidden: Set<string>): Promise<Map<string, GrantRow[]>> {
    const out = new Map<string, GrantRow[]>();
    for (const g of await this.inSpace(spaceId, bot)) {
      if (g.owner_id === viewerId || (g.to_id && g.to_id !== viewerId)) continue;
      if (!memberIds.includes(g.owner_id) || hidden.has(g.owner_id)) continue;
      out.set(g.owner_id, [...(out.get(g.owner_id) ?? []), g]);
    }
    return out;
  }

  /** Who gave the viewer what in one bot, in each of their spaces. */
  async forViewer(viewerId: string, bot: ShareBot): Promise<Array<{ spaceId: string; ownerId: string; ownerName: string; itemIds: string[]; titles: string[] }>> {
    const hidden = await this.blocks.hiddenFor(viewerId);
    const out: Array<{ spaceId: string; ownerId: string; ownerName: string; itemIds: string[]; titles: string[] }> = [];
    for (const s of await this.spaces.mine(viewerId)) {
      const members = await this.spaces.membersOf(s.id);
      const by = await this.reaching(viewerId, s.id, bot, members.map((m) => m.userId), hidden);
      for (const [ownerId, gs] of by) {
        out.push({ spaceId: s.id, ownerId, ownerName: members.find((m) => m.userId === ownerId)?.name ?? "Someone", itemIds: gs.map((g) => g.item_id), titles: gs.map((g) => g.title) });
      }
    }
    return out;
  }
}
