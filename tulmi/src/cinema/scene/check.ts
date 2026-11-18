/**
 * THE DOOR A SCENE COMES IN BY. Nothing from a model reaches the renderer without passing through here.
 *
 *   checkScene(raw)   whatever came back → a scene that is safe to render, and a note for everything changed
 *
 * It never throws and never refuses the whole thing. A field that is wrong is put back to what it should be, a thing that is
 * too big is clamped, a thing that cannot be understood is dropped, and each of those leaves one line in `notes` — which is
 * what the next round reads, so a model that asked for 400 objects is told it got 80 rather than silently losing 320.
 *
 * The rules it holds (types.ts CAPS) are about three things: that a render ends (counts, samples, frames), that it is of
 * something (a size that is not zero, a camera that is not inside the thing it looks at), and that the script it becomes holds
 * no surprises (names to a charset, colours to six hex digits, text to its length — script.ts escapes on top of that).
 *
 * Nothing here reads the environment, a store or a model.
 */
import {
  CAPS, ENGINES, LIGHTS, MODS, MOVES, SHAPES, SKIES,
  type Checked, type Engine, type Light, type LightKind, type Material, type Mod, type ModKind, type Move, type MoveKind,
  type Obj, type Scene, type ShapeKind, type Sky, type Vec3,
} from "./types.js";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A number, or the fallback; held between lo and hi. */
const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

const int = (v: unknown, lo: number, hi: number, fallback: number): number => Math.round(num(v, lo, hi, fallback));

