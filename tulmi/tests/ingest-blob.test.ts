/**
 * WHERE THE BYTES ARE KEPT (src/media/blob.ts): Cloudflare R2 through its S3 API, signed by our own SigV4, and a memory store for tests.
 *
 * No network: `fetchFn` is a fake R2 that checks what it is sent. The signer itself is held to AWS's published signatures in ingest-sigv4.test.ts; here it is
 * the R2 conventions: path-style URL on the account's endpoint, region "auto", the body signed with its real SHA-256, a retry on 5xx and 429, a 404 as "not
 * there", a refusal in words that carry no header, and a key that cannot be made to name anything but its own object.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });
const { MemoryBlobStore, R2BlobStore, blobKey, blobStoreFromConfig } = await import("../src/media/blob.js");
const { resetConfigForTests } = await import("../src/config.js");

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const USER = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

interface Seen { url: string; method: string; headers: Record<string, string>; body?: Buffer }

function fakeR2(answers: Array<number | Error | { status: number; body?: string | Buffer }>) {
  const seen: Seen[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, ...(init.body ? { body: Buffer.from(init.body as Uint8Array) } : {}) });
    const a = answers[Math.min(seen.length - 1, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    const { status, body } = typeof a === "number" ? { status: a, body: "" } : a;
    return new Response(status === 204 ? null : typeof body === "string" ? body : new Uint8Array(body ?? []), { status });
  }) as unknown as typeof fetch;
  return { seen, fetchFn };
}

const store = (fetchFn: typeof fetch) => new R2BlobStore({
  accountId: "acct123", accessKeyId: "AKID", secretAccessKey: "SECRET", bucket: "tailzu-media", fetchFn, now: () => new Date(Date.UTC(2026, 9, 27, 8, 0, 0)), retryMs: 0,
});

describe("R2", () => {
  it("puts an object: path-style URL on the account's endpoint, the body signed with its real hash, region auto, service s3", async () => {
    const r2 = fakeR2([200]);
    const body = Buffer.from("the bytes of a file");
    await store(r2.fetchFn).put(`u/${USER}/${HASH}`, body, "application/pdf");
    const s = r2.seen[0]!;
    expect(s.method).toBe("PUT");
    expect(s.url).toBe(`https://acct123.r2.cloudflarestorage.com/tailzu-media/u/${USER}/${HASH}`);
    expect(s.body).toEqual(body);
    expect(s.headers["x-amz-content-sha256"]).toBe(sha(body));
    expect(s.headers["x-amz-date"]).toBe("20261027T080000Z");
    expect(s.headers["content-type"]).toBe("application/pdf");
    expect(s.headers.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(s.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20261027\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(JSON.stringify(s.headers)).not.toContain("SECRET");
  });

  it("gets an object back, and a 404 is null", async () => {
    expect((await store(fakeR2([{ status: 200, body: Buffer.from("abc") }]).fetchFn).get("u/x/y"))!.toString()).toBe("abc");
    const none = fakeR2([404]);
    expect(await store(none.fetchFn).get("u/x/y")).toBeNull();
    expect(none.seen[0]!.headers["x-amz-content-sha256"]).toBe(sha(""));
  });

  it("deletes, and deleting what is not there is not an error", async () => {
    const r2 = fakeR2([204, 404]);
    const s = store(r2.fetchFn);
    await s.delete("u/x/y");
    await s.delete("u/x/y");
    expect(r2.seen.map((x) => x.method)).toEqual(["DELETE", "DELETE"]);
  });

  it("tries again on a 500, a 429 and a dropped connection, then succeeds", async () => {
    const r2 = fakeR2([500, new Error("socket hang up"), 429, { status: 200, body: "ok" }]);
    // Three tries at most: 500, dropped, 429 is the third, so this one fails; with two failures it succeeds.
    await expect(store(r2.fetchFn).get("u/x/y")).rejects.toThrow(/could not reach the file store/);
    const ok = fakeR2([500, new Error("reset"), { status: 200, body: "fine" }]);
    expect((await store(ok.fetchFn).get("u/x/y"))!.toString()).toBe("fine");
    expect(ok.seen).toHaveLength(3);
  });

  it("does not try again on a refusal, and reports it in words with no header in them", async () => {
    const r2 = fakeR2([{ status: 403, body: "<Error><Code>SignatureDoesNotMatch</Code></Error>" }]);
    const err = await store(r2.fetchFn).put("u/x/y", Buffer.from("a"), "text/plain").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/refused to keep that file \(403: <Error><Code>SignatureDoesNotMatch/);
    expect((err as Error).message).not.toMatch(/AWS4|SECRET|AKID/);
    expect(r2.seen).toHaveLength(1);
  });

  it("will not build a URL from a key that could name anything else", async () => {
    const r2 = fakeR2([200]);
    const s = store(r2.fetchFn);
    for (const key of ["../other", "u/../x", "/abs", "a b", "a?b=c", "a#b", "u/x\n"]) await expect(s.get(key), key).rejects.toThrow(/not a file key/);
    expect(r2.seen).toHaveLength(0);
  });

  it("an endpoint can be given for a test", async () => {
    const r2 = fakeR2([200]);
    const s = new R2BlobStore({ accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucket: "b", endpoint: "http://localhost:9000/", fetchFn: r2.fetchFn, retryMs: 0 });
    await s.put("k1", Buffer.from("x"), "text/plain");
    expect(r2.seen[0]!.url).toBe("http://localhost:9000/b/k1");
  });
});

describe("keys", () => {
  it("are the person's id and the file's checksum, so one person's key can never name another's object", () => {
    expect(blobKey(USER, HASH)).toBe(`u/${USER}/${HASH}`);
    expect(blobKey(USER, HASH, "/f0.jpg")).toBe(`u/${USER}/${HASH}/f0.jpg`);
    expect(() => blobKey("../x", HASH)).toThrow(/not a file key/);
    expect(() => blobKey(USER, "nothex")).toThrow(/not a file key/);
    expect(() => blobKey(`${USER}/../..`, HASH)).toThrow(/not a file key/);
  });
});

describe("the memory store", () => {
  it("keeps, returns copies, and forgets", async () => {
    const m = new MemoryBlobStore();
    const data = Buffer.from("abc");
    await m.put("k", data, "text/plain");
    data[0] = 0x7a;
    expect((await m.get("k"))!.toString()).toBe("abc");
    await m.delete("k");
    expect(await m.get("k")).toBeNull();
    await m.delete("k");
  });
});

describe("from the environment", () => {
  it("is a bucket only when all four settings are there", () => {
    const keys = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
    for (const k of keys) delete process.env[k];
    resetConfigForTests();
    expect(blobStoreFromConfig()).toBeNull();
    process.env.R2_ACCOUNT_ID = "a"; process.env.R2_ACCESS_KEY_ID = "b"; process.env.R2_SECRET_ACCESS_KEY = "c";
    resetConfigForTests();
    expect(blobStoreFromConfig()).toBeNull();
    process.env.R2_BUCKET = "d";
    resetConfigForTests();
    expect(blobStoreFromConfig()).toBeInstanceOf(R2BlobStore);
    for (const k of keys) delete process.env[k];
    resetConfigForTests();
  });
});
