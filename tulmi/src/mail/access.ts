/**
 * THE MAIL BOT IN SPACES: WHOSE BUSINESS IT IS, AND WHO ELSE MAY REACH IT (docs/mail.md, docs/spaces.md "The line about the admin").
 *
 *   mail_businesses   one row a business (migration 0084): its id (the worker's, unique across every account: mail-worker/server/companies.ts)
 *                     and the person who owns it. Kept when they make it, and filled in for an older business whenever its owner's list is read
 *   mail_handlers     one row an address its owner gave a member of their spaces to answer ("Ravi answers support@"): the business, its owner,
 *                     the address (its id at the worker and its email) and the member
 *
 *   mailAccess(...).resolve(viewer, business)   how the viewer reaches a business, or null (as if it weren't there):
 *     own       its owner is the viewer, or the registry has not heard of it (an older business: the worker says no if it isn't theirs)
 *     admin     its owner is a member of a space the viewer is the admin of (people.ts membersOf(viewer)): everything, read and write
 *     handler   its owner gave the viewer addresses, and the viewer is still a member of a space the owner is the admin of
 *               (people.ts membersOf(owner)): only those addresses' folders, conversations and drafts, sending only from them
 *   Every call to the worker for that business is then made inside the OWNER's account (worker.ts ownerOf(ownerId)), never the viewer's.
 *
 * "A member" is exactly people.ts's: in a space the other person is the admin of, not a draft, agreed to the line about the admin as it is
 * now, no block between them. While Spaces is off there is nobody, so a person reaches only their own businesses. A row is never deleted
 * because someone left a space, a block was made or Spaces is off: it does nothing until that person is a member again. It goes when its
 * owner takes the address back, removes the address or the business, or an account goes.
 *
 * Addresses are matched by their email, lowercase: what a handler may open (an alias's folder, a conversation, a draft) is named by its email.
 *
 * The server's alone (no policy lets a token read or write them); rows go with the accounts. The memory twins are what tests and a server
 * with no Supabase use; they are bounded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { MeetPeople } from "../meet/people.js";
import type { MailPerson } from "./digest.js";

/** Whose each business is. */
export interface MailBusinesses {
  /** The person who owns it, or null when the registry has not heard of it. */
  whose(businessId: string): Promise<string | null>;
  /** It is this person's: made now, or read in their own list. */
  keep(businessId: string, userId: string): Promise<void>;
  /** Their own list was read, so each business in it is theirs: only what is missing or says someone else is written. */
  claim(userId: string, businessIds: string[]): Promise<void>;
  /** Which of these people have a business here (their admin's list reads only theirs). */
  owning(userIds: string[]): Promise<Set<string>>;
  /** It was deleted. */
  forget(businessId: string): Promise<void>;
}

/** An address its owner gave a member to answer. */
export interface MailHandler { businessId: string; ownerId: string; addressId: number; addressEmail: string; memberId: string }

export interface MailHandlers {
  /** The address given to the member: false when it was theirs already. */
  give(h: MailHandler): Promise<boolean>;
  /** Taken back: the rows for that address, by its id or its email. */
  take(h: { businessId: string; ownerId: string; addressId: number; addressEmail?: string; memberId: string }): Promise<void>;
  /** What one member was given, in every business. */
  ofMember(memberId: string): Promise<MailHandler[]>;
  /** Who was given what, in these businesses. */
  ofBusinesses(businessIds: string[]): Promise<MailHandler[]>;
  /** The business was deleted, or made again under an old one's id. */
  forgetBusiness(businessId: string): Promise<void>;
  /** The address was removed. */
  forgetAddress(businessId: string, addressId: number): Promise<void>;
}

