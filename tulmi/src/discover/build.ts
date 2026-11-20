/**
 * BUILDING A CARD FOR A PLACE NOBODY HAS WRITTEN YET.
 *
 * The person searches "hampi". The place is resolved to one point (src/places, so "hampi" and "Hampi, Karnataka"
 * never become two cards), pages about it are read, and the model is asked to fill the SAME slots a card we wrote by
 * hand has — no more and no fewer. What comes back is not trusted: parseBuilt checks every slot and refuses the card
 * rather than show a half-made one.
 *
 *   BUILD_SLOTS          the schema the model fills (its tags are the closed list, so it cannot invent one)
 *   parseBuilt(raw, at)  -> { ok: true, card } | { ok: false, why }
 *
 * `read` — the pages the researcher really fetched — is passed in by builder.ts and REPLACES whatever the model
 * said its sources were. A model asked to cite itself writes citations that look right; this way a source on a
 * card is a page that was really fetched, on the day it says.
 *
 * What is refused, and why each one matters:
 *   fewer than two sources         one page agreeing with itself is not a fact
 *   a source with no date read     a price or an opening time with no day on it is worthless
 *   a tag outside the list         the catalogue stops being searchable the moment the vocabulary drifts
 *   no months                      see bar.ts
 *   a hook longer than 120         it is a line on a tile, not a paragraph
 *
 * A card that parses still has to clear the bar (bar.ts) before anyone sees it.
 */
import { judge, type Verdict } from "./bar.js";
import { isBudget, seasonFrom, tagsOf, TAGS } from "./taxonomy.js";
import type { Card, LatLon, Source } from "./types.js";

/** The slots, as the model is given them. Kept next to parseBuilt so the two can never drift apart. */
export const BUILD_SLOTS: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["title", "hook", "moment", "story", "tags", "months", "budget", "effort", "rarity", "wow", "sources"],
  properties: {
    title: { type: "string", minLength: 8, maxLength: 70, description: "The ACT, not the place name: 'The bamboo grove before anyone wakes'." },
    hook: { type: "string", minLength: 20, maxLength: 120, description: "One line for the tile: a thing seen or heard, and the hour it happens." },
    moment: { type: "string", minLength: 6, maxLength: 90, description: "The hour, tide or turn of the season when the place is itself: 'first light, before the first coach'. If there is no such moment, say so and the place gets no card." },
    dated: { type: ["string", "null"], maxLength: 140, description: "Its past with a date in it, from your sources: 'a capital of half a million until 1565'. Null when the place's pull is not history." },
    story: { type: "string", minLength: 80, maxLength: 1200, description: "Two or three short paragraphs. Every fact in them must come from the pages you were given." },
    tags: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", enum: [...TAGS] } },
    months: { type: "array", minItems: 1, maxItems: 12, items: { type: "integer", minimum: 1, maximum: 12 }, description: "The months it is at its best, not the months it is open." },
    budget: { type: "string", enum: ["budget", "moderate", "premium", "luxury"] },
    effort: { type: "integer", minimum: 1, maximum: 5, description: "1 you step off a bus, 5 you train for it." },
    rarity: { type: "number", minimum: 0, maximum: 1, description: "0 everyone has heard of it, 1 almost nobody has." },
    wow: { type: "number", minimum: 0, maximum: 1 },
    sources: {
      type: "array", minItems: 2, maxItems: 6,
      items: {
        type: "object", additionalProperties: false, required: ["url", "readAt"],
        properties: { url: { type: "string" }, readAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
      },
    },
  },
};

/** What the pipeline already knows before the model is asked: the resolved place. */
export interface Resolved {
  slug: string;
  where: string;
  country: string;
  at: LatLon;
}

export type Built =
  | { ok: true; card: Card; verdict: Verdict }
  | { ok: false; why: string; verdict?: Verdict };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.host.replace(/^www\./, "") : null;
  } catch { return null; }
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function sourcesOf(raw: unknown): Source[] | string {
  if (!Array.isArray(raw)) return "no sources";
  const out: Source[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = str(row.url);
    const readAt = str(row.readAt);
    const host = hostOf(url);
    if (!host) continue;
    if (!DAY.test(readAt)) return `the source ${host} has no day it was read`;
    if (!out.some((s) => s.host === host)) out.push({ host, url, readAt });
  }
  if (out.length < 2) return "fewer than two sources that can be checked";
  return out;
}

/**
 * The model's answer, into a card — or a reason it is not one. `at` is what the geocoder already settled, so the
 * model is never asked where a place is and can never move it.
 */
export function parseBuilt(raw: unknown, at: Resolved, forUserId: string, against: readonly Card[] = [], read?: readonly Source[]): Built {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, why: "the answer was not an object" };
  const row = raw as Record<string, unknown>;

  const title = str(row.title);
  if (title.length < 8 || title.length > 70) return { ok: false, why: "no usable title" };

  const hook = str(row.hook);
  if (hook.length < 20 || hook.length > 120) return { ok: false, why: "the one-line hook is missing or too long" };

  const story = str(row.story);
  if (story.length < 80) return { ok: false, why: "the story is too thin to show" };

  const moment = str(row.moment);
  const dated = str(row.dated) || null;
  if (!moment && !dated) return { ok: false, why: "neither a moment nor a date: nothing to build a card on" };

  const tags = tagsOf(Array.isArray(row.tags) ? row.tags : []);
  if (tags.length < 3) return { ok: false, why: "fewer than three tags we know" };

  const months = Array.isArray(row.months) ? row.months.filter((m): m is number => typeof m === "number") : [];
  const season = seasonFrom(months);
  if (season === 0) return { ok: false, why: "no months given" };

  const budget = row.budget;
  if (!isBudget(budget)) return { ok: false, why: "no budget band" };

  const effort = num(row.effort);
  if (effort === null || effort < 1 || effort > 5) return { ok: false, why: "no effort rating" };

  const rarity = num(row.rarity);
  const wow = num(row.wow);
  if (rarity === null || wow === null) return { ok: false, why: "no rarity or wow score" };

  // Pages really fetched, when the caller has them (builder.ts), beat anything the model says it read.
  const sources = read && read.length ? (read.length >= 2 ? [...read] : "fewer than two sources that can be checked") : sourcesOf(row.sources);
  if (typeof sources === "string") return { ok: false, why: sources };

  const card: Card = {
    id: `crd_built_${at.slug.replace(/-/g, "_")}`,
    slug: at.slug,
    title,
    where: at.where,
    country: at.country,
    at: at.at,
    hook,
    moment,
    dated,
    story,
    tags,
    season,
    budget,
    effort: Math.round(effort),
    rarity: Math.min(1, Math.max(0, rarity)),
    wow: Math.min(1, Math.max(0, wow)),
    photos: [],
    origin: "built",
    sources,
    forUserId,
    // The builder reads pages about a place; it has no way to know what advisory stands over it. The country-level
    // list in bar.ts is what protects a built card, which is the whole reason that list exists.
    advisory: null,
  };

  const verdict = judge(card, against);
  if (!verdict.ok) return { ok: false, why: "it does not clear the bar", verdict };
  return { ok: true, card, verdict };
}
