/**
 * BLIP'S CATALOG ON THE DESKTOP: his moves, the poses he peeks over Ask's card in and the poses he stands in, as data
 * (shared/bots/blip.json) the desktop plays (TAILZU-DESKTOP src/shared/blipCatalog.js compiles it; blip.js draws him).
 * New moves and changed ones go out without an app update: push a catalog with a higher v and every desktop picks it up.
 *
 *   checkBlip()      every field the desktop knows, every expression (the bots' motion language, motionLang.ts) after
 *                    its macros are spelled out, every name it reads (t, v, its lets) and every function it calls
 *   activeBlip()     the catalog served now: the file's, or one pushed since (PUT /v1/admin/blip, kept on the control
 *                    volume) while its v is higher than the file's
 *   blipFlags()      the bootstrap's word, "desktop.blip": { v, url }: the desktop fetches the catalog when v is not its own
 *
 * The desktop also carries a copy for its first launch and offline (src/shared/blipStarter.js, written by
 * scripts/gen-blip-starter.mjs from the file).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type Ast } from "../motionLang.js";
import { CONSTS, MOMENT_FUNCS } from "./looks.js";

/** The catalog format this release's desktop plays (blipCatalog.js FORMAT). */
const BLIP_FORMAT = 1;

export interface BlipCatalog {
  v: number;
  format?: number;
  note?: string;
  macros?: Record<string, [string[], string]>;
  gestures: Record<string, Record<string, unknown>>;
  card?: Record<string, unknown>;
  ground?: Record<string, unknown>;
  groundGlow?: Record<string, number>;
}

// ---------------------------------------------------------------- what the desktop knows (blipCatalog.js, kept in step)

const NUM = ["tilt", "brows", "headLift", "headSpin", "antSpin", "antLen", "lid", "sqx", "sqy", "spin", "hop", "bob", "glow", "mouthOpen", "antWob", "thumb", "point"];
const PAIRS = ["ra", "la", "look"];
const NAMES: Record<string, string[]> = { mouth: ["smile", "grin", "flat", "o"], eye: ["wide", "tiny", "spiral"] };
const FLAGS = ["handsOver", "noBlink"];
const CARD = ["rise", "tilt", "brows", "lid", "hands", "hop", "neck"];
const GROUND = ["ra0", "ra1", "la0", "la1", "tilt", "brows", "lx", "ly", "thumb", "point", "hop", "grin"];
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_GESTURES = 200, MAX_LETS = 12, MAX_STEPS = 16, MAX_SRC = 400;

/** Spell out the macros in `src`, as blipCatalog.js expand() does: name(a, b) becomes the body with its parameters replaced. */
export function expandMacros(src: string, macros: Record<string, [string[], string]>): string {
  let out = String(src);
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const name of Object.keys(macros)) {
      const [params, body] = macros[name]!;
      const re = new RegExp(`\\b${name}\\(`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(out))) {
        let depth = 1, i = m.index + m[0].length, start = i;
        const args: string[] = [];
        for (; i < out.length && depth; i++) {
          const ch = out[i];
          if (ch === "(") depth++;
          else if (ch === ")") { depth--; if (!depth) args.push(out.slice(start, i)); }
          else if (ch === "," && depth === 1) { args.push(out.slice(start, i)); start = i + 1; }
        }
        if (depth) throw new Error(`unclosed ${name}(`);
        if (args.length !== params.length) throw new Error(`${name} takes ${params.length}`);
        let b = body;
        params.forEach((p, k) => { b = b.replace(new RegExp(`\\b${p}\\b`, "g"), `(${args[k]!.trim()})`); });
        out = `${out.slice(0, m.index)}(${b})${out.slice(i)}`;
        re.lastIndex = 0;
        changed = true;
        if (out.length > 8000) throw new Error("too long");
      }
    }
    if (!changed) return out;
  }
  throw new Error("macros nest too deep");
}

