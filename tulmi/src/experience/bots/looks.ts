/**
 * THE BOTS' LOOKS AND MOMENTS (docs/bots-app.md, "Looks and moments"): what the bots look like (avatars, made of small
 * vector parts) and what they can do (moments: recipes of tracks over time), as data the apps draw and play with their
 * one physics core (TAILZU-FRONTEND app/src/botTiles/core.ts; the window's botTiles.js is generated from it).
 *
 *   shared/bots/looks.json  the catalog; `v` is its version (a whole number: raise it with every change)
 *   checkLooks()            every field and range the apps know, every part's path, every expression (the mic program's
 *                           language, motionLang.ts, with a moment's names) parsed and tried at a sample of times, every
 *                           name a recipe refers to (parts, moments, events): a catalog that passes compiles in the apps
 *                           (their tests compile this very file with the core, and fail if the two drift)
 *   activeLooks()           the catalog served now: the file's, or one pushed since (PUT /v1/admin/bots/looks, kept on
 *                           the control volume) while its v is higher than the file's
 *   looksFlags()            the bootstrap's word, "bots.looks": { v, url }: an app fetches the catalog when v is not its own
 *   momentProps()           a moment for a node, for a build that plays it (BotMoments); else the recipe's plain act
 *
 * The apps also bundle a starter copy of the file (generated at release, TAILZU-FRONTEND app/src/botTiles/genStarter.mjs)
 * for their first launch and offline.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, parse, type Ast, type Ctx } from "../motionLang.js";

/** The looks format the apps of this release play (core.ts LOOKS_FORMAT). */
export const LOOKS_FORMAT = 1;

export type BuddyActName = "play" | "wave" | "survey" | "read" | "settle" | "think" | "carry";

export interface LooksCatalog {
  v: number;
  format?: number;
  note?: string;
  parts?: Record<string, unknown>;
  avatars?: Record<string, Record<string, unknown>>;
  moments?: Record<string, { label?: string; fallback?: BuddyActName; react?: boolean; format?: number; mode?: string; [k: string]: unknown }>;
  kinds?: Record<string, string>;
  idle?: { every?: number; chance?: number; moments?: string[] };
}

// ---------------------------------------------------------------- what the apps know (core.ts, kept in step)

