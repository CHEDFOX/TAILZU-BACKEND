/**
 * KEYBOARD SKINS, EXPANDED ON THE SERVER (shared/types/keyboardFace.ts; native/SPEC.md sections 1.6 and 2.10).
 *
 * A skin is authored here (shared/native/skins/*.json, server-only) and expanded into the key tree config.ts already builds: into
 * node `props.face`, `style.fontFamily` and `style.press`, into themeDark and themeLight, and into the existing kb.* flags. THE
 * PHONE SHIPS PRIMITIVES ONLY — no skin resolver, no precedence chain, and it never sees a skin object, only the expanded tree plus
 * the small `skin` block (id, sha, budget, manifest) it needs for telemetry, the crash guard and the prefetch.
 *
 * THE FOUR LAWS, enforced here and again in the renderers:
 *   1. A key never changes what it does. A face is paint. `on`, actions, endpoints, layouts and anything that reads typed text are
 *      REFUSED (SKIN_FORBIDDEN_KEYS), not quietly cleaned: each one would be a guideline 4.4.1 problem, so a skin naming one does
 *      not ship at all.
 *   2. No typed text ever leaves the device. Nothing here adds a request of any kind.
 *   3. Every fetch happens when the config arrives, in one batch from `skin.manifest`. The renderer reads only the cache.
 *   4. Art and fonts come by content hash from our own compiled-in host. A skin can never carry a tracking pixel.
 *
 * LAUNCH DARK: with KEYBOARD_SKINS off (the default) this returns the config byte for byte, whatever a keyboard says it can draw.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KEY_FACE_KEYS, KEY_FACE_LIMITS, KEY_SKIN_1, MARK_SHAPE_KINDS, PRESS_EASES, PRESS_KINDS, SKIN_FLAG_PREFIXES,
  SKIN_FORBIDDEN_KEYS, SKIN_THEME_KEYS, SUB_POSITIONS,
  type KeyFace, type KeyPress, type KeySkinInfo, type KeyboardConfigSkinFields,
} from "../../../../shared/types/keyboardFace.js";
import { nativeFilesDir } from "../native/catalog.js";
import { TYPE_TOKENS } from "../../../../shared/types/nlook.js";
import type { KeyboardConfigResponse, KeyboardNode } from "../../../../shared/types/sdui.js";
import { getConfig } from "../../config.js";

/** The key nodes a face may sit on. Everything else in the tree (rows, bars, labels) is untouched. */
const KEY_TYPES = new Set(["LetterKey", "IconKey", "SpaceKey", "ShiftKey", "ReturnKey", "BackspaceKey", "GlobeKey", "MicKey", "RefineKey"]);

/** One skin as it is authored. Only these keys are read; anything else in the file is ignored, and the forbidden ones refuse it. */
export interface KeySkin {
  id: string;
  format: number;
  /** What the Keybot picker shows. */
  label: string;
  blurb?: string;
  /** A dark skin leads the picker in dark mode. Only a label, never a switch: the keyboard still follows the phone. */
  dark?: boolean;
  note?: string;
  theme?: { dark?: Record<string, unknown>; light?: Record<string, unknown> };
  font?: string;
  press?: KeyPress;
  flags?: Record<string, unknown>;
  faces?: {
    /** Laid under every other face, on every key. */
    all?: KeyFace;
    /** By node type: SpaceKey, ShiftKey, … */
    types?: Record<string, KeyFace>;
    /** By the letter the key types (LetterKey props.char), lower-cased. */
    chars?: Record<string, KeyFace>;
  };
  budget?: KeySkinInfo["budget"];
  manifest?: KeySkinInfo["manifest"];
}

// ---------------------------------------------------------------- reading the files

