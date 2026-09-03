/**
 * Shrink what has already been uploaded.
 *
 * Every file the app draws is served from this box, so their weight is the
 * app's first impression on a slow connection. Art arrives at whatever size it
 * was exported at — a 765 KB PNG for a 128pt circle is normal — and nothing
 * upstream is going to fix that.
 *
 * WHY THIS CANNOT BE A SHELL LOOP OVER THE FILES
 *
 * Files are named by the sha256 of their contents. Compressing a file changes
 * its bytes, so its hash, so its filename, so its URL. Compressing in place
 * would leave every registry entry pointing at a name that no longer exists —
 * every screen blank, and no error anywhere to say why. The compress, the
 * rehash, the registry update and the delete are one operation or they are a
 * broken app.
 *
 * WHAT IT DOES
 *
 *   images → WebP, which is smaller than PNG at the same quality and is drawn
 *            natively by expo-image on both platforms.
 *   video  → H.264 at a sane CRF, scaled down only if genuinely huge, audio
 *            dropped (these are silent heroes), +faststart so the first frame
 *            arrives before the whole file does.
 *   the rest (svg, json, pdf, text) is left alone; they are already small and
 *            re-encoding them can only lose.
 *
 * Animated GIFs are skipped by default. They are usually the biggest files
 * here and animated WebP would save the most — but the GIF path is the one
 * this app has had the most trouble rendering, and a silent format change is
 * the last thing it needs. `?gif=true` opts in deliberately.
 *
 * SAFETY
 *
 *   - `?dry=true` reports what it would save and changes nothing. Default.
 *   - A result that is not meaningfully smaller is discarded and the original
 *     kept. Compression that makes a file bigger is a bug that ships silently.
 *   - The registry is written before the old file is deleted, so a crash in
 *     between leaves an orphan (harmless) rather than a dead link (not).
 *   - Idempotent: a second run finds everything already compressed and is a
 *     no-op, so it is safe to call after every batch of uploads.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { MediaRegistry } from "./media.js";

const run = promisify(execFile);

/** Below this, re-encoding is not worth a new URL and a cache miss. */
const MIN_SAVING_RATIO = 0.9;
/** Anything wider than this is bigger than any screen that will show it. */
const MAX_VIDEO_WIDTH = 1080;
const MAX_IMAGE_WIDTH = 1600;

export type CompressPlan = {
  key: string;
  from: { size: number; contentType: string };
  to?: { size: number; contentType: string; url: string };
  saved: number;
  status: "compressed" | "would-compress" | "kept" | "skipped" | "failed";
  reason?: string;
};

function isImage(ct: string): boolean {
  return /^image\/(png|jpeg|webp)$/i.test(ct);
}
function isGif(ct: string): boolean {
  return /^image\/gif$/i.test(ct);
}
function isVideo(ct: string): boolean {
  return /^video\//i.test(ct);
}

/** ffmpeg present? Without it this endpoint has nothing to offer. */
export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-encode one file, returning the smaller bytes or null to keep the
 * original. Runs in a temp dir so a failed encode leaves nothing behind.
 */
