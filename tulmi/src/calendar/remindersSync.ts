/**
 * THE ONE REMINDERS LIST, MERGED WITH PLAN EASE'S TO-DOS (docs: perms2 §3). Pure: one function over two lists of plain shapes,
 * which says what to write here and what to answer the phone. Nothing in this file reads a store, a model or the clock.
 *
 * ONE LIST, AND ONLY ONE. The phone makes a Reminders list called "X0 Bot" and reads that list alone; its items arrive here
 * with an opaque identifier (`ext`), a title, a due date and whether they are done. No other list is ever fetched, and notes,
 * URL, location, priority, alarms and subtasks are never read or written on either side (§3.2).
 *
 *   planReminders(items, tasks, now, gone)   -> { ops, writes }
 *     ops     what the phone applies TO THAT LIST ONLY: `add` (a to-do of theirs that has no item yet), `update` (the to-do
 *             changed more recently than the item) and `remove` (its to-do is gone from X0)
 *     writes  what this server writes: a to-do changed by its item, a to-do made from a new item, a to-do deleted because its
 *             item was deleted in Reminders, a link dropped when the item behind it is gone but the to-do is the person's own,
 *             and the deletion marks that have now been acted on (`forget`)
 *     gone    the items whose to-do was deleted HERE and not yet taken out of the list (calendar/remindersGone.ts)
 *
 * WHO WINS. The newer change, by `changedAt` (the item's `lastModifiedDate`) against the to-do's `updatedAt`. Equal: the to-do,
 * because this server is where the rest of Plan Ease has already acted on it.
 *
 * WHAT A DELETION MEANS, each way round:
 *   deleted in Reminders   the to-do goes too, but ONLY if it came from Reminders AND is still open. One the person made in X0
 *                          is unlinked and kept: they deleted a copy, not the thing. A DONE one is unlinked and kept too,
 *                          because the phone stops sending an item completed over 7 days ago and its absence is not a deletion.
 *   deleted in X0          the item goes. `gone` is this server's own memory of the deletion (`Calendar.removeTask` marks a row
 *                          that had a link), because once the row is gone nothing else says the item ever had one — and the
 *                          phone does not tell us which items it made. An item the person made in Reminders and never linked
 *                          here is never removed by us.
 */

/** One item of the X0 Bot list, as the phone read it. */
export interface RemItem {
  /** The item's own opaque identifier, kept on the to-do as `ext_ref`. */
  ext: string;
  title: string;
  /** "2026-11-20" or "2026-11-20T17:30:00.000Z"; absent means no due date. */
  dueIso?: string;
  /** Whether the due date said a time, so a day-only due is not given one here. */
  dueHasTime: boolean;
  done: boolean;
  /**
   * The item's `lastModifiedDate`. Milliseconds here; the phone sends it as an ISO 8601 string, which `readRemItems` reads
   * either way (F:app/src/device/remindersCore.ts `changedAt`). 0 means "the phone said nothing we could read".
   */
  changedAt: number;
  /**
   * The phone made this item from an X0 to-do (an earlier `add`), and remembers that it did. The phone does NOT send this
   * today, so nothing depends on it: `gone` below is what decides a deletion made here.
   */
  mine?: boolean;
}

/** One of the person's own to-dos, as this merge needs it. */
export interface LocalTask {
  id: string;
  title: string;
  /** "2026-11-20", or null for no day. */
  due: string | null;
  /** When it is due, in milliseconds, when a time was said. */
  at: number | null;
  done: boolean;
  updatedAt: number;
  /** The item it is linked to, or null. */
  extRef: string | null;
  /** It was MADE from a Reminders item (ext_src), rather than typed in X0 and copied out. */
  fromReminders: boolean;
}

/** What the phone applies, to the X0 Bot list and nothing else. */
export interface SyncOps {
  add: Array<{ id: string; title: string; dueIso?: string; dueHasTime: boolean }>;
  update: Array<{ ext: string; title?: string; dueIso?: string; dueHasTime?: boolean; done?: boolean }>;
  remove: string[];
}

/** What this server writes. The route turns each of these into one calendar call. */
export interface SyncWrites {
  /** An existing to-do, changed by its item. */
  change: Array<{ id: string; title?: string; dueIso?: string | null; dueHasTime?: boolean; done?: boolean }>;
  /** A new item in the list: a new to-do, linked and marked as coming from Reminders. */
  make: Array<{ ext: string; title: string; dueIso?: string; dueHasTime: boolean; done: boolean }>;
  /**
   * An item that is ALREADY one of this person's to-dos and only lost its link: the link alone is written, and no second
   * to-do is made. This is the lost-`{applied}` case — see the merge below.
   */
  link: Array<{ id: string; ext: string }>;
  /** Its item was deleted in Reminders and the to-do came from there. */
  remove: string[];
  /** Its item is gone but the to-do is the person's own, or done: the link goes, the to-do stays. */
  unlink: string[];
  /**
   * The deletion marks that have been acted on, so they are not acted on twice (calendar/remindersGone.ts): the items taken
   * out of the list now, and any mark whose item is not in the list any more.
   */
  forget: string[];
}

