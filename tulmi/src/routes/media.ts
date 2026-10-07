/**
 * Media store — admin-uploaded assets served over HTTPS.
 *
 * Flow:
 *   1. Admin POSTs a file to /v1/media/upload (x-admin-secret header).
 *   2. Server stores it as MEDIA_DIR/<sha256>.<ext> and adds an entry to
 *      MEDIA_DIR/registry.json under an optional named key.
 *   3. Clients reference media by either raw URL (public /media/<name>) or by
 *      key (via bootstrap.media[key] → full URL).
 *
 * Registry shape: { [key: string]: { url: string; contentType: string; size: number; uploadedAt: number } }
 *
 * Public reads: /media/* is served by @fastify/static (no auth), and
 * /media/k/<key> redirects to a key's current file (for emails). Named
 * registry entries flow through the bootstrap response so clients don't need
 * to poll a separate endpoint.
 *
 * Design notes:
 *   - Deduplicated by SHA256 of contents. Re-uploading the same file yields
 *     the same URL; a rename just moves the registry entry.
 *   - No auth on the file bytes themselves — media is public by definition
 *     (icons, splash graphics, brand marks). Don't upload secrets here.
 *   - The registry file is the source of truth; treat MEDIA_DIR as append-only.
 *     Removing an entry from the registry hides it from bootstrap but leaves
 *     the file on disk (compacting is a separate op).
 */
import { FastifyInstance } from "fastify";
import { registerMediaCompressRoute, registerMediaRetimeRoute } from "./mediaCompress.js";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MediaPresent } from "../../../shared/types/sdui.js";
import { bumpCacheVersion } from "../experience/catalog.js";
import { requireAdmin } from "../control/index.js";

const runFile = promisify(execFile);

/**
 * Sanitise a presentation payload.
 *
 * Everything here ends up inside a style object a client renders, so this is a
 * whitelist, not a merge: unknown fields are dropped, enums must match, numbers
 * are clamped to a sane range, and the background has to look like a colour.
 * An admin secret is not a licence to post arbitrary style into every install.
 */