const MEMORY_MAX = 20_000;
const LIST_MAX = 2_000;
/** Account ids are Supabase's: a uuid. Anything else is nobody's row. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const lower = (s: string): string => s.trim().toLowerCase();

// ---------------------------------------------------------------------------------------------------------------------------- memory

export class MemoryMailBusinesses implements MailBusinesses {
  private readonly byBusiness = new Map<string, string>();

  async whose(businessId: string): Promise<string | null> { return this.byBusiness.get(businessId) ?? null; }

  async keep(businessId: string, userId: string): Promise<void> {
    this.byBusiness.delete(businessId);
    this.byBusiness.set(businessId, userId);
    while (this.byBusiness.size > MEMORY_MAX) this.byBusiness.delete(this.byBusiness.keys().next().value!);
  }

  async claim(userId: string, businessIds: string[]): Promise<void> {
    for (const id of businessIds) if (this.byBusiness.get(id) !== userId) await this.keep(id, userId);
  }

  async owning(userIds: string[]): Promise<Set<string>> {
    const wanted = new Set(userIds);
    const out = new Set<string>();
    for (const u of this.byBusiness.values()) if (wanted.has(u)) out.add(u);
    return out;
  }

  async forget(businessId: string): Promise<void> { this.byBusiness.delete(businessId); }
}

export class MemoryMailHandlers implements MailHandlers {
  private rows: MailHandler[] = [];

  async give(h: MailHandler): Promise<boolean> {
    const row = { ...h, addressEmail: lower(h.addressEmail) };
    const at = this.rows.findIndex((r) => r.businessId === h.businessId && r.addressId === h.addressId && r.memberId === h.memberId);
    if (at >= 0) {
      const was = this.rows[at]!;
      if (was.ownerId === row.ownerId && was.addressEmail === row.addressEmail) return false;
      this.rows[at] = row;
      return true;
    }
    this.rows.push(row);
    if (this.rows.length > MEMORY_MAX) this.rows.splice(0, this.rows.length - MEMORY_MAX);
    return true;
  }

  async take(h: { businessId: string; ownerId: string; addressId: number; addressEmail?: string; memberId: string }): Promise<void> {
    const email = h.addressEmail ? lower(h.addressEmail) : null;
    this.rows = this.rows.filter((r) => !(r.businessId === h.businessId && r.ownerId === h.ownerId && r.memberId === h.memberId
      && (r.addressId === h.addressId || (email !== null && r.addressEmail === email))));
  }

  async ofMember(memberId: string): Promise<MailHandler[]> { return this.rows.filter((r) => r.memberId === memberId).map((r) => ({ ...r })); }

  async ofBusinesses(businessIds: string[]): Promise<MailHandler[]> {
    const ids = new Set(businessIds);
    return this.rows.filter((r) => ids.has(r.businessId)).map((r) => ({ ...r }));
  }

  async forgetBusiness(businessId: string): Promise<void> { this.rows = this.rows.filter((r) => r.businessId !== businessId); }

  async forgetAddress(businessId: string, addressId: number): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.businessId === businessId && r.addressId === addressId));
  }
}

// -------------------------------------------------------------------------------------------------------------------------- supabase

export class SupabaseMailBusinesses implements MailBusinesses {
  constructor(private readonly db: SupabaseClient) {}

  async whose(businessId: string): Promise<string | null> {
    const { data, error } = await this.db.from("mail_businesses").select("user_id").eq("business_id", businessId).maybeSingle();
    if (error) throw new Error("mail_businesses read failed");
    return data ? String(data.user_id) : null;
  }

  async keep(businessId: string, userId: string): Promise<void> {
    if (!UUID.test(userId)) throw new Error("mail_businesses: not an account");
    const { error } = await this.db.from("mail_businesses").upsert({ business_id: businessId, user_id: userId }, { onConflict: "business_id" });
    if (error) throw new Error("mail_businesses write failed");
  }

  async claim(userId: string, businessIds: string[]): Promise<void> {
    if (!businessIds.length || !UUID.test(userId)) return;
    const { data, error } = await this.db.from("mail_businesses").select("business_id, user_id").in("business_id", businessIds);
    if (error) throw new Error("mail_businesses read failed");
    const known = new Map(((data ?? []) as Array<{ business_id: unknown; user_id: unknown }>).map((r) => [String(r.business_id), String(r.user_id)]));
    const rows = businessIds.filter((id) => known.get(id) !== userId).map((id) => ({ business_id: id, user_id: userId }));
    if (!rows.length) return;
    const { error: wrote } = await this.db.from("mail_businesses").upsert(rows, { onConflict: "business_id" });
    if (wrote) throw new Error("mail_businesses write failed");
  }

  async owning(userIds: string[]): Promise<Set<string>> {
    const ids = userIds.filter((u) => UUID.test(u));
    if (!ids.length) return new Set();
    const { data, error } = await this.db.from("mail_businesses").select("user_id").in("user_id", ids).limit(LIST_MAX);
    if (error) throw new Error("mail_businesses read failed");
    return new Set(((data ?? []) as Array<{ user_id: unknown }>).map((r) => String(r.user_id)));
  }

  async forget(businessId: string): Promise<void> {
    const { error } = await this.db.from("mail_businesses").delete().eq("business_id", businessId);
    if (error) throw new Error("mail_businesses delete failed");
  }
}

const HANDLER_COLUMNS = "business_id, owner_id, address_id, address_email, member_id";
type HandlerRow = { business_id: unknown; owner_id: unknown; address_id: unknown; address_email: unknown; member_id: unknown };
const handlerOf = (r: HandlerRow): MailHandler => ({
  businessId: String(r.business_id), ownerId: String(r.owner_id), addressId: Number(r.address_id), addressEmail: lower(String(r.address_email ?? "")),
  memberId: String(r.member_id),
});

export class SupabaseMailHandlers implements MailHandlers {
  constructor(private readonly db: SupabaseClient) {}

  async give(h: MailHandler): Promise<boolean> {
    if (!UUID.test(h.ownerId) || !UUID.test(h.memberId)) throw new Error("mail_handlers: not an account");
    const email = lower(h.addressEmail);
    const { data, error } = await this.db.from("mail_handlers").select("owner_id, address_email")
      .eq("business_id", h.businessId).eq("address_id", h.addressId).eq("member_id", h.memberId).maybeSingle();
    if (error) throw new Error("mail_handlers read failed");
    if (data && String(data.owner_id) === h.ownerId && lower(String(data.address_email ?? "")) === email) return false;
    const { error: wrote } = await this.db.from("mail_handlers").upsert(
      { business_id: h.businessId, owner_id: h.ownerId, address_id: h.addressId, address_email: email, member_id: h.memberId },
      { onConflict: "business_id,address_id,member_id" },
    );
    if (wrote) throw new Error("mail_handlers write failed");
    return true;
  }

  async take(h: { businessId: string; ownerId: string; addressId: number; addressEmail?: string; memberId: string }): Promise<void> {
    if (!UUID.test(h.ownerId) || !UUID.test(h.memberId)) return;
    const rows = () => this.db.from("mail_handlers").delete().eq("business_id", h.businessId).eq("owner_id", h.ownerId).eq("member_id", h.memberId);
    const { error } = await rows().eq("address_id", h.addressId);
    if (error) throw new Error("mail_handlers delete failed");
    if (h.addressEmail) {
      const { error: byEmail } = await rows().eq("address_email", lower(h.addressEmail));
      if (byEmail) throw new Error("mail_handlers delete failed");
    }
  }

  async ofMember(memberId: string): Promise<MailHandler[]> {
    if (!UUID.test(memberId)) return [];
    const { data, error } = await this.db.from("mail_handlers").select(HANDLER_COLUMNS).eq("member_id", memberId).limit(LIST_MAX);
    if (error) throw new Error("mail_handlers read failed");
    return ((data ?? []) as HandlerRow[]).map(handlerOf);
  }

  async ofBusinesses(businessIds: string[]): Promise<MailHandler[]> {
    if (!businessIds.length) return [];
    const { data, error } = await this.db.from("mail_handlers").select(HANDLER_COLUMNS).in("business_id", businessIds).limit(LIST_MAX);
    if (error) throw new Error("mail_handlers read failed");
    return ((data ?? []) as HandlerRow[]).map(handlerOf);
  }

  async forgetBusiness(businessId: string): Promise<void> {
    const { error } = await this.db.from("mail_handlers").delete().eq("business_id", businessId);
    if (error) throw new Error("mail_handlers delete failed");
  }

  async forgetAddress(businessId: string, addressId: number): Promise<void> {
    const { error } = await this.db.from("mail_handlers").delete().eq("business_id", businessId).eq("address_id", addressId);
    if (error) throw new Error("mail_handlers delete failed");
  }
}

let sharedBusinesses: MailBusinesses | null = null;
let sharedHandlers: MailHandlers | null = null;

/** The server's registry: Supabase when it is set up, else the memory twin. */
export function mailBusinesses(): MailBusinesses {
  if (!sharedBusinesses) {
    const db = supabase();
    sharedBusinesses = db ? new SupabaseMailBusinesses(db) : new MemoryMailBusinesses();
  }
  return sharedBusinesses;
}

