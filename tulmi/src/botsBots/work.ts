/**
 * WORK IN SPACE: on each of the four bots' pages (Plan Ease, Notes, Travel bot, Xode), the things people in your spaces let you see,
 * beside your own (docs/spaces.md). Shared work lives in the bots, not in the space.
 *
 *   read(viewer, bot)                 the people whose things the viewer may open in that bot, per space (every space they are
 *                                     in, none to show there too). It never reads anyone's bot (the bot pages are fetched at every
 *                                     launch): people and counts come from grants and shares
 *   person(viewer, bot, space, owner) the one place that lists another person's things: theirs the viewer may see
 *   mine(viewer, bot, { space?, tz? })   the viewer's own things ("/" in the feed picks one); for a space's admin, with its space,
 *                                     each member's too (ofMember ids), after theirs
 *   item / act                        one thing, and working on it: Change time on a plan event, or Add a note. Its owner also
 *                                     gets who it is shared with (each with Stop sharing: grants.ts revoke)
 *   canWork(viewer, owner, bot, item, space)   who may: "own", "admin", "shared", "view", or nobody (null)
 *
 * WHO MAY. The owner. The space's admin, for a member who agreed to the line about the admin as it is now (spacePerms.ts hasConsent).
 * Someone a grant reaches (grants.ts), whether its owner made it or the admin did ("Shared by Aanya": found under the owner, with the
 * same access). Someone the owner shares that bot with through the old per-bot sharing (spaceShares.ts): that was made read only, so
 * it stays "view": a look and a note, never a change. Everyone but the owner must name a space both are in now, with no block between
 * them; anything else is the same 404 as a thing that isn't there. Xode's projects are read only for everyone but their owner.
 * Changing a plan's time is for the owner, the admin and someone it was shared with by name: a share to everyone reaches whoever is
 * in the space, later joiners too, so it is a look and a note only.
 *
 * What someone did on another person's thing is a note on that thing (space_work_notes, migration 0068), never in the space's
 * activity, which every member reads. Its owner sees every space's notes. Anyone else sees the notes added through the space they
 * came by, except one added through a share to one person (only_owner): that one is for the owner, its writer and the space's admin,
 * so two people the owner shared the same thing with separately never read each other's notes, or learn the other has it.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { calendar, type CalEvent } from "../calendar/index.js";
import { clockAt, dayOf, dayWords, hhmm, isDayKey, MIN, minuteOf, startOfDay, timeOf, tzOf } from "../calendar/words.js";
import { screenPost } from "./filter.js";
import { byAdmin, type GrantReach, type GrantRow, type Grants } from "./grants.js";
import { shownLook, looksIn, lookOf, seen, type PersonLook } from "./personLook.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import { isShareBot, type OwnItem, type ShareBot, type ShareSource, type ShareSources, type SpaceShares } from "./spaceShares.js";
import { hasConsent } from "./spacePerms.js";
import type { MemberRow, Spaces, SpaceRow } from "./spaces.js";

export interface WorkNoteRow {
  [k: string]: unknown;
  id: string; space_id: string; owner_id: string; bot: ShareBot; item_id: string; by_id: string | null; by_name: string; text: string; at_ms: number;
  /** Added through a share to one person: only the owner, its writer and the space's admin see it (the rules at the top). */
  only_owner?: boolean;
}

