/**
 * A SPACE'S FEED (the new space screen): one feed for everyone, where a message can be to one person ("@") and a thing can be shared
 * from one of your bots ("/"). It is the space's own chat underneath (threads.ts), so older builds read the same thread.
 *
 *   read(user, space, { before?, limit? })   the space, its people, a page of messages (oldest first), what waits for you
 *   send(user, space, { text?, to?, thing?, files?, voice?, everyone? })   a message, to everyone or to one person, and/or one thing shared
 *   unshare(user, space, grant)              Stop sharing: who may is grants.ts revoke's; the access and its card leave the feed
 *
 * THE RULES (docs/spaces.md). A message to one person is seen by them, its sender and the space's admin (threads.ts sees()). Before
 * a member writes here they tap OK on "The space's admin can see and share your work and messages here." (spacePerms.ts ADMIN_LINE; one
 * who agreed to the line before it is asked again); until then the feed answers 403 consent_needed, so nothing they send reaches the
 * admin unannounced. A message to someone with a block either way is refused.
 *
 * A THING SHARED becomes a grant (grants.ts) and a card in the feed. A member shares one of their own (its bot must list it). The
 * space's admin shares theirs, or any member's ("/" lists them for the admin: work.ts mine, ids made by ofMember): the owner must be
 * in the space now and have agreed to the line as it is now, with no block between them and the admin, nor between them and the one
 * it is for. The card says whose it is ("Aanya shared Mom's Doctor visit"); its owner never sees it and isn't pinged (threads.ts).
 *
 * A NAME AT THE START is never trusted blind: "Mom, dinner's ready" said aloud, or "@mom dinner" typed with no person picked, is not
 * posted. The answer is { confirm }: "Send this to Mom only?" (or, when two people have that name, a line saying so), and the screen
 * sends again with `to`, or with `everyone: true` (the person chose everyone: the question is not asked again). A message to one person
 * is never sent to everyone by a slip.
 */
import { BotError } from "../bots/index.js";
import type { Blocks } from "./blocks.js";
import { screenPost } from "./filter.js";
import type { Grants } from "./grants.js";
import type { PaymentView, Payments } from "./payments.js";
import { shownLook, looksIn, type PersonLook } from "./personLook.js";
import { isShareBot, type ShareBot, type ShareSources } from "./spaceShares.js";
import { hasConsent } from "./spacePerms.js";
import type { Access, MemberRow, Spaces } from "./spaces.js";
import type { SpaceTasks, TaskView } from "./spaceTasks.js";
import type { ItemCard, MessageView, Threads } from "./threads.js";
import { BOT_NAMES, memberThing } from "./work.js";

export interface FeedPost { text?: unknown; to?: unknown; thing?: unknown; files?: unknown; voice?: unknown; everyone?: unknown }
export interface SpokenConfirm { toId: string; toName: string; text: string; whole: string; line: string }
export interface FeedMessage {
  id: string; at: number;
  from: { userId: string | null; name: string; you: boolean };
  /** A message to one person: who. Shown as "To <name>" to its sender and to the admin; the recipient sees a normal message. */
  to: { userId: string; name: string; you: boolean } | null;
  text: string;
  files: Array<{ id: string; name: string; mime: string; bytes: number; kind: string; url: string }>;
  /** `ownerName`: whose thing it is, when it isn't its sender's (the space's admin shared it); "" for a thing its owner shared. */
  thing: { grantId: string; bot: ShareBot; botName: string; ownerId: string; ownerName: string; id: string; title: string; line: string } | null;
  /** A shared thing from SharedItems (as today's chats show it). */
  item: { id: string; kind: string; title: string } | null;
}
export interface FeedRead {
  space: { id: string; name: string; admin: boolean; adminName: string; consented: boolean; threadId: string };
  /** Blocked people left out. `bot`: their tiny bot in this space (personLook.ts), the viewer's own their X0 bot. */
  people: Array<{ userId: string; name: string; you: boolean; admin: boolean; bot: PersonLook }>;
  /** Oldest first. */
  messages: FeedMessage[];
  more: boolean; before: number | null;
  /** Payment requests still waiting. */
  payments: PaymentView[];
  /** Open tasks and plans given to you, or set by you. */
  tasks: TaskView[];
}

/** "mom," or "Mom!" is "mom": a word without the punctuation around it, in lower case. */
const bare = (w: string): string => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
/** The first word, after a leading "hey " or "@", and what follows it ("Hey Mom, dinner" is mom and "dinner"). */
function leadingName(text: string): { word: string; rest: string } | null {
  const m = /^\s*(?:hey\s+|@)?(\S+)(.*)$/isu.exec(text);
  if (!m) return null;
  return { word: bare(m[1]!), rest: m[2]!.replace(/^[\s,:;.!?-]+/u, "").trim() };
}

