/**
 * The phone's launch motion (the bot pulls himself up over his bar, his hands come back and the bar is pulled in to
 * them): data the server sends, so a new launch, or a change to this one, reaches every phone without an app update.
 *
 * It is the file shared/launch/launch.json, or one pushed since (PUT /v1/admin/launch) with a higher v. Every phone's
 * bootstrap carries it whole as "app.launch"; the app keeps it with the rest of the bootstrap and plays it from the next
 * start (TAILZU-FRONTEND app/src/launch/launchMotion.ts). A launch the app cannot compile is not played: the copy the
 * build carries is. docs/launch.md has the format.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLets, checkNumber } from "../bots/blip.js";

/** The format this release's app plays (launchMotion.ts LAUNCH_FORMAT). */
const LAUNCH_FORMAT = 1;

export interface LaunchSpec {
  v: number;
  format?: number;
  note?: string;
  length: number;
  fade?: number;
  pinchAt: number;
  macros?: Record<string, [string[], string]>;
  let?: Array<[string, string | number]>;
  bar?: Record<string, unknown>;
  head?: Record<string, unknown>;
  gloves?: Record<string, unknown>;
  strip?: Record<string, unknown>;
}

// ---------------------------------------------------------------- what the app knows (launchMotion.ts, kept in step)

/** The names every formula reads, and each part's own. */
const NAMES = ["t", "Z", "U", "barTop", "barMid", "barBottom", "barLeft", "barRight", "mid"];
const PARTS: Record<string, { names: string[]; fields: string[] }> = {
  bar: { names: [], fields: ["dy"] },
  head: { names: [], fields: ["dy", "sway", "sq", "shut", "shown"] },
  gloves: { names: ["side", "cx", "half"], fields: ["grip", "dy", "edge", "lift", "flip", "gx", "turn", "size", "shown"] },
  strip: { names: ["i", "n", "x", "d"], fields: ["dx", "sx", "sy", "shown"] },
};
/** The app's motion language reads at most this many names in one formula. */
const MAX_NAMES = 32;
const TOP = ["v", "format", "note", "length", "fade", "pinchAt", "macros", "let", ...Object.keys(PARTS)];

/** Every way `spec` is not a launch the app would play; empty when it is. */
export function checkLaunch(spec: unknown): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["a launch: an object"];
  const c = spec as LaunchSpec;
  for (const k of Object.keys(c)) if (!TOP.includes(k)) errs.push(`${k}: not something a launch has`);
  if (!Number.isInteger(c.v) || c.v < 1) errs.push("v: a whole number, 1 or more");
  if ((c.format ?? LAUNCH_FORMAT) !== LAUNCH_FORMAT) errs.push(`format: ${LAUNCH_FORMAT}`);
  if (!(Number.isFinite(c.length) && c.length > 0 && c.length <= 10000)) errs.push("length: ms, up to 10000");
  if (!(Number.isFinite(c.pinchAt) && c.pinchAt > 0 && c.pinchAt < c.length)) errs.push("pinchAt: ms, inside the launch");
  if (c.fade !== undefined && !(Number.isFinite(c.fade) && c.fade >= 0 && c.fade <= 2000)) errs.push("fade: ms, up to 2000");
  const macros = (c.macros ?? {}) as Record<string, [string[], string]>;
  if (typeof macros !== "object" || Array.isArray(macros)) errs.push("macros: name: [[parameters], body]");
  // A launch's own lets are compiled AGAIN FOR EACH PART on the phone (launchCore.ts launchPart), with that part's own
  // names already in its slots — so a top-level `let side` or `let i` has nowhere to go there and the app refuses the
  // whole launch (launchCore.ts launchLets, "… is already a name here"). And because the bar and the head have no
  // names of their own, a top-level formula may READ only NAMES: `side * 2` compiles for the gloves and is an
  // unknown name for the bar. So the formulas are checked against NAMES, and the new names against every part's.
  const PART_OWN = Object.values(PARTS).flatMap((p) => p.names);
  const top = checkLets(c.let, NAMES.slice(), macros, errs, "launch").slice(NAMES.length);
  // The name is said, as the phone says it, so whoever pushed the launch can see which let has to be renamed.
  for (const n of top) if (PART_OWN.includes(n)) errs.push(`launch.let: a new name and an expression (${n} is already a name here)`);
  for (const [p, { names, fields }] of Object.entries(PARTS)) {
    const body = (c as unknown as Record<string, unknown>)[p];
    if (body === undefined) continue;
    if (!body || typeof body !== "object" || Array.isArray(body)) { errs.push(`${p}: an object`); continue; }
    const b = body as Record<string, unknown>;
    const base = [...NAMES, ...names, ...top];
    const all = checkLets(b.let, base, macros, errs, p);
    if (all.length > MAX_NAMES) errs.push(`${p}: at most ${MAX_NAMES} names (the launch's lets and its own, with ${[...NAMES, ...names].join(", ")})`);
    for (const [k, x] of Object.entries(b)) {
      if (k === "let") continue;
      if (!fields.includes(k)) { errs.push(`${p}.${k}: not something the ${p} has (${fields.join(", ")})`); continue; }
      checkNumber(x, all, macros, errs, `${p}.${k}`);
    }
  }
  return errs;
}

