/**
 * THE nlook CATALOG (shared/native/looks.json; native/SPEC.md sections 2.2 and 5.2): the palettes and the designs the Home Screen
 * widgets and the iOS Live Activity draw, as data. An extension of the bots' looks code (experience/bots/looks.ts), not a copy of it:
 * the same file-or-pushed shape, the same bootstrap flag shape, the same admin PUT and DELETE.
 *
 *   activeNativeLooks()   the catalog served now: one pushed since the deploy while its v is higher than the file's, else the file's
 *   checkNativeLooks()    every design cleaned on its own (clean.ts), plus the catalog's own rules: byte cap, palette shapes, a
 *                         fallback that names nothing, a bind that names nothing
 *   pushNativeLooks()     PUT /v1/admin/native/looks, kept on the control volume. `v` NEVER repeats: a high-water mark is kept
 *                         beside it, so a rollback (DELETE) re-serves the older content under a HIGHER number and every phone
 *                         holding the first copy refetches. (The bots' looks only require a v above the one served now, which a
 *                         rollback can repeat.)
 *   servedCatalog()       the projection one phone gets: only designs this build draws and this platform uses, targets stripped
 *   nativeLooksFlags()    the bootstrap's word, "native.looks": { v, url }. Nothing at all while the switch is off (launch dark)
 *   legacyLookOf()        the old widgets.look knob rebuilt from a palette, so a test can prove the two never drift (H4)
 *
 * LAUNCH DARK. NATIVE_LOOKS off (the default) means no flag, no route answer and no `look` on any glance: every build draws the
 * hand-written native view it draws today. NATIVE_ACTIVITY is the same switch for the Live Activity's designs on their own.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANDROID_WIDGET_ROOTS, NLOOK_CAPS, NLOOK_LIMITS, NLOOK_TARGET_SURFACES, PALETTE_ROLES, ROLE_FALLBACK,
  type NLookArt, type NLookCatalog, type NLookDesign, type NLookFont, type NLookPalette, type NLookScheme,
  type NLookTargetSurface,
} from "../../../../shared/types/nlook.js";
import { getConfig } from "../../config.js";
import { cleanDesign, type CleanResult } from "./clean.js";

/** The format of the contract in this deploy. A design above it is skipped alone, never served. */
export const NLOOK_SERVER_FORMAT = 1;

/** No build names more formats than this: the bound keeps the count finite for a capability set that says yes to everything. */
const FORMATS_MAX = 99;

export type Platform = "ios" | "android";

/**
 * The newest design format a build draws: 1 for "NativeLook1", n for a build that also says "NativeLook<n>"; 0 for a build that
 * says none, which gets no designs at all. Mirrors playsFormat for the bots' looks (experience/bots/looks.ts).
 */
export function drawsFormat(can: ReadonlySet<string>, family: string = NLOOK_CAPS.nativeLook): number {
  if (!can.has(`${family}1`)) return 0;
  let f = 1;
  while (f < FORMATS_MAX && can.has(`${family}${f + 1}`)) f++;
  return f;
}

// ---------------------------------------------------------------- the file, the pushed copy and the high-water mark

/** The file in the repo, found from src/ or dist/ (as the bots' looks finds theirs), or TULMI_SHARED_DIR. */
function looksFile(): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle with no file address: no file */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "native", "looks.json"),
    here && resolve(here, "..", "..", "..", "..", "shared", "native", "looks.json"),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "native", "looks.json"),
    resolve(process.cwd(), "..", "shared", "native", "looks.json"),
    resolve(process.cwd(), "shared", "native", "looks.json"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const controlDir = (): string => process.env.CONTROL_DIR || "/data/control";
/** Where a pushed catalog is kept (the control volume, beside bot-looks.json). */
export const pushedFile = (): string => join(controlDir(), "native-looks.json");
/** The highest `v` ever served from this server, so a rollback cannot re-serve different content under a number a phone holds. */
export const markFile = (): string => join(controlDir(), "native-looks-v.json");

let fileLooks: NLookCatalog | null | undefined;
let pushed: NLookCatalog | null | undefined;
let mark: number | undefined;
/**
 * The number the FILE's catalog is being served under, when its own `v` has already been handed out with other content.
 * `{ v }` is the file's own version, `as` is what every phone, ETag, flag and nudge sees. Kept beside the mark so a restart
 * does not move it: a served number that changed under a phone is the one thing the mark exists to prevent.
 */
let fileAs: { v: number; as: number } | null | undefined;
/** The content of the catalog served at `mark`, by hash: how "the same file again" is told from "different content". */
let markHash: string | undefined;
/** setNativeLooksForTests: a catalog handed in by a test never writes its number to the control volume. */
let ephemeral = false;

/** The catalog in the repo. Null when it cannot be found or read. */
export function fileCatalog(): NLookCatalog | null {
  if (fileLooks !== undefined) return fileLooks;
  try {
    const p = looksFile();
    fileLooks = p ? (JSON.parse(readFileSync(p, "utf8")) as NLookCatalog) : null;
  } catch { fileLooks = null; }
  return fileLooks;
}

function pushedCatalog(): NLookCatalog | null {
  if (pushed !== undefined) return pushed;
  try {
    const p = pushedFile();
    const c = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as NLookCatalog) : null;
    pushed = c && !checkNativeLooks(c).length ? c : null;
  } catch { pushed = null; }
  return pushed;
}

