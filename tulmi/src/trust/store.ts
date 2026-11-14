/**
 * WHERE THE ABUSE-PREVENTION ROWS LIVE (migration 0093_trust_signals.sql; docs/trust.md §storage).
 *
 *   seeNet / countAccountsOnNet            a (network key, account, day) row, and HOW MANY accounts a network key has seen
 *   seeDevice / countAccountsOnDevice      the same for the install id (8.4), behind its own flag
 *   tombstone / tombstoned                 what a deleted account leaves for 30 days, to stop a free-plan reset. No user id
 *   putAttestKey / attestKey / usedAttestKey / countAttestKeys    App Attest's public keys, one per account per install
 *   putScore / score / clearScore          the latest score, its reasons and the verdict summaries
 *   sweep                                  everything older than 30 days, across everyone
 *
 * COUNTED, NEVER JOINED (docs/trust.md rule 9). Every read here answers a number or this one account's own row. Nothing in
 * this file can hand back the OTHER accounts behind a network key, an install key or an email hash — no export returns a list
 * of user ids — so there is no "ban the cluster" to write by accident, and the admin view can only ever show counts.
 *
 * No raw address, no attestation token and no integrity token is stored anywhere. A key is a keyed hash (netKey.ts); the
 * verdicts are summaries ("ok", "fail", two bits, three labels), never the tokens they came from.
 *
 * Supabase with the service key when the server has one, else memory (tests, and a server with none), as the other stores do.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { emailKey } from "./email.js";
import { trustMode } from "./mode.js";
import type { NetClass } from "./netKey.js";

export type DeviceKind = "install";
export type TombstoneKind = "email" | "install";

/** What App Attest leaves us: the device's public key for this account and install, and the counter it signs with. */
export interface AttestKey {
  keyId: string;
  userId: string;
  /** The public key in SPKI form. */
  publicKey: Buffer;
  signCount: number;
  env: "production" | "development";
  receipt: Buffer | null;
  createdAt: number;
  lastUsedAt: number;
}

/** The summaries kept with a score. Never a token, never a device id made from a token's contents. */
export interface Verdicts {
  appAttest?: "ok" | "fail" | "none";
  deviceCheck?: {
    bit0: boolean;
    bit1: boolean;
    /** Apple's last_update_time, as "2026-11" */
    month?: string;
    /**
     * WE wrote bit0 for THIS account (docs/trust.md §DeviceCheck). Apple keeps the bit on the device, so the very next
     * query reads back what we just wrote: without this, an honest new iPhone would flag itself on its second launch. The
     * mark is per account, so the bit still counts for the NEXT account that signs in on that phone, which is its job.
     */
    setByUs?: boolean;
  };
  integrity?: { app?: string; device?: string[]; licence?: string };
  /**
   * When each answer above was given (ms). The policy says Apple's and Google's answers are kept 30 days, so the sweeper
   * needs to know how old each one is: `updated_at` cannot say, because every launch refreshes it.
   */
  at?: { appAttest?: number; deviceCheck?: number; integrity?: number };
  /**
   * An admin cleared this account for a second-hand phone (routes/admin/trust.ts): Apple's own two bits are cleared on
   * this account's next DeviceCheck pass, and this mark goes with them. Not an answer, so the sweeper leaves it alone.
   */
  deviceReset?: boolean;
}

/** The three answers the 30 days apply to. `at` and `deviceReset` are not answers. */
const VERDICT_KINDS = ["appAttest", "deviceCheck", "integrity"] as const;
export type VerdictKind = (typeof VERDICT_KINDS)[number];

/**
 * Apple's and Google's answers, with everything older than `before` dropped, and the time of the oldest answer left (which
 * is when this row next needs looking at). Pure, so the sweeper's rule is one test and not a database.
 */
