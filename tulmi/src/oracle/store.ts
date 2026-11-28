/**
 * WHAT THE ORACLE KEEPS OF A PERSON: WHEN AND WHERE THEY WERE BORN, AND THE ROUTE THEIR LAST QUESTION TOOK.
 *
 *   oracle_people   one row a person (migration 0078): `sky` (the date, the local time, the place and its coordinates, whether the time is known) and
 *                   `last_route` (what the oracle's router decided last turn, sent back so a follow-up on the same subject is read the same way)
 *
 * THE PEOPLE THEY READ FOR (migration 0119). Besides their own chart, the people they added (`others`: a name, a gender, when and where they
 * were born), which one Chamen reads for now (`active`: "me", an added person's "p:<id>", or a chart shared with them, "s:<owner>:<ref>"),
 * and the gender Chamen reads their OWN chart with when they switched it there (`gender`; the profile is left as it is).
 *
 *   oracle_shares   one row a chart shared into a space (their own "me", or "p:<id>"): its members can pick it and ask about it, never
 *                   seeing when or where the person was born (oracle/people.ts)
 *
 * The person's own: they can only READ their rows (owner-only RLS), the server writes with the service key, and they go with the account and
 * with "delete my data". The memory twin is what tests and a server with no Supabase use; it is bounded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { SkyDraft } from "./birth.js";

export type OracleGender = "male" | "female" | "other";

/** Someone they added to read for: Mom, a partner, a friend. */
export interface OtherPerson { id: string; name: string; gender: OracleGender | null; sky: SkyDraft | null; at: number }

/** The people they read for, which one is picked, and the gender Chamen reads their own chart with. */
export interface Circle { others: OtherPerson[]; active: string | null; gender: OracleGender | null }

export interface OracleRow extends Circle {
  /** When and where they were born; while the cards are filled in, the when alone (birth.ts isComplete tells). */
  sky: SkyDraft | null;
  route: unknown;
  updatedAt: number;
}

/** A chart shared into a space: the owner's own ("me") or someone they added ("p:<id>"). */
export interface OracleShare { ownerId: string; ref: string; spaceId: string; at: number }

export interface OracleStore {
  get(userId: string): Promise<OracleRow | null>;
  setSky(userId: string, sky: SkyDraft | null, now: number): Promise<void>;
  setRoute(userId: string, route: unknown, now: number): Promise<void>;
  /** The people, the pick and their Chamen gender: only what is given changes. */
  setCircle(userId: string, patch: Partial<Circle>, now: number): Promise<void>;
  sharesOf(ownerId: string): Promise<OracleShare[]>;
  sharesIn(spaceIds: readonly string[]): Promise<OracleShare[]>;
  setShare(ownerId: string, ref: string, spaceId: string, on: boolean, now: number): Promise<void>;
  forget(userId: string): Promise<void>;
}

/** The tables a person's account owns, for deleting an account and their data. */
export const ORACLE_USER_TABLES = ["oracle_people", "oracle_shares"] as const;
/** How many people one person can add. */
export const OTHERS_MAX = 20;
const SHARES_MAX = 200;
const EMPTY: Circle = { others: [], active: null, gender: null };

const MEMORY_MAX = 20_000;

export class MemoryOracleStore implements OracleStore {
  private readonly rows = new Map<string, OracleRow>();
  private shares: OracleShare[] = [];

  async get(userId: string): Promise<OracleRow | null> {
    const r = this.rows.get(userId);
    return r ? { ...r } : null;
  }

  private put(userId: string, patch: Partial<OracleRow>, now: number): void {
    const cur = this.rows.get(userId) ?? { sky: null, route: null, updatedAt: now, ...EMPTY };
    this.rows.delete(userId);
    this.rows.set(userId, { ...cur, ...patch, updatedAt: now });
    while (this.rows.size > MEMORY_MAX) this.rows.delete(this.rows.keys().next().value!);
  }

  async setSky(userId: string, sky: SkyDraft | null, now: number): Promise<void> { this.put(userId, { sky, route: null }, now); }
  async setRoute(userId: string, route: unknown, now: number): Promise<void> { this.put(userId, { route: route ?? null }, now); }
  async setCircle(userId: string, patch: Partial<Circle>, now: number): Promise<void> { this.put(userId, patch, now); }
  async sharesOf(ownerId: string): Promise<OracleShare[]> { return this.shares.filter((x) => x.ownerId === ownerId).map((x) => ({ ...x })); }
  async sharesIn(spaceIds: readonly string[]): Promise<OracleShare[]> { return this.shares.filter((x) => spaceIds.includes(x.spaceId)).map((x) => ({ ...x })); }
  async setShare(ownerId: string, ref: string, spaceId: string, on: boolean, now: number): Promise<void> {
    this.shares = this.shares.filter((x) => !(x.ownerId === ownerId && x.ref === ref && x.spaceId === spaceId));
    if (on) this.shares.push({ ownerId, ref, spaceId, at: now });
    if (this.shares.length > MEMORY_MAX) this.shares.shift();
  }
  async forget(userId: string): Promise<void> { this.rows.delete(userId); this.shares = this.shares.filter((x) => x.ownerId !== userId); }
}

