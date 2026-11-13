/**
 * CALLS' ROWS (migration 0090_rooms.sql): one row a room. Its link's code is kept twice: hashed, to find the room by a link, and sealed, so its
 * host can see and share the link again (rooms/link.ts). Who is in it now and every time people were in it are on the row, from LiveKit's
 * webhook; who waits in the lobby is not (rooms/lobby.ts, in memory: a knock lasts minutes).
 *
 * The server's alone (no policy lets a token read or write them); they go with the account. The memory twin is what tests and a server with
 * no Supabase use; it is bounded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { PersonView, RoomStatus } from "./types.js";

/** One stretch of time people were in the room: from the first in to the last out (end null while it goes on). */
export interface Session { start: number; end: number | null }
/** A room keeps its last this many sessions (the minutes of older ones stay in `minutes`). */
export const SESSIONS_MAX = 50;

export interface Room {
  id: string;
  userId: string;
  codeHash: string;
  codeEnc: string;
  businessId: string | null;
  host: string;
  title: string;
  lobby: boolean;
  status: RoomStatus;
  people: PersonView[];
  sessions: Session[];
  /** Minutes of sessions that ended and fell off `sessions`. */
  pastMinutes: number;
  createdAt: number;
  updatedAt: number;
  endedAt: number | null;
}

export type RoomPatch = Partial<Pick<Room, "title" | "lobby" | "status" | "people" | "sessions" | "pastMinutes" | "endedAt">>;

export interface RoomStore {
  add(r: Room): Promise<void>;
  get(id: string): Promise<Room | null>;
  byCodeHash(hash: string): Promise<Room | null>;
  update(id: string, patch: RoomPatch): Promise<Room | null>;
  /** Newest first; with businessId, only that business's. */
  list(userId: string, o?: { businessId?: string; limit?: number }): Promise<Room[]>;
  /** Every room someone is in now (the tick's). */
  live(): Promise<Room[]>;
  /** Rooms not ended whose last change is older than this. */
  stale(beforeMs: number): Promise<Room[]>;
}

const MEMORY_MAX = 5_000;
const copy = (r: Room): Room => ({ ...r, people: r.people.map((p) => ({ ...p })), sessions: r.sessions.map((s) => ({ ...s })) });

export class MemoryRoomStore implements RoomStore {
  private readonly rows = new Map<string, Room>();

  constructor(private readonly now: () => number = Date.now) {}

  async add(r: Room): Promise<void> {
    if ([...this.rows.values()].some((x) => x.codeHash === r.codeHash)) throw new Error("room code taken");
    this.rows.set(r.id, copy(r));
    while (this.rows.size > MEMORY_MAX) this.rows.delete(this.rows.keys().next().value!);
  }
  async get(id: string): Promise<Room | null> { const r = this.rows.get(id); return r ? copy(r) : null; }
  async byCodeHash(hash: string): Promise<Room | null> { const r = [...this.rows.values()].find((x) => x.codeHash === hash); return r ? copy(r) : null; }
  async update(id: string, patch: RoomPatch): Promise<Room | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    const next = { ...r, ...patch, updatedAt: this.now() };
    this.rows.set(id, copy(next));
    return copy(next);
  }
  async list(userId: string, o: { businessId?: string; limit?: number } = {}): Promise<Room[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId && (o.businessId === undefined || r.businessId === o.businessId))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, o.limit ?? 50).map(copy);
  }
  async live(): Promise<Room[]> { return [...this.rows.values()].filter((r) => r.status === "live").map(copy); }
  async stale(beforeMs: number): Promise<Room[]> { return [...this.rows.values()].filter((r) => r.status !== "ended" && r.updatedAt < beforeMs).map(copy); }
}

interface Row {
  id: string; user_id: string; code_hash: string; code_enc: string; business_id: string | null; host: string; title: string; lobby: boolean;
  status: RoomStatus; people: PersonView[] | null; sessions: Session[] | null; past_minutes: number | null; created_at: string; updated_at: string;
  ended_at: string | null;
}

const ms = (s: string | null): number | null => (s ? Date.parse(s) || null : null);
const iso = (n: number | null | undefined): string | null => (n ? new Date(n).toISOString() : null);

function fromRow(r: Row): Room {
  return {
    id: r.id, userId: r.user_id, codeHash: r.code_hash, codeEnc: r.code_enc, businessId: r.business_id, host: r.host ?? "", title: r.title ?? "",
    lobby: r.lobby !== false, status: r.status, people: Array.isArray(r.people) ? r.people : [], sessions: Array.isArray(r.sessions) ? r.sessions : [],
    pastMinutes: Number(r.past_minutes) || 0, createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0, endedAt: ms(r.ended_at),
  };
}

function toRow(p: RoomPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.title !== undefined) out.title = p.title;
  if (p.lobby !== undefined) out.lobby = p.lobby;
  if (p.status !== undefined) out.status = p.status;
  if (p.people !== undefined) out.people = p.people;
  if (p.sessions !== undefined) out.sessions = p.sessions;
  if (p.pastMinutes !== undefined) out.past_minutes = p.pastMinutes;
  if (p.endedAt !== undefined) out.ended_at = iso(p.endedAt);
  return out;
}

export class SupabaseRoomStore implements RoomStore {
  constructor(private readonly db: SupabaseClient) {}

  async add(r: Room): Promise<void> {
    const { error } = await this.db.from("rooms").insert({
      id: r.id, user_id: r.userId, code_hash: r.codeHash, code_enc: r.codeEnc, business_id: r.businessId, host: r.host,
      ...toRow(r), created_at: iso(r.createdAt), updated_at: iso(r.updatedAt),
    });
    if (error) throw new Error(error.code === "23505" ? "room code taken" : "rooms insert failed");
  }
  private async one(col: string, value: string): Promise<Room | null> {
    const { data, error } = await this.db.from("rooms").select("*").eq(col, value).maybeSingle();
    if (error) throw new Error("rooms read failed");
    return data ? fromRow(data as Row) : null;
  }
  get(id: string) { return this.one("id", id); }
  byCodeHash(hash: string) { return this.one("code_hash", hash); }
  async update(id: string, patch: RoomPatch): Promise<Room | null> {
    const { data, error } = await this.db.from("rooms").update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error("rooms update failed");
    return data ? fromRow(data as Row) : null;
  }
  async list(userId: string, o: { businessId?: string; limit?: number } = {}): Promise<Room[]> {
    let q = this.db.from("rooms").select("*").eq("user_id", userId);
    if (o.businessId !== undefined) q = q.eq("business_id", o.businessId);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(Math.min(200, o.limit ?? 50));
    if (error) throw new Error("rooms list failed");
    return (data as Row[]).map(fromRow);
  }
  async live(): Promise<Room[]> {
    const { data, error } = await this.db.from("rooms").select("*").eq("status", "live").limit(1000);
    if (error) throw new Error("rooms read failed");
    return (data as Row[]).map(fromRow);
  }
  async stale(beforeMs: number): Promise<Room[]> {
    const { data, error } = await this.db.from("rooms").select("*").neq("status", "ended").lt("updated_at", new Date(beforeMs).toISOString()).limit(500);
    if (error) throw new Error("rooms read failed");
    return (data as Row[]).map(fromRow);
  }
}

let shared: RoomStore | null = null;

/** The server's: Supabase when it is set up, else the memory twin. */
export function roomStore(): RoomStore {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseRoomStore(db) : new MemoryRoomStore();
  }
  return shared;
}
