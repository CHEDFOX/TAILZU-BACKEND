/**
 * EVERY CATALOG, CHECKED WITH THE REAL ENGINES (anim/SPEC.md 5.3).
 *
 * checkLooks() in looks.ts reads a catalog the way the apps' core would. That is not enough once a push can carry a
 * moving picture: the apps' core is a different file, in a different language, and the fleet runs several builds of
 * it at once. So shared/bots/engines/ holds the engines themselves, generated or frozen, and every push compiles
 * the catalog in each of them, for real:
 *
 *   f2.cjs                 the engine of this round, generated from the phone's scene.ts and core.ts
 *                          (`node src/botTiles/genDesktop.mjs --server` in TAILZU-FRONTEND/app)
 *   f1-desktop-0.4.7.cjs   the format-1 engine the released window really runs, kept as it shipped
 *
 * An engine file is a UMD module: `require` gives it, and it is never asked to draw on a real surface, only to
 * compile and to run a scene against a counting context.
 *
 *   checkWithEngines(spec)  every error any engine finds, in words; none: every build plays it
 *   simulate(spec)          each format-2 moment run for its whole length on three node sizes, both facings, with
 *                           scripted inputs; over a budget is an error, "does not fit" is a warning
 *   enginesHere()           which engines were found (a deploy without them checks what it can, and says so)
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOKS_FORMAT_MAX, projectLooks } from "./project.js";

const require_ = createRequire(import.meta.url);

/** What an engine gives us. Only the few members the checks use are named. */
interface Engine {
  name: string;
  format: number;
  compileLooks: (spec: unknown) => { errors: string[]; moments: Map<string, EngineMoment>; scenes?: Map<string, EngineScene> };
  BotTile: new (o: Record<string, unknown>) => EngineTile;
  SCENE_LIMITS?: Record<string, number>;
}
interface EngineMoment { id: string; ok: boolean; why: string; dur: number; react: boolean; scenes?: number; fallback: string; still: number }
interface EngineScene { id: string; ops: number; dots: number; draws: number; bw: number; bh: number }
interface EngineTile {
  resize(w: number, h: number, floor: number): void;
  playMoment(m: EngineMoment, mode?: string): boolean;
  step(dt: number): void;
  draw(ctx: unknown, alpha?: number): void;
  setLevel(v: number): void;
  cue(what: string, x: number, y: number): boolean;
  finite(): boolean;
  looksReport(): { bad?: string[]; slow?: string[] };
  /** Face one way (1 right, -1 left): the whole facing, not just the sign, which a step would undo. */
  turn(dir: number): void;
  /** The governor's clock. The simulation hands it a still one, so a loaded server cannot refuse a good catalog. */
  clock: (() => number) | null;
  faceSign: number;
  scOX: Float64Array;
  scOY: Float64Array;
  scenesLive(): boolean;
}

/** Where the engines live. */
function enginesDir(): string | null {
  let here = "";
  try { here = dirname(fileURLToPath(import.meta.url)); } catch { /* a bundle without a file address */ }
  const candidates = [
    process.env.TULMI_SHARED_DIR && resolve(process.env.TULMI_SHARED_DIR, "bots", "engines"),
    here && resolve(here, "..", "..", "..", "..", "shared", "bots", "engines"),
    here && resolve(here, "..", "..", "..", "..", "..", "..", "shared", "bots", "engines"),
    resolve(process.cwd(), "..", "shared", "bots", "engines"),
    resolve(process.cwd(), "shared", "bots", "engines"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

let engines: Engine[] | null = null;

/** Every engine beside this build, loaded once. The format each one plays is its own LOOKS_FORMAT. */
export function loadEngines(): Engine[] {
  if (engines) return engines;
  const dir = enginesDir();
  const out: Engine[] = [];
  if (dir) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".cjs")).sort()) {
      try {
        const mod = require_(join(dir, name)) as { LOOKS_FORMAT?: number; compileLooks?: unknown; BotTile?: unknown };
        if (typeof mod.compileLooks !== "function" || typeof mod.BotTile !== "function") continue;
        out.push({ ...(mod as unknown as Engine), name, format: Number(mod.LOOKS_FORMAT) || 1 });
      } catch { /* an engine that will not load is reported by enginesHere() being short */ }
    }
  }
  engines = out;
  return out;
}

