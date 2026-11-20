/**
 * THE SIGN-IN PANEL (docs/sites.md §panel, CLOUD_BROWSER — off).
 *
 * The one place a person touches their cloud browser directly, and it exists for a reason that cannot be designed
 * around: THE COOKIE LANDS WHERE THE HANDSHAKE FINISHES. If somebody signs in on their phone's own browser, the
 * shop sets its cookie there and this server is still signed out — and no browser will hand another site's cookies
 * to an app. So the sign-in has to happen in the browser that will keep it, which means they have to see that
 * browser for the half-minute it takes.
 *
 * What it is NOT: a browser. There is no address to type, the page is pinned to the hosts the panel opened for, and
 * it closes the moment the sign-in is done. A panel is a step in a flow, not a window on the web.
 *
 *   open(userId, site)          a held page at that site's sign-in, and the first frame
 *   tap / type / key / scroll   their touch, as real events
 *   poll(id)                    the newest frame, and whether it is over
 *   done(id)                    they say they are in: check, keep the session, close
 *   cancel(id)                  they gave up
 *
 * WHAT MAKES A SOCIAL SIGN-IN SAFE (docs/sites.md): the handshake needs Google, the shop's cookie does not. So when
 * the panel closes, every cookie of the social host is thrown away and only the shop's is kept. If your server is
 * read tomorrow, somebody orders dinner; nobody reads anybody's email.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { FrameGate, PanelLife, END_WORDS, type PanelEnd } from "./frames.js";
import { hostOf, mayUseCloudBrowser, siteAllowed } from "./gate.js";
import { looksSignedOut } from "./read.js";
import { SiteError } from "./service.js";
import { siteStore, type SiteProfile, type SiteStore } from "./store.js";
import type { HeldPage, SiteState } from "../web/browser/types.js";

/** The hosts a sign-in may reach besides the shop itself. Nothing else loads while the panel is open. */
const SOCIAL_HOSTS = ["accounts.google.com", "appleid.apple.com", "www.facebook.com"];
/** One panel a person. A second would hold a second of the browser's three places for the same sign-in. */
const ONE_EACH = true;

/**
 * THE TICKET. The panel is drawn by a page the server writes, shown in the app's LiveView — a WebView whose storage
 * is its own and empty, and which cannot reach the app's token (that is in SecureStore, behind the Keystore). So the
 * page is given a secret of its own instead, and it is deliberately the smallest one that can exist:
 *
 *   - it is this ONE panel. There is no other call it opens, no other panel it reaches, nothing it can read.
 *   - it dies with the panel, which is five minutes at the outside and ninety seconds of quiet.
 *   - it is never stored, never logged, and never leaves the page it was written into.
 *
 * Handing the app's own bearer token to a page that is about to load a shop's sign-in would be the opposite trade.
 */
const TICKET_BYTES = 32;

export type Hold = (o: { url: string; state?: SiteState; viewport?: { width: number; height: number }; allow?: RegExp[] }) => Promise<HeldPage>;

export interface PanelView {
  id: string;
  site: string;
  /** The newest frame as base64 JPEG, when there is one to send. */
  frame?: string;
  width: number;
  height: number;
  /** Set once it is over, with what to tell them. */
  ended?: PanelEnd;
  message?: string;
}

interface Live {
  id: string;
  userId: string;
  /** The page's own secret for this panel, and nothing else (see TICKET_BYTES). */
  ticket: string;
  site: string;
  page: HeldPage;
  gate: FrameGate;
  life: PanelLife;
  /** The newest frame, kept rather than queued: an old one is not worth sending late. */
  frame: string;
  width: number;
  height: number;
  ended: PanelEnd | null;
}

export interface PanelsDeps {
  hold: Hold;
  store?: SiteStore;
  now?: () => number;
}

export class Panels {
  private readonly live = new Map<string, Live>();
  private readonly store: SiteStore;
  private readonly now: () => number;

  constructor(private readonly d: PanelsDeps) {
    this.store = d.store ?? siteStore();
    this.now = d.now ?? Date.now;
  }

  /** The hosts this panel may load: the shop, and the places a social button goes. Nothing else. */
  private allowFor(site: string): RegExp[] {
    const hosts = [site, ...SOCIAL_HOSTS];
    return hosts.map((h) => new RegExp(`^https?://([a-z0-9-]+\\.)*${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$|:)`, "i"));
  }

  async open(userId: string, url: string): Promise<PanelView> {
    const site = hostOf(url);
    if (!mayUseCloudBrowser(userId)) throw new SiteError("off", "That isn't switched on here.", 404);
    if (!site || !siteAllowed(site)) throw new SiteError("site_not_allowed", "I can't sign in to that one.", 400);
    if (ONE_EACH) for (const p of this.live.values()) if (p.userId === userId) await this.shut(p, "cancelled");

    const page = await this.d.hold({ url, viewport: { width: 412, height: 915 }, allow: this.allowFor(site) })
      .catch((err: unknown) => {
        // WHY IT WOULD NOT OPEN, SAID OUT LOUD. The person is told something vague on purpose — a sign-in that
        // failed is not the place to explain a server — but this was the only copy, and dropping it left a 503
        // with nothing in the log at all: the one thing anybody needs to fix it, caught and thrown away. Chrome's
        // own startup lines travel in that message now (web/browser/chrome.ts), so this prints the real cause.
        console.warn(`[sites] the panel could not open ${site}: ${err instanceof Error ? err.message : String(err)}`);
        throw new SiteError("no_browser", "I can't open that right now.", 503);
      });

    const at = this.now();
    const p: Live = {
      id: randomUUID(), userId, site, page,
      ticket: randomBytes(TICKET_BYTES).toString("base64url"),
      gate: new FrameGate(), life: new PanelLife(at),
      frame: "", width: 412, height: 915, ended: null,
    };
    page.onFrame((jpeg, meta) => {
      const now = this.now();
      p.life.alive(now);
      // The gate decides whether this one is worth the bytes; the newest always replaces the one before it.
      if (p.gate.frame(now)) { p.frame = jpeg; p.width = meta.width; p.height = meta.height; }
    });
    this.live.set(p.id, p);
    return this.view(p);
  }

