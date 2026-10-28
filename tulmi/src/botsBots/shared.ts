/**
 * SHARING ANYTHING WITH A SPACE OR A PERSON: a plan, a trip, a list, a meeting note, a file, a link, a bot's answer, a Code bot preview.
 *
 *   share(user, me, { kind, ref?, title, text?, url?, items?, note?, access, to: { space } | { person } })
 *                         a shared thing: in a space's Shared, or to one person (their chat with you gets its card)
 *   list(user, space)     what's shared in a space, newest first
 *   get(user, item)       one, for someone who may see it
 *   edit(user, item, op)  a list (and a trip's packing list) changed by someone allowed: add, tick, take off, rename
 *   remove(user, item)    who shared it, or (in a space) someone who may edit shared things
 *   forBot(user, slug)    what a bot shared into the person's spaces may read when they use it
 *
 * A shared thing is a copy made when it was shared (a snapshot) or, for a file, a pointer to the sharer's own file (served only through
 * a signed link to someone who may see it). What the sharer says it is, is checked where it can be: a file must be theirs, a trip is
 * read from their own trips. Viewing needs being in the space (or the chat); editing needs "add, edit and remove shared things" in the
 * space (or, shared to a person, an edit share); only lists can be edited.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { live } from "../live/bus.js";
import { signQuery } from "./spaceLinks.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import type { Publish, Spaces } from "./spaces.js";
import type { FileRef, Threads } from "./threads.js";

export const ITEM_KINDS = ["list", "trip", "plan", "note", "file", "link", "answer", "preview", "text"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
/** The kinds that can be edited once shared: their list. */
export const EDITABLE: readonly ItemKind[] = ["list", "trip"];
export const LIST_MAX = 60;
export const ITEMS_MAX = 200;

export interface ListLine { id: string; text: string; done: boolean }
export interface ItemData {
  text?: string; url?: string; list?: ListLine[]; file?: FileRef; ref?: string;
  /** A trip's where, when and who. */
  place?: string; when?: string; who?: string;
  /** What the sharer said with it. */
  note?: string;
  /** The bot an answer came from. */
  bot?: string;
}
export interface ItemRow {
  [k: string]: unknown; id: string; space_id: string | null; thread_id: string | null; kind: ItemKind; title: string; data: ItemData;
  access: "view" | "edit"; shared_by: string; shared_name: string; created_ms: number; updated_ms: number; updated_by: string | null;
}
export interface ItemView {
  id: string; kind: ItemKind; title: string; spaceId: string | null; threadId: string | null; by: string; byYou: boolean; at: number; updatedAt: number;
  access: "view" | "edit"; canEdit: boolean; canRemove: boolean; summary: string;
  text: string; url: string; note: string; list: ListLine[]; place: string; when: string; who: string; bot: string;
  file: { name: string; mime: string; bytes: number; kind: string; url: string } | null;
}

/** What only the server may read: a person's own file and trip (routes build these from the media store and Trips). */
export interface ShareSources {
  file?(userId: string, id: string): Promise<{ id: string; name: string; mime: string; bytes: number; kind: string } | null>;
  trip?(userId: string, id: string): Promise<{ place: string; when: string; who: string; packing: Array<{ text: string; done: boolean }> } | null>;
}

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const body = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const gone = () => new BotError("not_found", "That isn't shared any more.", 404);
const isKind = (k: unknown): k is ItemKind => typeof k === "string" && (ITEM_KINDS as readonly string[]).includes(k);
const KIND_WORD: Record<ItemKind, string> = { list: "list", trip: "trip", plan: "plan", note: "note", file: "file", link: "link", answer: "answer", preview: "preview", text: "note" };

function safeUrl(v: unknown): string {
  const s = clean(v, 2000);
  if (!s) return "";
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : ""; } catch { return ""; }
}

function lines(v: unknown): ListLine[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, LIST_MAX).map((x) => {
    const t = typeof x === "string" ? clean(x, 200) : clean((x as { text?: unknown })?.text, 200);
    return t ? { id: randomUUID().slice(0, 8), text: t, done: typeof x === "object" && (x as { done?: unknown })?.done === true } : null;
  }).filter((x): x is ListLine => !!x);
}

