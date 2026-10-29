/**
 * OUR ADDRESSES, AND THE ONES WE ANSWERED TO BEFORE.
 *
 * Everything new is built on x0bot.com (docs/domain-x0bot.md):
 *   https://x0bot.com       the site (Vercel), which proxies /v1/*, /download, /downloads/*, /privacy, /terms, /.well-known/* here
 *   https://api.x0bot.com   this server
 *   https://app.x0bot.com   app links (/s/<screen>, the AASA and assetlinks)
 *
 * The apps already installed have tailzu.space built in, so its API and app-link hosts keep answering, the site there
 * sends its pages on to x0bot.com, and the few checks below that name a host take both while the move lasts.
 */

export const DOMAIN = "x0bot.com";
export const SITE_ORIGIN = "https://x0bot.com";
export const API_ORIGIN = "https://api.x0bot.com";
export const APP_LINK_ORIGIN = "https://app.x0bot.com";

/** The domain before x0bot.com. Never built into anything new: only accepted. */
export const LEGACY_DOMAIN = "tailzu.space";

/** The site's origins, new and old, apex and www: what a page of ours can be opened from. */
export const SITE_ORIGINS: readonly string[] = [
  SITE_ORIGIN, `https://www.${DOMAIN}`, `https://${LEGACY_DOMAIN}`, `https://www.${LEGACY_DOMAIN}`,
];

/** Is this a page on the site, at either domain (apex or www, https, any path)? */
export function isSitePage(url: string): boolean {
  return /^https:\/\/(?:www\.)?(?:x0bot\.com|tailzu\.space)(?:\/[^\s]*)?$/.test(url);
}

/**
 * The same address on the domain before the move: https://api.x0bot.com/x -> https://api.tailzu.space/x. undefined for
 * an address that is not on x0bot.com.
 */
export function legacyTwin(url: string): string | undefined {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h !== DOMAIN && !h.endsWith(`.${DOMAIN}`)) return undefined;
    u.hostname = `${h.slice(0, h.length - DOMAIN.length)}${LEGACY_DOMAIN}`;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Is this our own pay page (GET /pay on the site), at either domain? The env may still name the old one. */
export function isOurPayPage(url: string | undefined): url is string {
  return typeof url === "string" && [SITE_ORIGIN, `https://${LEGACY_DOMAIN}`].some((o) => url.startsWith(`${o}/pay`));
}
