/**
 * WHERE THEY WERE BORN: the birthplace card's search (routes/bots/oracle.ts GET /v1/oracle/places) and the place they pick.
 *
 *   with GOOGLE_PLACES_API_KEY   Google's suggestions as they type (towns and cities, `types=(cities)`), and the picked one's coordinates:
 *                                the Places API Plutto uses, autocomplete then details, in one session per card (the token the page
 *                                made), so a search and its pick are billed together
 *   without it, or when Google   the server's own: the cities table, then the configured geocoder (PLACES_GEOCODER), as one best guess
 *   refuses
 *
 * Neither the key nor anything a person typed is ever logged: a refusal is logged by Google's status alone, once until it changes.
 */
import { getConfig } from "../config.js";
import { places as defaultPlaces } from "../places/index.js";
import type { Place } from "../places/types.js";

type FetchFn = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One suggestion: `id` is what the pick sends back ("g:" Google's place, "c:" coordinates from the server's own). */
export interface PlaceHit { id: string; label: string; sub: string }

export interface BirthPlaces {
  /** Whether Google's suggestions are on. */
  readonly google: boolean;
  /** Up to five towns and cities for what they have typed so far (two letters at least). */
  suggest(q: string, session?: string): Promise<PlaceHit[]>;
  /** The place they picked (a suggestion's id, with its label) or typed (the label alone). Null when it cannot be found. */
  resolve(pick: { id?: string; label?: string; session?: string }): Promise<Place | null>;
}

const AUTOCOMPLETE = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";
const MAX_HITS = 5;
const SESSION = /^[A-Za-z0-9_-]{8,64}$/;
const LABEL_MAX = 120;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const onMap = (lat: number, lon: number): boolean => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** A place of the server's own as a suggestion: its coordinates in the id, so the pick needs no second lookup. */
function ownHit(p: Place): PlaceHit {
  const [first, ...rest] = p.label.split(",");
  return { id: `c:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, label: (first ?? p.label).trim(), sub: rest.join(",").trim() || p.country || "" };
}

export function birthPlaces(o: { key?: string | null; fetchFn?: FetchFn; finder?: { place(q: string): Promise<Place | null> }; log?: (line: string) => void } = {}): BirthPlaces {
  const key = o.key === undefined ? configuredKey() : o.key ?? undefined;
  const fetchFn: FetchFn = o.fetchFn ?? ((input, init) => fetch(input, init));
  const finder = () => o.finder ?? defaultPlaces();
  const log = o.log ?? ((line: string) => console.warn(line));
  let said = "";
  const refused = (status: string): void => {
    if (said === status) return;
    said = status;
    log(`[oracle] Google Places refused (${status}): the birthplace search uses the server's own geocoder until it answers`);
  };

  /** One call to Google: its body when it answered (OK, or nothing found), else null (refused, down, slow). */
  const google = async (url: string, params: Record<string, string>, ms: number): Promise<Record<string, unknown> | null> => {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("key", key!);
    try {
      const res = await fetchFn(u.toString(), { signal: AbortSignal.timeout(ms) });
      if (!res.ok) { refused(`HTTP ${res.status}`); return null; }
      const body = (await res.json()) as Record<string, unknown>;
      const status = str(body?.status);
      if (status === "OK" || status === "ZERO_RESULTS") { said = ""; return body; }
      refused(status || "no status");
      return null;
    } catch {
      return null;
    }
  };

  const ours = async (q: string): Promise<PlaceHit[]> => {
    const p = await finder().place(q).catch(() => null);
    return p && onMap(p.lat, p.lon) ? [ownHit(p)] : [];
  };

  return {
    google: !!key,

    async suggest(q, session) {
      const words = q.trim().replace(/\s+/g, " ").slice(0, 80);
      if (words.length < 2) return [];
      if (key) {
        const body = await google(AUTOCOMPLETE, {
          input: words, types: "(cities)", language: "en", ...(session && SESSION.test(session) ? { sessiontoken: session } : {}),
        }, 4000);
        if (body) {
          const predictions = Array.isArray(body.predictions) ? (body.predictions as Array<Record<string, unknown>>) : [];
          return predictions.slice(0, MAX_HITS).map((p): PlaceHit | null => {
            const id = str(p.place_id);
            const f = (p.structured_formatting ?? {}) as Record<string, unknown>;
            const whole = str(p.description);
            const label = str(f.main_text) || whole.split(",")[0]!.trim();
            if (!id || !label) return null;
            return { id: `g:${id}`.slice(0, 300), label: label.slice(0, LABEL_MAX), sub: (str(f.secondary_text) || whole.split(",").slice(1).join(",").trim()).slice(0, LABEL_MAX) };
          }).filter((h): h is PlaceHit => h !== null);
        }
      }
      return ours(words);
    },

    async resolve(pick) {
      const id = str(pick.id).slice(0, 300);
      const label = str(pick.label).slice(0, LABEL_MAX);
      if (id.startsWith("g:") && key) {
        const session = str(pick.session);
        const body = await google(DETAILS, {
          place_id: id.slice(2), fields: "geometry,formatted_address,name", language: "en", ...(SESSION.test(session) ? { sessiontoken: session } : {}),
        }, 6000);
        const r = (body?.result ?? null) as Record<string, unknown> | null;
        const at = ((r?.geometry as Record<string, unknown> | undefined)?.location ?? {}) as Record<string, unknown>;
        const lat = Number(at.lat), lon = Number(at.lng);
        if (r && onMap(lat, lon)) return { lat, lon, label: (str(r.formatted_address) || str(r.name) || label).slice(0, LABEL_MAX) };
      } else if (id.startsWith("c:")) {
        const [lat, lon] = id.slice(2).split(",").map(Number) as [number, number];
        if (onMap(lat, lon) && label) return { lat, lon, label };
      }
      return label ? finder().place(label).catch(() => null) : null;
    },
  };
}

function configuredKey(): string | undefined {
  try { return getConfig().GOOGLE_PLACES_API_KEY; } catch { return undefined; }
}

let shared: { key: string | undefined; places: BirthPlaces } | null = null;
/** The server's own, made once (again only when the key changes). */
export function oracleBirthPlaces(): BirthPlaces {
  const key = configuredKey();
  if (!shared || shared.key !== key) shared = { key, places: birthPlaces({ key: key ?? null }) };
  return shared.places;
}
