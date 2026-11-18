/**
 * THE IMAGE MODELS: for the bot's own pictures (a poster, a product shot, a portrait, a logo, an edit of a photo the person sends) and for a
 * film's reference sheets and stills. The same two halves as the video models (models.ts):
 *
 *   LIVE   OpenRouter's image API (GET /api/v1/images/models): the aspect ratios and resolutions each model takes, how many reference images,
 *          and the output formats (SVG for the vector ones).
 *   CRAFT  our judgment: what each is good at, its tier, and roughly what one image costs before it is made (the real cost comes back with
 *          it, in `usage.cost`).
 *
 * `routeImage` picks per picture, the way route.ts picks per shot: readable words in the picture want the models that spell (GPT Image,
 * Qwen Image, Nano Banana); a face that must stay someone's wants the ones that keep a reference (Nano Banana, Seedream); a logo or an icon
 * wants a vector model; a product on a table wants the ones that keep the product exactly as photographed.
 */
import { tierRank } from "./models.js";
import type { Tier } from "./types.js";

export interface ImageModel {
  id: string;
  name: string;
  aspects: string[];
  resolutions: string[];
  maxRefs: number;
  formats: string[];
}

export type ImageTrait = "realism" | "faces" | "text" | "edit" | "stylized" | "vector" | "product" | "consistency";

export interface ImageCraft {
  tier: Tier;
  /** Dollars one image costs, roughly, at the resolution we ask for. */
  usd: number;
  s: Record<ImageTrait, number>;
}

export type CatalogImageModel = ImageModel & ImageCraft;

const s = (realism: number, faces: number, text: number, edit: number, stylized: number, vector: number, product: number, consistency: number): Record<ImageTrait, number> =>
  ({ realism, faces, text, edit, stylized, vector, product, consistency });

/**                                                   realism faces text edit stylized vector product consistency */
export const IMAGE_CRAFT: Readonly<Record<string, ImageCraft>> = {
  "google/gemini-nano-banana-2.1": { tier: "standard", usd: 0.04, s: s(4, 4, 4, 5, 4, 1, 5, 5) },
  "google/gemini-3-pro-image": { tier: "premium", usd: 0.14, s: s(5, 5, 5, 5, 4, 1, 5, 5) },
  "google/gemini-3.1-flash-lite-image": { tier: "draft", usd: 0.02, s: s(3, 3, 3, 4, 3, 1, 3, 4) },
  "bytedance-seed/seedream-5-5": { tier: "standard", usd: 0.04, s: s(5, 5, 4, 4, 4, 1, 4, 4) },
  "bytedance-seed/seedream-5-0-flash": { tier: "draft", usd: 0.02, s: s(4, 4, 3, 3, 4, 1, 3, 3) },
  "qwen/qwen-image-3-pro": { tier: "standard", usd: 0.05, s: s(4, 4, 5, 4, 4, 1, 4, 3) },
  "qwen/qwen-image-2.1-turbo": { tier: "draft", usd: 0.015, s: s(3, 3, 4, 3, 3, 1, 3, 3) },
  "tencent/hy-image-v3.5-preview": { tier: "standard", usd: 0.04, s: s(4, 4, 4, 3, 5, 1, 3, 3) },
  "openai/gpt-image-2": { tier: "premium", usd: 0.08, s: s(4, 4, 5, 4, 4, 1, 4, 4) },
  "black-forest-labs/flux-3-image": { tier: "standard", usd: 0.05, s: s(5, 4, 4, 3, 4, 1, 4, 3) },
  "recraft/recraft-v4.1-pro-vector": { tier: "standard", usd: 0.08, s: s(1, 1, 4, 1, 4, 5, 2, 2) },
  "recraft/recraft-v4.1-vector": { tier: "draft", usd: 0.04, s: s(1, 1, 3, 1, 4, 5, 2, 2) },
};

/** The models a film's reference sheets and stills are made with, in order: they keep a face from its reference best. */
export const STILL_ORDER: readonly string[] = ["google/gemini-nano-banana-2.1", "bytedance-seed/seedream-5-5", "google/gemini-3-pro-image", "openai/gpt-image-2"];

