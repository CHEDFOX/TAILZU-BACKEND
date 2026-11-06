/**
 * SPACES: FAMILY AND FRIENDS. A space has members, the bots shared into it, invites by email, one standing code, and an activity log.
 * Its maker is its admin, for good; there are no roles (spacePerms.ts): every member may do the same things, and the admin a few more.
 * What is shared in it, its payment requests, its feed and its join requests are their own modules (shared.ts, payments.ts,
 * threads.ts, spaceFeed.ts, spaceJoin.ts) and ask this one who may do what (docs/spaces.md).
 *
 *   list(user) / detail(user, space)   the spaces the person is in (never a draft), and one whole (members, invites, activity, its code)
 *   create(user, name, me)             a new, named space (an old build's Start a space); its maker is its admin
 *   draft / draftInvite / finishDraft / dropDraft / draftOf   Create on the new Spaces screen: the first invite makes a draft nobody
 *                                      else sees, its mails go at once without a name, Done names it, Back deletes it
 *   inviteEmail(user, space, email)    the admin invites an address: a row, and a mail with the space's code
 *   invite(user, space, { email? })    an old build's invite: by email, or (no email) the space's code and its link
 *   codeFor / newCode                  the space's one code (made the first time it is asked for); the admin can make a new one
 *   addMember(space, user, name, o)    the one place a member row is written (spaceJoin.ts lets people in through it)
 *   setConsent / consented             the member saw "The space's admin can see your work and messages there."
 *   addBot / removeBot, rename, leave (or the admin removes someone), activity
 *   access(user, space) / need(user, space, perm)   who may do what: the other modules' one question
 *
 * Every check is here, on the server: a member who may not do a thing gets 403 in plain words; someone not in the space gets 404 (the
 * space "isn't there"). A space never pays: approving a payment is "you press pay" in your own UPI app.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { BotError, type Bots } from "../bots/index.js";
import { live } from "../live/bus.js";
import { screenPost } from "./filter.js";
import { cleanEmail, mailerFromEnv, MailOutbox, type Mailer } from "./mail.js";
import { shownLook, looksIn, type PersonLook } from "./personLook.js";
import { table, type Table } from "./rows.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import { ADMIN_ONLY, MEMBER_PERMS, PERM_WORDS, PERMS, type Perm } from "./spacePerms.js";
import { SHARE_BOTS } from "./spaceShares.js";

export interface SpaceRow {
  [k: string]: unknown; id: string; owner_id: string; name: string; created_ms: number;
  /** The space's own code (6 letters and digits), made the first time it is asked for. */
  join_code?: string | null;
  /** Set while its maker is still calling their people: nobody else sees it. */
  draft_ms?: number | null;
  /** False while a draft has no name of its own yet. */
  named?: boolean;
}
export interface MemberRow {
  [k: string]: unknown; space_id: string; user_id: string; name: string; can_approve: boolean; joined_ms: number;
  /** Written for a rollback only (always MEMBER_PERMS now): nothing reads it. */
  perms?: string[];
  role?: string | null;
  /** When they saw "The space's admin can see your work and messages there." Null: not yet, so the admin sees only what they share. */
  consent_ms?: number | null;
}
export interface SpaceBotRow { [k: string]: unknown; space_id: string; slug: string; name: string; colour: string; added_by: string; added_ms: number }
export interface InviteRow {
  [k: string]: unknown; code: string; space_id: string; created_by: string; created_ms: number; expires_ms: number;
  email?: string | null; perms?: string[]; role?: string | null; used_by?: string | null; used_ms?: number | null;
  /** The invited person said no. */
  dismissed_ms?: number | null;
}
export interface ActivityRow { [k: string]: unknown; id: string; space_id: string; actor_id: string | null; kind: string; text: string; at_ms: number }

export interface MemberView {
  userId: string; name: string; you: boolean; maker: boolean; canApprove: boolean; joinedAt: number; perms: Perm[]; role: string | null; roleName: string;
  /** Their tiny bot in this space (personLook.ts): the viewer's own is their X0 bot. */
  bot: PersonLook;
}
export interface InviteView { code: string; link: string; email: string | null; expiresAt: number; roleName: string; perms: Perm[]; byYou: boolean; by: string; mail: "queued" | "sent" | "failed" | null }
export interface SpaceView {
  id: string;
  name: string;
  /** You made it: you are its admin. */
  mine: boolean;
  me: { admin: boolean; perms: Perm[] };
  members: MemberView[];
  bots: Array<{ slug: string; name: string; colour: string; addedBy: string; byYou: boolean }>;
  /** Always null now: a space has one code, on its detail for its admin (older builds read this). */
  invite: { code: string; expiresAt: number } | null;
  /** Always empty: there are no roles (older builds read this). */
  roles: Array<{ id: string; name: string; perms: Perm[]; preset: boolean }>;
}
export interface SpaceDetail extends SpaceView {
  /** Open invites, for the admin; none for anyone else. */
  invites: InviteView[];
  /** The log, newest first. */
  activity: Array<{ id: string; kind: string; text: string; at: number; by: string }> | null;
  /** The space's code, shown 7KQ-29D: the admin only (made here the first time). */
  code: string | null;
}
/** The maker's open draft on the new Spaces screen. `name` is its own name, or null while it has none. */
export interface DraftView { id: string; name: string | null; invites: Array<{ code: string; email: string; at: number; mail: "queued" | "sent" | "failed" | null }> }

