/**
 * The website's own endpoints: the /download page and the site's event beacon.
 */

import type { FastifyInstance } from "fastify";
import { siteEventsScript, siteEvent } from "../ads/meta.js";
import type { AppConfig } from "../config.js";
import { sitePage } from "./demo.js";
import { DOWNLOAD_PAGE_HTML } from "./download.js";

export interface SitePageRouteDeps {
  cfg: AppConfig;
}

export function registerSitePageRoutes(app: FastifyInstance, deps: SitePageRouteDeps): void {
  const { cfg } = deps;
  // OS-aware desktop-app download page (x0bot.com/download). The page itself
  // HEAD-checks /downloads/* so platforms without a published installer show as
  // "coming soon" instead of a dead link.
  app.get("/download", async (_req, reply) => {
    const published = sitePage(cfg.SITE_DIR, "download");
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", published ? "public, max-age=60" : "public, max-age=3600");
    return published ?? DOWNLOAD_PAGE_HTML;
  });

  // META: the pixel and the server's copy of what it reports (src/ads/meta.ts),
  // for pages opened on api.x0bot.com. On x0bot.com Vercel answers both
  // itself (tailzu-web/api), with the dataset id from Vercel's settings. The
  // script is empty while there is no dataset id, so the pages can carry its
  // tag before Meta is set up.
  app.get("/site-events.js", async (_req, reply) => {
    reply.type("application/javascript; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=300");
    return siteEventsScript();
  });
  app.post("/v1/site/event", { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (req, reply) => {
    // A beacon: the page is already on its way to the store or the installer,
    // and nothing waits for this answer.
    siteEvent(req, req.body);
    return reply.code(204).send();
  });
}