/** Every name the expression reads is one of `names` (or a constant), every function is one the language has. */
function checkAst(n: Ast, names: readonly string[], errs: string[], where: string): void {
  switch (n.k) {
    case "n": return;
    case "v": if (!names.includes(n.name) && !Object.hasOwn(CONSTS, n.name)) errs.push(`${where}: unknown name ${n.name}`); return;
    case "neg": case "not": checkAst(n.x, names, errs, where); return;
    case "?": checkAst(n.c, names, errs, where); checkAst(n.a, names, errs, where); checkAst(n.b, names, errs, where); return;
    case "bin": checkAst(n.l, names, errs, where); checkAst(n.r, names, errs, where); return;
    case "call": {
      const f = Object.hasOwn(MOMENT_FUNCS, n.name) ? MOMENT_FUNCS[n.name] : undefined;
      if (!f) errs.push(`${where}: unknown function ${n.name}`);
      else if (n.args.length < f[0] || n.args.length > f[1]) errs.push(`${where}: ${n.name} takes ${f[0] === f[1] ? f[0] : `${f[0]} to ${f[1]}`}`);
      for (const a of n.args) checkAst(a, names, errs, where);
    }
  }
}

function checkNumber(x: unknown, names: readonly string[], macros: Record<string, [string[], string]>, errs: string[], where: string): void {
  if (typeof x === "number") { if (!Number.isFinite(x)) errs.push(`${where}: not a finite number`); return; }
  if (typeof x !== "string" || !x.trim() || x.length > MAX_SRC) { errs.push(`${where}: a number or an expression`); return; }
  try { checkAst(parse(expandMacros(x, macros)), names, errs, where); } catch (e) { errs.push(`${where}: ${(e as Error).message}`); }
}

function checkWord(field: string, x: unknown, names: readonly string[], macros: Record<string, [string[], string]>, errs: string[], where: string): void {
  if (x === null || x === undefined) return;
  if (typeof x === "string") { if (!NAMES[field]!.includes(x)) errs.push(`${where}: ${field} is one of ${NAMES[field]!.join(", ")}`); return; }
  const c = x as { if?: unknown; then?: unknown; else?: unknown };
  if (c && typeof c === "object" && typeof c.if === "string") {
    checkNumber(c.if, names, macros, errs, `${where}.if`);
    checkWord(field, c.then, names, macros, errs, `${where}.then`);
    checkWord(field, c.else, names, macros, errs, `${where}.else`);
    return;
  }
  errs.push(`${where}: a ${field} name, or { if, then, else }`);
}

function checkLets(spec: unknown, names: string[], macros: Record<string, [string[], string]>, errs: string[], where: string): string[] {
  if (spec === undefined) return names;
  if (!Array.isArray(spec) || spec.length > MAX_LETS) { errs.push(`${where}.let: at most ${MAX_LETS} [name, expression] pairs`); return names; }
  let ns = names.slice();
  for (const pair of spec) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string" || !NAME_RE.test(pair[0]) || ns.includes(pair[0])) { errs.push(`${where}.let: a new name and an expression`); continue; }
    checkNumber(pair[1], ns, macros, errs, `${where}.let ${pair[0]}`);
    ns = ns.concat(pair[0]);
  }
  return ns;
}

function checkPose(spec: unknown, names: readonly string[], macros: Record<string, [string[], string]>, errs: string[], where: string): void {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) { errs.push(`${where}: a pose`); return; }
  for (const [k, x] of Object.entries(spec as Record<string, unknown>)) {
    const at = `${where}.${k}`;
    if (NUM.includes(k)) checkNumber(x, names, macros, errs, at);
    else if (PAIRS.includes(k)) {
      if (!Array.isArray(x) || x.length !== 2) errs.push(`${at}: a pair`);
      else x.forEach((y, i) => checkNumber(y, names, macros, errs, `${at}[${i}]`));
    } else if (k === "legs") {
      if (!Array.isArray(x) || x.length !== 2) errs.push(`${at}: two legs`);
      else x.forEach((l, i) => { const leg = (l ?? {}) as { th?: unknown; lift?: unknown }; checkNumber(leg.th, names, macros, errs, `${at}[${i}].th`); checkNumber(leg.lift, names, macros, errs, `${at}[${i}].lift`); });
    } else if (Object.hasOwn(NAMES, k)) checkWord(k, x, names, macros, errs, at);
    else if (FLAGS.includes(k)) { if (typeof x !== "boolean") errs.push(`${at}: true or false`); }
    else errs.push(`${at}: not a field Blip has`);
  }
}

