/**
 * WHAT IS KNOWN OF EVERY FILE (src/media/store.ts): the memory twin, held to the contract, and the Supabase twin, held to the migration's columns.
 *
 *   - everything is the owner's: another person's id finds, changes, searches and removes nothing
 *   - a file is one row per person per checksum; the same one twice is the first; a `light` read leaves the text out
 *   - setText replaces the chunks; search finds by words; expired() is what has run out and is not kept
 *   - the Supabase twin writes the migration's columns, in batches of 200 chunks, takes back a half-written item, calls media_search with the words
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });
const { MemoryMediaStore, SupabaseMediaStore } = await import("../src/media/store.js");
type NewItem = import("../src/media/store.js").NewItem;

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const T0 = Date.UTC(2026, 9, 27);
const HASH = (c: string): string => c.repeat(64);

const item = (over: Partial<NewItem> = {}): NewItem => ({
  userId: ALICE, sha256: HASH("a"), kind: "pdf", format: "pdf", mime: "application/pdf", name: "policy.pdf", bytes: 1234, text: "Refunds within thirty days.", meta: { pages: 2 },
  blobKey: `u/${ALICE}/${HASH("a")}`, keep: false, expiresAt: T0 + 30 * 86_400_000, ...over,
});
const chunks = [{ seq: 0, text: "Welcome to the handbook.", heading: "Intro", page: 1 }, { seq: 1, text: "Refunds are issued within thirty days.", heading: "Refunds", page: 2 }];

describe("the memory twin", () => {
  it("keeps a file once per person and checksum, and gives the same row back for the same file", async () => {
    const s = new MemoryMediaStore(() => T0);
    const a = await s.put(item(), chunks);
    const again = await s.put(item({ name: "renamed.pdf" }), []);
    expect(again.id).toBe(a.id);
    expect(again.name).toBe("policy.pdf");
    const bob = await s.put(item({ userId: BOB }), chunks);
    expect(bob.id).not.toBe(a.id);
    expect(s.size).toBe(2);
    expect(a).toMatchObject({ chars: 27, createdAt: T0, kind: "pdf" });
  });

  it("finds by checksum or id, and a light read leaves the text out but keeps its length", async () => {
    const s = new MemoryMediaStore();
    const a = await s.put(item(), chunks);
    expect((await s.find(ALICE, HASH("a")))!.text).toBe("Refunds within thirty days.");
    const light = (await s.find(ALICE, HASH("a"), { light: true }))!;
    expect(light.text).toBe("");
    expect(light.chars).toBe(27);
    expect((await s.get(ALICE, a.id, { light: true }))!.text).toBe("");
    expect(await s.find(ALICE, HASH("b"))).toBeNull();
  });

  it("is the owner's: nobody else finds, changes, searches or removes it", async () => {
    const s = new MemoryMediaStore();
    const a = await s.put(item(), chunks);
    expect(await s.find(BOB, HASH("a"))).toBeNull();
    expect(await s.get(BOB, a.id)).toBeNull();
    expect(await s.update(BOB, a.id, { keep: true })).toBeNull();
    expect(await s.setText(BOB, a.id, "x", [])).toBeNull();
    expect(await s.search(BOB, a.id, ["refund"], 5)).toEqual([]);
    expect(await s.chunks(BOB, a.id, 5)).toEqual([]);
    expect(await s.remove(BOB, a.id)).toBeNull();
    expect(await s.list(BOB)).toEqual([]);
    expect(await s.get(ALICE, a.id)).not.toBeNull();
  });

  it("changes what the owner may change", async () => {
    const s = new MemoryMediaStore();
    const a = await s.put(item(), chunks);
    const u = await s.update(ALICE, a.id, { keep: true, expiresAt: T0 + 5, blobKey: null, meta: { pages: 9 } });
    expect(u).toMatchObject({ keep: true, expiresAt: T0 + 5, blobKey: null, meta: { pages: 9 } });
    expect((await s.get(ALICE, a.id))!.sha256).toBe(HASH("a"));
  });

  it("replaces the text and the chunks together", async () => {
    const s = new MemoryMediaStore();
    const a = await s.put(item({ text: "", kind: "image", format: "png" }), []);
    expect(await s.search(ALICE, a.id, ["gate"], 3)).toEqual([]);
    const next = await s.setText(ALICE, a.id, "A farm gate with a sign.", [{ seq: 0, text: "A farm gate with a sign." }], { width: 8 });
    expect(next).toMatchObject({ chars: 24, meta: { width: 8 } });
    expect((await s.search(ALICE, a.id, ["gate"], 3)).map((c) => c.seq)).toEqual([0]);
    expect(await s.chunks(ALICE, a.id, 10)).toEqual([{ seq: 0, text: "A farm gate with a sign." }]);
  });

  it("searches by words, best first, and lists newest first", async () => {
    let t = T0;
    const s = new MemoryMediaStore(() => (t += 1000));
    const a = await s.put(item(), chunks);
    await s.put(item({ sha256: HASH("c"), name: "later.pdf" }), []);
    expect((await s.search(ALICE, a.id, ["refund"], 5)).map((c) => [c.seq, c.heading])).toEqual([[1, "Refunds"]]);
    expect((await s.list(ALICE)).map((i) => i.name)).toEqual(["later.pdf", "policy.pdf"]);
    expect((await s.list(ALICE, 1))).toHaveLength(1);
    expect((await s.list(ALICE))[0]!.text).toBe("");
  });

  it("knows what has run out and is not kept, oldest first, whoever's", async () => {
    const s = new MemoryMediaStore();
    await s.put(item({ sha256: HASH("1"), expiresAt: 100 }), []);
    await s.put(item({ sha256: HASH("2"), expiresAt: 50, userId: BOB }), []);
    await s.put(item({ sha256: HASH("3"), expiresAt: 10, keep: true }), []);
    await s.put(item({ sha256: HASH("4"), expiresAt: 5000 }), []);
    expect((await s.expired(200, 10)).map((i) => i.expiresAt)).toEqual([50, 100]);
    expect(await s.expired(200, 1)).toHaveLength(1);
    expect((await s.forUser(ALICE)).map((i) => i.sha256).sort()).toEqual([HASH("1"), HASH("3"), HASH("4")]);
  });

  it("removes the file and gives back what it was, for its blobs", async () => {
    const s = new MemoryMediaStore();
    const a = await s.put(item(), chunks);
    expect((await s.remove(ALICE, a.id))!.blobKey).toBe(`u/${ALICE}/${HASH("a")}`);
    expect(await s.remove(ALICE, a.id)).toBeNull();
    expect(await s.chunks(ALICE, a.id, 5)).toEqual([]);
  });
});

// ------------------------------------------------------------------ supabase

type Call = [string, unknown[]];
/** A query builder that writes down what it is asked and answers, in order, with `answers` (the last repeats). */
function stub(answers: unknown[]) {
  const log: Call[] = [];
  let n = 0;
  const next = (): unknown => answers[Math.min(n++, answers.length - 1)];
  const q: Record<string, unknown> = {};
  for (const m of ["from", "insert", "update", "delete", "select", "eq", "lte", "gte", "order", "limit", "range", "single", "maybeSingle", "returns"]) q[m] = (...args: unknown[]) => { log.push([m, args]); return q; };
  q.rpc = (...args: unknown[]) => { log.push(["rpc", args]); return q; };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  return { sb: q as never, log, calls: (m: string) => log.filter(([x]) => x === m).map(([, a]) => a) };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "33333333-3333-4333-8333-333333333333", user_id: ALICE, sha256: HASH("a"), kind: "pdf", format: "pdf", mime: "application/pdf", name: "policy.pdf", bytes: "1234",
  text: "Refunds within thirty days.", text_chars: 27, meta: { pages: 2 }, blob_key: "u/x/y", keep: false, expires_at: "2026-11-26T00:00:00.000Z", created_at: "2026-10-27T00:00:00.000Z", ...over,
});
const ok = { error: null };

