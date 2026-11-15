/**
 * SHARING A PLAN (src/billing/planShare.ts, migration 0096, docs/plan-share.md). Launch dark: every route here answers 404 while
 * PLAN_SHARE is off, which is the default, and nothing about the meter changes for anybody.
 *
 *   GET    /v1/botsapp/bots/plan/share                -> PlanShareView  who is on my plan and how much of the month each has used,
 *                                                        or whose plan I am on; who I could share with; asks waiting for me; my own
 *   POST   /v1/botsapp/bots/plan/share { memberIds }  -> { view }       share my plan with them
 *   DELETE /v1/botsapp/bots/plan/share/:memberId      -> { view }       stop sharing with one person
 *   DELETE /v1/botsapp/bots/plan/share/mine           -> { view }       leave the plan I am on
 *   POST   /v1/botsapp/bots/plan/share/ask { ownerId, about? }          ask someone to share theirs
 *   PUT    /v1/botsapp/bots/plan/share/ask/:id { decision }             "share" | "promise" | "decline"; "withdraw" takes back my own
 *
 * THE RULES EVERY ONE OF THEM KEEPS:
 *
 *   - Spaces only. A plan can be shared with, or asked from, someone the person already shares a space with and nobody else: no
 *     email field, no link, no code, so a plan can never be handed to a stranger. Nobody across a block, either way round.
 *   - Their own plan always wins, so someone who has one is never put on another's, and never asks for one.
 *   - One plan a person. "They are already on a plan." — never whose: that is a fact about two other people's money.
 *   - A held account (abuse prevention, docs/trust.md §actions) may neither share, be shared with, nor ask, and is told nothing
 *     about why.
 *   - No money, anywhere. A share of the month is the only number any of this gives a screen, and the only thing ever said about
 *     another person's billing is whether they have a plan, so the right row can be drawn.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PlanShareView } from "../../../../shared/types/api.js";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import {
  answerAsk, askById, askFor, asksWaitingFor, hasOwnPlan, installPlanShareNames, installSharedTold, membersOn, myOpenAsk,
  payerFor, PlanShareError, planShareOn, planShareSwitchOn, shareOf, shareWith, stopSharing, withdrawAsk,
} from "../../billing/planShare.js";
import { installPlanShareAnswer } from "../../billing/planShareActs.js";
import { Blocks } from "../../botsBots/blocks.js";
import { lookOf, looksIn, type PersonLook } from "../../botsBots/personLook.js";
import type { Spaces } from "../../botsBots/spaces.js";
import { pushEngine } from "../../push/index.js";
import { heldFreeUse } from "../../trust/actions.js";
import { itemId } from "../../widgets/items.js";
import type { Spending } from "../../you/limits.js";
import type { BotsAreaDeps } from "./botsArea.js";

const AREA = "/v1/botsapp/bots";
/** A plan is shared with family and friends: a bound on every read, never a seat count (nothing here is sold by the seat). */
const PEOPLE_MAX = 200;
const ABOUT_MAX = 120;
/** How many people may be ticked in one go on the Share with someone screen. */
const SHARE_AT_ONCE = 50;

const OFF = { code: "plan_share_off", message: "That isn't switched on here." };
/** A held account is told nothing about why (docs/trust.md §actions): the same sentence any temporary trouble gets. */
const NOT_NOW = { code: "not_now", message: "That can't be done right now. Try again later." };
const NOT_CONNECTED = { code: "not_connected", message: "You can only share with people you share a space with." };

export interface PlanSharePerson { userId: string; name: string; look: PersonLook }

/**
 * Everyone the viewer shares a space with, with their name and their tiny bot as the FIRST space they share has them — the same
 * walk threads.ts `looksKnown` and `contacts()` do, so someone looks the same here as in a chat or on their page. Nobody with a
 * block between them, either way round. The viewer is never in it.
 */