  private mine(id: string, userId: string): Live {
    const p = this.live.get(id);
    if (!p || p.userId !== userId) throw new SiteError("not_found", "That panel isn't open.", 404);
    return p;
  }

  /**
   * The person whose panel this is, found by the page's own secret. Compared in constant time and only against
   * tickets of the same length, so the time a wrong one takes says nothing about how much of it was right.
   */
  idForTicket(ticket: string): string | null {
    if (typeof ticket !== "string" || !ticket) return null;
    const given = Buffer.from(ticket, "utf8");
    let found: string | null = null;
    for (const p of this.live.values()) {
      const want = Buffer.from(p.ticket, "utf8");
      // Every open panel is checked, with no early exit, so the number of comparisons does not leak either.
      if (want.length === given.length && timingSafeEqual(want, given)) found = p.id;
    }
    return found;
  }

  /** The user a panel belongs to: what a ticket call needs before it may do anything in that person's name. */
  ownerOf(id: string): string | null {
    return this.live.get(id)?.userId ?? null;
  }

  /** The page's secret, for writing into the page. Never sent to the app, never logged, never stored. */
  ticketOf(id: string): string | null {
    return this.live.get(id)?.ticket ?? null;
  }

  /** Their touch. Every one of these says "they are here", which is what keeps the panel alive and the frames quick. */
  async touch(id: string, userId: string, what: { tap?: { x: number; y: number }; type?: string; key?: "Enter" | "Backspace" | "Tab"; scroll?: number }): Promise<PanelView> {
    const p = this.mine(id, userId);
    if (p.ended) return this.view(p);
    const now = this.now();
    p.gate.touched(now);
    p.life.alive(now);
    if (what.tap) await p.page.tap(what.tap.x, what.tap.y);
    else if (typeof what.type === "string") await p.page.type(what.type);
    else if (what.key) await p.page.key(what.key);
    else if (typeof what.scroll === "number") await p.page.scroll(what.scroll);
    return this.view(p);
  }

  /**
   * The newest frame, and whether it is over. Asked by the app while the panel is up; also where the two clocks are
   * read, so a panel nobody is looking at still closes.
   */
  async poll(id: string, userId: string): Promise<PanelView> {
    const p = this.mine(id, userId);
    if (p.ended) return this.view(p);
    const over = p.life.over(this.now(), false);
    if (over) await this.shut(p, over);
    return this.view(p);
  }

  /**
   * They say they are in. Checked rather than believed: if the page is still a sign-in page the panel stays open,
   * because closing here would save a signed-out session over a good one — the same mistake the watcher made once.
   */
  async done(id: string, userId: string): Promise<PanelView & { signedIn: boolean }> {
    const p = this.mine(id, userId);
    if (p.ended) return { ...this.view(p), signedIn: false };
    const look = await p.page.look().catch(() => null);
    const signedIn = !!look && !looksSignedOut({ ...look, text: "", state: { cookies: [] } });
    if (!signedIn) return { ...this.view(p), signedIn: false, message: "That still looks like the sign-in page." };
    await this.keep(p);
    await this.shut(p, "said_done");
    return { ...this.view(p), signedIn: true };
  }

  async cancel(id: string, userId: string): Promise<PanelView> {
    const p = this.mine(id, userId);
    await this.shut(p, "cancelled");
    return this.view(p);
  }

  /**
   * KEEP THE SHOP AND THROW GOOGLE AWAY. The handshake needed the social host; the session does not. Taking it out
   * before the state is read means this server never holds a live Google session at all — not for a minute, not in
   * a backup, not in a breach.
   */
  private async keep(p: Live): Promise<void> {
    for (const h of SOCIAL_HOSTS) await p.page.forgetHost(h).catch(() => undefined);
    const state = await p.page.state().catch(() => null);
    if (!state) return;
    await this.store.saveLogin(p.userId, p.site, state as SiteProfile).catch(() => undefined);
  }

  private async shut(p: Live, why: PanelEnd): Promise<void> {
    if (p.ended) return;
    p.ended = why;
    this.live.delete(p.id);
    await p.page.close().catch(() => undefined);
  }

  private view(p: Live): PanelView {
    return {
      id: p.id, site: p.site, width: p.width, height: p.height,
      ...(p.frame ? { frame: p.frame } : {}),
      ...(p.ended ? { ended: p.ended, message: END_WORDS[p.ended] } : {}),
    };
  }

  /** Every open panel shut: for the server closing down, and for the tests. */
  async closeAll(): Promise<void> {
    for (const p of [...this.live.values()]) await this.shut(p, "cancelled");
  }

  /** How many are open, for the log. */
  get openCount(): number {
    return this.live.size;
  }
}
