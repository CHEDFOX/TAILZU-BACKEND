/**
 * THE ORACLE'S CARD (src/oracle, docs/oracle.md): when and where the person was born, kept for the Oracle to read their sky from.
 *
 *   GET    /v1/oracle/sky        { sky, line } (sky null when not given yet)
 *   PUT    /v1/oracle/sky        { date, time?, place } or { words }: read (oracle/birth.ts), the place found on the map, kept; 400 in words when not
 *   DELETE /v1/oracle/sky        forgotten (and the route of the last question with it)
 *
 * The signed-in person's own. With BOTS off, or the Oracle not set up (ORACLE_WORKER_URL, ORACLE_WORKER_SECRET), every route is 404 { code: "oracle_off" }.
 * The words are never logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { oracleOn } from "../../bots/builtin.js";
import { places as defaultPlaces } from "../../places/index.js";
import type { Place } from "../../places/types.js";
import { skyLine } from "../../oracle/birth.js";
import { skyFromWords } from "../../oracle/run.js";
import { oracleStore, type OracleStore } from "../../oracle/store.js";

export interface OracleRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  store?: OracleStore;
  places?: { place(q: string): Promise<Place | null> };
  now?: () => number;
}

const ROUTE = "/v1/oracle/sky";
const FIELD_MAX = 120;

const MISSING: Record<string, string> = {
  date: "I couldn't read a date of birth there. Try something like 13 July 1994.",
  place: "Add the town or city you were born in.",
  found: "I couldn't find that place on the map. Try the nearest city.",
};

export function registerOracleRoutes(app: FastifyInstance, deps: OracleRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const store = (): OracleStore => deps.store ?? oracleStore();
  const finder = () => deps.places ?? defaultPlaces();
  const now = deps.now ?? Date.now;

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    if (!deps.bots || !oracleOn()) { reply.code(404).send({ code: "oracle_off", message: "The Oracle is not switched on." }); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return user;
  };

  app.get(ROUTE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const row = await store().get(user.id).catch(() => null);
    return reply.header("cache-control", "no-store").send({ sky: row?.sky ?? null, line: row?.sky ? skyLine(row.sky) : null });
  });

  app.put(ROUTE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const part = (k: string): string => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, FIELD_MAX) : "");
    const words = part("words") || [part("date"), part("time"), part("place") ? `in ${part("place")}` : ""].filter(Boolean).join(", ");
    if (!words) return reply.code(400).send({ code: "bad_request", message: MISSING.date });
    const got = await skyFromWords(words, (q) => finder().place(q));
    if (!got.sky) return reply.code(400).send({ code: "bad_request", message: MISSING[got.missing ?? "date"] });
    await store().setSky(user.id, got.sky, now());
    return reply.send({ sky: got.sky, line: skyLine(got.sky) });
  });

  app.delete(ROUTE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    await store().forget(user.id);
    return reply.send({ ok: true });
  });
}
