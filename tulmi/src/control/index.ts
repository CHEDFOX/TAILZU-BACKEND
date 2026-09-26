/**
 * The control plane's wiring: the store, the hook every payload route calls
 * on its way out, and the admin API the console (GET /admin) drives.
 *
 * Admin API — every call needs the x-admin-secret header (ADMIN_SECRET):
 *   GET    /v1/admin/control                 live rules, version, last error
 *   PUT    /v1/admin/control                 replace all rules  { rules }
 *   PUT    /v1/admin/control/rules/:id       add or replace one rule
 *   DELETE /v1/admin/control/rules/:id       remove one rule
 *   GET    /v1/admin/control/history         saved versions, newest first
 *   GET    /v1/admin/control/versions/:v     one saved version
 *   POST   /v1/admin/control/rollback        { version } — make it live again
 *   POST   /v1/admin/control/preview         build a payload as any target:
 *            { surface, screen?, ctx?, draft?, authorization? }
 *            → { base, result, applied }   (base = before rules)
 *
 * Every save bumps the SDUI cache version, so apps drop cached screens on
 * their next launch; the keyboard picks changes up on its next config fetch.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { applyRules, RuleSchema, SURFACES, type Applied, type ControlCtx, type Rule, type Surface } from "./rules.js";
import { ControlStore } from "./store.js";
import { CONSOLE_HTML } from "./console.js";

let store: ControlStore | null = null;
let adminSecret: () => string | undefined = () => undefined;

export function initControl(opts: { dir: string; adminSecret: () => string | undefined; recheckMs?: number }): ControlStore {
  store = new ControlStore(opts.dir, opts.recheckMs);
  adminSecret = opts.adminSecret;
  return store;
}
export function controlStore(): ControlStore | null { return store; }

function isAdmin(req: FastifyRequest): boolean {
  const expected = adminSecret();
  const got = req.headers["x-admin-secret"];
  if (!expected || typeof got !== "string" || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : undefined;
}

/**
 * The hook. Every route that sends a client payload passes it through here
 * with what it knows about the request. Admin preview requests may add:
 *   x-control-ctx    JSON — targeting fields to pretend (userId, locale…)
 *   x-control-off    "1" — skip the rules (the "before" of a preview)
 *   x-control-draft  JSON — a rule to try as if saved
 * and get back x-control-applied: what each rule did.
 */
export function withControl<T>(req: FastifyRequest, reply: FastifyReply, payload: T, ctx: ControlCtx): T {
  if (!store) return payload;
  let rules: readonly Rule[] = store.rules();
  let c = ctx;
  const admin = isAdmin(req);
  if (admin) {
    if (header(req, "x-control-off") === "1") return payload;
    const pretend = header(req, "x-control-ctx");
    if (pretend) {
      try { c = { ...ctx, ...(JSON.parse(pretend) as Partial<ControlCtx>), surface: ctx.surface }; } catch { /* ignore */ }
    }
    const draft = header(req, "x-control-draft");
    if (draft) {
      try {
        const d = RuleSchema.parse(JSON.parse(Buffer.from(draft, "base64").toString("utf8")));
        rules = [...rules.filter((r) => r.id !== d.id), d];
      } catch (e) {
        reply.header("x-control-draft-error", encodeURIComponent((e as Error).message).slice(0, 2000));
      }
    }
  }
  try {
    const { payload: out, applied } = applyRules(payload, rules, c);
    if (admin && applied.length) {
      reply.header("x-control-applied", Buffer.from(JSON.stringify(applied)).toString("base64"));
    }
    return out;
  } catch (e) {
    req.log.error({ err: e }, "control: rules failed, payload sent unchanged");
    return payload;
  }
}

// ------------------------------------------------------------------- routes