describe("the Supabase twin", () => {
  it("writes the migration's columns, then the chunks in batches of 200, each with its item and its owner", async () => {
    const t = stub([{ data: row(), error: null }, ok, ok, ok]);
    const many = Array.from({ length: 450 }, (_, i) => ({ seq: i, text: `chunk ${i}`, ...(i === 0 ? { heading: "Intro", page: 1 } : {}) }));
    const made = await new SupabaseMediaStore(t.sb).put(item(), many);
    expect(t.calls("from")).toEqual([["media_items"], ["media_chunks"], ["media_chunks"], ["media_chunks"]]);
    expect(t.calls("insert")[0]![0]).toEqual({
      user_id: ALICE, sha256: HASH("a"), kind: "pdf", format: "pdf", mime: "application/pdf", name: "policy.pdf", bytes: 1234, text: "Refunds within thirty days.", text_chars: 27,
      meta: { pages: 2 }, blob_key: `u/${ALICE}/${HASH("a")}`, keep: false, expires_at: "2026-11-26T00:00:00.000Z",
    });
    const batches = t.calls("insert").slice(1).map((a) => a[0] as Array<Record<string, unknown>>);
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(batches[0]![0]).toEqual({ item_id: row().id, user_id: ALICE, seq: 0, text: "chunk 0", heading: "Intro", page: 1 });
    expect(batches[0]![1]).toEqual({ item_id: row().id, user_id: ALICE, seq: 1, text: "chunk 1", heading: null, page: null });
    expect(made).toMatchObject({ id: row().id, userId: ALICE, bytes: 1234, chars: 27, expiresAt: Date.parse("2026-11-26T00:00:00.000Z"), kind: "pdf" });
  });

  it("takes back an item whose chunks could not be written", async () => {
    const t = stub([{ data: row(), error: null }, { error: { message: "disk full" } }, ok]);
    await expect(new SupabaseMediaStore(t.sb).put(item(), chunks)).rejects.toThrow(/write chunks: disk full/);
    expect(t.calls("delete")).toHaveLength(1);
    expect(t.calls("eq").slice(-2)).toEqual([["id", row().id], ["user_id", ALICE]]);
  });

  it("gives back the first file when the same one arrives twice at once (the unique index says no)", async () => {
    const t = stub([{ data: null, error: { code: "23505", message: "duplicate key" } }, { data: row(), error: null }]);
    const got = await new SupabaseMediaStore(t.sb).put(item(), chunks);
    expect(got.id).toBe(row().id);
    expect(t.calls("insert")).toHaveLength(1);
    expect(t.calls("eq")).toContainEqual(["sha256", HASH("a")]);
  });

  it("reads one file by checksum or id for its owner, with the text only when asked", async () => {
    const t = stub([{ data: row(), error: null }]);
    const s = new SupabaseMediaStore(t.sb);
    await s.find(ALICE, HASH("a"), { light: true });
    expect(String(t.calls("select")[0]![0])).not.toContain("text,");
    expect(String(t.calls("select")[0]![0])).toContain("text_chars");
    expect(t.calls("eq")).toEqual([["user_id", ALICE], ["sha256", HASH("a")]]);
    await s.get(ALICE, row().id);
    expect(String(t.calls("select")[1]![0]).endsWith(",text")).toBe(true);
    expect(t.calls("eq").slice(2)).toEqual([["user_id", ALICE], ["id", row().id]]);
    const before = t.log.length;
    expect(await s.get(ALICE, "not-an-id")).toBeNull();
    expect(t.log.length).toBe(before);
  });

  it("maps a row to an item, whatever the database hands back", async () => {
    const t = stub([{ data: row({ kind: "something-new", bytes: 5e9, meta: null, blob_key: null, text: null, keep: true }), error: null }]);
    const i = (await new SupabaseMediaStore(t.sb).get(ALICE, row().id))!;
    expect(i).toMatchObject({ kind: "unsupported", bytes: 5e9, meta: {}, blobKey: null, text: "", keep: true });
    const none = stub([{ data: null, error: null }]);
    expect(await new SupabaseMediaStore(none.sb).get(ALICE, row().id)).toBeNull();
    const bad = stub([{ data: null, error: { message: "connection reset" } }]);
    await expect(new SupabaseMediaStore(bad.sb).get(ALICE, row().id)).rejects.toThrow(/media store: read: connection reset/);
  });

  it("searches with the person, the file, the words and the limit, and reads the rows back as chunks", async () => {
    const t = stub([{ data: [{ seq: 1, text: "Refunds.", heading: "Refund policy", page: 2, score: 0.23 }, { seq: 4, text: "More.", heading: null, page: null, score: "0.1" }], error: null }]);
    const found = await new SupabaseMediaStore(t.sb).search(ALICE, row().id, ["refund", "days"], 6);
    expect(t.calls("rpc")).toEqual([["media_search", { p_user: ALICE, p_item: row().id, p_terms: ["refund", "days"], p_limit: 6 }]]);
    expect(found).toEqual([{ seq: 1, text: "Refunds.", heading: "Refund policy", page: 2, score: 0.23 }, { seq: 4, text: "More.", score: 0.1 }]);
    const t2 = stub([{ data: [], error: null }]);
    expect(await new SupabaseMediaStore(t2.sb).search(ALICE, row().id, [], 6)).toEqual([]);
    expect(t2.log).toEqual([]);
  });

  it("changes keep, expiry and blob for the owner only, and replaces text and chunks together", async () => {
    const t = stub([{ data: row({ keep: true }), error: null }]);
    const s = new SupabaseMediaStore(t.sb);
    expect((await s.update(ALICE, row().id, { keep: true, expiresAt: Date.UTC(2026, 11, 1), blobKey: null }))!.keep).toBe(true);
    expect(t.calls("update")[0]![0]).toEqual({ keep: true, expires_at: "2026-12-01T00:00:00.000Z", blob_key: null });
    expect(t.calls("eq")).toEqual([["id", row().id], ["user_id", ALICE]]);
    const t2 = stub([{ data: row(), error: null }, ok, { data: row({ text_chars: 5 }), error: null }, ok]);
    const next = await new SupabaseMediaStore(t2.sb).setText(ALICE, row().id, "hello", [{ seq: 0, text: "hello" }], { chunks: 1 });
    expect(next).toMatchObject({ text: "hello", chars: 5 });
    expect(t2.calls("delete")).toHaveLength(1);
    expect(t2.calls("update")[0]![0]).toEqual({ text: "hello", text_chars: 5, meta: { chunks: 1 } });
    expect(t2.calls("insert")[0]![0]).toEqual([{ item_id: row().id, user_id: ALICE, seq: 0, text: "hello", heading: null, page: null }]);
  });

  it("finds what has run out and is not kept, lists a person's files, and removes one", async () => {
    const t = stub([{ data: [row()], error: null }]);
    const s = new SupabaseMediaStore(t.sb);
    expect(await s.expired(Date.UTC(2026, 11, 1), 50)).toHaveLength(1);
    expect(t.calls("eq")).toContainEqual(["keep", false]);
    expect(t.calls("lte")).toEqual([["expires_at", "2026-12-01T00:00:00.000Z"]]);
    expect(t.calls("limit")).toContainEqual([50]);
    await s.list(ALICE, 7);
    expect(t.calls("limit")).toContainEqual([7]);
    const r = stub([{ data: row(), error: null }]);
    expect((await new SupabaseMediaStore(r.sb).remove(ALICE, row().id))!.blobKey).toBe("u/x/y");
    expect(r.calls("eq")).toEqual([["id", row().id], ["user_id", ALICE]]);
  });

  it("lists everything of one person, a page at a time, for deleting an account", async () => {
    const page = Array.from({ length: 1000 }, () => row());
    const t = stub([{ data: page, error: null }, { data: [row()], error: null }]);
    const all = await new SupabaseMediaStore(t.sb).forUser(ALICE);
    expect(all).toHaveLength(1001);
    expect(t.calls("range")).toEqual([[0, 999], [1000, 1999]]);
  });
});