/** The engines found, by name and the format each plays. */
export function enginesHere(): Array<{ name: string; format: number }> {
  return loadEngines().map((e) => ({ name: e.name, format: e.format }));
}

/** Tests: load them again (a regenerated engine during a run). */
export function resetEnginesForTests(): void {
  engines = null;
}

/**
 * A drawing context that draws nothing and counts what it was asked for, with every format-2 member present. The
 * per-scene costs are checked against SCENE_LIMITS from the compiled numbers (which is what the phone budgets), so
 * this only has to not throw and to be cheap.
 */
function counter(): Record<string, unknown> & { calls: number } {
  const c: Record<string, unknown> & { calls: number } = {
    calls: 0, globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
  };
  for (const m of ["save", "restore", "translate", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "arc", "fill", "stroke", "clip", "rotate", "scale"]) {
    c[m] = () => { c.calls++; };
  }
  c.dots = () => { c.calls++; };
  return c;
}

/** The node sizes a moment is tried on: a Home tile, a page's stage, and a buddy's lane. */
const SIZES: Array<[string, number, number, number]> = [
  ["BotTiles", 169, 132, 72],
  ["BotStage", 340, 200, 150],
  ["BotBuddy", 150, 56, 44],
];

/**
 * Every engine compiles the catalog it would really be served (the projection for its own format), and the
 * format-2 engine also runs every format-2 moment. Returns the errors; warnings are separate.
 */
export function checkWithEngines(spec: unknown): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const list = loadEngines();
  if (!list.length) { warnings.push("no engines beside this build: shared/bots/engines is empty"); return { errors, warnings }; }
  for (const e of list) {
    const f = Math.min(e.format, LOOKS_FORMAT_MAX);
    let cut: unknown;
    try { cut = projectLooks(spec, f); } catch (err) { errors.push(`${e.name}: ${(err as Error).message}`); continue; }
    let L: { errors: string[]; moments: Map<string, EngineMoment>; scenes?: Map<string, EngineScene> };
    try { L = e.compileLooks(cut); } catch (err) { errors.push(`${e.name}: threw (${(err as Error).message})`); continue; }
    for (const msg of L.errors.slice(0, 8)) errors.push(`${e.name}: ${msg}`);
    if (L.errors.length > 8) errors.push(`${e.name}: and ${L.errors.length - 8} more`);
    if (f < LOOKS_FORMAT_MAX) continue;
    // Every format-2 recipe says what an older build does instead, and an idle surprise says what it looks like still.
    const moments = (cut as { moments?: Record<string, { format?: number }> }).moments ?? {};
    const idle = (cut as { idle?: { moments?: string[] } }).idle?.moments ?? [];
    for (const [id, raw] of Object.entries(moments)) {
      if ((raw.format ?? 1) < 2) continue;
      if (!("fallback" in raw)) errors.push(`moments.${id}: a format-2 recipe declares \`fallback\``);
      if (idle.includes(id) && !("still" in raw)) errors.push(`moments.${id}: an idle surprise declares \`still\``);
    }
    errors.push(...sizeErrors(e, cut));
    const sim = simulateWith(e, L, cut);
    errors.push(...sim.errors);
    warnings.push(...sim.warnings);
  }
  return { errors, warnings };
}

/**
 * The sizes SCENE_LIMITS sets and nothing else enforced: the whole catalog as it is served at this format, and
 * each scene's own JSON (anim/SPEC.md 3.7). Measured in bytes of UTF-8, as the phone downloads them.
 */
function sizeErrors(e: Engine, cut: unknown): string[] {
  const out: string[] = [];
  const limits = e.SCENE_LIMITS ?? {};
  if (limits.catalogBytes) {
    const n = Buffer.byteLength(JSON.stringify(cut), "utf8");
    if (n > limits.catalogBytes) out.push(`the catalog is ${n} bytes at f=${e.format}, over the ${limits.catalogBytes} a build will take`);
  }
  if (limits.bytes) {
    const scenes = (cut as { scenes?: Record<string, unknown> }).scenes ?? {};
    for (const [id, raw] of Object.entries(scenes)) {
      const n = Buffer.byteLength(JSON.stringify(raw), "utf8");
      if (n > limits.bytes) out.push(`scenes.${id}: ${n} bytes of JSON, over the ${limits.bytes} one scene may have`);
    }
  }
  return out;
}

