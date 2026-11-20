/**
 * A BROWSER THAT BELONGS TO THE PERSON (src/sites, migration 0098, docs/sites.md). Launch dark: every route here answers 404
 * while CLOUD_BROWSER is off, which is the default.
 *
 *   GET    /v1/botsapp/bots/sites                      -> SitesView   what they are signed in to, what is being watched
 *   GET    /v1/botsapp/bots/sites/search?q=            -> { results }  the sites they can find by name, each with that site's
 *                                                                      OWN sign-in page (src/sites/catalog.ts). Nothing off the
 *                                                                      catalog is ever answered, so no query reaches the open web
 *   POST   /v1/botsapp/bots/sites/watch { url, label } -> { view }    start watching a thing on a site they are signed in to
 *   DELETE /v1/botsapp/bots/sites/watch/:id            -> { view }    stop watching it
 *   POST   /v1/botsapp/bots/sites/check/:id            -> { view }    look now, if the floor allows (the pull-to-refresh)
 *   DELETE /v1/botsapp/bots/sites/:site                -> { view }    forget the slip: sign out of that site here
 *
 * THE PANEL, where a sign-in actually happens (src/sites/panel.ts):
 *
 *   POST   /v1/botsapp/bots/sites/panel { url }        -> PanelView   open their browser at a site's sign-in
 *   GET    /v1/botsapp/bots/sites/panel/:id            -> PanelView   the newest frame, and whether it is over
 *   POST   /v1/botsapp/bots/sites/panel/:id/touch      -> PanelView   { tap:{x,y} } | { type } | { key } | { scroll }
 *   POST   /v1/botsapp/bots/sites/panel/:id/fill       -> PanelView   { field, text }: one box of the card (src/sites/card.ts),
 *                                                                     named by the card and checked against the page first
 *   POST   /v1/botsapp/bots/sites/panel/:id/done       -> PanelView   "I'm signed in": checked, kept, closed
 *   DELETE /v1/botsapp/bots/sites/panel/:id            -> PanelView   they gave up
 *
 * AND THE SAME FOUR, REACHED BY THE PAGE ITSELF (src/sites/panelHost.ts, under /panel/t/:ticket). The panel is drawn
 * by a page the server writes, shown in the app's LiveView — a WebView that cannot see the app's token, because that
 * is in SecureStore behind the Keystore, in a process the page is not in. So the page is given a secret of its own:
 * one panel, nothing else, dead when the panel is. It is never stored, never logged, and never sent to the app.
 *
 * Those four answer with `Access-Control-Allow-Origin: *` and take no cookie. That is safe here precisely BECAUSE
 * the ticket is the whole of the authority: there is no ambient credential for another origin to ride on, and a
 * page that does not have the ticket gets nothing by asking from anywhere. Android's WebView gives a page loaded
 * from HTML-with-a-base-URL an origin that is sometimes opaque, so without this the panel would work on one phone
 * and not the other.
 *
 * THERE IS NO ROUTE THAT SIGNS ANYBODY IN. A session is only ever made by the person signing in themselves, in the panel, and
 * that path is not built yet — so nothing here can be talked into holding a login it was handed over the wire. A route that
 * took a cookie jar as JSON would be the whole security of this feature, written away in one parameter.
 *
 * Everything else these keep: the site is on CLOUD_BROWSER_SITES or it does not exist; a held account (docs/trust.md §actions)
 * is refused and told nothing about why; and `check` is still held to the floor, so leaning on refresh cannot turn one person
 * into a scraper.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SitesView } from "../../../../shared/types/api.js";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { allowedSites, cloudBrowserOn, mayUseCloudBrowser, watchLimits } from "../../sites/gate.js";
import { searchSites } from "../../sites/catalog.js";
import type { Panels } from "../../sites/panel.js";
import { SiteError, type Sites } from "../../sites/service.js";
import { heldFreeUse } from "../../trust/actions.js";
import type { BotsAreaDeps } from "./botsArea.js";

const AREA = "/v1/botsapp/bots";
const OFF = { code: "sites_off", message: "That isn't switched on here." };
const NOT_NOW = { code: "not_now", message: "That can't be done right now. Try again later." };
const LABEL_MAX = 80;
const URL_MAX = 2000;

/** The body as an object, whatever arrived. Module level, because both ways in read a touch out of it. */
const body = (req: FastifyRequest): Record<string, unknown> =>
  (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "").trim();