/** The names a moment's expression may read, and its built-in functions ([fewest, most] arguments). */
export const MOMENT_VARS = ["t", "u", "T", "D", "beat", "k", "side", "rnd", "rnd2", "W", "x", "px"];
const CONSTS: Record<string, number> = { pi: Math.PI, tau: Math.PI * 2, e: Math.E };
export const MOMENT_FUNCS: Record<string, [number, number]> = {
  sin: [1, 1], cos: [1, 1], tan: [1, 1], abs: [1, 1], sqrt: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1], exp: [1, 1], log: [1, 1],
  atan2: [2, 2], min: [1, 8], max: [1, 8], pow: [2, 2], hypot: [1, 8], clamp: [3, 3], smooth: [3, 3], lerp: [3, 3], crest: [1, 1],
  ramp: [3, 4], run: [5, 5], noise: [1, 1], sign: [1, 1], tri: [1, 1], hash: [1, 1],
};
/** Each track's own fields: x a number or an expression, n a number, the rest named choices. */
export const TRACK_FIELDS: Record<string, Record<string, string>> = {
  walk: { x: "x", dx: "x", toward: "walk", gap: "x", speed: "x" },
  crouch: { v: "x" }, sit: { v: "x" }, lean: { v: "x" }, tilt: { v: "x" }, lid: { v: "x" },
  arm: { hand: "hand", x: "x", y: "x", from: "from", k: "x", over: "bool" },
  look: { target: "look", x: "x", y: "x", rate: "n" },
  eyes: { state: "eyes" }, mouth: { state: "mouth", v: "x" },
  spin: { rate: "x" }, shake: { amp: "x", freq: "x", part: "shake" }, act: { act: "act" },
  prop: { part: "part", on: "anchor", x: "x", y: "x", scale: "x", rot: "x", paint: "paint", pop: "bool" },
  emit: {
    part: "part", parts: "parts", from: "anchor", x: "x", y: "x", n: "n", every: "n", vx: "x", vy: "x", spread: "n", g: "n", drag: "n", life: "n",
    size: "x", grow: "n", spin: "n", paint: "paint", alpha: "n", floor: "bool", aim: "anchor", flight: "n", alt: "bool", miss: "n", onMiss: "name",
    pause: "n", orbit: "n", orbitRate: "n",
  },
  face: { target: "face" },
  hop: { h: "x", dx: "x" }, kick: { part: "kick", vx: "x", vy: "x" }, fabric: { from: "anchor", x: "x", y: "x", v: "x", r: "x" },
  glow: { v: "x" }, sound: { name: "name" }, others: { play: "moment", n: "n", near: "n" }, event: { name: "name" }, blink: {},
};
const INSTANT = new Set(["hop", "kick", "fabric", "glow", "sound", "others", "event", "blink"]);
export const ANCHORS = ["head", "crown", "face", "mouth", "neck", "body", "hip", "hand_l", "hand_r", "hand_front", "hand_back", "foot_l", "foot_r", "ground"];
const ENUMS: Record<string, string[]> = {
  hand: ["front", "back", "l", "r", "both"],
  from: ["neck", "head", "hip", "crown", "face", "body"],
  look: ["screen", "peer", "away", "point", "around", "down", "up", "ahead", "drop", "last", "hand"],
  eyes: ["rest", "open", "closed", "half", "squint", "wide", "x", "happy", "spiral"],
  mouth: ["rest", "none", "line", "smile", "open", "o", "wide", "wavy"],
  shake: ["body", "head", "all"],
  act: ["play", "wave", "survey", "read", "settle", "think", "stretch"],
  face: ["screen", "peer", "away", "left", "right", "forward", "back"],
  kick: ["head", "body", "all", "hands", "feet", "hand_front", "hand_back"],
  walk: ["peer", "center", "left", "right", "start", "away"],
  anchor: ANCHORS,
};
/** A track's numbers that are not expressions: [low, high]. */
const RANGES: Record<string, [number, number]> = {
  rate: [0.1, 10], n: [1, 24], every: [0, 10], spread: [0, 3], g: [-3, 3], drag: [0, 20], life: [0.05, 10], grow: [0, 6], spin: [0, 30],
  alpha: [0, 1], flight: [0.1, 3], miss: [0, 1], pause: [0, 10], orbit: [0, 2], orbitRate: [-20, 20], near: [1, 40],
};
export const MOMENT_LIMITS = { tracks: 40, events: 8, dur: 60, props: 4 } as const;
const ACTS: BuddyActName[] = ["play", "wave", "survey", "read", "settle", "think", "carry"];
const KINDS = ["code", "keybot", "plan", "travel", "notes", "make", "custom"];

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const PAINT_RE = /^#[0-9a-fA-F]{6}$/;
const okPaint = (p: unknown, any = false): boolean => typeof p === "string" && (PAINT_RE.test(p) || p === "$color" || p === "$paint" || p === "ink" || p === "paper" || (any && p === "$any"));

/** An expression: parsed, every name and function one the apps have (with its arity), tried at a few times. "" when fine. */
export function checkMomentExpression(src: string): string {
  let ast: Ast;
  try { ast = parse(src); } catch (e) { return (e as Error).message; }
  const walk = (n: Ast): string => {
    switch (n.k) {
      case "n": return "";
      case "v": return MOMENT_VARS.includes(n.name) || n.name in CONSTS ? "" : `unknown name ${n.name}`;
      case "neg": case "not": return walk(n.x);
      case "?": return walk(n.c) || walk(n.a) || walk(n.b);
      case "bin": return walk(n.l) || walk(n.r);
      case "call": {
        const f = MOMENT_FUNCS[n.name];
        if (!f || !Object.hasOwn(MOMENT_FUNCS, n.name)) return `unknown function ${n.name}`;
        if (n.args.length < f[0] || n.args.length > f[1]) return `${n.name} takes ${f[0] === f[1] ? f[0] : `${f[0]} to ${f[1]}`} arguments`;
        for (const a of n.args) { const e = walk(a); if (e) return e; }
        return "";
      }
    }
  };
  const bad = walk(ast);
  if (bad) return bad;
  // A sample: through a track, a loop, either facing; the result must be a number.
  const hash01 = (x: number) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  for (const t of [0, 0.25, 1, 3.7]) for (const side of [1, -1]) {
    const ctx: Ctx = {
      ...CONSTS, t, u: Math.min(1, t / 2), T: t + 0.5, D: 2, beat: t * 2, k: 1, side, rnd: 0.3, rnd2: 0.8, W: 5, x: 2, px: 1.5,
      "fn:sign": (a) => (a > 0 ? 1 : a < 0 ? -1 : 0),
      "fn:tri": (a) => { const q = a - Math.floor(a); return q < 0.25 ? 4 * q : q < 0.75 ? 2 - 4 * q : 4 * q - 4; },
      "fn:hash": (a) => hash01(a),
    };
    const v = evaluate(ast, ctx, {});
    if (typeof v !== "number" || !Number.isFinite(v)) return `not a number at t=${t}`;
  }
  return "";
}

