/**
 * SPACES: FAMILY AND FRIENDS. A space has members, each with what they may do (spacePerms.ts), the bots shared into it, invites by link
 * or email, its own roles, and an activity log. What is shared in it, its payment requests and its chats are their own modules
 * (shared.ts, payments.ts, threads.ts) and ask this one who may do what.
 *
 *   list(user) / detail(user, space)   the spaces the person is in, and one whole (members, roles, invites, activity as they may see them)
 *   create(user, name, me)             a new space; its maker is its admin, for good
 *   invite(user, space, { email?, role?, perms? })   a code and its link, seven days; with an email, bound to that address and mailed.
 *                                      The link opens the app at joining (https://app.x0bot.com/s/bots.spaces?join=CODE, a link
 *                                      the apps claim, as bots.link's does); a browser gets a page that opens it, with the code to type
 *   join(user, code, me)               into the space, with what the invite gave (never more than its maker can still do)
 *   setPerms(user, space, member, { role?, perms? })  what someone may do
 *   saveRole / dropRole                the admin's own named roles
 *   addBot / removeBot, rename, leave (or remove someone), activity
 *   access(user, space) / need(user, space, perm)   who may do what: the other modules' one question
 *
 * Every check is here, on the server: a member who may not do a thing gets 403 in plain words; someone not in the space gets 404 (the
 * space "isn't there"). A space never pays: approving a payment is "you press pay" in your own UPI app.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { BotError, type Bots } from "../bots/index.js";
import { live } from "../live/bus.js";
import { cleanEmail, mailerFromEnv, MailOutbox, type Mailer } from "./mail.js";
import { table, type Table } from "./rows.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import { covers, lacking, legacyPerms, PERM_WORDS, PERMS, permNames, permsOf, presetOf, PRESETS, roleFor, type Perm } from "./spacePerms.js";

export interface SpaceRow { [k: string]: unknown; id: string; owner_id: string; name: string; created_ms: number }
export interface MemberRow {
  [k: string]: unknown; space_id: string; user_id: string; name: string; can_approve: boolean; joined_ms: number;
  /** What they may do (absent on a row from before permissions: Family, and approving if they could). */
  perms?: string[];
  /** A preset ("family", "kid", "guest"), one of the space's own roles (its id), or null: just for them. */
  role?: string | null;
}
export interface SpaceBotRow { [k: string]: unknown; space_id: string; slug: string; name: string; colour: string; added_by: string; added_ms: number }
export interface InviteRow {
  [k: string]: unknown; code: string; space_id: string; created_by: string; created_ms: number; expires_ms: number;
  email?: string | null; perms?: string[]; role?: string | null; used_by?: string | null; used_ms?: number | null;
}
export interface RoleRow { [k: string]: unknown; id: string; space_id: string; name: string; perms: string[]; created_ms: number }
export interface ActivityRow { [k: string]: unknown; id: string; space_id: string; actor_id: string | null; kind: string; text: string; at_ms: number }

export interface MemberView { userId: string; name: string; you: boolean; maker: boolean; canApprove: boolean; joinedAt: number; perms: Perm[]; role: string | null; roleName: string }
export interface RoleView { id: string; name: string; perms: Perm[]; preset: boolean }
export interface InviteView { code: string; link: string; email: string | null; expiresAt: number; roleName: string; perms: Perm[]; byYou: boolean; by: string; mail: "queued" | "sent" | "failed" | null }
export interface SpaceView {
  id: string;
  name: string;
  /** You made it: you are its admin. */
  mine: boolean;
  me: { admin: boolean; perms: Perm[] };
  members: MemberView[];
  bots: Array<{ slug: string; name: string; colour: string; addedBy: string; byYou: boolean }>;
  /** Your newest link invite still good, if any. */
  invite: { code: string; expiresAt: number } | null;
  roles: RoleView[];
}
export interface SpaceDetail extends SpaceView {
  /** Open invites (all of them for someone who may invite; else none). */
  invites: InviteView[];
  /** The log, newest first, for someone who may see it; null otherwise. */
  activity: Array<{ id: string; kind: string; text: string; at: number; by: string }> | null;
}

