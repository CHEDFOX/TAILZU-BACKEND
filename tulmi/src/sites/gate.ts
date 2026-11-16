/**
 * WHO MAY USE THE BROWSER, AND ON WHAT (CLOUD_BROWSER — off; docs/sites.md).
 *
 * A browser that holds somebody's signed-in session is the most sensitive thing this server keeps, so three gates
 * stand in front of it and all three must say yes:
 *
 *   on()            CLOUD_BROWSER. Off by default. Off means no screen, no row, nothing kept
 *   mayUse(userId)  CLOUD_BROWSER_USERS, when it names anyone. Empty means the switch alone decides
 *   siteAllowed()   CLOUD_BROWSER_SITES. **EMPTY MEANS NONE.** Every other list in this config is "empty means
 *                   everyone"; this one is the other way round on purpose. Nobody should be able to point a
 *                   signed-in browser at an arbitrary host because a setting was left blank
 *
 * The key matters too: the session is kept the way a connector's token is (connectors/crypto.ts) or it is not kept
 * at all, so with no CONNECTOR_TOKEN_KEY this is off however the switches are set.
 */
import { getConfig } from "../config.js";

function conf(): { on: boolean; users: string; sites: string; key: string | undefined } {
  try {
    const c = getConfig();
    return { on: c.CLOUD_BROWSER, users: c.CLOUD_BROWSER_USERS, sites: c.CLOUD_BROWSER_SITES, key: c.CONNECTOR_TOKEN_KEY };
  } catch {
    return {
      on: (process.env.CLOUD_BROWSER ?? "").toLowerCase() === "true",
      users: process.env.CLOUD_BROWSER_USERS ?? "",
      sites: process.env.CLOUD_BROWSER_SITES ?? "",
      key: process.env.CONNECTOR_TOKEN_KEY,
    };
  }
}

const listOf = (s: string): string[] => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/** The switch and the key alone: what a route checks before it knows who is asking. */
export function cloudBrowserOn(): boolean {
  const c = conf();
  return c.on && !!c.key;
}

/** This person may use it. */
export function mayUseCloudBrowser(userId: string): boolean {
  if (!cloudBrowserOn() || !userId) return false;
  const only = listOf(conf().users);
  return only.length === 0 || only.includes(userId.toLowerCase());
}

/**
 * A HOST THIS SERVER WILL HOLD A SESSION FOR. The named host, or one of its subdomains ("swiggy.com" allows
 * "www.swiggy.com"); never the other way round, so naming "swiggy.com" cannot be read as allowing
 * "swiggy.com.example.net".
 */
export function siteAllowed(host: string): boolean {
  if (!cloudBrowserOn()) return false;
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h || h.includes("/") || h.includes(" ")) return false;
  return listOf(conf().sites).some((a) => h === a || h.endsWith(`.${a}`));
}

/** Every site this server allows at all, for a screen that lists them. */
export function allowedSites(): string[] {
  return cloudBrowserOn() ? listOf(conf().sites) : [];
}

/** The host of a URL, lowercased and without a trailing dot; "" when it is not an http(s) address. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** How often the same thing may be looked at, and how many may be watched at once. */
export function watchLimits(): { every: number; most: number } {
  try {
    const c = getConfig();
    return { every: c.CLOUD_BROWSER_EVERY_MIN * 60_000, most: c.CLOUD_BROWSER_WATCHES };
  } catch {
    return { every: 20 * 60_000, most: 6 };
  }
}