// ---------------------------------------------------------------- the check

/** Everything wrong with a catalog (as the apps would find it), in words; none: it plays. */
export function checkLooks(spec: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(spec)) return ["the catalog is an object"];
  for (const k of Object.keys(spec)) if (!["v", "format", "note", "parts", "avatars", "moments", "kinds", "idle"].includes(k)) errs.push(`unknown field ${k}`);
  if (typeof spec.v !== "number" || !Number.isInteger(spec.v) || spec.v < 1) errs.push("v: a whole number from 1");
  if (spec.format != null && spec.format !== LOOKS_FORMAT) errs.push(`format: ${LOOKS_FORMAT} (the apps of this release)`);
  const parts = isRec(spec.parts) ? spec.parts : {};
  if (spec.parts != null && !isRec(spec.parts)) errs.push("parts: an object");
  for (const [id, p] of Object.entries(parts)) checkPart(id, p, errs);
  const avatars = isRec(spec.avatars) ? (spec.avatars as Record<string, unknown>) : {};
  if (spec.avatars != null && !isRec(spec.avatars)) errs.push("avatars: an object");
  for (const id of Object.keys(avatars)) checkAvatar(id, avatars, parts, errs);
  const moments = isRec(spec.moments) ? (spec.moments as Record<string, unknown>) : {};
  if (spec.moments != null && !isRec(spec.moments)) errs.push("moments: an object");
  for (const [id, m] of Object.entries(moments)) checkMoment(id, m, parts, moments, errs);
  if (spec.kinds != null) {
    if (!isRec(spec.kinds)) errs.push("kinds: an object");
    else for (const [k, a] of Object.entries(spec.kinds)) {
      if (!KINDS.includes(k)) errs.push(`kinds.${k}: not a kind (${KINDS.join(", ")})`);
      if (!isRec(avatars[String(a)])) errs.push(`kinds.${k}: no avatar "${String(a)}"`);
    }
  }
  if (spec.idle != null) {
    const i = spec.idle;
    if (!isRec(i)) errs.push("idle: an object");
    else {
      for (const k of Object.keys(i)) if (!["every", "chance", "moments"].includes(k)) errs.push(`idle: unknown field ${k}`);
      if (i.every != null && !(typeof i.every === "number" && i.every >= 1 && i.every <= 3600)) errs.push("idle.every: seconds in [1, 3600]");
      if (i.chance != null && !(typeof i.chance === "number" && i.chance >= 0 && i.chance <= 1)) errs.push("idle.chance: in [0, 1]");
      if (i.moments != null && (!Array.isArray(i.moments) || i.moments.some((m) => !isRec(moments[String(m)])))) errs.push("idle.moments: moments in this catalog");
    }
  }
  return errs;
}