export function pruneVerdicts(v: Verdicts, before: number): { verdicts: Verdicts; oldest: number | null; changed: boolean } {
  const out: Verdicts = { ...v, ...(v.at ? { at: { ...v.at } } : {}) };
  let changed = false;
  for (const kind of VERDICT_KINDS) {
    if (out[kind] === undefined) continue;
    // An answer with no time on it cannot be shown to be inside the 30 days, so it goes: the policy wins over the signal.
    const at = out.at?.[kind];
    if (at !== undefined && at >= before) continue;
    delete out[kind];
    if (out.at) delete out.at[kind];
    changed = true;
  }
  const times = VERDICT_KINDS.map((k) => out.at?.[k]).filter((n): n is number => typeof n === "number");
  if (out.at && !Object.keys(out.at).length) delete out.at;
  return { verdicts: out, oldest: times.length ? Math.min(...times) : null, changed };
}

/** When this row next needs the sweeper's attention: the oldest answer on it, or null when it holds none. */
export const oldestVerdict = (v: Verdicts): number | null => pruneVerdicts(v, 0).oldest;

export interface TrustScoreRow {
  userId: string;
  score: number;
  reasons: string[];
  action: "none" | "log" | "slow" | "hold" | "ask";
  verdicts: Verdicts;
  updatedAt: number;
}

export interface TrustStore {
  /** `newAcct`: this account was less than a week old when it was seen here, which is the only kind the counts count. */
  seeNet(o: { netKey: Buffer; userId: string; day: string; asn: number | null; netClass: NetClass; newAcct: boolean; at: number }): Promise<void>;
  /**
   * How many NEW accounts this network key has been seen with since `sinceDay`. A number only (rule 9).
   *
   * New ones only, because the signal is "accounts are being MADE here" (docs/trust.md §score: the 3rd and 5th new
   * account on one network). Counting every account on a line would score a shared home, an office or a CGNAT operator
   * for being busy, and the honest new sign-up in that house would be scored for its neighbours.
   */
  countAccountsOnNet(netKey: Buffer, sinceDay: string): Promise<number>;
  seeDevice(o: { deviceKey: Buffer; kind: DeviceKind; userId: string; at: number }): Promise<void>;
  /** How many different accounts this install key has been seen with. A number only (rule 9). */
  countAccountsOnDevice(deviceKey: Buffer, kind?: DeviceKind): Promise<number>;
  tombstone(key: Buffer, kind: TombstoneKind, at: number): Promise<void>;
  tombstoned(key: Buffer, kind: TombstoneKind): Promise<boolean>;
  putAttestKey(row: AttestKey): Promise<void>;
  attestKey(keyId: string): Promise<AttestKey | null>;
  usedAttestKey(keyId: string, signCount: number, at: number): Promise<void>;
  /** How many App Attest keys this account has made. A number only. */
  countAttestKeys(userId: string): Promise<number>;
  putScore(row: TrustScoreRow): Promise<void>;
  score(userId: string): Promise<TrustScoreRow | null>;
  clearScore(userId: string): Promise<void>;
  /** This account's OWN install keys, so a deletion can leave their tombstones. Keys, never the other way round (rule 9). */
  installKeysOf(userId: string): Promise<Buffer[]>;
  /** Everything older than the given times. How many rows went, per table. */
  sweep(o: { beforeDay: string; before: number; attestBefore: number }): Promise<{ net: number; device: number; tombstones: number; attest: number }>;
  /**
   * Apple's and Google's answers, dropped once they are older than `before` (the policy's 30 days). The score row itself
   * stays while the account does — it is recomputed on every launch — but the answers on it are not kept for ever.
   */
  sweepVerdicts(before: number): Promise<number>;
}

const hex = (b: Buffer): string => b.toString("hex");

// ------------------------------------------------------------------ memory

export class MemoryTrustStore implements TrustStore {
  private readonly net = new Map<string, { netKey: string; userId: string; day: string; asn: number | null; netClass: NetClass; newAcct: boolean; hits: number; firstAt: number; lastAt: number }>();
  private readonly devices = new Map<string, { deviceKey: string; kind: DeviceKind; userId: string; firstAt: number; lastAt: number }>();
  private readonly tombs = new Map<string, number>();
  private readonly keys = new Map<string, AttestKey>();
  private readonly scores = new Map<string, TrustScoreRow>();

