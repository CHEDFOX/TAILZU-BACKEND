/**
 * WHAT A PERSON LIKES, AND HOW SURE WE ARE. One number per tag, learned from what they do (signals.ts).
 *
 *   fold(taste, { tags, weight, at })   -> taste        one thing they did, folded in
 *   scoreOf(taste, "cold")              -> -1 .. +1     how much they like it
 *   sureOf(taste, "cold")               ->  0 .. 1      how much evidence stands behind that
 *   match(taste, card.tags)             -> { score, sure, topTag }
 *   because(taste, card.tags)           -> "because you keep quiet, warm places"
 *
 * Ported from the Firo backend's Explorer DNA, which has no framework in it. The decisions worth knowing:
 *
 *   TWO NUMBERS, NOT ONE. Positive and negative evidence are kept apart, so the profile can know somebody avoids
 *   nightlife rather than merely not knowing about it. A profile that can only add likes goes bland.
 *
 *   SHRINKAGE. score = (pos - neg) / (pos + neg + SHRINKAGE), so thin evidence sits near zero and one stray tap
 *   cannot swing anything. As evidence builds, SHRINKAGE stops mattering and the score sharpens.
 *
 *   TASTE TRANSFERS. Liking `cold` is evidence for `solitude` and against `warm` (RELATED below). One tap teaches
 *   us about dimensions the person was never shown, which is the difference between learning and counting.
 *
 *   OLD EVIDENCE FADES, half-life 180 days, so the profile is who they are now and not who they were.
 *
 *   OUR OWN BIAS IS DIVIDED OUT. Interest in a tag is damped by how often we showed that tag, so a feed cannot
 *   teach itself that everyone loves what it happens to show.
 *
 *   CREDIT IS SPLIT. A reaction is to a PLACE, not to a tag. Somebody rejecting Gion disliked one thing about it,
 *   not culture and food and history equally, so weight divides by the square root of the tag count.
 *
 * Every function here is pure. No clock of its own, no table, no model.
 */
import { TAGS, type Tag } from "./taxonomy.js";

/** Prior strength. Higher is more conservative: one keep lands near 0.5, six consistent signals reach confidence. */
export const SHRINKAGE = 6;
/** Evidence half-life in days. */
export const HALF_LIFE_DAYS = 180;
const MS_DAY = 86_400_000;
/** How much of a signal reaches a correlated tag. Always less than the direct one. */
export const TRANSFER_DAMPING = 0.35;

export interface Dimension {
  /** Evidence for, after decay. */
  pos: number;
  /** Evidence against, after decay. */
  neg: number;
  /** How many times we SHOWED them something with this tag. */
  shown: number;
  /** When this dimension last moved, ISO. */
  at: string;
}

export type TasteVector = Partial<Record<Tag, Dimension>>;

/**
 * HOW HARD, AND HOW EXPENSIVE — which are LEVELS, not likes.
 *
 * A tag is something you are for or against, so it gets pos and neg. Effort is not: nobody is "against 3 out of
 * 5". What we want is where on the scale somebody sits and how sure we are of it, so these keep a weighted mean
 * instead — `sum / weight`, with `weight` playing the part that evidence plays in `sure`.
 *
 * THEY LEARN FROM WHAT SOMEBODY WANTED, NEVER FROM WHAT THEY REFUSED. A keep on a five-day trek is evidence that
 * this person will walk. "Not for me" on the same card is not evidence against walking — it could be the cold,
 * the price, the country or the picture, and we have no way to tell which. A negative signal moves the tags and
 * leaves the levels alone, because a wrong inference here sends somebody up a mountain or into a hostel.
 */
export interface Scale {
  /** Sum of (level x weight). */
  sum: number;
  /** Sum of the weights behind it. */
  weight: number;
  at: string;
}

export const EMPTY_SCALE: Scale = { sum: 0, weight: 0, at: "1970-01-01T00:00:00.000Z" };

/** The levels a plan needs and a feed does not. */
export type Level = "effort" | "budget";
export type Scales = Partial<Record<Level, Scale>>;

export interface Taste {
  /** Per tag. A tag with no evidence is simply absent. */
  dims: TasteVector;
  /** Effort and budget, as levels. Absent until something positive has been folded in. */
  scales?: Scales;
  /** How many signals have been folded in, all told. */
  signals: number;
  at: string;
  /** Bumped on every fold, so a stale write can be spotted. */
  version: number;
}

export const EMPTY_DIMENSION: Dimension = { pos: 0, neg: 0, shown: 0, at: "1970-01-01T00:00:00.000Z" };

