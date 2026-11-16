/**
 * WHAT A SCENE IS: A FEW PARTS THAT COMPOSE, NOT A FILE. The story is in docs/cinema.md.
 *
 * A scene is DATA, never a .blend and never Python a model wrote. The model proposes this shape, check.ts reads every field and
 * drops or clamps what it cannot have, and script.ts turns what survives into a Blender script. Nothing a model writes is ever
 * executed: it chooses from shapes, materials, lights and moves, and we write the code.
 *
 *   look      the engine, how many samples, how big, and what the world is (a colour, or one of the skies we ship)
 *   camera    where it stands, what it looks at, its lens, and whether the background falls out of focus
 *   lights    key, fill, rim, sun, point, area — where each is, how strong, what colour
 *   objects   a shape (cube, sphere, cylinder, cone, torus, plane, text, or an asset we hold), where it is, how big it is,
 *             which material it wears, what is modified about it (bevel, smooth, array, mirror, solidify, subdivide), and
 *             the parts it is made of (an object may hold objects: a group that moves as one)
 *   materials a colour, how metal it is, how rough, whether it glows, whether it is glass
 *   motion    a still, or a turntable: the camera round the scene, or the scene round itself
 *
 * Everything is a number, an enum or a name from a list. The only free text is an object's `text` (which the script escapes) and
 * the names of materials and assets, both of which the checker holds to a charset. That is what makes a scene safe to run, the
 * same scene twice the same picture, and a change of mind three lines rather than a new file.
 *
 * Nothing here reads the environment, a store or a model.
 */

/** Cycles is the renderer that gets it right; Eevee is the one that gets it fast (and needs a real GPU to run at all). */
export const ENGINES = ["cycles", "eevee"] as const;
export type Engine = (typeof ENGINES)[number];

/** The shapes a scene can be built from, before anything is imported. */
export const SHAPES = ["cube", "sphere", "cylinder", "cone", "torus", "plane", "text", "asset"] as const;
export type ShapeKind = (typeof SHAPES)[number];

/** What can be done to a shape without modelling it by hand. */
export const MODS = ["bevel", "smooth", "array", "mirror", "solidify", "subdivide", "wireframe"] as const;
export type ModKind = (typeof MODS)[number];

/** What a light is for. key, fill and rim are placed as a photographer would; the rest are what Blender has. */
export const LIGHTS = ["key", "fill", "rim", "sun", "point", "area", "spot"] as const;
export type LightKind = (typeof LIGHTS)[number];

/** The skies we ship, by name. A scene never names a file: the runner knows where these are. */
export const SKIES = ["studio", "city", "sunset", "overcast", "night", "none"] as const;
export type Sky = (typeof SKIES)[number];

/** How the picture moves, if it moves at all. */
export const MOVES = ["still", "turntable", "orbit", "push"] as const;
export type MoveKind = (typeof MOVES)[number];

/** x, y, z in metres. Blender's z is up. */
export type Vec3 = [number, number, number];

export interface Material {
  /** #rrggbb. */
  colour: string;
  /** 0 is a dielectric, 1 is metal. */
  metallic: number;
  /** 0 is a mirror, 1 is chalk. */
  roughness: number;
  /** It gives off light of its own. */
  emission?: { colour: string; strength: number };
  /** It is see-through: glass, water, acrylic. */
  glass?: { ior: number };
  /** How much light passes through a thin thing (paper, a leaf). */
  translucency?: number;
}

export interface Mod {
  kind: ModKind;
  /** bevel: how wide (m) and in how many steps. */
  width?: number;
  segments?: number;
  /** array: how many, and how far apart each is from the last (m). */
  count?: number;
  offset?: Vec3;
  /** mirror: which way. */
  axis?: "x" | "y" | "z";
  /** solidify and wireframe: how thick (m). */
  thickness?: number;
  /** subdivide: how many times (each one is four times the faces). */
  levels?: number;
}

export interface Obj {
  /** Unique in the scene: lower-case letters, digits and single hyphens. It is how a later round says what to change. */
  id: string;
  shape: ShapeKind;
  /** For `text`: the words. For `asset`: which asset (the runner maps the name to a file; a scene never holds a path). */
  text?: string;
  asset?: string;
  /** Where its middle is. */
  at: Vec3;
  /** Degrees about each axis. */
  turn?: Vec3;
  /** One number for all three, or one for each. A sphere's is its radius, a cube's its half-width, as Blender has them. */
  size: number | Vec3;
  /** A name from `materials`. None: a plain grey. */
  material?: string;
  mods?: Mod[];
  /** The parts it is made of: they are placed relative to it, and it moves them. */
  parts?: Obj[];
  /** It is there, but light goes through it as if it were not (a floor that only catches shadow). */
  shadowOnly?: boolean;
}

export interface Light {
  kind: LightKind;
  at?: Vec3;
  /** What it points at. Omitted: the middle of the scene. */
  to?: Vec3;
  /** Watts for a point or an area, and the sun's own strength for a sun. */
  power: number;
  colour?: string;
  /** How big the lamp is (m): a big one is soft, a small one is hard. */
  size?: number;
}

export interface Camera {
  at: Vec3;
  to: Vec3;
  /** Millimetres. 35 is a room, 50 is an eye, 85 is a portrait, 135 is a product. */
  lens: number;
  /** The background falls away: the smaller the f-stop, the shallower it is. */
  blur?: { fStop: number };
}

export interface Look {
  engine: Engine;
  /** How many samples a frame gets. A preview wants a few, the real thing wants many. */
  samples: number;
  width: number;
  height: number;
  sky: Sky;
  /** How strong the sky is. */
  skyStrength?: number;
  /** The background colour when there is no sky (#rrggbb). */
  background?: string;
  /** No background at all: the picture comes back with a hole where the world was. */
  transparent?: boolean;
}

export interface Move {
  kind: MoveKind;
  /** How long it runs. */
  seconds: number;
  /** How many frames a second. */
  fps: number;
  /** turntable and orbit: how far round it goes, in degrees. push: how far the camera moves in, in metres. */
  amount?: number;
}

export interface Scene {
  look: Look;
  camera: Camera;
  lights: Light[];
  objects: Obj[];
  materials: Record<string, Material>;
  move?: Move;
  /** The same seed, the same grain in the picture. */
  seed?: number;
}

/**
 * WHAT A SCENE MAY NOT GO PAST. Every one of these is a number the checker clamps rather than a reason to refuse: a scene asking
 * for 4,000 objects comes back with the first 80 and a note, because half a scene a person can look at beats an error they
 * cannot. They are here, in one place, because they are the whole of what stops a render costing an hour.
 */
export const CAPS = {
  objects: 80,
  /** The parts under one object, and how deep that can go. */
  parts: 24,
  depth: 4,
  lights: 8,
  materials: 24,
  mods: 6,
  arrayCount: 64,
  subdivide: 3,
  /** Pixels, each way. */
  size: 1920,
  samples: 512,
  /** Seconds of film, and frames a second. */
  seconds: 20,
  fps: 30,
  /** Metres: anything further out than this is somewhere nobody is looking. */
  reach: 400,
  /** Characters in an object's text. */
  text: 120,
  /** Characters in a name. */
  name: 40,
} as const;

/** What a preview costs, against what the real thing costs: small, few samples, and nothing moves. */
export const PREVIEW = { width: 480, height: 360, samples: 24 } as const;

/** A scene as it came back from the checker: what survived, and what did not. */
export interface Checked {
  scene: Scene;
  /** One line for each thing dropped or clamped, in the order it happened. The next round reads them. */
  notes: string[];
}
