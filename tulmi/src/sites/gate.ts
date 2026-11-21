/**
 * WHO MAY USE THE BROWSER, AND ON WHAT (CLOUD_BROWSER — off; docs/sites.md).
 *
 * A browser that holds somebody's signed-in session is the most sensitive thing this server keeps, so three gates
 * stand in front of it and all three must say yes:
 *
 *   on()            CLOUD_BROWSER. Off by default. Off means no screen, no row, nothing kept
 *   mayUse(userId)  CLOUD_BROWSER_USERS, when it names anyone. Empty means the switch alone decides
 *   siteAllowed()   the catalog (catalog.ts) and CLOUD_BROWSER_SITES. The env list is **EMPTY MEANS NONE**: it adds hosts and
 *                   nothing more, so a blank one adds none. Every other list in this config is "empty means
 *                   everyone"; this one is the other way round on purpose. Nobody should be able to point a
 *                   signed-in browser at an arbitrary host because a setting was left blank
 *
 * The key matters too: the session is kept the way a connector's token is (connectors/crypto.ts) or it is not kept
 * at all, so with no CONNECTOR_TOKEN_KEY this is off however the switches are set.
 */
import { catalogHosts } from "./catalog.js";
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
  return allowedSites().some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Every site this server allows at all: the ones a person can find by typing (catalog.ts, a reviewed list in
 * code) and the ones an operator added on purpose (CLOUD_BROWSER_SITES). The switch still decides whether any of
 * it exists, so CLOUD_BROWSER off is still nothing at all — what the catalog changes is that turning the switch
 * on no longer needs a second list typed out before anybody can sign in to anything.
 *
 * The env list keeps its inverted meaning for what it covers: it adds hosts, and empty adds none.
 */
export function allowedSites(): string[] {
  if (!cloudBrowserOn()) return [];
  return [...new Set([...catalogHosts(), ...listOf(conf().sites)])];
}

/**
 * THE ONE NAME A SITE IS KEPT UNDER: the allowed entry a host belongs to ("www.swiggy.com" is "swiggy.com"), or the host
 * itself when none covers it. A sign-in on www. and a watch on m. are the same person on the same site, and keeping
 * them under one name is what lets a watch find the sign-in.
 */
export function siteOf(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  const hit = allowedSites().filter((a) => h === a || h.endsWith(`.${a}`)).sort((a, b) => b.length - a.length)[0];
  return hit ?? h;
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
