/**
 * WHERE A FILE'S BYTES ARE KEPT: CLOUDFLARE R2 THROUGH ITS S3 API, OR MEMORY FOR TESTS.
 *
 * The database holds what a file SAYS (its text, its chunks, its metadata); the bytes themselves go to a bucket, under
 * `u/<user id>/<sha256>`: one object per person per file, so the same picture uploaded twice is one object, and one person's key can
 * never name another's. Frames of a video are `u/<user id>/<sha256>/f<n>.jpg`.
 *
 * R2 is reached with fetch and our own SigV4 signer (sigv4.ts): path-style `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`,
 * region `auto`, service `s3`. The body is signed (its real SHA-256), so a byte changed on the way is a 403. A 5xx or a 429 is tried
 * again twice with a short wait; anything else is an error with R2's own words (the status and the first 200 characters, never a header).
 *
 * Config: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (a secret: .env only), R2_BUCKET. With any of them missing there is no
 * bucket and `blobStore()` returns null: the feature still reads files (text, chunks, metadata) but keeps no bytes.
 */
import { getConfig } from "../config.js";
import { sha256Hex, sign } from "./sigv4.js";
import { MediaError } from "./types.js";

export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** The bytes, or null when there is no such object. */
  get(key: string): Promise<Buffer | null>;
  /** Deleting what is not there is not an error. */
  delete(key: string): Promise<void>;
}

/** The key of a person's file. The id is a uuid and the checksum is hex, so neither can add a slash of its own. */
export function blobKey(userId: string, sha256: string, suffix = ""): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId) || !/^[0-9a-f]{64}$/.test(sha256)) throw new MediaError("bad_request", "That is not a file key.");
  return `u/${userId}/${sha256}${suffix}`;
}

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  async put(key: string, data: Buffer, contentType: string): Promise<void> { this.objects.set(key, { data: Buffer.from(data), contentType }); }
  async get(key: string): Promise<Buffer | null> { const o = this.objects.get(key); return o ? Buffer.from(o.data) : null; }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** The endpoint, for a test. */
  endpoint?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
  /** Waits between tries; a test makes it 0. */
  retryMs?: number;
}

const SAFE_KEY = /^[A-Za-z0-9._\-/]+$/;

export class R2BlobStore implements BlobStore {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly c: R2Config) {
    this.base = (c.endpoint ?? `https://${c.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
    this.fetchFn = c.fetchFn ?? fetch;
  }

  private url(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..") || key.startsWith("/")) throw new MediaError("bad_request", "That is not a file key.");
    return `${this.base}/${this.c.bucket}/${key}`;
  }

  private async send(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const url = this.url(key);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const signed = sign({
        method, url, region: "auto", service: "s3", ...(body ? { body } : { payloadHash: sha256Hex("") }),
        credentials: { accessKeyId: this.c.accessKeyId, secretAccessKey: this.c.secretAccessKey },
        ...(contentType ? { headers: { "content-type": contentType } } : {}), ...(this.c.now ? { date: this.c.now() } : {}),
      });
      try {
        const res = await this.fetchFn(url, { method, headers: signed.headers, ...(body ? { body: new Uint8Array(body) } : {}), signal: AbortSignal.timeout(60_000) });
        if (res.status >= 500 || res.status === 429) await res.arrayBuffer().catch(() => undefined);
        else return res;
      } catch {
        // The network failed: tried again below.
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, this.c.retryMs ?? 250 * (attempt + 1)));
    }
    throw new MediaError("failed", "I could not reach the file store just now. Try again in a moment.", 503);
  }

  private async fail(what: string, res: Response): Promise<never> {
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new MediaError("failed", `The file store refused to ${what} (${res.status}${text ? `: ${text}` : ""}).`, 502);
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const res = await this.send("PUT", key, data, contentType);
    if (!res.ok) await this.fail("keep that file", res);
    await res.arrayBuffer().catch(() => undefined);
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) { await res.arrayBuffer().catch(() => undefined); return null; }
    if (!res.ok) await this.fail("give that file back", res);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) await this.fail("delete that file", res);
    await res.arrayBuffer().catch(() => undefined);
  }
}

/** The bucket from the environment, or null when R2 is not set up. */
export function blobStoreFromConfig(): BlobStore | null {
  const c = getConfig();
  if (!c.R2_ACCOUNT_ID || !c.R2_ACCESS_KEY_ID || !c.R2_SECRET_ACCESS_KEY || !c.R2_BUCKET) return null;
  return new R2BlobStore({ accountId: c.R2_ACCOUNT_ID, accessKeyId: c.R2_ACCESS_KEY_ID, secretAccessKey: c.R2_SECRET_ACCESS_KEY, bucket: c.R2_BUCKET });
}