export interface Access { s: SpaceRow; me: MemberRow; admin: boolean; perms: Perm[]; roles: RoleRow[] }
export type MemberEvent = { spaceId: string; joined?: { userId: string; name: string }; left?: string; deleted?: boolean };
export type Publish = (userIds: Iterable<string>, topic: string, data?: Record<string, unknown>) => void;

export const SPACES_MAX = 10;
export const MEMBERS_MAX = 20;
export const SPACE_BOTS_MAX = 12;
export const ROLES_MAX = 8;
export const INVITES_A_DAY = 30;
const INVITE_MS = 7 * 24 * 3600_000;
const ACTIVITY_KEEP = 200;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** What an invite code looks like, in a link: anything else is not one. */
export const INVITE_CODE_RE = /^[A-Z0-9]{6,16}$/;

/**
 * Where an invite's link points: the host the phone app claims for its links (associatedDomains, intentFilters; the AASA serves
 * /s/*), the same one bots.link's QR uses (routes/deviceLink.ts LINK_ORIGIN). Opened there, the app goes straight to joining.
 */
export const INVITE_ORIGIN = (process.env.DEVICE_LINK_ORIGIN || "https://app.x0bot.com").replace(/\/+$/, "");
/** The screen an invite opens, and its parameter. */
export const JOIN_SCREEN = "bots.spaces";
export const inviteLinkOf = (origin: string, code: string): string => `${origin}/s/${JOIN_SCREEN}?join=${code}`;

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const notFound = () => new BotError("not_found", "That space isn't there any more.", 404);
const forbid = (msg: string) => new BotError("not_allowed", msg, 403);
/** "m•••@gmail.com": an address shown to someone who may not know it whole. */
export const maskEmail = (e: string): string => { const [l, d] = e.split("@"); return `${(l ?? "").slice(0, 1)}•••@${d ?? ""}`; };

