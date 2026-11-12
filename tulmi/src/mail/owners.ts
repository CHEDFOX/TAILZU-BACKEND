/**
 * WHOSE MAIL IT IS: THE PERSON BEHIND AN ACCOUNT HASH, FOR THE PUSH WHEN MAIL NEEDS THEM.
 *
 *   mail_owners   one row a person with a business on the mail bot (migration 0080): their id and the hash the worker knows them by
 *                 (worker.ts ownerOf). Kept when they make their first business. The worker never learns the id; when it says mail needs a
 *                 person, it names the hash, and this is how the push finds its phone.
 *
 * The server's alone (no policy lets a token read or write it); it goes with the account. The memory twin is what tests and a server with no
 * Supabase use; it is bounded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

export interface MailOwners {
  keep(userId: string, owner: string): Promise<void>;
  userOf(owner: string): Promise<string | null>;
  forget(userId: string): Promise<void>;
}

const MEMORY_MAX = 20_000;

export class MemoryMailOwners implements MailOwners {
  private readonly byOwner = new Map<string, string>();

  async keep(userId: string, owner: string): Promise<void> {
    this.byOwner.delete(owner);
    this.byOwner.set(owner, userId);
    while (this.byOwner.size > MEMORY_MAX) this.byOwner.delete(this.byOwner.keys().next().value!);
  }

  async userOf(owner: string): Promise<string | null> { return this.byOwner.get(owner) ?? null; }

  async forget(userId: string): Promise<void> {
    for (const [o, u] of this.byOwner) if (u === userId) this.byOwner.delete(o);
  }
}

export class SupabaseMailOwners implements MailOwners {
  constructor(private readonly db: SupabaseClient) {}

  async keep(userId: string, owner: string): Promise<void> {
    const { error } = await this.db.from("mail_owners").upsert({ user_id: userId, owner }, { onConflict: "user_id" });
    if (error) throw new Error("mail_owners write failed");
  }

  async userOf(owner: string): Promise<string | null> {
    const { data, error } = await this.db.from("mail_owners").select("user_id").eq("owner", owner).maybeSingle();
    if (error) throw new Error("mail_owners read failed");
    return data ? String(data.user_id) : null;
  }

  async forget(userId: string): Promise<void> {
    const { error } = await this.db.from("mail_owners").delete().eq("user_id", userId);
    if (error) throw new Error("mail_owners delete failed");
  }
}

let shared: MailOwners | null = null;

/** The server's: Supabase when it is set up, else the memory twin. */
export function mailOwners(): MailOwners {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseMailOwners(db) : new MemoryMailOwners();
  }
  return shared;
}
