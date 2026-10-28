/**
 * SPACES: BOTS SHARED WITH FAMILY OR A TEAM. A space has members, the bots shared into it, who may approve payments, and invites by link.
 *
 *   list(user)                         the spaces the person is in, each with its members, bots, approvers and (for its maker) the open invite
 *   create(user, name, me)             a new space; its maker is in it and approves payments
 *   invite(user, space)                a short code and its link, good for seven days; anyone in the space may make one
 *   join(user, code, me)               into the space the code is for
 *   setApprover(user, space, member)   who may approve payments (the maker decides); a space keeps at least one approver
 *   addBot / removeBot                 share one of your bots (or a Tailzu one) into the space, or take it out
 *   leave(user, space, member?)        leave, or (the maker) remove someone; the maker deleting the space removes it for everyone
 *
 * Minimal, and honest about it: a space says who may approve a payment; it never pays. A bot shared here is listed for everyone in it;
 * each person's own chats with it stay their own.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { BotError, type Bots } from "../bots/index.js";
import { table, type Table } from "./rows.js";

export interface SpaceRow { [k: string]: unknown; id: string; owner_id: string; name: string; created_ms: number }
export interface MemberRow { [k: string]: unknown; space_id: string; user_id: string; name: string; can_approve: boolean; joined_ms: number }
export interface SpaceBotRow { [k: string]: unknown; space_id: string; slug: string; name: string; colour: string; added_by: string; added_ms: number }
export interface InviteRow { [k: string]: unknown; code: string; space_id: string; created_by: string; created_ms: number; expires_ms: number }

export interface SpaceView {
  id: string;
  name: string;
  mine: boolean;
  members: Array<{ userId: string; name: string; you: boolean; maker: boolean; canApprove: boolean; joinedAt: number }>;
  bots: Array<{ slug: string; name: string; colour: string; addedBy: string; byYou: boolean }>;
  invite: { code: string; expiresAt: number } | null;
}

export const SPACES_MAX = 10;
export const MEMBERS_MAX = 20;
export const SPACE_BOTS_MAX = 12;
const INVITE_MS = 7 * 24 * 3600_000;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const notFound = () => new BotError("not_found", "That space isn't there any more.", 404);

export function inviteCode(): string {
  const b = randomBytes(8);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

export class Spaces {
  constructor(
    private readonly bots: Bots | null,
    private readonly now: () => number = Date.now,
    private readonly spaces: Table<SpaceRow> = table<SpaceRow>("spaces"),
    private readonly members: Table<MemberRow> = table<MemberRow>("space_members"),
    private readonly shared: Table<SpaceBotRow> = table<SpaceBotRow>("space_bots"),
    private readonly invites: Table<InviteRow> = table<InviteRow>("space_invites"),
  ) {}

  private async space(userId: string, id: string): Promise<{ s: SpaceRow; me: MemberRow }> {
    const [s] = await this.spaces.select({ id }, { limit: 1 });
    if (!s) throw notFound();
    const [me] = await this.members.select({ space_id: id, user_id: userId }, { limit: 1 });
    if (!me) throw notFound();
    return { s, me };
  }

  async list(userId: string): Promise<SpaceView[]> {
    const mine = await this.members.select({ user_id: userId }, { order: "joined_ms", limit: SPACES_MAX * 2 });
    const out: SpaceView[] = [];
    for (const m of mine) {
      const [s] = await this.spaces.select({ id: m.space_id }, { limit: 1 });
      if (!s) continue;
      const people = await this.members.select({ space_id: s.id }, { order: "joined_ms", limit: MEMBERS_MAX });
      const bots = await this.shared.select({ space_id: s.id }, { order: "added_ms", limit: SPACE_BOTS_MAX });
      const open = (await this.invites.select({ space_id: s.id, created_by: userId }, { order: "created_ms", desc: true, limit: 1 }))
        .find((i) => Number(i.expires_ms) > this.now());
      out.push({
        id: s.id, name: s.name, mine: s.owner_id === userId,
        members: people.map((p) => ({ userId: p.user_id, name: p.name, you: p.user_id === userId, maker: p.user_id === s.owner_id, canApprove: p.can_approve === true, joinedAt: Number(p.joined_ms) || 0 })),
        bots: bots.map((b) => ({ slug: b.slug, name: b.name, colour: b.colour, addedBy: people.find((p) => p.user_id === b.added_by)?.name ?? "someone", byYou: b.added_by === userId })),
        invite: open ? { code: open.code, expiresAt: Number(open.expires_ms) } : null,
      });
    }
    return out;
  }

  async create(userId: string, name: unknown, me: string): Promise<{ id: string }> {
    const n = clean(name, 40);
    if (!n) throw new BotError("bad_request", "Give the space a name, like Home or Studio.");
    if ((await this.members.select({ user_id: userId }, { limit: SPACES_MAX + 1 })).length >= SPACES_MAX) throw new BotError("space_limit", `You can be in ${SPACES_MAX} spaces.`, 409);
    const id = randomUUID();
    const at = this.now();
    await this.spaces.insert({ id, owner_id: userId, name: n, created_ms: at });
    await this.members.insert({ space_id: id, user_id: userId, name: clean(me, 40) || "You", can_approve: true, joined_ms: at });
    return { id };
  }

  async rename(userId: string, id: string, name: unknown): Promise<void> {
    const { s } = await this.space(userId, id);
    if (s.owner_id !== userId) throw new BotError("not_yours", "Only the person who made the space can rename it.", 403);
    const n = clean(name, 40);
    if (!n) throw new BotError("bad_request", "Give the space a name.");
    await this.spaces.update({ id }, { name: n });
  }

  async invite(userId: string, id: string): Promise<{ code: string; expiresAt: number }> {
    await this.space(userId, id);
    const at = this.now();
    const code = inviteCode();
    await this.invites.insert({ code, space_id: id, created_by: userId, created_ms: at, expires_ms: at + INVITE_MS });
    return { code, expiresAt: at + INVITE_MS };
  }

  /** What a code is for, without joining: the space's name (the link's page shows it). */
  async peek(code: unknown): Promise<{ name: string; members: number } | null> {
    const c = clean(code, 16).toUpperCase();
    if (!c) return null;
    const [inv] = await this.invites.select({ code: c }, { limit: 1 });
    if (!inv || Number(inv.expires_ms) <= this.now()) return null;
    const [s] = await this.spaces.select({ id: inv.space_id }, { limit: 1 });
    if (!s) return null;
    return { name: s.name, members: (await this.members.select({ space_id: s.id }, { limit: MEMBERS_MAX })).length };
  }

  async join(userId: string, code: unknown, me: string): Promise<{ id: string; name: string }> {
    const c = clean(code, 16).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const [inv] = c ? await this.invites.select({ code: c }, { limit: 1 }) : [];
    if (!inv || Number(inv.expires_ms) <= this.now()) throw new BotError("bad_code", "That code doesn't work. Ask for a new invite.", 404);
    const [s] = await this.spaces.select({ id: inv.space_id }, { limit: 1 });
    if (!s) throw new BotError("bad_code", "That space isn't there any more.", 404);
    const [already] = await this.members.select({ space_id: s.id, user_id: userId }, { limit: 1 });
    if (already) return { id: s.id, name: s.name };
    if ((await this.members.select({ space_id: s.id }, { limit: MEMBERS_MAX + 1 })).length >= MEMBERS_MAX) throw new BotError("space_full", `A space can have ${MEMBERS_MAX} people.`, 409);
    if ((await this.members.select({ user_id: userId }, { limit: SPACES_MAX + 1 })).length >= SPACES_MAX) throw new BotError("space_limit", `You can be in ${SPACES_MAX} spaces.`, 409);
    await this.members.insert({ space_id: s.id, user_id: userId, name: clean(me, 40) || "Someone", can_approve: false, joined_ms: this.now() });
    return { id: s.id, name: s.name };
  }

  async setApprover(userId: string, id: string, memberId: string, on: unknown): Promise<void> {
    const { s } = await this.space(userId, id);
    if (s.owner_id !== userId) throw new BotError("not_yours", "Only the person who made the space can change who approves payments.", 403);
    if (typeof on !== "boolean") throw new BotError("bad_request", "canApprove is true or false.");
    const people = await this.members.select({ space_id: id }, { limit: MEMBERS_MAX });
    if (!people.some((p) => p.user_id === memberId)) throw new BotError("not_found", "They aren't in this space.", 404);
    if (!on && people.filter((p) => p.can_approve && p.user_id !== memberId).length === 0) throw new BotError("last_approver", "Someone in the space has to be able to approve payments.", 409);
    await this.members.update({ space_id: id, user_id: memberId }, { can_approve: on });
  }

  async addBot(userId: string, id: string, slug: unknown): Promise<void> {
    await this.space(userId, id);
    const ref = clean(slug, 40).toLowerCase();
    const found = ref && this.bots ? await this.bots.resolve(userId, ref) : null;
    if (!found) throw new BotError("not_found", "There is no such bot.", 404);
    const have = await this.shared.select({ space_id: id }, { limit: SPACE_BOTS_MAX + 1 });
    if (have.some((b) => b.slug === found.def.slug)) return;
    if (have.length >= SPACE_BOTS_MAX) throw new BotError("space_bots_limit", `A space can share ${SPACE_BOTS_MAX} bots.`, 409);
    await this.shared.insert({ space_id: id, slug: found.def.slug, name: found.def.name, colour: found.def.colour, added_by: userId, added_ms: this.now() });
  }

  async removeBot(userId: string, id: string, slug: string): Promise<void> {
    const { s } = await this.space(userId, id);
    const [b] = await this.shared.select({ space_id: id, slug }, { limit: 1 });
    if (!b) throw new BotError("not_found", "That bot isn't in this space.", 404);
    if (b.added_by !== userId && s.owner_id !== userId) throw new BotError("not_yours", "Only who added it, or who made the space, can take it out.", 403);
    await this.shared.remove({ space_id: id, slug });
  }

  /** Leave (or, the maker, remove `memberId`). The maker leaving deletes the space. */
  async leave(userId: string, id: string, memberId?: string): Promise<{ deleted: boolean }> {
    const { s } = await this.space(userId, id);
    const who = memberId ?? userId;
    if (who !== userId && s.owner_id !== userId) throw new BotError("not_yours", "Only the person who made the space can remove someone.", 403);
    if (who === s.owner_id) {
      await this.shared.remove({ space_id: id });
      await this.invites.remove({ space_id: id });
      await this.members.remove({ space_id: id });
      await this.spaces.remove({ id });
      return { deleted: true };
    }
    await this.members.remove({ space_id: id, user_id: who });
    return { deleted: false };
  }
}
