/**
 * WHAT IS KNOWN OF EVERY FILE: media_items (the file, its text and what we know of it) AND media_chunks (the text in searchable pieces).
 *
 * One row per person per file (unique on user_id and the file's SHA-256), so a file is read once: the second time the same bytes arrive,
 * their text is already here. media_chunks carries a generated `tsvector` with a GIN index; the `media_search` function (migration 0035)
 * turns the words of a question into a query over it. Written by the server with the service key only; a person's own token can read their
 * own rows (owner-only RLS).
 *
 * The memory twin is what tests and a server with no Supabase use. It finds chunks with chunk.ts findChunks, the same idea as the database.
 *
 * A `light` read leaves the text out (`text` is "", `chars` is right): the hot path (a question about a file already read) needs the
 * metadata and the few chunks the search returns, never the whole 400,000 characters.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabase } from "../auth/supabase.js";
import { findChunks } from "./chunk.js";
import { MEDIA_KINDS, type Chunk, type FoundChunk, type MediaItem, type MediaKind, type MediaMeta } from "./types.js";

export interface NewItem {
  userId: string;
  sha256: string;
  kind: MediaKind;
  format: string;
  mime: string;
  name: string;
  bytes: number;
  text: string;
  meta: MediaMeta;
  blobKey: string | null;
  keep: boolean;
  expiresAt: number;
}

export interface MediaStore {
  find(userId: string, sha256: string, o?: { light?: boolean }): Promise<MediaItem | null>;
  get(userId: string, id: string, o?: { light?: boolean }): Promise<MediaItem | null>;
  /** The person's files, newest first, without their text. */
  list(userId: string, limit?: number): Promise<MediaItem[]>;
  /** Stores a new item with its chunks. The same (person, file) twice is the first one, returned. */
  put(item: NewItem, chunks: readonly Chunk[]): Promise<MediaItem>;
  /** Keeps or lets go, moves the expiry, notes the blob. Null when it is not the person's. */
  update(userId: string, id: string, patch: Partial<Pick<MediaItem, "keep" | "expiresAt" | "blobKey">> & { meta?: MediaMeta }): Promise<MediaItem | null>;
  /** Replaces the text and its chunks (a picture described, a video's frames read). */
  setText(userId: string, id: string, text: string, chunks: readonly Chunk[], meta?: MediaMeta): Promise<MediaItem | null>;
  /** Removes it and returns what it was (for its blobs). Null when it is not the person's. */
  remove(userId: string, id: string): Promise<MediaItem | null>;
  /** The chunks of one file closest to the words, best first. */
  search(userId: string, id: string, terms: readonly string[], limit: number): Promise<FoundChunk[]>;
  /** Every chunk of a file in order (the whole text, in pieces), at most `limit`. */
  chunks(userId: string, id: string, limit: number): Promise<Chunk[]>;
  /** Items past their expiry that are not kept, whoever's, oldest first. */
  expired(now: number, limit: number): Promise<MediaItem[]>;
  /** All of a person's items, without text: for deleting an account. */
  forUser(userId: string): Promise<MediaItem[]>;
}

const light = (i: MediaItem): MediaItem => ({ ...i, text: "" });

// -------------------------------------------------------------------- memory

export class MemoryMediaStore implements MediaStore {
  private readonly items = new Map<string, MediaItem>();
  private readonly chunkRows = new Map<string, Chunk[]>();

  constructor(private readonly now: () => number = Date.now) {}

  async find(userId: string, sha256: string, o: { light?: boolean } = {}): Promise<MediaItem | null> {
    for (const i of this.items.values()) if (i.userId === userId && i.sha256 === sha256) return o.light ? light(i) : { ...i };
    return null;
  }

  async get(userId: string, id: string, o: { light?: boolean } = {}): Promise<MediaItem | null> {
    const i = this.items.get(id);
    return i && i.userId === userId ? (o.light ? light(i) : { ...i }) : null;
  }

