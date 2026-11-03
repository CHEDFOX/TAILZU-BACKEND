/**
 * WHAT A GROUP'S BOTS KNOW ABOUT THE GROUP: short lines members tell them, kept per group (space_facts, migration 0064).
 *
 *   view(userId, spaceId)               every line, in sections, each with who wrote it (the people you blocked, or who blocked you, left out)
 *   add(userId, spaceId, text, o)       a line written in the group, or shared from the person's own space by a tap (o.fromKey)
 *   forget(userId, spaceId, lineId)     by the one who wrote it, or the group's admin
 *   forBot(userId, slug)                for a bot shared into the person's groups: those groups' lines, as data
 *
 * A person's own space never reaches a group by itself: a line gets here only when they write it here or share that one line. Never health,
 * religion, politics or sexuality (money is fine: "we split rent on the 1st"). Leaving a group takes your lines with you; a group that goes
 * takes all of them.
 */
import { BotError } from "../bots/index.js";
import { usableFact } from "../bots/memory.js";
import { sensitive } from "../bots/shared.js";
import { fileFact } from "../you/spaceFile.js";
import { isFactSection, KEY, type FactSection } from "../you/spaceMarks.js";
import type { Spaces } from "./spaces.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";

export interface SpaceFactRow {
  [k: string]: unknown;
  id: string; space_id: string; user_id: string; text: string; section: FactSection; from_key: string | null; created_ms: number;
}
export interface GroupLine { id: string; text: string; section: FactSection; by: string; you: boolean; mine: boolean; at: number; shared: boolean }
export interface GroupMemoryView { space: { id: string; name: string }; admin: boolean; lines: GroupLine[] }

/** Lines a group keeps: past this, a new one waits until one is forgotten. */
export const GROUP_LINES_MAX = 200;
/** Lines a bot reads of one group, newest first. */
const BOT_LINES = 40;

export class SpaceMemory {
  constructor(
    private readonly spaces: Spaces,
    private readonly o: { now?: () => number; hidden?: (userId: string) => Promise<Set<string>>; rows?: PagedTable<SpaceFactRow> } = {},
  ) {
    spaces.onMembers(async (e) => {
      if (e.deleted) await this.rows.remove({ space_id: e.spaceId });
      else if (e.left) await this.rows.remove({ space_id: e.spaceId, user_id: e.left });
    });
  }

  private get rows(): PagedTable<SpaceFactRow> { return (this.o.rows ??= spaceTable<SpaceFactRow>("space_facts")); }
  private now(): number { return (this.o.now ?? Date.now)(); }
  private async hidden(userId: string): Promise<Set<string>> { return this.o.hidden ? this.o.hidden(userId).catch(() => new Set<string>()) : new Set<string>(); }

  private async lines(spaceId: string, viewer: string): Promise<SpaceFactRow[]> {
    const hidden = await this.hidden(viewer);
    return (await this.rows.before({ space_id: spaceId }, "created_ms", null, GROUP_LINES_MAX)).filter((r) => !hidden.has(r.user_id));
  }

  async view(userId: string, spaceId: string): Promise<GroupMemoryView> {
    const a = await this.spaces.access(userId, spaceId);
    const names = new Map((await this.spaces.membersOf(spaceId)).map((m) => [m.userId, m.name]));
    const lines = (await this.lines(spaceId, userId)).map((r): GroupLine => ({
      id: r.id, text: r.text, section: r.section, by: r.user_id === userId ? "you" : names.get(r.user_id) ?? "Someone",
      you: r.user_id === userId, mine: r.user_id === userId || a.admin, at: r.created_ms, shared: !!r.from_key,
    }));
    return { space: { id: a.s.id, name: a.s.name }, admin: a.admin, lines };
  }

  async add(userId: string, spaceId: string, raw: unknown, o: { section?: unknown; fromKey?: string } = {}): Promise<GroupLine> {
    await this.spaces.access(userId, spaceId);
    const text = typeof raw === "string" ? usableFact(raw) : null;
    if (!text) throw new BotError("bad_line", "Write one short line (up to 160 letters), with no passwords or codes.");
    if (sensitive(text, { money: false })) throw new BotError("sensitive", "Health, religion, politics and the like stay out of what a group's bots know.");
    const have = await this.rows.before({ space_id: spaceId }, "created_ms", null, GROUP_LINES_MAX + 1);
    const same = have.find((r) => r.text.toLowerCase() === text.toLowerCase());
    if (same) throw new BotError("already_kept", "The group's bots already know that.", 409);
    if (have.length >= GROUP_LINES_MAX) throw new BotError("group_full", `A group keeps ${GROUP_LINES_MAX} lines. Forget one first.`, 409);
    const section = isFactSection(o.section) ? o.section : fileFact(text);
    const row = await this.rows.insert({
      id: crypto.randomUUID(), space_id: spaceId, user_id: userId, text, section,
      from_key: o.fromKey && KEY.test(o.fromKey) ? o.fromKey : null, created_ms: this.now(),
    });
    return { id: row.id, text, section, by: "you", you: true, mine: true, at: row.created_ms, shared: !!row.from_key };
  }

  async forget(userId: string, spaceId: string, lineId: string): Promise<void> {
    const a = await this.spaces.access(userId, spaceId);
    const [r] = await this.rows.select({ space_id: spaceId, id: lineId }, { limit: 1 });
    if (!r) throw new BotError("not_found", "That line isn't kept any more.", 404);
    if (r.user_id !== userId && !a.admin) throw new BotError("forbidden", "Only the one who wrote it, or the group's admin, can forget it.", 403);
    await this.rows.remove({ space_id: spaceId, id: lineId });
  }

  /** The person's groups that have this bot: what each group's bots know, as data for the bot's prompt. */
  async forBot(userId: string, slug: string): Promise<Array<{ name: string; kind: string; text: string }>> {
    const out: Array<{ name: string; kind: string; text: string }> = [];
    for (const s of (await this.spaces.spacesWithBot(userId, slug)).slice(0, 3)) {
      const rows = (await this.lines(s.id, userId)).slice(0, BOT_LINES);
      if (!rows.length) continue;
      const names = new Map((await this.spaces.membersOf(s.id)).map((m) => [m.userId, m.name]));
      out.push({ name: `What ${s.name} told its bots`, kind: "space", text: rows.map((r) => `- ${r.text} (said by ${names.get(r.user_id) ?? "someone"})`).join("\n") });
    }
    return out;
  }
}