function checkPart(id: string, p: unknown, errs: string[]): void {
  const at = `parts.${id}`;
  if (!isRec(p) || !Array.isArray(p.draw) || !p.draw.length || p.draw.length > 12) { errs.push(`${at}: draw is a list of 1 to 12 shapes`); return; }
  for (const k of Object.keys(p)) if (k !== "draw" && k !== "note") errs.push(`${at}: unknown field ${k}`);
  let size = 0;
  p.draw.forEach((sh: unknown, i: number) => {
    const w = `${at}.draw[${i}]`;
    if (!isRec(sh) || typeof sh.d !== "string") { errs.push(`${w}: d is the path`); return; }
    for (const k of Object.keys(sh)) if (!["d", "fill", "stroke", "width", "alpha"].includes(k)) errs.push(`${w}: unknown field ${k}`);
    if (sh.fill == null && sh.stroke == null) errs.push(`${w}: a fill or a stroke`);
    for (const k of ["fill", "stroke"]) if (sh[k] != null && !okPaint(sh[k])) errs.push(`${w}: bad paint ${String(sh[k])}`);
    if (sh.width != null && !(typeof sh.width === "number" && sh.width > 0 && sh.width <= 0.3)) errs.push(`${w}: width in (0, 0.3]`);
    if (sh.alpha != null && !(typeof sh.alpha === "number" && sh.alpha >= 0 && sh.alpha <= 1)) errs.push(`${w}: alpha in [0, 1]`);
    const toks = sh.d.replace(/([MLQZO])/g, " $1 ").trim().split(/[\s,]+/).filter((x) => x !== "");
    const arity: Record<string, number> = { M: 2, L: 2, Q: 4, Z: 0, O: 3 };
    let first = true;
    for (let k = 0; k < toks.length;) {
      const c = toks[k++]!;
      if (!(c in arity) || (first && c !== "M" && c !== "O")) { errs.push(`${w}: "${c}" (paths are M, L, Q, Z and O, starting with M or O)`); break; }
      first = false;
      size += 1 + arity[c]!;
      for (let j = 0; j < arity[c]!; j++) {
        const v = Number(toks[k++]);
        if (!Number.isFinite(v) || Math.abs(v) > 3) { errs.push(`${w}: a number in [-3, 3] after ${c}`); return; }
      }
    }
    size += 6;
  });
  if (size > 900) errs.push(`${at}: too big`);
}

/** An avatar, merged over what it extends (lists whole, the rest field by field), checked as the apps build it. */
function mergedAvatar(id: string, all: Record<string, unknown>, seen: string[], errs: string[]): Record<string, unknown> | null {
  const s = all[id];
  if (!isRec(s)) return null;
  if (seen.includes(id)) { errs.push(`avatars.${id}: extends itself`); return null; }
  if (s.extends == null) return s;
  const base = mergedAvatar(String(s.extends), all, [...seen, id], errs);
  if (!base) { errs.push(`avatars.${id}: extends "${String(s.extends)}", which is not there`); return null; }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(s)) if (k !== "extends") out[k] = isRec(v) && isRec(out[k]) ? { ...(out[k] as object), ...v } : v;
  return out;
}