export const emptyTaste = (at: string): Taste => ({ dims: {}, scales: {}, signals: 0, at, version: 0 });

export const dimOf = (t: Taste, tag: Tag): Dimension => t.dims[tag] ?? EMPTY_DIMENSION;

/** -1 .. +1. Zero means no opinion, not a middling one. */
export function score(d: Dimension): number {
  const total = d.pos + d.neg;
  if (total === 0) return 0;
  return (d.pos - d.neg) / (total + SHRINKAGE);
}

/** 0 .. 1 — how much evidence stands behind the score. */
export const sure = (d: Dimension): number => {
  const total = d.pos + d.neg;
  return total / (total + SHRINKAGE);
};

export const scoreOf = (t: Taste, tag: Tag): number => score(dimOf(t, tag));
export const sureOf = (t: Taste, tag: Tag): number => sure(dimOf(t, tag));

/** Big while we know little, small once we are sure: fast to learn, slow to whiplash. Capped at 2x. */
export const learningRate = (d: Dimension): number => 1 + (1 - sure(d));

/** Old evidence fades. */
export function decayFactor(fromIso: string, toMs: number): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from) || toMs <= from) return 1;
  return 0.5 ** ((toMs - from) / MS_DAY / HALF_LIFE_DAYS);
}

function decayed(d: Dimension, nowMs: number): Dimension {
  const f = decayFactor(d.at, nowMs);
  return f === 1 ? d : { pos: d.pos * f, neg: d.neg * f, shown: d.shown * f, at: d.at };
}

/**
 * EVERY DIMENSION, BROUGHT UP TO NOW. Fading happens when a dimension is touched, which is enough while somebody
 * is active but not when they are not: a profile left alone for a year would otherwise still be ranked on its old
 * scores, because nothing had touched those tags to fade them. So a profile is brought up to date when it is
 * LOADED, and the maths here stays pure — no function in this file reads a clock of its own.
 */
export function decayAll(t: Taste, nowMs: number): Taste {
  const dims: TasteVector = {};
  let moved = false;
  const nowIso = new Date(nowMs).toISOString();
  for (const tag of TAGS) {
    const d = t.dims[tag];
    if (!d) continue;
    const f = decayFactor(d.at, nowMs);
    if (f === 1) { dims[tag] = d; continue; }
    moved = true;
    dims[tag] = { pos: d.pos * f, neg: d.neg * f, shown: d.shown * f, at: nowIso };
  }
  return moved ? { ...t, dims } : t;
}

/** Our own bias, divided out. Damped with a +1 so a first-ever showing is not extreme. */
export function exposureNormalised(weight: number, shown: number): number {
  if (weight <= 0) return weight;
  return weight * (1 / Math.sqrt(1 + shown / 10));
}

/** A reaction is to a place, not to a tag: six tags must not become six strong opinions. */
export const tagDilution = (count: number): number => (count <= 1 ? 1 : 1 / Math.sqrt(count));

// ===================================================================== how tastes relate

type Pair = readonly [Tag, Tag, number];

/**
 * Hand-seeded, symmetric, and deliberately conservative. A negative pair means evidence for one is weak evidence
 * against the other. Once there is real behaviour these belong learned from what people keep together; the shape
 * stays the same, so that is a data change and not a code change.
 */
const RELATED: readonly Pair[] = [
  ["cold", "solitude", 0.45], ["cold", "mountains", 0.4], ["cold", "minimalism", 0.3],
  ["solitude", "nature", 0.4], ["solitude", "minimalism", 0.35],
  ["mountains", "hiking", 0.6], ["mountains", "nature", 0.5],
  ["hiking", "adventure", 0.55], ["hiking", "camping", 0.45],
  ["camping", "adventure", 0.4], ["camping", "nature", 0.4],
  ["wildlife", "nature", 0.55], ["wildlife", "adventure", 0.3],
  ["warm", "beach", 0.5], ["beach", "water", 0.6], ["beach", "island", 0.5], ["island", "water", 0.45],
  ["warm", "social", 0.2], ["social", "nightlife", 0.55], ["nightlife", "city", 0.5], ["social", "food", 0.35],
  ["culture", "history", 0.6], ["culture", "architecture", 0.5], ["history", "architecture", 0.5],
  ["city", "architecture", 0.45], ["city", "food", 0.4], ["culture", "food", 0.35], ["luxury", "city", 0.25],
  ["photography", "nature", 0.3], ["photography", "architecture", 0.25],
  ["road_trip", "adventure", 0.4], ["road_trip", "nature", 0.3],
  ["desert", "warm", 0.4], ["desert", "solitude", 0.4], ["desert", "minimalism", 0.35],
  ["adventure", "nature", 0.3],
  // Genuine opposites.
  ["solitude", "social", -0.5], ["solitude", "nightlife", -0.35], ["cold", "warm", -0.45],
  ["luxury", "camping", -0.4], ["minimalism", "luxury", -0.3], ["city", "nature", -0.25],
];

