/**
 * THE DISCOVER TOOLS AS A BOT SEES THEM (bots/tools.ts buildTools): their definitions, who gets them, and what the
 * model reads back.
 *
 *   places_discover   places worth going, by what they are like, the month, the country and the budget
 *   place_build       a place nobody has written yet: read about it, make a card, keep it in their feed
 *   place_open        one place in full, for when the bot is about to talk about it
 *
 * The Travel bot gets both, and so does any bot that searches the web. The tags in the schema are the closed list
 * (taxonomy.ts), so the model picks from our vocabulary instead of inventing one, and a sentence like "somewhere
 * warm and quiet in March" becomes three exact arguments rather than a web search and a hope.
 *
 * What the model reads back is a few lines a card, with the hook, where it is and when it is at its best. The word
 * OURS or BUILT is on each one, because a card we wrote and a card the bot built for this person are not the same
 * kind of claim, and the answer should not pretend otherwise.
 */
import type { PlacesCard, PlacePick } from "../everyday/types.js";
import type { Discover } from "./index.js";
import { isBudget, seasonWords, TAGS, type Tag } from "./taxonomy.js";
import type { Chosen } from "./types.js";

export interface DiscoverToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface DiscoverToolResult { content: string; ok: boolean }

/** What was asked for, in the words the card's header shows: "warm, quiet · March". */
export function askWords(tags: readonly string[], month?: number, country?: string): string {
  const when = month ? MONTHS[month - 1] : null;
  return [tags.join(", "), when, country ? country.toUpperCase() : null].filter(Boolean).join(" · ");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** One chosen card, as a row the apps draw (experience/bots/screens/finds.ts). Already in words. */
function pickOf(chosen: Chosen): PlacePick {
  const { card } = chosen;
  const photo = card.photos[0];
  return {
    slug: card.slug,
    title: card.title,
    where: card.where,
    hook: card.hook,
    season: seasonWords(card.season),
    budget: card.budget,
    tags: [...card.tags],
    ...(photo ? { photo: { url: photo.url, alt: photo.alt, credit: photo.credit } } : {}),
    ours: card.origin === "ours",
    wildcard: chosen.wildcard,
  };
}

/** The card beside the answer: what was asked, what was found, and how many there were. */
export function placesCardOf(query: string, found: readonly Chosen[], total: number): PlacesCard {
  return { kind: "places", query, results: found.map(pickOf), total };
}

/** Which bots get these: the Travel bot, and anything that already searches the web. */
export const discoverFor = (bot: { id: string; skills: { web?: boolean; research?: boolean } }): boolean =>
  bot.id === "travel" || !!(bot.skills.web || bot.skills.research);

export const DISCOVER_TOOLS: readonly DiscoverToolDef[] = [
  {
    name: "places_discover",
    description:
      "Places worth going, from our own written catalogue. Use it whenever somebody asks where to go rather than how to get there — 'somewhere warm and quiet in March', 'ideas for a week off', 'where should I go'. Turn their sentence into tags from the list, a month (1-12) worked out from today, and a country only if they named one. Returns a few places with a one-line hook each; say two or three of them back, never the whole list. These are our words, not live prices: never quote a cost from them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tags: { type: "array", maxItems: 5, items: { type: "string", enum: [...TAGS] }, description: "What the place should be like. Fewer and truer beats five loose ones." },
        month: { type: "integer", minimum: 1, maximum: 12, description: "Only places at their best in this month." },
        country: { type: "string", minLength: 2, maxLength: 2, description: "ISO country code, lower case, only if they named a country." },
        budget: { type: "string", enum: ["budget", "moderate", "premium", "luxury"] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: "place_build",
    description:
      "For a place nobody has written about yet: read about it and make a card for this person. Use it when they name somewhere places_discover does not have — a town, a temple, a park. It reads pages, cites them, and refuses places with nothing to see at a particular hour and no dated history: if it refuses, say so plainly and offer to plan the trip anyway. Takes a few seconds; never call it twice for the same place.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["place"],
      properties: { place: { type: "string", minLength: 2, maxLength: 80, description: "What they called it: \"hampi\", \"Lalibela\", \"Mount Abu\"." } },
    },
  },
  {
    name: "place_open",
    description: "One place in full, by the slug a places_discover result gave. Use it before describing a place at any length, so what you say is what the card says.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["slug"],
      properties: { slug: { type: "string", minLength: 2, maxLength: 80 } },
    },
  },
];

const tagsFrom = (v: unknown): Tag[] => {
  if (!Array.isArray(v)) return [];
  const known = new Set<string>(TAGS);
  return v.filter((t): t is Tag => typeof t === "string" && known.has(t));
};

const intFrom = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

