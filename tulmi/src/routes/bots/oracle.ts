/**
 * THE ORACLE'S CARDS (src/oracle, docs/oracle.md): when and where the person was born, kept for Chamen to read their sky from.
 *
 *   GET    /v1/oracle/sky              { sky, line, when }: sky (and its line) only once it is whole; when { date, time, line } once the first
 *                                      card is kept. Nulls before anything is given
 *   PUT    /v1/oracle/sky              in parts, as the cards ask: { date, time? } (the when; a place already kept stays), then { placeId?, place,
 *                                      session? } (the place: a suggestion's id and label, or typed words). Both at once also works, and { words }
 *                                      reads a whole set from a sentence. 400 in words when something can't be read or found
 *   DELETE /v1/oracle/sky              forgotten (and the route of the last question with it)
 *                                      The wheels' way too: { day, month, year, hour, minute, ampm } (birth.ts whenFromParts)
 *   GET    /v1/oracle/places?q=&s=     { q, places: [{ id, label, sub }] }: up to five towns and cities for what was typed (oracle/places.ts:
 *                                      Google's with GOOGLE_PLACES_API_KEY, else the server's own); `s` is the card's session token
 *
 * PEOPLE (oracle/people.ts, docs/oracle.md "People"): who Chamen reads for. One chat; each question is read against the one picked.
 *   GET    /v1/oracle/people           { active, me, others, shared, spaces } (people.ts CircleView)
 *   POST   /v1/oracle/people           { name, gender?, day, month, year, hour, minute, ampm, placeId?, place, session? }: someone added, whole,
 *                                      and picked. 400 in words when something can't be read or found; 409 past 20
 *   PUT    /v1/oracle/people/active    { ref }: who the next question is read for ("me", "p:<id>", or a shared "s:<owner>:<ref>")
 *   PUT    /v1/oracle/people/me        { gender }: the gender Chamen reads their own chart with (the profile is left as it is)
 *   DELETE /v1/oracle/people/:ref      someone they added, taken out (and every share of them)
 *   PUT    /v1/oracle/people/share     { ref, spaceId, on }: their own chart ("me") or someone they added, shared into a space they are in, or not
 *
 * The signed-in person's own. With BOTS off, or Chamen not set up (ORACLE_WORKER_URL, ORACLE_WORKER_SECRET), every route is 404 { code: "oracle_off" }.
 * Nothing a person typed is logged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import { oracleOn } from "../../bots/builtin.js";
import { places as defaultPlaces } from "../../places/index.js";
import type { Place } from "../../places/types.js";
import { randomUUID } from "node:crypto";
import { dateWords, hasPlace, isComplete, partsOf, readBirth, skyLine, timeWords, whenFromParts, whenLine, whenOf, type BirthWhen, type Sky, type SkyDraft } from "../../oracle/birth.js";
import { circleView, isOwnRef, oracleSpaces, parseRef } from "../../oracle/people.js";
import { OTHERS_MAX, type OracleGender } from "../../oracle/store.js";
import { getProfile } from "../../profile/store.js";
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
  time: "I couldn't read that time. Try 9:30 am.",
  when: "Tell me when you were born first.",
  place: "Add the town or city you were born in.",
  found: "I couldn't find that place on the map. Try the nearest city.",
  parts: "Pick the day, the month, the year and the time you were born.",
  name: "Add their name.",
};

/** What the page reads: the whole sky once it is whole, and the when as soon as it is kept (to fill the first card in again). */
export function skyView(sky: SkyDraft | null | undefined): { sky: Sky | null; line: string | null; place: string | null; when: { date: string; time: string; line: string } | null; parts: ReturnType<typeof partsOf> | null } {
  if (!sky) return { sky: null, line: null, place: null, when: null, parts: null };
  const whole = isComplete(sky) ? sky : null;
  // `place` is the place card's own answer, kept even while the sky is not whole, so the cards ask only for what is still owed.
  return {
    sky: whole, line: whole ? skyLine(whole) : null, place: hasPlace(sky) ? sky.place : null,
    when: { date: dateWords(sky), time: timeWords(sky), line: whenLine(sky) },
    // The wheels' parts, to open them on what was kept.
    parts: partsOf(sky),
  };
}