export function registerSitesRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { sites: Sites; panels?: Panels; now?: () => number }): void {
  const RL = { config: deps.rateLimit };
  const now = o.now ?? Date.now;

  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!cloudBrowserOn()) return reply.code(404).send(OFF);
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      if (!mayUseCloudBrowser(user.id)) return reply.code(404).send(OFF);
      if (heldFreeUse(user.id)) return reply.code(403).send(NOT_NOW);
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) {
        if (err instanceof SiteError) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "sites: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };

  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

  /** Everything the screens draw, from one read. */
  const view = async (userId: string): Promise<SitesView> => {
    const [logins, watches] = await Promise.all([o.sites.logins(userId), o.sites.list(userId)]);
    return { logins, watches, canAdd: allowedSites(), most: watchLimits().most };
  };

  app.get(`${AREA}/sites`, RL, run(async (user) => view(user.id)));

  /**
   * The sites somebody can find by typing a name (src/sites/catalog.ts). It answers entries, each with the site's
   * OWN sign-in page, because the whole point of searching by name is that the name picks the host — a person
   * reading a domain off a result and deciding whether it is the real one is how phishing works. Nothing that is
   * not in the catalog is ever answered here, so there is no query that turns this into a way to the open web.
   */
  app.get(`${AREA}/sites/search`, RL, run(async (user, req) => {
    const q = str((req.query as Record<string, unknown> | undefined)?.q, 64);
    const signedIn = new Set((await o.sites.logins(user.id)).map((l) => l.site));
    // `q` comes back so the screen can tell a search that found nothing from one nobody has run yet.
    return { q, results: searchSites(q).map((e) => ({ id: e.id, name: e.name, host: e.host, signIn: e.signIn, category: e.category, connected: signedIn.has(e.host) })) };
  }));

  app.post(`${AREA}/sites/watch`, RL, run(async (user, req) => {
    const b = body(req);
    await o.sites.watch(user.id, str(b.url, URL_MAX), str(b.label, LABEL_MAX));
    return { view: await view(user.id) };
  }));

  app.delete(`${AREA}/sites/watch/:id`, RL, run(async (user, req) => {
    await o.sites.stop(user.id, param(req, "id"));
    return { view: await view(user.id) };
  }));

  /**
   * Look now. Still held to the floor: `checkOne` reads `nextAt` from the row, so a person leaning on refresh gets the card
   * they already have rather than a site getting a visit a second. The screen says when it was last read, which is the
   * honest answer to "is this current".
   */
  app.post(`${AREA}/sites/check/:id`, RL, run(async (user, req) => {
    const id = param(req, "id");
    const all = await o.sites.list(user.id);
    const mine = all.find((w) => w.id === id);
    if (!mine) throw new SiteError("not_found", "That is not something I am watching.", 404);
    const row = (await o.sites.dueNow(50)).find((w) => w.id === id && w.ownerId === user.id);
    if (row) await o.sites.checkOne(row);
    return { view: await view(user.id) };
  }));

  app.delete(`${AREA}/sites/:site`, RL, run(async (user, req) => {
    await o.sites.signOut(user.id, param(req, "site").toLowerCase());
    return { view: await view(user.id) };
  }));

  // ------------------------------------------------------------ the panel

  // Absent when this server has no browser of its own: the sites screens still draw, and the sign-in simply is not
  // offered, which is honest. A route that existed and always failed would read as a bug.
  const panels = o.panels;
  const needPanels = (): Panels => {
    if (!panels) throw new SiteError("no_browser", "Signing in isn't available on this server.", 503);
    return panels;
  };

  // The ONE answer that carries the ticket, to the person who just opened the panel. The screen writes it straight
  // into the page's HTML and keeps it nowhere: no state path, no cache, no log. Every other answer leaves it out.
  app.post(`${AREA}/sites/panel`, RL, run(async (user, req) => {
    const panels = needPanels();
    const view = await panels.open(user.id, str(body(req).url, URL_MAX));
    const ticket = panels.ticketOf(view.id);
    return ticket ? { ...view, ticket } : view;
  }));

  app.get(`${AREA}/sites/panel/:id`, RL, run(async (user, req) => needPanels().poll(param(req, "id"), user.id)));

  app.post(`${AREA}/sites/panel/:id/touch`, RL, run(async (user, req) => needPanels().touch(param(req, "id"), user.id, oneTouch(req))));

  app.post(`${AREA}/sites/panel/:id/fill`, RL, run(async (user, req) => { const f = oneFill(req); return needPanels().fill(param(req, "id"), user.id, f.field, f.text); }));

  app.post(`${AREA}/sites/panel/:id/done`, RL, run(async (user, req) => needPanels().done(param(req, "id"), user.id)));

  app.delete(`${AREA}/sites/panel/:id`, RL, run(async (user, req) => needPanels().cancel(param(req, "id"), user.id)));

  // ------------------------------------------------------- the panel, as its own page asks

  /**
   * A call from the panel's own page. The ticket names the panel and the panel names the person, so everything the
   * bearer routes check is checked here too — the switch, the allowlist, a held account — just reached differently.
   * Nothing is taken from the caller but the ticket and the touch.
   */
  const byTicket = (fn: (panels: Panels, id: string, userId: string, req: FastifyRequest) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      // Asked from a page whose origin can be opaque; see the note at the top of this file for why that is safe.
      reply.header("access-control-allow-origin", "*");
      reply.header("cache-control", "no-store");
      if (!cloudBrowserOn()) return reply.code(404).send(OFF);
      const panels = o.panels;
      if (!panels) return reply.code(404).send(OFF);
      const id = panels.idForTicket(param(req, "ticket"));
      const userId = id ? panels.ownerOf(id) : null;
      // One answer for a ticket that is wrong, spent, or for a panel that has closed: there is nothing to tell apart.
      if (!id || !userId) return reply.code(404).send({ code: "not_found", message: "That panel isn't open." });
      if (!mayUseCloudBrowser(userId)) return reply.code(404).send(OFF);
      if (heldFreeUse(userId)) return reply.code(403).send(NOT_NOW);
      try {
        return reply.send(await fn(panels, id, userId, req));
      } catch (err) {
        if (err instanceof SiteError) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "sites: panel page request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };

  const TICKET = `${AREA}/sites/panel/t/:ticket`;
  app.get(TICKET, RL, byTicket(async (panels, id, userId) => panels.poll(id, userId)));
  app.post(`${TICKET}/touch`, RL, byTicket(async (panels, id, userId, req) => panels.touch(id, userId, oneTouch(req))));
  app.post(`${TICKET}/fill`, RL, byTicket(async (panels, id, userId, req) => { const f = oneFill(req); return panels.fill(id, userId, f.field, f.text); }));
  app.post(`${TICKET}/done`, RL, byTicket(async (panels, id, userId) => panels.done(id, userId)));
  app.delete(TICKET, RL, byTicket(async (panels, id, userId) => panels.cancel(id, userId)));

  void now;
}

/**
 * One touch a call, and only a shape we recognise: a panel takes a tap, some text, a named key or a scroll, and
 * nothing else is passed through to a real browser. Shared by both ways in, so neither can drift into taking more.
 */
/**
 * One box of the card and what goes in it. The box is named by the card, never by a selector or an address from
 * the caller: the only ids that work are the ones the card already offered, and the panel checks the page still
 * has that kind of box there before a character is typed.
 */
function oneFill(req: FastifyRequest): { field: string; text: string } {
  const b = body(req);
  const field = typeof b.field === "string" ? b.field.trim() : "";
  if (!/^e[0-9]{1,4}$/.test(field)) return failFill();
  if (typeof b.text !== "string") return failFill();
  return { field, text: b.text.slice(0, 200) };
}
const failFill = (): never => { throw new SiteError("bad_fill", "That isn't a box on this page.", 400); };

function oneTouch(req: FastifyRequest): { tap?: { x: number; y: number }; type?: string; key?: "Enter" | "Backspace" | "Tab"; scroll?: number } {
  const b = body(req);
  const tap = (b.tap ?? null) as { x?: unknown; y?: unknown } | null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : -1);
  if (tap && n(tap.x) >= 0 && n(tap.y) >= 0) return { tap: { x: n(tap.x), y: n(tap.y) } };
  if (typeof b.type === "string" && b.type) return { type: b.type.slice(0, 200) };
  if (b.key === "Enter" || b.key === "Backspace" || b.key === "Tab") return { key: b.key };
  if (typeof b.scroll === "number" && Number.isFinite(b.scroll)) return { scroll: Math.max(-2000, Math.min(2000, Math.round(b.scroll))) };
  throw new SiteError("bad_touch", "That isn't something I can do on the page.", 400);
}
