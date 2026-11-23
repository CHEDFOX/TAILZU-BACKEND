/**
 * WHEN THE PERSON HAS NO DESIGN IDEA: ONE CONCRETE THING, NOT A PILE OF ADJECTIVES.
 *
 * A project with a frontend already has a look, and the kit reads it (artifacts/kit.ts). This is the other case: nothing to read, and a person who
 * could not tell you what they want it to look like, because that is not their job. The usual answers are both wrong.
 *
 * ASKING FOR ADJECTIVES IS WRONG. "Modern, clean, trustworthy, premium" names a REGION, and a model asked for a region produces its centre, which
 * is the average of everything — which is exactly the generic page everyone complains about. A specific thing names a POINT.
 *
 * A MENU OF LOOKS IS WRONG TOO, and this is the less obvious one. Offer twelve named styles and within a month you have twelve new defaults; the
 * menu does not remove the default, it relocates it. The same goes for a ranked list of the model's own ideas: ranking hands the choice back to
 * the thing that produced the problem, and it will pick the safe one every time.
 *
 * SO: DERIVE, THEN DEAL.
 *
 *   1. From what the product actually is, list concrete things its audience already knows by heart — objects, places, printed matter, instruments,
 *      rituals. Not moods. Each one with what it looks like and what material world it belongs to.
 *   2. Throw out the rut: the page this category always ships, and its obvious opposite. Both are defaults.
 *   3. Check the list actually spread: at least three different material families, or it stopped at the first obvious thing and is asked again.
 *   4. DEAL a few at random rather than ranking them. The deal is the whole anti-convergence mechanism and it is why this is not a menu.
 *   5. One of them is the direction, and its restrictions come FREE. A model knows what a 1970s university lecture handout is, and it knows what
 *      one is not: it does not glow, it has no gradient, it has no hero. Nobody has to write that list, and a long list of don'ts is a sign the
 *      direction was too vague to carry them.
 *
 * HANDS FREE BY DEFAULT. It decides and gets on with it; it asks only when it cannot tell what the product even is, because a wrong guess there is
 * worse than a question. And the person steers with one word — plain, safer, bolder — rather than describing a design, because steering one axis
 * is something anyone can do and describing a design is not.
 *
 * DECIDED ONCE. The choice goes in the project's book like any other fact about it, and every later job is simply shown it. A direction that moves
 * between jobs is worse than a dull one.
 */
import { z } from "zod";
import { askJson, cut, fence, forModel, oneLine, type ModelCtx } from "../work/model.js";

/** How many candidates are asked for, and how many of them are dealt. */
export const CANDIDATES = 7;
export const DEALT = 3;
/** Below this many distinct material families the list stopped at the subject's most obvious artifact, and is asked again. Once. */
export const FAMILIES_MIN = 3;
export const ASK_AGAIN_MAX = 1;
/** The most characters of a candidate kept. */
export const FIELD_MAX = 160;

/** How bold the person wants it. The only steering there is, because it is the only one someone with no design idea can actually use. */
export type Register = "plain" | "safer" | "bolder";

/** One concrete thing from the audience's world that could carry the product. */
export interface Candidate {
  /** The thing itself, named concretely: "a 1970s university lecture handout", not "academic". */
  thing: string;
  /** Why this audience knows it by heart, and why it fits what the product does. */
  why: string;
  /** What it LOOKS like: its ground and main colours, its type voices, the one signature that makes it recognisable. */
  look: string;
  /** The material world it belongs to — print, signage, textile, instrument, architecture, screen — used only to check the list spread. */
  family: string;
}

export const ReferentReply = z.object({
  candidates: z.array(z.object({
    thing: z.string().min(3).max(FIELD_MAX),
    why: z.string().min(3).max(FIELD_MAX),
    look: z.string().min(3).max(FIELD_MAX),
    family: z.string().min(2).max(40),
  })).min(4).max(CANDIDATES),
  /** The page this kind of product always ships, which is kept OUT of the list. Naming it is what keeps it out. */
  rut: z.string().max(FIELD_MAX).optional(),
});

/** The words that name a region rather than a point. A direction made of these is not a direction. */
const VAGUE = new Set([
  "modern", "clean", "minimal", "minimalist", "sleek", "premium", "professional", "trustworthy", "elegant", "bold",
  "playful", "friendly", "simple", "beautiful", "sophisticated", "innovative", "dynamic", "fresh", "vibrant", "stunning",
]);

/** Whether a candidate is a thing or just a mood wearing a noun. A direction has to be something that exists. */
export function concrete(thing: string): boolean {
  const words = String(thing ?? "").toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  if (words.length < 2) return false;
  // All adjective and no object: "clean modern design" names nothing.
  return words.some((w) => !VAGUE.has(w) && w.length > 2);
}

