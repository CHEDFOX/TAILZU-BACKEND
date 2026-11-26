/**
 * AN ORDERS PAGE, READ INTO ORDERS (docs/site-portrait.md).
 *
 *   splitLinks(text)        the restaurant links the phone's history read put at the top of the page's words, and the words
 *   readOrders(...)         a small model turns the page into orders; never throws, null when nothing usable came back
 *   ordersOf(reply, ...)    what the model said, held to what an order is: capped, cleaned, keyed
 *   mergeOrders(had, new)   the history, with what this read added; an order already kept keeps when it was first seen
 *
 * THE PAGE IS DATA, as every page is here (src/sites/read.ts): fenced before the model sees it, and the model is told to
 * copy what the page shows and nothing else. The worst a strange page can do is put a wrong order in somebody's history,
 * which they can see on their portrait and forget.
 *
 * WHY A MODEL AND NOT A PARSER. A parser per site is a parser per site's redesign. The model reads Swiggy's orders page
 * the way a person does, and the numbers it gives are checked here: a total is a number, a time is a time, a dish has a
 * name. What it cannot be trusted with — the links — it is never shown: those are matched here, by name, in code.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { askJson } from "../../code/work/model.js";
import { fenced } from "../../agent/prompt.js";
import { catalogFor } from "../catalog.js";
import type { OrderItem, SiteOrder } from "./types.js";

/** Where the phone's history read puts the restaurant links it found, above the page's words (src/sites/history/phone.ts). */
export const LINKS_START = "[x0-links]";
export const LINKS_END = "[/x0-links]";

/** What one read may cost: a tiny model on a long page. The ceiling, not a budget anybody thinks about. */
export const SITE_ORDERS_PAISE = 60;

const PAGE_CHARS = 14_000;
const ORDERS_MAX = 40, ITEMS_MAX = 12, PLACE_MAX = 80, AREA_MAX = 60, DISH_MAX = 80, LINKS_MAX = 40;

export const OrdersReply = z.object({
  orders: z.array(z.object({
    no: z.string().optional(),
    place: z.string(),
    area: z.string().optional(),
    items: z.array(z.object({ name: z.string(), qty: z.number().optional() })),
    total: z.union([z.number(), z.string()]).optional(),
    at: z.string().optional(),
    cancelled: z.boolean().optional(),
  })),
}).strict();

export interface PageLink { label: string; url: string }

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").replace(/\s+/g, " ").trim();
const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");

/** The links block the phone's read wrote, taken off the words: the model is never shown an address. */
export function splitLinks(text: string): { text: string; links: PageLink[] } {
  const a = text.indexOf(LINKS_START), b = text.indexOf(LINKS_END);
  if (a < 0 || b < a) return { text, links: [] };
  const block = text.slice(a + LINKS_START.length, b);
  const links: PageLink[] = [];
  for (const line of block.split("\n")) {
    const [label, url] = line.split("\t");
    const l = clip(label, 120), u = clip(url, 600);
    if (l && /^https:\/\//.test(u)) links.push({ label: l, url: u });
    if (links.length >= LINKS_MAX) break;
  }
  return { text: (text.slice(0, a) + text.slice(b + LINKS_END.length)).trim(), links };
}

/** "₹ 1,234.50", "Rs. 456", 456 → 1234.5, 456. Anything that is not a sensible amount is no amount. */
export function rupees(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n * 100) / 100 : undefined;
}

