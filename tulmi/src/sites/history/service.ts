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
import { kindOf } from "./kinds.js";
import { readyFor } from "./plan.js";
import { safeImage } from "./pictures.js";
import type { PickView, SitePortrait, TasteView } from "./types.js";
import { discover, type DiscoverDeps, type Discovery } from "./taste/discover.js";
import { tasteHash, tasteOf, TASTE_MIN_ORDERS, type Taste, type TasteDeps } from "./taste/profile.js";

/** How often an orders page may be read. A person orders food a few times a week; twice a day misses nothing. */
export const HISTORY_EVERY_MS = 12 * 60 * 60_000;
/** How often new places are looked for, unless their taste changed: places do not open every hour. */
export const PICKS_EVERY_MS = 24 * 60 * 60_000;
/** How long an ask waits for a live look on the web before answering with what it has. */
export const LIVE_DISCOVER_MS = 12_000;

/** The conclusions of a taste, for a screen or a bot: never the order numbers behind them. */
export function tasteView(t: Taste): TasteView {
  return {
    insights: t.insights, palate: t.palate.map((p) => p.trait), motives: t.motives.map((m) => m.trait),
    moods: t.moods.map((m) => ({ moment: m.moment, wants: m.wants })),
    mightLike: t.mightLike.map((h) => ({ item: h.item, category: h.category, why: h.why, reach: h.reach })),
    chooser: t.chooser,
  };
}

export const pickView = (p: Discovery): PickView =>
  ({ place: p.place, item: p.item, category: p.category, why: p.why, said: p.said, host: p.host, reach: p.reach });

/**
 * The catalog entry of a site whose orders can be learned, if it is one: ANY site whose own orders page the catalog knows,
 * food or shopping alike. What differs by kind is in history/kinds.ts, not here.
 */
export function historySite(site: string) {
  const e = catalogFor(site);
  return e && e.orders ? e : undefined;
}

export type HistoryOutcome = "learned" | "same" | "early" | "signed_out" | "failed";

export interface HistoryDeps {
  store?: HistoryStore;
  logins?: SiteStore;
  read?: OrdersDeps;
  /** The taste profile's model (taste/profile.ts). Absent: no taste is worked out, and the portrait is what was counted. */
  taste?: TasteDeps;
  /** The web, for new places (taste/discover.ts). Absent: nothing new is looked for. */
  discover?: DiscoverDeps;
  now?: () => number;
}