/** How many different material worlds the list reaches across. Fewer than three and it stopped at the first obvious answer. */
export const familyCount = (cs: readonly Candidate[]): number => new Set(cs.map((c) => c.family.trim().toLowerCase())).size;

/** A small deterministic hash, so a job's hand is the same hand after a restart. */
function hash(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return Math.abs(h) / 2 ** 31; };
}

/**
 * Deals a few of the candidates at random. THIS IS THE POINT, not a detail: handing over a ranked list gives the choice back to the same taste
 * that produced the sameness, and it will take the safe card every time. The deal breaks that while leaving a real choice. Deterministic from the
 * seed, so a restart deals the same hand and a job does not quietly change direction halfway through.
 */
export function deal(candidates: readonly Candidate[], seed: string, n = DEALT): Candidate[] {
  const rnd = hash(seed);
  const pool = [...candidates];
  const out: Candidate[] = [];
  while (pool.length && out.length < n) out.push(...pool.splice(Math.floor(rnd() * pool.length), 1));
  return out;
}

const REGISTER_ASK: Readonly<Record<Register, string>> = {
  plain: "A fresh set, as wide as before.",
  safer: "Lean towards what this audience already trusts; familiar and well made is a real destination, not a failure of nerve.",
  bolder: "Reach further from the obvious, and commit fully to whatever you reach for.",
};

export interface ReferentInput {
  /** What the product is and who it is for, in the person's own words or the book's. */
  what: string;
  /** A seed for the deal, so the same job deals the same hand: the job's id. */
  seed: string;
  register?: Register;
}

export type Referent =
  /** One concrete direction, and the others that were dealt beside it, for a person who wants to steer. */
  | { kind: "one"; chosen: Candidate; dealt: Candidate[]; rut?: string }
  /** Nothing could be derived: there is not enough about the product to say, and a wrong guess is worse than a question. */
  | { kind: "unclear"; why: string };

/**
 * Derives a direction. Never throws: a model that cannot be reached is "unclear", which is the safe end, because building to a guessed direction
 * is the one failure that cannot be undone cheaply later.
 */
export async function referentFor(i: ReferentInput, model: ModelCtx | null): Promise<Referent> {
  if (!model) return { kind: "unclear", why: "there is no model here to work out a direction" };
  const said = oneLine(i.what, 600);
  if (said.replace(/[^a-z0-9]/gi, "").length < 12) return { kind: "unclear", why: "there is not enough about what this is for to derive a direction from" };

  let best: Candidate[] = [];
  let rut: string | undefined;
  for (let round = 0; round <= ASK_AGAIN_MAX; round += 1) {
    const r = await askJson(model, {
      tier: "cheap", purpose: "code.referent", role: "code_referent", schema: ReferentReply, maxTokens: 900,
      user: [
        `<product>\n${fence(cut(forModel(said), 600))}\n</product>`,
        i.register ? `How far to reach: ${REGISTER_ASK[i.register]}` : "",
        round > 0 ? `Your last list came from ${familyCount(best)} material world(s), which means it stopped at the most obvious artifact. Go further: at least ${FAMILIES_MIN}.` : "",
      ].filter(Boolean).join("\n"),
    });
    if (!r.ok) return { kind: "unclear", why: "the direction could not be worked out just now" };
    const got = r.value.candidates
      .map((c) => ({ thing: oneLine(c.thing, FIELD_MAX), why: oneLine(c.why, FIELD_MAX), look: oneLine(c.look, FIELD_MAX), family: oneLine(c.family, 40) }))
      .filter((c) => concrete(c.thing));
    rut = r.value.rut ? oneLine(r.value.rut, FIELD_MAX) : rut;
    if (got.length > best.length) best = got;
    if (familyCount(got) >= FAMILIES_MIN && got.length >= DEALT) { best = got; break; }
  }
  if (best.length < 2) return { kind: "unclear", why: "nothing concrete enough to build to came back" };

  const hand = deal(best, i.seed);
  return { kind: "one", chosen: hand[0]!, dealt: hand, ...(rut ? { rut } : {}) };
}

/**
 * The direction as the model building the thing is told it. Short on purpose: naming the object carries its own restrictions, and a long list of
 * don'ts underneath would only prove the direction was too vague to carry them.
 */
export function referentBrief(c: Candidate, rut?: string): string {
  return [
    `The design direction for this project is: ${c.thing}.`,
    `What it looks like: ${c.look}`,
    `Why it fits: ${c.why}`,
    "",
    "Build to that thing, not to a description of it. You know what it is and you know what it is NOT — whatever that object would never do, this page does not do either, and nobody has to list those out.",
    ...(rut ? [`What this kind of product usually ships, and what this is not: ${rut}.`] : []),
    "Where the request pins something down, the request wins, always. Where it leaves a choice open, make it from this direction rather than from what you would reach for on any page.",
  ].join("\n");
}
