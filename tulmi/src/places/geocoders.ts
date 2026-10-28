/**
 * WORDS TO PLACES: two OpenStreetMap geocoders behind one interface (types.ts Geocoder).
 *
 *   photonGeocoder({ baseUrl, line })      Photon (komoot's engine, Apache-2.0). Default https://photon.komoot.io: free, fair use
 *                                          ("extensive usage will be throttled"), no key. Run our own from the same code when we grow.
 *   nominatimGeocoder({ baseUrl, line })   Nominatim (GPL-2.0). No default address on purpose: the OSMF's public server allows at
 *                                          most one request a second, asks for caching, no personal data, and a deliberate choice by
 *                                          whoever runs the app. Set PLACES_GEOCODE_URL to it, or to a Nominatim we run.
 *
 * Both answer from OpenStreetMap (ODbL): a screen that shows what came from here shows "© OpenStreetMap contributors"
 * (places/index.ts credits()). Queries go in the query string only; nothing is logged.
 */
import type { Polite } from "./polite.js";
import type { Geocoder, GeocodeHints, Place } from "./types.js";

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const okPoint = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** "Indiranagar, Bengaluru": the name and the first wider part that says something new. */
function labelOf(name: string, wider: string[]): string {
  const parts = [name];
  for (const w of wider) if (w && !parts.some((p) => p.toLowerCase() === w.toLowerCase())) { parts.push(w); break; }
  return parts.filter(Boolean).join(", ").slice(0, 80);
}

/** Those in the hinted country first, keeping the provider's order otherwise. */
function rank(places: Place[], hints?: GeocodeHints): Place[] {
  if (!hints?.country) return places;
  const c = hints.country.toLowerCase();
  return [...places.filter((p) => p.country === c), ...places.filter((p) => p.country !== c)];
}

const base = (u: string) => u.replace(/\/+$/, "");

// ------------------------------------------------------------------ Photon

interface PhotonFeature { geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> }

export function parsePhoton(body: unknown): Place[] {
  const feats = (body as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const out: Place[] = [];
  for (const f of feats) {
    const [lon, lat] = (f.geometry?.coordinates ?? []).map(num);
    if (lat === undefined || lon === undefined || !okPoint(lat, lon)) continue;
    const p = f.properties ?? {};
    const name = str(p.name) || [str(p.housenumber), str(p.street)].filter(Boolean).join(" ") || str(p.city);
    if (!name) continue;
    const country = str(p.countrycode).toLowerCase();
    out.push({ lat, lon, label: labelOf(name, [str(p.district), str(p.locality), str(p.city), str(p.county), str(p.state)]), ...(country ? { country } : {}) });
  }
  return out;
}

export function photonGeocoder(o: { baseUrl: string; line: Polite }): Geocoder {
  return {
    id: "photon",
    async geocode(q, hints) {
      const params = new URLSearchParams({ q, limit: "5", lang: "en" });
      if (hints?.near) { params.set("lat", hints.near.lat.toFixed(3)); params.set("lon", hints.near.lon.toFixed(3)); }
      const res = await o.line.get(`${base(o.baseUrl)}/api/?${params}`);
      if (!res.ok) throw new Error(`photon: ${res.status}`);
      return rank(parsePhoton(await res.json()), hints);
    },
  };
}

// ------------------------------------------------------------------ Nominatim

interface NominatimHit { lat?: unknown; lon?: unknown; name?: unknown; display_name?: unknown; address?: Record<string, unknown> }

export function parseNominatim(body: unknown): Place[] {
  if (!Array.isArray(body)) return [];
  const out: Place[] = [];
  for (const h of body as NominatimHit[]) {
    const lat = num(h.lat), lon = num(h.lon);
    if (!okPoint(lat, lon)) continue;
    const a = h.address ?? {};
    const name = str(h.name) || str(h.display_name).split(",")[0]!.trim();
    if (!name) continue;
    const country = str(a.country_code).toLowerCase();
    out.push({ lat, lon, label: labelOf(name, [str(a.suburb), str(a.neighbourhood), str(a.city), str(a.town), str(a.village), str(a.state)]), ...(country ? { country } : {}) });
  }
  return out;
}

export function nominatimGeocoder(o: { baseUrl: string; line: Polite }): Geocoder {
  return {
    id: "nominatim",
    async geocode(q, hints) {
      const params = new URLSearchParams({ q, format: "jsonv2", addressdetails: "1", limit: "5", "accept-language": "en" });
      if (hints?.country) params.set("countrycodes", hints.country.toLowerCase());
      if (hints?.near) {
        const { lat, lon } = hints.near;
        params.set("viewbox", [lon - 0.5, lat + 0.5, lon + 0.5, lat - 0.5].map((n) => n.toFixed(3)).join(","));
      }
      const res = await o.line.get(`${base(o.baseUrl)}/search?${params}`);
      if (!res.ok) throw new Error(`nominatim: ${res.status}`);
      return rank(parseNominatim(await res.json()), hints);
    },
  };
}
