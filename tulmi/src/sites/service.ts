/**
 * WATCHING A THING ON A SITE SOMEBODY IS SIGNED IN TO (CLOUD_BROWSER — off; docs/sites.md).
 *
 *   signIn(userId, site, state)   keep the slip a browser came back with, after they signed in themselves
 *   watch(userId, url, label)     start watching a thing: an order on its way, an application going through
 *   checkOne(watch)               open the page as them, read it, write the card back
 *   dueNow(now)                   the things whose turn it is, for whatever runs the clock
 *
 * THREE RULES THAT ARE THE WHOLE OF ITS MANNERS, and the reason this is safe to point at a real shop:
 *
 *   1. It only looks while something is OPEN. A delivery arrives, and the looking stops the same minute. A site
 *      that sees one look while a parcel is out reads as a person; the same site seeing a heartbeat all day reads
 *      as a scraper, and scrapers get their accounts shut.
 *   2. It never looks sooner than CLOUD_BROWSER_EVERY_MIN, whatever asks.
 *   3. It reads and nothing else. Nothing in this path can press, type or spend.
 *
 * A failed read is not a blank card. The watch keeps what it had, because an empty card reads as "nothing is
 * happening", which is a lie about a parcel that is merely on a page we misread.
 */
import { hostOf, mayUseCloudBrowser, siteAllowed, siteOf, watchLimits } from "./gate.js";
import { looksSignedOut, readCard, type ReadDeps } from "./read.js";
import { FAILS_BEFORE_SIGN_IN, siteStore, type SiteProfile, type SiteStore, type SiteWatch } from "./store.js";
import type { SiteCard } from "../../../shared/types/api.js";
import type { SiteState, VisitOptions, VisitedPage } from "../web/browser/types.js";

export class SiteError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "SiteError";
  }
}

/** How a page is opened. The engine's `visit` in the server; anything in a test. */
export type Visit = (o: VisitOptions) => Promise<VisitedPage>;

export interface SitesDeps {
  /** The server's own browser. Absent on a server with no Chrome: then only logins held on the phone are read. */
  visit?: Visit;
  store?: SiteStore;
  read?: ReadDeps;
  now?: () => number;
}

export class Sites {
  private readonly store: SiteStore;
  private readonly now: () => number;

  constructor(private readonly d: SitesDeps) {
    this.store = d.store ?? siteStore();
    this.now = d.now ?? Date.now;
  }

  // ------------------------------------------------------------------ signing in

  /** Keep the slip. Called once the person has signed in themselves; never with anything they typed. */
  async signIn(userId: string, site: string, state: SiteState, who?: string): Promise<void> {
    this.allowed(userId, site);
    await this.store.saveLogin(userId, site, state as SiteProfile, who);
  }

  /**
   * SIGNED IN ON THE PHONE. The app's WebView saw the site's sign-in give way to a signed-in page, and says so. Nothing
   * comes with it — no cookie, no storage, nothing to replay — because nothing left the phone: what is kept here is
   * the fact that this person is signed in to this site, there. Which is also why there is still no route that
   * takes a session: this one takes a host name.
   */
  async connectedOnPhone(userId: string, host: string, who?: string): Promise<void> {
    const site = siteOf(host);
    this.allowed(userId, site);
    await this.store.saveLogin(userId, site, { cookies: [], onPhone: true }, who);
  }

  /**
   * WHAT A PAGE SAID, READ ON THE PHONE. The phone opened the watched page in its own signed-in WebView, read it by
   * the same walk the server's reader does (phone.ts READ_PAGE), and sent the words. From here it is the server's
   * read exactly — signed out or not, three strikes, a card from the model — through the same took().
   *
   * The manners are the server's, not the phone's: a read before the watch is due is answered with what it already
   * has and goes no further, so an app that asks too often costs a database read and never a model call.
   */
  async phoneRead(userId: string, watchId: string, page: Pick<VisitedPage, "finalUrl" | "title" | "text" | "elements">) {
    const w = await this.store.watch(watchId);
    if (!w || w.ownerId !== userId) throw new SiteError("not_found", "That is not something I am watching.", 404);
    if (w.state !== "open") return { card: w.card ?? null, outcome: "skipped" as const };
    this.allowed(userId, w.site);
    const login = await this.store.login(userId, w.site);
    if (!login?.profile.onPhone) throw new SiteError("not_on_phone", "That one is not signed in on your phone.", 409);
    if (w.nextAt && w.nextAt > this.now()) return { card: w.card ?? null, outcome: "early" as const };
    return this.took(w, { ...page, state: { cookies: [] } }, { fromPhone: true, who: login.who });
  }

  async signOut(userId: string, site: string): Promise<void> {
    await this.store.forgetLogin(userId, site);
  }

  async logins(userId: string) {
    if (!mayUseCloudBrowser(userId)) return [];
    const rows = await this.store.loginsOf(userId);
    return rows.map((r) => ({
      site: r.site, ...(r.who ? { who: r.who } : {}), ...(r.usedAt ? { usedAt: r.usedAt } : {}),
      ...(r.fails >= FAILS_BEFORE_SIGN_IN ? { needsSignIn: true } : {}),
      // Held on their phone: the phone reads it, and the screen gives it a reader there.
      ...(r.profile.onPhone ? { onPhone: true } : {}),
    }));
  }

  // ------------------------------------------------------------------ watching

  async watch(userId: string, url: string, label: string): Promise<SiteWatch> {
    const site = siteOf(hostOf(url));
    this.allowed(userId, site);
    const login = await this.store.login(userId, site);
    if (!login) throw new SiteError("not_signed_in", "You are not signed in to that one yet.", 409);
    const { most } = watchLimits();
    if (await this.store.openCount(userId) >= most) {
      throw new SiteError("too_many", "You are already watching as many things as I can keep up with.", 409);
    }
    return this.store.addWatch({
      ownerId: userId, site, url, label: label.trim().slice(0, 80) || site,
      state: "open", nextAt: this.now(),
    });
  }

