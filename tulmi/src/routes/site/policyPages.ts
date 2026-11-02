/**
 * The legal pages: /privacy, /terms, /support, /pricing, and /policies.json for the apps.
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config.js";
import { PAYWALL_CONFIG } from "../../experience/phone/paywall.js";
import { POLICY } from "../../experience/policy.js";
import { sitePage } from "./demo.js";
import { pricingHtml } from "./policies/pricing.js";
import { PRIVACY_POLICY_HTML, PRIVACY_POLICY_EFFECTIVE } from "./policies/privacy.js";
import { SUPPORT_HTML } from "./policies/support.js";
import { TERMS_HTML, TERMS_EFFECTIVE } from "./policies/terms.js";

export interface PolicyPageRouteDeps {
  cfg: AppConfig;
}

export function registerPolicyPageRoutes(app: FastifyInstance, deps: PolicyPageRouteDeps): void {
  const { cfg } = deps;
  // --- Public policies (linked from App Store Connect + in-app Settings) -----
  // Served as HTML directly from the backend so the URL never breaks even if
  // the marketing site is down. Cache-controlled for 1h; edits go live within
  // that window after a redeploy. If a shorter turnaround is ever needed, bump
  // the cache-version and clients will refetch.

  app.get("/privacy", async (_req, reply) => {
    // The published site wins; this file's copy is the fallback, so the legal
    // text is never unreachable even if the site directory is empty.
    const published = sitePage(cfg.SITE_DIR, "privacy");
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", published ? "public, max-age=60" : "public, max-age=3600");
    return published ?? PRIVACY_POLICY_HTML;
  });

  app.get("/terms", async (_req, reply) => {
    const published = sitePage(cfg.SITE_DIR, "terms");
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", published ? "public, max-age=60" : "public, max-age=3600");
    return published ?? TERMS_HTML;
  });

  // How to reach us, and quick answers (x0bot.com/support). Served like the two
  // above: the published site first, this repo's copy as the fallback.
  app.get("/support", async (_req, reply) => {
    const published = sitePage(cfg.SITE_DIR, "support");
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", published ? "public, max-age=60" : "public, max-age=3600");
    return published ?? SUPPORT_HTML;
  });

  // The prices, on a page of their own (x0bot.com/pricing), linked from the
  // site's footer rather than set on the landing page. Built from the paywall's
  // plans and the allowance the server enforces, so the three never disagree.
  app.get("/pricing", async (_req, reply) => {
    const published = sitePage(cfg.SITE_DIR, "pricing");
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=300");
    return published ?? pricingHtml({
      free: cfg.FREE_FOR_ALL,
      plans: PAYWALL_CONFIG.plans,
      freeWords: cfg.FREE_MONTHLY_WORDS,
      earnMaxWords: cfg.EARN_MAX_WORDS,
      terms: POLICY.terms,
      privacy: POLICY.privacy,
    });
  });

  // Machine-readable policy metadata — Apple's App Privacy questionnaire + any
  // automated review tooling can pull effective dates from here.
  app.get("/policies.json", async () => {
    return {
      privacy: {
        url: "https://x0bot.com/privacy",
        effective: PRIVACY_POLICY_EFFECTIVE,
      },
      terms: {
        url: "https://x0bot.com/terms",
        effective: TERMS_EFFECTIVE,
      },
    };
  });
}
