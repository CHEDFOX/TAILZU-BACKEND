/**
 * THE FIRST SIX IMAGES, PUT IN ORDER. How a brand-new profile gets its shape, in about fifteen seconds.
 *
 *   FIRST_LOOK                     the six, as the app draws them
 *   foldRanking(taste, order)      their order, folded into the profile
 *
 * ORDER, NOT TICKS. Ticking three of six has 64 possible answers; putting all six in order has 720 — nine bits
 * instead of six, from the same taps. More than that, an order tells us the BOTTOM as well as the top, and a tile
 * nobody ticked tells us nothing at all. Last place is real evidence against (signals.ts rankWeight).
 *
 * PICTURES, NOT QUESTIONS. "Which of these pulls you" is both faster and truer than "do you like adventure?":
 * nobody can describe their own taste in tags, and everybody can point at a photograph. It also needs no
 * translating, which matters for a bot that answers in any language.
 *
 * CHOSEN TO SPLIT PEOPLE, NOT TO PLEASE THEM. This is the part that is easy to get wrong. Landscape preference is
 * a real field — Kaplan and Kaplan on coherence, complexity, legibility and mystery; Appleton on prospect and
 * refuge; Ulrich on what people find restorative — but those findings mostly say what humans like ON AVERAGE:
 * water, a savanna-like opening, a path bending out of sight. Six photographs that are all beautiful in that way
 * would be ranked in nearly the same order by everybody and would teach us nothing.
 *
 * So each of the six is a near-pure instance of one axis where people genuinely disagree, and is deliberately
 * unappealing to the opposite taste:
 *
 *   1 fjord       cold and austere   against   2 lagoon      warm and lush
 *   3 carved      built and old      against   5 ridge       untouched and steep
 *   4 night       other people       against   6 dunes       nobody at all
 *
 * The dunes carry a second job: a track going over a crest and out of sight is Kaplan's "mystery", the most
 * reliable predictor of wanting to go further — which is the exact feeling this whole thing trades in.
 *
 * The photographs are BORROWED FROM THE CATALOGUE (`from`), not held separately: a better photograph on Lofoten
 * improves this screen the same day, and there is one picture pipeline rather than two.
 */
import type { Tag } from "./taxonomy.js";
import { fold, type Taste } from "./taste.js";
import { rankWeight } from "./signals.js";

export interface FirstLookImage {
  id: string;
  /** Two or three words under the photograph. Never a tag name. */
  label: string;
  /** One line, if the app has room. */
  sub: string;
  /** What ranking it high is evidence for. */
  tags: Tag[];
  /** The catalogue card whose photograph illustrates it; null while nothing fits. */
  from: string | null;
  /** Drawn while the photograph loads. */
  colour: string;
}

export interface FirstLook {
  /** Bumped when the six change, so an old answer is never folded with new meanings. */
  version: string;
  title: string;
  sub: string;
  images: FirstLookImage[];
}

export const FIRST_LOOK: FirstLook = {
  version: "1",
  title: "Put these in order",
  sub: "Most like you first. All six — what you leave till last tells me as much.",
  images: [
    {
      id: "fjord",
      label: "Grey water, one red hut",
      sub: "Cold, and nobody about",
      tags: ["cold", "solitude", "water", "minimalism"],
      from: "lofoten-blue-hour",
      colour: "#5F6B6E",
    },
    {
      id: "lagoon",
      label: "Warm shallows",
      sub: "Bright, soft, swimmable",
      tags: ["warm", "beach", "water", "island"],
      from: "benagil-sea-cave",
      colour: "#3E6E8E",
    },
    {
      id: "carved",
      label: "Carved stone, worn steps",
      sub: "Somewhere with a date on it",
      tags: ["history", "architecture", "culture"],
      from: "angkor-wat",
      colour: "#7A6440",
    },
    {
      id: "night",
      label: "A street at midnight",
      sub: "Noise, neon, people eating",
      tags: ["city", "nightlife", "social", "food"],
      from: "gion-lantern-night",
      colour: "#6E4A6B",
    },
    {
      id: "ridge",
      label: "A ridge above the cloud",
      sub: "Earned on foot",
      tags: ["mountains", "hiking", "adventure"],
      from: "tre-cime-circuit",
      colour: "#2F5D50",
    },
    {
      id: "dunes",
      label: "A track over the dunes",
      sub: "Going somewhere you cannot see",
      tags: ["desert", "solitude", "adventure", "minimalism"],
      from: "erg-chebbi-silence",
      colour: "#A9573A",
    },
  ],
};

const BY_ID = new Map(FIRST_LOOK.images.map((i) => [i.id, i]));

export const firstLookImage = (id: string): FirstLookImage | undefined => BY_ID.get(id);

export type RankingProblem = "wrong_count" | "unknown_image" | "repeated_image";

export interface RankingCheck {
  ok: boolean;
  why?: RankingProblem;
}

/**
 * The order must be COMPLETE: every image, once each. A partial order would quietly mean "the rest are equal",
 * which is never what somebody meant, and would turn missing taps into evidence.
 */
export function checkRanking(order: readonly string[]): RankingCheck {
  if (order.length !== FIRST_LOOK.images.length) return { ok: false, why: "wrong_count" };
  const seen = new Set<string>();
  for (const id of order) {
    if (!BY_ID.has(id)) return { ok: false, why: "unknown_image" };
    if (seen.has(id)) return { ok: false, why: "repeated_image" };
    seen.add(id);
  }
  return { ok: true };
}

export interface RankingResult {
  taste: Taste;
  /** How many of the six were folded in. */
  folded: number;
}

/**
 * Their order, into a profile. Each image is one observation whose weight comes from where they put it, so the
 * same machinery that learns from a keep learns from this — there is no second model to keep in step.
 */
export function foldRanking(taste: Taste, order: readonly string[], at: string): RankingResult {
  const check = checkRanking(order);
  if (!check.ok) return { taste, folded: 0 };

  const of = order.length;
  let next = taste;
  let folded = 0;

  order.forEach((id, index) => {
    const image = BY_ID.get(id);
    if (!image) return;
    next = fold(next, { tags: image.tags, weight: rankWeight(index + 1, of), at });
    folded += 1;
  });

  return { taste: next, folded };
}
