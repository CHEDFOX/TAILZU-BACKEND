/**
 * PLACES WORTH KEEPING, OVER HTTP (src/discover, docs/discover.md). Everything here is the signed-in person's own.
 *
 *   GET  /v1/discover/feed              ?tags=&month=&country=&budget=&limit= -> the cards, in their order
 *   GET  /v1/discover/place/:slug       one card in full
 *   POST /v1/discover/build             { place } -> a card read off the web for a place nobody has written
 *   POST /v1/discover/signals           { signals: [...] } -> what they did; folded at once
 *   GET  /v1/discover/taste             what we think they like, in their own words
 *
 * THERE IS NOTHING TO FILL IN FIRST. The feed is the first screen a new person sees, ordered by wow and rarity
 * until they have done anything (query.ts). Everything we know about somebody is built from what they tapped,
 * what sat in their viewport and for how long — which is what /signals carries.
 *
 * SIGNALS ARRIVE IN BATCHES. The app watches the viewport and sends what it saw — which tiles were on screen and
 * for how long — a few at a time, because one request per tile would be most of the traffic in the product. The
 * batch is capped, and anything unrecognised in it is dropped rather than refused: a feed must never fail to load
 * because a telemetry row was malformed.
 *
 * NOTHING HERE READS ANOTHER PERSON. Every call resolves the token first and passes that id down; there is no path
 * that takes a user id as a parameter.
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { isBudget, isSignalKind, type Card, type Discover, type Tag } from "../../discover/index.js";
import { daysLeftInSeason, seasonWords, TAGS } from "../../discover/taxonomy.js";

/** One batch of what the app saw. Enough for a long scroll, small enough to parse without thinking about it. */
const SIGNALS_MAX = 40;
/** Longest a single look is believed. Beyond this a screen was left on, not read. */
const DWELL_CAP_MS = 120_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

const TAG_SET: ReadonlySet<string> = new Set(TAGS);

/**
 * A card as the APP needs it, not as we hold it.
 *
 * `season` is a bitmask in here and a sentence out there: the screens do no arithmetic and no month maths, so a
 * card leaves with "December to March" and with the days left of that window when the window is closing. Sending
 * the mask raw is how a feed ends up saying "best 3585".
 */
/**
 * Our own photographs are stored root-relative (/photos/<slug>.jpg) so the catalogue stays a data file with no
 * config in it. The app needs somewhere to fetch them from: the same origin the typefaces come from (kit.ts).
 */
function absolute(url: string): string {
  if (!url.startsWith("/")) return url;
  const origin = process.env.PUBLIC_ORIGIN || "https://api.x0bot.com";
  return `${origin.replace(/\/$/, "")}${url}`;
}

function cardView(card: Card, now: Date): Record<string, unknown> {
  const left = daysLeftInSeason(card.season, now);
  return {
    slug: card.slug,
    title: card.title,
    where: card.where,
    hook: card.hook,
    story: card.story,
    moment: card.moment,
    dated: card.dated,
    tags: card.tags,
    budget: card.budget,
    effort: card.effort,
    photos: card.photos.map((p) => ({ ...p, url: absolute(p.url) })),
    origin: card.origin,
    sources: card.sources,
    at: card.at,
    season: seasonWords(card.season),
    daysLeft: left,
  };
}

const tagsFrom = (raw: unknown): Tag[] => {
  const parts = typeof raw === "string" ? raw.split(",") : [];
  const out: Tag[] = [];
  for (const part of parts) {
    const tag = part.trim();
    if (TAG_SET.has(tag) && !out.includes(tag as Tag)) out.push(tag as Tag);
  }
  return out.slice(0, 5);
};

