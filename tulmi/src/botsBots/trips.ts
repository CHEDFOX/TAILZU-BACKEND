/**
 * THE TRAVEL BOT'S TRIP: where and when, who is going, and the packing list, kept per person; the rest of the trip view is what the
 * Travel bot already has (its memory, the booking links it opened in chat, the person's ticket files, its waiting tasks).
 *
 *   current(user)                 the latest trip, or null
 *   create(user, { place, when, who })
 *   change(user, id, patch)       place, when, who
 *   pack(user, id, text)          a line on the packing list;  toggle(user, id, i);  unpack(user, id, i)
 *   starter(user, id)             a first packing list for the trip, when it has none
 *   addSpot(user, id, text);  dropSpot(user, id, i)          the trip's main places ("Sakshi's wedding, Koregaon Park"): the first
 *                                 is what stays are measured against
 *   addStay(user, id, input, by);  addStays(user, id, found);  dropStay(user, id, stayId);  pickStay(user, id, stayId)
 *                                 places to stay, compared on the trip (stays.ts, tripExtras.ts); a pick is the person's, a toggle
 *   remove(user, id)              the trip is over
 *
 * Booking is never done here: the trip shows the links the bot opened, and the person books and pays in that app.
 * Changes come over HTTP, which live/writes.ts publishes ("bot:travel"); the stay search in the background publishes from tripExtras.ts.
 * The spots and stays columns are migration 0052's; a trip is created without them (their defaults), so creating one works before it.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { table, type Table } from "./rows.js";
import { linkOf, paiseOf, ratingOf, stayFromLabel, type StayFound, type StayRow } from "./stays.js";

export interface TripRow {
  [k: string]: unknown;
  id: string;
  user_id: string;
  place: string;
  when_text: string;
  who: string;
  packing: Array<{ text: string; done: boolean }>;
  /** Migration 0052: the trip's main places, and its stays. */
  spots?: Array<{ text: string }>;
  stays?: StayRow[];
  created_ms: number;
  updated_ms: number;
}

export interface Trip {
  id: string; place: string; when: string; who: string; packing: Array<{ text: string; done: boolean }>; createdAt: number;
  spots: string[]; stays: StayRow[];
}

export const PACKING_MAX = 30;
export const SPOTS_MAX = 6;
export const STAYS_MAX = 8;
export const STARTER_LIST = ["Clothes for each day", "Phone charger", "ID for check-in (Aadhaar)", "Toothbrush kit", "Medicines you take", "Snacks for the way"];

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const tripOf = (r: TripRow): Trip => ({
  id: r.id, place: r.place, when: r.when_text, who: r.who, packing: r.packing ?? [], createdAt: Number(r.created_ms) || 0,
  spots: (r.spots ?? []).map((s) => s.text), stays: r.stays ?? [],
});

export class Trips {
  constructor(
    private readonly now: () => number = Date.now,
    private readonly rows: Table<TripRow> = table<TripRow>("trips"),
  ) {}

  async current(userId: string): Promise<Trip | null> {
    const [r] = await this.rows.select({ user_id: userId }, { order: "created_ms", desc: true, limit: 1 });
    return r ? tripOf(r) : null;
  }

  /** One of the person's trips (another's is not found). */
  async get(userId: string, id: string): Promise<Trip> { return tripOf(await this.mine(userId, id)); }

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

  private async save(userId: string, r: TripRow, patch: Partial<TripRow>): Promise<Trip> {
    r.updated_ms = this.now();
    await this.rows.update({ id: r.id, user_id: userId }, { ...patch, updated_ms: r.updated_ms });
    return tripOf(r);
  }

  private savePacking(userId: string, r: TripRow): Promise<Trip> { return this.save(userId, r, { packing: r.packing }); }

  // ------------------------------------------------------------------ the main places

  async addSpot(userId: string, id: string, text: unknown): Promise<Trip> {
    const r = await this.mine(userId, id);
    const t = clean(text, 80);
    if (!t) throw new BotError("bad_request", "Write the place first.");
    const spots = r.spots ?? [];
    if (spots.length >= SPOTS_MAX) throw new BotError("spots_limit", `A trip can have ${SPOTS_MAX} places.`, 409);
    if (!spots.some((s) => s.text.toLowerCase() === t.toLowerCase())) r.spots = [...spots, { text: t }];
    return this.save(userId, r, { spots: r.spots ?? [] });
  }

  async dropSpot(userId: string, id: string, index: number): Promise<Trip> {
    const r = await this.mine(userId, id);
    if (!(r.spots ?? [])[index]) throw new BotError("not_found", "That place isn't on the trip any more.", 404);
    r.spots = (r.spots ?? []).filter((_, i) => i !== index);
    return this.save(userId, r, { spots: r.spots });
  }

