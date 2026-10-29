/**
 * THE TABLES SPACES ADD (migration 0051_spaces_sharing.sql): roles, the activity log, shared things, payment requests, tasks and plans for
 * others, chats and their messages, and the email outbox. Same shape as rows.ts (match on equal columns), plus one read rows.ts has no need for: the rows
 * before a value of a column, newest first (older messages, a page at a time).
 *
 *   spaceTable<Row>("threads")   -> select / insert / update / remove / upsert / before
 *
 * Memory when there is no Supabase service client (tests, a server with none); written by the server with the service key only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { MemoryTable, SupabaseTable, type Row, type Table } from "./rows.js";

export interface PagedTable<R extends Row> extends Table<R> {
  /** Rows matching `match` whose `column` is below `value` (all when value is null), highest first, at most `limit`. */
  before(match: Partial<R>, column: keyof R & string, value: number | null, limit: number): Promise<R[]>;
}

export class MemoryPaged<R extends Row> extends MemoryTable<R> implements PagedTable<R> {
  async before(match: Partial<R>, column: keyof R & string, value: number | null, limit: number): Promise<R[]> {
    const all = await this.select(match, { order: column, desc: true });
    return all.filter((r) => value === null || Number(r[column]) < value).slice(0, limit);
  }
}

export class SupabasePaged<R extends Row> extends SupabaseTable<R> implements PagedTable<R> {
  constructor(private readonly client: SupabaseClient, private readonly tableName: string) { super(client, tableName); }

  async before(match: Partial<R>, column: keyof R & string, value: number | null, limit: number): Promise<R[]> {
    let q = this.client.from(this.tableName).select("*").match(match as Record<string, unknown>);
    if (value !== null) q = q.lt(column, value);
    const { data, error } = await q.order(column, { ascending: false }).limit(limit);
    if (error) throw new Error(`spaces: ${this.tableName} read: ${error.message}`);
    return (data ?? []) as R[];
  }
}

/** The tables migration 0051 adds, and 0057's blocks and reports (botsBots/blocks.ts, safety.ts). */
export const SPACE_TABLES = [
  "space_roles", "space_activity", "space_items", "space_payments", "space_tasks", "threads", "thread_members", "thread_messages", "mail_outbox",
  "user_blocks", "content_reports",
] as const;
export type SpaceTableName = (typeof SPACE_TABLES)[number];

const made = new Map<string, PagedTable<Row>>();

export function spaceTable<R extends Row>(name: SpaceTableName): PagedTable<R> {
  let t = made.get(name);
  if (!t) {
    const sb = supabase();
    t = sb ? new SupabasePaged<Row>(sb, name) : new MemoryPaged<Row>();
    made.set(name, t);
  }
  return t as unknown as PagedTable<R>;
}

/** Tests: forget every table. */
export function resetSpaceTablesForTests(): void { made.clear(); }