function skinsDir(): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle with no file address */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "native", "skins"),
    here && resolve(here, "..", "..", "..", "..", "shared", "native", "skins"),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "native", "skins"),
    resolve(process.cwd(), "..", "shared", "native", "skins"),
    resolve(process.cwd(), "shared", "native", "skins"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

let loaded: Map<string, KeySkin> | undefined;

/** Every skin in the repo, by id. A file that does not check is left out with a line in the log, never served half-read. */
export function allSkins(): ReadonlyMap<string, KeySkin> {
  if (loaded) return loaded;
  const out = new Map<string, KeySkin>();
  const dir = skinsDir();
  if (dir) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const s = JSON.parse(readFileSync(join(dir, name), "utf8")) as KeySkin;
        if (!checkSkin(s).length && s.id === name.replace(/\.json$/, "")) out.set(s.id, s);
        else console.warn(`keyboard skins: ${name} was not loaded (${checkSkin(s)[0] ?? "its id and its file name differ"})`);
      } catch { console.warn(`keyboard skins: ${name} is not readable JSON`); }
    }
  }
  loaded = out;
  return out;
}

/** Tests: forget what was read. */
export function resetSkinsForTests(): void { loaded = undefined; }

// ---------------------------------------------------------------- checking one skin

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The only shape an art name may have: a content hash and a screen scale. No host, no path, no extension of its own. */
const ART_NAME = /^[0-9a-f]{64}@[123]\.png$/;

/** Everything in a face that a skin may never carry, at any depth. One of these refuses the skin; it is never cleaned away. */
function forbidden(at: string, v: unknown, out: string[], depth = 0): void {
  if (depth > 6 || !isObj(v)) return;
  for (const [k, child] of Object.entries(v)) {
    if ((SKIN_FORBIDDEN_KEYS as readonly string[]).includes(k)) out.push(`${at}.${k}: a skin is paint; it can never carry "${k}" (App Review 4.4.1)`);
    forbidden(`${at}.${k}`, child, out, depth + 1);
  }
}

/** A colour on a key: a hex, with an optional alpha byte. The keyboard has no palette roles, so nothing else resolves. */
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const isHex = (v: unknown): boolean => typeof v === "string" && HEX.test(v);
const num = (v: unknown, lo: number, hi: number): boolean => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
const short = (v: unknown, cap: number): boolean => typeof v === "string" && v.length > 0 && v.length <= cap;

/**
 * The one thing a program may never read. A key position is a letter: giving a print the press point would be the single
 * way a skin could learn something about typing, which is the second law. Matched on the whole program, keys and values.
 */
const PRESS_POSITION = /\b(press\s*\.\s*[xy]|since\s*\.\s*press)\b/;

/** Every file a skin's manifest names must BE on disk under its own hash, exactly as the nlook catalog's files must. */
function skinFilesOnDisk(manifest: KeySkinInfo["manifest"]): string[] {
  const out: string[] = [];
  const on = (kind: "art" | "fonts", name: string, want: string, at: string, cap: number) => {
    const dir = nativeFilesDir(kind);
    const file = dir ? join(dir, name) : "";
    if (!file || !existsSync(file)) { out.push(`${at}: no file at shared/native/${kind}/${name}`); return; }
    let buf: Buffer;
    try { buf = readFileSync(file); } catch { out.push(`${at}: shared/native/${kind}/${name} could not be read`); return; }
    if (buf.byteLength > cap) { out.push(`${at}: shared/native/${kind}/${name} is ${buf.byteLength} bytes, over ${cap}`); return; }
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== want) out.push(`${at}: shared/native/${kind}/${name} hashes to ${sha.slice(0, 12)}…, so it is not that file`);
    if (kind === "art" && !(buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47)) out.push(`${at}: shared/native/art/${name} is not a PNG`);
  };
  for (const a of manifest?.art ?? []) {
    const m = /^([0-9a-f]{64})@([123])\.png$/.exec(String(a));
    if (m) on("art", String(a), m[1]!, `manifest.art "${a}"`, KEY_FACE_LIMITS.art.fileBytes);
  }
  for (const f of manifest?.fonts ?? []) {
    const sha = String(f?.sha256 ?? "");
    if (!/^[0-9a-f]{64}$/.test(sha)) { out.push(`manifest.fonts ${String(f?.id)}: sha256 is 64 hex characters`); continue; }
    // No extension: the keyboard asks for /v1/native/font/<sha> and the route joins the name exactly as given.
    on("fonts", sha, sha, `manifest.fonts ${String(f.id)}`, KEY_FACE_LIMITS.fonts.fileBytes);
  }
  return out;
}