export function cleanPresent(raw: unknown): MediaPresent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: MediaPresent = {};
  /**
   * A number, or nothing — and NOTHING IS NOT ZERO.
   *
   * This used to be `Number(v)` and a finite check, which quietly accepted
   * every value JavaScript is willing to turn into 0: null, "", false, []. So
   * a caller trying to clear a field by sending null did not clear it. The
   * value became 0, 0 was clamped up to the field's floor, and the field came
   * back set to its minimum — the opposite of what was asked, with a 200 and
   * a body that looked like it had worked.
   *
   * Found by sending {"boxHeight": null} and getting boxHeight 40, which put
   * a 9:16 film in a forty-point-tall box.
   *
   * Only a real number, or a string that is entirely one, counts. Anything
   * else is "not provided" and leaves the stored value alone — clearing is
   * what ?reset=true is for.
   */
  const num = (v: unknown, lo: number, hi: number): number | undefined => {
    if (typeof v === "number") {
      return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
    }
    if (typeof v !== "string" || v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
  };
  if (r.shape === "full" || r.shape === "plate" || r.shape === "card") out.shape = r.shape;
  if (r.fit === "cover" || r.fit === "contain") out.fit = r.fit;
  const radius = num(r.radius, 0, 999); if (radius !== undefined) out.radius = radius;
  const inset = num(r.inset, 0, 200); if (inset !== undefined) out.inset = inset;
  const size = num(r.size, 24, 2000); if (size !== undefined) out.size = size;
  const ar = num(r.aspectRatio, 0.1, 10); if (ar !== undefined) out.aspectRatio = ar;
  // A held scene the user cannot leave is the worst failure this screen has,
  // so the ceiling is low on purpose.
  const hold = num(r.holdMs, 300, 20000); if (hold !== undefined) out.holdMs = hold;
  if (typeof r.loop === "boolean") out.loop = r.loop;
  // Where the media sits inside its window, in percent of that window. Bounded
  // to +/-50 because a nudge past half the screen is not a nudge — it is a
  // media file pushed off the screen with no way to see that it happened.
  const nx = num(r.nudgeX, -50, 50); if (nx !== undefined) out.nudgeX = nx;
  const ny = num(r.nudgeY, -50, 50); if (ny !== undefined) out.nudgeY = ny;
  // How big the media is drawn inside that window. Floor at 0.05 so a typo
  // shrinks the opening rather than deleting it.
  const sc = num(r.scale, 0.05, 1); if (sc !== undefined) out.scale = sc;
  // A box in points, for matching something the platform itself measures in
  // points. Floor at 40 so a box is always big enough to see it went wrong.
  const bw = num(r.boxWidth, 40, 4000); if (bw !== undefined) out.boxWidth = bw;
  const bh = num(r.boxHeight, 40, 4000); if (bh !== undefined) out.boxHeight = bh;
  // The two facts placement is computed from, rather than the offset someone
  // measured once. `aspect` is the switch — without the art's shape the client
  // has nothing to compute and keeps the old centred cover.
  const asp = num(r.aspect, 0.1, 10); if (asp !== undefined) out.aspect = asp;
  const fx = num(r.focusX, 0, 1); if (fx !== undefined) out.focusX = fx;
  const fy = num(r.focusY, 0, 1); if (fy !== undefined) out.focusY = fy;
  const axr = num(r.anchorX, 0, 1); if (axr !== undefined) out.anchorX = axr;
  const ayr = num(r.anchorY, 0, 1); if (ayr !== undefined) out.anchorY = ayr;
  // Whether the art is cropped to the window at all. focus/anchor above choose
  // WHAT SURVIVES a crop; these choose whether there is one — the answer for
  // art whose full width is the subject, which no focal point can protect.
  // Needs `aspect`; without the art's shape there is no box to derive.
  if (r.fill === "window" || r.fill === "width" || r.fill === "height") out.fill = r.fill;
  if (r.pin === "top" || r.pin === "bottom" || r.pin === "center") out.pin = r.pin;
  // Hold the first frame this long, then play. Capped low: a screen frozen on
  // a still the user cannot get past is worse than one that opens mid-motion.
  const sd = num(r.startDelayMs, 0, 8000); if (sd !== undefined) out.startDelayMs = sd;
  // How long the last frame is held afterwards. Same low ceiling as the lead-in
  // and for the same reason: a screen the user cannot get past is the worst
  // failure either of these can cause.
  const eh = num(r.endHoldMs, 0, 8000); if (eh !== undefined) out.endHoldMs = eh;
  if (typeof r.background === "string" && /^#[0-9a-f]{3,8}$/i.test(r.background.trim())) {
    out.background = r.background.trim();
  }
  return Object.keys(out).length ? out : null;
}

/** Refuse keys that would pollute Object.prototype or produce a poisoned entry. */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Art that ships with the code (tulmi/brand, copied into the image), for keys
 * named by something that cannot wait for an upload: the sign-in email names
 * `email.mark` in HTML pasted into Supabase, and a key nobody has uploaded to
 * would show every new user a broken tile. An upload under the key still wins.
 */
const BRAND_DIR = process.env.BRAND_DIR || path.join(process.cwd(), "brand");
const BUNDLED_KEYED: Readonly<Record<string, { file: string; contentType: string }>> = Object.freeze({
  "email.mark": { file: "email-mark.png", contentType: "image/png" },
});

// Inside MEDIA_DIR (see registryPath), so it is also reachable at
// /media/_registry_v1.json. That is not a leak: the same mapping goes out in
// every bootstrap (bootstrap.media).
const REGISTRY_FILENAME = "_registry_v1.json";

export type MediaEntry = {
  url: string;
  contentType: string;
  size: number;
  uploadedAt: number;
  key?: string;
  /** Playback length, when known (set by the compressor for video sources). */
  durationMs?: number;
  /** How the slot is shown. Set by POST /v1/media/present. */
  present?: MediaPresent;
  /**
   * A video's first frame as a still, cut by the server (ensureVideoPosters).
   * `from` is the video url it was cut from, so a replaced video is re-cut
   * rather than wearing the old one's frame.
   */
  poster?: { url: string; contentType: string; from: string };
};

export type MediaRegistry = Record<string, MediaEntry>;

