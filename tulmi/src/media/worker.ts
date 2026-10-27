/**
 * THE MEDIA WORKER, FROM THE VPS'S SIDE: A SIGNED, BOUNDED HTTP CALL TO THE PYTHON SERVICE IN media-worker/.
 *
 * The worker does what Node should not: it reads office files (MarkItDown), PDFs that are scanned or complex (Docling), makes pictures
 * smaller and cuts a video into key frames and a sound track (ffmpeg and Pillow). It runs in a container that has no way out to the network.
 * Every call to it is SIGNED so that nothing else can use it:
 *
 *   X-Tailzu-Timestamp  seconds since the epoch; the worker refuses anything more than 60 seconds off
 *   X-Tailzu-Nonce      16 random bytes in hex; the worker refuses one it has seen in the last two minutes (no replay)
 *   X-Tailzu-Signature  HMAC-SHA256, in hex, with the shared secret, of these lines joined by \n:
 *                         v1 / timestamp / nonce / METHOD / path with its query string / SHA-256 of the body in hex
 *
 * so a captured request cannot be sent again, a body cannot be swapped, and a path or a query cannot be changed. The secret is
 * MEDIA_WORKER_SECRET (the same on both sides). Responses are JSON (or, for a picture, the bytes with the size in headers); a worker error is
 * `{ code, message }` with a message already written for a person, and becomes a MediaError with it. Each call has its own timeout.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getConfig } from "../config.js";
import { makeTable } from "./tabular.js";
import { MediaError, type DataTable, type MediaErrorCode } from "./types.js";

export interface Converted {
  markdown: string;
  pages?: number;
  tables: DataTable[];
  notes: string[];
}

export interface OptimisedImage {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
  format: "webp" | "png" | "jpeg";
}

export interface VideoRead {
  durationSeconds: number;
  width: number;
  height: number;
  frames: Array<{ t: number; data: Buffer }>;
  audio: { mime: string; data: Buffer } | null;
  notes: string[];
}

export interface ImageOptions {
  /** The longest side, in pixels: the picture is made to fit, never made bigger. */
  maxSide: number;
  /** `auto` keeps a PNG a PNG when it has transparency or is flat colour, and makes the rest WebP. */
  format: "webp" | "png" | "jpeg" | "auto";
  quality?: number;
}

export interface WorkerClient {
  /** docx, xlsx, pptx, odt, ods, odp, epub, html to Markdown (and the sheets' rows). */
  convert(data: Buffer, format: string): Promise<Converted>;
  /** A scanned or complex PDF, read by the layout reader. */
  pdf(data: Buffer): Promise<Converted>;
  /** The picture made to fit, in the format asked, with its metadata gone. */
  image(data: Buffer, o: ImageOptions): Promise<OptimisedImage>;
  /** Key frames (scene changes, at most 8) and the sound track. */
  video(data: Buffer): Promise<VideoRead>;
}

export const SIGNATURE_VERSION = "v1";
export const MAX_SKEW_SECONDS = 60;

/** The lines the signature is made over. */
export function signedLines(o: { timestamp: number; nonce: string; method: string; pathWithQuery: string; body: Uint8Array }): string {
  return [SIGNATURE_VERSION, String(o.timestamp), o.nonce, o.method.toUpperCase(), o.pathWithQuery, createHash("sha256").update(o.body).digest("hex")].join("\n");
}

export function workerSignature(secret: string, o: { timestamp: number; nonce: string; method: string; pathWithQuery: string; body: Uint8Array }): string {
  return createHmac("sha256", secret).update(signedLines(o), "utf8").digest("hex");
}

interface WorkerEnvelope {
  code?: string;
  message?: string;
}

const CODES: Record<string, MediaErrorCode> = {
  password: "password", bomb: "bomb", corrupt: "corrupt", too_big: "too_big", unsupported: "unsupported", too_long: "too_long", timeout: "failed", busy: "worker_down", failed: "failed",
};

export interface HttpWorkerOptions {
  baseUrl: string;
  secret: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  nonce?: () => string;
}

const TIMEOUT_MS = { convert: 150_000, pdf: 300_000, image: 60_000, video: 330_000 } as const;
const RESPONSE_MAX = 48 * 1024 * 1024;

const readTable = (t: { name?: unknown; columns?: unknown; rows?: unknown; total_rows?: unknown }): DataTable | null => {
  if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) return null;
  const rows = (t.rows as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((v) => (typeof v === "number" || typeof v === "string" ? v : v === null || v === undefined ? null : String(v))));
  return makeTable(String(t.name ?? "Sheet").slice(0, 80), (t.columns as unknown[]).map(String), rows, Number.isFinite(t.total_rows) ? Number(t.total_rows) : rows.length);
};

export class HttpWorker implements WorkerClient {
  private readonly base: string;

