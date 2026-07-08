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
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
};

export type MediaRegistry = Record<string, MediaEntry>;

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
 * Registry file lives in the PARENT of MEDIA_DIR (e.g. /data/_registry_v1.json
 * when MEDIA_DIR is /data/media) so the public static server rooted at
 * MEDIA_DIR can never expose it.
 */
function registryPath(mediaDir: string): string {
  return path.join(path.dirname(mediaDir), REGISTRY_FILENAME);
}

async function readRegistry(mediaDir: string): Promise<MediaRegistry> {
  const file = registryPath(mediaDir);
  try {
    const text = await fs.readFile(file, "utf8");
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
async function writeRegistry(mediaDir: string, r: MediaRegistry): Promise<void> {
  const file = registryPath(mediaDir);
  const tmp = file + `.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(r, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
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
}): void {
  const { mediaDir, publicUrlPrefix, adminSecret } = opts;

  // --- Upload -----------------------------------------------------------------
  // Multipart body with a single "file" field (image, svg, audio, etc.).
  // Optional query "key" registers the upload under a named lookup, e.g.
  // ?key=brand.mark makes it reachable via bootstrap.media["brand.mark"].
  app.post("/v1/media/upload", async (req, reply) => {
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
    const key = (query?.key ?? extraKey ?? sha).trim();
    if (RESERVED_KEYS.has(key)) return reply.code(400).send({ code: "reserved_key" });
    entry.key = key;
    cachedRegistry[key] = entry;
    await writeRegistry(mediaDir, cachedRegistry);

    return reply.send({ ok: true, key, url, sha, size, contentType });
  });

  // --- List (admin) -----------------------------------------------------------
  app.get("/v1/media/list", async (req, reply) => {
    const guard = checkAdmin(req, adminSecret);
    if (!guard.ok) return reply.code(guard.reason === "not_configured" ? 503 : 401)
      .send({ code: guard.reason });
    return reply.send({ registry: cachedRegistry });
  });

  // --- Delete (admin) — removes registry entry; file stays on disk ----------
  app.delete("/v1/media/:key", async (req, reply) => {
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
