/**
 * THE TIME BETWEEN TWO POINTS: two OpenStreetMap routers behind one interface (types.ts Routing). Walking and driving only: neither
 * routes buses, metros or trains, so the app never claims a transit time.
 *
 *   osrmRouting({ baseUrl, line })   OSRM (BSD-2, easy to run ourselves). `baseUrl` may hold "{mode}", replaced by "car" or "foot", for a
 *                                    server with one profile per path (FOSSGIS' https://routing.openstreetmap.de/routed-{mode}, the default:
 *                                    car, bike and foot worldwide; one request a second; commercial use only where it is not an essential
 *                                    part of the offering, so run our own OSRM before this matters). Without "{mode}" it drives only.
 *   orsRouting({ baseUrl, key, line })  openrouteservice (GPL-3.0; HeiGIT's hosted API needs a free key, limited per day and minute;
 *                                    or run our own without one). Driving and walking.
 *
 * Free-flow times: neither knows today's traffic. places/index.ts adds the drive buffer. Points go in the address or the body; no logging.
 */
import type { Polite } from "./polite.js";
import type { LatLon, Leg, Mode, Routing } from "./types.js";

const base = (u: string) => u.replace(/\/+$/, "");
const pt = (p: LatLon) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
const legOf = (mode: Mode, seconds: unknown, metres: unknown): Leg | null => {
  const s = Number(seconds), m = Number(metres);
  if (!Number.isFinite(s) || s < 0) return null;
  return { mode, minutes: Math.max(1, Math.round(s / 60)), km: Number.isFinite(m) ? Math.round(m / 100) / 10 : 0 };
};

// ------------------------------------------------------------------ OSRM

export function parseOsrm(mode: Mode, body: unknown): Leg | null | "no_route" {
  const b = body as { code?: string; routes?: Array<{ duration?: unknown; distance?: unknown }> } | null;
  if (b?.code === "NoRoute" || b?.code === "NoSegment") return "no_route";
  if (b?.code !== "Ok" || !b.routes?.length) return null;
  return legOf(mode, b.routes[0]!.duration, b.routes[0]!.distance);
}

export function osrmRouting(o: { baseUrl: string; line: Polite }): Routing {
  const perMode = o.baseUrl.includes("{mode}");
  const urlFor = (mode: Mode) => base(o.baseUrl.replace("{mode}", mode === "walk" ? "foot" : "car"));
  return {
    id: "osrm",
    modes: perMode ? ["drive", "walk"] : ["drive"],
    async leg(from, to, mode) {
      if (!perMode && mode !== "drive") return null;
      const res = await o.line.get(`${urlFor(mode)}/route/v1/driving/${pt(from)};${pt(to)}?overview=false&alternatives=false&steps=false`);
      const body = await res.json().catch(() => null);
      const leg = parseOsrm(mode, body);
      if (leg === "no_route") return null;
      if (!res.ok || !leg) throw new Error(`osrm: ${res.status}`);
      return leg;
    },
  };
}

// ------------------------------------------------------------------ openrouteservice

export function parseOrs(mode: Mode, body: unknown): Leg | null {
  const r = (body as { routes?: Array<{ summary?: { duration?: unknown; distance?: unknown } }> } | null)?.routes?.[0];
  if (!r?.summary) return null;
  return legOf(mode, r.summary.duration ?? 0, r.summary.distance ?? 0);
}

export function orsRouting(o: { baseUrl: string; key?: string; line: Polite }): Routing {
  return {
    id: "ors",
    modes: ["drive", "walk"],
    async leg(from, to, mode) {
      const res = await o.line.get(`${base(o.baseUrl)}/v2/directions/${mode === "walk" ? "foot-walking" : "driving-car"}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(o.key ? { authorization: o.key } : {}) },
        body: JSON.stringify({ coordinates: [[from.lon, from.lat], [to.lon, to.lat]], instructions: false }),
      });
      const body = await res.json().catch(() => null);
      // 2004 (too far), 2009/2010 (no routable point near): no route, a real answer.
      const code = Number((body as { error?: { code?: unknown } } | null)?.error?.code);
      if (!res.ok && [2004, 2009, 2010].includes(code)) return null;
      const leg = parseOrs(mode, body);
      if (!res.ok || !leg) throw new Error(`ors: ${res.status}`);
      return leg;
    },
  };
}
