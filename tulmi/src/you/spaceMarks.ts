/**
 * THE SECTIONS OF A PERSON'S SPACE, AND WHAT THEY CHANGED IN IT (src/you/space.ts reads them; kept in you_settings.privacy.space).
 *
 *   off     the sections no bot may use (their lines stay, for the person to read)
 *   pins    the lines every bot is shown first, by key (a line's key is its words, so a copy kept by another bot is the same line)
 *   moved   lines the person put in another section than the rules filed them in
 *
 * No other module is imported here: the You settings clean these as they are read.
 */
export const SECTION_IDS = ["about", "day", "people", "places", "likes", "money", "work", "bots", "files", "timeline"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
/** The sections that hold what bots learned. The others show the person's own things (notes, trips, projects) and every line by time. */
export const FACT_SECTIONS = ["about", "day", "people", "places", "likes", "money", "work"] as const;
export type FactSection = (typeof FACT_SECTIONS)[number];

export const isSection = (v: unknown): v is SectionId => typeof v === "string" && (SECTION_IDS as readonly string[]).includes(v);
export const isFactSection = (v: unknown): v is FactSection => typeof v === "string" && (FACT_SECTIONS as readonly string[]).includes(v);

export interface SpaceMarks { off: FactSection[]; pins: string[]; moved: Record<string, FactSection> }
export const NO_MARKS: SpaceMarks = { off: [], pins: [], moved: {} };

export const KEY = /^[0-9a-f]{12}$/;
export const PINS_MAX = 40;
/** Moved lines kept: the oldest moves drop first (by then the line is usually gone too). */
const MOVED_MAX = 400;

/** Whatever was stored, as marks: a wrong entry is left out. */
export function cleanMarks(raw: unknown): SpaceMarks {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const off = Array.isArray(r.off) ? [...new Set(r.off.filter(isFactSection))] : [];
  const pins = Array.isArray(r.pins) ? [...new Set(r.pins.filter((k): k is string => typeof k === "string" && KEY.test(k)))].slice(-PINS_MAX) : [];
  const m = r.moved && typeof r.moved === "object" && !Array.isArray(r.moved) ? Object.entries(r.moved as Record<string, unknown>) : [];
  const moved = Object.fromEntries(m.filter(([k, v]) => KEY.test(k) && isFactSection(v)).slice(-MOVED_MAX)) as Record<string, FactSection>;
  return { off, pins, moved };
}
