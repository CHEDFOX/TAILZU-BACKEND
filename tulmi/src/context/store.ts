/**
 * WHERE THE CONTEXT IS KEPT: migration 0063 (person_context), one row per person, with a memory twin for tests and a server with no Supabase
 * (a restart then forgets it). Written with the service key only; a person's own token can neither read nor write a row. The row goes with
 * the account.
 *
 * The row holds what was learned from what the person did, never what is read live: the people they message (people), their last asks in
 * full (turns) and the older ones folded into one short line (summary). Whatever was stored is read back through cleanKept, so a row from an
 * older build, or one edited by hand, is still a context.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { ASK_DOS, type AskDo } from "../askDecide/index.js";

/** Someone the person messages, and through what. */
export interface Person {
  name: string;
  via?: string;
  count: number;
  lastAt: number;
}

/** One ask, as it was decided, and what came of it when the server saw that. */
export interface KeptTurn {
  id: string;
  said: string;
  did: AskDo;
  /** The request made whole, when it differs from what was said ("send it to Dev too"). */
  goal?: string;
  to?: string;
  via?: string;
  /** What X0 did: the agent run's last words, or "done". */
  result?: string;
  at: number;
}

export interface Kept {
  people: Person[];
  turns: KeptTurn[];
  /** The asks that left `turns`, folded, oldest first. */
  summary: string;
  updatedAt: number;
}

export const emptyKept = (now = 0): Kept => ({ people: [], turns: [], summary: "", updatedAt: now });

export interface ContextStore {
  get(userId: string): Promise<Kept | null>;
  put(userId: string, k: Kept): Promise<void>;
  remove(userId: string): Promise<void>;
}

const str = (v: unknown, n: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Whatever was stored, as a context: an entry that cannot be read is left out. */
export function cleanKept(raw: unknown): Kept {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const people: Person[] = (Array.isArray(r.people) ? r.people : []).flatMap((p) => {
    const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const name = str(o.name, 80);
    if (!name) return [];
    const via = str(o.via, 40);
    return [{ name, ...(via ? { via } : {}), count: Math.max(1, Math.floor(num(o.count))), lastAt: num(o.lastAt) }];
  });
  const turns: KeptTurn[] = (Array.isArray(r.turns) ? r.turns : []).flatMap((t) => {
    const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
    const said = str(o.said, 400);
    const did = (ASK_DOS as readonly string[]).includes(String(o.did)) ? (o.did as AskDo) : undefined;
    if (!said || !did) return [];
    const extra = { goal: str(o.goal, 400), to: str(o.to, 80), via: str(o.via, 40), result: str(o.result, 300) };
    return [{
      id: str(o.id, 64) ?? "", said, did, at: num(o.at),
      ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)),
    } as KeptTurn];
  });
  return { people, turns, summary: str(r.summary, 1000) ?? "", updatedAt: num(r.updatedAt) };
}

export class MemoryContextStore implements ContextStore {
  private rows = new Map<string, Kept>();
  async get(userId: string) {
    const k = this.rows.get(userId);
    return k ? structuredClone(k) : null;
  }
  async put(userId: string, k: Kept) { this.rows.set(userId, structuredClone(k)); }
  async remove(userId: string) { this.rows.delete(userId); }
}

const TABLE = "person_context";

interface Row { user_id: string; people: unknown; turns: unknown; summary: string; updated_at: string }

export class SupabaseContextStore implements ContextStore {
  constructor(private readonly sb: SupabaseClient) {}

  async get(userId: string) {
    const { data, error } = await this.sb.from(TABLE).select("user_id, people, turns, summary, updated_at").eq("user_id", userId).maybeSingle<Row>();
    if (error) throw new Error(`${TABLE}: read failed: ${error.message}`);
    return data ? cleanKept({ people: data.people, turns: data.turns, summary: data.summary, updatedAt: Date.parse(data.updated_at) }) : null;
  }

  async put(userId: string, k: Kept) {
    const { error } = await this.sb.from(TABLE).upsert({
      user_id: userId, people: k.people, turns: k.turns, summary: k.summary, updated_at: new Date(k.updatedAt).toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error(`${TABLE}: write failed: ${error.message}`);
  }

  async remove(userId: string) {
    const { error } = await this.sb.from(TABLE).delete().eq("user_id", userId);
    if (error) throw new Error(`${TABLE}: delete failed: ${error.message}`);
  }
}

let current: ContextStore | null = null;

/** Supabase when the server has it, else memory. */
export function contextStore(): ContextStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseContextStore(sb) : new MemoryContextStore();
  }
  return current;
}

export function resetContextStoreForTests(): void { current = null; }