/** Everything the mark file holds, read once per process. */
function readMark(): void {
  if (mark !== undefined) return;
  mark = 0;
  fileAs = null;
  markHash = "";
  try {
    const p = markFile();
    if (!existsSync(p)) return;
    const raw = JSON.parse(readFileSync(p, "utf8")) as { v?: unknown; h?: unknown; fileAs?: { v?: unknown; as?: unknown } };
    const n = Number(raw.v);
    if (Number.isFinite(n) && n > 0) mark = n;
    if (typeof raw.h === "string") markHash = raw.h;
    const fv = Number(raw.fileAs?.v), fa = Number(raw.fileAs?.as);
    if (Number.isFinite(fv) && fv > 0 && Number.isFinite(fa) && fa > 0) fileAs = { v: fv, as: fa };
  } catch { /* no mark: this server has served nothing it must stay above */ }
}

/**
 * What was served, by content. Short on purpose: it only ever answers "is this the same catalog as last time?".
 * Memoized per object, because activeNativeLooks() is on the glance's hot path and a catalog is tens of kilobytes.
 */
const hashes = new WeakMap<NLookCatalog, string>();
function contentHash(c: NLookCatalog): string {
  const had = hashes.get(c);
  if (had) return had;
  const h = createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16);
  hashes.set(c, h);
  return h;
}

/** The highest `v` ever SERVED from this server, not counting a file nobody has been given yet (0 when it has served none). */
function served(): number {
  readMark();
  return mark ?? 0;
}

/** The highest `v` a publish must stay above: everything served, and the file in the repo, whether served yet or not. */
export function highWater(): number {
  return Math.max(served(), fileCatalog()?.v ?? 0);
}

function writeMark(): void {
  if (ephemeral) return;
  try {
    const p = markFile();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(`${p}.tmp`, JSON.stringify({ v: mark ?? 0, ...(markHash ? { h: markHash } : {}), ...(fileAs ? { fileAs } : {}) }));
    renameSync(`${p}.tmp`, p);
  } catch { /* the mark is best effort: the in-process one still holds for this server */ }
}

/** Remember that `v` was served, and what was served under it. */
function raiseHighWater(v: number, hash?: string): void {
  readMark();
  if (v < (mark ?? 0)) return;
  if (v === (mark ?? 0) && (!hash || hash === markHash)) return;
  mark = v;
  if (hash) markHash = hash;
  writeMark();
}

/**
 * The catalog served now: a pushed one while its v is higher than the file's, else the file's.
 *
 * WHEN THE FILE WINS AND ITS OWN `v` HAS ALREADY BEEN SERVED — a push took v5, a rollback dropped it, and a later PR raised
 * the file to v5 with different content — the file is served under `mark + 1` instead, and that number is written down so it
 * never moves again. Everything reads the catalog through here, so the route, the ETag, the bootstrap flag and the rollback's
 * nudge all say the same number, and a phone holding the pushed v5 sees a version it does not have and refetches. Without
 * this, "v never repeats" held for pushes and quietly failed for the deploy that followed one.
 */