/** `bot`: their tiny bot in that space (personLook.ts). */
export interface WorkPerson { userId: string; name: string; how: "admin" | "shared" | "view"; line: string; bot: PersonLook }
export interface WorkSpace { spaceId: string; spaceName: string; admin: boolean; people: WorkPerson[] }
export interface WorkRead {
  bot: ShareBot; botName: string; spaces: WorkSpace[];
  /** Admins who can see the viewer's own things in this bot ("Aanya, the space's admin, can see these too."). */
  seenBy: string[];
  notesOnMine: Array<{ itemId: string; title: string; by: string; byBot: PersonLook; text: string; at: number; spaceId: string }>;
}
export interface WorkItem {
  bot: ShareBot; botName: string; id: string; title: string; line: string; at: number | null;
  owner: { userId: string; name: string; you: boolean }; space: { id: string; name: string };
  how: "own" | "admin" | "shared" | "view";
  detail: { when?: string; place?: string; notes?: string; day?: string; time?: string };
  /** `bot`: who wrote it, as their tiny bot (the viewer's own: their X0 bot). */
  notes: Array<{ id: string; by: string; you: boolean; bot: PersonLook; text: string; at: number }>;
  can: { time: boolean; note: boolean };
  /** Its owner only (empty for anyone else): who they shared it with, in which space ("Everyone" for a share to everyone). */
  shared: Array<{ grantId: string; spaceId: string; spaceName: string; to: string }>;
  /** It reaches the viewer through a share the space's admin made, not its owner: the admin's name ("Shared by Aanya"). */
  sharedBy?: string;
}
/** One of someone's things the viewer may see; `sharedBy` as on WorkItem. */
export type SharedItem = OwnItem & { sharedBy?: string };
export type WorkHow = WorkItem["how"];

export const BOT_NAMES: Record<ShareBot, string> = { plan: "Plan Ease", notes: "Notes", travel: "Travel bot", code: "Xode" };
/** What one thing is called in each bot: plan(s), note(s), trip(s), project(s). */
const NOUN: Record<ShareBot, string> = { plan: "plan", notes: "note", travel: "trip", code: "project" };
const nouns = (bot: ShareBot, n: number) => `${n} ${NOUN[bot]}${n === 1 ? "" : "s"}`;

/**
 * A person's line in Work in space when things of theirs were shared with the viewer: "2 plans shared with you"; a thing only the
 * space's admin shared says so ("1 plan · Shared by Aanya", or "3 plans shared with you · 1 by Aanya"). Counted by thing, not grant.
 */
function sharedLine(bot: ShareBot, gs: GrantRow[], rows: MemberRow[]): string {
  const byOwner = new Set(gs.filter((g) => !byAdmin(g)).map((g) => g.item_id));
  const onlyAdmin = new Map(gs.filter((g) => byAdmin(g) && !byOwner.has(g.item_id)).map((g) => [g.item_id, g.by_id!]));
  const n = byOwner.size + onlyAdmin.size;
  if (!onlyAdmin.size) return `${nouns(bot, n)} shared with you`;
  const who = rows.find((r) => r.user_id === [...onlyAdmin.values()][0])?.name ?? "the admin";
  return byOwner.size ? `${nouns(bot, n)} shared with you · ${onlyAdmin.size} by ${who}` : `${nouns(bot, n)} · Shared by ${who}`;
}

/** Another person's things an admin sees at once: at most this many. */
const ADMIN_ITEMS = 50;
const NOTES_SHOWN = 30;
const NOTES_ON_MINE = 5;
const NOTE_MAX = 1000;

const gone = () => new BotError("not_found", "That isn't there any more.", 404);
/**
 * A note's writer as their tiny bot: as they are in the space it came through when its looks are known, else their own look; a
 * writer whose account is gone, by their name.
 */
function noteLook(looks: ReadonlyMap<string, PersonLook> | undefined, n: WorkNoteRow, viewer: string): PersonLook {
  if (!n.by_id) return lookOf(`name:${n.by_name}`);
  return looks ? shownLook(looks, n.by_id, viewer) : seen(lookOf(n.by_id), viewer);
}
const isDraft = (s: SpaceRow): boolean => s.draft_ms !== null && s.draft_ms !== undefined;

/**
 * A member's thing as the admin's "/" list names it (mine with a space): "of:<owner>:<item>". The apps send it back as the thing's id
 * unchanged (spaceFeed.ts send reads it with memberThing), so the list and the box need nothing new. A user id has no ":".
 */
