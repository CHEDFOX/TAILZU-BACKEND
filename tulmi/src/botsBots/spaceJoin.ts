/**
 * COMING INTO A SPACE (docs/spaces.md): an invitation waiting for the invited email, a code, and the admin letting people in.
 *
 *   invitationsFor(user)                       the invitations waiting for this person: email invites the admin sent to their
 *                                              confirmed address, for named spaces they aren't in, from an admin they have no block with
 *   decideInvitation(user, code, accept|dismiss, consent, me)   Accept joins at once; Dismiss hides it. `consent`: which line about
 *                                              the admin their screen showed when they tapped it (0 none; spacePerms.ts lineShown)
 *   join(user, code, me, consent)              a code typed or linked: the space's own code, or an old invite's. The invited
 *                                              address joins at once; anyone else makes a join request for the admin
 *   peek(user, code)                           what an email invite's own code is for, before joining (never a space's own code)
 *   requestsFor(admin) / askedBy(user)         the open requests an admin decides; the ones a person is waiting on
 *   decide(admin, space, request, accept|dismiss)   the admin lets them in, or not
 *
 * THE RULES. A code alone never lets anyone in: it is short and never expires, so only the admin's yes does. An invitation is good
 * only for the address it was sent to, once that address is confirmed (AuthedUser.emailConfirmed), and only when the space's admin
 * made it (an invite a member made under the old roles makes a request). A draft is nobody's to join yet (409 not_ready). After the
 * admin says no, the same person waits a week to ask that space again; nobody asks more than 10 spaces a day. Asking, and every
 * decision, is pushed and told live to the admin and to the person asking.
 *
 * GUESSING. A space's own code is 6 characters and never expires, so a code alone must never say whose space it is: asking answers
 * "requested" with no name, the person's waiting line shows the code they typed, not the space, and peek names only an email
 * invite's own code (8 characters, seven days). Codes that don't work count against the person: after 20 in a day, every code
 * answers 429 until tomorrow, a good one too, so guessing can't go on.
 */
import { randomUUID } from "node:crypto";
import { Limiter } from "../artifacts/limits.js";
import { BotError } from "../bots/index.js";
import { live } from "../live/bus.js";
import { Blocks } from "./blocks.js";
import { screenPost } from "./filter.js";
import { cleanEmail } from "./mail.js";
import { looksIn, lookOf, type PersonLook } from "./personLook.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import { agreedTo, CONSENT_VERSION } from "./spacePerms.js";
import { codeOf, isJoinCodeShape, showCode, type InviteRow, type Publish, type SpaceRow, type Spaces } from "./spaces.js";

/** "requested" names no space: the code alone was all they had (the rules at the top). */
export type JoinResult = { status: "joined" | "member"; id: string; name: string } | { status: "requested" } | { status: "dismissed"; name: string };
/** `byBot`: the admin who invited them, as their tiny bot in that space (personLook.ts). */
export interface Invitation { code: string; spaceId: string; spaceName: string; by: string; byBot: PersonLook; people: number; expiresAt: number }
/** `bot`: the one asking, as the tiny bot they would be in that space once let in. */
export interface JoinRequestView { id: string; spaceId: string; spaceName: string; name: string; bot: PersonLook; at: number }
/** One of the person's own open requests: the code they typed (shown 7KQ-29D), never the space's name. */
export interface MyRequest { id: string; code: string; at: number }

export interface JoinRequestRow {
  [k: string]: unknown;
  id: string; space_id: string; user_id: string; name: string; consent_ms: number | null;
  /** Which line about the admin their screen showed when they asked (migration 0069; spacePerms.ts CONSENT_VERSION). */
  consent_v?: number | null;
  status: "open" | "accepted" | "dismissed"; created_ms: number; decided_ms: number | null; decided_by: string | null;
  /** The code they typed, as they see it while they wait. */
  code?: string;
}

/** Who is joining: their address only counts once it is confirmed. */
export interface Joiner { id: string; email?: string | null; emailConfirmed?: boolean }

