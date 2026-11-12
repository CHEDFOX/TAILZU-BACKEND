/**
 * FOLLOW-THROUGH'S REACH: NUMBERS, KEYS AND CAPS (PLAN_V2_FOLLOW; docs/plan-ease.md "Follow-through").
 *
 *   reachKey / reachReady        the key every number hash and every call MAC is made with (from CONNECTOR_TOKEN_KEY, labelled)
 *   e164Of / sealNumber / openNumber / numberHash   a number as it is typed, kept sealed, and looked up by a keyed hash only: the number the
 *                                asker keeps for someone on their items (their own Call button, plan_numbers: X0 never dials it), and a
 *                                person's own number for real phone calls, which they turned on themselves (plan_phones, the phone channel)
 *   replyMac / macOk             what binds a real phone call's keypad (press 1, 2 or 3) to one step of one follow for one person
 *   publicOrigin                 where the phone provider's callbacks come back to (the phone channel, planFollowChannels.ts)
 *   capTake / capGive / capTakeAll   the day's louder pings and calls, shared by every server (compare-and-swap on plan_reach_caps)
 *
 * Nothing here logs a number or a MAC.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { decrypt, encrypt, tokenKey } from "../connectors/crypto.js";
import type { CapTable } from "./planFollowStore.js";
import { isDuplicate } from "./planFollowStore.js";

/** The reach key: HMAC-SHA256(tokenKey(), "tailzu:plan:reach:v1") from connectors/crypto.ts. Throws when CONNECTOR_TOKEN_KEY is missing. */
export function reachKey(): Buffer {
  return createHmac("sha256", tokenKey()).update("tailzu:plan:reach:v1").digest();
}

/** CONNECTOR_TOKEN_KEY is set: numbers can be kept (sealed) and call MACs made. Without it: no number field, no real calls. */
export function reachReady(): boolean {
  try { tokenKey(); return true; } catch { return false; }
}

/** E.164 or null: "+<8–15 digits>"; 10 digits starting 6–9 become "+91…"; "0" + 10 digits and "91" + 10 digits too. */
export function e164Of(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (!s || s.length > 32 || !/^\+?[\d\s().-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
  const india = (ten: string): string | null => (/^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null);
  if (digits.length === 10) return india(digits);
  if (digits.length === 11 && digits.startsWith("0")) return india(digits.slice(1));
  if (digits.length === 12 && digits.startsWith("91")) return india(digits.slice(2));
  return null;
}

/** The number sealed (connectors/crypto.ts encrypt): the asker's own Call button (tel: from their phone), and a person's own number for real calls. */
export function sealNumber(e164: string, key?: Buffer): string { return encrypt(e164, key ?? tokenKey()); }

/** The number back; null on any failure (a rotated key, an altered seal). */
export function openNumber(seal: string, key?: Buffer): string | null {
  try { return decrypt(seal, key ?? tokenKey()); } catch { return null; }
}

const hmacHex = (key: Buffer, s: string): string => createHmac("sha256", key).update(s).digest("hex");

/** hex HMAC(key, "n:" + e164): how a number is found (the inbound call that proves it) without opening any seal. */
export function numberHash(e164: string, key?: Buffer): string { return hmacHex(key ?? reachKey(), `n:${e164}`); }

/** The MAC that binds a real phone call to one step of one follow for one person: base64url(HMAC(key, `${followId}.${n}.${person}`)).slice(0, 16). */
export function replyMac(followId: string, n: number, person: string, key?: Buffer): string {
  return createHmac("sha256", key ?? reachKey()).update(`${followId}.${n}.${person}`).digest("base64url").slice(0, 16);
}

export function macOk(followId: string, n: number, person: string, mac: string, key?: Buffer): boolean {
  if (typeof mac !== "string" || mac.length !== 16) return false;
  let want: string;
  try { want = replyMac(followId, n, person, key); } catch { return false; }
  const a = Buffer.from(want), b = Buffer.from(mac);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** (process.env.PUBLIC_ORIGIN || "https://api.x0bot.com") without a trailing "/": the phone provider's callbacks come back here. */
export function publicOrigin(): string { return (process.env.PUBLIC_ORIGIN || "https://api.x0bot.com").replace(/\/+$/, ""); }

// ------------------------------------------------------------------ the day's caps

const TRIES = 4;

/**
 * One more for `person` today, if under `max`: compare-and-swap on plan_reach_caps.n (insert n = 1 when there is no row). A lost swap or a
 * duplicate insert reads again and tries again, 4 tries in all, so two servers at once never make a person look over the cap when they
 * are not. Keys (migration 0081): "u:<id>" a person's louder pings, X0 calls and real calls (their ringMax); "p:<id>" their real calls;
 * "ap:<asker>" real calls for one asker's items; "all:p" the server's real calls (a UTC day).
 */
export async function capTake(caps: CapTable, person: string, day: string, max: number): Promise<boolean> {
  if (!(max > 0)) return false;
  for (let i = 0; i < TRIES; i += 1) {
    const row = (await caps.select({ person, day }, { limit: 1 }))[0];
    if (!row) {
      try { await caps.insert({ person, day, n: 1 }); return true; } catch (err) { if (isDuplicate(err)) continue; throw err; }
    }
    const n = Number(row.n) || 0;
    if (n >= max) return false;
    if (await caps.update({ person, day, n }, { n: n + 1 })) return true;
  }
  return false;
}

/** Gives one back (never below 0) when what it was taken for did not go: a ring planCall refused, a call that failed before leaving. */
export async function capGive(caps: CapTable, person: string, day: string): Promise<void> {
  for (let i = 0; i < TRIES; i += 1) {
    const row = (await caps.select({ person, day }, { limit: 1 }))[0];
    const n = Number(row?.n) || 0;
    if (!row || n <= 0) return;
    if (await caps.update({ person, day, n }, { n: n - 1 })) return;
  }
}

/** Takes every key in order, all or none (each one taken is given back when a later one is full). */
export async function capTakeAll(caps: CapTable, takes: Array<{ person: string; day: string; max: number }>): Promise<boolean> {
  const taken: Array<{ person: string; day: string }> = [];
  for (const t of takes) {
    let got = false;
    try { got = await capTake(caps, t.person, t.day, t.max); } catch { got = false; }
    if (!got) {
      for (const g of taken.reverse()) await capGive(caps, g.person, g.day).catch(() => undefined);
      return false;
    }
    taken.push(t);
  }
  return true;
}

/** Gives back every key `capTakeAll` took. */
export async function capGiveAll(caps: CapTable, takes: Array<{ person: string; day: string }>): Promise<void> {
  for (const t of takes) await capGive(caps, t.person, t.day).catch(() => undefined);
}