/** One line a card: enough for the model to choose and to say it back, never the whole story. */
function lineOf(chosen: Chosen, index: number): string {
  const { card } = chosen;
  const season = seasonWords(card.season, true);
  const bits = [
    `${index + 1}. ${card.title} — ${card.where}`,
    `slug ${card.slug}`,
    season ? `best ${season}` : null,
    card.budget,
    card.tags.slice(0, 4).join(", "),
    card.origin === "ours" ? "OURS" : "BUILT for this person",
    chosen.wildcard ? "NOT what they asked for, offer it as a change of mind" : null,
  ].filter(Boolean);
  return `${bits.join(" · ")}\n   "${card.hook}"`;
}

export async function runDiscover(d: Discover, userId: string, name: string, args: Record<string, unknown>, found?: (c: PlacesCard) => void): Promise<DiscoverToolResult> {
  if (name === "place_open") {
    const slug = typeof args.slug === "string" ? args.slug : "";
    const card = await d.open(slug, userId);
    if (!card) return { content: `No place called ${slug || "that"}. Use places_discover first and open one of its slugs.`, ok: false };
    const season = seasonWords(card.season);
    const lines = [
      `${card.title} — ${card.where}`,
      `${card.hook}`,
      season ? `Best ${season}. ${card.budget}, effort ${card.effort} of 5.` : `${card.budget}, effort ${card.effort} of 5.`,
      `Tags: ${card.tags.join(", ")}.`,
      card.story ? `\n${card.story}` : "",
      card.origin === "ours"
        ? "\nOurs: our own words. Not a price and not a forecast."
        : `\nBuilt for this person from ${card.sources.map((s) => s.host).join(", ")}, read ${card.sources[0]?.readAt ?? "recently"}. Say where it came from if you use it.`,
    ].filter(Boolean);
    return { content: lines.join("\n"), ok: true };
  }

  if (name === "place_build") {
    const place = typeof args.place === "string" ? args.place.trim() : "";
    if (place.length < 2) return { content: "place_build needs a place.", ok: false };
    if (!d.canBuild) return { content: "I cannot write up a new place right now. Say so, and offer what we already have, or to plan the trip anyway.", ok: false };

    const out = await d.build(place, userId);
    if (!out.ok) {
      return { content: `${out.why} Say that plainly — do not invent the place — and offer to plan the trip there anyway, or to look on the web.`, ok: true };
    }

    const card = out.card;
    const season = seasonWords(card.season);
    if (found) found(placesCardOf(card.where, [{ card, score: 1, matched: [], wildcard: false }], 1));
    return {
      content: [
        `Made a card for ${card.where} and kept it in their feed:`,
        `${card.title} — "${card.hook}"`,
        season ? `Best ${season}. ${card.budget}, effort ${card.effort} of 5.` : `${card.budget}, effort ${card.effort} of 5.`,
        card.story,
        card.sources.length ? `Read today from ${card.sources.map((s) => s.host).join(", ")} — say where it came from.` : "",
        "These are not our own words: they are the web's, read just now. No prices in them.",
      ].filter(Boolean).join("\n"),
      ok: true,
    };
  }

  if (name !== "places_discover") return { content: `There is no tool called ${name}.`, ok: false };

  const tags = tagsFrom(args.tags);
  const month = intFrom(args.month);
  const limit = intFrom(args.limit);
  const country = typeof args.country === "string" && args.country.length === 2 ? args.country.toLowerCase() : undefined;
  const budget = isBudget(args.budget) ? args.budget : undefined;

  const ask = {
    userId,
    ...(tags.length ? { tags } : {}),
    ...(month !== undefined ? { month } : {}),
    ...(country ? { country } : {}),
    ...(budget ? { budget } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };

  const chosen = await d.ask(ask);
  const total = await d.count(ask);

  // The person sees these as cards; the model reads the lines below and chooses two or three to say.
  if (found && chosen.length) found(placesCardOf(askWords(tags, month, country), chosen, total));

  if (chosen.length === 0) {
    const written = d.countries();
    return {
      content: [
        "Nothing of ours matches that.",
        `We have written places in ${written.length} countries so far (${written.join(", ")}).`,
        "Say so plainly — do not invent a place — and offer to look on the web instead, or to plan a trip to somewhere they name.",
      ].join(" "),
      ok: true,
    };
  }

  const head = total > chosen.length ? `${total} places match; the best ${chosen.length}:` : `${chosen.length} places:`;
  return {
    content: [
      head,
      ...chosen.map(lineOf),
      "",
      "Offer two or three, not the list. Our own words; flights and stays are searched live, never quoted from here.",
    ].join("\n"),
    ok: true,
  };
}
