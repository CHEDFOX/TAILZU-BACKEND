/**
 * THE TRAVEL BOT'S TRIP: where and when, who is going, and the packing list, kept per person; the rest of the trip view is what the
 * Travel bot already has (its memory, the booking links it opened in chat, the person's ticket files, its waiting tasks).
 *
 *   current(user)                 the latest trip, or null
 *   create(user, { place, when, who })
 *   change(user, id, patch)       place, when, who
 *   pack(user, id, text)          a line on the packing list;  toggle(user, id, i);  unpack(user, id, i)
 *   starter(user, id)             a first packing list for the trip, when it has none
 *   remove(user, id)              the trip is over
 *
 * Booking is never done here: the trip shows the links the bot opened, and the person books and pays in that app.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { table, type Table } from "./rows.js";

export interface TripRow {
  [k: string]: unknown;
  id: string;
  user_id: string;
  place: string;
  when_text: string;
  who: string;
  packing: Array<{ text: string; done: boolean }>;
  created_ms: number;
  updated_ms: number;
}

export interface Trip { id: string; place: string; when: string; who: string; packing: Array<{ text: string; done: boolean }>; createdAt: number }

export const PACKING_MAX = 30;
export const STARTER_LIST = ["Clothes for each day", "Phone charger", "ID for check-in (Aadhaar)", "Toothbrush kit", "Medicines you take", "Snacks for the way"];

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const tripOf = (r: TripRow): Trip => ({ id: r.id, place: r.place, when: r.when_text, who: r.who, packing: r.packing ?? [], createdAt: Number(r.created_ms) || 0 });

export class Trips {
  constructor(private readonly now: () => number = Date.now, private readonly rows: Table<TripRow> = table<TripRow>("trips")) {}

  async current(userId: string): Promise<Trip | null> {
    const [r] = await this.rows.select({ user_id: userId }, { order: "created_ms", desc: true, limit: 1 });
    return r ? tripOf(r) : null;
  }

  private async mine(userId: string, id: string): Promise<TripRow> {
    const [r] = await this.rows.select({ id, user_id: userId }, { limit: 1 });
    if (!r) throw new BotError("not_found", "That trip isn't there any more.", 404);
    return r;
  }

  async create(userId: string, b: { place?: unknown; when?: unknown; who?: unknown }): Promise<Trip> {
    const place = clean(b.place, 60);
    if (!place) throw new BotError("bad_request", "Where are you going?");
    const at = this.now();
    const row: TripRow = { id: randomUUID(), user_id: userId, place, when_text: clean(b.when, 40), who: clean(b.who, 60), packing: [], created_ms: at, updated_ms: at };
    await this.rows.insert(row);
    return tripOf(row);
  }

  async change(userId: string, id: string, b: { place?: unknown; when?: unknown; who?: unknown }): Promise<Trip> {
    const r = await this.mine(userId, id);
    if (b.place !== undefined) { const p = clean(b.place, 60); if (!p) throw new BotError("bad_request", "Where are you going?"); r.place = p; }
    if (b.when !== undefined) r.when_text = clean(b.when, 40);
    if (b.who !== undefined) r.who = clean(b.who, 60);
    r.updated_ms = this.now();
    await this.rows.update({ id, user_id: userId }, { place: r.place, when_text: r.when_text, who: r.who, updated_ms: r.updated_ms });
    return tripOf(r);
  }

  private async savePacking(userId: string, r: TripRow): Promise<Trip> {
    r.updated_ms = this.now();
    await this.rows.update({ id: r.id, user_id: userId }, { packing: r.packing, updated_ms: r.updated_ms });
    return tripOf(r);
  }

  async pack(userId: string, id: string, text: unknown): Promise<Trip> {
    const r = await this.mine(userId, id);
    const t = clean(text, 60);
    if (!t) throw new BotError("bad_request", "Write what to pack first.");
    if ((r.packing ?? []).length >= PACKING_MAX) throw new BotError("packing_limit", `A list can have ${PACKING_MAX} things.`, 409);
    if (!(r.packing ?? []).some((p) => p.text.toLowerCase() === t.toLowerCase())) r.packing = [...(r.packing ?? []), { text: t, done: false }];
    return this.savePacking(userId, r);
  }

  async toggle(userId: string, id: string, index: number): Promise<Trip> {
    const r = await this.mine(userId, id);
    const item = (r.packing ?? [])[index];
    if (!item) throw new BotError("not_found", "That isn't on the list any more.", 404);
    item.done = !item.done;
    return this.savePacking(userId, r);
  }

  async unpack(userId: string, id: string, index: number): Promise<Trip> {
    const r = await this.mine(userId, id);
    if (!(r.packing ?? [])[index]) throw new BotError("not_found", "That isn't on the list any more.", 404);
    r.packing.splice(index, 1);
    return this.savePacking(userId, r);
  }

  async starter(userId: string, id: string): Promise<Trip> {
    const r = await this.mine(userId, id);
    const have = new Set((r.packing ?? []).map((p) => p.text.toLowerCase()));
    r.packing = [...(r.packing ?? []), ...STARTER_LIST.filter((t) => !have.has(t.toLowerCase())).map((text) => ({ text, done: false }))].slice(0, PACKING_MAX);
    return this.savePacking(userId, r);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.rows.remove({ id, user_id: userId }))) throw new BotError("not_found", "That trip isn't there any more.", 404);
  }
}
