/**
 * THE EMAIL, AS A KEY AND AS A SIGNAL (docs/trust.md §email).
 *
 * Two things only: whether the same address keeps coming back under a new account (a keyed hash of the NORMALISED address, so
 * "a.b+one@gmail.com" and "ab@gmail.com" are one key), and whether its domain is a throwaway one. The address itself is never
 * stored here: the hash is, for 30 days, and the same hash is what a deleted account's tombstone holds.
 *
 * The throwaway list is a short one kept in this file, because a list in the repo is a list we can read in a review. A fuller
 * one can be dropped on the server as `disposable.txt` in TRUST_LISTS_DIR (one domain a line, # for a comment) and is used in
 * addition to this one; no list at all simply means the signal never fires.
 */
import { keyOf, hashKey } from "./netKey.js";

/**
 * How an address is compared with another: lower case, no +tag, and, for Google's own domains only, no dots in the name (Gmail
 * ignores them, so "a.b@gmail.com" and "ab@gmail.com" are the same mailbox; nowhere else is that true).
 */
export function normaliseEmail(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at <= 0 || at === s.length - 1) return "";
  let name = s.slice(0, at);
  const domain = s.slice(at + 1);
  const plus = name.indexOf("+");
  if (plus >= 0) name = name.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") name = name.replace(/\./g, "");
  return name && domain ? `${name}@${domain}` : "";
}

/** The keyed hash of the normalised address, or null (no address, or no TRUST_HASH_KEY). */
export function emailKey(raw: unknown, key = hashKey()): Buffer | null {
  const norm = normaliseEmail(raw);
  return norm ? keyOf("email", norm, key) : null;
}

/** The domain of a normalised address. */
export const domainOf = (raw: unknown): string => {
  const norm = normaliseEmail(raw);
  return norm ? norm.slice(norm.lastIndexOf("@") + 1) : "";
};

/**
 * Throwaway mailbox domains, the common ones. Short on purpose: every name here is one we can explain, and a false positive
 * costs a real person 30 points on a score that only ever logs, slows or holds the free plan. The server's own list file adds
 * to it (lists.ts `disposableFromFile`).
 */
export const DISPOSABLE_DOMAINS: readonly string[] = [
  "10minutemail.com", "20minutemail.com", "33mail.com", "cock.li", "dispostable.com", "emailondeck.com",
  "fakeinbox.com", "getairmail.com", "getnada.com", "guerrillamail.com", "guerrillamail.info", "guerrillamailblock.com",
  "inboxbear.com", "mail-temp.com", "mail7.io", "mailcatch.com", "maildrop.cc", "mailinator.com", "mailnesia.com",
  "mintemail.com", "moakt.com", "mohmal.com", "mytemp.email", "nowmymail.com", "sharklasers.com", "spam4.me",
  "spamgourmet.com", "temp-mail.io", "temp-mail.org", "tempail.com", "tempinbox.com", "tempm.com", "tempmail.net",
  "tempmailo.com", "throwawaymail.com", "trashmail.com", "trashmail.de", "yopmail.com", "yopmail.fr", "mailtemp.net",
];

/** The set as the signal reads it: this file's list plus whatever the server's own file added. */
export class DisposableList {
  private readonly set: Set<string>;
  constructor(extra: readonly string[] = []) {
    this.set = new Set([...DISPOSABLE_DOMAINS, ...extra.map((d) => d.trim().toLowerCase()).filter(Boolean)]);
  }
  /** Whether this address's domain is a throwaway one. A subdomain of one counts ("x.mailinator.com"). */
  has(raw: unknown): boolean {
    const domain = domainOf(raw);
    if (!domain) return false;
    if (this.set.has(domain)) return true;
    for (const d of this.set) if (domain.endsWith(`.${d}`)) return true;
    return false;
  }
  get size(): number { return this.set.size; }
}

/** One domain a line, # for a comment: the shape of `disposable.txt` on the server. */
export function parseDisposableFile(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim().toLowerCase())
    .filter((l) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(l));
}