  async list(userId: string, limit = 50): Promise<MediaItem[]> {
    return [...this.items.values()].filter((i) => i.userId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(light);
  }

  async put(item: NewItem, chunks: readonly Chunk[]): Promise<MediaItem> {
    const had = await this.find(item.userId, item.sha256);
    if (had) return had;
    const row: MediaItem = { ...item, id: randomUUID(), chars: item.text.length, createdAt: this.now() };
    this.items.set(row.id, row);
    this.chunkRows.set(row.id, chunks.map((c) => ({ ...c })));
    return { ...row };
  }

  async update(userId: string, id: string, patch: Partial<Pick<MediaItem, "keep" | "expiresAt" | "blobKey">> & { meta?: MediaMeta }): Promise<MediaItem | null> {
    const i = this.items.get(id);
    if (!i || i.userId !== userId) return null;
    if (patch.keep !== undefined) i.keep = patch.keep;
    if (patch.expiresAt !== undefined) i.expiresAt = patch.expiresAt;
    if (patch.blobKey !== undefined) i.blobKey = patch.blobKey;
    if (patch.meta !== undefined) i.meta = patch.meta;
    return { ...i };
  }

  async setText(userId: string, id: string, text: string, chunks: readonly Chunk[], meta?: MediaMeta): Promise<MediaItem | null> {
    const i = this.items.get(id);
    if (!i || i.userId !== userId) return null;
    i.text = text;
    i.chars = text.length;
    if (meta) i.meta = meta;
    this.chunkRows.set(id, chunks.map((c) => ({ ...c })));
    return { ...i };
  }

  async remove(userId: string, id: string): Promise<MediaItem | null> {
    const i = this.items.get(id);
    if (!i || i.userId !== userId) return null;
    this.items.delete(id);
    this.chunkRows.delete(id);
    return { ...i };
  }

  async search(userId: string, id: string, terms: readonly string[], limit: number): Promise<FoundChunk[]> {
    const i = this.items.get(id);
    if (!i || i.userId !== userId) return [];
    return findChunks(this.chunkRows.get(id) ?? [], terms, limit);
  }

  async chunks(userId: string, id: string, limit: number): Promise<Chunk[]> {
    const i = this.items.get(id);
    if (!i || i.userId !== userId) return [];
    return (this.chunkRows.get(id) ?? []).slice(0, limit).map((c) => ({ ...c }));
  }

  async expired(now: number = this.now(), limit = 100): Promise<MediaItem[]> {
    return [...this.items.values()].filter((i) => !i.keep && i.expiresAt <= now).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, limit).map(light);
  }

  async forUser(userId: string): Promise<MediaItem[]> {
    return [...this.items.values()].filter((i) => i.userId === userId).map(light);
  }

  /** For tests: how many items there are. */
  get size(): number { return this.items.size; }
}

// ------------------------------------------------------------------ supabase

interface ItemRow {
  id: string; user_id: string; sha256: string; kind: string; format: string; mime: string; name: string; bytes: number | string; text?: string | null;
  text_chars: number; meta: MediaMeta | null; blob_key: string | null; keep: boolean; expires_at: string; created_at: string;
}

const LIGHT_COLUMNS = "id,user_id,sha256,kind,format,mime,name,bytes,text_chars,meta,blob_key,keep,expires_at,created_at";
const CHUNK_BATCH = 200;

const rowOf = (r: ItemRow): MediaItem => ({
  id: r.id, userId: r.user_id, sha256: r.sha256, kind: (MEDIA_KINDS as readonly string[]).includes(r.kind) ? (r.kind as MediaKind) : "unsupported",
  format: r.format, mime: r.mime, name: r.name, bytes: Number(r.bytes) || 0, text: r.text ?? "", chars: Number(r.text_chars) || 0, meta: r.meta ?? {},
  blobKey: r.blob_key, keep: r.keep === true, expiresAt: Date.parse(r.expires_at) || 0, createdAt: Date.parse(r.created_at) || 0,
});

export class SupabaseMediaStore implements MediaStore {
  constructor(private readonly sb: SupabaseClient) {}

  private fail(what: string, error: { message: string }): never { throw new Error(`media store: ${what}: ${error.message}`); }

  private async one(userId: string, column: "id" | "sha256", value: string, o: { light?: boolean }): Promise<MediaItem | null> {
    const { data, error } = await this.sb.from("media_items").select(o.light ? LIGHT_COLUMNS : `${LIGHT_COLUMNS},text`).eq("user_id", userId).eq(column, value).maybeSingle<ItemRow>();
    if (error) this.fail("read", error);
    return data ? rowOf(data) : null;
  }

  find(userId: string, sha256: string, o: { light?: boolean } = {}): Promise<MediaItem | null> { return this.one(userId, "sha256", sha256, o); }
  get(userId: string, id: string, o: { light?: boolean } = {}): Promise<MediaItem | null> { return /^[0-9a-f-]{36}$/i.test(id) ? this.one(userId, "id", id, o) : Promise.resolve(null); }

  async list(userId: string, limit = 50): Promise<MediaItem[]> {
    const { data, error } = await this.sb.from("media_items").select(LIGHT_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit).returns<ItemRow[]>();
    if (error) this.fail("list", error);
    return (data ?? []).map(rowOf);
  }

  private async insertChunks(item: MediaItem, chunks: readonly Chunk[]): Promise<void> {
    for (let at = 0; at < chunks.length; at += CHUNK_BATCH) {
      const rows = chunks.slice(at, at + CHUNK_BATCH).map((c) => ({ item_id: item.id, user_id: item.userId, seq: c.seq, text: c.text, heading: c.heading ?? null, page: c.page ?? null }));
      const { error } = await this.sb.from("media_chunks").insert(rows);
      if (error) this.fail("write chunks", error);
    }
  }