const genderOf = (v: unknown): OracleGender | null => (v === "male" || v === "female" || v === "other" ? v : null);
/** What was kept of the people, read back defensively: a row written by hand is data too. */
export function othersOf(v: unknown): OtherPerson[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, OTHERS_MAX).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.slice(0, 40) : "", name = typeof o.name === "string" ? o.name.slice(0, 60) : "";
    return id && name ? [{ id, name, gender: genderOf(o.gender), sky: (o.sky && typeof o.sky === "object" ? o.sky : null) as SkyDraft | null, at: Number(o.at) || 0 }] : [];
  });
}

export class SupabaseOracleStore implements OracleStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(userId: string): Promise<OracleRow | null> {
    const { data, error } = await this.db.from("oracle_people").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("oracle_people read failed");
    if (!data) return null;
    return {
      sky: (data.sky as SkyDraft | null) ?? null, route: data.last_route ?? null, updatedAt: Date.parse(String(data.updated_at)) || 0,
      // Read with select("*") so a server ahead of migration 0119 still reads the row it always did (no such columns: the empty circle).
      others: othersOf(data.others), active: typeof data.active === "string" ? data.active : null, gender: genderOf(data.chamen_gender),
    };
  }

  async setSky(userId: string, sky: SkyDraft | null, now: number): Promise<void> {
    // A new sky starts a new conversation with the oracle: the last route was read against the old one.
    const { error } = await this.db.from("oracle_people").upsert({ user_id: userId, sky, last_route: null, updated_at: new Date(now).toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error("oracle_people write failed");
  }

  async setRoute(userId: string, route: unknown, now: number): Promise<void> {
    const { error } = await this.db.from("oracle_people").upsert({ user_id: userId, last_route: route ?? null, updated_at: new Date(now).toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error("oracle_people write failed");
  }

  async setCircle(userId: string, patch: Partial<Circle>, now: number): Promise<void> {
    const row: Record<string, unknown> = { user_id: userId, updated_at: new Date(now).toISOString() };
    if (patch.others) row.others = patch.others.slice(0, OTHERS_MAX);
    if (patch.active !== undefined) row.active = patch.active;
    if (patch.gender !== undefined) row.chamen_gender = patch.gender;
    const { error } = await this.db.from("oracle_people").upsert(row, { onConflict: "user_id" });
    if (error) throw new Error("oracle_people write failed");
  }

  private static share(r: Record<string, unknown>): OracleShare {
    return { ownerId: String(r.user_id), ref: String(r.ref), spaceId: String(r.space_id), at: Date.parse(String(r.created_at)) || 0 };
  }

  async sharesOf(ownerId: string): Promise<OracleShare[]> {
    const { data, error } = await this.db.from("oracle_shares").select("*").eq("user_id", ownerId).limit(SHARES_MAX);
    if (error) return [];
    return (data ?? []).map((r) => SupabaseOracleStore.share(r as Record<string, unknown>));
  }

  async sharesIn(spaceIds: readonly string[]): Promise<OracleShare[]> {
    if (!spaceIds.length) return [];
    const { data, error } = await this.db.from("oracle_shares").select("*").in("space_id", spaceIds.slice(0, 100)).limit(SHARES_MAX);
    if (error) return [];
    return (data ?? []).map((r) => SupabaseOracleStore.share(r as Record<string, unknown>));
  }

  async setShare(ownerId: string, ref: string, spaceId: string, on: boolean, now: number): Promise<void> {
    const q = on
      ? this.db.from("oracle_shares").upsert({ user_id: ownerId, ref, space_id: spaceId, created_at: new Date(now).toISOString() }, { onConflict: "user_id,ref,space_id" })
      : this.db.from("oracle_shares").delete().eq("user_id", ownerId).eq("ref", ref).eq("space_id", spaceId);
    const { error } = await q;
    if (error) throw new Error("oracle_shares write failed");
  }

  async forget(userId: string): Promise<void> {
    const { error } = await this.db.from("oracle_people").delete().eq("user_id", userId);
    if (error) throw new Error("oracle_people delete failed");
    await this.db.from("oracle_shares").delete().eq("user_id", userId);
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