export class SiteHistories {
  private readonly store: HistoryStore;
  private readonly logins: SiteStore;
  private readonly now: () => number;
  /** Refreshes running, by person and site: one at a time each, however often a screen asks. */
  private readonly busy = new Map<string, Promise<void>>();

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
   * screens draw an unseen reader for each (screens/sites/forYou.ts), and the read comes back to phoneRead.
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
    // The orders changed, so their taste may have: worked out again behind the answer, never in its way.
    void this.refresh(userId, site);
    return { outcome: "learned", added: fresh.filter((o) => !known.has(o.key)).length };
  }

  async portrait(userId: string, rawSite: string): Promise<SitePortrait> {
    const site = siteOf(rawSite);
    this.allowed(userId, site);
    const [orders, mark, ins] = await Promise.all([this.store.ordersOf(userId, site), this.store.mark(userId, site), this.store.insight(userId, site)]);
    const p = portraitOf(site, orders, this.now(), mark.readAt);
    // A taste that is missing or older than the orders is worked out again, behind the page; the page shows what there is.
    if (this.stale(orders, ins)) void this.refresh(userId, site);
    const ready = readyFor({ site, orders, ...(ins.taste ? { chooser: ins.taste.chooser } : {}), ...(ins.picks ? { picks: ins.picks } : {}) }, this.now());
    const did = await this.store.didOf(userId, site);
    return {
      ...p,
      ...(ins.taste ? { taste: tasteView(ins.taste) } : {}),
      ...(ins.picks?.length ? { picks: ins.picks.map(pickView) } : {}),
      ...(ready.length ? { ready } : {}),
      ...(did.length ? { did: did.map((d) => ({ kind: d.kind, title: d.title, ...(d.line ? { line: d.line } : {}), at: d.at, ...(d.image ? { image: d.image } : {}) })) } : {}),
    };
  }

  private stale(orders: readonly import("./types.js").SiteOrder[], ins: { taste?: Taste; picksAt?: number }): boolean {
    if (!this.d.taste || orders.filter((o) => !o.cancelled).length < TASTE_MIN_ORDERS) return false;
    if (!ins.taste || ins.taste.hash !== tasteHash(orders)) return true;
    return !!this.d.discover && (!ins.picksAt || this.now() - ins.picksAt >= PICKS_EVERY_MS);
  }

  /**
   * WORK OUT THEIR TASTE AGAIN, AND LOOK FOR NEW PLACES FOR IT. The taste when the orders changed; new places when the taste
   * changed or a day has passed. One at a time per person and site, and never throws: a failed refresh leaves what was there.
   */
  refresh(userId: string, site: string): Promise<void> {
    const k = `${userId}\u0000${site}`;
    const running = this.busy.get(k);
    if (running) return running;
    const run = (async () => {
      try {
        const orders = await this.store.ordersOf(userId, site);
        const ins = await this.store.insight(userId, site);
        if (!this.stale(orders, ins)) return;
        let taste = ins.taste;
        const changed = !taste || taste.hash !== tasteHash(orders);
        if (changed && this.d.taste) {
          const made = await tasteOf(userId, orders, this.d.taste, this.now(), site);
          if (made) { taste = made; await this.store.saveInsight(userId, site, { taste }); }
        }
        if (!taste || !this.d.discover) return;
        if (!changed && ins.picksAt && this.now() - ins.picksAt < PICKS_EVERY_MS) return;
        const picks = await discover(userId, taste, this.d.discover);
        // An empty look is kept too: it says when it was looked for, so it is not looked for again within the day.
        await this.store.saveInsight(userId, site, { picks, picksAt: this.now() });
        // Something done for them, and said so on the page: one line a day at most.
        const fresh = picks.filter((p) => !(ins.picks ?? []).some((q) => q.place === p.place && q.item === p.item));
        if (fresh.length) {
          const k = kindOf(site);
          await this.store.addDid(userId, site, {
            ref: `found:${new Date(this.now()).toISOString().slice(0, 10)}`, kind: "found", at: this.now(),
            title: fresh.length === 1 ? `Found you something new: ${fresh[0]!.item}` : `Found ${fresh.length} new ${k.kind === "food" ? "places" : "things"} you'd like`,
            line: fresh.map((p) => `${p.item} ${k.kind === "food" ? "at" : "from"} ${p.place}`).join(", ").slice(0, 160),
            ...(fresh.find((p) => p.image)?.image ? { image: fresh.find((p) => p.image)!.image } : {}),
          });
        }
      } catch { /* what was there stays */ } finally {
        this.busy.delete(k);
      }
    })();
    this.busy.set(k, run);
    return run;
  }

  /**
   * A LIVE LOOK FOR SOMETHING THEY ASKED FOR AND HAVE NEVER ORDERED ("order pizza"): the web, read through their taste.
   * Held to LIVE_DISCOVER_MS, so an ask is answered in seconds whatever the web does; nothing found is an empty list.
   */
  async discoverFor(userId: string, want: string): Promise<Discovery[]> {
    if (!this.d.discover || !want.trim()) return [];
    const sites = (await this.store.sitesOf(userId)).filter((s) => historySite(s) && siteAllowed(s));
    let taste: Taste | undefined;
    for (const s of sites) { taste = (await this.store.insight(userId, s)).taste; if (taste) break; }
    if (!taste) return [];
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<Discovery[]>((done) => { timer = setTimeout(() => done([]), LIVE_DISCOVER_MS); timer.unref?.(); });
    try {
      return await Promise.race([discover(userId, taste, this.d.discover, { want }), late]);
    } finally { if (timer) clearTimeout(timer); }
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
    return Promise.all(sites.map(async (site) => {
      const [orders, ins] = await Promise.all([this.store.ordersOf(userId, site), this.store.insight(userId, site)]);
      return { site, orders, ...(ins.taste ? { chooser: ins.taste.chooser } : {}), ...(ins.picks?.length ? { picks: ins.picks } : {}) };
    }));
  }

  /** A cart filled on their phone (screens/sites/order.ts): noted once per order, shown under "Done for you". */
  async noteCart(userId: string, rawSite: string, c: { ref: string; title: string; line?: string; image?: string }): Promise<void> {
    const site = siteOf(rawSite);
    this.allowed(userId, site);
    const image = safeImage(c.image, site);
    await this.store.addDid(userId, site, {
      ref: `cart:${c.ref}`, kind: "cart", title: c.title, ...(c.line ? { line: c.line } : {}), ...(image ? { image } : {}), at: this.now(),
    });
  }

  async forget(userId: string, rawSite: string): Promise<void> {
    const site = siteOf(rawSite);
    this.allowed(userId, site);
    await this.store.forget(userId, site);
  }
}