// ---------------------------------------------------------------- the file, and a pushed one

function launchFile(): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle without a file address: no file */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "launch", "launch.json"),
    here && resolve(here, "..", "..", "..", "..", "shared", "launch", "launch.json"),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "launch", "launch.json"),
    resolve(process.cwd(), "..", "shared", "launch", "launch.json"),
    resolve(process.cwd(), "shared", "launch", "launch.json"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Where a pushed launch is kept (the control volume, beside Blip's catalog). */
export function pushedLaunchFile(): string {
  return join(process.env.CONTROL_DIR || "/data/control", "launch.json");
}

let fileLaunch: LaunchSpec | null | undefined;
let pushed: LaunchSpec | null | undefined;

function fileSpec(): LaunchSpec | null {
  if (fileLaunch !== undefined) return fileLaunch;
  try { const p = launchFile(); fileLaunch = p ? (JSON.parse(readFileSync(p, "utf8")) as LaunchSpec) : null; } catch { fileLaunch = null; }
  return fileLaunch;
}

function pushedSpec(): LaunchSpec | null {
  if (pushed !== undefined) return pushed;
  try {
    const p = pushedLaunchFile();
    const c = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as LaunchSpec) : null;
    pushed = c && !checkLaunch(c).length ? c : null;
  } catch { pushed = null; }
  return pushed;
}

/** The launch served now: one pushed since the deploy while its v is higher than the file's, else the file's. */
export function activeLaunch(): LaunchSpec | null {
  const f = fileSpec(), p = pushedSpec();
  if (p && (!f || p.v > f.v)) return p;
  return f;
}

/** Push a launch without a deploy (PUT /v1/admin/launch): checked as the app compiles it; its v above the one served. */
export function pushLaunch(spec: unknown, o: { dry?: boolean } = {}): { ok: true; v: number } | { ok: false; status: number; errors: string[] } {
  const errors = checkLaunch(spec);
  if (errors.length) return { ok: false, status: 400, errors };
  const c = spec as LaunchSpec, now = activeLaunch();
  if (now && c.v <= now.v) return { ok: false, status: 409, errors: [`v must be above ${now.v}, the one served now`] };
  if (o.dry) return { ok: true, v: c.v };
  const p = pushedLaunchFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(c));
  renameSync(`${p}.tmp`, p);
  pushed = c;
  return { ok: true, v: c.v };
}

/** Take a pushed launch back: the file's is served again. */
export function dropPushedLaunch(): void {
  rmSync(pushedLaunchFile(), { force: true });
  pushed = null;
}

/** A phone's bootstrap flag: the launch, whole (a few KB), kept by the app and played from its next start. */
export function launchFlags(): Record<string, unknown> {
  const c = activeLaunch();
  return c ? { "app.launch": c } : {};
}

export function resetLaunchForTests(): void {
  fileLaunch = undefined;
  pushed = undefined;
}
