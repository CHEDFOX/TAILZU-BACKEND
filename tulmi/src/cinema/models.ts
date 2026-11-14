/**
 * THE MODELS A FILM CAN BE MADE WITH: what OpenRouter has today, and what we know each one is good at.
 *
 * Two halves, kept apart on purpose:
 *
 *   LIVE   what OpenRouter's video API says right now (GET /api/v1/videos/models): the durations, aspect ratios and resolutions each
 *          model takes, whether it takes a first and a last frame, whether it makes sound, and its price. Read at boot and every few hours
 *          (openrouter.ts), so a new duration or a price change is picked up without a deploy. Nothing here is typed by hand.
 *   CRAFT  what we know and OpenRouter does not say: which models are good at faces, at physics, at camera moves, at spoken lines, how
 *          each one wants its prompt written (compile.ts), and which tier it belongs to. A model is used only when it is in both halves:
 *          one that leaves OpenRouter is dropped by itself, and a new one waits until we have judged it.
 *
 * Scores are 0 to 5, our judgment from use, and the router (route.ts) weighs them against what a shot needs. The Chinese labs' models
 * (Kling, Seedance, Wan, HappyHorse, Hailuo) are first-class here: on motion, camera moves and keeping a face the same they are often the
 * best choice, and usually the cheapest. The image models are in imageModels.ts.
 *
 * A few models do not animate a still at all: they do one job on a clip we already have (`JOBS`) - edit it, make a mouth say our own
 * recording, enlarge it. They are kept out of the animators' catalog (which asks for a first frame and a list of durations) and picked by
 * their own job (route.ts pickJob).
 *
 * Prices. OpenRouter writes them several ways (`pricing_skus`): dollars a second (`duration_seconds_with_audio_720p`), cents a second
 * (`cents_per_video_output_second_720p`, `cents_per_second_output_1080p`), and for Seedance a price per video token (a token is a
 * 32 x 32 patch of one frame at 24 frames a second). `usdPerSecond` reads all three and picks the one that fits what we render. A price it
 * cannot read is null, and the router does not use that model.
 */
import type { Aspect, IssueKind, Tier } from "./types.js";

/** One model as OpenRouter's video API describes it. */
export interface VideoModel {
  id: string;
  name: string;
  durations: number[];
  aspects: string[];
  resolutions: string[];
  first: boolean;
  last: boolean;
  audio: boolean;
  seed: boolean;
  skus: Record<string, string>;
  passthrough: string[];
}

export type Trait = "realism" | "faces" | "motion" | "physics" | "camera" | "stylized" | "dialogue" | "text" | "consistency";
export const TRAITS: readonly Trait[] = ["realism", "faces", "motion", "physics", "camera", "stylized", "dialogue", "text", "consistency"];

/** How a model wants its prompt written (compile.ts). */
export type Dialect = "veo" | "kling" | "seedance" | "runway" | "wan" | "hailuo" | "generic";

export interface Craft {
  tier: Tier;
  dialect: Dialect;
  s: Record<Trait, number>;
  /** The longest prompt it reads well, in characters: Veo about 200 words; Kling tighter and motion-led; Seedance its full labelled timeline. */
  maxPrompt: number;
}

/** A model we will use: OpenRouter's facts and our judgment together. */
export type CatalogModel = VideoModel & Craft;

const s = (realism: number, faces: number, motion: number, physics: number, camera: number, stylized: number, dialogue: number, text: number, consistency: number): Record<Trait, number> =>
  ({ realism, faces, motion, physics, camera, stylized, dialogue, text, consistency });

/**
 * Our judgment, model by model. Order is not preference: the router decides per shot.
 *                                  realism faces motion physics camera stylized dialogue text consistency
 */