export function registerControlRoutes(app: FastifyInstance, opts: {
  bumpCache: () => string;
  rateLimit?: Record<string, unknown>;
}): void {
  const cfg = opts.rateLimit ? { config: opts.rateLimit } : {};
  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!adminSecret()) {
      reply.code(503).send({ code: "not_configured", message: "ADMIN_SECRET is not set on the server" });
      return false;
    }
    if (!isAdmin(req)) {
      reply.code(401).send({ code: "unauthorized", message: "Bad or missing admin secret" });
      return false;
    }
    if (!store) {
      reply.code(503).send({ code: "no_store", message: "The control store is not initialised" });
      return false;
    }
    return true;
  };
  const by = (req: FastifyRequest) => header(req, "x-admin-name")?.slice(0, 60) || "admin";
  const saved = (doc: { version: number }) => ({ ok: true, version: doc.version, cacheVersion: opts.bumpCache() });

  app.get("/admin", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'");
    return reply.type("text/html; charset=utf-8").send(CONSOLE_HTML);
  });

  app.get("/v1/admin/control", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    const doc = store!.current();
    return reply.send({ ...doc, lastError: store!.lastError, surfaces: SURFACES });
  });

  app.put("/v1/admin/control", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    const body = (req.body ?? {}) as { rules?: unknown };
    const parsed = RuleSchema.array().safeParse(body.rules);
    if (!parsed.success) return reply.code(400).send({ code: "invalid", issues: parsed.error.issues });
    const ids = parsed.data.map((r) => r.id);
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ code: "invalid", message: "duplicate rule ids" });
    return reply.send(saved(store!.save(parsed.data, by(req))));
  });

  app.put("/v1/admin/control/rules/:id", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = RuleSchema.safeParse({ ...(req.body as object), id });
    if (!parsed.success) return reply.code(400).send({ code: "invalid", issues: parsed.error.issues });
    return reply.send(saved(store!.put(parsed.data, by(req))));
  });

  app.delete("/v1/admin/control/rules/:id", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    const doc = store!.remove((req.params as { id: string }).id, by(req));
    if (!doc) return reply.code(404).send({ code: "not_found" });
    return reply.send(saved(doc));
  });

  app.get("/v1/admin/control/history", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    return reply.send({ versions: store!.history(100) });
  });

  app.get("/v1/admin/control/versions/:v", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    const doc = store!.version(Number((req.params as { v: string }).v));
    if (!doc) return reply.code(404).send({ code: "not_found" });
    return reply.send(doc);
  });

  app.post("/v1/admin/control/rollback", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    const v = Number((req.body as { version?: unknown })?.version);
    const doc = Number.isInteger(v) ? store!.rollback(v, by(req)) : null;
    if (!doc) return reply.code(404).send({ code: "not_found", message: `no version ${v}` });
    return reply.send(saved(doc));
  });

  /**
   * Build a payload exactly as a client would get it, by calling the real
   * route in-process, once without rules and once with them.
   */
  app.post("/v1/admin/control/preview", cfg, async (req, reply) => {
    if (!guard(req, reply)) return;
    const b = (req.body ?? {}) as {
      surface?: Surface; screen?: string; ctx?: Partial<ControlCtx>; draft?: unknown; authorization?: string;
    };
    const surface = b.surface;
    if (!surface || !SURFACES.includes(surface)) return reply.code(400).send({ code: "invalid", message: "surface?" });
    const ctx = b.ctx ?? {};
    const platform = ctx.platform ?? (surface === "site" ? "web" : "ios");
    const headers: Record<string, string> = { "x-admin-secret": header(req, "x-admin-secret")!, "content-type": "application/json" };
    if (b.authorization) headers["authorization"] = b.authorization;
    let method: "GET" | "POST" = "GET", url = "/v1/site", payload: string | undefined;
    if (surface === "bootstrap" || surface === "screen") {
      method = "POST";
      const capabilities = {
        platform: platform === "desktop" ? "web" : platform,
        appVersion: ctx.appVersion, bundle: ctx.bundle,
        device: { formFactor: ctx.formFactor ?? (platform === "desktop" ? "desktop" : "phone") },
      };
      url = surface === "bootstrap" ? "/v1/app/bootstrap" : "/v1/app/screen";
      payload = JSON.stringify(surface === "bootstrap"
        ? { capabilities }
        : { screenId: b.screen ?? "home", platform: capabilities.platform, capabilities });
    } else if (surface === "keyboard") {
      url = "/v1/keyboard/config";
      headers["user-agent"] = platform === "android" ? "okhttp/4 TailzuKeyboard" : "TailzuKeyboard CFNetwork Darwin";
      if (ctx.build !== undefined) headers["x-tulmi-keyboard-build"] = `K${ctx.build}`;
    }
    headers["x-control-ctx"] = JSON.stringify(ctx);
    if (b.draft !== undefined) headers["x-control-draft"] = Buffer.from(JSON.stringify(b.draft)).toString("base64");
    const [base, result] = await Promise.all([
      app.inject({ method, url, headers: { ...headers, "x-control-off": "1" }, payload }),
      app.inject({ method, url, headers, payload }),
    ]);
    const decode = (h: unknown): Applied[] => {
      if (typeof h !== "string") return [];
      try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")) as Applied[]; } catch { return []; }
    };
    const draftError = result.headers["x-control-draft-error"];
    return reply.send({
      status: result.statusCode,
      base: safeJson(base.body),
      result: safeJson(result.body),
      applied: decode(result.headers["x-control-applied"]),
      ...(typeof draftError === "string" ? { draftError: decodeURIComponent(draftError) } : {}),
    });
  });
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