export const ofMember = (ownerId: string, itemId: string): string => `of:${ownerId}:${itemId}`;
export function memberThing(id: string): { ownerId: string; itemId: string } | null {
  const m = /^of:([^:]+):([\s\S]+)$/.exec(id);
  return m ? { ownerId: m[1]!, itemId: m[2]! } : null;
}
/** A thing's line in the admin's "/" list: a plan's event by its day and time ("Sat 14 Nov · 7:40 pm"), anything else as it is. */
function whenOf(bot: ShareBot, i: OwnItem, tz: number): string {
  return bot === "plan" && i.id.startsWith("e:") && i.line === "Event" && typeof i.at === "number" ? `${dayWords(dayOf(i.at, tz))} · ${clockAt(i.at, tz)}` : i.line;
}

export class Work {
  private readonly notes: PagedTable<WorkNoteRow>;

  constructor(
    private readonly spaces: Spaces,
    private readonly grants: Grants,
    private readonly shares: SpaceShares,
    private readonly sources: ShareSources,
    notes?: PagedTable<WorkNoteRow>,
    private readonly now: () => number = Date.now,
  ) {
    this.notes = notes ?? spaceTable<WorkNoteRow>("space_work_notes");
    spaces.onMembers(async (e) => { if (e.deleted) await this.notes.remove({ space_id: e.spaceId }); });
  }

  private source(botIn: unknown): { bot: ShareBot; src: ShareSource } {
    if (!isShareBot(botIn) || !this.sources[botIn]) throw new BotError("not_found", "That bot can't be shared in a space.", 404);
    return { bot: botIn, src: this.sources[botIn]! };
  }

  /** A person's own things in a bot; a source that fails lists nothing. */
  private async listOf(src: ShareSource, userId: string): Promise<OwnItem[]> {
    return src.list(userId).catch(() => [] as OwnItem[]);
  }

  // ------------------------------------------------------------------ who the viewer sees, in one space

  /**
   * The people in one space whose things in `bot` the viewer may open, and how. Reads grants, shares and member rows only: never
   * anyone's bot.
   */
  private async peopleIn(viewer: string, bot: ShareBot, s: SpaceRow, rows: MemberRow[], hidden: Set<string>): Promise<WorkPerson[]> {
    const admin = s.owner_id === viewer;
    const others = rows.filter((m) => m.user_id !== viewer && !hidden.has(m.user_id));
    const granted = await this.grants.reaching(viewer, s.id, bot, rows.map((m) => m.user_id), hidden);
    const shared = await this.shares.rules(s.id, bot);
    // Their bots as the space has them (rows come oldest first, every member: spaces.ts memberRows).
    const looks = looksIn(rows.map((m) => m.user_id));
    const out: WorkPerson[] = [];
    for (const m of others) {
      const who = { userId: m.user_id, name: m.name, bot: shownLook(looks, m.user_id, viewer) };
      if (admin && hasConsent(m)) { out.push({ ...who, how: "admin", line: `All their ${NOUN[bot]}s` }); continue; }
      const gs = granted.get(m.user_id) ?? [];
      if (gs.length) { out.push({ ...who, how: "shared", line: sharedLine(bot, gs, rows) }); continue; }
      const r = shared.get(m.user_id);
      if (r?.mode === "all") out.push({ ...who, how: "view", line: "Everything they share" });
      else if (r?.mode === "some" && r.items.length) out.push({ ...who, how: "view", line: `${nouns(bot, r.items.length)} shared` });
    }
    return out;
  }