export const CRAFT: Readonly<Record<string, Craft>> = {
  "google/veo-3.1": { tier: "premium", dialect: "veo", s: s(5, 5, 4, 5, 4, 3, 5, 3, 4), maxPrompt: 1500 },
  "google/veo-3.1-fast": { tier: "standard", dialect: "veo", s: s(4, 4, 4, 4, 4, 3, 4, 3, 4), maxPrompt: 1500 },
  "google/veo-3.1-lite": { tier: "draft", dialect: "veo", s: s(3, 3, 3, 3, 3, 3, 3, 2, 3), maxPrompt: 1500 },
  // Native sound, a first and a last frame, three to fifteen seconds, and a quarter of Veo 3.1's price: the standard tier's workhorse.
  "google/gemini-omni-1.2-flash": { tier: "standard", dialect: "veo", s: s(4, 4, 4, 4, 4, 3, 5, 3, 4), maxPrompt: 1500 },
  "google/gemini-omni-1.1-flash": { tier: "draft", dialect: "veo", s: s(3, 3, 3, 3, 3, 3, 4, 3, 3), maxPrompt: 1500 },
  "kwaivgi/kling-v3.0-pro": { tier: "premium", dialect: "kling", s: s(4, 4, 5, 4, 5, 4, 3, 2, 4), maxPrompt: 1000 },
  "kwaivgi/kling-v3.0-std": { tier: "standard", dialect: "kling", s: s(4, 4, 4, 3, 4, 4, 3, 2, 4), maxPrompt: 1000 },
  "kwaivgi/kling-video-o1": { tier: "standard", dialect: "kling", s: s(4, 4, 4, 4, 4, 4, 3, 2, 5), maxPrompt: 1000 },
  "bytedance/seedance-2.5": { tier: "premium", dialect: "seedance", s: s(4, 4, 5, 4, 5, 4, 4, 3, 5), maxPrompt: 2000 },
  "bytedance/seedance-2.0": { tier: "standard", dialect: "seedance", s: s(4, 4, 4, 4, 4, 4, 3, 3, 5), maxPrompt: 2000 },
  "bytedance/seedance-2.0-fast": { tier: "draft", dialect: "seedance", s: s(3, 3, 4, 3, 4, 4, 3, 2, 4), maxPrompt: 2000 },
  "bytedance/seedance-2.0-mini": { tier: "draft", dialect: "seedance", s: s(3, 3, 3, 3, 3, 3, 2, 2, 4), maxPrompt: 2000 },
  "alibaba/wan-3.0-prime": { tier: "standard", dialect: "wan", s: s(4, 4, 4, 4, 4, 4, 3, 3, 4), maxPrompt: 1300 },
  "alibaba/wan-3.0": { tier: "standard", dialect: "wan", s: s(4, 4, 4, 4, 4, 4, 3, 3, 4), maxPrompt: 1300 },
  "alibaba/wan-2.7": { tier: "draft", dialect: "wan", s: s(3, 3, 3, 3, 3, 4, 2, 2, 3), maxPrompt: 1300 },
  "alibaba/wan-2.6": { tier: "draft", dialect: "wan", s: s(3, 3, 3, 3, 3, 4, 2, 2, 3), maxPrompt: 1300 },
  "minimax/hailuo-3": { tier: "standard", dialect: "hailuo", s: s(4, 3, 4, 5, 4, 4, 2, 4, 3), maxPrompt: 1300 },
  "minimax/hailuo-3-max": { tier: "draft", dialect: "hailuo", s: s(4, 3, 4, 4, 3, 3, 0, 3, 3), maxPrompt: 1300 },
  "minimax/hailuo-2.3": { tier: "draft", dialect: "hailuo", s: s(3, 3, 4, 4, 3, 3, 0, 3, 3), maxPrompt: 1300 },
  "runway/gen-4.5": { tier: "premium", dialect: "runway", s: s(4, 4, 5, 4, 5, 5, 0, 2, 4), maxPrompt: 1000 },
  // Five to twenty seconds, up to 4K, its own sound, and a first and a last frame: the long premium shot.
  "black-forest-labs/flux-3-video": { tier: "premium", dialect: "veo", s: s(5, 4, 4, 4, 4, 4, 4, 4, 4), maxPrompt: 1500 },
  "alibaba/happyhorse-1.1": { tier: "standard", dialect: "generic", s: s(4, 4, 4, 3, 4, 4, 0, 2, 4), maxPrompt: 1300 },
  "alibaba/happyhorse-1.0": { tier: "draft", dialect: "generic", s: s(3, 3, 3, 3, 3, 4, 0, 2, 3), maxPrompt: 1300 },
  // Up to thirty seconds from one frame, two cents a second at 480p: what a draft board moves on.
  "heygen/heygen-video-1": { tier: "draft", dialect: "generic", s: s(3, 3, 3, 2, 3, 3, 0, 2, 3), maxPrompt: 800 },
  "x-ai/grok-imagine-video-1.5": { tier: "standard", dialect: "generic", s: s(3, 3, 4, 3, 3, 5, 0, 2, 3), maxPrompt: 800 },
  "x-ai/grok-imagine-video-1.5-lite": { tier: "draft", dialect: "generic", s: s(3, 3, 3, 2, 3, 4, 0, 2, 3), maxPrompt: 800 },
  "x-ai/grok-imagine-video": { tier: "draft", dialect: "generic", s: s(2, 2, 3, 2, 3, 4, 0, 1, 2), maxPrompt: 800 },
  "tbc/mischief-1": { tier: "draft", dialect: "generic", s: s(2, 2, 3, 2, 2, 4, 0, 1, 2), maxPrompt: 600 },
};

