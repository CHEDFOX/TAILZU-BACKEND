/**
 * THE USERNAME: the one name a person is reached by (docs/username.md; migration 0110).
 *
 *   cleanUsername(v)          what someone typed, as a username ("@Aanya " -> "aanya"); "" when it is not one
 *   checkShape(name)          the shape alone, with the line to show when it is wrong (no database, so a screen can say it at once)
 *   free(name)                nobody holds it, it is not ours, and nobody has given it up
 *   claim(userId, name)       take it: "ok", "taken", "too_soon" or "blocked"
 *   usernameOf(userId)        theirs
 *   idFor(name)               whose it is, for adding someone by username: the id alone, never anything about them
 *   namesStarting(start, n)   the usernames that start with what was typed (Add a person, as they type): name and id only
 *
 * EVERY ACCOUNT HAS ONE from the moment it is made (the trigger in 0110), so adding by username can rely on it. The one a person
 * is given is a word pair and a number, never a running count: a number in order would say how many accounts there are and let
 * anyone walk them.
 *
 * A NAME IS NEVER GIVEN TWICE. Giving one up tombstones it ('freed'): a connection survives a change because it holds a user id,
 * but a name typed into a message a year ago does not, so a freed name must never come to mean a different person.
 *
 * WHAT A LOOK-UP SAYS. free() answers yes or no and nothing else, and idFor() gives an id and nothing else: no name, no picture,
 * no spaces. Asking is rate limited by its route, as codes are (botsBots/spaceJoin.ts guessing()), because asking repeatedly is
 * how a list of everyone would be made.
 */
import { BotError } from "../bots/index.js";
import { screenPost } from "../botsBots/filter.js";
import { supabase } from "../auth/supabase.js";

/**
 * A deploy and a migration are two separate acts, and not always in that order (profile/store.ts does the same): until 0110 has
 * run there is no username column and no ledger. Reading then says "no username" rather than taking the card, or the bootstrap
 * that draws it, down with it. Claiming still throws, because a claim that quietly did nothing would be worse.
 */
const notMigrated = (message: string): boolean => {
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache");
};

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Lower case letters, digits, _ and -, starting and ending with a letter or digit. The same check the database holds. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/;
/** Once they have picked one themselves, the next change waits this long. The first change, off the one they were given, is free. */
export const CHANGE_EVERY_MS = 30 * 24 * 60 * 60 * 1000;

export type ClaimResult = "ok" | "taken" | "too_soon" | "blocked";

/** Tests and a server with no Supabase: the ledger in memory, by the same rules. */
const held = new Map<string, string>();
const freed = new Set<string>();
/** How many names they have given up. The one they were given counts as the first, as it does in the database. */
const gaveUp = new Map<string, number>();
const lastPick = new Map<string, number>();

/** Injectable, as the other brakes in here are (artifacts/limits.ts), so pacing can be tested without waiting a month. */
let now: () => number = Date.now;
export function setUsernameClockForTests(fn: () => number): void { now = fn; }
/** The same list the database holds (migration 0110). Three characters at least, as the shape demands. */
const RESERVED = new Set([
  "x0bot", "tailzu", "tulmi", "blip", "keybot", "xode", "oracle",
  "admin", "support", "help", "root", "system", "staff", "team", "official",
  "everyone", "here", "all", "you", "null", "undefined", "anonymous", "someone",
]);

/** Tests: forget every name taken in memory. */
export function resetUsernamesForTests(): void {
  held.clear();
  freed.clear();
  gaveUp.clear();
  lastPick.clear();
  now = Date.now;
}

/** What someone typed, as a username: the "@" off, spaces off, lower case. "" when it could never be one. */
export function cleanUsername(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim().replace(/^@+/, "").toLowerCase();
  return s.length >= USERNAME_MIN && s.length <= USERNAME_MAX ? s : "";
}

/**
 * The shape alone: no database, so the card can say what is wrong as it is typed. The lines are what a person reads, so they say
 * what to do rather than naming a rule.
 */
export function checkShape(raw: unknown): { ok: true; name: string } | { ok: false; why: string } {
  const s = typeof raw === "string" ? raw.trim().replace(/^@+/, "").toLowerCase() : "";
  if (!s) return { ok: false, why: "Pick a username." };
  if (s.length < USERNAME_MIN) return { ok: false, why: `At least ${USERNAME_MIN} characters.` };
  if (s.length > USERNAME_MAX) return { ok: false, why: `At most ${USERNAME_MAX} characters.` };
  if (/[^a-z0-9_-]/.test(s)) return { ok: false, why: "Letters, numbers, - and _ only." };
  if (!USERNAME_RE.test(s)) return { ok: false, why: "Start and end with a letter or number." };
  return { ok: true, name: s };
}

/** Nobody holds it, it is not ours, and nobody has given it up. A bad shape is never free. */
export async function free(raw: unknown): Promise<boolean> {
  const shape = checkShape(raw);
  if (!shape.ok) return false;
  const sb = supabase();
  if (!sb) return !held.has(shape.name) && !freed.has(shape.name) && !RESERVED.has(shape.name);
  const { data, error } = await sb.from("usernames").select("name").eq("name", shape.name).maybeSingle();
  if (error) {
    if (notMigrated(error.message)) return false;
    throw new Error(`usernames: read: ${error.message}`);
  }
  return !data;
}