export class SharedItems {
  private readonly rows: PagedTable<ItemRow>;
  private readonly publish: Publish;

  constructor(
    private readonly spaces: Spaces,
    private readonly threads: Threads,
    private readonly now: () => number = Date.now,
    private readonly sources: ShareSources = {},
    o: { publish?: Publish; rows?: PagedTable<ItemRow>; filePath?: (itemId: string) => string } = {},
  ) {
    this.rows = o.rows ?? spaceTable<ItemRow>("space_items");
    this.publish = o.publish ?? ((ids, topic, data) => live.publish(ids, topic, data));
    this.filePath = o.filePath ?? ((id) => `/v1/botsapp/bots/items/${id}/file`);
    spaces.onMembers(async (e) => { if (e.deleted) await this.rows.remove({ space_id: e.spaceId }); });
  }
  private readonly filePath: (itemId: string) => string;

  // ------------------------------------------------------------------ who may

  /** The row and what this person may do with it; 404 unless they may see it. */
  private async open(userId: string, itemId: string): Promise<{ r: ItemRow; canEdit: boolean; canRemove: boolean }> {
    const [r] = UUID.test(itemId) ? await this.rows.select({ id: itemId }, { limit: 1 }) : [];
    if (!r) throw gone();
    const editable = EDITABLE.includes(r.kind) && r.access === "edit";
    if (r.space_id) {
      const perms = await this.spaces.permsFor(userId, r.space_id);
      if (!perms) throw gone();
      const may = perms.includes("share");
      return { r, canEdit: editable && may, canRemove: r.shared_by === userId || may };
    }
    if (r.thread_id && (await this.threads.canRead(userId, r.thread_id))) return { r, canEdit: editable, canRemove: r.shared_by === userId };
    throw gone();
  }

  private view(userId: string, r: ItemRow, canEdit: boolean, canRemove: boolean): ItemView {
    const d = r.data ?? {};
    const list = d.list ?? [];
    const summary = r.kind === "list" || (r.kind === "trip" && list.length)
      ? `${list.filter((l) => l.done).length} of ${list.length} done`
      : r.kind === "file" && d.file ? d.file.name : r.kind === "link" ? (d.url ? new URL(d.url).host : "") : (d.text ?? "").replace(/\s+/g, " ").slice(0, 90);
    return {
      id: r.id, kind: r.kind, title: r.title, spaceId: r.space_id, threadId: r.thread_id, by: r.shared_by === userId ? "You" : r.shared_name, byYou: r.shared_by === userId,
      at: Number(r.created_ms), updatedAt: Number(r.updated_ms), access: r.access, canEdit, canRemove, summary,
      text: d.text ?? "", url: d.url ?? "", note: d.note ?? "", list, place: d.place ?? "", when: d.when ?? "", who: d.who ?? "", bot: d.bot ?? "",
      file: d.file ? { name: d.file.name, mime: d.file.mime, bytes: d.file.bytes, kind: d.file.kind, url: `${this.filePath(r.id)}?${signQuery(userId, [r.id, d.file.id], this.now())}` } : null,
    };
  }

  private async tell(r: ItemRow, also: string[] = []): Promise<void> {
    if (r.space_id) {
      const ids = [...(await this.spaces.memberIds(r.space_id)), ...also];
      this.publish(ids, `space:${r.space_id}`);
      this.publish(ids, `item:${r.id}`);
    } else if (r.thread_id) {
      const ids = [...(await this.threads.peopleOf(r.thread_id)), ...also];
      this.publish(ids, `item:${r.id}`);
    }
  }

  // ------------------------------------------------------------------ sharing