export function activeNativeLooks(): NLookCatalog | null {
  const f = fileCatalog(), p = pushedCatalog();
  if (p && (!f || p.v > f.v)) { raiseHighWater(p.v, contentHash(p)); return p; }
  if (!f) return null;
  readMark();
  const hash = contentHash(f);
  if (fileAs && fileAs.v !== f.v) fileAs = null;
  // Bumped when the file's own `v` would be a step BACK (something newer was served), or when that very number already
  // went out carrying different content. Serving the same file again under the same number is not either of those.
  const repeats = (mark ?? 0) > f.v || ((mark ?? 0) === f.v && !!markHash && markHash !== hash);
  if (!fileAs && repeats) fileAs = { v: f.v, as: (mark ?? 0) + 1 };
  const as = fileAs ? fileAs.as : f.v;
  raiseHighWater(as, hash);
  if (fileAs) writeMark();
  return as === f.v ? f : { ...f, v: as };
}

/** Tests: forget what was read. */
export function resetNativeLooksForTests(): void {
  fileLooks = undefined;
  pushed = undefined;
  mark = undefined;
  fileAs = undefined;
  markHash = undefined;
  ephemeral = false;
}

/** Tests: serve this catalog instead of the file's, without writing anything to the repo. Pass null to go back to the file. */
export function setNativeLooksForTests(c: NLookCatalog | null): void {
  fileLooks = c;
  pushed = null;
  mark = 0;
  fileAs = null;
  markHash = "";
  ephemeral = true;
}

// ---------------------------------------------------------------- the files a catalog names

/**
 * Where the content-addressed files live: beside the catalog in the repo, so a design's art ships with the design and is
 * served by the API host itself (the phones only ever fetch from a compiled-in host; there is no CDN).
 */
export function nativeFilesDir(kind: "art" | "fonts"): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle with no file address */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "native", kind),
    here && resolve(here, "..", "..", "..", "..", "shared", "native", kind),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "native", kind),
    resolve(process.cwd(), "..", "shared", "native", kind),
    resolve(process.cwd(), "shared", "native", kind),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** The name a file must have on disk. Art carries its scale; a font is the bare hash, because that is what the phone asks for. */
export const artFileName = (sha: string, scale: number): string => `${sha}@${scale}.png`;

/**
 * Every file the catalog names must BE on disk, under its own hash. The hot path (the admin PUT) cannot add a file, so a
 * design whose art is new needs a PR and a deploy — which is the price of serving art from the image, and it is the right
 * way round: a catalog that named a file nobody has would draw holes on Home Screens until someone noticed.
 */
function filesOnDiskErrors(art: readonly NLookArt[], fonts: readonly NLookFont[]): string[] {
  if (!art.length && !fonts.length) return [];
  const out: string[] = [];
  const check = (kind: "art" | "fonts", name: string, want: string, at: string, cap: number) => {
    const dir = nativeFilesDir(kind);
    const p = dir ? join(dir, name) : "";
    if (!p || !existsSync(p)) { out.push(`${at}: no file at shared/native/${kind}/${name}`); return; }
    let buf: Buffer;
    try { buf = readFileSync(p); } catch { out.push(`${at}: shared/native/${kind}/${name} could not be read`); return; }
    if (buf.byteLength > cap) { out.push(`${at}: shared/native/${kind}/${name} is ${buf.byteLength} bytes, over ${cap}`); return; }
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== want) out.push(`${at}: shared/native/${kind}/${name} hashes to ${sha.slice(0, 12)}…, so it is not that file`);
    // A PNG and nothing else: the phones decode art as PNG, and the route serves it as image/png.
    if (kind === "art" && !(buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47)) out.push(`${at}: shared/native/art/${name} is not a PNG`);
  };
  for (const a of art) {
    for (const f of Array.isArray(a?.files) ? a.files : []) {
      const sha = String(f?.sha256 ?? "");
      if (!/^[0-9a-f]{64}$/.test(sha)) continue; // already reported
      check("art", artFileName(sha, Number(f.scale)), sha, `art ${a.key}@${f.scale}`, NLOOK_LIMITS.art.fileBytes);
    }
  }
  for (const f of fonts) {
    const sha = String(f?.sha256 ?? "");
    if (!/^[0-9a-f]{64}$/.test(sha)) { out.push(`font ${f?.id}: sha256 is 64 hex characters`); continue; }
    // No extension: the phone asks for /v1/native/font/<sha> and the route joins the name exactly as given.
    check("fonts", sha, sha, `font ${f.id}`, NLOOK_LIMITS.fonts.fileBytes);
  }
  return out;
}

