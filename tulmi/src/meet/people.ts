/**
 * THE MEETING BOT IN SPACES: WHOSE MEETINGS A SPACE'S ADMIN SEES (docs/spaces.md "The admin, and no roles", "The line about the admin").
 *
 *   membersOf(admin)    the members whose meetings the admin sees and may send the bot to, for them: in each space they are the admin of
 *                       (not a draft), each member who agreed to the line about the admin as it is now (spacePerms.ts hasConsent), with no
 *                       block between them. A member of two of their spaces is listed once, under the first (spaces come oldest first)
 *   adminsOf(member)    the admins who see the member's meetings: of each space the member is in but not the admin of, when the member
 *                       agreed to the line and there is no block between them. Each admin once
 *   NO_PEOPLE           nobody, for a server or a test without Spaces
 *
 * The same walk Work in space makes (botsBots/work.ts read): the person's spaces, each space's row and its member rows, never anyone's
 * things. Names are as the space has them (its member rows). While Spaces is off (botsBots/spacesSwitch.ts) there is nobody: no admin
 * sees a member's meeting, and nobody can send the bot for anyone.
 */
import { hasConsent } from "../botsBots/spacePerms.js";
import { spacesOn } from "../botsBots/spacesSwitch.js";
import type { SpaceRow, Spaces } from "../botsBots/spaces.js";

export interface MeetPeople {
  /** Members whose meetings this person sees and may send the bot for. Empty while Spaces is off. */
  membersOf(adminId: string): Promise<Array<{ userId: string; name: string; spaceId: string }>>;
  /** The admins who see this person's meetings, with this person's name as that space has it. Empty while Spaces is off. */
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
          if (m.user_id === adminId || listed.has(m.user_id) || hidden.has(m.user_id) || !hasConsent(m)) continue;
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
        if (!me || !hasConsent(me)) continue;
        listed.add(s.owner_id);
        out.push({ userId: s.owner_id, name: rows.find((r) => r.user_id === s.owner_id)?.name ?? "", spaceId: s.id, memberName: me.name });
      }
      return out;
    },
  };
}