/** Every problem with ONE face: a closed vocabulary, and a bound on every value in it. */
function faceErrors(at: string, raw: unknown, fonts: ReadonlySet<string>, art: readonly string[]): string[] {
  if (!isObj(raw)) return [`${at}: a face is an object`];
  const out: string[] = [];
  const f = raw as Record<string, unknown>;
  for (const k of Object.keys(f)) {
    if (!(KEY_FACE_KEYS as readonly string[]).includes(k)) out.push(`${at}.${k}: a face carries only ${KEY_FACE_KEYS.join(", ")}`);
  }
  if (f.label !== undefined && !short(f.label, KEY_FACE_LIMITS.text.label)) out.push(`${at}.label: 1 to ${KEY_FACE_LIMITS.text.label} characters`);
  if (f.sub !== undefined && !short(f.sub, KEY_FACE_LIMITS.text.sub)) out.push(`${at}.sub: 1 to ${KEY_FACE_LIMITS.text.sub} characters`);
  if (f.corner !== undefined && !short(f.corner, KEY_FACE_LIMITS.text.corner)) out.push(`${at}.corner: 1 to ${KEY_FACE_LIMITS.text.corner} characters`);
  if (f.subPos !== undefined && !(SUB_POSITIONS as readonly string[]).includes(String(f.subPos))) out.push(`${at}.subPos: ${SUB_POSITIONS.join(", ")}`);
  if (f.layer !== undefined && f.layer !== "behind" && f.layer !== "instead") out.push(`${at}.layer: behind or instead`);
  if (f.color !== undefined && !isHex(f.color)) out.push(`${at}.color: a #RRGGBB(AA) hex`);
  if (f.opacity !== undefined && !num(f.opacity, 0, 1)) out.push(`${at}.opacity: 0 to 1`);
  if (f.size !== undefined && !num(f.size, KEY_FACE_LIMITS.size.min, KEY_FACE_LIMITS.size.max)) out.push(`${at}.size: ${KEY_FACE_LIMITS.size.min} to ${KEY_FACE_LIMITS.size.max}`);
  if (f.weight !== undefined && !num(f.weight, KEY_FACE_LIMITS.weight.min, KEY_FACE_LIMITS.weight.max)) out.push(`${at}.weight: ${KEY_FACE_LIMITS.weight.min} to ${KEY_FACE_LIMITS.weight.max}`);
  if (f.inset !== undefined && !num(f.inset, KEY_FACE_LIMITS.inset.min, KEY_FACE_LIMITS.inset.max)) out.push(`${at}.inset: ${KEY_FACE_LIMITS.inset.min} to ${KEY_FACE_LIMITS.inset.max}`);
  if (f.font !== undefined && !(TYPE_TOKENS as readonly string[]).includes(String(f.font)) && !fonts.has(String(f.font))) {
    out.push(`${at}.font: a type token (${TYPE_TOKENS.join(", ")}) or a font id in manifest.fonts`);
  }
  if (f.icon !== undefined) {
    const i = f.icon;
    const ok = short(i, 60) || (isObj(i) && Object.keys(i).length === 1 && ["sf", "asset", "emoji"].some((k) => short((i as Record<string, unknown>)[k], 60)));
    if (!ok) out.push(`${at}.icon: an icon is sf, asset or emoji; a picture goes through art, by content hash`);
  }
  if (f.art !== undefined) {
    const name = String(f.art);
    if (!ART_NAME.test(name)) out.push(`${at}.art: "${name}" is not the bare manifest name <sha256>@<scale>.png`);
    else if (!art.includes(name)) out.push(`${at}.art: "${name}" is not in manifest.art, so it would be fetched during a session`);
  }
  if (f.mark !== undefined) out.push(...markErrors(`${at}.mark`, f.mark));
  if (f.program !== undefined) {
    if (!isObj(f.program)) out.push(`${at}.program: the numbers-only motion language, as an object`);
    else if (PRESS_POSITION.test(JSON.stringify(f.program))) out.push(`${at}.program: there is no press position (press.x, press.y, since.press) in a key's program`);
  }
  return out;
}