const intFrom = (raw: unknown, min: number, max: number): number | undefined => {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

export function registerDiscoverRoutes(
  app: FastifyInstance,
  deps: { rateLimit: { rateLimit: { max: number; timeWindow: number } }; discover: Discover | null },
): void {
  const RL = { config: deps.rateLimit };
  const unauthorized = { code: "unauthorized", message: "Missing or invalid token" };
  const off = { code: "discover_off", message: "Places are not switched on here." };

  const who = async (auth: string | undefined): Promise<string | null> => {
    const user = await resolveUser(auth).catch(() => null);
    return user?.id ?? null;
  };

  app.get<{ Querystring: Record<string, string> }>("/v1/discover/feed", RL, async (req, reply) => {
    const userId = await who(req.headers["authorization"]);
    if (!userId) return reply.code(401).send(unauthorized);
    const d = deps.discover;
    if (!d) return reply.code(503).send(off);

    const q = req.query ?? {};
    const tags = tagsFrom(q.tags);
    const month = intFrom(q.month, 1, 12);
    const limit = intFrom(q.limit, 1, 40);
    const country = typeof q.country === "string" && /^[a-zA-Z]{2}$/.test(q.country) ? q.country.toLowerCase() : undefined;
    const budget = isBudget(q.budget) ? q.budget : undefined;

    const ask = {
      userId,
      ...(tags.length ? { tags } : {}),
      ...(month !== undefined ? { month } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(country ? { country } : {}),
      ...(budget ? { budget } : {}),
    };

    const [chosen, total] = await Promise.all([d.ask(ask), d.count(ask)]);
    const now = new Date();
    return reply.send({
      total,
      cards: chosen.map((c) => ({
        ...cardView(c.card, now),
        score: Number(c.score.toFixed(4)),
        wildcard: c.wildcard,
        reason: c.reason ?? null,
      })),
    });
  });

  app.get<{ Params: { slug: string } }>("/v1/discover/place/:slug", RL, async (req, reply) => {
    const userId = await who(req.headers["authorization"]);
    if (!userId) return reply.code(401).send(unauthorized);
    const d = deps.discover;
    if (!d) return reply.code(503).send(off);

    const slug = req.params.slug;
    if (!SLUG.test(slug)) return reply.code(400).send({ code: "bad_slug", message: "Not a place." });
    const card = await d.open(slug, userId);
    if (!card) return reply.code(404).send({ code: "not_found", message: "Nothing of ours by that name yet." });
    return reply.send({ card: cardView(card, new Date()) });
  });

  app.post<{ Body: { place?: unknown } }>("/v1/discover/build", RL, async (req, reply) => {
    const userId = await who(req.headers["authorization"]);
    if (!userId) return reply.code(401).send(unauthorized);
    const d = deps.discover;
    if (!d) return reply.code(503).send(off);

    const place = typeof req.body?.place === "string" ? req.body.place.trim().slice(0, 80) : "";
    if (place.length < 2) return reply.code(400).send({ code: "bad_place", message: "Say where." });
    if (!d.canBuild) return reply.code(503).send({ code: "build_off", message: "I cannot write up a new place right now." });

    const out = await d.build(place, userId);
    // A refusal is an ANSWER, not an error: the place may be real and simply not worth a card, and the app says so.
    if (!out.ok) return reply.send({ ok: false, why: out.why });
    return reply.send({ ok: true, card: cardView(out.card, new Date()) });
  });

  app.post<{ Body: { signals?: unknown } }>("/v1/discover/signals", RL, async (req, reply) => {
    const userId = await who(req.headers["authorization"]);
    if (!userId) return reply.code(401).send(unauthorized);
    const d = deps.discover;
    if (!d) return reply.code(503).send(off);

    const raw = Array.isArray(req.body?.signals) ? req.body.signals.slice(0, SIGNALS_MAX) : [];
    let taken = 0;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const kind = row.kind;
      const slug = typeof row.slug === "string" ? row.slug : "";
      // Dropped, not refused: a feed must not fail to load because one telemetry row was malformed.
      if (!isSignalKind(kind) || !SLUG.test(slug)) continue;

      const ms = intFrom(row.ms, 0, DWELL_CAP_MS);
      const rank = intFrom(row.rank, 1, 50);
      const of = intFrom(row.of, 1, 50);
      await d.did(userId, {
        kind,
        slug,
        ...(ms !== undefined ? { ms } : {}),
        ...(rank !== undefined ? { rank } : {}),
        ...(of !== undefined ? { of } : {}),
      });
      taken += 1;
    }
    return reply.send({ ok: true, taken });
  });

  app.get("/v1/discover/taste", RL, async (req, reply) => {
    const userId = await who(req.headers["authorization"]);
    if (!userId) return reply.code(401).send(unauthorized);
    const d = deps.discover;
    if (!d) return reply.code(503).send(off);

    const mine = await d.taste(userId);
    return reply.send({
      known: Number(mine.known.toFixed(3)),
      signals: mine.taste.signals,
      likes: mine.likes.map((l) => ({ tag: l.tag, score: Number(l.score.toFixed(3)), sure: Number(l.sure.toFixed(3)) })),
      dislikes: mine.dislikes.map((l) => ({ tag: l.tag, score: Number(l.score.toFixed(3)), sure: Number(l.sure.toFixed(3)) })),
    });
  });
}