export interface SyncPlan { ops: SyncOps; writes: SyncWrites }

/** At most this many items, and this many to-dos, in one sync (the route checks the same number). */
export const REMINDERS_LIMITS = { items: 300, title: 200, outDays: 30 } as const;

/** The title as either side keeps it: one line, 200 characters at most. */
export const remTitle = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, REMINDERS_LIMITS.title);

/** A to-do's due date as the item wants it: the day alone, or the day and its time. */
export function dueIsoOf(t: Pick<LocalTask, "due" | "at">): { dueIso?: string; dueHasTime: boolean } {
  if (!t.due) return { dueHasTime: false };
  if (t.at === null) return { dueIso: t.due, dueHasTime: false };
  return { dueIso: new Date(t.at).toISOString(), dueHasTime: true };
}

/** Does the item say something different from the to-do? Only the three things that are ever synced are compared. */
function differs(item: RemItem, task: LocalTask): boolean {
  const mine = dueIsoOf(task);
  return remTitle(item.title) !== remTitle(task.title)
    || (item.dueIso ?? "") !== (mine.dueIso ?? "")
    || item.dueHasTime !== mine.dueHasTime
    || item.done !== task.done;
}

/** Which of the person's to-dos go out to the list: open ones, with no day or due within 30 days. */
export function goesOut(t: LocalTask, now: number): boolean {
  if (t.done) return false;
  if (!t.due) return true;
  const at = t.at ?? Date.parse(`${t.due}T12:00:00Z`);
  return Number.isFinite(at) && at <= now + REMINDERS_LIMITS.outDays * 86_400_000;
}

/**
 * THE MERGE. `items` is the whole X0 Bot list as the phone read it (open items plus items completed in the last 7 days);
 * `tasks` is the person's own to-dos, every linked one and every one that could go out.
 */
export function planReminders(items: readonly RemItem[], tasks: readonly LocalTask[], now: number, gone: Iterable<string> = []): SyncPlan {
  const ops: SyncOps = { add: [], update: [], remove: [] };
  const writes: SyncWrites = { change: [], make: [], remove: [], unlink: [], forget: [], link: [] };
  const byExt = new Map<string, LocalTask>();
  for (const t of tasks) if (t.extRef) byExt.set(t.extRef, t);
  const seen = new Set<string>();
  // The to-dos deleted HERE whose item is still in the list (calendar/remindersGone.ts). Without this memory the item would
  // read as a new to-do and be copied straight back in, every sync.
  const deletedHere = new Set(gone);
  /**
   * THE TO-DOS THIS SERVER HAS ALREADY ASKED THE PHONE TO ADD, waiting for their ext to come back.
   *
   * A sync is two requests: the list goes out as `ops.add`, the phone makes the items, and the SECOND request carries
   * `{applied: [{id, ext}]}` with the ext each one became. If that second request is lost — the app is closed, the network
   * goes — the to-do still has no link, and next round the very item we asked for arrives as an ext nobody knows. Importing
   * it would make a SECOND to-do of the one we had just sent out, and then add that one too, for ever.
   *
   * Same title, same due date, no link, and due to go out: it is ours. The link is written and nothing is made. A real new
   * item the person typed in Reminders that happens to match a to-do of theirs word for word is the one thing this could
   * take for ours, and the two are then the same to-do, which is what they would have wanted anyway.
   */
  const key = (title: string, dueIso: string | undefined, hasTime: boolean): string => `${title}\u0000${dueIso ?? ""}\u0000${hasTime ? 1 : 0}`;
  const waiting = new Map<string, LocalTask[]>();
  for (const t of tasks) {
    if (t.extRef || t.done || !goesOut(t, now)) continue;
    const d = dueIsoOf(t);
    const k = key(remTitle(t.title), d.dueIso, d.dueHasTime);
    const at = waiting.get(k);
    if (at) at.push(t); else waiting.set(k, [t]);
  }
  /** The to-dos linked to an incoming item in this round, so the second loop does not add them again. */
  const linkedNow = new Set<string>();

  for (const item of items) {
    if (!item.ext || seen.has(item.ext)) continue;
    seen.add(item.ext);
    const task = byExt.get(item.ext);
    if (!task) {
      // No to-do behind it. One whose to-do was deleted here goes out of the list, and its mark with it. (`mine` is the
      // phone-side version of the same thing, kept for a phone that ever sends it.)
      if (deletedHere.has(item.ext) || item.mine === true) {
        ops.remove.push(item.ext);
        writes.forget.push(item.ext);
        continue;
      }
      // One of ours whose `{applied}` never landed: link it, do not copy it.
      const ours = !item.done ? waiting.get(key(remTitle(item.title), item.dueIso, item.dueHasTime))?.shift() : undefined;
      if (ours) {
        writes.link.push({ id: ours.id, ext: item.ext });
        linkedNow.add(ours.id);
        continue;
      }
      // An item the person made in Reminders is a new to-do here.
      writes.make.push({ ext: item.ext, title: remTitle(item.title), ...(item.dueIso ? { dueIso: item.dueIso } : {}), dueHasTime: item.dueHasTime, done: item.done });
      continue;
    }
    if (!differs(item, task)) continue;
    if (item.changedAt > task.updatedAt) {
      writes.change.push({
        id: task.id, title: remTitle(item.title),
        dueIso: item.dueIso ?? null, dueHasTime: item.dueHasTime, done: item.done,
      });
    } else {
      ops.update.push({ ext: item.ext, title: remTitle(task.title), ...dueIsoOf(task), done: task.done });
    }
  }

  for (const t of tasks) {
    if (t.extRef && !seen.has(t.extRef)) {
      // Its item is not in the list any more. A to-do that came from Reminders and is still OPEN was deleted there, so it
      // goes too. A DONE one is only out of the phone's read: the phone stops sending an item completed over 7 days ago
      // (TulmiReminders `doneDays`), and that is not a deletion — so the link goes and the to-do stays, ticked, as it was.
      if (t.fromReminders && !t.done) writes.remove.push(t.id);
      else writes.unlink.push(t.id);
      continue;
    }
    if (!t.extRef && !linkedNow.has(t.id) && goesOut(t, now)) ops.add.push({ id: t.id, title: remTitle(t.title), ...dueIsoOf(t) });
  }
  // A mark whose item is not in the list any more has nothing left to do: the item has gone, by our hand or theirs.
  for (const ref of deletedHere) if (!seen.has(ref)) writes.forget.push(ref);
  return { ops, writes };
}