  async stop(userId: string, id: string): Promise<void> {
    const w = await this.store.watch(id);
    if (!w || w.ownerId !== userId) throw new SiteError("not_found", "That is not something I am watching.", 404);
    await this.store.setWatchState(id, "stopped");
  }

  async list(userId: string) {
    if (!mayUseCloudBrowser(userId)) return [];
    const rows = await this.store.watchesOf(userId);
    return rows.map((w) => ({
      id: w.id, site: w.site, label: w.label, state: w.state,
      ...(w.card ? { card: w.card } : {}), ...(w.readAt ? { readAt: w.readAt } : {}),
      // For the phone's reader: the page to open, and whether it is its turn. `due` is the same floor checkOne and
      // phoneRead keep, so a screen opened twice a minute does not read a site twice a minute.
      ...(w.state === "open" ? { url: w.url, due: (w.nextAt ?? 0) <= this.now() } : {}),
    }));
  }

  /** The things whose turn it is. */
  dueNow(limit?: number) {
    return this.store.due(this.now(), limit);
  }

  // ------------------------------------------------------------------ one look

  /**
   * Open it as them, read it, write the card back. Never throws: whatever goes wrong, the watch is left in a state
   * the next run can pick up.
   */
  async checkOne(w: SiteWatch): Promise<{ card: SiteCard | null; outcome: "read" | "done" | "signed_out" | "failed" | "skipped" }> {
    if (w.state !== "open") return { card: null, outcome: "skipped" };
    if (!mayUseCloudBrowser(w.ownerId) || !siteAllowed(w.site)) {
      // The switch went off, or the site was taken off the list, under a watch that was already running.
      await this.store.setWatchState(w.id, "stopped");
      return { card: null, outcome: "skipped" };
    }
    const { every } = watchLimits();
    const login = await this.store.login(w.ownerId, w.site);
    if (!login) {
      await this.store.saveRead(w.id, undefined, "open", this.now() + every);
      return { card: null, outcome: "signed_out" };
    }

    // Held on the phone: the server has nothing to open it with, and must not try — a visit with no session would
    // read a signed-out page and count it as a refusal. The phone reads these (phoneRead), so the watch is left as
    // it is, still due for the phone.
    if (login.profile.onPhone || !this.d.visit) return { card: null, outcome: "skipped" };

    let page: VisitedPage;
    try {
      page = await this.d.visit({ url: w.url, state: login.profile as SiteState });
    } catch {
      await this.store.saveRead(w.id, undefined, "open", this.now() + every);
      return { card: null, outcome: "failed" };
    }
    return this.took(w, page, { fromPhone: false, who: login.who });
  }

  /**
   * ONE PAGE, AS READ — by the server's browser or the phone's, the same from here on. Whether we are still them is
   * asked before anything is written; three refusals stop the watch; otherwise the model makes the card.
   */
  private async took(w: SiteWatch, page: VisitedPage, o: { fromPhone: boolean; who?: string }): Promise<{ card: SiteCard | null; outcome: "read" | "done" | "signed_out" | "failed" | "skipped" }> {
    const { every } = watchLimits();

    // WHETHER WE ARE STILL THEM DECIDES EVERYTHING ELSE, so it is asked before anything is written.
    //
    // Saving the session first looked tidy and was wrong twice over: a sign-in page's cookies are a SIGNED-OUT
    // session, so writing them back destroys the good slip and signs them out for real; and saveLogin clears the
    // refusal count, so three strikes could never add up and nobody was ever asked to sign in again.
    if (looksSignedOut(page)) {
      const fails = await this.store.noteRefusal(w.ownerId, w.site);
      // Three in a row and the slip is dead: stop looking, and the screen asks them to sign in again.
      if (fails >= FAILS_BEFORE_SIGN_IN) await this.store.setWatchState(w.id, "stopped");
      else await this.store.saveRead(w.id, undefined, "open", this.now() + every);
      return { card: null, outcome: "signed_out" };
    }

    // Still them: keep the session as it stands now, which is not the one that went in. A site refreshes its own
    // cookies as it is used, and throwing the new ones away is how a login quietly rots. Not for the phone: its
    // session is in its own WebView and refreshes itself there, and writing an empty one here would erase the fact
    // that it is held on the phone at all. A read that went through still clears the refusal count, though.
    if (o.fromPhone) await this.store.saveLogin(w.ownerId, w.site, { cookies: [], onPhone: true }, o.who).catch(() => undefined);
    else await this.store.saveLogin(w.ownerId, w.site, page.state as SiteProfile, o.who).catch(() => undefined);

    const card = this.d.read ? await readCard(w.ownerId, w.label, page, this.d.read) : null;
    if (!card) {
      await this.store.saveRead(w.id, undefined, "open", this.now() + every);
      return { card: null, outcome: "failed" };
    }
    const done = card.done === true;
    await this.store.saveRead(w.id, card, done ? "done" : "open", done ? undefined : this.now() + every);
    return { card, outcome: done ? "done" : "read" };
  }

  private allowed(userId: string, site: string): void {
    if (!mayUseCloudBrowser(userId)) throw new SiteError("off", "That is not switched on here.", 404);
    if (!site) throw new SiteError("bad_site", "That is not a web address I can open.", 400);
    if (!siteAllowed(site)) throw new SiteError("site_not_allowed", "I cannot sign in to that one.", 400);
  }
}