  async read(viewer: string, botIn: unknown): Promise<WorkRead> {
    const { bot, src } = this.source(botIn);
    const hidden = await this.grants.blocks.hiddenFor(viewer);
    const spaces: WorkSpace[] = [];
    const seenBy: string[] = [];
    // Each space's looks, for the notes below: a note's writer is drawn as they are in the space it came through.
    const looksBy = new Map<string, Map<string, PersonLook>>();
    for (const m of await this.spaces.mine(viewer)) {
      const s = await this.spaces.spaceRow(m.id);
      if (!s || isDraft(s)) continue;
      const rows = await this.spaces.memberRows(s.id);
      looksBy.set(s.id, looksIn(rows.map((r) => r.user_id)));
      const me = rows.find((r) => r.user_id === viewer);
      if (!m.admin && me && hasConsent(me) && !hidden.has(s.owner_id)) {
        const adminName = rows.find((r) => r.user_id === s.owner_id)?.name;
        if (adminName && !seenBy.includes(adminName)) seenBy.push(adminName);
      }
      // Every space they are in, with no one in it yet too: the bot page shows Work in space to anyone in a space.
      spaces.push({ spaceId: s.id, spaceName: s.name, admin: m.admin, people: await this.peopleIn(viewer, bot, s, rows, hidden) });
    }
    // Notes others left on the viewer's own things: their titles from the viewer's own bot, read only when there are some.
    const on = (await this.notes.select({ owner_id: viewer, bot }, { order: "at_ms", desc: true, limit: 40 }))
      .filter((n) => n.by_id !== viewer && !(n.by_id && hidden.has(n.by_id))).slice(0, NOTES_ON_MINE);
    const titles = on.length ? new Map((await this.listOf(src, viewer)).map((i) => [i.id, i.title])) : new Map<string, string>();
    const notesOnMine = on.map((n) => ({
      itemId: n.item_id, title: titles.get(n.item_id) ?? "", by: n.by_name, byBot: noteLook(looksBy.get(n.space_id), n, viewer), text: n.text, at: Number(n.at_ms), spaceId: n.space_id,
    }));
    return { bot, botName: BOT_NAMES[bot], spaces, seenBy, notesOnMine };
  }

  /** The space, its member rows and the viewer's view of `ownerId` there; 404 unless read() would list them. */
  private async personIn(viewer: string, bot: ShareBot, spaceId: string, ownerId: string): Promise<{ s: SpaceRow; rows: MemberRow[]; person: WorkPerson }> {
    const s = await this.spaces.spaceRow(spaceId);
    if (!s || isDraft(s)) throw gone();
    const rows = await this.spaces.memberRows(s.id);
    if (!rows.some((r) => r.user_id === viewer)) throw gone();
    const hidden = await this.grants.blocks.hiddenFor(viewer);
    const person = (await this.peopleIn(viewer, bot, s, rows, hidden)).find((p) => p.userId === ownerId);
    if (!person) throw gone();
    return { s, rows, person };
  }

  /** What of `ownerId`'s things in `bot` the viewer may see in this space, as their bot lists them now. */
  async person(viewer: string, botIn: unknown, spaceId: string, ownerId: string): Promise<{ space: { id: string; name: string }; person: WorkPerson; items: SharedItem[] }> {
    const { bot, src } = this.source(botIn);
    const { s, rows, person } = await this.personIn(viewer, bot, spaceId, ownerId);
    const theirs = await this.listOf(src, ownerId);
    let items: SharedItem[];
    if (person.how === "admin") items = theirs.slice(0, ADMIN_ITEMS);
    else {
      // What the owner shared (a grant, or the old per-bot sharing), and what only the admin's shares reach: "Shared by Aanya".
      const ids = new Set<string>();
      const byWhom = new Map<string, string>();
      const hidden = await this.grants.blocks.hiddenFor(viewer);
      const granted = (await this.grants.reaching(viewer, s.id, bot, [ownerId], hidden)).get(ownerId) ?? [];
      for (const g of granted) {
        if (byAdmin(g)) byWhom.set(g.item_id, g.by_id!);
        else ids.add(g.item_id);
      }
      const rule = await this.shares.rule(s.id, ownerId, bot);
      if (rule.mode === "all") for (const i of theirs) ids.add(i.id);
      else if (rule.mode === "some") for (const id of rule.items) ids.add(id);
      const nameOf = (id: string) => rows.find((r) => r.user_id === id)?.name ?? "the admin";
      items = theirs.filter((i) => ids.has(i.id) || byWhom.has(i.id)).map((i) => (ids.has(i.id) ? i : { ...i, sharedBy: nameOf(byWhom.get(i.id)!) }));
    }
    return { space: { id: s.id, name: s.name }, person, items };
  }