// ------------------------------------------------------------------ the migration

describe("the migration (supabase/migrations/0036_media.sql)", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase");
  const sql = readFileSync(join(root, "migrations", "0036_media.sql"), "utf8");
  const full = readFileSync(join(root, "full_schema.sql"), "utf8");
  const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "media", "store.ts"), "utf8");

  it("has both tables, the generated tsvector with its GIN index, the search function, and owner-only RLS with no write policy", () => {
    expect(sql).toMatch(/create table if not exists public\.media_items/);
    expect(sql).toMatch(/create table if not exists public\.media_chunks/);
    expect(sql).toMatch(/unique \(user_id, sha256\)/);
    expect(sql).toMatch(/tsv\s+tsvector generated always as \(to_tsvector\('simple'/);
    expect(sql).toMatch(/using gin \(tsv\)/);
    expect(sql).toMatch(/create or replace function public\.media_search\(p_user uuid, p_item uuid, p_terms text\[\], p_limit integer/);
    expect(sql).toMatch(/alter table public\.media_items\s+enable row level security/);
    expect(sql).toMatch(/alter table public\.media_chunks enable row level security/);
    expect(sql.match(/create policy/g)).toHaveLength(2);
    expect(sql.match(/for select\s+using \(auth\.uid\(\) = user_id\)/g)).toHaveLength(2);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/i);
    expect(sql).toMatch(/on delete cascade/);
  });

  it("names every column the store writes and reads", () => {
    const columns = ["user_id", "sha256", "kind", "format", "mime", "name", "bytes", "text", "text_chars", "meta", "blob_key", "keep", "expires_at", "created_at", "item_id", "seq", "heading", "page"];
    for (const c of columns) {
      expect(sql, c).toMatch(new RegExp(`\\b${c}\\b`));
      expect(code, c).toMatch(new RegExp(`\\b${c}\\b`));
    }
    for (const k of ["image", "pdf", "document", "presentation", "spreadsheet", "data", "text", "code", "audio", "video", "archive"]) expect(sql, k).toContain(`'${k}'`);
  });

  it("is in full_schema.sql too, whole", () => {
    expect(full).toContain("-- 0036_media.sql");
    expect(full).toContain(sql.trim().split("\n").slice(-4).join("\n"));
    expect(full).toContain("create or replace function public.media_search");
  });
});