// ------------------------------------------------------------------ what the phone sent, checked

const bad = (m: string): never => { throw new Error(m); };

/** The items of one sync, checked. Out of bounds is refused, not trimmed. */
export function readRemItems(body: unknown): { listId: string; items: RemItem[] } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as { listId?: unknown; items?: unknown };
  const listId = String(b.listId ?? "").slice(0, 200);
  if (!Array.isArray(b.items)) bad("items is the X0 Bot list's items.");
  const list = b.items as unknown[];
  if (list.length > REMINDERS_LIMITS.items) bad(`items is ${REMINDERS_LIMITS.items} at most.`);
  const items: RemItem[] = [];
  for (const raw of list) {
    const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const ext = String(o.ext ?? "").slice(0, 200);
    if (!ext) bad("each item has its own ext.");
    // The phone sends `changedAt` as an ISO 8601 string (remindersCore `isoOk`); the contract says milliseconds. Either is
    // read, because a number that came back NaN read as 0, which made the to-do win every time and pushed X0's old copy back
    // over an edit made in Reminders.
    const changedAt = typeof o.changedAt === "string" ? Date.parse(o.changedAt) : Number(o.changedAt);
    const dueIso = typeof o.dueIso === "string" && o.dueIso ? o.dueIso : undefined;
    if (dueIso !== undefined && !Number.isFinite(Date.parse(dueIso))) bad("an item's dueIso is a date.");
    items.push({
      ext, title: remTitle(o.title), ...(dueIso ? { dueIso } : {}),
      dueHasTime: o.dueHasTime === true, done: o.done === true,
      changedAt: Number.isFinite(changedAt) ? changedAt : 0,
      ...(o.mine === true ? { mine: true as const } : {}),
    });
  }
  return { listId, items };
}

/** The second request: which item each added to-do became, so the link is written here. */
export function readApplied(body: unknown): Array<{ id: string; ext: string }> {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as { applied?: unknown };
  if (!Array.isArray(b.applied)) bad("applied is the list of what the phone made.");
  const list = b.applied as unknown[];
  if (list.length > REMINDERS_LIMITS.items) bad(`applied is ${REMINDERS_LIMITS.items} at most.`);
  const out: Array<{ id: string; ext: string }> = [];
  for (const raw of list) {
    const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as { id?: unknown; ext?: unknown };
    const id = String(o.id ?? ""), ext = String(o.ext ?? "").slice(0, 200);
    if (!id || !ext) bad("each one has the to-do's id and the item's ext.");
    out.push({ id, ext });
  }
  return out;
}