const MATRIX: Map<Tag, Map<Tag, number>> = (() => {
  const m = new Map<Tag, Map<Tag, number>>();
  const link = (a: Tag, b: Tag, w: number): void => {
    const row = m.get(a) ?? new Map<Tag, number>();
    row.set(b, w);
    m.set(a, row);
  };
  for (const [a, b, w] of RELATED) { link(a, b, w); link(b, a, w); }
  return m;
})();

export function transferWeight(from: Tag, to: Tag): number {
  if (from === to) return 1;
  return (MATRIX.get(from)?.get(to) ?? 0) * TRANSFER_DAMPING;
}

// ===================================================================== learning

export interface Observation {
  /** The card's tags. */
  tags: readonly Tag[];
  /** Signed evidence (signals.ts weightOf). */
  weight: number;
  at: string;
  /** True for a "shown": no evidence of taste, only of our choices. */
  onlyShown?: boolean;
  /**
   * The card's own effort (1-5) and budget (1-4). Folded into the LEVELS, and only when the signal is positive —
   * see the note on Scale for why a rejection teaches us nothing about either.
   */
  levels?: { effort?: number; budget?: number };
}

/**
 * Fold one thing they did into the profile. Applied to each of the card's tags, then a damped share to every tag
 * correlated with those — so a single keep moves a dozen dimensions, most of them gently.
 */
export function fold(t: Taste, o: Observation, nowMs: number = Date.parse(o.at)): Taste {
  const nowIso = new Date(nowMs).toISOString();
  const dims: TasteVector = { ...t.dims };

  // Which tags move, and by how much of the signal. A direct hit always beats a transfer.
  const share = new Map<Tag, number>();
  for (const tag of o.tags) share.set(tag, 1);
  for (const tag of o.tags) {
    for (const other of TAGS) {
      if (share.get(other) === 1) continue;
      const w = transferWeight(tag, other);
      if (w === 0) continue;
      const had = share.get(other) ?? 0;
      if (Math.abs(w) > Math.abs(had)) share.set(other, w);
    }
  }

  for (const [tag, part] of share) {
    const now = decayed(dims[tag] ?? EMPTY_DIMENSION, nowMs);

    if (o.onlyShown) {
      // Counted, never credited: this is what lets us divide out our own bias later.
      if (part === 1) dims[tag] = { ...now, shown: now.shown + 1, at: nowIso };
      continue;
    }

    const raw = o.weight * part * learningRate(now) * tagDilution(o.tags.length);
    const adjusted = exposureNormalised(raw, now.shown);
    dims[tag] = {
      pos: now.pos + Math.max(0, adjusted),
      neg: now.neg + Math.max(0, -adjusted),
      shown: now.shown,
      at: nowIso,
    };
  }

  // The levels: only what they went toward, never what they turned down.
  const scales: Scales = { ...t.scales };
  if (!o.onlyShown && o.weight > 0 && o.levels) {
    for (const level of ["effort", "budget"] as const) {
      const of = o.levels[level];
      if (typeof of !== "number" || !Number.isFinite(of)) continue;
      const had = scales[level] ?? EMPTY_SCALE;
      scales[level] = { sum: had.sum + of * o.weight, weight: had.weight + o.weight, at: nowIso };
    }
  }

  return { dims, scales, signals: t.signals + 1, at: nowIso, version: t.version + 1 };
}

// ===================================================================== levels

/** What we think somebody's level is, and whether we actually know it. */
export interface Reading {
  /** The weighted mean, on the dimension's own scale. Meaningless when `sure` is low. */
  of: number;
  /** 0 .. 1, the same shrinkage as a tag: thin evidence is honestly thin. */
  sure: number;
}

/**
 * HOW SURE WE HAVE TO BE BEFORE WE STOP ASKING.
 *
 * Under this, a planner asks the person instead of guessing, and says that is what it is doing. Over it, we have
 * watched them choose enough times to not waste a question. Deliberately not high: three or four keeps is a real
 * signal, and a product that interrogates somebody who has already told it through their behaviour is worse than
 * one that occasionally gets it slightly wrong.
 */
export const KNOWN_AT = 0.45;