  constructor(private readonly o: HttpWorkerOptions) {
    this.base = o.baseUrl.replace(/\/+$/, "");
  }

  private async call(path: string, query: Record<string, string>, body: Buffer, timeoutMs: number): Promise<Response> {
    const qs = new URLSearchParams(query).toString();
    const pathWithQuery = qs ? `${path}?${qs}` : path;
    const timestamp = Math.floor((this.o.now ?? Date.now)() / 1000);
    const nonce = (this.o.nonce ?? (() => randomBytes(16).toString("hex")))();
    const signature = workerSignature(this.o.secret, { timestamp, nonce, method: "POST", pathWithQuery, body });
    let res: Response;
    try {
      res = await (this.o.fetchFn ?? fetch)(`${this.base}${pathWithQuery}`, {
        method: "POST", body: new Uint8Array(body), signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "content-type": "application/octet-stream", "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": signature,
        },
      });
    } catch {
      throw new MediaError("worker_down", "The file reader is not answering just now. Try again in a moment.", 503);
    }
    if (res.ok) return res;
    const env = (await res.json().catch(() => ({}))) as WorkerEnvelope;
    const code = CODES[String(env.code)] ?? "failed";
    const message = typeof env.message === "string" && env.message ? env.message.slice(0, 300) : "The file reader could not read that file.";
    throw new MediaError(code, message, res.status >= 500 ? 502 : res.status === 401 || res.status === 403 ? 502 : 422);
  }

  private async json<T>(res: Response): Promise<T> {
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > RESPONSE_MAX) throw new MediaError("failed", "The file reader's answer was too big to take.", 502);
    return (await res.json()) as T;
  }

  async convert(data: Buffer, format: string): Promise<Converted> {
    const r = await this.json<{ markdown?: string; pages?: number | null; tables?: unknown[]; notes?: unknown[] }>(await this.call("/v1/convert", { format }, data, TIMEOUT_MS.convert));
    return {
      markdown: String(r.markdown ?? ""), ...(typeof r.pages === "number" ? { pages: r.pages } : {}),
      tables: (r.tables ?? []).map((t) => readTable(t as never)).filter((t): t is DataTable => !!t).slice(0, 6),
      notes: (r.notes ?? []).map(String).slice(0, 10),
    };
  }

  async pdf(data: Buffer): Promise<Converted> {
    const r = await this.json<{ markdown?: string; pages?: number | null; notes?: unknown[] }>(await this.call("/v1/pdf", {}, data, TIMEOUT_MS.pdf));
    return { markdown: String(r.markdown ?? ""), ...(typeof r.pages === "number" ? { pages: r.pages } : {}), tables: [], notes: (r.notes ?? []).map(String).slice(0, 10) };
  }

  async image(data: Buffer, o: ImageOptions): Promise<OptimisedImage> {
    const res = await this.call("/v1/image", { max: String(Math.round(o.maxSide)), format: o.format, ...(o.quality ? { quality: String(o.quality) } : {}) }, data, TIMEOUT_MS.image);
    const format = res.headers.get("x-image-format");
    if (format !== "webp" && format !== "png" && format !== "jpeg") throw new MediaError("failed", "The file reader sent back a picture I do not know.", 502);
    return {
      data: Buffer.from(await res.arrayBuffer()), format, mime: `image/${format}`,
      width: Number(res.headers.get("x-image-width") ?? 0), height: Number(res.headers.get("x-image-height") ?? 0),
    };
  }

  async video(data: Buffer): Promise<VideoRead> {
    const r = await this.json<{
      duration?: number; width?: number; height?: number; frames?: Array<{ t?: number; jpeg?: string }>; audio?: { mime?: string; data?: string } | null; notes?: unknown[];
    }>(await this.call("/v1/video", {}, data, TIMEOUT_MS.video));
    return {
      durationSeconds: Number(r.duration) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0,
      frames: (r.frames ?? []).filter((f) => typeof f.jpeg === "string").slice(0, 8).map((f) => ({ t: Number(f.t) || 0, data: Buffer.from(f.jpeg!, "base64") })),
      audio: r.audio?.data ? { mime: r.audio.mime ?? "audio/mpeg", data: Buffer.from(r.audio.data, "base64") } : null,
      notes: (r.notes ?? []).map(String).slice(0, 10),
    };
  }
}

/** The worker as the environment names it, or null when there is none. */
export function workerFromConfig(fetchFn?: typeof fetch): WorkerClient | null {
  const c = getConfig();
  if (!c.MEDIA_WORKER_URL || !c.MEDIA_WORKER_SECRET) return null;
  if (!/^https?:\/\//i.test(c.MEDIA_WORKER_URL)) return null;
  return new HttpWorker({ baseUrl: c.MEDIA_WORKER_URL, secret: c.MEDIA_WORKER_SECRET, ...(fetchFn ? { fetchFn } : {}) });
}
