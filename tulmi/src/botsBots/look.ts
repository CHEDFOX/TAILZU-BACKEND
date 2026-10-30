/**
 * WORK IT OUT FROM WHAT IS KNOWN, AND LEARN THE REST AFTER: Plan Ease's travel times and the Travel bot's weather and stays are each
 * one pure computation over three questions (where is this, how long between these, what weather there), written once.
 *
 *   const { value, pending } = await lookNow({ places, later, userId, key: "plan", topics: ["bot:plan"], waitMs, compute })
 *
 * `compute(look)` runs against memory: every answer not known yet is undefined, and asking for it notes a lookup. If any were noted, a
 * job (later.ts) makes them, one at a time, and runs `compute` again until nothing is missing or a round learns nothing; the screen
 * gets what was known within `waitMs`, says the rest is coming (`pending`), and the live channel brings it.
 */
import type { Forecast, GeocodeHints, LatLon, Leg, Place, Places } from "../places/index.js";
import { within, type Later } from "./later.js";

export interface Look {
  place(q: string, hints?: GeocodeHints): Place | null | undefined;
  travel(a: LatLon, b: LatLon): Leg | null | undefined;
  forecast(at: LatLon): Forecast | null | undefined;
}

const pt = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

/** A look from memory; what it could not answer is put in `missing`, as the lookup that would. */
export function peeking(places: Places, missing: Map<string, () => Promise<unknown>>): Look {
  return {
    place(q, hints) {
      const v = places.peekPlace(q, hints);
      if (v === undefined) missing.set(`p|${q}|${hints?.country ?? ""}|${hints?.near ? pt(hints.near) : ""}`, () => places.place(q, hints));
      return v;
    },
    travel(a, b) {
      const v = places.peekTravel(a, b);
      if (v === undefined) missing.set(`t|${pt(a)}|${pt(b)}`, () => places.travel(a, b));
      return v;
    },
    forecast(at) {
      const v = places.peekForecast(at);
      if (v === undefined) missing.set(`w|${at.lat.toFixed(2)},${at.lon.toFixed(2)}`, () => places.forecast(at));
      return v;
    },
  };
}

/** Makes the lookups `compute` needs, round by round. True when something new was learned. */
export async function settle(places: Places, compute: (look: Look) => unknown, rounds = 8): Promise<boolean> {
  let learned = false;
  let before: string[] | null = null;
  for (let i = 0; i < rounds; i += 1) {
    const missing = new Map<string, () => Promise<unknown>>();
    compute(peeking(places, missing));
    const keys = [...missing.keys()].sort();
    if (!keys.length) return learned || i > 0;
    if (before && keys.join("\n") === before.join("\n")) return learned;
    if (before) learned = true;
    before = keys;
    for (const go of missing.values()) await go().catch(() => null);
  }
  return true;
}

export async function lookNow<T>(o: {
  places: Places; later: Later; userId: string; key: string; topics: string[]; waitMs: number; compute: (look: Look) => T;
}): Promise<{ value: T; pending: boolean }> {
  let missing = new Map<string, () => Promise<unknown>>();
  let value = o.compute(peeking(o.places, missing));
  if (!missing.size) return { value, pending: false };
  const job = o.later.run(o.userId, o.key, o.topics, () => settle(o.places, o.compute));
  if (o.waitMs > 0) {
    await within(job, o.waitMs);
    missing = new Map();
    value = o.compute(peeking(o.places, missing));
  }
  return { value, pending: missing.size > 0 };
}