// ---------------------------------------------------------------- checking a whole catalog

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A scheme holds every role but the three ROLE_FALLBACK resolves; each value is a hex. */
function schemeErrors(at: string, s: unknown): string[] {
  if (!isObj(s)) return [`${at}: a scheme is an object of roles`];
  const out: string[] = [];
  for (const role of PALETTE_ROLES) {
    if (role === "paper") continue;
    const v = s[role];
    if (v === undefined) {
      if (!ROLE_FALLBACK[role]) out.push(`${at}.${role}: missing, and no role falls back to it`);
      continue;
    }
    if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) out.push(`${at}.${role}: a palette role is a #RRGGBB(AA) hex`);
  }
  return out;
}

/**
 * Every problem with the TARGETING RULES. They are server-only, so nothing downstream ever validates them: a rule naming a
 * design that does not exist, or an Activity design for a widget, would publish silently and then draw nothing at all, which
 * reads on a Home Screen exactly like the feature being off. `when.users` must be an ARRAY: written as a string it would be
 * substring-matched by `includes`, so one rule could reach accounts nobody named.
 */
function targetErrors(raw: unknown, designs: Record<string, unknown>): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return ["targets: a list of rules, or nothing at all"];
  const out: string[] = [];
  const surfaces = Object.keys(NLOOK_TARGET_SURFACES);
  raw.forEach((r, i) => {
    const at = `targets[${i}]`;
    if (!isObj(r)) { out.push(`${at}: a rule is { surface, design, when? }`); return; }
    const surface = String(r.surface ?? "");
    if (!surfaces.includes(surface)) { out.push(`${at}.surface: one of ${surfaces.join(", ")}`); return; }
    const want = NLOOK_TARGET_SURFACES[surface as NLookTargetSurface];
    const d = designs[String(r.design ?? "")];
    // `keyboard` names a skin, not a design: a key skin is a file of its own (experience/keyboard/skin.ts).
    if (want === null) {
      if (typeof r.design !== "string" || !r.design) out.push(`${at}.design: the skin's id`);
    } else if (!isObj(d)) {
      out.push(`${at}.design: no design called "${String(r.design ?? "")}"`);
    } else if (d.surface !== want) {
      out.push(`${at}.design: "${String(r.design)}" is a ${String(d.surface)} design, and ${surface} draws a ${want} one`);
    }
    if (r.when === undefined) return;
    if (!isObj(r.when)) { out.push(`${at}.when: { users } or nothing`); return; }
    const users = r.when.users;
    if (users === undefined) return;
    if (!Array.isArray(users) || users.some((u) => typeof u !== "string" || !u)) out.push(`${at}.when.users: a list of account ids`);
  });
  return out;
}

/**
 * Every problem with a catalog, in plain words, for the admin PUT and for CI. Empty means it may be published.
 * A DESIGN that is only `skipped` (its format is above this deploy's) is fine: it is simply never named for these builds.
 */