/** Run every format-2 moment, for real, on three node sizes and both facings. */
function simulateWith(
  e: Engine,
  L: { moments: Map<string, EngineMoment>; scenes?: Map<string, EngineScene> },
  cut: unknown,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const raw = (cut as { moments?: Record<string, { format?: number }> }).moments ?? {};
  const limits = e.SCENE_LIMITS ?? {};
  for (const [id, m] of L.moments) {
    if ((raw[id]?.format ?? 1) < 2 || m.react) continue;
    if (!m.ok) { errors.push(`moments.${id}: ${m.why}`); continue; }
    for (const [where, w, h, floor] of SIZES) {
      for (const side of [1, -1]) {
        const t = new e.BotTile({ kind: "custom", color: "#4F7A3A", mood: "idle", seed: 4 });
        t.resize(w, h, floor);
        // The whole facing, not the sign alone: a step works the sign out from `face` again, so assigning it ran
        // both passes facing right and the mirrored fit and placement were never tried.
        t.turn(side);
        // A still clock: the governor must not drop a scene here because this machine was busy. What a scene costs
        // is budgeted from the compiled ops, dots and draw calls below, which do not move with the load.
        t.clock = () => 0;
        if (!t.playMoment(m, "once")) { errors.push(`moments.${id}: will not play`); break; }
        const ctx = counter();
        let drew = 0;
        const frames = Math.ceil((m.dur + 0.5) * 60);
        for (let f = 0; f < frames; f++) {
          t.setLevel(0.5 + 0.5 * Math.sin(f / 14));
          t.step(1 / 60);
          if (f === Math.floor(frames / 2)) t.cue("tap", t.scOX[0]!, t.scOY[0]! - 4);
          t.draw(ctx, 1);
          if (t.scenesLive()) drew++;
        }
        if (!t.finite()) errors.push(`moments.${id} on ${where}: a value went non-finite`);
        const report = t.looksReport();
        for (const bad of report.bad ?? []) {
          if (bad.endsWith(":fit")) warnings.push(`moments.${id} on ${where}: its scene does not fit`);
          else errors.push(`moments.${id} on ${where}: ${bad}`);
        }
        for (const slow of report.slow ?? []) warnings.push(`moments.${id} on ${where}: the governor slowed "${slow}"`);
        if (!drew) warnings.push(`moments.${id} on ${where}: its scene never drew`);
      }
    }
  }
  // The compiled cost of every scene, against the table the engine itself carries.
  for (const [id, sc] of L.scenes ?? new Map<string, EngineScene>()) {
    if (limits.ops && sc.ops > limits.ops) errors.push(`scenes.${id}: ${sc.ops} expression ops a frame, over ${limits.ops}`);
    if (limits.dotsScene && sc.dots > limits.dotsScene) errors.push(`scenes.${id}: ${sc.dots} dots, over ${limits.dotsScene}`);
    if (limits.draws && sc.draws > limits.draws) errors.push(`scenes.${id}: ${sc.draws} drawing calls, over ${limits.draws}`);
  }
  return { errors, warnings };
}

/** What each build gets for a moment: it plays, or it falls back to an act (the table in SPEC 5.4). */
export function perBuild(spec: unknown, id: string): Array<{ engine: string; format: number; plays: boolean; act?: string }> {
  return loadEngines().map((e) => {
    const f = Math.min(e.format, LOOKS_FORMAT_MAX);
    const cut = projectLooks(spec, f) as { moments?: Record<string, { fallback?: string }> };
    const m = cut.moments?.[id];
    if (m) return { engine: e.name, format: f, plays: true };
    const all = (spec as { moments?: Record<string, { fallback?: string }> }).moments ?? {};
    return { engine: e.name, format: f, plays: false, act: all[id]?.fallback ?? "play" };
  });
}
