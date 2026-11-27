/**
 * WHAT A PERSON'S ORDERS ON A SITE SAY ABOUT THEM, AND AN ORDER MADE FROM IT (src/sites/history, migration 0114,
 * docs/site-portrait.md). Launch dark with the rest of sites: every route answers 404 while CLOUD_BROWSER is off.
 *
 *   GET    /v1/botsapp/bots/sites/portraits                 -> { portraits, readers }   every site they have orders on, and
 *                                                                                       the orders pages this phone should read
 *   GET    /v1/botsapp/bots/sites/portrait/:site            -> { portrait, reader? }    one site's
 *   POST   /v1/botsapp/bots/sites/history/:site/read { url, title, text, elements }
 *                                                           -> { outcome, added }      the orders page, read on the phone
 *   DELETE /v1/botsapp/bots/sites/history/:site             -> { ok }                  forget everything learned there
 *   POST   /v1/botsapp/bots/sites/did { site, ref, title, line? } -> { ok }             a cart filled on the phone, for "Done for you"
 *   POST   /v1/botsapp/bots/sites/order/plan { words, tz }  -> { options, line }       what X0 would order for them now
 *
 * There is no route that places an order. An order is a screen (screens/sites/order.ts) that opens the site on their
 * phone and fills the cart while they watch; they pay on the site, as themselves.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { cloudBrowserOn, mayUseCloudBrowser } from "../../sites/gate.js";
import { readOrderAsk } from "../../sites/history/ask.js";
import { planLine, planOrder } from "../../sites/history/plan.js";
import type { SiteHistories } from "../../sites/history/service.js";
import { SiteError } from "../../sites/service.js";
import { heldFreeUse } from "../../trust/actions.js";
import type { BotsAreaDeps } from "./botsArea.js";
import type { DidView, SitePortrait } from "../../sites/history/types.js";

const AREA = "/v1/botsapp/bots/sites";
const OFF = { code: "sites_off", message: "That isn't switched on here." };
const NOT_NOW = { code: "not_now", message: "That can't be done right now. Try again later." };

const body = (req: FastifyRequest): Record<string, unknown> =>
  (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "").trim().toLowerCase();
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** What the watcher saw arrive (src/sites/service.ts list): a delivery is something done for them too. */
export type WatchesOf = (userId: string) => Promise<Array<{ site: string; label: string; state: string; card?: { title: string; line: string }; readAt?: number }>>;

/** A portrait with the deliveries the watcher saw through on that site among what was done, newest first. */
async function withArrivals(p: SitePortrait, userId: string, watches?: WatchesOf): Promise<SitePortrait> {
  if (!watches) return p;
  const arrived: DidView[] = (await watches(userId).catch(() => [])).filter((w) => w.site === p.site && w.state === "done")
    .map((w) => ({ kind: "arrived" as const, title: `Kept an eye on ${w.card?.title || w.label} until it arrived`, ...(w.card?.line ? { line: w.card.line } : {}), at: w.readAt ?? 0 }));
  if (!arrived.length) return p;
  return { ...p, did: [...(p.did ?? []), ...arrived].sort((a, b) => b.at - a.at).slice(0, 8) };
}

export function registerSiteHistoryRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { histories: SiteHistories; watches?: WatchesOf; now?: () => number }): void {
  const RL = { config: deps.rateLimit };
  const now = o.now ?? Date.now;

  const run = (fn: (user: AuthedUser, req: FastifyRequest) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!cloudBrowserOn()) return reply.code(404).send(OFF);
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      if (!mayUseCloudBrowser(user.id)) return reply.code(404).send(OFF);
      if (heldFreeUse(user.id)) return reply.code(403).send(NOT_NOW);
      try {
        return reply.send((await fn(user, req)) ?? { ok: true });
      } catch (err) {
        if (err instanceof SiteError) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "site history: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };

  app.get(`${AREA}/portraits`, RL, run(async (user) => {
    const [portraits, readers] = await Promise.all([o.histories.portraits(user.id), o.histories.readers(user.id)]);
    return { portraits: await Promise.all(portraits.map((p) => withArrivals(p, user.id, o.watches))), readers };
  }));

  app.get(`${AREA}/portrait/:site`, RL, run(async (user, req) => {
    const site = param(req, "site");
    const [raw, readers] = await Promise.all([o.histories.portrait(user.id, site), o.histories.readers(user.id)]);
    const portrait = await withArrivals(raw, user.id, o.watches);
    const reader = readers.find((r) => r.site === portrait.site);
    return { portrait, ...(reader ? { reader } : {}) };
  }));

  // The orders page, as the phone read it: held to the same sizes the watch's read is (botsSites.ts).
  app.post(`${AREA}/history/:site/read`, RL, run(async (user, req) => {
    const b = body(req);
    const elements = Array.isArray(b.elements) ? (b.elements as unknown[]).slice(0, 400).flatMap((e) => {
      const x = (e ?? {}) as Record<string, unknown>;
      const id = str(x.id, 12), role = str(x.role, 16);
      return id && role ? [{ id, role, ...(str(x.label, 120) ? { label: str(x.label, 120) } : {}) }] : [];
    }) : [];
    return o.histories.phoneRead(user.id, param(req, "site"), {
      finalUrl: str(b.url, 2000), title: str(b.title, 200), text: str(b.text, 20_000), elements,
    });
  }));

  // A cart filled on their phone, as the order screen opened (screens/sites/order.ts). `ref` is the order's own id, so the same
  // order opened twice in a day is one line.
  app.post(`${AREA}/did`, RL, run(async (user, req) => {
    const b = body(req);
    const ref = str(b.ref, 40).replace(/[^a-z0-9-]/gi, ""), title = str(b.title, 120);
    if (!ref || !title) throw new SiteError("bad_request", "That isn't something I did.", 400);
    await o.histories.noteCart(user.id, str(b.site, 120).toLowerCase(), {
      ref, title, ...(str(b.line, 160) ? { line: str(b.line, 160) } : {}), ...(str(b.image, 600) ? { image: str(b.image, 600) } : {}),
    });
    return { ok: true };
  }));

  app.delete(`${AREA}/history/:site`, RL, run(async (user, req) => {
    await o.histories.forget(user.id, param(req, "site"));
    return { ok: true };
  }));

  // What X0 would order now. The same planner Talk uses; words that are no ask to order still get their usual.
  app.post(`${AREA}/order/plan`, RL, run(async (user, req) => {
    const b = body(req);
    const words = str(b.words, 400);
    const tz = typeof b.tz === "number" && Number.isFinite(b.tz) ? Math.max(-720, Math.min(840, Math.round(b.tz))) : 330;
    const ask = readOrderAsk(words) ?? { usual: true, last: false, want: [] };
    const options = planOrder(await o.histories.histories(user.id), ask, now(), tz);
    return { options, line: planLine(options) };
  }));
}