/** A push to someone's phones (routes: the push engine). Never throws to the caller. */
export type JoinNotify = (userId: string, msg: { kind: "space_request" | "space_accepted"; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<void>;

const INVITATIONS_MAX = 10;
const REQUESTS_MAX = 20;
const ASKED_MAX = 10;
const REQUESTS_A_DAY = 10;
const DAY_MS = 24 * 3600_000;
/** After the admin says no, the same person waits this long to ask that space again. */
const ASK_AGAIN_MS = 7 * DAY_MS;
/** Codes that didn't work, a person, a day (the rules at the top). */
const MISSES_A_DAY = 20;

const badCode = () => new BotError("bad_code", "That code doesn't work. Check it and try again.", 404);
const decisionOf = (v: unknown): "accept" | "dismiss" => {
  if (v !== "accept" && v !== "dismiss") throw new BotError("bad_request", "Accept or dismiss.");
  return v;
};
const isDraft = (s: SpaceRow): boolean => s.draft_ms !== null && s.draft_ms !== undefined;

export class SpaceJoin {
  private readonly rows: PagedTable<JoinRequestRow>;
  private readonly notify: JoinNotify;
  private readonly publish: Publish;
  private readonly blocks: Blocks;
  /**
   * Codes that didn't work, per person. Kept in this process's memory, as the server's other brakes are (artifacts/limits.ts): a
   * restart forgets a day at most, and the per-minute route limits still hold.
   */
  private readonly misses: Limiter;

  constructor(
    private readonly spaces: Spaces,
    private readonly now: () => number = Date.now,
    o: { notify?: JoinNotify; publish?: Publish; blocks?: Blocks; rows?: PagedTable<JoinRequestRow> } = {},
  ) {
    this.rows = o.rows ?? spaceTable<JoinRequestRow>("space_join_requests");
    this.notify = o.notify ?? (async () => undefined);
    this.publish = o.publish ?? ((ids, topic, data) => live.publish(ids, topic, data));
    this.blocks = o.blocks ?? new Blocks(now);
    this.misses = new Limiter(MISSES_A_DAY, DAY_MS, { now });
    spaces.onMembers(async (e) => {
      if (e.deleted) await this.rows.remove({ space_id: e.spaceId });
      // In by another door (an invitation): their request for the space is answered.
      else if (e.joined) await this.rows.update({ space_id: e.spaceId, user_id: e.joined.userId, status: "open" }, { status: "accepted", decided_ms: this.now() });
    });
  }

  // ------------------------------------------------------------------ invitations

  /** Whether this invite is one waiting for this person (the rules at the top), with its space. */
  private async invitation(user: Joiner, i: InviteRow): Promise<{ s: SpaceRow; by: string; byBot: PersonLook; people: number } | null> {
    const s = await this.spaces.spaceRow(i.space_id);
    if (!s || isDraft(s) || i.created_by !== s.owner_id) return null;
    if (await this.spaces.isMember(s.id, user.id)) return null;
    if (await this.blocks.between(user.id, s.owner_id)) return null;
    const rows = await this.spaces.memberRows(s.id);
    const byBot = looksIn(rows.map((m) => m.user_id)).get(s.owner_id) ?? lookOf(s.owner_id);
    return { s, by: rows.find((m) => m.user_id === s.owner_id)?.name ?? "Someone", byBot, people: rows.length };
  }

  /** The person's confirmed address, or "" (none, not confirmed, or a static token). */
  private emailOf(user: Joiner): string {
    return user.emailConfirmed === true ? cleanEmail(user.email ?? "") : "";
  }

  async invitationsFor(user: Joiner): Promise<Invitation[]> {
    const email = this.emailOf(user);
    if (!email) return [];
    const out: Invitation[] = [];
    for (const i of await this.spaces.invitesTo(email)) {
      if (out.length >= INVITATIONS_MAX) break;
      if (out.some((x) => x.spaceId === i.space_id)) continue;
      const w = await this.invitation(user, i);
      if (w) out.push({ code: i.code, spaceId: w.s.id, spaceName: w.s.name, by: w.by, byBot: w.byBot, people: w.people, expiresAt: Number(i.expires_ms) });
    }
    return out;
  }

  /** Accept (join at once, as the invited address) or dismiss an invitation the person has. Anything else is 404 bad_code. */
  async decideInvitation(user: Joiner, codeIn: unknown, decisionIn: unknown, consent: number, me: string): Promise<JoinResult> {
    const decision = decisionOf(decisionIn);
    const code = codeOf(codeIn);
    const listed = (await this.invitationsFor(user)).find((i) => i.code === code);
    if (!listed) throw new BotError("bad_code", "That invitation isn't there any more.", 404);
    const s = await this.spaces.spaceRow(listed.spaceId);
    if (!s) throw new BotError("bad_code", "That invitation isn't there any more.", 404);
    if (decision === "dismiss") {
      await this.spaces.dismissInvite(code);
      this.publish([user.id], "spaces");
      await this.spaces.changed(s.id);
      return { status: "dismissed", name: s.name };
    }
    return this.accept(user, code, s, consent, me);
  }

  /** In by an invitation: room is checked before it is used up, then claimed once (two taps: one wins), then they are in. */
  private async accept(user: Joiner, code: string, s: SpaceRow, consent: number, me: string): Promise<JoinResult> {
    const inv = await this.spaces.inviteByCode(code);
    if (!inv) throw new BotError("bad_code", "That invitation isn't there any more.", 404);
    await this.spaces.roomFor(s, user.id);
    if (!(await this.spaces.claimInvite(inv, user.id))) throw new BotError("bad_code", "That invitation has been used.", 404);
    // The admin made it: they hear who came in with it (routes/bots/botsSpaces.ts, space_joined).
    await this.spaces.addMember(s, { id: user.id }, me, { consent, invitedBy: inv.created_by });
    return { status: "joined", id: s.id, name: s.name };
  }

  // ------------------------------------------------------------------ a code

  /** What a code opens: the space (by its own code, or an old invite's that still works), or nothing. */
  private async spaceFor(code: string): Promise<SpaceRow | null> {
    const own = await this.spaces.byCode(code);
    if (own) return own;
    const inv = await this.spaces.inviteByCode(code);
    if (!inv || Number(inv.expires_ms) <= this.now() || (inv.email && inv.used_by)) return null;
    return this.spaces.spaceRow(inv.space_id);
  }

  /** 429 once the person has had 20 codes that didn't work today: before any look-up, so a good code says nothing either. */
  private guessing(userId: string): void {
    if (this.misses.retryAfterSec(userId) > 0) throw new BotError("code_limit", "That's a lot of codes that didn't work today. Try again tomorrow.", 429);
  }

  /** What an email invite's own code is for, before joining. A space's own code is never named here (the rules at the top). */
  async peek(userId: string, codeIn: unknown): Promise<{ name: string; members: number } | null> {
    const code = codeOf(codeIn);
    if (!code || isJoinCodeShape(code)) return null;
    this.guessing(userId);
    const r = await this.spaces.peek(code);
    if (!r) this.misses.allow(userId);
    return r;
  }

  async join(user: Joiner, codeIn: unknown, me: string, consent: number): Promise<JoinResult> {
    const code = codeOf(codeIn);
    this.guessing(user.id);
    const s = code ? await this.spaceFor(code) : null;
    if (!s) {
      this.misses.allow(user.id);
      throw badCode();
    }
    if (isDraft(s)) throw new BotError("not_ready", "That space isn't ready yet.", 409);
    if (await this.spaces.isMember(s.id, user.id)) return { status: "member", id: s.id, name: s.name };
    // The invited address, typing the code: as if they tapped Accept.
    const invited = (await this.invitationsFor(user)).find((i) => i.spaceId === s.id);
    if (invited) return this.accept(user, invited.code, s, consent, me);
    return this.ask(user, s, me, consent, code);
  }

  /** A join request for the admin (the rules at the top). */
  private async ask(user: Joiner, s: SpaceRow, me: string, consent: number, code: string): Promise<JoinResult> {
    // Someone with a block between them and the admin learns nothing more than a bad code would tell them.
    if (await this.blocks.between(user.id, s.owner_id)) throw badCode();
    const at = this.now();
    const theirs = await this.rows.select({ space_id: s.id, user_id: user.id }, { limit: 50 });
    if (theirs.some((r) => r.status === "open")) return { status: "requested" };
    if (theirs.some((r) => r.status === "dismissed" && Number(r.decided_ms) > at - ASK_AGAIN_MS)) {
      throw new BotError("asked_recently", "You asked already. Try again next week.", 409);
    }
    const today = (await this.rows.select({ user_id: user.id }, { order: "created_ms", desc: true, limit: REQUESTS_A_DAY + 1 })).filter((r) => Number(r.created_ms) > at - DAY_MS);
    if (today.length >= REQUESTS_A_DAY) throw new BotError("request_limit", "That's a lot of codes today. Try again tomorrow.", 429);
    // The admin reads this name. It comes from the account (its email), not from anything typed, so a name the screen flags is
    // shown as "Someone" rather than stopping a real person (Randi, say) from ever asking to join.
    const own = (me || "Someone").replace(/\s+/g, " ").trim().slice(0, 40) || "Someone";
    const name = await screenPost([own]).then(() => own, () => "Someone");
    try {
      await this.rows.insert({
        id: randomUUID(), space_id: s.id, user_id: user.id, name, consent_ms: consent > 0 ? at : null, consent_v: consent > 0 ? Math.min(consent, CONSENT_VERSION) : null, status: "open", created_ms: at, decided_ms: null, decided_by: null,
        code: code.slice(0, 16),
      });
    } catch (err) {
      // The database's one-open-request index: asked twice at once, and the other one is there.
      if ((await this.rows.select({ space_id: s.id, user_id: user.id, status: "open" }, { limit: 1 })).length) return { status: "requested" };
      throw err;
    }
    this.publish([s.owner_id, user.id], "spaces");
    await this.notify(s.owner_id, { kind: "space_request", key: `${s.id}:${user.id}:${at}`, vars: { name, space: s.name }, data: { thought: "1" } }).catch(() => undefined);
    return { status: "requested" };
  }

  // ------------------------------------------------------------------ requests

  /** The open requests of every space this person is the admin of, newest first. */
  async requestsFor(adminId: string): Promise<JoinRequestView[]> {
    const hidden = await this.blocks.hiddenFor(adminId);
    const out: JoinRequestView[] = [];
    for (const s of (await this.spaces.mine(adminId)).filter((x) => x.admin)) {
      const open = (await this.rows.select({ space_id: s.id, status: "open" }, { limit: REQUESTS_MAX })).filter((r) => !hidden.has(r.user_id));
      if (!open.length) continue;
      // Each one as the bot they would be there: after everyone in it now, in the order they asked.
      const members = (await this.spaces.memberRows(s.id)).map((m) => m.user_id);
      const looks = looksIn([...members, ...[...open].sort((a, b) => Number(a.created_ms) - Number(b.created_ms)).map((r) => r.user_id)]);
      for (const r of open) out.push({ id: r.id, spaceId: s.id, spaceName: s.name, name: r.name, bot: looks.get(r.user_id) ?? lookOf(r.user_id), at: Number(r.created_ms) });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, REQUESTS_MAX);
  }

  /** The requests this person is waiting on, newest first: by the code they typed, never the space's name (the rules at the top). */
  async askedBy(userId: string): Promise<MyRequest[]> {
    const open = (await this.rows.select({ user_id: userId }, { order: "created_ms", desc: true, limit: 50 })).filter((r) => r.status === "open");
    const out: MyRequest[] = [];
    for (const r of open.slice(0, ASKED_MAX)) {
      const s = await this.spaces.spaceRow(r.space_id);
      const c = codeOf(r.code);
      if (s) out.push({ id: r.id, code: isJoinCodeShape(c) ? showCode(c) : c, at: Number(r.created_ms) });
    }
    return out;
  }

  /** The admin lets them in, or not. A space that is full (or a person in too many) leaves the request open with that answer. */
  async decide(adminId: string, spaceId: string, requestId: string, decisionIn: unknown): Promise<{ status: "joined" | "dismissed"; name: string }> {
    const decision = decisionOf(decisionIn);
    const a = await this.spaces.access(adminId, spaceId);
    if (!a.admin) throw new BotError("not_allowed", `Only ${a.s.name}'s admin can let people in.`, 403);
    const [r] = requestId ? await this.rows.select({ id: requestId }, { limit: 1 }) : [];
    if (!r || r.space_id !== spaceId || r.status !== "open") throw new BotError("not_found", "That request isn't there any more.", 404);
    // A block made after they asked (the admin's screen may still show the request): never let them in.
    if (await this.blocks.between(adminId, r.user_id)) throw new BotError("not_found", "That request isn't there any more.", 404);
    const at = this.now();
    if (decision === "accept") {
      // The line their screen showed comes in with them: one made under the line before ("can see") is asked once more in the feed.
      await this.spaces.addMember(a.s, { id: r.user_id }, r.name, { consent: agreedTo(r) });
      await this.rows.update({ id: r.id }, { status: "accepted", decided_ms: at, decided_by: adminId });
      await this.notify(r.user_id, { kind: "space_accepted", key: `${spaceId}:${r.user_id}:accepted`, vars: { space: a.s.name, admin: a.me.name }, data: { id: spaceId } }).catch(() => undefined);
    } else {
      await this.rows.update({ id: r.id, status: "open" }, { status: "dismissed", decided_ms: at, decided_by: adminId });
    }
    // The asker's Spaces screen updates too (they are told live either way).
    await this.spaces.changed(spaceId, [r.user_id]);
    return { status: decision === "accept" ? "joined" : "dismissed", name: r.name };
  }
}