  async seeNet(o: { netKey: Buffer; userId: string; day: string; asn: number | null; netClass: NetClass; newAcct: boolean; at: number }): Promise<void> {
    const id = `${hex(o.netKey)}|${o.userId}|${o.day}`;
    const had = this.net.get(id);
    if (had) { had.hits += 1; had.lastAt = o.at; had.netClass = o.netClass; return; }
    this.net.set(id, { netKey: hex(o.netKey), userId: o.userId, day: o.day, asn: o.asn, netClass: o.netClass, newAcct: o.newAcct, hits: 1, firstAt: o.at, lastAt: o.at });
  }

  async countAccountsOnNet(netKey: Buffer, sinceDay: string): Promise<number> {
    const k = hex(netKey);
    const seen = new Set<string>();
    for (const r of this.net.values()) if (r.netKey === k && r.day >= sinceDay && r.newAcct) seen.add(r.userId);
    return seen.size;
  }

  async seeDevice(o: { deviceKey: Buffer; kind: DeviceKind; userId: string; at: number }): Promise<void> {
    const id = `${hex(o.deviceKey)}|${o.kind}|${o.userId}`;
    const had = this.devices.get(id);
    if (had) { had.lastAt = o.at; return; }
    this.devices.set(id, { deviceKey: hex(o.deviceKey), kind: o.kind, userId: o.userId, firstAt: o.at, lastAt: o.at });
  }

  async countAccountsOnDevice(deviceKey: Buffer, kind: DeviceKind = "install"): Promise<number> {
    const k = hex(deviceKey);
    const seen = new Set<string>();
    for (const r of this.devices.values()) if (r.deviceKey === k && r.kind === kind) seen.add(r.userId);
    return seen.size;
  }

  async tombstone(key: Buffer, kind: TombstoneKind, at: number): Promise<void> {
    this.tombs.set(`${hex(key)}|${kind}`, at);
  }
  async tombstoned(key: Buffer, kind: TombstoneKind): Promise<boolean> {
    return this.tombs.has(`${hex(key)}|${kind}`);
  }

  async putAttestKey(row: AttestKey): Promise<void> { this.keys.set(row.keyId, { ...row }); }
  async attestKey(keyId: string): Promise<AttestKey | null> {
    const r = this.keys.get(keyId);
    return r ? { ...r } : null;
  }
  async usedAttestKey(keyId: string, signCount: number, at: number): Promise<void> {
    const r = this.keys.get(keyId);
    if (r) { r.signCount = signCount; r.lastUsedAt = at; }
  }
  async countAttestKeys(userId: string): Promise<number> {
    let n = 0;
    for (const r of this.keys.values()) if (r.userId === userId) n += 1;
    return n;
  }

  async putScore(row: TrustScoreRow): Promise<void> { this.scores.set(row.userId, { ...row }); }
  async score(userId: string): Promise<TrustScoreRow | null> {
    const r = this.scores.get(userId);
    return r ? { ...r } : null;
  }
  async clearScore(userId: string): Promise<void> { this.scores.delete(userId); }

  async installKeysOf(userId: string): Promise<Buffer[]> {
    const out: Buffer[] = [];
    for (const r of this.devices.values()) if (r.userId === userId && r.kind === "install") out.push(Buffer.from(r.deviceKey, "hex"));
    return out;
  }

  async sweep(o: { beforeDay: string; before: number; attestBefore: number }): Promise<{ net: number; device: number; tombstones: number; attest: number }> {
    let net = 0, device = 0, tombstones = 0, attest = 0;
    for (const [id, r] of [...this.net]) if (r.day < o.beforeDay) { this.net.delete(id); net += 1; }
    for (const [id, r] of [...this.devices]) if (r.lastAt < o.before) { this.devices.delete(id); device += 1; }
    for (const [id, at] of [...this.tombs]) if (at < o.before) { this.tombs.delete(id); tombstones += 1; }
    for (const [id, r] of [...this.keys]) if (r.lastUsedAt < o.attestBefore) { this.keys.delete(id); attest += 1; }
    return { net, device, tombstones, attest };
  }

  async sweepVerdicts(before: number): Promise<number> {
    let changed = 0;
    for (const row of this.scores.values()) {
      const got = pruneVerdicts(row.verdicts, before);
      if (!got.changed) continue;
      row.verdicts = got.verdicts;
      changed += 1;
    }
    return changed;
  }
}

