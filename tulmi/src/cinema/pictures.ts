/**
 * THE BOT'S OWN PICTURES: a poster, a product shot, a portrait, a logo, an edit of a photo the person sends. The same logic as a film,
 * made small:
 *
 *   1. READ    a cheap model reads the ask (`readAsk`): what kind of picture it is, the words that must be spelled right in it, the frame,
 *              and a full description written for an image model (who, what, where, light, lens, style), in plain words, with none of the
 *              empty words that make a picture generic. Someone from the person's cast named in the ask brings their reference sheet.
 *   2. ROUTE   imageModels.ts routeImage picks the model by what the picture needs: words → the models that spell; a face that must stay
 *              someone's → the ones that keep a reference; a logo → a vector model.
 *   3. MAKE    two candidates at once when the picture has faces or words (where pictures most often go wrong), else one
 *   4. LOOK    a vision model checks each against the ask (`IMAGE_CHECK`): does it match, is it well made, are the words spelled exactly, is
 *              the person the person in the reference. The better passing one is kept. When none passes, one more try on the next model
 *              with the fix line; then the best is given, with a note saying what is off.
 *
 * Money: every picture made and every look is the person's (the service charges it); the cap per ask is PICTURE_CAP_USD.
 */
import { plain } from "./compile.js";
import { IMAGE_KINDS, routeImage, type CatalogImageModel, type ImageAsk, type ImageKind } from "./imageModels.js";
import type { Think } from "./plan.js";
import type { Character, Tier } from "./types.js";

/** The most one ask may cost, all tries and looks together. */
export const PICTURE_CAP_USD = 0.6;
const ASPECTS = ["1:1", "4:5", "3:4", "2:3", "9:16", "16:9", "3:2", "4:3", "21:9"] as const;

export interface ReadAsk {
  kind: ImageKind;
  text: string | null;
  aspect: string;
  /** The description an image model is given. */
  prompt: string;
  /** Cast members named in the ask, by key. */
  cast: string[];
}

const READ_SYSTEM = `You are an art director and photographer. You turn a person's request for a picture into a brief an image model will follow exactly. Image models only know what you write: be concrete, visual and specific, with precise nouns, materials, colours, directions and measures. Vague words (beautiful, cinematic, epic, stunning, masterpiece, 8k) make generic pictures; leave them out.

First decide what the picture is FOR (sell a product, announce a sale, flatter a face, explain a thing, set a mood) and make every choice serve that result. Then write the brief, covering in this order, each in a sentence or two:
1. Subject: who or what, in full: age, skin tone, face, eyes, hair, build, expression and pose for a person; shape, material, colour, finish, size and brand details they asked for for a product.
2. Action and moment: what is happening at this instant.
3. Setting: the place, its materials, props, time of day and weather.
4. Composition: the framing (close-up, medium, wide), the angle, where the subject sits (thirds, centre), the foreground and background, the negative space (and where text will go, for a poster).
5. Camera: the lens in mm, the aperture and depth of field, the focus point.
6. Lighting: the key light's direction and quality, the colour temperature, the fill, the rim or back light, the practicals, reflections.
7. Colour: three or four named colours, the grade, the contrast.
8. Texture and medium: photograph (film stock or digital), illustration (medium and style), 3D render, vector.
9. Mood: two or three words of feeling.
10. Text, for a poster or a label: the exact words, the typeface style (bold condensed sans, elegant serif, hand lettering), the size and placement, the colour and the hierarchy.
Rules: "edit" when they sent photos and want them changed: say exactly what to change and what must stay as it is (the face, the product, the background). Keep their language for any words in the picture. Never real people's likenesses unless it is an edit of the photo they sent, never brands they did not ask for, nothing sexual involving minors, no gore or hate.

Answer with JSON only:
{"kind":"photo|portrait|product|poster|illustration|logo|edit","text":"words that must appear in the picture exactly, or null","aspect":"1:1|4:5|3:4|2:3|9:16|16:9|3:2|4:3|21:9","prompt":"the brief: 120 to 220 words, the ten parts above as one flowing description","cast":["keys of the listed people the request names"]}`;

