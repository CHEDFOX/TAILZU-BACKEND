/**
 * WHAT IS KEPT: the slip a site gave the browser, and the things worth looking at (migration 0098, docs/sites.md).
 *
 * THE SLIP IS NOT A PASSWORD. What a site hands a browser once somebody is signed in is a cookie — "this browser is
 * Rahul" — and that is all that is ever written here, encrypted with CONNECTOR_TOKEN_KEY exactly as a connector's
 * token is. The password and the one-time code go from the person to the SITE and are kept nowhere, by anyone, ever.
 *
 * ONE PROFILE PER SITE, not one per person. A person signed in to four shops has four rows and four separate cookie
 * jars, so one shop's session being read tells you nothing about the other three, and no site can see its neighbour.
 *
 * Supabase with the service key when the server has one, else memory (a restart forgets it, as the other stores here).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabase } from "../auth/supabase.js";
import { decrypt, encrypt } from "../connectors/crypto.js";
import type { SiteCard } from "../../../shared/types/api.js";

/** The cookies and storage of ONE site, as the browser handed them over. Never anything else. */
export interface SiteProfile {
  /**
   * SIGNED IN ON THE PHONE. The person signed in inside the app's own WebView and the session stayed there, as a
   * browser's does: this row holds no cookie and no storage, only the fact. The server never reads a site for a
   * login like this — the phone does, and sends the words (service.ts phoneRead).
   */
  onPhone?: true;
  cookies: unknown[];
  /** localStorage and sessionStorage per origin, as [origin, key, value] rows. Half a session lives here. */
  storage?: Array<[string, string, string]>;
}

export interface SiteLogin {
  site: string;
  profile: SiteProfile;
  who?: string;
  usedAt?: number;
  fails: number;
}

export interface SiteWatch {
  id: string;
  ownerId: string;
  site: string;
  url: string;
  label: string;
  state: "open" | "done" | "stopped" | "lost";
  card?: SiteCard;
  readAt?: number;
  nextAt?: number;
}

/** Three refusals in a row and the site has stopped believing the slip: the person is asked to sign in again. */
export const FAILS_BEFORE_SIGN_IN = 3;

const ms = (s: string | null | undefined): number | undefined => (s ? new Date(s).getTime() : undefined);

export class SiteStore {
  private readonly logins = new Map<string, SiteLogin>();
  private readonly watches = new Map<string, SiteWatch>();

  constructor(private readonly db: SupabaseClient | null = supabase()) {}

  private key = (ownerId: string, site: string) => `${ownerId}\u0000${site}`;

  // ------------------------------------------------------------------ the slip

  async login(ownerId: string, site: string): Promise<SiteLogin | null> {
    if (!this.db) return this.logins.get(this.key(ownerId, site)) ?? null;
    const { data } = await this.db.from("site_profiles")
      .select("site, blob, who, used_at, fails").eq("owner_id", ownerId).eq("site", site).maybeSingle();
    if (!data?.blob) return null;
    let profile: SiteProfile;
    // A slip we cannot read is a slip we do not have: a changed key must not look like a signed-in person.
    try { profile = JSON.parse(decrypt(String(data.blob))) as SiteProfile; } catch { return null; }
    return {
      site: String(data.site), profile, fails: Number(data.fails ?? 0),
      ...(data.who ? { who: String(data.who) } : {}), ...(ms(data.used_at as string) ? { usedAt: ms(data.used_at as string) } : {}),
    };
  }

  /** Every site this person is signed in to, newest use first. */
  async loginsOf(ownerId: string): Promise<SiteLogin[]> {
    if (!this.db) {
      return [...this.logins.entries()].filter(([k]) => k.startsWith(`${ownerId}\u0000`)).map(([, v]) => v)
        .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
    }
    const { data } = await this.db.from("site_profiles")
      .select("site, blob, who, used_at, fails").eq("owner_id", ownerId).order("used_at", { ascending: false });
    // Only whether it is held on the phone is kept from the slip: the list never carries cookies anywhere.
    const onPhone = (blob: unknown): boolean => {
      try { return (JSON.parse(decrypt(String(blob))) as SiteProfile).onPhone === true; } catch { return false; }
    };
    return (data ?? []).map((r) => ({
      site: String(r.site), profile: { cookies: [], ...(onPhone(r.blob) ? { onPhone: true as const } : {}) }, fails: Number(r.fails ?? 0),
      ...(r.who ? { who: String(r.who) } : {}), ...(ms(r.used_at as string) ? { usedAt: ms(r.used_at as string) } : {}),
    }));
  }

  /** Keep the slip. Encrypting is not optional: with no key `encrypt` throws and nothing is written. */
  async saveLogin(ownerId: string, site: string, profile: SiteProfile, who?: string): Promise<void> {
    const blob = encrypt(JSON.stringify(profile));
    const now = Date.now();
    if (!this.db) {
      this.logins.set(this.key(ownerId, site), { site, profile, fails: 0, usedAt: now, ...(who ? { who } : {}) });
      return;
    }
    await this.db.from("site_profiles").upsert({
      owner_id: ownerId, site, blob, used_at: new Date(now).toISOString(), fails: 0, failed_at: null,
      ...(who ? { who } : {}),
    }, { onConflict: "owner_id,site" });
  }

