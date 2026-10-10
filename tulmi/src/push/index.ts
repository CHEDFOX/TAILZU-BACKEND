/**
 * Smart notifications, wired: the engine the server starts after it listens,
 * the admin routes the console uses to see and test it, and the hook the
 * screen route calls when a push was tapped.
 *
 * Admin API — x-admin-secret (ADMIN_SECRET) on every call:
 *   GET  /v1/admin/push/plan?userId=…   what this person would get, when, and why
 *   POST /v1/admin/push/send            { userId, kind? } — send it now, ignoring the clock
 *   POST /v1/admin/push/broadcast       { title, body, screenId?, key?, send? } — everyone, now (dry run unless send: true)
 *   POST /v1/admin/push/tick            { dryRun? } — run one pass now
 *   GET  /v1/admin/push/stats?days=7    sent / opened / failed per reason
 *
 * Tuning lives in the control plane: surface "push", flags push.* and labels
 * push.*.title / .body (see defaults.ts).
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { applyRules } from "../control/rules.js";
import { controlStore, requireAdmin } from "../control/index.js";
import { supabase } from "../auth/supabase.js";
import { PUSH_DEFAULTS, PUSH_KINDS, type PushKind, type PushPayload } from "./defaults.js";
import { ExpoSender, type PushSender } from "./expo.js";
import { PushEngine, type ConfigFor } from "./engine.js";
import { knobsOf } from "./plan.js";
import { rhythm, busiestWeekday, confident } from "./timing.js";
import { SupabasePushStore, type PushStore } from "./store.js";

let engine: PushEngine | null = null;

/** The defaults with the live rules applied for this context. */
export const pushConfig: ConfigFor = (ctx) => {
  const base = structuredClone(PUSH_DEFAULTS) as PushPayload;
  const store = controlStore();
  if (!store) return base;
  try {
    return applyRules(base, store.rules(), { ...ctx, surface: "push" }).payload;
  } catch {
    return base;
  }
};

export function initPush(opts: { accessToken?: string; store?: PushStore; sender?: PushSender } = {}): PushEngine | null {
  const sb = supabase();
  const store = opts.store ?? (sb ? new SupabasePushStore(sb) : null);
  if (!store) return null;
  engine = new PushEngine(store, opts.sender ?? new ExpoSender({ accessToken: opts.accessToken }), pushConfig);
  return engine;
}

export function pushEngine(): PushEngine | null { return engine; }

export function registerPushRoutes(app: FastifyInstance, opts: { rateLimit?: Record<string, unknown> } = {}): void {
  const cfg = opts.rateLimit ? { config: opts.rateLimit } : {};
  const ready = (req: FastifyRequest, reply: FastifyReply): PushEngine | null => {
    if (!requireAdmin(req, reply)) return null;
    if (!engine) {
      reply.code(503).send({ code: "not_configured", message: "Push needs Supabase (SUPABASE_URL + SUPABASE_SERVICE_KEY) and PUSH_ENGINE" });
      return null;
    }
    return engine;
  };

  app.get("/v1/admin/push/plan", cfg, async (req, reply) => {
    const e = ready(req, reply);
    if (!e) return;
    const userId = String((req.query as { userId?: string })?.userId ?? "");
    const now = Date.now();
    const c = await e.candidate(userId, now);
    if (!c) return reply.code(404).send({ code: "not_found", message: "No push token for that user" });
    const { decision, facts, payload } = await e.decide(c, now);
    const k = knobsOf(payload);
    const r = rhythm(facts.moments, now, k.flag("push.smart.halfLifeDays", 14));
    const topHours = Array.from(r.day).map((v, h) => ({ hourUtc: h, weight: Math.round(v * 100) / 100 }))
      .sort((a, b) => b.weight - a.weight).slice(0, 3);
    return reply.send({
      userId,
      platforms: c.tokens.map((t) => t.platform),
      entitled: c.entitled,
      tzOffsetMin: c.tzOffsetMin,
      lastSeenAt: c.lastSeenAt ? new Date(c.lastSeenAt).toISOString() : null,
      rhythm: { events: r.events, days: r.days, confident: confident(r, { minEvents: k.flag("push.smart.minEvents", 5), minDays: k.flag("push.smart.minDays", 3) }), busiestWeekdayUtc: busiestWeekday(r), topHours },
      recent: facts.log.slice(0, 10).map((l) => ({ kind: l.kind, status: l.status, sentAt: l.sentAt ? new Date(l.sentAt).toISOString() : null, opened: l.openedAt !== null })),
      decision: "sendAt" in decision ? { ...decision, sendAt: new Date(decision.sendAt).toISOString() } : decision,
    });
  });

  app.post("/v1/admin/push/send", cfg, async (req, reply) => {
    const e = ready(req, reply);
    if (!e) return;
    const b = (req.body ?? {}) as { userId?: string; kind?: string };
    const now = Date.now();
    const c = b.userId ? await e.candidate(b.userId, now) : null;
    if (!c) return reply.code(404).send({ code: "not_found", message: "No push token for that user" });
    const kind = (PUSH_KINDS as readonly string[]).includes(b.kind ?? "") ? (b.kind as PushKind) : "winback";
    const payload = e.configFor(c, now);
    const k = knobsOf(payload);
    const d = {
      kind, periodKey: `test:${now}`, sendAt: now, basis: "rhythm" as const,
      title: k.label(`push.${kind}.title`, "", { n: 3, words: "1,200" }),
      body: k.label(`push.${kind}.body`, "", { n: 3, words: "1,200" }),
      screenId: k.flag(`push.${kind}.screenId`, "home"),
      ttlSec: 600,
    };
    const res = await e.deliver(c, d, payload, now);
    return reply.send({ ok: !!res?.sent, pushId: res?.id ?? null, title: d.title, body: d.body });
  });

  // One message to everyone, now. A dry run unless send is true.
  app.post("/v1/admin/push/broadcast", cfg, async (req, reply) => {
    const e = ready(req, reply);
    if (!e) return;
    const b = (req.body ?? {}) as { title?: unknown; body?: unknown; screenId?: unknown; key?: unknown; send?: unknown; ignoreQuiet?: unknown };
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 120) : "";
    const body = typeof b.body === "string" ? b.body.trim().slice(0, 240) : "";
    if (!title || !body) return reply.code(400).send({ code: "bad_request", message: "title and body are required" });
    const screenId = typeof b.screenId === "string" && /^[a-z0-9_-]{1,40}$/i.test(b.screenId) ? b.screenId : "stats";
    const key = typeof b.key === "string" && /^[a-z0-9_.:-]{1,60}$/i.test(b.key)
      ? b.key
      : createHash("sha256").update(`${title}\n${body}`).digest("hex").slice(0, 12);
    return reply.send(await e.broadcast({ title, body, screenId, key }, Date.now(), {
      dryRun: b.send !== true,
      ignoreQuiet: b.ignoreQuiet === true,
    }));
  });

  app.post("/v1/admin/push/tick", cfg, async (req, reply) => {
    const e = ready(req, reply);
    if (!e) return;
    const dryRun = (req.body as { dryRun?: unknown })?.dryRun !== false;
    return reply.send(await e.tick(Date.now(), { dryRun }));
  });

  app.get("/v1/admin/push/stats", cfg, async (req, reply) => {
    const e = ready(req, reply);
    if (!e) return;
    const days = Math.min(90, Math.max(1, Number((req.query as { days?: string })?.days) || 7));
    return reply.send({ days, byKind: await e.stats(Date.now(), days) });
  });
}