  /**
   * The viewer's own things ("/" in a space's feed picks one). With `space`, for that space's admin alone: theirs first, then each
   * member's who agreed to the line about the admin as it is now (oldest member first; nobody with a block between them), their ids
   * made by ofMember and their line saying whose ("Mom's · Sat 14 Nov · 7:40 pm"), so the apps' list needs nothing new. Anyone else
   * gets their own, as without it. Only this reads the members' bots, when the admin picks a bot in "/".
   */
  async mine(viewer: string, botIn: unknown, o: { space?: unknown; tz?: unknown } = {}): Promise<{ items: OwnItem[] }> {
    const { bot, src } = this.source(botIn);
    const items = [...(await this.listOf(src, viewer))];
    const s = typeof o.space === "string" && o.space ? await this.spaces.spaceRow(o.space) : null;
    if (!s || isDraft(s) || s.owner_id !== viewer) return { items };
    const tz = tzOf(o.tz);
    const hidden = await this.grants.blocks.hiddenFor(viewer);
    for (const m of await this.spaces.memberRows(s.id)) {
      if (m.user_id === viewer || hidden.has(m.user_id) || !hasConsent(m)) continue;
      for (const i of (await this.listOf(src, m.user_id)).slice(0, ADMIN_ITEMS)) {
        items.push({ ...i, id: ofMember(m.user_id, i.id), line: [`${m.name}'s`, whenOf(bot, i, tz)].filter(Boolean).join(" · ") });
      }
    }
    return { items };
  }

  // ------------------------------------------------------------------ one thing

  async canWork(viewerId: string, ownerId: string, botIn: unknown, itemId: string, spaceId: string): Promise<WorkHow | null> {
    return (await this.accessOf(viewerId, ownerId, botIn, itemId, spaceId))?.how ?? null;
  }

  /**
   * canWork, and for "shared" how the grant reaches them (a share to them by name, or to everyone) and, when the admin made it rather
   * than its owner, the admin's id (`by`).
   */
  private async accessOf(viewerId: string, ownerId: string, botIn: unknown, itemId: string, spaceId: string): Promise<{ how: WorkHow; reach?: GrantReach; by?: string | null } | null> {
    if (!isShareBot(botIn) || !this.sources[botIn] || !itemId) return null;
    const bot = botIn;
    if (viewerId === ownerId) return { how: "own" };
    const s = await this.spaces.spaceRow(spaceId);
    if (!s || isDraft(s)) return null;
    const rows = await this.spaces.memberRows(s.id);
    const owner = rows.find((r) => r.user_id === ownerId);
    if (!owner || !rows.some((r) => r.user_id === viewerId)) return null;
    if (await this.grants.blocks.between(viewerId, ownerId)) return null;
    if (s.owner_id === viewerId && hasConsent(owner)) return { how: "admin" };
    const held = await this.grants.holds(viewerId, s.id, ownerId, bot, itemId);
    if (held) return { how: "shared", reach: held.reach, by: held.by };
    const rule = await this.shares.rule(s.id, ownerId, bot);
    if (rule.mode === "some" && rule.items.includes(itemId)) return { how: "view" };
    if (rule.mode === "all" && (await this.listOf(this.sources[bot]!, ownerId)).some((i) => i.id === itemId)) return { how: "view" };
    return null;
  }

