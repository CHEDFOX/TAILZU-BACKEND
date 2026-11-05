/**
 * WHAT EACH PERSON SHARES FROM THEIR OWN BOTS INTO A GROUP: a group's sub-bots (Plan, Notes, Travel, Xode), and inside each, every
 * person's own part of it, as much as they chose.
 *
 *   mine(user, space, bot)            what you share there (everything, picked items or nothing) and your items to pick from
 *   set(user, space, bot, choice)     change it: yours alone, and only items that are yours
 *   view(user, space, bot)            what everyone in the space shares from that bot, each person's items, yours first
 *   summary(user, space)              per bot, who shares anything: the group page's "Bots in Home"
 *
 * THE RULES. Nothing is shared until its owner chooses (no row is nothing). Only the owner changes what they share: no admin, no
 * role. Seeing a shared item is all it gives: nobody acts on another's item from here. Someone who leaves a space takes their
 * sharing with them, and a space that goes takes all of it (onMembers). An item picked and then deleted simply stops showing.
 *
 * Where the items come from is the caller's (routes/bots/botsSpaces.ts): one ShareSource a bot, which lists a person's own items.
 * Kept in space_bot_shares (migration 0063).
 */
import { BotError } from "../bots/index.js";
import type { Spaces } from "./spaces.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";

export const SHARE_BOTS = ["plan", "notes", "travel", "code"] as const;
export type ShareBot = (typeof SHARE_BOTS)[number];
export type ShareMode = "all" | "some" | "none";
export const isShareBot = (v: unknown): v is ShareBot => typeof v === "string" && (SHARE_BOTS as readonly string[]).includes(v);

/** One of a person's own items, as the group sees it: a title, one line, and when. */
export interface OwnItem { id: string; title: string; line: string; at: number | null }

/** Lists a person's own items from one bot (their calendar, notes, trips, projects). */
export interface ShareSource { list(userId: string): Promise<OwnItem[]> }
export type ShareSources = Partial<Record<ShareBot, ShareSource>>;

interface ShareRow {
  [k: string]: unknown;
  space_id: string; user_id: string; bot: string; mode: ShareMode; items: string[]; updated_ms: number;
}

export interface PersonShare { userId: string; name: string; you: boolean; mode: ShareMode; items: OwnItem[] }
export interface BotView { bot: ShareBot; space: { id: string; name: string }; people: PersonShare[] }
export interface BotSummary { bot: ShareBot; sharing: Array<{ userId: string; name: string; you: boolean; mode: ShareMode }> }

/** Items a person may pick: at most this many. */
const PICK_MAX = 200;
/** Items shown for one person in a group: at most this many. */
const SHOW_MAX = 30;

export class SpaceShares {
  constructor(
    private readonly spaces: Spaces,
    private readonly sources: ShareSources,
    private readonly now: () => number = Date.now,
    private readonly rows: PagedTable<ShareRow> = spaceTable<ShareRow>("space_bot_shares"),
  ) {
    spaces.onMembers(async (e) => {
      if (e.deleted) await this.rows.remove({ space_id: e.spaceId });
      else if (e.left) await this.rows.remove({ space_id: e.spaceId, user_id: e.left });
    });
  }

  /** The bots that can be shared here: the ones this server has a source for. */
  bots(): ShareBot[] { return SHARE_BOTS.filter((b) => !!this.sources[b]); }

  private source(bot: unknown): { bot: ShareBot; src: ShareSource } {
    if (!isShareBot(bot) || !this.sources[bot]) throw new BotError("not_found", "That bot can't be shared in a space.", 404);
    return { bot, src: this.sources[bot]! };
  }

  /** What one person shares in a space from one bot (no row: nothing). Work in space reads it too (work.ts): it is read only there. */
  async rule(spaceId: string, userId: string, bot: ShareBot): Promise<{ mode: ShareMode; items: string[] }> {
    const [r] = await this.rows.select({ space_id: spaceId, user_id: userId, bot }, { limit: 1 });
    return r ? { mode: r.mode, items: Array.isArray(r.items) ? r.items.map(String) : [] } : { mode: "none", items: [] };
  }

