/**
 * LEARNING FROM A SITE'S ORDERS PAGE (docs/site-portrait.md).
 *
 *   historySite(site)          whether a site has a history to learn: a food site whose orders page the catalog knows
 *   due(userId, site)          whether its orders page is due a read (never read, or not for HISTORY_EVERY_MS)
 *   phoneRead(userId, site, p) what the orders page said, read on their phone: orders read out of it and kept
 *   portrait / portraits       what their orders add up to, per site
 *   histories(userId)          the orders themselves, for the planner
 *   forget(userId, site)       everything learned from that site, gone
 *
 * THE MANNERS ARE THE WATCHER'S (src/sites/service.ts), and stricter: one read of one page, at most twice a day, only of
 * the site's own orders page, only on their phone, and only while they are signed in there. The same page read twice is
 * not read twice by a model: its hash is kept, and a page that has not changed costs nothing.
 *
 * Nothing here can press, type or spend. Ordering is somewhere else (screens/sites/order.ts), and starts with a person's tap.
 */
import { createHash } from "node:crypto";
import { catalogFor } from "../catalog.js";
import { mayUseCloudBrowser, siteAllowed, siteOf } from "../gate.js";
import { looksSignedOut } from "../read.js";
import { SiteError } from "../service.js";
import { siteStore, type SiteStore } from "../store.js";
import type { VisitedPage } from "../../web/browser/types.js";
import { mergeOrders, readOrders, type OrdersDeps } from "./orders.js";
import { portraitOf } from "./portrait.js";
import type { SiteHistory } from "./plan.js";
import { historyStore, type HistoryStore } from "./store.js";
import type { SitePortrait } from "./types.js";

/** How often an orders page may be read. A person orders food a few times a week; twice a day misses nothing. */
export const HISTORY_EVERY_MS = 12 * 60 * 60_000;

/** The catalog entry of a site whose orders can be learned, if it is one. */
export function historySite(site: string) {
  const e = catalogFor(site);
  return e && e.orders && e.category === "Food" ? e : undefined;
}

export type HistoryOutcome = "learned" | "same" | "early" | "signed_out" | "failed";

export interface HistoryDeps {
  store?: HistoryStore;
  logins?: SiteStore;
  read?: OrdersDeps;
  now?: () => number;
}

export class SiteHistories {
  private readonly store: HistoryStore;
  private readonly logins: SiteStore;
  private readonly now: () => number;

  constructor(private readonly d: HistoryDeps = {}) {
    this.store = d.store ?? historyStore();
    this.logins = d.logins ?? siteStore();
    this.now = d.now ?? Date.now;
  }

  private allowed(userId: string, site: string) {
    if (!mayUseCloudBrowser(userId)) throw new SiteError("off", "That is not switched on here.", 404);
    const entry = historySite(site);
    if (!site || !siteAllowed(site) || !entry) throw new SiteError("no_history", "I can't learn from that site.", 400);
    return entry;
  }

  /** Whether the orders page is due a read. */
  async due(userId: string, site: string): Promise<boolean> {
    const m = await this.store.mark(userId, site);
    return !m.readAt || this.now() - m.readAt >= HISTORY_EVERY_MS;
  }

  /**
   * The sites whose orders page this phone should read now: signed in on the phone, a site with a history, due. The
   * screens draw an unseen reader for each (screens/sites/portrait.ts), and the read comes back to phoneRead.
   */
  async readers(userId: string): Promise<Array<{ site: string; url: string }>> {
    if (!mayUseCloudBrowser(userId)) return [];
    const out: Array<{ site: string; url: string }> = [];
    for (const l of await this.logins.loginsOf(userId)) {
      const e = historySite(l.site);
      if (!e?.orders || !l.profile.onPhone || l.fails >= 3 || !siteAllowed(l.site)) continue;
      if (await this.due(userId, l.site)) out.push({ site: l.site, url: e.orders });
    }
    return out;
  }

  /**
   * WHAT THE ORDERS PAGE SAID, READ ON THE PHONE. Held to the floor before anything else, so an app that asks too often costs
   * a database read and never a model call; then the page has to be the site's, and has to be them signed in.
   */
  async phoneRead(userId: string, rawSite: string, page: Pick<VisitedPage, "finalUrl" | "title" | "text" | "elements">): Promise<{ outcome: HistoryOutcome; added: number }> {
    const site = siteOf(rawSite);
    this.allowed(userId, site);
    const login = await this.logins.login(userId, site);
    if (!login?.profile.onPhone) throw new SiteError("not_on_phone", "That one is not signed in on your phone.", 409);
    let host = "";
    try { host = new URL(page.finalUrl).hostname.toLowerCase(); } catch { /* checked below */ }
    if (!(host === site || host.endsWith(`.${site}`))) throw new SiteError("wrong_site", "That page is not from that site.", 400);
    if (!(await this.due(userId, site))) return { outcome: "early", added: 0 };
    const now = this.now();
    const mark = await this.store.mark(userId, site);
    if (looksSignedOut({ ...page, state: { cookies: [] } })) {
      await this.store.setMark(userId, site, { readAt: now, ...(mark.hash ? { hash: mark.hash } : {}) });
      return { outcome: "signed_out", added: 0 };
    }
    const hash = createHash("sha256").update(page.text).digest("hex").slice(0, 32);
    if (mark.hash === hash) {
      await this.store.setMark(userId, site, { readAt: now, hash });
      return { outcome: "same", added: 0 };
    }
    const fresh = this.d.read ? await readOrders(userId, site, page, this.d.read, now) : null;
    if (!fresh) {
      // Read, and nothing usable: the floor still holds, and the hash is not kept, so the next read tries again.
      await this.store.setMark(userId, site, { readAt: now, ...(mark.hash ? { hash: mark.hash } : {}) });
      return { outcome: "failed", added: 0 };
    }
    const had = await this.store.ordersOf(userId, site);
    const known = new Set(had.map((o) => o.key));
    await this.store.saveOrders(userId, site, mergeOrders(had, fresh));
    await this.store.setMark(userId, site, { readAt: now, hash });
    return { outcome: "learned", added: fresh.filter((o) => !known.has(o.key)).length };
  }

  async portrait(userId: string, rawSite: string): Promise<SitePortrait> {
    const site = siteOf(rawSite);
    this.allowed(userId, site);
    const [orders, mark] = await Promise.all([this.store.ordersOf(userId, site), this.store.mark(userId, site)]);
    return portraitOf(site, orders, this.now(), mark.readAt);
  }

  /** A portrait for every site they have orders on, the most ordered first. */
  async portraits(userId: string): Promise<SitePortrait[]> {
    if (!mayUseCloudBrowser(userId)) return [];
    const sites = (await this.store.sitesOf(userId)).filter((s) => historySite(s) && siteAllowed(s));
    const all = await Promise.all(sites.map((s) => this.portrait(userId, s).catch(() => null)));
    return all.filter((p): p is SitePortrait => !!p && p.orders > 0).sort((a, b) => b.orders - a.orders);
  }

  async histories(userId: string): Promise<SiteHistory[]> {
    if (!mayUseCloudBrowser(userId)) return [];
    const sites = (await this.store.sitesOf(userId)).filter((s) => historySite(s) && siteAllowed(s));
    return Promise.all(sites.map(async (site) => ({ site, orders: await this.store.ordersOf(userId, site) })));
  }

  async forget(userId: string, rawSite: string): Promise<void> {
    const site = siteOf(rawSite);
    this.allowed(userId, site);
    await this.store.forget(userId, site);
  }
}