  /** Who the owner shared their thing with, in the spaces they are in now (the owner's page only; never a share the admin made). */
  private async sharedWith(ownerId: string, bot: ShareBot, itemId: string): Promise<WorkItem["shared"]> {
    const out: WorkItem["shared"] = [];
    const rowsOf = new Map<string, { s: SpaceRow; rows: MemberRow[] } | null>();
    for (const g of await this.grants.ofItem(ownerId, bot, itemId)) {
      if (!rowsOf.has(g.space_id)) {
        const s = await this.spaces.spaceRow(g.space_id);
        rowsOf.set(g.space_id, s && !isDraft(s) ? { s, rows: await this.spaces.memberRows(s.id) } : null);
      }
      const at = rowsOf.get(g.space_id);
      if (!at || !at.rows.some((r) => r.user_id === ownerId)) continue;
      const to = g.to_id ? at.rows.find((r) => r.user_id === g.to_id)?.name : "Everyone";
      if (to) out.push({ grantId: g.id, spaceId: at.s.id, spaceName: at.s.name, to });
    }
    return out;
  }

  /** A plan event as its owner keeps it (read without a time zone, so the owner's own is never changed by someone else's look). */
  private async eventOf(ownerId: string, itemId: string): Promise<CalEvent | null> {
    if (!itemId.startsWith("e:")) return null;
    return calendar().event(ownerId, itemId.slice(2)).catch(() => null);
  }

  async item(viewer: string, botIn: unknown, ownerId: string, itemId: string, spaceId: string, tzIn?: unknown): Promise<WorkItem> {
    const { bot, src } = this.source(botIn);
    const access = await this.accessOf(viewer, ownerId, bot, itemId, spaceId);
    if (!access) throw gone();
    const how = access.how;
    const tz = tzOf(tzIn);
    const listed = (await this.listOf(src, ownerId)).find((i) => i.id === itemId);
    const ev = bot === "plan" ? await this.eventOf(ownerId, itemId) : null;
    if (!listed && !ev) throw gone();
    const s = await this.spaces.spaceRow(spaceId);
    const rows = s ? await this.spaces.memberRows(s.id) : [];
    // The owner may open their own thing with any space's id: its name is said only to someone in it.
    const inSpace = !!s && !isDraft(s) && rows.some((r) => r.user_id === viewer);
    const ownerName = how === "own" ? "You" : rows.find((r) => r.user_id === ownerId)?.name ?? "Someone";
    const detail: WorkItem["detail"] = {};
    if (ev) {
      const day = dayOf(ev.start, tz);
      detail.when = `${dayWords(day)} · ${ev.allDay ? "All day" : clockAt(ev.start, tz)}`;
      detail.day = day;
      detail.time = ev.allDay ? "" : hhmm(minuteOf(ev.start, tz));
      // An old per-bot share showed a title, a line and a time, and no more: it stays that way.
      if (how !== "view") {
        if (ev.place) detail.place = ev.place;
        if (ev.notes) detail.notes = ev.notes;
      }
    }
    const adminId = s?.owner_id;
    const looks = looksIn(rows.map((r) => r.user_id));
    const notes = (await this.notes.select({ owner_id: ownerId, bot, item_id: itemId }, { order: "at_ms", desc: true, limit: NOTES_SHOWN * 3 }))
      .filter((n) => viewer === ownerId || (n.space_id === spaceId && (n.only_owner !== true || n.by_id === viewer || viewer === adminId))).slice(0, NOTES_SHOWN)
      .map((n) => ({
        id: n.id, by: n.by_id === viewer ? "You" : n.by_name, you: n.by_id === viewer, bot: noteLook(n.space_id === spaceId ? looks : undefined, n, viewer), text: n.text,
        at: Number(n.at_ms),
      }));
    return {
      bot, botName: BOT_NAMES[bot], id: itemId, title: listed?.title ?? ev?.title ?? "", line: listed?.line ?? (ev?.allDay ? "All day" : "Event"),
      at: listed?.at ?? ev?.start ?? null,
      owner: { userId: ownerId, name: ownerName, you: ownerId === viewer }, space: inSpace && s ? { id: s.id, name: s.name } : { id: "", name: "" },
      how, detail, notes,
      can: { time: !!ev && !ev.fixed && (how === "own" || how === "admin" || access.reach === "one"), note: true },
      shared: how === "own" ? await this.sharedWith(ownerId, bot, itemId) : [],
      ...(access.by ? { sharedBy: rows.find((r) => r.user_id === access.by)?.name ?? "the admin" } : {}),
    };
  }

