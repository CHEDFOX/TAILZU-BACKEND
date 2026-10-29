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
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { live } from "../live/bus.js";
import { Blocks } from "./blocks.js";
import { signQuery } from "./spaceLinks.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import { pickedIds } from "./spacePerms.js";
import type { Publish, Spaces } from "./spaces.js";

export interface ThreadRow {
  [k: string]: unknown; id: string; kind: "direct" | "group" | "space"; space_id: string | null; name: string; direct_key: string | null;
  created_by: string | null; created_ms: number; last_ms: number; last_text: string;
}
export interface ThreadMemberRow {
  [k: string]: unknown; thread_id: string; user_id: string; name: string; joined_ms: number; last_read_ms: number; unread: number; muted: boolean; left_ms: number | null;
}
export interface FileRef { id: string; name: string; mime: string; bytes: number; kind: string; owner: string }
export interface ItemCard { id: string; kind: string; title: string }
export interface MessageRow {
  [k: string]: unknown; id: string; thread_id: string; sender_id: string | null; sender_name: string; text: string; files: FileRef[]; item: ItemCard | null; at_ms: number;
}

export interface MessageView {
  id: string; from: { userId: string | null; name: string; you: boolean }; text: string; at: number;
  files: Array<{ id: string; name: string; mime: string; bytes: number; kind: string; url: string }>; item: ItemCard | null;
}
export interface ThreadView {
  id: string; kind: ThreadRow["kind"]; name: string; spaceId: string | null; spaceName: string;
  people: Array<{ userId: string; name: string; you: boolean }>;
  last: { text: string; at: number } | null; unread: number; muted: boolean;
  /** Can write here now; when not, `why` says why in a line. */
  canPost: boolean; why: string;
}

/** A file the sender owns, as the media store has it (routes build this from MediaService). */
export interface FileLookup {
  get(userId: string, id: string): Promise<{ id: string; name: string; mime: string; bytes: number; kind: string } | null>;
}