export async function peopleAround(spaces: Spaces, blocks: Blocks, userId: string): Promise<PlanSharePerson[]> {
  const out = new Map<string, PlanSharePerson>();
  const hidden = await blocks.hiddenFor(userId).catch(() => new Set<string>());
  for (const s of await spaces.mine(userId).catch(() => [])) {
    const members = await spaces.membersOf(s.id).catch(() => []);
    const looks = looksIn(members.map((m) => m.userId));
    for (const m of members) {
      if (m.userId === userId || hidden.has(m.userId) || out.has(m.userId)) continue;
      out.set(m.userId, { userId: m.userId, name: m.name, look: looks.get(m.userId) ?? lookOf(m.userId) });
      if (out.size >= PEOPLE_MAX) return [...out.values()];
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const pct = (frac: number): number => Math.max(0, Math.min(100, Math.round(frac * 100)));

export function registerPlanShareRoutes(
  app: FastifyInstance,
  deps: BotsAreaDeps,
  o: { spaces: Spaces; spending: Spending; blocks?: Blocks; now?: () => number },
): void {
  const RL = { config: deps.rateLimit };
  const spaces = o.spaces;
  const blocks = o.blocks ?? new Blocks();
  const now = o.now ?? Date.now;

  // The one line that names a person in this whole feature ("You are on Rahul's Lite") reads its name from Spaces, through the
  // hook billing/planShare.ts leaves for it so the meter never has to depend on Spaces.
  installPlanShareNames(async (userId) => {
    for (const s of await spaces.mine(userId).catch(() => [])) {
      const me = (await spaces.membersOf(s.id).catch(() => [])).find((m) => m.userId === userId);
      if (me?.name) return me.name;
    }
    return "";
  });
  /** "You're on a shared plan": the one push the member gets, however they came to be on it. A plain notification, no buttons. */
  const tellOn = (memberId: string): void => {
    void pushEngine()?.notify(memberId, { kind: "plan_share_on", key: `pson:${memberId}:${Math.floor(now() / 60_000)}`, vars: {}, data: {} })
      ?.catch?.(() => undefined);
  };
  // A promise kept the moment the payment lands (entitlements.ts -> settlePromisedAsks): the asker is told, and nothing on the
  // owner's side has to be pressed again.
  installSharedTold(({ memberId }) => tellOn(memberId));
  app.addHook("onClose", async () => { installPlanShareNames(null); installSharedTold(null); installPlanShareAnswer(null); });

  // ------------------------------------------------------------ helpers

  const run = (fn: (user: AuthedUser, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!planShareSwitchOn()) return reply.code(404).send(OFF);
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
      if (!planShareOn(user.id)) return reply.code(404).send(OFF);
      // Held by signals: neither share, nor be shared with, nor ask. Nothing is said about why.
      if (heldFreeUse(user.id)) return reply.code(403).send(NOT_NOW);
      try {
        const out = await fn(user, req, reply);
        return reply.sent ? reply : reply.send(out ?? { ok: true });
      } catch (err) {
        if (err instanceof PlanShareError) return reply.code(err.status).send({ code: err.code, message: err.message });
        req.log.error({ err: (err as Error)?.name }, "plan share: request failed");
        return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
      }
    };

  const body = (req: FastifyRequest): Record<string, unknown> =>
    (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
  const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "").trim();

  /** Everything the sharing screens draw, from one read. */
  const view = async (userId: string): Promise<PlanShareView> => {
    const [around, canShare, rows, payer, waiting, mine] = await Promise.all([
      peopleAround(spaces, blocks, userId),
      hasOwnPlan(userId),
      membersOn(userId),
      payerFor(userId),
      asksWaitingFor(userId),
      myOpenAsk(userId),
    ]);
    const byId = new Map(around.map((p) => [p.userId, p]));
    const onMyPlan = new Set(rows.map((r) => r.memberId));

    const members = await Promise.all(rows.map(async (r) => {
      const p = byId.get(r.memberId);
      return {
        userId: r.memberId, name: p?.name ?? "", usedPct: pct(await o.spending.shareOfMonth(userId, r.memberId)),
        look: p?.look ?? lookOf(r.memberId),
      };
    }));

    // Whether each person has a plan is a yes/no, and the only thing ever said about their billing: never its name, their use
    // or their renewal. People who already have one are drawn with no row at all by the screens.
    const people = await Promise.all(around.map(async (p) => ({
      userId: p.userId, name: p.name, hasPlan: await hasOwnPlan(p.userId), onMyPlan: onMyPlan.has(p.userId), look: p.look,
    })));

    const out: PlanShareView = {
      canShare,
      members,
      people,
      // An ask from someone no longer in any of my spaces is not shown: the connection that allowed it has gone.
      asks: waiting.filter((a) => byId.has(a.askerId)).map((a) => ({
        id: a.id, askerId: a.askerId, name: byId.get(a.askerId)!.name, ...(a.about ? { about: a.about } : {}),
        at: a.createdAt, look: byId.get(a.askerId)!.look,
      })),
    };
    if (payer.sharedFrom) {
      const ownerId = payer.sharedFrom.userId;
      const row = await shareOf(userId);
      const u = await o.spending.usage(userId);
      const p = byId.get(ownerId);
      out.on = {
        ownerId, name: p?.name || payer.sharedFrom.name, planName: u.plan.name, since: row?.createdAt ?? 0,
        monthUsedPct: pct(u.month.used), myUsedPct: pct(await o.spending.shareOfMonth(ownerId, userId)),
        look: p?.look ?? lookOf(ownerId),
      };
    }
    if (mine) {
      const p = byId.get(mine.ownerId);
      out.asked = { id: mine.id, ownerId: mine.ownerId, name: p?.name ?? "", at: mine.createdAt, ...(p ? { look: p.look } : {}) };
    }
    return out;
  };

  /** They must be someone I share a space with, and neither of us held. Says nothing about why where a hold is the reason. */
  const reachable = async (userId: string, otherId: string): Promise<PlanSharePerson> => {
    if (!otherId || otherId === userId) throw new PlanShareError("bad_request", "That is your own plan.");
    if (heldFreeUse(otherId) || !planShareOn(otherId)) throw new PlanShareError(NOT_NOW.code, NOT_NOW.message, 403);
    const p = (await peopleAround(spaces, blocks, userId)).find((x) => x.userId === otherId);
    if (!p) throw new PlanShareError(NOT_CONNECTED.code, NOT_CONNECTED.message, 403);
    return p;
  };

  /**
   * THE SAME ANSWER FROM THE NOTIFICATION (billing/planShareActs.ts, widgets/act.ts; the item is `psa:<askId>`). Share and
   * Not now go through the one door every notification's button goes through and land here, so they keep exactly the checks
   * the PUT below keeps — and two more the screen does not need: the ask must still be waiting, so a retry cannot answer
   * twice, and "Share" may only share. Someone on Free is told so, rather than quietly promised: a button with no screen
   * behind it cannot open the plans screen the card opens, and the ask stays waiting there for them.
   */
  installPlanShareAnswer(async (userId, askId, decision) => {
    if (!planShareSwitchOn() || !planShareOn(userId)) throw new PlanShareError(OFF.code, OFF.message, 404);
    if (heldFreeUse(userId)) throw new PlanShareError(NOT_NOW.code, NOT_NOW.message, 403);
    const ask = await askById(askId);
    // Only the ask it was sent for, and only the person it was sent to: anybody else's "has gone", as the PUT answers.
    if (!ask || ask.ownerId !== userId) throw new PlanShareError("not_found", "That ask has gone.", 404);
    // Answered, promised or taken back already: the button answers nothing a second time.
    if (ask.state !== "waiting") throw new PlanShareError("not_waiting", "That was already answered.", 409);
    if (decision === "decline") { await answerAsk(ask, "decline", now()); return { state: "declined" }; }
    if (!(await hasOwnPlan(userId))) throw new PlanShareError("no_plan", "You don't have a plan to share yet. Open X0 to get one.", 409);
    await reachable(userId, ask.askerId);
    if (await hasOwnPlan(ask.askerId)) throw new PlanShareError("has_plan", "They already have a plan of their own.", 409);
    await answerAsk(ask, "share", now());
    tellOn(ask.askerId);
    return { state: "shared" };
  });

  // ------------------------------------------------------------ the routes

  app.get(`${AREA}/plan/share`, RL, run(async (user) => view(user.id)));

  app.post(`${AREA}/plan/share`, RL, run(async (user, req) => {
    if (!(await hasOwnPlan(user.id))) throw new PlanShareError("no_plan", "You don't have a plan to share yet.", 409);
    const raw = body(req).memberIds;
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map((v) => String(v ?? "").trim()).filter(Boolean))].slice(0, SHARE_AT_ONCE);
    if (!ids.length) throw new PlanShareError("bad_request", "Choose someone to share with.");
    for (const id of ids) {
      await reachable(user.id, id);
      // Someone with a plan of their own has nothing to gain and would be quietly refused by the rule anyway; say so plainly.
      if (await hasOwnPlan(id)) throw new PlanShareError("has_plan", "They already have a plan of their own.", 409);
      await shareWith(user.id, id, now());
      tellOn(id);
    }
    return { view: await view(user.id) };
  }));

  // "mine" is not an account id (ids are uuids), so leaving the plan I am on and stopping one I give never collide.
  app.delete(`${AREA}/plan/share/mine`, RL, run(async (user) => {
    const row = await shareOf(user.id);
    if (row) await stopSharing(row.ownerId, user.id);
    return { view: await view(user.id) };
  }));

  app.delete(`${AREA}/plan/share/:memberId`, RL, run(async (user, req) => {
    await stopSharing(user.id, param(req, "memberId"));
    return { view: await view(user.id) };
  }));

  app.post(`${AREA}/plan/share/ask`, RL, run(async (user, req) => {
    if (await hasOwnPlan(user.id)) throw new PlanShareError("has_plan", "You already have a plan of your own.", 409);
    if (await shareOf(user.id)) throw new PlanShareError("already_shared", "You are already on a plan.", 409);
    const b = body(req);
    const ownerId = String(b.ownerId ?? "").trim();
    await reachable(user.id, ownerId);
    const about = String(b.about ?? "").replace(/\s+/g, " ").trim().slice(0, ABOUT_MAX) || undefined;
    const ask = await askFor(user.id, ownerId, about, now());
    const me = (await peopleAround(spaces, blocks, ownerId)).find((p) => p.userId === user.id);
    void pushEngine()?.notify(ownerId, {
      kind: "plan_share_ask", key: `psask:${ask.id}`,
      vars: { name: me?.name ?? "Someone", about: about ?? "" },
      // The ask's own id, and the item its notification's two buttons answer (widgets/items.ts `psa:`): without the item the
      // notification is drawn with no buttons at all, whatever category it carries.
      data: { ask: ask.id, item: itemId({ kind: "psa", askId: ask.id }) },
    })?.catch?.(() => undefined);
    return { ask: { id: ask.id, at: ask.createdAt }, view: await view(user.id) };
  }));

  app.put(`${AREA}/plan/share/ask/:id`, RL, run(async (user, req) => {
    const ask = await askById(param(req, "id"));
    if (!ask) throw new PlanShareError("not_found", "That ask has gone.", 404);
    const decision = String(body(req).decision ?? "").trim();
    // My own ask: the only thing I may do to it is take it back.
    if (ask.askerId === user.id) {
      if (decision !== "withdraw") throw new PlanShareError("bad_request", "That isn't yours to answer.", 403);
      await withdrawAsk(ask, now());
      return { view: await view(user.id) };
    }
    if (ask.ownerId !== user.id) throw new PlanShareError("not_found", "That ask has gone.", 404);
    // Already answered: say so rather than answer it twice. Both doors to an ask now keep the same check (the other is the
    // notification's, in billing/planShareActs.ts), so a card left open on a second phone cannot quietly re-answer it.
    if (ask.state !== "waiting") throw new PlanShareError("not_waiting", "That was already answered.", 409);
    if (decision !== "share" && decision !== "promise" && decision !== "decline") {
      throw new PlanShareError("bad_request", 'decision is "share", "promise" or "decline".');
    }
    if (decision === "share") {
      if (!(await hasOwnPlan(user.id))) throw new PlanShareError("no_plan", "You don't have a plan to share yet.", 409);
      await reachable(user.id, ask.askerId);
      if (await hasOwnPlan(ask.askerId)) throw new PlanShareError("has_plan", "They already have a plan of their own.", 409);
    }
    await answerAsk(ask, decision, now());
    if (decision === "share") tellOn(ask.askerId);
    return { view: await view(user.id) };
  }));
}
