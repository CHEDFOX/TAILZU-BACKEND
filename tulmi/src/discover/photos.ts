/**
 * PHOTOGRAPHS FOR A PLACE, FROM WIKIMEDIA COMMONS. Free to use, no key, and the only source that covers the places
 * worth writing about — a 12th-century temple has photographs on Commons; a shopping street does not.
 *
 *   const p = photos()
 *   await p.find("Hampi", { near: { lat, lon }, want: 6 })   -> Photo[]   best first, each with its credit
 *
 * THE LICENCE IS A GATE, NOT A FOOTNOTE. Commons carries some files that are not ours to show (fair-use logos,
 * "non-free" screenshots). Only the licences in FREE below are taken, the credit line is built from the file's own
 * metadata, and a file with no usable licence is dropped rather than shown without one. A card with no photograph
 * still goes out; a card with somebody's photograph and no credit does not.
 *
 * Nothing about the person reaches Commons: the query is the place name, which is also what the geocoder saw.
 *
 * Settings: COMMONS (on | off, default on), COMMONS_URL (its api.php), PLACES_CONTACT (who we are in the
 * User-Agent, shared with src/places).
 */
import { getConfig } from "../config.js";
import { Polite, userAgentFor, type FetchFn } from "../places/polite.js";
import { PlacesBusy } from "../places/types.js";
import type { LatLon, Photo } from "./types.js";

export const COMMONS_URL = "https://commons.wikimedia.org/w/api.php";

/** The widest we ask for. Commons makes the thumbnail, so we are not pulling 40MB originals. */
const WIDTH = 1600;
const WANT = 6;
/** Commons asks for one request a second from a tool like ours. */
const GAP_MS = 1100;

/**
 * Licences we may show, by the short name Commons reports. Anything else — "Fair use", "Non-free", a bare
 * "Copyrighted" — is dropped. CC BY-SA and friends need the credit line, which is why it is built here and carried
 * on the Photo itself rather than looked up again later.
 */
const FREE = /^(cc0|cc[ -]by([ -]sa)?([ -][0-9.]+)?|public domain|pd[ -].*|no restrictions)/i;

interface CommonsPage {
  title?: unknown;
  index?: unknown;
  imageinfo?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Commons gives HTML in its metadata (an artist is a link). A credit line is text. */
const plain = (html: string): string =>
  html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const metaOf = (info: Record<string, unknown>, key: string): string => {
  const ext = info.extmetadata;
  if (!ext || typeof ext !== "object") return "";
  const row = (ext as Record<string, unknown>)[key];
  if (!row || typeof row !== "object") return "";
  return plain(str((row as Record<string, unknown>).value));
};

/** The file name, as a last resort for the alt text: "File:Hampi Virupaksha temple.jpg" -> "Hampi Virupaksha temple". */
const fromTitle = (title: string): string => title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();

/** One page of the answer, into a photograph we may show — or null. */
export function photoFrom(page: CommonsPage, place: string): Photo | null {
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  if (!info || typeof info !== "object") return null;
  const row = info as Record<string, unknown>;

  const licence = metaOf(row, "LicenseShortName");
  if (!licence || !FREE.test(licence)) return null;

  const url = str(row.thumburl) || str(row.url);
  if (!/^https:\/\//.test(url)) return null;

  const artist = metaOf(row, "Artist");
  const described = metaOf(row, "ImageDescription");
  const title = fromTitle(str(page.title));

  const width = typeof row.thumbwidth === "number" ? row.thumbwidth : typeof row.width === "number" ? row.width : undefined;
  const height = typeof row.thumbheight === "number" ? row.thumbheight : typeof row.height === "number" ? row.height : undefined;

  return {
    url,
    alt: (described || title || place).slice(0, 180),
    credit: ["Wikimedia Commons", licence, artist].filter(Boolean).join(" · ").slice(0, 180),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

/** The whole answer, in the order Commons ranked it. */
export function parseCommons(body: unknown, place: string): Photo[] {
  if (!body || typeof body !== "object") return [];
  const query = (body as Record<string, unknown>).query;
  if (!query || typeof query !== "object") return [];
  const pages = (query as Record<string, unknown>).pages;
  if (!pages || typeof pages !== "object") return [];

  const rows = Object.values(pages as Record<string, CommonsPage>);
  rows.sort((a, b) => (typeof a.index === "number" ? a.index : 99) - (typeof b.index === "number" ? b.index : 99));

  const out: Photo[] = [];
  const seen = new Set<string>();
  for (const page of rows) {
    const photo = photoFrom(page, place);
    if (!photo || seen.has(photo.url)) continue;
    seen.add(photo.url);
    out.push(photo);
  }
  return out;
}

export interface FindOpts {
  /** Narrows the search to a point, where Commons has the file geocoded. */
  near?: LatLon;
  want?: number;
}

export interface PhotoSource {
  readonly id: string;
  find(place: string, opts?: FindOpts): Promise<Photo[]>;
}

export interface PhotosOpts {
  url?: string;
  fetch?: FetchFn;
  contact?: string;
  now?: () => number;
}

export function commonsPhotos(o: PhotosOpts = {}): PhotoSource {
  const url = o.url ?? COMMONS_URL;
  const polite = new Polite({
    name: "commons",
    minGapMs: GAP_MS,
    userAgent: userAgentFor(o.contact ?? "https://x0bot.com"),
    ...(o.fetch ? { fetchFn: o.fetch } : {}),
    ...(o.now ? { now: o.now } : {}),
  });

  return {
    id: "commons",
    async find(place, opts = {}) {
      const q = place.trim();
      if (!q) return [];
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "1",
        generator: "search",
        gsrsearch: q,
        gsrnamespace: "6",
        gsrlimit: String(Math.min(Math.max(1, opts.want ?? WANT), 20)),
        prop: "imageinfo",
        iiprop: "url|size|extmetadata",
        iiurlwidth: String(WIDTH),
      });
      const res = await polite.get(`${url}?${params.toString()}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`commons: ${res.status}`);
      const body: unknown = await res.json();
      return parseCommons(body, q).slice(0, opts.want ?? WANT);
    },
  };
}

/** The server's photograph source, from the config. Null when COMMONS is off. */
export function photosFromConfig(fetch?: FetchFn): PhotoSource | null {
  const cfg = getConfig() as unknown as Record<string, unknown>;
  const on = String(cfg.COMMONS ?? "on").toLowerCase() !== "off";
  if (!on) return null;
  const url = typeof cfg.COMMONS_URL === "string" && cfg.COMMONS_URL ? cfg.COMMONS_URL : COMMONS_URL;
  const contact = typeof cfg.PLACES_CONTACT === "string" && cfg.PLACES_CONTACT ? cfg.PLACES_CONTACT : undefined;
  return commonsPhotos({ url, ...(contact ? { contact } : {}), ...(fetch ? { fetch } : {}) });
}

export { PlacesBusy };