export function checkNativeLooks(spec: unknown): string[] {
  if (!isObj(spec)) return ["the catalog is an object"];
  const errs: string[] = [];
  const v = Number(spec.v);
  if (!Number.isFinite(v) || v < 1 || Math.round(v) !== v) errs.push("v: a whole number from 1, raised with every change");
  if (Number(spec.format) !== 1) errs.push("format: this deploy publishes catalog format 1");
  if (!isObj(spec.palettes) || !Object.keys(spec.palettes).length) errs.push("palettes: at least one, and it is THE source for widget colour");
  else for (const [name, p] of Object.entries(spec.palettes)) {
    if (!isObj(p)) { errs.push(`palettes.${name}: a palette is { dark, light }`); continue; }
    errs.push(...schemeErrors(`palettes.${name}.dark`, p.dark), ...schemeErrors(`palettes.${name}.light`, p.light));
  }
  const designs = isObj(spec.designs) ? spec.designs : {};
  if (!Object.keys(designs).length) errs.push("designs: a catalog with no designs would say nothing");

  const ids = Object.keys(designs);
  const fallbackOf: Record<string, string | undefined> = {};
  for (const [id, d] of Object.entries(designs)) if (isObj(d) && typeof d.fallback === "string") fallbackOf[id] = d.fallback;
  const palettes = isObj(spec.palettes) ? Object.keys(spec.palettes) : [];
  const art: readonly NLookArt[] = Array.isArray(spec.art) ? (spec.art as NLookArt[]) : [];

  for (const [key, d] of Object.entries(designs)) {
    if (!isObj(d) || d.id !== key) { errs.push(`designs.${key}: the key and the design's own id must be the same word`); continue; }
    const r = cleanDesign(d, { drawsFormat: FORMATS_MAX, palettes, art, designIds: ids, fallbackOf });
    // OUR OWN catalog has to be clean, not merely cleanable. `clamped` means cleanDesign would have thrown something away —
    // a foreign link, an unknown node, a prop over its cap — and project()/servedCatalog() hand out the design OBJECT FROM
    // THE CATALOG, not the cleaned copy, so what was "clamped" here is what a phone receives. The clamping is for a design
    // an OLDER build cannot read; for the file we publish, every issue is an error with its own readable line.
    if (r.verdict === "dropped" || r.verdict === "clamped") errs.push(...r.issues.map((i) => `designs.${key}.${i.at}: ${i.why}`));
    // Our own catalog binds only what the server sends. A typo here would draw a hole on someone's Home Screen.
    for (const b of r.binds) errs.push(`designs.${key}.${b}: binds nothing this build knows`);
    // The cap on what IS SERVED, which is this object, not the cleaned copy cleanDesign measures.
    const cap = d.surface === "activity" ? NLOOK_LIMITS.activity.designBytes : NLOOK_LIMITS.widget.designBytes;
    const raw = Buffer.byteLength(JSON.stringify(d), "utf8");
    if (raw > cap) errs.push(`designs.${key}: ${raw} bytes as written, over the ${cap} a ${String(d.surface)} design may hold`);
  }
  errs.push(...targetErrors(spec.targets, designs));
  for (const a of art) {
    const files = Array.isArray(a?.files) ? a.files : [];
    if (!files.length) errs.push(`art ${a?.key}: files is one entry per scale served`);
    if (files.length > 3) errs.push(`art ${a?.key}: at most three scales`);
    const seen = new Set<number>();
    for (const f of files) {
      const scale = Number(f?.scale);
      if (scale !== 1 && scale !== 2 && scale !== 3) errs.push(`art ${a?.key}: a scale is 1, 2 or 3`);
      else if (seen.has(scale)) errs.push(`art ${a?.key}: scale ${scale} is listed twice`);
      else seen.add(scale);
      // Each scale is a different file, so each one carries its own hash. One hash for all of them could only ever match one.
      if (!/^[0-9a-f]{64}$/.test(String(f?.sha256))) errs.push(`art ${a?.key}@${f?.scale}: sha256 is 64 hex characters`);
      if (Number(f?.bytes) > NLOOK_LIMITS.art.fileBytes) errs.push(`art ${a?.key}@${f?.scale}: over ${NLOOK_LIMITS.art.fileBytes} bytes`);
    }
    if (Math.max(Number(a?.w), Number(a?.h)) > NLOOK_LIMITS.art.longEdgePx) errs.push(`art ${a?.key}: over ${NLOOK_LIMITS.art.longEdgePx} px on the long edge`);
  }
  const fonts = Array.isArray(spec.fonts) ? (spec.fonts as NLookFont[]) : [];
  if (fonts.length > NLOOK_LIMITS.fonts.inCatalog) errs.push(`fonts: at most ${NLOOK_LIMITS.fonts.inCatalog}`);
  errs.push(...filesOnDiskErrors(art, fonts));

  // What one phone would receive, which is the number that matters: the file itself may hold more (targets, server-only designs).
  const bytes = Buffer.byteLength(JSON.stringify(project(spec as unknown as NLookCatalog, { format: FORMATS_MAX, platform: "ios", activity: true })), "utf8");
  if (bytes > NLOOK_LIMITS.catalogBytes) errs.push(`the catalog one phone receives is ${bytes} bytes, over ${NLOOK_LIMITS.catalogBytes}`);
  return errs;
}

