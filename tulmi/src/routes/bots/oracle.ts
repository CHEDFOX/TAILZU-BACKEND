/**
 * THE ORACLE'S CARDS (src/oracle, docs/oracle.md): when and where the person was born, kept for the Oracle to read their sky from.
 *
 *   GET    /v1/oracle/sky              { sky, line, when }: sky (and its line) only once it is whole; when { date, time, line } once the first
 *                                      card is kept. Nulls before anything is given
 *   PUT    /v1/oracle/sky              in parts, as the cards ask: { date, time? } (the when; a place already kept stays), then { placeId?, place,
 *                                      session? } (the place: a suggestion's id and label, or typed words). Both at once also works, and { words }
 *                                      reads a whole set from a sentence. 400 in words when something can't be read or found
 *   DELETE /v1/oracle/sky              forgotten (and the route of the last question with it)
 *   GET    /v1/oracle/places?q=&s=     { q, places: [{ id, label, sub }] }: up to five towns and cities for what was typed (oracle/places.ts:
 *                                      Google's with GOOGLE_PLACES_API_KEY, else the server's own); `s` is the card's session token
 *
 * The signed-in person's own. With BOTS off, or the Oracle not set up (ORACLE_WORKER_URL, ORACLE_WORKER_SECRET), every route is 404 { code: "oracle_off" }.
 * Nothing a person typed is logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { oracleOn } from "../../bots/builtin.js";
import { places as defaultPlaces } from "../../places/index.js";
import type { Place } from "../../places/types.js";
import { dateWords, isComplete, readBirth, skyLine, timeWords, whenLine, whenOf, type BirthWhen, type Sky, type SkyDraft } from "../../oracle/birth.js";
import { birthPlaces, oracleBirthPlaces, type BirthPlaces } from "../../oracle/places.js";
import { skyFromWords } from "../../oracle/run.js";
import { oracleStore, type OracleStore } from "../../oracle/store.js";

export interface OracleRouteDeps {
  rateLimit: unknown;
  /** Null when BOTS is off. */
  bots: unknown;
  store?: OracleStore;
  /** The geocoder typed places are found with (the server's own when not given). */
  places?: { place(q: string): Promise<Place | null> };
  /** The birthplace search (oracle/places.ts). Not given: Google's when configured, else `places`. */
  birthPlaces?: BirthPlaces;
  now?: () => number;
}

const ROUTE = "/v1/oracle/sky";
const PLACES = "/v1/oracle/places";
const FIELD_MAX = 120;

const MISSING: Record<string, string> = {
  date: "I couldn't read a date of birth there. Try something like 13 July 1994.",
  time: "I couldn't read that time. Try 9:30 am, or leave it empty if you don't know it.",
  when: "Tell me when you were born first.",
  place: "Add the town or city you were born in.",
  found: "I couldn't find that place on the map. Try the nearest city.",
};

/** What the page reads: the whole sky once it is whole, and the when as soon as it is kept (to fill the first card in again). */
export function skyView(sky: SkyDraft | null | undefined): { sky: Sky | null; line: string | null; when: { date: string; time: string; line: string } | null } {
  if (!sky) return { sky: null, line: null, when: null };
  const whole = isComplete(sky) ? sky : null;
  return { sky: whole, line: whole ? skyLine(whole) : null, when: { date: dateWords(sky), time: timeWords(sky), line: whenLine(sky) } };
}

export function registerOracleRoutes(app: FastifyInstance, deps: OracleRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const store = (): OracleStore => deps.store ?? oracleStore();
  const finder = () => deps.places ?? defaultPlaces();
  const search = (): BirthPlaces => deps.birthPlaces ?? (deps.places ? birthPlaces({ key: null, finder: deps.places }) : oracleBirthPlaces());
  const now = deps.now ?? Date.now;

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    if (!deps.bots || !oracleOn()) { reply.code(404).send({ code: "oracle_off", message: "The Oracle is not switched on." }); return null; }
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) { reply.code(401).send({ code: "unauthorized", message: "Sign in again." }); return null; }
    return user;
  };
  const bad = (reply: FastifyReply, why: string) => reply.code(400).send({ code: "bad_request", message: MISSING[why] ?? MISSING.date });

  app.get(ROUTE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const row = await store().get(user.id).catch(() => null);
    return reply.header("cache-control", "no-store").send(skyView(row?.sky));
  });

  app.put(ROUTE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const part = (k: string): string => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, k === "placeId" ? 300 : FIELD_MAX) : "");

    // A whole set in one sentence (the chat's way): read as before.
    if (part("words")) {
      const got = await skyFromWords(part("words"), (q) => finder().place(q));
      if (!got.sky) return bad(reply, got.missing ?? "date");
      await store().setSky(user.id, got.sky, now());
      return reply.send(skyView(got.sky));
    }

    const kept = (await store().get(user.id).catch(() => null))?.sky ?? null;
    let when: BirthWhen | null = kept ? whenOf(kept) : null;
    if (part("date")) {
      const read = readBirth(part("time") ? `${part("date")}, ${part("time")}` : part("date"));
      if (!read) return bad(reply, "date");
      if (part("time") && !read.timeKnown) return bad(reply, "time");
      when = whenOf(read);
    } else if (part("time")) {
      return bad(reply, "date");
    }
    let at: Pick<Sky, "lat" | "lng" | "place"> | null = isComplete(kept) ? { lat: kept.lat, lng: kept.lng, place: kept.place } : null;
    if (part("placeId") || part("place")) {
      if (!when) return bad(reply, "when");
      const found = await search().resolve({ id: part("placeId"), label: part("place"), session: part("session") }).catch(() => null);
      if (!found) return bad(reply, "found");
      at = { lat: found.lat, lng: found.lon, place: found.label.slice(0, FIELD_MAX) };
    }
    if (!when) return bad(reply, "date");
    const sky: SkyDraft = { ...when, ...(at ?? {}) };
    await store().setSky(user.id, sky, now());
    return reply.send(skyView(sky));
  });

  app.delete(ROUTE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    await store().forget(user.id);
    return reply.send({ ok: true });
  });

  app.get(PLACES, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const q = (req.query ?? {}) as Record<string, unknown>;
    const words = typeof q.q === "string" ? q.q.slice(0, 80) : "";
    const session = typeof q.s === "string" ? q.s.slice(0, 64) : "";
    const places = await search().suggest(words, session).catch(() => []);
    return reply.header("cache-control", "no-store").send({ q: words, places });
  });
}