/** A push for a new message (routes: the push engine). */
export type MessageNotify = (userId: string, msg: { kind: "space_message"; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<void>;

export const TEXT_MAX = 4000;
export const FILES_MAX = 6;
export const PAGE = 30;
export const GROUPS_MAX = 40;

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "");
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const gone = () => new BotError("not_found", "That chat isn't there any more.", 404);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const names = (list: string[]) => (list.length <= 1 ? list[0] ?? "" : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
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
    for (const r of rows) {
      const v = await this.viewOf(userId, r.thread_id).catch(() => null);
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
      const m = newest.find((x) => x.sender_id && x.sender_id !== userId && !hidden.has(x.sender_id));
      if (!m) continue;
      out.push({ threadId: t.id, messageId: m.id, chat: t.name, chatKind: t.kind, from: m.sender_name, text: lineOf(m), at: Number(m.at_ms), unread: t.unread > 0 });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  private async viewOf(userId: string, threadId: string): Promise<ThreadView> {
    const { t, me, members: all } = await this.open(userId, threadId);
    const hidden = await this.blocks.hiddenFor(userId);
    // Someone with a block between you is left out of a group's people (they are still in it, unseen).
    const members = all.filter((m) => !hidden.has(m.user_id));
    const spaceName = t.space_id ? await this.spaces.nameOf(t.space_id) : "";
    const others = members.filter((m) => m.user_id !== userId);
    const post = await this.mayPost(userId, t, all);
    const name = t.kind === "space" ? spaceName : t.kind === "direct" ? (others[0]?.name ?? (await this.people.select({ thread_id: t.id }, { limit: 4 })).find((m) => m.user_id !== userId)?.name ?? "Someone") : (t.name || names(others.map((m) => m.name)));
    let last = Number(t.last_ms) > Number(t.created_ms) || t.last_text ? { text: t.last_text, at: Number(t.last_ms) } : null;
    if (last && hidden.size && t.kind !== "direct") {
      // The chat's last line may be theirs: show the last one you can see instead.
      const newest = await this.messages.before({ thread_id: t.id }, "at_ms", null, 20);
      if (newest[0] && newest[0].sender_id && hidden.has(newest[0].sender_id)) {
        const seen = newest.find((m) => !m.sender_id || !hidden.has(m.sender_id));
        last = seen ? { text: `${seen.sender_name}: ${lineOf(seen)}`.slice(0, 140), at: Number(seen.at_ms) } : null;
      }
    }
    return {
      id: t.id, kind: t.kind, name, spaceId: t.space_id, spaceName,
      people: members.map((m) => ({ userId: m.user_id, name: m.name, you: m.user_id === userId })),
      last, unread: Math.max(0, Number(me.unread) || 0), muted: me.muted === true, canPost: post.ok, why: post.why,
    };
  }

  /** Who this person can message (one to one), and where they can start a group. Nobody with a block between you. */
  async contacts(userId: string): Promise<{ people: Array<{ userId: string; name: string; spaces: string[] }>; groupSpaces: Array<{ id: string; name: string; people: Array<{ userId: string; name: string }> }> }> {
    const people = new Map<string, { userId: string; name: string; spaces: string[] }>();
    const groupSpaces: Array<{ id: string; name: string; people: Array<{ userId: string; name: string }> }> = [];
    const hidden = await this.blocks.hiddenFor(userId);
    for (const s of await this.spaces.mine(userId)) {
      const ms = (await this.spaces.membersOf(s.id)).filter((m) => m.userId !== userId && !hidden.has(m.userId));
      if (s.perms.includes("message")) {
        for (const m of ms) {
          const p = people.get(m.userId) ?? { userId: m.userId, name: m.name, spaces: [] };
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
    };
  }

  async read(userId: string, threadId: string, o: { before?: unknown; limit?: unknown } = {}): Promise<{ thread: ThreadView; messages: MessageView[]; more: boolean; before: number | null }> {
    const { me } = await this.open(userId, threadId);
    const before = Number(o.before);
    const limit = Math.max(1, Math.min(Number(o.limit) || PAGE, 60));
    const rows = await this.messages.before({ thread_id: threadId }, "at_ms", Number.isFinite(before) && before > 0 ? before : null, limit + 1);
    const page = rows.slice(0, limit);
    if (!(Number.isFinite(before) && before > 0) && (Number(me.unread) > 0 || Number(me.last_read_ms) < this.now() - 1000)) {
      await this.people.update({ thread_id: threadId, user_id: userId }, { unread: 0, last_read_ms: this.now() });
      if (Number(me.unread) > 0) this.publish([userId], "threads");
    }
    const thread = await this.viewOf(userId, threadId);
    // The page is cut before anyone's messages are left out, so the next page starts where this one ended.
    const hidden = await this.blocks.hiddenFor(userId);
    const shown = page.filter((r) => !r.sender_id || !hidden.has(r.sender_id));
    // `page` is newest first: the next page is before its oldest.
    return { thread: { ...thread, unread: 0 }, messages: shown.reverse().map((r) => this.viewMessage(userId, r)), more: rows.length > limit, before: page.length ? Number(page[page.length - 1]!.at_ms) : null };
  }

  /** One message, for someone who may read the chat and see it (a report of it): the row and its chat. 404 otherwise. */
  async messageFor(userId: string, threadId: string, messageId: string): Promise<{ m: MessageRow; t: ThreadRow }> {
    const { t } = await this.open(userId, threadId);
    const [m] = UUID.test(messageId) ? await this.messages.select({ id: messageId, thread_id: t.id }, { limit: 1 }) : [];
    if (!m || (m.sender_id && (await this.blocks.hiddenFor(userId)).has(m.sender_id))) throw new BotError("not_found", "That message isn't there any more.", 404);
    return { m, t };
  }

  /** The admin takes a message out (a report acted on): it goes for everyone, and the chat's last line is the one before it. */
  async removeMessage(threadId: string, messageId: string): Promise<boolean> {
    if (!UUID.test(threadId) || !UUID.test(messageId)) return false;
    const n = await this.messages.remove({ id: messageId, thread_id: threadId });
    if (!n) return false;
    const [t] = await this.threads.select({ id: threadId }, { limit: 1 });
    if (t) {
      const [newest] = await this.messages.before({ thread_id: threadId }, "at_ms", null, 1);
      await this.threads.update({ id: threadId }, { last_text: newest ? `${newest.sender_name}: ${lineOf(newest)}`.slice(0, 140) : "" });
    }
    const ids = (await this.people.select({ thread_id: threadId }, { limit: 60 })).map((m) => m.user_id);
    this.publish(ids, `thread:${threadId}`);
    this.publish(ids, "threads");
    return true;
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

  /** A message from a person (words and their own files). */
  async send(userId: string, threadId: string, o: { text?: unknown; files?: unknown }): Promise<MessageView> {
    const text = clean(o.text, TEXT_MAX + 1);
    if (text.length > TEXT_MAX) throw new BotError("too_large", `A message can be ${TEXT_MAX} characters.`, 413);
    const ids = Array.isArray(o.files) ? o.files.map((f) => (typeof f === "string" ? f : (f as { id?: unknown })?.id)).filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
    if (ids.length > FILES_MAX) throw new BotError("too_large", `A message can carry ${FILES_MAX} files.`, 413);
    const files: FileRef[] = [];
    for (const id of [...new Set(ids)]) {
      const f = this.files ? await this.files.get(userId, id) : null;
      if (!f) throw new BotError("not_found", "One of those files isn't yours, or isn't there any more.", 404);
      files.push({ id: f.id, name: f.name.slice(0, 200), mime: f.mime.slice(0, 100), bytes: f.bytes, kind: f.kind, owner: userId });
    }
    if (!text && !files.length) throw new BotError("bad_request", "Type something first.");
    return this.post(userId, threadId, { text, files, item: null });
  }

  /** Any message, once its parts are checked (shared.ts posts a shared thing's card through here). */
  async post(userId: string, threadId: string, m: { text: string; files: FileRef[]; item: ItemCard | null }): Promise<MessageView> {
    const { t, me, members } = await this.open(userId, threadId);
    const may = await this.mayPost(userId, t, members);
    if (!may.ok) throw new BotError("not_allowed", may.why, 403);
    const at = Math.max(this.now(), Number(t.last_ms) + 1);
    const row: MessageRow = { id: randomUUID(), thread_id: t.id, sender_id: userId, sender_name: me.name, text: m.text, files: m.files, item: m.item, at_ms: at };
    await this.messages.insert(row);
    const line = lineOf(m);
    await this.threads.update({ id: t.id }, { last_ms: at, last_text: `${me.name}: ${line}`.slice(0, 140) });
    // Someone with a block between them and the sender never sees this message: it isn't unread for them, and they aren't pinged.
    const unseen = await this.blocks.hiddenFor(userId);
    for (const p of members) {
      if (p.user_id === userId) await this.people.update({ thread_id: t.id, user_id: userId }, { last_read_ms: at, unread: 0 });
      else if (!unseen.has(p.user_id)) await this.people.update({ thread_id: t.id, user_id: p.user_id }, { unread: (Number(p.unread) || 0) + 1 });
    }
    const everyone = members.map((p) => p.user_id);
    this.publish(everyone, `thread:${t.id}`);
    this.publish(everyone, "threads");
    // A push to each phone, never with the words; none for a muted chat.
    const chat = t.kind === "direct" ? me.name : t.kind === "space" ? await this.spaces.nameOf(t.space_id ?? "") : (t.name || "Group chat");
    for (const p of members) {
      if (p.user_id === userId || p.muted === true || unseen.has(p.user_id)) continue;
      await this.notify(p.user_id, { kind: "space_message", key: `${t.id}:${row.id}`, vars: { name: me.name, chat: chat || "X0 Bot" }, data: { threadId: t.id } }).catch(() => undefined);
    }
    return this.viewMessage(userId, row);
  }

  /** A file in a message, for someone who may read the chat: who owns its bytes, or null. */
  async fileOf(userId: string, threadId: string, messageId: string, fileId: string): Promise<FileRef | null> {
    await this.open(userId, threadId).catch(() => { throw gone(); });
    const [m] = UUID.test(messageId) ? await this.messages.select({ id: messageId, thread_id: threadId }, { limit: 1 }) : [];
    if (m?.sender_id && (await this.blocks.hiddenFor(userId)).has(m.sender_id)) return null;
    return (m?.files ?? []).find((f) => f.id === fileId) ?? null;
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