  // ------------------------------------------------------------------ stays

  /** One stay from what the person typed (or a link the bot opened): a name or a link at least. */
  stayOf(b: { name?: unknown; url?: unknown; area?: unknown; price?: unknown; rating?: unknown; label?: unknown }, by: StayRow["by"]): StayRow {
    const link = b.url !== undefined && b.url !== "" ? linkOf(b.url) : null;
    if (b.url !== undefined && b.url !== "" && !link) throw new BotError("bad_request", "That link doesn't look right.");
    const fromLabel = typeof b.label === "string" ? stayFromLabel(b.label) : null;
    let name = clean(b.name, 80) || fromLabel?.name || "";
    if (!name && link) {
      const last = new URL(link.url).pathname.split("/").filter(Boolean).pop() ?? "";
      let words = last;
      try { words = decodeURIComponent(last); } catch { /* as it is */ }
      name = words.replace(/\.html?$/, "").replace(/[-_+]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim().slice(0, 80) || link.host;
    }
    if (!name) throw new BotError("bad_request", "Write the stay's name or paste its link.");
    const rate = b.rating !== undefined && b.rating !== "" ? ratingOf(b.rating) : null;
    const reviews = typeof b.rating === "string" ? Number(b.rating.match(/([\d,]+)\s*review/i)?.[1]?.replace(/,/g, "")) : NaN;
    return {
      id: randomUUID().slice(0, 8), name, area: clean(b.area, 60) || fromLabel?.area || "", url: link?.url ?? "", host: link?.host ?? "",
      nightPaise: paiseOf(b.price) ?? fromLabel?.nightPaise ?? null, rating: rate?.rating ?? null, ratingOf: rate?.of ?? null,
      reviews: Number.isFinite(reviews) && reviews > 0 ? reviews : null, by, picked: false, at: this.now(),
    };
  }

  private addTo(r: TripRow, add: StayRow[]): number {
    const stays = r.stays ?? [];
    const key = (s: StayRow) => [s.url && s.url.replace(/[?#].*$/, ""), s.name.toLowerCase()];
    let n = 0;
    for (const s of add) {
      if (stays.length >= STAYS_MAX) break;
      const [u, nm] = key(s);
      if (stays.some((x) => { const [xu, xn] = key(x); return (u && xu === u) || xn === nm; })) continue;
      stays.push(s);
      n += 1;
    }
    r.stays = stays;
    return n;
  }

  async addStay(userId: string, id: string, b: Record<string, unknown>, by: "you" | "chat" = "you"): Promise<Trip> {
    const r = await this.mine(userId, id);
    if ((r.stays ?? []).length >= STAYS_MAX) throw new BotError("stays_limit", `A trip can compare ${STAYS_MAX} stays.`, 409);
    this.addTo(r, [this.stayOf(b, by)]);
    return this.save(userId, r, { stays: r.stays ?? [] });
  }

  /** What a search found; those already on the trip are left out. How many were added. */
  async addStays(userId: string, id: string, found: StayFound[]): Promise<{ trip: Trip; added: number }> {
    const r = await this.mine(userId, id);
    const added = this.addTo(r, found.map((f) => ({ ...this.stayOf({ name: f.name, url: f.url, area: f.area }, "web"), nightPaise: f.nightPaise, rating: f.rating, ratingOf: f.ratingOf, reviews: f.reviews })));
    return { trip: added ? await this.save(userId, r, { stays: r.stays ?? [] }) : tripOf(r), added };
  }

  async dropStay(userId: string, id: string, stayId: string): Promise<Trip> {
    const r = await this.mine(userId, id);
    if (!(r.stays ?? []).some((s) => s.id === stayId)) throw new BotError("not_found", "That stay isn't on the trip any more.", 404);
    r.stays = (r.stays ?? []).filter((s) => s.id !== stayId);
    return this.save(userId, r, { stays: r.stays });
  }

  /** The person's pick, or not any more (a second tap). One pick at a time. */
  async pickStay(userId: string, id: string, stayId: string): Promise<Trip> {
    const r = await this.mine(userId, id);
    const s = (r.stays ?? []).find((x) => x.id === stayId);
    if (!s) throw new BotError("not_found", "That stay isn't on the trip any more.", 404);
    const on = !s.picked;
    r.stays = (r.stays ?? []).map((x) => ({ ...x, picked: x.id === stayId ? on : false }));
    return this.save(userId, r, { stays: r.stays });
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
