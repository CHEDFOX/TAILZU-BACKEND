/**
 * THE TWO DOORS THE LOOP GOES OUT BY: somewhere to run Blender, and somewhere to keep what comes back.
 *
 * The loop (make.ts) knows nothing about where a render happens. It hands a script to a `Render` and gets pictures back, so
 * the same loop runs against the person's own computer, a container on the VPS, a rented card, or a fake in a test. That is
 * the whole reason the scene is a script: the thing being passed around is small and goes anywhere.
 *
 *   Render   a script in, pictures (or a clip) out, with a log and what it took
 *   keep     the pictures and the script into the bucket we already have (media/blob.ts), under this person's own keys
 *
 * Keys are `c/<user>/<creation>/v<n>/<name>`: one person's key can never name another's, a version never writes over the one
 * before it, and a creation survives the job that made it.
 *
 * WHAT IS KEPT AND WHAT IS NOT. The script is the asset — kilobytes, kept always, and enough to make everything else again.
 * The preview is kept because it is what a person sees in a list. The full render and the .blend are only kept when someone
 * asks for them (`keepHeavy`), because they are the things that fill a bucket.
 */
import { createHash } from "node:crypto";
import type { BlobStore } from "../../media/blob.js";

/** One picture out of a render: a still, or the frame a move was previewed at. */
export interface Shot {
  frame: number;
  bytes: Buffer;
  /** image/png, or video/mp4 for a clip. */
  mime: string;
}

export interface RenderJob {
  /** The whole script, as script.ts wrote it. */
  script: string;
  /** Still: one picture. Move: the frames the script already holds, encoded as one clip. */
  move: boolean;
  /** Give up after this long. A preview gets a short one; the real thing gets a long one. */
  timeoutMs: number;
  /** Name → where that asset is, for the machine that runs it. A scene only ever names things. */
  assets?: Record<string, string>;
  /** Keep the .blend the script saves, and hand it back. */
  wantBlend?: boolean;
}

export type RenderOut =
  | { ok: true; shots: Shot[]; blend?: Buffer; ms: number; log: string }
  | { ok: false; error: string; ms: number; log: string };

/** Anywhere Blender can be run. The loop never knows which. */
export type Render = (job: RenderJob) => Promise<RenderOut>;

/** Something kept, as the creation's record holds it. */
export interface Kept {
  key: string;
  mime: string;
  bytes: number;
  /** Of the bytes, so the same picture twice is one object and a changed one is obvious. */
  sha256: string;
}

/** `c/<user>/<creation>/v<n>/<name>` — user-scoped, version-scoped, and never a path a model chose. */
export function creationKey(userId: string, creation: string, version: number, file: string): string {
  const safe = (s: string): string => s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "x";
  return `c/${safe(userId)}/${safe(creation)}/v${Math.max(1, Math.round(version))}/${safe(file)}`;
}

/** One thing into the bucket. No bucket (it is not set up): nothing is kept and the loop carries on. */
export async function keep(store: BlobStore | null, key: string, bytes: Buffer, mime: string): Promise<Kept | null> {
  if (!store) return null;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await store.put(key, bytes, mime);
  return { key, mime, bytes: bytes.length, sha256 };
}