/**
 * THE ONE-JOB MODELS. These take a clip we already have, not a still, so they never enter the animators' catalog:
 *
 *   edit     a clip and an instruction back: "take the sixth finger off his left hand". Cheap enough (three cents a second against forty
 *            for a second of Veo) that a take with one local fault is mended rather than filmed again (qc.ts EDITABLE).
 *   lipsync  a still and a recording of ours, and the mouth says our words: the part a video model gets wrong in Hindi and Hinglish.
 *   upscale  the finished cut enlarged, so a draft can be filmed small and finished large.
 *
 * `prefer` is the order to try them in, highest first; the price decides between equals. `fixes` is the only thing an edit is trusted with.
 */
export type Job = "edit" | "lipsync" | "upscale";

interface JobCraft { job: Job; prefer: number; maxPrompt: number; fixes?: readonly IssueKind[] }

/**
 * What an enlargement costs: its own price is a dollar a megapixel-second of what comes OUT, so the factor counts twice (twice as wide and
 * twice as tall is four times the pixels). A twenty-second 1080p film doubled is about six dollars, which is more than the film cost to
 * make, so the service asks this before it offers one and refuses where it will not fit (service.ts enlarge).
 */
export function upscaleUsd(m: Pick<JobModel, "usd">, o: { res: string; aspect: Aspect; seconds: number; factor: number }): number {
  const { w, h } = frameSize(o.res, o.aspect);
  const mpx = (w * h * o.factor * o.factor) / 1_000_000;
  return Math.round(m.usd * mpx * Math.max(1, o.seconds) * 1e6) / 1e6;
}

const JOBS: Readonly<Record<string, JobCraft>> = {
  "black-forest-labs/flux-video-edit": { job: "edit", prefer: 2, maxPrompt: 600, fixes: ["text", "artifact", "anatomy", "wardrobe"] },
  "runway/aleph-2": { job: "edit", prefer: 1, maxPrompt: 600, fixes: ["text", "artifact", "anatomy", "wardrobe"] },
  "heygen/avatar-iv": { job: "lipsync", prefer: 2, maxPrompt: 400 },
  "black-forest-labs/flux-video-upscale": { job: "upscale", prefer: 2, maxPrompt: 200 },
};

/** A one-job model: OpenRouter's facts, its price, and what we will give it. */
export type JobModel = VideoModel & JobCraft & {
  /** Dollars a second of output; for an upscale, a dollar a megapixel-second. */
  usd: number;
  /** The least one call costs, whatever its length (Runway charges two seconds minimum). */
  minUsd: number;
};

/** Every one-job model we have today, each job's best first: what the service carries beside the animators' catalog. */
export const allJobs = (live: readonly VideoModel[]): JobModel[] =>
  [...jobCatalog(live, "edit"), ...jobCatalog(live, "lipsync"), ...jobCatalog(live, "upscale")];

