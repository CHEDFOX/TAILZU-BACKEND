/**
 * PICTURES AND VIDEO FROM OPENROUTER: the one key the server already has reaches every model a film uses (docs/cinema.md "Models").
 *
 *   images   POST /api/v1/images          synchronous; the picture comes back as base64 (`data[].b64_json`), the cost in `usage.cost`
 *   videos   POST /api/v1/videos          a job: 202 { id, polling_url }; GET /api/v1/videos/:id until `completed` (or failed, cancelled,
 *                                         expired); the clip from `unsigned_urls[0]` (OpenRouter's own address, with the key), the cost in
 *                                         `usage.cost`. A generation that fails is not billed.
 *   lists    GET /api/v1/videos/models, GET /api/v1/images/models: what each model takes and costs (models.ts, imageModels.ts), read at
 *            most every LIST_TTL_MS and kept when a read fails, so a hiccup at OpenRouter never empties the catalog
 *
 * Everything goes through the server's own fetch, which asks the person's AI consent first for OpenRouter's host (privacy/aiGate.ts
 * installAiFetchGuard): the service runs a film's steps as its owner (asPerson). Reference images and first frames are sent as data URLs,
 * never as links to our storage, so nothing of a person's is left at an address. Nothing here logs a prompt, a picture or a URL.
 */
import { getConfig } from "../config.js";
import { imageCatalog, parseImageLive, type CatalogImageModel } from "./imageModels.js";
import { catalog, parseLive, type CatalogModel } from "./models.js";
import type { Aspect } from "./types.js";

const BASE = "https://openrouter.ai/api/v1";
export const LIST_TTL_MS = 6 * 3_600_000;
/** The largest clip we take: a 30-second 1080p clip is far under it. */
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export class MediaError extends Error {
  constructor(public readonly code: "bad_request" | "no_credit" | "busy" | "gone" | "upstream" | "failed" | "too_big", message: string, public readonly status = 502) {
    super(message);
    this.name = "MediaError";
  }
}

