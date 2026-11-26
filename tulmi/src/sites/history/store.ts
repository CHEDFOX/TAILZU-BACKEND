/**
 * WHAT IS KEPT OF A SITE'S ORDERS (migration 0114, docs/site-portrait.md): the orders, and when the page was last read.
 *
 * Supabase with the service key when the server has one, else memory (a restart forgets it, as the other stores here).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import type { OrderItem, SiteOrder } from "./types.js";
import type { Taste } from "./taste/profile.js";
import type { Discovery } from "./taste/discover.js";

/** The most orders kept per site: two years of a weekly habit, and a portrait never needs more. */
export const ORDERS_KEPT = 120;

export interface HistoryMark { readAt?: number; hash?: string }

/** Something X0 did for them on a site: a cart it filled, new places it found. */
export interface Did { ref: string; kind: "cart" | "found"; title: string; line?: string; at: number }

/** What was worked out from the orders (taste/profile.ts) and found for it on the web (taste/discover.ts). */
export interface Insight { taste?: Taste; picks?: Discovery[]; picksAt?: number }

const ms = (s: unknown): number | undefined => (typeof s === "string" && s ? new Date(s).getTime() : undefined);

export class HistoryStore {
  private readonly orders = new Map<string, SiteOrder[]>();
  private readonly marks = new Map<string, HistoryMark>();
  private readonly insights = new Map<string, Insight>();
  private readonly dids = new Map<string, Did[]>();

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

  async insight(ownerId: string, site: string): Promise<Insight> {
    if (!this.db) return { ...(this.insights.get(this.key(ownerId, site)) ?? {}) };
    const { data } = await this.db.from("site_history").select("taste, picks, picks_at").eq("owner_id", ownerId).eq("site", site).maybeSingle();
    const picksAt = ms(data?.picks_at);
    return {
      ...(data?.taste ? { taste: data.taste as Taste } : {}),
      ...(Array.isArray(data?.picks) ? { picks: data.picks as Discovery[] } : {}),
      ...(picksAt ? { picksAt } : {}),
    };
  }

  /** Keep what was worked out. Only the fields given change. */
  async saveInsight(ownerId: string, site: string, i: Insight): Promise<void> {
    if (!this.db) { this.insights.set(this.key(ownerId, site), { ...(this.insights.get(this.key(ownerId, site)) ?? {}), ...i }); return; }
    await this.db.from("site_history").upsert({
      owner_id: ownerId, site,
      ...(i.taste ? { taste: i.taste } : {}),
      ...(i.picks ? { picks: i.picks, picks_at: new Date(i.picksAt ?? Date.now()).toISOString() } : {}),
    }, { onConflict: "owner_id,site" });
  }

  /** Note something done. The same `ref` twice is one thing: the second report changes nothing. */
  async addDid(ownerId: string, site: string, d: Did): Promise<void> {
    if (!this.db) {
      const k = this.key(ownerId, site);
      const had = this.dids.get(k) ?? [];
      if (!had.some((x) => x.ref === d.ref)) this.dids.set(k, [d, ...had].slice(0, 50));
      return;
    }
    await this.db.from("site_did").upsert({
      owner_id: ownerId, site, ref: d.ref, kind: d.kind, title: d.title, line: d.line ?? null, at: new Date(d.at).toISOString(),
    }, { onConflict: "owner_id,site,ref", ignoreDuplicates: true });
  }

  /** What was done, newest first. */
  async didOf(ownerId: string, site: string, limit = 8): Promise<Did[]> {
    if (!this.db) return (this.dids.get(this.key(ownerId, site)) ?? []).slice(0, limit);
    const { data } = await this.db.from("site_did").select("ref, kind, title, line, at").eq("owner_id", ownerId).eq("site", site)
      .order("at", { ascending: false }).limit(limit);
    return (data ?? []).map((r) => ({
      ref: String(r.ref), kind: r.kind === "found" ? "found" as const : "cart" as const, title: String(r.title),
      ...(r.line ? { line: String(r.line) } : {}), at: ms(r.at) ?? 0,
    }));
  }

  /** Forget everything learned from a site: its orders, when it was read, and what was worked out from them. */
  async forget(ownerId: string, site: string): Promise<void> {
    if (!this.db) {
      const k = this.key(ownerId, site);
      this.orders.delete(k); this.marks.delete(k); this.insights.delete(k); this.dids.delete(k);
      return;
    }
    await this.db.from("site_did").delete().eq("owner_id", ownerId).eq("site", site);
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