/** Every design cleaned, for the admin dry run and the preview renderer: what would be served, and what each one lost. */
export function cleanCatalog(spec: unknown, o: { drawsFormat?: number } = {}): CleanResult[] {
  if (!isObj(spec) || !isObj(spec.designs)) return [];
  const ids = Object.keys(spec.designs);
  const fallbackOf: Record<string, string | undefined> = {};
  for (const [id, d] of Object.entries(spec.designs)) if (isObj(d) && typeof d.fallback === "string") fallbackOf[id] = d.fallback;
  return Object.values(spec.designs).map((d) => cleanDesign(d, {
    drawsFormat: o.drawsFormat ?? NLOOK_SERVER_FORMAT,
    palettes: isObj(spec.palettes) ? Object.keys(spec.palettes) : [],
    art: Array.isArray(spec.art) ? (spec.art as NLookArt[]) : [],
    designIds: ids, fallbackOf,
  }));
}

// ---------------------------------------------------------------- publishing

/**
 * Push a catalog without a deploy. Checked as every reader would read it, and its `v` must be above the HIGH-WATER MARK, not merely
 * above the one served now: a rollback re-serves under a higher number, so content a phone holds is never replaced under its own v.
 * `since` is computed here, never written by an author: a design whose content is unchanged keeps the v it first appeared under.
 */
export function pushNativeLooks(spec: unknown, o: { dry?: boolean } = {}): { ok: true; v: number; since: Record<string, number> } | { ok: false; status: number; errors: string[] } {
  const errors = checkNativeLooks(spec);
  if (errors.length) return { ok: false, status: 400, errors };
  const c = structuredClone(spec) as NLookCatalog;
  const floor = Math.max(highWater(), activeNativeLooks()?.v ?? 0);
  if (c.v <= floor) return { ok: false, status: 409, errors: [`v must be above ${floor}, the highest ever served (a rollback re-serves under a higher number)`] };
  const since = stampSince(c, activeNativeLooks());
  if (o.dry) return { ok: true, v: c.v, since };
  const p = pushedFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(c));
  renameSync(`${p}.tmp`, p);
  pushed = c;
  raiseHighWater(c.v);
  return { ok: true, v: c.v, since };
}

/** `since` for every design: the catalog `v` its content first appeared under. Unchanged content keeps its old number. */
export function stampSince(c: NLookCatalog, before: NLookCatalog | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, d] of Object.entries(c.designs ?? {})) {
    const old = before?.designs?.[id];
    const same = old && JSON.stringify({ ...old, since: 0 }) === JSON.stringify({ ...d, since: 0 });
    const since = same && typeof old.since === "number" ? old.since : c.v;
    d.since = since;
    out[id] = since;
  }
  return out;
}

/**
 * Take a pushed catalog back: the file's is served again, under a number ABOVE everything served so far. The number comes
 * from activeNativeLooks(), which does the bumping and writes it down — so what this returns (and what the DELETE route
 * nudges with) is exactly the `v` the next phone to ask will be handed, rather than a number nothing was serving.
 */
export function dropPushedNativeLooks(): number | null {
  try { rmSync(pushedFile(), { force: true }); } catch { /* nothing kept */ }
  pushed = null;
  return activeNativeLooks()?.v ?? null;
}

// ---------------------------------------------------------------- what one phone receives

export interface ProjectOptions {
  /** The highest design format this build draws (drawsFormat). 0 means it draws none. */
  format: number;
  platform: Platform;
  /** Whether Live Activity designs may go at all (the NATIVE_ACTIVITY switch; iOS only in any case). */
  activity: boolean;
}

/**
 * The catalog as one phone receives it: targeting rules stripped, designs above this build's format left out, and only the
 * surfaces this platform has. A design left out is left out ALONE; the catalog around it is served as usual.
 */
export function project(c: NLookCatalog, o: ProjectOptions): NLookCatalog {
  const designs: Record<string, NLookDesign> = {};
  for (const [id, d] of Object.entries(c.designs ?? {})) {
    if (!d || typeof d !== "object") continue;
    if (Number(d.format) > o.format) continue;
    if (d.surface === "activity" && (o.platform !== "ios" || !o.activity)) continue;
    if (d.surface === "liveupdate" && o.platform !== "android") continue;
    // Android draws the three sizes only: RemoteViews has no accessory families, so those roots are weight for nothing.
    if (d.surface === "widget" && o.platform === "android" && d.roots) {
      const roots: NLookDesign["roots"] = {};
      for (const r of ANDROID_WIDGET_ROOTS) if (d.roots[r]) roots[r] = d.roots[r];
      if (!Object.keys(roots).length) continue;
      designs[id] = { ...d, roots };
      continue;
    }
    designs[id] = d;
  }
  return {
    v: c.v, format: c.format, ...(c.note ? { note: c.note } : {}),
    palettes: c.palettes, designs,
    ...(c.art?.length ? { art: c.art } : {}),
    ...(c.fonts?.length ? { fonts: c.fonts.filter((f) => f.platforms.includes(o.platform)) } : {}),
  };
}

