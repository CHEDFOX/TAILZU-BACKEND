/**
 * THE PICTURES ON A SITE'S CARDS, AND WHERE THEY MAY COME FROM (docs/site-portrait.md §4c).
 *
 *   imageHosts(site)            the site's own image servers (catalog `images`) and Wikimedia Commons, and nothing else
 *   safeImage(url, site)        the address, if it is a picture we may show for that site; else nothing
 *   splitImages(text)           the pictures the phone's history read found on the orders page, taken off the words
 *   imageFor(name, images)      the picture that belongs to a dish, a product or a restaurant, matched by its name
 *
 * REAL PICTURES, FROM TWO PLACES ONLY. The dish or product they ordered is shown with the picture the site itself shows
 * for it, read off their orders page on their phone (history/phone.ts historyRead): that is the photo they would see on
 * the site, so it is the right one. Something new X0 found for them is shown with a freely licensed photo of the dish
 * from Wikimedia Commons, with its credit (taste/discover.ts). Nowhere else: a picture loads by itself, and an address a
 * page or a model chose could carry anything in it. So every address is checked here, on the way in and again on the
 * way out to a screen, against the hosts the catalog names for that site, https only. A card with no picture is drawn
 * with the kind's own mark, which is honest; a card with somebody else's picture is not.
 */
import { catalogFor } from "../catalog.js";

/** Free photographs of a dish, for something new found for them (src/discover/photos.ts reads Commons). */
export const COMMONS_IMAGES = ["upload.wikimedia.org"];

/** Where the phone's history read puts the pictures it found, above the page's words (history/phone.ts). */
export const IMAGES_START = "[x0-images]";
export const IMAGES_END = "[/x0-images]";

export interface PageImage { label: string; url: string }

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").replace(/\s+/g, " ").trim();

export const imageHosts = (site: string): string[] => [...(catalogFor(site)?.images ?? []), ...COMMONS_IMAGES];

/** The address if it is a picture we may show on this site's cards: https, on one of its image hosts. */
export function safeImage(url: unknown, site: string): string | undefined {
  if (typeof url !== "string" || !url || url.length > 600) return undefined;
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== "https:" || u.username || u.password) return undefined;
  const h = u.hostname.toLowerCase();
  return imageHosts(site).some((a) => h === a || h.endsWith(`.${a}`)) ? u.href : undefined;
}

/** The pictures block the phone's read wrote, taken off the words: the model is never shown an address. */
export function splitImages(text: string, site: string): { text: string; images: PageImage[] } {
  const a = text.indexOf(IMAGES_START), b = text.indexOf(IMAGES_END);
  if (a < 0 || b < a) return { text, images: [] };
  const images: PageImage[] = [];
  for (const line of text.slice(a + IMAGES_START.length, b).split("\n")) {
    const [label, url] = line.split("\t");
    const l = (label ?? "").replace(/\s+/g, " ").trim().slice(0, 120), u = safeImage((url ?? "").trim(), site);
    if (l && u) images.push({ label: l, url: u });
    if (images.length >= 60) break;
  }
  return { text: (text.slice(0, a) + text.slice(b + IMAGES_END.length)).trim(), images };
}

/**
 * The picture that belongs to a name: the one whose label (its alt text, or the words beside it on the page) is that
 * name, or starts with it, or holds it whole. A long product name may be cut short on one side or the other, so the
 * first words of each are compared too.
 */
export function imageFor(name: string, images: readonly PageImage[]): string | undefined {
  const want = norm(name);
  if (want.length < 3) return undefined;
  const head = want.split(" ").slice(0, 4).join(" ");
  const hit = images.find((i) => norm(i.label) === want)
    ?? images.find((i) => { const l = norm(i.label); return l.startsWith(want) || (want.length >= 6 && l.includes(want)); })
    ?? images.find((i) => head.length >= 8 && norm(i.label).startsWith(head));
  return hit?.url;
}