  async put(item: NewItem, chunks: readonly Chunk[]): Promise<MediaItem> {
    const { data, error } = await this.sb.from("media_items").insert({
      user_id: item.userId, sha256: item.sha256, kind: item.kind, format: item.format, mime: item.mime, name: item.name, bytes: item.bytes, text: item.text,
      text_chars: item.text.length, meta: item.meta, blob_key: item.blobKey, keep: item.keep, expires_at: new Date(item.expiresAt).toISOString(),
    }).select(`${LIGHT_COLUMNS},text`).single<ItemRow>();
    if (error) {
      // The same file arrived twice at once: the second is the first.
      if ((error as { code?: string }).code === "23505") {
        const had = await this.find(item.userId, item.sha256);
        if (had) return had;
      }
      this.fail("write", error);
    }
    const row = rowOf(data!);
    try {
      await this.insertChunks(row, chunks);
    } catch (err) {
      await this.sb.from("media_items").delete().eq("id", row.id).eq("user_id", item.userId);
      throw err;
    }
    return row;
  }

  async update(userId: string, id: string, patch: Partial<Pick<MediaItem, "keep" | "expiresAt" | "blobKey">> & { meta?: MediaMeta }): Promise<MediaItem | null> {
    const set: Record<string, unknown> = {};
    if (patch.keep !== undefined) set.keep = patch.keep;
    if (patch.expiresAt !== undefined) set.expires_at = new Date(patch.expiresAt).toISOString();
    if (patch.blobKey !== undefined) set.blob_key = patch.blobKey;
    if (patch.meta !== undefined) set.meta = patch.meta;
    if (!Object.keys(set).length) return this.get(userId, id, { light: true });
    const { data, error } = await this.sb.from("media_items").update(set).eq("id", id).eq("user_id", userId).select(LIGHT_COLUMNS).maybeSingle<ItemRow>();
    if (error) this.fail("update", error);
    return data ? rowOf(data) : null;
  }

  async setText(userId: string, id: string, text: string, chunks: readonly Chunk[], meta?: MediaMeta): Promise<MediaItem | null> {
    const had = await this.get(userId, id, { light: true });
    if (!had) return null;
    const { error: e1 } = await this.sb.from("media_chunks").delete().eq("item_id", id).eq("user_id", userId);
    if (e1) this.fail("replace chunks", e1);
    const { data, error } = await this.sb.from("media_items").update({ text, text_chars: text.length, ...(meta ? { meta } : {}) }).eq("id", id).eq("user_id", userId)
      .select(LIGHT_COLUMNS).maybeSingle<ItemRow>();
    if (error) this.fail("update", error);
    if (!data) return null;
    const row = rowOf(data);
    await this.insertChunks(row, chunks);
    return { ...row, text, chars: text.length };
  }

  async remove(userId: string, id: string): Promise<MediaItem | null> {
    const { data, error } = await this.sb.from("media_items").delete().eq("id", id).eq("user_id", userId).select(LIGHT_COLUMNS).maybeSingle<ItemRow>();
    if (error) this.fail("delete", error);
    return data ? rowOf(data) : null;
  }

  async search(userId: string, id: string, terms: readonly string[], limit: number): Promise<FoundChunk[]> {
    if (!terms.length) return [];
    const { data, error } = await this.sb.rpc("media_search", { p_user: userId, p_item: id, p_terms: [...terms], p_limit: limit });
    if (error) this.fail("search", error);
    return ((data ?? []) as Array<{ seq: number; text: string; heading: string | null; page: number | null; score: number }>).map((r) => ({
      seq: r.seq, text: r.text, score: Number(r.score) || 0, ...(r.heading ? { heading: r.heading } : {}), ...(r.page !== null && r.page !== undefined ? { page: r.page } : {}),
    }));
  }

  async chunks(userId: string, id: string, limit: number): Promise<Chunk[]> {
    const { data, error } = await this.sb.from("media_chunks").select("seq,text,heading,page").eq("item_id", id).eq("user_id", userId).order("seq").limit(limit)
      .returns<Array<{ seq: number; text: string; heading: string | null; page: number | null }>>();
    if (error) this.fail("read chunks", error);
    return (data ?? []).map((r) => ({ seq: r.seq, text: r.text, ...(r.heading ? { heading: r.heading } : {}), ...(r.page !== null ? { page: r.page } : {}) }));
  }

  async expired(now: number, limit: number): Promise<MediaItem[]> {
    const { data, error } = await this.sb.from("media_items").select(LIGHT_COLUMNS).eq("keep", false).lte("expires_at", new Date(now).toISOString())
      .order("expires_at").limit(limit).returns<ItemRow[]>();
    if (error) this.fail("expired", error);
    return (data ?? []).map(rowOf);
  }

  async forUser(userId: string): Promise<MediaItem[]> {
    const out: MediaItem[] = [];
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await this.sb.from("media_items").select(LIGHT_COLUMNS).eq("user_id", userId).order("created_at").range(from, from + 999).returns<ItemRow[]>();
      if (error) this.fail("list", error);
      out.push(...(data ?? []).map(rowOf));
      if ((data?.length ?? 0) < 1000) break;
    }
    return out;
  }
}

// ------------------------------------------------------------------ the one

let current: MediaStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function mediaStore(): MediaStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseMediaStore(sb) : new MemoryMediaStore();
  }
  return current;
}

export function resetMediaStoreForTests(): void { current = null; }