function checkAvatar(id: string, all: Record<string, unknown>, parts: Record<string, unknown>, errs: string[]): void {
  const at = `avatars.${id}`;
  if (!isRec(all[id])) { errs.push(`${at}: an object`); return; }
  const sp = mergedAvatar(id, all, [], errs);
  if (!sp) return;
  for (const k of Object.keys(sp)) if (!["extends", "label", "note", "head", "eyes", "mouth", "antennae", "ears", "dots", "body", "limbs", "paint", "wear"].includes(k)) errs.push(`${at}: unknown field ${k}`);
  const sub = (k: string, fields: Record<string, [number, number] | string[]>) => {
    const v = sp[k];
    if (v == null) return;
    if (!isRec(v)) { errs.push(`${at}.${k}: an object`); return; }
    for (const [f, val] of Object.entries(v)) {
      const rule = fields[f];
      if (!rule) { errs.push(`${at}.${k}: unknown field ${f}`); continue; }
      if (Array.isArray(rule) && typeof rule[0] === "string") { if (!(rule as string[]).includes(String(val))) errs.push(`${at}.${k}.${f}: one of ${(rule as string[]).join(", ")}`); }
      else { const [lo, hi] = rule as [number, number]; if (typeof val !== "number" || !(val >= lo && val <= hi)) errs.push(`${at}.${k}.${f}: a number in [${lo}, ${hi}]`); }
    }
  };
  sub("head", { shape: ["round", "oval", "square"], size: [0.12, 0.3], w: [0.6, 1.5], h: [0.6, 1.5], round: [0, 1] });
  sub("eyes", { style: ["one", "two", "dots", "visor", "none"], size: [0.1, 0.6], gap: [0, 0.7], pupil: [0, 0.9], y: [-0.5, 0.5] });
  sub("mouth", { style: ["none", "line", "smile", "o", "open"], size: [0.1, 0.8], y: [-0.95, -0.1] });
  sub("ears", { style: ["none", "round", "bolt", "point"], size: [0.1, 0.6] });
  sub("dots", { pattern: ["hex", "grid", "none"], spacing: [0.04, 0.12], size: [0.005, 0.05], alpha: [0, 1] });
  sub("body", { top: [0.06, 0.25], bottom: [0.06, 0.28], round: [0, 0.12] });
  sub("limbs", { arm: [0.02, 0.12], leg: [0.02, 0.12], neck: [0.02, 0.14], hand: [0.015, 0.08], antenna: [0.01, 0.08] });
  if (sp.paint != null) {
    if (!isRec(sp.paint)) errs.push(`${at}.paint: an object`);
    else for (const [k, v] of Object.entries(sp.paint)) {
      if (!["body", "dots", "eye", "pupil", "mouth", "light", "ears"].includes(k)) errs.push(`${at}.paint: unknown field ${k}`);
      else if (!okPaint(v) || v === "$paint") errs.push(`${at}.paint.${k}: a colour`);
    }
  }
  if (sp.antennae != null) {
    if (!Array.isArray(sp.antennae) || sp.antennae.length > 2) errs.push(`${at}.antennae: a list of at most 2`);
    else sp.antennae.forEach((a: unknown, i: number) => {
      const w = `${at}.antennae[${i}]`;
      if (!isRec(a)) { errs.push(`${w}: an object`); return; }
      const R: Record<string, [number, number]> = { at: [-0.95, 0.95], up: [0, 1.5], lean: [-1.6, 1.6], len: [0.02, 0.3], tipLen: [0.02, 0.25], bend: [-2.5, 2.5], tipSize: [0, 0.12] };
      for (const [k, v] of Object.entries(a)) {
        if (k === "tip") { if (!["none", "ball", "light", "star"].includes(String(v))) errs.push(`${w}.tip: none, ball, light or star`); }
        else if (!R[k]) errs.push(`${w}: unknown field ${k}`);
        else if (typeof v !== "number" || !(v >= R[k]![0] && v <= R[k]![1])) errs.push(`${w}.${k}: a number in [${R[k]![0]}, ${R[k]![1]}]`);
      }
    });
  }
  if (sp.wear != null) {
    if (!Array.isArray(sp.wear) || sp.wear.length > 6) errs.push(`${at}.wear: a list of at most 6`);
    else sp.wear.forEach((wr: unknown, i: number) => {
      const w = `${at}.wear[${i}]`;
      if (!isRec(wr)) { errs.push(`${w}: an object`); return; }
      const R: Record<string, [number, number]> = { x: [-1, 1], y: [-1, 1], scale: [0.2, 3], rot: [-3.2, 3.2] };
      for (const [k, v] of Object.entries(wr)) {
        if (k === "part") { if (!isRec(parts[String(v)])) errs.push(`${w}: no part "${String(v)}"`); }
        else if (k === "on") { if (!ANCHORS.includes(String(v))) errs.push(`${w}.on: one of ${ANCHORS.join(", ")}`); }
        else if (k === "paint") { if (!okPaint(v) || v === "$paint") errs.push(`${w}.paint: a colour`); }
        else if (k === "back") { if (typeof v !== "boolean") errs.push(`${w}.back: true or false`); }
        else if (!R[k]) errs.push(`${w}: unknown field ${k}`);
        else if (typeof v !== "number" || !(v >= R[k]![0] && v <= R[k]![1])) errs.push(`${w}.${k}: a number in [${R[k]![0]}, ${R[k]![1]}]`);
      }
      if (wr.part == null) errs.push(`${w}: a part`);
    });
  }
}