/** Every problem with a drawn print. An unknown shape kind refuses the skin rather than being skipped at render time. */
function markErrors(at: string, raw: unknown): string[] {
  if (!isObj(raw)) return [`${at}: a mark is { viewBox, shapes }`];
  const out: string[] = [];
  const vb = raw.viewBox;
  if (!Array.isArray(vb) || vb.length !== 4 || vb.some((n) => !Number.isFinite(Number(n)))) out.push(`${at}.viewBox: four numbers`);
  if (raw.fit !== undefined && raw.fit !== "circle" && raw.fit !== "box") out.push(`${at}.fit: circle or box`);
  const shapes = Array.isArray(raw.shapes) ? raw.shapes : null;
  if (!shapes) return [...out, `${at}.shapes: a list of shapes`];
  if (shapes.length > KEY_FACE_LIMITS.mark.shapes) out.push(`${at}: a mark holds at most ${KEY_FACE_LIMITS.mark.shapes} shapes`);
  shapes.forEach((sh, i) => {
    const where = `${at}.shapes[${i}]`;
    if (!isObj(sh)) { out.push(`${where}: a shape is an object`); return; }
    if (!(MARK_SHAPE_KINDS as readonly string[]).includes(String(sh.kind))) out.push(`${where}.kind: ${MARK_SHAPE_KINDS.join(", ")}`);
    if (sh.kind === "path" && String(sh.d ?? "").length > KEY_FACE_LIMITS.mark.dChars) out.push(`${where}.d: at most ${KEY_FACE_LIMITS.mark.dChars} characters`);
    if (sh.color !== undefined && !isHex(sh.color)) out.push(`${where}.color: a #RRGGBB(AA) hex`);
    for (const k of ["x", "y", "w", "h", "cx", "cy", "r", "x1", "y1", "x2", "y2", "width"]) {
      if (sh[k] !== undefined && !Number.isFinite(Number(sh[k]))) out.push(`${where}.${k}: a number`);
    }
  });
  return out;
}

