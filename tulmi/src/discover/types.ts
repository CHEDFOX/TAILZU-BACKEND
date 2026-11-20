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
import type { Detail } from "./catalog-detail.js";
import type { Budget, SeasonMask, Tag } from "./taxonomy.js";

export interface LatLon { lat: number; lon: number }

/**
 * One picture. `credit` says what KIND it is and is shown wherever the picture is, because every one of these
 * is an illustration rather than a photograph of the place (photos-catalog.ts) and a card must say so.
 */
export interface Photo {
  /** 1280px wide: the one place somebody opened. */
  url: string;
  /** 520px wide: the feed, which shows the whole catalogue at about 160pt a tile. */
  tile?: string;
  /** What it shows, for a screen reader. */
  alt: string;
  /** "Illustration · made for this catalogue, not a photograph of the place". */
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
 * A government travel warning standing over the place. Written on the card rather than applied by hand, so the
 * card survives the advisory changing, and so the bar (bar.ts) can keep it out of the feed while the warning
 * stands. "do_not_travel" is the top level of warning: US Level 4, or its equivalent elsewhere.
 */
export type Advisory = "do_not_travel";

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
  /**
   * How long it takes, how you reach it, and what can stop you (catalog-detail.ts). Empty on a built card: the
   * bot reads pages about a place, and a permit quota it half-remembers is worse than saying nothing.
   */
  detail: Detail;
  /** Whose feed it is in. Null for a card everybody gets. */
  forUserId: string | null;
  /**
   * A standing government warning over this place, or null. A card with one is written and kept, and never shown:
   * a feed that says "go here, it is extraordinary" about a Do Not Travel zone is a liability, not a recommendation.
   */
  advisory: Advisory | null;
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
  /** "because you keep cold, quiet places" — null when the evidence is too thin to say it out loud. */
  reason?: string | null;
}