  /** A note on the thing, by who worked on it, through this space. `onlyOwner`: added through a share to them by name. */
  private async noteOn(spaceId: string, ownerId: string, bot: ShareBot, itemId: string, by: { id: string; name: string }, text: string, onlyOwner: boolean): Promise<void> {
    await this.notes.insert({
      id: randomUUID(), space_id: spaceId, owner_id: ownerId, bot, item_id: itemId.slice(0, 200), by_id: by.id,
      by_name: by.name.slice(0, 40) || "Someone", text: text.slice(0, NOTE_MAX), at_ms: this.now(), only_owner: onlyOwner,
    });
  }

  /**
   * Work on the thing: "time" moves a plan event (Change time; the owner's own calendar, with their id), "note" adds a note. Each is
   * written as a note on the thing (never the space's activity), and the space's open pages redraw. Returns the thing as it is now.
   */
  async act(viewer: { id: string; name: string }, botIn: unknown, ownerId: string, itemId: string, spaceId: string,
    b: { op?: unknown; day?: unknown; time?: unknown; tz?: unknown; text?: unknown }): Promise<WorkItem> {
    const { bot } = this.source(botIn);
    const it = await this.item(viewer.id, bot, ownerId, itemId, spaceId, b.tz);
    // Through a share to them by name: what they write is for the owner (and the admin), not for others it was shared with.
    const onlyOwner = it.how === "shared" && (await this.accessOf(viewer.id, ownerId, bot, itemId, spaceId))?.reach === "one";
    const s = await this.spaces.spaceRow(spaceId);
    // A note lives in a space: the owner, too, works on their thing through one they are in. It is signed with the name the
    // people there know them by.
    const me = s ? (await this.spaces.memberRows(s.id)).find((m) => m.user_id === viewer.id) : undefined;
    const inSpace = !!me;
    const by = { id: viewer.id, name: me?.name || viewer.name };
    let id = itemId;
    if (b.op === "time") {
      if (!it.can.time) throw gone();
      const tz = tzOf(b.tz);
      const minute = timeOf(b.time);
      if (!isDayKey(b.day) || minute === null) throw new BotError("bad_request", "Give a day like 2026-11-14 and a time like 19:30.");
      const moved = await calendar().moveEvent(ownerId, itemId.slice(2), startOfDay(b.day, tz) + minute * MIN);
      id = `e:${moved.id}`;
      if (id !== itemId) {
        // One start of a series moved alone is a new event: what was given, and the notes on it, follow it.
        await this.grants.moved(ownerId, bot, itemId, id);
        await this.notes.update({ owner_id: ownerId, bot, item_id: itemId }, { item_id: id });
      }
      if (inSpace && viewer.id !== ownerId) await this.noteOn(spaceId, ownerId, bot, id, by, `Moved it to ${dayWords(dayOf(moved.start, tz))} · ${clockAt(moved.start, tz)}.`, onlyOwner);
    } else if (b.op === "note") {
      const text = typeof b.text === "string" ? b.text.replace(/\r/g, "").trim() : "";
      if (!text) throw new BotError("bad_request", "Write the note first.");
      if (text.length > NOTE_MAX) throw new BotError("too_large", `A note can be ${NOTE_MAX} characters.`, 413);
      if (!inSpace) throw gone();
      await screenPost([text]);
      await this.noteOn(spaceId, ownerId, bot, itemId, by, text, onlyOwner);
    } else {
      throw new BotError("bad_request", "Change the time, or add a note.");
    }
    if (inSpace) await this.spaces.changed(spaceId);
    return this.item(viewer.id, bot, ownerId, id, spaceId, b.tz);
  }
}
