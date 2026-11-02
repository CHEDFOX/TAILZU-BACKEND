/**
 * GET /healthz and GET /readyz: liveness, and readiness with the upstreams pinged.
 */

import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "../../../shared/types/api.js";
import { VERSION, type AppConfig } from "../config.js";

export interface HealthRouteDeps {
  cfg: AppConfig;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDeps): void {
  const { cfg } = deps;
  // --- Health -----------------------------------------------------------------

  // /healthz — liveness only. Cheap, no upstream calls. Used by Docker HEALTHCHECK.
  app.get("/healthz", async (): Promise<HealthResponse> => {
    return { status: "ok", service: "tulmi-backend", version: VERSION };
  });

  // /readyz — readiness. Pings the upstreams the pipeline depends on so an
  // orchestrator (or operator) can tell "process alive" from "actually serving".
  // Cached for 5 s so a flood of probes can't push us into upstream rate limits.
  type Readiness = { name: string; ok: boolean; detail?: string };
  let readyCache: { at: number; status: number; body: unknown } | null = null;
  const READY_CACHE_MS = 5_000;

  async function pingHead(url: string, timeoutMs = 1500): Promise<Readiness> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "HEAD", signal: ctl.signal });
      // 2xx-4xx all mean the host is reachable; 5xx means upstream is sick.
      return { name: url, ok: res.status < 500, detail: `HTTP ${res.status}` };
    } catch (err) {
      return { name: url, ok: false, detail: (err as Error).message };
    } finally {
      clearTimeout(t);
    }
  }

  app.get("/readyz", async (_req, reply) => {
    const now = Date.now();
    if (readyCache && now - readyCache.at < READY_CACHE_MS) {
      return reply.code(readyCache.status).send(readyCache.body);
    }
    const checks: Readiness[] = [];
    checks.push(await pingHead("https://openrouter.ai/api/v1/models"));
    if (cfg.SUPABASE_URL) {
      checks.push(await pingHead(`${cfg.SUPABASE_URL}/auth/v1/health`));
    } else {
      checks.push({ name: "supabase", ok: cfg.DEV_SKIP_AUTH, detail: "not configured (DEV_SKIP_AUTH)" });
    }
    const allOk = checks.every((c) => c.ok);
    const status = allOk ? 200 : 503;
    const body = {
      status: allOk ? "ready" : "degraded",
      service: "tulmi-backend",
      version: VERSION,
      checks,
    };
    readyCache = { at: now, status, body };
    return reply.code(status).send(body);
  });
}