/** Every problem with a skin, in plain words. Empty means it may be expanded into a config. */
export function checkSkin(spec: unknown): string[] {
  if (!isObj(spec)) return ["a skin is an object"];
  const errs: string[] = [];
  const id = String(spec.id ?? "");
  if (!/^[a-z0-9-]{1,40}$/.test(id)) errs.push("id: [a-z0-9-], 1 to 40 characters");
  if (Number(spec.format) !== 1) errs.push("format: this deploy expands skin format 1");
  if (typeof spec.label !== "string" || !spec.label.trim()) errs.push("label: the words the picker shows");
  if (spec.font !== undefined && !(TYPE_TOKENS as readonly string[]).includes(String(spec.font))) {
    errs.push(`font: a type token (${TYPE_TOKENS.join(", ")}) or nothing; a hooked font is named in the manifest`);
  }

  // THE WHOLE SKIN, not only its faces. `on` inside press, inside a theme side or inside flags is the same 4.4.1 problem
  // as `on` inside a face, and faces were the only place this looked.
  forbidden("skin", spec, errs);

  // The kb.* flags a skin may set, by prefix. Everything else — where a deep link goes, which schemes open, whether the
  // letter is typed on finger-down — is the keyboard's behaviour, and a skin is paint.
  if (spec.flags !== undefined) {
    if (!isObj(spec.flags)) errs.push("flags: an object of kb.* knobs, or nothing");
    else for (const [k, v] of Object.entries(spec.flags)) {
      if (!SKIN_FLAG_PREFIXES.some((p) => k.startsWith(p))) { errs.push(`flags.${k}: a skin may set only ${SKIN_FLAG_PREFIXES.join(" and ")}* flags`); continue; }
      // A knob is a value, never a structure: an action object under an allowed prefix would still be an action.
      const flat = (x: unknown) => ["string", "number", "boolean"].includes(typeof x);
      if (!flat(v) && !(Array.isArray(v) && v.every(flat))) errs.push(`flags.${k}: a knob is a word, a number, true/false, or a list of those`);
    }
  }

  // The themes, key by key: a skin repaints the keyboard, it does not reshape it.
  for (const side of ["dark", "light"] as const) {
    const t = (spec.theme as Record<string, unknown> | undefined)?.[side];
    if (t === undefined) continue;
    if (!isObj(t)) { errs.push(`theme.${side}: an object of colours`); continue; }
    for (const [k, v] of Object.entries(t)) {
      const want = (SKIN_THEME_KEYS as Record<string, string | undefined>)[k];
      if (!want) { errs.push(`theme.${side}.${k}: a skin sets only ${Object.keys(SKIN_THEME_KEYS).join(", ")}`); continue; }
      if (want === "colour" && !isHex(v)) errs.push(`theme.${side}.${k}: a #RRGGBB(AA) hex`);
      if (want === "number" && !Number.isFinite(Number(v))) errs.push(`theme.${side}.${k}: a number`);
      if (want === "boolean" && typeof v !== "boolean") errs.push(`theme.${side}.${k}: true or false`);
    }
  }

  if (spec.press !== undefined) {
    const p = spec.press as KeyPress;
    const L = KEY_FACE_LIMITS.press;
    if (!(PRESS_KINDS as readonly string[]).includes(String(p?.kind))) errs.push(`press.kind: ${PRESS_KINDS.join(", ")}`);
    // One press block goes to both phones, so one pair of clamps holds for both; a value outside them would sink on one
    // phone and do nothing on the other.
    if (p?.ms !== undefined && !(Number(p.ms) > 0 && Number(p.ms) <= L.maxMs)) errs.push(`press.ms: 1 to ${L.maxMs}`);
    if (p?.scale !== undefined && !(Number(p.scale) >= L.scale.min && Number(p.scale) <= L.scale.max)) errs.push(`press.scale: ${L.scale.min} to ${L.scale.max}`);
    if (p?.dy !== undefined && !(Number(p.dy) >= L.dy.min && Number(p.dy) <= L.dy.max)) errs.push(`press.dy: ${L.dy.min} to ${L.dy.max}`);
    if (p?.color !== undefined && !isHex(p.color)) errs.push("press.color: a #RRGGBB(AA) hex");
    if (p?.ease !== undefined && !(PRESS_EASES as readonly string[]).includes(String(p.ease))) errs.push(`press.ease: ${PRESS_EASES.join(", ")}`);
  }

  const manifest = spec.manifest as KeySkinInfo["manifest"] | undefined;
  const fonts = manifest?.fonts ?? [];
  if (fonts.length > KEY_FACE_LIMITS.fonts.perConfig) errs.push(`manifest.fonts: at most ${KEY_FACE_LIMITS.fonts.perConfig} hooked fonts per config`);
  const art = manifest?.art ?? [];
  if (art.length > KEY_FACE_LIMITS.art.files) errs.push(`manifest.art: at most ${KEY_FACE_LIMITS.art.files} files`);
  for (const a of art) if (!ART_NAME.test(String(a))) errs.push(`manifest.art: "${a}" is not <sha256>@<scale>.png`);
  // Art on a face must be the BARE manifest name, must be in the manifest, and the file must BE on disk under that hash:
  // a name nobody has would be fetched, fail, and leave a flat key. Each phone builds the address from its own compiled
  // host, so a host in a config can only ever be a mistake.
  errs.push(...skinFilesOnDisk(manifest));

  const faceFonts = new Set(fonts.map((f) => String(f?.id ?? "")));
  const faces = isObj(spec.faces) ? spec.faces : {};
  for (const k of Object.keys(faces)) if (!["all", "types", "chars"].includes(k)) errs.push(`faces.${k}: faces are all, types and chars`);
  const named: Array<[string, unknown]> = [];
  if (faces.all !== undefined) named.push(["faces.all", faces.all]);
  for (const [t, f] of Object.entries((faces.types ?? {}) as Record<string, unknown>)) {
    if (!KEY_TYPES.has(t)) errs.push(`faces.types.${t}: not a key node type`);
    named.push([`faces.types.${t}`, f]);
  }
  for (const [c, f] of Object.entries((faces.chars ?? {}) as Record<string, unknown>)) {
    if (c.length > 4) errs.push(`faces.chars.${c}: a character, lower-cased`);
    named.push([`faces.chars.${c}`, f]);
  }
  for (const [at, f] of named) errs.push(...faceErrors(at, f, faceFonts, art));
  return errs;
}