/**
 * Whether this deploy sends designs at all, and whether the two pushed surfaces' designs are among them (launch dark; all
 * three off by default). Each surface switch needs the master switch too: `looks` off means nothing is named anywhere.
 */
export function nativeSwitches(): { looks: boolean; activity: boolean; notice: boolean } {
  const cfg = getConfig();
  const looks = cfg.NATIVE_LOOKS === true;
  return { looks, activity: looks && cfg.NATIVE_ACTIVITY === true, notice: looks && cfg.ANDROID_BOTS_NOTICE === true };
}

/** The catalog one build gets, or null when the switch is off, the build draws nothing, or there is no catalog. */
export function servedCatalog(can: ReadonlySet<string>, platform: Platform): NLookCatalog | null {
  if (!nativeSwitches().looks) return null;
  const format = Math.min(drawsFormat(can), NLOOK_SERVER_FORMAT);
  if (format < 1) return null;
  const c = activeNativeLooks();
  return c ? project(c, { format, platform, activity: nativeSwitches().activity }) : null;
}

/**
 * Whether any targeting rule could ever name a design for this person: a plain rule (one with no `when`), or a rule whose
 * `when.users` lists them. The rules are catalog data, which is why this lives here and not in target.ts.
 */
export function looksCouldReach(userId?: string): boolean {
  const rules = activeNativeLooks()?.targets ?? [];
  // Array.isArray first: `users` written as a string would be substring-matched by includes, so "abc" would reach "b".
  return rules.some((r) => !r.when || (!!userId && Array.isArray(r.when.users) && r.when.users.includes(userId)));
}

/**
 * The bootstrap's word: which catalog is current, and where to fetch it. Nothing at all while the switch is off, and nothing
 * for a person NO RULE COULD EVER NAME A DESIGN FOR. That second gate matters: this flag is what starts the phone's whole
 * sync (fetch the catalog, fetch the art, draw the bot stills, write a version folder). With `targets` empty, turning the
 * master switch on must start that on nobody; in the testers' stage it starts only on the testers' phones.
 */
export function nativeLooksFlags(userId?: string): Record<string, unknown> {
  if (!nativeSwitches().looks) return {};
  if (!looksCouldReach(userId)) return {};
  const c = activeNativeLooks();
  return c ? { "native.looks": { v: c.v, url: `/v1/native/looks?v=${c.v}` } } : {};
}

// ---------------------------------------------------------------- the nudge, once per publish

/** What the nudge needs, passed in, so this file imports nothing from the push engine and a test can drive it. */
export interface NudgeDeps {
  /** Every phone whose binary said NativeLook1, narrowed to `only` when the catalog's rules all name their own users. */
  phones(cap: string, only?: ReadonlySet<string>): Promise<{ userId: string; token: string; platform: "ios" | "android" }[]>;
  send(messages: {
    to: string; title: string; body: string; data: Record<string, unknown>;
    priority: "normal"; ttl: number; collapseId: string; dataOnly?: true; contentAvailable?: true;
  }[]): Promise<unknown>;
  /** Between batches. The default spreads them; a test passes a no-op. */
  wait?: (ms: number) => Promise<void>;
  log?: { info(msg: string): void; warn(msg: string): void };
}

/** The silent push's kind, which the phone's background task switches on. */
export const NUDGE_KIND = "native.looks";
const NUDGE_BATCH = 100;
/** The whole publish is spread over about this long, so a catalog and its art are not fetched by everyone at once. */
const NUDGE_SPREAD_MS = 10 * 60_000;

/**
 * "A new catalog is out." Sent ONCE per publish, to phones that said NativeLook1, as a push that shows nothing: data-only on
 * Android (normal priority — FCM deprioritizes an app whose high-priority messages draw nothing, and a catalog can wait for
 * the next Doze window), content-available on iOS (Apple requires priority 5 for a background push).
 *
 * The same gate as the bootstrap flag: while every rule carries `when.users`, only those users are nudged. Nothing of the
 * person travels in it — the kind and the version, and nothing else.
 */
