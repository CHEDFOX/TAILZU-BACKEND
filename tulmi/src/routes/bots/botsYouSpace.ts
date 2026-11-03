/**
 * YOUR SPACE (src/you/space.ts): what your bots know about you, in sections, beside your own things. Signed in; only ever your own.
 *
 *   GET    /v1/bots/you/space                     -> { on, total, sections: [{ id, name, count, peek, off }] }
 *   GET    /v1/bots/you/space/:section            -> { id, name, line, use, canAdd, on, lines, things, me? }
 *   POST   /v1/bots/you/space/:section            { text } -> { line }  a line you write, kept for all your bots
 *   PUT    /v1/bots/you/space/:section/use        { on } -> { on }  may bots use this section (its lines stay)
 *   PUT    /v1/bots/you/space/lines/:key          { pinned?, section?, text? } -> { line }  every bot's copy alike
 *   DELETE /v1/bots/you/space/lines/:key          -> { forgot }  gone from every bot that kept it
 *   POST   /v1/bots/you/space/lines/:key/share    { space } -> { line }  that one line, for one group's bots (never Money)
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import type { Spaces } from "../../botsBots/spaces.js";
import type { SpaceMemory } from "../../botsBots/spaceMemory.js";
import { isBotError } from "../../bots/index.js";
import { shareSources } from "../../botsBots/shareSources.js";
import type { ShareSources } from "../../botsBots/spaceShares.js";
import type { PlanPrefsRow } from "../../botsBots/planTravel.js";
import { table } from "../../botsBots/rows.js";
import type { Trips } from "../../botsBots/trips.js";
import { getProfile } from "../../profile/store.js";
import { SpaceError, UserSpace } from "../../you/space.js";
import { isSection, KEY } from "../../you/spaceMarks.js";
import type { BotsAreaDeps } from "./botsArea.js";

export const SPACE_PATH = "/v1/bots/you/space";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});
const param = (req: FastifyRequest, k: string): string => String((req.params as Record<string, unknown>)[k] ?? "");

/** The space with the server's own stores: plans, notes, trips and projects, groups, and Plan Ease's home. */
export function userSpace(o: { spaces?: Spaces; trips?: Trips | null; sources?: ShareSources }): UserSpace {
  const prefs = table<PlanPrefsRow>("plan_prefs");
  return new UserSpace({
    sources: o.sources ?? shareSources({ trips: o.trips ?? null }),
    ...(o.spaces ? {
      groups: async (userId: string) => (await o.spaces!.list(userId)).map((s) => ({ id: s.id, name: s.name, people: s.members.filter((m) => !m.you).map((m) => m.name) })),
    } : {}),
    home: async (userId: string) => (await prefs.select({ user_id: userId }, { limit: 1 }))[0]?.home ?? "",
  });
}

export function registerYouSpaceRoutes(app: FastifyInstance, deps: BotsAreaDeps, o: { space: UserSpace; groups?: SpaceMemory }): void {
  const RL = { config: deps.rateLimit };
  const space = o.space;

  const run = (fn: (user: AuthedUser, req: FastifyRequest) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    try {
      return reply.send(await fn(user, req));
    } catch (err) {
      if (err instanceof SpaceError) return reply.code(err.status).send({ code: err.code, message: err.message });
      req.log.error({ err: (err as Error)?.name }, "your space: request failed");
      return reply.code(500).send({ code: "failed", message: "Couldn't do that just now." });
    }
  };
  const sectionOf = (req: FastifyRequest) => {
    const s = param(req, "section");
    if (!isSection(s)) throw new SpaceError(404, "not_found", "There's no such section.");
    return s;
  };
  const keyOf = (req: FastifyRequest) => {
    const k = param(req, "key");
    if (!KEY.test(k)) throw new SpaceError(404, "not_found", "That line isn't kept any more.");
    return k;
  };

  app.get(SPACE_PATH, RL, run((user) => space.overview(user.id)));

  app.get(`${SPACE_PATH}/:section`, RL, run((user, req) => space.section(user.id, sectionOf(req), {
    profile: async () => {
      const p = await getProfile(user);
      return { name: p.fullName?.trim() ?? "", gender: p.gender ?? null };
    },
  })));

  app.post(`${SPACE_PATH}/:section`, RL, run(async (user, req) => ({ line: await space.add(user.id, sectionOf(req), bodyOf(req.body).text) })));

  app.put(`${SPACE_PATH}/:section/use`, RL, run(async (user, req) => ({ on: await space.use(user.id, sectionOf(req), bodyOf(req.body).on) })));

  app.put(`${SPACE_PATH}/lines/:key`, RL, run(async (user, req) => {
    const b = bodyOf(req.body);
    return { line: await space.change(user.id, keyOf(req), { pinned: b.pinned, section: b.section, text: b.text }) };
  }));

  // One line, shared with one group by the person's own tap: nothing else of their space goes with it. Money never does.
  app.post(`${SPACE_PATH}/lines/:key/share`, RL, run(async (user, req) => {
    if (!o.groups) throw new SpaceError(404, "groups_off", "Groups aren't switched on here.");
    const key = keyOf(req);
    const line = await space.lineOf(user.id, key);
    if (line.section === "money") throw new SpaceError(400, "money_stays", "Money stays with the one bot you told.");
    try {
      return { line: await o.groups.add(user.id, String(bodyOf(req.body).space ?? ""), line.text, { section: line.section, fromKey: key }) };
    } catch (err) {
      if (isBotError(err)) throw new SpaceError(err.status, err.code, err.message);
      throw err;
    }
  }));

  app.delete(`${SPACE_PATH}/lines/:key`, RL, run(async (user, req) => ({ forgot: await space.forget(user.id, keyOf(req)) })));
}
