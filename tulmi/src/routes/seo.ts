/**
 * The pages and files that exist for search and answer engines, served here
 * and through the site's proxy (tailzu-web/vercel.json), so they are
 * canonical at tailzu.space and built from the same facts as everything else
 * (seo/facts.ts).
 *
 *   /languages, /languages/:slug, /faq   pages, in the site's own room
 *   /sitemap.xml, /llms.txt, /llms-full.txt
 *   /robots.txt                           this host only (api.tailzu.space)
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { faqHtml, languagePageHtml, languagesHubHtml } from "../seo/pages.js";
import { API_ROBOTS, llmsFullTxt, llmsTxt, sitemapXml } from "../seo/machine.js";

/** Pages change with a deploy or a price; an hour at the edge is plenty. */
const PAGE_CACHE = "public, max-age=600, s-maxage=3600";

function html(reply: FastifyReply, body: string) {
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", PAGE_CACHE);
  return body;
}

function text(reply: FastifyReply, type: string, body: string) {
  reply.type(`${type}; charset=utf-8`);
  reply.header("Cache-Control", PAGE_CACHE);
  return body;
}

export function registerSeoRoutes(app: FastifyInstance): void {
  app.get("/languages", async (_req, reply) => html(reply, languagesHubHtml()));
  app.get("/languages/:slug", async (req, reply) => {
    const slug = String((req.params as { slug?: string }).slug ?? "").toLowerCase();
    const page = languagePageHtml(slug);
    if (!page) return reply.redirect("/languages", 301);
    return html(reply, page);
  });
  app.get("/faq", async (_req, reply) => html(reply, faqHtml()));

  app.get("/sitemap.xml", async (_req, reply) => text(reply, "application/xml", sitemapXml()));
  app.get("/llms.txt", async (_req, reply) => text(reply, "text/plain", llmsTxt()));
  app.get("/llms-full.txt", async (_req, reply) => text(reply, "text/plain", llmsFullTxt()));
  // tailzu.space serves its own static robots.txt; this one only ever answers
  // for the API host, which must not rank for the pages it proxies.
  app.get("/robots.txt", async (_req, reply) => text(reply, "text/plain", API_ROBOTS));
}
