/**
 * PLAN EASE'S FOLLOW-THROUGH: ITS ROUTES AND ITS WIRING (PLAN_V2_FOLLOW; botsBots/planFollow.ts, docs/plan-ease.md "Follow-through").
 *
 *   GET  /v1/botsapp/bots/plan/follow/:id        the follow page (FollowView): 404 for anyone not on it
 *   PUT  /v1/botsapp/bots/plan/follow/item       { kind, id, importance?: "auto" | "normal" | "must", people?: [{ id } | { name }] }:
 *                                                 how important an item is and who does it; names or ids not in your X0 people are
 *                                                 not saved, and the answer says so ({ missing, message, invite })
 *   GET  /v1/botsapp/bots/plan/follow/people     ?kind=&id=: who can be on it (you, and your X0 people), and the invite way
 *   PUT  /v1/botsapp/bots/plan/follow/number     { member, phone }: a number you keep for someone, for your own Call button
 *
 * Every answer (Done, Later, Can't, I'll do it, Undone, Allow, Not now) goes through the act door (POST /v1/widgets/act, pf:<id>:<n>).
 *
 * WIRING, at boot: the follow service hears who is in a person's X0 people from messaging itself (threads.ts contacts: the same rules,
 * never a list of its own), a muted chat, a family ask's Done, Plan Ease's six a day; the calendar asks it before each reminder and tells
 * it when a to-do is ticked; an opened push marks its step; its sweep runs every minute.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { isBotError } from "../../bots/index.js";
import type { PlanEase } from "../../botsBots/planEase.js";
import { planFollows, plugFollows } from "../../botsBots/planFollow.js";
import { FOLLOW, isUuid } from "../../botsBots/planFollowWords.js";
import { removePlanSource } from "../../botsBots/planSources.js";
import { followOn } from "../../botsBots/planSwitch.js";
import { spacesOn } from "../../botsBots/spacesSwitch.js";
import { addPushOpenHook } from "../../push/engine.js";
import type { BotsAreaDeps } from "./botsArea.js";
import type { SpaceParts } from "./botsSpaces.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const OFF = { code: "follow_off", message: "That isn't switched on here." };
const GONE = { code: "not_found", message: "That isn't there any more." };

export function registerPlanFollowRoutes(app: FastifyInstance, deps: Pick<BotsAreaDeps, "rateLimit">, o: { spaces: SpaceParts; ease: PlanEase }): void {
  const RL = { config: deps.rateLimit };
  const tight = (max: number) => ({ config: { rateLimit: { max: Math.min(max, deps.rateLimit.rateLimit.max), timeWindow: deps.rateLimit.rateLimit.timeWindow } } });
  const follows = planFollows();
  const { spaces, threads, tasks } = o.spaces;

  follows.wire({
    // Who a person can reach: exactly whom messaging lets them message (threads.ts contacts), only while Spaces is on.
    contacts: async (userId) => (spacesOn() ? (await threads.contacts(userId)).people.map((p) => ({ userId: p.userId, name: p.name })) : []),
    muted: (userId, otherId) => threads.directMuted(userId, otherId),
    spaceDone: async (userId, spaceId, taskId) => { await tasks.answer(userId, spaceId, taskId, { status: "done" }); },
    spend: (userId, day) => o.ease.policy.spend(userId, day),
    log: app.log,
  });
  // The existing way to bring someone in (as the Spaces screens do): a space of yours to invite them to, else Spaces to start one.
  follows.people.wire({
    invite: async (userId) => {
      const own = (await spaces.mine(userId)).find((s) => s.admin);
      return own ? { screen: "bots.space.invite", params: { id: own.id } } : { screen: "bots.spaces" };
    },
  });
  o.ease.wire({ follow: (userId, c) => follows.arm(userId, c) });
  o.ease.calendar.setTickHook((userId, taskId, what) => { void follows.taskTicked(userId, taskId, what).catch(() => undefined); });
  // The push id comes from the phone: only a step that went to that same person is marked opened.
  const unhook = addPushOpenHook((userId, kind, pushId) => {
    if (kind.includes("_follow")) void follows.stepSeen(pushId, "opened", Date.now(), `u:${userId}`).catch(() => undefined);
  });
  plugFollows();
  const stop = follows.start(app.log);
  app.addHook("onClose", async () => {
    stop(); unhook(); o.ease.calendar.setTickHook(null); o.ease.wire({ follow: null }); removePlanSource("follow");
  });

  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]).catch(() => null);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      void reply.header("cache-control", "no-store");
      if (!followOn()) return reply.code(404).send(OFF);
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) {
        if (isBotError(err)) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "follow: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };
  const q = (req: FastifyRequest, k: string): string => { const v = (req.query as Record<string, unknown> | undefined)?.[k]; return typeof v === "string" ? v : ""; };
  const refOf = (kind: unknown, id: unknown): { kind: "event" | "task"; id: string } | null =>
    (kind === "event" || kind === "task") && typeof id === "string" && /^[0-9a-f-]{36}(?:@\d{4}-\d{2}-\d{2})?$/i.test(id) ? { kind, id } : null;

  app.get(`${FOLLOW}/people`, RL, run(async (user, req, reply) => {
    const kind = q(req, "kind"), id = q(req, "id");
    if (!kind && !id) return follows.people.picker(user.id, null);
    const ref = refOf(kind, id);
    if (!ref) { reply.code(404); return GONE; }
    return follows.people.picker(user.id, ref);
  }));

  app.put(`${FOLLOW}/item`, tight(60), run(async (user, req, reply) => {
    const b = bodyOf(req.body);
    const ref = refOf(b.kind, b.id);
    if (!ref) { reply.code(404); return GONE; }
    const out = await follows.people.setItem(user.id, ref, { importance: b.importance, people: b.people });
    return { ok: true, ...out };
  }));

  app.put(`${FOLLOW}/number`, tight(20), run(async (user, req) => {
    const b = bodyOf(req.body);
    return follows.people.setNumber(user.id, { member: b.member, phone: b.phone });
  }));

  app.get(`${FOLLOW}/:id`, RL, run(async (user, req, reply) => {
    const id = String((req.params as Record<string, unknown>).id ?? "").toLowerCase();
    if (!isUuid(id)) { reply.code(404); return GONE; }
    const view = await follows.view(user.id, id);
    if (!view) { reply.code(404); return GONE; }
    return view;
  }));
}