  /** What everyone shares in a space from one bot, by person (only those who share something). */
  async rules(spaceId: string, bot: ShareBot): Promise<Map<string, { mode: ShareMode; items: string[] }>> {
    const rows = await this.rows.select({ space_id: spaceId, bot }, { limit: 200 });
    return new Map(rows.filter((r) => r.mode !== "none").map((r) => [r.user_id, { mode: r.mode, items: Array.isArray(r.items) ? r.items.map(String) : [] }]));
  }

  /** What you share in a space from one bot, and your items to pick from. */
  async mine(userId: string, spaceId: string, botIn: unknown): Promise<{ bot: ShareBot; mode: ShareMode; items: string[]; own: OwnItem[] }> {
    const { bot, src } = this.source(botIn);
    await this.spaces.access(userId, spaceId);
    const [rule, own] = await Promise.all([this.rule(spaceId, userId, bot), src.list(userId).catch(() => [] as OwnItem[])]);
    const ids = new Set(own.map((i) => i.id));
    return { bot, mode: rule.mode, items: rule.items.filter((id) => ids.has(id)), own };
  }

  /**
   * Change what you share: `mode`, or one item picked or unpicked (`item` with `on`), which also makes the mode "some". Only your
   * own items can be picked.
   */
  async set(userId: string, spaceId: string, botIn: unknown, choice: { mode?: unknown; item?: unknown; on?: unknown }): Promise<{ mode: ShareMode; items: string[] }> {
    const { bot, src } = this.source(botIn);
    await this.spaces.access(userId, spaceId);
    const cur = await this.rule(spaceId, userId, bot);
    let mode: ShareMode = cur.mode, items = cur.items;
    if (choice.mode !== undefined) {
      if (choice.mode !== "all" && choice.mode !== "some" && choice.mode !== "none") throw new BotError("bad_mode", "Pick everything, some or nothing.");
      mode = choice.mode;
    }
    if (choice.item !== undefined) {
      const id = String(choice.item ?? "");
      const own = await src.list(userId);
      if (!own.some((i) => i.id === id)) throw new BotError("not_found", "That isn't one of yours.", 404);
      items = choice.on === false ? items.filter((x) => x !== id) : [...new Set([...items, id])].slice(0, PICK_MAX);
      mode = "some";
    }
    await this.rows.upsert({ space_id: spaceId, user_id: userId, bot, mode, items, updated_ms: this.now() }, ["space_id", "user_id", "bot"]);
    return { mode, items };
  }

  /** What everyone in the space shares from one bot: you first, then the others; someone who shares nothing is listed with nothing. */
  async view(userId: string, spaceId: string, botIn: unknown): Promise<BotView> {
    const { bot, src } = this.source(botIn);
    const a = await this.spaces.access(userId, spaceId);
    const members = await this.spaces.membersOf(spaceId);
    const rules = await this.rows.select({ space_id: spaceId, bot }, { limit: 200 });
    const people = await Promise.all(members.map(async (m): Promise<PersonShare> => {
      const r = rules.find((x) => x.user_id === m.userId);
      const mode: ShareMode = r?.mode ?? "none";
      const you = m.userId === userId;
      if (mode === "none") return { userId: m.userId, name: m.name, you, mode, items: [] };
      const own = await src.list(m.userId).catch(() => [] as OwnItem[]);
      const picked = new Set(Array.isArray(r?.items) ? r!.items.map(String) : []);
      const items = (mode === "all" ? own : own.filter((i) => picked.has(i.id))).slice(0, SHOW_MAX);
      return { userId: m.userId, name: m.name, you, mode, items };
    }));
    return { bot, space: { id: a.s.id, name: a.s.name }, people: [...people.filter((p) => p.you), ...people.filter((p) => !p.you)] };
  }

  /** For each bot, who shares anything in the space (and how): no items read, only the choices. */
  async summary(userId: string, spaceId: string): Promise<BotSummary[]> {
    await this.spaces.access(userId, spaceId);
    const [members, rules] = await Promise.all([this.spaces.membersOf(spaceId), this.rows.select({ space_id: spaceId }, { limit: 1000 })]);
    return this.bots().map((bot) => ({
      bot,
      sharing: rules.filter((r) => r.bot === bot && r.mode !== "none").flatMap((r) => {
        const m = members.find((x) => x.userId === r.user_id);
        return m ? [{ userId: m.userId, name: m.name, you: m.userId === userId, mode: r.mode }] : [];
      }),
    }));
  }
}
