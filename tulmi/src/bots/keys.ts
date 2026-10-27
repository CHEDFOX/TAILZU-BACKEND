/**
 * A BOT'S API KEYS: MADE AT RANDOM, SHOWN ONCE, KEPT ONLY AS A HASH.
 *
 *   newKey()            tzb_ and 32 random bytes in base64url: 256 bits, nothing to guess
 *   hashKey(key, pepper)  sha256 of the pepper and the key: what is stored, and what a key presented is looked up by
 *   maskKey(prefix)     what the owner is shown afterwards
 *
 * The pepper (BOT_KEY_PEPPER) lives in the server's environment and never in the database, so a leaked table cannot be used to test guesses and
 * cannot be turned into keys. A key is high-entropy, so a fast hash is right (nothing to stretch); the pepper is what makes the stored value useless
 * on its own. Rotating the pepper revokes every key. The comparison is by the hash, in the database's index; no key is ever compared as text.
 */
import { createHash, randomBytes } from "node:crypto";

export const KEY_PREFIX = "tzb_";
/** The shape of a key we made: the prefix and 43 base64url characters. Anything else is turned away before a lookup. */
export const KEY_SHAPE = /^tzb_[A-Za-z0-9_-]{43}$/;
/** How many characters of a key are kept to tell keys apart. */
export const PREFIX_CHARS = 8;

export const newKey = (): string => `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;

export const hashKey = (key: string, pepper: string): string => createHash("sha256").update(pepper).update(":").update(key).digest("hex");

export const prefixOf = (key: string): string => key.slice(0, PREFIX_CHARS);
export const maskKey = (prefix: string): string => `${prefix}…`;

/** The key in an Authorization header, or null when it is not one of ours. */
export function bearerKey(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h ?? "");
  return m && KEY_SHAPE.test(m[1]!) ? m[1]! : null;
}

/** Whether a bearer token is meant as a bot key (so the owner's sign-in is not asked about it). */
export const looksLikeKey = (header: string | string[] | undefined): boolean => /^Bearer\s+tzb_/i.test((Array.isArray(header) ? header[0] : header) ?? "");
