/**
 * THE ORDERS TALK OFFERED, KEPT ON THE TURN (botsBots/chat.ts TurnDid.order), so the card is still there when the thread is
 * drawn again, and still says what it said.
 *
 *   orderToken(options)   the options as the turn keeps them: JSON, capped
 *   readOrderToken(raw)   the options read back, checked again: a kept row is data too, and a card opens a real site
 *
 * Every address is checked on the way back out: https, on a site this server allows, and the site the option names. An
 * option that fails any of it is dropped, so a row that was tampered with can at most lose its card.
 */
import { siteAllowed } from "../gate.js";
import type { OrderItem, OrderOption } from "./types.js";

export const ORDER_TOKEN_MAX = 3000;
const OPTIONS_KEPT = 3, ITEMS_KEPT = 8;

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function orderToken(options: readonly OrderOption[]): string {
  const kept = options.slice(0, OPTIONS_KEPT).map((o) => ({
    site: o.site, place: o.place.slice(0, 80), items: o.items.slice(0, ITEMS_KEPT), why: o.why.slice(0, 200), url: o.url,
    ...(o.area ? { area: o.area.slice(0, 60) } : {}), ...(o.total ? { total: o.total } : {}), ...(o.search ? { search: true } : {}),
    ...(o.fresh ? { fresh: true, said: (o.said ?? "").slice(0, 240), host: (o.host ?? "").slice(0, 60) } : {}),
  }));
  // Fewer options rather than a cut in the middle of one, which would be no JSON at all.
  for (let n = kept.length; n > 0; n--) {
    const s = JSON.stringify({ v: 1, options: kept.slice(0, n) });
    if (s.length <= ORDER_TOKEN_MAX) return s;
  }
  return "";
}

/** A site's host and the address are one site: the address is on it or one of its subdomains. */
function onSite(url: string, site: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return u.protocol === "https:" && (h === site || h.endsWith(`.${site}`));
  } catch { return false; }
}

export function readOrderToken(raw: unknown): OrderOption[] {
  if (typeof raw !== "string" || !raw || raw.length > ORDER_TOKEN_MAX) return [];
  let j: { options?: unknown };
  try { j = JSON.parse(raw) as { options?: unknown }; } catch { return []; }
  if (!Array.isArray(j?.options)) return [];
  const out: OrderOption[] = [];
  for (const x of j.options.slice(0, OPTIONS_KEPT)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const site = clip(o.site, 120).toLowerCase(), place = clip(o.place, 80), why = clip(o.why, 200), url = clip(o.url, 600);
    if (!site || !place || !siteAllowed(site) || !onSite(url, site)) continue;
    const items: OrderItem[] = (Array.isArray(o.items) ? o.items : []).slice(0, ITEMS_KEPT).flatMap((it) => {
      const i = (it ?? {}) as Record<string, unknown>;
      const name = clip(i.name, 80);
      const qty = typeof i.qty === "number" && i.qty > 0 ? Math.min(20, Math.round(i.qty)) : 1;
      return name ? [{ name, qty }] : [];
    });
    const search = o.search === true;
    if (!search && !items.length) continue;
    const total = typeof o.total === "number" && o.total > 0 && o.total < 100_000 ? o.total : undefined;
    const area = clip(o.area, 60);
    // Somewhere new: the reviewer's words and where they were written travel with it, and are only ever drawn as text.
    const said = o.fresh === true ? clip(o.said, 240) : "", host = o.fresh === true ? clip(o.host, 60).replace(/[^a-z0-9.-]/gi, "") : "";
    out.push({
      site, place, items, why, url, ...(area ? { area } : {}), ...(total ? { total } : {}), ...(search ? { search: true as const } : {}),
      ...(o.fresh === true ? { fresh: true as const, ...(said ? { said } : {}), ...(host ? { host } : {}) } : {}),
    });
  }
  return out;
}
