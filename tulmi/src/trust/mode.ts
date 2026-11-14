/**
 * THE KILL SWITCH, ON ITS OWN (docs/trust.md §switches).
 *
 * `TRUST = off | shadow | on`, with the one thing that overrides it: with no key to hash an address with, nothing can be
 * collected, so it is off whatever the env says.
 *
 * It lives in this little file, and not in actions.ts, because the store has to read it too (a deleted account's tombstone
 * must not be written while the whole thing is off) and the store is what actions.ts is built on: one import either way
 * would be a circle.
 */
import { getConfig } from "../config.js";
import { hashKey } from "./netKey.js";

export type TrustMode = "off" | "shadow" | "on";

/** The mode now. Never throws: it is read on every request, and a config that cannot be read must not fail one. */
export function trustMode(): TrustMode {
  try {
    const cfg = getConfig();
    if (cfg.TRUST === "off") return "off";
    return hashKey() ? cfg.TRUST : "off";
  } catch {
    return "off";
  }
}