// ---------------------------------------------------------------- expanding one skin into the tree

/**
 * A press as it may travel: a known kind, and every number written out and clamped, so NO PHONE DEFAULT ever decides how a
 * skin looks. The two renderers have different built-in defaults and different clamps, and one press block goes to both.
 */
export function cleanPress(p: KeyPress | undefined): KeyPress | undefined {
  if (!p || !(PRESS_KINDS as readonly string[]).includes(p.kind)) return undefined;
  const L = KEY_FACE_LIMITS.press;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const ms = Number.isFinite(Number(p.ms)) && Number(p.ms) > 0 ? clamp(Math.round(Number(p.ms)), 1, L.maxMs) : PRESS_MS;
  // BUILT, never spread. `{ ...p }` carried whatever else the press block held — an `on`, an endpoint — straight into every
  // key's style, where nothing looks at it again. Only PRESS_KEYS travel, and only the ones this kind uses.
  const out: KeyPress = { kind: p.kind, ms };
  if (p.kind === "pop") {
    out.scale = clamp(Number.isFinite(Number(p.scale)) ? Number(p.scale) : PRESS_SCALE, L.scale.min, L.scale.max);
    out.dy = clamp(Number.isFinite(Number(p.dy)) ? Number(p.dy) : 0, L.dy.min, L.dy.max);
  }
  if (p.kind === "glow" && isHex(p.color)) out.color = p.color;
  if (p.ease !== undefined && (PRESS_EASES as readonly string[]).includes(String(p.ease))) out.ease = p.ease;
  return out;
}

/** The defaults written into every press block, so both phones draw the same skin. */
const PRESS_MS = 140;
const PRESS_SCALE = 1.08;

/** The face for one key: the skin's `all`, then its type's, then its character's. Later wins, key by key. */
function faceFor(node: KeyboardNode, skin: KeySkin): KeyFace | undefined {
  const char = String((node.props?.char ?? "") as string).toLowerCase();
  const parts = [skin.faces?.all, skin.faces?.types?.[node.type], char ? skin.faces?.chars?.[char] : undefined].filter(Boolean) as KeyFace[];
  if (!parts.length) return undefined;
  const face = Object.assign({}, ...parts) as KeyFace;
  // `all` alone is paint with nothing on it: a font and a layer print nothing by themselves.
  const prints = face.label || face.sub || face.corner || face.icon || face.art || face.mark;
  return prints ? face : undefined;
}

export interface SkinOptions {
  /** What the keyboard said it can draw (X-Tulmi-Keyboard-Can). Without KeySkin1 nothing is expanded. */
  can: ReadonlySet<string>;
  /** The person's pick (KeybotPrefs.keyboard.skin). Absent or unknown: no skin. */
  skin?: string;
  /** X-Tulmi-Keyboard-Bad: this device's crash guard struck on that skin, so it gets the unskinned tree. */
  bad?: string;
  /** Who is asking, for the KEYBOARD_SKINS_USERS stage. Absent while that list is set means no skin. */
  userId?: string;
}

/**
 * The keyboard's testers' stage. A key tree has no `targets` the way a design does, so the list is a setting: while it has
 * any name in it, only those accounts get a skinned tree or see the picker. Empty means the switch alone decides.
 */
