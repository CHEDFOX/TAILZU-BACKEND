/**
 * A SCENE, AS THE SCRIPT THAT BUILDS IT. This is the only place Python is written, and a model never writes a line of it.
 *
 *   scriptFor(scene, o)   a checked scene → a Blender script that builds and renders it
 *
 * Why a script and not a file: it is small enough to keep forever, it reads as a diff when one thing changes, the same script
 * is the same picture on any machine, and the thing a person owns at the end is something they can take elsewhere. The .blend
 * and the frames are what it leaves behind, not what it is.
 *
 * TWO THINGS NEVER COME FROM THE SCENE. Where the frames are written (the runner sets CINEMA_OUT) and where an asset lives
 * (the runner sets CINEMA_ASSETS, a name → path map). So a scene can ask for "the speaker" by name, and nothing it says can
 * reach a path, a drive or another person's work.
 *
 * Nothing here reads the environment, a store or a model.
 */
import { frameCount } from "./check.js";
import type { Light, Material, Mod, Obj, Scene, Vec3 } from "./types.js";

/** Numbers as the script writes them: six places, no exponent, so the same scene is the same text. */
const n = (v: number): string => {
  const x = Number.isFinite(v) ? v : 0;
  return (Math.round(x * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, "") || "0";
};
const v3 = (v: Vec3): string => `(${n(v[0])}, ${n(v[1])}, ${n(v[2])})`;
const rad = (deg: number): string => n((deg * Math.PI) / 180);

/** A Python string, safely. Everything that could end the quote or the line is escaped. */
const py = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "")}"`;