function checkTable(spec: unknown, fields: string[], errs: string[], where: string): void {
  if (spec === undefined) return;
  if (!spec || typeof spec !== "object") { errs.push(`${where}: an object`); return; }
  const t = spec as Record<string, unknown>;
  for (const [name, x] of Object.entries(t)) {
    if (!NAME_RE.test(name)) { errs.push(`${where}: ${name} is not a name`); continue; }
    if (typeof x === "string") { if (typeof t[x] !== "object") errs.push(`${where}.${name}: ${x} is not a pose here`); continue; }
    if (!x || typeof x !== "object") { errs.push(`${where}.${name}: a pose`); continue; }
    for (const [f, v] of Object.entries(x as Record<string, unknown>)) {
      if (!fields.includes(f)) errs.push(`${where}.${name}.${f}: not a field`);
      else if (typeof v !== "number" || !Number.isFinite(v)) errs.push(`${where}.${name}.${f}: a number`);
    }
  }
}

/** Everything wrong with a catalog, as the desktop would find it. Empty: it plays. */
export function checkBlip(spec: unknown): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== "object") return ["not a catalog"];
  const c = spec as BlipCatalog;
  if (!Number.isInteger(c.v) || c.v < 1) errs.push("v: a whole number above 0");
  if (c.format !== undefined && c.format !== BLIP_FORMAT) errs.push(`format: ${BLIP_FORMAT}`);
  const macros: Record<string, [string[], string]> = {};
  for (const [name, def] of Object.entries(c.macros ?? {})) {
    if (!NAME_RE.test(name) || !Array.isArray(def) || !Array.isArray(def[0]) || !def[0].every((p) => typeof p === "string" && NAME_RE.test(p)) || typeof def[1] !== "string") {
      errs.push(`macros.${name}: [[parameters], body]`);
      continue;
    }
    macros[name] = [def[0], def[1]];
  }
  const gestures = c.gestures && typeof c.gestures === "object" ? Object.entries(c.gestures) : [];
  if (!gestures.length) errs.push("gestures: at least one");
  if (gestures.length > MAX_GESTURES) errs.push(`gestures: at most ${MAX_GESTURES}`);
  if (!c.gestures?.rest) errs.push("gestures: a rest move");
  for (const [name, g] of gestures) {
    const at = `gestures.${name}`;
    if (!NAME_RE.test(name)) { errs.push(`${at}: not a name`); continue; }
    if (!g || typeof g !== "object") { errs.push(`${at}: an object`); continue; }
    if (g.length !== undefined && (typeof g.length !== "number" || !(g.length > 0 && g.length < 60))) errs.push(`${at}.length: seconds, 0 to 60`);
    for (const f of ["quirk", "hover"]) if (g[f] !== undefined && typeof g[f] !== "boolean") errs.push(`${at}.${f}: true or false`);
    const top = checkLets(g.let, ["t", "v"], macros, errs, at);
    if (g.steps !== undefined) {
      if (!Array.isArray(g.steps) || !g.steps.length || g.steps.length > MAX_STEPS) { errs.push(`${at}.steps: 1 to ${MAX_STEPS}`); continue; }
      g.steps.forEach((st: Record<string, unknown>, i: number) => {
        const sat = `${at}.steps[${i}]`;
        if (!st || typeof st !== "object") { errs.push(`${sat}: an object`); return; }
        const ns = checkLets(st.let, top, macros, errs, sat);
        if (st.until !== undefined && (typeof st.until !== "number" || !Number.isFinite(st.until))) errs.push(`${sat}.until: seconds`);
        if (st.when !== undefined) checkNumber(st.when, ns, macros, errs, `${sat}.when`);
        if (st.as !== undefined) {
          if (typeof st.as !== "string" || st.as === name || !c.gestures[st.as]) errs.push(`${sat}.as: another move in this catalog`);
        } else checkPose(st.pose, ns, macros, errs, `${sat}.pose`);
      });
    } else checkPose(g.pose, top, macros, errs, `${at}.pose`);
  }
  checkTable(c.card, CARD, errs, "card");
  checkTable(c.ground, GROUND, errs, "ground");
  for (const [k, x] of Object.entries(c.groundGlow ?? {})) if (typeof x !== "number" || !Number.isFinite(x)) errs.push(`groundGlow.${k}: a number`);
  return errs;
}

