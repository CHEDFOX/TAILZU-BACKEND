/**
 * WHAT IS KEPT OF A SITE'S ORDERS (migration 0114, docs/site-portrait.md): the orders, and when the page was last read.
 *
 * Supabase with the service key when the server has one, else memory (a restart forgets it, as the other stores here).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import type { OrderItem, SiteOrder } from "./types.js";

/** The most orders kept per site: two years of a weekly habit, and a portrait never needs more. */
export const ORDERS_KEPT = 120;

export interface HistoryMark { readAt?: number; hash?: string }

const ms = (s: unknown): number | undefined => (typeof s === "string" && s ? new Date(s).getTime() : undefined);

export class HistoryStore {
  private readonly orders = new Map<string, SiteOrder[]>();
  private readonly marks = new Map<string, HistoryMark>();

  constructor(private readonly db: SupabaseClient | null = supabase()) {}

  private key = (ownerId: string, site: string) => `${ownerId}\u0000${site}`;

  /** Their orders on a site, newest first. */
  async ordersOf(ownerId: string, site: string): Promise<SiteOrder[]> {
    if (!this.db) return [...(this.orders.get(this.key(ownerId, site)) ?? [])];
    const { data } = await this.db.from("site_orders").select("*").eq("owner_id", ownerId).eq("site", site)
      .order("local", { ascending: false, nullsFirst: false }).limit(ORDERS_KEPT);
    return (data ?? []).map((r) => rowToOrder(r as Record<string, unknown>));
  }

  /** Every site they have a history on. */
  async sitesOf(ownerId: string): Promise<string[]> {
    if (!this.db) {
      return [...this.orders.keys()].filter((k) => k.startsWith(`${ownerId}\u0000`) && (this.orders.get(k)?.length ?? 0) > 0)
        .map((k) => k.slice(ownerId.length + 1));
    }
    const { data } = await this.db.from("site_history").select("site").eq("owner_id", ownerId);
    return (data ?? []).map((r) => String((r as { site: unknown }).site));
  }

  /** Keep the history as it now stands: what the read added, the rest as it was. */
  async saveOrders(ownerId: string, site: string, all: readonly SiteOrder[]): Promise<void> {
    const kept = all.slice(0, ORDERS_KEPT);
    if (!this.db) { this.orders.set(this.key(ownerId, site), [...kept]); return; }
    if (!kept.length) return;
    await this.db.from("site_orders").upsert(kept.map((o) => ({
      owner_id: ownerId, site, key: o.key, place: o.place, area: o.area ?? null, items: o.items, total: o.total ?? null,
      local: o.local ?? null, link: o.link ?? null, cancelled: o.cancelled === true, seen_at: new Date(o.seenAt).toISOString(),
    })), { onConflict: "owner_id,site,key" });
  }

  async mark(ownerId: string, site: string): Promise<HistoryMark> {
    if (!this.db) return { ...(this.marks.get(this.key(ownerId, site)) ?? {}) };
    const { data } = await this.db.from("site_history").select("read_at, hash").eq("owner_id", ownerId).eq("site", site).maybeSingle();
    const readAt = ms(data?.read_at);
    return { ...(readAt ? { readAt } : {}), ...(data?.hash ? { hash: String(data.hash) } : {}) };
  }

  async setMark(ownerId: string, site: string, m: HistoryMark): Promise<void> {
    if (!this.db) { this.marks.set(this.key(ownerId, site), { ...m }); return; }
    await this.db.from("site_history").upsert({
      owner_id: ownerId, site, read_at: m.readAt ? new Date(m.readAt).toISOString() : null, hash: m.hash ?? null,
    }, { onConflict: "owner_id,site" });
  }

  /** Forget everything learned from a site: its orders and when it was read. */
  async forget(ownerId: string, site: string): Promise<void> {
    if (!this.db) { this.orders.delete(this.key(ownerId, site)); this.marks.delete(this.key(ownerId, site)); return; }
    await this.db.from("site_orders").delete().eq("owner_id", ownerId).eq("site", site);
    await this.db.from("site_history").delete().eq("owner_id", ownerId).eq("site", site);
  }
}

function itemsOf(v: unknown): OrderItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.slice(0, 80) : "";
    const qty = typeof o.qty === "number" && o.qty > 0 ? Math.min(20, Math.round(o.qty)) : 1;
    return name ? [{ name, qty }] : [];
  }).slice(0, 12);
}

function rowToOrder(r: Record<string, unknown>): SiteOrder {
  const total = r.total === null || r.total === undefined ? undefined : Number(r.total);
  return {
    key: String(r.key), site: String(r.site), place: String(r.place ?? ""), items: itemsOf(r.items),
    seenAt: ms(r.seen_at) ?? 0,
    ...(r.area ? { area: String(r.area) } : {}),
    ...(total && Number.isFinite(total) ? { total } : {}),
    ...(r.local ? { local: String(r.local) } : {}),
    ...(r.link ? { link: String(r.link) } : {}),
    ...(r.cancelled === true ? { cancelled: true as const } : {}),
  };
}

let shared: HistoryStore | null = null;
export const historyStore = (): HistoryStore => (shared ??= new HistoryStore());
