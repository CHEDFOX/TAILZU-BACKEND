/**
 * MESSAGING BETWEEN PEOPLE WHO SHARE A SPACE: one to one, groups made from a space's people, and each space's own chat.
 *
 *   list(user)                                the person's chats, newest first, each with its unread count
 *   contacts(user)                            who they can message, and the spaces they can start groups in
 *   direct(user, other)                       the one-to-one chat with someone they share a space with (made the first time)
 *   group(user, space, { name, people })      a group of people from one space ("all": the space's own chat)
 *   read(user, thread, { before? })           a page of messages, oldest first (and, the newest page, marks it read)
 *   send(user, thread, { text, files })       a message: words, photos and files (sent to POST /v1/files first, and theirs)
 *   leave(user, thread) / mute(user, thread, on)
 *
 * Who may: everyone in a space reads its chat and its groups they're in; writing needs "message" in that space; a group needs "start
 * group chats"; one to one needs a space you share in which you may message. A chat with someone you no longer share a space with can
 * still be read, not written to. Someone who leaves a space leaves its chat and its groups. Every write tells the people in the chat
 * (live: "thread:<id>" and "threads"), so an open chat updates by itself.
 *
 * BLOCKS (blocks.ts), either way round: the one-to-one chat between the two is gone for both (hidden, closed, 404), neither sees the
 * other's messages in a group or a space's chat (nor counts them unread, nor is pinged for them), and neither is offered the other
 * to message or to add to a group.
 *
 * A MESSAGE TO ONE PERSON (a space's feed, spaceFeed.ts: to_id): only its sender, that person and the space's admin see it. Every
 * reader here applies that one rule (sees()): a page, the widget's words, a report, a file, unread counts, pushes and live events.
 * A chat's last line (last_text, and last_public_ms, the time lists show) is only ever a message to everyone, so a message to one
 * person never moves anyone else's chat or line.
 *
 * A MEMBER'S THING THE ADMIN SHARED (spaceFeed.ts, grants.ts: a grant card whose owner isn't its sender): its owner is not told, so
 * sees() never shows them its card (nor counts it unread, pings them or tells them live), and anyone with a block with the owner
 * doesn't see it either, as with a card the owner sent. It is never a chat's last line, so no list or Home card says it to them.
 */
import { screenPost } from "./filter.js";
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { live } from "../live/bus.js";
import { Blocks } from "./blocks.js";
import { lookOf, looksIn, selfLook, shownLook, type PersonLook } from "./personLook.js";
import { signQuery } from "./spaceLinks.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import { pickedIds } from "./spacePerms.js";
import type { Publish, Spaces } from "./spaces.js";

export interface ThreadRow {
  [k: string]: unknown; id: string; kind: "direct" | "group" | "space"; space_id: string | null; name: string; direct_key: string | null;
  created_by: string | null; created_ms: number; last_ms: number; last_text: string;
  /** When last_text (a line for everyone) was written: what lists show. Null on rows from before migration 0068: last_ms then. */
  last_public_ms?: number | null;
}
export interface ThreadMemberRow {
  [k: string]: unknown; thread_id: string; user_id: string; name: string; joined_ms: number; last_read_ms: number; unread: number; muted: boolean; left_ms: number | null;
}
export interface FileRef { id: string; name: string; mime: string; bytes: number; kind: string; owner: string }
/**
 * A shared thing's card. A grant's (spaceFeed.ts, "/" in a space): kind "grant", id the grant's, and the item it opens; `ownerName`
 * when its owner isn't the one who sent it (the space's admin shared it: "Aanya shared Mom's Doctor visit").
 */
export interface ItemCard { id: string; kind: string; title: string; bot?: string; botName?: string; ownerId?: string; itemId?: string; line?: string; ownerName?: string }
export interface MessageRow {
  [k: string]: unknown; id: string; thread_id: string; sender_id: string | null; sender_name: string; text: string; files: FileRef[]; item: ItemCard | null; at_ms: number;
  /** A message to one person (migration 0068): who. Null or absent: for everyone in the chat. */
  to_id?: string | null; to_name?: string;
}

export interface MessageView {
  id: string; from: { userId: string | null; name: string; you: boolean }; text: string; at: number;
  files: Array<{ id: string; name: string; mime: string; bytes: number; kind: string; url: string }>; item: ItemCard | null;
  /** A message to one person: who (an old build says "To Rohan"). Null: for everyone. */
  to: { userId: string; name: string; you: boolean } | null;
}
export interface ThreadView {
  id: string; kind: ThreadRow["kind"]; name: string; spaceId: string | null; spaceName: string;
  /**
   * A one to one chat's two people carry `bot`: the other as their tiny bot wherever no space decides it (looksKnown), you your own.
   * Read one chat at a time (read), a group's or a space chat's people carry it too, as their space has them (each message's line is
   * in its sender's colour); the list never works them out.
   */
  people: Array<{ userId: string; name: string; you: boolean; bot?: PersonLook }>;
  last: { text: string; at: number } | null; unread: number; muted: boolean;
  /** Can write here now; when not, `why` says why in a line. */
  canPost: boolean; why: string;
}

