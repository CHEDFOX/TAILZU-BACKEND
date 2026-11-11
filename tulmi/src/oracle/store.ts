/**
 * WHAT THE ORACLE KEEPS OF A PERSON: WHEN AND WHERE THEY WERE BORN, AND THE ROUTE THEIR LAST QUESTION TOOK.
 *
 *   oracle_people   one row a person (migration 0078): `sky` (the date, the local time, the place and its coordinates, whether the time is known) and
 *                   `last_route` (what the oracle's router decided last turn, sent back so a follow-up on the same subject is read the same way)
 *
 * The person's own: they can only READ their row (owner-only RLS), the server writes with the service key, and it goes with the account and with
 * "delete my data". The memory twin is what tests and a server with no Supabase use; it is bounded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { Sky } from "./birth.js";

export interface OracleRow {
  sky: Sky | null;
  route: unknown;
  updatedAt: number;
}

export interface OracleStore {
  get(userId: string): Promise<OracleRow | null>;
  setSky(userId: string, sky: Sky | null, now: number): Promise<void>;
  setRoute(userId: string, route: unknown, now: number): Promise<void>;
  forget(userId: string): Promise<void>;
}

/** The table a person's account owns, for deleting an account and their data. */
export const ORACLE_USER_TABLES = ["oracle_people"] as const;

const MEMORY_MAX = 20_000;

export class MemoryOracleStore implements OracleStore {
  private readonly rows = new Map<string, OracleRow>();

  async get(userId: string): Promise<OracleRow | null> {
    const r = this.rows.get(userId);
    return r ? { ...r } : null;
  }

  private put(userId: string, patch: Partial<OracleRow>, now: number): void {
    const cur = this.rows.get(userId) ?? { sky: null, route: null, updatedAt: now };
    this.rows.delete(userId);
    this.rows.set(userId, { ...cur, ...patch, updatedAt: now });
    while (this.rows.size > MEMORY_MAX) this.rows.delete(this.rows.keys().next().value!);
  }

  async setSky(userId: string, sky: Sky | null, now: number): Promise<void> { this.put(userId, { sky, route: null }, now); }
  async setRoute(userId: string, route: unknown, now: number): Promise<void> { this.put(userId, { route: route ?? null }, now); }
  async forget(userId: string): Promise<void> { this.rows.delete(userId); }
}

export class SupabaseOracleStore implements OracleStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(userId: string): Promise<OracleRow | null> {
    const { data, error } = await this.db.from("oracle_people").select("sky, last_route, updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("oracle_people read failed");
    if (!data) return null;
    return { sky: (data.sky as Sky | null) ?? null, route: data.last_route ?? null, updatedAt: Date.parse(String(data.updated_at)) || 0 };
  }

  async setSky(userId: string, sky: Sky | null, now: number): Promise<void> {
    // A new sky starts a new conversation with the oracle: the last route was read against the old one.
    const { error } = await this.db.from("oracle_people").upsert({ user_id: userId, sky, last_route: null, updated_at: new Date(now).toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error("oracle_people write failed");
  }

  async setRoute(userId: string, route: unknown, now: number): Promise<void> {
    const { error } = await this.db.from("oracle_people").upsert({ user_id: userId, last_route: route ?? null, updated_at: new Date(now).toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error("oracle_people write failed");
  }

  async forget(userId: string): Promise<void> {
    const { error } = await this.db.from("oracle_people").delete().eq("user_id", userId);
    if (error) throw new Error("oracle_people delete failed");
  }
}

let shared: OracleStore | null = null;

/** The server's store: Supabase when it is set up, else the memory twin. */
export function oracleStore(): OracleStore {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseOracleStore(db) : new MemoryOracleStore();
  }
  return shared;
}
