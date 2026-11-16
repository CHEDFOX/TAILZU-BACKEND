/**
 * TURNING AN ASK INTO A FEED: what is kept, in what order, and the one card put in against the ask on purpose.
 *
 *   pick(cards, ask, now) -> Chosen[]
 *
 * In order:
 *   1. KEEP      country, month and budget are hard — a place out of season is not a suggestion, it is a mistake
 *   2. SCORE     the tags asked for, then how good it is, then how little known it is
 *   3. SPREAD    at most two from one country in a row, so a feed is not all Norway
 *   4. WILDCARD  one card that does NOT match the ask, slotted third, marked as such
 *
 * The wildcard is the point of the whole thing. A feed that only ever confirms what someone already likes stops
 * being looked at within a week; the one that is not what they asked for is what keeps them scrolling. It is marked
 * ("Not your usual") rather than slipped in, because a surprise owned up to is a better surprise.
 *
 * Nothing here is random: the same ask gives the same feed, so a person can go back and find a card again.
 */
import { inSeason, type Tag } from "./taxonomy.js";
import type { Ask, Card, Chosen } from "./types.js";

const DEFAULT_LIMIT = 14;
const MAX_LIMIT = 40;
/** Where the wildcard goes, when there is one to put in. */
const WILDCARD_AT = 2;
/** How many of one country may sit together before the next is pushed down. */
const SAME_COUNTRY_RUN = 2;

/** A card a person asked for is theirs; everyone else only ever sees what was written by hand. */
const visible = (card: Card, userId: string | null | undefined): boolean =>
  card.forUserId === null || (!!userId && card.forUserId === userId);

function keeps(card: Card, ask: Ask): boolean {
  if (ask.country && card.country !== ask.country.toLowerCase()) return false;
  if (ask.month !== undefined && !inSeason(card.season, ask.month)) return false;
  if (ask.budget && card.budget !== ask.budget) return false;
  return true;
}

function overlap(card: Card, tags: readonly Tag[]): Tag[] {
  if (tags.length === 0) return [];
  return tags.filter((t) => card.tags.includes(t));
}

/**
 * 0..1. The tags asked for carry it; what is left separates the good from the merely matching.
 * A card matching every tag asked for cannot be beaten by a prettier card matching fewer.
 */
function scoreOf(card: Card, matched: Tag[], asked: number): number {
  const fit = asked === 0 ? 0 : matched.length / asked;
  return fit * 0.6 + card.wow * 0.25 + card.rarity * 0.15;
}

/** Deterministic: score first, then rarity, then the slug, so two runs never disagree. */
const byScore = (a: Chosen, b: Chosen): number =>
  b.score - a.score || b.card.rarity - a.card.rarity || a.card.slug.localeCompare(b.card.slug);

/** No more than SAME_COUNTRY_RUN of one country together; a third is held back for later in the list. */
function spread(list: Chosen[]): Chosen[] {
  const out: Chosen[] = [];
  const held: Chosen[] = [];
  let run = 0;
  let last = "";
  for (const item of list) {
    if (item.card.country === last && run >= SAME_COUNTRY_RUN) { held.push(item); continue; }
    run = item.card.country === last ? run + 1 : 1;
    last = item.card.country;
    out.push(item);
  }
  return [...out, ...held];
}

export function pick(cards: readonly Card[], ask: Ask = {}): Chosen[] {
  const limit = Math.min(Math.max(1, ask.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const asked = ask.tags ?? [];

  const allowed = cards.filter((c) => visible(c, ask.userId));
  const kept = allowed.filter((c) => keeps(c, ask));

  const matching: Chosen[] = [];
  const rest: Chosen[] = [];
  for (const card of kept) {
    const matched = overlap(card, asked);
    const chosen: Chosen = { card, score: scoreOf(card, matched, asked.length), matched, wildcard: false };
    if (asked.length === 0 || matched.length > 0) matching.push(chosen);
    else rest.push(chosen);
  }

  matching.sort(byScore);
  const ordered = spread(matching).slice(0, limit);

  // The wildcard: in season and allowed, but NOT what they asked for. Only when something was actually asked for,
  // and only when there is room — a feed of three has no space to be surprising.
  if (asked.length > 0 && ordered.length >= WILDCARD_AT + 1 && rest.length > 0) {
    rest.sort((a, b) => b.card.rarity - a.card.rarity || b.card.wow - a.card.wow || a.card.slug.localeCompare(b.card.slug));
    const odd = rest[0]!;
    ordered.splice(WILDCARD_AT, 0, { ...odd, wildcard: true });
    if (ordered.length > limit) ordered.length = limit;
  }

  return ordered;
}

/** How many we could have shown before the limit — "14 places", and the warning when the answer is thin. */
export function countFor(cards: readonly Card[], ask: Ask = {}): number {
  const asked = ask.tags ?? [];
  return cards
    .filter((c) => visible(c, ask.userId))
    .filter((c) => keeps(c, ask))
    .filter((c) => asked.length === 0 || overlap(c, asked).length > 0).length;
}