export function inviteCode(): string {
  const b = randomBytes(8);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

/** "You can't invite people in Home." */
const cant = (perm: Perm, space: string) => forbid(`You can't ${PERM_WORDS[perm].label.charAt(0).toLowerCase()}${PERM_WORDS[perm].label.slice(1)} in ${space}.`);

export interface SpaceOpts {
  publish?: Publish;
  outbox?: MailOutbox;
  mailer?: Mailer;
  /** The address invite links start with (INVITE_ORIGIN). */
  origin?: () => string;
  tables?: {
    spaces?: Table<SpaceRow>; members?: Table<MemberRow>; bots?: Table<SpaceBotRow>; invites?: Table<InviteRow>;
    roles?: PagedTable<RoleRow>; activity?: PagedTable<ActivityRow>;
  };
}

export class Spaces {
  private readonly spaces: Table<SpaceRow>;
  private readonly members: Table<MemberRow>;
  private readonly shared: Table<SpaceBotRow>;
  private readonly invites: Table<InviteRow>;
  private readonly roles: PagedTable<RoleRow>;
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
    this.roles = o.tables?.roles ?? spaceTable<RoleRow>("space_roles");
    this.log = o.tables?.activity ?? spaceTable<ActivityRow>("space_activity");
    this.publish = o.publish ?? ((ids, topic, data) => live.publish(ids, topic, data));
    this.outbox = o.outbox ?? new MailOutbox(undefined, now);
    this.mailer = o.mailer ?? mailerFromEnv();
    // The host the apps claim for their links: the invite opens Tailzu at joining (a browser gets a page that opens it).
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

  private permsOfRow(m: MemberRow, s: SpaceRow, roles: RoleRow[]): Perm[] {
    if (m.user_id === s.owner_id) return [...PERMS];
    const preset = presetOf(m.role);
    if (preset) return [...preset.perms];
    const custom = m.role ? roles.find((r) => r.id === m.role) : undefined;
    if (custom) return permsOf(custom.perms);
    return Array.isArray(m.perms) ? permsOf(m.perms) : legacyPerms(m.can_approve === true);
  }

  private roleName(m: MemberRow, s: SpaceRow, roles: RoleRow[], perms: Perm[]): string {
    if (m.user_id === s.owner_id) return "Admin";
    const preset = presetOf(m.role);
    if (preset) return preset.name;
    const custom = m.role ? roles.find((r) => r.id === m.role) : undefined;
    if (custom) return custom.name;
    const same = roleFor(perms, roles.map((r) => ({ id: r.id, perms: permsOf(r.perms) })));
    return presetOf(same)?.name ?? roles.find((r) => r.id === same)?.name ?? "Just for them";
  }

  /** The space and what this person may do in it; 404 when they aren't in it. */
  async access(userId: string, spaceId: string): Promise<Access> {
    const [s] = spaceId ? await this.spaces.select({ id: spaceId }, { limit: 1 }) : [];
    if (!s) throw notFound();
    const [me] = await this.members.select({ space_id: spaceId, user_id: userId }, { limit: 1 });
    if (!me) throw notFound();
    const roles = await this.roles.select({ space_id: spaceId }, { order: "created_ms", limit: ROLES_MAX });
    return { s, me, admin: s.owner_id === userId, perms: this.permsOfRow(me, s, roles), roles };
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
    return (await this.members.select({ space_id: spaceId }, { order: "joined_ms", limit: MEMBERS_MAX + 5 })).map((m) => ({ userId: m.user_id, name: m.name }));
  }

  /** The spaces this person is in, with what they may do in each. */
  async mine(userId: string): Promise<Array<{ id: string; name: string; perms: Perm[] }>> {
    const rows = await this.members.select({ user_id: userId }, { order: "joined_ms", limit: SPACES_MAX * 2 });
    const out: Array<{ id: string; name: string; perms: Perm[] }> = [];
    for (const m of rows) {
      const a = await this.access(userId, m.space_id).catch(() => null);
      if (a) out.push({ id: a.s.id, name: a.s.name, perms: a.perms });
    }
    return out;
  }

  async nameOf(spaceId: string): Promise<string> {
    const [s] = await this.spaces.select({ id: spaceId }, { limit: 1 });
    return s?.name ?? "";
  }

  // ------------------------------------------------------------------ reading

  private async view(userId: string, a: Access): Promise<SpaceView> {
    const { s, roles } = a;
    const people = await this.members.select({ space_id: s.id }, { order: "joined_ms", limit: MEMBERS_MAX });
    const bots = await this.shared.select({ space_id: s.id }, { order: "added_ms", limit: SPACE_BOTS_MAX });
    const open = (await this.invites.select({ space_id: s.id, created_by: userId }, { order: "created_ms", desc: true, limit: 5 }))
      .find((i) => !i.email && Number(i.expires_ms) > this.now());
    return {
      id: s.id, name: s.name, mine: a.admin, me: { admin: a.admin, perms: a.perms },
      members: people.map((p) => {
        const perms = this.permsOfRow(p, s, roles);
        return {
          userId: p.user_id, name: p.name, you: p.user_id === userId, maker: p.user_id === s.owner_id, canApprove: perms.includes("approve"),
          joinedAt: Number(p.joined_ms) || 0, perms, role: p.user_id === s.owner_id ? "admin" : (p.role ?? null), roleName: this.roleName(p, s, roles, perms),
        };
      }),
      bots: bots.map((b) => ({ slug: b.slug, name: b.name, colour: b.colour, addedBy: people.find((p) => p.user_id === b.added_by)?.name ?? "someone", byYou: b.added_by === userId })),
      invite: open ? { code: open.code, expiresAt: Number(open.expires_ms) } : null,
      roles: [
        ...PRESETS.map((p) => ({ id: p.id, name: p.name, perms: [...p.perms], preset: true })),
        ...roles.map((r) => ({ id: r.id, name: r.name, perms: permsOf(r.perms), preset: false })),
      ],
    };
  }

  async list(userId: string): Promise<SpaceView[]> {
    const mine = await this.members.select({ user_id: userId }, { order: "joined_ms", limit: SPACES_MAX * 2 });
    const out: SpaceView[] = [];
    for (const m of mine) {
      const a = await this.access(userId, m.space_id).catch(() => null);
      if (a) out.push(await this.view(userId, a));
    }
    return out;
  }

  async detail(userId: string, spaceId: string): Promise<SpaceDetail> {
    const a = await this.access(userId, spaceId);
    const v = await this.view(userId, a);
    let invites: InviteView[] = [];
    if (a.perms.includes("invite")) {
      const rows = (await this.invites.select({ space_id: spaceId }, { order: "created_ms", desc: true, limit: 40 }))
        .filter((i) => Number(i.expires_ms) > this.now() && !i.used_by);
      invites = [];
      for (const i of rows.slice(0, 12)) {
        const perms = await this.invitePerms(i, a.s, a.roles);
        const mail = i.email ? await this.outbox.byRef("space_invite", i.code) : null;
        invites.push({
          code: i.code, link: this.linkOf(i.code), email: i.email ? (i.created_by === userId || a.admin ? i.email : maskEmail(i.email)) : null,
          expiresAt: Number(i.expires_ms), perms, roleName: this.inviteRoleName(i, a.roles, perms), byYou: i.created_by === userId,
          by: v.members.find((m) => m.userId === i.created_by)?.name ?? "someone",
          mail: mail ? (mail.status === "sent" ? "sent" : mail.status === "failed" ? "failed" : "queued") : null,
        });
      }
    }
    const activity = a.perms.includes("activity") ? await this.activity(userId, spaceId, 30, v.members) : null;
    return { ...v, invites, activity };
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

  async create(userId: string, name: unknown, me: string): Promise<{ id: string }> {
    const n = clean(name, 40);
    if (!n) throw new BotError("bad_request", "Give the space a name, like Home or Studio.");
    if ((await this.members.select({ user_id: userId }, { limit: SPACES_MAX + 1 })).length >= SPACES_MAX) throw new BotError("space_limit", `You can be in ${SPACES_MAX} spaces.`, 409);
    const id = randomUUID();
    const at = this.now();
    const who = clean(me, 40) || "You";
    await this.spaces.insert({ id, owner_id: userId, name: n, created_ms: at });
    await this.members.insert({ space_id: id, user_id: userId, name: who, can_approve: true, joined_ms: at, perms: [...PERMS], role: null });
    await this.note(id, userId, "made", `${who} made ${n}`);
    await this.emit({ spaceId: id, joined: { userId, name: who } });
    await this.changed(id);
    return { id };
  }

  async rename(userId: string, id: string, name: unknown): Promise<void> {
    const a = await this.need(userId, id, "rename");
    const n = clean(name, 40);
    if (!n) throw new BotError("bad_request", "Give the space a name.");
    if (n === a.s.name) return;
    await this.spaces.update({ id }, { name: n });
    await this.note(id, userId, "renamed", `${a.me.name} renamed ${a.s.name} to ${n}`);
    await this.changed(id);
  }

  // ------------------------------------------------------------------ invites

  private linkOf(code: string): string { return inviteLinkOf(this.origin(), code); }

  /** What an invite gives: its preset or role as it is now, else its own list, else (an invite from before permissions) Family. */
  private async invitePerms(i: InviteRow, s: SpaceRow, roles?: RoleRow[]): Promise<Perm[]> {
    const preset = presetOf(i.role);
    if (preset) return [...preset.perms];
    const rs = roles ?? await this.roles.select({ space_id: s.id }, { limit: ROLES_MAX });
    const custom = i.role ? rs.find((r) => r.id === i.role) : undefined;
    if (custom) return permsOf(custom.perms);
    // An invite from before permissions has no role at all (migration 0051 makes theirs "family").
    return Array.isArray(i.perms) && i.role !== undefined ? permsOf(i.perms) : [...presetOf("family")!.perms];
  }

  private inviteRoleName(i: InviteRow, roles: RoleRow[], perms: Perm[]): string {
    return presetOf(i.role)?.name ?? roles.find((r) => r.id === i.role)?.name ?? (perms.length ? "Just for them" : "Can only look");
  }

  /** The permissions a choice names: a preset, one of the space's roles, or a list. Null: none named. */
  private wanted(a: Access, o: { role?: unknown; perms?: unknown }): { role: string | null; perms: Perm[] } | null {
    if (typeof o.role === "string" && o.role) {
      const preset = presetOf(o.role);
      if (preset) return { role: preset.id, perms: [...preset.perms] };
      const custom = a.roles.find((r) => r.id === o.role);
      if (!custom) throw new BotError("not_found", "That role isn't there any more.", 404);
      return { role: custom.id, perms: permsOf(custom.perms) };
    }
    if (o.perms !== undefined) return { role: null, perms: permsOf(o.perms) };
    return null;
  }

  /**
   * A code and its link, seven days. With `email`, the invite is that address's alone (signing in with it is how it is accepted) and
   * a mail is queued to it; without, anyone with the link can join. Either way it gives what was chosen, never more than you can do.
   */
  async invite(user: { id: string; name?: string }, id: string, o: { email?: unknown; role?: unknown; perms?: unknown } = {}): Promise<{ code: string; link: string; expiresAt: number; email: string | null; mail: "queued" | null; mailReady: boolean }> {
    const a = await this.need(user.id, id, "invite");
    let want = this.wanted(a, o);
    if (!want) {
      // Nothing chosen (an older app): Family, as far as you can give it.
      const fam = presetOf("family")!;
      want = lacking(a.perms, fam.perms).length ? { role: null, perms: fam.perms.filter((p) => a.perms.includes(p)) } : { role: fam.id, perms: [...fam.perms] };
    }
    const missing = lacking(a.perms, want.perms);
    if (missing.length) throw forbid(`You can't give what you can't do yourself: ${permNames(missing)}.`);
    const email = o.email === undefined || o.email === "" ? "" : cleanEmail(o.email);
    if (o.email !== undefined && o.email !== "" && !email) throw new BotError("bad_email", "That doesn't look like an email address.");
    const at = this.now();
    const recent = (await this.invites.select({ created_by: user.id }, { order: "created_ms", desc: true, limit: INVITES_A_DAY + 1 }))
      .filter((i) => Number(i.created_ms) > at - 24 * 3600_000);
    if (recent.length >= INVITES_A_DAY) throw new BotError("invite_limit", `That's ${INVITES_A_DAY} invites today. Try again tomorrow.`, 429);
    if (email && recent.some((i) => i.email === email && i.space_id === id && Number(i.expires_ms) > at)) {
      throw new BotError("already_invited", "They already have an invite to this space. Take that one back first to send another.", 409);
    }
    const code = inviteCode();
    await this.invites.insert({
      code, space_id: id, created_by: user.id, created_ms: at, expires_ms: at + INVITE_MS,
      email: email || null, perms: want.perms, role: want.role, used_by: null, used_ms: null,
    });
    const link = this.linkOf(code);
    if (email) {
      const from = a.me.name || "Someone";
      await this.outbox.queue({
        to: email, kind: "space_invite", ref: code,
        subject: `${from} invited you to ${a.s.name} on X0 Bot`,
        text: [
          `${from} invited you to ${a.s.name} on X0 Bot.`,
          `Open this link to join (it works for seven days): ${link}`,
          `Or open X0 Bot, go to You, then Spaces, tap Join with a code and enter ${code}.`,
          `Sign in with this email address (${email}) to accept. If you weren't expecting this, you can ignore it.`,
        ].join("\n\n"),
      });
      await this.note(id, user.id, "invited", `${from} invited ${maskEmail(email)}`);
    }
    await this.changed(id);
    return { code, link, expiresAt: at + INVITE_MS, email: email || null, mail: email ? "queued" : null, mailReady: this.mailer.configured };
  }

  /** Take an invite back: its maker, or the admin. A queued mail for it is not sent. */
  async revokeInvite(userId: string, id: string, code: string): Promise<void> {
    const a = await this.access(userId, id);
    const [i] = await this.invites.select({ code: clean(code, 16).toUpperCase(), space_id: id }, { limit: 1 });
    if (!i) throw new BotError("not_found", "That invite isn't there any more.", 404);
    if (i.created_by !== userId && !a.admin) throw forbid("Only who made the invite, or the admin, can take it back.");
    await this.invites.update({ code: i.code }, { expires_ms: this.now() });
    await this.outbox.cancel("space_invite", i.code);
    await this.changed(id);
  }

  /** What a code is for, without joining: the space's name (the link's page shows it) and whether it is for one address. */
  async peek(code: unknown): Promise<{ name: string; members: number; email: string | null } | null> {
    const c = clean(code, 16).toUpperCase();
    if (!c) return null;
    const [inv] = await this.invites.select({ code: c }, { limit: 1 });
    if (!inv || Number(inv.expires_ms) <= this.now() || inv.used_by) return null;
    const [s] = await this.spaces.select({ id: inv.space_id }, { limit: 1 });
    if (!s) return null;
    return { name: s.name, members: (await this.members.select({ space_id: s.id }, { limit: MEMBERS_MAX })).length, email: inv.email ? maskEmail(inv.email) : null };
  }

  async join(user: { id: string; email?: string | null }, code: unknown, me: string): Promise<{ id: string; name: string }> {
    const userId = user.id;
    const c = clean(code, 16).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const [inv] = c ? await this.invites.select({ code: c }, { limit: 1 }) : [];
    if (!inv || Number(inv.expires_ms) <= this.now()) throw new BotError("bad_code", "That code doesn't work. Ask for a new invite.", 404);
    const [s] = await this.spaces.select({ id: inv.space_id }, { limit: 1 });
    if (!s) throw new BotError("bad_code", "That space isn't there any more.", 404);
    if (inv.email && (!user.email || user.email.trim().toLowerCase() !== inv.email)) {
      throw new BotError("wrong_account", `This invite is for ${maskEmail(inv.email)}. Sign in with that email to accept it.`, 403);
    }
    const [already] = await this.members.select({ space_id: s.id, user_id: userId }, { limit: 1 });
    if (already) return { id: s.id, name: s.name };
    if (inv.email && inv.used_by) throw new BotError("bad_code", "That invite has been used. Ask for a new one.", 404);
    // It gives what it says, and never more than the person who made it can still do (nothing, once they've left).
    const roles = await this.roles.select({ space_id: s.id }, { limit: ROLES_MAX });
    const [maker] = await this.members.select({ space_id: s.id, user_id: inv.created_by }, { limit: 1 });
    if (!maker) throw new BotError("bad_code", "That invite doesn't work any more. Ask for a new one.", 404);
    const makerPerms = this.permsOfRow(maker, s, roles);
    const given = await this.invitePerms(inv, s, roles);
    const perms = given.filter((p) => makerPerms.includes(p));
    const role = perms.length === given.length ? (inv.role && inv.role !== "custom" ? inv.role : null) : null;
    if ((await this.members.select({ space_id: s.id }, { limit: MEMBERS_MAX + 1 })).length >= MEMBERS_MAX) throw new BotError("space_full", `A space can have ${MEMBERS_MAX} people.`, 409);
    if ((await this.members.select({ user_id: userId }, { limit: SPACES_MAX + 1 })).length >= SPACES_MAX) throw new BotError("space_limit", `You can be in ${SPACES_MAX} spaces.`, 409);
    if (inv.email) {
      // One account per email invite: claim it first (on the expiry just read, so of two taps only one matches), then it's used up.
      const claimed = await this.invites.update({ code: inv.code, expires_ms: inv.expires_ms } as Partial<InviteRow>, { used_by: userId, used_ms: this.now(), expires_ms: this.now() });
      if (!claimed) throw new BotError("bad_code", "That invite has been used. Ask for a new one.", 404);
    }
    const who = clean(me, 40) || "Someone";
    await this.members.insert({ space_id: s.id, user_id: userId, name: who, can_approve: perms.includes("approve"), joined_ms: this.now(), perms, role });
    await this.note(s.id, userId, "joined", `${who} joined`);
    await this.emit({ spaceId: s.id, joined: { userId, name: who } });
    await this.changed(s.id);
    return { id: s.id, name: s.name };
  }

  // ------------------------------------------------------------------ what people may do

  /**
   * Change what `memberId` may do: to a preset or role, or to a list. You need "manage"; nobody changes the admin or themselves; and you
   * may only change someone who can't do more than you, to something that isn't more than you (so you can neither give nor take away
   * what you can't do yourself).
   */
  async setPerms(userId: string, id: string, memberId: string, o: { role?: unknown; perms?: unknown }): Promise<{ perms: Perm[]; role: string | null }> {
    const a = await this.need(userId, id, "manage");
    if (memberId === a.s.owner_id) throw forbid(`${a.s.name}'s admin can always do everything. That can't change.`);
    if (memberId === userId) throw forbid("You can't change what you can do yourself. Ask the admin.");
    const [m] = await this.members.select({ space_id: id, user_id: memberId }, { limit: 1 });
    if (!m) throw new BotError("not_found", "They aren't in this space.", 404);
    const before = this.permsOfRow(m, a.s, a.roles);
    if (!covers(a.perms, before)) throw forbid(`${m.name} can do things you can't (${permNames(lacking(a.perms, before))}), so only someone who can may change them.`);
    const want = this.wanted(a, o);
    if (!want) throw new BotError("bad_request", "Say which role, or which things they may do.");
    const missing = lacking(a.perms, want.perms);
    if (missing.length) throw forbid(`You can't give what you can't do yourself: ${permNames(missing)}.`);
    await this.members.update({ space_id: id, user_id: memberId }, { perms: want.perms, role: want.role, can_approve: want.perms.includes("approve") });
    const added = want.perms.filter((p) => !before.includes(p)), dropped = before.filter((p) => !want.perms.includes(p));
    if (added.length || dropped.length) {
      const role = presetOf(want.role)?.name ?? a.roles.find((r) => r.id === want.role)?.name;
      await this.note(id, userId, "perms", role ? `${a.me.name} made ${m.name} ${role}` : `${a.me.name} changed what ${m.name} can do`);
    }
    await this.changed(id);
    return want;
  }

  /** The old switch ("who approves payments"): turns approving on or off for someone, through setPerms' rules. */
  async setApprover(userId: string, id: string, memberId: string, on: unknown): Promise<void> {
    if (typeof on !== "boolean") throw new BotError("bad_request", "canApprove is true or false.");
    const a = await this.access(userId, id);
    if (memberId === a.s.owner_id) throw new BotError("is_admin", `${a.s.name}'s admin can always approve payments.`, 409);
    const [m] = await this.members.select({ space_id: id, user_id: memberId }, { limit: 1 });
    if (!m) throw new BotError("not_found", "They aren't in this space.", 404);
    const cur = this.permsOfRow(m, a.s, a.roles);
    await this.setPerms(userId, id, memberId, { perms: on ? [...cur, "approve"] : cur.filter((p) => p !== "approve") });
  }

  /** A role of the space's own, made or changed by its admin (`roleId` to change one). Its members follow it. */
  async saveRole(userId: string, id: string, o: { roleId?: unknown; name?: unknown; perms?: unknown }): Promise<RoleView> {
    const a = await this.access(userId, id);
    if (!a.admin) throw forbid("Only the admin can make roles.");
    const name = clean(o.name, 30);
    if (!name) throw new BotError("bad_request", "Name the role, like Grandparent or Cook.");
    if (PRESETS.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new BotError("bad_request", `${name} is one of X0 Bot's roles already. Pick another name.`);
    const perms = permsOf(o.perms);
    if (typeof o.roleId === "string" && o.roleId) {
      const r = a.roles.find((x) => x.id === o.roleId);
      if (!r) throw new BotError("not_found", "That role isn't there any more.", 404);
      await this.roles.update({ id: r.id, space_id: id }, { name, perms });
      await this.members.update({ space_id: id, role: r.id } as Partial<MemberRow>, { perms, can_approve: perms.includes("approve") });
      await this.changed(id);
      return { id: r.id, name, perms, preset: false };
    }
    if (a.roles.length >= ROLES_MAX) throw new BotError("role_limit", `A space can have ${ROLES_MAX} roles of its own.`, 409);
    const rid = randomUUID();
    await this.roles.insert({ id: rid, space_id: id, name, perms, created_ms: this.now() });
    await this.changed(id);
    return { id: rid, name, perms, preset: false };
  }

  /** Delete a role: its members keep what it gave them, just for them. */
  async dropRole(userId: string, id: string, roleId: string): Promise<void> {
    const a = await this.access(userId, id);
    if (!a.admin) throw forbid("Only the admin can delete roles.");
    if (!(await this.roles.remove({ id: roleId, space_id: id }))) throw new BotError("not_found", "That role isn't there any more.", 404);
    await this.members.update({ space_id: id, role: roleId } as Partial<MemberRow>, { role: null });
    await this.changed(id);
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

  /** The spaces where this person may use the shared bots and `slug` is one of them. */
  async spacesWithBot(userId: string, slug: string): Promise<Array<{ id: string; name: string }>> {
    const out: Array<{ id: string; name: string }> = [];
    for (const s of await this.mine(userId)) {
      if (!s.perms.includes("bots")) continue;
      if ((await this.shared.select({ space_id: s.id, slug }, { limit: 1 })).length) out.push({ id: s.id, name: s.name });
    }
    return out;
  }

  // ------------------------------------------------------------------ leaving

  /** Leave, or remove `memberId` (needs "remove", and only someone who can't do more than you). The admin leaving deletes the space. */
  async leave(userId: string, id: string, memberId?: string): Promise<{ deleted: boolean }> {
    const a = await this.access(userId, id);
    const who = memberId ?? userId;
    if (who !== userId) {
      if (!a.perms.includes("remove")) throw cant("remove", a.s.name);
      if (who === a.s.owner_id) throw forbid(`Nobody can remove ${a.s.name}'s admin.`);
      const [m] = await this.members.select({ space_id: id, user_id: who }, { limit: 1 });
      if (!m) throw new BotError("not_found", "They aren't in this space.", 404);
      const theirs = this.permsOfRow(m, a.s, a.roles);
      if (!covers(a.perms, theirs)) throw forbid(`${m.name} can do things you can't, so you can't remove them.`);
    }
    if (who === a.s.owner_id) {
      const everyone = await this.memberIds(id);
      await this.emit({ spaceId: id, deleted: true });
      await this.shared.remove({ space_id: id });
      await this.invites.remove({ space_id: id });
      await this.roles.remove({ space_id: id });
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