export class SpaceFeed {
  constructor(
    private readonly spaces: Spaces,
    private readonly threads: Threads,
    private readonly grants: Grants,
    private readonly sources: ShareSources,
    private readonly blocks: Blocks,
    private readonly o: { payments?: Payments; tasks?: SpaceTasks } = {},
  ) {}

  private feedMessage(m: MessageView): FeedMessage {
    const card: ItemCard | null = m.item;
    const grant = card && card.kind === "grant" && isShareBot(card.bot) ? card : null;
    return {
      id: m.id, at: m.at, from: m.from, to: m.to, text: m.text, files: m.files,
      thing: grant ? {
        grantId: grant.id, bot: grant.bot as ShareBot, botName: grant.botName ?? BOT_NAMES[grant.bot as ShareBot], ownerId: grant.ownerId ?? "",
        ownerName: grant.ownerId && grant.ownerId !== m.from.userId ? grant.ownerName || "Someone" : "",
        id: grant.itemId ?? "", title: grant.title, line: grant.line ?? "",
      } : null,
      item: card && !grant ? { id: card.id, kind: card.kind, title: card.title } : null,
    };
  }

  async read(userId: string, spaceId: string, o: { before?: unknown; limit?: unknown } = {}): Promise<FeedRead> {
    const a = await this.spaces.access(userId, spaceId);
    const threadId = await this.threads.spaceThread(spaceId);
    const [page, rows, hidden, pays, todo] = await Promise.all([
      this.threads.read(userId, threadId, { before: o.before, limit: o.limit }),
      this.spaces.memberRows(spaceId),
      this.blocks.hiddenFor(userId),
      this.o.payments ? this.o.payments.list(userId, spaceId).catch(() => [] as PaymentView[]) : Promise.resolve([] as PaymentView[]),
      this.o.tasks ? this.o.tasks.list(userId, spaceId).catch(() => [] as TaskView[]) : Promise.resolve([] as TaskView[]),
    ]);
    const owner = a.s.owner_id;
    // Every member's look, oldest first, before anyone is hidden from this viewer (spaces.ts view does the same).
    const looks = looksIn(rows.map((m) => m.user_id));
    return {
      space: {
        id: a.s.id, name: a.s.name, admin: a.admin, adminName: rows.find((m) => m.user_id === owner)?.name ?? "",
        consented: a.admin || hasConsent(a.me), threadId,
      },
      people: rows.filter((m) => !hidden.has(m.user_id)).map((m) => ({
        userId: m.user_id, name: m.name, you: m.user_id === userId, admin: m.user_id === owner, bot: shownLook(looks, m.user_id, userId),
      })),
      messages: page.messages.map((m) => this.feedMessage(m)),
      more: page.more, before: page.before,
      payments: pays.filter((p) => p.status === "waiting"),
      tasks: todo.filter((t) => !t.done && (t.byYou || (t.mine !== null && t.mine.status !== "done"))),
    };
  }

