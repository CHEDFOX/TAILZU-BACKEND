/**
 * The shared projection (shared/bots/project.mjs), loaded once. One implementation, used by the server here and by
 * the phone's release script (app/src/botTiles/genStarter.mjs), because an old build must be served a catalog
 * byte-identical to what it is served today (anim/SPEC.md 5.1).
 *
 * It is plain JS beside the catalog it cuts down, not TypeScript inside src/, so it is found the way looks.json is:
 * from src/ in the repo, from dist/ in a deploy, or under TULMI_SHARED_DIR. If it cannot be found the server still
 * starts and serves the file whole, which is right for a catalog that has nothing above format 1.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const LOOKS_FORMAT_MAX = 2;

type Projector = {
  projectLooks: (spec: unknown, f: number) => Record<string, unknown>;
  formatOfCatalog: (spec: unknown) => number;
  ProjectError: new (m: string) => Error;
};

/** Where shared/bots/project.mjs is, found as looks.json is. */
function projectFile(): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle without a file address */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "bots", "project.mjs"),
    here && resolve(here, "..", "..", "..", "..", "shared", "bots", "project.mjs"),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "bots", "project.mjs"),
    resolve(process.cwd(), "..", "shared", "bots", "project.mjs"),
    resolve(process.cwd(), "shared", "bots", "project.mjs"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * What is used when the shared file is not beside this build. It is NOT the catalog whole: once looks.json carries
 * scenes, serving them to a format-1 build is a catalog its core refuses, and it would refetch at every bootstrap.
 * So this cuts the way the shared projection does, roughly but safely: scenes go, and so does any item above f.
 */
const PASSTHROUGH: Projector = {
  projectLooks: (spec, f) => {
    if (!isRec(spec)) return {};
    const want = Math.max(1, Math.floor(Number(f)) || 1);
    const out: Record<string, unknown> = { ...spec, format: want };
    if (want < 2) delete out.scenes;
    for (const where of ["moments", "scenes"]) {
      const sec = isRec(out[where]) ? (out[where] as Record<string, unknown>) : null;
      if (!sec) continue;
      const kept: Record<string, unknown> = {};
      for (const [id, item] of Object.entries(sec)) {
        const g = isRec(item) && typeof item.format === "number" ? item.format : 1;
        if (g <= want) kept[id] = item;
      }
      out[where] = kept;
    }
    const idle = isRec(out.idle) ? { ...(out.idle as Record<string, unknown>) } : null;
    const moments = isRec(out.moments) ? (out.moments as Record<string, unknown>) : {};
    if (idle && Array.isArray(idle.moments)) {
      idle.moments = (idle.moments as unknown[]).filter((id) => typeof id === "string" && id in moments);
      out.idle = idle;
    }
    return out;
  },
  formatOfCatalog: (spec) => {
    let f = 1;
    if (!isRec(spec)) return f;
    for (const where of ["moments", "scenes"]) {
      const sec = isRec(spec[where]) ? (spec[where] as Record<string, unknown>) : {};
      for (const item of Object.values(sec)) if (isRec(item) && typeof item.format === "number") f = Math.max(f, item.format);
    }
    return f;
  },
  ProjectError: Error,
};

const file = projectFile();
const loaded: Projector = file ? ((await import(pathToFileURL(file).href)) as unknown as Projector) : PASSTHROUGH;

/** The guard, for its own test: what a deploy without shared/bots/project.mjs would serve. */
export const passthroughProjector: Projector = PASSTHROUGH;

/** True when the shared projection is really here (a test asserts it in this repo). */
export const projectionLoaded = !!file;

export const projectLooks = loaded.projectLooks;
export const formatOfCatalog = loaded.formatOfCatalog;
export const ProjectError = loaded.ProjectError;
