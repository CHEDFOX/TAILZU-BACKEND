/**
 * WHERE THE YOU TAB KEEPS ITS OWN THINGS (supabase/migrations/0041_you.sql): the person's settings (monthly limit, stop at it, what pings them, the
 * screen-picture choice), what each bot answer cost, and the computers that have helped.
 *
 * Supabase with the service key when the server has one, else memory (a restart forgets it, as every other store here). A read that fails is the
 * defaults, never an error page: the screens draw what is true.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { DEFAULT_SETTINGS, cleanSettings, type YouSettings } from "./settings.js";

export interface SpendRow { bot: string; at: number; paise: number }
export interface ComputerRow { deviceId: string; name: string; os: string; firstSeen: number; lastSeen: number }

export interface YouStore {
  getSettings(userId: string): Promise<YouSettings>;
  putSettings(userId: string, s: YouSettings, now: number): Promise<YouSettings>;
  /** People who turned the daily summary on (for the summary's clock), at most `limit`. */
  summaryPeople(limit: number): Promise<Array<{ userId: string; settings: YouSettings }>>;
  addSpend(userId: string, bot: string, paise: number, at: number): Promise<void>;
  spendSince(userId: string, since: number): Promise<SpendRow[]>;
  seeComputer(userId: string, c: { deviceId: string; name: string; os: string }, now: number): Promise<void>;
  listComputers(userId: string): Promise<ComputerRow[]>;
  removeComputer(userId: string, deviceId: string): Promise<boolean>;
  /** Every row of this person's here, for "Download my data". */
  exportRows(userId: string): Promise<{ settings: YouSettings; spend: SpendRow[]; computers: ComputerRow[] }>;
}

const SPEND_READ_MAX = 5000;
const COMPUTERS_MAX = 20;

// -------------------------------------------------------------------- memory

export class MemoryYouStore implements YouStore {
  private readonly settings = new Map<string, YouSettings>();
  private readonly spend = new Map<string, SpendRow[]>();
  private readonly computers = new Map<string, Map<string, ComputerRow>>();

  async getSettings(userId: string) { return structuredClone(this.settings.get(userId) ?? DEFAULT_SETTINGS); }
  async putSettings(userId: string, s: YouSettings) { this.settings.set(userId, structuredClone(s)); return structuredClone(s); }
  async summaryPeople(limit: number) {
    return [...this.settings].filter(([, s]) => s.notify.summary).slice(0, limit).map(([userId, settings]) => ({ userId, settings: structuredClone(settings) }));
  }
  async addSpend(userId: string, bot: string, paise: number, at: number) {
    const list = this.spend.get(userId) ?? [];
    list.push({ bot, at, paise });
    // Forty days are all a month's screens read.
    this.spend.set(userId, list.filter((r) => at - r.at < 40 * 86_400_000).slice(-SPEND_READ_MAX));
  }
  async spendSince(userId: string, since: number) { return (this.spend.get(userId) ?? []).filter((r) => r.at >= since).map((r) => ({ ...r })); }
  async seeComputer(userId: string, c: { deviceId: string; name: string; os: string }, now: number) {
    const mine = this.computers.get(userId) ?? new Map<string, ComputerRow>();
    const before = mine.get(c.deviceId);
    mine.set(c.deviceId, { deviceId: c.deviceId, name: c.name, os: c.os, firstSeen: before?.firstSeen ?? now, lastSeen: now });
    if (mine.size > COMPUTERS_MAX) {
      const oldest = [...mine.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0]!;
      mine.delete(oldest.deviceId);
    }
    this.computers.set(userId, mine);
  }
  async listComputers(userId: string) { return [...(this.computers.get(userId)?.values() ?? [])].sort((a, b) => b.lastSeen - a.lastSeen).map((c) => ({ ...c })); }
  async removeComputer(userId: string, deviceId: string) { return this.computers.get(userId)?.delete(deviceId) ?? false; }
  async exportRows(userId: string) {
    return { settings: await this.getSettings(userId), spend: await this.spendSince(userId, 0), computers: await this.listComputers(userId) };
  }
}

// -------------------------------------------------------------------- supabase

const ms = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : 0) || 0;
const iso = (t: number): string => new Date(t).toISOString();

export class SupabaseYouStore implements YouStore {
  constructor(private readonly sb: SupabaseClient) {}

  private settingsOf(r: Record<string, unknown> | null): YouSettings {
    if (!r) return structuredClone(DEFAULT_SETTINGS);
    return cleanSettings({ monthLimitPaise: r.month_limit_paise, stopAtLimit: r.stop_at_limit, notify: r.notify, privacy: r.privacy });
  }

