/**
 * THE PLACES WE HAVE WRITTEN OURSELVES. Not every place: only ones with something to do at an hour that matters, or a
 * history with a date on it. A town with neither is answered by the bot in words and never becomes a card (bar.ts).
 *
 * Rows, like the city list in src/places/cities.ts, so a place is one line to read and one line to add. Carried over
 * from the Firo catalogue with its coordinates, months and editorial scores unchanged.
 *
 *   CURATED            every card we have written
 *   curatedBySlug(s)   one of them
 *
 * Photographs are filled in by whoever writes the card; a card with none still shows, with its hook and its words.
 */
import type { Card } from "./types.js";
import { seasonFrom, type Budget, type Tag } from "./taxonomy.js";

type Row = [
  slug: string,
  title: string,
  where: string,
  country: string,
  lat: number,
  lon: number,
  hook: string,
  moment: string,
  dated: string | null,
  tags: Tag[],
  months: number[],
  budget: Budget,
  effort: number,
  wow: number,
  rarity: number,
  story: string,
];

const ROWS: Row[] = [
  [
    "lofoten-blue-hour", "Lofoten in the blue hour", "Lofoten, Norway", "no", 67.9333, 13.0894,
    "Red cabins, black water, and a sky that refuses to go fully dark.",
    "the long blue twilight either side of midwinter", null,
    ["cold", "mountains", "photography", "solitude", "nature", "water"], [1, 2, 3, 9, 10, 11, 12], "premium", 2, 0.94, 0.45,
    "For a few weeks either side of midwinter the Lofoten islands sit in a long blue twilight. The peaks turn to silhouettes, the fjord goes to glass, and the whole archipelago feels like somewhere the world forgot to switch the lights on.",
  ],
  [
    "hamnoy-bridge-dawn", "Dawn from the Hamnøy bridge", "Lofoten, Norway", "no", 67.9503, 13.1372,
    "The most photographed view in the Arctic — and still worth standing in the cold for.",
    "dawn, standing on the bridge in the cold", null,
    ["cold", "photography", "mountains", "water", "solitude"], [1, 2, 3, 10, 11, 12], "moderate", 1, 0.88, 0.3,
    "",
  ],
  [
    "vestrahorn-black-sand", "Vestrahorn on black sand", "South Iceland", "is", 64.2494, -14.9819,
    "A jagged mountain rising straight out of a mirror of volcanic beach.",
    "when the tide pulls back and the sand mirrors the peaks", null,
    ["cold", "mountains", "photography", "nature", "solitude", "beach"], [1, 2, 3, 9, 10, 11, 12], "moderate", 2, 0.91, 0.55,
    "Stokksnes is a rare place where a serious mountain meets a black sand beach with nothing in between. When the tide pulls back the sand mirrors the peaks, and in winter the northern lights sometimes finish the picture.",
  ],
  [
    "arashiyama-bamboo-dawn", "The bamboo grove before anyone wakes", "Kansai, Japan", "jp", 35.0094, 135.6668,
    "Get there at first light and the loudest thing is the creak of the stalks.",
    "first light, before the first coach", null,
    ["culture", "nature", "photography", "solitude", "minimalism"], [3, 4, 5, 10, 11, 12], "moderate", 1, 0.82, 0.2,
    "",
  ],
  [
    "gion-lantern-night", "Gion after the lanterns come on", "Kansai, Japan", "jp", 35.0037, 135.7788,
    "Wooden machiya, warm paper light, and the sound of geta on stone.",
    "after the lanterns come on", "a pleasure district laid out in the 1600s",
    ["culture", "city", "food", "architecture", "history", "social"], [3, 4, 5, 9, 10, 11], "premium", 1, 0.79, 0.25,
    "",
  ],
  [
    "tre-cime-circuit", "The Tre Cime circuit", "Dolomites, Italy", "it", 46.6183, 12.3053,
    "Three impossible towers of rock, and a trail that keeps showing them to you.",
    "early, walking it before the car park fills", "its towers were a front line from 1915 to 1917",
    ["hiking", "mountains", "adventure", "nature", "photography"], [6, 7, 8, 9], "moderate", 3, 0.9, 0.28,
    "The loop around the Tre Cime is one of the great half-day walks in Europe: about ten kilometres, never technical, and the mountains rearrange themselves into a new composition at every bend.",
  ],
  [
    "erg-chebbi-silence", "The silence of Erg Chebbi", "Sahara, Morocco", "ma", 31.1497, -3.9764,
    "Dunes the height of buildings, and a quiet so complete it feels physical.",
    "six in the evening, when the wind drops", null,
    ["desert", "warm", "solitude", "adventure", "camping", "minimalism"], [1, 2, 3, 10, 11, 12], "budget", 3, 0.87, 0.62,
    "",
  ],
  [
    "benagil-sea-cave", "Kayaking into the Benagil cave", "Algarve, Portugal", "pt", 37.0876, -8.4267,
    "A cathedral of golden stone with a hole in the roof and a beach on the floor.",
    "first light, kayaking in before the tour boats", null,
    ["water", "warm", "beach", "adventure", "social", "photography"], [5, 6, 7, 8, 9], "budget", 2, 0.81, 0.35,
    "",
  ],
  [
    "machu-picchu-first-light", "Machu Picchu at first light", "Cusco, Peru", "pe", -13.1631, -72.545,
    "Cloud pouring through the saddle while the terraces come out of the dark.",
    "first light, as cloud pours through the saddle", "built in the 1450s and left a century later",
    ["history", "culture", "mountains", "hiking", "adventure", "architecture"], [4, 5, 6, 7, 8, 9], "premium", 3, 0.95, 0.15,
    "",
  ],
  [
    "wanaka-roys-peak", "Roy's Peak before sunrise", "Otago, New Zealand", "nz", -44.7, 169.15,
    "A brutal climb in the dark that pays out over a lake the colour of mercury.",
    "the climb in the dark, to be up for sunrise", null,
    ["hiking", "mountains", "adventure", "nature", "water", "photography"], [11, 12, 1, 2, 3], "moderate", 4, 0.89, 0.4,
    "",
  ],
];

function cardOf(row: Row): Card {
  const [slug, title, where, country, lat, lon, hook, moment, dated, tags, months, budget, effort, wow, rarity, story] = row;
  return {
    id: `crd_${slug.replace(/-/g, "_")}`,
    slug,
    title,
    where,
    country,
    at: { lat, lon },
    hook,
    moment,
    dated,
    story,
    tags: [...tags],
    season: seasonFrom(months),
    budget,
    effort,
    rarity,
    wow,
    photos: [],
    origin: "ours",
    sources: [],
    forUserId: null,
  };
}

export const CURATED: readonly Card[] = ROWS.map(cardOf);

const BY_SLUG = new Map(CURATED.map((c) => [c.slug, c]));

export const curatedBySlug = (slug: string): Card | undefined => BY_SLUG.get(slug.trim().toLowerCase());

/** The countries we have written anything in, for "3 of 8 countries kept" and for telling a person where we are thin. */
export const curatedCountries = (): string[] => [...new Set(CURATED.map((c) => c.country))].sort();