export interface Access { s: SpaceRow; me: MemberRow; admin: boolean; perms: Perm[] }
/** joined.invitedBy: who made the invite that was used (they are told: routes/bots/botsSpaces.ts). */
export type MemberEvent = { spaceId: string; joined?: { userId: string; name: string; invitedBy?: string; spaceName?: string }; left?: string; deleted?: boolean };
export type Publish = (userIds: Iterable<string>, topic: string, data?: Record<string, unknown>) => void;

export const SPACES_MAX = 10;
export const MEMBERS_MAX = 20;
const SPACE_BOTS_MAX = 12;
const INVITES_A_DAY = 30;
const INVITE_MS = 7 * 24 * 3600_000;
const ACTIVITY_KEEP = 200;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** A draft's name until it is named (spaces.name is required). Never shown: DraftView.name is null until then. */
export const DRAFT_NAME = "New space";
/** A draft left this long is deleted the next time its maker opens Spaces or starts another. */
const DRAFT_MS = 24 * 3600_000;
/** The space's own code: CODE_CHARS, shown 3-3 ("7KQ-29D"). */
const JOIN_CODE_LEN = 6;
const CODE_TRIES = 5;
export const showCode = (c: string): string => `${c.slice(0, 3)}-${c.slice(3)}`;
/** Whether a code (as codeOf gives it) has the shape of a space's own code; an email invite's is 8 characters. */
export const isJoinCodeShape = (c: string): boolean => c.length === JOIN_CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch));
/** What an invite code looks like, in a link: anything else is not one. */
export const INVITE_CODE_RE = /^[A-Z0-9]{6,16}$/;

/**
 * Where an invite's link points: the host the phone app claims for its links (associatedDomains, intentFilters; the AASA serves
 * /s/*), the same one bots.link's QR uses (routes/account/deviceLink.ts LINK_ORIGIN). Opened there, the app goes straight to joining.
 */
export const INVITE_ORIGIN = (process.env.DEVICE_LINK_ORIGIN || "https://app.x0bot.com").replace(/\/+$/, "");
/** The screen an invite opens, and its parameter. */
export const JOIN_SCREEN = "bots.spaces";
export const inviteLinkOf = (origin: string, code: string): string => `${origin}/s/${JOIN_SCREEN}?join=${code}`;
/** A code as typed or linked: letters and digits, upper case ("7kq-29d" is 7KQ29D). */
export const codeOf = (v: unknown): string => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const notFound = () => new BotError("not_found", "That space isn't there any more.", 404);
const forbid = (msg: string) => new BotError("not_allowed", msg, 403);
/** "m•••@gmail.com": an address shown to someone who may not know it whole. */
const maskEmail = (e: string): string => { const [l, d] = e.split("@"); return `${(l ?? "").slice(0, 1)}•••@${d ?? ""}`; };
const isDraft = (s: Pick<SpaceRow, "draft_ms">): boolean => s.draft_ms !== null && s.draft_ms !== undefined;
const isOpen = (i: InviteRow, now: number): boolean => Number(i.expires_ms) > now && !i.used_by && (i.dismissed_ms === null || i.dismissed_ms === undefined);

