/**
 * WHAT A PLACE IS, IN THE FEED AND BEHIND IT.
 *
 * One shape for both tiers. A card written by us and a card the bot built for one person differ in exactly two
 * fields — `origin` and `sources` — and the screens show that difference rather than hiding it.
 *
 *   origin "ours"   written by hand, many photographs, no sources to cite because the words are our own
 *   origin "built"  made for one person from pages read today; every claim has somewhere it came from
 *
 * Nothing here names a person. A built card belongs to the person who asked for it until enough people ask for the
 * same place, and then it is written by hand and becomes everyone's.
 */
import type { Budget, SeasonMask, Tag } from "./taxonomy.js";

export interface LatLon { lat: number; lon: number }

/** One photograph. `credit` is required on anything we did not shoot, and is shown wherever the picture is. */
export interface Photo {
  url: string;
  /** What it shows, for a screen reader. */
  alt: string;
  /** "Wikimedia Commons · CC BY-SA · <photographer>", or null for ours. */
  credit: string | null;
  width?: number;
  height?: number;
}

/** Where a built card's words came from: one page, and the day it was read. */
export interface Source {
  /** The host alone ("whc.unesco.org"), which is what a screen shows. */
  host: string;
  url: string;
  /** YYYY-MM-DD, in UTC. */
  readAt: string;
}

export type Origin = "ours" | "built";

/**
 * A place worth keeping. The title is the ACT, not the place name ("The silence of Erg Chebbi"), because the act is
 * what a person pictures themselves doing; the place name lives in `where`.
 */
export interface Card {
  id: string;
  /** Stable, lower case, no spaces: the key the geocoder's answer is filed under, so one place is never two cards. */
  slug: string;
  title: string;
  /** "Sahara, Morocco" — region and country as a person would say them. */
  where: string;
  /** ISO 3166-1 alpha-2, lower case. */
  country: string;
  at: LatLon;
  /** One line, under 120 characters: a thing seen or heard, and the hour it happens. */
  hook: string;
  /**
   * THE MOMENT THE PLACE IS ITSELF: "first light, before the first coach", "when the tide pulls back",
   * "the long blue twilight either side of midwinter". Stated, not guessed from the prose — a card without one
   * has not been thought about, and the bar says so.
   */
  moment: string;
  /** Its past, with a date in it: "a capital of half a million until 1565". Null for a place whose pull is not history. */
  dated: string | null;
  /** Two or three short paragraphs. Empty on a card still being built. */
  story: string;
  tags: Tag[];
  season: SeasonMask;
  budget: Budget;
  /** 1 easy … 5 demanding. */
  effort: number;
  /** 0..1, how rare it is to have heard of it. Drives the "hidden gem" mark and the wildcard. */
  rarity: number;
  /** 0..1, editorial: how much of a moment it is. Ranking only, never shown. */
  wow: number;
  photos: Photo[];
  origin: Origin;
  /** Empty for "ours". At least two for "built", or the card is refused. */
  sources: Source[];
  /** Whose feed it is in. Null for a card everybody gets. */
  forUserId: string | null;
}

/** What the feed was asked for. Everything is optional: with nothing set it is "show me something". */
export interface Ask {
  tags?: readonly Tag[];
  /** ISO 3166-1 alpha-2, lower case. */
  country?: string;
  /** 1-12. A place is kept only if it is at its best then. */
  month?: number;
  budget?: Budget;
  /** How many cards to return. */
  limit?: number;
  /** The person, so their own built cards are in their feed and nobody else's. */
  userId?: string | null;
}

/** A card with the reason it was chosen, which the screens turn into "because you keep saving warm, quiet places". */
export interface Chosen {
  card: Card;
  /** 0..1 after everything. */
  score: number;
  /** Tags of the ask this card actually matched. */
  matched: Tag[];
  /** It was put in deliberately against the ask, to keep the feed from going stale. */
  wildcard: boolean;
}