function headers(json = true): Record<string, string> {
  const c = getConfig();
  return {
    Authorization: `Bearer ${c.OPENROUTER_API_KEY}`,
    "HTTP-Referer": c.OPENROUTER_APP_URL,
    "X-Title": c.OPENROUTER_APP_NAME,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(init.body !== undefined), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(init.timeoutMs ?? 60_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw fromStatus(res.status, body);
  return body;
}

function fromStatus(status: number, body: unknown): MediaError {
  const msg = (body as { error?: { message?: unknown } } | null)?.error?.message;
  const said = typeof msg === "string" ? msg.slice(0, 300) : `OpenRouter answered ${status}`;
  if (status === 400 || status === 422) return new MediaError("bad_request", said, 400);
  if (status === 402) return new MediaError("no_credit", "The generation service is out of credit.", 503);
  if (status === 429) return new MediaError("busy", "The generation service is busy; trying again shortly.", 503);
  if (status === 404) return new MediaError("gone", said, 404);
  return new MediaError("upstream", said, 502);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The model lists.

interface Lists { video: CatalogModel[]; image: CatalogImageModel[]; at: number }
let lists: Lists | null = null;
let reading: Promise<Lists> | null = null;

/** The models we use today, read again when older than LIST_TTL_MS; the last good lists when a read fails. */
export async function liveModels(now = Date.now()): Promise<Lists> {
  if (lists && now - lists.at < LIST_TTL_MS) return lists;
  reading ??= (async () => {
    try {
      const [v, i] = await Promise.all([call("/videos/models", { timeoutMs: 20_000 }), call("/images/models", { timeoutMs: 20_000 })]);
      const next = { video: catalog(parseLive(v)), image: imageCatalog(parseImageLive(i)), at: now };
      if (next.video.length || !lists) lists = next;
      else lists = { ...lists, at: now };
    } catch {
      lists = lists ? { ...lists, at: now - LIST_TTL_MS + 300_000 } : { video: [], image: [], at: now - LIST_TTL_MS + 60_000 };
    } finally {
      reading = null;
    }
    return lists!;
  })();
  return reading;
}

/** Tests set the lists directly. */
export function setLiveModels(l: { video: CatalogModel[]; image: CatalogImageModel[] } | null, now = Date.now()): void {
  lists = l ? { ...l, at: now } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Images.

export interface ImageOut { bytes: Buffer; type: string; usd: number }

export const dataUrl = (bytes: Buffer, type: string): string => `data:${type};base64,${bytes.toString("base64")}`;

/** One picture. `refs` are data URLs, in the order the prompt names them. */
export async function makeImage(o: { model: string; prompt: string; aspect: string; refs?: string[]; resolution?: string; format?: "png" | "jpeg" | "svg" }): Promise<ImageOut> {
  const body = {
    model: o.model,
    prompt: o.prompt,
    n: 1,
    ...(o.aspect ? { aspect_ratio: o.aspect } : {}),
    ...(o.resolution ? { resolution: o.resolution } : {}),
    ...(o.format ? { output_format: o.format } : {}),
    ...(o.refs?.length ? { input_references: o.refs.map((url) => ({ type: "image_url", image_url: { url } })) } : {}),
  };
  const r = (await call("/images", { method: "POST", body: JSON.stringify(body), timeoutMs: 180_000 })) as {
    data?: { b64_json?: unknown; media_type?: unknown }[];
    usage?: { cost?: unknown };
  } | null;
  const first = r?.data?.[0];
  if (!first || typeof first.b64_json !== "string" || !first.b64_json) throw new MediaError("failed", "The picture did not come back.");
  return {
    bytes: Buffer.from(first.b64_json, "base64"),
    type: typeof first.media_type === "string" ? first.media_type : "image/png",
    usd: typeof r?.usage?.cost === "number" ? r.usage.cost : 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Video.

export interface VideoAsk {
  model: string;
  prompt: string;
  seconds: number;
  res: string;
  aspect: Aspect;
  /** The opening frame (a data URL). */
  first: string;
  /** The closing frame, for a shot that continues the one before and lands on its own still. */
  last?: string | null;
  audio: boolean;
  seed?: number;
}

/** Starts a take. Its job id is what `videoStatus` asks about. */
export async function startVideo(a: VideoAsk): Promise<string> {
  const frames = [{ type: "image_url", image_url: { url: a.first }, frame_type: "first_frame" }];
  if (a.last) frames.push({ type: "image_url", image_url: { url: a.last }, frame_type: "last_frame" });
  const body = {
    model: a.model,
    prompt: a.prompt,
    duration: a.seconds,
    resolution: a.res,
    aspect_ratio: a.aspect,
    frame_images: frames,
    generate_audio: a.audio,
    ...(typeof a.seed === "number" ? { seed: a.seed } : {}),
  };
  const r = (await call("/videos", { method: "POST", body: JSON.stringify(body), timeoutMs: 90_000 })) as { id?: unknown } | null;
  if (!r || typeof r.id !== "string" || !r.id) throw new MediaError("failed", "The take did not start.");
  return r.id;
}

export type VideoState =
  | { status: "running" }
  | { status: "done"; url: string; usd: number | null }
  | { status: "failed"; error: string };

/** How a take is going. An unknown job (404) is a failed take: the provider has forgotten it. */
export async function videoStatus(job: string): Promise<VideoState> {
  let r: { status?: unknown; unsigned_urls?: unknown; urls?: unknown; usage?: { cost?: unknown }; error?: unknown } | null;
  try {
    r = (await call(`/videos/${encodeURIComponent(job)}`, { timeoutMs: 30_000 })) as typeof r;
  } catch (err) {
    if (err instanceof MediaError && err.code === "gone") return { status: "failed", error: "The take was lost at the provider." };
    throw err;
  }
  const status = typeof r?.status === "string" ? r.status : "";
  if (status === "completed") {
    const list = [r?.unsigned_urls, r?.urls].find((u) => Array.isArray(u) && typeof u[0] === "string") as string[] | undefined;
    if (!list) return { status: "failed", error: "The take finished without a clip." };
    return { status: "done", url: list[0]!, usd: typeof r?.usage?.cost === "number" ? r.usage.cost : null };
  }
  if (status === "failed" || status === "cancelled" || status === "expired") {
    const e = typeof r?.error === "string" ? r.error : (r?.error as { message?: unknown } | undefined)?.message;
    return { status: "failed", error: typeof e === "string" && e ? e.slice(0, 200) : `The take ${status}.` };
  }
  return { status: "running" };
}

/** The finished clip's bytes. OpenRouter's own address takes the key; a signed storage address takes nothing. */
export async function fetchVideo(url: string): Promise<Buffer> {
  const own = url.startsWith(`${BASE}/`) || url.startsWith("/api/v1/");
  const full = url.startsWith("/") ? `https://openrouter.ai${url}` : url;
  const res = await fetch(full, { headers: own ? headers(false) : {}, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new MediaError("upstream", `The clip could not be fetched (${res.status}).`);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_VIDEO_BYTES) throw new MediaError("too_big", "The clip is too big to keep.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_VIDEO_BYTES) throw new MediaError("too_big", "The clip is too big to keep.");
  return bytes;
}

/** Music: one clip from Lyria (OpenRouter's chat API with sound out). Null when it gives none. */
export async function makeMusic(prompt: string, seconds: number): Promise<{ bytes: Buffer; usd: number } | null> {
  const model = seconds > 30 ? "google/lyria-3-pro-preview" : "google/lyria-3-clip-preview";
  const r = (await call("/chat/completions", {
    method: "POST",
    timeoutMs: 180_000,
    body: JSON.stringify({ model, modalities: ["text", "audio"], messages: [{ role: "user", content: `Instrumental film score, no vocals, about ${Math.round(seconds)} seconds: ${prompt}` }] }),
  })) as { choices?: { message?: { audio?: { data?: unknown } } }[]; usage?: { cost?: unknown } } | null;
  const data = r?.choices?.[0]?.message?.audio?.data;
  if (typeof data !== "string" || !data) return null;
  return { bytes: Buffer.from(data, "base64"), usd: typeof r?.usage?.cost === "number" ? r.usage.cost : 0.04 };
}