/** "2026-11-21T20:40" (seconds allowed and dropped), or nothing: a time that is not a real time is not kept. */
export function localTime(v: unknown): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(typeof v === "string" ? v.trim() : "");
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (y < 2010 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return undefined;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (t.getUTCDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

/** The same order on two reads gets the same key: the site's number if it showed one, else what and when. */
export function keyOf(o: { no?: string; place: string; local?: string; items: OrderItem[] }): string {
  const no = clip(o.no, 40).replace(/[^A-Za-z0-9-]/g, "");
  if (no.length >= 4) return `no:${no}`;
  const what = [norm(o.place), o.local ?? "", ...o.items.map((i) => `${i.qty}x${norm(i.name)}`).sort()].join("|");
  return `h:${createHash("sha256").update(what).digest("hex").slice(0, 24)}`;
}

/**
 * The restaurant's own page, from the links the page had: the link whose words are the place's name, on the site's host,
 * with the site's restaurant path in it. Matched here, never by the model.
 */
export function linkFor(place: string, site: string, links: readonly PageLink[]): string | undefined {
  const want = norm(place);
  if (!want) return undefined;
  const path = catalogFor(site)?.placePath;
  for (const l of links) {
    let u: URL;
    try { u = new URL(l.url); } catch { continue; }
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || !(h === site || h.endsWith(`.${site}`))) continue;
    if (path && !u.pathname.includes(path)) continue;
    const said = norm(l.label);
    if (said && (said === want || said.startsWith(want) || want.startsWith(said))) return `${u.origin}${u.pathname}`;
  }
  return undefined;
}

/** What the model said, as orders: anything without a place or a dish is dropped, everything is capped. */
export function ordersOf(reply: z.infer<typeof OrdersReply>, site: string, links: readonly PageLink[], now: number): SiteOrder[] {
  const out: SiteOrder[] = [];
  const keys = new Set<string>();
  for (const r of reply.orders.slice(0, ORDERS_MAX)) {
    const place = clip(r.place, PLACE_MAX);
    const items: OrderItem[] = [];
    for (const it of (Array.isArray(r.items) ? r.items : []).slice(0, ITEMS_MAX)) {
      const name = clip(it?.name, DISH_MAX);
      const qty = typeof it?.qty === "number" && Number.isFinite(it.qty) ? Math.max(1, Math.min(20, Math.round(it.qty))) : 1;
      if (name) items.push({ name, qty });
    }
    if (!place || !items.length) continue;
    const local = localTime(r.at);
    const total = rupees(r.total);
    const area = clip(r.area, AREA_MAX);
    // A restaurant's link is named by the restaurant; a product's by the product.
    const link = linkFor(place, site, links) ?? linkFor(items[0]!.name, site, links);
    const key = keyOf({ ...(r.no ? { no: r.no } : {}), place, items, ...(local ? { local } : {}) });
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({
      key, site, place, items, seenAt: now,
      ...(area ? { area } : {}), ...(total ? { total } : {}), ...(local ? { local } : {}), ...(link ? { link } : {}),
      ...(r.cancelled === true ? { cancelled: true as const } : {}),
    });
  }
  return out;
}

/** The history with this read's orders in it. One already kept keeps when it was first seen, and a link it learned. */
export function mergeOrders(had: readonly SiteOrder[], fresh: readonly SiteOrder[]): SiteOrder[] {
  const by = new Map(had.map((o) => [o.key, o]));
  for (const o of fresh) {
    const old = by.get(o.key);
    by.set(o.key, old ? { ...old, ...o, seenAt: old.seenAt, ...(o.link ?? old.link ? { link: o.link ?? old.link } : {}) } : o);
  }
  return [...by.values()].sort((a, b) => (b.local ?? "").localeCompare(a.local ?? "") || b.seenAt - a.seenAt);
}

/** What the model is told: the page, fenced, and the year, so "Sun, Nov 23" becomes a date and not a guess. */
export function ordersUser(page: { title: string; text: string; finalUrl: string }, now: number): string {
  let host = "";
  try { host = new URL(page.finalUrl).host; } catch { /* no host is still a page */ }
  return [
    `Today is ${new Date(now).toISOString().slice(0, 10)}.`,
    `The page: ${fenced(page.title)} (${fenced(host)})`,
    "<page>",
    fenced(page.text.slice(0, PAGE_CHARS)),
    "</page>",
  ].join("\n");
}

export interface OrdersDeps {
  call?: Parameters<typeof askJson>[0]["call"];
  gateway?: Parameters<typeof askJson>[0]["gateway"];
  maxPaise: number;
}

/** The orders on a page. Never throws: a read that gives nothing leaves the history as it was. */
export async function readOrders(
  userId: string, site: string, page: { title: string; text: string; finalUrl: string }, d: OrdersDeps, now = Date.now(),
): Promise<SiteOrder[] | null> {
  const { text, links } = splitLinks(page.text);
  if (text.length < 20) return null;
  try {
    const r = await askJson({
      ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}),
      userId, budget: { maxPaise: d.maxPaise },
    }, {
      tier: "tiny", purpose: "site.orders", role: "site_orders",
      user: ordersUser({ ...page, text }, now), schema: OrdersReply, maxTokens: 1800,
    });
    return r.ok ? ordersOf(r.value, site, links, now) : null;
  } catch {
    return null;
  }
}