export const readingOf = (t: Taste, level: Level): Reading => {
  const s = t.scales?.[level] ?? EMPTY_SCALE;
  return { of: s.weight > 0 ? s.sum / s.weight : 0, sure: s.weight / (s.weight + SHRINKAGE) };
};

/** Whether a plan can get on without asking about this. */
export const weKnow = (t: Taste, level: Level): boolean => readingOf(t, level).sure >= KNOWN_AT;

/** Somebody answered a question we could not answer ourselves. Folded like any other evidence, and heavily. */
export const ANSWER_WEIGHT = 8;

export function told(t: Taste, level: Level, of: number, at: string): Taste {
  const had = t.scales?.[level] ?? EMPTY_SCALE;
  return {
    ...t,
    scales: { ...t.scales, [level]: { sum: had.sum + of * ANSWER_WEIGHT, weight: had.weight + ANSWER_WEIGHT, at } },
    at,
    version: t.version + 1,
  };
}

// ===================================================================== using it

export interface Match {
  /** -1 .. +1 — how well this place matches them. */
  score: number;
  /** 0 .. 1 — how much evidence that judgement rests on. */
  sure: number;
  /** The tag that carried it, for saying why. */
  topTag: Tag | null;
}

/**
 * A place's tags against the profile. Confidence-weighted rather than averaged, so dimensions we really know
 * dominate ones we are guessing at — which keeps the first few feeds sane instead of erratic.
 */
export function match(t: Taste, tags: readonly Tag[]): Match {
  if (tags.length === 0) return { score: 0, sure: 0, topTag: null };

  let sum = 0;
  let weight = 0;
  let topTag: Tag | null = null;
  let best = 0;

  for (const tag of tags) {
    const s = scoreOf(t, tag);
    const w = Math.max(sureOf(t, tag), 0.15);
    sum += s * w;
    weight += w;
    if (s * w > best) { best = s * w; topTag = tag; }
  }

  const sureness = tags.reduce((acc, tag) => acc + sureOf(t, tag), 0) / tags.length;
  return { score: weight === 0 ? 0 : sum / weight, sure: sureness, topTag };
}

export interface TasteLine { tag: Tag; score: number; sure: number }

const ranked = (t: Taste): TasteLine[] =>
  TAGS.map((tag) => ({ tag, score: scoreOf(t, tag), sure: sureOf(t, tag) }));

/** Their strongest likings, for "because you…". */
export const likes = (t: Taste, limit = 5, minSure = 0.25): TasteLine[] =>
  ranked(t).filter((l) => l.score > 0.05 && l.sure >= minSure)
    .sort((a, b) => b.score * b.sure - a.score * a.sure).slice(0, limit);

/** What they turn down. Used as a soft filter, never a hard one: people change. */
export const dislikes = (t: Taste, minSure = 0.25): TasteLine[] =>
  ranked(t).filter((l) => l.score < -0.15 && l.sure >= minSure).sort((a, b) => a.score - b.score);

/** How much of them we actually know, 0..1 — by dimensions we are sure of, not by how much they tapped. */
export const known = (t: Taste): number =>
  Math.min(1, TAGS.reduce((sum, tag) => sum + sureOf(t, tag), 0) / TAGS.length);

/** A tag in words a person would use about themselves. */
const SAID: Partial<Record<Tag, string>> = {
  cold: "cold, quiet places", warm: "warm places", solitude: "places with nobody else around",
  social: "places with some life in them", mountains: "mountains", water: "water", beach: "beaches",
  island: "islands", desert: "deserts", city: "cities", nightlife: "a night out", food: "eating well",
  history: "places with a past", culture: "how people live somewhere", architecture: "buildings worth looking at",
  hiking: "walking somewhere hard to reach", camping: "sleeping outside", wildlife: "animals",
  nature: "being outside", photography: "places worth photographing", adventure: "a bit of effort",
  minimalism: "bare, simple places", luxury: "being looked after", road_trip: "driving somewhere",
};

export const saidAs = (tag: Tag): string => SAID[tag] ?? tag.replace(/_/g, " ");

/**
 * "Because you keep cold, quiet places." Null when the evidence is too thin to say it out loud — a made-up reason
 * is worse than none, because the whole point of this model over an opaque one is that it can be checked.
 */
export function because(t: Taste, tags: readonly Tag[], minSure = 0.3): string | null {
  const m = match(t, tags);
  if (!m.topTag || m.score <= 0.1 || m.sure < minSure) return null;
  if (sureOf(t, m.topTag) < minSure) return null;
  return `because you keep ${saidAs(m.topTag)}`;
}
