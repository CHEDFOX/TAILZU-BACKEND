/**
 * THE NAME YOU GIVE SOMEONE (docs/social.md §2; migration 0111).
 *
 * A username is how a person is REACHED (`profile/username.ts`). This is what they are CALLED, and it is per reader, the way a
 * phone's contacts are: you add `@aanya-r` and you call her Mom. The same account is Mom to one person and Aanya to another, and
 * neither ever sees the other's name for her.
 *
 *   known(viewer)                 every name this person gave, in one read: a Map for a whole list (looksKnown does the same)
 *   shownName(known, id, fallback)  what one row says: the viewer's own name for them, else the name already on the row
 *   nameFor(viewer, subject)      one, or "" when they never gave one
 *   set(viewer, subject, name)    name them, screened; an empty name takes the name off again
 *   mine(viewer)                  the names they have given, for a screen that lists them
 *
 * WHY A FALLBACK AND NOT A REPLACEMENT. Every name on a row today keeps being written exactly as it was
 * (`space_members.name`, `thread_members.name`, `thread_messages.sender_name`), and one of them is load-bearing: a DELETED
 * account takes its `thread_members` row with it, so a one-to-one chat reads its name back off that person's own messages
 * (`sender_name`, migration 0051; docs/spaces.md "Someone no longer here"). So this resolves ON TOP of those, never instead of
 * them, and only while the subject still has an account — `subject_id` cascades, so the account going takes these names with it
 * and the row's own name takes over, exactly as it does today.
 *
 * Looks are untouched: a person's tiny bot is hashed from their id, never their name (`personLook.ts`).
 */
import { BotError } from "../bots/index.js";
import { screenPost } from "./filter.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";

export interface PersonNameRow {
  [k: string]: unknown;
  owner_id: string; subject_id: string; name: string; set_ms: number;
}

/** A name is as long as the names already on the rows (`space_members.name`). */
export const NAME_MAX = 40;
/** How many people one person may name. A bound, so this cannot become somewhere to keep notes on everybody. */
const NAMED_MAX = 2000;

const clean = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";

export class PersonNames {
  private readonly rows: PagedTable<PersonNameRow>;

  constructor(o: { now?: () => number } = {}) {
    this.rows = spaceTable<PersonNameRow>("person_names");
    this.now = o.now ?? Date.now;
  }

  private readonly now: () => number;

  /**
   * Every name this person has given, by subject id. One read, so a list of twenty people costs the same as one (the looks are
   * worked out the same way: `threads.ts looksKnown`).
   */
  async known(viewerId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!viewerId) return out;
    for (const r of await this.rows.select({ owner_id: viewerId }, { limit: NAMED_MAX })) {
      if (r.name) out.set(r.subject_id, r.name);
    }
    return out;
  }

  /** The name they gave this one person, or "". */
  async nameFor(viewerId: string, subjectId: string): Promise<string> {
    if (!viewerId || !subjectId || viewerId === subjectId) return "";
    const [r] = await this.rows.select({ owner_id: viewerId, subject_id: subjectId }, { limit: 1 });
    return r?.name ?? "";
  }

  /** The names they have given, newest first, for a screen that lists them. */
  async mine(viewerId: string): Promise<Array<{ userId: string; name: string; at: number }>> {
    const rows = await this.rows.select({ owner_id: viewerId }, { order: "set_ms", desc: true, limit: NAMED_MAX });
    return rows.map((r) => ({ userId: r.subject_id, name: r.name, at: Number(r.set_ms) || 0 }));
  }

  /**
   * Name someone. An empty name takes the name off again, so the row's own name shows instead. Screened like every other name a
   * person writes (space names, a join request's name: `filter.ts`).
   */
  async set(viewerId: string, subjectId: string, nameIn: unknown): Promise<{ name: string }> {
    if (!subjectId) throw new BotError("bad_request", "Who do you mean?");
    if (subjectId === viewerId) throw new BotError("bad_request", "That's you.");
    const name = clean(nameIn);
    if (!name) {
      await this.rows.remove({ owner_id: viewerId, subject_id: subjectId });
      return { name: "" };
    }
    await screenPost([name]);
    const had = await this.nameFor(viewerId, subjectId);
    if (!had) {
      const mine = await this.rows.select({ owner_id: viewerId }, { limit: NAMED_MAX + 1 });
      if (mine.length >= NAMED_MAX) throw new BotError("too_many", "That's a lot of people named. Take one off first.", 409);
    }
    await this.rows.upsert({ owner_id: viewerId, subject_id: subjectId, name, set_ms: this.now() }, ["owner_id", "subject_id"]);
    return { name };
  }
}

/**
 * What one row says a person is called: the viewer's own name for them first, then the name already on the row (a member row, a
 * thread member, a message's `sender_name`). Never empty where the row had something.
 */
export const shownName = (known: ReadonlyMap<string, string> | null | undefined, id: string, fallback: string): string =>
  (id && known?.get(id)) || fallback;
