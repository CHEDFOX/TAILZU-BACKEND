// The bots' catalog, cut down to a format (anim/SPEC.md 5.1). Plain JS, no dependencies, so the server
// (tulmi/src/experience/bots/looks.ts) and the phone's release script (app/src/botTiles/genStarter.mjs) use the
// very same code: an old build must be served a file byte-identical to what it is served today.
//
//   projectLooks(spec, f)  the catalog with only what format f knows: its top-level sections, its moments and its
//                          scenes. `format` is set to f. For a catalog with nothing above format 1,
//                          projectLooks(spec, 1) deep-equals spec.
//
// It refuses, with a named error, rather than guessing a cascade:
//   - a part, avatar or `kinds` entry that carries `format` (the shipped core refuses that key outright);
//   - a format-1 moment that plays a format-2 one (`others.play`), which an old core would report as missing.

/** The top-level sections each format knows. Anything else is dropped on the way down. */
export const FORMAT_KEYS = {
  1: ["v", "format", "note", "parts", "avatars", "moments", "kinds", "idle"],
  2: ["v", "format", "note", "parts", "avatars", "moments", "kinds", "idle", "scenes"],
};

export const LOOKS_FORMAT_MAX = 2;

const isRec = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const formatOf = (item) => (isRec(item) && typeof item.format === "number" ? item.format : 1);

/** Thrown when a catalog cannot be cut down honestly; the message names the item. */
export class ProjectError extends Error {}

/**
 * The catalog as a build of format `f` is served it. `f` below 1 or above LOOKS_FORMAT_MAX is clamped.
 * The input is never changed.
 */
export function projectLooks(spec, f) {
  if (!isRec(spec)) throw new ProjectError("the catalog is an object");
  const want = Math.max(1, Math.min(LOOKS_FORMAT_MAX, Math.floor(Number(f) || 1)));
  const keys = FORMAT_KEYS[want] || FORMAT_KEYS[1];
  for (const where of ["parts", "avatars", "kinds"]) {
    const sec = spec[where];
    if (!isRec(sec)) continue;
    for (const [id, item] of Object.entries(sec)) {
      if (isRec(item) && item.format !== undefined) throw new ProjectError(`${where}.${id}: only a moment or a scene carries \`format\``);
    }
  }
  const moments = isRec(spec.moments) ? spec.moments : {};
  const kept = new Set(Object.keys(moments).filter((id) => formatOf(moments[id]) <= want));
  // A moment this format keeps may not lean on one it drops: an old core would call that a missing moment.
  for (const id of kept) {
    const m = moments[id];
    const tracks = isRec(m) && Array.isArray(m.tracks) ? m.tracks : [];
    const ends = isRec(m) && isRec(m.end) && Array.isArray(m.end.tracks) ? m.end.tracks : [];
    for (const tr of [...tracks, ...ends]) {
      if (!isRec(tr) || tr.do !== "others") continue;
      const play = String(tr.play);
      if (moments[play] !== undefined && !kept.has(play)) {
        throw new ProjectError(`moments.${id}: plays "${play}", which format ${want} does not have`);
      }
    }
  }
  const out = {};
  for (const k of keys) {
    if (spec[k] === undefined) continue;
    if (k === "moments") {
      const only = {};
      for (const id of Object.keys(moments)) if (kept.has(id)) only[id] = moments[id];
      out.moments = only;
      continue;
    }
    if (k === "scenes") {
      const scenes = isRec(spec.scenes) ? spec.scenes : {};
      const only = {};
      for (const [id, sc] of Object.entries(scenes)) if (formatOf(sc) <= want) only[id] = sc;
      out.scenes = only;
      continue;
    }
    if (k === "idle") {
      const idle = spec.idle;
      if (!isRec(idle)) { out.idle = idle; continue; }
      // Only entries pointing at a moment THIS format drops are taken out: one naming a moment that is not in the
      // catalog at all stays, so the check still reports it.
      out.idle = Array.isArray(idle.moments)
        ? { ...idle, moments: idle.moments.filter((m) => kept.has(String(m)) || moments[String(m)] === undefined) }
        : { ...idle };
      continue;
    }
    out[k] = spec[k];
  }
  if (spec.format !== undefined || want > 1) out.format = want;
  // The sections keep the order the file has them in, so a projection of a format-1 file is the same bytes.
  const ordered = {};
  for (const k of Object.keys(spec)) if (k in out) ordered[k] = out[k];
  for (const k of Object.keys(out)) if (!(k in ordered)) ordered[k] = out[k];
  return ordered;
}

/** The highest format any item in the catalog asks for (the catalog's own `format`). */
export function formatOfCatalog(spec) {
  let f = 1;
  if (!isRec(spec)) return f;
  for (const where of ["moments", "scenes"]) {
    const sec = isRec(spec[where]) ? spec[where] : {};
    for (const item of Object.values(sec)) f = Math.max(f, formatOf(item));
  }
  return f;
}