/** #rrggbb, lower-cased. Anything else is the fallback. */
const hex = (v: unknown, fallback: string): string => {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]!}${s[1]!}${s[2]!}${s[2]!}${s[3]!}${s[3]!}`;
  return fallback;
};

/** A name we are willing to write into a script: lower-case letters, digits, single hyphens. */
const name = (v: unknown): string => {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, CAPS.name);
};

const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  (typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : fallback);

/** Three angles, each brought round to 0..360. Degrees are not distances, so nothing here is clamped to the world. */
const turn3 = (v: unknown): Vec3 => {
  const one = (x: unknown): number => {
    const d = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
    return Number.isFinite(d) ? ((d % 360) + 360) % 360 : 0;
  };
  return Array.isArray(v) && v.length >= 3 ? [one(v[0]), one(v[1]), one(v[2])] : [0, 0, 0];
};

/** Three numbers, each within reach of the middle of the world. */
const vec3 = (v: unknown, fallback: Vec3): Vec3 => {
  if (!Array.isArray(v) || v.length < 3) return fallback;
  const r = CAPS.reach;
  return [num(v[0], -r, r, fallback[0]), num(v[1], -r, r, fallback[1]), num(v[2], -r, r, fallback[2])];
};

// ------------------------------------------------------------------ the pieces

function checkMaterial(raw: unknown, notes: string[], key: string): Material | null {
  if (!isObj(raw)) { notes.push(`material ${key}: not a material, dropped`); return null; }
  const m: Material = {
    colour: hex(raw.colour ?? raw.color, "#9a9a9a"),
    metallic: num(raw.metallic, 0, 1, 0),
    roughness: num(raw.roughness, 0, 1, 0.45),
  };
  if (isObj(raw.emission)) {
    m.emission = { colour: hex(raw.emission.colour ?? raw.emission.color, m.colour), strength: num(raw.emission.strength, 0, 100, 1) };
  }
  if (isObj(raw.glass)) m.glass = { ior: num(raw.glass.ior, 1, 2.5, 1.45) };
  if (raw.translucency !== undefined) m.translucency = num(raw.translucency, 0, 1, 0);
  return m;
}

function checkMod(raw: unknown, notes: string[], where: string): Mod | null {
  if (!isObj(raw)) return null;
  const kind = oneOf(raw.kind, MODS, "" as ModKind);
  if (!kind) { notes.push(`${where}: ${String(raw.kind)} is not something we can do to a shape, dropped`); return null; }
  const m: Mod = { kind };
  if (kind === "bevel") { m.width = num(raw.width, 0.0005, 1, 0.01); m.segments = int(raw.segments, 1, 8, 2); }
  if (kind === "array") {
    m.count = int(raw.count, 1, CAPS.arrayCount, 3);
    m.offset = vec3(raw.offset, [1, 0, 0]);
    if (int(raw.count, 1, 1e6, 3) > CAPS.arrayCount) notes.push(`${where}: ${CAPS.arrayCount} copies at most`);
  }
  if (kind === "mirror") m.axis = oneOf(raw.axis, ["x", "y", "z"] as const, "x");
  if (kind === "solidify" || kind === "wireframe") m.thickness = num(raw.thickness, 0.0005, 2, 0.02);
  if (kind === "subdivide") {
    m.levels = int(raw.levels, 1, CAPS.subdivide, 1);
    if (int(raw.levels, 1, 99, 1) > CAPS.subdivide) notes.push(`${where}: ${CAPS.subdivide} levels of subdivision at most`);
  }
  return m;
}

/** One object and everything under it. `budget` is how many objects are left in the whole scene. */
function checkObj(
  raw: unknown,
  notes: string[],
  ctx: { ids: Set<string>; materials: Set<string>; budget: { left: number }; depth: number; at: string },
): Obj | null {
  if (!isObj(raw)) return null;
  if (ctx.budget.left <= 0) return null;
  const shape = oneOf(raw.shape, SHAPES, "" as ShapeKind);
  if (!shape) { notes.push(`${ctx.at}: ${String(raw.shape)} is not a shape we have, dropped`); return null; }

  // A name of its own, and never the same as another's: a later round points at an object by its id.
  let id = name(raw.id);
  if (!id) id = `${shape}-${ctx.ids.size + 1}`;
  if (ctx.ids.has(id)) {
    let n = 2;
    while (ctx.ids.has(`${id}-${n}`)) n++;
    notes.push(`${ctx.at}: two objects called ${id}; the second is ${id}-${n}`);
    id = `${id}-${n}`;
  }
  ctx.ids.add(id);
  ctx.budget.left--;

  const o: Obj = { id, shape, at: vec3(raw.at, [0, 0, 0]), size: 1 };

  // Its size: one number for all three, or one for each. Never nothing, which renders as a point nobody can see.
  if (Array.isArray(raw.size)) o.size = vec3(raw.size, [1, 1, 1]).map((n) => Math.max(0.001, Math.abs(n))) as Vec3;
  else o.size = Math.max(0.001, Math.abs(num(raw.size, 0.001, CAPS.reach, 1)));

  if (raw.turn !== undefined) o.turn = turn3(raw.turn);
  if (raw.shadowOnly === true) o.shadowOnly = true;

  if (shape === "text") {
    const t = typeof raw.text === "string" ? raw.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, CAPS.text) : "";
    if (!t) { notes.push(`${ctx.at}: text with nothing to say, dropped`); ctx.ids.delete(id); ctx.budget.left++; return null; }
    o.text = t;
  }
  if (shape === "asset") {
    const a = name(raw.asset);
    if (!a) { notes.push(`${ctx.at}: an asset with no name, dropped`); ctx.ids.delete(id); ctx.budget.left++; return null; }
    o.asset = a;
  }

  const mat = name(raw.material);
  if (mat) {
    if (ctx.materials.has(mat)) o.material = mat;
    else notes.push(`${ctx.at}: there is no material called ${mat}; it wears the plain one`);
  }

  if (Array.isArray(raw.mods)) {
    const mods = raw.mods.slice(0, CAPS.mods).map((m, i) => checkMod(m, notes, `${ctx.at}.mods[${i}]`)).filter((m): m is Mod => !!m);
    if (raw.mods.length > CAPS.mods) notes.push(`${ctx.at}: ${CAPS.mods} changes to a shape at most`);
    if (mods.length) o.mods = mods;
  }

  if (Array.isArray(raw.parts) && raw.parts.length) {
    if (ctx.depth >= CAPS.depth) notes.push(`${ctx.at}: parts inside parts stop at ${CAPS.depth} deep`);
    else {
      const parts = raw.parts.slice(0, CAPS.parts)
        .map((p, i) => checkObj(p, notes, { ...ctx, depth: ctx.depth + 1, at: `${ctx.at}.parts[${i}]` }))
        .filter((p): p is Obj => !!p);
      if (raw.parts.length > CAPS.parts) notes.push(`${ctx.at}: ${CAPS.parts} parts at most`);
      if (parts.length) o.parts = parts;
    }
  }
  return o;
}

function checkLight(raw: unknown, notes: string[], i: number): Light | null {
  if (!isObj(raw)) return null;
  const kind = oneOf(raw.kind, LIGHTS, "" as LightKind);
  if (!kind) { notes.push(`light ${i}: ${String(raw.kind)} is not a kind of light, dropped`); return null; }
  const sun = kind === "sun";
  const l: Light = { kind, power: num(raw.power, 0, sun ? 50 : 20_000, sun ? 3 : 200) };
  if (raw.at !== undefined) l.at = vec3(raw.at, [3, -3, 3]);
  if (raw.to !== undefined) l.to = vec3(raw.to, [0, 0, 0]);
  if (raw.colour !== undefined || raw.color !== undefined) l.colour = hex(raw.colour ?? raw.color, "#ffffff");
  if (raw.size !== undefined) l.size = num(raw.size, 0.01, 20, 1);
  return l;
}

function checkMove(raw: unknown, notes: string[]): Move | undefined {
  if (!isObj(raw)) return undefined;
  const kind = oneOf(raw.kind, MOVES, "still" as MoveKind);
  if (kind === "still") return undefined;
  const seconds = num(raw.seconds, 0.5, CAPS.seconds, 4);
  if (num(raw.seconds, 0, 1e6, 4) > CAPS.seconds) notes.push(`move: ${CAPS.seconds} seconds at most`);
  const fps = int(raw.fps, 6, CAPS.fps, 24);
  const m: Move = { kind, seconds, fps };
  if (kind === "push") m.amount = num(raw.amount, -50, 50, 1);
  else m.amount = num(raw.amount, 1, 1440, 360);
  return m;
}

// ------------------------------------------------------------------ the scene

/**
 * Whatever a model answered, as something we are willing to render. The notes are the only way it learns what it lost, so they
 * are written for a reader, not for a log.
 */
export function checkScene(raw: unknown): Checked {
  const notes: string[] = [];
  const r = isObj(raw) ? raw : {};

  // Materials first: an object may only wear one that exists.
  const materials: Record<string, Material> = {};
  if (isObj(r.materials)) {
    for (const [k, v] of Object.entries(r.materials)) {
      if (Object.keys(materials).length >= CAPS.materials) { notes.push(`${CAPS.materials} materials at most`); break; }
      const key = name(k);
      if (!key) { notes.push(`material "${k}": the name cannot be used, dropped`); continue; }
      const m = checkMaterial(v, notes, key);
      if (m) materials[key] = m;
    }
  }

  const rawLook = isObj(r.look) ? r.look : {};
  const engine = oneOf(rawLook.engine, ENGINES, "cycles" as Engine);
  const look = {
    engine,
    samples: int(rawLook.samples, 1, CAPS.samples, 64),
    width: int(rawLook.width, 64, CAPS.size, 1280),
    height: int(rawLook.height, 64, CAPS.size, 960),
    sky: oneOf(rawLook.sky, SKIES, "studio" as Sky),
    skyStrength: num(rawLook.skyStrength, 0, 10, 1),
    background: hex(rawLook.background, "#111111"),
    ...(rawLook.transparent === true ? { transparent: true } : {}),
  };
  if (int(rawLook.samples, 1, 1e6, 64) > CAPS.samples) notes.push(`${CAPS.samples} samples at most`);
  if (int(rawLook.width, 1, 1e6, 1280) > CAPS.size || int(rawLook.height, 1, 1e6, 960) > CAPS.size) notes.push(`${CAPS.size} pixels at most, each way`);

  const rawCam = isObj(r.camera) ? r.camera : {};
  const camera = {
    at: vec3(rawCam.at, [4, -4, 2.4]),
    to: vec3(rawCam.to, [0, 0, 0.6]),
    lens: num(rawCam.lens, 8, 300, 50),
    ...(isObj(rawCam.blur) ? { blur: { fStop: num(rawCam.blur.fStop, 0.7, 32, 2.8) } } : {}),
  };
  // A camera standing where it is looking sees nothing at all.
  if (Math.hypot(camera.at[0] - camera.to[0], camera.at[1] - camera.to[1], camera.at[2] - camera.to[2]) < 0.05) {
    notes.push("the camera was standing in what it was looking at; moved back");
    camera.at = [camera.to[0] + 4, camera.to[1] - 4, camera.to[2] + 2.4];
  }

  const lights = (Array.isArray(r.lights) ? r.lights : [])
    .slice(0, CAPS.lights)
    .map((l, i) => checkLight(l, notes, i))
    .filter((l): l is Light => !!l);
  if (Array.isArray(r.lights) && r.lights.length > CAPS.lights) notes.push(`${CAPS.lights} lights at most`);

  const budget = { left: CAPS.objects };
  const ids = new Set<string>();
  const objects = (Array.isArray(r.objects) ? r.objects : [])
    .map((o, i) => checkObj(o, notes, { ids, materials: new Set(Object.keys(materials)), budget, depth: 0, at: `objects[${i}]` }))
    .filter((o): o is Obj => !!o);
  if (budget.left <= 0) notes.push(`${CAPS.objects} objects at most, parts counted`);

  const move = checkMove(r.move, notes);
  const scene: Scene = {
    look, camera, lights, objects, materials,
    ...(move ? { move } : {}),
    seed: int(r.seed, 0, 2 ** 31 - 1, 1),
  };

  // A scene with nothing in it renders as an empty room. Say so, rather than letting a picture of nothing come back.
  if (!objects.length) notes.push("the scene has nothing in it");
  if (!lights.length && look.sky === "none") notes.push("nothing lights the scene: no lamps and no sky");
  return { scene, notes };
}

/** How many objects a scene holds, parts and all: what a render's cost follows. */
export function sceneSize(scene: Scene): number {
  const count = (o: Obj): number => 1 + (o.parts ?? []).reduce((n, p) => n + count(p), 0);
  return scene.objects.reduce((n, o) => n + count(o), 0);
}

/** The frames a move comes to: a still is one. */
export function frameCount(scene: Scene): number {
  return scene.move ? Math.max(1, Math.round(scene.move.seconds * scene.move.fps)) : 1;
}