  async share(userId: string, me: string, b: Record<string, unknown>): Promise<{ item: ItemView; threadId: string | null }> {
    if (!isKind(b.kind)) throw new BotError("bad_request", "What kind of thing is it?");
    const kind = b.kind;
    const to = (b.to && typeof b.to === "object" ? b.to : {}) as { space?: unknown; person?: unknown };
    const space = typeof to.space === "string" ? to.space : "";
    const person = typeof to.person === "string" ? to.person : "";
    if (!space === !person) throw new BotError("bad_request", "Share it to a space or to a person.");
    const access: "view" | "edit" = b.access === "edit" && EDITABLE.includes(kind) ? "edit" : "view";
    const ref = clean(b.ref, 80);
    const data: ItemData = {};
    let title = clean(b.title, 120);
    // What the server can read itself, it reads: a file must be the sharer's own; a trip comes from their own trips.
    if (kind === "file") {
      const f = ref && this.sources.file ? await this.sources.file(userId, ref) : null;
      if (!f) throw new BotError("not_found", "That file isn't yours, or isn't there any more.", 404);
      data.file = { id: f.id, name: f.name.slice(0, 200), mime: f.mime.slice(0, 100), bytes: f.bytes, kind: f.kind, owner: userId };
      title = title || f.name.slice(0, 120);
    } else if (kind === "trip" && ref) {
      const t = this.sources.trip ? await this.sources.trip(userId, ref) : null;
      if (!t) throw new BotError("not_found", "That trip isn't yours, or isn't there any more.", 404);
      Object.assign(data, { place: t.place, when: t.when, who: t.who, ref, list: lines(t.packing) });
      title = title || `Trip to ${t.place}`;
    } else {
      const text = body(b.text, 6000);
      const url = safeUrl(b.url);
      if (text) data.text = text;
      if (url) data.url = url;
      if (kind === "list" || kind === "trip") data.list = lines(b.items);
      if (ref) data.ref = ref;
      if (kind === "link" && !url) throw new BotError("bad_request", "That link doesn't look right.");
      if (!text && !url && !(data.list ?? []).length && kind !== "list") throw new BotError("bad_request", "There's nothing to share.");
    }
    if (kind === "answer") data.bot = clean(b.bot, 40);
    const note = body(b.note, 600);
    if (note) data.note = note;
    if (!title) title = KIND_WORD[kind].charAt(0).toUpperCase() + KIND_WORD[kind].slice(1);

    const at = this.now();
    let threadId: string | null = null;
    if (space) {
      const a = await this.spaces.need(userId, space, "share");
      if ((await this.rows.select({ space_id: space }, { limit: ITEMS_MAX + 1 })).length >= ITEMS_MAX) throw new BotError("item_limit", `${a.s.name} has ${ITEMS_MAX} shared things. Take some out first.`, 409);
    } else {
      threadId = (await this.threads.direct(userId, me, person)).id;
    }
    const r: ItemRow = {
      id: randomUUID(), space_id: space || null, thread_id: threadId, kind, title, data, access, shared_by: userId, shared_name: clean(me, 40) || "Someone",
      created_ms: at, updated_ms: at, updated_by: userId,
    };
    await this.rows.insert(r);
    if (space) {
      await this.spaces.note(space, userId, "shared", `${r.shared_name} shared ${title}`);
      await this.spaces.changed(space);
    } else if (threadId) {
      await this.threads.post(userId, threadId, { text: note, files: [], item: { id: r.id, kind, title } });
    }
    return { item: this.view(userId, r, EDITABLE.includes(kind) && access === "edit", true), threadId };
  }

  /** A new, empty list made right in a space ("New list" in Shared). */
  async newList(userId: string, me: string, spaceId: string, title: unknown): Promise<ItemView> {
    const t = clean(title, 120);
    if (!t) throw new BotError("bad_request", "Name the list, like Groceries.");
    return (await this.share(userId, me, { kind: "list", title: t, items: [], access: "edit", to: { space: spaceId } })).item;
  }

  async list(userId: string, spaceId: string): Promise<ItemView[]> {
    const perms = await this.spaces.permsFor(userId, spaceId);
    if (!perms) throw new BotError("not_found", "That space isn't there any more.", 404);
    const rows = await this.rows.before({ space_id: spaceId }, "updated_ms", null, ITEMS_MAX);
    const may = perms.includes("share");
    return rows.map((r) => this.view(userId, r, may && r.access === "edit" && EDITABLE.includes(r.kind), r.shared_by === userId || may));
  }

  async get(userId: string, itemId: string): Promise<ItemView> {
    const { r, canEdit, canRemove } = await this.open(userId, itemId);
    return this.view(userId, r, canEdit, canRemove);
  }