/**
 * What this file actually IS, from its first bytes.
 *
 * The declared mimetype comes from whatever uploaded the file, and clients get
 * it wrong constantly — a curl that cannot guess sends nothing, and the route
 * fell back to application/octet-stream. That stored an mp4 with a ".bin"
 * extension and a content type nothing recognises, so the screen that asked
 * for a Video node got an Image node and the clip silently did not play. The
 * upload said ok:true; the failure surfaced days later as "why is it blank".
 *
 * The bytes cannot be wrong. A specific declared type is still trusted — it
 * carries detail sniffing cannot, like svg+xml versus plain xml — but a
 * generic or missing one is repaired here rather than propagated.
 */
export function sniffContentType(buf: Buffer, declared: string): string {
  const d = (declared || "").toLowerCase();
  const generic = !d || d === "application/octet-stream" || d === "binary/octet-stream";
  if (!generic) return declared;
  const ascii = (start: number, len: number) => buf.slice(start, start + len).toString("latin1");
  if (buf.length >= 12) {
    // ISO base media (mp4, m4v, mov): a "ftyp" box at offset 4, whose brand
    // then separates QuickTime from the mp4 family.
    if (ascii(4, 4) === "ftyp") {
      return ascii(8, 4).startsWith("qt") ? "video/quicktime" : "video/mp4";
    }
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (ascii(0, 4) === "\u001aE\u00df\u00a3") return "video/webm";
  }
  if (buf.length >= 8 && buf[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 5 && ascii(0, 5) === "%PDF-") return "application/pdf";
  return declared || "application/octet-stream";
}

function extForContentType(ct: string): string {
  if (!ct) return "bin";
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/heic": "heic",
    "audio/mpeg": "mp3",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/json": "json",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  const known = map[ct.toLowerCase()];
  if (known) return known;
  // The fallback comes from the uploader's declared type, so it is held to a
  // plain token, and never one the static server would hand a browser as a
  // page: "text/html" must not become a script-running .html on this origin.
  const sub = ct.split("/")[1]?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,10}$/.test(sub) && !/html/.test(sub) ? sub : "bin";
}

/**
 * Registry file lives INSIDE MEDIA_DIR so it sits on the same Docker volume
 * as the media files it maps to. Previously it lived in the parent
 * directory — but only MEDIA_DIR is volume-mounted in docker-compose.yml,
 * so on `docker compose down/build --no-cache/up`, the parent got wiped
 * and the mapping was lost while the SHA-named files kept surviving.
 *
 * Filename is prefixed with `_` so it sorts to the top of any listing
 * and can't clash with a SHA-named media file.
 */
function registryPath(mediaDir: string): string {
  return path.join(mediaDir, REGISTRY_FILENAME);
}

/**
 * Legacy registry path (parent of MEDIA_DIR). Kept as a read-only fallback
 * so a running container that has an old registry in its ephemeral parent
 * still picks it up on boot — even though we now write to the new location.
 */
function legacyRegistryPath(mediaDir: string): string {
  return path.join(path.dirname(mediaDir), REGISTRY_FILENAME);
}