export async function usernameOf(userId: string): Promise<string> {
  const sb = supabase();
  if (!sb) return [...held.entries()].find(([, id]) => id === userId)?.[0] ?? "";
  const { data, error } = await sb.from("profiles").select("username").eq("user_id", userId).maybeSingle();
  if (error) {
    if (notMigrated(error.message)) return "";
    throw new Error(`usernames: read: ${error.message}`);
  }
  return (data?.username as string | undefined) ?? "";
}

/** Whose a username is: the id alone. Null when nobody holds it (a freed or reserved name is nobody's). */
export async function idFor(raw: unknown): Promise<string | null> {
  const shape = checkShape(raw);
  if (!shape.ok) return null;
  const sb = supabase();
  if (!sb) return held.get(shape.name) ?? null;
  const { data, error } = await sb.from("usernames").select("user_id").eq("name", shape.name).eq("kind", "held").maybeSingle();
  if (error) {
    if (notMigrated(error.message)) return null;
    throw new Error(`usernames: read: ${error.message}`);
  }
  return (data?.user_id as string | undefined) ?? null;
}

/** A LIKE pattern's own characters, taken literally. */
const likeSafe = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The usernames that start with what was typed, in order, held ones only: each with its holder's id. For adding a person as they
 * type (botsBots/spaceJoin.ts search, which hides blocks and brakes the asking). A start shorter than USERNAME_MIN finds nothing.
 */
export async function namesStarting(raw: unknown, limit: number): Promise<Array<{ name: string; userId: string }>> {
  const start = typeof raw === "string" ? raw.trim().replace(/^@+/, "").toLowerCase() : "";
  if (start.length < USERNAME_MIN || start.length > USERNAME_MAX || /[^a-z0-9_-]/.test(start)) return [];
  const n = Math.max(1, Math.min(20, Math.floor(limit)));
  const sb = supabase();
  if (!sb) {
    return [...held.entries()].filter(([name]) => name.startsWith(start)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, n).map(([name, userId]) => ({ name, userId }));
  }
  const { data, error } = await sb.from("usernames").select("name, user_id").eq("kind", "held").like("name", `${likeSafe(start)}%`).order("name").limit(n);
  if (error) {
    if (notMigrated(error.message)) return [];
    throw new Error(`usernames: search: ${error.message}`);
  }
  return (data ?? []).map((r) => ({ name: String(r.name), userId: String(r.user_id) }));
}

/**
 * Take a username. "taken" covers held, ours and given up alike, so asking never says which: a name nobody can have reads the
 * same as one someone has. "blocked" is the screen every name a person writes goes through (botsBots/filter.ts).
 */
export async function claim(userId: string, raw: unknown): Promise<ClaimResult> {
  const shape = checkShape(raw);
  if (!shape.ok) throw new BotError("bad_request", shape.why);
  const name = shape.name;
  if (name === (await usernameOf(userId))) return "ok";

  try {
    await screenPost([name]);
  } catch {
    return "blocked";
  }

  const sb = supabase();
  if (!sb) {
    const mine = [...held.entries()].find(([, id]) => id === userId)?.[0];
    const changes = gaveUp.get(userId) ?? 0;
    if (changes >= 1 && (lastPick.get(userId) ?? 0) > now() - CHANGE_EVERY_MS) return "too_soon";
    if (held.has(name) || freed.has(name) || RESERVED.has(name)) return "taken";
    if (mine) { held.delete(mine); freed.add(mine); }
    // The first claim stands in for giving up the name they were given at sign-up, which the database's trigger makes and
    // this map does not: so the count reaches 1 here too, and pacing starts at the same change either way.
    held.set(name, userId);
    gaveUp.set(userId, changes + 1);
    lastPick.set(userId, now());
    return "ok";
  }

  if (await tooSoon(sb, userId)) return "too_soon";
  const { data, error } = await sb.rpc("claim_username", { who: userId, want: name });
  if (error) throw new Error(`usernames: claim: ${error.message}`);
  return data === true ? "ok" : "taken";
}

/** They have picked one themselves before, and it has not been long enough since. */
async function tooSoon(sb: NonNullable<ReturnType<typeof supabase>>, userId: string): Promise<boolean> {
  const { data: gaveUp, error: e1 } = await sb.from("usernames").select("name").eq("user_id", userId).eq("kind", "freed").limit(1);
  if (e1) throw new Error(`usernames: read: ${e1.message}`);
  if (!gaveUp?.length) return false;
  const { data: p, error: e2 } = await sb.from("profiles").select("username_ms").eq("user_id", userId).maybeSingle();
  if (e2) throw new Error(`usernames: read: ${e2.message}`);
  const at = Number(p?.username_ms ?? 0) || 0;
  return at > now() - CHANGE_EVERY_MS;
}
