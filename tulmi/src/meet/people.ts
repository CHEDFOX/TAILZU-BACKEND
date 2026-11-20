/**
 * WHO MADE WHICH OF YOUR SPACES, AND WHO IS IN THE ONES YOU MADE. Plain space membership, nothing more.
 *
 *   membersOf(admin)    the people in each space this person made (not a draft), with no block between them. Listed once each,
 *                       under the first of those spaces (spaces come oldest first)
 *   adminsOf(member)    whoever made each space this person is in but did not make themselves. Each one once
 *   NO_PEOPLE           nobody, for a server or a test without Spaces
 *
 * IT GRANTS NOTHING. It used to be "whose meetings a space's admin sees", under the line members agreed to; the admin has no
 * automatic sight of anything any more (docs/social.md §4), so the consent filter is gone with it and these are now only a way to
 * ask who shares a space with whom. The mail bot still uses it to scope a grant its OWNER made (mail/access.ts "handler": the
 * addresses the owner handed over), which is the owner's choice and not the admin's.
 *
 * The same walk Work in space makes (botsBots/work.ts read): the person's spaces, each space's row and its member rows, never anyone's
 * things. Names are as the space has them (its member rows). While Spaces is off (botsBots/spacesSwitch.ts) there is nobody: no admin
 * sees a member's meeting, and nobody can send the bot for anyone.
 */
import { spacesOn } from "../botsBots/spacesSwitch.js";
import type { SpaceRow, Spaces } from "../botsBots/spaces.js";

export interface MeetPeople {
  /** The people in the spaces this person made. Empty while Spaces is off. */
  membersOf(adminId: string): Promise<Array<{ userId: string; name: string; spaceId: string }>>;
  /** Whoever made each space this person is in, with this person's name as that space has it. Empty while Spaces is off. */
  adminsOf(memberId: string): Promise<Array<{ userId: string; name: string; spaceId: string; memberName: string }>>;
}

export const NO_PEOPLE: MeetPeople = {
  async membersOf() { return []; },
  async adminsOf() { return []; },
};

const isDraft = (s: SpaceRow): boolean => s.draft_ms !== null && s.draft_ms !== undefined;

export function spacePeople(o: {
  spaces: Pick<Spaces, "mine" | "spaceRow" | "memberRows">;
  blocks: { hiddenFor(userId: string): Promise<Set<string>> };
}): MeetPeople {
  return {
    async membersOf(adminId) {
      if (!spacesOn() || !adminId) return [];
      const hidden = await o.blocks.hiddenFor(adminId);
      const out: Array<{ userId: string; name: string; spaceId: string }> = [];
      const listed = new Set<string>();
      for (const mine of await o.spaces.mine(adminId)) {
        if (!mine.admin) continue;
        const s = await o.spaces.spaceRow(mine.id);
        if (!s || isDraft(s) || s.owner_id !== adminId) continue;
        // Member rows come oldest first.
        for (const m of await o.spaces.memberRows(s.id)) {
          if (m.user_id === adminId || listed.has(m.user_id) || hidden.has(m.user_id)) continue;
          listed.add(m.user_id);
          out.push({ userId: m.user_id, name: m.name, spaceId: s.id });
        }
      }
      return out;
    },

    async adminsOf(memberId) {
      if (!spacesOn() || !memberId) return [];
      const hidden = await o.blocks.hiddenFor(memberId);
      const out: Array<{ userId: string; name: string; spaceId: string; memberName: string }> = [];
      const listed = new Set<string>();
      for (const mine of await o.spaces.mine(memberId)) {
        if (mine.admin) continue;
        const s = await o.spaces.spaceRow(mine.id);
        if (!s || isDraft(s) || s.owner_id === memberId || listed.has(s.owner_id) || hidden.has(s.owner_id)) continue;
        const rows = await o.spaces.memberRows(s.id);
        const me = rows.find((r) => r.user_id === memberId);
        if (!me) continue;
        listed.add(s.owner_id);
        out.push({ userId: s.owner_id, name: rows.find((r) => r.user_id === s.owner_id)?.name ?? "", spaceId: s.id, memberName: me.name });
      }
      return out;
    },
  };
}