export function registerOracleRoutes(app: FastifyInstance, deps: OracleRouteDeps): void {
  const rl = { config: deps.rateLimit as never };
  const store = (): OracleStore => deps.store ?? oracleStore();
  const finder = () => deps.places ?? defaultPlaces();
  const search = (): BirthPlaces => deps.birthPlaces ?? (deps.places ? birthPlaces({ key: null, finder: deps.places }) : oracleBirthPlaces());
  const now = deps.now ?? Date.now;

  const begin = async (req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> => {
    if (!deps.bots || !oracleOn()) { reply.code(404).send({ code: "oracle_off", message: "Chamen is not switched on." }); return null; }
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
    if (b.day !== undefined || b.year !== undefined) {
      // The wheels: every part picked, and a date that exists.
      const got = whenFromParts(b);
      if (!got) return bad(reply, "parts");
      when = got;
    } else if (part("date")) {
      const read = readBirth(part("time") ? `${part("date")}, ${part("time")}` : part("date"));
      if (!read) return bad(reply, "date");
      if (part("time") && !read.timeKnown) return bad(reply, "time");
      when = whenOf(read);
    } else if (part("time")) {
      return bad(reply, "date");
    }
    let at: Pick<Sky, "lat" | "lng" | "place"> | null = hasPlace(kept) ? { lat: kept.lat, lng: kept.lng, place: kept.place } : null;
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

  // ------------------------------------------------------------------ people

  const PEOPLE = "/v1/oracle/people";
  const profileOf = async (user: AuthedUser) => {
    const p = await getProfile(user).catch(() => null);
    return { name: p?.fullName ?? "", gender: p?.gender ?? null };
  };
  const genderIn = (v: unknown): OracleGender | null => (v === "male" || v === "female" || v === "other" ? v : null);

  app.get(PEOPLE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    return reply.header("cache-control", "no-store").send(await circleView(user.id, await profileOf(user), store()));
  });

  app.post(PEOPLE, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!name) return bad(reply, "name");
    const when = whenFromParts(b);
    if (!when) return bad(reply, "parts");
    const str = (k: string): string => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, k === "placeId" ? 300 : FIELD_MAX) : "");
    if (!str("placeId") && !str("place")) return bad(reply, "place");
    const found = await search().resolve({ id: str("placeId"), label: str("place"), session: str("session") }).catch(() => null);
    if (!found) return bad(reply, "found");
    const row = await store().get(user.id).catch(() => null);
    const others = row?.others ?? [];
    if (others.length >= OTHERS_MAX) { reply.code(409); return reply.send({ code: "too_many", message: `Chamen keeps up to ${OTHERS_MAX} people. Take someone out first.` }); }
    const id = randomUUID().slice(0, 12);
    const sky: SkyDraft = { ...when, lat: found.lat, lng: found.lon, place: found.label.slice(0, FIELD_MAX) };
    await store().setCircle(user.id, { others: [...others, { id, name, gender: genderIn(b.gender), sky, at: now() }], active: `p:${id}` }, now());
    // A new person's questions start fresh: the last route was read against another chart.
    await store().setRoute(user.id, null, now()).catch(() => undefined);
    reply.code(201);
    return reply.send(await circleView(user.id, await profileOf(user), store()));
  });

  app.put(`${PEOPLE}/active`, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const want = (req.body as Record<string, unknown> | undefined)?.ref;
    const view = await circleView(user.id, await profileOf(user), store());
    const refs = new Set(["me", ...view.others.map((o) => o.ref), ...view.shared.map((x) => x.ref)]);
    if (typeof want !== "string" || !parseRef(want) || !refs.has(want)) { reply.code(404); return reply.send({ code: "not_found", message: "That person isn't here any more." }); }
    await store().setCircle(user.id, { active: want }, now());
    await store().setRoute(user.id, null, now()).catch(() => undefined);
    return reply.send({ ...view, active: want });
  });

  app.put(`${PEOPLE}/me`, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const gender = genderIn((req.body as Record<string, unknown> | undefined)?.gender);
    if (!gender) return reply.code(400).send({ code: "bad_request", message: "Pick one." });
    await store().setCircle(user.id, { gender }, now());
    return reply.send(await circleView(user.id, await profileOf(user), store()));
  });

  app.delete(`${PEOPLE}/:ref`, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const ref = String((req.params as Record<string, unknown>).ref ?? "");
    const parsed = parseRef(ref);
    const row = await store().get(user.id).catch(() => null);
    if (!parsed || parsed.kind !== "other" || !row?.others.some((o) => o.id === parsed.id)) {
      reply.code(404); return reply.send({ code: "not_found", message: "That person isn't here any more." });
    }
    await store().setCircle(user.id, { others: row.others.filter((o) => o.id !== parsed.id), ...(row.active === ref ? { active: "me" } : {}) }, now());
    for (const x of (await store().sharesOf(user.id).catch(() => [])).filter((x) => x.ref === ref)) await store().setShare(user.id, ref, x.spaceId, false, now()).catch(() => undefined);
    return reply.send(await circleView(user.id, await profileOf(user), store()));
  });

  app.put(`${PEOPLE}/share`, rl, async (req, reply) => {
    const user = await begin(req, reply);
    if (!user) return reply;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ref = typeof b.ref === "string" ? b.ref : "", spaceId = typeof b.spaceId === "string" ? b.spaceId : "";
    const row = await store().get(user.id).catch(() => null);
    const ownsIt = ref === "me" || (isOwnRef(ref) && !!row?.others.some((o) => `p:${o.id}` === ref));
    const inSpace = (await oracleSpaces()?.mine(user.id).catch(() => []) ?? []).some((s) => s.id === spaceId);
    if (!ownsIt || !inSpace) { reply.code(404); return reply.send({ code: "not_found", message: "Couldn't share that there." }); }
    await store().setShare(user.id, ref, spaceId, b.on !== false, now());
    return reply.send(await circleView(user.id, await profileOf(user), store()));
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