/** The one-job models we have today, best first. */
export function jobCatalog(live: readonly VideoModel[], job: Job): JobModel[] {
  const out: JobModel[] = [];
  for (const m of live) {
    const c = JOBS[m.id];
    if (!c || c.job !== job) continue;
    const usd = job === "upscale" ? usdPerMegapixelSecond(m) : usdPerSecond(m, { res: "1080p", audio: false, aspect: "16:9" });
    if (usd === null) continue;
    out.push({ ...m, ...c, usd, minUsd: minUsd(m) });
  }
  return out.sort((a, b) => b.prefer - a.prefer || a.usd - b.usd);
}

/** The resolution each tier renders at; clamped to what the model has (renderRes). */
const TIER_RES: Record<Tier, string> = { draft: "720p", standard: "720p", premium: "1080p" };
const RES_ORDER = ["360p", "480p", "540p", "720p", "768p", "1080p", "1K", "2K", "4K"];

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** OpenRouter's model list into ours. Anything malformed is skipped, never thrown. */
export function parseLive(body: unknown): VideoModel[] {
  const data = (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) ? (body as { data: unknown[] }).data : [];
  const out: VideoModel[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== "string" || !m.id) continue;
    const frames = asStrings(m.supported_frame_images);
    const skus: Record<string, string> = {};
    if (m.pricing_skus && typeof m.pricing_skus === "object") {
      for (const [k, v] of Object.entries(m.pricing_skus as Record<string, unknown>)) if (typeof v === "string" || typeof v === "number") skus[k] = String(v);
    }
    out.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      durations: Array.isArray(m.supported_durations) ? (m.supported_durations as unknown[]).filter((d): d is number => typeof d === "number" && d > 0).sort((a, b) => a - b) : [],
      aspects: asStrings(m.supported_aspect_ratios),
      resolutions: asStrings(m.supported_resolutions),
      first: frames.includes("first_frame"),
      last: frames.includes("last_frame"),
      audio: m.generate_audio === true,
      seed: m.seed === true,
      skus,
      passthrough: asStrings(m.allowed_passthrough_parameters),
    });
  }
  return out;
}

/** The models we will use: live, judged by us, animating from a first frame (every shot starts from its approved still), with a price. */
export function catalog(live: readonly VideoModel[]): CatalogModel[] {
  const out: CatalogModel[] = [];
  for (const m of live) {
    const c = CRAFT[m.id];
    if (!c || !m.first || !m.durations.length) continue;
    if (usdPerSecond(m, { res: renderRes(m, c.tier), audio: false, aspect: "16:9" }) === null) continue;
    out.push({ ...m, ...c, s: { ...c.s } });
  }
  return out;
}

/** The resolution a model renders at for a tier: the tier's own if the model has it, else the nearest below, else the nearest above. */
export function renderRes(m: Pick<VideoModel, "resolutions">, tier: Tier): string {
  const want = TIER_RES[tier];
  if (!m.resolutions.length || m.resolutions.includes(want)) return want;
  const rank = (r: string) => RES_ORDER.indexOf(r);
  const w = rank(want);
  const known = m.resolutions.filter((r) => rank(r) >= 0).sort((a, b) => rank(a) - rank(b));
  const below = known.filter((r) => rank(r) <= w);
  return below.length ? below[below.length - 1]! : (known[0] ?? m.resolutions[0]!);
}

/** Pixels of a frame at a resolution and aspect: what Seedance's tokens are counted from. */
export function frameSize(res: string, aspect: Aspect): { w: number; h: number } {
  const short = res === "4K" ? 2160 : res === "2K" ? 1440 : res === "1K" ? 1024 : Number.parseInt(res, 10) || 720;
  const long = Math.round((short * 16) / 9 / 2) * 2;
  if (aspect === "1:1") return { w: short, h: short };
  return aspect === "9:16" ? { w: short, h: long } : { w: long, h: short };
}

const RES_TAG = /(?:^|_)(360p|480p|540p|720p|768p|1080p|1k|2k|4k)$/i;
const NOT_PLAIN = /long_|reference|continuation|with_video_input|image_input|reference_images|minimum|upscale|megapixel/;

