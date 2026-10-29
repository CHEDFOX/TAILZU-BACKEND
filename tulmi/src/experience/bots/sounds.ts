/**
 * THE BOTS' SOUNDS (shared/types/sdui.ts 3h; docs/bots-app.md "Sounds"): the catalog the phone plays, where its files are,
 * and pushing a new pack without a deploy.
 *
 *   shared/bots/sounds.json     the catalog in the repo: `v` (raise it with every change), and each sound's id, file, hash,
 *                               kind, weight, rare, ms, label (tulmi/scripts/make-bot-sounds.py writes it with the files)
 *   shared/bots/sounds/*.m4a    the files, served at /bots/sounds/ (routes/botSounds.ts), immutable: a URL carries its
 *                               file's hash, so a changed file is a new URL (masters/*.wav are kept, never served)
 *   a pushed catalog            PUT /v1/admin/bots/sounds: kept on the control volume, served while its v is higher than
 *                               the file's; its sounds may name an https address (a file put in the media store) instead
 *
 * The Bots app's bootstrap carries "bots.sounds": { v, url } (soundsFlags); a phone whose catalog is another v fetches
 * GET /v1/bots/sounds and the files it does not have.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotSound, BotSoundKind, BotSoundsCatalog } from "../../../../shared/types/sdui.js";

export const SOUND_KINDS: readonly BotSoundKind[] = ["throw", "tick", "new", "uptodate", "moment"];
/** Where the files are served (server.ts registers it with the route file). */
export const SOUNDS_PREFIX = "/bots/sounds/";
/** The longest a sound may be, and how many a catalog may hold. */
export const SOUND_MAX_MS = 450;
export const SOUNDS_MAX = 64;

/** A sound as the catalog file has it: a `file` in shared/bots/sounds/, or (a pushed catalog) a `url`. */
export interface SoundSpec {
  id: string;
  file?: string;
  url?: string;
  hash: string;
  kind: BotSoundKind;
  weight: number;
  ms: number;
  rare?: boolean;
  label?: string;
}

export interface SoundsSpec {
  v: number;
  note?: string;
  sounds: SoundSpec[];
}

const ID = /^[a-z0-9][a-z0-9._-]{0,40}$/;
const FILE = /^[a-z0-9][a-z0-9._-]{0,60}\.m4a$/;
const HASH = /^[0-9a-f]{8,64}$/;
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * What is wrong with a catalog, as the phone would read it ([] when nothing). `dir`: also check that every file is there
 * and its hash is the file's own (the repo's catalog against its files).
 */
export function checkSounds(spec: unknown, o: { dir?: string } = {}): string[] {
  const errs: string[] = [];
  if (!isRec(spec)) return ["a catalog: { v, sounds }"];
  for (const k of Object.keys(spec)) if (!["v", "note", "sounds"].includes(k)) errs.push(`unknown field ${k}`);
  if (typeof spec.v !== "number" || !Number.isInteger(spec.v) || spec.v < 1) errs.push("v: a whole number from 1");
  if (!Array.isArray(spec.sounds) || !spec.sounds.length || spec.sounds.length > SOUNDS_MAX) {
    errs.push(`sounds: a list of 1 to ${SOUNDS_MAX}`);
    return errs;
  }
  const ids = new Set<string>();
  spec.sounds.forEach((s, i) => {
    const at = `sounds[${i}]`;
    if (!isRec(s)) { errs.push(`${at}: an object`); return; }
    for (const k of Object.keys(s)) if (!["id", "file", "url", "hash", "kind", "weight", "ms", "rare", "label"].includes(k)) errs.push(`${at}: unknown field ${k}`);
    const id = String(s.id ?? "");
    if (!ID.test(id)) errs.push(`${at}.id: lower-case letters, digits, . _ -`);
    else if (ids.has(id)) errs.push(`${at}.id: "${id}" twice`);
    ids.add(id);
    if (!SOUND_KINDS.includes(s.kind as BotSoundKind)) errs.push(`${at}.kind: one of ${SOUND_KINDS.join(", ")}`);
    if (typeof s.weight !== "number" || !(s.weight >= 0 && s.weight <= 100)) errs.push(`${at}.weight: 0 to 100`);
    if (typeof s.ms !== "number" || !(s.ms > 0 && s.ms <= SOUND_MAX_MS)) errs.push(`${at}.ms: up to ${SOUND_MAX_MS}`);
    if (s.rare !== undefined && typeof s.rare !== "boolean") errs.push(`${at}.rare: true or false`);
    if (s.label !== undefined && (typeof s.label !== "string" || s.label.length > 60)) errs.push(`${at}.label: up to 60 characters`);
    if (typeof s.hash !== "string" || !HASH.test(s.hash)) errs.push(`${at}.hash: hex`);
    const hasFile = s.file !== undefined, hasUrl = s.url !== undefined;
    if (hasFile === hasUrl) errs.push(`${at}: a file or a url`);
    if (hasFile) {
      if (typeof s.file !== "string" || !FILE.test(s.file)) errs.push(`${at}.file: a .m4a name`);
      else if (o.dir) {
        const p = join(o.dir, s.file);
        if (!existsSync(p)) errs.push(`${at}.file: ${s.file} is not there`);
        else if (typeof s.hash === "string" && fileHash(p) !== s.hash) errs.push(`${at}.hash: not ${s.file}'s (make the sounds again)`);
      }
    }
    if (hasUrl && (typeof s.url !== "string" || !/^https:\/\/[^\s]+$/.test(s.url))) errs.push(`${at}.url: an https address`);
  });
  for (const kind of ["throw", "tick", "new", "uptodate"] as const) {
    if (!spec.sounds.some((s) => isRec(s) && s.kind === kind && Number(s.weight) > 0)) errs.push(`no ${kind} sound`);
  }
  return errs;
}