function randomCode(len: number): string {
  const b = randomBytes(len);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

/** "You can't give tasks to others in Home.", or for what only the admin does, "Only Home's admin can invite people." */
function cant(perm: Perm, space: string): BotError {
  const what = `${PERM_WORDS[perm].label.charAt(0).toLowerCase()}${PERM_WORDS[perm].label.slice(1)}`;
  return forbid(ADMIN_ONLY.includes(perm) ? `Only ${space}'s admin can ${what}.` : `You can't ${what} in ${space}.`);
}

export interface SpaceOpts {
  publish?: Publish;
  outbox?: MailOutbox;
  mailer?: Mailer;
  /** The address invite links start with (INVITE_ORIGIN). */
  origin?: () => string;
  tables?: {
    spaces?: Table<SpaceRow>; members?: Table<MemberRow>; bots?: Table<SpaceBotRow>; invites?: Table<InviteRow>;
    activity?: PagedTable<ActivityRow>;
  };
}

export class Spaces {
  private readonly spaces: Table<SpaceRow>;
  private readonly members: Table<MemberRow>;
  private readonly shared: Table<SpaceBotRow>;
  private readonly invites: Table<InviteRow>;
  private readonly log: PagedTable<ActivityRow>;
  private readonly publish: Publish;
  readonly outbox: MailOutbox;
  readonly mailer: Mailer;
  private readonly origin: () => string;
  private readonly listeners: Array<(e: MemberEvent) => Promise<void>> = [];
  private lastNote = 0;

  constructor(private readonly bots: Bots | null, private readonly now: () => number = Date.now, o: SpaceOpts = {}) {
    this.spaces = o.tables?.spaces ?? table<SpaceRow>("spaces");
    this.members = o.tables?.members ?? table<MemberRow>("space_members");
    this.shared = o.tables?.bots ?? table<SpaceBotRow>("space_bots");
    this.invites = o.tables?.invites ?? table<InviteRow>("space_invites");
    this.log = o.tables?.activity ?? spaceTable<ActivityRow>("space_activity");
    this.publish = o.publish ?? ((ids, topic, data) => live.publish(ids, topic, data));
    this.outbox = o.outbox ?? new MailOutbox(undefined, now);
    this.mailer = o.mailer ?? mailerFromEnv();
    // The host the apps claim for their links: the invite opens X0 Bot at joining (a browser gets a page that opens it).
    this.origin = o.origin ?? (() => INVITE_ORIGIN);
  }

  /** Someone joined, left or was removed, or the space went: the chats follow (threads.ts). */
  onMembers(fn: (e: MemberEvent) => Promise<void>): void { this.listeners.push(fn); }
  private async emit(e: MemberEvent): Promise<void> { for (const fn of this.listeners) await fn(e).catch(() => undefined); }

  /** Tell everyone in the space (and `also`) that it changed. */
  async changed(spaceId: string, also: string[] = []): Promise<void> {
    const ids = [...(await this.memberIds(spaceId)), ...also];
    this.publish(ids, `space:${spaceId}`);
    this.publish(ids, "spaces");
  }

  // ------------------------------------------------------------------ who may do what

  /** No roles: the admin may do everything, everyone else the members' set. */
  private permsOfRow(m: MemberRow, s: SpaceRow): Perm[] {
    return m.user_id === s.owner_id ? [...PERMS] : [...MEMBER_PERMS];
  }

  /** The space and what this person may do in it; 404 when they aren't in it. */
  async access(userId: string, spaceId: string): Promise<Access> {
    const [s] = spaceId ? await this.spaces.select({ id: spaceId }, { limit: 1 }) : [];
    if (!s) throw notFound();
    const [me] = await this.members.select({ space_id: spaceId, user_id: userId }, { limit: 1 });
    if (!me) throw notFound();
    return { s, me, admin: s.owner_id === userId, perms: this.permsOfRow(me, s) };
  }

  /** Like access, and 403 unless they may `perm`. */
  async need(userId: string, spaceId: string, perm: Perm): Promise<Access> {
    const a = await this.access(userId, spaceId);
    if (!a.perms.includes(perm)) throw cant(perm, a.s.name);
    return a;
  }

  /** What this person may do in the space, or null when they aren't in it. */
  async permsFor(userId: string, spaceId: string): Promise<Perm[] | null> {
    return this.access(userId, spaceId).then((a) => a.perms, () => null);
  }

  async memberIds(spaceId: string): Promise<string[]> {
    return (await this.members.select({ space_id: spaceId }, { limit: MEMBERS_MAX + 5 })).map((m) => m.user_id);
  }

  async membersOf(spaceId: string): Promise<Array<{ userId: string; name: string }>> {
    return (await this.memberRows(spaceId)).map((m) => ({ userId: m.user_id, name: m.name }));
  }

  /** The member rows as they are, oldest first (the feed and Work in space read who saw the line about the admin). */
  async memberRows(spaceId: string): Promise<MemberRow[]> {
    return this.members.select({ space_id: spaceId }, { order: "joined_ms", limit: MEMBERS_MAX + 5 });
  }

  /** The space's row, or null (a draft too: callers decide). */
  async spaceRow(spaceId: string): Promise<SpaceRow | null> {
    if (!spaceId) return null;
    return (await this.spaces.select({ id: spaceId }, { limit: 1 }))[0] ?? null;
  }

  /** Who the space's admin is: cheap, for the feed's rule (who sees a message to one person). */
  async ownerOf(spaceId: string): Promise<string | null> {
    return (await this.spaceRow(spaceId))?.owner_id ?? null;
  }

  async isMember(spaceId: string, userId: string): Promise<boolean> {
    return (await this.members.select({ space_id: spaceId, user_id: userId }, { limit: 1 })).length > 0;
  }

  /** The spaces this person is in, with what they may do in each. Never a draft: every list a person sees is made from this or list(). */
  async mine(userId: string): Promise<Array<{ id: string; name: string; perms: Perm[]; admin: boolean }>> {
    const rows = await this.members.select({ user_id: userId }, { order: "joined_ms", limit: SPACES_MAX * 2 });
    const out: Array<{ id: string; name: string; perms: Perm[]; admin: boolean }> = [];
    for (const m of rows) {
      const a = await this.access(userId, m.space_id).catch(() => null);
      if (a && !isDraft(a.s)) out.push({ id: a.s.id, name: a.s.name, perms: a.perms, admin: a.admin });
    }
    return out;
  }

  async nameOf(spaceId: string): Promise<string> {
    return (await this.spaceRow(spaceId))?.name ?? "";
  }

  // ------------------------------------------------------------------ reading

  private async view(userId: string, a: Access): Promise<SpaceView> {
    const { s } = a;
    const people = await this.members.select({ space_id: s.id }, { order: "joined_ms", limit: MEMBERS_MAX });
    const bots = await this.shared.select({ space_id: s.id }, { order: "added_ms", limit: SPACE_BOTS_MAX });
    // Looks from every member, oldest first, before anyone is hidden from this viewer: Mom is the same bot to everyone in it.
    const looks = looksIn(people.map((p) => p.user_id));
    return {
      id: s.id, name: s.name, mine: a.admin, me: { admin: a.admin, perms: a.perms },
      members: people.map((p) => {
        const admin = p.user_id === s.owner_id;
        return {
          userId: p.user_id, name: p.name, you: p.user_id === userId, maker: admin, canApprove: true,
          joinedAt: Number(p.joined_ms) || 0, perms: this.permsOfRow(p, s), role: admin ? "admin" : null, roleName: admin ? "Admin" : "Member",
          bot: shownLook(looks, p.user_id, userId),
        };
      }),
      bots: bots.map((b) => ({ slug: b.slug, name: b.name, colour: b.colour, addedBy: people.find((p) => p.user_id === b.added_by)?.name ?? "someone", byYou: b.added_by === userId })),
      invite: null,
      roles: [],
    };
  }

  /** The spaces the person is in, never a draft. It only reads: Home and both apps' launches read it every time. */
  async list(userId: string): Promise<SpaceView[]> {
    const mine = await this.members.select({ user_id: userId }, { order: "joined_ms", limit: SPACES_MAX * 2 });
    const out: SpaceView[] = [];
    for (const m of mine) {
      const a = await this.access(userId, m.space_id).catch(() => null);
      if (a && !isDraft(a.s)) out.push(await this.view(userId, a));
    }
    return out;
  }

  /** How many people the admin invited by email who haven't come in yet (open: not used, not taken back, not said no to). */
  async invited(userId: string, spaceId: string): Promise<number> {
    const a = await this.access(userId, spaceId).catch(() => null);
    if (!a?.admin) return 0;
    const at = this.now();
    return (await this.invites.select({ space_id: spaceId }, { limit: 200 })).filter((i) => !!i.email && isOpen(i, at)).length;
  }

  async detail(userId: string, spaceId: string): Promise<SpaceDetail> {
    const a = await this.access(userId, spaceId);
    const v = await this.view(userId, a);
    const invites: InviteView[] = [];
    if (a.admin) {
      const at = this.now();
      const rows = (await this.invites.select({ space_id: spaceId }, { order: "created_ms", desc: true, limit: 40 })).filter((i) => isOpen(i, at));
      const code = await this.codeFor(spaceId);
      for (const i of rows.slice(0, 12)) {
        const mail = i.email ? await this.outbox.byRef("space_invite", i.code) : null;
        invites.push({
          code: i.code, link: this.linkOf(code), email: i.email ?? null,
          expiresAt: Number(i.expires_ms), perms: [...MEMBER_PERMS], roleName: "Member", byYou: i.created_by === userId,
          by: v.members.find((m) => m.userId === i.created_by)?.name ?? "someone",
          mail: mail ? (mail.status === "sent" ? "sent" : mail.status === "failed" ? "failed" : "queued") : null,
        });
      }
    }
    const activity = a.perms.includes("activity") ? await this.activity(userId, spaceId, 30, v.members) : null;
    return { ...v, invites, activity, code: a.admin ? showCode(await this.codeFor(spaceId)) : null };
  }

  async activity(userId: string, spaceId: string, limit = 30, members?: MemberView[]): Promise<Array<{ id: string; kind: string; text: string; at: number; by: string }>> {
    if (!members) await this.need(userId, spaceId, "activity");
    const rows = await this.log.before({ space_id: spaceId }, "at_ms", null, Math.max(1, Math.min(limit, 100)));
    return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, at: Number(r.at_ms), by: r.actor_id === userId ? "You" : (members?.find((m) => m.userId === r.actor_id)?.name ?? "") }));
  }

  /** Write a line to the space's log (and keep the log short). */
  async note(spaceId: string, actorId: string | null, kind: string, line: string): Promise<void> {
    // Strictly after the last line, so two things in one millisecond keep their order.
    const at = this.lastNote = Math.max(this.now(), this.lastNote + 1);
    await this.log.insert({ id: randomUUID(), space_id: spaceId, actor_id: actorId, kind: kind.slice(0, 32), text: line.slice(0, 300), at_ms: at });
    const old = await this.log.before({ space_id: spaceId }, "at_ms", null, ACTIVITY_KEEP + 20);
    for (const r of old.slice(ACTIVITY_KEEP)) await this.log.remove({ id: r.id });
  }

  // ------------------------------------------------------------------ making, naming

  /** A space's name, as given: other people see it, so it is screened (422 blocked_content). */
  private async nameFrom(name: unknown, empty: string): Promise<string> {
    const n = clean(name, 40);
    if (!n) throw new BotError("bad_request", empty);
    await screenPost([n]);
    return n;
  }

  private async roomForOneMore(userId: string): Promise<void> {
    if ((await this.members.select({ user_id: userId }, { limit: SPACES_MAX + 1 })).length >= SPACES_MAX) throw new BotError("space_limit", `You can be in ${SPACES_MAX} spaces.`, 409);
  }

  /** A real, named space at once (an old build's Start a space, and Done with no draft). */
  async create(userId: string, name: unknown, me: string): Promise<{ id: string }> {
    const n = await this.nameFrom(name, "Give the space a name, like Home or Studio.");
    await this.roomForOneMore(userId);
    const id = randomUUID();
    const at = this.now();
    const who = clean(me, 40) || "You";
    // A real space: draft_ms null and named true are the columns' own defaults (migration 0068).
    await this.spaces.insert({ id, owner_id: userId, name: n, created_ms: at });
    await this.members.insert({ space_id: id, user_id: userId, name: who, can_approve: true, joined_ms: at, perms: [...PERMS], role: null });
    await this.note(id, userId, "made", `${who} made ${n}`);
    await this.emit({ spaceId: id, joined: { userId, name: who } });
    await this.changed(id);
    return { id };
  }

  async rename(userId: string, id: string, name: unknown): Promise<void> {
    const a = await this.need(userId, id, "rename");
    const n = await this.nameFrom(name, "Give the space a name.");
    if (n === a.s.name && a.s.named !== false) return;
    await this.spaces.update({ id }, { name: n, named: true });
    await this.note(id, userId, "renamed", `${a.me.name} renamed ${a.s.name} to ${n}`);
    await this.changed(id);
  }

  // ------------------------------------------------------------------ drafts (Create, then Call Your People, then Name your space)

  /** The maker's drafts, youngest first. */
  private async draftsOf(userId: string): Promise<SpaceRow[]> {
    // Through their member rows (indexed by person): a draft always has its maker in it.
    const out: SpaceRow[] = [];
    for (const m of await this.members.select({ user_id: userId }, { limit: SPACES_MAX * 2 })) {
      const s = await this.spaceRow(m.space_id);
      if (s && s.owner_id === userId && isDraft(s)) out.push(s);
    }
    return out.sort((a, b) => Number(b.draft_ms) - Number(a.draft_ms));
  }

  /** Their drafts left a day or more are deleted, as Back would (their mails stop). Only from the Spaces screen and Create: never a list. */
  private async sweep(userId: string): Promise<SpaceRow | null> {
    const [open, ...rest] = await this.draftsOf(userId);
    const stale = [...rest, ...(open && Number(open.draft_ms) <= this.now() - DRAFT_MS ? [open] : [])];
    for (const d of stale) await this.leave(userId, d.id).catch(() => undefined);
    return open && !stale.includes(open) ? open : null;
  }

  private async draftView(s: SpaceRow): Promise<DraftView> {
    const at = this.now();
    const rows = (await this.invites.select({ space_id: s.id }, { order: "created_ms", limit: MEMBERS_MAX * 2 })).filter((i) => !!i.email && isOpen(i, at));
    const invites: DraftView["invites"] = [];
    for (const i of rows) {
      const mail = await this.outbox.byRef("space_invite", i.code);
      invites.push({ code: i.code, email: i.email ?? "", at: Number(i.created_ms), mail: mail ? (mail.status === "sent" ? "sent" : mail.status === "failed" ? "failed" : "queued") : null });
    }
    return { id: s.id, name: s.named === false ? null : s.name, invites };
  }

  /** The maker's open draft, with who it invited, or null. Sweeps their old ones first. */
  async draftOf(userId: string): Promise<DraftView | null> {
    const d = await this.sweep(userId);
    return d ? this.draftView(d) : null;
  }

  /** The maker's open draft, made if there is none. A name (Make a new space) names it, screened. */
  async draft(user: { id: string }, o: { name?: unknown }, me: string): Promise<DraftView> {
    let d = await this.sweep(user.id);
    const named = o.name === undefined || o.name === null || o.name === "" ? null : await this.nameFrom(o.name, "Give the space a name.");
    if (!d) {
      await this.roomForOneMore(user.id);
      const at = this.now();
      d = { id: randomUUID(), owner_id: user.id, name: named ?? DRAFT_NAME, created_ms: at, draft_ms: at, named: !!named };
      await this.spaces.insert(d);
      await this.members.insert({ space_id: d.id, user_id: user.id, name: clean(me, 40) || "You", can_approve: true, joined_ms: at, perms: [...PERMS], role: null });
    } else if (named) {
      await this.spaces.update({ id: d.id }, { name: named, named: true });
      d = { ...d, name: named, named: true };
    }
    this.publish([user.id], "spaces");
    return this.draftView(d);
  }

  /** Call Your People: the draft (made if none), and an invite to this address on it. */
  async draftInvite(user: { id: string }, email: unknown, me: string): Promise<DraftView> {
    const d = await this.draft(user, {}, me);
    await this.inviteEmail(user, d.id, email, me);
    const s = await this.spaceRow(d.id);
    return s ? this.draftView(s) : d;
  }

  /** Done: the draft becomes a real space with this name, or its own. No draft: a new real space with the name. */
  async finishDraft(user: { id: string }, o: { name?: unknown }, me: string): Promise<{ id: string; name: string }> {
    const d = await this.sweep(user.id);
    const given = o.name === undefined || o.name === null || o.name === "" ? null : await this.nameFrom(o.name, "Name your space first.");
    if (!d) {
      if (!given) throw new BotError("bad_request", "Name your space first.");
      const { id } = await this.create(user.id, given, me);
      return { id, name: given };
    }
    const name = given ?? (d.named === false ? null : d.name);
    if (!name) throw new BotError("bad_request", "Name your space first.");
    await this.spaces.update({ id: d.id }, { name, named: true, draft_ms: null });
    const [m] = await this.members.select({ space_id: d.id, user_id: user.id }, { limit: 1 });
    const who = m?.name || clean(me, 40) || "You";
    await this.note(d.id, user.id, "made", `${who} made ${name}`);
    await this.emit({ spaceId: d.id, joined: { userId: user.id, name: who } });
    await this.changed(d.id);
    return { id: d.id, name };
  }

  /** Back: the draft goes, with its invites, and any mail still waiting to go. */
  async dropDraft(userId: string): Promise<void> {
    for (const d of await this.draftsOf(userId)) await this.leave(userId, d.id);
    this.publish([userId], "spaces");
  }

  // ------------------------------------------------------------------ the space's code

  private linkOf(code: string): string { return inviteLinkOf(this.origin(), code); }

  /** A code no space has yet: checked first (the memory twin has no unique index), and the database's unique index backs it. */
  private async freshCode(spaceId: string): Promise<string> {
    for (let i = 0; i < CODE_TRIES; i += 1) {
      const c = randomCode(JOIN_CODE_LEN);
      if ((await this.spaces.select({ join_code: c }, { limit: 1 })).length) continue;
      try {
        await this.spaces.update({ id: spaceId }, { join_code: c });
        return c;
      } catch { /* taken in the meantime (the unique index): another */ }
    }
    throw new BotError("failed", "Couldn't make a code just now. Try again.", 503);
  }

  /** The space's code, made the first time it is asked for (not by a list: GET /spaces never writes). */
  async codeFor(spaceId: string): Promise<string> {
    const s = await this.spaceRow(spaceId);
    if (!s) throw notFound();
    if (s.join_code) return s.join_code;
    await this.freshCode(spaceId);
    // Two first asks at once both write: whichever landed is the code.
    return (await this.spaceRow(spaceId))?.join_code ?? "";
  }

  /** The admin makes a new code; the old one stops working at once. Shown 7KQ-29D. */
  async newCode(user: { id: string }, spaceId: string): Promise<string> {
    const a = await this.access(user.id, spaceId);
    if (!a.admin) throw forbid(`Only ${a.s.name}'s admin can make a new code.`);
    const c = await this.freshCode(spaceId);
    await this.note(spaceId, user.id, "code", `${a.me.name} made a new code`);
    await this.changed(spaceId);
    return showCode(c);
  }

  /** The space a code is for (its own code), or null. */
  async byCode(code: string): Promise<SpaceRow | null> {
    if (code.length !== JOIN_CODE_LEN) return null;
    return (await this.spaces.select({ join_code: code }, { limit: 1 }))[0] ?? null;
  }

  // ------------------------------------------------------------------ invites

  /**
   * The admin invites an address: a row (its own code, seven days, good once for that address) and a mail with the space's code. A
   * draft's mail has no name ("their space"): it goes before the space is named. Up to 30 invite mails a day, counted in the outbox
   * by who sent them: its rows stay when a space or draft is deleted, so Back on Create can't start the count again. One open invite
   * an address.
   */
  async inviteEmail(user: { id: string }, spaceId: string, emailIn: unknown, me: string): Promise<{ code: string; email: string }> {
    const a = await this.need(user.id, spaceId, "invite");
    const email = cleanEmail(emailIn);
    if (!email) throw new BotError("bad_email", "That doesn't look like an email address.");
    const at = this.now();
    if ((await this.outbox.sentBy("space_invite", user.id, at - 24 * 3600_000, INVITES_A_DAY)) >= INVITES_A_DAY) {
      throw new BotError("invite_limit", `That's ${INVITES_A_DAY} invites today. Try again tomorrow.`, 429);
    }
    const open = (await this.invites.select({ space_id: spaceId, email }, { limit: 20 })).some((i) => isOpen(i, at));
    if (open) throw new BotError("already_invited", "They're already invited.", 409);
    const code = randomCode(8);
    await this.invites.insert({
      code, space_id: spaceId, created_by: user.id, created_ms: at, expires_ms: at + INVITE_MS,
      email, perms: [...MEMBER_PERMS], role: null, used_by: null, used_ms: null,
    });
    const joinCode = await this.codeFor(spaceId);
    const from = a.me.name || clean(me, 40) || "Someone";
    const space = a.s.named === false ? "their space" : a.s.name;
    await this.outbox.queue({
      to: email, kind: "space_invite", ref: code, by: user.id,
      subject: `${from} invited you to ${space} on X0 Bot`,
      text: [
        `${from} invited you to ${space} on X0 Bot.`,
        `Sign in to X0 Bot with this email (${email}) and the invite is waiting: open Spaces, tap your bot, and tap Accept.`,
        `Signing in with another email? Open Spaces, tap your bot, and type this code: ${showCode(joinCode)}. ${from} will let you in.`,
        "The space's admin can see your work and messages there.",
        `Get X0 Bot: ${this.linkOf(joinCode)}`,
        "If you weren't expecting this, you can ignore it.",
      ].join("\n\n"),
    });
    await this.note(spaceId, user.id, "invited", `${from} invited ${maskEmail(email)}`);
    await this.changed(spaceId);
    return { code, email };
  }

  /**
   * An old build's invite. The admin only; a role or permissions it names are ignored (there are none). With an email, inviteEmail;
   * without one (an old build's "link"), no new row: the space's own code and its link.
   */
  async invite(user: { id: string }, id: string, o: { email?: unknown } = {}, me = ""): Promise<{ code: string; link: string; expiresAt: number; email: string | null; mail: "queued" | null; mailReady: boolean }> {
    await this.need(user.id, id, "invite");
    const at = this.now();
    if (o.email !== undefined && o.email !== "" && o.email !== null) {
      const r = await this.inviteEmail(user, id, o.email, me);
      return { code: r.code, link: this.linkOf(await this.codeFor(id)), expiresAt: at + INVITE_MS, email: r.email, mail: "queued", mailReady: this.mailer.configured };
    }
    const code = await this.codeFor(id);
    return { code, link: this.linkOf(code), expiresAt: at + INVITE_MS, email: null, mail: null, mailReady: this.mailer.configured };
  }

  /** Take an invite back (the admin): it stops working, and a mail for it still waiting is not sent. */
  async revokeInvite(userId: string, id: string, code: string): Promise<void> {
    const a = await this.access(userId, id);
    const [i] = await this.invites.select({ code: codeOf(code), space_id: id }, { limit: 1 });
    if (!i) throw new BotError("not_found", "That invite isn't there any more.", 404);
    if (!a.admin) throw forbid(`Only ${a.s.name}'s admin can take an invite back.`);
    await this.invites.update({ code: i.code }, { expires_ms: this.now() });
    await this.outbox.cancel("space_invite", i.code);
    await this.changed(id);
  }

  /** One invite by its own code, as it is. */
  async inviteByCode(code: string): Promise<InviteRow | null> {
    if (!INVITE_CODE_RE.test(code)) return null;
    return (await this.invites.select({ code }, { limit: 1 }))[0] ?? null;
  }

  /** The open email invites to this address (spaceJoin.ts narrows them to the invitations it lists). */
  async invitesTo(email: string): Promise<InviteRow[]> {
    if (!email) return [];
    const at = this.now();
    return (await this.invites.select({ email }, { order: "created_ms", desc: true, limit: 40 })).filter((i) => isOpen(i, at));
  }

  /** An email invite used once: claimed on the expiry just read, so of two taps only one matches. False: someone was first. */
  async claimInvite(i: InviteRow, userId: string): Promise<boolean> {
    const at = this.now();
    return (await this.invites.update({ code: i.code, expires_ms: i.expires_ms } as Partial<InviteRow>, { used_by: userId, used_ms: at, expires_ms: at })) > 0;
  }

  /** The invited person said no: it isn't listed again. */
  async dismissInvite(code: string): Promise<void> {
    await this.invites.update({ code }, { dismissed_ms: this.now() });
  }

  /**
   * What an email invite's own code is for, without joining: the space's name and how many are in. A space's own code is never named
   * (6 characters that never expire: naming its space would let anyone guess codes and read family names), nor a draft: null.
   */
  async peek(code: unknown): Promise<{ name: string; members: number } | null> {
    const c = codeOf(code);
    if (!c || isJoinCodeShape(c)) return null;
    const inv = await this.inviteByCode(c);
    if (!inv || !isOpen(inv, this.now())) return null;
    const s = await this.spaceRow(inv.space_id);
    if (!s || isDraft(s)) return null;
    return { name: s.name, members: (await this.members.select({ space_id: s.id }, { limit: MEMBERS_MAX })).length };
  }

  // ------------------------------------------------------------------ members

  /**
   * The one place a member row is written: the caps, the members' set, whether they saw the line about the admin, the "joined" line,
   * and everyone told (the chats follow; whoever's invite it was hears who came in). spaceJoin.ts calls it.
   */
  async addMember(s: SpaceRow, user: { id: string }, name: string, o: { consent: boolean; invitedBy?: string }): Promise<void> {
    if (await this.isMember(s.id, user.id)) return;
    await this.roomFor(s, user.id);
    const who = clean(name, 40) || "Someone";
    const at = this.now();
    await this.members.insert({ space_id: s.id, user_id: user.id, name: who, can_approve: true, joined_ms: at, perms: [...MEMBER_PERMS], role: null, consent_ms: o.consent ? at : null });
    await this.note(s.id, user.id, "joined", `${who} joined`);
    await this.emit({ spaceId: s.id, joined: { userId: user.id, name: who, ...(o.invitedBy ? { invitedBy: o.invitedBy } : {}), spaceName: s.name } });
    await this.changed(s.id);
  }

  /** 409 unless there is room: the space has fewer than 20 people, and the person is in fewer than 10 spaces. */
  async roomFor(s: SpaceRow, userId: string): Promise<void> {
    if ((await this.members.select({ space_id: s.id }, { limit: MEMBERS_MAX + 1 })).length >= MEMBERS_MAX) throw new BotError("space_full", `A space can have ${MEMBERS_MAX} people.`, 409);
    await this.roomForOneMore(userId);
  }

  /** The member tapped OK on "The space's admin can see your work and messages here." Once is enough; the admin never needs it. */
  async setConsent(userId: string, spaceId: string): Promise<void> {
    const a = await this.access(userId, spaceId);
    if (a.admin || (a.me.consent_ms !== null && a.me.consent_ms !== undefined)) return;
    await this.members.update({ space_id: spaceId, user_id: userId }, { consent_ms: this.now() });
    await this.changed(spaceId);
  }

  /** Whether they saw the line about the admin (the admin: always). */
  async consented(spaceId: string, userId: string): Promise<boolean> {
    const s = await this.spaceRow(spaceId);
    if (!s) return false;
    if (s.owner_id === userId) return true;
    const [m] = await this.members.select({ space_id: spaceId, user_id: userId }, { limit: 1 });
    return !!m && m.consent_ms !== null && m.consent_ms !== undefined;
  }

  // ------------------------------------------------------------------ bots

  async addBot(userId: string, id: string, slug: unknown): Promise<void> {
    const a = await this.need(userId, id, "addBots");
    const ref = clean(slug, 40).toLowerCase();
    const found = ref && this.bots ? await this.bots.resolve(userId, ref) : null;
    if (!found) throw new BotError("not_found", "There is no such bot.", 404);
    const have = await this.shared.select({ space_id: id }, { limit: SPACE_BOTS_MAX + 1 });
    if (have.some((b) => b.slug === found.def.slug)) return;
    if (have.length >= SPACE_BOTS_MAX) throw new BotError("space_bots_limit", `A space can share ${SPACE_BOTS_MAX} bots.`, 409);
    await this.shared.insert({ space_id: id, slug: found.def.slug, name: found.def.name, colour: found.def.colour, added_by: userId, added_ms: this.now() });
    await this.note(id, userId, "bot", `${a.me.name} added ${found.def.name}`);
    await this.changed(id);
  }

  async removeBot(userId: string, id: string, slug: string): Promise<void> {
    const a = await this.need(userId, id, "addBots");
    const [b] = await this.shared.select({ space_id: id, slug }, { limit: 1 });
    if (!b) throw new BotError("not_found", "That bot isn't in this space.", 404);
    await this.shared.remove({ space_id: id, slug });
    await this.note(id, userId, "bot", `${a.me.name} took out ${b.name}`);
    await this.changed(id);
  }

  /**
   * The spaces whose bots `slug` is. Plan Ease, Notes, Travel bot and Xode are every group's bots (there is no add-a-bot step any
   * more), so for them it is every space the person is in; any other bot, the spaces it was added to.
   */
  async spacesWithBot(userId: string, slug: string): Promise<Array<{ id: string; name: string }>> {
    const out: Array<{ id: string; name: string }> = [];
    const everyGroups = (SHARE_BOTS as readonly string[]).includes(slug);
    for (const s of await this.mine(userId)) {
      if (!s.perms.includes("bots")) continue;
      if (everyGroups || (await this.shared.select({ space_id: s.id, slug }, { limit: 1 })).length) out.push({ id: s.id, name: s.name });
    }
    return out;
  }

  // ------------------------------------------------------------------ leaving

  /** Leave, or remove `memberId` (the admin only; nobody removes the admin). The admin leaving deletes the space. */
  async leave(userId: string, id: string, memberId?: string): Promise<{ deleted: boolean }> {
    const a = await this.access(userId, id);
    const who = memberId ?? userId;
    if (who !== userId) {
      if (!a.perms.includes("remove")) throw cant("remove", a.s.name);
      if (who === a.s.owner_id) throw forbid(`Nobody can remove ${a.s.name}'s admin.`);
      const [m] = await this.members.select({ space_id: id, user_id: who }, { limit: 1 });
      if (!m) throw new BotError("not_found", "They aren't in this space.", 404);
    }
    if (who === a.s.owner_id) {
      const everyone = await this.memberIds(id);
      // Any invite mail still waiting to go stops with the space.
      for (const i of await this.invites.select({ space_id: id }, { limit: 500 })) await this.outbox.cancel("space_invite", i.code);
      await this.emit({ spaceId: id, deleted: true });
      await this.shared.remove({ space_id: id });
      await this.invites.remove({ space_id: id });
      await this.log.remove({ space_id: id });
      await this.members.remove({ space_id: id });
      await this.spaces.remove({ id });
      this.publish(everyone, `space:${id}`);
      this.publish(everyone, "spaces");
      return { deleted: true };
    }
    const [gone] = await this.members.select({ space_id: id, user_id: who }, { limit: 1 });
    await this.members.remove({ space_id: id, user_id: who });
    await this.note(id, userId, who === userId ? "left" : "removed", who === userId ? `${a.me.name} left` : `${a.me.name} removed ${gone?.name ?? "someone"}`);
    await this.emit({ spaceId: id, left: who });
    await this.changed(id, [who]);
    return { deleted: false };
  }
}
