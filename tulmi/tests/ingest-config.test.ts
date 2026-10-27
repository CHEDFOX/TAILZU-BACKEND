/**
 * THE SWITCH AND THE SETTINGS OF MEDIA AND FILES INGESTION (src/config.ts, src/media/index.ts).
 *
 *   - off unless MEDIA_INGEST=true; the defaults; every new key is one the test setup clears (ENV_KEYS)
 *   - half-set bucket and worker settings are said at start, not found out at the first upload
 *   - the bucket is used only with a database to remember what is in it
 *   - the sweep deletes what has run out, on a timer
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { getConfig, resetConfigForTests, ENV_KEYS } = await import("../src/config.js");
const { createMedia, startMediaSweep, MemoryBlobStore, MemoryMediaStore, MediaService, R2BlobStore } = await import("../src/media/index.js");

const KEYS = ["MEDIA_INGEST", "MEDIA_WORKER_URL", "MEDIA_WORKER_SECRET", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "MEDIA_KEEP_DAYS"];
afterEach(() => { for (const k of KEYS) delete process.env[k]; resetConfigForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });
const set = (o: Record<string, string>) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, o); resetConfigForTests(); };

describe("the switch", () => {
  it("is off by default, with a thirty day keep, and every key is one the suite clears", () => {
    set({});
    expect(getConfig()).toMatchObject({ MEDIA_INGEST: false, MEDIA_KEEP_DAYS: 30 });
    expect(createMedia()).toBeNull();
    for (const k of KEYS) expect(ENV_KEYS, k).toContain(k);
  });

  it("is on with MEDIA_INGEST=true, or made anyway for a test", () => {
    set({ MEDIA_INGEST: "true", MEDIA_KEEP_DAYS: "7" });
    expect(getConfig()).toMatchObject({ MEDIA_INGEST: true, MEDIA_KEEP_DAYS: 7 });
    expect(createMedia()).toBeInstanceOf(MediaService);
    set({});
    expect(createMedia({ force: true })).toBeInstanceOf(MediaService);
  });

  it("holds the days to a sane range", () => {
    set({ MEDIA_KEEP_DAYS: "0" });
    expect(() => getConfig()).toThrow(/MEDIA_KEEP_DAYS/);
    set({ MEDIA_KEEP_DAYS: "99999" });
    expect(() => getConfig()).toThrow(/MEDIA_KEEP_DAYS/);
  });
});

describe("half-set settings are said at start", () => {
  const said = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

  it("a bucket with a missing key, a worker with no secret, a secret that is short", () => {
    const warn = said();
    set({ MEDIA_INGEST: "true", R2_ACCOUNT_ID: "a", R2_BUCKET: "b" });
    getConfig();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are not all set/);
    warn.mockClear();
    set({ MEDIA_INGEST: "true", MEDIA_WORKER_URL: "http://media-worker:8000" });
    getConfig();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/MEDIA_WORKER_URL and MEDIA_WORKER_SECRET go together/);
    warn.mockClear();
    set({ MEDIA_INGEST: "true", MEDIA_WORKER_URL: "http://media-worker:8000", MEDIA_WORKER_SECRET: "short" });
    getConfig();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/MEDIA_WORKER_SECRET is under 32 characters/);
  });

  it("says nothing when it is off, or when nothing is half set", () => {
    const warn = said();
    set({ R2_ACCOUNT_ID: "a" });
    getConfig();
    set({ MEDIA_INGEST: "true", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", MEDIA_WORKER_URL: "http://w:8000", MEDIA_WORKER_SECRET: "x".repeat(40) });
    getConfig();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the bucket needs a database to be of use", () => {
  it("is not used with an index in memory, and the server says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    set({ MEDIA_INGEST: "true", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" });
    const m = createMedia({ store: new MemoryMediaStore() })!;
    expect(m.blobs).toBeNull();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/NOT kept/);
  });

  it("is used when it is given outright, as a test or a different store does", () => {
    set({ MEDIA_INGEST: "true", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" });
    const blobs = new MemoryBlobStore();
    expect(createMedia({ store: new MemoryMediaStore(), blobs })!.blobs).toBe(blobs);
    expect(createMedia({ store: new MemoryMediaStore(), blobs: null })!.blobs).toBeNull();
    expect(createMedia({ store: new MemoryMediaStore(), blobs: new R2BlobStore({ accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "d" }) })!.blobs).toBeInstanceOf(R2BlobStore);
  });
});

describe("the sweep", () => {
  it("runs on a timer, deletes what has run out, and can be stopped", async () => {
    vi.useFakeTimers();
    const clock = { t: Date.UTC(2026, 9, 27) };
    const store = new MemoryMediaStore(() => clock.t);
    const blobs = new MemoryBlobStore();
    const media = new MediaService({ store, blobs, now: () => clock.t });
    await media.ingest("u1", { name: "a.txt", data: Buffer.from("one\ntwo\n") });
    expect(blobs.objects.size).toBe(1);
    const stop = startMediaSweep(media, { everyMs: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.size).toBe(1);
    clock.t += 31 * 24 * 60 * 60 * 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.size).toBe(0);
    expect(blobs.objects.size).toBe(0);
    stop();
    await media.ingest("u1", { name: "b.txt", data: Buffer.from("three\nfour\n") });
    clock.t += 31 * 24 * 60 * 60 * 1000;
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.size).toBe(1);
  });

  it("a sweep that fails is a warning, not a crash", async () => {
    vi.useFakeTimers();
    const media = new MediaService({ store: new MemoryMediaStore() });
    media.sweep = async () => { throw new Error("db down"); };
    const warn = vi.fn();
    const stop = startMediaSweep(media, { everyMs: 1000, log: { warn } });
    await vi.advanceTimersByTimeAsync(1500);
    expect(warn).toHaveBeenCalledWith({ error: "Error" }, "media: sweep failed");
    stop();
  });
});