function checkMoment(id: string, m: unknown, parts: Record<string, unknown>, moments: Record<string, unknown>, errs: string[]): void {
  const at = `moments.${id}`;
  if (!isRec(m)) { errs.push(`${at}: an object`); return; }
  for (const k of Object.keys(m)) if (!["label", "note", "format", "dur", "mode", "loopFrom", "bpm", "still", "fallback", "react", "tracks", "end"].includes(k)) errs.push(`${at}: unknown field ${k}`);
  if (m.format != null && !(typeof m.format === "number" && m.format >= 1)) errs.push(`${at}.format: a whole number`);
  // A recipe for a newer build: the apps of this release leave it out (its fallback), so its tracks are not this file's to judge.
  if (typeof m.format === "number" && m.format > LOOKS_FORMAT) return;
  const dur = typeof m.dur === "number" && m.dur > 0 && m.dur <= MOMENT_LIMITS.dur ? m.dur : 0;
  if (!dur) errs.push(`${at}.dur: seconds in (0, ${MOMENT_LIMITS.dur}]`);
  if (m.mode != null && m.mode !== "once" && m.mode !== "loop") errs.push(`${at}.mode: once or loop`);
  if (m.loopFrom != null && !(typeof m.loopFrom === "number" && m.loopFrom >= 0 && m.loopFrom < dur)) errs.push(`${at}.loopFrom: seconds in [0, dur)`);
  if (m.bpm != null && !(typeof m.bpm === "number" && m.bpm > 0 && m.bpm <= 300)) errs.push(`${at}.bpm: in (0, 300]`);
  if (m.still != null && !(typeof m.still === "number" && m.still >= 0 && m.still <= dur)) errs.push(`${at}.still: seconds in [0, dur]`);
  if (m.fallback != null && !ACTS.includes(m.fallback as BuddyActName)) errs.push(`${at}.fallback: one of ${ACTS.join(", ")}`);
  if (m.react != null && typeof m.react !== "boolean") errs.push(`${at}.react: true or false`);
  const events: string[] = [];
  const fired = new Set<string>(), followed: Array<[string, string]> = [];
  const ev = (name: unknown, where: string, fires: boolean) => {
    if (typeof name !== "string" || !/^[a-z][a-z0-9_.-]{0,23}$/.test(name)) { errs.push(`${where}: an event name`); return; }
    if (!events.includes(name)) {
      if (events.length >= MOMENT_LIMITS.events) { errs.push(`${where}: at most ${MOMENT_LIMITS.events} events`); return; }
      events.push(name);
    }
    if (fires) fired.add(name); else followed.push([name, where]);
  };
  const tracks = (list: unknown, d: number, where: string) => {
    if (!Array.isArray(list) || list.length > MOMENT_LIMITS.tracks) { errs.push(`${where}: a list of at most ${MOMENT_LIMITS.tracks} tracks`); return; }
    let props = 0;
    list.forEach((raw: unknown, ti: number) => {
      const w = `${where}[${ti}]`;
      if (!isRec(raw)) { errs.push(`${w}: an object`); return; }
      const kind = String(raw.do);
      const fields = Object.hasOwn(TRACK_FIELDS, kind) ? TRACK_FIELDS[kind]! : null;
      if (!fields) { errs.push(`${w}: do "${kind}" is not one the apps play`); return; }
      const instant = INSTANT.has(kind) || (kind === "emit" && !(typeof raw.every === "number" && raw.every > 0));
      for (const [f, v] of Object.entries(raw)) {
        if (["do", "note"].includes(f)) continue;
        if (f === "at" || f === "to") { if (typeof v !== "number" || !(v >= 0 && v <= d)) errs.push(`${w}.${f}: seconds in [0, ${d}]`); continue; }
        if (f === "chance") { if (typeof v !== "number" || !(v >= 0 && v <= 1)) errs.push(`${w}.chance: in [0, 1]`); continue; }
        if (f === "if") { if (v !== "alone" && v !== "paired") errs.push(`${w}.if: alone or paired`); continue; }
        if (f === "after") { ev(v, `${w}.after`, false); continue; }
        const rule = fields[f];
        if (!rule) { errs.push(`${w}: ${kind} has no field ${f}`); continue; }
        if (rule === "x") {
          if (typeof v === "number") { if (!Number.isFinite(v)) errs.push(`${w}.${f}: a number`); }
          else if (typeof v === "string") { const e = checkMomentExpression(v); if (e) errs.push(`${w}.${f}: ${e}`); }
          else errs.push(`${w}.${f}: a number or an expression`);
        } else if (rule === "n") {
          const r: [number, number] = kind === "others" && f === "n" ? [1, 8] : RANGES[f] ?? [0, 1e9];
          if (typeof v !== "number" || !(v >= r[0] && v <= r[1])) errs.push(`${w}.${f}: a number in [${r[0]}, ${r[1]}]`);
        } else if (rule === "bool") { if (typeof v !== "boolean") errs.push(`${w}.${f}: true or false`); }
        else if (rule === "part") { if (!isRec(parts[String(v)])) errs.push(`${w}.${f}: no part "${String(v)}"`); }
        else if (rule === "parts") {
          if (!Array.isArray(v) || !v.length || v.length > 6) errs.push(`${w}.parts: 1 to 6 parts`);
          else for (const p of v) if (!isRec(parts[String(p)])) errs.push(`${w}.parts: no part "${String(p)}"`);
        } else if (rule === "paint") { if (!okPaint(v, kind === "emit") || v === "$paint") errs.push(`${w}.paint: a colour`); }
        else if (rule === "name") {
          if (f === "onMiss") ev(v, `${w}.onMiss`, true);
          else if (kind === "event") ev(v, `${w}.name`, true);
          else if (typeof v !== "string" || !/^[a-z][a-z0-9_.-]{0,31}$/.test(v)) errs.push(`${w}.${f}: a name (lower case)`);
        } else if (rule === "moment") { if (!isRec(moments[String(v)])) errs.push(`${w}.play: no moment "${String(v)}"`); }
        else { const list = ENUMS[rule]; if (list && !list.includes(String(v))) errs.push(`${w}.${f}: one of ${list.join(", ")}`); }
      }
      if (raw.to != null && instant && kind !== "hop") errs.push(`${w}.to: ${kind} happens once, at "at"`);
      if (raw.to != null && !instant && !(Number(raw.to) > Number(raw.at ?? 0))) errs.push(`${w}.to: after "at"`);
      if (kind === "walk" && raw.x == null && raw.dx == null && raw.toward == null) errs.push(`${w}: walk where (x, dx or toward)`);
      if (kind === "prop") { if (raw.part == null) errs.push(`${w}: a part`); if (++props > MOMENT_LIMITS.props) errs.push(`${w}: at most ${MOMENT_LIMITS.props} props in a recipe`); }
      if (kind === "emit" && raw.part == null && raw.parts == null) errs.push(`${w}: a part (or parts)`);
      if ((kind === "event" && raw.name == null) || (kind === "sound" && raw.name == null)) errs.push(`${w}: a name`);
      if (kind === "others" && raw.play == null) errs.push(`${w}: play (a moment)`);
    });
  };
  tracks(m.tracks, dur || 1, `${at}.tracks`);
  if (m.end != null) {
    if (!isRec(m.end) || typeof m.end.dur !== "number" || !(m.end.dur > 0 && m.end.dur <= 20)) errs.push(`${at}.end: { dur (0, 20], tracks }`);
    else tracks(m.end.tracks, m.end.dur, `${at}.end.tracks`);
  }
  for (const [name, w] of followed) if (!fired.has(name)) errs.push(`${w}: nothing fires "${name}"`);
}