  async send(user: { id: string; name: string }, spaceId: string, b: FeedPost): Promise<{ message: FeedMessage } | { confirm: SpokenConfirm }> {
    const a = await this.spaces.access(user.id, spaceId);
    if (!a.admin && !hasConsent(a.me)) {
      throw new BotError("consent_needed", "Tap OK on the line about the space's admin first.", 403);
    }
    const text = this.threads.textOf(b.text);
    const files = await this.threads.filesOf(user.id, b.files);
    // Empty means none: no `to` is everyone, and a thing with no bot or id is no thing.
    const rawThing = b.thing && typeof b.thing === "object" ? (b.thing as { bot?: unknown; id?: unknown }) : null;
    const thingIn = rawThing && typeof rawThing.bot === "string" && rawThing.bot && typeof rawThing.id === "string" && rawThing.id ? { bot: rawThing.bot, id: rawThing.id } : null;
    const toId = typeof b.to === "string" ? b.to.trim() : "";
    if (!text && !thingIn && !files.length) throw new BotError("bad_request", "Write something first.");
    const rows = await this.spaces.memberRows(spaceId);
    let to: { id: string; name: string } | null = null;
    if (toId) {
      const m = rows.find((r) => r.user_id === toId && r.user_id !== user.id);
      if (!m) throw new BotError("not_found", "They aren't in this space.", 404);
      if (await this.blocks.between(user.id, toId)) throw new BotError("blocked", "You can't message them.", 403);
      to = { id: m.user_id, name: m.name };
    }
    let thing: { bot: ShareBot; item: { id: string; title: string; line: string; at: number | null }; owner: { id: string; name: string } } | null = null;
    if (thingIn) {
      const src = isShareBot(thingIn.bot) ? this.sources[thingIn.bot] : undefined;
      // A member's thing, as the admin's "/" lists it: only the admin may share it, and only theirs it may be (the rules at the top).
      // Anyone else naming one is told it isn't there, as for any thing that isn't theirs.
      const theirs = memberThing(thingIn.id);
      const owner = theirs && a.admin && theirs.ownerId !== user.id
        ? await this.ownerToShare(user.id, a, rows, theirs.ownerId, to)
        : { id: user.id, name: a.me.name };
      const itemId = theirs && a.admin ? theirs.itemId : thingIn.id;
      const item = src ? (await src.list(owner.id).catch(() => [])).find((i) => i.id === itemId) : undefined;
      if (!src || !item) throw new BotError("not_found", "That isn't there any more.", 404);
      thing = { bot: thingIn.bot as ShareBot, item, owner };
    }
    // Screened before anything is written (filter.ts, App Review 1.2): the thing's line too, which its card shows to others (a Xode
    // job's task, a trip's "when · who", both typed by its owner).
    await screenPost([text, ...files.map((f) => f.name), thing?.item.title, thing?.item.line]);
    if (!to && text && b.everyone !== true && (b.voice === true || text.startsWith("@"))) {
      const ask = await this.namedAtStart(user.id, text, rows);
      if (ask) return { confirm: ask };
    }
    const threadId = await this.threads.spaceThread(spaceId);
    if (thing) {
      const other = thing.owner.id !== user.id;
      const g = await this.grants.give(spaceId, thing.owner, thing.bot, thing.item, to?.id ?? null, other ? user.id : undefined);
      const card: ItemCard = {
        kind: "grant", id: g.id, title: thing.item.title.slice(0, 120), bot: thing.bot, botName: BOT_NAMES[thing.bot],
        ownerId: thing.owner.id, itemId: thing.item.id, line: thing.item.line.slice(0, 120), ...(other ? { ownerName: thing.owner.name.slice(0, 40) } : {}),
      };
      const posted = await this.threads.post(user.id, threadId, { text, files, item: card, to });
      await this.grants.setMessage(g.id, posted.id);
      return { message: this.feedMessage(posted) };
    }
    const posted = await this.threads.post(user.id, threadId, { text, files, item: null, to });
    return { message: this.feedMessage(posted) };
  }

  /**
   * The member whose thing the admin is sharing, once they may: in the space now (404 otherwise, as a thing that isn't there), with
   * no block between them and the admin (the same 404: the admin can't see their things), agreed to the line about the admin as it
   * is now (403), not the one it is for (it is theirs already), and with no block between them and that person (403).
   */
  private async ownerToShare(adminId: string, a: Access, rows: MemberRow[], ownerId: string, to: { id: string; name: string } | null): Promise<{ id: string; name: string }> {
    const m = rows.find((r) => r.user_id === ownerId);
    if (!m || (await this.blocks.between(adminId, ownerId))) throw new BotError("not_found", "That isn't there any more.", 404);
    if (!hasConsent(m)) throw new BotError("not_allowed", `${m.name} hasn't agreed yet that ${a.s.name}'s admin can share their things.`, 403);
    if (to?.id === ownerId) throw new BotError("bad_request", `That is ${m.name}'s own already.`);
    if (to && (await this.blocks.between(ownerId, to.id))) throw new BotError("blocked", `You can't share ${m.name}'s things with ${to.name}.`, 403);
    return { id: m.user_id, name: m.name };
  }

  /**
   * Stop sharing a thing (grants.ts revoke says who may: a share the admin made, only the admin). The access goes at once, and its
   * card goes from the feed for everyone, so nobody is left with an Open that leads nowhere.
   */
  async unshare(userId: string, spaceId: string, grantId: string): Promise<void> {
    const g = await this.grants.revoke(userId, spaceId, grantId);
    if (g.message_id) await this.threads.removeMessage(await this.threads.spaceThread(spaceId), g.message_id);
    await this.spaces.changed(spaceId);
  }

  /** A name at the start that is someone's here: the question to ask instead of posting (the rules at the top). Null: post it. */
  private async namedAtStart(senderId: string, text: string, rows: Array<{ user_id: string; name: string }>): Promise<SpokenConfirm | null> {
    const lead = leadingName(text);
    if (!lead?.word) return null;
    const hidden = await this.blocks.hiddenFor(senderId);
    const hits = rows.filter((m) => m.user_id !== senderId && !hidden.has(m.user_id) && bare(m.name.split(/\s+/)[0] ?? "") === lead.word);
    if (!hits.length) return null;
    if (hits.length > 1) return { toId: "", toName: "", text, whole: text, line: "Two people here have that name. Send it to everyone, or cancel and write it with @." };
    const who = hits[0]!;
    return { toId: who.user_id, toName: who.name, text: lead.rest, whole: text, line: `Send this to ${who.name} only?` };
  }
}
