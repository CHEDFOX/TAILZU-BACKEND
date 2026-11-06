/**
 * A SPACE'S FEED (the new space screen): one feed for everyone, where a message can be to one person ("@") and a thing can be shared
 * from one of your bots ("/"). It is the space's own chat underneath (threads.ts), so older builds read the same thread.
 *
 *   read(user, space, { before?, limit? })   the space, its people, a page of messages (oldest first), what waits for you
 *   send(user, space, { text?, to?, thing?, files?, voice?, everyone? })   a message, to everyone or to one person, and/or one thing shared
 *   unshare(user, space, grant)              Stop sharing: the sharer or the admin takes a thing back, and its card leaves the feed
 *
 * THE RULES (docs/spaces.md). A message to one person is seen by them, its sender and the space's admin (threads.ts sees()). Before
 * a member writes here they tap OK on "The space's admin can see your work and messages here." (consent_ms); until then the feed
 * answers 403 consent_needed, so nothing they send reaches the admin unannounced. A message to someone with a block either way is
 * refused. A thing shared must be one of the sender's own (its bot lists it); it becomes a grant (grants.ts) and a card in the feed.
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
import type { Spaces } from "./spaces.js";
import type { SpaceTasks, TaskView } from "./spaceTasks.js";
import type { ItemCard, MessageView, Threads } from "./threads.js";
import { BOT_NAMES } from "./work.js";

export interface FeedPost { text?: unknown; to?: unknown; thing?: unknown; files?: unknown; voice?: unknown; everyone?: unknown }
export interface SpokenConfirm { toId: string; toName: string; text: string; whole: string; line: string }
export interface FeedMessage {
  id: string; at: number;
  from: { userId: string | null; name: string; you: boolean };
  /** A message to one person: who. Shown as "To <name>" to its sender and to the admin; the recipient sees a normal message. */
  to: { userId: string; name: string; you: boolean } | null;
  text: string;
  files: Array<{ id: string; name: string; mime: string; bytes: number; kind: string; url: string }>;
  thing: { grantId: string; bot: ShareBot; botName: string; ownerId: string; id: string; title: string; line: string } | null;
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
        consented: a.admin || (a.me.consent_ms !== null && a.me.consent_ms !== undefined), threadId,
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
    if (!a.admin && (a.me.consent_ms === null || a.me.consent_ms === undefined)) {
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
    let thing: { bot: ShareBot; item: { id: string; title: string; line: string; at: number | null } } | null = null;
    if (thingIn) {
      const src = isShareBot(thingIn.bot) ? this.sources[thingIn.bot] : undefined;
      const item = src ? (await src.list(user.id).catch(() => [])).find((i) => i.id === thingIn.id) : undefined;
      if (!src || !item) throw new BotError("not_found", "That isn't there any more.", 404);
      thing = { bot: thingIn.bot as ShareBot, item };
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
      const g = await this.grants.give(spaceId, { id: user.id, name: a.me.name }, thing.bot, thing.item, to?.id ?? null);
      const card: ItemCard = {
        kind: "grant", id: g.id, title: thing.item.title.slice(0, 120), bot: thing.bot, botName: BOT_NAMES[thing.bot],
        ownerId: user.id, itemId: thing.item.id, line: thing.item.line.slice(0, 120),
      };
      const posted = await this.threads.post(user.id, threadId, { text, files, item: card, to });
      await this.grants.setMessage(g.id, posted.id);
      return { message: this.feedMessage(posted) };
    }
    const posted = await this.threads.post(user.id, threadId, { text, files, item: null, to });
    return { message: this.feedMessage(posted) };
  }

  /**
   * Stop sharing a thing: its sharer, or the space's admin (grants.ts revoke says who may). The access goes at once, and its card goes
   * from the feed for everyone, so nobody is left with an Open that leads nowhere.
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