  /** The file behind a shared file, for someone who may see it. */
  async fileOf(userId: string, itemId: string): Promise<FileRef | null> {
    const { r } = await this.open(userId, itemId);
    return r.data?.file ?? null;
  }

  /** add { text } · toggle { line } · drop { line } · rename { title } on a list someone may edit. */
  async edit(userId: string, itemId: string, b: Record<string, unknown>): Promise<ItemView> {
    const { r, canEdit, canRemove } = await this.open(userId, itemId);
    if (!canEdit) throw new BotError("not_allowed", r.access === "edit" ? "You can look at this, not change it." : "This was shared to look at, not to change.", 403);
    const list = [...(r.data?.list ?? [])];
    let title = r.title;
    const line = typeof b.line === "string" ? b.line : "";
    switch (b.op) {
      case "add": {
        const t = clean(b.text, 200);
        if (!t) throw new BotError("bad_request", "Type what to add.");
        if (list.length >= LIST_MAX) throw new BotError("list_full", `A list can have ${LIST_MAX} things.`, 409);
        list.push({ id: randomUUID().slice(0, 8), text: t, done: false });
        break;
      }
      case "toggle": case "drop": {
        const i = list.findIndex((l) => l.id === line);
        if (i < 0) throw new BotError("not_found", "That isn't on the list any more.", 404);
        if (b.op === "toggle") list[i] = { ...list[i]!, done: !list[i]!.done }; else list.splice(i, 1);
        break;
      }
      case "clearDone": {
        const left = list.filter((l) => !l.done);
        list.length = 0;
        list.push(...left);
        break;
      }
      case "rename": {
        title = clean(b.title, 120);
        if (!title) throw new BotError("bad_request", "Give it a name.");
        break;
      }
      default: throw new BotError("bad_request", "add, toggle, drop, clearDone or rename.");
    }
    const at = this.now();
    await this.rows.update({ id: r.id }, { data: { ...r.data, list }, title, updated_ms: at, updated_by: userId });
    const next = { ...r, data: { ...r.data, list }, title, updated_ms: at };
    await this.tell(next);
    return this.view(userId, next, canEdit, canRemove);
  }

  async remove(userId: string, itemId: string): Promise<void> {
    const { r, canRemove } = await this.open(userId, itemId);
    if (!canRemove) throw new BotError("not_allowed", "Only who shared it, or someone who may change shared things, can take it out.", 403);
    await this.rows.remove({ id: r.id });
    if (r.space_id) {
      const name = (await this.spaces.membersOf(r.space_id)).find((m) => m.userId === userId)?.name ?? "Someone";
      await this.spaces.note(r.space_id, userId, "unshared", `${name} took out ${r.title}`);
    }
    await this.tell(r);
  }

  /**
   * What a bot may read when this person uses it: the shared things of each space they're in where the bot is shared and they may use
   * the shared bots. Data, never instructions (the bot's prompt wraps it as such).
   */
  async forBot(userId: string, slug: string): Promise<Array<{ name: string; kind: string; text: string }>> {
    const out: Array<{ name: string; kind: string; text: string }> = [];
    for (const s of (await this.spaces.spacesWithBot(userId, slug)).slice(0, 3)) {
      const rows = await this.rows.before({ space_id: s.id }, "updated_ms", null, 25);
      if (!rows.length) continue;
      const lines = rows.map((r) => {
        const d = r.data ?? {};
        const what = [
          d.place ? `${d.place}${d.when ? `, ${d.when}` : ""}${d.who ? `, with ${d.who}` : ""}` : "",
          d.list?.length ? d.list.map((l) => `${l.done ? "[x]" : "[ ]"} ${l.text}`).join("; ") : "",
          d.text ? d.text.replace(/\s+/g, " ").slice(0, 500) : "", d.url ?? "", d.file ? `file ${d.file.name}` : "",
        ].filter(Boolean).join(" · ");
        return `- ${r.title} (${KIND_WORD[r.kind]}, shared by ${r.shared_name})${what ? `: ${what}` : ""}`;
      });
      out.push({ name: `Shared in ${s.name}`, kind: "space", text: lines.join("\n").slice(0, 6000) });
    }
    return out;
  }
}