/** The server's handlers: Supabase when it is set up, else the memory twin. */
export function mailHandlers(): MailHandlers {
  if (!sharedHandlers) {
    const db = supabase();
    sharedHandlers = db ? new SupabaseMailHandlers(db) : new MemoryMailHandlers();
  }
  return sharedHandlers;
}

// ---------------------------------------------------------------------------------------------------------------------------- reach

export type MailAccessKind = "own" | "admin" | "handler";

/** How the viewer reaches a business. */
export interface MailReach {
  /** Whose it is: every worker call for it goes inside this person's account. */
  ownerId: string;
  access: MailAccessKind;
  /** A handler's addresses, their emails lowercase. */
  addresses?: Set<string>;
  /** Whose it is, by the name the admin's space has them (admin only: a handler's view asks adminName). */
  owner?: MailPerson;
}

export interface MailAccessDeps { businesses: MailBusinesses; handlers: MailHandlers; people: MeetPeople }

const said = (err: unknown): string => String((err as Error)?.message ?? err).slice(0, 160);

export function mailAccess(d: MailAccessDeps) {
  /** The members of the spaces this person is the admin of; nobody when that can't be read. */
  const membersOf = async (adminId: string): Promise<MailPerson[]> => {
    try {
      return (await d.people.membersOf(adminId)).map((m) => ({ id: m.userId, name: m.name }));
    } catch (err) {
      console.warn(`[mail] a space's members could not be read: ${said(err)}`);
      return [];
    }
  };

  /** The admins of the spaces this person is a member of, each with their name as that space has it; nobody when that can't be read. */
  const adminsOf = async (memberId: string): Promise<MailPerson[]> => {
    try {
      return (await d.people.adminsOf(memberId)).map((a) => ({ id: a.userId, name: a.name }));
    } catch (err) {
      console.warn(`[mail] a member's admins could not be read: ${said(err)}`);
      return [];
    }
  };

  return {
    membersOf,
    adminsOf,

    /** An admin's name as the member's space has them ("" when they are not the member's admin). */
    async adminName(memberId: string, adminId: string): Promise<string> {
      return (await adminsOf(memberId)).find((a) => a.id === adminId)?.name ?? "";
    },

    /** How the viewer reaches the business, or null: it is someone else's they have no way into (answered as if it weren't there). */
    async resolve(viewerId: string, businessId: string): Promise<MailReach | null> {
      // Unknown (or unreadable): the viewer's own, so the worker is asked inside their account and says no if it isn't theirs.
      const ownerId = await d.businesses.whose(businessId).catch((err) => { console.warn(`[mail] whose business: ${said(err)}`); return null; });
      if (!ownerId || ownerId === viewerId) return { ownerId: viewerId, access: "own" };
      const member = (await membersOf(viewerId)).find((m) => m.id === ownerId);
      if (member) return { ownerId, access: "admin", owner: member };
      const given = (await d.handlers.ofMember(viewerId).catch((err) => { console.warn(`[mail] handlers: ${said(err)}`); return [] as MailHandler[]; }))
        .filter((h) => h.businessId === businessId && h.ownerId === ownerId);
      if (!given.length) return null;
      if (!(await membersOf(ownerId)).some((m) => m.id === viewerId)) return null;
      return { ownerId, access: "handler", addresses: new Set(given.map((h) => lower(h.addressEmail))) };
    },
  };
}

export type MailAccess = ReturnType<typeof mailAccess>;
