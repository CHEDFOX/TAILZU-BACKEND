/**
 * The one way this server compares a presented secret with the real one.
 *
 * Both sides are hashed first, so the comparison is always over two 32-byte
 * digests: timingSafeEqual throws on a length mismatch, and branching on that
 * (or on `a.length !== b.length`) leaks the length it is meant to hide. `===`
 * leaks length and prefix under repetition, which is exactly the shape of an
 * attack on a fixed secret.
 *
 * Used for the admin secret, the RevenueCat webhook secret, the review code
 * and the static bearer tokens. An empty expected value never matches.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

export function sameSecret(presented: string, expected: string): boolean {
  return !!expected && timingSafeEqual(digest(presented), digest(expected));
}