// ------------------------------------------------------------------ supabase

/** bytea as PostgREST reads and writes it. */
const bytea = (b: Buffer): string => `\\x${b.toString("hex")}`;
const fromBytea = (v: unknown): Buffer => Buffer.from(String(v ?? "").replace(/^\\x/, ""), "hex");
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown): number => Date.parse(String(v ?? "")) || 0;

class SupabaseTrustStore implements TrustStore {
  constructor(private readonly sb: SupabaseClient) {}

  async seeNet(o: { netKey: Buffer; userId: string; day: string; asn: number | null; netClass: NetClass; newAcct: boolean; at: number }): Promise<void> {
    // One row a (key, account, day). The hit count is a best effort: a lost increment costs nothing, a lost row would.
    const { error } = await this.sb.from("trust_net_seen").upsert({
      net_key: bytea(o.netKey), user_id: o.userId, day: o.day, asn: o.asn, net_class: o.netClass,
      new_acct: o.newAcct, hits: 1, first_at: iso(o.at), last_at: iso(o.at),
    }, { onConflict: "net_key,user_id,day", ignoreDuplicates: true });
    if (error) throw new Error(`trust_net_seen: write: ${error.message}`);
  }

  async countAccountsOnNet(netKey: Buffer, sinceDay: string): Promise<number> {
    const { data, error } = await this.sb.from("trust_net_seen").select("user_id")
      .eq("net_key", bytea(netKey)).gte("day", sinceDay).eq("new_acct", true).limit(200);
    if (error) throw new Error(`trust_net_seen: read: ${error.message}`);
    // The ids are counted here and nothing else: this function answers a number, and no caller can ask for the list.
    return new Set((data ?? []).map((r) => String((r as { user_id: unknown }).user_id))).size;
  }

  async seeDevice(o: { deviceKey: Buffer; kind: DeviceKind; userId: string; at: number }): Promise<void> {
    const { error } = await this.sb.from("trust_device_seen").upsert({
      device_key: bytea(o.deviceKey), kind: o.kind, user_id: o.userId, first_at: iso(o.at), last_at: iso(o.at),
    }, { onConflict: "device_key,kind,user_id", ignoreDuplicates: true });
    if (error) throw new Error(`trust_device_seen: write: ${error.message}`);
  }

  async countAccountsOnDevice(deviceKey: Buffer, kind: DeviceKind = "install"): Promise<number> {
    const { data, error } = await this.sb.from("trust_device_seen").select("user_id")
      .eq("device_key", bytea(deviceKey)).eq("kind", kind).limit(200);
    if (error) throw new Error(`trust_device_seen: read: ${error.message}`);
    return new Set((data ?? []).map((r) => String((r as { user_id: unknown }).user_id))).size;
  }

  async tombstone(key: Buffer, kind: TombstoneKind, at: number): Promise<void> {
    const { error } = await this.sb.from("trust_tombstones")
      .upsert({ key: bytea(key), kind, deleted_at: iso(at) }, { onConflict: "key,kind" });
    if (error) throw new Error(`trust_tombstones: write: ${error.message}`);
  }

  async tombstoned(key: Buffer, kind: TombstoneKind): Promise<boolean> {
    const { data, error } = await this.sb.from("trust_tombstones").select("kind")
      .eq("key", bytea(key)).eq("kind", kind).maybeSingle();
    if (error) throw new Error(`trust_tombstones: read: ${error.message}`);
    return !!data;
  }

  async putAttestKey(row: AttestKey): Promise<void> {
    const { error } = await this.sb.from("trust_attest_keys").upsert({
      key_id: row.keyId, user_id: row.userId, public_key: bytea(row.publicKey), sign_count: row.signCount,
      env: row.env, receipt: row.receipt ? bytea(row.receipt) : null,
      created_at: iso(row.createdAt), last_used_at: iso(row.lastUsedAt),
    }, { onConflict: "key_id" });
    if (error) throw new Error(`trust_attest_keys: write: ${error.message}`);
  }