/** #rrggbb as linear rgb, the way Blender wants it (sRGB is not linear, and a grey that ignores that looks washed out). */
const rgb = (hexColour: string): string => {
  const h = /^#[0-9a-f]{6}$/i.test(hexColour) ? hexColour : "#9a9a9a";
  const to = (i: number): number => {
    const c = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return `(${n(to(0))}, ${n(to(1))}, ${n(to(2))}, 1.0)`;
};

const HEAD = `# Written by X0 Bot's cinema bot from a checked scene. Do not edit by hand: change the scene and build it again.
import bpy, os, json, math
from mathutils import Vector

OUT = os.environ.get("CINEMA_OUT", "/tmp/cinema")
ASSETS = json.loads(os.environ.get("CINEMA_ASSETS", "{}"))
os.makedirs(OUT, exist_ok=True)

# A scene of our own, so nothing of Blender's start-up file is in the picture.
bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene

def point_at(ob, target):
    """Turn ob to face target, with its up still up."""
    d = Vector(target) - ob.location
    if d.length < 1e-6:
        return
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

def mat(name, colour, metallic, roughness, emit, emit_strength, ior, transmission, translucency):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = colour
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if "Emission Color" in b.inputs:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = emit_strength
    elif "Emission" in b.inputs:
        b.inputs["Emission"].default_value = emit
        b.inputs["Emission Strength"].default_value = emit_strength
    if transmission > 0:
        for key in ("Transmission Weight", "Transmission"):
            if key in b.inputs:
                b.inputs[key].default_value = transmission
                break
        b.inputs["IOR"].default_value = ior
    if translucency > 0:
        for key in ("Subsurface Weight", "Subsurface"):
            if key in b.inputs:
                b.inputs[key].default_value = translucency
                break
    return m

def wear(ob, m):
    if m is None or ob.type not in {"MESH", "CURVE", "FONT"}:
        return
    ob.data.materials.clear()
    ob.data.materials.append(m)
`;

function materialsPy(materials: Record<string, Material>): string {
  const out: string[] = ["", "# ---- materials"];
  out.push("M = {}");
  for (const [key, m] of Object.entries(materials)) {
    const emit = m.emission ? rgb(m.emission.colour) : "(0.0, 0.0, 0.0, 1.0)";
    const strength = m.emission ? n(m.emission.strength) : "0";
    const ior = m.glass ? n(m.glass.ior) : "1.45";
    const transmission = m.glass ? "1.0" : "0";
    out.push(`M[${py(key)}] = mat(${py(key)}, ${rgb(m.colour)}, ${n(m.metallic)}, ${n(m.roughness)}, ${emit}, ${strength}, ${ior}, ${transmission}, ${n(m.translucency ?? 0)})`);
  }
  return out.join("\n");
}

/** One shape, made where it stands. `parent` is the Python name of what it hangs from, if anything. */
function objectPy(o: Obj, parent: string | null, lines: string[], seq: { i: number }): void {
  const v = `o${seq.i++}`;
  const size: Vec3 = typeof o.size === "number" ? [o.size, o.size, o.size] : o.size;
  const at = v3(o.at);

  switch (o.shape) {
    case "cube": lines.push(`bpy.ops.mesh.primitive_cube_add(size=2, location=${at})`); break;
    case "sphere": lines.push(`bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=48, ring_count=24, location=${at})`); break;
    case "cylinder": lines.push(`bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=2, vertices=48, location=${at})`); break;
    case "cone": lines.push(`bpy.ops.mesh.primitive_cone_add(radius1=1, depth=2, vertices=48, location=${at})`); break;
    case "torus": lines.push(`bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.28, major_segments=64, minor_segments=20, location=${at})`); break;
    case "plane": lines.push(`bpy.ops.mesh.primitive_plane_add(size=2, location=${at})`); break;
    case "text":
      lines.push(`bpy.ops.object.text_add(location=${at})`);
      break;
    case "asset":
      // Only a name the runner knows; anything else leaves a note in the log and nothing in the scene.
      lines.push(`_p = ASSETS.get(${py(o.asset ?? "")})`);
      lines.push(`if _p and os.path.exists(_p):`);
      lines.push(`    _before = set(bpy.data.objects)`);
      lines.push(`    bpy.ops.wm.append(filepath=_p, directory=_p + "/Object/", filename=${py(o.asset ?? "")}) if _p.endswith(".blend") else bpy.ops.import_scene.gltf(filepath=_p)`);
      lines.push(`    _new = [x for x in bpy.data.objects if x not in _before]`);
      lines.push(`    bpy.ops.object.select_all(action="DESELECT")`);
      lines.push(`    for x in _new: x.select_set(True)`);
      lines.push(`    bpy.context.view_layer.objects.active = _new[0] if _new else None`);
      lines.push(`    if len(_new) > 1: bpy.ops.object.join()`);
      lines.push(`    if _new: bpy.context.view_layer.objects.active.location = ${at}`);
      lines.push(`    else: bpy.ops.object.empty_add(location=${at})`);
      lines.push(`else:`);
      lines.push(`    print("cinema: no asset called", ${py(o.asset ?? "")})`);
      lines.push(`    bpy.ops.object.empty_add(location=${at})`);
      break;
  }
  lines.push(`${v} = bpy.context.view_layer.objects.active`);
  lines.push(`${v}.name = ${py(o.id)}`);

  if (o.shape === "text") {
    lines.push(`${v}.data.body = ${py(o.text ?? "")}`);
    lines.push(`${v}.data.align_x = "CENTER"`);
    lines.push(`${v}.data.align_y = "CENTER"`);
    lines.push(`${v}.data.extrude = 0.04`);
    lines.push(`${v}.data.bevel_depth = 0.004`);
  }

  lines.push(`${v}.scale = ${v3(size)}`);
  if (o.turn) lines.push(`${v}.rotation_euler = (${rad(o.turn[0])}, ${rad(o.turn[1])}, ${rad(o.turn[2])})`);
  if (o.material) lines.push(`wear(${v}, M.get(${py(o.material)}))`);
  if (o.shadowOnly) lines.push(`${v}.is_shadow_catcher = True`);

  for (const m of o.mods ?? []) { const line = modPy(v, m); if (line) lines.push(line); }

  if (parent) {
    lines.push(`${v}.parent = ${parent}`);
    lines.push(`${v}.matrix_parent_inverse = ${parent}.matrix_world.inverted()`);
  }
  lines.push(`ALL.append(${v})`);

  for (const p of o.parts ?? []) objectPy(p, v, lines, seq);
}

function modPy(v: string, m: Mod): string {
  switch (m.kind) {
    case "bevel":
      return `_m = ${v}.modifiers.new("bevel", "BEVEL"); _m.width = ${n(m.width ?? 0.01)}; _m.segments = ${m.segments ?? 2}; _m.limit_method = "ANGLE"`;
    case "smooth":
      return `[p.__setattr__("use_smooth", True) for p in getattr(${v}.data, "polygons", [])]`;
    case "array":
      return `_m = ${v}.modifiers.new("array", "ARRAY"); _m.count = ${m.count ?? 3}; _m.use_relative_offset = False; _m.use_constant_offset = True; _m.constant_offset_displace = ${v3(m.offset ?? [1, 0, 0])}`;
    case "mirror":
      return `_m = ${v}.modifiers.new("mirror", "MIRROR"); _m.use_axis = (${m.axis === "x" ? "True, False, False" : m.axis === "y" ? "False, True, False" : "False, False, True"})`;
    case "solidify":
      return `_m = ${v}.modifiers.new("solidify", "SOLIDIFY"); _m.thickness = ${n(m.thickness ?? 0.02)}`;
    case "subdivide":
      return `_m = ${v}.modifiers.new("subdivide", "SUBSURF"); _m.levels = ${m.levels ?? 1}; _m.render_levels = ${m.levels ?? 1}`;
    case "wireframe":
      return `_m = ${v}.modifiers.new("wireframe", "WIREFRAME"); _m.thickness = ${n(m.thickness ?? 0.02)}`;
    default:
      return "";
  }
}

function lightPy(l: Light, i: number): string {
  const kindOf: Record<string, string> = { key: "AREA", fill: "AREA", rim: "AREA", sun: "SUN", point: "POINT", area: "AREA", spot: "SPOT" };
  // The three a photographer sets: a big soft one in front and to the side, a weaker one opposite it, a hard one behind.
  const place: Record<string, Vec3> = { key: [4, -4, 4], fill: [-5, -3, 2], rim: [-2.5, 4.5, 3.5] };
  const at = l.at ?? place[l.kind] ?? [4, -4, 4];
  const size = l.size ?? (l.kind === "key" ? 4 : l.kind === "fill" ? 5 : l.kind === "rim" ? 2 : 1);
  const lines = [
    `_d = bpy.data.lights.new("light${i}", ${py(kindOf[l.kind] ?? "AREA")})`,
    `_d.energy = ${n(l.power)}`,
    `_d.color = ${rgb(l.colour ?? "#ffffff").replace(/, 1\.0\)$/, ")")}`,
  ];
  if ((kindOf[l.kind] ?? "AREA") === "AREA") lines.push(`_d.size = ${n(size)}`);
  if ((kindOf[l.kind] ?? "AREA") === "SUN") lines.push(`_d.angle = ${n(Math.min(0.5, size / 20))}`);
  lines.push(`_o = bpy.data.objects.new("light${i}", _d)`);
  lines.push(`S.collection.objects.link(_o)`);
  lines.push(`_o.location = ${v3(at)}`);
  lines.push(`point_at(_o, ${v3(l.to ?? [0, 0, 0])})`);
  return lines.join("\n");
}

function worldPy(scene: Scene): string {
  const { sky, skyStrength = 1, background = "#111111" } = scene.look;
  const lines = [
    "",
    "# ---- the world",
    `W = bpy.data.worlds.new("world")`,
    `S.world = W`,
    `W.use_nodes = True`,
    `_bg = W.node_tree.nodes["Background"]`,
  ];
  if (sky === "none") {
    lines.push(`_bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)`);
    lines.push(`_bg.inputs["Strength"].default_value = 0.0`);
  } else {
    // A sky by name: the runner says where it is. Without it, the flat colour, which is a scene that still renders.
    lines.push(`_sky = ASSETS.get("sky-" + ${py(sky)})`);
    lines.push(`if _sky and os.path.exists(_sky):`);
    lines.push(`    _env = W.node_tree.nodes.new("ShaderNodeTexEnvironment")`);
    lines.push(`    _env.image = bpy.data.images.load(_sky)`);
    lines.push(`    W.node_tree.links.new(_env.outputs["Color"], _bg.inputs["Color"])`);
    lines.push(`else:`);
    lines.push(`    _bg.inputs["Color"].default_value = ${rgb(background)}`);
    lines.push(`_bg.inputs["Strength"].default_value = ${n(skyStrength)}`);
  }
  if (scene.look.transparent) lines.push(`S.render.film_transparent = True`);
  return lines.join("\n");
}

function cameraPy(scene: Scene): string {
  const { at, to, lens, blur } = scene.camera;
  const lines = [
    "",
    "# ---- the camera",
    `_cd = bpy.data.cameras.new("camera")`,
    `_cd.lens = ${n(lens)}`,
    `CAM = bpy.data.objects.new("camera", _cd)`,
    `S.collection.objects.link(CAM)`,
    `S.camera = CAM`,
    `CAM.location = ${v3(at)}`,
    `point_at(CAM, ${v3(to)})`,
  ];
  if (blur) {
    lines.push(`_cd.dof.use_dof = True`);
    lines.push(`_cd.dof.focus_distance = (Vector(${v3(to)}) - Vector(${v3(at)})).length`);
    lines.push(`_cd.dof.aperture_fstop = ${n(blur.fStop)}`);
  }
  return lines.join("\n");
}

function movePy(scene: Scene): string {
  const move = scene.move;
  const frames = frameCount(scene);
  if (!move) return ["", "# ---- one frame", "S.frame_start = 1", "S.frame_end = 1"].join("\n");
  const lines = ["", `# ---- ${move.kind}, ${move.seconds}s at ${move.fps}fps`, `S.render.fps = ${move.fps}`, "S.frame_start = 1", `S.frame_end = ${frames}`];
  const to = v3(scene.camera.to);
  if (move.kind === "turntable") {
    // The scene turns and the lights stay put, which is what a turntable is.
    lines.push(`bpy.ops.object.empty_add(location=${to})`);
    lines.push(`SPIN = bpy.context.view_layer.objects.active`);
    lines.push(`SPIN.name = "turntable"`);
    lines.push(`for _o in ALL:`);
    lines.push(`    if _o.parent is None:`);
    lines.push(`        _o.parent = SPIN`);
    lines.push(`        _o.matrix_parent_inverse = SPIN.matrix_world.inverted()`);
    lines.push(`SPIN.rotation_euler = (0, 0, 0)`);
    lines.push(`SPIN.keyframe_insert("rotation_euler", frame=1)`);
    lines.push(`SPIN.rotation_euler = (0, 0, ${rad(move.amount ?? 360)})`);
    lines.push(`SPIN.keyframe_insert("rotation_euler", frame=${frames})`);
    lines.push(`for _fc in SPIN.animation_data.action.fcurves:`);
    lines.push(`    for _k in _fc.keyframe_points: _k.interpolation = "LINEAR"`);
  } else if (move.kind === "orbit") {
    // The camera walks round instead, so the light on the thing changes as it goes.
    lines.push(`bpy.ops.object.empty_add(location=${to})`);
    lines.push(`PIVOT = bpy.context.view_layer.objects.active`);
    lines.push(`PIVOT.name = "orbit"`);
    lines.push(`CAM.parent = PIVOT`);
    lines.push(`CAM.matrix_parent_inverse = PIVOT.matrix_world.inverted()`);
    lines.push(`PIVOT.rotation_euler = (0, 0, 0)`);
    lines.push(`PIVOT.keyframe_insert("rotation_euler", frame=1)`);
    lines.push(`PIVOT.rotation_euler = (0, 0, ${rad(move.amount ?? 360)})`);
    lines.push(`PIVOT.keyframe_insert("rotation_euler", frame=${frames})`);
    lines.push(`for _fc in PIVOT.animation_data.action.fcurves:`);
    lines.push(`    for _k in _fc.keyframe_points: _k.interpolation = "LINEAR"`);
  } else if (move.kind === "push") {
    lines.push(`_from = Vector(${v3(scene.camera.at)})`);
    lines.push(`_to = Vector(${to})`);
    lines.push(`_dir = (_to - _from).normalized()`);
    lines.push(`CAM.location = _from`);
    lines.push(`CAM.keyframe_insert("location", frame=1)`);
    lines.push(`CAM.location = _from + _dir * ${n(move.amount ?? 1)}`);
    lines.push(`CAM.keyframe_insert("location", frame=${frames})`);
  }
  return lines.join("\n");
}

export interface ScriptOpts {
  /** A preview overrides what the scene asked for: small, few samples, and one frame of whatever it is. */
  preview?: boolean;
  /** Render only this one frame of a move (the middle of a turntable says more than its first frame). */
  frame?: number;
}

/** A checked scene as the script that builds and renders it. The same scene gives the same text, byte for byte. */

/** Denoise where the build has the denoiser, never where it has not (see the render settings below). */
export const DENOISE = `S.cycles.use_denoising = bool(getattr(bpy.app.build_options, "openimagedenoise", False))`;

export function scriptFor(scene: Scene, o: ScriptOpts = {}): string {
  const preview = o.preview === true;
  const width = preview ? 480 : scene.look.width;
  const height = preview ? 360 : scene.look.height;
  const samples = preview ? Math.min(24, scene.look.samples) : scene.look.samples;
  const still = preview || o.frame !== undefined || !scene.move;

  const lines: string[] = [HEAD, "", "ALL = []", materialsPy(scene.materials), "", "# ---- what is in it"];
  const seq = { i: 0 };
  for (const ob of scene.objects) objectPy(ob, null, lines, seq);

  lines.push("", "# ---- the lights");
  scene.lights.forEach((l, i) => lines.push(lightPy(l, i)));
  lines.push(worldPy(scene));
  lines.push(cameraPy(scene));
  lines.push(movePy(scene));

  lines.push("", "# ---- how it is rendered");
  if (scene.look.engine === "cycles") {
    lines.push(`S.render.engine = "CYCLES"`);
    lines.push(`S.cycles.samples = ${samples}`);
    // The denoiser only where this Blender was built with it: a build without it (Ubuntu's own package) refuses to render a
    // frame at all when asked to denoise, so asking unconditionally turned a missing library into no picture.
    lines.push(DENOISE);
    lines.push(`S.cycles.seed = ${scene.seed ?? 1}`);
    lines.push(`S.cycles.use_adaptive_sampling = True`);
    // Whatever this machine has: a card if there is one, its cores if there is not.
    lines.push(`try:`);
    lines.push(`    _p = bpy.context.preferences.addons["cycles"].preferences`);
    lines.push(`    for _t in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):`);
    lines.push(`        _p.compute_device_type = _t`);
    lines.push(`        _p.get_devices()`);
    lines.push(`        if any(d.type == _t for d in _p.devices):`);
    lines.push(`            for d in _p.devices: d.use = d.type in (_t, "CPU")`);
    lines.push(`            S.cycles.device = "GPU"`);
    lines.push(`            break`);
    lines.push(`except Exception as e:`);
    lines.push(`    print("cinema: cpu only (", e, ")")`);
  } else {
    // Eevee draws with a graphics card. On a machine that has none — a server, a container — there is nothing for it to draw
    // with, so the render falls to Cycles, which is slower and runs anywhere. Decided here, at run time, because only the
    // machine knows what it has.
    lines.push(`try:`);
    lines.push(`    import gpu`);
    lines.push(`    _backend = str(gpu.platform.backend_type_get())`);
    lines.push(`except Exception:`);
    lines.push(`    _backend = "NONE"`);
    lines.push(`if "NONE" in _backend or "UNKNOWN" in _backend:`);
    lines.push(`    print("cinema: no graphics card here, so cycles instead of eevee")`);
    lines.push(`    S.render.engine = "CYCLES"`);
    lines.push(`    S.cycles.samples = ${Math.min(samples, 64)}`);
    lines.push(`    ${DENOISE}`);
    lines.push(`    S.cycles.seed = ${scene.seed ?? 1}`);
    lines.push(`else:`);
    lines.push(`    S.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"`);
    lines.push(`    try: S.eevee.taa_render_samples = ${samples}`);
    lines.push(`    except Exception: pass`);
  }
  lines.push(`S.render.resolution_x = ${width}`);
  lines.push(`S.render.resolution_y = ${height}`);
  lines.push(`S.render.resolution_percentage = 100`);
  // A still comes back as one picture; anything that moves comes back as ONE video, never a thousand frames to clean up
  // afterwards (Blender's own encoder, so nothing else has to be installed).
  if (still) {
    lines.push(`S.render.image_settings.file_format = "PNG"`);
    lines.push(`S.render.image_settings.color_mode = ${scene.look.transparent ? '"RGBA"' : '"RGB"'}`);
    lines.push(`S.render.filepath = os.path.join(OUT, "f_")`);
  } else {
    lines.push(`S.render.image_settings.file_format = "FFMPEG"`);
    lines.push(`S.render.ffmpeg.format = "MPEG4"`);
    lines.push(`S.render.ffmpeg.codec = "H264"`);
    lines.push(`S.render.ffmpeg.constant_rate_factor = "MEDIUM"`);
    lines.push(`S.render.ffmpeg.ffmpeg_preset = "GOOD"`);
    lines.push(`S.render.ffmpeg.gopsize = ${Math.max(1, Math.round((scene.move?.fps ?? 24) / 2))}`);
    lines.push(`S.render.filepath = os.path.join(OUT, "clip")`);
  }
  if (o.frame !== undefined) lines.push(`S.frame_set(${Math.max(1, Math.round(o.frame))})`);
  lines.push(`bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "scene.blend"))`);
  lines.push(still ? `bpy.ops.render.render(write_still=True)` : `bpy.ops.render.render(animation=True)`);
  lines.push(`print("cinema: done")`);
  return `${lines.join("\n")}\n`;
}
