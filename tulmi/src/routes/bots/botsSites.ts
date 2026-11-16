/**
 * A BROWSER THAT BELONGS TO THE PERSON (src/sites, migration 0098, docs/sites.md). Launch dark: every route here answers 404
 * while CLOUD_BROWSER is off, which is the default.
 *
 *   GET    /v1/botsapp/bots/sites                      -> SitesView   what they are signed in to, what is being watched
 *   POST   /v1/botsapp/bots/sites/watch { url, label } -> { view }    start watching a thing on a site they are signed in to
 *   DELETE /v1/botsapp/bots/sites/watch/:id            -> { view }    stop watching it
 *   POST   /v1/botsapp/bots/sites/check/:id            -> { view }    look now, if the floor allows (the pull-to-refresh)
 *   DELETE /v1/botsapp/bots/sites/:site                -> { view }    forget the slip: sign out of that site here
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
import { SiteError, type Sites } from "../../sites/service.js";
import { heldFreeUse } from "../../trust/actions.js";
import type { BotsAreaDeps } from "./botsArea.js";

const AREA = "/v1/botsapp/bots";
const OFF = { code: "sites_off", message: "That isn't switched on here." };
const NOT_NOW = { code: "not_now", message: "That can't be done right now. Try again later." };
const LABEL_MAX = 80;
const URL_MAX = 2000;

export function registerSitesRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { sites: Sites; now?: () => number }): void {
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

  const body = (req: FastifyRequest): Record<string, unknown> =>
    (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
  const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "").trim();
  const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

  /** Everything the screens draw, from one read. */
  const view = async (userId: string): Promise<SitesView> => {
    const [logins, watches] = await Promise.all([o.sites.logins(userId), o.sites.list(userId)]);
    return { logins, watches, canAdd: allowedSites(), most: watchLimits().most };
  };

  app.get(`${AREA}/sites`, RL, run(async (user) => view(user.id)));

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

  void now;
}