export function skinsAllowed(userId?: string): boolean {
  if (!getConfig().KEYBOARD_SKINS) return false;
  const only = String(getConfig().KEYBOARD_SKINS_USERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return !only.length || (!!userId && only.includes(userId));
}

/**
 * The config a KeySkin1 build receives. A build that cannot draw faces, a device that reported this skin bad, an unknown pick or
 * the switch turned off all get the config back EXACTLY as it was built — the same object, so nothing downstream can tell the
 * difference between "skins are off" and "this release has no skins".
 */
export function withKeySkin<T extends KeyboardConfigResponse>(cfg: T, o: SkinOptions): T & KeyboardConfigSkinFields {
  const picked = o.skin ? allSkins().get(o.skin) : undefined;
  if (!skinsAllowed(o.userId) || !o.can.has(KEY_SKIN_1) || !picked || o.bad === picked.id) return cfg;

  const press = cleanPress(picked.press);
  const font = picked.font;
  let faced = 0;
  let animated = 0;

  const walk = (node: KeyboardNode): KeyboardNode => {
    const children = node.children?.map(walk);
    if (!KEY_TYPES.has(node.type)) return children ? { ...node, children } : node;
    let face = faced < KEY_FACE_LIMITS.facedKeys ? faceFor(node, picked) : undefined;
    // At most three keys may animate. The rest keep their print and draw it at t = 0, never starting a display link.
    if (face?.program) {
      if (animated >= KEY_FACE_LIMITS.animatedKeys) { const { program: _p, ...still } = face; face = still; }
      else animated++;
    }
    if (face) faced++;
    if (!face && !press && !font) return children ? { ...node, children } : node;
    return {
      ...node,
      ...(children ? { children } : {}),
      ...(face ? { props: { ...(node.props ?? {}), face } } : {}),
      style: { ...(node.style ?? {}), ...(font ? { fontFamily: font } : {}), ...(press ? { press } : {}) },
    };
  };

  const root = cfg.root ? walk(cfg.root) : cfg.root;
  // checkSkin already refused anything else, and a skin that did not check is never loaded — but the tree a keyboard
  // receives is built here, so what may reach it is decided here too, from the same two lists.
  const dark = cleanTheme(picked.theme?.dark), light = cleanTheme(picked.theme?.light);
  const theme = { ...cfg.theme, ...dark } as T["theme"];
  const themeDark = { ...(cfg.themeDark ?? cfg.theme), ...dark } as T["theme"];
  const themeLight = { ...(cfg.themeLight ?? cfg.theme), ...light } as T["theme"];

  const skin: KeySkinInfo = {
    id: picked.id,
    sha: skinSha(picked),
    budget: { decodedKB: picked.budget?.decodedKB ?? Math.round(KEY_FACE_LIMITS.liveImageBytes / 1024), animatedKeys: Math.min(picked.budget?.animatedKeys ?? KEY_FACE_LIMITS.animatedKeys, KEY_FACE_LIMITS.animatedKeys) },
    ...(picked.manifest ? { manifest: picked.manifest } : {}),
  };

  return {
    ...cfg,
    ...(root ? { root } : {}),
    theme, themeDark, themeLight,
    flags: { ...(cfg.flags ?? {}), ...skinFlags(picked.flags) },
    skin,
  };
}

/** The kb.* flags a skin is allowed to set, by prefix (SKIN_FLAG_PREFIXES). Everything else is dropped. */
function skinFlags(flags: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flags ?? {})) if (SKIN_FLAG_PREFIXES.some((p) => k.startsWith(p))) out[k] = v;
  return out;
}

/** The theme keys a skin is allowed to set, each with the kind of value it takes (SKIN_THEME_KEYS). */
function cleanTheme(side: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(side ?? {})) {
    const want = (SKIN_THEME_KEYS as Record<string, string | undefined>)[k];
    if (want === "colour" && isHex(v)) out[k] = v;
    else if (want === "number" && Number.isFinite(Number(v))) out[k] = Number(v);
    else if (want === "boolean" && typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** The skin's own content hash: the crash guard's key, and what telemetry tags a render failure with. */
export function skinSha(skin: KeySkin): string {
  return createHash("sha256").update(JSON.stringify(skin)).digest("hex").slice(0, 16);
}

/** What the Keybot picker lists: every skin in this release, plus "None", which is simply no pick at all. */
export function skinChoices(userId?: string): Array<{ id: string; label: string; blurb: string; dark: boolean }> {
  if (!skinsAllowed(userId)) return [];
  return [...allSkins().values()].map((s) => ({ id: s.id, label: s.label, blurb: s.blurb ?? "", dark: s.dark === true }));
}
