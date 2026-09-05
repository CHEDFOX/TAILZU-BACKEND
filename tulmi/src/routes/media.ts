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
 * Public reads: /media/* is served by @fastify/static (no auth). Named
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
import { registerMediaCompressRoute } from "./mediaCompress.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MediaPresent } from "../../../shared/types/sdui.js";

/**
 * Sanitise a presentation payload.
 *
 * Everything here ends up inside a style object a client renders, so this is a
 * whitelist, not a merge: unknown fields are dropped, enums must match, numbers
 * are clamped to a sane range, and the background has to look like a colour.
 * An admin secret is not a licence to post arbitrary style into every install.
 */
function cleanPresent(raw: unknown): MediaPresent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: MediaPresent = {};
  const num = (v: unknown, lo: number, hi: number): number | undefined => {
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
  if (typeof r.background === "string" && /^#[0-9a-f]{3,8}$/i.test(r.background.trim())) {
    out.background = r.background.trim();
  }
  return Object.keys(out).length ? out : null;
}

/** Refuse keys that would pollute Object.prototype or produce a poisoned entry. */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Timing-safe string compare. `provided === expected` leaks length via
 * response time on repeated probes; this uses Node's timingSafeEqual which
 * runs in constant time relative to length.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Registry file lives OUTSIDE MEDIA_DIR so @fastify/static doesn't serve it
// publicly at /media/registry.json (which would leak every named mapping).
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
  return map[ct.toLowerCase()] ?? ct.split("/")[1] ?? "bin";
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
        await writeRegistry(mediaDir, cachedRegistry);
      } catch (err) {
        console.error("[media] failed to migrate legacy registry to new path", err);
      }
    }
  }
}

/** Guard: admin-secret header must match the ADMIN_SECRET env var (timing-safe). */
function checkAdmin(req: any, expected: string): { ok: boolean; reason?: string } {
  if (!expected) return { ok: false, reason: "not_configured" };
  const provided = req.headers["x-admin-secret"];
  if (typeof provided !== "string" || provided.length === 0) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!safeEqual(provided, expected)) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true };
}

export function registerMediaRoutes(app: FastifyInstance, opts: {
  mediaDir: string;
  publicUrlPrefix: string;   // e.g. "https://api.tailzu.space/media"
  adminSecret: string;
  /** Per-IP rate-limit cap for the admin routes (the app's AUTHED_RL tier). */
  rateLimit?: { max: number; timeWindow: number };
}): void {
  const { mediaDir, publicUrlPrefix, adminSecret, rateLimit } = opts;

  // Compression lives in its own module but has to run in here: it needs the
  // live registry, the same admin check, and the same media dir, and the
  // rewrite has to be one operation with the registry write.
  registerMediaCompressRoute(app, {
    mediaDir,
    publicUrlPrefix,
    adminSecret,
    registry: () => cachedRegistry,
    writeRegistry: async (r) => {
      cachedRegistry = r;
      await writeRegistry(mediaDir, r);
    },
    checkAdmin: (req, expected) => checkAdmin(req, expected),
  });

  // @fastify/rate-limit is registered global:false, so a route is only
  // throttled when it carries a `config.rateLimit`. Build it once and attach
  // it to the admin routes below (the public /v1/media/resolve read is left
  // unthrottled by design).
  const rl = rateLimit ? { config: { rateLimit } } : {};

  // --- Upload -----------------------------------------------------------------
  // Multipart body with a single "file" field (image, svg, audio, etc.).
  // Optional query "key" registers the upload under a named lookup, e.g.
  // ?key=brand.mark makes it reachable via bootstrap.media["brand.mark"].
  app.post("/v1/media/upload", rl, async (req, reply) => {
    const guard = checkAdmin(req, adminSecret);
    if (!guard.ok) return reply.code(guard.reason === "not_configured" ? 503 : 401)
      .send({ code: guard.reason });

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
    await writeRegistry(mediaDir, cachedRegistry);

    return reply.send({ ok: true, key, url, sha, size, contentType });
  });

  // --- List (admin) -----------------------------------------------------------
  app.get("/v1/media/list", rl, async (req, reply) => {
    const guard = checkAdmin(req, adminSecret);
    if (!guard.ok) return reply.code(guard.reason === "not_configured" ? 503 : 401)
      .send({ code: guard.reason });
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
    const guard = checkAdmin(req, adminSecret);
    if (!guard.ok) return reply.code(guard.reason === "not_configured" ? 503 : 401)
      .send({ code: guard.reason });

    const q = (req as { query?: Record<string, string> }).query ?? {};
    const key = (q.key ?? "").trim();
    if (!key) return reply.code(400).send({ code: "bad_request", message: "Missing ?key=" });
    if (RESERVED_KEYS.has(key)) return reply.code(400).send({ code: "reserved_key" });
    const entry = Object.prototype.hasOwnProperty.call(cachedRegistry, key)
      ? cachedRegistry[key] : undefined;
    if (!entry) return reply.code(404).send({ code: "not_found", message: `no media at key "${key}"` });

    if (q.reset === "true") {
      delete entry.present;
      await writeRegistry(mediaDir, cachedRegistry);
      return reply.send({ ok: true, key, present: null });
    }

    const present = cleanPresent(req.body);
    if (!present) {
      return reply.code(400).send({
        code: "bad_request",
        message: "Nothing usable. Fields: shape (full|plate|card), fit (cover|contain), radius, inset, size, aspectRatio, background (#hex), holdMs.",
      });
    }
    // Merge, so setting one field does not silently drop the rest.
    entry.present = { ...(entry.present ?? {}), ...present };
    await writeRegistry(mediaDir, cachedRegistry);
    return reply.send({ ok: true, key, present: entry.present });
  });

  // --- Delete (admin) — removes registry entry; file stays on disk ----------
  app.delete("/v1/media/:key", rl, async (req, reply) => {
    const guard = checkAdmin(req, adminSecret);
    if (!guard.ok) return reply.code(guard.reason === "not_configured" ? 503 : 401)
      .send({ code: guard.reason });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const key = ((req as any).params?.key ?? "") as string;
    if (RESERVED_KEYS.has(key)) return reply.code(400).send({ code: "reserved_key" });
    if (!Object.prototype.hasOwnProperty.call(cachedRegistry, key)) {
      return reply.code(404).send({ code: "not_found" });
    }
    delete cachedRegistry[key];
    await writeRegistry(mediaDir, cachedRegistry);
    return reply.send({ ok: true });
  });

  // --- Public read (no auth) --------------------------------------------------
  // Named lookup for clients that only know the semantic key. Returns the URL
  // + content type; clients then fetch the actual bytes from /media/*.
  app.get("/v1/media/resolve", async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const key = String(((req as any).query?.key ?? "")).trim();
    if (!key) return reply.code(400).send({ code: "missing_key" });
    if (RESERVED_KEYS.has(key)) return reply.code(400).send({ code: "reserved_key" });
    if (!Object.prototype.hasOwnProperty.call(cachedRegistry, key)) {
      return reply.code(404).send({ code: "not_found" });
    }
    const entry = cachedRegistry[key];
    return reply.send(entry);
  });
}