// ---------------------------------------------------------------- the catalog served

/** The file, found from src/ or dist/ (as prompts.ts finds shared/prompts), or TULMI_SHARED_DIR. */
function looksFile(): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle without a file address: no file */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "bots", "looks.json"),
    here && resolve(here, "..", "..", "..", "..", "shared", "bots", "looks.json"), // tulmi/src/experience/bots → repo/shared
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "bots", "looks.json"), // dist/tulmi/src/experience/bots → /app/shared
    resolve(process.cwd(), "..", "shared", "bots", "looks.json"),
    resolve(process.cwd(), "shared", "bots", "looks.json"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Where a pushed catalog is kept (the control volume, beside the control plane's rules). */
export function pushedFile(): string {
  return join(process.env.CONTROL_DIR || "/data/control", "bot-looks.json");
}

let fileLooks: LooksCatalog | null | undefined;
let pushed: LooksCatalog | null | undefined;

/** The catalog in the repo (shared/bots/looks.json), read once. Null when it cannot be found or read. */
export function fileCatalog(): LooksCatalog | null {
  if (fileLooks !== undefined) return fileLooks;
  try {
    const p = looksFile();
    fileLooks = p ? (JSON.parse(readFileSync(p, "utf8")) as LooksCatalog) : null;
  } catch { fileLooks = null; }
  return fileLooks;
}

function pushedCatalog(): LooksCatalog | null {
  if (pushed !== undefined) return pushed;
  try {
    const p = pushedFile();
    const c = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as LooksCatalog) : null;
    pushed = c && !checkLooks(c).length ? c : null;
  } catch { pushed = null; }
  return pushed;
}

/** The catalog served now: one pushed since the deploy while its v is higher than the file's, else the file's. */
export function activeLooks(): LooksCatalog | null {
  const f = fileCatalog(), p = pushedCatalog();
  if (p && (!f || p.v > f.v)) return p;
  return f;
}

/**
 * Push a catalog without a deploy (PUT /v1/admin/bots/looks): checked as the apps would compile it, and its v must be
 * above the one served now. Kept on the control volume, so a restart keeps it, until a deploy brings a file with a
 * higher v (or it is taken back: dropPushed).
 */
export function pushLooks(spec: unknown, o: { dry?: boolean } = {}): { ok: true; v: number } | { ok: false; status: number; errors: string[] } {
  const errors = checkLooks(spec);
  if (errors.length) return { ok: false, status: 400, errors };
  const c = spec as LooksCatalog, now = activeLooks();
  if (now && c.v <= now.v) return { ok: false, status: 409, errors: [`v must be above ${now.v}, the one served now`] };
  if (o.dry) return { ok: true, v: c.v };
  const p = pushedFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(c));
  renameSync(`${p}.tmp`, p);
  pushed = c;
  return { ok: true, v: c.v };
}

