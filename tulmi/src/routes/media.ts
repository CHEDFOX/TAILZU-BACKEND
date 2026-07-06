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

const REGISTRY_FILENAME = "registry.json";

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

async function readRegistry(dir: string): Promise<MediaRegistry> {
  const file = path.join(dir, REGISTRY_FILENAME);
  try {
    const text = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as MediaRegistry;
  } catch {
    // fine — first boot, no registry yet
  }
  return {};
}

async function writeRegistry(dir: string, r: MediaRegistry): Promise<void> {
  const file = path.join(dir, REGISTRY_FILENAME);
  await fs.writeFile(file, JSON.stringify(r, null, 2) + "\n", "utf8");
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

/** Guard: admin-secret header must match the ADMIN_SECRET env var. */
function checkAdmin(req: any, expected: string): { ok: boolean; reason?: string } {
  if (!expected) return { ok: false, reason: "not_configured" };
  const provided = req.headers["x-admin-secret"];
  if (typeof provided !== "string" || provided.length === 0 || provided !== expected) {
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
    let uploadedFile: any = null;
    let extraKey = "";
    for await (const p of parts) {
      if (p.type === "file" && !uploadedFile) uploadedFile = p;
      else if (p.type === "field" && p.fieldname === "key") extraKey = String(p.value);
    }
    if (!uploadedFile) return reply.code(400).send({ code: "no_file" });

    const buf: Buffer = await uploadedFile.toBuffer();
    const contentType: string = uploadedFile.mimetype || "application/octet-stream";
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
    if (!(key in cachedRegistry)) return reply.code(404).send({ code: "not_found" });
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
    const entry = cachedRegistry[key];
    if (!entry) return reply.code(404).send({ code: "not_found" });
    return reply.send(entry);
  });
}
