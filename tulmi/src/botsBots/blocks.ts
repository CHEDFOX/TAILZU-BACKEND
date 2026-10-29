/**
 * BLOCKING SOMEONE (migration 0057 user_blocks; App Review guideline 1.2). A block works both ways round, whoever made it:
 *
 *   - the one-to-one chat between the two is closed (neither can write) and hidden from both chat lists;
 *   - in a group or a space's chat, neither sees the other's messages, and a message from one never counts as unread for, or pings,
 *     the other;
 *   - neither appears in the other's lists of people: a space's members, Message someone, Start a group, Share to;
 *   - neither sees what the other shared in a space.
 *
 * Only the person who blocked can unblock (You › Blocked people). Reading is fail-open: until the migration is run (or while the
 * table can't be read) nobody is blocked and messaging works as before; writing a block fails loudly instead, so nobody is told a
 * block is in place when it is not.
 *
 *   hiddenFor(viewer)      the people the viewer and they have a block between, either way round (a Set, memoised a moment)
 *   between(a, b)          whether there is a block either way
 *   byMe(viewer, other)    whether the viewer blocked them
 *   list(viewer)           whom the viewer blocked, newest first
 *   block(viewer, other, name) / unblock(viewer, other)
 */
import { spaceTable, type PagedTable } from "./spaceRows.js";

export interface BlockRow { [k: string]: unknown; blocker_id: string; blocked_id: string; name: string; at_ms: number }

/** How many people one person can block: plenty for family and friends, and a bound on every read. */
export const BLOCKS_MAX = 200;
const MEMO_MS = 2_000;

export class Blocks {
  private readonly rows: PagedTable<BlockRow>;
  private readonly memo = new Map<string, { at: number; ids: Set<string> }>();
  private warned = false;

  constructor(private readonly now: () => number = Date.now, o: { rows?: PagedTable<BlockRow>; log?: { warn(o: object, m: string): void } } = {}) {
    this.rows = o.rows ?? spaceTable<BlockRow>("user_blocks");
    this.log = o.log;
  }
  private readonly log?: { warn(o: object, m: string): void };

  private async read(match: Partial<BlockRow>): Promise<BlockRow[]> {
    try {
      return await this.rows.select(match, { limit: BLOCKS_MAX + 1 });
    } catch (err) {
      if (!this.warned) { this.warned = true; this.log?.warn({ error: (err as Error)?.message?.slice(0, 120) }, "blocks: can't read user_blocks (is migration 0057 run?); nobody is blocked"); }
      return [];
    }
  }

  /** Everyone the viewer has a block with, either way round. */
  async hiddenFor(viewer: string): Promise<Set<string>> {
    const m = this.memo.get(viewer);
    if (m && this.now() - m.at < MEMO_MS) return m.ids;
    const [mine, theirs] = await Promise.all([this.read({ blocker_id: viewer }), this.read({ blocked_id: viewer })]);
    const ids = new Set<string>([...mine.map((r) => r.blocked_id), ...theirs.map((r) => r.blocker_id)]);
    this.memo.set(viewer, { at: this.now(), ids });
    if (this.memo.size > 5_000) this.memo.clear();
    return ids;
  }

  async between(a: string, b: string): Promise<boolean> {
    if (!a || !b || a === b) return false;
    return (await this.hiddenFor(a)).has(b);
  }

  async byMe(viewer: string, other: string): Promise<boolean> {
    return (await this.read({ blocker_id: viewer, blocked_id: other })).length > 0;
  }

  async list(viewer: string): Promise<Array<{ userId: string; name: string; at: number }>> {
    const rows = await this.read({ blocker_id: viewer });
    return rows.sort((x, y) => Number(y.at_ms) - Number(x.at_ms)).map((r) => ({ userId: r.blocked_id, name: r.name || "Someone", at: Number(r.at_ms) }));
  }

  /** Block `other`. Blocking twice keeps the first. Throws when the block can't be written. */
  async block(viewer: string, other: string, name: string): Promise<{ already: boolean }> {
    if (await this.byMe(viewer, other)) return { already: true };
    const count = (await this.rows.select({ blocker_id: viewer }, { limit: BLOCKS_MAX + 1 })).length;
    if (count >= BLOCKS_MAX) throw new Error("block limit");
    await this.rows.insert({ blocker_id: viewer, blocked_id: other, name: name.slice(0, 40), at_ms: this.now() });
    this.forget(viewer, other);
    return { already: false };
  }

  async unblock(viewer: string, other: string): Promise<boolean> {
    const n = await this.rows.remove({ blocker_id: viewer, blocked_id: other });
    this.forget(viewer, other);
    return n > 0;
  }

  private forget(...ids: string[]): void { for (const id of ids) this.memo.delete(id); }
}