interface SkuRead { usdPerUnit: number; unit: "second" | "token"; res: string | null; audio: boolean | null; mode: "i2v" | "t2v" | null }

function readSku(key: string, value: string): SkuRead | null {
  const k = key.toLowerCase();
  if (NOT_PLAIN.test(k)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const resM = RES_TAG.exec(k);
  const res = resM ? resM[1]!.toLowerCase().replace(/k$/, "K") : null;
  const audio = k.includes("without_audio") ? false : k.includes("with_audio") ? true : null;
  const mode = k.startsWith("image_to_video") ? "i2v" : k.startsWith("text_to_video") ? "t2v" : null;
  if (k.startsWith("video_tokens")) return { usdPerUnit: n, unit: "token", res, audio, mode };
  if (k.startsWith("cents_per_video_output_second") || k.startsWith("cents_per_second_output")) return { usdPerUnit: n / 100, unit: "second", res, audio, mode };
  if (/^(image_to_video_|text_to_video_)?duration_seconds/.test(k)) return { usdPerUnit: n, unit: "second", res, audio, mode };
  return null;
}

/**
 * Dollars for one second of video, rendered at `res`, with or without its own sound, from a first frame. The most specific price that fits
 * wins: the resolution named over none, the sound named over none, image-to-video over a price with no mode. Null when none can be read.
 */
export function usdPerSecond(m: Pick<VideoModel, "skus">, o: { res: string; audio: boolean; aspect: Aspect }): number | null {
  const res = o.res.replace(/k$/, "K");
  const read = (anyAudio: boolean): number | null => {
    let best: { usd: number; score: number } | null = null;
    for (const [key, value] of Object.entries(m.skus)) {
      const r = readSku(key, value);
      if (!r) continue;
      if (r.res !== null && r.res !== res) continue;
      if (!anyAudio && r.audio !== null && r.audio !== o.audio) continue;
      if (r.mode === "t2v") continue;
      let usd = r.usdPerUnit;
      if (r.unit === "token") {
        const { w, h } = frameSize(res === "1080p" || res === "720p" || res === "480p" ? res : "720p", o.aspect);
        usd = (r.usdPerUnit * w * h * 24) / 1024;
      }
      const score = (r.res ? 4 : 0) + (r.audio !== null ? 2 : 0) + (r.mode ? 1 : 0);
      if (!best || score > best.score) best = { usd, score };
    }
    return best ? Math.round(best.usd * 1e6) / 1e6 : null;
  };
  // A model that always makes its own sound has only a with-sound price (Gemini Omni): that price is the price, silent or not.
  return read(false) ?? read(true);
}

/** Dollars a megapixel-second for an upscale (`cents_per_megapixel_second_precise`), or null when it has no such price. */
export function usdPerMegapixelSecond(m: Pick<VideoModel, "skus">): number | null {
  for (const key of ["cents_per_megapixel_second_precise", "cents_per_megapixel_second_creative"]) {
    const n = Number(m.skus[key]);
    if (Number.isFinite(n) && n >= 0) return Math.round((n / 100) * 1e6) / 1e6;
  }
  return null;
}

/** The least one call costs, whatever its length (`minimum_cents_per_generation`); 0 when there is no floor. */
export function minUsd(m: Pick<VideoModel, "skus">): number {
  const n = Number(m.skus.minimum_cents_per_generation);
  return Number.isFinite(n) && n > 0 ? Math.round((n / 100) * 1e6) / 1e6 : 0;
}

/** The duration a model renders nearest to what a shot wants: the closest it takes, the longer of two equally close. */
export function snapSeconds(m: Pick<VideoModel, "durations">, want: number): number {
  if (!m.durations.length) return want;
  let best = m.durations[0]!;
  for (const d of m.durations) if (Math.abs(d - want) < Math.abs(best - want) || (Math.abs(d - want) === Math.abs(best - want) && d > best)) best = d;
  return best;
}

export const tierRank = (t: Tier): number => (t === "draft" ? 0 : t === "standard" ? 1 : 2);