  /** The site turned us away. Returns how many times in a row now. */
  async noteRefusal(ownerId: string, site: string): Promise<number> {
    if (!this.db) {
      const got = this.logins.get(this.key(ownerId, site));
      if (!got) return 0;
      got.fails += 1;
      return got.fails;
    }
    const { data } = await this.db.from("site_profiles").select("fails").eq("owner_id", ownerId).eq("site", site).maybeSingle();
    const fails = Number(data?.fails ?? 0) + 1;
    await this.db.from("site_profiles").update({ fails, failed_at: new Date().toISOString() })
      .eq("owner_id", ownerId).eq("site", site);
    return fails;
  }

  async forgetLogin(ownerId: string, site: string): Promise<void> {
    if (!this.db) { this.logins.delete(this.key(ownerId, site)); return; }
    await this.db.from("site_profiles").delete().eq("owner_id", ownerId).eq("site", site);
  }

  // ------------------------------------------------------------------ the things watched

  async watch(id: string): Promise<SiteWatch | null> {
    if (!this.db) return this.watches.get(id) ?? null;
    const { data } = await this.db.from("site_watches").select("*").eq("id", id).maybeSingle();
    return data ? this.rowToWatch(data) : null;
  }

  async watchesOf(ownerId: string, states: SiteWatch["state"][] = ["open", "done"]): Promise<SiteWatch[]> {
    if (!this.db) {
      return [...this.watches.values()].filter((w) => w.ownerId === ownerId && states.includes(w.state))
        .sort((a, b) => (b.readAt ?? 0) - (a.readAt ?? 0));
    }
    const { data } = await this.db.from("site_watches").select("*").eq("owner_id", ownerId)
      .in("state", states).order("read_at", { ascending: false, nullsFirst: false }).limit(50);
    return (data ?? []).map((r) => this.rowToWatch(r));
  }

  async openCount(ownerId: string): Promise<number> {
    if (!this.db) return [...this.watches.values()].filter((w) => w.ownerId === ownerId && w.state === "open").length;
    const { count } = await this.db.from("site_watches").select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId).eq("state", "open");
    return count ?? 0;
  }

  async addWatch(w: Omit<SiteWatch, "id">): Promise<SiteWatch> {
    const id = randomUUID();
    const made: SiteWatch = { ...w, id };
    if (!this.db) { this.watches.set(id, made); return made; }
    await this.db.from("site_watches").insert({
      id, owner_id: w.ownerId, site: w.site, url: w.url, label: w.label, state: w.state,
      ...(w.nextAt ? { next_at: new Date(w.nextAt).toISOString() } : {}),
    });
    return made;
  }

  async saveRead(id: string, card: SiteCard | undefined, state: SiteWatch["state"], nextAt?: number): Promise<void> {
    const now = Date.now();
    if (!this.db) {
      const got = this.watches.get(id);
      if (got) {
        // A failed read keeps the card it had: a blank card would read as "nothing is happening", which is a lie.
        if (card) got.card = card;
        got.state = state; got.readAt = now;
        if (nextAt) got.nextAt = nextAt; else delete got.nextAt;
      }
      return;
    }
    await this.db.from("site_watches").update({
      ...(card ? { card } : {}), state, read_at: new Date(now).toISOString(),
      next_at: nextAt ? new Date(nextAt).toISOString() : null,
      ...(state === "done" ? { done_at: new Date(now).toISOString() } : {}),
    }).eq("id", id);
  }

  async setWatchState(id: string, state: SiteWatch["state"]): Promise<void> {
    if (!this.db) { const got = this.watches.get(id); if (got) { got.state = state; delete got.nextAt; } return; }
    await this.db.from("site_watches").update({ state, next_at: null }).eq("id", id);
  }

  /** The open things whose turn it is, oldest first. */
  async due(now: number, limit = 20): Promise<SiteWatch[]> {
    if (!this.db) {
      return [...this.watches.values()].filter((w) => w.state === "open" && (w.nextAt ?? 0) <= now)
        .sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0)).slice(0, limit);
    }
    const { data } = await this.db.from("site_watches").select("*").eq("state", "open")
      .lte("next_at", new Date(now).toISOString()).order("next_at", { ascending: true }).limit(limit);
    return (data ?? []).map((r) => this.rowToWatch(r));
  }

  private rowToWatch(r: Record<string, unknown>): SiteWatch {
    return {
      id: String(r.id), ownerId: String(r.owner_id), site: String(r.site), url: String(r.url),
      label: String(r.label ?? ""), state: (r.state as SiteWatch["state"]) ?? "open",
      ...(r.card ? { card: r.card as SiteCard } : {}),
      ...(ms(r.read_at as string) ? { readAt: ms(r.read_at as string) } : {}),
      ...(ms(r.next_at as string) ? { nextAt: ms(r.next_at as string) } : {}),
    };
  }
}

let shared: SiteStore | null = null;
export const siteStore = (): SiteStore => (shared ??= new SiteStore());