export async function nudgeLooks(v: number, d: NudgeDeps): Promise<{ sent: number; batches: number; skipped?: string }> {
  if (!nativeSwitches().looks) return { sent: 0, batches: 0, skipped: "the switch is off" };
  const rules = activeNativeLooks()?.targets ?? [];
  if (!rules.length) return { sent: 0, batches: 0, skipped: "no rule names a design" };
  const everyone = rules.some((r) => !r.when);
  const only = everyone ? undefined : new Set(rules.flatMap((r) => r.when?.users ?? []));
  if (only && !only.size) return { sent: 0, batches: 0, skipped: "no rule names a design" };

  const phones = await d.phones(NLOOK_CAPS.look1, only).catch(() => []);
  if (!phones.length) return { sent: 0, batches: 0 };
  const wait = d.wait ?? ((ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); }));
  const batches = Math.ceil(phones.length / NUDGE_BATCH);
  const gap = batches > 1 ? Math.round(NUDGE_SPREAD_MS / (batches - 1)) : 0;

  let sent = 0;
  for (let i = 0; i < phones.length; i += NUDGE_BATCH) {
    if (i) await wait(gap).catch(() => undefined);
    const chunk = phones.slice(i, i + NUDGE_BATCH).map((p) => ({
      to: p.token, title: "", body: "",
      data: { kind: NUDGE_KIND, v },
      priority: "normal" as const,
      // Six hours: a nudge older than that is about a catalog the phone has had every chance to find on its own.
      ttl: 6 * 3600,
      collapseId: NUDGE_KIND,
      ...(p.platform === "android" ? { dataOnly: true as const } : { contentAvailable: true as const }),
    }));
    try { await d.send(chunk); sent += chunk.length; }
    catch (err) { d.log?.warn(`native looks: a nudge batch failed (${(err as Error)?.message?.slice(0, 80) ?? "error"})`); }
  }
  d.log?.info(`native looks: nudged ${sent} phones about v${v} in ${batches} batch(es)`);
  return { sent, batches };
}

// ---------------------------------------------------------------- the legacy knob, rebuilt

/** The shape widgets.look has carried since the first widget release (widgets/defaults.ts). Only its colour half is rebuilt here. */
export interface LegacyLook {
  colors: { ground: string; pale: string; mark: string; accent: string; meta: string; line: string; surface: string };
  light: { ground: string; pale: string; mark: string; accent: string; meta: string; line: string; surface: string };
  alpha: { dim: number; rule: number };
}

const legacySide = (s: NLookScheme): LegacyLook["colors"] => ({
  ground: s.ground, pale: s.ink, mark: s.ink, accent: s.accent, meta: s.meta, line: s.line, surface: s.surface,
});

/**
 * The old widgets.look knob rebuilt from a palette (H4). The knob itself stays hand-written in defaults.ts, which must keep no
 * imports at all so the console can preview it; this is the CHECKED COPY, and a test deep-equals the two so drift fails the build.
 * The knob keeps its own shape: it never gains dim, outline or hollow.
 */
export function legacyLookOf(p: NLookPalette): LegacyLook {
  return { colors: legacySide(p.dark), light: legacySide(p.light), alpha: { dim: p.alpha?.dim ?? 0.64, rule: p.alpha?.rule ?? 0.15 } };
}

/**
 * The `since` a design carries in the catalog being served, or undefined when that catalog does not hold it. A missing
 * `since` reads as the catalog's own `v`, for the same reason drawable() does it (experience/native/target.ts): the ordinary
 * publish path never stamps one. Used by the crash marks, so a design that is FIXED and republished is tried again.
 */
export function designSince(id: string): number | undefined {
  const c = activeNativeLooks();
  const d = c?.designs?.[id];
  if (!c || !d) return undefined;
  return typeof d.since === "number" && Number.isFinite(d.since) ? d.since : c.v;
}

/** The palette the widgets' colour comes from: the catalog's named one, else its first. Null when there is no catalog. */
export function defaultPalette(name?: string): NLookPalette | null {
  const c = activeNativeLooks();
  if (!c) return null;
  if (name && c.palettes[name]) return c.palettes[name]!;
  const first = Object.values(c.palettes)[0];
  return first ?? null;
}