/** A file's hash as the catalog writes it: sha-256, its first 12 hex. */
export function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------- where things are

function sharedCandidates(...rest: string[]): string[] {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle without a file address */ }
  return [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "bots", ...rest),
    here && resolve(here, "..", "..", "..", "..", "shared", "bots", ...rest), // tulmi/src/experience/bots → repo/shared
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "bots", ...rest), // dist/tulmi/src/experience/bots → /app/shared
    resolve(process.cwd(), "..", "shared", "bots", ...rest),
    resolve(process.cwd(), "shared", "bots", ...rest),
  ].filter(Boolean) as string[];
}

/** The sounds' folder (shared/bots/sounds), or null. */
export function soundsDir(): string | null {
  return sharedCandidates("sounds").find((p) => existsSync(p)) ?? null;
}

/** Where a pushed catalog is kept (the control volume). */
export function pushedSoundsFile(): string {
  return join(process.env.CONTROL_DIR || "/data/control", "bot-sounds.json");
}

let fileSounds: SoundsSpec | null | undefined;
let pushed: SoundsSpec | null | undefined;

/** The catalog in the repo (shared/bots/sounds.json), read once. */
export function fileSoundsCatalog(): SoundsSpec | null {
  if (fileSounds !== undefined) return fileSounds;
  try {
    const p = sharedCandidates("sounds.json").find((x) => existsSync(x));
    fileSounds = p ? (JSON.parse(readFileSync(p, "utf8")) as SoundsSpec) : null;
  } catch { fileSounds = null; }
  return fileSounds;
}

function pushedSounds(): SoundsSpec | null {
  if (pushed !== undefined) return pushed;
  try {
    const p = pushedSoundsFile();
    const c = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SoundsSpec) : null;
    pushed = c && !checkSounds(c).length ? c : null;
  } catch { pushed = null; }
  return pushed;
}

/** The catalog served now: a pushed one while its v is higher than the file's, else the file's. */
export function activeSounds(): SoundsSpec | null {
  const f = fileSoundsCatalog(), p = pushedSounds();
  if (p && (!f || p.v > f.v)) return p;
  return f;
}

/**
 * Push a catalog without a deploy (PUT /v1/admin/bots/sounds): checked as the phone reads it, its v above the one served.
 * Its new sounds name https addresses (files put in the media store); the repo's files can be named by `file`.
 */
export function pushSounds(spec: unknown, o: { dry?: boolean } = {}): { ok: true; v: number } | { ok: false; status: number; errors: string[] } {
  const dir = soundsDir() ?? undefined;
  const errors = checkSounds(spec, { dir });
  if (errors.length) return { ok: false, status: 400, errors };
  const c = spec as SoundsSpec, now = activeSounds();
  if (now && c.v <= now.v) return { ok: false, status: 409, errors: [`v must be above ${now.v}, the one served now`] };
  if (o.dry) return { ok: true, v: c.v };
  const p = pushedSoundsFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(c));
  renameSync(`${p}.tmp`, p);
  pushed = c;
  return { ok: true, v: c.v };
}

/** Take a pushed catalog back: the file's is served again. */
export function dropPushedSounds(): void {
  try { rmSync(pushedSoundsFile(), { force: true }); } catch { /* nothing kept */ }
  pushed = null;
}

/** Tests: forget what was read. */
export function resetSoundsForTests(): void {
  fileSounds = undefined;
  pushed = undefined;
}

/** The catalog as the phone gets it: each sound with the address of its file (its hash in it). */
export function servedSounds(c: SoundsSpec): BotSoundsCatalog {
  return {
    v: c.v,
    sounds: c.sounds.map((s): BotSound => ({
      id: s.id, kind: s.kind, weight: s.weight, ms: s.ms, hash: s.hash,
      url: s.file ? `${SOUNDS_PREFIX}${s.file}?h=${s.hash}` : String(s.url),
      ...(s.rare ? { rare: true } : {}), ...(s.label ? { label: s.label } : {}),
    })),
  };
}

/** The bootstrap's word on the sounds: their catalog's version, and where to get it. Nothing when there is none. */
export function soundsFlags(): Record<string, unknown> {
  const c = activeSounds();
  return c ? { "bots.sounds": { v: c.v, url: `/v1/bots/sounds?v=${c.v}` } } : {};
}