/** Take a pushed catalog back: the file's is served again (the apps follow the flag down). */
export function dropPushed(): void {
  try { rmSync(pushedFile(), { force: true }); } catch { /* nothing kept */ }
  pushed = null;
}

/** Tests: forget what was read. */
export function resetLooksForTests(): void {
  fileLooks = undefined;
  pushed = undefined;
}

/** The bootstrap's word on the catalog: its version, and where an app fetches it. Nothing when there is none. */
export function looksFlags(): Record<string, unknown> {
  const c = activeLooks();
  return c ? { "bots.looks": { v: c.v, url: `/v1/bots/looks?v=${c.v}` } } : {};
}

// ---------------------------------------------------------------- for screens

/** A build that plays the catalog (it declares BotMoments), with the living bots. */
export const BOT_MOMENTS = "BotMoments";

/**
 * A moment for a node (BotBuddy, a tile, BotCard): `{ moment, momentMode }` for a build that plays it, else the recipe's
 * plain act (`{ act }`), which every build has. An id the catalog does not have: nothing.
 */
export function momentProps(can: ReadonlySet<string>, id: string, mode?: "once" | "loop"): { moment?: string; momentMode?: "once" | "loop"; act?: BuddyActName } {
  const m = activeLooks()?.moments?.[id];
  if (!m) return {};
  const format = typeof m.format === "number" ? m.format : 1;
  if (can.has(BOT_MOMENTS) && format <= LOOKS_FORMAT) return { moment: id, ...(mode ? { momentMode: mode } : {}) };
  return { act: (m.fallback as BuddyActName) ?? "play" };
}

/** Home's rare idle surprises (BotTiles `surprises`), from the catalog's `idle`, for a build that plays them. */
export function idleSurprises(can: ReadonlySet<string>): { every: number; chance: number; moments: string[] } | undefined {
  if (!can.has(BOT_MOMENTS)) return undefined;
  const c = activeLooks(), i = c?.idle;
  if (!i || !Array.isArray(i.moments) || !i.moments.length || !(Number(i.chance) > 0)) return undefined;
  return { every: Number(i.every) || 30, chance: Number(i.chance), moments: i.moments.filter((m) => !!c?.moments?.[m]) };
}