const values = (p: unknown): string[] => {
  if (!p || typeof p !== "object") return [];
  const v = (p as { values?: unknown }).values;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

/** OpenRouter's image model list into ours. */
export function parseImageLive(body: unknown): ImageModel[] {
  const data = (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) ? (body as { data: unknown[] }).data : [];
  const out: ImageModel[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== "string" || !m.id) continue;
    const sp = (m.supported_parameters && typeof m.supported_parameters === "object" ? m.supported_parameters : {}) as Record<string, unknown>;
    const refs = sp.input_references as { max?: unknown } | undefined;
    out.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      aspects: values(sp.aspect_ratio),
      resolutions: values(sp.resolution),
      maxRefs: typeof refs?.max === "number" ? refs.max : 0,
      formats: values(sp.output_format),
    });
  }
  return out;
}

export function imageCatalog(live: readonly ImageModel[]): CatalogImageModel[] {
  return live.flatMap((m) => (IMAGE_CRAFT[m.id] ? [{ ...m, ...IMAGE_CRAFT[m.id]!, s: { ...IMAGE_CRAFT[m.id]!.s } }] : []));
}

/** What a picture is, as the bot read the ask (pictures.ts). */
export type ImageKind = "photo" | "portrait" | "product" | "poster" | "illustration" | "logo" | "edit";
export const IMAGE_KINDS: readonly ImageKind[] = ["photo", "portrait", "product", "poster", "illustration", "logo", "edit"];

export interface ImageAsk {
  kind: ImageKind;
  /** Words that must be spelled right in the picture, or null. */
  text: string | null;
  /** Reference images that come with it (the person's photos, a character's sheet). */
  refs: number;
  aspect: string;
  tier: Tier;
  /** A model the person asked for by name. */
  pin?: string | null;
}

export function imageNeeds(a: ImageAsk): Record<ImageTrait, number> {
  const k = a.kind;
  return {
    realism: k === "photo" || k === "portrait" || k === "product" ? 1 : 0.2,
    faces: k === "portrait" ? 1.2 : k === "photo" ? 0.6 : 0.1,
    text: a.text ? 1.5 : k === "poster" ? 0.6 : 0,
    edit: k === "edit" ? 1.5 : a.refs ? 0.8 : 0,
    stylized: k === "illustration" || k === "poster" ? 1 : 0.1,
    vector: k === "logo" ? 2 : 0,
    product: k === "product" ? 1.2 : 0,
    consistency: a.refs ? 1 : 0,
  };
}

const PRICE_WEIGHT: Record<Tier, number> = { draft: 60, standard: 20, premium: 6 };

export interface ImageChoice { model: CatalogImageModel; score: number; usd: number; aspect: string }

/** Every image model that can make the picture, best first. */
export function routeImage(a: ImageAsk, models: readonly CatalogImageModel[]): ImageChoice[] {
  const need = imageNeeds(a);
  const out: ImageChoice[] = [];
  for (const m of models) {
    if (tierRank(m.tier) > tierRank(a.tier) && m.id !== a.pin) continue;
    if (a.refs > 0 && m.maxRefs < Math.min(a.refs, 1)) continue;
    if (a.kind === "edit" && m.maxRefs < 1) continue;
    if (a.kind === "logo" && m.s.vector < 4) continue;
    if (a.kind !== "logo" && m.s.vector >= 4 && m.s.realism < 2) continue;
    const aspect = m.aspects.length === 0 || m.aspects.includes(a.aspect) ? a.aspect : m.aspects.includes("auto") ? "auto" : "";
    if (!aspect) continue;
    let fit = 0;
    for (const t of Object.keys(need) as ImageTrait[]) fit += need[t] * m.s[t];
    out.push({ model: m, usd: m.usd, aspect, score: Math.round((fit - m.usd * PRICE_WEIGHT[a.tier]) * 100) / 100 });
  }
  out.sort((x, y) => y.score - x.score || x.usd - y.usd);
  const pinned = a.pin ? out.findIndex((c) => c.model.id === a.pin) : -1;
  if (pinned > 0) out.unshift(...out.splice(pinned, 1));
  return out;
}

/** The model a film's sheets and stills use: the first of STILL_ORDER that is live and takes enough references. */
export function stillModel(models: readonly CatalogImageModel[], refs: number): CatalogImageModel | null {
  for (const id of STILL_ORDER) {
    const m = models.find((x) => x.id === id);
    if (m && m.maxRefs >= Math.min(refs, 1)) return m;
  }
  return models.find((m) => m.maxRefs >= Math.min(refs, 1) && m.s.vector < 4) ?? null;
}