/** A file the sender owns, as the media store has it (routes build this from MediaService). */
export interface FileLookup {
  get(userId: string, id: string): Promise<{ id: string; name: string; mime: string; bytes: number; kind: string } | null>;
}

/** A push for a new message (routes: the push engine). */
export type MessageNotify = (userId: string, msg: { kind: "space_message" | "space_feed"; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<void>;

const TEXT_MAX = 4000;
const FILES_MAX = 6;
const PAGE = 30;
const GROUPS_MAX = 40;

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "");
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const gone = () => new BotError("not_found", "That chat isn't there any more.", 404);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const names = (list: string[]) => (list.length <= 1 ? list[0] ?? "" : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
/** Whose thing a card is, when the space's admin shared it and it isn't theirs (the rules at the top); else null. */
const sharedOf = (m: Pick<MessageRow, "item" | "sender_id">): string | null =>
  m.item?.kind === "grant" && m.item.ownerId && m.item.ownerId !== m.sender_id ? m.item.ownerId : null;
/** A message for everyone in the chat (not one to one person, nor a card kept from its thing's owner): it may be the last line. */
const isPublic = (m: Pick<MessageRow, "to_id" | "item" | "sender_id">): boolean => !m.to_id && !sharedOf(m);
/** From, or (a card the admin sent) of the thing of, someone with a block with the viewer (`hidden`): not shown to them. */
const hiddenIn = (hidden: Set<string>, m: Pick<MessageRow, "item" | "sender_id">): boolean => {
  const of = sharedOf(m);
  return (!!m.sender_id && hidden.has(m.sender_id)) || (!!of && hidden.has(of));
};
/** A message as one line (a chat's last line, a report's subject). */
const lineOf = (m: Pick<MessageRow, "text" | "item" | "files">): string => m.text ? oneLine(m.text, 120) : m.item ? `Shared ${m.item.title}` : (m.files ?? []).length === 1 ? (m.files[0]!.mime.startsWith("image/") ? "Photo" : m.files[0]!.name) : `${(m.files ?? []).length} files`;

export class Threads {
  private readonly threads: PagedTable<ThreadRow>;
  private readonly people: PagedTable<ThreadMemberRow>;
  private readonly messages: PagedTable<MessageRow>;
  private readonly publish: Publish;

  constructor(
    private readonly spaces: Spaces,
    private readonly now: () => number = Date.now,
    o: { publish?: Publish; files?: FileLookup | null; filePath?: (threadId: string, messageId: string, fileId: string) => string; notify?: MessageNotify;
      blocks?: Blocks;
      tables?: { threads?: PagedTable<ThreadRow>; members?: PagedTable<ThreadMemberRow>; messages?: PagedTable<MessageRow> } } = {},
  ) {
    this.threads = o.tables?.threads ?? spaceTable<ThreadRow>("threads");
    this.people = o.tables?.members ?? spaceTable<ThreadMemberRow>("thread_members");
    this.messages = o.tables?.messages ?? spaceTable<MessageRow>("thread_messages");
    this.publish = o.publish ?? ((ids, topic, data) => live.publish(ids, topic, data));
    this.files = o.files ?? null;
    this.filePath = o.filePath ?? ((t, m, f) => `/v1/botsapp/bots/threads/${t}/files/${m}/${f}`);
    this.notify = o.notify ?? (async () => undefined);
    this.blocks = o.blocks ?? new Blocks(now);
    spaces.onMembers((e) => this.follow(e));
  }
  private readonly files: FileLookup | null;
  private readonly filePath: (threadId: string, messageId: string, fileId: string) => string;
  private readonly notify: MessageNotify;
  /** Who has blocked whom (blocks.ts): the rules at the top of this file. */
  readonly blocks: Blocks;

  // ------------------------------------------------------------------ who may

  private async thread(id: string): Promise<ThreadRow> {
    const [t] = UUID.test(id) ? await this.threads.select({ id }, { limit: 1 }) : [];
    if (!t) throw gone();
    return t;
  }

  private async active(threadId: string): Promise<ThreadMemberRow[]> {
    return (await this.people.select({ thread_id: threadId }, { limit: 60 })).filter((m) => m.left_ms === null || m.left_ms === undefined);
  }

  /** The thread and this person's row in it; 404 unless they may read it. */
  private async open(userId: string, threadId: string): Promise<{ t: ThreadRow; me: ThreadMemberRow; members: ThreadMemberRow[] }> {
    const t = await this.thread(threadId);
    const members = await this.active(t.id);
    const me = members.find((m) => m.user_id === userId);
    if (!me) throw gone();
    if (t.space_id && !(await this.spaces.permsFor(userId, t.space_id))) throw gone();
    // A one-to-one chat with a block between the two is gone for both.
    if (t.kind === "direct" && (await this.directBlocked(userId, t))) throw gone();
    return { t, me, members };
  }

  /** The other person in a one-to-one chat (from its key, which outlives their membership). */
  private otherOf(userId: string, t: ThreadRow): string {
    return (t.direct_key ?? "").split(":").find((id) => id && id !== userId) ?? "";
  }

  private async directBlocked(userId: string, t: ThreadRow): Promise<boolean> {
    const other = this.otherOf(userId, t);
    return !!other && (await this.blocks.hiddenFor(userId)).has(other);
  }

  /**
   * Who sees a message: everyone, for one to everyone; else its sender, the one it is to, and the space's admin (`ownerId`). A card
   * of a member's thing the admin shared, never its owner (the rules at the top).
   */
  private sees(viewer: string, m: Pick<MessageRow, "to_id" | "sender_id" | "item">, ownerId: string | null): boolean {
    if (sharedOf(m) === viewer) return false;
    return !m.to_id || m.sender_id === viewer || m.to_id === viewer || viewer === ownerId;
  }

  /** The space's admin, for a space's chat or group (a one-to-one chat has none, and never carries a message to one person). */
  private async ownerOf(t: ThreadRow): Promise<string | null> {
    return t.space_id ? this.spaces.ownerOf(t.space_id) : null;
  }

  async canRead(userId: string, threadId: string): Promise<boolean> {
    return this.open(userId, threadId).then(() => true, () => false);
  }

  /** Who is in a chat now. */
  async peopleOf(threadId: string): Promise<string[]> {
    return (await this.active(threadId)).map((m) => m.user_id);
  }

  /** Whether they may write now, and if not, why (in a line). */
  private async mayPost(userId: string, t: ThreadRow, members: ThreadMemberRow[]): Promise<{ ok: boolean; why: string }> {
    if (t.space_id) {
      const perms = await this.spaces.permsFor(userId, t.space_id);
      if (!perms) return { ok: false, why: "You're not in this space any more." };
      return perms.includes("message") ? { ok: true, why: "" } : { ok: false, why: "You can read this chat. Ask the admin to let you message." };
    }
    const other = members.find((m) => m.user_id !== userId) ?? (await this.people.select({ thread_id: t.id }, { limit: 4 })).find((m) => m.user_id !== userId);
    if (!other) return { ok: false, why: "They aren't here any more." };
    return (await this.messageable(userId, other.user_id)) ? { ok: true, why: "" } : { ok: false, why: `You don't share a space where you can message ${other.name} any more.` };
  }

  /** A space both are in, in which `userId` may message. */
  private async messageable(userId: string, otherId: string): Promise<boolean> {
    for (const s of await this.spaces.mine(userId)) {
      if (!s.perms.includes("message")) continue;
      if ((await this.spaces.memberIds(s.id)).includes(otherId)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ listing

  async list(userId: string): Promise<{ threads: ThreadView[]; unread: number }> {
    // Each space's own chat exists once someone looks.
    for (const s of await this.spaces.mine(userId)) await this.spaceThread(s.id).catch(() => undefined);
    const rows = (await this.people.select({ user_id: userId }, { limit: GROUPS_MAX + 40 })).filter((m) => m.left_ms === null || m.left_ms === undefined);
    const out: ThreadView[] = [];
    // The looks of the people in one to one chats: worked out once for the whole list, and only if there is such a chat.
    let known: Promise<Map<string, PersonLook>> | undefined;
    const looks = () => (known ??= this.looksKnown(userId));
    for (const r of rows) {
      const v = await this.viewOf(userId, r.thread_id, looks).catch(() => null);
      if (v) out.push(v);
    }
    out.sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0) || a.name.localeCompare(b.name));
    return { threads: out, unread: out.filter((t) => !t.muted).reduce((n, t) => n + t.unread, 0) };
  }

  /**
   * The newest message from someone else in each of the person's newest chats, newest first (the "From your people" widget,
   * src/widgets). Reads only: nothing is marked read. Never their own messages, never someone with a block between them, a muted
   * chat only when asked for. `chats`: how many chats are looked into.
   */
  async recentFrom(userId: string, o: { chats?: number; includeMuted?: boolean } = {}): Promise<Array<{
    threadId: string; messageId: string; chat: string; chatKind: ThreadRow["kind"]; from: string; text: string; at: number; unread: boolean;
  }>> {
    const { threads } = await this.list(userId);
    const hidden = await this.blocks.hiddenFor(userId);
    const out: Array<{ threadId: string; messageId: string; chat: string; chatKind: ThreadRow["kind"]; from: string; text: string; at: number; unread: boolean }> = [];
    for (const t of threads.filter((x) => x.last && (o.includeMuted || !x.muted)).slice(0, Math.max(1, Math.min(o.chats ?? 8, 20)))) {
      const newest = await this.messages.before({ thread_id: t.id }, "at_ms", null, 10);
      const owner = t.spaceId ? await this.spaces.ownerOf(t.spaceId) : null;
      const m = newest.find((x) => x.sender_id && x.sender_id !== userId && !hiddenIn(hidden, x) && this.sees(userId, x, owner));
      if (!m) continue;
      out.push({ threadId: t.id, messageId: m.id, chat: t.name, chatKind: t.kind, from: m.sender_name, text: lineOf(m), at: Number(m.at_ms), unread: t.unread > 0 });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  private async viewOf(userId: string, threadId: string, looks: () => Promise<Map<string, PersonLook>> = () => this.looksKnown(userId)): Promise<ThreadView> {
    const { t, me, members: all } = await this.open(userId, threadId);
    const hidden = await this.blocks.hiddenFor(userId);
    // Someone with a block between you is left out of a group's people (they are still in it, unseen).
    const members = all.filter((m) => !hidden.has(m.user_id));
    const spaceName = t.space_id ? await this.spaces.nameOf(t.space_id) : "";
    const others = members.filter((m) => m.user_id !== userId);
    const post = await this.mayPost(userId, t, all);
    const name = t.kind === "space" ? spaceName : t.kind === "direct" ? (others[0]?.name ?? (await this.people.select({ thread_id: t.id }, { limit: 4 })).find((m) => m.user_id !== userId)?.name ?? "Someone") : (t.name || names(others.map((m) => m.name)));
    const last = await this.lastLine(t, hidden);
    // One to one: the other person as the same tiny bot their page and the contacts show (a chat with no space has none of its own).
    const known = t.kind === "direct" ? await looks() : null;
    const botOf = (id: string): PersonLook => (id === userId ? selfLook(userId) : known?.get(id) ?? lookOf(id));
    return {
      id: t.id, kind: t.kind, name, spaceId: t.space_id, spaceName,
      people: members.map((m) => ({ userId: m.user_id, name: m.name, you: m.user_id === userId, ...(known ? { bot: botOf(m.user_id) } : {}) })),
      last, unread: Math.max(0, Number(me.unread) || 0), muted: me.muted === true, canPost: post.ok, why: post.why,
    };
  }

  /**
   * A chat's last line for someone: the newest message for everyone, and when (last_public_ms; last_ms on a row from before it). A
   * line from someone with a block between them is passed over for the one before it.
   */
  private async lastLine(t: ThreadRow, hidden: Set<string>): Promise<{ text: string; at: number } | null> {
    const at = Number(t.last_public_ms ?? t.last_ms);
    let last = at > Number(t.created_ms) || t.last_text ? { text: t.last_text, at } : null;
    if (last && hidden.size && t.kind !== "direct") {
      // The chat's last line may be theirs: show the last one you can see instead.
      const newest = (await this.messages.before({ thread_id: t.id }, "at_ms", null, 20)).filter(isPublic);
      if (newest[0] && newest[0].sender_id && hidden.has(newest[0].sender_id)) {
        const seen = newest.find((m) => !m.sender_id || !hidden.has(m.sender_id));
        last = seen ? { text: `${seen.sender_name}: ${lineOf(seen)}`.slice(0, 140), at: Number(seen.at_ms) } : null;
      }
    }
    return last;
  }

  /**
   * A space's feed for the Spaces list: its last line for everyone ("Mom: dinner at 8") and the person's unread count. Reads only:
   * a space whose feed nobody opened yet has none.
   */
  async summaryFor(userId: string, spaceId: string): Promise<{ threadId: string; last: { from: string; text: string; at: number } | null; unread: number }> {
    const [t] = await this.threads.select({ space_id: spaceId, kind: "space" }, { limit: 1 });
    if (!t) return { threadId: "", last: null, unread: 0 };
    const [me] = await this.people.select({ thread_id: t.id, user_id: userId }, { limit: 1 });
    if (!me || (me.left_ms !== null && me.left_ms !== undefined)) return { threadId: t.id, last: null, unread: 0 };
    const line = t.last_text ? await this.lastLine(t, await this.blocks.hiddenFor(userId)) : null;
    const cut = line ? line.text.indexOf(": ") : -1;
    const last = line && line.text ? (cut > 0 ? { from: line.text.slice(0, cut), text: line.text.slice(cut + 2), at: line.at } : { from: "", text: line.text, at: line.at }) : null;
    return { threadId: t.id, last, unread: Math.max(0, Number(me.unread) || 0) };
  }

  /**
   * Everyone this person shares a space with, as their tiny bot in the first of those spaces (oldest first, as `Spaces.mine` lists
   * them; whatever that space lets the person do), so someone looks the same in a one to one chat, the contacts and their page as
   * there. The person themself is not in it.
   */
  async looksKnown(userId: string): Promise<Map<string, PersonLook>> {
    const known = new Map<string, PersonLook>();
    for (const s of await this.spaces.mine(userId)) this.learnLooks(known, userId, (await this.spaces.membersOf(s.id)).map((m) => m.userId));
    return known;
  }

  /** A space's looks (its members, oldest first) into `known`, for anyone not met in an earlier space. */
  private learnLooks(known: Map<string, PersonLook>, userId: string, ids: string[]): void {
    for (const [id, look] of looksIn(ids)) if (id !== userId && !known.has(id)) known.set(id, look);
  }

  /**
   * Who this person can message (one to one), and where they can start a group. Nobody with a block between you. Each person's `bot`
   * is their tiny bot in the first space they share (looksKnown), so they look the same here as there.
   */
  async contacts(userId: string): Promise<{ people: Array<{ userId: string; name: string; spaces: string[]; bot: PersonLook }>; groupSpaces: Array<{ id: string; name: string; people: Array<{ userId: string; name: string }> }> }> {
    const people = new Map<string, { userId: string; name: string; spaces: string[]; bot: PersonLook }>();
    const groupSpaces: Array<{ id: string; name: string; people: Array<{ userId: string; name: string }> }> = [];
    const hidden = await this.blocks.hiddenFor(userId);
    const known = new Map<string, PersonLook>();
    for (const s of await this.spaces.mine(userId)) {
      const all = await this.spaces.membersOf(s.id);
      // Every space counts for how someone looks, the ones that don't let you message them too (looksKnown does the same).
      this.learnLooks(known, userId, all.map((m) => m.userId));
      const ms = all.filter((m) => m.userId !== userId && !hidden.has(m.userId));
      if (s.perms.includes("message")) {
        for (const m of ms) {
          const p = people.get(m.userId) ?? { userId: m.userId, name: m.name, spaces: [], bot: known.get(m.userId) ?? lookOf(m.userId) };
          p.spaces.push(s.name);
          people.set(m.userId, p);
        }
      }
      if (s.perms.includes("groups") && s.perms.includes("message") && ms.length) groupSpaces.push({ id: s.id, name: s.name, people: ms });
    }
    return { people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)), groupSpaces };
  }

  // ------------------------------------------------------------------ starting one

  private async addMember(threadId: string, userId: string, name: string): Promise<void> {
    const [have] = await this.people.select({ thread_id: threadId, user_id: userId }, { limit: 1 });
    if (have) {
      if (have.left_ms !== null && have.left_ms !== undefined) await this.people.update({ thread_id: threadId, user_id: userId }, { left_ms: null, name });
      return;
    }
    await this.people.insert({ thread_id: threadId, user_id: userId, name: name.slice(0, 40), joined_ms: this.now(), last_read_ms: this.now(), unread: 0, muted: false, left_ms: null });
  }

  /** The space's own chat (everyone in the space), made the first time it is asked for. */
  async spaceThread(spaceId: string): Promise<string> {
    const find = async () => (await this.threads.select({ space_id: spaceId, kind: "space" }, { limit: 1 }))[0];
    let t = await find();
    if (!t) {
      const at = this.now();
      try {
        t = await this.threads.insert({ id: randomUUID(), kind: "space", space_id: spaceId, name: "", direct_key: null, created_by: null, created_ms: at, last_ms: at, last_text: "" });
      } catch { t = await find(); }
      if (!t) throw gone();
      for (const m of await this.spaces.membersOf(spaceId)) await this.addMember(t.id, m.userId, m.name);
    }
    return t.id;
  }

  /** The chat with a space's whole crowd: anyone in it may open it. */
  async forSpace(userId: string, spaceId: string): Promise<{ id: string }> {
    await this.spaces.access(userId, spaceId);
    return { id: await this.spaceThread(spaceId) };
  }

  async direct(userId: string, myName: string, otherId: string): Promise<{ id: string }> {
    if (otherId === userId) throw new BotError("bad_request", "That's you.");
    if (await this.blocks.between(userId, otherId)) {
      throw new BotError("blocked", (await this.blocks.byMe(userId, otherId)) ? "You blocked them. Unblock them in You, Blocked people, to message them." : "You can't message them.", 403);
    }
    if (!(await this.messageable(userId, otherId))) throw new BotError("not_allowed", "You can message people in a space you share, if the space lets you.", 403);
    const key = [userId, otherId].sort().join(":");
    const find = async () => (await this.threads.select({ direct_key: key }, { limit: 1 }))[0];
    let t = await find();
    if (!t) {
      const at = this.now();
      try {
        t = await this.threads.insert({ id: randomUUID(), kind: "direct", space_id: null, name: "", direct_key: key, created_by: userId, created_ms: at, last_ms: at, last_text: "" });
      } catch { t = await find(); }
      if (!t) throw gone();
    }
    const otherName = await this.nameIn(otherId);
    await this.addMember(t.id, userId, myName);
    await this.addMember(t.id, otherId, otherName);
    return { id: t.id };
  }

  /** How someone is shown: their name in a space they're in. */
  private async nameIn(userId: string): Promise<string> {
    for (const s of await this.spaces.mine(userId)) {
      const m = (await this.spaces.membersOf(s.id)).find((x) => x.userId === userId);
      if (m?.name) return m.name;
    }
    return "Someone";
  }

  async group(userId: string, spaceId: string, o: { name?: unknown; people?: unknown }): Promise<{ id: string }> {
    if (o.people === "all") return this.forSpace(userId, spaceId);
    const a = await this.spaces.need(userId, spaceId, "groups");
    if (!a.perms.includes("message")) throw new BotError("not_allowed", `You can't message people in ${a.s.name}.`, 403);
    const inSpace = await this.spaces.membersOf(spaceId);
    const picked = pickedIds(o.people);
    const chosen = inSpace.filter((m) => picked.includes(m.userId) && m.userId !== userId);
    if (picked.filter((p) => p !== userId).length !== chosen.length) throw new BotError("not_found", `Everyone in a group has to be in ${a.s.name}.`, 404);
    if (!chosen.length) throw new BotError("bad_request", "Pick at least one person.");
    const hidden = await this.blocks.hiddenFor(userId);
    const kept = chosen.find((m) => hidden.has(m.userId));
    if (kept) throw new BotError("blocked", `You can't add ${kept.name} to a group.`, 403);
    const mine = (await this.people.select({ user_id: userId }, { limit: GROUPS_MAX + 40 })).length;
    if (mine >= GROUPS_MAX + 30) throw new BotError("group_limit", "That's a lot of chats. Leave one you don't use first.", 409);
    const at = this.now();
    const name = oneLine(typeof o.name === "string" ? o.name : "", 40);
    const id = randomUUID();
    await this.threads.insert({ id, kind: "group", space_id: spaceId, name, direct_key: null, created_by: userId, created_ms: at, last_ms: at, last_text: "" });
    await this.addMember(id, userId, a.me.name);
    for (const m of chosen) await this.addMember(id, m.userId, m.name);
    this.publish([userId, ...chosen.map((m) => m.userId)], "threads");
    return { id };
  }

  // ------------------------------------------------------------------ reading and writing

  private viewMessage(userId: string, r: MessageRow): MessageView {
    return {
      id: r.id, from: { userId: r.sender_id, name: r.sender_name, you: r.sender_id === userId }, text: r.text, at: Number(r.at_ms),
      files: (r.files ?? []).map((f) => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes, kind: f.kind, url: `${this.filePath(r.thread_id, r.id, f.id)}?${signQuery(userId, [r.thread_id, r.id, f.id], this.now())}` })),
      item: r.item ?? null,
      to: r.to_id ? { userId: r.to_id, name: r.to_name ?? "", you: r.to_id === userId } : null,
    };
  }

  async read(userId: string, threadId: string, o: { before?: unknown; limit?: unknown } = {}): Promise<{ thread: ThreadView; messages: MessageView[]; more: boolean; before: number | null }> {
    const { t, me } = await this.open(userId, threadId);
    const before = Number(o.before);
    const limit = Math.max(1, Math.min(Number(o.limit) || PAGE, 60));
    const rows = await this.messages.before({ thread_id: threadId }, "at_ms", Number.isFinite(before) && before > 0 ? before : null, limit + 1);
    const page = rows.slice(0, limit);
    if (!(Number.isFinite(before) && before > 0) && (Number(me.unread) > 0 || Number(me.last_read_ms) < this.now() - 1000)) {
      await this.people.update({ thread_id: threadId, user_id: userId }, { unread: 0, last_read_ms: this.now() });
      if (Number(me.unread) > 0) this.publish([userId], "threads");
    }
    const view = await this.viewOf(userId, threadId);
    // A group's or a space chat's people as their space has them (the rules on ThreadView.people).
    const looks = t.space_id && t.kind !== "direct" ? looksIn((await this.spaces.memberRows(t.space_id)).map((r) => r.user_id)) : null;
    const thread = looks ? { ...view, people: view.people.map((p) => ({ ...p, bot: shownLook(looks, p.userId, userId) })) } : view;
    // The page is cut before anyone's messages are left out, so the next page starts where this one ended.
    const hidden = await this.blocks.hiddenFor(userId);
    const owner = await this.ownerOf(t);
    const shown = page.filter((r) => !hiddenIn(hidden, r) && this.sees(userId, r, owner));
    // `page` is newest first: the next page is before its oldest.
    return { thread: { ...thread, unread: 0 }, messages: shown.reverse().map((r) => this.viewMessage(userId, r)), more: rows.length > limit, before: page.length ? Number(page[page.length - 1]!.at_ms) : null };
  }

  /** One message, for someone who may read the chat and see it (a report of it): the row and its chat. 404 otherwise. */
  async messageFor(userId: string, threadId: string, messageId: string): Promise<{ m: MessageRow; t: ThreadRow }> {
    const { t } = await this.open(userId, threadId);
    const [m] = UUID.test(messageId) ? await this.messages.select({ id: messageId, thread_id: t.id }, { limit: 1 }) : [];
    if (!m || hiddenIn(await this.blocks.hiddenFor(userId), m) || !this.sees(userId, m, await this.ownerOf(t))) {
      throw new BotError("not_found", "That message isn't there any more.", 404);
    }
    return { m, t };
  }

  /**
   * The admin takes a message out (a report acted on): it goes for everyone, and the chat's last line is the newest one for everyone
   * before it. Returns the row taken out (its caller, safety.ts, takes a grant's access away with its card), or null.
   */
  async removeMessage(threadId: string, messageId: string): Promise<MessageRow | null> {
    if (!UUID.test(threadId) || !UUID.test(messageId)) return null;
    const [row] = await this.messages.select({ id: messageId, thread_id: threadId }, { limit: 1 });
    if (!row || !(await this.messages.remove({ id: messageId, thread_id: threadId }))) return null;
    const [t] = await this.threads.select({ id: threadId }, { limit: 1 });
    if (t) {
      const newest = (await this.messages.before({ thread_id: threadId }, "at_ms", null, 40)).find(isPublic);
      await this.threads.update({ id: threadId }, newest
        ? { last_text: `${newest.sender_name}: ${lineOf(newest)}`.slice(0, 140), last_public_ms: Number(newest.at_ms) }
        : { last_text: "", last_public_ms: Number(t.created_ms) });
    }
    const ids = (await this.people.select({ thread_id: threadId }, { limit: 60 })).map((m) => m.user_id);
    this.publish(ids, `thread:${threadId}`);
    this.publish(ids, "threads");
    return row;
  }

  /**
   * How `userId` knows `otherId`: the spaces they share, and their one-to-one chat; null when they share neither a space nor any chat
   * (you can only block or report someone you've come across here). Works with a block in place, so the person can still be unblocked.
   */
  async acquaintance(userId: string, otherId: string): Promise<{ name: string; spaces: Array<{ id: string; name: string }>; direct: string | null } | null> {
    if (!UUID.test(otherId) || otherId === userId) return null;
    const spaces: Array<{ id: string; name: string }> = [];
    let name = "";
    for (const s of await this.spaces.mine(userId)) {
      const m = (await this.spaces.membersOf(s.id)).find((x) => x.userId === otherId);
      if (m) { spaces.push({ id: s.id, name: s.name }); name ||= m.name; }
    }
    const [d] = await this.threads.select({ direct_key: [userId, otherId].sort().join(":") }, { limit: 1 });
    let met = spaces.length > 0 || !!d;
    if (d && !name) name = (await this.people.select({ thread_id: d.id, user_id: otherId }, { limit: 1 }))[0]?.name ?? "";
    if (!met || !name) {
      // Met in a group chat only (they've since left the space).
      for (const r of await this.people.select({ user_id: userId }, { limit: GROUPS_MAX + 40 })) {
        const [o] = await this.people.select({ thread_id: r.thread_id, user_id: otherId }, { limit: 1 });
        if (o) { met = true; name ||= o.name; break; }
      }
    }
    return met ? { name: name || "Someone", spaces, direct: d?.id ?? null } : null;
  }

  /** A block was made or taken away between two people: both their chat lists, and every chat they share, redraw. */
  async blocksChanged(a: string, b: string): Promise<void> {
    this.publish([a, b], "threads");
    const theirs = new Set((await this.people.select({ user_id: b }, { limit: GROUPS_MAX + 40 })).map((r) => r.thread_id));
    for (const r of await this.people.select({ user_id: a }, { limit: GROUPS_MAX + 40 })) {
      if (theirs.has(r.thread_id)) this.publish([a, b], `thread:${r.thread_id}`);
    }
  }

  /** A message's words as sent: at most 4000 characters (413 past it). */
  textOf(raw: unknown): string {
    const text = clean(raw, TEXT_MAX + 1);
    if (text.length > TEXT_MAX) throw new BotError("too_large", `A message can be ${TEXT_MAX} characters.`, 413);
    return text;
  }

  /** The files a message carries: at most six, each the sender's own (sent to POST /v1/files first). */
  async filesOf(userId: string, raw: unknown): Promise<FileRef[]> {
    const ids = Array.isArray(raw) ? raw.map((f) => (typeof f === "string" ? f : (f as { id?: unknown })?.id)).filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
    if (ids.length > FILES_MAX) throw new BotError("too_large", `A message can carry ${FILES_MAX} files.`, 413);
    const files: FileRef[] = [];
    for (const id of [...new Set(ids)]) {
      const f = this.files ? await this.files.get(userId, id) : null;
      if (!f) throw new BotError("not_found", "One of those files isn't yours, or isn't there any more.", 404);
      files.push({ id: f.id, name: f.name.slice(0, 200), mime: f.mime.slice(0, 100), bytes: f.bytes, kind: f.kind, owner: userId });
    }
    return files;
  }

  /** A message from a person (words and their own files), for everyone in the chat. */
  async send(userId: string, threadId: string, o: { text?: unknown; files?: unknown }): Promise<MessageView> {
    const text = this.textOf(o.text);
    const files = await this.filesOf(userId, o.files);
    if (!text && !files.length) throw new BotError("bad_request", "Type something first.");
    // Screened before it is posted (filter.ts, App Review 1.2): the words, and the files' names.
    await screenPost([text, ...files.map((f) => f.name)]);
    return this.post(userId, threadId, { text, files, item: null });
  }

  /**
   * Any message, once its parts are checked (shared.ts posts a shared thing's card through here, spaceFeed.ts the feed's messages).
   * With `to` (a space's feed only), a message to one person: only they, its sender and the space's admin see it, count it unread or
   * hear of it live; it is pushed to them alone (to the admin silently: no push), and it never becomes the chat's last line.
   */
  async post(userId: string, threadId: string, m: { text: string; files: FileRef[]; item: ItemCard | null; to?: { id: string; name: string } | null }): Promise<MessageView> {
    const { t, me, members } = await this.open(userId, threadId);
    const may = await this.mayPost(userId, t, members);
    if (!may.ok) throw new BotError("not_allowed", may.why, 403);
    const to = m.to && t.kind === "space" ? m.to : null;
    const owner = await this.ownerOf(t);
    const at = Math.max(this.now(), Number(t.last_ms) + 1);
    const row: MessageRow = {
      id: randomUUID(), thread_id: t.id, sender_id: userId, sender_name: me.name, text: m.text, files: m.files, item: m.item, at_ms: at,
      ...(to ? { to_id: to.id, to_name: to.name.slice(0, 40) } : {}),
    };
    await this.messages.insert(row);
    // A chat's last line is only ever a message for everyone: lists show it, and its time, to everyone in the chat.
    // A chat from before last_public_ms keeps the time of its last line for everyone (last_ms, until now) when this one isn't.
    const before = t.last_public_ms === null || t.last_public_ms === undefined ? { last_public_ms: Number(t.last_ms) } : {};
    await this.threads.update({ id: t.id }, isPublic(row) ? { last_ms: at, last_text: `${me.name}: ${lineOf(m)}`.slice(0, 140), last_public_ms: at } : { last_ms: at, ...before });
    // Someone with a block between them and the sender never sees this message: it isn't unread for them, and they aren't pinged. Nor
    // does someone with a block with the owner of a thing the admin shared.
    const of = sharedOf(row);
    const unseen = new Set([...(await this.blocks.hiddenFor(userId)), ...(of ? await this.blocks.hiddenFor(of) : [])]);
    const seeing = members.filter((p) => p.user_id === userId || (!unseen.has(p.user_id) && this.sees(p.user_id, row, owner)));
    for (const p of seeing) {
      if (p.user_id === userId) await this.people.update({ thread_id: t.id, user_id: userId }, { last_read_ms: at, unread: 0 });
      else await this.people.update({ thread_id: t.id, user_id: p.user_id }, { unread: (Number(p.unread) || 0) + 1 });
    }
    const ids = seeing.map((p) => p.user_id);
    this.publish(ids, `thread:${t.id}`);
    this.publish(ids, "threads");
    // A push to each phone, never with the words; none for a muted chat. A message to one person pings only them: the admin sees it
    // in the feed, unannounced. A space's own chat is its feed: its push opens the space (space_feed).
    const chat = t.kind === "direct" ? me.name : t.kind === "space" ? await this.spaces.nameOf(t.space_id ?? "") : (t.name || "Group chat");
    for (const p of seeing) {
      if (p.user_id === userId || p.muted === true || (to && p.user_id !== to.id)) continue;
      const kind = t.kind === "space" ? "space_feed" : "space_message";
      const data: Record<string, string> = t.kind === "space" ? { id: t.space_id ?? "" } : { threadId: t.id };
      await this.notify(p.user_id, { kind, key: `${t.id}:${row.id}`, vars: { name: me.name, chat: chat || "X0 Bot" }, data }).catch(() => undefined);
    }
    return this.viewMessage(userId, row);
  }

  /** A file in a message, for someone who may read the chat: who owns its bytes, or null. */
  async fileOf(userId: string, threadId: string, messageId: string, fileId: string): Promise<FileRef | null> {
    await this.open(userId, threadId).catch(() => { throw gone(); });
    const [m] = UUID.test(messageId) ? await this.messages.select({ id: messageId, thread_id: threadId }, { limit: 1 }) : [];
    if (!m) return null;
    if (hiddenIn(await this.blocks.hiddenFor(userId), m)) return null;
    if (!this.sees(userId, m, await this.ownerOf(await this.thread(threadId)))) return null;
    return (m.files ?? []).find((f) => f.id === fileId) ?? null;
  }

  async leave(userId: string, threadId: string): Promise<void> {
    const { t, members } = await this.open(userId, threadId);
    if (t.kind === "space") throw new BotError("bad_request", "This is the space's own chat. Mute it, or leave the space.", 409);
    if (t.kind === "direct") throw new BotError("bad_request", "You can mute a chat with one person, not leave it.", 409);
    await this.people.update({ thread_id: t.id, user_id: userId }, { left_ms: this.now(), unread: 0 });
    this.publish(members.map((m) => m.user_id), `thread:${t.id}`);
    this.publish(members.map((m) => m.user_id), "threads");
  }

  async mute(userId: string, threadId: string, on: unknown): Promise<void> {
    if (typeof on !== "boolean") throw new BotError("bad_request", "muted is true or false.");
    await this.open(userId, threadId);
    await this.people.update({ thread_id: threadId, user_id: userId }, { muted: on });
    this.publish([userId], "threads");
    this.publish([userId], `thread:${threadId}`);
  }

  // ------------------------------------------------------------------ following the spaces

  private async follow(e: { spaceId: string; joined?: { userId: string; name: string }; left?: string; deleted?: boolean }): Promise<void> {
    const ofSpace = await this.threads.select({ space_id: e.spaceId }, { limit: GROUPS_MAX * 5 });
    if (e.deleted) {
      for (const t of ofSpace) {
        const ids = (await this.people.select({ thread_id: t.id }, { limit: 60 })).map((m) => m.user_id);
        await this.messages.remove({ thread_id: t.id });
        await this.people.remove({ thread_id: t.id });
        await this.threads.remove({ id: t.id });
        this.publish(ids, "threads");
      }
      return;
    }
    if (e.joined) {
      const own = ofSpace.find((t) => t.kind === "space");
      if (own) await this.addMember(own.id, e.joined.userId, e.joined.name);
    }
    if (e.left) {
      for (const t of ofSpace) await this.people.update({ thread_id: t.id, user_id: e.left }, { left_ms: this.now(), unread: 0 });
      this.publish([e.left], "threads");
    }
  }
}
