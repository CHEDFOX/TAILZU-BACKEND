/**
 * THE KEYED HASH, AND THE LITTLE BIT OF ADDRESS MATHS EVERYTHING ELSE HERE NEEDS (docs/trust.md §network key).
 *
 * No raw IP address is ever stored or logged. What is stored is HMAC-SHA256(TRUST_HASH_KEY, "n1|" + address) cut to 16 bytes:
 * the full address for IPv4, the /64 for IPv6 (one home gets one key, not one per device). A coarser key per /24 or /48 is
 * used for bursts and never leaves memory.
 *
 * BE HONEST ABOUT WHAT THIS IS. It is pseudonymous, not anonymous: IPv4 has only 2^32 values, so whoever holds the key could
 * test an address against a row. So the key lives only in the server's .env (never in Supabase, a backup, a log or the repo),
 * the rows are treated as personal data (30 days, deleted with the account, named in the privacy policy), and the policy says
 * "keyed hash", never "anonymous". With no key set, every function here answers null and nothing is collected at all.
 *
 * The same keyed hash makes the email key (for repeats and the deletion tombstone) and the install key (8.4). The labels keep
 * the three apart, so one table's key can never be looked up in another.
 */
import { createHmac } from "node:crypto";
import { getConfig } from "../config.js";

/** How a network is described. Nothing finer, and never a place: no country, city or location is worked out from an address. */
export type NetClass = "home" | "mobile" | "hosting" | "vpn" | "tor" | "relay" | "unknown";

/** The three things a key can be made of. The label goes into the hash, so the keys cannot be compared across kinds. */
export type KeyKind = "net" | "email" | "install";
const LABEL: Record<KeyKind, string> = { net: "n1|", email: "e1|", install: "i1|" };

/**
 * The key, or null while TRUST_HASH_KEY is not set (and so nothing is collected). Never throws: the log serializer calls
 * this on every request, and a config that cannot be read must not take the logs with it.
 */
export function hashKey(): string | null {
  try {
    const k = getConfig().TRUST_HASH_KEY?.trim();
    return k ? k : null;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 cut to 16 bytes: long enough that two networks never share a key, short enough to index. */
export function keyOf(kind: KeyKind, value: string, key = hashKey()): Buffer | null {
  if (!key || !value) return null;
  return createHmac("sha256", key).update(LABEL[kind] + value).digest().subarray(0, 16);
}

// ------------------------------------------------------------------ addresses

/** The four numbers of an IPv4 address, or null. */
export function v4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** An IPv4 address as one number, for the sorted range arrays. */
export function v4Num(ip: string): number | null {
  const p = v4Parts(ip);
  return p ? ((p[0]! * 256 + p[1]!) * 256 + p[2]!) * 256 + p[3]! : null;
}

/** The eight 16-bit words of an IPv6 address, "::" expanded, or null. An IPv4-mapped address is not one (see `ipOf`). */
export function v6Words(ip: string): number[] | null {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!s.includes(":")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const read = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const piece of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };
  const head = read(halves[0] ?? "");
  const tail = halves.length === 2 ? read(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  if (gap < 1) return null;
  return [...head, ...Array(gap).fill(0), ...tail];
}

/** An IPv6 address as 32 lowercase hex characters: a fixed width, so a plain string compare sorts and searches it. */
export function v6Hex(ip: string): string | null {
  const w = v6Words(ip);
  return w ? w.map((n) => n.toString(16).padStart(4, "0")).join("") : null;
}

/**
 * What came in, as one of the two families. An IPv4-mapped IPv6 address (::ffff:1.2.3.4, which is how some proxies write a
 * plain IPv4 caller) counts as IPv4, so one caller does not get two keys.
 */
export function ipOf(raw: unknown): { family: "v4" | "v6"; ip: string } | null {
  const s = String(raw ?? "").trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!s) return null;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(s);
  const flat = mapped?.[1] ?? s;
  if (v4Num(flat) !== null) return { family: "v4", ip: flat };
  return v6Hex(s) !== null ? { family: "v6", ip: s.toLowerCase() } : null;
}

/** What goes into the network key: the whole IPv4 address, or an IPv6 address's /64. */
export function netKeyInput(raw: unknown): string | null {
  const got = ipOf(raw);
  if (!got) return null;
  if (got.family === "v4") return got.ip;
  const hex = v6Hex(got.ip)!;
  return `${hex.slice(0, 16)}/64`;
}

/** What goes into the coarse key, for bursts only: an IPv4 /24 or an IPv6 /48. Memory only, never a row. */
export function coarseKeyInput(raw: unknown): string | null {
  const got = ipOf(raw);
  if (!got) return null;
  if (got.family === "v4") {
    const p = v4Parts(got.ip)!;
    return `${p[0]}.${p[1]}.${p[2]}.0/24`;
  }
  return `${v6Hex(got.ip)!.slice(0, 12)}/48`;
}

/** The network key for an address, or null (not an address, or no TRUST_HASH_KEY). */
export function netKey(raw: unknown, key = hashKey()): Buffer | null {
  const input = netKeyInput(raw);
  return input ? keyOf("net", input, key) : null;
}

/** The coarse key, as hex, for the in-memory burst counters. */
export function coarseKey(raw: unknown, key = hashKey()): string | null {
  const input = coarseKeyInput(raw);
  const k = input ? keyOf("net", input, key) : null;
  return k ? k.toString("hex") : null;
}

/**
 * What a log line may carry instead of an address (observability.ts): the first 12 characters of the network key. It says
 * "these two requests came from one network" to whoever reads the logs, and nothing else. No key set, nothing is logged.
 */
export function netKeyForLog(raw: unknown): string | undefined {
  const k = netKey(raw);
  return k ? k.toString("hex").slice(0, 12) : undefined;
}
