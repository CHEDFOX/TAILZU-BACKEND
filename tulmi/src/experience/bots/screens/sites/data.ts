/**
 * A PORTRAIT OF A SITE'S ORDERS — THE RENDERER'S HALF: the loads, the paths, and what came back held to the shape the
 * screens draw (src/sites/history, docs/site-portrait.md). With sites off nothing is read and nothing is drawn.
 *
 * Everything in a portrait was written by a site (the places, the dishes) or counted from that, so it is cleaned here as
 * any payload is: capped, typed, and anything the wrong shape dropped.
 */
import { SLOTS, type OrderItem, type SitePortrait, type Slot } from "../../../../sites/history/types.js";
import type { BotsDeps } from "../../live.js";
import { SITES_API, sitesOn } from "../../sites.js";

export const PORTRAITS_PATH = `${SITES_API}/portraits`;
export const portraitPath = (site: string): string => `${SITES_API}/portrait/${encodeURIComponent(site)}`;
export const historyReadPath = (site: string): string => `${SITES_API}/history/${encodeURIComponent(site)}/read`;
export const forgetHistoryPath = (site: string): string => `${SITES_API}/history/${encodeURIComponent(site)}`;

/** An orders page this phone should read now, by an unseen SiteView. */
export interface Reader { site: string; url: string }

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const local = (v: unknown): string | undefined => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str(v, 16)) ? str(v, 16) : undefined);
const https = (v: unknown): string | undefined => (/^https:\/\//.test(str(v, 600)) ? str(v, 600) : undefined);
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? v as Record<string, unknown> : {});

function itemsOf(v: unknown): OrderItem[] {
  return arr(v, 12).flatMap((x) => {
    const i = rec(x);
    const name = str(i.name, 80);
    return name ? [{ name, qty: Math.max(1, Math.min(20, Math.round(num(i.qty) ?? 1))) }] : [];
  });
}

const slotOf = (v: unknown): Slot | undefined => (SLOTS as readonly string[]).includes(String(v)) ? v as Slot : undefined;

/** A portrait as the screens draw it, or undefined when what came back is not one. */
export function cleanPortrait(raw: unknown): SitePortrait | undefined {
  const r = rec(raw);
  const site = str(r.site, 120).toLowerCase();
  if (!site) return undefined;
  const last = rec(r.last);
  const usual = rec(r.usual);
  const spend = rec(r.spend);
  const lastItems = itemsOf(last.items), usualItems = itemsOf(usual.items);
  const recent = arr(r.recent, 5).flatMap((x) => {
    const o = rec(x);
    const place = str(o.place, 80), items = itemsOf(o.items);
    if (!place || !items.length) return [];
    return [{
      key: str(o.key, 80), site, place, items, seenAt: num(o.seenAt) ?? 0,
      ...(num(o.total) ? { total: num(o.total) } : {}), ...(local(o.local) ? { local: local(o.local) } : {}),
    }];
  });
  return {
    site, name: str(r.name, 60) || site, orders: Math.round(num(r.orders) ?? 0),
    places: arr(r.places, 8).flatMap((x) => {
      const p = rec(x);
      const place = str(p.place, 80);
      if (!place) return [];
      return [{
        place, count: Math.round(num(p.count) ?? 0), share: Math.min(1, num(p.share) ?? 0),
        dishes: arr(p.dishes, 6).flatMap((d) => { const o = rec(d); const name = str(o.name, 80); return name ? [{ name, count: Math.round(num(o.count) ?? 0) }] : []; }),
        ...(str(p.area, 60) ? { area: str(p.area, 60) } : {}), ...(https(p.link) ? { link: https(p.link) } : {}),
        ...(local(p.lastLocal) ? { lastLocal: local(p.lastLocal) } : {}), ...(num(p.usualTotal) ? { usualTotal: num(p.usualTotal) } : {}),
      }];
    }),
    dishes: arr(r.dishes, 12).flatMap((x) => {
      const d = rec(x);
      const name = str(d.name, 80);
      return name ? [{ name, place: str(d.place, 80), count: Math.round(num(d.count) ?? 0) }] : [];
    }),
    slots: SLOTS.map((s) => ({ slot: s, count: Math.round(num(rec(arr(r.slots, 5).find((x) => rec(x).slot === s)).count) ?? 0) })),
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, count: Math.round(num(rec(arr(r.days, 7).find((x) => rec(x).day === d)).count) ?? 0) })),
    spend: {
      ...(num(spend.median) ? { median: num(spend.median) } : {}),
      ...(num(spend.month) ? { month: num(spend.month) } : {}),
      ...(num(spend.total) ? { total: num(spend.total) } : {}),
    },
    noticed: arr(r.noticed, 5).map((x) => str(x, 160)).filter(Boolean),
    recent,
    ...(local(r.since) ? { since: local(r.since) } : {}),
    ...(num(r.readAt) ? { readAt: num(r.readAt) } : {}),
    ...(str(last.place, 80) && lastItems.length ? {
      last: {
        key: str(last.key, 80), site, place: str(last.place, 80), items: lastItems, seenAt: num(last.seenAt) ?? 0,
        ...(num(last.total) ? { total: num(last.total) } : {}), ...(local(last.local) ? { local: local(last.local) } : {}),
        ...(https(last.link) ? { link: https(last.link) } : {}),
      },
    } : {}),
    ...(str(usual.place, 80) && usualItems.length ? {
      usual: {
        place: str(usual.place, 80), items: usualItems, count: Math.round(num(usual.count) ?? 0),
        ...(slotOf(usual.slot) ? { slot: slotOf(usual.slot) } : {}),
        ...(num(usual.day) !== undefined && num(usual.day)! <= 6 ? { day: Math.round(num(usual.day)!) } : {}),
        ...(num(usual.total) ? { total: num(usual.total) } : {}), ...(https(usual.link) ? { link: https(usual.link) } : {}),
      },
    } : {}),
  };
}

function readersOf(v: unknown): Reader[] {
  return arr(v, 4).flatMap((x) => {
    const r = rec(x);
    const site = str(r.site, 120).toLowerCase(), url = https(r.url);
    return site && url ? [{ site, url }] : [];
  });
}

export interface PortraitsView { portraits: SitePortrait[]; readers: Reader[] }
export interface PortraitView { portrait?: SitePortrait; reader?: Reader }

export async function loadPortraits(deps: Pick<BotsDeps, "api">, userId?: string | null): Promise<PortraitsView | undefined> {
  if (!sitesOn(userId)) return undefined;
  return deps.api<unknown>("GET", PORTRAITS_PATH).then((raw) => {
    const r = rec(raw);
    return {
      portraits: arr(r.portraits, 8).map(cleanPortrait).filter((p): p is SitePortrait => !!p && p.orders > 0),
      readers: readersOf(r.readers),
    };
  }).catch(() => undefined);
}

export async function loadPortrait(deps: Pick<BotsDeps, "api">, userId: string | null | undefined, site: string): Promise<PortraitView | undefined> {
  if (!sitesOn(userId) || !site) return undefined;
  return deps.api<unknown>("GET", portraitPath(site)).then((raw) => {
    const r = rec(raw);
    const portrait = cleanPortrait(r.portrait);
    const reader = readersOf([r.reader])[0];
    return { ...(portrait ? { portrait } : {}), ...(reader ? { reader } : {}) };
  }).catch(() => undefined);
}
