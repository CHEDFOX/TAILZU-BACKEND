/**
 * THE BOTS AREA'S ROWS: one small table shape for everything this area keeps (migration 0042), in memory or in Supabase.
 *
 *   table<Row>("spaces")   -> select / insert / update / remove / upsert, matched on equal columns
 *
 * A row's fields are its column names (snake_case), times are epoch milliseconds (bigint columns), lists are jsonb. The memory twin is
 * what the tests and a server with no Supabase use; it is bounded per table. The server writes with the service key; every read and
 * write here is already narrowed to the signed-in person by the caller (user_id in the match).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

export type Row = Record<string, unknown>;

export interface Table<R extends Row> {
  select(match: Partial<R>, o?: { order?: keyof R & string; desc?: boolean; limit?: number }): Promise<R[]>;
  insert(row: R): Promise<R>;
  /** Changes the matching rows; how many. */
  update(match: Partial<R>, patch: Partial<R>): Promise<number>;
  remove(match: Partial<R>): Promise<number>;
  /** Inserts, or replaces the row with the same `keys`. */
  upsert(row: R, keys: Array<keyof R & string>): Promise<R>;
}

const MEMORY_ROWS_MAX = 50_000;
const matches = <R extends Row>(r: R, m: Partial<R>): boolean => Object.entries(m).every(([k, v]) => r[k] === v);
const copy = <R extends Row>(r: R): R => JSON.parse(JSON.stringify(r)) as R;

export class MemoryTable<R extends Row> implements Table<R> {
  readonly rows: R[] = [];

  async select(match: Partial<R>, o: { order?: keyof R & string; desc?: boolean; limit?: number } = {}): Promise<R[]> {
    let out = this.rows.filter((r) => matches(r, match));
    if (o.order) {
      const k = o.order;
      out = [...out].sort((a, b) => (Number(a[k]) - Number(b[k])) * (o.desc ? -1 : 1));
    }
    return out.slice(0, o.limit ?? out.length).map(copy);
  }

  async insert(row: R): Promise<R> {
    this.rows.push(copy(row));
    if (this.rows.length > MEMORY_ROWS_MAX) this.rows.splice(0, this.rows.length - MEMORY_ROWS_MAX);
    return copy(row);
  }

  async update(match: Partial<R>, patch: Partial<R>): Promise<number> {
    let n = 0;
    for (const r of this.rows) if (matches(r, match)) { Object.assign(r, copy(patch as R)); n += 1; }
    return n;
  }

  async remove(match: Partial<R>): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) if (matches(this.rows[i]!, match)) this.rows.splice(i, 1);
    return before - this.rows.length;
  }

  async upsert(row: R, keys: Array<keyof R & string>): Promise<R> {
    const m = Object.fromEntries(keys.map((k) => [k, row[k]])) as Partial<R>;
    const i = this.rows.findIndex((r) => matches(r, m));
    if (i >= 0) this.rows[i] = copy(row);
    else await this.insert(row);
    return copy(row);
  }
}

const fail = (table: string, what: string, error: { message: string }): never => { throw new Error(`bots area: ${table} ${what}: ${error.message}`); };

export class SupabaseTable<R extends Row> implements Table<R> {
  constructor(private readonly sb: SupabaseClient, private readonly name: string) {}

  async select(match: Partial<R>, o: { order?: keyof R & string; desc?: boolean; limit?: number } = {}): Promise<R[]> {
    let q = this.sb.from(this.name).select("*").match(match as Record<string, unknown>);
    if (o.order) q = q.order(o.order, { ascending: !o.desc });
    if (o.limit) q = q.limit(o.limit);
    const { data, error } = await q;
    if (error) fail(this.name, "read", error);
    return (data ?? []) as R[];
  }

  async insert(row: R): Promise<R> {
    const { data, error } = await this.sb.from(this.name).insert(row).select("*").single();
    if (error) fail(this.name, "insert", error);
    return data as R;
  }

  async update(match: Partial<R>, patch: Partial<R>): Promise<number> {
    const { data, error } = await this.sb.from(this.name).update(patch as Row).match(match as Record<string, unknown>).select("*");
    if (error) fail(this.name, "update", error);
    return (data ?? []).length;
  }

  async remove(match: Partial<R>): Promise<number> {
    const { data, error } = await this.sb.from(this.name).delete().match(match as Record<string, unknown>).select("*");
    if (error) fail(this.name, "delete", error);
    return (data ?? []).length;
  }

  async upsert(row: R, keys: Array<keyof R & string>): Promise<R> {
    const { data, error } = await this.sb.from(this.name).upsert(row, { onConflict: keys.join(",") }).select("*").single();
    if (error) fail(this.name, "upsert", error);
    return data as R;
  }
}

/** The tables this area keeps (migration 0042_bots_area.sql). */
export const AREA_TABLES = [
  "bot_chat_turns", "bot_drafts", "bot_listings", "bot_listing_adds", "bot_key_usage",
  "spaces", "space_members", "space_bots", "space_invites", "plan_skips", "trips",
] as const;
export type AreaTable = (typeof AREA_TABLES)[number];

const made = new Map<string, Table<Row>>();

/** One table: Supabase when the service client exists, else memory. */
export function table<R extends Row>(name: AreaTable): Table<R> {
  let t = made.get(name);
  if (!t) {
    const sb = supabase();
    t = sb ? new SupabaseTable<Row>(sb, name) : new MemoryTable<Row>();
    made.set(name, t);
  }
  return t as unknown as Table<R>;
}

/** Tests: forget every table. */
export function resetAreaTablesForTests(): void { made.clear(); }