async function readRegistry(mediaDir: string): Promise<MediaRegistry> {
  // Try the new (inside-volume) path first.
  const file = registryPath(mediaDir);
  let newFileExists = false;
  try {
    const text = await fs.readFile(file, "utf8");
    newFileExists = true;
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as MediaRegistry;
    throw new Error("registry is not an object");
  } catch (err) {
    // If the NEW file EXISTS but is unreadable/corrupt, do NOT silently fall
    // through to {} — the next upload would overwrite it and permanently lose
    // every mapping. Preserve the bad file under a .corrupt name so it's
    // recoverable, and only then continue to the legacy fallback.
    if (newFileExists) {
      console.error("[media] registry at new path is corrupt; backing it up", err);
      try { await fs.rename(file, `${file}.corrupt.${crypto.randomUUID()}`); } catch { /* best effort */ }
    }
  }
  // Fallback: legacy parent-dir location. If we find one, subsequent writes
  // will land in the new (persistent) location automatically.
  try {
    const legacy = legacyRegistryPath(mediaDir);
    const text = await fs.readFile(legacy, "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as MediaRegistry;
  } catch {
    // fine — first boot, no registry yet
  }
  return {};
}

/**
 * Atomic write: serialise to a temp sibling then rename over the target.
 * Prevents corrupt registries when the process is killed mid-write or two
 * uploads race. On EACCES / EPERM (volume-owner mismatch) we surface a clear
 * error instead of silently losing data.
 */
// Serialize registry writes so two concurrent uploads/deletes can't interleave
// (last-rename-wins would drop a concurrently-added key, and same-ms temp names
// could collide). Each write chains onto the previous one.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Every registry write goes through here, and every one of them INVALIDATES
 * THE SCREEN CACHE.
 *
 * A screen is built with the media baked into it — the resolved url, the box
 * its placement implies, whether it is a Video node or an Image one — and the
 * result is cached under a version token the app compares against. So changing
 * how a clip is presented used to change nothing a user could see: the server
 * kept serving the screen it had already built, and the new values only
 * appeared when something else happened to bump the token.
 *
 * That failure is invisible from both ends. The POST answers ok:true with the
 * new values echoed back, and the app shows the old ones, which reads as the
 * setting not working rather than as a stale cache. Two people spent a while
 * re-uploading a clip that had been correct on the server the whole time.
 */
async function writeRegistryAndInvalidate(mediaDir: string, r: MediaRegistry): Promise<void> {
  await writeRegistry(mediaDir, r);
  bumpCacheVersion();
  // Whatever changed, a new or replaced video gets its first frame cut.
  schedulePosters();
}

// --- First frames ------------------------------------------------------------
//
// THE STILL THAT MAKES A FILM'S OPENING SEAMLESS.
//
// A video player has decoded nothing until the file arrives, and the app's
// player (expo-video) has no poster: for those first moments it draws only
// its background. On the opening film that is the launch image's mark
// vanishing and coming back when the first frame lands — the blink between
// the splash and its animation. So the server cuts each video's frame 0 into
// a still once, and the screens put it under the film: the app's splash wait
// already prefetches a screen's images, so the still is on disk before the
// launch image lifts, and the film plays over its own first frame.

/** One video file in, its first frame out as WebP bytes (or null). */
export type FrameExtractor = (videoFile: string) => Promise<Buffer | null>;

export const ffmpegFirstFrame: FrameExtractor = async (videoFile) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tulmi-poster-"));
  try {
    const out = path.join(dir, "frame.webp");
    await runFile("ffmpeg", [
      "-y", "-i", videoFile, "-frames:v", "1", "-an",
      // Near-lossless: the still has to be the film's own frame, not an
      // approximation of it, or the hand-over is a visible change of grain.
      "-c:v", "libwebp", "-lossless", "0", "-quality", "95",
      out,
    ], { timeout: 60_000, maxBuffer: 1 << 24 });
    return await fs.readFile(out);
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

let posterCfg: { mediaDir: string; publicUrlPrefix: string; extract: FrameExtractor } | null = null;
let posterRun: Promise<number> | null = null;
let posterAgain = false;

/**
 * Cut the first frame of every video that has none (or whose still was cut
 * from a file since replaced). Returns how many were cut. Never throws: a
 * video without a still simply plays as it always has.
 */
export async function ensureVideoPosters(opts: {
  mediaDir: string; publicUrlPrefix: string; extract?: FrameExtractor;
}): Promise<number> {
  const extract = opts.extract ?? ffmpegFirstFrame;
  let cut = 0;
  for (const [key, e] of Object.entries(cachedRegistry)) {
    if (!/^video\//i.test(e.contentType ?? "")) continue;
    if (e.poster && e.poster.from === e.url) continue;
    const name = String(e.url).split("?")[0]!.split("/").pop() ?? "";
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    const file = path.join(opts.mediaDir, name);
    try { await fs.access(file); } catch { continue; }
    const buf = await extract(file).catch(() => null);
    if (!buf || buf.length < 64) continue;
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const filename = `${sha}.webp`;
    const target = path.join(opts.mediaDir, filename);
    try { await fs.access(target); } catch { await fs.writeFile(target, buf); }
    // The entry may have been replaced while ffmpeg ran; only attach the still
    // to the same file it was cut from.
    const now = cachedRegistry[key];
    if (!now || now.url !== e.url) continue;
    cachedRegistry = {
      ...cachedRegistry,
      [key]: { ...now, poster: { url: `${opts.publicUrlPrefix}/${filename}`, contentType: "image/webp", from: now.url } },
    };
    cut++;
  }
  if (cut) {
    await writeRegistry(opts.mediaDir, cachedRegistry);
    bumpCacheVersion();
  }
  return cut;
}

/** Run ensureVideoPosters in the background, once at a time, again if asked meanwhile. */
function schedulePosters(): void {
  if (!posterCfg) return;
  if (posterRun) { posterAgain = true; return; }
  const cfg = posterCfg;
  posterRun = (async () => {
    let total = 0;
    do {
      posterAgain = false;
      total += await ensureVideoPosters(cfg).catch((err) => {
        console.error("[media] first-frame cut failed", err);
        return 0;
      });
    } while (posterAgain);
    return total;
  })().finally(() => { posterRun = null; });
}

async function writeRegistry(mediaDir: string, r: MediaRegistry): Promise<void> {
  const run = writeChain.then(async () => {
    const file = registryPath(mediaDir);
    // Unique temp name (randomUUID, not pid+Date.now) so two writes in the same
    // millisecond can't target the same temp file and interleave bytes.
    const tmp = `${file}.tmp.${crypto.randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify(r, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
  });
  // Keep the chain alive even if this write throws, so a failure doesn't wedge
  // all future writes.
  writeChain = run.catch(() => {});
  return run;
}

let cachedRegistry: MediaRegistry = {};

/** Read the current in-memory registry — used by bootstrap to publish
 * `bootstrap.media`. Kept in memory so bootstrap requests don't hit disk. */
export function getMediaRegistry(): MediaRegistry {
  return cachedRegistry;
}

/** Warm the in-memory cache from disk. Call once at boot. */
export async function loadMediaRegistry(mediaDir: string): Promise<void> {
  await fs.mkdir(mediaDir, { recursive: true });
  cachedRegistry = await readRegistry(mediaDir);
  // Migrate-at-boot: if the new in-volume registry file is absent but we loaded
  // entries (they came from the legacy parent-dir path), persist them into the
  // new persistent location NOW. Without this, a container restart before the
  // next upload/delete — the very restart that wipes the ephemeral parent dir —
  // would silently lose every key→URL mapping (mic art, intro frames, etc.).
  try {
    await fs.access(registryPath(mediaDir));
  } catch {
    if (Object.keys(cachedRegistry).length > 0) {
      try {
        await writeRegistryAndInvalidate(mediaDir, cachedRegistry);
      } catch (err) {
        console.error("[media] failed to migrate legacy registry to new path", err);
      }
    }
  }
}

export function registerMediaRoutes(app: FastifyInstance, opts: {
  mediaDir: string;
  publicUrlPrefix: string;   // e.g. "https://api.tailzu.space/media"
  /** Per-IP rate-limit cap for the admin routes (the app's AUTHED_RL tier). */
  rateLimit?: { max: number; timeWindow: number };
}): void {
  const { mediaDir, publicUrlPrefix, rateLimit } = opts;

  // @fastify/rate-limit is registered global:false, so a route is only
  // throttled when it carries a `config.rateLimit`. Every admin route here
  // carries one, so the admin secret cannot be guessed at line rate.
  const rl = rateLimit ? { config: { rateLimit } } : {};

  // The server cuts each video's first frame (see ensureVideoPosters) — now,
  // for what is already stored, and after every change from here on.
  posterCfg = { mediaDir, publicUrlPrefix, extract: ffmpegFirstFrame };
  schedulePosters();

  // Compression lives in its own module but has to run in here: it needs the
  // live registry, the same admin check, and the same media dir, and the
  // rewrite has to be one operation with the registry write.
  const processing = {
    mediaDir,
    publicUrlPrefix,
    route: rl,
    registry: () => cachedRegistry,
    writeRegistry: async (r: MediaRegistry) => {
      cachedRegistry = r;
      await writeRegistryAndInvalidate(mediaDir, r);
    },
  };
  registerMediaCompressRoute(app, processing);
  // Same plumbing, different job: /compress makes a file smaller, /retime makes
  // it faster. Kept apart because compression discards a result that is not
  // smaller, which would throw away every retime that is not also a saving.
  registerMediaRetimeRoute(app, processing);

  // --- Upload -----------------------------------------------------------------
  // Multipart body with a single "file" field (image, svg, audio, etc.).
  // Optional query "key" registers the upload under a named lookup, e.g.
  // ?key=brand.mark makes it reachable via bootstrap.media["brand.mark"].
  app.post("/v1/media/upload", rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    // @fastify/multipart iterator — take the first file we encounter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyReq = req as any;
    const parts = anyReq.parts?.();
    if (!parts) return reply.code(400).send({ code: "no_multipart" });
    // IMPORTANT: the iterator can only advance to the next part once the
    // current part's stream has been consumed. So we MUST call toBuffer()
    // on the file part *inside* the loop — the old "capture the reference,
    // read the buffer after the loop" pattern hangs forever on a
    // single-part request because the loop can't tell there's no next
    // part until the file's stream ends, which never happens without a
    // consumer. Every upload timed out silently as a result.
    let contentType = "application/octet-stream";
    let buf: Buffer | null = null;
    let extraKey = "";
    for await (const p of parts) {
      if (p.type === "file") {
        if (buf == null) {
          buf = await p.toBuffer();
          contentType = p.mimetype || contentType;
        } else {
          // Extra files — drain them so the iterator can advance to any
          // trailing fields without hanging.
          await p.toBuffer();
        }
      } else if (p.type === "field" && p.fieldname === "key") {
        extraKey = String(p.value);
      }
    }
    if (!buf) return reply.code(400).send({ code: "no_file" });
    const size = buf.length;
    // Repair a generic declared type from the bytes before anything is derived
    // from it — the extension, the url, and every renderer's node choice all
    // hang off this one value.
    contentType = sniffContentType(buf, contentType);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const ext = extForContentType(contentType);
    const filename = `${sha}.${ext}`;
    const filepath = path.join(mediaDir, filename);
    // Skip write if the same bytes are already on disk.
    let alreadyPresent = false;
    try { await fs.access(filepath); alreadyPresent = true; } catch {}
    if (!alreadyPresent) await fs.writeFile(filepath, buf);
    const url = `${publicUrlPrefix}/${filename}`;

    const entry: MediaEntry = {
      url,
      contentType,
      size,
      uploadedAt: Date.now(),
    };

    // Key precedence: query param `key`, then multipart field `key`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (req as any).query as Record<string, string> | undefined;
    // `??` keeps an empty string (e.g. "?key="), which registered the upload
    // under "" and clobbered the previous unkeyed upload. Trim first, then fall
    // through on empty with `||` so a keyless upload is SHA-addressed as intended.
    const key = (query?.key?.trim() || extraKey?.trim() || sha).trim();
    if (RESERVED_KEYS.has(key)) return reply.code(400).send({ code: "reserved_key" });
    entry.key = key;
    cachedRegistry[key] = entry;
    await writeRegistryAndInvalidate(mediaDir, cachedRegistry);

    return reply.send({ ok: true, key, url, sha, size, contentType });
  });

  // --- List (admin) -----------------------------------------------------------
  app.get("/v1/media/list", rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return reply.send({ registry: cachedRegistry });
  });

  // --- Presentation (admin) -------------------------------------------------
  //
  // How a slot is SHOWN, separate from what is in it. The opening media can go
  // from a circle to edge-to-edge, or change how long it holds, with one call
  // and no deploy — which is the whole point of the media store being the
  // backend's, not the build's.
  //
  //   POST /v1/media/present?key=intro   {"shape":"full","fit":"cover","holdMs":4600}
  //   POST /v1/media/present?key=intro&reset=true    → back to the screen's default
  app.post("/v1/media/present", rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const q = (req as { query?: Record<string, string> }).query ?? {};
    const key = (q.key ?? "").trim();
    if (!key) return reply.code(400).send({ code: "bad_request", message: "Missing ?key=" });
    if (RESERVED_KEYS.has(key)) return reply.code(400).send({ code: "reserved_key" });
    const entry = Object.prototype.hasOwnProperty.call(cachedRegistry, key)
      ? cachedRegistry[key] : undefined;
    if (!entry) return reply.code(404).send({ code: "not_found", message: `no media at key "${key}"` });

    if (q.reset === "true") {
      delete entry.present;
      await writeRegistryAndInvalidate(mediaDir, cachedRegistry);
      return reply.send({ ok: true, key, present: null });
    }

    const present = cleanPresent(req.body);
    if (!present) {
      return reply.code(400).send({
        code: "bad_request",
        message: "Nothing usable. Fields: shape (full|plate|card), fit (cover|contain), radius, inset, size, aspectRatio, background (#hex), holdMs, loop, nudgeX, nudgeY (percent of the window, +/-50), scale (0.05-1), boxWidth, boxHeight (points), aspect (art width/height), focusX, focusY, anchorX, anchorY (0-1), startDelayMs, endHoldMs (0-8000), fill (window|width|height), pin (top|bottom|center).",
      });
    }
    // Merge, so setting one field does not silently drop the rest.
    entry.present = { ...(entry.present ?? {}), ...present };
    await writeRegistryAndInvalidate(mediaDir, cachedRegistry);
    return reply.send({ ok: true, key, present: entry.present });
  });

  // --- Delete (admin) — removes registry entry; file stays on disk ----------
  app.delete("/v1/media/:key", rl, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const key = ((req as any).params?.key ?? "") as string;
    if (RESERVED_KEYS.has(key)) return reply.code(400).send({ code: "reserved_key" });
    if (!Object.prototype.hasOwnProperty.call(cachedRegistry, key)) {
      return reply.code(404).send({ code: "not_found" });
    }
    delete cachedRegistry[key];
    await writeRegistryAndInvalidate(mediaDir, cachedRegistry);
    return reply.send({ ok: true });
  });

  /**
   * THE FILE ITSELF, AT A URL THAT NEVER CHANGES.
   *
   * Everything else here addresses media by content hash, which is right for
   * the app — it fetches the registry first and follows whatever URL it finds,
   * so a new upload is picked up on the next bootstrap. An EMAIL cannot do
   * that. Its HTML is pasted into Supabase by hand and then sits there for
   * months, so a content-addressed URL in it means the icon breaks the day
   * anyone re-uploads it, silently, in mail nobody on the team receives.
   *
   * So: a redirect keyed by name. The template names `email.mark` forever and
   * this points it at whatever is currently under that key.
   *
   * Public and unauthenticated, like /media/* — it serves what an anonymous
   * client could already fetch, and reveals only whether a key exists, which
   * every bootstrap's `media` map already tells anyone who asks. 302 rather than 301
   * because the target is expected to change; a permanent redirect is exactly
   * the thing a mail client would cache past the next upload.
   */
  app.get<{ Params: { key: string } }>("/media/k/:key", async (req, reply) => {
    const key = String(req.params.key ?? "").trim();
    if (!key || RESERVED_KEYS.has(key)) return reply.code(404).send({ code: "not_found" });
    const url = Object.prototype.hasOwnProperty.call(cachedRegistry, key) ? cachedRegistry[key]?.url : undefined;
    // Short, so swapping the art shows up the same day, and long enough that a
    // mail client opened twice does not fetch twice.
    if (url) return reply.header("cache-control", "public, max-age=3600").redirect(url, 302);
    // Nothing uploaded under the key: the copy that ships with the code, so a
    // template never shows a broken tile for want of an upload nobody ran.
    const bundled = Object.prototype.hasOwnProperty.call(BUNDLED_KEYED, key) ? BUNDLED_KEYED[key] : undefined;
    if (bundled) {
      try {
        const bytes = await fs.readFile(path.join(BRAND_DIR, bundled.file));
        return reply.header("cache-control", "public, max-age=3600").type(bundled.contentType).send(bytes);
      } catch { /* not in this build: answer as for any unknown key */ }
    }
    return reply.code(404).send({ code: "not_found" });
  });
}
