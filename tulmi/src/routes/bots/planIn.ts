/**
 * Plan Ease, steps 2 and 3: the work calendar by its link, and getting things in (botsBots/planLinks.ts, planCapture.ts, planDue.ts;
 * docs/plan-ease.md). Everything is the signed-in person's own, and bodies and links are never logged.
 *
 *   GET    /v1/botsapp/bots/plan/links                 -> { links }                   what the link page lists (never an address)
 *   POST   /v1/botsapp/bots/plan/links { url | code, tz }  -> { link, line }          a pasted link, or x0bot.com/cal's 6-number code
 *   DELETE /v1/botsapp/bots/plan/links/:id             -> { ok }                      taken off, its meetings with it
 *   GET    /v1/botsapp/bots/plan/linked/:ref?tz=       -> { meeting }                 one work meeting, for its details
 *   POST   /v1/botsapp/bots/plan/capture/look { files, text, from, tz }  -> { capture } | { plan: false }   the share-in screen's ask
 *   GET    /v1/botsapp/bots/plan/capture/:id           -> { capture }                 the card (looking at it counts)
 *   POST   /v1/botsapp/bots/plan/capture/:id/toggle { item }   -> { capture }
 *   PUT    /v1/botsapp/bots/plan/capture/:id/items/:item { title, day, time, who }   -> { capture }
 *   GET    /v1/botsapp/bots/plan/capture/:id/who       -> { people }                  who in their family spaces a row can be given to
 *   GET    /v1/botsapp/bots/plan/pay/:taskId           -> { url }                     a bill's safe pay link (a notification's Pay)
 *   (Add all, Undo, Paid and "No thanks" answer at POST /v1/widgets/act: pc:, pt:, pl: items, botsBots/planInActs.ts)
 *
 *   GET    /cal          x0bot.com/cal, on a computer, no sign-in: one field for the link
 *   POST   /cal          the link kept sealed for 15 minutes under a 6-number code, shown big; nothing is read until a signed-in phone
 *                        types it. No script runs; nothing is loaded from anyone but the fonts.
 *
 * Off (404 plan_v2_off) while PLAN_V2_LINKS or PLAN_V2_CAPTURE is off; the share-in screen's ask answers { plan: false } then, so the
 * bot picker is as it was.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { BotError, isBotError } from "../../bots/index.js";
import type { PlanEase } from "../../botsBots/planEase.js";
import { wirePlanIn } from "../../botsBots/planInWire.js";
import { lookOf } from "../../botsBots/personLook.js";
import { planOn, type PlanStep } from "../../botsBots/planSwitch.js";
import { spacesOn } from "../../botsBots/spacesSwitch.js";
import { pushEngine } from "../../push/index.js";
import type { BotsAreaDeps } from "./botsArea.js";
import type { SpaceParts } from "./botsSpaces.js";
import { calPageHtml, CAL_CSP } from "../site/calPage.js";

const AREA = "/v1/botsapp/bots/plan";
type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");
const tzOf = (v: unknown): number => { const t = Number(v); return Number.isFinite(t) ? Math.max(-720, Math.min(840, Math.round(t))) : 330; };

export function registerPlanInRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { ease: PlanEase; spaces?: SpaceParts | null }): void {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const media = deps.media;
  const sp = o.spaces ?? null;
  const send = async (userId: string, msg: { kind: string; key: string; vars: Record<string, string>; data?: Record<string, string>; category?: string }) =>
    pushEngine()?.notify(userId, msg as Parameters<NonNullable<ReturnType<typeof pushEngine>>["notify"]>[1]);
  const wired = wirePlanIn({
    ease: o.ease, send, log: app.log,
    capture: {
      files: media ? {
        get: (userId, id) => media.store.get(userId, id),
        bytes: (item) => media.bytesOf(item),
        remove: (userId, id) => media.remove(userId, id),
      } : null,
      ...(deps.bots ? {
        spend: (userId: string, paise: number) => deps.bots!.spendToday(userId, "plan", paise),
        leftToday: (userId: string) => deps.bots!.leftToday(userId, "plan"),
      } : {}),
      ...(sp ? {
        giveTask: async (userId: string, spaceId: string, b: Record<string, unknown>) => ({ id: (await sp.tasks.create(userId, spaceId, b)).id }),
        takeBackTask: (userId: string, spaceId: string, taskId: string) => sp.tasks.remove(userId, spaceId, taskId),
      } : {}),
    },
  });
  app.addHook("onClose", async () => { wired.stop(); });
  const { links, capture } = wired;

  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
    req.log.error({ err: (err as Error)?.name }, "plan ease: request failed");
    return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
  };
  /** A route for the signed-in person, while its step is on. */
  const run = (step: PlanStep, fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      if (!planOn(step)) return reply.code(404).send({ code: "plan_v2_off", message: "That isn't switched on here." });
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) { return fail(req, reply, err); }
    };

  // ------------------------------------------------------------------ the work calendar

  app.get(`${AREA}/links`, RL, run("links", async (user) => ({ links: await links.list(user.id) })));

  app.post(`${AREA}/links`, tight(10), run("links", async (user, req) => {
    const b = bodyOf(req.body);
    const said = typeof b.code === "string" ? b.code : typeof b.url === "string" ? b.url : "";
    // Six numbers are x0bot.com/cal's code; anything else is the link itself.
    const r = /^\s*\d{3}\s?\d{3}\s*$/.test(said) ? await links.claim(user.id, said, tzOf(b.tz), req.ip || null) : await links.add(user.id, said, tzOf(b.tz));
    return { link: r.link, line: "Linked. Your meetings show here now." };
  }));

  app.delete(`${AREA}/links/:id`, RL, run("links", async (user, req) => { await links.remove(user.id, param(req, "id")); return { ok: true }; }));

  app.get(`${AREA}/linked/:ref`, RL, run("links", async (user, req) => {
    const m = await links.meeting(user.id, param(req, "ref"), tzOf((req.query as Body | undefined)?.tz));
    if (!m) throw new BotError("not_found", "That meeting isn't on your work calendar any more.", 404);
    return { meeting: { title: m.title, day: m.day, start: m.start, end: m.end, allDay: m.allDay, where: m.where, place: m.place, people: m.people, provider: m.provider } };
  }));

  // ------------------------------------------------------------------ getting things in

  app.post(`${AREA}/capture/look`, tight(30), async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    // Off: the share screen's bot picker, as it was.
    if (!planOn("capture")) return reply.send({ plan: false });
    const b = bodyOf(req.body);
    try {
      const files = Array.isArray(b.files) ? b.files.filter((x): x is string => typeof x === "string").slice(0, 4) : [];
      return reply.send(await capture.look(user.id, { files, ...(typeof b.text === "string" ? { text: b.text } : {}), ...(b.from === "plan" ? { from: "plan" } : {}), tz: tzOf(b.tz) }));
    } catch (err) { return fail(req, reply, err); }
  });

  app.get(`${AREA}/capture/:id`, RL, run("capture", async (user, req) => ({ capture: await capture.view(user.id, param(req, "id")) })));
  app.post(`${AREA}/capture/:id/toggle`, RL, run("capture", async (user, req) => ({ capture: await capture.toggle(user.id, param(req, "id"), bodyOf(req.body).item) })));
  app.put(`${AREA}/capture/:id/items/:item`, RL, run("capture", async (user, req) => ({ capture: await capture.edit(user.id, param(req, "id"), param(req, "item"), bodyOf(req.body)) })));

  app.get(`${AREA}/capture/:id/who`, RL, run("capture", async (user) => {
    // The people in the spaces where they may give tasks (a family space), each once, as their tiny bot. Never anyone else.
    if (!sp || !spacesOn()) return { people: [] };
    const out = new Map<string, { id: string; name: string; spaceId: string; look: ReturnType<typeof lookOf> }>();
    for (const s of (await sp.spaces.mine(user.id).catch(() => [])).filter((x) => x.perms.includes("tasks")).slice(0, 5)) {
      for (const m of await sp.spaces.membersOf(s.id).catch(() => [])) {
        if (m.userId !== user.id && !out.has(m.userId)) out.set(m.userId, { id: m.userId, name: m.name, spaceId: s.id, look: lookOf(m.userId) });
      }
    }
    return { people: [...out.values()].slice(0, 12) };
  }));

  app.get(`${AREA}/pay/:taskId`, RL, run("capture", async (user, req) => {
    const t = await o.ease.calendar.task(user.id, param(req, "taskId"));
    if (t.kind !== "due" || !t.payLink || t.done) throw new BotError("not_found", "There's nothing to pay here.", 404);
    return { url: t.payLink };
  }));

  // ------------------------------------------------------------------ x0bot.com/cal (on a computer, no sign-in)

  void app.register(async (page) => {
    // A form's body, here only: one field, a few kilobytes at most.
    page.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 8 * 1024 }, (_req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (err) { done(err as Error, undefined); }
    });
    const html = (reply: FastifyReply, o2: Parameters<typeof calPageHtml>[0]) => {
      reply.header("Content-Security-Policy", CAL_CSP);
      reply.header("Referrer-Policy", "no-referrer");
      reply.header("X-Robots-Tag", "noindex");
      reply.header("Cache-Control", "no-store");
      reply.type("text/html; charset=utf-8");
      return calPageHtml(o2);
    };
    page.get("/cal", async (_req, reply) => html(reply, { on: planOn("links") }));
    page.post("/cal", { config: { rateLimit: { max: Math.min(10, deps.rateLimit.rateLimit.max), timeWindow: 15 * 60_000 } } }, async (req, reply) => {
      if (!planOn("links")) return html(reply, { on: false });
      const link = bodyOf(req.body).link;
      try {
        const code = await links.codeFor(link);
        return html(reply, { on: true, code });
      } catch (err) {
        return html(reply, { on: true, wrong: isBotError(err) ? err.message : "Couldn't keep that just now. Try again in a minute." });
      }
    });
  });
}