  async attestKey(keyId: string): Promise<AttestKey | null> {
    const { data, error } = await this.sb.from("trust_attest_keys")
      .select("key_id, user_id, public_key, sign_count, env, receipt, created_at, last_used_at")
      .eq("key_id", keyId).maybeSingle();
    if (error) throw new Error(`trust_attest_keys: read: ${error.message}`);
    if (!data) return null;
    const d = data as Record<string, unknown>;
    return {
      keyId: String(d.key_id), userId: String(d.user_id), publicKey: fromBytea(d.public_key),
      signCount: Number(d.sign_count) || 0, env: d.env === "development" ? "development" : "production",
      receipt: d.receipt ? fromBytea(d.receipt) : null, createdAt: ms(d.created_at), lastUsedAt: ms(d.last_used_at),
    };
  }

  async usedAttestKey(keyId: string, signCount: number, at: number): Promise<void> {
    const { error } = await this.sb.from("trust_attest_keys")
      .update({ sign_count: signCount, last_used_at: iso(at) }).eq("key_id", keyId);
    if (error) throw new Error(`trust_attest_keys: write: ${error.message}`);
  }

  async countAttestKeys(userId: string): Promise<number> {
    const { count, error } = await this.sb.from("trust_attest_keys")
      .select("key_id", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw new Error(`trust_attest_keys: read: ${error.message}`);
    return count ?? 0;
  }

  async putScore(row: TrustScoreRow): Promise<void> {
    // `verdicts_at` is the oldest answer on the row, so the sweeper can find the rows whose answers are due to go without
    // reading every account's row. `updated_at` cannot do that job: every launch refreshes it.
    const oldest = oldestVerdict(row.verdicts);
    const { error } = await this.sb.from("trust_scores").upsert({
      user_id: row.userId, score: row.score, reasons: row.reasons, action: row.action,
      verdicts: row.verdicts, verdicts_at: oldest === null ? null : iso(oldest), updated_at: iso(row.updatedAt),
    }, { onConflict: "user_id" });
    if (error) throw new Error(`trust_scores: write: ${error.message}`);
  }

  async score(userId: string): Promise<TrustScoreRow | null> {
    const { data, error } = await this.sb.from("trust_scores")
      .select("user_id, score, reasons, action, verdicts, updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`trust_scores: read: ${error.message}`);
    if (!data) return null;
    const d = data as Record<string, unknown>;
    return {
      userId: String(d.user_id), score: Number(d.score) || 0,
      reasons: Array.isArray(d.reasons) ? d.reasons.map(String) : [],
      action: (["none", "log", "slow", "hold", "ask"].includes(String(d.action)) ? String(d.action) : "none") as TrustScoreRow["action"],
      verdicts: (d.verdicts && typeof d.verdicts === "object" ? d.verdicts : {}) as Verdicts,
      updatedAt: ms(d.updated_at),
    };
  }

  async clearScore(userId: string): Promise<void> {
    const { error } = await this.sb.from("trust_scores").delete().eq("user_id", userId);
    if (error) throw new Error(`trust_scores: delete: ${error.message}`);
  }

  async installKeysOf(userId: string): Promise<Buffer[]> {
    const { data, error } = await this.sb.from("trust_device_seen").select("device_key")
      .eq("user_id", userId).eq("kind", "install").limit(50);
    if (error) throw new Error(`trust_device_seen: read: ${error.message}`);
    return (data ?? []).map((r) => fromBytea((r as { device_key: unknown }).device_key));
  }

  async sweep(o: { beforeDay: string; before: number; attestBefore: number }): Promise<{ net: number; device: number; tombstones: number; attest: number }> {
    const count = async (table: string, apply: (q: never) => unknown): Promise<number> => {
      const q = this.sb.from(table).delete({ count: "exact" }) as unknown as never;
      const { error, count: n } = (await apply(q)) as { error: { message: string } | null; count: number | null };
      if (error) throw new Error(`${table}: sweep: ${error.message}`);
      return n ?? 0;
    };
    const net = await count("trust_net_seen", (q) => (q as unknown as { lt: (c: string, v: string) => unknown }).lt("day", o.beforeDay));
    const device = await count("trust_device_seen", (q) => (q as unknown as { lt: (c: string, v: string) => unknown }).lt("last_at", iso(o.before)));
    const tombstones = await count("trust_tombstones", (q) => (q as unknown as { lt: (c: string, v: string) => unknown }).lt("deleted_at", iso(o.before)));
    const attest = await count("trust_attest_keys", (q) => (q as unknown as { lt: (c: string, v: string) => unknown }).lt("last_used_at", iso(o.attestBefore)));
    return { net, device, tombstones, attest };
  }

  async sweepVerdicts(before: number): Promise<number> {
    // Only the rows that hold an answer older than the cutoff, which `verdicts_at` says without reading the jsonb.
    const { data, error } = await this.sb.from("trust_scores").select("user_id, verdicts")
      .lt("verdicts_at", iso(before)).limit(500);
    if (error) throw new Error(`trust_scores: sweep: ${error.message}`);
    let changed = 0;
    for (const raw of (data ?? []) as Array<{ user_id: unknown; verdicts: unknown }>) {
      const had = (raw.verdicts && typeof raw.verdicts === "object" ? raw.verdicts : {}) as Verdicts;
      const got = pruneVerdicts(had, before);
      if (!got.changed) continue;
      const { error: wrote } = await this.sb.from("trust_scores")
        .update({ verdicts: got.verdicts, verdicts_at: got.oldest === null ? null : iso(got.oldest) })
        .eq("user_id", String(raw.user_id));
      if (wrote) throw new Error(`trust_scores: sweep: ${wrote.message}`);
      changed += 1;
    }
    return changed;
  }
}

let made: TrustStore | undefined;

/** The store: Supabase with the service key, else memory. */
export function trustStore(): TrustStore {
  if (!made) {
    const sb = supabase();
    made = sb ? new SupabaseTrustStore(sb) : new MemoryTrustStore();
  }
  return made;
}

/** Tests: a fresh store. */
export function resetTrustStoreForTests(store?: TrustStore): void { made = store ?? new MemoryTrustStore(); }

/**
 * WHAT A DELETED ACCOUNT LEAVES BEHIND, AND WHY (docs/trust.md §tombstones; the privacy policy says it in words).
 *
 * Deleting an account resets the free plan, so without this one row the cheapest way to get another $35 of model spend is to
 * delete and sign up again. So, for 30 days: a one-way hash of the account's email address and of its install id (8.4), with
 * NO user id and nothing else. It cannot be turned back into an address, it says nothing about the person, and after 30 days
 * it is swept away like every other row here.
 *
 * Nothing attestation-derived is ever tombstoned: App Attest's keys are per account per install, and DeviceCheck's and Play
 * Integrity's tokens carry no stable device id we are allowed to keep. The per-device memory is Apple's and Google's own.
 *
 * Called just before the real delete (routes/account/account.ts eraseAccount, which both ways in go through), so a cancelled
 * deletion leaves nothing. Never throws.
 *
 * WITH TRUST OFF, NOTHING IS WRITTEN. The kill switch has to mean it: while abuse prevention is off (or has no key), there
 * is nothing to stop a free-plan reset with, so keeping a hash of a deleted account's address would be keeping it for
 * nothing — and the sweeper is the only thing that would ever take it away again.
 */
export async function tombstoneAccount(userId: string, o: { now?: number; store?: TrustStore; email?: string } = {}): Promise<{ email: boolean; installs: number }> {
  if (trustMode() === "off") return { email: false, installs: 0 };
  const now = o.now ?? Date.now();
  const store = o.store ?? trustStore();
  let email = o.email;
  if (email === undefined) {
    const sb = supabase();
    if (sb) email = (await sb.auth.admin.getUserById(userId).catch(() => null))?.data?.user?.email ?? undefined;
  }
  const key = email ? emailKey(email) : null;
  if (key) await store.tombstone(key, "email", now);
  const installs = await store.installKeysOf(userId).catch(() => [] as Buffer[]);
  for (const k of installs) await store.tombstone(k, "install", now);
  return { email: !!key, installs: installs.length };
}
