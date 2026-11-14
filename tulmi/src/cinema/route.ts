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
import { renderRes, snapSeconds, tierRank, usdPerSecond, type CatalogModel, type Job, type JobModel, type Trait } from "./models.js";
import type { Aspect, IssueKind, ShotCard, Style, Tier } from "./types.js";

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

// ---------------------------------------------------------------------------------------------------------------------------------------
// SEVERAL SHOTS AS ONE TAKE. A shot marked "continue" carries the same moment on from the one before it: today that is two generations
// joined at a frame, and the join is the weakest moment in the film. The long models take fifteen seconds and a last frame, so a run of
// such shots can be filmed ONCE - the whole move, unbroken - and cut apart afterwards at the beats (ffmpeg.ts slice). The film is the same
// length and costs the same per second; what it buys is that there is no join at all.
//
// A run is only ever tried on a clean slate: not one of its shots may have a take yet. Anything that then goes wrong with one of them is
// filmed again on its own, the ordinary way, so a bad run cannot repeat itself.

/** The most shots in one take, and the longest run we will ask for. */
export const RUN_MAX_SHOTS = 3;
export const RUN_MAX_SECONDS = 15;

export interface RunInput {
  cards: readonly ShotCard[];
  /** Where in `cards` the run would start. */
  at: number;
  style: Style;
  aspect: Aspect;
  tier: Tier;
  models: readonly CatalogModel[];
  /** Whether a shot has any take of its own for the card as it stands: a run is only tried before anything is filmed. */
  filmed: (n: number) => boolean;
}

export interface Run {
  cards: ShotCard[];
  /** Where each card begins inside the one take, in seconds. */
  starts: number[];
  seconds: number;
  pick: Choice;
}

/**
 * The run that starts at `at`, or null. Every shot after the first must say it continues the one before; they must share the place and the
 * people; nobody may speak (a mouth across a cut is a different problem); and one model of the film's tier must be able to render the whole
 * length in one go, from the first shot's still to the last shot's still.
 */
export function runFrom(i: RunInput): Run | null {
  const first = i.cards[i.at];
  if (!first || i.filmed(first.n)) return null;
  const run: ShotCard[] = [first];
  for (let k = i.at + 1; k < i.cards.length && run.length < RUN_MAX_SHOTS; k++) {
    const c = i.cards[k]!;
    if (c.link !== "continue" || i.filmed(c.n)) break;
    if (c.place !== first.place || c.cast.join(",") !== first.cast.join(",")) break;
    if (c.lines.length || first.lines.length) break;
    if (c.pin && c.pin !== first.pin) break;
    const total = run.reduce((n, x) => n + x.seconds, 0) + c.seconds;
    if (total > RUN_MAX_SECONDS) break;
    run.push(c);
  }
  if (run.length < 2) return null;
  const seconds = run.reduce((n, c) => n + c.seconds, 0);
  // One model for the whole run: it must reach the length, land on a last frame, and be the best of those that can.
  const whole: ShotCard = { ...first, seconds, motion: Math.max(...run.map((c) => c.motion)) as ShotCard["motion"], physics: run.some((c) => c.physics), crowd: run.some((c) => c.crowd) };
  const pick = route({ card: whole, style: i.style, aspect: i.aspect, tier: i.tier, models: i.models })
    .find((p) => p.model.last && p.model.durations.some((d) => d >= seconds) && Math.abs(p.seconds - seconds) < 1.5);
  if (!pick) return null;
  const starts: number[] = [];
  let t = 0;
  for (const c of run) { starts.push(Math.round(t * 100) / 100); t += c.seconds; }
  return { cards: run, starts, seconds, pick };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The one-job models (models.ts JOBS): mending a take, making a mouth say our own recording, enlarging the finished cut.

/** The model for a job, or null when we have none today. Every caller carries on without it, so a job is never the reason a film stops. */
export const pickJob = (jobs: readonly JobModel[], job: Job): JobModel | null => jobs.find((m) => m.job === job) ?? null;

/**
 * Whether a take's faults are the kind an edit mends: all of them local, nothing major outside that list. A melting face, a camera that
 * went the wrong way or an action that never happened are not mended - the shot is filmed again.
 */
export function editable(faults: readonly IssueKind[], m: Pick<JobModel, "fixes"> | null): boolean {
  if (!m?.fixes?.length || !faults.length) return false;
  return faults.every((k) => m.fixes!.includes(k));
}

/** What an edit costs: its seconds at its rate, never less than its floor. */
export const editUsd = (m: Pick<JobModel, "usd" | "minUsd">, seconds: number): number =>
  Math.round(Math.max(m.minUsd, m.usd * Math.max(1, seconds)) * 1e6) / 1e6;

/**
 * Whether a shot's lines are better said by a lip-sync model than by the video model itself: one person speaking, close enough that the
 * mouth is the shot, and the film's language is one a video model guesses at (every language but English, in practice, and Hinglish worst
 * of all, because the lines are written in Latin letters and read as Hindi).
 */
export function wantsLipSync(card: ShotCard, language: string): boolean {
  if (card.lines.length !== 1 || card.cast.length !== 1) return false;
  if (!CLOSE.has(card.size)) return false;
  if (card.move !== "static" && card.move !== "pan" && card.move !== "tilt") return false;
  if (card.motion >= 2 || card.crowd) return false;
  return !/^en\b/i.test(language.trim());
}
