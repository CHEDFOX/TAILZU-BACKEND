/**
 * WHERE A PERSON'S 3D CREATIONS ARE KEPT (migration 0104). Supabase when it is set up, else memory (tests, and a dev server with no
 * database: a restart forgets them).
 *
 * A CREATION, NOT A JOB. The loop (make.ts) runs for a minute or two and is gone; what a person comes back to is the thing it made,
 * and the version of it they are on. So a row is `(creation, version)`, unique per person, and the blobs it names live under
 * `c/<person>/<creation>/v<n>/` (ports.ts creationKey) — a version never writes over the one before it, and the script alone is enough
 * to make everything else again.
 *
 * The script, preview, full render and .blend are blobs (media/blob.ts); these rows only name them. Nothing here is logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";

/** Which of the four files a round kept, by name. */
export interface KeptKeys {
  script?: string;
  preview?: string;
  final?: string;
  blend?: string;
}

export interface SceneRecord {
  id: string;
  ownerId: string;
  /** The creation these versions belong to: the key its blobs sit under. */
  creation: string;
  version: number;
  ask: string;
  status: "working" | "done" | "failed";
  /** Made.why, once the loop has stopped. */
  why: "done" | "rounds" | "budget" | "render" | "model" | null;
  rounds: number;
  objects: number;
  kept: KeptKeys;
  mime: string | null;
  paise: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SceneStore {
  create(r: SceneRecord): Promise<void>;
  get(userId: string, id: string): Promise<SceneRecord | null>;
  save(r: SceneRecord): Promise<void>;
  list(userId: string, limit: number): Promise<SceneRecord[]>;
  /** The newest version of one creation, for a change to something already made. */
  latest(userId: string, creation: string): Promise<SceneRecord | null>;
  /** Still 'working' when the server came up: nothing is running any more, so they are failed honestly. */
  stranded(limit: number): Promise<SceneRecord[]>;
  forAccountDelete(userId: string): Promise<void>;
}

interface Row {
  id: string;
  user_id: string;
  creation: string;
  version: number;
  ask: string;
  status: string;
  why: string | null;
  rounds: number;
  objects: number;
  kept: KeptKeys;
  mime: string | null;
  paise: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const toRow = (r: SceneRecord): Row => ({
  id: r.id, user_id: r.ownerId, creation: r.creation, version: r.version, ask: r.ask, status: r.status,
  why: r.why, rounds: r.rounds, objects: r.objects, kept: r.kept, mime: r.mime, paise: r.paise, error: r.error,
  created_at: new Date(r.createdAt).toISOString(), updated_at: new Date(r.updatedAt).toISOString(),
});

const fromRow = (d: Row): SceneRecord => ({
  id: d.id, ownerId: d.user_id, creation: d.creation, version: Number(d.version) || 1, ask: d.ask,
  status: (d.status as SceneRecord["status"]) ?? "failed",
  why: (d.why as SceneRecord["why"]) ?? null,
  rounds: Number(d.rounds) || 0, objects: Number(d.objects) || 0,
  kept: d.kept ?? {}, mime: d.mime ?? null, paise: Number(d.paise) || 0, error: d.error ?? null,
  createdAt: Date.parse(d.created_at) || 0, updatedAt: Date.parse(d.updated_at) || 0,
});

export class MemorySceneStore implements SceneStore {
  private readonly rows = new Map<string, SceneRecord>();

  async create(r: SceneRecord): Promise<void> { this.rows.set(r.id, { ...r, kept: { ...r.kept } }); }
  async get(userId: string, id: string): Promise<SceneRecord | null> {
    const r = this.rows.get(id);
    return r && r.ownerId === userId ? { ...r, kept: { ...r.kept } } : null;
  }
  async save(r: SceneRecord): Promise<void> { if (this.rows.has(r.id)) this.rows.set(r.id, { ...r, kept: { ...r.kept } }); }
  async list(userId: string, limit: number): Promise<SceneRecord[]> {
    return [...this.rows.values()].filter((r) => r.ownerId === userId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.min(100, limit));
  }
  async latest(userId: string, creation: string): Promise<SceneRecord | null> {
    const mine = [...this.rows.values()].filter((r) => r.ownerId === userId && r.creation === creation).sort((a, b) => b.version - a.version);
    return mine[0] ? { ...mine[0], kept: { ...mine[0].kept } } : null;
  }
  async stranded(limit: number): Promise<SceneRecord[]> {
    return [...this.rows.values()].filter((r) => r.status === "working").slice(0, limit);
  }
  async forAccountDelete(userId: string): Promise<void> {
    for (const [id, r] of this.rows) if (r.ownerId === userId) this.rows.delete(id);
  }
}

export class SupabaseSceneStore implements SceneStore {
  constructor(private readonly db: SupabaseClient) {}

  async create(r: SceneRecord): Promise<void> {
    const { error } = await this.db.from("cinema_scenes").insert(toRow(r));
    if (error) throw new Error("cinema_scenes insert failed");
  }
  async get(userId: string, id: string): Promise<SceneRecord | null> {
    const { data, error } = await this.db.from("cinema_scenes").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) throw new Error("cinema_scenes read failed");
    return data ? fromRow(data as Row) : null;
  }
  async save(r: SceneRecord): Promise<void> {
    const { id, user_id, created_at, ...rest } = toRow(r);
    void created_at;
    const { error } = await this.db.from("cinema_scenes").update(rest).eq("id", id).eq("user_id", user_id);
    if (error) throw new Error("cinema_scenes update failed");
  }
  async list(userId: string, limit: number): Promise<SceneRecord[]> {
    const { data, error } = await this.db.from("cinema_scenes").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(Math.min(100, limit));
    if (error) throw new Error("cinema_scenes list failed");
    return (data as Row[]).map(fromRow);
  }
  async latest(userId: string, creation: string): Promise<SceneRecord | null> {
    const { data, error } = await this.db.from("cinema_scenes").select("*").eq("user_id", userId).eq("creation", creation).order("version", { ascending: false }).limit(1);
    if (error) throw new Error("cinema_scenes latest failed");
    const row = (data as Row[])[0];
    return row ? fromRow(row) : null;
  }
  async stranded(limit: number): Promise<SceneRecord[]> {
    const { data, error } = await this.db.from("cinema_scenes").select("*").eq("status", "working").order("updated_at", { ascending: true }).limit(Math.min(500, limit));
    if (error) throw new Error("cinema_scenes stranded failed");
    return (data as Row[]).map(fromRow);
  }
  async forAccountDelete(userId: string): Promise<void> {
    const { error } = await this.db.from("cinema_scenes").delete().eq("user_id", userId);
    if (error) throw new Error("cinema_scenes delete failed");
  }
}

let shared: SceneStore | null = null;

export function sceneStore(): SceneStore {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseSceneStore(db) : new MemorySceneStore();
  }
  return shared;
}
