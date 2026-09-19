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
/** Animated-WebP conversion: enough for a 260–360pt slot on a 3x screen. */
const MAX_WEBP_WIDTH = 720;
const WEBP_FPS = 15;
/** Output rate for a retimed GIF. A gif carries per-frame delays, not a clock,
 *  so speeding one up means re-sampling it onto a fixed rate. 20 is smooth for
 *  a short reveal and keeps the palette pass affordable. */
const GIF_FPS = 20;
const WEBP_MAX_SECONDS = Number(process.env.WEBP_MAX_SECONDS ?? 30);

/**
 * Keys that must stay VIDEO even when converting.
 *
 * The in-app mic freezes on a frame when it is not recording — that resting
 * frame is the button's whole idle state. Only a video can hold a frame:
 * expo-image cannot pause an animated format, so the app UNMOUNTS a paused
 * gif or webp, and converting the mic left an empty hole where the button
 * used to be. Learned the hard way, in production.
 */
function mustStayVideo(key: string): boolean {
  return /^mic\./i.test(key);
}

/** How long the clip runs, for a screen that has to wait for it. */
async function probeDurationMs(src: string): Promise<number | undefined> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", src,
    ], { timeout: 30_000 });
    const secs = Number(String(stdout).trim());
    return Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : undefined;
  } catch {
    return undefined;
  }
}

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
  videoTo: "h264" | "webp" = "h264",
): Promise<{ buf: Buffer; contentType: string } | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tulmi-compress-"));
  try {
    if (isVideo(contentType) && videoTo === "webp") {
      // Video → ANIMATED WEBP.
      //
      // A hero clip is short, silent, looping and drawn at ~260pt. That is
      // exactly what animated WebP is for, and it is played by expo-image —
      // the same path that carries every other image in the app, and the one
      // known to work on device. A Video node needs expo-video, a separate
      // native module reached through a hook, and when that does not render
      // the result is a silent blank: the failure that kept the intro black
      // for days and then repeated on the Flow screen.
      //
      // So this is not a downgrade for these slots, it is the shorter road to
      // the same picture. 15fps and a 12s cap keep it honest — past that a
      // WebP is heavier than the video it replaced, and a hero nobody watches
      // twice does not need 60fps.
      const out = path.join(dir, "out.webp");
      await run("ffmpeg", [
        "-y", "-t", String(WEBP_MAX_SECONDS), "-i", src,
        "-vf", `scale='min(${MAX_WEBP_WIDTH},iw)':-2,fps=${WEBP_FPS}`,
        "-loop", "0", "-lossless", "0", "-q:v", "58", "-preset", "picture",
        "-an", "-vsync", "0",
        out,
      ], { timeout: 10 * 60 * 1000, maxBuffer: 1 << 24 });
      return { buf: await fs.readFile(out), contentType: "image/webp" };
    }
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

/**
 * Re-time one file: same pictures, played faster or slower.
 *
 * Deliberately NOT a flag on /compress. Compression discards a result that is
 * not meaningfully smaller — correct for compression, wrong here, where the
 * point is the timing and the size is whatever it turns out to be. Two jobs,
 * two routes, two rules.
 *
 * The output keeps the input's KIND. A gif stays a gif and a clip stays a clip,
 * because the screens choose their node from the stored contentType and a
 * silent change of kind is how the intro went black once already.
 *
 * A retimed file is different bytes, so a different sha, so a different URL —
 * which is exactly how every device picks it up. Files are served immutable for
 * a year; nothing has to be invalidated because nothing is being replaced.
 *
 * `present.holdMs` scales with the clip. The hold IS the length of the scene
 * (a gif reports nothing when it ends), so leaving it alone after a 4x speed-up
 * would hold a still last frame for three quarters of the opening.
 */
export function registerMediaRetimeRoute(
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

  app.post("/v1/media/retime", async (req, reply) => {
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
    const key = q.key?.trim();
    const speed = q.speed === undefined || q.speed === "" ? 1 : Number(q.speed);
    // Whether the file repeats. For a GIF or an animated WebP this is not a
    // playback option — the repeat count lives INSIDE the file, and no player
    // setting and no `present` field can override it. Changing it means
    // re-encoding, which is what this route already does.
    const loopRaw = q.loop === undefined || q.loop === "" ? undefined : q.loop !== "false";
    // HOLD ON THE FIRST FRAME, in the file.
    //
    // This was once a client feature and it hid the clip completely: it paused
    // the player for the lead-in, and a paused expo-video that has never played
    // renders NOTHING — no poster, no first frame, just a hole where the film
    // should be. It was removed rather than patched, with a note saying the
    // lead-in belongs in the file. This is that.
    //
    // In the file it also costs nothing to ship and works on every build,
    // including ones already installed, because it is not a feature at all any
    // more — it is footage.
    const leadMs = q.lead === undefined || q.lead === "" ? 0 : Number(q.lead);
    if (!key) return reply.code(400).send({ code: "bad_request", message: "Missing 'key'." });
    if (!Number.isFinite(speed) || speed < 0.1 || speed > 20) {
      return reply.code(400).send({
        code: "bad_request",
        message: "'speed' must be between 0.1 and 20. 4 plays it four times as fast.",
      });
    }
    if (!Number.isFinite(leadMs) || leadMs < 0 || leadMs > 10_000) {
      return reply.code(400).send({
        code: "bad_request",
        message: "'lead' is milliseconds to hold the FIRST frame before playing, 0-10000.",
      });
    }
    if (speed === 1 && loopRaw === undefined && leadMs === 0) {
      return reply.code(400).send({
        code: "bad_request",
        message: "Nothing to change. Pass 'speed' (0.1-20), 'loop' (true|false), 'lead' (ms), or any combination.",
      });
    }
    const entry = registry()[key];
    if (!entry) return reply.code(404).send({ code: "not_found", message: `No media at '${key}'.` });

    const ct = entry.contentType ?? "";
    if (!isGif(ct) && !isVideo(ct) && !/^image\/webp$/i.test(ct)) {
      return reply.code(400).send({
        code: "bad_request",
        message: `'${key}' is ${ct || "unknown"} — only gif, animated webp and video have a timeline.`,
      });
    }

    const filename = entry.url.split("/").pop() ?? "";
    const src = path.join(mediaDir, filename);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tulmi-retime-"));
    // The retime, as a filter chain. ORDER IS THE POINT: speed first, hold
    // second. Padding before setpts would speed the pad up too, so a 2.5s hold
    // asked for at 4x would arrive as 0.6s — the one bug this ordering exists
    // to prevent.
    //
    // tpad with start_mode=clone repeats the FIRST decoded frame for the
    // duration, which is exactly "hold on the opening frame" and needs no
    // second input, no still image and no concat.
    const timeline = (extra = "") =>
      `setpts=PTS/${speed}` +
      (leadMs > 0 ? `,tpad=start_duration=${(leadMs / 1000).toFixed(3)}:start_mode=clone` : "") +
      extra;
    let out: { buf: Buffer; name: string; contentType: string; path: string };
    try {
      await fs.access(src);
      if (isVideo(ct)) {
        // setpts divides every timestamp, which is what "faster" means for a
        // container with a real timeline. Audio is already dropped on these.
        const dst = path.join(dir, "out.mp4");
        await run("ffmpeg", [
          "-y", "-i", src,
          "-filter:v", timeline(),
          "-c:v", "libx264", "-preset", "slow", "-crf", "28",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
          dst,
        ], { timeout: 10 * 60 * 1000, maxBuffer: 1 << 24 });
        out = { buf: await fs.readFile(dst), name: "mp4", contentType: "video/mp4", path: dst };
      } else {
        // GIF and animated WebP carry a per-frame delay rather than a clock, so
        // the retime is setpts plus a fixed output rate. The palette pass is not
        // optional for gif: ffmpeg's default 256-colour quantiser bands a dark
        // gradient badly, and this art is almost entirely dark gradient.
        const isWebp = /^image\/webp$/i.test(ct);
        const dst = path.join(dir, isWebp ? "out.webp" : "out.gif");
        // The repeat count, written into the file. The two formats spell "once"
        // differently and neither spells it the way you would guess: a GIF's
        // -loop is how many EXTRA passes to make, so -1 is play once and 0 is
        // forever; an animated WebP's is the total number of passes, so 1 is
        // play once and 0 is forever. Getting these backwards produces a file
        // that loops when it should stop, which looks like the screen is stuck.
        const wantLoop = loopRaw ?? true;
        const loopArg = isWebp
          ? (wantLoop ? "0" : "1")
          : (wantLoop ? "0" : "-1");
        const args = isWebp
          ? ["-y", "-i", src, "-filter:v", timeline(`,fps=${WEBP_FPS}`),
             "-loop", loopArg, "-lossless", "0", "-q:v", "58", "-preset", "picture", "-an", dst]
          : ["-y", "-i", src,
             "-filter_complex",
             `[0:v]${timeline(`,fps=${GIF_FPS}`)},split[a][b];` +
             `[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
             "-loop", loopArg, dst];
        await run("ffmpeg", args, { timeout: 10 * 60 * 1000, maxBuffer: 1 << 24 });
        out = isWebp
          ? { buf: await fs.readFile(dst), name: "webp", contentType: "image/webp", path: dst }
          : { buf: await fs.readFile(dst), name: "gif", contentType: "image/gif", path: dst };
      }
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      return reply.code(500).send({ code: "retime_failed", message: (err as Error).message.slice(0, 300) });
    }
    // MEASURE the result rather than predict it. Speed and lead are both known,
    // so the new length could be arithmetic — but the arithmetic starts from an
    // entry.durationMs that is usually absent, because only the compressor ever
    // wrote one. Probing costs one ffprobe and fills that gap for good, which
    // the screens want anyway: flowDismissMs reads durationMs before it falls
    // back to a default.
    const probedMs = await probeDurationMs(out.path);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

    const sha = crypto.createHash("sha256").update(out.buf).digest("hex");
    const newName = `${sha}.${out.name}`;
    const url = `${publicUrlPrefix}/${newName}`;
    const durationMs = probedMs
      ?? (entry.durationMs ? Math.round(entry.durationMs / speed) + leadMs : undefined);
    // The hold is the length of the SCENE, and it has two jobs that pull in
    // opposite directions: it must not sit for seconds on a frozen last frame,
    // and it must never cut the clip off mid-play. So it scales down with speed
    // — a hold left alone after a 4x speed-up is three quarters of the opening
    // spent frozen — and is then floored at the clip's real length plus a beat,
    // which is what stops a lead-in from being trimmed away by the scene that
    // was sized before it existed.
    //
    // `loop` is recorded as well as encoded, so the file and the metadata agree.
    // They drive different things and both are needed: a Video node takes its
    // repeat from present.loop, because a player owns an mp4's looping; a GIF
    // or WebP takes it from the bytes, because no player can override those.
    // One request sets whichever applies and leaves nothing to contradict it.
    const present = ((): typeof entry.present => {
      const p = entry.present;
      let next = p;
      if (p?.holdMs) {
        const scaled = Math.max(300, Math.round(p.holdMs / speed));
        const floor = durationMs ? durationMs + 400 : 0;
        next = { ...p, holdMs: Math.min(20_000, Math.max(scaled, floor)) };
      }
      if (loopRaw === undefined) return next;
      return { ...(next ?? {}), loop: loopRaw };
    })();

    // File first, registry second, delete last: a crash in between leaves an
    // orphan file (costs disk) rather than a dead URL (costs the screen).
    await fs.writeFile(path.join(mediaDir, newName), out.buf);
    const next = registry();
    next[key] = {
      ...entry,
      url,
      contentType: out.contentType,
      size: out.buf.length,
      uploadedAt: Date.now(),
      ...(durationMs ? { durationMs } : {}),
      ...(present ? { present } : {}),
    };
    await writeRegistry(next);
    if (filename && filename !== newName) {
      await fs.rm(path.join(mediaDir, filename), { force: true }).catch(() => {});
    }

    return reply.send({ ok: true, key, speed, loop: loopRaw, leadMs, entry: next[key] });
  });
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
    // video=webp turns clips into animated WebP instead of re-encoding them.
    // Opt-in, because it changes what KIND of thing the slot holds and every
    // screen decides its node from that.
    const videoTo: "h264" | "webp" = q.video === "webp" ? "webp" : "h264";

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
      let durationMs: number | undefined;
      try {
        await fs.access(src);
        if (isVideo(ct)) durationMs = await probeDurationMs(src);
        result = await encode(src, ct, mustStayVideo(key) ? "h264" : videoTo);
      } catch (err) {
        totalAfter += entry.size;
        plans.push({ key, from: { size: entry.size, contentType: ct }, saved: 0,
                     status: "failed", reason: (err as Error).message.slice(0, 160) });
        continue;
      }

      // Not meaningfully smaller → keep what we have. A new URL costs every
      // client a re-download; it has to buy something.
      const convertingKind = !!result && result.contentType !== ct;
      if (!result || (!convertingKind && result.buf.length >= entry.size * MIN_SAVING_RATIO)) {
        totalAfter += entry.size;
        plans.push({ key, from: { size: entry.size, contentType: ct }, saved: 0,
                     status: "kept", reason: "no meaningful saving" });
        continue;
      }

      const sha = crypto.createHash("sha256").update(result.buf).digest("hex");
      const ext = result.contentType === "video/mp4" ? "mp4" : "webp";
      // A conversion can legitimately grow the file — it is bought for
      // playability, not bytes — so `saved` may be negative and says so.
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
        // Kept so a screen can wait for the clip instead of guessing — see
        // the Flow screen, which used to cut its own demo off mid-play.
        ...(durationMs ? { durationMs } : {}),
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