// ---------------------------------------------------------------- the file, and a pushed one

function blipFile(): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle without a file address: no file */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "bots", "blip.json"),
    here && resolve(here, "..", "..", "..", "..", "shared", "bots", "blip.json"),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "bots", "blip.json"),
    resolve(process.cwd(), "..", "shared", "bots", "blip.json"),
    resolve(process.cwd(), "shared", "bots", "blip.json"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Where a pushed catalog is kept (the control volume, beside the bots' looks). */
export function pushedBlipFile(): string {
  return join(process.env.CONTROL_DIR || "/data/control", "blip.json");
}

let fileBlip: BlipCatalog | null | undefined;
let pushed: BlipCatalog | null | undefined;

function fileCatalog(): BlipCatalog | null {
  if (fileBlip !== undefined) return fileBlip;
  try { const p = blipFile(); fileBlip = p ? (JSON.parse(readFileSync(p, "utf8")) as BlipCatalog) : null; } catch { fileBlip = null; }
  return fileBlip;
}

function pushedCatalog(): BlipCatalog | null {
  if (pushed !== undefined) return pushed;
  try {
    const p = pushedBlipFile();
    const c = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as BlipCatalog) : null;
    pushed = c && !checkBlip(c).length ? c : null;
  } catch { pushed = null; }
  return pushed;
}

/** The catalog served now: one pushed since the deploy while its v is higher than the file's, else the file's. */
export function activeBlip(): BlipCatalog | null {
  const f = fileCatalog(), p = pushedCatalog();
  if (p && (!f || p.v > f.v)) return p;
  return f;
}

/** Push a catalog without a deploy (PUT /v1/admin/blip): checked as the desktop compiles it; its v above the one served. */
export function pushBlip(spec: unknown, o: { dry?: boolean } = {}): { ok: true; v: number } | { ok: false; status: number; errors: string[] } {
  const errors = checkBlip(spec);
  if (errors.length) return { ok: false, status: 400, errors };
  const c = spec as BlipCatalog, now = activeBlip();
  if (now && c.v <= now.v) return { ok: false, status: 409, errors: [`v must be above ${now.v}, the one served now`] };
  if (o.dry) return { ok: true, v: c.v };
  const p = pushedBlipFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(c));
  renameSync(`${p}.tmp`, p);
  pushed = c;
  return { ok: true, v: c.v };
}

/** Take a pushed catalog back: the file's is served again (the desktops follow the flag down). */
export function dropPushedBlip(): void {
  try { rmSync(pushedBlipFile(), { force: true }); } catch { /* nothing kept */ }
  pushed = null;
}

export function resetBlipForTests(): void { fileBlip = undefined; pushed = undefined; }

/** The bootstrap's word on the catalog: its version, and where the desktop fetches it. Nothing when there is none. */
export function blipFlags(): Record<string, unknown> {
  const c = activeBlip();
  return c ? { "desktop.blip": { v: c.v, url: `/v1/blip?v=${c.v}` } } : {};
}
