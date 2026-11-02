/**
 * The files Apple and Google read to open x0bot.com links in the apps.
 */

import type { FastifyInstance } from "fastify";

export function registerWellKnownRoutes(app: FastifyInstance): void {
  // --- Universal Links / App Links (AASA + assetlinks) -----------------------
  // Apple + Google fetch these from the naked domain to verify the app owns the
  // URL space. We serve them from the backend and expect Caddy to proxy
  // app.x0bot.com + app.tailzu.space through to this container (deploy/Caddyfile,
  // docs/domain-x0bot.md), and the site on Vercel (x0bot.com, tailzu.space) to
  // proxy /.well-known/* here. Any Host header works; the content is static.
  //
  // AASA must be served with application/json AND no redirect. Cache is short
  // so an app-id or path change goes live within a day.
  const AASA_JSON = JSON.stringify({
    applinks: {
      apps: [],
      details: [
        {
          appIDs: ["6552H8HYA4.com.tulmi.app"],
          components: [
            { "/": "/s/*" },
            { "/": "/screen/*" },
            { "/": "/paywall*" },
            { "/": "/invite/*" },
          ],
        },
      ],
    },
    webcredentials: {
      apps: ["6552H8HYA4.com.tulmi.app"],
    },
  });

  app.get("/.well-known/apple-app-site-association", async (_req, reply) => {
    reply.type("application/json");
    reply.header("Cache-Control", "public, max-age=3600");
    return AASA_JSON;
  });

  // Some older docs point iOS at the naked path — serve there too as an alias.
  app.get("/apple-app-site-association", async (_req, reply) => {
    reply.type("application/json");
    reply.header("Cache-Control", "public, max-age=3600");
    return AASA_JSON;
  });

  app.get("/.well-known/assetlinks.json", async (_req, reply) => {
    reply.type("application/json");
    reply.header("Cache-Control", "public, max-age=3600");
    return [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.tulmi.app",
          sha256_cert_fingerprints: [
            process.env.ANDROID_SIGNING_SHA256 ||
              "REPLACE_WITH_PRODUCTION_SIGNING_SHA256_FINGERPRINT",
          ],
        },
      },
    ];
  });
}