async function encode(
  src: string,
  contentType: string,
): Promise<{ buf: Buffer; contentType: string } | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tulmi-compress-"));
  try {
    if (isVideo(contentType)) {
      const out = path.join(dir, "out.mp4");
      await run("ffmpeg", [
        "-y", "-i", src,
        // Scale down only when oversized, and only by width — height follows,
        // rounded to an even number because H.264 requires it.
        "-vf", `scale='min(${MAX_VIDEO_WIDTH},iw)':-2`,
        "-c:v", "libx264", "-preset", "slow", "-crf", "28",
        // yuv420p is the pixel format every player accepts; without it some
        // devices show a green frame or nothing at all.
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        out,
      ], { timeout: 10 * 60 * 1000, maxBuffer: 1 << 24 });
      return { buf: await fs.readFile(out), contentType: "video/mp4" };
    }
    const out = path.join(dir, "out.webp");
    await run("ffmpeg", [
      "-y", "-i", src,
      "-vf", `scale='min(${MAX_IMAGE_WIDTH},iw)':-1`,
      "-quality", "82",
      out,
    ], { timeout: 2 * 60 * 1000, maxBuffer: 1 << 24 });
    return { buf: await fs.readFile(out), contentType: "image/webp" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerMediaCompressRoute(
  app: FastifyInstance,
  opts: {
    mediaDir: string;
    publicUrlPrefix: string;
    adminSecret: string;
    registry: () => MediaRegistry;
    writeRegistry: (r: MediaRegistry) => Promise<void>;
    checkAdmin: (req: unknown, expected: string) => { ok: boolean; reason?: string };
  },
): void {
  const { mediaDir, publicUrlPrefix, adminSecret, registry, writeRegistry, checkAdmin } = opts;

  app.post("/v1/media/compress", async (req, reply) => {
    const guard = checkAdmin(req, adminSecret);
    if (!guard.ok) {
      return reply.code(guard.reason === "not_configured" ? 503 : 401).send({ code: guard.reason });
    }
    if (!(await hasFfmpeg())) {
      return reply.code(503).send({
        code: "ffmpeg_missing",
        message: "ffmpeg is not installed in this image — rebuild the backend to get it.",
      });
    }

    const q = (req as { query?: Record<string, string> }).query ?? {};
    const dry = q.dry !== "false";          // dry by default: changing every URL is not a default
    const withGif = q.gif === "true";
    const only = q.key?.trim();

    const reg = registry();
    const plans: CompressPlan[] = [];
    let totalBefore = 0;
    let totalAfter = 0;

    for (const [key, entry] of Object.entries(reg)) {
      if (only && key !== only) continue;
      const ct = entry.contentType ?? "";
      const eligible = isImage(ct) || isVideo(ct) || (withGif && isGif(ct));
      if (!eligible) {
        plans.push({ key, from: { size: entry.size, contentType: ct }, saved: 0,
                     status: "skipped", reason: isGif(ct) ? "gif (pass gif=true)" : "format" });
        continue;
      }

      const filename = entry.url.split("/").pop() ?? "";
      const src = path.join(mediaDir, filename);
      totalBefore += entry.size;

      let result: { buf: Buffer; contentType: string } | null = null;
      try {
        await fs.access(src);
        result = await encode(src, ct);
      } catch (err) {
        totalAfter += entry.size;
        plans.push({ key, from: { size: entry.size, contentType: ct }, saved: 0,
                     status: "failed", reason: (err as Error).message.slice(0, 160) });
        continue;
      }

      // Not meaningfully smaller → keep what we have. A new URL costs every
      // client a re-download; it has to buy something.
      if (!result || result.buf.length >= entry.size * MIN_SAVING_RATIO) {
        totalAfter += entry.size;
        plans.push({ key, from: { size: entry.size, contentType: ct }, saved: 0,
                     status: "kept", reason: "no meaningful saving" });
        continue;
      }

      const sha = crypto.createHash("sha256").update(result.buf).digest("hex");
      const ext = result.contentType === "video/mp4" ? "mp4" : "webp";
      const newName = `${sha}.${ext}`;
      const url = `${publicUrlPrefix}/${newName}`;
      const saved = entry.size - result.buf.length;
      totalAfter += result.buf.length;

      plans.push({
        key,
        from: { size: entry.size, contentType: ct },
        to: { size: result.buf.length, contentType: result.contentType, url },
        saved,
        status: dry ? "would-compress" : "compressed",
      });

      if (dry) continue;

      // Write the new file, point the registry at it, and only then remove the
      // old one. A crash between the last two leaves an unreferenced file,
      // which costs disk; the other order leaves a dead URL, which costs the
      // screen.
      await fs.writeFile(path.join(mediaDir, newName), result.buf);
      const next = registry();
      next[key] = {
        ...entry,
        url,
        contentType: result.contentType,
        size: result.buf.length,
        uploadedAt: Date.now(),
      };
      await writeRegistry(next);
      if (filename && filename !== newName) {
        await fs.rm(path.join(mediaDir, filename), { force: true }).catch(() => {});
      }
    }

    return reply.send({
      ok: true,
      dry,
      totalBefore,
      totalAfter,
      saved: Math.max(0, totalBefore - totalAfter),
      savedPercent: totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0,
      items: plans,
    });
  });
}
