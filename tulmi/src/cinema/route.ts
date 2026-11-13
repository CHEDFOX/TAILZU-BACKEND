/**
 * WHICH MODEL ANIMATES WHICH SHOT. The person never has to know a model's name: each shot is matched to the model that is best at what it
 * needs, within the film's tier, at a price that is worth it. (They can still pin one: a pinned model is used whenever it can do the shot.)
 *
 * What a shot needs is read from its card (`needs`): faces in close shots, fast motion, physics (water, fire, cloth), a camera move, spoken
 * lines (a model that makes its own sound and moves lips), readable words, a style that is not live action. Each need weighs the models'
 * scores for it (models.ts CRAFT); price takes a little off, more in the cheaper tiers.
 *
 * Hard rules first, so a model is never asked for what it cannot do:
 *   - the film's aspect ratio must be one it makes
 *   - a shot that continues the one before must land on its own still, so the model must take a last frame too
 *   - a shot with lines needs a model that makes sound
 *   - a model of a higher tier than the film's is never used
 *   - a model already blamed for this shot (qc.ts) is skipped on a retake, unless nothing else is left
 *
 * The answer is a ranked list: the first is used, and a retake that blames the model moves down it.
 */
import { renderRes, snapSeconds, tierRank, usdPerSecond, type CatalogModel, type Trait } from "./models.js";
import type { Aspect, ShotCard, Style, Tier } from "./types.js";

export interface Choice {
  model: CatalogModel;
  /** The duration it will render (the nearest it takes to the card's). */
  seconds: number;
  res: string;
  /** Whether it makes its own sound for this shot. */
  audio: boolean;
  usd: number;
  score: number;
}

const CLOSE = new Set(["medium-close", "close", "extreme-close"]);
const BIG_MOVES = new Set(["orbit", "crane", "drone", "tracking", "truck"]);

/** What a shot asks of a model, trait by trait (0 = nothing, about 1 = a lot). */
export function needs(card: ShotCard, style: Style): Record<Trait, number> {
  const people = card.cast.length > 0;
  return {
    realism: style === "live" ? 1 : 0.2,
    stylized: style === "animated" ? 1 : 0,
    faces: people ? (CLOSE.has(card.size) ? 1.2 : card.size === "medium" ? 0.8 : 0.4) : 0,
    motion: card.motion / 3,
    physics: card.physics ? 1 : 0.1,
    camera: card.move === "static" ? 0.1 : BIG_MOVES.has(card.move) ? 1 : 0.5,
    dialogue: card.lines.length ? 1.5 : 0,
    text: card.text ? 1 : 0,
    consistency: people ? 0.8 : 0.3,
  };
}

/** How much a dollar a second costs in score, by tier: a draft is mostly about the price, a premium film mostly about the picture. */
const PRICE_WEIGHT: Record<Tier, number> = { draft: 30, standard: 12, premium: 4 };

/**
 * Whether a take asks for the model's own sound. Lines need it (the lips move with them). Ambience only where the model can be told "no
 * music": Kling's sound is all or nothing and adds a score of its own, so its takes are silent unless someone speaks, and the cut adds the
 * film's music and voice-over.
 */
export const wantsAudio = (card: ShotCard, m: Pick<CatalogModel, "audio" | "dialect">): boolean =>
  m.audio && (card.lines.length > 0 || (card.sound.trim().length > 0 && m.dialect !== "kling" && m.dialect !== "runway"));

export interface RouteInput {
  card: ShotCard;
  style: Style;
  aspect: Aspect;
  tier: Tier;
  models: readonly CatalogModel[];
  blamed?: readonly string[];
}

/** Every model that can do the shot, best first. Empty when none can (the caller says why: see `whyNone`). */
export function route(i: RouteInput): Choice[] {
  const need = needs(i.card, i.style);
  const blamed = new Set(i.blamed ?? []);
  const able = i.models.filter((m) => can(m, i));
  const fresh = able.filter((m) => !blamed.has(m.id));
  const pool = fresh.length ? fresh : able;
  const picks: Choice[] = [];
  for (const m of pool) {
    const res = renderRes(m, i.tier);
    const audio = wantsAudio(i.card, m);
    const usd = usdPerSecond(m, { res, audio, aspect: i.aspect });
    if (usd === null) continue;
    let fit = 0;
    for (const t of Object.keys(need) as Trait[]) fit += need[t] * m.s[t];
    const seconds = snapSeconds(m, i.card.seconds);
    const off = Math.abs(seconds - i.card.seconds) * 0.6;
    const score = Math.round((fit - usd * PRICE_WEIGHT[i.tier] - off) * 100) / 100;
    picks.push({ model: m, seconds, res, audio, usd, score });
  }
  picks.sort((a, b) => b.score - a.score || a.usd - b.usd);
  const pinned = i.card.pin ? picks.findIndex((p) => p.model.id === i.card.pin) : -1;
  if (pinned > 0) picks.unshift(...picks.splice(pinned, 1));
  return picks;
}

function can(m: CatalogModel, i: RouteInput): boolean {
  if (tierRank(m.tier) > tierRank(i.tier) && m.id !== i.card.pin) return false;
  if (m.aspects.length && !m.aspects.includes(i.aspect)) return false;
  if (i.card.link === "continue" && !m.last) return false;
  if (i.card.lines.length && !m.audio) return false;
  return true;
}

/** Why a shot cannot be made, in a few words for a person: what to change, never which models there are. */
export function whyNone(i: RouteInput): string {
  if (!i.models.length) return "Video can't be made just now. Try again in a few minutes.";
  if (!i.models.some((m) => !m.aspects.length || m.aspects.includes(i.aspect))) return `${i.aspect} video can't be made just now; pick another frame.`;
  if (i.card.lines.length && !i.models.some((m) => m.audio && tierRank(m.tier) <= tierRank(i.tier))) return "Spoken lines can't be filmed at this quality; move them to the voice-over or raise the quality.";
  if (i.card.link === "continue" && !i.models.some((m) => m.last)) return "This shot can't carry straight on from the one before; make it a cut.";
  return "This shot can't be made at this quality; raise the quality.";
}