  async getSettings(userId: string) {
    const { data, error } = await this.sb.from("you_settings").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`you store: ${error.message}`);
    return this.settingsOf(data as Record<string, unknown> | null);
  }

  async putSettings(userId: string, s: YouSettings, now: number) {
    const { error } = await this.sb.from("you_settings").upsert({
      user_id: userId, month_limit_paise: s.monthLimitPaise, stop_at_limit: s.stopAtLimit, notify: s.notify, privacy: s.privacy, updated_at: iso(now),
    }, { onConflict: "user_id" });
    if (error) throw new Error(`you store: ${error.message}`);
    return structuredClone(s);
  }

  async summaryPeople(limit: number) {
    const { data, error } = await this.sb.from("you_settings").select("*").eq("notify->>summary", "true").limit(limit);
    if (error) throw new Error(`you store: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ userId: String(r.user_id), settings: this.settingsOf(r) }));
  }

  async addSpend(userId: string, bot: string, paise: number, at: number) {
    const { error } = await this.sb.from("you_spend").insert({ user_id: userId, bot: bot.slice(0, 64), paise: Math.max(0, Math.round(paise)), at: iso(at) });
    if (error) throw new Error(`you store: ${error.message}`);
  }

  async spendSince(userId: string, since: number) {
    const { data, error } = await this.sb.from("you_spend").select("bot, at, paise").eq("user_id", userId).gte("at", iso(since))
      .order("at", { ascending: false }).limit(SPEND_READ_MAX);
    if (error) throw new Error(`you store: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ bot: String(r.bot), at: ms(r.at), paise: Number(r.paise) || 0 }));
  }

  async seeComputer(userId: string, c: { deviceId: string; name: string; os: string }, now: number) {
    const { error } = await this.sb.from("you_computers").upsert({
      user_id: userId, device_id: c.deviceId.slice(0, 128), name: c.name.slice(0, 80), os: c.os.slice(0, 40), last_seen: iso(now),
    }, { onConflict: "user_id,device_id" });
    if (error) throw new Error(`you store: ${error.message}`);
  }

  async listComputers(userId: string) {
    const { data, error } = await this.sb.from("you_computers").select("*").eq("user_id", userId).order("last_seen", { ascending: false }).limit(COMPUTERS_MAX);
    if (error) throw new Error(`you store: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      deviceId: String(r.device_id), name: String(r.name ?? ""), os: String(r.os ?? ""), firstSeen: ms(r.first_seen), lastSeen: ms(r.last_seen),
    }));
  }

  async removeComputer(userId: string, deviceId: string) {
    const { error, count } = await this.sb.from("you_computers").delete({ count: "exact" }).eq("user_id", userId).eq("device_id", deviceId);
    if (error) throw new Error(`you store: ${error.message}`);
    return (count ?? 0) > 0;
  }

  async exportRows(userId: string) {
    const [settings, spend, computers] = await Promise.all([this.getSettings(userId), this.spendSince(userId, 0), this.listComputers(userId)]);
    return { settings, spend, computers };
  }
}

let current: YouStore | null = null;

/** The process's store: Supabase when the server has the service key, else memory. */
export function youStore(): YouStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseYouStore(sb) : new MemoryYouStore();
  }
  return current;
}

export function setYouStoreForTests(s: YouStore | null): void { current = s; }

// -------------------------------------------------------------------- signed-in desktops

/**
 * A COMPUTER SIGNED IN AS THE PERSON, before its X0 Code runner is on. The runner (off until they turn it on) is the
 * only thing that reported a computer, so someone signed in on their Mac saw "No computer yet". The desktop app's own
 * screen requests say what it is (formFactor "desktop", its os), so each one is kept as a row "app:<os>", one per kind
 * of computer (the window sends no name of its own), written at most every few minutes per person.
 */
export const APP_COMPUTER = "app:";
const APP_SEEN_EVERY_MS = 10 * 60_000;
const appSeen = new Map<string, number>();

/** "mac", "windows" or "linux", from either what the window says or Node's process.platform; "" for anything else. */
export function computerOs(os: string | undefined): "mac" | "windows" | "linux" | "" {
  const o = String(os ?? "").toLowerCase();
  return o === "mac" || o === "darwin" || o === "macos" ? "mac" : o === "windows" || o === "win32" ? "windows" : o === "linux" ? "linux" : "";
}

/** The desktop app, signed in as this person, asked for a screen: keep (or freshen) its row. Never throws. */
export function seeDesktopApp(userId: string, os: string | undefined, now = Date.now(), store: YouStore = youStore()): void {
  const kind = computerOs(os);
  if (!userId || !kind) return;
  const key = `${userId}:${kind}`;
  if (now - (appSeen.get(key) ?? 0) < APP_SEEN_EVERY_MS) return;
  if (appSeen.size > 50_000) appSeen.clear();
  appSeen.set(key, now);
  const name = kind === "mac" ? "Your Mac" : kind === "windows" ? "Your Windows PC" : "Your Linux computer";
  void store.seeComputer(userId, { deviceId: APP_COMPUTER + kind, name, os: kind }, now).catch(() => appSeen.delete(key));
}

export function resetDesktopAppSeenForTests(): void { appSeen.clear(); }