export async function readAsk(think: Think, words: string, o: { photos: number; cast: readonly Character[] }): Promise<ReadAsk> {
  const user = [
    `Request: <<<${words.slice(0, 3000)}>>>`,
    o.photos ? `They sent ${o.photos} photo(s) with it.` : "No photos came with it.",
    o.cast.length ? `People they have: ${o.cast.map((c) => `${c.key} (${c.name})`).join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const r = await think({ purpose: "cinema.picture.read", tier: "cheap", system: READ_SYSTEM, user, maxTokens: 1400, capPaise: 60 });
  return normalizeAsk(r.json ?? r.text, words, o);
}

export function normalizeAsk(raw: unknown, words: string, o: { photos: number; cast: readonly Character[] }): ReadAsk {
  let r: Record<string, unknown> = {};
  if (raw && typeof raw === "object") r = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    try {
      const m = /\{[\s\S]*\}/.exec(raw);
      if (m) r = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      r = {};
    }
  }
  const kindIn = typeof r.kind === "string" ? r.kind.toLowerCase() : "";
  let kind: ImageKind = (IMAGE_KINDS as readonly string[]).includes(kindIn) ? (kindIn as ImageKind) : o.photos ? "edit" : "photo";
  if (kind === "edit" && !o.photos) kind = "photo";
  const text = typeof r.text === "string" && r.text.trim() && r.text.trim().toLowerCase() !== "null" ? r.text.trim().slice(0, 60) : null;
  const aspect = typeof r.aspect === "string" && (ASPECTS as readonly string[]).includes(r.aspect) ? r.aspect : kind === "logo" ? "1:1" : kind === "poster" ? "2:3" : "1:1";
  const prompt = plain(typeof r.prompt === "string" && r.prompt.trim() ? r.prompt.trim().slice(0, 2400) : words.slice(0, 2400));
  const cast = (Array.isArray(r.cast) ? r.cast : []).filter((k): k is string => typeof k === "string" && o.cast.some((c) => c.key === k)).slice(0, 4);
  return { kind, text, aspect, prompt, cast };
}

/** What makes each kind of picture hold up, said to the model every time. */
const QUALITY: Partial<Record<ImageKind, string>> = {
  photo: "Photographic realism: natural skin texture, realistic eyes with catchlights, anatomically correct hands with five fingers, true-to-life materials, coherent perspective.",
  portrait: "Portrait quality: tack-sharp focus on the eyes, natural skin texture with pores, flattering but honest light, anatomically correct hands, the background softly out of focus.",
  product: "Product photography quality: the product exact in shape, colour, label and proportions, crisp edges, accurate reflections and shadows, clean, uncluttered background.",
  poster: "Poster quality: a clear visual hierarchy, a strong focal point, the text area kept clean and legible, balanced margins.",
  illustration: "Illustration quality: consistent style and line work, readable shapes, a coherent palette, no stray marks.",
  logo: "Logo quality: simple, bold, balanced shapes that read at small sizes, flat colours, no gradients unless asked, no mock-up, on a plain background.",
  edit: "Edit quality: change only what was asked; keep everything else in the photo exactly as it is, the same face, product, light and perspective.",
};

/** The words the image model reads: the brief, the quality lock for its kind, each reference's one role, the rule on text. */
export function picturePrompt(a: ReadAsk, refs: { role: string }[]): string {
  const parts = [a.prompt];
  const lock = QUALITY[a.kind];
  if (lock) parts.push(lock);
  refs.forEach((r, i) => parts.push(`Reference image ${i + 1}: ${r.role}.`));
  if (a.text) parts.push(`The words "${a.text}" appear exactly as written, spelled correctly, clearly readable; no other text.`);
  else if (a.kind !== "logo") parts.push("No text, captions, logos or watermarks.");
  return plain(parts.join(" "));
}

export interface ImageVerdict { scores: { match: number; quality: number; text: number; identity: number }; issues: string[]; fix: string | null; pass: boolean }

export const IMAGE_CHECK = `You check a generated picture against what was asked. The first image is the picture; any images after it are references it had to follow. Answer with JSON only:
{"scores":{"match":0-10,"quality":0-10,"text":0-10,"identity":0-10},"issues":["a few words each"],"major":true|false,"fix":"one short instruction for another try, or null"}
match: does it show what was asked. quality: anatomy, hands, faces, artifacts, melting, odd geometry. text: are the required words there, spelled exactly and readable (10 when no words were required and there are none; low when there is unwanted text). identity: does each person look like their reference (10 when there is no reference). major: true if a viewer would notice a problem at once.`;

const n10 = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : d);

export function parseImageVerdict(raw: unknown): ImageVerdict | null {
  let o: Record<string, unknown> | null = null;
  if (raw && typeof raw === "object") o = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    try {
      const m = /\{[\s\S]*\}/.exec(raw);
      o = m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
    } catch {
      o = null;
    }
  }
  if (!o) return null;
  const s = (o.scores && typeof o.scores === "object" ? o.scores : {}) as Record<string, unknown>;
  if (typeof s.match !== "number" || typeof s.quality !== "number") return null;
  const scores = { match: n10(s.match, 0), quality: n10(s.quality, 0), text: n10(s.text, 10), identity: n10(s.identity, 10) };
  const issues = (Array.isArray(o.issues) ? o.issues : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 120)).slice(0, 6);
  const fix = typeof o.fix === "string" && o.fix.trim() && o.fix.trim() !== "null" ? o.fix.trim().slice(0, 200) : null;
  const vals = Object.values(scores);
  const pass = o.major !== true && Math.min(...vals) >= 6 && vals.reduce((a, b) => a + b, 0) / vals.length >= 7;
  return { scores, issues, fix, pass };
}

const meanOf = (v: ImageVerdict): number => Object.values(v.scores).reduce((a, b) => a + b, 0) / 4;

/** How many candidates to make at once. */
export const candidates = (a: Pick<ReadAsk, "kind" | "text">): number => (a.text || a.kind === "portrait" || a.kind === "photo" || a.kind === "edit" ? 2 : 1);

export interface PictureDeps {
  think: Think;
  make: (o: { model: string; prompt: string; aspect: string; refs: string[]; format?: "png" | "jpeg" | "svg" }) => Promise<{ bytes: Buffer; type: string; usd: number }>;
  models: readonly CatalogImageModel[];
  /** Turns the reference picture's bytes into a data URL for the check. */
  dataUrl: (bytes: Buffer, type: string) => string;
}

export interface PictureAsk {
  words: string;
  tier: Tier;
  /** Reference images, as data URLs, each with its one role (the person's photos, cast sheets). */
  refs: { url: string; role: string }[];
  ask: ReadAsk;
  pin?: string | null;
}

export interface PictureOut { bytes: Buffer; type: string; model: string; usd: number; verdict: ImageVerdict | null; note: string | null; tries: number }

/** Makes the picture: routed, made (two at once where it pays), looked at, tried once more on another model if none passes. */
export async function makePicture(d: PictureDeps, p: PictureAsk): Promise<PictureOut> {
  const route: ImageAsk = { kind: p.ask.kind, text: p.ask.text, refs: p.refs.length, aspect: p.ask.aspect, tier: p.tier, pin: p.pin ?? null };
  const choices = routeImage(route, d.models);
  if (!choices.length) throw Object.assign(new Error("No picture model can make this right now."), { status: 503, code: "no_model" });
  let usd = 0;
  let best: { bytes: Buffer; type: string; model: string; verdict: ImageVerdict | null } | null = null;
  let fix: string | null = null;
  let tries = 0;
  for (const choice of choices.slice(0, 2)) {
    const m = choice.model;
    const refs = p.refs.slice(0, m.maxRefs);
    const prompt = picturePrompt({ ...p.ask, prompt: fix ? `${p.ask.prompt} ${fix}` : p.ask.prompt }, refs);
    const format = m.formats.includes("svg") && p.ask.kind === "logo" ? "svg" : undefined;
    const n = candidates(p.ask);
    const made = await Promise.allSettled(Array.from({ length: n }, () => d.make({ model: m.id, prompt, aspect: choice.aspect, refs: refs.map((r) => r.url), ...(format ? { format } : {}) })));
    const got = made.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
    tries += n;
    usd += got.reduce((a, g) => a + g.usd, 0);
    if (!got.length) continue;
    for (const g of got) {
      const seen = format === "svg" ? null : await look(d, g, p).catch(() => null);
      usd += seen?.usd ?? 0;
      const verdict = seen?.verdict ?? null;
      if (!best || (verdict && (!best.verdict || meanOf(verdict) > meanOf(best.verdict)))) best = { ...g, model: m.id, verdict };
    }
    if (!best || !best.verdict || best.verdict.pass || usd >= PICTURE_CAP_USD) break;
    fix = best.verdict.fix;
  }
  if (!best) throw Object.assign(new Error("The picture could not be made just now. Try again in a moment."), { status: 502, code: "picture_failed" });
  const note = best.verdict && !best.verdict.pass ? `Not quite right yet${best.verdict.issues[0] ? `: ${best.verdict.issues[0]}` : ""}. Say what to change and I'll make it again.` : null;
  return { bytes: best.bytes, type: best.type, model: best.model, usd, verdict: best.verdict, note, tries };
}

async function look(d: PictureDeps, g: { bytes: Buffer; type: string }, p: PictureAsk): Promise<{ verdict: ImageVerdict | null; usd: number }> {
  const asked = [`Asked for: ${p.words.slice(0, 800)}`, p.ask.text ? `Required words: "${p.ask.text}"` : "No words were required."].join("\n");
  const r = await d.think({
    purpose: "cinema.picture.check",
    tier: "vision",
    system: IMAGE_CHECK,
    user: [{ type: "text", text: asked }, { type: "image_url", image_url: { url: d.dataUrl(g.bytes, g.type) } }, ...p.refs.slice(0, 3).map((r) => ({ type: "image_url" as const, image_url: { url: r.url } }))],
    maxTokens: 500,
    capPaise: 10,
  });
  return { verdict: parseImageVerdict(r.json ?? r.text), usd: r.usd ?? 0 };
}
