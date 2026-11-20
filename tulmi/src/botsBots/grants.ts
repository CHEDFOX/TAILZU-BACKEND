/**
 * ONE THING SHARED FROM A BOT IN A SPACE ("/" in the feed, spaceFeed.ts): one plan, note, trip or Xode project, given to one person
 * there or to everyone in the space. It lets them open it and work on it from their own bot's "Work in space" (work.ts); a card for it
 * sits in the feed (threads.ts item kind "grant"). Kept in space_grants (migrations 0068, 0069).
 *
 *   give(space, owner, bot, item, to, by?)   a grant (the same thing to the same person by the same sharer twice is one grant)
 *   setMessage / dropForMessage         its card in the feed; moderation taking the card out takes the access with it (safety.ts)
 *   revoke(actor, space, grant)         Stop sharing (spaceFeed.ts takes its card out): the rules below say who may
 *   holds(viewer, space, owner, bot, item)   how a grant reaches the viewer: to them ("one"), to everyone ("everyone"), or not at
 *                                       all, and who shared it when that wasn't its owner
 *   ofItem(owner, bot, item)            who the owner shared one thing with, for their page ("Shared with Rohan in Home")
 *   forViewer(viewer, bot)              who gave the viewer what in that bot, across their spaces
 *
 * WHO SHARES: THE OWNER, AND ONLY EVER THE OWNER. Nothing leaves someone's account unless they shared it, so the admin shares its
 * own things like any other member and nobody else's (docs/social.md §4). The admin may still STOP any share in its space, which is
 * moderation of its own feed and takes nothing from anyone's account.
 *
 * The admin used to share any member's thing, with the owner never told — no card in their feed, no push, not even on their own page
 * for that thing. That is gone. `by_id` stays on the rows and nothing writes it; migration 0112 revokes the grants that have one, so
 * no access outlives the line that explained it.
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
  /**
   * Who shared it, when it wasn't its owner: the space's admin (migration 0069). NOTHING WRITES THIS ANY MORE — the admin has no
   * automatic sight of anyone's things, so only an owner shares (docs/social.md §4). It stays on the rows for a rollback, and 0112
   * revokes the rows that have one.
   */
  by_id?: string | null;
}

/** What a space's grants hold: at most this many a bot, read at once. */
const GRANTS_READ = 500;

/** How a grant reaches someone: given to them by name, or to everyone in the space. */
export type GrantReach = "one" | "everyone";

/** A share the space's admin made of someone else's thing (the rules at the top). */

/** Who shared it: the admin, for a share of someone else's thing; else its owner. */
/** Who shared a grant: its owner, always (the rules at the top). */
export const sharerOf = (g: Pick<GrantRow, "owner_id">): string => g.owner_id;

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

  /**
   * The same thing to the same person (or everyone) by the same sharer again is the grant already there, its title and line brought
   * up to date. `byId`: the space's admin sharing someone else's thing (spaceFeed.ts checks they may); a share by its owner has none.
   * The admin's share and the owner's own of the same thing are two grants: each is stopped by the one who may stop it.
   */
  async give(spaceId: string, owner: { id: string; name: string }, bot: ShareBot, item: OwnItem, toId: string | null): Promise<{ id: string }> {
    const same = (await this.inSpace(spaceId, bot)).find((g) => g.owner_id === owner.id && g.item_id === item.id && (g.to_id ?? null) === toId);
    const title = item.title.replace(/\s+/g, " ").trim().slice(0, 120) || "A thing";
    const line = item.line.replace(/\s+/g, " ").trim().slice(0, 120);
    if (same) {
      await this.rows.update({ id: same.id }, { title, line });
      return { id: same.id };
    }
    const id = randomUUID();
    await this.rows.insert({
      id, space_id: spaceId, owner_id: owner.id, bot, item_id: item.id.slice(0, 200), title, line, to_id: toId, message_id: null, created_ms: this.now(),
    });
    return { id };
  }

  async setMessage(grantId: string, messageId: string): Promise<void> {
    await this.rows.update({ id: grantId }, { message_id: messageId });
  }

  /**
   * Stop sharing: the space's admin takes back any share; anyone else only one they made (of their own thing). So a share the admin
   * made is the admin's alone to stop: its owner is refused like anyone else in the space. Someone not in it, or a grant that isn't
   * there, is the same 404. Returns the grant taken back, so its card can come out of the feed with it.
   */
  async revoke(actorId: string, spaceId: string, grantId: string): Promise<GrantRow> {
    const a = await this.spaces.access(actorId, spaceId);
    const [g] = grantId ? await this.rows.select({ id: grantId }, { limit: 1 }) : [];
    if (!g || g.space_id !== spaceId) throw new BotError("not_found", "That isn't shared any more.", 404);
    if (!a.admin && sharerOf(g) !== actorId) {
      throw new BotError("not_allowed", "Only the one who shared it, or the space's admin, can stop sharing it.", 403);
    }
    await this.rows.remove({ id: g.id });
    return g;
  }

  /**
   * Who the owner shared one thing of theirs with, in every space: their page lists them, each with Stop sharing. Never a share the
   * admin made of it: its owner isn't told of those, and couldn't stop them (the rules at the top).
   */
  async ofItem(ownerId: string, bot: ShareBot, itemId: string): Promise<GrantRow[]> {
    return await this.rows.select({ owner_id: ownerId, bot, item_id: itemId }, { order: "created_ms", limit: 60 });
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

  /**
   * How a grant of this exact item reaches the viewer: to them by name ("one", which wins), to everyone in the space, or not
   * (null). `by` is always null now: only an owner shares, so there is never anyone else to name (the rules at the top).
   */
  async holds(viewerId: string, spaceId: string, ownerId: string, bot: ShareBot, itemId: string): Promise<{ reach: GrantReach; by: string | null } | null> {
    if (!viewerId || viewerId === ownerId || !(await this.together(spaceId, viewerId, ownerId))) return null;
    const theirs = (await this.inSpace(spaceId, bot)).filter((g) => g.owner_id === ownerId && g.item_id === itemId && (!g.to_id || g.to_id === viewerId));
    const one = theirs.find((g) => g.to_id === viewerId);
    const g = one ?? theirs[0];
    return g ? { reach: one ? "one" : "everyone", by: null } : null;
  }

  /** The grants that reach the viewer in one space and bot, by owner (still in the space, no block, still standing). */
  async reaching(viewerId: string, spaceId: string, bot: ShareBot, memberIds: string[], hidden: Set<string>): Promise<Map<string, GrantRow[]>> {
    const out = new Map<string, GrantRow[]>();
    const reach = (await this.inSpace(spaceId, bot)).filter((g) => g.owner_id !== viewerId && (!g.to_id || g.to_id === viewerId) && memberIds.includes(g.owner_id) && !hidden.has(g.owner_id));
    for (const g of reach) out.set(g.owner_id, [...(out.get(g.owner_id) ?? []), g]);
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
